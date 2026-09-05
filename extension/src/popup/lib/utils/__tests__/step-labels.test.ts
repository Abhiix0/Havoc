import { describe, it, expect } from 'vitest';
import type { ShipCheckStepKind } from '../../../../domain/ship-check';
import { STEP_LABELS, friendlyStepName } from '../step-labels';

describe('step-labels', () => {
  const allKinds: ShipCheckStepKind[] = [
    'runtime_errors',
    'fetch_latency',
    'fetch_failure',
    'input_stress',
    'viewport_stress',
    'secret_scan',
  ];

  it.each(allKinds)('maps %s to a non-empty friendly label', (kind) => {
    const label = friendlyStepName(kind);
    expect(label).toBeTruthy();
    expect(label).toBe(STEP_LABELS[kind]);
  });

  it('falls back to raw kind string if unknown kind is provided', () => {
    expect(friendlyStepName('unknown_check' as ShipCheckStepKind)).toBe('unknown_check');
  });
});
