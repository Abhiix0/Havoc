import { describe, it, expect } from 'vitest';
import { deriveFindingFromRuntimeErrors } from '../finding-engine';
import type { HavocEvent } from '../../../domain/event';
import type { Signal } from '../../../domain/signal';

describe('Runtime Error Finding Derivation', () => {
  const runId = 'run-finding-test-1';

  it('returns null finding when zero error signals are present (clean negative)', () => {
    const eventIndex = new Map<string, HavocEvent>();
    const signalIndex = new Map<string, Signal>();

    const result = deriveFindingFromRuntimeErrors(
      runId,
      [],
      [],
      eventIndex,
      signalIndex
    );

    expect(result.finding).toBeNull();
    expect(result.evidence).toEqual([]);
  });

  it('derives MEDIUM finding for 1 distinct error message and links all evidence', () => {
    const event1: HavocEvent = {
      id: 'evt-err-1',
      runId,
      timestamp: 1000,
      sequence: 1,
      type: 'UNCAUGHT_EXCEPTION',
      source: 'page',
      metadata: { message: 'ReferenceError: foo is not defined' },
    };

    const event2: HavocEvent = {
      id: 'evt-err-2',
      runId,
      timestamp: 1500,
      sequence: 2,
      type: 'UNCAUGHT_EXCEPTION',
      source: 'page',
      metadata: { message: 'ReferenceError: foo is not defined' }, // same message
    };

    const signal1: Signal = {
      id: 'sig-err-1',
      runId,
      type: 'RuntimeErrorObserved',
      confidence: 0.98,
      derivedFrom: [event1.id],
      timestamp: 1000,
    };

    const signal2: Signal = {
      id: 'sig-err-2',
      runId,
      type: 'RuntimeErrorObserved',
      confidence: 0.98,
      derivedFrom: [event2.id],
      timestamp: 1500,
    };

    const eventIndex = new Map<string, HavocEvent>([
      [event1.id, event1],
      [event2.id, event2],
    ]);

    const signalIndex = new Map<string, Signal>([
      [signal1.id, signal1],
      [signal2.id, signal2],
    ]);

    const result = deriveFindingFromRuntimeErrors(
      runId,
      [event1, event2],
      [signal1, signal2],
      eventIndex,
      signalIndex
    );

    expect(result.finding).not.toBeNull();
    expect(result.finding?.severity).toBe('MEDIUM');
    expect(result.finding?.confidence).toBeCloseTo(0.98);
    expect(result.finding?.runId).toBe(runId);
    expect(result.finding?.description).toContain('ReferenceError: foo is not defined');
    expect(result.finding?.description).toContain('1 distinct message');

    // Evidence checks
    expect(result.evidence).toHaveLength(4); // 2 events + 2 signals
    expect(result.finding?.evidenceIds).toEqual(result.evidence.map((e) => e.id));

    // Confirm refIds match real event and signal ids
    const eventEvidence = result.evidence.filter((e) => e.kind === 'event');
    const signalEvidence = result.evidence.filter((e) => e.kind === 'signal');
    expect(eventEvidence.map((e) => e.refId)).toEqual([event1.id, event2.id]);
    expect(signalEvidence.map((e) => e.refId)).toEqual([signal1.id, signal2.id]);
  });

  it('derives HIGH finding for 2 or more distinct error messages', () => {
    const event1: HavocEvent = {
      id: 'evt-err-a',
      runId,
      timestamp: 1000,
      sequence: 1,
      type: 'UNCAUGHT_EXCEPTION',
      source: 'page',
      metadata: { message: 'TypeError: Cannot read property "x" of null' },
    };

    const event2: HavocEvent = {
      id: 'evt-err-b',
      runId,
      timestamp: 2000,
      sequence: 2,
      type: 'UNHANDLED_REJECTION',
      source: 'page',
      metadata: { message: 'Network request failed with status 500' },
    };

    const signal1: Signal = {
      id: 'sig-err-a',
      runId,
      type: 'RuntimeErrorObserved',
      confidence: 0.98,
      derivedFrom: [event1.id],
      timestamp: 1000,
    };

    const signal2: Signal = {
      id: 'sig-err-b',
      runId,
      type: 'RuntimeErrorObserved',
      confidence: 0.98,
      derivedFrom: [event2.id],
      timestamp: 2000,
    };

    const eventIndex = new Map<string, HavocEvent>([
      [event1.id, event1],
      [event2.id, event2],
    ]);

    const signalIndex = new Map<string, Signal>([
      [signal1.id, signal1],
      [signal2.id, signal2],
    ]);

    const result = deriveFindingFromRuntimeErrors(
      runId,
      [event1, event2],
      [signal1, signal2],
      eventIndex,
      signalIndex
    );

    expect(result.finding).not.toBeNull();
    expect(result.finding?.severity).toBe('HIGH');
    expect(result.finding?.confidence).toBeCloseTo(0.98);
    expect(result.finding?.description).toContain('2 distinct message(s)');
    expect(result.evidence).toHaveLength(4);
    expect(result.finding?.evidenceIds).toEqual(result.evidence.map((e) => e.id));
  });
});
