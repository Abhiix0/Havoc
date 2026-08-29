/**
 * service-worker.ts — MV3 background service worker for HAVOC.
 *
 * Startup order:
 *  1. onMessage listener registered synchronously (Chrome queues messages
 *     during async startup; registration must be sync).
 *  2. rehydrate() + openDatabase() run in parallel — IndexedDB is not needed
 *     to answer GET_CURRENT_RUN or to log observations.
 *
 * Phase 2 additions:
 *  - Handles REQUEST_OBSERVATION messages forwarded from the content script.
 *  - Maintains a per-runId sequence counter (Map<runId, number>) so events
 *    carry a monotonic sequence number even across SW suspensions within the
 *    same session (counter lives in memory; for cross-suspension monotonicity
 *    the counter will move to chrome.storage.session in a later phase).
 *  - Constructs a HavocEvent from each validated observation and logs it.
 *    No IndexedDB writes yet — that is Phase 7.
 */

import {
  createBridgeMessage,
  createCurrentRunResponseMessage,
  type ObservationPayload,
} from '../messaging/messages';
import {
  isBridgeMessage,
  isGetCurrentRunMessage,
  isObservationMessage,
} from '../messaging/validator';
import { openDatabase } from '../storage/database';
import { rehydrate, getCurrentRun } from './state';
import type { HavocEvent } from '../domain/event';

console.log('[HAVOC][SW] service worker booted');

// ---------------------------------------------------------------------------
// Sequence counter — per runId, monotonically increasing within one SW
// activation.  Key: runId, Value: last sequence number assigned.
// Phase 2 uses a fixed placeholder runId until the experiment engine exists.
// ---------------------------------------------------------------------------
const DEBUG_RUN_ID = 'debug-run' as const;
const _sequenceCounters = new Map<string, number>();

function nextSequence(runId: string): number {
  const current = _sequenceCounters.get(runId) ?? 0;
  const next = current + 1;
  _sequenceCounters.set(runId, next);
  return next;
}

// ---------------------------------------------------------------------------
// Build a HavocEvent from a validated ObservationPayload.
// ---------------------------------------------------------------------------
function observationToEvent(obs: ObservationPayload, runId: string): HavocEvent {
  // Map the three-way outcome distinction to distinct HavocEvent type strings
  // so downstream consumers (Signal Engine, Phase 5+) can switch on them.
  const typeMap: Record<ObservationPayload['outcome'], string> = {
    success:           'REQUEST_COMPLETED',
    http_failure:      'REQUEST_HTTP_FAILURE',
    transport_failure: 'REQUEST_TRANSPORT_FAILURE',
    timeout:           'REQUEST_TIMEOUT',
  };

  return {
    id: crypto.randomUUID(),
    runId,
    timestamp: Date.now(),
    sequence: nextSequence(runId),
    type: typeMap[obs.outcome],
    source: 'page',
    resource: obs.url,
    correlationId: obs.observationId,
    metadata: {
      transport: obs.transport,
      method: obs.method,
      status: obs.status,
      duration: obs.duration,
      ...(obs.errorMessage !== undefined && { errorMessage: obs.errorMessage }),
    },
  };
}

// ---------------------------------------------------------------------------
// Message listener — registered synchronously.
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // --- REQUEST_OBSERVATION (page → content → SW) ---
  if (isObservationMessage(message)) {
    const runId = getCurrentRun()?.runId ?? DEBUG_RUN_ID;
    const event = observationToEvent(message.payload, runId);
    console.log(
      `[HAVOC][SW] event #${event.sequence} ${event.type}`,
      event.resource,
      `(${(event.metadata?.status as number)}`,
      `${(event.metadata?.duration as number).toFixed(1)}ms)`
    );
    // Phase 7 will persist to IndexedDB here.
    sendResponse(null);
    return true;
  }

  // --- GET_CURRENT_RUN (popup → SW) ---
  if (isGetCurrentRunMessage(message)) {
    console.log('[HAVOC][SW] GET_CURRENT_RUN from', sender.tab?.id ?? 'popup');
    sendResponse(createCurrentRunResponseMessage(getCurrentRun()));
    return true;
  }

  // --- Bridge protocol messages relayed from content script ---
  if (!isBridgeMessage(message)) return false;

  console.log('[HAVOC][SW] received', message.type, 'from tab', sender.tab?.id);

  if (message.type === 'BRIDGE_HELLO') {
    sendResponse(createBridgeMessage('BRIDGE_READY'));
    return true;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Async startup.
// ---------------------------------------------------------------------------
const startupPromise = Promise.all([
  rehydrate(),
  openDatabase()
    .then(() => console.log('[HAVOC][SW] IndexedDB ready'))
    .catch((err: unknown) => console.error('[HAVOC][SW] IndexedDB failed to open', err)),
]);

startupPromise.catch((err: unknown) => console.error('[HAVOC][SW] startup error', err));
