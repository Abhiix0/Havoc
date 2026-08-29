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
  import type { FetchFailureMode } from '../messaging/messages';

  // ---------------------------------------------------------------------------
  // Display state
  // ---------------------------------------------------------------------------
  let run: ExperimentRun | null = null;
  let loading = true;
  let error: string | null = null;
  let starting = false;

  // ---------------------------------------------------------------------------
  // Experiment configuration
  // ---------------------------------------------------------------------------
  type KindOption = 'fetch_latency' | 'fetch_failure';
  let selectedKind: KindOption = 'fetch_latency';

  // fetch_latency params
  let delayMs = 800;
  let durationMs = 5000;

  // fetch_failure params
  let failureMode: FetchFailureMode = 'transport_error';
  let syntheticStatus = 503;
  let timeoutMs = 8000;

  function buildDefinition(): ExperimentDefinition {
    const base = {
      id: crypto.randomUUID(),
      name: selectedKind === 'fetch_latency'
        ? `Fetch latency +${delayMs}ms`
        : `Fetch failure (${failureMode})`,
      description: 'Phase 4 chaos experiment',
      durationMs,
    };

    if (selectedKind === 'fetch_latency') {
      return {
        ...base,
        kind: 'fetch_latency' as const,
        params: { delayMs, durationMs },
      };
    } else {
      return {
        ...base,
        kind: 'fetch_failure' as const,
        params: {
          mode: failureMode,
          durationMs,
          ...(failureMode === 'synthetic_http_error' && { syntheticStatus }),
          ...(failureMode === 'synthetic_timeout'    && { timeoutMs }),
        },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Mount: fetch current state + subscribe to updates
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

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  });

  onDestroy(() => {
    chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  });

  function handleRuntimeMessage(message: unknown): void {
    if (isRunStateUpdateMessage(message)) {
      run = message.run;
      if (run === null) starting = false;
    }
  }

  // ---------------------------------------------------------------------------
  // CREATE_RUN
  // ---------------------------------------------------------------------------
  async function createRun(): Promise<void> {
    if (starting || isRunActive) return;
    starting = true;
    error = null;

    try {
      const response: unknown = await chrome.runtime.sendMessage(
        createCreateRunMessage(buildDefinition())
      );

      if (isCreateRunResponseMessage(response)) {
        if (response.error) {
          error = response.error;
          starting = false;
        } else {
          run = response.run ?? null;
        }
      } else {
        error = 'Unexpected response from service worker';
        starting = false;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not reach service worker';
      starting = false;
    }
  }

  // ---------------------------------------------------------------------------
  // ABORT_RUN — sends a message to trigger abortRun() in the coordinator
  // ---------------------------------------------------------------------------
  async function abortRun(): Promise<void> {
    // We'll add an ABORT_RUN message type in a follow-up; for now a simple
    // reload of the popup state is sufficient in development.
    await chrome.runtime.sendMessage(createGetCurrentRunMessage());
  }

  // ---------------------------------------------------------------------------
  // Derived
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
        ? 'idle'
        : run.state;

  $: stateClass = run === null
    ? 'idle'
    : run.state === 'COMPLETED'      ? 'done'
    : run.state === 'ACTIVE'         ? 'chaos'
    : run.state === 'CLEANUP_FAILED' ? 'warn'
    : TERMINAL.has(run.state)        ? 'fail'
    : 'active';
</script>

<main>
  <h1>HAVOC</h1>

  <p class="status {stateClass}">{statusLabel}</p>

  {#if run !== null}
    <dl class="run-meta">
      <dt>run</dt>    <dd>{run.runId.slice(0, 8)}…</dd>
      <dt>state</dt>  <dd>{run.state}</dd>
      <dt>kind</dt>   <dd>{run.definition.kind}</dd>
      <dt>target</dt> <dd>tab {run.target.tabId} · {run.target.origin}</dd>
    </dl>
  {/if}

  <!-- Config panel — only shown when idle -->
  {#if !isRunActive && !starting}
    <fieldset class="config">
      <legend>experiment</legend>

      <label>
        kind
        <select bind:value={selectedKind}>
          <option value="fetch_latency">fetch latency</option>
          <option value="fetch_failure">fetch failure</option>
        </select>
      </label>

      <label>
        duration (ms)
        <input type="number" min="500" max="60000" step="500" bind:value={durationMs} />
      </label>

      {#if selectedKind === 'fetch_latency'}
        <label>
          delay (ms)
          <input type="number" min="0" max="10000" step="100" bind:value={delayMs} />
        </label>
      {:else}
        <label>
          failure mode
          <select bind:value={failureMode}>
            <option value="transport_error">transport error</option>
            <option value="synthetic_http_error">synthetic HTTP error</option>
            <option value="synthetic_timeout">synthetic timeout</option>
          </select>
        </label>

        {#if failureMode === 'synthetic_http_error'}
          <label>
            status code
            <input type="number" min="400" max="599" step="1" bind:value={syntheticStatus} />
          </label>
        {/if}

        {#if failureMode === 'synthetic_timeout'}
          <label>
            timeout (ms)
            <input type="number" min="1000" max="60000" step="1000" bind:value={timeoutMs} />
          </label>
        {/if}
      {/if}
    </fieldset>
  {/if}

  <div class="actions">
    <button on:click={createRun} disabled={!canStart} class:spinning={starting}>
      {#if starting && !isRunActive}
        starting…
      {:else if isRunActive}
        running…
      {:else}
        ▶ start run
      {/if}
    </button>
  </div>
</main>

<style>
  main {
    padding: 12px;
    min-width: 260px;
    font-family: monospace;
    font-size: 12px;
    color: #d0d0d0;
    background: #111;
  }

  h1 {
    font-size: 13px;
    letter-spacing: 3px;
    margin: 0 0 8px;
    text-transform: uppercase;
    color: #fff;
  }

  .status {
    margin: 0 0 10px;
    padding: 3px 7px;
    border-radius: 3px;
    font-size: 11px;
    background: #1e1e1e;
    color: #777;
    display: inline-block;
  }
  .status.active { color: #7dd3fc; background: #0c2233; }
  .status.chaos  { color: #f97316; background: #2a1200; }
  .status.done   { color: #86efac; background: #0b2417; }
  .status.fail   { color: #fca5a5; background: #2d0b0b; }
  .status.warn   { color: #fde68a; background: #2d1f00; }

  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 8px;
    margin: 0 0 10px;
    font-size: 11px;
  }
  dt { opacity: 0.4; text-align: right; }
  dd { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  fieldset.config {
    border: 1px solid #2a2a2a;
    border-radius: 4px;
    padding: 6px 8px 8px;
    margin: 0 0 10px;
  }
  legend {
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    opacity: 0.5;
    padding: 0 4px;
  }
  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 4px 0;
    font-size: 11px;
    opacity: 0.8;
  }
  select, input[type="number"] {
    background: #1e1e1e;
    border: 1px solid #333;
    color: #d0d0d0;
    border-radius: 3px;
    padding: 2px 5px;
    font-family: monospace;
    font-size: 11px;
    width: 130px;
  }

  .actions { display: flex; gap: 6px; }

  button {
    flex: 1;
    padding: 5px 10px;
    font-size: 11px;
    font-family: monospace;
    cursor: pointer;
    background: #1e1e1e;
    color: #d0d0d0;
    border: 1px solid #333;
    border-radius: 3px;
    transition: background 0.12s;
  }
  button:disabled { opacity: 0.35; cursor: default; }
  button:not(:disabled):hover { background: #2a2a2a; }
  button.spinning { color: #f97316; }
</style>
