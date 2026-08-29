/**
 * recovery-window.ts — evaluates application recovery after chaos injection.
 *
 * The recovery window opens when the run transitions to STOPPING (chaos is
 * removed) and closes after a bounded timeout. During this window the engine
 * collects the events/signals that the signal-engine has already deposited into
 * its per-run buffer, plus any new ones that arrive before the timeout.
 *
 * Resolution is based on EXPLICIT observable predicates only:
 *
 *   RECOVERED
 *     Predicate: at least one REQUEST_COMPLETED for a URL that previously
 *     produced a failure event during the chaos window. The app retried and
 *     succeeded — the clearest observable sign of recovery.
 *
 *   DEGRADED
 *     Predicate: an ErrorStateDetected signal was present (app showed an error),
 *     AND a loading_indicator_removed DOM event appeared afterwards (app is
 *     retrying / entering a new loading state), BUT no REQUEST_COMPLETED
 *     appeared for a previously-failed URL. The app is trying to recover but
 *     hasn't yet succeeded.
 *
 *   FAILED
 *     Predicate: RequestFailureObserved signals exist with injectionId linkage
 *     (chaos-caused), AND no REQUEST_COMPLETED appeared for the failed URLs
 *     within the window, AND no loading recovery indicators appeared. The app
 *     appears stuck.
 *
 *   UNKNOWN
 *     All other cases — including:
 *     - No failure events observed (chaos had no visible effect)
 *     - Window timed out before any recovery predicate resolved
 *     - Only ambiguous signals (e.g. ErrorStateDetected with low confidence
 *       but no confirmed network failure)
 *     UNKNOWN is a first-class valid outcome, not a fallback. It means HAVOC
 *     does not have enough evidence to conclude — which is the honest answer.
 *
 * The predicates are deliberately narrow. A wider window or more events cannot
 * turn UNKNOWN into RECOVERED retroactively — the evaluation is frozen at
 * windowEnd.
 */

import type { HavocEvent } from '../../domain/event';
import type { Signal } from '../../domain/signal';
import type { Recovery } from '../../domain/recovery';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecoveryWindowInput {
  runId: string;
  /** Timestamp when chaos was removed (STOPPING transition). */
  chaosEndTime: number;
  /** How long to wait for recovery evidence. Default: 8 s. */
  windowMs?: number | undefined;
  /** Optional AbortSignal to short-circuit the recovery window. */
  signal?: AbortSignal | undefined;
  /** All HavocEvents buffered for this run, including post-chaos arrivals. */
  events: HavocEvent[];
  /** All Signals derived for this run. */
  signals: Signal[];
}

export interface RecoveryWindowResult {
  recovery: Recovery;
  /**
   * The HavocEvent ids and Signal ids that directly drove the outcome.
   * Used by the Finding Engine to create Evidence objects with traceable refIds.
   */
  contributingEventIds: string[];
  contributingSignalIds: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_MS = 8_000;

const FAILURE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'REQUEST_TRANSPORT_FAILURE',
  'REQUEST_HTTP_FAILURE',
  'REQUEST_TIMEOUT',
]);

// ---------------------------------------------------------------------------
// Predicate helpers
// ---------------------------------------------------------------------------

/**
 * Returns URLs that failed during the chaos window (before chaosEndTime).
 * Only includes failures with an injectionId (chaos-caused), so we don't
 * treat ambient pre-existing failures as part of the chaos effect.
 */
function getChaosFailedUrls(events: HavocEvent[], chaosEndTime: number): Set<string> {
  const urls = new Set<string>();
  for (const e of events) {
    if (
      FAILURE_EVENT_TYPES.has(e.type) &&
      e.timestamp <= chaosEndTime &&
      typeof e.metadata?.injectionId === 'string' &&
      typeof e.resource === 'string' &&
      e.resource.length > 0
    ) {
      urls.add(e.resource);
    }
  }
  return urls;
}

/**
 * Returns true if at least one REQUEST_COMPLETED appeared after chaosEndTime
 * for a URL that was in the chaos-failed set.
 */
