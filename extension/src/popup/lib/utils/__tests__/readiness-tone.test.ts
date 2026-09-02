import { describe, it, expect } from 'vitest';
import type { ReadinessState } from '../../../../domain/ship-check';
import { readinessToTone, type ReadinessTone } from '../readiness-tone';

describe('readinessToTone', () => {
  const cases: Array<[ReadinessState, ReadinessTone]> = [
    ['READY', 'success'],
    ['NEEDS_ATTENTION', 'warning'],
    ['BLOCKED', 'critical'],
    ['UNKNOWN', 'neutral'],
  ];

  it.each(cases)('maps %s to %s', (readiness, expectedTone) => {
    expect(readinessToTone(readiness)).toBe(expectedTone);
  });
});
