export type RecoveryOutcome = 'RECOVERED' | 'DEGRADED' | 'FAILED' | 'UNKNOWN';

export interface Recovery {
  id: string;
  runId: string;
  outcome: RecoveryOutcome;
  windowStart: number;
  windowEnd: number;
  evaluatedAt: number;
}