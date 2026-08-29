/**
 * autopsy.test.ts — three golden test scenarios for the Recovery Window
 * evaluator and Finding Engine.
 *
 * These tests exercise the pure evaluation logic (evaluateRecovery + deriveFinding)
 * directly — no Chrome APIs, no async waiting, no extension context required.
 *
 * Scenario A — failure → clean recovery → RECOVERED, no Finding
 * Scenario B — failure → ambiguous state → UNKNOWN, no Finding (and critically,
 *              no unjustified HIGH-severity Finding)
 * Scenario C — failure → no recovery evidence → FAILED → HIGH Finding with real evidence
 */

import { describe, it, expect } from 'vitest';
import { evaluateRecovery } from '../recovery-window';
import { deriveFinding } from '../finding-engine';
import type { HavocEvent } from '../../../domain/event';
import type { Signal } from '../../../domain/signal';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let _seq = 0;
function seq(): number { return ++_seq; }

function makeFailureEvent(
  overrides: Partial<HavocEvent> & { url: string; injectionId: string; ts: number }
): HavocEvent {
  return {
    id: crypto.randomUUID(),
    runId: 'run-test',
    timestamp: overrides.ts,
    sequence: seq(),
    type: 'REQUEST_TRANSPORT_FAILURE',
    source: 'page',
    resource: overrides.url,
    metadata: { injectionId: overrides.injectionId, status: 0, duration: 0, transport: 'fetch', method: 'GET' },
    ...overrides,
  };
}

function makeSuccessEvent(overrides: { url: string; ts: number }): HavocEvent {
  return {
    id: crypto.randomUUID(),
    runId: 'run-test',
    timestamp: overrides.ts,
    sequence: seq(),
    type: 'REQUEST_COMPLETED',
    source: 'page',
    resource: overrides.url,
    metadata: { status: 200, duration: 80, transport: 'fetch', method: 'GET' },
  };
}

function makeLoadingRemovedEvent(ts: number): HavocEvent {
  return {
    id: crypto.randomUUID(),
    runId: 'run-test',
    timestamp: ts,
    sequence: seq(),
    type: 'DOM_OBSERVATION',
    source: 'content',
    metadata: { kind: 'loading_indicator_removed', selector: '.spinner', textSnippet: '' },
  };
}

function makeErrorTextEvent(ts: number): HavocEvent {
  return {
    id: crypto.randomUUID(),
    runId: 'run-test',
    timestamp: ts,
    sequence: seq(),
    type: 'DOM_OBSERVATION',
    source: 'content',
    metadata: { kind: 'error_text_appeared', selector: '.toast-error', textSnippet: 'Failed to load data' },
  };
}

function makeRequestFailureSignal(eventId: string, confidence = 0.97): Signal {
  return {
    id: crypto.randomUUID(),
    runId: 'run-test',
    type: 'RequestFailureObserved',
    confidence,
    derivedFrom: [eventId],
    timestamp: Date.now(),
  };
}

function makeErrorStateSignal(eventId: string, confidence = 0.75): Signal {
  return {
    id: crypto.randomUUID(),
    runId: 'run-test',
    type: 'ErrorStateDetected',
    confidence,
    derivedFrom: [eventId],
    timestamp: Date.now(),
  };
}

function buildIndexes(
  events: HavocEvent[],
  signals: Signal[]
): { eventIndex: Map<string, HavocEvent>; signalIndex: Map<string, Signal> } {
  return {
    eventIndex: new Map(events.map((e) => [e.id, e])),
    signalIndex: new Map(signals.map((s) => [s.id, s])),
  };
}

// ---------------------------------------------------------------------------
// Scenario A: failure → clean recovery → RECOVERED, no Finding
// ---------------------------------------------------------------------------

