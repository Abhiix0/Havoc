<script lang="ts">
  import { onMount } from 'svelte';
  import type { ExperimentKind } from '../domain/experiment';
  import { isRunActive, setupRunStore } from './lib/stores/run';
  import { isShipCheckActive, setupShipCheckStore } from './lib/stores/ship-check';
  import HomeScreen from './lib/screens/HomeScreen.svelte';
  import ExperimentSelectScreen from './lib/screens/ExperimentSelectScreen.svelte';
  import ConfigureScreen from './lib/screens/ConfigureScreen.svelte';
  import ActiveChaosScreen from './lib/screens/ActiveChaosScreen.svelte';
  import AutopsyScreen from './lib/screens/AutopsyScreen.svelte';
  import HistoryScreen from './lib/screens/HistoryScreen.svelte';
  import RunningScreen from './lib/screens/RunningScreen.svelte';
  import ResultsScreen from './lib/screens/ResultsScreen.svelte';

  type Screen =
    | 'home'
    | 'select'
    | 'configure'
    | 'active'
    | 'autopsy'
    | 'history'
    | 'running'
    | 'results';

  let currentScreen: Screen = 'home';
  let selectedKind: ExperimentKind = 'fetch_latency';
  let inspectedRunId: string | null = null;
  let inspectedShipCheckId: string | null = null;

  onMount(() => {
    const cleanup1 = setupRunStore();
    const cleanup2 = setupShipCheckStore();
    return () => {
      cleanup1();
      cleanup2();
    };
  });

  // If a single experiment run is active, show the active screen immediately unless inspecting past runs
  $: if ($isRunActive) {
    const isInspectingHistorical =
      currentScreen === 'history' ||
      (currentScreen === 'autopsy' && inspectedRunId !== null) ||
      (currentScreen === 'results' && inspectedShipCheckId !== null);

    if (currentScreen !== 'active' && !isInspectingHistorical) {
      currentScreen = 'active';
      inspectedRunId = null;
    }
  }

  // If a Ship Check is active, show the running screen immediately unless inspecting past runs
  $: if ($isShipCheckActive) {
    const isInspectingHistorical =
      currentScreen === 'history' ||
      (currentScreen === 'results' && inspectedShipCheckId !== null) ||
      (currentScreen === 'autopsy' && inspectedRunId !== null);

    if (currentScreen !== 'running' && !isInspectingHistorical) {
      currentScreen = 'running';
    }
  }

  function handleNavigate(detail: any) {
    if (typeof detail === 'string') {
      currentScreen = detail as Screen;
      if (detail !== 'autopsy') {
        inspectedRunId = null;
      }
      if (detail !== 'results') {
        inspectedShipCheckId = null;
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
      if ('shipCheckId' in detail) {
        inspectedShipCheckId = detail.shipCheckId ?? null;
      } else if (detail.screen !== 'results') {
        inspectedShipCheckId = null;
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
  {:else if currentScreen === 'running'}
    <RunningScreen on:navigate={(e) => handleNavigate(e.detail)} />
  {:else if currentScreen === 'results'}
    <ResultsScreen
      shipCheckId={inspectedShipCheckId}
      on:navigate={(e) => handleNavigate(e.detail)}
    />
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
