<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import {
    currentRun,
    events,
    aborting,
    handleAbortRun,
    TERMINAL_STATES,
  } from '../stores/run';
  import type { ExperimentState } from '../../../domain/run';
  import Robot from '../components/Robot.svelte';
  import Button from '../components/Button.svelte';
  import EventRow from '../components/EventRow.svelte';

  const dispatch = createEventDispatcher<{
    navigate: 'autopsy' | 'home';
  }>();

  let elapsedSec = 0;
  let timer: any = null;
  let navigatedAway = false;

  onMount(() => {
    updateElapsed();
    timer = setInterval(updateElapsed, 500);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });

  function updateElapsed() {
    if ($currentRun && $currentRun.createdAt > 0) {
      elapsedSec = Math.max(0, (Date.now() - $currentRun.createdAt) / 1000);
    }
  }

  // Map state to Robot state prop
  function getRobotState(
    s?: ExperimentState
  ): 'armed' | 'chaos' | 'running' | 'success' | 'failure' | 'idle' {
    if (!s) return 'idle';
    if (s === 'PREPARING') return 'armed';
    if (s === 'ACTIVE') return 'chaos';
    if (s === 'STOPPING' || s === 'CLEANING' || s === 'EVALUATING')
      return 'running';
    if (s === 'COMPLETED') return 'success';
    if (TERMINAL_STATES.has(s)) return 'failure';
    return 'idle';
  }

  // Get state styling class
  function getStateTone(s?: ExperimentState): string {
    if (!s) return 'tone-neutral';
    if (s === 'ACTIVE') return 'tone-active';
    if (s === 'COMPLETED') return 'tone-completed';
    if (
      s === 'PREPARING' ||
      s === 'STOPPING' ||
      s === 'CLEANING' ||
      s === 'EVALUATING'
    ) {
      return 'tone-transitional';
    }
    return 'tone-danger';
  }

  // Summarize what's being affected from definition
  function getAffectedSummary(run: typeof $currentRun): string {
    if (!run?.definition) return 'Injecting chaos...';
    const def = run.definition;
    const p = def.params ?? {};

    if (def.kind === 'fetch_latency') {
      const delay = p.delayMs ?? 500;
      return `Delaying outgoing network requests by +${delay}ms`;
    }
    if (def.kind === 'fetch_failure') {
      const mode = p.mode ?? 'transport_error';
      if (mode === 'synthetic_http_error')
        return `Simulating HTTP ${p.syntheticStatus ?? 503} errors`;
      if (mode === 'synthetic_timeout')
        return `Simulating request timeouts (${p.timeoutMs ?? 8000}ms)`;
      return 'Simulating transport / network connection failures';
    }
    if (def.kind === 'input_stress') {
      return `Injecting ${p.mode ?? 'all'} edge-case values into input fields`;
    }
    if (def.kind === 'viewport_stress') {
      return `Applying ${p.mode ?? 'mobile_narrow'} layout constraints`;
    }
    return def.description || def.name;
  }

  // Watch for terminal state to auto-navigate to autopsy after a brief pause
  $: if (
    $currentRun &&
    TERMINAL_STATES.has($currentRun.state) &&
    !navigatedAway
  ) {
    navigatedAway = true;
    setTimeout(() => {
      dispatch('navigate', 'autopsy');
    }, 1200);
  }

  $: recentEvents = $events.slice(-5).reverse();
</script>

