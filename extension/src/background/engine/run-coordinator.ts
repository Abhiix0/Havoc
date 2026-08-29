/**
 * run-coordinator.ts — owns the ExperimentRun lifecycle.
 *
 * State machine (happy path):
 *   CREATED → PREPARING → ACTIVE → STOPPING → CLEANING → EVALUATING → COMPLETED
 *
 * Terminal states reachable from any non-terminal state:
 *   FAILED        — unexpected error during a transition
 *   ABORTED       — explicit abort() call
 *   TIMED_OUT     — run exceeded its time budget (Phase 4 will wire the timer)
 *   TARGET_LOST   — SafetyController rejected the target before ACTIVE
 *   CLEANUP_FAILED — ResourceRegistry.cleanupAll() had ≥1 failure
 *
 * Invariants enforced here:
 *  1. Only one run may be active at a time — startRun() rejects if a run
 *     is already in progress.
 *  2. Every state transition calls checkpoint() so the run survives SW
 *     suspension.
 *  3. Transitions are serialised by the async state machine — no concurrent
 *     calls to transition() are possible within a single activation.
 *  4. Phase 3 has no chaos injection, so ACTIVE immediately proceeds to
 *     STOPPING after the safety check passes.  Phase 4 will replace that
 *     with real injection logic.
 */

import type { ExperimentDefinition } from '../../domain/experiment';
import type { Target } from '../../domain/target';
import type { ExperimentRun, ExperimentState } from '../../domain/run';
import { checkpoint, getCurrentRun } from '../state';
import { ResourceRegistry } from './resource-registry';
import { verifyTarget } from './safety-controller';
import { createRunStateUpdateMessage } from '../../messaging/messages';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TERMINAL_STATES: ReadonlySet<ExperimentState> = new Set([
  'COMPLETED',
  'FAILED',
  'ABORTED',
  'TIMED_OUT',
  'CLEANUP_FAILED',
  'TARGET_LOST',
]);

function isTerminal(state: ExperimentState): boolean {
  return TERMINAL_STATES.has(state);
}

function now(): number {
  return Date.now();
}

/**
 * Broadcast a RUN_STATE_UPDATE to any open popups.
 * Uses sendMessage with a fire-and-forget pattern — if the popup is closed
 * there is no receiver, which is expected and not an error.
 */
function broadcastStateUpdate(run: ExperimentRun | null, previousState: ExperimentState | null): void {
  chrome.runtime.sendMessage(createRunStateUpdateMessage(run, previousState)).catch(() => {
    // No listeners (popup closed) — this is normal, not an error.
  });
}

// ---------------------------------------------------------------------------
// Module-level singleton registry — one per SW activation.
// Replaced on each new run so stale resources from a previous run don't
// leak into the next one.
// ---------------------------------------------------------------------------
let _registry = new ResourceRegistry();
let _abortController: AbortController | null = null;

// ---------------------------------------------------------------------------
// Transition helper — mutates the run, checkpoints, and broadcasts.
// ---------------------------------------------------------------------------
async function transition(
  run: ExperimentRun,
  newState: ExperimentState,
  extra?: Partial<ExperimentRun>
): Promise<ExperimentRun> {
  const previousState = run.state;
  const updated: ExperimentRun = {
    ...run,
    ...extra,
    state: newState,
    updatedAt: now(),
  };
  await checkpoint(updated);
  broadcastStateUpdate(updated, previousState);
  console.log(`[HAVOC][coordinator] ${run.runId}: ${previousState} → ${newState}`);
  return updated;
}

