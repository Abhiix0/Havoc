import type { HavocEvent } from './event';

export interface Signal {
  id: string;
  runId: string;
  type: string;
  confidence: number; // 0..1
  derivedFrom: Array<HavocEvent['id']>;
  timestamp: number;
}