<script lang="ts">
  import { onMount } from 'svelte';
  import type { Finding } from '../../../domain/finding';

  export let finding: Finding;

  let meterWidth = 0;

  onMount(() => {
    // Trigger smooth transition on mount
    const t = setTimeout(() => {
      meterWidth = Math.round((finding.confidence ?? 0) * 100);
    }, 80);
    return () => clearTimeout(t);
  });

  $: severity = finding.severity ?? 'MEDIUM';
  $: confidencePct = Math.round((finding.confidence ?? 0) * 100);
</script>

<div class="finding-card sev-{severity.toLowerCase()}">
  <div class="finding-header">
    <span class="sev-badge sev-badge-{severity.toLowerCase()}">
      [{severity} SEVERITY]
    </span>
    <div class="confidence-meter-group">
      <span class="conf-text">CONFIDENCE {confidencePct}%</span>
      <div class="meter-track">
        <div
          class="meter-fill sev-fill-{severity.toLowerCase()}"
          style="width: {meterWidth}%;"
        />
      </div>
    </div>
  </div>

  <p class="finding-desc">{finding.description}</p>

  <footer class="finding-footer">
    <span class="evidence-tag">EVIDENCE: {finding.evidenceIds?.length ?? 0} RECORDS</span>
    {#if finding.recoveryId}
      <span class="rec-id">REC: {finding.recoveryId.slice(0, 8)}</span>
    {/if}
  </footer>
</div>

<style>
  .finding-card {
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-left: 3px solid var(--border, #2A2B30);
    border-radius: var(--radius-md, 6px);
    padding: var(--space-3, 12px);
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    box-sizing: border-box;
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
  }

  .sev-high {
    border-left-color: var(--havoc-red, #E85C4A);
  }
  .sev-medium {
    border-left-color: var(--warn-amber, #F5C451);
  }
  .sev-low {
    border-left-color: var(--info-blue, #5B8FD8);
  }

  .finding-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2, 8px);
  }

  .sev-badge {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    padding: 1px 5px;
    border-radius: var(--radius-sm, 4px);
  }

  .sev-badge-high {
    background: rgba(232, 92, 74, 0.15);
    color: var(--havoc-red, #E85C4A);
    border: 1px solid rgba(232, 92, 74, 0.3);
  }
  .sev-badge-medium {
    background: rgba(245, 196, 81, 0.15);
    color: var(--warn-amber, #F5C451);
    border: 1px solid rgba(245, 196, 81, 0.3);
  }
  .sev-badge-low {
    background: rgba(91, 143, 216, 0.15);
    color: var(--info-blue, #5B8FD8);
    border: 1px solid rgba(91, 143, 216, 0.3);
  }

  .confidence-meter-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .conf-text {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9px;
    color: var(--text-muted, #8A8B90);
  }

  .meter-track {
    width: 48px;
    height: 4px;
    background: var(--bg-surface-2, #1E1F23);
    border: 1px solid var(--border, #2A2B30);
    border-radius: 2px;
    overflow: hidden;
  }

  .meter-fill {
    height: 100%;
    transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .sev-fill-high {
    background: var(--havoc-red, #E85C4A);
  }
  .sev-fill-medium {
    background: var(--warn-amber, #F5C451);
  }
  .sev-fill-low {
    background: var(--info-blue, #5B8FD8);
  }

  .finding-desc {
    margin: 0;
    font-size: var(--text-xs, 11px);
    color: var(--text-primary, #F2F2F0);
    line-height: 1.45;
  }

  .finding-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9px;
    color: var(--text-muted, #8A8B90);
  }
</style>