async function transitionToFailed(
  run: ExperimentRun,
  err: unknown
): Promise<ExperimentRun> {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[HAVOC][coordinator] ${run.runId}: FAILED —`, msg);
  return transition(run, 'FAILED');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create and drive a new ExperimentRun through its full lifecycle.
 *
 * Returns the final ExperimentRun (terminal state).
 * Throws only if called while another run is already active — all other
 * errors are absorbed into the run's terminal state.
 */
export async function startRun(
  definition: ExperimentDefinition,
  target: Target
): Promise<ExperimentRun> {
  // Guard: only one active run at a time.
  const existing = getCurrentRun();
  if (existing !== null && !isTerminal(existing.state)) {
    throw new Error(
      `Cannot start a new run — run ${existing.runId} is already in state "${existing.state}"`
    );
  }

  // Fresh registry and abort controller for this run.
  _registry = new ResourceRegistry();
  _abortController = new AbortController();

  // --- CREATED ---
  let run: ExperimentRun = {
    runId: crypto.randomUUID(),
    definition,
    target,
    state: 'CREATED',
    createdAt: now(),
    updatedAt: now(),
  };
  await checkpoint(run);
  broadcastStateUpdate(run, null);
  console.log(`[HAVOC][coordinator] created run ${run.runId} (${definition.kind})`);

  try {
    // --- PREPARING ---
    // In Phase 4+ this will register chaos injection resources.
    // For Phase 3 we register a no-op placeholder so the registry code path
    // is exercised end-to-end.
    run = await transition(run, 'PREPARING');

    _registry.register({
      id: 'phase3-placeholder',
      scope: 'run-lifetime',
      cleanup: async () => {
        console.log('[HAVOC][coordinator] placeholder resource cleaned up');
      },
    });

    // Small yield so the PREPARING state is observable in the popup before
    // we immediately proceed. Real preparation work will replace this.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    // --- Safety check: PREPARING → ACTIVE ---
    const verification = await verifyTarget(run.target);
    if (!verification.ok) {
      console.warn(
        `[HAVOC][coordinator] ${run.runId}: target lost — ${verification.reason}: ${verification.detail}`
      );
      run = await transition(run, 'TARGET_LOST');
      await cleanup(run);
      return run;
    }

    // --- ACTIVE ---
    // Phase 4 will start chaos injection here. For now we immediately stop.
    run = await transition(run, 'ACTIVE');

    // Yield so ACTIVE is observable, then stop immediately (no chaos yet).
    await new Promise<void>((resolve) => setTimeout(resolve, 150));

    // --- STOPPING ---
    run = await transition(run, 'STOPPING');

  } catch (err) {
    run = await transitionToFailed(run, err);
    await cleanup(run);
    return run;
  }

  // --- CLEANING ---
  run = await cleanup(run);
  if (isTerminal(run.state)) return run;

  // --- EVALUATING ---
  try {
    run = await transition(run, 'EVALUATING');
    // Phase 5/6 will compute Signals and Findings here.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  } catch (err) {
    return transitionToFailed(run, err);
  }

  // --- COMPLETED ---
  run = await transition(run, 'COMPLETED');
  // Clear the checkpoint — run is done; pop the state back to null.
  await checkpoint(null);
  broadcastStateUpdate(null, 'COMPLETED');
  return run;
}

/**
 * Abort the currently active run. Safe to call from any state; idempotent
 * if the run is already terminal.
 */
export async function abortRun(): Promise<void> {
  const run = getCurrentRun();
  if (run === null || isTerminal(run.state)) return;

  _abortController?.abort();
  let updated = await transition(run, 'ABORTED');
  await cleanup(updated);
}

// ---------------------------------------------------------------------------
// Internal cleanup helper
// ---------------------------------------------------------------------------

/**
 * Drive the run through CLEANING, execute the resource registry, then
 * return the run in either CLEANUP_FAILED or the original terminal-bound
 * state (so the caller can continue to EVALUATING on success).
 */
async function cleanup(run: ExperimentRun): Promise<ExperimentRun> {
  let current = await transition(run, 'CLEANING');

  const result = await _registry.cleanupAll();

  if (result.failed.length > 0) {
    console.error(
      `[HAVOC][coordinator] ${run.runId}: CLEANUP_FAILED — failed resources:`,
      result.failed.map((f) => `${f.id} (${f.error})`).join(', ')
    );
    current = await transition(current, 'CLEANUP_FAILED');
    await checkpoint(null);
    broadcastStateUpdate(null, 'CLEANUP_FAILED');
    return current;
  }

  return current;
}
