<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    createGetCurrentRunMessage,
    createCreateRunMessage,
    createAbortRunMessage,
    type FetchFailureMode,
  } from '../messaging/messages';
  import {
    isCurrentRunResponseMessage,
    isCreateRunResponseMessage,
    isRunStateUpdateMessage,
  } from '../messaging/validator';
  import {
    getAllRuns,
    getEventsByRunId,
    getSignalsByRunId,
    getRecoveryByRunId,
    getFindingsByRunId,
  } from '../storage/repository';
  import type { ExperimentRun, ExperimentState } from '../domain/run';
  import type { ExperimentDefinition } from '../domain/experiment';
  import type { HavocEvent } from '../domain/event';
  import type { Signal } from '../domain/signal';
  import type { Finding } from '../domain/finding';
  import type { Recovery } from '../domain/recovery';
  import type { Target } from '../domain/target';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let currentRun: ExperimentRun | null = null;
  let activeTab: Target | null = null;
  let loading = true;
  let error: string | null = null;
  let starting = false;
  let aborting = false;

  // Run history / inspected records
  let events: HavocEvent[] = [];
  let signals: Signal[] = [];
  let recovery: Recovery | undefined = undefined;
  let findings: Finding[] = [];

  // Active view tab: 'timeline' | 'signals' | 'autopsy' | 'config'
  let activeTabNav: 'timeline' | 'signals' | 'autopsy' | 'config' = 'timeline';

  // ---------------------------------------------------------------------------
  // Experiment Configuration
  // ---------------------------------------------------------------------------
  type KindOption = 'fetch_latency' | 'fetch_failure' | 'input_stress' | 'viewport_stress';
  let selectedKind: KindOption = 'fetch_latency';

  // fetch_latency params
  let delayMs = 800;
  let durationMs = 5000;
  let recoveryWindowMs = 8000;

  // fetch_failure params
  let failureMode: FetchFailureMode = 'transport_error';
  let syntheticStatus = 503;
  let timeoutMs = 8000;

  // input_stress params
  let inputStressMode: import('../messaging/messages').InputStressMode = 'all';

  // viewport_stress params
  let viewportStressMode: import('../messaging/messages').ViewportStressMode = 'mobile_narrow';

  function buildDefinition(): ExperimentDefinition {
    let name = '';
    if (selectedKind === 'fetch_latency') {
      name = `LATENCY +${delayMs}ms`;
    } else if (selectedKind === 'fetch_failure') {
      name = `FAILURE (${failureMode.toUpperCase()})`;
    } else if (selectedKind === 'input_stress') {
      name = `INPUT STRESS (${inputStressMode.toUpperCase()})`;
    } else {
      name = `VIEWPORT (${viewportStressMode.toUpperCase()})`;
    }

    const base = {
      id: crypto.randomUUID(),
      name,
      description: 'Automated chaos experiment',
      durationMs,
    };

    if (selectedKind === 'fetch_latency') {
      return {
        ...base,
        kind: 'fetch_latency' as const,
        params: { delayMs, durationMs, recoveryWindowMs },
      };
    } else if (selectedKind === 'fetch_failure') {
      return {
        ...base,
        kind: 'fetch_failure' as const,
        params: {
          mode: failureMode,
          durationMs,
          recoveryWindowMs,
          ...(failureMode === 'synthetic_http_error' && { syntheticStatus }),
          ...(failureMode === 'synthetic_timeout' && { timeoutMs }),
        },
      };
    } else if (selectedKind === 'input_stress') {
      return {
        ...base,
        kind: 'input_stress' as const,
        params: {
          mode: inputStressMode,
          durationMs,
          recoveryWindowMs,
        },
      };
    } else {
      return {
        ...base,
        kind: 'viewport_stress' as const,
        params: {
          mode: viewportStressMode,
          durationMs,
          recoveryWindowMs,
        },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle & Polling
  // ---------------------------------------------------------------------------
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  onMount(async () => {
    await resolveActiveTab();
    await syncState();
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    // Poll while run is active to stream events and signals in real time
    pollInterval = setInterval(async () => {
      if (isRunActive && currentRun) {
        await loadRunDetails(currentRun.runId);
      }
    }, 600);
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
    chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  });

  async function resolveActiveTab(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id !== undefined && tab.url) {
        let origin = '';
        try {
          origin = new URL(tab.url).origin;
        } catch {
          origin = tab.url;
        }
        activeTab = { tabId: tab.id, origin, url: tab.url, frameId: 0 };
      }
    } catch (e) {
      console.warn('[HAVOC][popup] could not resolve active tab', e);
    }
  }

  async function syncState(): Promise<void> {
    loading = true;
    error = null;
    try {
      // 1. Query SW for active in-memory run
      const response: unknown = await chrome.runtime.sendMessage(createGetCurrentRunMessage());
      if (isCurrentRunResponseMessage(response) && response.run) {
        currentRun = response.run;
      } else {
        // 2. If no active run in SW, read the most recent run from IndexedDB
        const runs = await getAllRuns();
        if (runs.length > 0) {
          runs.sort((a, b) => b.createdAt - a.createdAt);
          currentRun = runs[0];
        } else {
          currentRun = null;
        }
      }

      // 3. Load associated details if we have a run
      if (currentRun) {
        await loadRunDetails(currentRun.runId);
      }
    } catch (e) {
      error = 'Could not sync state with background worker';
      console.error('[HAVOC][popup] syncState error', e);
    } finally {
      loading = false;
    }
  }

  async function loadRunDetails(runId: string): Promise<void> {
    try {
      const [evts, sigs, rec, fnds] = await Promise.all([
        getEventsByRunId(runId),
        getSignalsByRunId(runId),
        getRecoveryByRunId(runId),
        getFindingsByRunId(runId),
      ]);
      events = evts;
      signals = sigs;
      recovery = rec;
      findings = fnds;
    } catch (e) {
      console.error('[HAVOC][popup] loadRunDetails error', e);
    }
  }

  function handleRuntimeMessage(message: unknown): void {
    if (isRunStateUpdateMessage(message)) {
      if (message.run) {
        currentRun = message.run;
        loadRunDetails(message.run.runId);
      } else if (currentRun) {
        // State completed / reset
        starting = false;
        aborting = false;
        loadRunDetails(currentRun.runId);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  async function handleStartRun(): Promise<void> {
    if (starting || isRunActive) return;
    starting = true;
    error = null;
    try {
      const def = buildDefinition();
      const response: unknown = await chrome.runtime.sendMessage(
        createCreateRunMessage(def, activeTab ?? undefined)
      );

      if (isCreateRunResponseMessage(response)) {
        if (response.error) {
          error = response.error;
          starting = false;
        } else if (response.run) {
          currentRun = response.run;
          events = [];
          signals = [];
          recovery = undefined;
          findings = [];
          activeTabNav = 'timeline';
        }
      } else {
        error = 'Invalid response received from service worker';
        starting = false;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to launch experiment';
      starting = false;
    }
  }

  async function handleAbortRun(): Promise<void> {
    if (!isRunActive || aborting) return;
    aborting = true;
    try {
      await chrome.runtime.sendMessage(createAbortRunMessage());
    } catch (e) {
      console.error('[HAVOC][popup] abort error', e);
    } finally {
      setTimeout(() => {
        aborting = false;
      }, 1000);
    }
  }

  // ---------------------------------------------------------------------------
  // Computed helpers
  // ---------------------------------------------------------------------------
  const TERMINAL_STATES = new Set<ExperimentState>([
    'COMPLETED',
    'FAILED',
    'ABORTED',
    'TIMED_OUT',
    'CLEANUP_FAILED',
    'TARGET_LOST',
  ]);

  const PIPELINE_STEPS: ExperimentState[] = [
    'CREATED',
    'PREPARING',
    'ACTIVE',
    'STOPPING',
    'CLEANING',
    'EVALUATING',
    'COMPLETED',
  ];

  $: isRunActive = currentRun !== null && !TERMINAL_STATES.has(currentRun.state);
  $: canStart = !loading && !isRunActive && !starting;

  function getStepIndex(state: ExperimentState): number {
    const idx = PIPELINE_STEPS.indexOf(state);
    return idx >= 0 ? idx : -1;
  }

  function formatRelativeTime(timestamp: number, baseTimestamp: number): string {
    const diff = (timestamp - baseTimestamp) / 1000;
    const sign = diff >= 0 ? '+' : '-';
    return `${sign}${Math.abs(diff).toFixed(2)}s`;
  }

  function formatConfidence(conf: number): string {
    return `${Math.round(conf * 100)}%`;
  }
</script>

<div class="lab-frame">
  <div class="grid-texture" />

  <main class="console-body">
    <header class="console-header">
      <div class="title-row">
        <div class="brand">
          <span class="brand-logo">HAVOC</span>
          <span class="brand-tag">[v1.0 LAB-DECK]</span>
        </div>
        <div class="status-indicator">
          {#if isRunActive}
            <span class="badge badge-active blink">● ACTIVE [{currentRun?.state}]</span>
          {:else if currentRun?.state === 'COMPLETED'}
            <span class="badge badge-completed">■ COMPLETED</span>
          {:else if currentRun && TERMINAL_STATES.has(currentRun.state)}
            <span class="badge badge-terminal">✖ {currentRun.state}</span>
          {:else}
            <span class="badge badge-standby">□ STANDBY</span>
          {/if}
        </div>
      </div>

      <div class="target-strip">
        <span class="target-label">[TARGET]</span>
        {#if activeTab}
          <span class="target-chip tab-id">TAB #{activeTab.tabId}</span>
          <span class="target-origin" title={activeTab.url}>{activeTab.origin}</span>
        {:else}
          <span class="target-chip no-target">NO ACTIVE TARGET</span>
        {/if}
      </div>
    </header>

    {#if error}
      <div class="error-banner">
        <span class="error-icon">!</span>
        <span class="error-text">{error}</span>
      </div>
    {/if}

    {#if currentRun}
      <section class="pipeline-section">
        <div class="pipeline-header">
          <span class="sec-label">STATE MACHINE TRACKER</span>
          <span class="run-id-tag">RUN #{currentRun.runId.slice(0, 8)}</span>
        </div>
        <div class="pipeline-bar">
          {#each PIPELINE_STEPS as step, i}
            {@const currentIdx = getStepIndex(currentRun.state)}
            {@const isCurrent = currentRun.state === step}
            {@const isPast = currentIdx > i || currentRun.state === 'COMPLETED'}
            {@const isFailed = TERMINAL_STATES.has(currentRun.state) && currentRun.state !== 'COMPLETED' && currentRun.state === step}
            <div class="pipe-node" class:current={isCurrent} class:past={isPast} class:failed={isFailed} title={step}>
              <span class="node-glyph">
                {#if isFailed}<span class="glyph-pixel glyph-failed">✖</span>
                {:else if isPast}<span class="glyph-pixel glyph-past">■</span>
                {:else if isCurrent}<span class="glyph-pixel glyph-current">▣</span>
                {:else}<span class="glyph-pixel glyph-pending">□</span>{/if}
              </span>
              <span class="node-num">0{i + 1}</span>
              <span class="node-name">{step}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <nav class="console-nav">
      <button class="nav-tab" class:active={activeTabNav === 'timeline'} on:click={() => (activeTabNav = 'timeline')}>
        [01] TIMELINE ({events.length})
      </button>
      <button class="nav-tab" class:active={activeTabNav === 'signals'} on:click={() => (activeTabNav = 'signals')}>
        [02] SIGNALS ({signals.length})
      </button>
      <button class="nav-tab" class:active={activeTabNav === 'autopsy'} on:click={() => (activeTabNav = 'autopsy')}>
        [03] AUTOPSY {recovery ? `[${recovery.outcome}]` : ''}
      </button>
      <button class="nav-tab" class:active={activeTabNav === 'config'} on:click={() => (activeTabNav = 'config')}>
        [04] CONTROLS
      </button>
    </nav>

    <div class="viewport">
      {#if activeTabNav === 'timeline'}
        <div class="timeline-view">
          {#if events.length === 0}
            <div class="empty-state">
              <div class="pixel-radar"><span class="radar-ring" /><span class="radar-sweep" /><span class="radar-blip" /></div>
              <span class="empty-prompt">&gt; Awaiting observation telemetry...</span>
              <span class="empty-sub">Trigger chaos injection to observe network and DOM mutations.</span>
            </div>
          {:else}
            <div class="event-list">
              {#each events as evt}
                <div class="event-row type-{evt.type.toLowerCase()}">
                  <div class="evt-meta">
                    <span class="evt-seq">#{String(evt.sequence).padStart(2, '0')}</span>
                    <span class="evt-time">{currentRun ? formatRelativeTime(evt.timestamp, currentRun.createdAt) : '+0.00s'}</span>
                    <span class="evt-badge badge-{evt.type.toLowerCase()}">{evt.type}</span>
                  </div>
                  <div class="evt-details">
                    {#if evt.resource}<span class="evt-resource" title={evt.resource}>{evt.resource}</span>{/if}
                    {#if evt.metadata?.kind}
                      <span class="evt-dom-kind">DOM: {evt.metadata.kind}</span>
                      {#if evt.metadata?.selector}<span class="evt-selector" title={String(evt.metadata.selector)}>{evt.metadata.selector}</span>{/if}
                      {#if evt.metadata?.textSnippet}<span class="evt-snippet">"{evt.metadata.textSnippet}"</span>{/if}
                    {/if}
                    {#if evt.metadata?.status !== undefined}
                      <span class="evt-status" class:ok={Number(evt.metadata.status) >= 200 && Number(evt.metadata.status) < 300} class:fail={Number(evt.metadata.status) === 0 || Number(evt.metadata.status) >= 400}>
                        HTTP {evt.metadata.status}
                      </span>
                    {/if}
                    {#if evt.metadata?.duration !== undefined}<span class="evt-duration">{(Number(evt.metadata.duration)).toFixed(0)}ms</span>{/if}
                    {#if evt.metadata?.errorMessage}<span class="evt-err-msg">{evt.metadata.errorMessage}</span>{/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {:else if activeTabNav === 'signals'}
        <div class="signals-view">
          {#if signals.length === 0}
            <div class="empty-state">
              <div class="pixel-radar"><span class="radar-ring" /><span class="radar-sweep" /><span class="radar-blip" /></div>
              <span class="empty-prompt">&gt; No derived signals generated.</span>
              <span class="empty-sub">Signals correlate observed telemetry with causal chaos events.</span>
            </div>
          {:else}
            <div class="signals-list">
              {#each signals as sig}
                <div class="signal-card type-{sig.type.toLowerCase()}">
                  <div class="sig-header">
                    <span class="sig-type">{sig.type}</span>
                    <span class="sig-conf-badge">{formatConfidence(sig.confidence)} CONF</span>
                  </div>
                  <div class="sig-meter"><div class="sig-meter-fill" style="width: {Math.round(sig.confidence * 100)}%" /></div>
                  <div class="sig-footer">
                    <span class="sig-prov-label">DERIVED FROM:</span>
                    <span class="sig-prov-tags">
                      {#each sig.derivedFrom.slice(0, 3) as refId}<span class="ref-tag">#{refId.slice(0, 6)}</span>{/each}
                      {#if sig.derivedFrom.length > 3}<span class="ref-more">+{sig.derivedFrom.length - 3}</span>{/if}
                    </span>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {:else if activeTabNav === 'autopsy'}
        <div class="autopsy-view">
          {#if !recovery}
            <div class="empty-state">
              <div class="pixel-radar"><span class="radar-ring" /><span class="radar-sweep" /><span class="radar-blip" /></div>
              <span class="empty-prompt">&gt; Recovery autopsy pending.</span>
              <span class="empty-sub">Autopsy generates post-chaos evaluation findings upon run completion.</span>
            </div>
          {:else}
            <div class="autopsy-report">
              <div class="outcome-banner outcome-{recovery.outcome.toLowerCase()}">
                <div class="outcome-title">
                  <span class="outcome-tag">[RECOVERY OUTCOME]</span>
                  <span class="outcome-val">{recovery.outcome}</span>
                </div>
                <div class="outcome-window">
                  <span>WINDOW: {((recovery.windowEnd - recovery.windowStart) / 1000).toFixed(1)}s</span>
                  <span>EVAL: {new Date(recovery.evaluatedAt).toLocaleTimeString()}</span>
                </div>
              </div>
              {#if findings.length === 0}
                <div class="no-finding-box">
                  <span class="nf-icon">■</span>
                  <span class="nf-text">
                    {#if recovery.outcome === 'RECOVERED'}RESILIENT: Application retried and recovered successfully.
                    {:else}INCONCLUSIVE: Insufficient observable evidence to conclude failure.{/if}
                  </span>
                </div>
              {:else}
                {#each findings as fnd}
                  <div class="finding-card severity-{fnd.severity.toLowerCase()}">
                    <div class="finding-header">
                      <span class="sev-badge sev-{fnd.severity.toLowerCase()}">[{fnd.severity} SEVERITY]</span>
                      <span class="fnd-conf">{formatConfidence(fnd.confidence)} CONFIDENCE</span>
                    </div>
                    <p class="fnd-desc">{fnd.description}</p>
                    <div class="fnd-evidence">
                      <span class="ev-label">EVIDENCE ATTACHED:</span>
                      <span class="ev-count">{fnd.evidenceIds.length} records verified</span>
                    </div>
                  </div>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {:else if activeTabNav === 'config'}
        <div class="config-view">
          <fieldset class="control-box">
            <legend class="ctrl-legend">[CHAOS INJECTION PARAMETERS]</legend>
            <div class="form-row">
              <span class="ctrl-label">EXPERIMENT KIND:</span>
              <div class="btn-group">
                <button class="btn-toggle" class:selected={selectedKind === 'fetch_latency'} disabled={isRunActive} on:click={() => (selectedKind = 'fetch_latency')}>LATENCY</button>
                <button class="btn-toggle" class:selected={selectedKind === 'fetch_failure'} disabled={isRunActive} on:click={() => (selectedKind = 'fetch_failure')}>FAILURE</button>
                <button class="btn-toggle" class:selected={selectedKind === 'input_stress'} disabled={isRunActive} on:click={() => (selectedKind = 'input_stress')}>INPUT</button>
                <button class="btn-toggle" class:selected={selectedKind === 'viewport_stress'} disabled={isRunActive} on:click={() => (selectedKind = 'viewport_stress')}>VIEWPORT</button>
              </div>
            </div>

            {#if selectedKind === 'fetch_latency'}
              <div class="form-row">
                <span class="ctrl-label">DELAY (ms):</span>
                <div class="input-with-presets">
                  <input type="number" min="100" max="10000" step="100" bind:value={delayMs} disabled={isRunActive} />
                  <div class="mini-presets">
                    <button class="btn-preset" on:click={() => (delayMs = 400)} disabled={isRunActive}>400ms</button>
                    <button class="btn-preset" on:click={() => (delayMs = 800)} disabled={isRunActive}>800ms</button>
                    <button class="btn-preset" on:click={() => (delayMs = 2000)} disabled={isRunActive}>2s</button>
                  </div>
                </div>
              </div>
            {:else if selectedKind === 'fetch_failure'}
              <div class="form-row">
                <span class="ctrl-label">FAILURE MODE:</span>
                <select bind:value={failureMode} disabled={isRunActive}>
                  <option value="transport_error">TRANSPORT (NETWORK FAIL)</option>
                  <option value="synthetic_http_error">SYNTHETIC HTTP ERROR</option>
                  <option value="synthetic_timeout">SYNTHETIC TIMEOUT</option>
                </select>
              </div>
              {#if failureMode === 'synthetic_http_error'}
                <div class="form-row">
                  <span class="ctrl-label">HTTP STATUS:</span>
                  <input type="number" min="400" max="599" step="1" bind:value={syntheticStatus} disabled={isRunActive} />
                </div>
              {/if}
              {#if failureMode === 'synthetic_timeout'}
                <div class="form-row">
                  <span class="ctrl-label">TIMEOUT (ms):</span>
                  <input type="number" min="1000" max="30000" step="1000" bind:value={timeoutMs} disabled={isRunActive} />
                </div>
              {/if}
            {:else if selectedKind === 'input_stress'}
              <div class="form-row">
                <span class="ctrl-label">INPUT STRESS MODE:</span>
                <select bind:value={inputStressMode} disabled={isRunActive}>
                  <option value="all">ALL PATTERNS (MIXED)</option>
                  <option value="unicode">UNICODE & RTL OVERRIDE</option>
                  <option value="emoji">EMOJI & SPECIAL SYMBOLS</option>
                  <option value="long_text">LONG BOUNDARY TEXT (5K+)</option>
                  <option value="numeric_extreme">NUMERIC EXTREMES</option>
                  <option value="whitespace">WHITESPACE ONLY</option>
                  <option value="empty">EMPTY STRINGS</option>
                </select>
              </div>
            {:else if selectedKind === 'viewport_stress'}
              <div class="form-row">
                <span class="ctrl-label">LAYOUT CONSTRAINT:</span>
                <select bind:value={viewportStressMode} disabled={isRunActive}>
                  <option value="mobile_narrow">MOBILE NARROW (320px)</option>
                  <option value="overflow_squeeze">OVERFLOW SQUEEZE (280px)</option>
                  <option value="extreme_zoom">EXTREME ZOOM (200%)</option>
                </select>
              </div>
            {/if}

            <div class="form-row">
              <span class="ctrl-label">HOLD DURATION (ms):</span>
              <input type="number" min="1000" max="30000" step="1000" bind:value={durationMs} disabled={isRunActive} />
            </div>
            <div class="form-row">
              <span class="ctrl-label">RECOVERY WINDOW (ms):</span>
              <input type="number" min="2000" max="30000" step="1000" bind:value={recoveryWindowMs} disabled={isRunActive} />
            </div>
          </fieldset>
        </div>
      {/if}
    </div>

    <footer class="action-footer">
      {#if isRunActive}
        <button class="btn-action btn-abort" on:click={handleAbortRun} disabled={aborting}>
          <span class="btn-icon">■</span>{aborting ? 'ABORTING...' : 'ABORT EXPERIMENT'}
        </button>
      {:else}
        <button class="btn-action btn-start" on:click={handleStartRun} disabled={!canStart}>
          <span class="btn-icon">▶</span>{starting ? 'ARMING CHAOS...' : 'INITIATE HAVOC'}
        </button>
      {/if}
    </footer>
  </main>
</div>

<style>
  :global(:root) {
    --bg-void: #0a0a0a;
    --bg-panel: #111411;
    --bg-inset: #0d0d0d;
    --border-dim: #2a2f2a;
    --border-mid: #444b44;
    --text-primary: #ffffff;
    --text-body: #e5e5e5;
    --text-muted: #8a948a;
    --chaos: #f0c419;
    --chaos-bg: #2b2200;
    --recover: #00ff66;
    --recover-bg: #00260f;
    --danger: #ff3b3b;
    --danger-bg: #2b0000;
    --info: #38bdf8;
    --info-bg: #041d29;
    --font-display: 'Press Start 2P', monospace;
    --font-body: 'JetBrains Mono', Consolas, 'Courier New', monospace;
    --shadow-sm: 2px 2px 0 #000;
    --shadow-md: 3px 3px 0 #000;
    --shadow-lg: 4px 4px 0 #000;
  }

  .lab-frame {
    position: relative;
    width: 480px;
    min-height: 600px;
    background: var(--bg-void);
    color: var(--text-body);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    font-family: var(--font-body);
  }

  .grid-texture {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background-image:
      linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px);
    background-size: 16px 16px;
  }

  .console-body {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    flex: 1;
    padding: 10px;
    gap: 8px;
  }

  .console-header {
    background: var(--bg-panel);
    border: 2px solid var(--border-dim);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: var(--shadow-md);
  }

  .title-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .brand { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }

  .brand-logo {
    font-family: var(--font-display);
    font-size: 13px;
    letter-spacing: 2px;
    color: var(--chaos);
    animation: glitch-steps 4s steps(2) infinite;
  }
  @keyframes glitch-steps {
    0%, 93%, 100% { text-shadow: 2px 2px 0 #000; transform: translate(0, 0); }
    94% { text-shadow: -2px 0 0 var(--danger), 2px 2px 0 #000; transform: translate(-1px, 0); }
    96% { text-shadow: 2px -1px 0 var(--recover), -2px 2px 0 #000; transform: translate(1px, -1px); }
    98% { text-shadow: 0 2px 0 var(--chaos), 2px 2px 0 #000; transform: translate(0, 1px); }
  }

  .brand-tag { font-size: 9px; letter-spacing: 0.5px; color: var(--text-muted); }

  .target-strip {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    background: var(--bg-inset);
    padding: 4px 6px;
    border: 2px solid #222622;
    flex-wrap: wrap;
  }
  .target-label { color: var(--chaos); font-weight: bold; font-size: 9px; }
  .target-chip {
    font-family: var(--font-display);
    padding: 2px 4px;
    font-size: 7.5px;
    background: var(--border-dim);
    color: var(--text-body);
    border: 1px solid var(--border-mid);
  }
  .target-chip.no-target { background: var(--danger-bg); border-color: var(--danger); color: var(--danger); }
  .target-origin {
    color: var(--text-body);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 260px;
  }

  .badge {
    font-family: var(--font-display);
    font-size: 7.5px;
    padding: 4px 6px;
    letter-spacing: 0.5px;
    line-height: 1.2;
    box-shadow: var(--shadow-sm);
    border: 2px solid;
    white-space: nowrap;
  }
  .badge-active { background: var(--chaos-bg); color: var(--chaos); border-color: var(--chaos); }
  .badge-completed { background: var(--recover-bg); color: var(--recover); border-color: var(--recover); }
  .badge-terminal { background: var(--danger-bg); color: var(--danger); border-color: var(--danger); }
  .badge-standby { background: #141714; color: var(--text-muted); border-color: var(--border-dim); }

  .blink { animation: blink-stepped 1s steps(2) infinite; }
  @keyframes blink-stepped { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }

  .error-banner {
    background: var(--danger-bg);
    border: 2px solid var(--danger);
    color: #ff9999;
    padding: 5px 8px;
    font-size: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: var(--shadow-sm);
  }
  .error-icon { background: var(--danger); color: #000; font-weight: bold; padding: 0 4px; }

  /* ---- Pipeline ribbon: wraps into rows instead of horizontal-scrolling ---- */
  .pipeline-section {
    background: var(--bg-panel);
    border: 2px solid var(--border-dim);
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: var(--shadow-md);
  }
  .pipeline-header { display: flex; justify-content: space-between; font-size: 8px; color: var(--text-muted); }
  .sec-label { font-family: var(--font-display); font-size: 7px; color: var(--text-muted); }
  .run-id-tag { font-family: var(--font-display); font-size: 7px; color: var(--chaos); }

  .pipeline-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px 10px;
    background: var(--bg-inset);
    padding: 6px 8px;
    border: 2px solid #222622;
  }

  .pipe-node {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 8px;
    color: #555e55;
  }
  .node-glyph { display: inline-flex; align-items: center; justify-content: center; font-size: 8.5px; line-height: 1; }
  .glyph-current { color: var(--chaos); animation: pulse-step 0.8s steps(2) infinite; }
  @keyframes pulse-step { 0%, 100% { transform: scale(1.2); opacity: 1; } 50% { transform: scale(0.9); opacity: 0.6; } }
  .glyph-past { color: var(--recover); }
  .glyph-failed { color: var(--danger); }
  .glyph-pending { color: var(--border-mid); }

  .pipe-node.past { color: var(--recover); }
  .pipe-node.current { color: var(--chaos); font-weight: bold; }
  .pipe-node.failed { color: var(--danger); font-weight: bold; }
  .node-num { opacity: 0.7; font-size: 7px; }
  .node-name { font-size: 7.5px; letter-spacing: 0.3px; white-space: nowrap; }

  .console-nav { display: flex; gap: 6px; }
  .nav-tab {
    flex: 1;
    background: #141714;
    color: var(--text-muted);
    border: 2px solid var(--border-dim);
    font-family: var(--font-display);
    font-size: 7px;
    padding: 7px 2px;
    cursor: pointer;
    letter-spacing: 0.5px;
    box-shadow: var(--shadow-sm);
    transition: all 0.08s steps(2);
    line-height: 1.2;
  }
  .nav-tab:hover { background: #1d221d; color: var(--text-body); border-color: var(--border-mid); }
  .nav-tab.active {
    background: #1a1600;
    color: var(--chaos);
    border-color: var(--chaos);
    box-shadow: 1px 1px 0 #000;
    transform: translate(1px, 1px);
  }

  .viewport {
    flex: 1;
    min-height: 260px;
    max-height: 320px;
    background: var(--bg-inset);
    border: 2px solid var(--border-dim);
    padding: 8px;
    overflow-y: auto;
    box-shadow: var(--shadow-md);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 200px;
    color: var(--text-muted);
    text-align: center;
    gap: 8px;
  }
  .pixel-radar {
    position: relative;
    width: 28px;
    height: 28px;
    border: 2px solid var(--border-dim);
    background: #050505;
    box-shadow: var(--shadow-sm);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .radar-ring { position: absolute; width: 14px; height: 14px; border: 1px dashed var(--border-mid); }
  .radar-sweep {
    position: absolute;
    width: 100%;
    height: 2px;
    background: var(--chaos);
    opacity: 0.6;
    animation: radar-sweep 2s steps(8) infinite;
  }
  @keyframes radar-sweep { 0% { transform: translateY(-12px); } 50% { transform: translateY(12px); } 100% { transform: translateY(-12px); } }
  .radar-blip { width: 4px; height: 4px; background: var(--recover); box-shadow: 0 0 4px var(--recover); animation: blink-stepped 1.5s steps(2) infinite; }
  .empty-prompt { font-size: 11px; color: var(--text-body); font-weight: bold; }
  .empty-sub { font-size: 9.5px; color: var(--text-muted); max-width: 280px; }

  .event-list { display: flex; flex-direction: column; gap: 6px; }
  .event-row {
    background: var(--bg-panel);
    border: 2px solid #222622;
    border-left: 4px solid var(--border-mid);
    padding: 6px 8px;
    font-size: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: var(--shadow-sm);
  }
  .event-row.type-chaos_injected { border-left-color: var(--chaos); background: #171404; }
  .event-row.type-request_transport_failure,
  .event-row.type-request_http_failure,
  .event-row.type-request_timeout { border-left-color: var(--danger); background: #170404; }
  .event-row.type-request_completed { border-left-color: var(--recover); background: #041708; }
  .event-row.type-dom_observation { border-left-color: var(--info); background: #041217; }

  .evt-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .evt-seq { color: var(--text-muted); font-weight: bold; font-size: 9px; }
  .evt-time { color: var(--text-body); font-size: 9px; }
  .evt-badge { font-family: var(--font-display); font-size: 6.5px; padding: 2px 4px; border: 1px solid #333; background: #141714; color: var(--text-body); }
  .badge-chaos_injected { background: var(--chaos-bg); color: var(--chaos); border-color: var(--chaos); }
  .badge-request_completed { background: var(--recover-bg); color: var(--recover); border-color: var(--recover); }
  .badge-request_transport_failure,
  .badge-request_http_failure,
  .badge-request_timeout { background: var(--danger-bg); color: var(--danger); border-color: var(--danger); }
  .badge-dom_observation { background: var(--info-bg); color: var(--info); border-color: var(--info); }

  .evt-details { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: #d1d5db; }
  .evt-resource { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
  .evt-dom-kind { color: var(--info); font-weight: bold; }
  .evt-selector { color: #d1d5db; background: var(--bg-void); padding: 0 4px; border: 1px solid var(--border-dim); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .evt-snippet { color: var(--text-primary); font-style: italic; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .evt-status { padding: 0 4px; font-weight: bold; border: 1px solid; }
  .evt-status.ok { color: var(--recover); background: var(--recover-bg); border-color: var(--recover); }
  .evt-status.fail { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  .evt-duration { color: var(--chaos); }
  .evt-err-msg { color: var(--danger); }

  .signals-list { display: flex; flex-direction: column; gap: 6px; }
  .signal-card {
    background: var(--bg-panel);
    border: 2px solid var(--border-dim);
    border-left: 4px solid var(--chaos);
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: var(--shadow-sm);
  }
  .signal-card.type-requestfailureobserved { border-left-color: var(--danger); }
  .signal-card.type-loadingstatedetected { border-left-color: var(--chaos); }
  .signal-card.type-errorstatedetected { border-left-color: var(--danger); }

  .sig-header { display: flex; justify-content: space-between; align-items: center; }
  .sig-type { font-size: 11px; font-weight: bold; color: var(--text-primary); }
  .sig-conf-badge { font-family: var(--font-display); font-size: 7px; color: var(--chaos); background: #1a1600; padding: 2px 5px; border: 1px solid var(--chaos); }
  .sig-meter { height: 4px; background: #1e241e; border: 1px solid var(--border-dim); overflow: hidden; }
  .sig-meter-fill { height: 100%; background: var(--chaos); }
  .sig-footer { display: flex; align-items: center; gap: 6px; font-size: 9px; color: var(--text-muted); flex-wrap: wrap; }
  .ref-tag { background: #1c211c; color: var(--text-body); padding: 0 4px; border: 1px solid var(--border-dim); }

  .autopsy-report { display: flex; flex-direction: column; gap: 8px; }
  .outcome-banner {
    padding: 8px 10px;
    border: 2px solid;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: var(--shadow-md);
    flex-wrap: wrap;
    gap: 6px;
  }
  .outcome-recovered { background: var(--recover-bg); border-color: var(--recover); color: var(--recover); }
  .outcome-degraded { background: var(--chaos-bg); border-color: var(--chaos); color: var(--chaos); }
  .outcome-failed { background: var(--danger-bg); border-color: var(--danger); color: var(--danger); }
  .outcome-unknown { background: var(--info-bg); border-color: var(--info); color: var(--info); }
  .outcome-title { display: flex; flex-direction: column; gap: 2px; }
  .outcome-tag { font-family: var(--font-display); font-size: 7px; opacity: 0.85; }
  .outcome-val { font-family: var(--font-display); font-size: 11px; letter-spacing: 1px; }
  .outcome-window { display: flex; flex-direction: column; text-align: right; font-size: 9.5px; color: var(--text-primary); }

  .no-finding-box {
    background: var(--recover-bg);
    border: 2px solid var(--recover);
    color: var(--recover);
    padding: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    box-shadow: var(--shadow-sm);
  }
  .nf-icon { font-size: 12px; }

  .finding-card {
    background: var(--bg-panel);
    border: 2px solid var(--border-dim);
    border-left: 4px solid var(--chaos);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: var(--shadow-sm);
  }
  .finding-card.severity-high { border-left-color: var(--danger); }
  .finding-card.severity-medium { border-left-color: var(--chaos); }
  .finding-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px; }
  .sev-badge { font-family: var(--font-display); font-size: 7.5px; }
  .sev-high { color: var(--danger); }
  .sev-medium { color: var(--chaos); }
  .fnd-conf { font-size: 9.5px; color: var(--text-muted); }
  .fnd-desc { margin: 0; font-size: 10.5px; line-height: 1.45; color: var(--text-primary); }
  .fnd-evidence { display: flex; justify-content: space-between; font-size: 9px; color: var(--text-muted); border-top: 1px solid #222622; padding-top: 4px; }

  .control-box {
    border: 2px solid var(--border-dim);
    padding: 8px 10px;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--bg-panel);
    box-shadow: var(--shadow-sm);
  }
  .ctrl-legend { font-family: var(--font-display); font-size: 7.5px; color: var(--chaos); padding: 0 4px; letter-spacing: 0.5px; }
  .form-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ctrl-label { font-size: 10px; color: var(--text-body); }

  .btn-group { display: flex; gap: 4px; flex-wrap: wrap; }
  .btn-toggle {
    background: #141714;
    border: 2px solid var(--border-dim);
    color: var(--text-muted);
    font-family: var(--font-display);
    font-size: 7px;
    padding: 4px 6px;
    cursor: pointer;
    box-shadow: 1px 1px 0 #000;
    transition: all 0.08s steps(2);
  }
  .btn-toggle.selected { background: #1a1600; color: var(--chaos); border-color: var(--chaos); box-shadow: none; transform: translate(1px, 1px); font-weight: bold; }
  .btn-toggle:disabled { opacity: 0.5; cursor: default; }

  input[type='number'], select {
    background: var(--bg-void);
    border: 2px solid var(--border-dim);
    color: var(--text-primary);
    font-family: var(--font-body);
    font-size: 10.5px;
    padding: 4px 6px;
    width: 140px;
  }
  input[type='number']:focus, select:focus { outline: 2px solid var(--chaos); border-color: var(--chaos); }

  .input-with-presets { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
  .mini-presets { display: flex; gap: 3px; }
  .btn-preset {
    background: #141714;
    border: 1px solid var(--border-dim);
    color: var(--text-muted);
    font-family: var(--font-display);
    font-size: 6.5px;
    padding: 2px 4px;
    cursor: pointer;
  }
  .btn-preset:hover { color: var(--chaos); border-color: var(--chaos); }
  .btn-preset:disabled { opacity: 0.5; cursor: default; }

  .action-footer { display: flex; gap: 6px; }
  .btn-action {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px;
    font-family: var(--font-display);
    font-size: 9.5px;
    letter-spacing: 1px;
    cursor: pointer;
    border: 2px solid;
    box-shadow: var(--shadow-lg);
    transition: transform 0.05s steps(2), box-shadow 0.05s steps(2);
  }
  .btn-action:active:not(:disabled) { transform: translate(4px, 4px); box-shadow: 0 0 0 #000; }
  .btn-start { background: var(--chaos); color: var(--bg-void); border-color: var(--chaos); font-weight: 900; }
  .btn-start:hover:not(:disabled) { background: #ffd633; border-color: #ffd633; }
  .btn-start:disabled { background: #1f1b0a; color: #66591f; border-color: #332d0d; box-shadow: var(--shadow-sm); cursor: default; }
  .btn-abort { background: var(--danger); color: #fff; border-color: var(--danger); }
  .btn-abort:hover:not(:disabled) { background: #ff6666; border-color: #ff6666; }
  .btn-abort:disabled { opacity: 0.4; cursor: default; }
  .btn-icon { font-size: 8.5px; }
</style>
