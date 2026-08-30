<script lang="ts">
  import { onMount } from 'svelte';
  import type { ExperimentKind } from '../domain/experiment';
  import { isRunActive, setupRunStore } from './lib/stores/run';
  import HomeScreen from './lib/screens/HomeScreen.svelte';
  import ExperimentSelectScreen from './lib/screens/ExperimentSelectScreen.svelte';
  import ConfigureScreen from './lib/screens/ConfigureScreen.svelte';
  import ActiveChaosScreen from './lib/screens/ActiveChaosScreen.svelte';
  import AutopsyScreen from './lib/screens/AutopsyScreen.svelte';
  import HistoryScreen from './lib/screens/HistoryScreen.svelte';

  type Screen = 'home' | 'select' | 'configure' | 'active' | 'autopsy' | 'history';
  let currentScreen: Screen = 'home';
  let selectedKind: ExperimentKind = 'fetch_latency';
  let inspectedRunId: string | null = null;

  onMount(() => {
    const cleanup = setupRunStore();
    return cleanup;
  });

  // If a run is active, show the active screen immediately unless inspecting past runs
  $: if ($isRunActive) {
    const isInspectingHistorical =
      currentScreen === 'history' ||
      (currentScreen === 'autopsy' && inspectedRunId !== null);

    if (currentScreen !== 'active' && !isInspectingHistorical) {
      currentScreen = 'active';
      inspectedRunId = null;
    }
  }

  function handleNavigate(detail: any) {
    if (typeof detail === 'string') {
      currentScreen = detail as Screen;
      if (detail !== 'autopsy') {
        inspectedRunId = null;
      }
    } else if (typeof detail === 'object' && detail !== null) {
      if (detail.screen) {
        currentScreen = detail.screen as Screen;
      }
      if (detail.kind) {
        selectedKind = detail.kind as ExperimentKind;
      }
      if ('runId' in detail) {
        inspectedRunId = detail.runId ?? null;
      } else if (detail.screen !== 'autopsy') {
        inspectedRunId = null;
      }
    }
  }
</script>

<div class="app-root">
  {#if currentScreen === 'home'}
    <HomeScreen on:navigate={(e) => handleNavigate(e.detail)} />
  {:else if currentScreen === 'select'}
    <ExperimentSelectScreen
      {selectedKind}
      on:navigate={(e) => handleNavigate(e.detail)}
    />
  {:else if currentScreen === 'configure'}
    <ConfigureScreen
      {selectedKind}
      on:navigate={(e) => handleNavigate(e.detail)}
    />
  {:else if currentScreen === 'active'}
    <ActiveChaosScreen on:navigate={(e) => handleNavigate(e.detail)} />
  {:else if currentScreen === 'autopsy'}
    <AutopsyScreen
      historicalRunId={inspectedRunId}
      on:navigate={(e) => handleNavigate(e.detail)}
    />
  {:else if currentScreen === 'history'}
    <HistoryScreen on:navigate={(e) => handleNavigate(e.detail)} />
  {/if}
</div>

<style>
  :global(:root) {
    color-scheme: dark;
  }

  .app-root {
    width: 480px;
    min-height: 520px;
    background: var(--bg-base, #0A0A0B);
    color: var(--text-primary, #F2F2F0);
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
