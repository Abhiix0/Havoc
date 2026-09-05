<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import type { ShipCheckRun } from '../../../domain/ship-check';
  import type { Finding } from '../../../domain/finding';
  import type { Remediation } from '../../../domain/remediation';
  import { loadShipCheck } from '../stores/ship-check';
  import { readinessToTone } from '../utils/readiness-tone';
  import { friendlyStepName } from '../utils/step-labels';
  import FindingCard from '../components/FindingCard.svelte';
  import Button from '../components/Button.svelte';

  export let shipCheckId: string | null = null;

  const dispatch = createEventDispatcher<{
    navigate: { screen: 'home' | 'autopsy' | 'running'; runId?: string };
  }>();

  let shipCheck: ShipCheckRun | undefined = undefined;
  let findings: Finding[] = [];
  let remediations: Remediation[] = [];
  let loading = true;

  onMount(async () => {
    if (shipCheckId) {
      try {
        const details = await loadShipCheck(shipCheckId);
        shipCheck = details.shipCheck;
        findings = details.findings;
        remediations = details.remediations;
      } catch (e) {
        console.error('[HAVOC][results] failed to load ship check details', e);
      } finally {
        loading = false;
      }
    } else {
      loading = false;
    }
  });

  $: readiness = shipCheck?.readiness ?? 'UNKNOWN';
  $: tone = readinessToTone(readiness);

  // Remediation lookup map by findingId
  $: remediationMap = new Map<string, Remediation>(
    remediations.map((r) => [r.findingId, r])
  );

  // Summary counts
  $: criticalCount = findings.filter((f) => f.severity === 'HIGH').length;
  $: warningCount = findings.filter((f) => f.severity === 'MEDIUM' || f.severity === 'LOW').length;

  // Errored steps derivation
  $: erroredSteps = (shipCheck?.steps ?? []).filter((s) => s.status === 'ERRORED');
  $: hasErroredSteps = erroredSteps.length > 0;

  // Passed count = steps that reached DONE with 0 findings
  $: passedCount = (shipCheck?.steps ?? []).filter((step) => {
    if (step.status !== 'DONE') return false;
    const stepFindings = findings.filter((f) => f.runId === step.runId);
    return stepFindings.length === 0;
  }).length;

  function handleInspectAutopsy(runId: string) {
    dispatch('navigate', { screen: 'autopsy', runId });
  }
</script>

