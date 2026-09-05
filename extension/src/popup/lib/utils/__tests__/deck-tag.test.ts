import { describe, it, expect } from 'vitest';
import type { ShipCheckRun } from '../../../../domain/ship-check';
import type { Target } from '../../../../domain/target';
import { getDeckTagLabel } from '../deck-tag';

describe('getDeckTagLabel', () => {
  const baseTarget: Target = {
    tabId: 1,
    origin: 'https://example.com',
    url: 'https://example.com',
    frameId: 0,
  };

  it('returns "RUNNING" when shipCheck is null or undefined', () => {
    expect(getDeckTagLabel(null)).toBe('RUNNING');
    expect(getDeckTagLabel(undefined)).toBe('RUNNING');
  });

  it('returns "RUNNING" when steps are present but not all terminal', () => {
    const shipCheck: ShipCheckRun = {
      shipCheckId: 'sc-1',
      target: baseTarget,
      readiness: 'UNKNOWN',
      createdAt: Date.now(),
      steps: [
        { kind: 'runtime_errors', runId: 'r-1', status: 'DONE' },
        { kind: 'fetch_latency', runId: 'r-2', status: 'RUNNING' },
        { kind: 'fetch_failure', runId: 'r-3', status: 'PENDING' },
      ],
    };
    expect(getDeckTagLabel(shipCheck)).toBe('RUNNING');
  });

  it('returns "RUNNING" when steps array is empty', () => {
    const shipCheck: ShipCheckRun = {
      shipCheckId: 'sc-empty',
      target: baseTarget,
      readiness: 'UNKNOWN',
      createdAt: Date.now(),
      steps: [],
    };
    expect(getDeckTagLabel(shipCheck)).toBe('RUNNING');
  });

  it('returns "FINALIZING" when all steps are terminal (DONE/ERRORED/SKIPPED) but completedAt is unset', () => {
    const shipCheck: ShipCheckRun = {
      shipCheckId: 'sc-2',
      target: baseTarget,
      readiness: 'READY',
      createdAt: Date.now(),
      steps: [
        { kind: 'runtime_errors', runId: 'r-1', status: 'DONE' },
        { kind: 'fetch_latency', runId: 'r-2', status: 'ERRORED' },
        { kind: 'fetch_failure', runId: 'r-3', status: 'SKIPPED' },
      ],
    };
    expect(getDeckTagLabel(shipCheck)).toBe('FINALIZING');
  });

  it('returns "COMPLETE" when completedAt is set', () => {
    const shipCheck: ShipCheckRun = {
      shipCheckId: 'sc-3',
      target: baseTarget,
      readiness: 'READY',
      createdAt: Date.now() - 5000,
      completedAt: Date.now(),
      steps: [
        { kind: 'runtime_errors', runId: 'r-1', status: 'DONE' },
        { kind: 'fetch_latency', runId: 'r-2', status: 'DONE' },
      ],
    };
    expect(getDeckTagLabel(shipCheck)).toBe('COMPLETE');
  });
});
