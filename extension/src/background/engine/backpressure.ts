/**
 * backpressure.ts — event buffer backpressure, coalescing, and priority drop policy.
 *
 * Locked Priority Hierarchy:
 *   P0 (Critical / Non-Droppable) : CHAOS_INJECTED, lifecycle state events.
 *   P1 (High Priority)            : REQUEST_COMPLETED, REQUEST_TRANSPORT_FAILURE,
 *                                   REQUEST_HTTP_FAILURE, REQUEST_TIMEOUT.
 *   P2 (Low / Drop Eligible)      : DOM_OBSERVATION mutations (loading indicators, error text).
 *
 * Strategies:
 *   1. Rapid DOM mutation coalescing within DOM_COALESCE_WINDOW_MS (250ms).
 *   2. Hard buffer cap (MAX_BUFFERED_EVENTS = 300).
 *   3. Drop policy: Drops oldest P2 DOM events when buffer is pressurized,
 *      guaranteeing zero network or lifecycle telemetry is ever dropped.
 */

import type { HavocEvent } from '../../domain/event';

export const MAX_BUFFERED_EVENTS = 300;
export const DOM_COALESCE_WINDOW_MS = 250;

export type EventPriority = 'P0_CRITICAL' | 'P1_NETWORK' | 'P2_DOM';

export function getEventPriority(event: HavocEvent): EventPriority {
  if (event.type === 'CHAOS_INJECTED') {
    return 'P0_CRITICAL';
  }
  if (
    event.type === 'REQUEST_COMPLETED' ||
    event.type === 'REQUEST_TRANSPORT_FAILURE' ||
    event.type === 'REQUEST_HTTP_FAILURE' ||
    event.type === 'REQUEST_TIMEOUT'
  ) {
    return 'P1_NETWORK';
  }
  if (event.type === 'DOM_OBSERVATION') {
    return 'P2_DOM';
  }
  // Default to critical for unknown / lifecycle types
  return 'P0_CRITICAL';
}

export interface BackpressureStats {
  totalIngested: number;
  totalAdmitted: number;
  totalCoalesced: number;
  totalDroppedP2: number;
}

interface RunCoalesceState {
  lastSeen: Map<string, { timestamp: number; count: number }>;
  stats: BackpressureStats;
}

const _runStates = new Map<string, RunCoalesceState>();

function getRunState(runId: string): RunCoalesceState {
  let state = _runStates.get(runId);
  if (!state) {
    state = {
      lastSeen: new Map(),
      stats: {
        totalIngested: 0,
        totalAdmitted: 0,
        totalCoalesced: 0,
        totalDroppedP2: 0,
      },
    };
    _runStates.set(runId, state);
  }
  return state;
}

export function clearBackpressureState(runId: string): void {
  _runStates.delete(runId);
}

export function getBackpressureStats(runId: string): BackpressureStats {
  return getRunState(runId).stats;
}

/**
 * Checks if a DOM observation is a rapid duplicate that should be coalesced.
 */
export function shouldCoalesceDomEvent(event: HavocEvent): boolean {
  if (event.type !== 'DOM_OBSERVATION') return false;

  const state = getRunState(event.runId);
  state.stats.totalIngested++;

  const kind = String(event.metadata?.kind ?? '');
  const selector = String(event.metadata?.selector ?? '');
  const key = `${kind}::${selector}`;

  const now = event.timestamp;
  const previous = state.lastSeen.get(key);

  if (previous && now - previous.timestamp < DOM_COALESCE_WINDOW_MS) {
    previous.count++;
    previous.timestamp = now;
    state.stats.totalCoalesced++;
    return true;
  }

  state.lastSeen.set(key, { timestamp: now, count: 1 });
  return false;
}

export interface AdmissionDecision {
  admit: boolean;
  droppedEventId?: string | undefined;
  reason?: string | undefined;
}

/**
 * Evaluates whether an event can be admitted into the buffer under current capacity.
 * If capacity is exceeded, evicts the oldest P2 DOM event to make room for P0/P1.
 */
export function evaluateAdmission(
  event: HavocEvent,
  currentBuffer: HavocEvent[],
  maxEvents: number = MAX_BUFFERED_EVENTS
): AdmissionDecision {
  const priority = getEventPriority(event);
  const state = getRunState(event.runId);

  if (currentBuffer.length < maxEvents) {
    state.stats.totalAdmitted++;
    return { admit: true };
  }

  // Buffer is at capacity:
  if (priority === 'P2_DOM') {
    // Drop low-priority event
    state.stats.totalDroppedP2++;
    console.warn(
      `[HAVOC][backpressure] run ${event.runId}: dropped low-priority DOM event #${event.sequence} (buffer capacity ${maxEvents} reached)`
    );
    return {
      admit: false,
      reason: 'BUFFER_FULL_P2_DROPPED',
    };
  }

  // Event is P0 or P1: find oldest P2 event in buffer to evict
  const oldestP2Index = currentBuffer.findIndex((e) => getEventPriority(e) === 'P2_DOM');
  if (oldestP2Index !== -1) {
    const [evicted] = currentBuffer.splice(oldestP2Index, 1);
    state.stats.totalDroppedP2++;
    state.stats.totalAdmitted++;
    console.log(
      `[HAVOC][backpressure] run ${event.runId}: evicted oldest DOM event #${evicted?.sequence} to admit critical ${event.type} #${event.sequence}`
    );
    return {
      admit: true,
      droppedEventId: evicted?.id,
      reason: 'P2_EVICTED_FOR_HIGH_PRIORITY',
    };
  }

  // All existing events are P0/P1: admit critical event anyway
  state.stats.totalAdmitted++;
  return {
    admit: true,
    reason: 'ADMITTED_CRITICAL_OVERFLOW',
  };
}
