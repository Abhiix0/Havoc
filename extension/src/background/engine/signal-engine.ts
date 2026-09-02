/**
 * signal-engine.ts — derives Signal objects from the raw HavocEvent stream.
 *
 * Architecture:
 *   processEvent(event) is called by the SW on every HavocEvent as it arrives.
 *   The engine maintains an in-memory EventBuffer per run. Each deriver rule
 *   inspects the buffer and the incoming event, and may emit zero or more Signals.
 *
 * Three signal types in Phase 5:
 *
 *   RequestFailureObserved
 *     Source: REQUEST_TRANSPORT_FAILURE, REQUEST_HTTP_FAILURE, REQUEST_TIMEOUT
 *     Confidence: 0.95 — directly observed from instrumentation, not inferred.
 *       Discounted slightly from 1.0 because the injectionId linkage is not
 *       guaranteed (observations outside a chaos window still arrive here).
 *       When injectionId is present (chaos-caused), confidence is 0.97.
 *
 *   LoadingStateDetected
 *     Source: DOM_OBSERVATION kind=loading_indicator_appeared, correlated with
 *       a REQUEST_* failure or CHAOS_INJECTED within the look-back window.
 *     Confidence: computed from timing proximity and DOM signal specificity:
 *       base = 0.5 (loading indicator appeared, but no causal link proven)
 *       +0.20 if a failure event exists within 2 s before the DOM mutation
 *       +0.15 if the mutation is on an aria-role=progressbar element (specific)
 *       +0.10 if a CHAOS_INJECTED event is in the buffer for the same run
 *       Maximum: 0.95 — capped because DOM heuristics are never certain.
 *
 *   ErrorStateDetected
 *     Source: DOM_OBSERVATION kind=error_text_appeared or aria_live_changed,
 *       correlated with failure events in the look-back window.
 *     Confidence: computed from timing and text strength:
 *       base = 0.35 (error text appeared — very loose heuristic)
 *       +0.25 if a failure event exists within 3 s before the DOM mutation
 *       +0.20 if kind=aria_live_changed (accessible error announcement — stronger)
 *       +0.15 if the text matches a high-specificity error pattern (regex below)
 *       Maximum: 0.90 — capped because text matching is inherently ambiguous.
 *
 * Provenance:
 *   Every Signal stores derivedFrom: Array<HavocEvent['id']> — the exact event
 *   ids that contributed to the derivation. Never emit a Signal without at least
 *   one derivedFrom entry.
 *
 * De-duplication:
 *   The engine tracks emitted signal fingerprints per run to avoid re-emitting
 *   the same signal for the same causal event. Fingerprint = type + primaryEventId.
 */

import type { HavocEvent } from '../../domain/event';
import type { Signal } from '../../domain/signal';
import type { DomObservationPayload } from '../../messaging/messages';
import type { ExperimentKind } from '../../domain/experiment';
import { getCurrentRun } from '../state';
import {
  evaluateAdmission,
  shouldCoalesceDomEvent,
  clearBackpressureState,
} from './backpressure';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignalContext {
  kind?: ExperimentKind | undefined;
  targetOrigin?: string | undefined;
}

/** A HavocEvent that carries a DOM observation in its metadata. */
interface DomHavocEvent extends HavocEvent {
  type: 'DOM_OBSERVATION';
  metadata: Record<string, unknown> & {
    kind: DomObservationPayload['kind'];
    selector: string;
    textSnippet: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Events older than this are pruned from the buffer to bound memory usage. */
const BUFFER_TTL_MS = 60_000;

/** Look-back window for causal correlation (LoadingStateDetected). */
const LOADING_LOOKBACK_MS = 2_000;

/** Look-back window for causal correlation (ErrorStateDetected). */
const ERROR_LOOKBACK_MS = 3_000;

/**
 * High-specificity error text pattern — strings that almost certainly
 * indicate an application-level error state, not just background noise.
 * Used to boost confidence in ErrorStateDetected.
 */
const HIGH_SPECIFICITY_ERROR_RE =
  /\b(failed to load|could not (fetch|load|connect)|network error|service unavailable|try again later|request failed|error loading|unable to (fetch|load|connect))\b/i;

const FAILURE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'REQUEST_TRANSPORT_FAILURE',
  'REQUEST_HTTP_FAILURE',
  'REQUEST_TIMEOUT',
]);

