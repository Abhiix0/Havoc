/**
 * Passive checks observe and analyze the target page without active chaos injection.
 * They do NOT go through the chaos/recovery-window lifecycle because there is nothing
 * injected and nothing to recover from — they observe and analyze only.
 */

import type { Target } from './target';

export type PassiveCheckKind = 'runtime_errors' | 'secret_scan';

export type PassiveCheckState =
  | 'CREATED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'TARGET_LOST';

export interface PassiveCheckDefinition {
  id: string;
  kind: PassiveCheckKind;
  name: string;
  description: string;
  params: Record<string, unknown>;
}

export interface PassiveCheckRun {
  runId: string;
  target: Target;
  definition: PassiveCheckDefinition;
  state: PassiveCheckState;
  createdAt: number;
  updatedAt: number;
}