describe('Scenario A — failure then clean recovery', () => {
  const INJECTION_ID = crypto.randomUUID();
  const URL = 'https://api.example.com/data';
  const CHAOS_END = 1_000_000; // arbitrary epoch ms
  const WINDOW_END = CHAOS_END + 8_000;

  // During chaos: one transport failure with injectionId
  const failureEvent = makeFailureEvent({ url: URL, injectionId: INJECTION_ID, ts: CHAOS_END - 500 });
  // After chaos: a successful retry for the same URL
  const successEvent = makeSuccessEvent({ url: URL, ts: CHAOS_END + 1_200 });

  const failureSig = makeRequestFailureSignal(failureEvent.id, 0.97);
  const events = [failureEvent, successEvent];
  const signals = [failureSig];

  it('resolves to RECOVERED', () => {
    const result = evaluateRecovery({
      runId: 'run-test',
      chaosEndTime: CHAOS_END,
      windowEnd: WINDOW_END,
      events,
      signals,
    });
    expect(result.recovery.outcome).toBe('RECOVERED');
  });

  it('does not produce a Finding', () => {
    const result = evaluateRecovery({
      runId: 'run-test',
      chaosEndTime: CHAOS_END,
      windowEnd: WINDOW_END,
      events,
      signals,
    });
    const { eventIndex, signalIndex } = buildIndexes(events, signals);
    const { finding, evidence } = deriveFinding({
      runId: 'run-test',
      recovery: result.recovery,
      contributingEventIds: result.contributingEventIds,
      contributingSignalIds: result.contributingSignalIds,
      eventIndex,
      signalIndex,
    });
    expect(finding).toBeNull();
    // Evidence is still built — recovery record is always wrapped
    expect(evidence.length).toBeGreaterThan(0);
    // Every evidence item has a non-empty id and refId
    for (const ev of evidence) {
      expect(ev.id).toBeTruthy();
      expect(ev.refId).toBeTruthy();
    }
  });

  it('includes the success event id in contributingEventIds', () => {
    const result = evaluateRecovery({
      runId: 'run-test',
      chaosEndTime: CHAOS_END,
      windowEnd: WINDOW_END,
      events,
      signals,
    });
    expect(result.contributingEventIds).toContain(successEvent.id);
  });
});

// ---------------------------------------------------------------------------
// Scenario B: failure → ambiguous state → UNKNOWN, no unjustified HIGH Finding
// ---------------------------------------------------------------------------
//
// What makes this UNKNOWN:
//   - A chaos-linked failure occurred (injectionId present)
//   - An ErrorStateDetected signal was derived (DOM showed error text)
//   - BUT: no successful retry for the failed URL appeared
//   - AND: no loading_indicator_removed appeared (no sign of retry in progress)
//
// This means FAILED predicate also can't fire, because FAILED requires
// chaos-linked failures + no recovery evidence, but we DO have an ErrorStateDetected
// signal present — which is corroborating evidence of effect, but without a
// loading recovery we can't say DEGRADED either.
//
// Result: the evidence is real but insufficient to conclude.
// UNKNOWN is the CORRECT answer here — not a bug.
// ---------------------------------------------------------------------------

