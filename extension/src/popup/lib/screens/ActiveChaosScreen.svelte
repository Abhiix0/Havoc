<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { currentRun, aborting, handleAbortRun } from '../stores/run';
  import Button from '../components/Button.svelte';

  const dispatch = createEventDispatcher<{
    navigate: string;
  }>();
</script>

<div class="active-screen">
  <header class="active-header">
    <span class="active-title">ACTIVE CHAOS</span>
    <span class="run-badge">{$currentRun?.state ?? 'ACTIVE'}</span>
  </header>

  <div class="active-content">
    <p class="run-id">RUN ID: <code>{$currentRun?.runId ?? 'UNKNOWN'}</code></p>
    <p class="run-kind">KIND: <code>{$currentRun?.definition.kind ?? ''}</code></p>
  </div>

  <div class="active-actions">
    <Button
      variant="danger"
      disabled={$aborting}
      on:click={handleAbortRun}
    >
      {$aborting ? 'ABORTING...' : 'ABORT EXPERIMENT'}
    </Button>
  </div>
</div>

<style>
  .active-screen {
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 16px);
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

  .active-title {
    font-size: var(--text-base, 13px);
    font-weight: 700;
    color: var(--havoc-red, #E85C4A);
    letter-spacing: 1px;
  }

  .run-badge {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-xs, 11px);
    color: var(--warn-amber, #F5C451);
    background: var(--bg-surface-2, #1E1F23);
    padding: 2px 6px;
    border-radius: var(--radius-sm, 4px);
    border: 1px solid var(--border, #2A2B30);
  }

  .active-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-xs, 11px);
    color: var(--text-muted, #8A8B90);
  }

  code {
    color: var(--text-primary, #F2F2F0);
  }

  .active-actions {
    margin-top: auto;
    width: 100%;
  }

  .active-actions :global(button) {
    width: 100%;
  }
</style>
