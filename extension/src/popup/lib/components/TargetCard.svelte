<script lang="ts">
  import CapabilityBadge from './CapabilityBadge.svelte';

  export let origin: string = '';
  export let url: string = '';
  export let capabilities: Array<{ label: string; tone?: 'neutral' | 'info' | 'success' }> = [];
</script>

<div class="target-card">
  <div class="target-header">
    <span class="target-label">TARGET</span>
    {#if capabilities.length > 0}
      <div class="target-caps">
        {#each capabilities as cap}
          <CapabilityBadge label={cap.label} tone={cap.tone ?? 'neutral'} />
        {/each}
      </div>
    {/if}
  </div>

  <div class="target-body">
    <div class="target-origin" title={origin || url}>
      {origin || 'No active target'}
    </div>
    {#if url && url !== origin}
      <div class="target-url" title={url}>
        {url}
      </div>
    {/if}
  </div>
</div>

<style>
  .target-card {
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-md, 6px);
    padding: var(--space-3, 12px);
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }

  .target-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2, 8px);
  }

  .target-label {
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
    font-size: var(--text-xs, 11px);
    font-weight: 600;
    color: var(--text-muted, #8A8B90);
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .target-caps {
    display: flex;
    align-items: center;
    gap: var(--space-1, 4px);
    flex-wrap: wrap;
  }

  .target-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .target-origin {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-sm, 12px);
    font-weight: 500;
    color: var(--text-primary, #F2F2F0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .target-url {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-xs, 11px);
    color: var(--text-muted, #8A8B90);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.8;
  }
</style>
