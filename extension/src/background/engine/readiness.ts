/**
 * readiness.ts — categorical readiness state calculator.
 *
 * Categorizes ship readiness cleanly without artificial scoring algorithms:
 *   - UNKNOWN: if any check step failed/errored
 *   - BLOCKED: if any finding has HIGH severity
 *   - NEEDS_ATTENTION: if any findings exist (all MEDIUM/LOW)
 *   - READY: zero findings and zero errors
 */

import type { Finding } from '../../domain/finding';
import type { ReadinessState } from '../../domain/ship-check';

export function computeReadiness(
  findings: Finding[],
  erroredStepCount: number
): ReadinessState {
  if (findings.some((f) => f.severity === 'HIGH')) return 'BLOCKED';
  if (erroredStepCount > 0) return 'UNKNOWN';
  if (findings.length > 0) return 'NEEDS_ATTENTION';
  return 'READY';
}