describe('Scenario B — ambiguous state (UNKNOWN)', () => {
  const INJECTION_ID = crypto.randomUUID();
  const URL = 'https://api.example.com/items';
  const CHAOS_END = 2_000_000;
  const WINDOW_END = CHAOS_END + 8_000;

  const failureEvent = makeFailureEvent({ url: URL, injectionId: INJECTION_ID, ts: CHAOS_END - 300 });
  const errorDomEvent = makeErrorTextEvent(CHAOS_END + 200);
  // No success event. No loading_indicator_removed.

  const failureSig = makeRequestFailureSignal(failureEvent.id, 0.97);
  const errorSig = makeErrorStateSignal(errorDomEvent.id, 0.60);

  const events = [failureEvent, errorDomEvent];
  const signals = [failureSig, errorSig];

  it('resolves to UNKNOWN', () => {
    const result = evaluateRecovery({
      runId: 'run-test',
      chaosEndTime: CHAOS_END,
      windowEnd: WINDOW_END,
      events,
      signals,
    });
    expect(result.recovery.outcome).toBe('UNKNOWN');
  });

  it('does not produce any Finding at all', () => {
    const result = evaluateRecovery({
      runId: 'run-test',
      chaosEndTime: CHAOS_END,
      windowEnd: WINDOW_END,
      events,
      signals,
    });
    const { eventIndex, signalIndex } = buildIndexes(events, signals);
    const { finding } = deriveFinding({
      runId: 'run-test',
      recovery: result.recovery,
      contributingEventIds: result.contributingEventIds,
      contributingSignalIds: result.contributingSignalIds,
      eventIndex,
      signalIndex,
    });
    expect(finding).toBeNull();
  });

  it('specifically does NOT produce a HIGH-severity Finding', () => {
    // This assertion is the key contract: UNKNOWN must never escalate to HIGH.
    const result = evaluateRecovery({
      runId: 'run-test',
      chaosEndTime: CHAOS_END,
      windowEnd: WINDOW_END,
      events,
      signals,
    });
    const { eventIndex, signalIndex } = buildIndexes(events, signals);
    const { finding } = deriveFinding({
      runId: 'run-test',
      recovery: result.recovery,
      contributingEventIds: result.contributingEventIds,
      contributingSignalIds: result.contributingSignalIds,
      eventIndex,
      signalIndex,
    });
    expect(finding?.severity).not.toBe('HIGH');
  });

  it('has fragmentary contributing evidence (not empty — evidence is real)', () => {
    const result = evaluateRecovery({
      runId: 'run-test',
      chaosEndTime: CHAOS_END,
      windowEnd: WINDOW_END,
      events,
      signals,
    });
    // Even for UNKNOWN there is real (fragmentary) evidence.
    expect(result.contributingEventIds.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario C: failure → no recovery evidence → FAILED → HIGH Finding
// ---------------------------------------------------------------------------

describe('Scenario C — no recovery evidence (FAILED → HIGH Finding)', () => {
  const INJECTION_ID = crypto.randomUUID();
  const URL = 'https://api.example.com/orders';
  const CHAOS_END = 3_000_000;
  const WINDOW_END = CHAOS_END + 8_000;

  // Chaos-linked failures, nothing else in the window.
  const failure1 = makeFailureEvent({ url: URL, injectionId: INJECTION_ID, ts: CHAOS_END - 800 });
  const failure2 = makeFailureEvent({ url: URL, injectionId: INJECTION_ID, ts: CHAOS_END - 400 });
  // No success events, no DOM observations.

  const sig1 = makeRequestFailureSignal(failure1.id, 0.97);
  const sig2 = makeRequestFailureSignal(failure2.id, 0.97);

  const events = [failure1, failure2];
  const signals = [sig1, sig2];

  it('resolves to FAILED', () => {
    const result = evaluateRecovery({
      runId: 'run-test',
      chaosEndTime: CHAOS_END,
      windowEnd: WINDOW_END,
      events,
      signals,
    });
    expect(result.recovery.outcome).toBe('FAILED');
  });

  it('produces a Finding', () => {
    const result = evaluateRecovery({
      runId: 'run-test',
      chaosEndTime: CHAOS_END,
      windowEnd: WINDOW_END,
      events,
      signals,
    });
    const { eventIndex, signalIndex } = buildIndexes(events, signals);
    const { finding } = deriveFinding({
      runId: 'run-test',
      recovery: result.recovery,
      contributingEventIds: result.contributingEventIds,
      contributingSignalIds: result.contributingSignalIds,
      eventIndex,
      signalIndex,
    });
    expect(finding).not.toBeNull();
  });

  it('Finding has HIGH severity', () => {
    const result = evaluateRecovery({
      runId: 'run-test',
      chaosEndTime: CHAOS_END,
      windowEnd: WINDOW_END,
      events,
      signals,
    });
    const { eventIndex, signalIndex } = buildIndexes(events, signals);
    const { finding } = deriveFinding({
      runId: 'run-test',
      recovery: result.recovery,
      contributingEventIds: result.contributingEventIds,
      contributingSignalIds: result.contributingSignalIds,
      eventIndex,
      signalIndex,
    });
    expect(finding?.severity).toBe('HIGH');
  });

  it('every evidenceId traces back to a real Evidence record', () => {
    const result = evaluateRecovery({
      runId: 'run-test',
      chaosEndTime: CHAOS_END,
      windowEnd: WINDOW_END,
      events,
      signals,
    });
    const { eventIndex, signalIndex } = buildIndexes(events, signals);
    const { finding, evidence } = deriveFinding({
      runId: 'run-test',
      recovery: result.recovery,
      contributingEventIds: result.contributingEventIds,
      contributingSignalIds: result.contributingSignalIds,
      eventIndex,
      signalIndex,
    });

    expect(finding).not.toBeNull();
    const evidenceById = new Map(evidence.map((e) => [e.id, e]));

    for (const eid of finding!.evidenceIds) {
      const ev = evidenceById.get(eid);
      expect(ev, `evidenceId ${eid} must resolve to a real Evidence object`).toBeDefined();
      // The refId must point to a real event, signal, or recovery record.
      const refIsEvent = eventIndex.has(ev!.refId);
      const refIsSignal = signalIndex.has(ev!.refId);
      const refIsRecovery = ev!.refId === result.recovery.id;
      expect(
        refIsEvent || refIsSignal || refIsRecovery,
        `Evidence refId ${ev!.refId} must point to a real event, signal, or recovery`
      ).toBe(true);
    }
  });

  it('Finding has recoveryId linking back to the Recovery record', () => {
    const result = evaluateRecovery({
      runId: 'run-test',
      chaosEndTime: CHAOS_END,
      windowEnd: WINDOW_END,
      events,
      signals,
    });
    const { eventIndex, signalIndex } = buildIndexes(events, signals);
    const { finding } = deriveFinding({
      runId: 'run-test',
      recovery: result.recovery,
      contributingEventIds: result.contributingEventIds,
      contributingSignalIds: result.contributingSignalIds,
      eventIndex,
      signalIndex,
    });
    expect(finding?.recoveryId).toBe(result.recovery.id);
  });
});
