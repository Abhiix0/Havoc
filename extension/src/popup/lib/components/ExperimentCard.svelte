<script lang="ts">
  export let title: string;
  export let description: string;
  export let kind: string;
  export let riskTone: 'low' | 'medium' = 'low';
  export let selected: boolean = false;
</script>

<button
  type="button"
  class="experiment-card"
  class:selected
  on:click
  {...$$restProps}
>
  <div class="card-header">
    <span class="kind-tag">{kind}</span>
    <span class="risk-badge risk-{riskTone}">
      {riskTone === 'medium' ? 'MED RISK' : 'LOW RISK'}
    </span>
  </div>

  <div class="card-body">
    <span class="card-title">{title}</span>
    <p class="card-desc" title={description}>{description}</p>
  </div>
</button>

<style>
  .experiment-card {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    padding: var(--space-3, 12px);
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-md, 6px);
    text-align: left;
    cursor: pointer;
    transition:
      transform 0.08s ease,
      border-color 0.15s ease,
      background 0.15s ease;
    user-select: none;
    box-sizing: border-box;
  }

  .experiment-card:hover {
    background: var(--bg-surface-2, #1E1F23);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .experiment-card:active {
    transform: scale(0.985);
  }

  .experiment-card.selected {
    border-color: var(--havoc-red, #E85C4A);
    background: rgba(232, 92, 74, 0.06);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2, 8px);
  }

  .kind-tag {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    font-weight: 500;
    color: var(--text-muted, #8A8B90);
    letter-spacing: 0.2px;
  }

  .risk-badge {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: var(--radius-full, 9999px);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .risk-low {
    background: rgba(91, 143, 216, 0.12);
    color: var(--info-blue, #5B8FD8);
    border: 1px solid rgba(91, 143, 216, 0.25);
  }

  .risk-medium {
    background: rgba(245, 196, 81, 0.12);
    color: var(--warn-amber, #F5C451);
    border: 1px solid rgba(245, 196, 81, 0.25);
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .card-title {
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
    font-size: var(--text-base, 13px);
    font-weight: 700;
    color: var(--text-primary, #F2F2F0);
  }

  .card-desc {
    margin: 0;
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
    font-size: var(--text-xs, 11px);
    color: var(--text-muted, #8A8B90);
    line-height: 1.35;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
