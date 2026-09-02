import { describe, it, expect } from 'vitest';
import { deriveFindingFromLayoutOverflow } from '../finding-engine';
import type { HavocEvent } from '../../../domain/event';
import type { Signal } from '../../../domain/signal';

describe('Layout Overflow Finding Derivation', () => {
  const runId = 'run-layout-test';

  it('returns null finding and empty evidence when zero overflow signals are present', () => {
    const result = deriveFindingFromLayoutOverflow(
      runId,
      [],
      new Map<string, HavocEvent>(),
      new Map<string, Signal>()
    );

    expect(result.finding).toBeNull();
    expect(result.evidence).toEqual([]);
  });

  it('derives a MEDIUM finding with real overflow amount pulled from underlying event textSnippet', () => {
    const overflowEvent: HavocEvent = {
      id: 'evt-dom-overflow-143',
      runId,
      timestamp: 2000,
      sequence: 1,
      type: 'DOM_OBSERVATION',
      source: 'content',
      metadata: {
        kind: 'layout_overflow_detected',
        selector: 'html',
        textSnippet: 'overflow 143px',
      },
    };

    const overflowSignal: Signal = {
      id: 'sig-overflow-143',
      runId,
      type: 'LayoutOverflowDetected',
      confidence: 0.95,
      derivedFrom: ['evt-dom-overflow-143'],
      timestamp: 2000,
    };

    const eventIndex = new Map<string, HavocEvent>([[overflowEvent.id, overflowEvent]]);
    const signalIndex = new Map<string, Signal>([[overflowSignal.id, overflowSignal]]);

    const result = deriveFindingFromLayoutOverflow(
      runId,
      [overflowSignal],
      eventIndex,
      signalIndex
    );

    expect(result.finding).not.toBeNull();
    const finding = result.finding!;
    expect(finding.runId).toBe(runId);
    expect(finding.severity).toBe('MEDIUM');
    expect(finding.confidence).toBe(0.95);
    expect(finding.checkKind).toBe('viewport_stress');
    expect(finding.description).toContain('overflow 143px');
    expect(finding.description).toContain('Horizontal layout overflow detected');
    expect(result.evidence.length).toBeGreaterThanOrEqual(2); // signal + event
  });
});
