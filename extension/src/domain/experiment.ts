export type ExperimentKind =
  | 'fetch_latency'
  | 'fetch_failure'
  | 'input_stress'
  | 'viewport_stress';

export interface ExperimentDefinition {
  id: string;
  kind: ExperimentKind;
  name: string;
  description: string;
  params: Record<string, unknown>;
}