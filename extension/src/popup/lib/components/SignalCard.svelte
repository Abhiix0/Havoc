<script lang="ts">
  import type { Signal } from '../../../domain/signal';
  import { getSignalPlausibilityTag } from '../utils/plausibility';

  export let signal: Signal;

  $: confidencePct = Math.round((signal.confidence ?? 0) * 100);
  $: plausibilityTag = getSignalPlausibilityTag(signal);
</script>

<div class="signal-card">
  <div class="sig-header">
    <div class="sig-title-group">
      <span class="sig-type">{signal.type}</span>
      {#if plausibilityTag}
        <span class="sig-plausibility tone-{plausibilityTag.tone}">
          {plausibilityTag.label}
        </span>
      {/if}
    </div>
    <span class="sig-conf-badge">{confidencePct}% CONF</span>
  </div>
  <div class="sig-meter">
    <div class="sig-meter-fill" style="width: {confidencePct}%;" />
  </div>
  {#if signal.derivedFrom && signal.derivedFrom.length > 0}
    <div class="sig-footer">
      <span class="sig-ref-label">DERIVED FROM:</span>
      {#each signal.derivedFrom as refId}
        <span class="ref-tag">#{refId.slice(0, 8)}</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .signal-card {
    background: var(--bg-surface-2, #1E1F23);
    border: 1px solid var(--border, #2A2B30);
    border-left: 3px solid var(--warn-amber, #F5C451);
    border-radius: var(--radius-sm, 4px);
    padding: var(--space-2, 8px);
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
  }

  .sig-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sig-title-group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .sig-type {
    font-size: 10px;
    font-weight: 700;
    color: var(--text-primary, #F2F2F0);
  }

  .sig-plausibility {
    font-size: 8px;
    font-weight: 600;
    padding: 1px 4px;
    border-radius: 2px;
    letter-spacing: 0.2px;
  }

  .tone-chaos {
    background: rgba(232, 92, 74, 0.15);
    color: var(--havoc-red, #E85C4A);
    border: 1px solid rgba(232, 92, 74, 0.3);
  }

  .tone-ambient {
    background: rgba(245, 196, 81, 0.15);
    color: var(--warn-amber, #F5C451);
    border: 1px solid rgba(245, 196, 81, 0.3);
  }

  .sig-conf-badge {
    font-size: 9px;
    color: var(--warn-amber, #F5C451);
    background: rgba(245, 196, 81, 0.1);
    padding: 1px 4px;
    border-radius: 2px;
  }

  .sig-meter {
    height: 3px;
    background: var(--bg-surface, #16171A);
    border-radius: 1.5px;
    overflow: hidden;
  }

  .sig-meter-fill {
    height: 100%;
    background: var(--warn-amber, #F5C451);
  }

  .sig-footer {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 8.5px;
    color: var(--text-muted, #8A8B90);
    flex-wrap: wrap;
    margin-top: 2px;
  }

  .ref-tag {
    background: var(--bg-surface, #16171A);
    color: var(--text-primary, #F2F2F0);
    padding: 0 4px;
    border-radius: 2px;
    border: 1px solid var(--border, #2A2B30);
  }
</style>
