<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import type { ExperimentDefinition, ExperimentKind } from '../../../domain/experiment';
  import type {
    FetchFailureMode,
    InputStressMode,
    ViewportStressMode,
  } from '../../../messaging/messages';
  import {
    handleStartRun,
    starting,
    error,
    activeTab,
  } from '../stores/run';
  import Button from '../components/Button.svelte';
  import ParamField from '../components/ParamField.svelte';

  export let selectedKind: ExperimentKind = 'fetch_latency';

  const dispatch = createEventDispatcher<{
    navigate: 'select' | 'active';
  }>();

  // fetch_latency params
  let delayMs = 800;
  let durationMs = 5000;
  let recoveryWindowMs = 8000;

  // fetch_failure params
  let failureMode: FetchFailureMode = 'transport_error';
  let syntheticStatus = 503;
  let timeoutMs = 8000;

  // input_stress params
  let inputStressMode: InputStressMode = 'all';

  // viewport_stress params
  let viewportStressMode: ViewportStressMode = 'mobile_narrow';

  function buildDefinition(): ExperimentDefinition {
    let name = '';
    let description = '';

    if (selectedKind === 'fetch_latency') {
      name = `LATENCY +${delayMs}ms`;
      description = `Inject artificial ${delayMs}ms latency into all outgoing fetch/XHR requests`;
      return {
        id: crypto.randomUUID(),
        name,
        description,
        kind: 'fetch_latency',
        params: {
          delayMs,
          durationMs,
          recoveryWindowMs,
        },
      };
    } else if (selectedKind === 'fetch_failure') {
      name = `FAILURE (${failureMode.toUpperCase()})`;
      description = `Simulate network failure mode: ${failureMode}`;
      return {
        id: crypto.randomUUID(),
        name,
        description,
        kind: 'fetch_failure',
        params: {
          mode: failureMode,
          ...(failureMode === 'synthetic_http_error' ? { syntheticStatus } : {}),
          ...(failureMode === 'synthetic_timeout' ? { timeoutMs } : {}),
          durationMs,
          recoveryWindowMs,
        },
      };
    } else if (selectedKind === 'input_stress') {
      name = `INPUT STRESS (${inputStressMode.toUpperCase()})`;
      description = `Inject stress inputs into input/textarea fields (${inputStressMode})`;
      return {
        id: crypto.randomUUID(),
        name,
        description,
        kind: 'input_stress',
        params: {
          mode: inputStressMode,
          durationMs,
          recoveryWindowMs,
        },
      };
    } else {
      name = `VIEWPORT (${viewportStressMode.toUpperCase()})`;
      description = `Apply layout stress constraints: ${viewportStressMode}`;
      return {
        id: crypto.randomUUID(),
        name,
        description,
        kind: 'viewport_stress',
        params: {
          mode: viewportStressMode,
          durationMs,
          recoveryWindowMs,
        },
      };
    }
  }

  async function handleStart() {
    const def = buildDefinition();
    await handleStartRun(def);
    dispatch('navigate', 'active');
  }

  function getKindTitle(k: ExperimentKind): string {
    switch (k) {
      case 'fetch_latency':
        return 'FETCH LATENCY';
      case 'fetch_failure':
        return 'FETCH FAILURE';
      case 'input_stress':
        return 'INPUT STRESS';
      case 'viewport_stress':
        return 'VIEWPORT STRESS';
      default:
        return 'EXPERIMENT';
    }
  }
</script>

