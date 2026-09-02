import { describe, it, expect } from 'vitest';
import { computeReadiness } from '../readiness';
import type { Finding } from '../../../domain/finding';

describe('Readiness Evaluation', () => {
  const lowFinding: Finding = {
    id: 'f-low',
    runId: 'r-1',
    severity: 'LOW',
    confidence: 0.7,
    description: 'Low finding',
    evidenceIds: [],
  };

  const medFinding: Finding = {
    id: 'f-med',
    runId: 'r-1',
    severity: 'MEDIUM',
    confidence: 0.8,
    description: 'Medium finding',
    evidenceIds: [],
  };

  const highFinding: Finding = {
    id: 'f-high',
    runId: 'r-1',
    severity: 'HIGH',
    confidence: 0.95,
    description: 'High finding',
    evidenceIds: [],
  };

  it('returns UNKNOWN when erroredStepCount > 0 regardless of findings', () => {
    expect(computeReadiness([], 1)).toBe('UNKNOWN');
    expect(computeReadiness([lowFinding], 2)).toBe('UNKNOWN');
    expect(computeReadiness([highFinding], 1)).toBe('UNKNOWN');
  });

  it('returns BLOCKED when any finding has HIGH severity (and erroredStepCount === 0)', () => {
    expect(computeReadiness([highFinding], 0)).toBe('BLOCKED');
    expect(computeReadiness([lowFinding, highFinding], 0)).toBe('BLOCKED');
    expect(computeReadiness([medFinding, highFinding], 0)).toBe('BLOCKED');
  });

  it('returns NEEDS_ATTENTION when findings exist but none are HIGH (and erroredStepCount === 0)', () => {
    expect(computeReadiness([lowFinding], 0)).toBe('NEEDS_ATTENTION');
    expect(computeReadiness([medFinding], 0)).toBe('NEEDS_ATTENTION');
    expect(computeReadiness([lowFinding, medFinding], 0)).toBe('NEEDS_ATTENTION');
  });

  it('returns READY when zero findings and zero errors', () => {
    expect(computeReadiness([], 0)).toBe('READY');
  });
});
