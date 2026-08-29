<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { getAllRuns, getRecoveryByRunId } from '../../../storage/repository';
  import type { ExperimentRun } from '../../../domain/run';
  import type { Recovery } from '../../../domain/recovery';

  const dispatch = createEventDispatcher<{
    navigate: { screen: 'home' | 'autopsy'; runId?: string };
  }>();

  interface HistoryItem {
    run: ExperimentRun;
    recovery?: Recovery;
  }

  let historyItems: HistoryItem[] = [];
  let loading = true;

  onMount(async () => {
    try {
      const runs = await getAllRuns();
      // Sort newest first
      runs.sort((a, b) => b.createdAt - a.createdAt);

      const items: HistoryItem[] = await Promise.all(
        runs.map(async (run) => {
          const rec = await getRecoveryByRunId(run.runId);
          return { run, recovery: rec };
        })
      );

      historyItems = items;
    } catch (e) {
      console.error('[HAVOC][history] error loading run history', e);
    } finally {
      loading = false;
    }
  });

  function formatTimeAgo(ts: number): string {
    if (!ts) return '';
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}d ago`;
  }

  function getBadgeTone(item: HistoryItem): string {
    if (item.recovery?.outcome) {
      return item.recovery.outcome.toLowerCase();
    }
    if (item.run.state === 'COMPLETED') return 'recovered';
    if (item.run.state === 'FAILED' || item.run.state === 'ABORTED' || item.run.state === 'TIMED_OUT') {
      return 'failed';
    }
    return 'unknown';
  }

  function getBadgeLabel(item: HistoryItem): string {
    if (item.recovery?.outcome) {
      return item.recovery.outcome;
    }
    return item.run.state;
  }

  function handleSelectRun(runId: string) {
    dispatch('navigate', { screen: 'autopsy', runId });
  }
</script>

<div class="history-screen" in:fade={{ duration: 200, easing: cubicOut }}>
  <!-- Top Navigation Header -->
  <header class="history-header">
    <button
      type="button"
      class="back-link"
      aria-label="Back to home screen"
      on:click={() => dispatch('navigate', { screen: 'home' })}
    >
      ← HOME
    </button>
    <div class="header-titles">
      <span class="history-title">EXPERIMENT HISTORY</span>
      <span class="history-cap">{historyItems.length} / 25 RUNS</span>
    </div>
  </header>

  <!-- History Items List -->
  <div class="history-content">
    {#if loading}
      <div class="loading-state">
        <span class="loading-text">Loading past experiment runs...</span>
      </div>
    {:else if historyItems.length === 0}
      <div class="empty-state">
        <span class="empty-icon">◻</span>
        <span class="empty-title">NO STORED EXPERIMENTS</span>
        <p class="empty-desc">Completed experiments will appear here automatically.</p>
      </div>
    {:else}
      <div class="runs-list">
        {#each historyItems as item, i (item.run.runId)}
          <button
            type="button"
            class="run-row"
            aria-label="Inspect autopsy for {item.run.definition?.name || item.run.definition?.kind}"
            in:fly={{ y: 6, duration: 180, delay: i * 35 }}
            on:click={() => handleSelectRun(item.run.runId)}
          >
            <div class="row-left">
              <span class="run-name">{item.run.definition?.name || item.run.definition?.kind}</span>
              <span class="run-target" title={item.run.target?.origin || item.run.target?.url}>
                {item.run.target?.origin || 'Top-Level'}
              </span>
            </div>

            <div class="row-right">
              <span class="run-time">{formatTimeAgo(item.run.createdAt)}</span>
              <span class="outcome-badge tone-{getBadgeTone(item)}">
                {getBadgeLabel(item)}
              </span>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .history-screen {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 12px);
    padding: var(--space-4, 16px);
    background: var(--bg-base, #0A0A0B);
    min-height: 520px;
    box-sizing: border-box;
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: var(--space-2, 8px);
    border-bottom: 1px solid var(--border, #2A2B30);
  }

  .back-link {
    background: none;
    border: none;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-xs, 11px);
    color: var(--text-muted, #8A8B90);
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease;
  }

  .back-link:hover {
    color: var(--text-primary, #F2F2F0);
  }

  .back-link:focus-visible {
    outline: 2px solid var(--havoc-red, #E85C4A);
    outline-offset: 2px;
    border-radius: var(--radius-sm, 4px);
  }

  .header-titles {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
  }

  .history-title {
    font-size: var(--text-sm, 12px);
    font-weight: 700;
    color: var(--text-primary, #F2F2F0);
    letter-spacing: 0.5px;
  }

  .history-cap {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    color: var(--text-muted, #8A8B90);
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-sm, 4px);
    padding: 1px 5px;
  }

  .history-content {
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  .loading-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-6, 24px) var(--space-3, 12px);
    background: var(--bg-surface, #16171A);
    border: 1px dashed var(--border, #2A2B30);
    border-radius: var(--radius-md, 6px);
    text-align: center;
    gap: var(--space-1, 4px);
    margin: auto 0;
  }

  .empty-icon {
    font-size: 18px;
    color: var(--text-muted, #8A8B90);
  }

  .empty-title {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-xs, 11px);
    font-weight: 700;
    color: var(--text-primary, #F2F2F0);
    letter-spacing: 0.5px;
  }

  .empty-desc {
    margin: 0;
    font-size: var(--text-xs, 11px);
    color: var(--text-muted, #8A8B90);
  }

  .runs-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    max-height: 440px;
    overflow-y: auto;
  }

  .run-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2, 8px) var(--space-3, 12px);
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-md, 6px);
    cursor: pointer;
    text-align: left;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      transform 0.08s ease;
    user-select: none;
    box-sizing: border-box;
    width: 100%;
  }

  .run-row:hover {
    background: var(--bg-surface-2, #1E1F23);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .run-row:focus-visible {
    outline: 2px solid var(--havoc-red, #E85C4A);
    outline-offset: 2px;
  }

  .run-row:active {
    transform: scale(0.985);
  }

  .row-left {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  .run-name {
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
    font-size: var(--text-sm, 12px);
    font-weight: 700;
    color: var(--text-primary, #F2F2F0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-target {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    color: var(--text-muted, #8A8B90);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-right {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    flex-shrink: 0;
  }

  .run-time {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    color: var(--text-muted, #8A8B90);
  }

  .outcome-badge {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: var(--radius-sm, 4px);
    letter-spacing: 0.3px;
  }

  .tone-recovered {
    background: rgba(74, 222, 128, 0.12);
    color: var(--recover-green, #4ADE80);
    border: 1px solid rgba(74, 222, 128, 0.3);
  }

  .tone-degraded {
    background: rgba(245, 196, 81, 0.12);
    color: var(--warn-amber, #F5C451);
    border: 1px solid rgba(245, 196, 81, 0.3);
  }

  .tone-failed {
    background: rgba(232, 92, 74, 0.12);
    color: var(--havoc-red, #E85C4A);
    border: 1px solid rgba(232, 92, 74, 0.3);
  }

  .tone-unknown {
    background: rgba(91, 143, 216, 0.12);
    color: var(--info-blue, #5B8FD8);
    border: 1px solid rgba(91, 143, 216, 0.3);
  }
</style>
