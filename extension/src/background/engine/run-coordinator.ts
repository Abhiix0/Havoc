/**
 * run-coordinator.ts — owns the ExperimentRun lifecycle.
 *
 * State machine (happy path):
 *   CREATED → PREPARING → ACTIVE → STOPPING → CLEANING → EVALUATING → COMPLETED
 *
 * Terminal states:
 *   FAILED / ABORTED / TIMED_OUT / TARGET_LOST / CLEANUP_FAILED
 *
 * Phase 4 changes:
 *  - PREPARING now calls buildChaosParams() for fetch_latency / fetch_failure runs.
 *  - ACTIVE calls injectChaos() and holds the injection open for the configured
 *    duration (params.durationMs, default 5 s). The _abortController can cut
 *    this short via abortRun().
 *  - STOPPING is now just a label — the actual teardown happens in CLEANING via
 *    the ResourceRegistry, which calls REMOVE_CHAOS on the target tab.
 *  - Sequence numbering is surfaced as nextSequence() so chaos-injector.ts can
 *    assign correct monotonic numbers to CHAOS_INJECTED events.
 */

import type { ExperimentDefinition } from '../../domain/experiment';
import type { Target } from '../../domain/target';
import type { ExperimentRun, ExperimentState } from '../../domain/run';
import { checkpoint, getCurrentRun } from '../state';
import { ResourceRegistry } from './resource-registry';
import { verifyTarget } from './safety-controller';
import { buildChaosParams, injectChaos, ContentScriptUnavailableError } from './chaos-injector';
import { createRunStateUpdateMessage } from '../../messaging/messages';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TERMINAL_STATES: ReadonlySet<ExperimentState> = new Set([
  'COMPLETED', 'FAILED', 'ABORTED', 'TIMED_OUT', 'CLEANUP_FAILED', 'TARGET_LOST',
]);

function isTerminal(state: ExperimentState): boolean {
  return TERMINAL_STATES.has(state);
}

function now(): number { return Date.now(); }

function broadcastStateUpdate(run: ExperimentRun | null, previousState: ExperimentState | null): void {
  chrome.runtime.sendMessage(createRunStateUpdateMessage(run, previousState)).catch(() => {
    // No popup open — expected and not an error.
  });
}

// ---------------------------------------------------------------------------
// Module-level singletons — one per SW activation, replaced each run.
// ---------------------------------------------------------------------------
let _registry = new ResourceRegistry();
let _abortController: AbortController | null = null;

// Per-run sequence counter — surfaced so chaos-injector can use it.
const _sequenceCounters = new Map<string, number>();

export function nextSequence(runId: string): number {
  const current = _sequenceCounters.get(runId) ?? 0;
  const next = current + 1;
  _sequenceCounters.set(runId, next);
  return next;
}

// ---------------------------------------------------------------------------
// Transition helper
// ---------------------------------------------------------------------------

async function transition(
  run: ExperimentRun,
  newState: ExperimentState,
  extra?: Partial<ExperimentRun>
): Promise<ExperimentRun> {
  const previousState = run.state;
  const updated: ExperimentRun = { ...run, ...extra, state: newState, updatedAt: now() };
  await checkpoint(updated);
  broadcastStateUpdate(updated, previousState);
  console.log(`[HAVOC][coordinator] ${run.runId}: ${previousState} → ${newState}`);
  return updated;
}

async function transitionToFailed(run: ExperimentRun, err: unknown): Promise<ExperimentRun> {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[HAVOC][coordinator] ${run.runId}: FAILED —`, msg);
  return transition(run, 'FAILED');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create and drive a new ExperimentRun through its full lifecycle.
 * Returns the final ExperimentRun (terminal state).
 * Throws only if called while another run is already active.
 */
export async function startRun(
  definition: ExperimentDefinition,
  target: Target
): Promise<ExperimentRun> {
  const existing = getCurrentRun();
  if (existing !== null && !isTerminal(existing.state)) {
    throw new Error(
      `Cannot start a new run — run ${existing.runId} is already in state "${existing.state}"`
    );
  }

  _registry = new ResourceRegistry();
  _abortController = new AbortController();
  const signal = _abortController.signal;

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
    run = await transition(run, 'PREPARING');

    // Build chaos params for supported experiment kinds.
    const chaosParams = buildChaosParams(definition, run.runId);
    if (chaosParams === null && (definition.kind === 'fetch_latency' || definition.kind === 'fetch_failure')) {
      throw new Error(`buildChaosParams returned null for kind "${definition.kind}" — check definition.params`);
    }

    // Brief yield so PREPARING is visible in the popup.
    await delay(80, signal);

    // --- Safety check: PREPARING → ACTIVE ---
    const verification = await verifyTarget(run.target);
    if (!verification.ok) {
      console.warn(`[HAVOC][coordinator] ${run.runId}: target lost — ${verification.reason}: ${verification.detail}`);
      run = await transition(run, 'TARGET_LOST');
      return await doCleanup(run);
    }

    // --- ACTIVE — inject chaos if applicable ---
    run = await transition(run, 'ACTIVE');

    if (chaosParams !== null) {
      let handle;
      try {
        handle = await injectChaos(run.target, chaosParams, _registry, nextSequence);
      } catch (err) {
        if (err instanceof ContentScriptUnavailableError) {
          // Content script not present — tab is unreachable for chaos.
          // This is a target problem, not an experiment bug.
          console.warn(`[HAVOC][coordinator] ${run.runId}: content script absent — ${err.message}`);
          run = await transition(run, 'TARGET_LOST');
          return await doCleanup(run);
        }
        throw err; // other errors propagate to the outer catch → FAILED
      }
      // Phase 7 will persist handle.chaosEvent to IndexedDB here.
      console.log(`[HAVOC][coordinator] ${run.runId}: chaos active (injection ${handle.injectionId})`);
    }

    // Hold ACTIVE for the configured duration (or until aborted).
    // Default: 5 s so there's time to observe effects. Configurable via params.durationMs.
    const durationMs = typeof definition.params.durationMs === 'number'
      ? definition.params.durationMs
      : 5_000;
    await delay(durationMs, signal);

    // --- STOPPING ---
    run = await transition(run, 'STOPPING');

  } catch (err) {
    if (isAbortError(err)) {
      run = await transition(run, 'ABORTED');
    } else {
      run = await transitionToFailed(run, err);
    }
    return await doCleanup(run);
  }

  // --- CLEANING ---
  run = await doCleanup(run);
  if (isTerminal(run.state)) return run;

  // --- EVALUATING ---
  try {
    run = await transition(run, 'EVALUATING');
    // Phase 5/6: Signal + Finding derivation goes here.
    await delay(50);
  } catch (err) {
    return transitionToFailed(run, err);
  }

  // --- COMPLETED ---
  run = await transition(run, 'COMPLETED');
  await checkpoint(null);
  broadcastStateUpdate(null, 'COMPLETED');
  return run;
}

/**
 * Abort the currently active run.
 * Safe to call from any state; idempotent if already terminal.
 */
export async function abortRun(): Promise<void> {
  const run = getCurrentRun();
  if (run === null || isTerminal(run.state)) return;
  _abortController?.abort(new DOMException('Run aborted by user', 'AbortError'));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function doCleanup(run: ExperimentRun): Promise<ExperimentRun> {
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

/** Delay that respects an AbortSignal. Throws AbortError if aborted. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
