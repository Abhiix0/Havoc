export type EvidenceKind = 'event' | 'signal' | 'metric' | 'snapshot';

export interface Evidence {
  id: string;
  runId: string;
  kind: EvidenceKind;
  refId: string;
  capturedAt: number;
}