export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Finding {
  id: string;
  runId: string;
  severity: FindingSeverity;
  confidence: number;
  description: string;
  evidenceIds: string[];
  recoveryId?: string;
}