<div class="active-screen" in:fade={{ duration: 200, easing: cubicOut }}>
  {#if !$currentRun}
    <div class="empty-state">
      <div class="robot-wrap">
        <Robot state="idle" />
      </div>
      <div class="empty-text">
        <span class="empty-title">NO ACTIVE RUN</span>
        <p class="empty-desc">There is currently no active chaos experiment running.</p>
      </div>
      <div class="empty-action">
        <Button variant="ghost" on:click={() => dispatch('navigate', 'home')}>
          ← RETURN HOME
        </Button>
      </div>
    </div>
  {:else}
    <!-- Top State Header -->
    <header class="active-header">
      <div class="header-left">
        <span class="live-dot" />
        <span class="header-label">EXPERIMENT IN PROGRESS</span>
      </div>
      <div class="header-right">
        <span class="timer-tag">{elapsedSec.toFixed(1)}s</span>
      </div>
    </header>

    <!-- Robot Mascot & Live State Indicator -->
    <div class="status-hero">
      <div class="robot-wrap">
        <Robot state={getRobotState($currentRun?.state)} />
      </div>

      <div class="state-block">
        <span class="state-tag {getStateTone($currentRun?.state)}">
          ● {$currentRun?.state ?? 'ACTIVE'}
        </span>
        <p class="affected-summary">{getAffectedSummary($currentRun)}</p>
      </div>
    </div>

    <!-- Target & Run Meta Info -->
    <div class="meta-card">
      <div class="meta-row">
        <span class="meta-label">RUN ID:</span>
        <span class="meta-val mono">{$currentRun?.runId ?? 'UNKNOWN'}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">TARGET:</span>
        <span class="meta-val mono" title={$currentRun?.target.origin}>
          {$currentRun?.target.origin ?? 'Active Tab'}
        </span>
      </div>
    </div>

    <!-- Live Telemetry Ticker -->
    <div class="ticker-section">
      <div class="ticker-header">
        <span class="ticker-title">LIVE TELEMETRY</span>
        <span class="ticker-count">{$events.length} EVENTS</span>
      </div>

      <div class="events-stream">
        {#if recentEvents.length === 0}
          <div class="empty-ticker">
            <span class="pulse-line">Awaiting initial telemetry events...</span>
          </div>
        {:else}
          {#each recentEvents as evt (evt.id)}
            <div in:slide={{ duration: 120, easing: cubicOut }}>
              <EventRow
                event={evt}
                startTime={$currentRun?.createdAt ?? 0}
                targetOrigin={$currentRun?.target?.origin ?? ''}
              />
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Action Bar -->
    <div class="action-footer">
      <Button
        variant="danger"
        disabled={$aborting ||
          ($currentRun !== null && TERMINAL_STATES.has($currentRun.state))}
        on:click={handleAbortRun}
      >
        {$aborting ? 'STOPPING...' : '■ STOP HAVOC'}
      </Button>
    </div>
  {/if}
</div>

<style>
  .active-screen {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 12px);
    padding: var(--space-4, 16px);
    background: var(--bg-base, #0A0A0B);
    min-height: 520px;
    box-sizing: border-box;
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
  }

  .active-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: var(--space-2, 8px);
    border-bottom: 1px solid var(--border, #2A2B30);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
  }

  .live-dot {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-full, 9999px);
    background: var(--havoc-red, #E85C4A);
    animation: blink-dot 1.2s infinite;
  }

  .header-label {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted, #8A8B90);
    letter-spacing: 0.5px;
  }

  .timer-tag {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-xs, 11px);
    font-weight: 700;
    color: var(--text-primary, #F2F2F0);
    background: var(--bg-surface-2, #1E1F23);
    padding: 2px 8px;
    border-radius: var(--radius-sm, 4px);
    border: 1px solid var(--border, #2A2B30);
  }

  .status-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2, 8px);
    padding: var(--space-1, 4px) 0;
  }

  .robot-wrap {
    padding: var(--space-1, 4px);
  }

  .state-block {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .state-tag {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-xl, 16px);
    font-weight: 800;
    letter-spacing: 1px;
  }

  .tone-active {
    color: var(--havoc-red, #E85C4A);
  }

  .tone-transitional {
    color: var(--warn-amber, #F5C451);
  }

  .tone-completed {
    color: var(--recover-green, #4ADE80);
  }

  .tone-danger {
    color: var(--havoc-red, #E85C4A);
  }

  .tone-neutral {
    color: var(--text-muted, #8A8B90);
  }

  .affected-summary {
    margin: 0;
    font-size: var(--text-xs, 11px);
    color: var(--text-muted, #8A8B90);
    max-width: 380px;
    line-height: 1.35;
  }

  .meta-card {
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-md, 6px);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .meta-row {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    font-size: var(--text-xs, 11px);
  }

  .meta-label {
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
    font-weight: 600;
    color: var(--text-muted, #8A8B90);
    min-width: 55px;
  }

  .meta-val {
    color: var(--text-primary, #F2F2F0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta-val.mono {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
  }

  .ticker-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
    flex: 1;
  }

  .ticker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .ticker-title {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted, #8A8B90);
    letter-spacing: 0.5px;
  }

  .ticker-count {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9px;
    color: var(--text-muted, #8A8B90);
  }

  .events-stream {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 80px;
    max-height: 120px;
    overflow-y: hidden;
  }

  .empty-ticker {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 80px;
    background: var(--bg-surface, #16171A);
    border: 1px dashed var(--border, #2A2B30);
    border-radius: var(--radius-sm, 4px);
    color: var(--text-muted, #8A8B90);
    font-size: 10px;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
  }

  .action-footer {
    margin-top: auto;
    display: flex;
    flex-direction: column;
  }

  .action-footer :global(button) {
    width: 100%;
    padding: var(--space-3, 12px) var(--space-4, 16px);
    font-size: var(--text-base, 13px);
    letter-spacing: 0.5px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    text-align: center;
    gap: var(--space-4, 16px);
    margin: auto 0;
  }

  .empty-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
  }

  .empty-title {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-base, 13px);
    font-weight: 700;
    color: var(--text-primary, #F2F2F0);
    letter-spacing: 0.5px;
  }

  .empty-desc {
    margin: 0;
    font-size: var(--text-xs, 11px);
    color: var(--text-muted, #8A8B90);
    max-width: 280px;
    line-height: 1.4;
  }

  .empty-action {
    margin-top: var(--space-2, 8px);
  }

  @keyframes blink-dot {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.2;
    }
  }
</style>
