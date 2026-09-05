<script lang="ts">
  import type { SyncState } from '../../../domain/ship-check';
  import { syncStatusLabel } from '../utils/sync-status-label';

  export let syncState: SyncState | undefined = undefined;

  $: status = syncStatusLabel(syncState);
</script>

<span class="sync-status-tag tone-{status.tone}">
  {#if status.tone === 'progress'}
    <span class="sync-spinner" aria-hidden="true" />
  {/if}
  <span class="sync-text">{status.text}</span>
</span>

<style>
  .sync-status-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 8.5px;
    font-weight: 700;
    line-height: 1;
    padding: 2px 5px;
    border-radius: var(--radius-sm, 4px);
    border: 1px solid transparent;
    letter-spacing: 0.3px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .tone-muted {
    background: var(--bg-surface, #16171A);
    color: var(--text-muted, #8A8B90);
    border-color: var(--border, #2A2B30);
  }

  .tone-progress {
    background: rgba(91, 143, 216, 0.12);
    color: var(--info-blue, #5B8FD8);
    border-color: rgba(91, 143, 216, 0.3);
  }

  .tone-success {
    background: rgba(74, 222, 128, 0.12);
    color: var(--recover-green, #4ADE80);
    border-color: rgba(74, 222, 128, 0.3);
  }

  .tone-warning {
    background: rgba(245, 196, 81, 0.12);
    color: var(--warn-amber, #F5C451);
    border-color: rgba(245, 196, 81, 0.3);
  }

  .sync-spinner {
    width: 6px;
    height: 6px;
    border: 1px solid rgba(91, 143, 216, 0.3);
    border-top-color: var(--info-blue, #5B8FD8);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
