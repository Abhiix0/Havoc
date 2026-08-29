import type { Target } from './target';
import type { ExperimentDefinition } from './experiment';

export type ExperimentState =
  | 'CREATED'
  | 'PREPARING'
  | 'ACTIVE'
  | 'STOPPING'
  | 'CLEANING'
  | 'EVALUATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABORTED'
  | 'TIMED_OUT'
  | 'CLEANUP_FAILED'
  | 'TARGET_LOST';

export interface ExperimentRun {
  runId: string;
  target: Target;
  definition: ExperimentDefinition;
  state: ExperimentState;
  createdAt: number;
  updatedAt: number;
}