<div class="results-screen" in:fade={{ duration: 200, easing: cubicOut }}>
  <!-- Top Navigation Header -->
  <header class="results-header">
    <button
      type="button"
      class="back-link"
      aria-label="Back to home screen"
      on:click={() => dispatch('navigate', { screen: 'home' })}
    >
      ← HOME
    </button>
    <div class="header-titles">
      <span class="results-title">SHIP CHECK VERDICT</span>
    </div>
  </header>

  {#if loading}
    <div class="loading-state">
      <span class="loading-text">Loading diagnostic results...</span>
    </div>
  {:else if !shipCheck}
    <div class="empty-state">
      <span class="empty-icon">⚠</span>
      <span class="empty-title">SHIP CHECK NOT FOUND</span>
      <p class="empty-desc">Could not retrieve results for this test run.</p>
    </div>
  {:else}
    <!-- Readiness Banner -->
    <div class="verdict-banner tone-{tone}">
      <div class="banner-top">
        <span class="verdict-label">READINESS VERDICT</span>
        <span class="verdict-tag">[{readiness}]</span>
      </div>
      <h2 class="verdict-headline">
        {#if readiness === 'READY'}
          SHIP READY · ALL CHECKS PASSED
        {:else if readiness === 'NEEDS_ATTENTION'}
          CAUTION · NON-BLOCKING RESILIENCE ISSUES
        {:else if readiness === 'BLOCKED'}
          RELEASE BLOCKED · CRITICAL ISSUES DETECTED
        {:else}
          INCONCLUSIVE · TARGET UNREACHABLE OR ERROR
        {/if}
      </h2>
    </div>

    <!-- 3-Number Metric Row -->
    <div class="metric-grid">
      <div class="metric-card metric-critical">
        <span class="metric-num">{criticalCount}</span>
        <span class="metric-label">CRITICAL</span>
      </div>
      <div class="metric-card metric-warning">
        <span class="metric-num">{warningCount}</span>
        <span class="metric-label">WARNINGS</span>
      </div>
      <div class="metric-card metric-passed">
        <span class="metric-num">{passedCount}</span>
        <span class="metric-label">PASSED</span>
      </div>
    </div>

    <!-- Findings List -->
    <div class="findings-section">
      <div class="section-title-row">
        <span class="section-title">FINDINGS & REMEDIATION</span>
        <span class="finding-count">{findings.length} DETECTED</span>
      </div>

      {#if findings.length === 0 && !hasErroredSteps}
        <div class="clean-state">
          <span class="clean-icon">✓</span>
          <span class="clean-title">No issues detected</span>
          <p class="clean-desc">
            HAVOC completed all {(shipCheck?.steps ?? []).length} checks and found
            no evidence of a problem.
          </p>
        </div>
      {:else if findings.length === 0 && hasErroredSteps}
        <div class="clean-state incomplete-state">
          <span class="clean-icon incomplete-icon">!</span>
          <span class="clean-title">Results are incomplete</span>
          <p class="clean-desc">
            {erroredSteps.length} of {(shipCheck?.steps ?? []).length} checks
            couldn't run — see below. The checks that did complete found no
            issues, but this is not a full pass.
          </p>
          <ul class="errored-step-list">
            {#each erroredSteps as step}
              <li>{friendlyStepName(step.kind)}</li>
            {/each}
          </ul>
        </div>
      {:else}
        <div class="findings-list">
          {#each findings as finding, i (finding.id)}
            <div in:fly={{ y: 6, duration: 180, delay: i * 35 }}>
              <FindingCard
                {finding}
                remediation={remediationMap.get(finding.id)}
                summaryOnly={true}
              >
                <button
                  slot="action"
                  type="button"
                  class="view-details-btn"
                  on:click={() => handleInspectAutopsy(finding.runId)}
                >
                  DETAILS →
                </button>
              </FindingCard>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Action Section -->
    <div class="action-section">
      <Button
        variant="secondary"
        on:click={() => dispatch('navigate', { screen: 'home' })}
      >
        RETURN TO HOME
      </Button>
    </div>
  {/if}
</div>

<style>
  .results-screen {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 12px);
    padding: var(--space-4, 16px);
    background: var(--bg-base, #0A0A0B);
    min-height: 520px;
    box-sizing: border-box;
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
  }

  .results-header {
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

  .back-link:focus-visible {
    outline: 2px solid var(--havoc-red, #E85C4A);
    outline-offset: 2px;
    border-radius: var(--radius-sm, 4px);
  }

  .results-title {
    font-size: var(--text-sm, 12px);
    font-weight: 700;
    color: var(--text-primary, #F2F2F0);
    letter-spacing: 0.5px;
  }

  .verdict-banner {
    padding: var(--space-3, 12px);
    border-radius: var(--radius-md, 6px);
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-sizing: border-box;
  }

  .banner-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .verdict-label {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    opacity: 0.8;
  }

  .verdict-tag {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    font-weight: 800;
  }

  .verdict-headline {
    margin: 0;
    font-size: var(--text-sm, 13px);
    font-weight: 800;
    letter-spacing: 0.3px;
  }

  .tone-success {
    background: rgba(74, 222, 128, 0.12);
    border: 1px solid rgba(74, 222, 128, 0.3);
    color: var(--recover-green, #4ADE80);
  }

  .tone-warning {
    background: rgba(245, 196, 81, 0.12);
    border: 1px solid rgba(245, 196, 81, 0.3);
    color: var(--warn-amber, #F5C451);
  }

  .tone-critical {
    background: rgba(232, 92, 74, 0.12);
    border: 1px solid rgba(232, 92, 74, 0.3);
    color: var(--havoc-red, #E85C4A);
  }

  .tone-neutral {
    background: rgba(91, 143, 216, 0.12);
    border: 1px solid rgba(91, 143, 216, 0.3);
    color: var(--info-blue, #5B8FD8);
  }

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2, 8px);
  }

  .metric-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-2, 8px);
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-md, 6px);
  }

  .metric-num {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-lg, 18px);
    font-weight: 800;
  }

  .metric-label {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 8.5px;
    font-weight: 700;
    color: var(--text-muted, #8A8B90);
    letter-spacing: 0.5px;
  }

  .metric-critical .metric-num {
    color: var(--havoc-red, #E85C4A);
  }
  .metric-warning .metric-num {
    color: var(--warn-amber, #F5C451);
  }
  .metric-passed .metric-num {
    color: var(--recover-green, #4ADE80);
  }

  .findings-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    flex: 1;
    overflow-y: auto;
    max-height: 240px;
  }

  .section-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 2px;
  }

  .section-title {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9.5px;
    font-weight: 700;
    color: var(--text-muted, #8A8B90);
    letter-spacing: 0.5px;
  }

  .finding-count {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9px;
    color: var(--text-muted, #8A8B90);
  }

  .findings-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }

  .clean-state,
  .empty-state,
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-4, 16px);
    background: var(--bg-surface, #16171A);
    border: 1px dashed var(--border, #2A2B30);
    border-radius: var(--radius-md, 6px);
    text-align: center;
    gap: 4px;
  }

  .clean-icon {
    color: var(--recover-green, #4ADE80);
    font-size: 16px;
    font-weight: 700;
  }

  .incomplete-state {
    border-color: rgba(245, 196, 81, 0.3);
    background: rgba(245, 196, 81, 0.04);
  }

  .incomplete-icon {
    color: var(--warn-amber, #F5C451);
  }

  .clean-title {
    font-size: var(--text-xs, 11px);
    font-weight: 700;
    color: var(--text-primary, #F2F2F0);
  }

  .clean-desc {
    margin: 0;
    font-size: 10px;
    color: var(--text-muted, #8A8B90);
    line-height: 1.4;
  }

  .errored-step-list {
    margin: 6px 0 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .errored-step-list li {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9.5px;
    color: var(--warn-amber, #F5C451);
    background: rgba(245, 196, 81, 0.08);
    border: 1px solid rgba(245, 196, 81, 0.2);
    border-radius: var(--radius-sm, 4px);
    padding: 3px 8px;
    text-align: left;
  }

  .view-details-btn {
    background: none;
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-sm, 4px);
    color: var(--text-muted, #8A8B90);
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 8.5px;
    font-weight: 700;
    padding: 2px 6px;
    cursor: pointer;
    transition:
      color 0.12s ease,
      border-color 0.12s ease;
  }

  .view-details-btn:hover {
    color: var(--text-primary, #F2F2F0);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .action-section {
    margin-top: auto;
    padding-top: var(--space-2, 8px);
  }

  .action-section :global(button) {
    width: 100%;
    padding: var(--space-2, 8px) var(--space-4, 16px);
  }
</style>
