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

  onMount(() => {
    const cleanup = setupRunStore();
    return cleanup;
  });

  // If a run is active, show the active screen immediately
  $: if ($isRunActive) {
    if (currentScreen !== 'active') {
      currentScreen = 'active';
    }
  }

  function handleNavigate(detail: any) {
    if (typeof detail === 'string') {
      currentScreen = detail as Screen;
    } else if (typeof detail === 'object' && detail !== null) {
      if (detail.screen) {
        currentScreen = detail.screen as Screen;
      }
      if (detail.kind) {
        selectedKind = detail.kind as ExperimentKind;
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
    <AutopsyScreen on:navigate={(e) => handleNavigate(e.detail)} />
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
