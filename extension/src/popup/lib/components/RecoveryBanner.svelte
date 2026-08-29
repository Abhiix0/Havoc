<script lang="ts">
  import type { Recovery } from '../../../domain/recovery';

  export let recovery: Recovery;

  $: outcome = recovery?.outcome ?? 'UNKNOWN';
  $: windowSec = recovery
    ? ((recovery.windowEnd - recovery.windowStart) / 1000).toFixed(1)
    : '0.0';

  function getOutcomeDesc(o: string): string {
    switch (o) {
      case 'RECOVERED':
        return 'Application restored normal operation within the observation window.';
      case 'DEGRADED':
        return 'Application maintained partial function with observable degradation.';
      case 'FAILED':
        return 'Unrecovered failure detected during the observation window.';
      default:
        return 'Insufficient observable evidence to conclude recovery state.';
    }
  }
</script>

<div class="recovery-banner outcome-{outcome.toLowerCase()}">
  <div class="banner-top">
    <div class="outcome-label-group">
      <span class="outcome-tag">EVALUATED OUTCOME</span>
      <h2 class="outcome-heading">{outcome}</h2>
    </div>
    <div class="window-badge">
      <span class="window-label">OBSERVATION WINDOW</span>
      <span class="window-val">{windowSec}s</span>
    </div>
  </div>
  <p class="outcome-desc">{getOutcomeDesc(outcome)}</p>
</div>

<style>
  .recovery-banner {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    padding: var(--space-3, 12px);
    border-radius: var(--radius-md, 6px);
    border: 1px solid;
    box-sizing: border-box;
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
  }

  .banner-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2, 8px);
  }

  .outcome-label-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .outcome-tag {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.8px;
    opacity: 0.8;
  }

  .outcome-heading {
    margin: 0;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-2xl, 20px);
    font-weight: 800;
    letter-spacing: 1px;
  }

  .window-badge {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .window-label {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 8.5px;
    letter-spacing: 0.4px;
    opacity: 0.75;
  }

  .window-val {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-sm, 12px);
    font-weight: 700;
  }

  .outcome-desc {
    margin: 0;
    font-size: var(--text-xs, 11px);
    line-height: 1.35;
    opacity: 0.9;
  }

  /* Color Tones */
  .outcome-recovered {
    background: rgba(74, 222, 128, 0.1);
    border-color: rgba(74, 222, 128, 0.4);
    color: var(--recover-green, #4ADE80);
  }
  .outcome-recovered .outcome-heading,
  .outcome-recovered .window-val {
    color: var(--recover-green, #4ADE80);
  }

  .outcome-degraded {
    background: rgba(245, 196, 81, 0.1);
    border-color: rgba(245, 196, 81, 0.4);
    color: var(--warn-amber, #F5C451);
  }
  .outcome-degraded .outcome-heading,
  .outcome-degraded .window-val {
    color: var(--warn-amber, #F5C451);
  }

  .outcome-failed {
    background: rgba(232, 92, 74, 0.1);
    border-color: rgba(232, 92, 74, 0.4);
    color: var(--havoc-red, #E85C4A);
  }
  .outcome-failed .outcome-heading,
  .outcome-failed .window-val {
    color: var(--havoc-red, #E85C4A);
  }

  .outcome-unknown {
    background: rgba(91, 143, 216, 0.1);
    border-color: rgba(91, 143, 216, 0.4);
    color: var(--info-blue, #5B8FD8);
  }
  .outcome-unknown .outcome-heading,
  .outcome-unknown .window-val {
    color: var(--info-blue, #5B8FD8);
  }
</style>
