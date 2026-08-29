/**
 * state.ts — crash-resistant run registry for the MV3 service worker.
 *
 * Chrome MV3 service workers are suspended after ~30 s of inactivity and can
 * be terminated at any time by the browser. All JS heap state is lost on
 * suspension. chrome.storage.session survives SW suspension (it lives in the
 * browser process, not the SW process) but is cleared when the browser
 * profile session ends — making it the right tier for "currently active run"
 * data that must outlive SW restarts but need not survive a browser restart.
 */

import type { ExperimentRun, ExperimentState } from '../domain/run';

const SESSION_KEY = 'havoc_current_run' as const;

/**
 * States from which a run cannot be resumed after SW suspension.
 * The lifecycle machinery (registry, abort controller, timers) is lost
 * when the SW is killed — these states are irrecoverable without a full
 * restart, so we mark them terminal on rehydration rather than leaving
 * the popup stuck showing a zombie state.
 */
const NON_RESUMABLE_STATES: ReadonlySet<ExperimentState> = new Set([
  'PREPARING',
  'ACTIVE',
  'STOPPING',
  'CLEANING',
  'EVALUATING',
]);

// ---------------------------------------------------------------------------
// In-memory cache — authoritative only while this SW activation is alive.
// Always re-hydrated from session storage on startup (see rehydrate()).
// ---------------------------------------------------------------------------
let _currentRun: ExperimentRun | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Re-hydrate the in-memory cache from chrome.storage.session.
 * Call this once, at the very top of the service worker module, before
 * registering any message handlers — so the first incoming message is never
 * answered from a cold/empty state.
 */
export async function rehydrate(): Promise<void> {
  const result = await chrome.storage.session.get(SESSION_KEY);
  let stored = result[SESSION_KEY] as ExperimentRun | null | undefined;

  if (stored !== null && stored !== undefined && NON_RESUMABLE_STATES.has(stored.state)) {
    // Run was interrupted mid-lifecycle by SW suspension. The in-memory
    // registry, abort controller, and timers are all gone — we cannot
    // resume it. Mark it FAILED and clear the checkpoint so the next
    // startRun() doesn't see a zombie blocking run.
    console.warn(
      `[HAVOC][state] discarding non-resumable run ${stored.runId} (was ${stored.state}) — marking FAILED`
    );
    stored = { ...stored, state: 'FAILED', updatedAt: Date.now() };
    await chrome.storage.session.remove(SESSION_KEY);
    // Keep _currentRun as null — the failed run is gone.
    _currentRun = null;
    console.log('[HAVOC][state] rehydrated: stale run discarded');
    return;
  }

  _currentRun = stored ?? null;
  console.log(
    '[HAVOC][state] rehydrated from session storage:',
    _currentRun ? `run ${_currentRun.runId} (${_currentRun.state})` : 'no active run'
  );
}

/**
 * Persist the current run snapshot to chrome.storage.session.
 * Call this on every meaningful state transition so the data survives SW
 * suspension. Pass `null` to clear the checkpoint (e.g. after a run ends).
 */
export async function checkpoint(run: ExperimentRun | null): Promise<void> {
  _currentRun = run;
  if (run === null) {
    await chrome.storage.session.remove(SESSION_KEY);
    console.log('[HAVOC][state] checkpoint cleared');
  } else {
    await chrome.storage.session.set({ [SESSION_KEY]: run });
    console.log(`[HAVOC][state] checkpoint saved: run ${run.runId} → ${run.state}`);
  }
}

/**
 * Return the current in-memory run snapshot.
 * This is always consistent with the last checkpoint() call within this SW
 * activation, and with storage after a rehydrate() on startup.
 */
export function getCurrentRun(): ExperimentRun | null {
  return _currentRun;
}
