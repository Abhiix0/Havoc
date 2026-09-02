import type { Target } from './target';
import type { ExperimentKind } from './experiment';
import type { PassiveCheckKind } from './passive-check';

export type ShipCheckStepKind = ExperimentKind | PassiveCheckKind;

export type ShipCheckStepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'DONE'
  | 'SKIPPED'
  | 'ERRORED';

export interface ShipCheckStep {
  kind: ShipCheckStepKind;
  runId: string;
  status: ShipCheckStepStatus;
}

export type ReadinessState =
  | 'READY'
  | 'NEEDS_ATTENTION'
  | 'BLOCKED'
  | 'UNKNOWN';

export interface ShipCheckRun {
  shipCheckId: string;
  target: Target;
  steps: ShipCheckStep[];
  createdAt: number;
  completedAt?: number;
  readiness: ReadinessState;
}
