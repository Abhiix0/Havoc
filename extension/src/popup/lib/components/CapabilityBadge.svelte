<script lang="ts">
  export let label: string;
  export let tone: 'neutral' | 'info' | 'success' = 'neutral';
</script>

<span class="cap-badge cap-badge-{tone}">
  {label}
</span>

<style>
  .cap-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    font-weight: 500;
    line-height: 1;
    padding: 2px 6px;
    border-radius: var(--radius-full, 9999px);
    border: 1px solid transparent;
    letter-spacing: 0.2px;
    white-space: nowrap;
    text-transform: uppercase;
  }

  .cap-badge-neutral {
    background: var(--bg-surface-2, #1E1F23);
    color: var(--text-muted, #8A8B90);
    border-color: var(--border, #2A2B30);
  }

  .cap-badge-info {
    background: rgba(91, 143, 216, 0.12);
    color: var(--info-blue, #5B8FD8);
    border-color: rgba(91, 143, 216, 0.3);
  }

  .cap-badge-success {
    background: rgba(74, 222, 128, 0.12);
    color: var(--recover-green, #4ADE80);
    border-color: rgba(74, 222, 128, 0.3);
  }
</style>
