<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import type { ExperimentKind } from '../../../domain/experiment';
  import ExperimentCard from '../components/ExperimentCard.svelte';

  export let selectedKind: ExperimentKind | string = 'fetch_latency';

  const dispatch = createEventDispatcher<{
    navigate: { screen: 'home' | 'configure'; kind?: ExperimentKind };
  }>();

  interface ExperimentOption {
    kind: ExperimentKind;
    title: string;
    description: string;
    riskTone: 'low' | 'medium';
    category: 'NETWORK' | 'INTERACTION';
    delayMs: number;
  }

  const EXPERIMENTS: ExperimentOption[] = [
    {
      category: 'NETWORK',
      kind: 'fetch_latency',
      title: 'Fetch Latency',
      description: 'Delay outgoing requests to test loading states',
      riskTone: 'low',
      delayMs: 40,
    },
    {
      category: 'NETWORK',
      kind: 'fetch_failure',
      title: 'Fetch Failure',
      description: 'Force requests to fail via transport error, HTTP error, or timeout',
      riskTone: 'medium',
      delayMs: 90,
    },
    {
      category: 'INTERACTION',
      kind: 'input_stress',
      title: 'Passive Input Stress',
      description: 'Populate form fields with edge-case values without submitting',
      riskTone: 'low',
      delayMs: 140,
    },
    {
      category: 'INTERACTION',
      kind: 'viewport_stress',
      title: 'Viewport Stress',
      description: 'Apply layout/CSS constraints to test responsive behavior',
      riskTone: 'low',
      delayMs: 190,
    },
  ];

  function handleSelect(kind: ExperimentKind) {
    dispatch('navigate', { screen: 'configure', kind });
  }
</script>

<div class="select-screen" in:fade={{ duration: 200, easing: cubicOut }} out:fade={{ duration: 150, easing: cubicOut }}>
  <header class="select-header">
    <button
      type="button"
      class="back-link"
      on:click={() => dispatch('navigate', { screen: 'home' })}
    >
      ← BACK
    </button>
    <div class="header-titles">
      <span class="select-title">SELECT EXPERIMENT</span>
      <span class="select-step">STEP 1/2</span>
    </div>
  </header>

  <div class="cards-list">
    <!-- Network Section -->
    <div class="section-group">
      <span class="group-label">NETWORK</span>
      <div class="group-cards">
        {#each EXPERIMENTS.filter((e) => e.category === 'NETWORK') as exp}
          <div in:fly={{ y: 8, duration: 200, delay: exp.delayMs }}>
            <ExperimentCard
              title={exp.title}
              description={exp.description}
              kind={exp.kind}
              riskTone={exp.riskTone}
              selected={selectedKind === exp.kind}
              on:click={() => handleSelect(exp.kind)}
            />
          </div>
        {/each}
      </div>
    </div>

    <!-- Interaction Section -->
    <div class="section-group">
      <span class="group-label">INTERACTION</span>
      <div class="group-cards">
        {#each EXPERIMENTS.filter((e) => e.category === 'INTERACTION') as exp}
          <div in:fly={{ y: 8, duration: 200, delay: exp.delayMs }}>
            <ExperimentCard
              title={exp.title}
              description={exp.description}
              kind={exp.kind}
              riskTone={exp.riskTone}
              selected={selectedKind === exp.kind}
              on:click={() => handleSelect(exp.kind)}
            />
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .select-screen {
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 16px);
    padding: var(--space-4, 16px);
    background: var(--bg-base, #0A0A0B);
    min-height: 520px;
    box-sizing: border-box;
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
  }

  .select-header {
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

  .select-title {
    font-size: var(--text-sm, 12px);
    font-weight: 700;
    color: var(--text-primary, #F2F2F0);
    letter-spacing: 0.5px;
  }

  .select-step {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    color: var(--text-muted, #8A8B90);
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-sm, 4px);
    padding: 1px 5px;
  }

  .cards-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 16px);
  }

  .section-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }

  .group-label {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted, #8A8B90);
    letter-spacing: 0.8px;
  }

  .group-cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }
</style>
