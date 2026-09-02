import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  saveRun,
  getRun,
  getAllRuns,
  saveEvent,
  saveEvents,
  getEventsByRunId,
  saveSignal,
  saveSignals,
  getSignalsByRunId,
  saveFinding,
  getFindingsByRunId,
  saveEvidence,
  saveAllEvidence,
  getEvidenceByRunId,
  saveRecovery,
  getRecoveryByRunId,
  saveRemediation,
  getRemediationsByFindingId,
  getRemediationsByRunId,
  deleteRunCascade,
  applyRetention,
} from '../repository';
import type { ExperimentRun } from '../../domain/run';
import type { HavocEvent } from '../../domain/event';
import type { Signal } from '../../domain/signal';
import type { Finding } from '../../domain/finding';
import type { Evidence } from '../../domain/evidence';
import type { Recovery } from '../../domain/recovery';
import type { Remediation } from '../../domain/remediation';

import { closeDatabase } from '../database';

describe('HAVOC Storage Repository', () => {
  beforeEach(async () => {
    // Cleanly close connection and delete database before each test
    closeDatabase();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('havoc');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  });

  it('saves, updates, and retrieves ExperimentRuns', async () => {
    const run: ExperimentRun = {
      runId: 'run-1',
      target: { tabId: 1, origin: 'https://example.com', url: 'https://example.com/app', frameId: 0 },
      definition: { id: 'exp-1', name: 'Latency Test', description: 'Test latency', kind: 'fetch_latency', params: { delayMs: 1000 } },
      state: 'CREATED',
      createdAt: 1000,
      updatedAt: 1000,
    };

    await saveRun(run);
    const retrieved = await getRun('run-1');
    expect(retrieved).toEqual(run);

    // Update state
    const updatedRun: ExperimentRun = { ...run, state: 'ACTIVE', updatedAt: 2000 };
    await saveRun(updatedRun);
    const retrievedUpdated = await getRun('run-1');
    expect(retrievedUpdated?.state).toBe('ACTIVE');
    expect(retrievedUpdated?.updatedAt).toBe(2000);

    const allRuns = await getAllRuns();
    expect(allRuns).toHaveLength(1);
  });

  it('saves and retrieves events ordered by sequence', async () => {
    const event1: HavocEvent = {
      id: 'e1',
      runId: 'run-1',
      timestamp: 1000,
      sequence: 2,
      type: 'REQUEST_COMPLETED',
      source: 'page',
      resource: 'https://example.com/api',
    };
    const event2: HavocEvent = {
      id: 'e2',
      runId: 'run-1',
      timestamp: 900,
      sequence: 1,
      type: 'CHAOS_INJECTED',
      source: 'service_worker',
    };
    const eventOtherRun: HavocEvent = {
      id: 'e3',
      runId: 'run-2',
      timestamp: 1100,
      sequence: 1,
      type: 'REQUEST_COMPLETED',
      source: 'page',
    };

    await saveEvents([event1, event2, eventOtherRun]);

    const run1Events = await getEventsByRunId('run-1');
    expect(run1Events).toHaveLength(2);
    expect(run1Events[0]?.id).toBe('e2'); // sequence 1
    expect(run1Events[1]?.id).toBe('e1'); // sequence 2
  });

  it('saves and retrieves signals by runId', async () => {
    const signal1: Signal = {
      id: 's1',
      runId: 'run-1',
      type: 'RequestFailureObserved',
      confidence: 0.97,
      derivedFrom: ['e1'],
      timestamp: 1000,
    };
    const signal2: Signal = {
      id: 's2',
      runId: 'run-1',
      type: 'ErrorStateDetected',
      confidence: 0.85,
      derivedFrom: ['e2'],
      timestamp: 1050,
    };
    const signalOther: Signal = {
      id: 's3',
      runId: 'run-2',
      type: 'RequestFailureObserved',
      confidence: 0.95,
      derivedFrom: ['e3'],
      timestamp: 1000,
    };

    await saveSignals([signal1, signal2, signalOther]);

    const run1Signals = await getSignalsByRunId('run-1');
    expect(run1Signals).toHaveLength(2);
    expect(run1Signals.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('saves and retrieves findings, evidence, and recovery records', async () => {
    const recovery: Recovery = {
      id: 'rec-1',
      runId: 'run-1',
      outcome: 'FAILED',
      windowStart: 1000,
      windowEnd: 9000,
      evaluatedAt: 9000,
    };
    const evidence1: Evidence = {
      id: 'ev-1',
      runId: 'run-1',
      kind: 'event',
      refId: 'e1',
      capturedAt: 9000,
    };
    const evidence2: Evidence = {
      id: 'ev-2',
      runId: 'run-1',
      kind: 'metric',
      refId: 'rec-1',
      capturedAt: 9000,
    };
    const finding: Finding = {
      id: 'f-1',
      runId: 'run-1',
      severity: 'HIGH',
      confidence: 0.95,
      description: 'App failed to recover',
      evidenceIds: ['ev-1', 'ev-2'],
      recoveryId: 'rec-1',
    };

    await saveRecovery(recovery);
    await saveAllEvidence([evidence1, evidence2]);
    await saveFinding(finding);

    const retrievedRecovery = await getRecoveryByRunId('run-1');
    expect(retrievedRecovery).toEqual(recovery);

    const retrievedEvidence = await getEvidenceByRunId('run-1');
    expect(retrievedEvidence).toHaveLength(2);
    expect(retrievedEvidence.map((e) => e.id)).toEqual(['ev-1', 'ev-2']);

    const retrievedFindings = await getFindingsByRunId('run-1');
    expect(retrievedFindings).toHaveLength(1);
    expect(retrievedFindings[0]).toEqual(finding);
  });

  it('cascade-deletes ALL associated records across all stores with no orphans', async () => {
    // Populate run 1 with full set of records
    const run1: ExperimentRun = {
      runId: 'run-1',
      target: { tabId: 1, origin: 'https://example.com', url: 'https://example.com', frameId: 0 },
      definition: { id: 'exp-1', name: 'Failure Test', description: 'Test failure', kind: 'fetch_failure', params: {} },
      state: 'COMPLETED',
      createdAt: 1000,
      updatedAt: 2000,
    };
    const event1: HavocEvent = { id: 'e-1', runId: 'run-1', timestamp: 1100, sequence: 1, type: 'CHAOS_INJECTED', source: 'service_worker' };
    const signal1: Signal = { id: 's-1', runId: 'run-1', type: 'RequestFailureObserved', confidence: 0.95, derivedFrom: ['e-1'], timestamp: 1200 };
    const recovery1: Recovery = { id: 'rec-1', runId: 'run-1', outcome: 'FAILED', windowStart: 1200, windowEnd: 9200, evaluatedAt: 9200 };
    const evidence1: Evidence = { id: 'ev-1', runId: 'run-1', kind: 'event', refId: 'e-1', capturedAt: 9200 };
    const finding1: Finding = { id: 'f-1', runId: 'run-1', severity: 'HIGH', confidence: 0.95, description: 'Failure', evidenceIds: ['ev-1'], recoveryId: 'rec-1' };

    // Populate run 2 (to verify it is untouched)
    const run2: ExperimentRun = {
      runId: 'run-2',
      target: { tabId: 2, origin: 'https://example.org', url: 'https://example.org', frameId: 0 },
      definition: { id: 'exp-2', name: 'Latency Test', description: 'Test latency', kind: 'fetch_latency', params: {} },
      state: 'COMPLETED',
      createdAt: 3000,
      updatedAt: 4000,
    };
    const event2: HavocEvent = { id: 'e-2', runId: 'run-2', timestamp: 3100, sequence: 1, type: 'CHAOS_INJECTED', source: 'service_worker' };
    const signal2: Signal = { id: 's-2', runId: 'run-2', type: 'RequestFailureObserved', confidence: 0.95, derivedFrom: ['e-2'], timestamp: 3200 };

    await saveRun(run1);
    await saveEvent(event1);
    await saveSignal(signal1);
    await saveRecovery(recovery1);
    await saveEvidence(evidence1);
    await saveFinding(finding1);

    await saveRun(run2);
    await saveEvent(event2);
    await saveSignal(signal2);

    // Delete run-1
    await deleteRunCascade('run-1');

    // Verify run-1 is completely gone across all stores
    expect(await getRun('run-1')).toBeUndefined();
    expect(await getEventsByRunId('run-1')).toEqual([]);
    expect(await getSignalsByRunId('run-1')).toEqual([]);
    expect(await getRecoveryByRunId('run-1')).toBeUndefined();
    expect(await getEvidenceByRunId('run-1')).toEqual([]);
    expect(await getFindingsByRunId('run-1')).toEqual([]);

    // Verify run-2 is completely intact
    expect(await getRun('run-2')).toBeDefined();
    expect(await getEventsByRunId('run-2')).toHaveLength(1);
    expect(await getSignalsByRunId('run-2')).toHaveLength(1);
  });

  it('retention policy keeps only the last 25 runs and purges older runs with child records', async () => {
    // Create 28 runs with child records
    for (let i = 1; i <= 28; i++) {
      const runId = `run-${i}`;
      const timestamp = 1000 * i;
      await saveRun({
        runId,
        target: { tabId: i, origin: 'https://example.com', url: 'https://example.com', frameId: 0 },
        definition: { id: `exp-${i}`, name: `Exp ${i}`, description: `Exp ${i} description`, kind: 'fetch_latency', params: {} },
        state: 'COMPLETED',
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await saveEvent({
        id: `ev-${i}`,
        runId,
        timestamp,
        sequence: 1,
        type: 'REQUEST_COMPLETED',
        source: 'page',
      });

      await saveSignal({
        id: `sig-${i}`,
        runId,
        type: 'RequestFailureObserved',
        confidence: 0.95,
        derivedFrom: [`ev-${i}`],
        timestamp,
      });
    }

    const allBeforeRetention = await getAllRuns();
    expect(allBeforeRetention).toHaveLength(28);

    // Apply retention (max 25)
    const evicted = await applyRetention(25);
    expect(evicted).toEqual(['run-1', 'run-2', 'run-3']);

    // Check remaining runs count
    const remainingRuns = await getAllRuns();
    expect(remainingRuns).toHaveLength(25);
    const remainingRunIds = new Set(remainingRuns.map((r) => r.runId));

    // Oldest 3 runs should not exist
    expect(remainingRunIds.has('run-1')).toBe(false);
    expect(remainingRunIds.has('run-2')).toBe(false);
    expect(remainingRunIds.has('run-3')).toBe(false);

    // Newest 25 runs (run-4 to run-28) should exist
    for (let i = 4; i <= 28; i++) {
      expect(remainingRunIds.has(`run-${i}`)).toBe(true);
    }

    // Verify child records for evicted runs are completely purged
    for (let i = 1; i <= 3; i++) {
      const events = await getEventsByRunId(`run-${i}`);
      const signals = await getSignalsByRunId(`run-${i}`);
      expect(events).toEqual([]);
      expect(signals).toEqual([]);
    }

    // Verify child records for retained runs are intact
    for (let i = 4; i <= 28; i++) {
      const events = await getEventsByRunId(`run-${i}`);
      const signals = await getSignalsByRunId(`run-${i}`);
      expect(events).toHaveLength(1);
      expect(signals).toHaveLength(1);
    }
  });

  it('saves, retrieves, and cascade-deletes remediations with zero orphans', async () => {
    const runId = 'run-rem-test';
    const findingId = 'finding-rem-test';

    const run: ExperimentRun = {
      runId,
      target: { tabId: 1, origin: 'https://example.com', url: 'https://example.com', frameId: 0 },
      definition: { id: 'exp-1', name: 'Failure Test', description: 'Test', kind: 'fetch_failure', params: {} },
      state: 'COMPLETED',
      createdAt: 1000,
      updatedAt: 2000,
    };

    const finding: Finding = {
      id: findingId,
      runId,
      severity: 'HIGH',
      confidence: 0.95,
      description: 'App failed',
      evidenceIds: [],
    };

    const remediation: Remediation = {
      id: 'rem-1',
      findingId,
      runId,
      title: 'Fix API error handling',
      whatHappened: 'Requests failed',
      whyItMatters: 'Users see broken UI',
      howToFix: ['Add error banner', 'Add retry button'],
      fixPrompt: 'Fix the API error handling',
    };

    await saveRun(run);
    await saveFinding(finding);
    await saveRemediation(remediation);

    // Retrieve by findingId
    const byFinding = await getRemediationsByFindingId(findingId);
    expect(byFinding).toHaveLength(1);
    expect(byFinding[0]).toEqual(remediation);

    // Retrieve by runId
    const byRun = await getRemediationsByRunId(runId);
    expect(byRun).toHaveLength(1);
    expect(byRun[0]).toEqual(remediation);

    // Cascade delete run
    await deleteRunCascade(runId);

    // Verify all records purged
    expect(await getRun(runId)).toBeUndefined();
    expect(await getFindingsByRunId(runId)).toEqual([]);
    expect(await getRemediationsByFindingId(findingId)).toEqual([]);
    expect(await getRemediationsByRunId(runId)).toEqual([]);
  });
});
