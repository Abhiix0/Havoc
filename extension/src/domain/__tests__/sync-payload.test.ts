import { describe, it, expect } from 'vitest';
import type { ShipCheckRun } from '../ship-check';
import type { Finding } from '../finding';
import type { Remediation } from '../remediation';
import type { Evidence } from '../evidence';
import { buildSyncPayload } from '../sync-payload';

describe('buildSyncPayload', () => {
  const baseTarget = {
    tabId: 42,
    origin: 'https://example.com',
    url: 'https://example.com/checkout',
    frameId: 0 as const,
  };

  it('1. throws an error when ShipCheckRun completedAt is unset (incomplete check)', () => {
    const incompleteRun: ShipCheckRun = {
      shipCheckId: 'sc-incomplete-1',
      target: baseTarget,
      readiness: 'UNKNOWN',
      createdAt: 1000,
      completedAt: undefined,
      steps: [
        { kind: 'fetch_latency', runId: 'r-1', status: 'DONE' },
      ],
    };

    expect(() =>
      buildSyncPayload(incompleteRun, [], [], new Map())
    ).toThrow('Cannot build sync payload for an incomplete Ship Check (completedAt is undefined)');
  });

  it('throws an error if any step has a non-terminal status (PENDING or RUNNING)', () => {
    const runningStepRun: ShipCheckRun = {
      shipCheckId: 'sc-running-step',
      target: baseTarget,
      readiness: 'UNKNOWN',
      createdAt: 1000,
      completedAt: 2000,
      steps: [
        { kind: 'fetch_latency', runId: 'r-1', status: 'RUNNING' },
      ],
    };

    expect(() =>
      buildSyncPayload(runningStepRun, [], [], new Map())
    ).toThrow('Cannot build sync payload with non-terminal step status: RUNNING');
  });

  it('2. maps a completed run with 2 steps, 1 HIGH finding with evidence and remediation to exact schema without extra internal keys', () => {
    const shipCheck: ShipCheckRun = {
      shipCheckId: 'sc-100',
      target: baseTarget,
      readiness: 'BLOCKED',
      createdAt: 1000,
      completedAt: 5000,
      steps: [
        { kind: 'fetch_latency', runId: 'r-lat-1', status: 'DONE' },
        { kind: 'fetch_failure', runId: 'r-fail-1', status: 'ERRORED' },
      ],
    };

    const finding: Finding = {
      id: 'f-1',
      runId: 'r-lat-1',
      severity: 'HIGH',
      confidence: 0.95,
      description: 'Slow API response on checkout',
      evidenceIds: ['ev-1'],
      checkKind: 'fetch_latency',
      recoveryId: 'rec-1', // internal-only field — must NOT leak
    };

    const evidenceItem: Evidence = {
      id: 'ev-1',
      runId: 'r-lat-1',
      kind: 'event',
      refId: 'ref-req-123',
      capturedAt: 1200,
    };

    const remediation: Remediation = {
      id: 'rem-1', // internal-only field — must NOT leak
      findingId: 'f-1',
      runId: 'r-lat-1', // internal-only field — must NOT leak
      title: 'Optimize API Latency',
      whatHappened: 'Fetch request took 3500ms',
      whyItMatters: 'Users will drop off before checkout completes',
      howToFix: ['Add caching', 'Use optimistic UI updates'],
      fixPrompt: 'Improve response time for /api/checkout',
    };

    const evidenceMap = new Map<string, Evidence[]>([
      ['f-1', [evidenceItem]],
    ]);

    const payload = buildSyncPayload(shipCheck, [finding], [remediation], evidenceMap);

    // Assert top-level payload shape and exact keys
    expect(Object.keys(payload).sort()).toEqual([
      'clientShipCheckId',
      'completedAt',
      'createdAt',
      'findings',
      'readiness',
      'steps',
      'targetOrigin',
    ]);
    expect(payload.clientShipCheckId).toBe('sc-100');
    expect(payload.targetOrigin).toBe('https://example.com');
    expect(payload.readiness).toBe('BLOCKED');
    expect(payload.createdAt).toBe(1000);
    expect(payload.completedAt).toBe(5000);

    // Assert steps mapping and keys
    expect(payload.steps).toHaveLength(2);
    const step0 = payload.steps[0]!;
    const step1 = payload.steps[1]!;
    expect(step0).toEqual({
      kind: 'fetch_latency',
      status: 'DONE',
      ordinal: 0,
    });
    expect(Object.keys(step0).sort()).toEqual(['kind', 'ordinal', 'status']);
    expect(step1).toEqual({
      kind: 'fetch_failure',
      status: 'ERRORED',
      ordinal: 1,
    });

    // Assert finding mapping and keys
    expect(payload.findings).toHaveLength(1);
    const syncFinding = payload.findings[0]!;
    expect(Object.keys(syncFinding).sort()).toEqual([
      'checkKind',
      'clientFindingId',
      'confidence',
      'description',
      'evidence',
      'remediation',
      'severity',
    ]);
    expect(syncFinding.clientFindingId).toBe('f-1');
    expect(syncFinding.checkKind).toBe('fetch_latency');
    expect(syncFinding.severity).toBe('HIGH');
    expect(syncFinding.confidence).toBe(0.95);
    expect(syncFinding.description).toBe('Slow API response on checkout');

    // Assert evidence mapping and keys (no internal `id` or `runId`)
    expect(syncFinding.evidence).toHaveLength(1);
    const ev0 = syncFinding.evidence[0]!;
    expect(ev0).toEqual({
      kind: 'event',
      refId: 'ref-req-123',
      capturedAt: 1200,
    });
    expect(Object.keys(ev0).sort()).toEqual(['capturedAt', 'kind', 'refId']);

    // Assert remediation mapping and keys (no internal `id`, `findingId`, or `runId`)
    expect(syncFinding.remediation).toEqual({
      title: 'Optimize API Latency',
      whatHappened: 'Fetch request took 3500ms',
      whyItMatters: 'Users will drop off before checkout completes',
      howToFix: ['Add caching', 'Use optimistic UI updates'],
      fixPrompt: 'Improve response time for /api/checkout',
    });
    expect(Object.keys(syncFinding.remediation!).sort()).toEqual([
      'fixPrompt',
      'howToFix',
      'title',
      'whatHappened',
      'whyItMatters',
    ]);
  });

  it('3. finding with no remediation produces remediation: undefined rather than an empty object', () => {
    const shipCheck: ShipCheckRun = {
      shipCheckId: 'sc-200',
      target: baseTarget,
      readiness: 'READY',
      createdAt: 1000,
      completedAt: 3000,
      steps: [
        { kind: 'runtime_errors', runId: 'r-rt-1', status: 'DONE' },
      ],
    };

    const findingWithoutRem: Finding = {
      id: 'f-no-rem',
      runId: 'r-rt-1',
      severity: 'LOW',
      confidence: 0.5,
      description: 'Minor non-blocking issue',
      evidenceIds: [],
    };

    const payload = buildSyncPayload(shipCheck, [findingWithoutRem], [], new Map());

    expect(payload.findings).toHaveLength(1);
    const finding0 = payload.findings[0]!;
    expect(finding0.remediation).toBeUndefined();
    expect('remediation' in finding0).toBe(false);
  });

  it('4. correctly correlates findings, evidence, and remediation across input collections (mismatched IDs do not crash)', () => {
    const shipCheck: ShipCheckRun = {
      shipCheckId: 'sc-300',
      target: baseTarget,
      readiness: 'NEEDS_ATTENTION',
      createdAt: 1000,
      completedAt: 4000,
      steps: [
        { kind: 'input_stress', runId: 'r-inp-1', status: 'DONE' },
        { kind: 'viewport_stress', runId: 'r-vp-1', status: 'SKIPPED' },
      ],
    };

    const finding1: Finding = {
      id: 'f-matched',
      runId: 'r-inp-1',
      severity: 'MEDIUM',
      confidence: 0.8,
      description: 'Input overflow',
      evidenceIds: ['ev-match'],
    };

    const finding2: Finding = {
      id: 'f-unmatched',
      runId: 'r-inp-1',
      severity: 'LOW',
      confidence: 0.4,
      description: 'Orphan finding',
      evidenceIds: ['ev-orphan'],
    };

    const evidenceMatched: Evidence = {
      id: 'ev-match',
      runId: 'r-inp-1',
      kind: 'signal',
      refId: 'sig-1',
      capturedAt: 1500,
    };

    const remediationMatched: Remediation = {
      id: 'rem-match',
      findingId: 'f-matched',
      runId: 'r-inp-1',
      title: 'Fix Input Overflow',
      whatHappened: 'Form broke on long text',
      whyItMatters: 'Input is unusable on long entries',
      howToFix: ['Add maxLength attribute'],
      fixPrompt: 'Add maxLength to inputs',
    };

    const remediationOrphan: Remediation = {
      id: 'rem-orphan',
      findingId: 'f-nonexistent',
      runId: 'r-inp-1',
      title: 'Orphan Remediation',
      whatHappened: 'None',
      whyItMatters: 'None',
      howToFix: [],
      fixPrompt: '',
    };

    const evidenceMap = new Map<string, Evidence[]>([
      ['f-matched', [evidenceMatched]],
      ['f-other-nonexistent', [{ id: 'e-x', runId: 'r-1', kind: 'event', refId: 'x', capturedAt: 100 }]],
    ]);

    const payload = buildSyncPayload(
      shipCheck,
      [finding1, finding2],
      [remediationMatched, remediationOrphan],
      evidenceMap
    );

    expect(payload.findings).toHaveLength(2);
    const findingA = payload.findings[0]!;
    const findingB = payload.findings[1]!;

    // finding1 has matching evidence & remediation
    expect(findingA.clientFindingId).toBe('f-matched');
    expect(findingA.evidence).toHaveLength(1);
    expect(findingA.evidence[0]!.refId).toBe('sig-1');
    expect(findingA.remediation?.title).toBe('Fix Input Overflow');

    // finding2 has no matching evidence in map and no matching remediation
    expect(findingB.clientFindingId).toBe('f-unmatched');
    expect(findingB.evidence).toEqual([]);
    expect(findingB.remediation).toBeUndefined();
  });
});
