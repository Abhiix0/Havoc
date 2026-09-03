/**
 * passive-check-runner.ts — coordinates the lifecycle of passive checks.
 *
 * State machine:
 *   CREATED → RUNNING → COMPLETED | FAILED | TARGET_LOST
 *
 * Passive checks do not inject chaos and do not require recovery windows,
 * chaos removal, or ResourceRegistry teardowns.
 */

import type { Target } from '../../domain/target';
import type {
  PassiveCheckDefinition,
  PassiveCheckKind,
  PassiveCheckRun,
  PassiveCheckState,
} from '../../domain/passive-check';
import type { HavocEvent } from '../../domain/event';
import { checkpointPassiveRun } from '../state';
import { verifyTarget } from './safety-controller';
import { processEvent, clearRunBuffer } from './signal-engine';
import { saveEvent, saveSignals } from '../../storage/repository';
import { createPassiveRunStateUpdateMessage } from '../../messaging/messages';

export type PassiveCheckExecutor = (
  target: Target,
  definition: PassiveCheckDefinition,
  runId: string,
  nextSequence: (runId: string) => number
) => Promise<{ events: HavocEvent[] }>;

// ---------------------------------------------------------------------------
// Executor Registry
// ---------------------------------------------------------------------------

const _executors = new Map<PassiveCheckKind, PassiveCheckExecutor>();

export function registerPassiveCheckExecutor(
  kind: PassiveCheckKind,
  executor: PassiveCheckExecutor
): void {
  _executors.set(kind, executor);
}

export function getPassiveCheckExecutor(
  kind: PassiveCheckKind
): PassiveCheckExecutor | undefined {
  return _executors.get(kind);
}

// ---------------------------------------------------------------------------
// Helpers & State Management
// ---------------------------------------------------------------------------

const _sequenceCounters = new Map<string, number>();

export function nextSequence(runId: string): number {
  const current = _sequenceCounters.get(runId) ?? 0;
  const next = current + 1;
  _sequenceCounters.set(runId, next);
  return next;
}

function now(): number {
  return Date.now();
}

function broadcastStateUpdate(
  run: PassiveCheckRun | null,
  previousState: PassiveCheckState | null
): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  try {
    const res = chrome.runtime.sendMessage(
      createPassiveRunStateUpdateMessage(run, previousState)
    );
    if (res && typeof res.catch === 'function') {
      res.catch(() => {
        // No popup open — expected and not an error.
      });
    }
  } catch {
    // No popup open — expected and not an error.
  }
}

async function transition(
  run: PassiveCheckRun,
  newState: PassiveCheckState,
  extra?: Partial<PassiveCheckRun>
): Promise<PassiveCheckRun> {
  const previousState = run.state;
  const updated: PassiveCheckRun = {
    ...run,
    ...extra,
    state: newState,
    updatedAt: now(),
  };
  await checkpointPassiveRun(updated);
  broadcastStateUpdate(updated, previousState);
  console.log(`[HAVOC][passive-runner] ${run.runId}: ${previousState} → ${newState}`);
  return updated;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

// ---------------------------------------------------------------------------
// Public Runner Entry Point
// ---------------------------------------------------------------------------

export async function startPassiveCheck(
  definition: PassiveCheckDefinition,
  target: Target
): Promise<PassiveCheckRun> {
  const runId = crypto.randomUUID();

  let run: PassiveCheckRun = {
    runId,
    target,
    definition,
    state: 'CREATED',
    createdAt: now(),
    updatedAt: now(),
  };

  await checkpointPassiveRun(run);
  broadcastStateUpdate(run, null);
  console.log(`[HAVOC][passive-runner] created run ${run.runId} (${definition.kind})`);

  try {
    const executor = getPassiveCheckExecutor(definition.kind);
    if (!executor) {
      throw new Error(`No executor registered for passive check kind "${definition.kind}"`);
    }

    // --- Verify target ---
    const verification = await verifyTarget(run.target);
    if (!verification.ok) {
      console.warn(
        `[HAVOC][passive-runner] ${run.runId}: target lost — ${verification.reason}: ${verification.detail}`
      );
      run = await transition(run, 'TARGET_LOST');
      await checkpointPassiveRun(null);
      clearRunBuffer(run.runId);
      return run;
    }

    // --- RUNNING ---
    run = await transition(run, 'RUNNING');

    // Execute with 10s hard timeout
    const timeoutMs = 10_000;
    const abortController = new AbortController();

    const timeoutPromise = delay(timeoutMs, abortController.signal).then(() => {
      throw new Error(`Passive check "${definition.kind}" timed out after ${timeoutMs}ms`);
    });
    timeoutPromise.catch(() => {
      /* expected once aborted after normal completion */
    });

    const result = await Promise.race([
      executor(run.target, run.definition, run.runId, nextSequence),
      timeoutPromise,
    ]).finally(() => {
      abortController.abort();
    });

    // Feed returned events through saveEvent & signal-engine
    for (const event of result.events) {
      await saveEvent(event).catch((err: unknown) => {
        console.error(`[HAVOC][passive-runner] failed to persist event ${event.id}:`, err);
      });
      const signals = processEvent(event);
      if (signals.length > 0) {
        await saveSignals(signals).catch((err: unknown) => {
          console.error(
            `[HAVOC][passive-runner] failed to persist signals for event ${event.id}:`,
            err
          );
        });
      }
    }

    // --- COMPLETED ---
    run = await transition(run, 'COMPLETED');
    await checkpointPassiveRun(null);
    clearRunBuffer(run.runId);
    return run;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[HAVOC][passive-runner] ${run.runId}: FAILED —`, msg);
    run = await transition(run, 'FAILED');
    await checkpointPassiveRun(null);
    clearRunBuffer(run.runId);
    return run;
  }
}
