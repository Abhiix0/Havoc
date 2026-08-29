import { writable, derived, get } from 'svelte/store';
import {
  createGetCurrentRunMessage,
  createCreateRunMessage,
  createAbortRunMessage,
} from '../../../messaging/messages';
import {
  isCurrentRunResponseMessage,
  isCreateRunResponseMessage,
  isRunStateUpdateMessage,
} from '../../../messaging/validator';
import {
  getAllRuns,
  getEventsByRunId,
  getSignalsByRunId,
  getRecoveryByRunId,
  getFindingsByRunId,
} from '../../../storage/repository';
import type { ExperimentRun, ExperimentState } from '../../../domain/run';
import type { ExperimentDefinition } from '../../../domain/experiment';
import type { HavocEvent } from '../../../domain/event';
import type { Signal } from '../../../domain/signal';
import type { Finding } from '../../../domain/finding';
import type { Recovery } from '../../../domain/recovery';
import type { Target } from '../../../domain/target';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const TERMINAL_STATES = new Set<ExperimentState>([
  'COMPLETED',
  'FAILED',
  'ABORTED',
  'TIMED_OUT',
  'CLEANUP_FAILED',
  'TARGET_LOST',
]);

export const PIPELINE_STEPS: ExperimentState[] = [
  'CREATED',
  'PREPARING',
  'ACTIVE',
  'STOPPING',
  'CLEANING',
  'EVALUATING',
  'COMPLETED',
];

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------
export const currentRun = writable<ExperimentRun | null>(null);
export const activeTab = writable<Target | null>(null);
export const loading = writable<boolean>(true);
export const error = writable<string | null>(null);
export const starting = writable<boolean>(false);
export const aborting = writable<boolean>(false);

// Run history / inspected records
export const events = writable<HavocEvent[]>([]);
export const signals = writable<Signal[]>([]);
export const recovery = writable<Recovery | undefined>(undefined);
export const findings = writable<Finding[]>([]);

// Active view tab: 'timeline' | 'signals' | 'autopsy' | 'config'
export const activeTabNav = writable<'timeline' | 'signals' | 'autopsy' | 'config'>('timeline');

// ---------------------------------------------------------------------------
// Computed Stores
// ---------------------------------------------------------------------------
export const isRunActive = derived(currentRun, ($currentRun) => {
  return $currentRun !== null && !TERMINAL_STATES.has($currentRun.state);
});

export const canStart = derived(
  [loading, isRunActive, starting],
  ([$loading, $isRunActive, $starting]) => !$loading && !$isRunActive && !$starting
);

// ---------------------------------------------------------------------------
// State Operations & Telemetry Loading
// ---------------------------------------------------------------------------
export async function resolveActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id !== undefined && tab.url) {
      let origin = '';
      try {
        origin = new URL(tab.url).origin;
      } catch {
        origin = tab.url;
      }
      activeTab.set({ tabId: tab.id, origin, url: tab.url, frameId: 0 });
    }
  } catch (e) {
    console.warn('[HAVOC][popup] could not resolve active tab', e);
  }
}

export async function loadRunDetails(runId: string): Promise<void> {
  try {
    const [evts, sigs, rec, fnds] = await Promise.all([
      getEventsByRunId(runId),
      getSignalsByRunId(runId),
      getRecoveryByRunId(runId),
      getFindingsByRunId(runId),
    ]);
    events.set(evts);
    signals.set(sigs);
    recovery.set(rec);
    findings.set(fnds);
  } catch (e) {
    console.error('[HAVOC][popup] loadRunDetails error', e);
  }
}

export async function syncState(): Promise<void> {
  loading.set(true);
  error.set(null);
  try {
    // 1. Query SW for active in-memory run
    const response: unknown = await chrome.runtime.sendMessage(createGetCurrentRunMessage());
    if (isCurrentRunResponseMessage(response) && response.run) {
      currentRun.set(response.run);
    } else {
      // 2. If no active run in SW, read the most recent run from IndexedDB
      const runs = await getAllRuns();
      if (runs.length > 0) {
        runs.sort((a, b) => b.createdAt - a.createdAt);
        currentRun.set(runs[0] ?? null);
      } else {
        currentRun.set(null);
      }
    }

    // 3. Load associated details if we have a run
    const run = get(currentRun);
    if (run) {
      await loadRunDetails(run.runId);
    }
  } catch (e) {
    error.set('Could not sync state with background worker');
    console.error('[HAVOC][popup] syncState error', e);
  } finally {
    loading.set(false);
  }
}

export function handleRuntimeMessage(message: unknown): void {
  if (isRunStateUpdateMessage(message)) {
    const run = get(currentRun);
    if (message.run) {
      currentRun.set(message.run);
      loadRunDetails(message.run.runId);
    } else if (run) {
      // State completed / reset
      starting.set(false);
      aborting.set(false);
      loadRunDetails(run.runId);
    }
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
export async function handleStartRun(definition: ExperimentDefinition): Promise<void> {
  const isStarting = get(starting);
  const active = get(isRunActive);
  const currentTarget = get(activeTab);

  if (isStarting || active) return;
  starting.set(true);
  error.set(null);

  try {
    const response: unknown = await chrome.runtime.sendMessage(
      createCreateRunMessage(definition, currentTarget ?? undefined)
    );

    if (isCreateRunResponseMessage(response)) {
      if (response.error) {
        error.set(response.error);
        starting.set(false);
      } else if (response.run) {
        currentRun.set(response.run);
        events.set([]);
        signals.set([]);
        recovery.set(undefined);
        findings.set([]);
        activeTabNav.set('timeline');
        starting.set(false);
      }
    } else {
      error.set('Invalid response received from service worker');
      starting.set(false);
    }
  } catch (e) {
    error.set(e instanceof Error ? e.message : 'Failed to launch experiment');
    starting.set(false);
  }
}

export async function handleAbortRun(): Promise<void> {
  const active = get(isRunActive);
  const isAborting = get(aborting);

  if (!active || isAborting) return;
  aborting.set(true);

  try {
    await chrome.runtime.sendMessage(createAbortRunMessage());
  } catch (e) {
    console.error('[HAVOC][popup] abort error', e);
  } finally {
    setTimeout(() => {
      aborting.set(false);
    }, 1000);
  }
}

// ---------------------------------------------------------------------------
// Polling & Lifecycle helper
// ---------------------------------------------------------------------------
export function setupRunStore(): () => void {
  resolveActiveTab();
  syncState();

  chrome.runtime.onMessage.addListener(handleRuntimeMessage);

  const pollInterval = setInterval(async () => {
    const active = get(isRunActive);
    const run = get(currentRun);
    if (active && run) {
      await loadRunDetails(run.runId);
    }
  }, 600);

  return () => {
    clearInterval(pollInterval);
    chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  };
}

// ---------------------------------------------------------------------------
// Presentation formatters
// ---------------------------------------------------------------------------
export function getStepIndex(state: ExperimentState): number {
  const idx = PIPELINE_STEPS.indexOf(state);
  return idx >= 0 ? idx : -1;
}

export function formatRelativeTime(timestamp: number, baseTimestamp: number): string {
  const diff = (timestamp - baseTimestamp) / 1000;
  const sign = diff >= 0 ? '+' : '-';
  return `${sign}${Math.abs(diff).toFixed(2)}s`;
}

export function formatConfidence(conf: number): string {
  return `${Math.round(conf * 100)}%`;
}