const RUNTIME_ERROR_EVENT_TYPES: ReadonlySet<string> = new Set([
  'UNCAUGHT_EXCEPTION',
  'UNHANDLED_REJECTION',
]);

// ---------------------------------------------------------------------------
// Per-run state
// ---------------------------------------------------------------------------

interface RunBuffer {
  events: HavocEvent[];
  /** Fingerprints of already-emitted signals: type + ':' + primaryEventId */
  emitted: Set<string>;
  context?: SignalContext;
}

const _buffers = new Map<string, RunBuffer>();

function getBuffer(runId: string): RunBuffer {
  let buf = _buffers.get(runId);
  if (buf === undefined) {
    buf = { events: [], emitted: new Set() };
    _buffers.set(runId, buf);
  }
  return buf;
}

function pruneBuffer(buf: RunBuffer, now: number): void {
  const cutoff = now - BUFFER_TTL_MS;
  let i = 0;
  while (i < buf.events.length && (buf.events[i]?.timestamp ?? 0) < cutoff) i++;
  if (i > 0) buf.events.splice(0, i);
}

/** Clear a run's buffer when the run ends. */
export function clearRunBuffer(runId: string): void {
  _buffers.delete(runId);
  clearBackpressureState(runId);
}

/** Register or update the run context (experiment kind, target origin). */
export function setRunContext(runId: string, context: SignalContext): void {
  const buf = getBuffer(runId);
  buf.context = { ...buf.context, ...context };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignal(
  type: string,
  runId: string,
  confidence: number,
  derivedFrom: string[]
): Signal {
  return {
    id: crypto.randomUUID(),
    runId,
    type,
    confidence: Math.min(1, Math.max(0, confidence)),
    derivedFrom,
    timestamp: Date.now(),
  };
}

function logSignal(signal: Signal): void {
  console.log(
    `[HAVOC][signal] ${signal.type}`,
    `confidence=${signal.confidence.toFixed(2)}`,
    `derivedFrom=[${signal.derivedFrom.slice(0, 3).join(', ')}${signal.derivedFrom.length > 3 ? '…' : ''}]`
  );
}

function isDomObservationEvent(event: HavocEvent): event is DomHavocEvent {
  return (
    event.type === 'DOM_OBSERVATION' &&
    typeof event.metadata?.kind === 'string'
  );
}

function getOrigin(urlStr?: string, baseOrigin?: string): string | null {
  if (!urlStr) return null;
  try {
    return new URL(urlStr, baseOrigin).origin.toLowerCase();
  } catch {
    return null;
  }
}

function isSameOrigin(urlStr?: string, targetOrigin?: string): boolean {
  if (!urlStr || !targetOrigin) return false;
  const tgtOrigin = getOrigin(targetOrigin);
  if (!tgtOrigin) return false;
  const eventOrigin = getOrigin(urlStr, tgtOrigin);
  return Boolean(eventOrigin && eventOrigin === tgtOrigin);
}

function resolveContext(
  event: HavocEvent,
  buf: RunBuffer
): { kind?: ExperimentKind | undefined; targetOrigin?: string | undefined } {
  let kind: ExperimentKind | undefined = buf.context?.kind;
  let targetOrigin: string | undefined = buf.context?.targetOrigin;

  if (!kind || !targetOrigin) {
    try {
      const currentRun = getCurrentRun();
      if (currentRun && currentRun.runId === event.runId) {
        kind = kind ?? currentRun.definition?.kind;
        targetOrigin = targetOrigin ?? currentRun.target?.origin;
      }
    } catch {
      // In isolated environments
    }
  }

  if (!kind || !targetOrigin) {
    const chaosEvent = buf.events.find(
      (e) => e.type === 'CHAOS_INJECTED' && e.runId === event.runId
    );
    if (chaosEvent?.metadata) {
      if (!kind && typeof chaosEvent.metadata.kind === 'string') {
        kind = chaosEvent.metadata.kind as ExperimentKind;
      }
      if (!targetOrigin && typeof chaosEvent.metadata.origin === 'string') {
        targetOrigin = chaosEvent.metadata.origin;
      }
    }
  }

  return { kind, targetOrigin };
}

// ---------------------------------------------------------------------------
// Deriver 1 — RequestFailureObserved
//
// Causal-plausibility heuristics:
//   - input_stress / viewport_stress never touch fetch/XHR -> unconditionally null.
//   - fetch_latency -> only failures with injectionId linkage qualify.
//   - fetch_failure -> failures with injectionId linkage OR same-origin to Target qualify.
//                      cross-origin failures without injectionId are noise (ads/analytics).
//   - Confidence: 0.97 with injectionId linkage, 0.95 for same-origin ambient/corroborated.
// ---------------------------------------------------------------------------

function deriveRequestFailure(
  event: HavocEvent,
  buf: RunBuffer
): Signal | null {
  if (!FAILURE_EVENT_TYPES.has(event.type)) return null;

  const { kind, targetOrigin } = resolveContext(event, buf);

  // 1. Input stress and viewport stress never touch fetch/XHR — reject all failure events unconditionally
  if (kind === 'input_stress' || kind === 'viewport_stress') {
    return null;
  }

  const hasInjectionLink = typeof event.metadata?.injectionId === 'string';
  const sameOrigin = isSameOrigin(event.resource, targetOrigin);

  // 2. Gate for fetch_latency vs fetch_failure vs default:
  if (kind === 'fetch_latency') {
    // fetch_latency only causes delays, not forced failures.
    // Only failures directly intercepted during active injection count.
    if (!hasInjectionLink) {
      return null;
    }
  } else if (kind === 'fetch_failure') {
    // fetch_failure: must have injection link OR be same-origin to the page under test
    if (!hasInjectionLink && !sameOrigin) {
      return null;
    }
  } else {
    // If kind is unspecified (e.g. test fixture without kind):
    // Require injection link OR same-origin if targetOrigin is known
    if (!hasInjectionLink && targetOrigin && !sameOrigin) {
      return null;
    }
  }

  const fingerprint = `RequestFailureObserved:${event.id}`;
  if (buf.emitted.has(fingerprint)) return null;
  buf.emitted.add(fingerprint);

  const confidence = hasInjectionLink ? 0.97 : 0.95;

  return makeSignal('RequestFailureObserved', event.runId, confidence, [event.id]);
}

// ---------------------------------------------------------------------------
// Deriver 2 — LoadingStateDetected
//
// Confidence heuristic:
//   Base 0.50 — a loading indicator appeared, but we don't know why.
//   +0.20 if a failure event is in the buffer within LOADING_LOOKBACK_MS before
//          this DOM mutation (temporal proximity = causal hint).
//   +0.15 if the mutation element has role=progressbar (more specific than a
//          generic spinner class — app explicitly labelled it a progress bar).
//   +0.10 if a CHAOS_INJECTED event exists for this run in the buffer
//          (confirms chaos was active, not just ambient failures).
//   Cap 0.95 — DOM heuristics can never be fully certain.
// ---------------------------------------------------------------------------

function deriveLoadingState(
  event: HavocEvent,
  buf: RunBuffer
): Signal | null {
  if (!isDomObservationEvent(event)) return null;
  if (event.metadata.kind !== 'loading_indicator_appeared') return null;

  const fingerprint = `LoadingStateDetected:${event.id}`;
  if (buf.emitted.has(fingerprint)) return null;

  const now = event.timestamp;
  const derivedFrom: string[] = [event.id];

  // Find failure events within the look-back window.
  const recentFailures = buf.events.filter(
    (e) =>
      FAILURE_EVENT_TYPES.has(e.type) &&
      e.timestamp >= now - LOADING_LOOKBACK_MS &&
      e.timestamp <= now
  );

  if (recentFailures.length === 0) {
    // No causal link — only emit if base confidence is worth reporting.
    // Threshold: 0.50 alone is noise. Skip until we have corroboration.
    return null;
  }

  recentFailures.forEach((e) => derivedFrom.push(e.id));

  let confidence = 0.50 + 0.20; // base + proximity boost

  // Specificity boost: progressbar role in selector.
  if (/progressbar/i.test(event.metadata.selector)) {
    confidence += 0.15;
    derivedFrom.push(event.id); // already in, no dup needed — selector noted in metadata
  }

  // Chaos active boost: CHAOS_INJECTED in buffer for this run.
  const chaosEvent = buf.events.find((e) => e.type === 'CHAOS_INJECTED' && e.runId === event.runId);
  if (chaosEvent !== undefined) {
    confidence += 0.10;
    derivedFrom.push(chaosEvent.id);
  }

  buf.emitted.add(fingerprint);
  return makeSignal('LoadingStateDetected', event.runId, Math.min(confidence, 0.95), derivedFrom);
}

// ---------------------------------------------------------------------------
// Deriver 3 — ErrorStateDetected
//
// Confidence heuristic:
//   Base 0.35 — error text appeared, but this is a loose heuristic. The word
//   "error" appears in many benign contexts (e.g. "no errors found").
//   +0.25 if a failure event is in the buffer within ERROR_LOOKBACK_MS (temporal
//          proximity is the strongest available signal for causality here).
//   +0.20 if kind=aria_live_changed (the app explicitly announced a status
//          change via an accessible live region — apps don't do this for benign
//          states, so it's a much stronger indicator than raw text).
//   +0.15 if the text matches HIGH_SPECIFICITY_ERROR_RE (phrases like
//          "failed to load" are rarely used in non-error states).
//   Cap 0.90 — text classification is inherently ambiguous.
// ---------------------------------------------------------------------------

function deriveErrorState(
  event: HavocEvent,
  buf: RunBuffer
): Signal | null {
  if (!isDomObservationEvent(event)) return null;
  if (
    event.metadata.kind !== 'error_text_appeared' &&
    event.metadata.kind !== 'aria_live_changed'
  ) {
    return null;
  }

  const fingerprint = `ErrorStateDetected:${event.id}`;
  if (buf.emitted.has(fingerprint)) return null;

  const now = event.timestamp;
  const derivedFrom: string[] = [event.id];

  let confidence = 0.35;

  // Temporal proximity to a failure event.
  const recentFailures = buf.events.filter(
    (e) =>
      FAILURE_EVENT_TYPES.has(e.type) &&
      e.timestamp >= now - ERROR_LOOKBACK_MS &&
      e.timestamp <= now
  );

  if (recentFailures.length === 0 && event.metadata.kind === 'error_text_appeared') {
    // Text-only without any failure events — too noisy to emit.
    return null;
  }

  recentFailures.forEach((e) => derivedFrom.push(e.id));
  if (recentFailures.length > 0) confidence += 0.25;

  // aria-live is a stronger signal.
  if (event.metadata.kind === 'aria_live_changed') {
    confidence += 0.20;
  }

  // High-specificity text match.
  if (HIGH_SPECIFICITY_ERROR_RE.test(event.metadata.textSnippet)) {
    confidence += 0.15;
  }

  buf.emitted.add(fingerprint);
  return makeSignal('ErrorStateDetected', event.runId, Math.min(confidence, 0.90), derivedFrom);
}

// ---------------------------------------------------------------------------
// Deriver 4 — RuntimeErrorObserved
// ---------------------------------------------------------------------------

function deriveRuntimeErrorObserved(
  event: HavocEvent,
  buf: RunBuffer
): Signal | null {
  if (!RUNTIME_ERROR_EVENT_TYPES.has(event.type)) return null;

  const fingerprint = `RuntimeErrorObserved:${event.id}`;
  if (buf.emitted.has(fingerprint)) return null;
  buf.emitted.add(fingerprint);

  return makeSignal('RuntimeErrorObserved', event.runId, 0.98, [event.id]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Feed a HavocEvent into the Signal Engine.
 * Returns zero or more newly derived Signals.
 * Called by the SW on every event as it is constructed — including
 * DOM_OBSERVATION events constructed from DomObservationMessage payloads.
 */
export function processEvent(event: HavocEvent, context?: SignalContext): Signal[] {
  // Check if DOM observation should be coalesced
  if (shouldCoalesceDomEvent(event)) {
    return [];
  }

  const buf = getBuffer(event.runId);
  if (context) {
    buf.context = { ...buf.context, ...context };
  }
  const now = event.timestamp;

  // Evaluate admission against backpressure cap
  const admission = evaluateAdmission(event, buf.events);
  if (!admission.admit) {
    return [];
  }

  // Add the event to the buffer first so derivers can see it.
  buf.events.push(event);
  pruneBuffer(buf, now);

  const signals: Signal[] = [];

  const s1 = deriveRequestFailure(event, buf);
  if (s1 !== null) signals.push(s1);

  const s2 = deriveLoadingState(event, buf);
  if (s2 !== null) signals.push(s2);

  const s3 = deriveErrorState(event, buf);
  if (s3 !== null) signals.push(s3);

  const s4 = deriveRuntimeErrorObserved(event, buf);
  if (s4 !== null) signals.push(s4);

  signals.forEach(logSignal);
  return signals;
}

/**
 * Return a live snapshot of the event buffer and all emitted signals for a run.
 * Used by the recovery window evaluator — called after the window expires so
 * it captures the most recent state, not a snapshot taken at STOPPING time.
 */
export function getRunSnapshot(runId: string): { events: HavocEvent[]; signals: Signal[] } {
  const buf = _buffers.get(runId);
  if (buf === undefined) return { events: [], signals: [] };

  // Return shallow copies so the evaluator cannot mutate the live buffer.
  const events = [...buf.events];

  // Reconstruct signals from derivedFrom provenance stored in the buffer.
  // The buffer only stores events; signals were returned from processEvent()
  // calls and not separately persisted. We rebuild them by re-running the
  // derivers on the current buffer snapshot without emitting (read-only pass).
  const signals = deriveSignalsFromBuffer(buf);

  return { events, signals };
}

/**
 * Re-derive all signals from a buffer snapshot for read-only inspection.
 * Does NOT update the emitted set — purely observational.
 */
function deriveSignalsFromBuffer(buf: RunBuffer): Signal[] {
  const signals: Signal[] = [];
  // We stored emitted fingerprints — use them to reconstruct which signals
  // were derived, pairing each fingerprint back to the signal's source event.
  for (const event of buf.events) {
    // Only re-derive types that were actually emitted to avoid fabricating signals.
    if (buf.emitted.has(`RequestFailureObserved:${event.id}`)) {
      const hasInjectionLink = typeof event.metadata?.injectionId === 'string';
      signals.push(makeSignal('RequestFailureObserved', event.runId, hasInjectionLink ? 0.97 : 0.95, [event.id]));
    }
    if (buf.emitted.has(`LoadingStateDetected:${event.id}`)) {
      // Confidence reconstruction: use 0.70 as the representative value
      // (base 0.50 + proximity 0.20 minimum that caused emission).
      signals.push(makeSignal('LoadingStateDetected', event.runId, 0.70, [event.id]));
    }
    if (buf.emitted.has(`ErrorStateDetected:${event.id}`)) {
      signals.push(makeSignal('ErrorStateDetected', event.runId, 0.60, [event.id]));
    }
    if (buf.emitted.has(`RuntimeErrorObserved:${event.id}`)) {
      signals.push(makeSignal('RuntimeErrorObserved', event.runId, 0.98, [event.id]));
    }
  }
  return signals;
}
