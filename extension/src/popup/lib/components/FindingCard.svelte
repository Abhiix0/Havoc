<script lang="ts">
  import { onMount } from 'svelte';
  import type { Finding } from '../../../domain/finding';
  import type { Remediation } from '../../../domain/remediation';
  import FixPromptBox from './FixPromptBox.svelte';

  export let finding: Finding;
  export let remediation: Remediation | undefined = undefined;
  export let summaryOnly: boolean = false;

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

<div class="finding-card sev-{severity.toLowerCase()}" class:summary-card={summaryOnly}>
  {#if summaryOnly}
    <div class="summary-header">
      <div class="remediation-title-row">
        <span class="sev-badge sev-badge-{severity.toLowerCase()}">
          [{severity}]
        </span>
        <h4 class="remediation-title">{remediation?.title ?? finding.checkKind ?? 'Finding'}</h4>
      </div>
      <slot name="action" />
    </div>
    <p class="summary-desc">{remediation?.whatHappened ?? finding.description}</p>
  {:else if remediation}
    <div class="remediation-header">
      <div class="remediation-title-row">
        <span class="sev-badge sev-badge-{severity.toLowerCase()}">
          [{severity} SEVERITY]
        </span>
        <h4 class="remediation-title">{remediation.title}</h4>
      </div>
    </div>

    <div class="remediation-body">
      <div class="rem-section">
        <span class="rem-label">WHAT HAPPENED</span>
        <p class="rem-text">{remediation.whatHappened}</p>
      </div>

      <div class="rem-section">
        <span class="rem-label">WHY IT MATTERS</span>
        <p class="rem-text">{remediation.whyItMatters}</p>
      </div>

      <div class="rem-section">
        <span class="rem-label">HOW TO FIX IT</span>
        <ol class="rem-list">
          {#each remediation.howToFix as step}
            <li>{step}</li>
          {/each}
        </ol>
      </div>

      <FixPromptBox fixPrompt={remediation.fixPrompt} />
    </div>

    <details class="tech-details">
      <summary class="tech-summary">Technical evidence</summary>
      <div class="tech-content">
        <div class="finding-header">
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
    </details>
  {:else}
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
  {/if}
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

  .remediation-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .remediation-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .remediation-title {
    margin: 0;
    font-size: var(--text-sm, 13px);
    font-weight: 600;
    color: var(--text-primary, #F2F2F0);
  }

  .remediation-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 4px;
  }

  .rem-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .rem-label {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--text-muted, #8A8B90);
  }

  .rem-text {
    margin: 0;
    font-size: var(--text-xs, 11px);
    color: var(--text-primary, #F2F2F0);
    line-height: 1.45;
  }

  .rem-list {
    margin: 0;
    padding-left: 16px;
    font-size: var(--text-xs, 11px);
    color: var(--text-primary, #F2F2F0);
    line-height: 1.45;
  }

  .rem-list li {
    margin-bottom: 2px;
  }

  .tech-details {
    margin-top: 8px;
    border-top: 1px dashed var(--border, #2A2B30);
    padding-top: 6px;
  }

  .tech-summary {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9px;
    color: var(--text-muted, #8A8B90);
    cursor: pointer;
    user-select: none;
  }

  .tech-summary:hover {
    color: var(--text-primary, #F2F2F0);
  }

  .tech-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    padding-top: 8px;
  }

  .summary-card {
    padding: var(--space-2, 8px) var(--space-3, 12px);
    gap: 4px;
  }

  .summary-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .summary-desc {
    margin: 0;
    font-size: var(--text-xs, 11px);
    color: var(--text-muted, #8A8B90);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
</style>
