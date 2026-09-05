import type { ShipCheckStepKind } from '../../../domain/ship-check';

export const STEP_LABELS: Record<ShipCheckStepKind, string> = {
  runtime_errors: 'Checking for runtime errors',
  fetch_latency: 'Testing slow API responses',
  fetch_failure: 'Testing API failures',
  input_stress: 'Testing form inputs',
  viewport_stress: 'Testing narrow screens',
  secret_scan: 'Scanning for exposed secrets',
};

export function friendlyStepName(kind: ShipCheckStepKind): string {
  return STEP_LABELS[kind] ?? kind;
}
