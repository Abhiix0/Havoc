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

<div class="crt-frame">
  <!-- Scanline & Vignette Overlays -->
  <div class="scanlines" />
  <div class="crt-vignette" />

  <!-- Main Container -->
  <main class="console-body">
    <!-- Header -->
    <header class="console-header">
      <div class="title-row">
        <div class="brand">
          <span class="brand-glitch">HAVOC</span>
          <span class="sub-brand">// DIAGNOSTIC CONSOLE v1.0</span>
        </div>
        <div class="status-indicator">
          {#if isRunActive}
            <span class="badge badge-active blink">● ACTIVE [{currentRun?.state}]</span>
          {:else if currentRun?.state === 'COMPLETED'}
            <span class="badge badge-completed">✓ IDLE [COMPLETED]</span>
          {:else if currentRun && TERMINAL_STATES.has(currentRun.state)}
            <span class="badge badge-terminal">▲ IDLE [{currentRun.state}]</span>
          {:else}
            <span class="badge badge-standby">STANDBY</span>
          {/if}
        </div>
      </div>

      <!-- Target Inspector Strip -->
      <div class="target-strip">
        <span class="label">[TARGET]</span>
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
              <span class="empty-prompt">&gt; Awaiting observation telemetry...</span>
              <span class="empty-sub">Trigger an experiment to observe network and DOM mutations.</span>
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
                  <span class="nf-icon">✓</span>
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

    <!-- Action Bar -->
    <footer class="action-footer">
      {#if isRunActive}
        <button class="btn-action btn-abort" on:click={handleAbortRun} disabled={aborting}>
          <span class="btn-icon">⏹</span>
          {aborting ? 'ABORTING...' : 'ABORT EXPERIMENT'}
        </button>
      {:else}
        <button class="btn-action btn-start" on:click={handleStartRun} disabled={!canStart}>
          <span class="btn-icon">▶</span>
          {starting ? 'ARMING CHAOS...' : 'EXECUTE EXPERIMENT'}
        </button>
      {/if}
    </footer>
  </main>
</div>

<style>
  /* CRT Chassis, Vignette & Scanline effect */
  .crt-frame {
    position: relative;
    width: 440px;
    min-height: 560px;
    background: #05070a;
    color: #cbd5e1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    animation: crt-flicker 0.18s infinite;
    font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  }

  @keyframes crt-flicker {
    0% { opacity: 0.993; }
    50% { opacity: 1; }
    100% { opacity: 0.996; }
  }

  .scanlines {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 100;
    background: linear-gradient(
      rgba(18, 16, 16, 0) 50%,
      rgba(0, 0, 0, 0.35) 50%
    ),
    linear-gradient(
      90deg,
      rgba(255, 0, 0, 0.03),
      rgba(0, 255, 0, 0.015),
      rgba(0, 0, 255, 0.03)
    );
    background-size: 100% 2px, 3px 100%;
  }

  .crt-vignette {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 101;
    background: radial-gradient(
      circle at 50% 50%,
      transparent 60%,
      rgba(0, 0, 0, 0.4) 88%,
      rgba(0, 0, 0, 0.75) 100%
    );
    box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.9);
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
    background: #090e17;
    border: 1px solid #1e293b;
    border-left: 3px solid #00f0ff;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: 0 0 10px rgba(0, 240, 255, 0.08);
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

  .brand-glitch {
    font-family: 'Press Start 2P', monospace;
    font-size: 11px;
    letter-spacing: 1px;
    color: #00f0ff;
    text-shadow: 0 0 8px rgba(0, 240, 255, 0.6);
  }

  .sub-brand {
    font-size: 9px;
    letter-spacing: 0.5px;
    color: #94a3b8;
  }

  .target-strip {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    background: #05080e;
    padding: 4px 6px;
    border: 1px solid #131e2e;
  }

  .label {
    color: #38bdf8;
    font-weight: bold;
    font-size: 9px;
  }

  .target-chip {
    font-family: 'Press Start 2P', monospace;
    padding: 2px 4px;
    border-radius: 2px;
    font-size: 7.5px;
    background: #0284c7;
    color: #fff;
  }

  .target-chip.no-target {
    background: #dc2626;
  }

  .target-origin {
    color: #cbd5e1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 250px;
  }

  /* Badges */
  .badge {
    font-family: 'Press Start 2P', monospace;
    font-size: 7.5px;
    padding: 3px 6px;
    letter-spacing: 0.5px;
    border-radius: 2px;
    line-height: 1.3;
  }
  .badge-active {
    background: #7c2d12;
    color: #fed7aa;
    border: 1px solid #ea580c;
    text-shadow: 0 0 6px rgba(251, 146, 60, 0.7);
  }
  .badge-completed {
    background: #064e3b;
    color: #86efac;
    border: 1px solid #16a34a;
    text-shadow: 0 0 6px rgba(74, 222, 128, 0.5);
  }
  .badge-terminal {
    background: #450a0a;
    color: #fca5a5;
    border: 1px solid #dc2626;
  }
  .badge-standby {
    background: #1e293b;
    color: #cbd5e1;
    border: 1px solid #334155;
  }

  .blink {
    animation: blinker 1.2s infinite ease-in-out;
  }
  @keyframes blinker {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .error-banner {
    background: #450a0a;
    border: 1px solid #dc2626;
    color: #fecaca;
    padding: 5px 8px;
    font-size: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .error-icon {
    background: #dc2626;
    color: #fff;
    font-weight: bold;
    padding: 0 4px;
    border-radius: 2px;
  }

  /* Pipeline ribbon */
  .pipeline-section {
    background: #090e17;
    border: 1px solid #1e293b;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .pipeline-header {
    display: flex;
    justify-content: space-between;
    font-size: 8.5px;
    color: #94a3b8;
    letter-spacing: 0.5px;
  }

  .sec-label {
    font-family: 'Press Start 2P', monospace;
    font-size: 7px;
    color: #94a3b8;
  }

  .run-id-tag {
    font-family: 'Press Start 2P', monospace;
    font-size: 7px;
    color: #38bdf8;
  }

  .pipeline-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #04060a;
    padding: 5px 6px;
    border: 1px solid #131e2e;
    overflow-x: auto;
  }

  .pipe-node {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 8.5px;
    color: #64748b;
  }
  .node-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 8px;
    line-height: 1;
  }
  .glyph-current {
    color: #00f0ff;
    text-shadow: 0 0 6px rgba(0, 240, 255, 0.85);
    animation: pixel-pulse 0.9s infinite alternate ease-in-out;
  }
  @keyframes pixel-pulse {
    0% { transform: scale(0.9); opacity: 0.8; }
    100% { transform: scale(1.18); opacity: 1; }
  }
  .glyph-past {
    color: #22c55e;
  }
  .glyph-failed {
    color: #ef4444;
    text-shadow: 0 0 6px rgba(239, 68, 68, 0.8);
  }
  .glyph-pending {
    color: #475569;
  }

  .pipe-node.past {
    color: #22c55e;
  }
  .pipe-node.current {
    color: #00f0ff;
    font-weight: bold;
    text-shadow: 0 0 4px rgba(0, 240, 255, 0.6);
  }
  .pipe-node.failed {
    color: #ef4444;
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
    color: #94a3b8;
  }

  /* Navigation */
  .console-nav {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid #1e293b;
    padding-bottom: 2px;
  }

  .nav-tab {
    flex: 1;
    background: #090e17;
    color: #94a3b8;
    border: 1px solid #1e293b;
    border-bottom: none;
    font-family: 'Press Start 2P', monospace;
    font-size: 7.5px;
    padding: 6px 2px;
    cursor: pointer;
    letter-spacing: 0.5px;
    transition: all 0.12s;
    line-height: 1.2;
  }
  .nav-tab:hover {
    background: #131e2e;
    color: #f1f5f9;
  }
  .nav-tab.active {
    background: #131e2e;
    color: #00f0ff;
    border-top: 2px solid #00f0ff;
    text-shadow: 0 0 6px rgba(0, 240, 255, 0.5);
  }

  /* Viewport Area */
  .viewport {
    flex: 1;
    min-height: 250px;
    max-height: 310px;
    background: #080c14;
    border: 1px solid #1e293b;
    padding: 8px;
    overflow-y: auto;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 200px;
    color: #94a3b8;
    text-align: center;
    gap: 6px;
  }
  .empty-prompt {
    font-size: 11px;
    color: #cbd5e1;
    font-weight: bold;
  }
  .empty-sub {
    font-size: 9.5px;
    color: #94a3b8;
    max-width: 260px;
  }

  /* Timeline Stream */
  .event-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .event-row {
    background: #05080e;
    border: 1px solid #15202e;
    border-left: 3px solid #334155;
    padding: 6px 8px;
    font-size: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .event-row.type-chaos_injected {
    border-left-color: #f97316;
    background: #140d06;
  }
  .event-row.type-request_transport_failure,
  .event-row.type-request_http_failure,
  .event-row.type-request_timeout {
    border-left-color: #ef4444;
    background: #150808;
  }
  .event-row.type-request_completed {
    border-left-color: #22c55e;
  }
  .event-row.type-dom_observation {
    border-left-color: #06b6d4;
  }

  .evt-meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .evt-seq {
    color: #94a3b8;
    font-weight: bold;
    font-size: 9px;
  }
  .evt-time {
    color: #cbd5e1;
    font-size: 9px;
  }
  .evt-badge {
    font-family: 'Press Start 2P', monospace;
    font-size: 7px;
    padding: 2px 4px;
    border-radius: 2px;
    background: #1e293b;
    color: #e2e8f0;
  }
  .badge-chaos_injected { background: #7c2d12; color: #fed7aa; }
  .badge-request_completed { background: #064e3b; color: #a7f3d0; }
  .badge-request_transport_failure,
  .badge-request_http_failure,
  .badge-request_timeout { background: #450a0a; color: #fecaca; }
  .badge-dom_observation { background: #164e63; color: #a5f3fc; }

  .evt-details {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    color: #cbd5e1;
  }
  .evt-resource {
    color: #f1f5f9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 220px;
  }
  .evt-dom-kind {
    color: #38bdf8;
    font-weight: bold;
  }
  .evt-selector {
    color: #cbd5e1;
    background: #0b111a;
    padding: 0 4px;
    border: 1px solid #1e293b;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .evt-snippet {
    color: #f8fafc;
    font-style: italic;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .evt-status {
    padding: 0 4px;
    font-weight: bold;
    border-radius: 2px;
  }
  .evt-status.ok { color: #86efac; background: #064e3b; }
  .evt-status.fail { color: #fca5a5; background: #450a0a; }
  .evt-duration { color: #fbbf24; }
  .evt-err-msg { color: #f87171; }

  /* Signals View */
  .signals-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .signal-card {
    background: #05080e;
    border: 1px solid #1e293b;
    border-left: 3px solid #00f0ff;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .signal-card.type-requestfailureobserved {
    border-left-color: #ef4444;
  }
  .signal-card.type-loadingstatedetected {
    border-left-color: #f59e0b;
  }
  .signal-card.type-errorstatedetected {
    border-left-color: #ec4899;
  }

  .sig-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .sig-type {
    font-size: 11px;
    font-weight: bold;
    color: #f8fafc;
  }
  .sig-conf-badge {
    font-family: 'Press Start 2P', monospace;
    font-size: 7.5px;
    color: #00f0ff;
    background: #0c2033;
    padding: 2px 5px;
    border-radius: 2px;
    border: 1px solid #0284c7;
  }

  .sig-meter {
    height: 4px;
    background: #1e293b;
    border-radius: 1px;
    overflow: hidden;
  }
  .sig-meter-fill {
    height: 100%;
    background: #00f0ff;
    box-shadow: 0 0 6px rgba(0, 240, 255, 0.6);
  }

  .sig-footer {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 9px;
    color: #94a3b8;
  }
  .ref-tag {
    background: #131e2e;
    color: #cbd5e1;
    padding: 0 4px;
    border-radius: 2px;
  }

  /* Autopsy View */
  .autopsy-report {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .outcome-banner {
    padding: 8px 10px;
    border: 1px solid #1e293b;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .outcome-recovered {
    background: #064e3b;
    border-color: #16a34a;
    color: #86efac;
  }
  .outcome-degraded {
    background: #451a03;
    border-color: #d97706;
    color: #fde68a;
  }
  .outcome-failed {
    background: #450a0a;
    border-color: #dc2626;
    color: #fca5a5;
  }
  .outcome-unknown {
    background: #082f49;
    border-color: #0284c7;
    color: #7dd3fc;
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
    color: #f1f5f9;
  }

  .no-finding-box {
    background: #064e3b;
    border: 1px solid #16a34a;
    color: #dcfce7;
    padding: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }
  .nf-icon {
    font-size: 16px;
    font-weight: bold;
  }

  .finding-card {
    background: #05080e;
    border: 1px solid #1e293b;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .finding-card.severity-high {
    border-left: 4px solid #ef4444;
  }
  .finding-card.severity-medium {
    border-left: 4px solid #f59e0b;
  }

  .finding-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .sev-badge {
    font-family: 'Press Start 2P', monospace;
    font-size: 8px;
  }
  .sev-high { color: #fca5a5; }
  .sev-medium { color: #fde68a; }
  .fnd-conf {
    font-size: 9.5px;
    color: #cbd5e1;
  }
  .fnd-desc {
    margin: 0;
    font-size: 10.5px;
    line-height: 1.45;
    color: #f1f5f9;
  }
  .fnd-evidence {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: #94a3b8;
    border-top: 1px solid #131e2e;
    padding-top: 4px;
  }

  /* Config view */
  .control-box {
    border: 1px solid #1e293b;
    padding: 8px 10px;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: #070b12;
  }
  .ctrl-legend {
    font-family: 'Press Start 2P', monospace;
    font-size: 7.5px;
    color: #00f0ff;
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
    color: #cbd5e1;
  }

  .btn-group {
    display: flex;
    gap: 4px;
  }
  .btn-toggle {
    background: #090e17;
    border: 1px solid #1e293b;
    color: #94a3b8;
    font-family: 'Press Start 2P', monospace;
    font-size: 7.5px;
    padding: 4px 8px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .btn-toggle.selected {
    background: #0284c7;
    color: #fff;
    border-color: #38bdf8;
    font-weight: bold;
    box-shadow: 0 0 6px rgba(56, 189, 248, 0.4);
  }

  input[type='number'],
  select {
    background: #04060a;
    border: 1px solid #1e293b;
    color: #f1f5f9;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    padding: 4px 6px;
    width: 140px;
  }
  input[type='number']:focus,
  select:focus {
    outline: 1px solid #00f0ff;
    border-color: #00f0ff;
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
    background: #090e17;
    border: 1px solid #1e293b;
    color: #94a3b8;
    font-family: 'Press Start 2P', monospace;
    font-size: 6.5px;
    padding: 2px 4px;
    cursor: pointer;
    transition: all 0.1s;
  }
  .btn-preset:hover {
    color: #00f0ff;
    border-color: #00f0ff;
  }

  /* Actions footer */
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
    padding: 9px;
    font-family: 'Press Start 2P', monospace;
    font-size: 9px;
    letter-spacing: 0.5px;
    cursor: pointer;
    border-radius: 2px;
    transition: all 0.15s;
  }

  .btn-start {
    background: #00ff88;
    color: #022c15;
    border: 1px solid #00ff88;
    text-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
    box-shadow: 0 0 10px rgba(0, 255, 136, 0.35);
  }
  .btn-start:hover:not(:disabled) {
    background: #34d399;
    box-shadow: 0 0 16px rgba(0, 255, 136, 0.6);
  }
  .btn-start:disabled {
    background: #112017;
    color: #4b6355;
    border-color: #1a3023;
    box-shadow: none;
    cursor: default;
  }

  .btn-abort {
    background: #ef4444;
    color: #fff;
    border: 1px solid #ef4444;
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.4);
  }
  .btn-abort:hover:not(:disabled) {
    background: #f87171;
    box-shadow: 0 0 16px rgba(239, 68, 68, 0.7);
  }
  .btn-abort:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn-icon {
    font-size: 9px;
  }
</style>