function hasSuccessfulRetry(
  events: HavocEvent[],
  chaosEndTime: number,
  failedUrls: Set<string>
): { found: boolean; eventIds: string[] } {
  const eventIds: string[] = [];
  for (const e of events) {
    if (
      e.type === 'REQUEST_COMPLETED' &&
      e.timestamp > chaosEndTime &&
      typeof e.resource === 'string' &&
      failedUrls.has(e.resource)
    ) {
      eventIds.push(e.id);
    }
  }
  return { found: eventIds.length > 0, eventIds };
}

/**
 * Returns true if a loading_indicator_removed DOM event appeared after
 * chaosEndTime — indicating the app entered a recovery loading state.
 */
function hasLoadingRecovery(
  events: HavocEvent[],
  chaosEndTime: number
): { found: boolean; eventIds: string[] } {
  const eventIds: string[] = [];
  for (const e of events) {
    if (
      e.type === 'DOM_OBSERVATION' &&
      e.timestamp > chaosEndTime &&
      e.metadata?.kind === 'loading_indicator_removed'
    ) {
      eventIds.push(e.id);
    }
  }
  return { found: eventIds.length > 0, eventIds };
}

// ---------------------------------------------------------------------------
// Core evaluator — pure function, no async, no side effects
// ---------------------------------------------------------------------------

/**
 * Evaluate recovery from a frozen snapshot of events and signals.
 * This is the pure evaluation logic, separated from the timing/waiting
 * concerns so it can be unit tested directly.
 */
export function evaluateRecovery(
  input: RecoveryWindowInput & { windowEnd: number }
): RecoveryWindowResult {
  const { runId, chaosEndTime, windowEnd, events, signals } = input;

  const now = Date.now();
  const evaluatedAt = now;

  // Narrow the event set to what arrived within the recovery window.
  const windowEvents = events.filter((e) => e.timestamp <= windowEnd);
  // Signals are derived from events — they inherit temporal scope from their
  // source events. Don't re-filter by windowEnd (signal timestamps come from
  // Date.now() at derivation time, not from the event timestamp, so comparing
  // them against a synthetic windowEnd produces false negatives in tests and
  // real runs where the signal engine runs asynchronously).
  const windowSignals = signals;

  const chaosFailedUrls = getChaosFailedUrls(windowEvents, chaosEndTime);
  const contributingEventIds: string[] = [];
  const contributingSignalIds: string[] = [];

  // ── Predicate 1: RECOVERED ────────────────────────────────────────────────
  // Was there at least one successful request for a previously-failed URL?
  const successRetry = hasSuccessfulRetry(windowEvents, chaosEndTime, chaosFailedUrls);
  if (successRetry.found) {
    // Collect contributing events: the failure events + the success events.
    for (const e of windowEvents) {
      if (FAILURE_EVENT_TYPES.has(e.type) && typeof e.metadata?.injectionId === 'string') {
        contributingEventIds.push(e.id);
      }
    }
    contributingEventIds.push(...successRetry.eventIds);

    // Signals: RequestFailureObserved that have injectionId linkage.
    for (const s of windowSignals) {
      if (s.type === 'RequestFailureObserved') contributingSignalIds.push(s.id);
    }

    return {
      recovery: { id: crypto.randomUUID(), runId, outcome: 'RECOVERED', windowStart: chaosEndTime, windowEnd, evaluatedAt },
      contributingEventIds,
      contributingSignalIds,
    };
  }

  // ── Predicate 2: DEGRADED ─────────────────────────────────────────────────
  // Error state was detected AND a loading recovery appeared, but no success.
  const errorSignals = windowSignals.filter((s) => s.type === 'ErrorStateDetected');
  const loadingRecovery = hasLoadingRecovery(windowEvents, chaosEndTime);

  if (errorSignals.length > 0 && loadingRecovery.found) {
    for (const e of windowEvents) {
      if (FAILURE_EVENT_TYPES.has(e.type)) contributingEventIds.push(e.id);
    }
    contributingEventIds.push(...loadingRecovery.eventIds);
    errorSignals.forEach((s) => contributingSignalIds.push(s.id));

    return {
      recovery: { id: crypto.randomUUID(), runId, outcome: 'DEGRADED', windowStart: chaosEndTime, windowEnd, evaluatedAt },
      contributingEventIds,
      contributingSignalIds,
    };
  }

  // ── Predicate 3: FAILED ───────────────────────────────────────────────────
  // Chaos-caused failures observed, no recovery evidence at all.
  const chaosLinkedFailures = windowEvents.filter(
    (e) => FAILURE_EVENT_TYPES.has(e.type) && typeof e.metadata?.injectionId === 'string'
  );
  const requestFailureSignals = windowSignals.filter((s) => s.type === 'RequestFailureObserved');

  if (chaosLinkedFailures.length > 0 && !loadingRecovery.found && errorSignals.length === 0) {
    chaosLinkedFailures.forEach((e) => contributingEventIds.push(e.id));
    requestFailureSignals.forEach((s) => contributingSignalIds.push(s.id));

    return {
      recovery: { id: crypto.randomUUID(), runId, outcome: 'FAILED', windowStart: chaosEndTime, windowEnd, evaluatedAt },
      contributingEventIds,
      contributingSignalIds,
    };
  }

  // ── Predicate 4: UNKNOWN ──────────────────────────────────────────────────
  // Insufficient evidence to conclude. This is a first-class valid result:
  //  - No chaos-linked failures (chaos had no observable network effect)
  //  - Window timed out with only ambiguous signals
  //  - ErrorStateDetected but no loading recovery and no confirmed failures
  //    (e.g. DOM-only noise without network corroboration)
  //
  // Collect whatever fragmentary evidence we do have for traceability.
  for (const e of windowEvents) {
    if (e.type === 'CHAOS_INJECTED' || FAILURE_EVENT_TYPES.has(e.type)) {
      contributingEventIds.push(e.id);
    }
  }
  for (const s of windowSignals) {
    contributingSignalIds.push(s.id);
  }

  return {
    recovery: { id: crypto.randomUUID(), runId, outcome: 'UNKNOWN', windowStart: chaosEndTime, windowEnd, evaluatedAt },
    contributingEventIds,
    contributingSignalIds,
  };
}

