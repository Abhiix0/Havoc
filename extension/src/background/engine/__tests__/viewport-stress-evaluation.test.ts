import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { processEvent, clearRunBuffer, getRunSnapshot } from '../signal-engine';
import { deriveFindingFromLayoutOverflow, deriveFromRecoveryResult } from '../finding-engine';
import type { HavocEvent } from '../../../domain/event';
import type { RecoveryWindowResult } from '../recovery-window';

describe('Viewport Stress Evaluation Logic', () => {
  const runId = 'test-vp-eval';

  beforeEach(() => {
    clearRunBuffer(runId);
  });

  it('produces exactly ONE layout-specific Finding when LayoutOverflowDetected is present', () => {
    const chaosEvent: HavocEvent = {
      id: 'chaos-1',
      runId,
      timestamp: 1000,
      sequence: 1,
      type: 'CHAOS_INJECTED',
      source: 'service_worker',
      metadata: { kind: 'viewport_stress' },
    };

    const overflowEvent: HavocEvent = {
      id: 'dom-overflow-1',
      runId,
      timestamp: 1200,
      sequence: 2,
      type: 'DOM_OBSERVATION',
      source: 'content',
      metadata: {
        kind: 'layout_overflow_detected',
        selector: 'html',
        textSnippet: 'overflow 95px',
      },
    };

    processEvent(chaosEvent);
    processEvent(overflowEvent);

    const snapshot = getRunSnapshot(runId);
    const eventIndex = new Map(snapshot.events.map((e) => [e.id, e]));
    const signalIndex = new Map(snapshot.signals.map((s) => [s.id, s]));

    const overflowSignals = snapshot.signals.filter((s) => s.type === 'LayoutOverflowDetected');
    expect(overflowSignals).toHaveLength(1);

    const result = deriveFindingFromLayoutOverflow(
      runId,
      overflowSignals,
      eventIndex,
      signalIndex
    );

    expect(result.finding).not.toBeNull();
    expect(result.finding?.checkKind).toBe('viewport_stress');
    expect(result.finding?.severity).toBe('MEDIUM');
    expect(result.finding?.description).toContain('overflow 95px');
    expect(result.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to deriveFromRecoveryResult (null finding / UNKNOWN outcome) when no overflow occurred', () => {
    const chaosEvent: HavocEvent = {
      id: 'chaos-1',
      runId,
      timestamp: 1000,
      sequence: 1,
      type: 'CHAOS_INJECTED',
      source: 'service_worker',
      metadata: { kind: 'viewport_stress' },
    };

    processEvent(chaosEvent);

    const snapshot = getRunSnapshot(runId);
    const eventIndex = new Map(snapshot.events.map((e) => [e.id, e]));
    const signalIndex = new Map(snapshot.signals.map((s) => [s.id, s]));

    const overflowSignals = snapshot.signals.filter((s) => s.type === 'LayoutOverflowDetected');
    expect(overflowSignals).toHaveLength(0);

    const dummyRecoveryResult: RecoveryWindowResult = {
      recovery: {
        id: 'rec-1',
        runId,
        outcome: 'UNKNOWN',
        windowStart: 1000,
        windowEnd: 8000,
        evaluatedAt: 8000,
      },
      contributingEventIds: [],
      contributingSignalIds: [],
    };

    const result = deriveFromRecoveryResult(
      runId,
      dummyRecoveryResult,
      eventIndex,
      signalIndex,
      'viewport_stress'
    );

    expect(result.finding).toBeNull();
    expect(result.evidence).toHaveLength(1); // metric evidence
  });
});
