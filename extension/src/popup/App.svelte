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
  <!-- Scanline Overlay -->
  <div class="scanlines" />

  <!-- Main Container -->
  <main class="console-body">
    <!-- Header -->
    <header class="console-header">
      <div class="title-row">
        <div class="brand">
          <span class="brand-glitch">HAVOC</span>
          <span class="sub-brand">// DIAGNOSTIC CONSOLE v0.8</span>
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
  /* CRT Chassis & Scanline effect */
  .crt-frame {
    position: relative;
    width: 440px;
    min-height: 560px;
    background: #06090e;
    color: #cbd5e1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
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
      rgba(0, 0, 0, 0.28) 50%
    ),
    linear-gradient(
      90deg,
      rgba(255, 0, 0, 0.02),
      rgba(0, 255, 0, 0.01),
      rgba(0, 0, 255, 0.02)
    );
    background-size: 100% 2px, 3px 100%;
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
    background: #0b111a;
    border: 1px solid #1e293b;
    border-left: 3px solid #00f0ff;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
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
    font-size: 14px;
    font-weight: 900;
    letter-spacing: 2px;
    color: #00f0ff;
    text-shadow: 0 0 6px rgba(0, 240, 255, 0.5);
  }

  .sub-brand {
    font-size: 9px;
    letter-spacing: 1px;
    color: #64748b;
  }

  .target-strip {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    background: #070c14;
    padding: 3px 6px;
    border: 1px solid #131e2e;
  }

  .target-chip {
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 9px;
    font-weight: bold;
    background: #0284c7;
    color: #fff;
  }

  .target-chip.no-target {
    background: #dc2626;
  }

  .target-origin {
    color: #94a3b8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 250px;
  }

  /* Badges */
  .badge {
    font-size: 10px;
    font-weight: bold;
    padding: 2px 6px;
    letter-spacing: 0.5px;
    border-radius: 2px;
  }
  .badge-active {
    background: #7c2d12;
    color: #fb923c;
    border: 1px solid #ea580c;
    text-shadow: 0 0 4px rgba(251, 146, 60, 0.6);
  }
  .badge-completed {
    background: #064e3b;
    color: #4ade80;
    border: 1px solid #16a34a;
  }
  .badge-terminal {
    background: #450a0a;
    color: #f87171;
    border: 1px solid #dc2626;
  }
  .badge-standby {
    background: #1e293b;
    color: #94a3b8;
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
    color: #fca5a5;
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
    background: #0b111a;
    border: 1px solid #1e293b;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .pipeline-header {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: #64748b;
    letter-spacing: 0.5px;
  }

  .pipeline-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #05080e;
    padding: 4px 6px;
    border: 1px solid #131e2e;
    overflow-x: auto;
  }

  .pipe-node {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 8.5px;
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
    opacity: 0.6;
    font-size: 7px;
  }
  .node-arrow {
    opacity: 0.3;
    margin-left: 2px;
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
    background: #0b111a;
    color: #64748b;
    border: 1px solid #1e293b;
    border-bottom: none;
    font-family: inherit;
    font-size: 9.5px;
    font-weight: bold;
    padding: 5px 2px;
    cursor: pointer;
    letter-spacing: 0.5px;
    transition: all 0.12s;
  }
  .nav-tab:hover {
    background: #131e2e;
    color: #cbd5e1;
  }
  .nav-tab.active {
    background: #131e2e;
    color: #00f0ff;
    border-top: 2px solid #00f0ff;
    text-shadow: 0 0 4px rgba(0, 240, 255, 0.4);
  }

  /* Viewport Area */
  .viewport {
    flex: 1;
    min-height: 250px;
    max-height: 310px;
    background: #090e16;
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
    color: #64748b;
    text-align: center;
    gap: 6px;
  }
  .empty-prompt {
    font-size: 11px;
    color: #94a3b8;
  }
  .empty-sub {
    font-size: 9px;
    max-width: 260px;
  }

  /* Timeline Stream */
  .event-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .event-row {
    background: #06090e;
    border: 1px solid #15202e;
    border-left: 2px solid #334155;
    padding: 5px 7px;
    font-size: 9.5px;
    display: flex;
    flex-direction: column;
    gap: 3px;
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
    color: #64748b;
    font-weight: bold;
  }
  .evt-time {
    color: #94a3b8;
  }
  .evt-badge {
    font-size: 8px;
    font-weight: bold;
    padding: 1px 4px;
    border-radius: 2px;
    background: #1e293b;
    color: #e2e8f0;
  }
  .badge-chaos_injected { background: #7c2d12; color: #fdba74; }
  .badge-request_completed { background: #064e3b; color: #86efac; }
  .badge-request_transport_failure,
  .badge-request_http_failure,
  .badge-request_timeout { background: #450a0a; color: #fca5a5; }
  .badge-dom_observation { background: #164e63; color: #67e8f9; }

  .evt-details {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    color: #94a3b8;
  }
  .evt-resource {
    color: #cbd5e1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 220px;
  }
  .evt-dom-kind {
    color: #38bdf8;
  }
  .evt-selector {
    color: #94a3b8;
    background: #0b111a;
    padding: 0 3px;
    border: 1px solid #1e293b;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .evt-snippet {
    color: #e2e8f0;
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
  .evt-status.ok { color: #4ade80; background: #064e3b; }
  .evt-status.fail { color: #f87171; background: #450a0a; }
  .evt-duration { color: #f59e0b; }
  .evt-err-msg { color: #ef4444; }

  /* Signals View */
  .signals-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .signal-card {
    background: #06090e;
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
    font-size: 10.5px;
    font-weight: bold;
    color: #f1f5f9;
  }
  .sig-conf-badge {
    font-size: 9px;
    color: #00f0ff;
    background: #0c2033;
    padding: 1px 5px;
    border-radius: 2px;
    border: 1px solid #0284c7;
  }

  .sig-meter {
    height: 3px;
    background: #1e293b;
    border-radius: 1px;
    overflow: hidden;
  }
  .sig-meter-fill {
    height: 100%;
    background: #00f0ff;
  }

  .sig-footer {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 8.5px;
    color: #64748b;
  }
  .ref-tag {
    background: #131e2e;
    color: #94a3b8;
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
    color: #4ade80;
  }
  .outcome-degraded {
    background: #451a03;
    border-color: #d97706;
    color: #fbbf24;
  }
  .outcome-failed {
    background: #450a0a;
    border-color: #dc2626;
    color: #f87171;
  }
  .outcome-unknown {
    background: #082f49;
    border-color: #0284c7;
    color: #38bdf8;
  }

  .outcome-title {
    display: flex;
    flex-direction: column;
  }
  .outcome-tag { font-size: 8.5px; opacity: 0.8; }
  .outcome-val { font-size: 14px; font-weight: 900; letter-spacing: 1px; }

  .outcome-window {
    display: flex;
    flex-direction: column;
    text-align: right;
    font-size: 9px;
    opacity: 0.9;
  }

  .no-finding-box {
    background: #064e3b;
    border: 1px solid #16a34a;
    color: #bbf7d0;
    padding: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10.5px;
  }
  .nf-icon {
    font-size: 16px;
    font-weight: bold;
  }

  .finding-card {
    background: #06090e;
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
    font-size: 10px;
    font-weight: bold;
  }
  .sev-high { color: #f87171; }
  .sev-medium { color: #fbbf24; }
  .fnd-conf {
    font-size: 9px;
    color: #94a3b8;
  }
  .fnd-desc {
    margin: 0;
    font-size: 10px;
    line-height: 1.4;
    color: #e2e8f0;
  }
  .fnd-evidence {
    display: flex;
    justify-content: space-between;
    font-size: 8.5px;
    color: #64748b;
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
  }
  .ctrl-legend {
    font-size: 9px;
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
    font-size: 9.5px;
    color: #94a3b8;
  }

  .btn-group {
    display: flex;
    gap: 4px;
  }
  .btn-toggle {
    background: #0b111a;
    border: 1px solid #1e293b;
    color: #64748b;
    font-family: inherit;
    font-size: 9px;
    padding: 3px 8px;
    cursor: pointer;
  }
  .btn-toggle.selected {
    background: #0284c7;
    color: #fff;
    border-color: #38bdf8;
    font-weight: bold;
  }

  input[type='number'],
  select {
    background: #05080e;
    border: 1px solid #1e293b;
    color: #e2e8f0;
    font-family: inherit;
    font-size: 10px;
    padding: 3px 6px;
    width: 140px;
  }
  input[type='number']:focus,
  select:focus {
    outline: 1px solid #00f0ff;
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
    background: #0b111a;
    border: 1px solid #1e293b;
    color: #64748b;
    font-size: 8px;
    padding: 1px 4px;
    cursor: pointer;
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
    padding: 8px;
    font-family: inherit;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 1px;
    cursor: pointer;
    border-radius: 2px;
    transition: all 0.15s;
  }

  .btn-start {
    background: #00ff88;
    color: #022c15;
    border: 1px solid #00ff88;
    text-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
    box-shadow: 0 0 10px rgba(0, 255, 136, 0.25);
  }
  .btn-start:hover:not(:disabled) {
    background: #34d399;
    box-shadow: 0 0 15px rgba(0, 255, 136, 0.5);
  }
  .btn-start:disabled {
    background: #13241b;
    color: #4b6355;
    border-color: #1e3a2b;
    box-shadow: none;
    cursor: default;
  }

  .btn-abort {
    background: #ef4444;
    color: #fff;
    border: 1px solid #ef4444;
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.3);
  }
  .btn-abort:hover:not(:disabled) {
    background: #f87171;
  }
  .btn-abort:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn-icon {
    font-size: 10px;
  }
</style>
