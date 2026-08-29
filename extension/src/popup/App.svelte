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
  <!-- Background Grid Texture -->
  <div class="grid-texture" />

  <!-- Main Container -->
  <main class="console-body">
    <!-- Header -->
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

      <!-- Target Inspector Strip -->
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

    <!-- Pipeline State Ribbon -->
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
            <div
              class="pipe-node"
              class:current={isCurrent}
              class:past={isPast}
              class:failed={isFailed}
              title={step}
            >
              <span class="node-glyph">
                {#if isFailed}
                  <span class="glyph-pixel glyph-failed">✖</span>
                {:else if isPast}
                  <span class="glyph-pixel glyph-past">■</span>
                {:else if isCurrent}
                  <span class="glyph-pixel glyph-current">▣</span>
                {:else}
                  <span class="glyph-pixel glyph-pending">□</span>
                {/if}
              </span>
              <span class="node-num">0{i + 1}</span>
              <span class="node-name">{step}</span>
              {#if i < PIPELINE_STEPS.length - 1}
                <span class="node-arrow">→</span>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Navigation Tabs -->
    <nav class="console-nav">
      <button
        class="nav-tab"
        class:active={activeTabNav === 'timeline'}
        on:click={() => (activeTabNav = 'timeline')}
      >
        [01] TIMELINE ({events.length})
      </button>
      <button
        class="nav-tab"
        class:active={activeTabNav === 'signals'}
        on:click={() => (activeTabNav = 'signals')}
      >
        [02] SIGNALS ({signals.length})
      </button>
      <button
        class="nav-tab"
        class:active={activeTabNav === 'autopsy'}
        on:click={() => (activeTabNav = 'autopsy')}
      >
        [03] AUTOPSY {recovery ? `[${recovery.outcome}]` : ''}
      </button>
      <button
        class="nav-tab"
        class:active={activeTabNav === 'config'}
        on:click={() => (activeTabNav = 'config')}
      >
        [04] CONTROLS
      </button>
    </nav>

    <!-- Tab Content Viewport -->
    <div class="viewport">
      <!-- 01: TIMELINE -->
      {#if activeTabNav === 'timeline'}
        <div class="timeline-view">
          {#if events.length === 0}
            <div class="empty-state">
              <div class="pixel-radar">
                <span class="radar-ring" />
                <span class="radar-sweep" />
                <span class="radar-blip" />
              </div>
              <span class="empty-prompt">&gt; Awaiting observation telemetry...</span>
              <span class="empty-sub">Trigger chaos injection to observe network and DOM mutations.</span>
            </div>
          {:else}
            <div class="event-list">
              {#each events as evt}
                <div class="event-row type-{evt.type.toLowerCase()}">
                  <div class="evt-meta">
                    <span class="evt-seq">#{String(evt.sequence).padStart(2, '0')}</span>
                    <span class="evt-time">
                      {currentRun ? formatRelativeTime(evt.timestamp, currentRun.createdAt) : '+0.00s'}
                    </span>
                    <span class="evt-badge badge-{evt.type.toLowerCase()}">{evt.type}</span>
                  </div>

                  <div class="evt-details">
                    {#if evt.resource}
                      <span class="evt-resource" title={evt.resource}>{evt.resource}</span>
                    {/if}

                    {#if evt.metadata?.kind}
                      <span class="evt-dom-kind">DOM: {evt.metadata.kind}</span>
                      {#if evt.metadata?.selector}
                        <span class="evt-selector" title={String(evt.metadata.selector)}>{evt.metadata.selector}</span>
                      {/if}
                      {#if evt.metadata?.textSnippet}
                        <span class="evt-snippet">"{evt.metadata.textSnippet}"</span>
                      {/if}
                    {/if}

                    {#if evt.metadata?.status !== undefined}
                      <span
                        class="evt-status"
                        class:ok={Number(evt.metadata.status) >= 200 && Number(evt.metadata.status) < 300}
                        class:fail={Number(evt.metadata.status) === 0 || Number(evt.metadata.status) >= 400}
                      >
                        HTTP {evt.metadata.status}
                      </span>
                    {/if}

                    {#if evt.metadata?.duration !== undefined}
                      <span class="evt-duration">{(Number(evt.metadata.duration)).toFixed(0)}ms</span>
                    {/if}

                    {#if evt.metadata?.errorMessage}
                      <span class="evt-err-msg">{evt.metadata.errorMessage}</span>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>

      <!-- 02: SIGNALS -->
      {:else if activeTabNav === 'signals'}
        <div class="signals-view">
          {#if signals.length === 0}
            <div class="empty-state">
              <div class="pixel-radar">
                <span class="radar-ring" />
                <span class="radar-sweep" />
                <span class="radar-blip" />
              </div>
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
                  <div class="sig-meter">
                    <div class="sig-meter-fill" style="width: {Math.round(sig.confidence * 100)}%" />
                  </div>
                  <div class="sig-footer">
                    <span class="sig-prov-label">DERIVED FROM:</span>
                    <span class="sig-prov-tags">
                      {#each sig.derivedFrom.slice(0, 3) as refId}
                        <span class="ref-tag">#{refId.slice(0, 6)}</span>
                      {/each}
                      {#if sig.derivedFrom.length > 3}
                        <span class="ref-more">+{sig.derivedFrom.length - 3}</span>
                      {/if}
                    </span>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>

      <!-- 03: AUTOPSY -->
      {:else if activeTabNav === 'autopsy'}
        <div class="autopsy-view">
          {#if !recovery}
            <div class="empty-state">
              <div class="pixel-radar">
                <span class="radar-ring" />
                <span class="radar-sweep" />
                <span class="radar-blip" />
              </div>
              <span class="empty-prompt">&gt; Recovery autopsy pending.</span>
              <span class="empty-sub">Autopsy generates post-chaos evaluation findings upon run completion.</span>
            </div>
          {:else}
            <div class="autopsy-report">
              <!-- Outcome Banner -->
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

              <!-- Findings Section -->
              {#if findings.length === 0}
                <div class="no-finding-box">
                  <span class="nf-icon">■</span>
                  <span class="nf-text">
                    {#if recovery.outcome === 'RECOVERED'}
                      RESILIENT: Application retried and recovered successfully.
                    {:else}
                      INCONCLUSIVE: Insufficient observable evidence to conclude failure.
                    {/if}
                  </span>
                </div>
              {:else}
                {#each findings as fnd}
                  <div class="finding-card severity-{fnd.severity.toLowerCase()}">
                    <div class="finding-header">
                      <span class="sev-badge sev-{fnd.severity.toLowerCase()}">
                        [{fnd.severity} SEVERITY]
                      </span>
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

      <!-- 04: CONTROLS -->
      {:else if activeTabNav === 'config'}
        <div class="config-view">
          <fieldset class="control-box">
            <legend class="ctrl-legend">[CHAOS INJECTION PARAMETERS]</legend>

            <!-- Experiment Kind -->
            <div class="form-row">
              <span class="ctrl-label">EXPERIMENT KIND:</span>
              <div class="btn-group">
                <button
                  class="btn-toggle"
                  class:selected={selectedKind === 'fetch_latency'}
                  disabled={isRunActive}
                  on:click={() => (selectedKind = 'fetch_latency')}
                >
                  LATENCY
                </button>
                <button
                  class="btn-toggle"
                  class:selected={selectedKind === 'fetch_failure'}
                  disabled={isRunActive}
                  on:click={() => (selectedKind = 'fetch_failure')}
                >
                  FAILURE
                </button>
                <button
                  class="btn-toggle"
                  class:selected={selectedKind === 'input_stress'}
                  disabled={isRunActive}
                  on:click={() => (selectedKind = 'input_stress')}
                >
                  INPUT
                </button>
                <button
                  class="btn-toggle"
                  class:selected={selectedKind === 'viewport_stress'}
                  disabled={isRunActive}
                  on:click={() => (selectedKind = 'viewport_stress')}
                >
                  VIEWPORT
                </button>
              </div>
            </div>

            <!-- Latency Options -->
            {#if selectedKind === 'fetch_latency'}
              <div class="form-row">
                <span class="ctrl-label">DELAY (ms):</span>
                <div class="input-with-presets">
                  <input
                    type="number"
                    min="100"
                    max="10000"
                    step="100"
                    bind:value={delayMs}
                    disabled={isRunActive}
                  />
                  <div class="mini-presets">
                    <button class="btn-preset" on:click={() => (delayMs = 400)} disabled={isRunActive}>400ms</button>
                    <button class="btn-preset" on:click={() => (delayMs = 800)} disabled={isRunActive}>800ms</button>
                    <button class="btn-preset" on:click={() => (delayMs = 2000)} disabled={isRunActive}>2s</button>
                  </div>
                </div>
              </div>
            {:else if selectedKind === 'fetch_failure'}
              <!-- Failure Options -->
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
                  <input
                    type="number"
                    min="400"
                    max="599"
                    step="1"
                    bind:value={syntheticStatus}
                    disabled={isRunActive}
                  />
                </div>
              {/if}

              {#if failureMode === 'synthetic_timeout'}
                <div class="form-row">
                  <span class="ctrl-label">TIMEOUT (ms):</span>
                  <input
                    type="number"
                    min="1000"
                    max="30000"
                    step="1000"
                    bind:value={timeoutMs}
                    disabled={isRunActive}
                  />
                </div>
              {/if}
            {:else if selectedKind === 'input_stress'}
              <!-- Input Stress Options -->
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
              <!-- Viewport Stress Options -->
              <div class="form-row">
                <span class="ctrl-label">LAYOUT CONSTRAINT:</span>
                <select bind:value={viewportStressMode} disabled={isRunActive}>
                  <option value="mobile_narrow">MOBILE NARROW (320px)</option>
                  <option value="overflow_squeeze">OVERFLOW SQUEEZE (280px)</option>
                  <option value="extreme_zoom">EXTREME ZOOM (200%)</option>
                </select>
              </div>
            {/if}

            <!-- Duration -->
            <div class="form-row">
              <span class="ctrl-label">HOLD DURATION (ms):</span>
              <input
                type="number"
                min="1000"
                max="30000"
                step="1000"
                bind:value={durationMs}
                disabled={isRunActive}
              />
            </div>

            <!-- Recovery Window -->
            <div class="form-row">
              <span class="ctrl-label">RECOVERY WINDOW (ms):</span>
              <input
                type="number"
                min="2000"
                max="30000"
                step="1000"
                bind:value={recoveryWindowMs}
                disabled={isRunActive}
              />
            </div>
          </fieldset>
        </div>
      {/if}
    </div>

    <!-- Action Bar (The INITIATE HAVOC Moment) -->
    <footer class="action-footer">
      {#if isRunActive}
        <button class="btn-action btn-abort" on:click={handleAbortRun} disabled={aborting}>
          <span class="btn-icon">■</span>
          {aborting ? 'ABORTING...' : 'ABORT EXPERIMENT'}
        </button>
      {:else}
        <button class="btn-action btn-start" on:click={handleStartRun} disabled={!canStart}>
          <span class="btn-icon">▶</span>
          {starting ? 'ARMING CHAOS...' : 'INITIATE HAVOC'}
        </button>
      {/if}
    </footer>
  </main>
</div>

<style>
  /* Base Pixel-Lab Frame & Texture */
  .lab-frame {
    position: relative;
    width: 460px;
    min-height: 580px;
    background: #0a0a0a;
    color: #e5e5e5;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  }

  .grid-texture {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
    background-image: 
      linear-gradient(to right, rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
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

  /* Header */
  .console-header {
    background: #111411;
    border: 2px solid #2a2f2a;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: 3px 3px 0 #000000;
  }

  .title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .brand {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .brand-logo {
    font-family: 'Press Start 2P', monospace;
    font-size: 13px;
    letter-spacing: 2px;
    color: #f0c419;
    animation: glitch-steps 4s steps(2) infinite;
  }

  @keyframes glitch-steps {
    0%, 93%, 100% {
      text-shadow: 2px 2px 0 #000;
      transform: translate(0, 0);
    }
    94% {
      text-shadow: -2px 0 0 #ff3b3b, 2px 2px 0 #000;
      transform: translate(-1px, 0);
    }
    96% {
      text-shadow: 2px -1px 0 #00ff66, -2px 2px 0 #000;
      transform: translate(1px, -1px);
    }
    98% {
      text-shadow: 0 2px 0 #f0c419, 2px 2px 0 #000;
      transform: translate(0, 1px);
    }
  }

  .brand-tag {
    font-size: 9px;
    letter-spacing: 0.5px;
    color: #8a948a;
  }

  .target-strip {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    background: #0d0d0d;
    padding: 4px 6px;
    border: 2px solid #222622;
  }

  .target-label {
    color: #f0c419;
    font-weight: bold;
    font-size: 9px;
  }

  .target-chip {
    font-family: 'Press Start 2P', monospace;
    padding: 2px 4px;
    font-size: 7.5px;
    background: #2a2f2a;
    color: #e5e5e5;
    border: 1px solid #444b44;
  }

  .target-chip.no-target {
    background: #450a0a;
    border-color: #ff3b3b;
    color: #ff3b3b;
  }

  .target-origin {
    color: #e5e5e5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 260px;
  }

  /* Badges */
  .badge {
    font-family: 'Press Start 2P', monospace;
    font-size: 7.5px;
    padding: 4px 6px;
    letter-spacing: 0.5px;
    line-height: 1.2;
    box-shadow: 2px 2px 0 #000;
    border: 2px solid;
  }
  .badge-active {
    background: #2b2200;
    color: #f0c419;
    border-color: #f0c419;
  }
  .badge-completed {
    background: #00260f;
    color: #00ff66;
    border-color: #00ff66;
  }
  .badge-terminal {
    background: #2b0000;
    color: #ff3b3b;
    border-color: #ff3b3b;
  }
  .badge-standby {
    background: #141714;
    color: #8a948a;
    border-color: #2a2f2a;
  }

  .blink {
    animation: blink-stepped 1s steps(2) infinite;
  }
  @keyframes blink-stepped {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }

  .error-banner {
    background: #2b0000;
    border: 2px solid #ff3b3b;
    color: #ff9999;
    padding: 5px 8px;
    font-size: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: 2px 2px 0 #000;
  }
  .error-icon {
    background: #ff3b3b;
    color: #000;
    font-weight: bold;
    padding: 0 4px;
  }

  /* Pipeline State Ribbon */
  .pipeline-section {
    background: #111411;
    border: 2px solid #2a2f2a;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: 3px 3px 0 #000;
  }

  .pipeline-header {
    display: flex;
    justify-content: space-between;
    font-size: 8px;
    color: #8a948a;
  }

  .sec-label {
    font-family: 'Press Start 2P', monospace;
    font-size: 7px;
    color: #8a948a;
  }

  .run-id-tag {
    font-family: 'Press Start 2P', monospace;
    font-size: 7px;
    color: #f0c419;
  }

  .pipeline-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #0d0d0d;
    padding: 6px 8px;
    border: 2px solid #222622;
    overflow-x: auto;
  }

  .pipe-node {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 8.5px;
    color: #555e55;
  }
  .node-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 8.5px;
    line-height: 1;
  }
  .glyph-current {
    color: #f0c419;
    animation: pulse-step 0.8s steps(2) infinite;
  }
  @keyframes pulse-step {
    0%, 100% { transform: scale(1.2); opacity: 1; }
    50% { transform: scale(0.9); opacity: 0.6; }
  }
  .glyph-past {
    color: #00ff66;
  }
  .glyph-failed {
    color: #ff3b3b;
  }
  .glyph-pending {
    color: #444b44;
  }

  .pipe-node.past {
    color: #00ff66;
  }
  .pipe-node.current {
    color: #f0c419;
    font-weight: bold;
  }
  .pipe-node.failed {
    color: #ff3b3b;
    font-weight: bold;
  }
  .node-num {
    opacity: 0.7;
    font-size: 7.5px;
  }
  .node-name {
    font-size: 8px;
    letter-spacing: 0.3px;
  }
  .node-arrow {
    opacity: 0.4;
    margin-left: 2px;
    color: #8a948a;
  }

  /* Navigation Tabs */
  .console-nav {
    display: flex;
    gap: 6px;
  }

  .nav-tab {
    flex: 1;
    background: #141714;
    color: #8a948a;
    border: 2px solid #2a2f2a;
    font-family: 'Press Start 2P', monospace;
    font-size: 7px;
    padding: 7px 2px;
    cursor: pointer;
    letter-spacing: 0.5px;
    box-shadow: 2px 2px 0 #000;
    transition: all 0.08s steps(2);
    line-height: 1.2;
  }
  .nav-tab:hover {
    background: #1d221d;
    color: #e5e5e5;
    border-color: #444b44;
  }
  .nav-tab.active {
    background: #1a1600;
    color: #f0c419;
    border-color: #f0c419;
    box-shadow: 1px 1px 0 #000;
    transform: translate(1px, 1px);
  }

  /* Viewport Area */
  .viewport {
    flex: 1;
    min-height: 250px;
    max-height: 310px;
    background: #0d0d0d;
    border: 2px solid #2a2f2a;
    padding: 8px;
    overflow-y: auto;
    box-shadow: 3px 3px 0 #000;
  }

  /* Empty State with Pixel Radar Mascot */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 200px;
    color: #8a948a;
    text-align: center;
    gap: 8px;
  }

  .pixel-radar {
    position: relative;
    width: 28px;
    height: 28px;
    border: 2px solid #2a2f2a;
    background: #050505;
    box-shadow: 2px 2px 0 #000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .radar-ring {
    position: absolute;
    width: 14px;
    height: 14px;
    border: 1px dashed #444b44;
  }
  .radar-sweep {
    position: absolute;
    width: 100%;
    height: 2px;
    background: #f0c419;
    opacity: 0.6;
    animation: radar-sweep 2s steps(8) infinite;
  }
  @keyframes radar-sweep {
    0% { transform: translateY(-12px); }
    50% { transform: translateY(12px); }
    100% { transform: translateY(-12px); }
  }
  .radar-blip {
    width: 4px;
    height: 4px;
    background: #00ff66;
    box-shadow: 0 0 4px #00ff66;
    animation: blink-stepped 1.5s steps(2) infinite;
  }

  .empty-prompt {
    font-size: 11px;
    color: #e5e5e5;
    font-weight: bold;
  }
  .empty-sub {
    font-size: 9.5px;
    color: #8a948a;
    max-width: 280px;
  }

  /* Timeline Stream */
  .event-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .event-row {
    background: #111411;
    border: 2px solid #222622;
    border-left: 4px solid #444b44;
    padding: 6px 8px;
    font-size: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: 2px 2px 0 #000;
  }
  .event-row.type-chaos_injected {
    border-left-color: #f0c419;
    background: #171404;
  }
  .event-row.type-request_transport_failure,
  .event-row.type-request_http_failure,
  .event-row.type-request_timeout {
    border-left-color: #ff3b3b;
    background: #170404;
  }
  .event-row.type-request_completed {
    border-left-color: #00ff66;
    background: #041708;
  }
  .event-row.type-dom_observation {
    border-left-color: #38bdf8;
    background: #041217;
  }

  .evt-meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .evt-seq {
    color: #8a948a;
    font-weight: bold;
    font-size: 9px;
  }
  .evt-time {
    color: #e5e5e5;
    font-size: 9px;
  }
  .evt-badge {
    font-family: 'Press Start 2P', monospace;
    font-size: 6.5px;
    padding: 2px 4px;
    border: 1px solid #333;
    background: #141714;
    color: #e5e5e5;
  }
  .badge-chaos_injected { background: #2b2200; color: #f0c419; border-color: #f0c419; }
  .badge-request_completed { background: #00260f; color: #00ff66; border-color: #00ff66; }
  .badge-request_transport_failure,
  .badge-request_http_failure,
  .badge-request_timeout { background: #2b0000; color: #ff3b3b; border-color: #ff3b3b; }
  .badge-dom_observation { background: #041d29; color: #38bdf8; border-color: #38bdf8; }

  .evt-details {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    color: #d1d5db;
  }
  .evt-resource {
    color: #ffffff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 240px;
  }
  .evt-dom-kind {
    color: #38bdf8;
    font-weight: bold;
  }
  .evt-selector {
    color: #d1d5db;
    background: #0a0a0a;
    padding: 0 4px;
    border: 1px solid #2a2f2a;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .evt-snippet {
    color: #ffffff;
    font-style: italic;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .evt-status {
    padding: 0 4px;
    font-weight: bold;
    border: 1px solid;
  }
  .evt-status.ok { color: #00ff66; background: #00260f; border-color: #00ff66; }
  .evt-status.fail { color: #ff3b3b; background: #2b0000; border-color: #ff3b3b; }
  .evt-duration { color: #f0c419; }
  .evt-err-msg { color: #ff3b3b; }

  /* Signals View */
  .signals-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .signal-card {
    background: #111411;
    border: 2px solid #2a2f2a;
    border-left: 4px solid #f0c419;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: 2px 2px 0 #000;
  }
  .signal-card.type-requestfailureobserved {
    border-left-color: #ff3b3b;
  }
  .signal-card.type-loadingstatedetected {
    border-left-color: #f0c419;
  }
  .signal-card.type-errorstatedetected {
    border-left-color: #ff3b3b;
  }

  .sig-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .sig-type {
    font-size: 11px;
    font-weight: bold;
    color: #ffffff;
  }
  .sig-conf-badge {
    font-family: 'Press Start 2P', monospace;
    font-size: 7px;
    color: #f0c419;
    background: #1a1600;
    padding: 2px 5px;
    border: 1px solid #f0c419;
  }

  .sig-meter {
    height: 4px;
    background: #1e241e;
    border: 1px solid #2a2f2a;
    overflow: hidden;
  }
  .sig-meter-fill {
    height: 100%;
    background: #f0c419;
  }

  .sig-footer {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 9px;
    color: #8a948a;
  }
  .ref-tag {
    background: #1c211c;
    color: #e5e5e5;
    padding: 0 4px;
    border: 1px solid #2a2f2a;
  }

  /* Autopsy View */
  .autopsy-report {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .outcome-banner {
    padding: 8px 10px;
    border: 2px solid;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 3px 3px 0 #000;
  }
  .outcome-recovered {
    background: #00260f;
    border-color: #00ff66;
    color: #00ff66;
  }
  .outcome-degraded {
    background: #2b2200;
    border-color: #f0c419;
    color: #f0c419;
  }
  .outcome-failed {
    background: #2b0000;
    border-color: #ff3b3b;
    color: #ff3b3b;
  }
  .outcome-unknown {
    background: #041d29;
    border-color: #38bdf8;
    color: #38bdf8;
  }

  .outcome-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .outcome-tag {
    font-family: 'Press Start 2P', monospace;
    font-size: 7px;
    opacity: 0.85;
  }
  .outcome-val {
    font-family: 'Press Start 2P', monospace;
    font-size: 11px;
    letter-spacing: 1px;
  }

  .outcome-window {
    display: flex;
    flex-direction: column;
    text-align: right;
    font-size: 9.5px;
    color: #ffffff;
  }

  .no-finding-box {
    background: #00260f;
    border: 2px solid #00ff66;
    color: #00ff66;
    padding: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    box-shadow: 2px 2px 0 #000;
  }
  .nf-icon {
    font-size: 12px;
  }

  .finding-card {
    background: #111411;
    border: 2px solid #2a2f2a;
    border-left: 4px solid #f0c419;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: 2px 2px 0 #000;
  }
  .finding-card.severity-high {
    border-left-color: #ff3b3b;
  }
  .finding-card.severity-medium {
    border-left-color: #f0c419;
  }

  .finding-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .sev-badge {
    font-family: 'Press Start 2P', monospace;
    font-size: 7.5px;
  }
  .sev-high { color: #ff3b3b; }
  .sev-medium { color: #f0c419; }
  .fnd-conf {
    font-size: 9.5px;
    color: #8a948a;
  }
  .fnd-desc {
    margin: 0;
    font-size: 10.5px;
    line-height: 1.45;
    color: #ffffff;
  }
  .fnd-evidence {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: #8a948a;
    border-top: 1px solid #222622;
    padding-top: 4px;
  }

  /* Config view */
  .control-box {
    border: 2px solid #2a2f2a;
    padding: 8px 10px;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: #111411;
    box-shadow: 2px 2px 0 #000;
  }
  .ctrl-legend {
    font-family: 'Press Start 2P', monospace;
    font-size: 7.5px;
    color: #f0c419;
    padding: 0 4px;
    letter-spacing: 0.5px;
  }

  .form-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .ctrl-label {
    font-size: 10px;
    color: #e5e5e5;
  }

  .btn-group {
    display: flex;
    gap: 4px;
  }
  .btn-toggle {
    background: #141714;
    border: 2px solid #2a2f2a;
    color: #8a948a;
    font-family: 'Press Start 2P', monospace;
    font-size: 7px;
    padding: 4px 6px;
    cursor: pointer;
    box-shadow: 1px 1px 0 #000;
    transition: all 0.08s steps(2);
  }
  .btn-toggle.selected {
    background: #1a1600;
    color: #f0c419;
    border-color: #f0c419;
    box-shadow: none;
    transform: translate(1px, 1px);
    font-weight: bold;
  }

  input[type='number'],
  select {
    background: #0a0a0a;
    border: 2px solid #2a2f2a;
    color: #ffffff;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    padding: 4px 6px;
    width: 140px;
  }
  input[type='number']:focus,
  select:focus {
    outline: 2px solid #f0c419;
    border-color: #f0c419;
  }

  .input-with-presets {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
  }
  .mini-presets {
    display: flex;
    gap: 3px;
  }
  .btn-preset {
    background: #141714;
    border: 1px solid #2a2f2a;
    color: #8a948a;
    font-family: 'Press Start 2P', monospace;
    font-size: 6.5px;
    padding: 2px 4px;
    cursor: pointer;
  }
  .btn-preset:hover {
    color: #f0c419;
    border-color: #f0c419;
  }

  /* Actions footer (The INITIATE HAVOC Moment) */
  .action-footer {
    display: flex;
    gap: 6px;
  }
  .btn-action {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px;
    font-family: 'Press Start 2P', monospace;
    font-size: 9.5px;
    letter-spacing: 1px;
    cursor: pointer;
    border: 2px solid;
    box-shadow: 4px 4px 0 #000000;
    transition: transform 0.05s steps(2), box-shadow 0.05s steps(2);
  }
  .btn-action:active:not(:disabled) {
    transform: translate(4px, 4px);
    box-shadow: 0 0 0 #000000;
  }

  .btn-start {
    background: #f0c419;
    color: #0a0a0a;
    border-color: #f0c419;
    font-weight: 900;
  }
  .btn-start:hover:not(:disabled) {
    background: #ffd633;
    border-color: #ffd633;
  }
  .btn-start:disabled {
    background: #1f1b0a;
    color: #66591f;
    border-color: #332d0d;
    box-shadow: 2px 2px 0 #000;
    cursor: default;
  }

  .btn-abort {
    background: #ff3b3b;
    color: #ffffff;
    border-color: #ff3b3b;
  }
  .btn-abort:hover:not(:disabled) {
    background: #ff6666;
    border-color: #ff6666;
  }
  .btn-abort:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .btn-icon {
    font-size: 8.5px;
  }
</style>
