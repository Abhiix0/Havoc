import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Target } from '../../../domain/target';
import type { Finding } from '../../../domain/finding';
import type { ExperimentRun } from '../../../domain/run';
import type { PassiveCheckRun } from '../../../domain/passive-check';
import type { ShipCheckStepKind } from '../../../domain/ship-check';

// Module mocks
vi.mock('../safety-controller', () => ({
  verifyTarget: vi.fn(),
}));

vi.mock('../run-coordinator', () => ({
  startRun: vi.fn(),
}));

vi.mock('../passive-check-runner', () => ({
  startPassiveCheck: vi.fn(),
}));

vi.mock('../../../storage/repository', () => ({
  saveShipCheck: vi.fn().mockResolvedValue(undefined),
  getFindingsByRunId: vi.fn().mockResolvedValue([]),
  getEventsByRunId: vi.fn().mockResolvedValue([]),
  getSignalsByRunId: vi.fn().mockResolvedValue([]),
  getRecoveryByRunId: vi.fn().mockResolvedValue(undefined),
  saveRemediation: vi.fn().mockResolvedValue(undefined),
}));

import { verifyTarget } from '../safety-controller';
import { startRun } from '../run-coordinator';
import { startPassiveCheck } from '../passive-check-runner';
import {
  saveShipCheck,
  getFindingsByRunId,
  saveRemediation,
} from '../../../storage/repository';
import { startShipCheck } from '../ship-check-orchestrator';