<div class="config-screen" in:fade={{ duration: 200 }} out:fade={{ duration: 150 }}>
  <!-- Screen Header -->
  <header class="config-header">
    <button
      type="button"
      class="back-link"
      on:click={() => dispatch('navigate', 'select')}
    >
      ← BACK
    </button>
    <div class="header-titles">
      <span class="config-title">{getKindTitle(selectedKind)}</span>
      <span class="config-step">STEP 2/2</span>
    </div>
  </header>

  <!-- Error Banner -->
  {#if $error}
    <div class="error-banner" transition:slide={{ duration: 150 }}>
      <span class="err-icon">⚠</span>
      <span class="err-text">{$error}</span>
    </div>
  {/if}

  <form class="config-form" on:submit|preventDefault={handleStart}>
    <!-- Kind-specific Parameters -->
    <div class="param-section" in:fade={{ duration: 150 }}>
      <span class="section-label">CHAOS PARAMETERS</span>

      {#if selectedKind === 'fetch_latency'}
        <div class="field-container">
          <ParamField label="Injected Delay" description="Artificial latency added to outgoing fetch and XHR requests">
            <div class="input-with-presets">
              <input
                type="number"
                min="100"
                max="10000"
                step="100"
                bind:value={delayMs}
                disabled={$starting}
                required
              />
              <div class="mini-presets">
                <button
                  type="button"
                  class="preset-chip"
                  class:active={delayMs === 400}
                  on:click={() => (delayMs = 400)}
                  disabled={$starting}
                >
                  400ms
                </button>
                <button
                  type="button"
                  class="preset-chip"
                  class:active={delayMs === 800}
                  on:click={() => (delayMs = 800)}
                  disabled={$starting}
                >
                  800ms
                </button>
                <button
                  type="button"
                  class="preset-chip"
                  class:active={delayMs === 2000}
                  on:click={() => (delayMs = 2000)}
                  disabled={$starting}
                >
                  2s
                </button>
              </div>
            </div>
          </ParamField>
        </div>
      {:else if selectedKind === 'fetch_failure'}
        <div class="field-container">
          <ParamField label="Failure Mode" description="Simulated HTTP or transport error condition">
            <select bind:value={failureMode} disabled={$starting}>
              <option value="transport_error">TRANSPORT (NETWORK FAIL)</option>
              <option value="synthetic_http_error">SYNTHETIC HTTP ERROR</option>
              <option value="synthetic_timeout">SYNTHETIC TIMEOUT</option>
            </select>
          </ParamField>

          {#if failureMode === 'synthetic_http_error'}
            <div in:slide={{ duration: 150 }}>
              <ParamField label="HTTP Status Code" description="Simulated status response returned to application">
                <input
                  type="number"
                  min="400"
                  max="599"
                  step="1"
                  bind:value={syntheticStatus}
                  disabled={$starting}
                  required
                />
              </ParamField>
            </div>
          {/if}

          {#if failureMode === 'synthetic_timeout'}
            <div in:slide={{ duration: 150 }}>
              <ParamField label="Timeout Limit (ms)" description="Abort duration after which the request fails">
                <input
                  type="number"
                  min="1000"
                  max="30000"
                  step="1000"
                  bind:value={timeoutMs}
                  disabled={$starting}
                  required
                />
              </ParamField>
            </div>
          {/if}
        </div>
      {:else if selectedKind === 'input_stress'}
        <div class="field-container">
          <ParamField label="Input Stress Pattern" description="Edge-case input payload injected into form fields">
            <select bind:value={inputStressMode} disabled={$starting}>
              <option value="all">ALL PATTERNS (MIXED)</option>
              <option value="unicode">UNICODE & RTL OVERRIDE</option>
              <option value="emoji">EMOJI & SPECIAL SYMBOLS</option>
              <option value="whitespace">EMPTY & WHITESPACE ONLY</option>
              <option value="long_text">OVERFLOW STRINGS (5000+ chars)</option>
              <option value="numeric_extreme">NUMERIC EXTREMES (NaN, ±Infinity, 0)</option>
            </select>
          </ParamField>
        </div>
      {:else if selectedKind === 'viewport_stress'}
        <div class="field-container">
          <ParamField label="Layout Constraint" description="CSS / viewport squeeze applied to document">
            <select bind:value={viewportStressMode} disabled={$starting}>
              <option value="mobile_narrow">MOBILE NARROW (320px)</option>
              <option value="overflow_squeeze">OVERFLOW SQUEEZE (280px)</option>
              <option value="extreme_zoom">EXTREME ZOOM (200%)</option>
            </select>
          </ParamField>
        </div>
      {/if}
    </div>

    <!-- Timing & Recovery Parameters -->
    <div class="param-section timing-section">
      <span class="section-label">TIMING & RECOVERY</span>

      <div class="timing-grid">
        <ParamField label="Hold Duration" description="Active chaos injection window">
          <div class="input-with-unit">
            <input
              type="number"
              min="1000"
              max="30000"
              step="1000"
              bind:value={durationMs}
              disabled={$starting}
              required
            />
            <span class="unit-tag">ms</span>
          </div>
        </ParamField>

        <ParamField label="Recovery Window" description="Telemetry observation window after release">
          <div class="input-with-unit">
            <input
              type="number"
              min="2000"
              max="30000"
              step="1000"
              bind:value={recoveryWindowMs}
              disabled={$starting}
              required
            />
            <span class="unit-tag">ms</span>
          </div>
        </ParamField>
      </div>
    </div>

    <!-- Action Button -->
    <div class="action-footer">
      <Button
        type="submit"
        variant="primary"
        disabled={$starting || !$activeTab}
      >
        {$starting ? 'ARMING CHAOS...' : '⚡ START EXPERIMENT'}
      </Button>
    </div>
  </form>
</div>

<style>
  .config-screen {
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 16px);
    padding: var(--space-4, 16px);
    background: var(--bg-base, #0A0A0B);
    min-height: 520px;
    box-sizing: border-box;
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
  }

  .config-header {
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

  .header-titles {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
  }

  .config-title {
    font-size: var(--text-sm, 12px);
    font-weight: 700;
    color: var(--text-primary, #F2F2F0);
    letter-spacing: 0.5px;
  }

  .config-step {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    color: var(--text-muted, #8A8B90);
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-sm, 4px);
    padding: 1px 5px;
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    background: rgba(232, 92, 74, 0.1);
    border: 1px solid rgba(232, 92, 74, 0.3);
    border-radius: var(--radius-sm, 4px);
    color: var(--havoc-red, #E85C4A);
    font-size: var(--text-xs, 11px);
  }

  .config-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 16px);
    flex: 1;
  }

  .param-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    background: var(--bg-surface, #16171A);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-md, 6px);
    padding: var(--space-3, 12px);
  }

  .section-label {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted, #8A8B90);
    letter-spacing: 0.8px;
    margin-bottom: 2px;
  }

  .field-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 12px);
  }

  .input-with-presets {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }

  .mini-presets {
    display: flex;
    gap: var(--space-1, 4px);
  }

  .preset-chip {
    background: var(--bg-surface-2, #1E1F23);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-sm, 4px);
    color: var(--text-muted, #8A8B90);
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    padding: 3px 8px;
    cursor: pointer;
    transition: all 0.12s ease;
  }

  .preset-chip:hover:not(:disabled) {
    background: #25272D;
    color: var(--text-primary, #F2F2F0);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .preset-chip.active {
    background: rgba(232, 92, 74, 0.15);
    color: var(--havoc-red, #E85C4A);
    border-color: rgba(232, 92, 74, 0.4);
    font-weight: 600;
  }

  .preset-chip:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .timing-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2, 8px);
  }

  .input-with-unit {
    position: relative;
    display: flex;
    align-items: center;
  }

  .input-with-unit :global(input) {
    padding-right: 32px !important;
  }

  .unit-tag {
    position: absolute;
    right: 10px;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    color: var(--text-muted, #8A8B90);
    pointer-events: none;
  }

  .action-footer {
    margin-top: auto;
    display: flex;
    flex-direction: column;
  }

  .action-footer :global(button) {
    width: 100%;
    padding: var(--space-3, 12px) var(--space-4, 16px);
    font-size: var(--text-base, 13px);
    letter-spacing: 0.5px;
  }
</style>
