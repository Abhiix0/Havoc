import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Target } from '../../../domain/target';
import type { Finding } from '../../../domain/finding';
import type { HavocEvent } from '../../../domain/event';
import type { Signal } from '../../../domain/signal';
import type { ExperimentRun } from '../../../domain/run';
import type { PassiveCheckRun } from '../../../domain/passive-check';

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
  saveFinding: vi.fn().mockResolvedValue(undefined),
  saveAllEvidence: vi.fn().mockResolvedValue(undefined),
  getFindingsByRunId: vi.fn().mockResolvedValue([]),
  getEventsByRunId: vi.fn().mockResolvedValue([]),
  getSignalsByRunId: vi.fn().mockResolvedValue([]),
  getRecoveryByRunId: vi.fn().mockResolvedValue(undefined),
  saveRemediation: vi.fn().mockResolvedValue(undefined),
  applyShipCheckRetention: vi.fn().mockResolvedValue([]),
}));

import { verifyTarget } from '../safety-controller';
import { startRun } from '../run-coordinator';
import { startPassiveCheck } from '../passive-check-runner';
import {
  saveFinding,
  saveAllEvidence,
  getFindingsByRunId,
  getEventsByRunId,
  getSignalsByRunId,
} from '../../../storage/repository';
import { startShipCheck } from '../ship-check-orchestrator';

describe('Ship Check Passive Findings Derivation', () => {
  const target: Target = {
    tabId: 101,
    origin: 'https://example.com',
    url: 'https://example.com/app',
    frameId: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyTarget).mockResolvedValue({ ok: true });

    // Default implementations for runners
    vi.mocked(startPassiveCheck).mockImplementation(async (def, _tgt) => {
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
  });

  it('runtime_errors step with 1 uncaught exception derives MEDIUM finding and yields NEEDS_ATTENTION readiness', async () => {
    const errorEvent: HavocEvent = {
      id: 'evt-err-1',
      runId: 'run-runtime_errors',
      timestamp: 1100,
      sequence: 1,
      type: 'UNCAUGHT_EXCEPTION',
      source: 'page',
      metadata: {
        message: 'Uncaught TypeError: Cannot read properties of undefined (reading foo)',
        filename: 'app.js',
        lineno: 42,
        colno: 10,
      },
    };

    const errorSignal: Signal = {
      id: 'sig-err-1',
      runId: 'run-runtime_errors',
      type: 'RuntimeErrorObserved',
      confidence: 0.98,
      derivedFrom: ['evt-err-1'],
      timestamp: 1100,
    };

    // When step 4b queries events/signals for run-runtime_errors
    vi.mocked(getEventsByRunId).mockImplementation(async (runId) => {
      if (runId === 'run-runtime_errors') return [errorEvent];
      return [];
    });

    vi.mocked(getSignalsByRunId).mockImplementation(async (runId) => {
      if (runId === 'run-runtime_errors') return [errorSignal];
      return [];
    });

    // In-memory store emulation for getFindingsByRunId once saveFinding is called
    let savedFinding: Finding | null = null;
    vi.mocked(saveFinding).mockImplementation(async (finding) => {
      savedFinding = finding;
    });
    vi.mocked(getFindingsByRunId).mockImplementation(async (runId) => {
      if (runId === 'run-runtime_errors' && savedFinding) {
        return [savedFinding];
      }
      return [];
    });

    const result = await startShipCheck(target);

    // Finding was persisted with MEDIUM severity
    expect(saveFinding).toHaveBeenCalledTimes(1);
    expect(savedFinding).not.toBeNull();
    const finding = savedFinding as unknown as Finding;
    expect(finding.severity).toBe('MEDIUM');
    expect(finding.checkKind).toBe('runtime_errors');
    expect(finding.description).toContain('Observed 1 runtime error(s)');

    // Evidence was persisted
    expect(saveAllEvidence).toHaveBeenCalledTimes(1);

    // Readiness is updated based on the finding
    expect(result.readiness).toBe('NEEDS_ATTENTION');
  });

  it('secret_scan step with HIGH severity match derives HIGH finding and yields BLOCKED readiness', async () => {
    const matchEvent: HavocEvent = {
      id: 'evt-sec-1',
      runId: 'run-secret_scan',
      timestamp: 1200,
      sequence: 1,
      type: 'SECRET_PATTERN_MATCH',
      source: 'service_worker',
      metadata: {
        patternId: 'aws_access_key',
        label: 'AWS Access Key',
        severity: 'HIGH',
        sourceDescription: 'inline script (tag #1)',
        redactedSnippet: 'AKIA[REDACTED]7XYZ',
      },
    };

    const matchSignal: Signal = {
      id: 'sig-sec-1',
      runId: 'run-secret_scan',
      type: 'SecretPatternDetected',
      confidence: 0.60,
      derivedFrom: ['evt-sec-1'],
      timestamp: 1200,
    };

    vi.mocked(getEventsByRunId).mockImplementation(async (runId) => {
      if (runId === 'run-secret_scan') return [matchEvent];
      return [];
    });

    vi.mocked(getSignalsByRunId).mockImplementation(async (runId) => {
      if (runId === 'run-secret_scan') return [matchSignal];
      return [];
    });

    let savedFinding: Finding | null = null;
    vi.mocked(saveFinding).mockImplementation(async (finding) => {
      savedFinding = finding;
    });
    vi.mocked(getFindingsByRunId).mockImplementation(async (runId) => {
      if (runId === 'run-secret_scan' && savedFinding) {
        return [savedFinding];
      }
      return [];
    });

    const result = await startShipCheck(target);

    expect(saveFinding).toHaveBeenCalledTimes(1);
    expect(savedFinding).not.toBeNull();
    const finding = savedFinding as unknown as Finding;
    expect(finding.severity).toBe('HIGH');
    expect(finding.checkKind).toBe('secret_scan');
    expect(finding.description).toContain('Observed 1 potential secret match(es)');

    expect(result.readiness).toBe('BLOCKED');
  });

  it('runtime_errors step with zero error events does not call saveFinding', async () => {
    vi.mocked(getEventsByRunId).mockResolvedValue([]);
    vi.mocked(getSignalsByRunId).mockResolvedValue([]);
    vi.mocked(getFindingsByRunId).mockResolvedValue([]);

    const result = await startShipCheck(target);

    expect(saveFinding).not.toHaveBeenCalled();
    expect(result.readiness).toBe('READY');
  });

  it('preserves execution of all 6 steps in proper order', async () => {
    const callOrder: string[] = [];

    vi.mocked(startPassiveCheck).mockImplementation(async (def) => {
      callOrder.push(def.kind);
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
      callOrder.push(def.kind);
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

    expect(callOrder).toEqual([
      'runtime_errors',
      'fetch_latency',
      'fetch_failure',
      'input_stress',
      'viewport_stress',
      'secret_scan',
    ]);
    expect(result.steps.every((s) => s.status === 'DONE')).toBe(true);
    expect(result.readiness).toBe('READY');
  });
});
