import { describe, it, expect } from 'vitest';
import { deriveFindingFromSecretMatches } from '../finding-engine';
import type { HavocEvent } from '../../../domain/event';
import type { Signal } from '../../../domain/signal';

describe('Secret Finding Derivation', () => {
  const runId = 'run-sec-finding-1';
  const disclaimerSentence =
    'This is a heuristic exposure check, not a guarantee of security. Absence of a finding does not mean your application has no exposed secrets.';

  it('returns null finding when zero match signals are present', () => {
    const eventIndex = new Map<string, HavocEvent>();
    const signalIndex = new Map<string, Signal>();

    const result = deriveFindingFromSecretMatches(
      runId,
      [],
      [],
      eventIndex,
      signalIndex
    );

    expect(result.finding).toBeNull();
    expect(result.evidence).toEqual([]);
  });

  it('derives HIGH finding when at least one HIGH severity pattern is matched, containing disclaimer sentence', () => {
    const event1: HavocEvent = {
      id: 'evt-sec-high',
      runId,
      timestamp: 1000,
      sequence: 1,
      type: 'SECRET_PATTERN_MATCH',
      source: 'service_worker',
      metadata: {
        patternId: 'aws_access_key',
        label: 'AWS Access Key',
        severity: 'HIGH',
        redacted: 'AKIA...[REDACTED]...1234',
        sourceDescription: 'inline <script> tag',
      },
    };

    const signal1: Signal = {
      id: 'sig-sec-high',
      runId,
      type: 'SecretPatternDetected',
      confidence: 0.6,
      derivedFrom: [event1.id],
      timestamp: 1000,
    };

    const eventIndex = new Map<string, HavocEvent>([[event1.id, event1]]);
    const signalIndex = new Map<string, Signal>([[signal1.id, signal1]]);

    const result = deriveFindingFromSecretMatches(
      runId,
      [event1],
      [signal1],
      eventIndex,
      signalIndex
    );

    expect(result.finding).not.toBeNull();
    expect(result.finding?.severity).toBe('HIGH');
    expect(result.finding?.confidence).toBe(0.6);
    expect(result.finding?.description).toContain(disclaimerSentence);
    expect(result.finding?.description).toContain('AWS Access Key');
    expect(result.finding?.description).toContain('inline <script> tag');
    expect(result.evidence).toHaveLength(2);
    expect(result.finding?.evidenceIds).toEqual(result.evidence.map((e) => e.id));
  });

  it('derives MEDIUM finding when only MEDIUM severity patterns are matched', () => {
    const event1: HavocEvent = {
      id: 'evt-sec-med',
      runId,
      timestamp: 1000,
      sequence: 1,
      type: 'SECRET_PATTERN_MATCH',
      source: 'service_worker',
      metadata: {
        patternId: 'generic_api_key',
        label: 'Generic API Key Assignment',
        severity: 'MEDIUM',
        redacted: 'api_...[REDACTED]...789"',
        sourceDescription: 'external script: https://example.com/app.js',
      },
    };

    const signal1: Signal = {
      id: 'sig-sec-med',
      runId,
      type: 'SecretPatternDetected',
      confidence: 0.6,
      derivedFrom: [event1.id],
      timestamp: 1000,
    };

    const eventIndex = new Map<string, HavocEvent>([[event1.id, event1]]);
    const signalIndex = new Map<string, Signal>([[signal1.id, signal1]]);

    const result = deriveFindingFromSecretMatches(
      runId,
      [event1],
      [signal1],
      eventIndex,
      signalIndex
    );

    expect(result.finding).not.toBeNull();
    expect(result.finding?.severity).toBe('MEDIUM');
    expect(result.finding?.confidence).toBe(0.6);
    expect(result.finding?.description).toContain(disclaimerSentence);
    expect(result.finding?.description).toContain('Generic API Key Assignment');
  });
});
