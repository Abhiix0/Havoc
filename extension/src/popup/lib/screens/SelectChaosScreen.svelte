<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Button from '../components/Button.svelte';

  const dispatch = createEventDispatcher<{
    navigate: string;
  }>();
</script>

<div class="screen-wrap">
  <header class="screen-header">
    <button class="back-btn" on:click={() => dispatch('navigate', 'home')}>← BACK</button>
    <span class="screen-title">SELECT EXPERIMENT</span>
  </header>

  <div class="screen-body">
    <p class="placeholder-text">Select Chaos Screen [Phase 3]</p>
  </div>
</div>

<style>
  .screen-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 16px);
    padding: var(--space-4, 16px);
    background: var(--bg-base, #0A0A0B);
    min-height: 520px;
    box-sizing: border-box;
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
  }

  .screen-header {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
    padding-bottom: var(--space-2, 8px);
    border-bottom: 1px solid var(--border, #2A2B30);
  }

  .back-btn {
    background: none;
    border: none;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-xs, 11px);
    color: var(--text-muted, #8A8B90);
    cursor: pointer;
    padding: 0;
  }

  .back-btn:hover {
    color: var(--text-primary, #F2F2F0);
  }

  .screen-title {
    font-size: var(--text-sm, 12px);
    font-weight: 700;
    color: var(--text-primary, #F2F2F0);
    letter-spacing: 0.5px;
  }

  .screen-body {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-xs, 11px);
    color: var(--text-muted, #8A8B90);
  }
</style>
