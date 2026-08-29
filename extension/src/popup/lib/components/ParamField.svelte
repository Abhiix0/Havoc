<script lang="ts">
  export let label: string;
  export let description: string = '';
  export let layout: 'vertical' | 'horizontal' = 'vertical';
</script>

<div class="param-field layout-{layout}">
  <div class="label-row">
    <span class="field-label">{label}</span>
    {#if description}
      <span class="field-desc">{description}</span>
    {/if}
  </div>
  <div class="field-control">
    <slot />
  </div>
</div>

<style>
  .param-field {
    display: flex;
    gap: var(--space-2, 8px);
    width: 100%;
    box-sizing: border-box;
  }

  .layout-vertical {
    flex-direction: column;
  }

  .layout-horizontal {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .label-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .field-label {
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
    font-size: var(--text-xs, 11px);
    font-weight: 600;
    color: var(--text-primary, #F2F2F0);
    letter-spacing: 0.3px;
    text-transform: uppercase;
  }

  .field-desc {
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
    font-size: 10px;
    color: var(--text-muted, #8A8B90);
  }

  .field-control {
    width: 100%;
  }

  .layout-horizontal .field-control {
    width: auto;
  }

  /* Global input/select token styling within controls */
  .field-control :global(input[type='number']),
  .field-control :global(select) {
    width: 100%;
    background: var(--bg-surface-2, #1E1F23);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-sm, 4px);
    color: var(--text-primary, #F2F2F0);
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-sm, 12px);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    box-sizing: border-box;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }

  .field-control :global(input[type='number']:focus),
  .field-control :global(select:focus) {
    outline: none;
    border-color: var(--havoc-red, #E85C4A);
    background: var(--bg-surface, #16171A);
  }

  .field-control :global(select) {
    cursor: pointer;
  }
</style>
