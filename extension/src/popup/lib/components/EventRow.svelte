<script lang="ts">
  import type { HavocEvent } from '../../../domain/event';

  export let event: HavocEvent;
  export let startTime: number = 0;

  $: relTime =
    startTime > 0 && event.timestamp > 0
      ? `+${((event.timestamp - startTime) / 1000).toFixed(2)}s`
      : `#${event.sequence}`;

  function getBadgeTone(type: string): string {
    if (type === 'CHAOS_INJECTED') return 'chaos';
    if (type.includes('FAILURE') || type.includes('ERROR')) return 'danger';
    if (type.includes('OBSERVATION') || type.includes('OBSERVED')) return 'info';
    return 'neutral';
  }

  function getDetailText(e: HavocEvent): string {
    if (e.metadata?.message) return String(e.metadata.message);
    if (e.metadata?.kind) return String(e.metadata.kind);
    if (e.metadata?.selector) return String(e.metadata.selector);
    if (e.resource) return e.resource;
    return e.type;
  }
</script>

<div class="event-row">
  <span class="evt-time">{relTime}</span>
  <span class="evt-badge badge-{getBadgeTone(event.type)}">{event.type}</span>
  <span class="evt-detail" title={getDetailText(event)}>{getDetailText(event)}</span>
</div>

<style>
  .event-row {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    padding: 3px 6px;
    background: var(--bg-surface-2, #1E1F23);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-sm, 4px);
    white-space: nowrap;
    overflow: hidden;
  }

  .evt-time {
    color: var(--text-muted, #8A8B90);
    font-size: 9px;
    min-width: 42px;
  }

  .evt-badge {
    font-size: 8.5px;
    font-weight: 600;
    padding: 1px 4px;
    border-radius: 2px;
    letter-spacing: 0.2px;
  }

  .badge-chaos {
    background: rgba(232, 92, 74, 0.15);
    color: var(--havoc-red, #E85C4A);
    border: 1px solid rgba(232, 92, 74, 0.3);
  }

  .badge-danger {
    background: rgba(232, 92, 74, 0.2);
    color: var(--havoc-red, #E85C4A);
    border: 1px solid var(--havoc-red, #E85C4A);
  }

  .badge-info {
    background: rgba(91, 143, 216, 0.12);
    color: var(--info-blue, #5B8FD8);
    border: 1px solid rgba(91, 143, 216, 0.25);
  }

  .badge-neutral {
    background: var(--bg-surface, #16171A);
    color: var(--text-muted, #8A8B90);
    border: 1px solid var(--border, #2A2B30);
  }

  .evt-detail {
    color: var(--text-primary, #F2F2F0);
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 9.5px;
  }
</style>
