<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { currentShipCheck, syncShipCheckState } from '../stores/ship-check';
  import type { ShipCheckStepKind, ShipCheckStepStatus } from '../../../domain/ship-check';
  import { STEP_LABELS } from '../utils/step-labels';
  import { getDeckTagLabel } from '../utils/deck-tag';
  import Robot from '../components/Robot.svelte';

  const dispatch = createEventDispatcher<{
    navigate: { screen: 'results'; shipCheckId: string };
  }>();

  const DEFAULT_STEPS: Array<{ kind: ShipCheckStepKind; status: ShipCheckStepStatus }> = [
    { kind: 'runtime_errors', status: 'PENDING' },
    { kind: 'fetch_latency', status: 'PENDING' },
    { kind: 'fetch_failure', status: 'PENDING' },
    { kind: 'input_stress', status: 'PENDING' },
    { kind: 'viewport_stress', status: 'PENDING' },
    { kind: 'secret_scan', status: 'PENDING' },
  ];

  $: steps = $currentShipCheck?.steps ?? DEFAULT_STEPS;
  $: deckTagLabel = getDeckTagLabel($currentShipCheck);

  let pollInterval: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    pollInterval = setInterval(() => {
      if ($currentShipCheck && !$currentShipCheck.completedAt) {
        syncShipCheckState().catch((e) => {
          console.warn('[HAVOC][running] fallback sync error', e);
        });
      }
    }, 2000);
  });

  onDestroy(() => {
    if (pollInterval !== undefined) {
      clearInterval(pollInterval);
      pollInterval = undefined;
    }
  });

  let navigated = false;
  $: if ($currentShipCheck?.completedAt && !navigated && $currentShipCheck.shipCheckId) {
    if (pollInterval !== undefined) {
      clearInterval(pollInterval);
      pollInterval = undefined;
    }
    navigated = true;
    setTimeout(() => {
      dispatch('navigate', {
        screen: 'results',
        shipCheckId: $currentShipCheck!.shipCheckId,
      });
    }, 400);
  }

  function getStepIcon(status: ShipCheckStepStatus): string {
    switch (status) {
      case 'DONE':
        return '✓';
      case 'RUNNING':
        return '●';
      case 'ERRORED':
        return '✕';
      case 'SKIPPED':
        return '—';
      case 'PENDING':
      default:
        return '○';
    }
  }

  function getStepTone(status: ShipCheckStepStatus): string {
    switch (status) {
      case 'DONE':
        return 'tone-done';
      case 'RUNNING':
        return 'tone-running';
      case 'ERRORED':
        return 'tone-errored';
      case 'SKIPPED':
        return 'tone-skipped';
      case 'PENDING':
      default:
        return 'tone-pending';
    }
  }
</script>

<div class="running-screen" in:fade={{ duration: 200, easing: cubicOut }}>
  <!-- Top Brand Header -->
  <header class="running-header">
    <div class="brand">
      <span class="brand-title">HAVOC</span>
      <span class="brand-badge">SHIP CHECK</span>
    </div>
    <div class="deck-tag">{deckTagLabel}</div>
  </header>

  <!-- Robot Mascot & Live Indicator -->
  <div class="hero-section">
    <div class="robot-container">
      <Robot state="running" />
    </div>

    <div class="hero-text">
      <h1 class="hero-title">EVALUATING READINESS</h1>
      <p class="hero-subtext">Executing 6-step automated diagnostic pipeline...</p>
    </div>
  </div>

  <!-- Checklist Card -->
  <div class="checklist-card">
    {#each steps as step, i (step.kind)}
      <div
        class="step-row {getStepTone(step.status)}"
        in:fly={{ y: 4, duration: 150, delay: i * 30 }}
      >
        <span class="step-icon">
          {#if step.status === 'RUNNING'}
            <span class="spinner" />
          {:else}
            {getStepIcon(step.status)}
          {/if}
        </span>
        <span class="step-label">{STEP_LABELS[step.kind]}</span>
        <span class="step-status">{step.status}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .running-screen {
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 16px);
    padding: var(--space-4, 16px);
    background: var(--bg-base, #0A0A0B);
    min-height: 520px;
    box-sizing: border-box;
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
  }

  .running-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: var(--space-2, 8px);
    border-bottom: 1px solid var(--border, #2A2B30);
  }

  .brand {
    display: flex;
    align-items: baseline;
    gap: var(--space-2, 8px);
  }

  .brand-title {
    font-size: var(--text-xl, 16px);
    font-weight: 800;
    letter-spacing: 1.5px;
    color: var(--text-primary, #F2F2F0);
  }

  .brand-badge {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-xs, 11px);
    color: var(--havoc-red, #E85C4A);
    font-weight: 700;
  }

  .deck-tag {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    color: var(--warn-amber, #F5C451);
    padding: 2px 6px;
    background: rgba(245, 196, 81, 0.1);
    border: 1px solid rgba(245, 196, 81, 0.3);
    border-radius: var(--radius-sm, 4px);
    letter-spacing: 0.5px;
    font-weight: 700;
  }

  .hero-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2, 8px);
    padding: var(--space-1, 4px) 0;
  }

  .robot-container {
    padding: 0;
  }

  .hero-text {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hero-title {
    margin: 0;
    font-size: var(--text-lg, 16px);
    font-weight: 800;
    letter-spacing: 0.5px;
    color: var(--text-primary, #F2F2F0);
  }

  .hero-subtext {
    margin: 0;
    font-size: var(--text-xs, 11px);
    color: var(--text-muted, #8A8B90);
  }

  .checklist-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-md, 6px);
    padding: var(--space-3, 12px);
  }

  .step-row {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    padding: 6px 8px;
    border-radius: var(--radius-sm, 4px);
    font-size: var(--text-xs, 11px);
    transition: background 0.15s ease;
  }

  .step-icon {
    width: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-weight: 700;
  }

  .step-label {
    flex: 1;
    font-weight: 500;
    color: var(--text-primary, #F2F2F0);
  }

  .step-status {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }

  .tone-done {
    color: var(--recover-green, #4ADE80);
  }
  .tone-done .step-label {
    color: var(--text-primary, #F2F2F0);
  }

  .tone-running {
    background: rgba(245, 196, 81, 0.08);
    color: var(--warn-amber, #F5C451);
  }
  .tone-running .step-label {
    color: var(--warn-amber, #F5C451);
    font-weight: 700;
  }

  .tone-errored {
    color: var(--havoc-red, #E85C4A);
  }

  .tone-skipped,
  .tone-pending {
    color: var(--text-muted, #8A8B90);
    opacity: 0.6;
  }

  .spinner {
    width: 8px;
    height: 8px;
    border: 1.5px solid rgba(245, 196, 81, 0.3);
    border-top-color: var(--warn-amber, #F5C451);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