// ---------------------------------------------------------------------------
// Public API — async version that waits for the window to close
// ---------------------------------------------------------------------------

/**
 * Open a recovery observation window and evaluate recovery after it expires.
 *
 * In the real system this function is called from the EVALUATING phase of the
 * run coordinator. It waits `windowMs` ms for new events to accumulate in the
 * signal engine buffer (which the SW feeds asynchronously), then evaluates.
 *
 * The `getLatestBuffer` callback lets the coordinator inject the current
 * live buffer at evaluation time rather than capturing a stale snapshot.
 *
 * @param input            Static inputs known at STOPPING time.
 * @param getLatestBuffer  Returns {events, signals} at call time — evaluated
 *                         after the window expires, not when this function starts.
 */
export async function openRecoveryWindow(
  input: RecoveryWindowInput,
  getLatestBuffer: () => { events: HavocEvent[]; signals: Signal[] },
  signal?: AbortSignal
): Promise<RecoveryWindowResult> {
  const effectiveSignal = signal ?? input.signal;
  const windowMs = input.windowMs ?? DEFAULT_WINDOW_MS;
  const windowEnd = input.chaosEndTime + windowMs;

  console.log(
    `[HAVOC][recovery] window opened for run ${input.runId}`,
    `(${windowMs}ms, ends at ${new Date(windowEnd).toISOString()})`
  );

  // Wait for the window to close, or abort immediately if signal fires.
  const remaining = windowEnd - Date.now();
  if (remaining > 0 && !effectiveSignal?.aborted) {
    await new Promise<void>((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          resolve();
        }
      }, remaining);

      if (effectiveSignal) {
        effectiveSignal.addEventListener(
          'abort',
          () => {
            if (!done) {
              done = true;
              clearTimeout(timer);
              console.log(`[HAVOC][recovery] run ${input.runId}: recovery window short-circuited by abort`);
              resolve();
            }
          },
          { once: true }
        );
      }
    });
  }

  // Snapshot the live buffer at evaluation time.
  const { events, signals } = getLatestBuffer();

  const result = evaluateRecovery({
    ...input,
    events,
    signals,
    windowEnd: Math.min(windowEnd, Date.now()),
  });

  console.log(
    `[HAVOC][recovery] run ${input.runId}: outcome=${result.recovery.outcome}`,
    `events=${result.contributingEventIds.length}`,
    `signals=${result.contributingSignalIds.length}`
  );

  return result;
}
