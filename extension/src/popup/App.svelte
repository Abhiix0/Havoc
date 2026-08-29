<script lang="ts">
  import { onMount } from 'svelte';
  import { createGetCurrentRunMessage } from '../messaging/messages';
  import { isCurrentRunResponseMessage } from '../messaging/validator';
  import type { ExperimentRun } from '../domain/run';

  // The popup is a pure, disposable control surface — it holds no authoritative
  // state. Every time it mounts it asks the service worker for the truth.

  let run: ExperimentRun | null = null;
  let loading = true;
  let error: string | null = null;

  onMount(async () => {
    try {
      const response: unknown = await chrome.runtime.sendMessage(createGetCurrentRunMessage());

      if (isCurrentRunResponseMessage(response)) {
        run = response.run;
      } else {
        error = 'Unexpected response from service worker';
        console.error('[HAVOC][popup] unexpected response', response);
      }
    } catch (e) {
      error = 'Could not reach service worker';
      console.error('[HAVOC][popup] sendMessage error', e);
    } finally {
      loading = false;
    }
  });

  $: statusLabel = loading
    ? 'loading…'
    : error !== null
      ? `error: ${error}`
      : run === null
        ? 'no active run'
        : `${run.state} — ${run.runId}`;
</script>

<main>
  <h1>HAVOC</h1>
  <p class="status">status: {statusLabel}</p>
  {#if run !== null}
    <dl class="run-meta">
      <dt>run</dt>       <dd>{run.runId}</dd>
      <dt>state</dt>     <dd>{run.state}</dd>
      <dt>experiment</dt><dd>{run.definition.name}</dd>
      <dt>target</dt>    <dd>{run.target.tabId}</dd>
    </dl>
  {/if}
</main>

<style>
  main { padding: 12px; min-width: 220px; }
  h1   { font-size: 14px; letter-spacing: 2px; margin: 0 0 8px; }
  .status { font-size: 12px; opacity: 0.7; margin: 0 0 8px; }
  dl   { font-size: 11px; display: grid; grid-template-columns: max-content 1fr; gap: 2px 8px; margin: 0; }
  dt   { opacity: 0.5; text-align: right; }
  dd   { margin: 0; font-family: monospace; }
</style>
