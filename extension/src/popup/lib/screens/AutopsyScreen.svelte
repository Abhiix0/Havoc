<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { fade, fly, slide } from 'svelte/transition';
  import {
    currentRun,
    recovery,
    findings,
    signals,
    events,
    loadRunDetails,
  } from '../stores/run';
  import RecoveryBanner from '../components/RecoveryBanner.svelte';
  import FindingCard from '../components/FindingCard.svelte';
  import SignalCard from '../components/SignalCard.svelte';
  import EventRow from '../components/EventRow.svelte';
  import Button from '../components/Button.svelte';

  const dispatch = createEventDispatcher<{
    navigate: 'home' | 'history';
  }>();

  let showFindings = false;
  let showRawEvidence = false;
  let rawEvidenceTab: 'signals' | 'events' = 'signals';

  onMount(async () => {
    if ($currentRun) {
      await loadRunDetails($currentRun.runId);
    }
    // Sequenced reveal: findings appear 180ms after banner
    setTimeout(() => {
      showFindings = true;
    }, 180);
  });

  function getInjectedSummary(run: typeof $currentRun): string {
    if (!run?.definition) return 'Chaos injection complete';
    const def = run.definition;
    const p = def.params ?? {};

    if (def.kind === 'fetch_latency') {
      const delay = p.delayMs ?? 500;
      return `Delayed outgoing requests by +${delay}ms`;
    }
    if (def.kind === 'fetch_failure') {
      const mode = p.mode ?? 'transport_error';
      if (mode === 'synthetic_http_error')
        return `Simulated HTTP ${p.syntheticStatus ?? 503} errors`;
      if (mode === 'synthetic_timeout')
        return `Simulated request timeouts (${p.timeoutMs ?? 8000}ms)`;
      return 'Simulated transport failure';
    }
    if (def.kind === 'input_stress') {
      return `Injected ${p.mode ?? 'all'} edge-case values into input fields`;
    }
    if (def.kind === 'viewport_stress') {
      return `Applied ${p.mode ?? 'mobile_narrow'} layout constraints`;
    }
    return def.description || def.name;
  }
</script>

