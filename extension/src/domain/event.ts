export type EventSource = 'page' | 'content' | 'service_worker';

export interface HavocEvent {
  id: string;
  runId: string;
  timestamp: number;
  sequence: number;
  type: string;
  source: EventSource;
  resource?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
  parentEventId?: string;
}