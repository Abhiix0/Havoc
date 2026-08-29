<script lang="ts">
  export let variant: 'primary' | 'ghost' | 'danger' = 'primary';
  export let disabled: boolean = false;
  export let type: 'button' | 'submit' | 'reset' = 'button';
</script>

<button
  class="btn btn-{variant}"
  {disabled}
  {type}
  on:click
  {...$$restProps}
>
  <slot />
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2, 8px);
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
    font-size: var(--text-sm, 12px);
    font-weight: 600;
    line-height: 1;
    padding: var(--space-2, 8px) var(--space-4, 16px);
    border-radius: var(--radius-md, 6px);
    border: 1px solid transparent;
    cursor: pointer;
    user-select: none;
    transition: transform 0.08s ease, background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
    white-space: nowrap;
    text-decoration: none;
  }

  .btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  /* Primary variant */
  .btn-primary {
    background: var(--havoc-red, #E85C4A);
    color: var(--text-primary, #F2F2F0);
    border-color: rgba(255, 255, 255, 0.1);
  }
  .btn-primary:hover:not(:disabled) {
    background: #f06a58;
  }

  /* Ghost variant */
  .btn-ghost {
    background: transparent;
    color: var(--text-muted, #8A8B90);
    border-color: var(--border, #2A2B30);
  }
  .btn-ghost:hover:not(:disabled) {
    background: var(--bg-surface, #16171A);
    color: var(--text-primary, #F2F2F0);
    border-color: rgba(255, 255, 255, 0.15);
  }

  /* Danger variant */
  .btn-danger {
    background: rgba(232, 92, 74, 0.15);
    color: var(--havoc-red, #E85C4A);
    border-color: rgba(232, 92, 74, 0.4);
  }
  .btn-danger:hover:not(:disabled) {
    background: var(--havoc-red, #E85C4A);
    color: var(--text-primary, #F2F2F0);
  }

  /* Disabled state */
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    pointer-events: none;
  }
</style>
