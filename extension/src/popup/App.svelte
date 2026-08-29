<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    createGetCurrentRunMessage,
    createCreateRunMessage,
  } from '../messaging/messages';
  import {
    isCurrentRunResponseMessage,
    isCreateRunResponseMessage,
    isRunStateUpdateMessage,
  } from '../messaging/validator';
  import type { ExperimentRun } from '../domain/run';
  import type { ExperimentDefinition } from '../domain/experiment';

  // ---------------------------------------------------------------------------
  // State — popup holds NO authoritative state, only a display mirror.
  // ---------------------------------------------------------------------------
  let run: ExperimentRun | null = null;
  let loading = true;
  let error: string | null = null;
  let starting = false;

  // ---------------------------------------------------------------------------
  // Hardcoded test definition for Phase 3 (no real injection yet).
  // ---------------------------------------------------------------------------
  const TEST_DEFINITION: ExperimentDefinition = {
    id: crypto.randomUUID(),
    kind: 'fetch_latency',
    name: 'Phase 3 smoke test',
    description: 'Exercises the run lifecycle without any chaos injection.',
    params: {},
  };

  // ---------------------------------------------------------------------------
  // Fetch current run on mount.
  // ---------------------------------------------------------------------------
  onMount(async () => {
    try {
      const response: unknown = await chrome.runtime.sendMessage(createGetCurrentRunMessage());
      if (isCurrentRunResponseMessage(response)) {
        run = response.run;
      } else {
        error = 'Unexpected response from service worker';
      }
    } catch (e) {
      error = 'Could not reach service worker';
      console.error('[HAVOC][popup] mount error', e);
    } finally {
      loading = false;
    }

    // Subscribe to live state updates pushed by the coordinator.
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  });

  onDestroy(() => {
    chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  });

  // ---------------------------------------------------------------------------
  // Runtime message handler — receives RUN_STATE_UPDATE from the coordinator.
  // ---------------------------------------------------------------------------
  function handleRuntimeMessage(message: unknown): void {
    if (isRunStateUpdateMessage(message)) {
      run = message.run;
      // If a run just completed/failed, clear starting flag.
      if (run === null) starting = false;
    }
  }

  // ---------------------------------------------------------------------------
  // CREATE_RUN — popup sends the request, coordinator drives the lifecycle.
  // ---------------------------------------------------------------------------
  async function createRun(): Promise<void> {
    if (starting) return;
    starting = true;
    error = null;

    try {
      const response: unknown = await chrome.runtime.sendMessage(
        createCreateRunMessage(TEST_DEFINITION)
      );

      if (isCreateRunResponseMessage(response)) {
        if (response.error) {
          error = response.error;
          starting = false;
        } else {
          // Run started — initial state comes back in response.run,
          // subsequent transitions arrive via RUN_STATE_UPDATE.
          run = response.run ?? null;
        }
      } else {
        error = 'Unexpected response from service worker';
        starting = false;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not reach service worker';
      starting = false;
      console.error('[HAVOC][popup] createRun error', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Derived display values.
  // ---------------------------------------------------------------------------
  const TERMINAL = new Set([
    'COMPLETED', 'FAILED', 'ABORTED', 'TIMED_OUT', 'CLEANUP_FAILED', 'TARGET_LOST',
  ]);

  $: isRunActive = run !== null && !TERMINAL.has(run.state);
  $: canStart    = !loading && !isRunActive && !starting;

  $: statusLabel = loading
    ? 'loading…'
    : error !== null
      ? `error: ${error}`
      : run === null
        ? 'no active run'
        : run.state;

  $: stateClass = run === null
    ? 'idle'
    : run.state === 'COMPLETED'     ? 'done'
    : run.state === 'CLEANUP_FAILED'? 'warn'
    : TERMINAL.has(run.state)       ? 'fail'
    : 'active';
</script>

<main>
  <h1>HAVOC</h1>

  <p class="status {stateClass}">
    {statusLabel}
  </p>

  {#if run !== null}
    <dl class="run-meta">
      <dt>run</dt>        <dd>{run.runId.slice(0, 8)}…</dd>
      <dt>state</dt>      <dd>{run.state}</dd>
      <dt>experiment</dt> <dd>{run.definition.name}</dd>
      <dt>target</dt>     <dd>tab {run.target.tabId}</dd>
      <dt>origin</dt>     <dd>{run.target.origin}</dd>
    </dl>
  {/if}

  <div class="actions">
    <button
      on:click={createRun}
      disabled={!canStart}
      class:spinning={starting && !isRunActive}
    >
      {#if starting && !isRunActive}
        starting…
      {:else if isRunActive}
        running…
      {:else}
        start run
      {/if}
    </button>
  </div>
</main>

<style>
  main { padding: 12px; min-width: 240px; font-family: monospace; }

  h1 {
    font-size: 13px;
    letter-spacing: 3px;
    margin: 0 0 8px;
    text-transform: uppercase;
  }

  .status {
    font-size: 12px;
    margin: 0 0 10px;
    padding: 3px 6px;
    border-radius: 3px;
    background: #1a1a1a;
    color: #888;
  }
  .status.active  { color: #7dd3fc; background: #0c2233; }
  .status.done    { color: #86efac; background: #0b2417; }
  .status.fail    { color: #fca5a5; background: #2d0b0b; }
  .status.warn    { color: #fde68a; background: #2d1f00; }

  dl {
    font-size: 11px;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 8px;
    margin: 0 0 10px;
  }
  dt { opacity: 0.45; text-align: right; }
  dd { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .actions { display: flex; gap: 6px; }

  button {
    flex: 1;
    padding: 5px 10px;
    font-size: 11px;
    font-family: monospace;
    cursor: pointer;
    background: #2a2a2a;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 3px;
    transition: background 0.15s;
  }
  button:disabled { opacity: 0.4; cursor: default; }
  button:not(:disabled):hover { background: #3a3a3a; }
  button.spinning { color: #7dd3fc; }
</style>