<div class="autopsy-screen" in:fade={{ duration: 200 }}>
  <!-- Top Navigation Header -->
  <header class="autopsy-header">
    <button
      type="button"
      class="back-link"
      on:click={() => dispatch('navigate', 'home')}
    >
      ← HOME
    </button>
    <div class="header-titles">
      <span class="autopsy-title">AUTOPSY REPORT</span>
      <span class="autopsy-tag">{$currentRun?.state ?? 'COMPLETED'}</span>
    </div>
  </header>

  <!-- Injected Experiment Header -->
  <div class="injected-banner">
    <span class="injected-label">INJECTED CHAOS:</span>
    <span class="injected-val">{getInjectedSummary($currentRun)}</span>
  </div>

  <!-- Evaluated Recovery Banner -->
  <div class="banner-section" in:fade={{ duration: 150 }}>
    {#if $recovery}
      <RecoveryBanner recovery={$recovery} />
    {:else}
      <div class="empty-recovery">
        <span class="empty-text">Awaiting autopsy evaluation results...</span>
      </div>
    {/if}
  </div>

  <!-- Findings List or Calm Resilient Message -->
  {#if showFindings}
    <div class="findings-section" in:fade={{ duration: 200 }}>
      {#if $findings.length === 0}
        <div class="resilient-box" in:fly={{ y: 6, duration: 200 }}>
          <span class="resilient-icon">✔</span>
          <div class="resilient-content">
            {#if $recovery?.outcome === 'RECOVERED'}
              <span class="resilient-title">RESILIENT</span>
              <p class="resilient-text">
                Application recovered cleanly within the observation window. No user-visible faults detected.
              </p>
            {:else if $recovery?.outcome === 'DEGRADED'}
              <span class="resilient-title">GRACEFUL DEGRADATION</span>
              <p class="resilient-text">
                Application maintained partial function without hard failure findings.
              </p>
            {:else}
              <span class="resilient-title">INCONCLUSIVE</span>
              <p class="resilient-text">
                Insufficient observable evidence to conclude definitive failure.
              </p>
            {/if}
          </div>
        </div>
      {:else}
        <div class="findings-header">
          <span class="section-title">FINDINGS ({$findings.length})</span>
        </div>
        <div class="findings-list">
          {#each $findings as fnd, i (fnd.id)}
            <div in:fly={{ y: 8, duration: 200, delay: i * 60 }}>
              <FindingCard finding={fnd} />
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Collapsible Raw Evidence Section -->
  <div class="evidence-section">
    <button
      type="button"
      class="evidence-toggle"
      on:click={() => (showRawEvidence = !showRawEvidence)}
    >
      <span class="toggle-left">
        <span class="chevron">{showRawEvidence ? '▼' : '▶'}</span>
        <span>RAW EVIDENCE & TELEMETRY</span>
      </span>
      <span class="toggle-count">{$signals.length} SIG / {$events.length} EVT</span>
    </button>

    {#if showRawEvidence}
      <div class="evidence-content" transition:slide={{ duration: 150 }}>
        <!-- Sub Tabs -->
        <div class="evidence-nav">
          <button
            type="button"
            class="tab-btn"
            class:active={rawEvidenceTab === 'signals'}
            on:click={() => (rawEvidenceTab = 'signals')}
          >
            SIGNALS ({$signals.length})
          </button>
          <button
            type="button"
            class="tab-btn"
            class:active={rawEvidenceTab === 'events'}
            on:click={() => (rawEvidenceTab = 'events')}
          >
            TIMELINE ({$events.length})
          </button>
        </div>

        <!-- Evidence List -->
        <div class="evidence-list-wrap">
          {#if rawEvidenceTab === 'signals'}
            {#if $signals.length === 0}
              <div class="empty-sub">No failure signals detected.</div>
            {:else}
              <div class="signals-column">
                {#each $signals as sig (sig.id)}
                  <SignalCard signal={sig} />
                {/each}
              </div>
            {/if}
          {:else}
            {#if $events.length === 0}
              <div class="empty-sub">No recorded telemetry events.</div>
            {:else}
              <div class="events-column">
                {#each $events as evt (evt.id)}
                  <EventRow event={evt} startTime={$currentRun?.createdAt ?? 0} />
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- Action Bar -->
  <div class="action-footer">
    <Button
      variant="primary"
      on:click={() => dispatch('navigate', 'home')}
    >
      DONE
    </Button>
  </div>
</div>

<style>
  .autopsy-screen {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 12px);
    padding: var(--space-4, 16px);
    background: var(--bg-base, #0A0A0B);
    min-height: 520px;
    box-sizing: border-box;
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
  }

  .autopsy-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: var(--space-2, 8px);
    border-bottom: 1px solid var(--border, #2A2B30);
  }

  .back-link {
    background: none;
    border: none;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-xs, 11px);
    color: var(--text-muted, #8A8B90);
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease;
  }

  .back-link:hover {
    color: var(--text-primary, #F2F2F0);
  }

  .header-titles {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
  }

  .autopsy-title {
    font-size: var(--text-sm, 12px);
    font-weight: 700;
    color: var(--text-primary, #F2F2F0);
    letter-spacing: 0.5px;
  }

  .autopsy-tag {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    color: var(--text-muted, #8A8B90);
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-sm, 4px);
    padding: 1px 5px;
  }

  .injected-banner {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-sm, 4px);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    font-size: var(--text-xs, 11px);
  }

  .injected-label {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-weight: 700;
    color: var(--text-muted, #8A8B90);
    font-size: 10px;
    min-width: 105px;
  }

  .injected-val {
    color: var(--text-primary, #F2F2F0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .banner-section {
    width: 100%;
  }

  .empty-recovery {
    padding: var(--space-3, 12px);
    background: var(--bg-surface, #16171A);
    border: 1px dashed var(--border, #2A2B30);
    border-radius: var(--radius-md, 6px);
    text-align: center;
    color: var(--text-muted, #8A8B90);
    font-size: var(--text-xs, 11px);
  }

  .findings-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }

  .findings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-title {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    font-weight: 700;
    color: var(--text-muted, #8A8B90);
    letter-spacing: 0.5px;
  }

  .findings-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    max-height: 180px;
    overflow-y: auto;
  }

  .resilient-box {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3, 12px);
    padding: var(--space-3, 12px);
    background: rgba(74, 222, 128, 0.08);
    border: 1px solid rgba(74, 222, 128, 0.3);
    border-radius: var(--radius-md, 6px);
  }

  .resilient-icon {
    color: var(--recover-green, #4ADE80);
    font-size: 14px;
    font-weight: 800;
  }

  .resilient-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .resilient-title {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-xs, 11px);
    font-weight: 700;
    color: var(--recover-green, #4ADE80);
    letter-spacing: 0.5px;
  }

  .resilient-text {
    margin: 0;
    font-size: var(--text-xs, 11px);
    color: var(--text-primary, #F2F2F0);
    line-height: 1.35;
  }

  .evidence-section {
    display: flex;
    flex-direction: column;
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-md, 6px);
    overflow: hidden;
  }

  .evidence-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2, 8px) var(--space-3, 12px);
    background: none;
    border: none;
    color: var(--text-muted, #8A8B90);
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s ease;
  }

  .evidence-toggle:hover {
    background: var(--bg-surface-2, #1E1F23);
    color: var(--text-primary, #F2F2F0);
  }

  .toggle-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .chevron {
    font-size: 8px;
  }

  .toggle-count {
    font-size: 9px;
    opacity: 0.8;
  }

  .evidence-content {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border, #2A2B30);
    padding: var(--space-2, 8px);
    gap: var(--space-2, 8px);
    background: var(--bg-base, #0A0A0B);
  }

  .evidence-nav {
    display: flex;
    gap: var(--space-1, 4px);
  }

  .tab-btn {
    background: none;
    border: 1px solid transparent;
    color: var(--text-muted, #8A8B90);
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9.5px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
  }

  .tab-btn.active {
    background: var(--bg-surface-2, #1E1F23);
    color: var(--text-primary, #F2F2F0);
    border-color: var(--border, #2A2B30);
  }

  .evidence-list-wrap {
    max-height: 140px;
    overflow-y: auto;
  }

  .signals-column,
  .events-column {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .empty-sub {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    color: var(--text-muted, #8A8B90);
    text-align: center;
    padding: var(--space-3, 12px);
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
</style>