describe('Ship Check Orchestrator', () => {
  const target: Target = {
    tabId: 101,
    origin: 'https://example.com',
    url: 'https://example.com/app',
    frameId: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Happy path: executes all 6 steps in exact documented order with zero findings -> READY', async () => {
    vi.mocked(verifyTarget).mockResolvedValue({ ok: true });

    const callOrder: ShipCheckStepKind[] = [];

    vi.mocked(startPassiveCheck).mockImplementation(async (def, _tgt) => {
      callOrder.push(def.kind);
      const run: PassiveCheckRun = {
        runId: `run-${def.kind}`,
        target,
        definition: def,
        state: 'COMPLETED',
        createdAt: 1000,
        updatedAt: 2000,
      };
      return run;
    });

    vi.mocked(startRun).mockImplementation(async (def, _tgt) => {
      callOrder.push(def.kind);
      const run: ExperimentRun = {
        runId: `run-${def.kind}`,
        target,
        definition: def,
        state: 'COMPLETED',
        createdAt: 1000,
        updatedAt: 2000,
      };
      return run;
    });

    vi.mocked(getFindingsByRunId).mockResolvedValue([]);

    const result = await startShipCheck(target);

    expect(callOrder).toEqual([
      'runtime_errors',
      'fetch_latency',
      'fetch_failure',
      'input_stress',
      'viewport_stress',
      'secret_scan',
    ]);

    expect(result.readiness).toBe('READY');
    expect(result.steps).toHaveLength(6);
    expect(result.steps.every((s) => s.status === 'DONE')).toBe(true);
    expect(result.completedAt).toBeDefined();
    expect(saveShipCheck).toHaveBeenCalled();
  });

  it('Mixed findings: handles HIGH and MEDIUM findings across steps -> BLOCKED and saves remediations', async () => {
    vi.mocked(verifyTarget).mockResolvedValue({ ok: true });

    vi.mocked(startPassiveCheck).mockImplementation(async (def) => ({
      runId: `run-${def.kind}`,
      target,
      definition: def,
      state: 'COMPLETED',
      createdAt: 1000,
      updatedAt: 2000,
    }));

    vi.mocked(startRun).mockImplementation(async (def) => ({
      runId: `run-${def.kind}`,
      target,
      definition: def,
      state: 'COMPLETED',
      createdAt: 1000,
      updatedAt: 2000,
    }));

    const highFinding: Finding = {
      id: 'find-high',
      runId: 'run-runtime_errors',
      severity: 'HIGH',
      confidence: 0.98,
      description: 'Multiple uncaught exceptions',
      evidenceIds: [],
      checkKind: 'runtime_errors',
    };

    const medFinding: Finding = {
      id: 'find-med',
      runId: 'run-viewport_stress',
      severity: 'MEDIUM',
      confidence: 0.95,
      description: 'Layout overflow',
      evidenceIds: [],
      checkKind: 'viewport_stress',
    };

    vi.mocked(getFindingsByRunId).mockImplementation(async (runId: string) => {
      if (runId === 'run-runtime_errors') return [highFinding];
      if (runId === 'run-viewport_stress') return [medFinding];
      return [];
    });

    const result = await startShipCheck(target);

    expect(result.readiness).toBe('BLOCKED');
    expect(result.steps.every((s) => s.status === 'DONE')).toBe(true);
    // saveRemediation called once per finding (2 total during step loops)
    expect(saveRemediation).toHaveBeenCalledTimes(2);
  });

  it('Target lost: stops when verifyTarget fails on 3rd step, marks remaining as ERRORED without running them', async () => {
    // Step 1 & 2 succeed, Step 3 fails verification
    let verifyCount = 0;
    vi.mocked(verifyTarget).mockImplementation(async () => {
      verifyCount++;
      if (verifyCount <= 2) {
        return { ok: true };
      }
      return { ok: false, reason: 'TAB_NOT_FOUND', detail: 'Tab closed' };
    });

    const executedSteps: string[] = [];

    vi.mocked(startPassiveCheck).mockImplementation(async (def) => {
      executedSteps.push(def.kind);
      return {
        runId: `run-${def.kind}`,
        target,
        definition: def,
        state: 'COMPLETED',
        createdAt: 1000,
        updatedAt: 2000,
      };
    });

    vi.mocked(startRun).mockImplementation(async (def) => {
      executedSteps.push(def.kind);
      return {
        runId: `run-${def.kind}`,
        target,
        definition: def,
        state: 'COMPLETED',
        createdAt: 1000,
        updatedAt: 2000,
      };
    });

    const result = await startShipCheck(target);

    // Only step 1 ('runtime_errors') and step 2 ('fetch_latency') ran
    expect(executedSteps).toEqual(['runtime_errors', 'fetch_latency']);

    // Steps 1 & 2 are DONE, steps 3, 4, 5, 6 are ERRORED
    expect(result.steps[0]?.status).toBe('DONE');
    expect(result.steps[1]?.status).toBe('DONE');
    expect(result.steps[2]?.status).toBe('ERRORED');
    expect(result.steps[3]?.status).toBe('ERRORED');
    expect(result.steps[4]?.status).toBe('ERRORED');
    expect(result.steps[5]?.status).toBe('ERRORED');

    // With errored steps, readiness is UNKNOWN
    expect(result.readiness).toBe('UNKNOWN');
  });

  it('Runner error: when one runner throws, that step is ERRORED but other 5 steps complete', async () => {
    vi.mocked(verifyTarget).mockResolvedValue({ ok: true });

    const executedSteps: string[] = [];

    vi.mocked(startPassiveCheck).mockImplementation(async (def) => {
      executedSteps.push(def.kind);
      return {
        runId: `run-${def.kind}`,
        target,
        definition: def,
        state: 'COMPLETED',
        createdAt: 1000,
        updatedAt: 2000,
      };
    });

    vi.mocked(startRun).mockImplementation(async (def) => {
      executedSteps.push(def.kind);
      if (def.kind === 'fetch_failure') {
        throw new Error('Chaos injector network timeout');
      }
      return {
        runId: `run-${def.kind}`,
        target,
        definition: def,
        state: 'COMPLETED',
        createdAt: 1000,
        updatedAt: 2000,
      };
    });

    const result = await startShipCheck(target);

    // All 6 steps were attempted
    expect(executedSteps).toEqual([
      'runtime_errors',
      'fetch_latency',
      'fetch_failure',
      'input_stress',
      'viewport_stress',
      'secret_scan',
    ]);

    expect(result.steps.find((s) => s.kind === 'fetch_failure')?.status).toBe('ERRORED');
    expect(result.steps.filter((s) => s.status === 'DONE')).toHaveLength(5);
    expect(result.readiness).toBe('UNKNOWN'); // 1 errored step -> UNKNOWN
  });
});
