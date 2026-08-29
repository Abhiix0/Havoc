<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { activeTab, currentRun, TERMINAL_STATES } from '../stores/run';
  import Robot from '../components/Robot.svelte';
  import TargetCard from '../components/TargetCard.svelte';
  import Button from '../components/Button.svelte';

  const dispatch = createEventDispatcher<{
    navigate: 'select' | 'history';
  }>();

  $: hasTerminalRun = $currentRun !== null && TERMINAL_STATES.has($currentRun.state);
  $: capabilities = $activeTab
    ? [
        { label: 'TOP-LEVEL', tone: 'neutral' as const },
        { label: 'INTERCEPT', tone: 'info' as const },
        { label: 'ONLINE', tone: 'success' as const },
      ]
    : [{ label: 'STANDBY', tone: 'neutral' as const }];
</script>

<div class="home-screen" in:fade={{ duration: 200, easing: cubicOut }}>
  <!-- Top Brand Header -->
  <header class="home-header">
    <div class="brand">
      <span class="brand-title">HAVOC</span>
      <span class="brand-ver">v1.0</span>
    </div>
    <div class="deck-tag">LAB-DECK</div>
  </header>

  <!-- Robot Mascot & Hero Heading -->
  <div class="hero-section">
    <div class="robot-container">
      <Robot state="idle" />
    </div>

    <div class="hero-text">
      <h1 class="hero-title">READY TO BREAK</h1>
      <p class="hero-subtext">Controlled chaos. Observable recovery.</p>
    </div>
  </div>

  <!-- Target Info Card -->
  <div class="target-section">
    <TargetCard
      origin={$activeTab?.origin ?? ''}
      url={$activeTab?.url ?? ''}
      {capabilities}
    />
  </div>

  <!-- Action Bar -->
  <div class="action-section">
    <Button
      variant="primary"
      disabled={!$activeTab}
      on:click={() => dispatch('navigate', 'select')}
    >
      ⚡ INITIATE HAVOC
    </Button>
  </div>

  <!-- Last Run History Link -->
  {#if hasTerminalRun}
    <footer class="home-footer">
      <button
        class="last-run-link"
        aria-label="View last experiment run in history"
        on:click={() => dispatch('navigate', 'history')}
      >
        LAST RUN [{ $currentRun?.state }] →
      </button>
    </footer>
  {/if}
</div>

<style>
  .home-screen {
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 16px);
    padding: var(--space-4, 16px);
    background: var(--bg-base, #0A0A0B);
    min-height: 520px;
    box-sizing: border-box;
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
  }

  .home-header {
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
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
    font-size: var(--text-xl, 16px);
    font-weight: 800;
    letter-spacing: 1.5px;
    color: var(--text-primary, #F2F2F0);
  }

  .brand-ver {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-xs, 11px);
    color: var(--havoc-red, #E85C4A);
    font-weight: 600;
  }

  .deck-tag {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    color: var(--text-muted, #8A8B90);
    padding: 2px 6px;
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-sm, 4px);
    letter-spacing: 0.5px;
  }

  .hero-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3, 12px);
    padding: var(--space-2, 8px) 0;
  }

  .robot-container {
    padding: var(--space-2, 8px);
  }

  .hero-text {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .hero-title {
    margin: 0;
    font-size: var(--text-2xl, 20px);
    font-weight: 800;
    letter-spacing: 0.5px;
    color: var(--text-primary, #F2F2F0);
  }

  .hero-subtext {
    margin: 0;
    font-size: var(--text-sm, 12px);
    color: var(--text-muted, #8A8B90);
  }

  .target-section {
    width: 100%;
  }

  .action-section {
    display: flex;
    flex-direction: column;
    margin-top: auto;
  }

  .action-section :global(button) {
    width: 100%;
    padding: var(--space-3, 12px) var(--space-4, 16px);
    font-size: var(--text-base, 13px);
    letter-spacing: 0.5px;
  }

  .home-footer {
    display: flex;
    justify-content: center;
    padding-top: var(--space-1, 4px);
  }

  .last-run-link {
    background: none;
    border: none;
    padding: 0;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-xs, 11px);
    color: var(--text-muted, #8A8B90);
    cursor: pointer;
    text-decoration: none;
    transition: color 0.15s ease;
  }

  .last-run-link:hover {
    color: var(--text-primary, #F2F2F0);
    text-decoration: underline;
  }

  .last-run-link:focus-visible {
    outline: 2px solid var(--havoc-red, #E85C4A);
    outline-offset: 2px;
    border-radius: var(--radius-sm, 4px);
  }
</style>
