/**
 * service-worker.ts — MV3 background service worker for HAVOC.
 *
 * Startup order:
 *  1. onMessage listener registered synchronously.
 *  2. rehydrate() + openDatabase() in parallel.
 *
 * Phase 3 additions:
 *  - Handles CREATE_RUN: resolves the active tab when no explicit target is
 *    supplied, delegates to RunCoordinator.startRun(), returns the initial run
 *    as CREATE_RUN_RESPONSE immediately (coordinator drives the rest async).
 *  - Sequence counters now keyed on real runIds from the RunCoordinator;
 *    DEBUG_RUN_ID fallback only used for observations that arrive outside any
 *    active run (e.g. background tabs during development).
 */

import {
  createBridgeMessage,
  createCurrentRunResponseMessage,
  createCreateRunResponseMessage,
  type ObservationPayload,
} from '../messaging/messages';
import {
  isBridgeMessage,
  isGetCurrentRunMessage,
  isObservationMessage,
  isCreateRunMessage,
} from '../messaging/validator';
import { openDatabase } from '../storage/database';
import { rehydrate, getCurrentRun } from './state';
import { startRun } from './engine/run-coordinator';
import type { HavocEvent } from '../domain/event';
import type { Target } from '../domain/target';

console.log('[HAVOC][SW] service worker booted');

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[HAVOC][SW] installed/updated:', details.reason);
});

// ---------------------------------------------------------------------------
// Per-run sequence counters (in-memory, keyed by runId).
// Falls back to a stable placeholder only when no run is active.
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
// Resolve the active tab for CREATE_RUN when no explicit target is provided.
// ---------------------------------------------------------------------------
async function resolveActiveTab(): Promise<Target | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined || !tab.url) return null;

  let origin: string;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    return null;
  }

  return {
    tabId: tab.id,
    origin,
    url: tab.url,
    frameId: 0,
  };
}

// ---------------------------------------------------------------------------
// Message listener — registered synchronously.
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // --- CREATE_RUN (popup → SW) ---
  if (isCreateRunMessage(message)) {
    (async () => {
      try {
        // Resolve target: use explicit target if provided, otherwise the
        // currently active tab at the moment the popup sends CREATE_RUN.
        let target: Target | null = message.target ?? null;
        if (target === null) {
          target = await resolveActiveTab();
        }

        if (target === null) {
          sendResponse(createCreateRunResponseMessage(
            undefined,
            'Could not resolve a target tab — open a web page first'
          ));
          return;
        }

        // startRun is async and drives the full lifecycle. We respond
        // immediately with the initial run state (CREATED) so the popup
        // doesn't block. The coordinator broadcasts RUN_STATE_UPDATE on
        // every subsequent transition.
        const runPromise = startRun(message.definition, target);

        // The run is checkpointed synchronously to session storage in
        // CREATED state before startRun's first await resolves — so
        // getCurrentRun() is safe to call here.
        // We wait one microtask tick to let the CREATED checkpoint land.
        await Promise.resolve();

        const initialRun = getCurrentRun();
        sendResponse(createCreateRunResponseMessage(initialRun ?? undefined));

        // Let the lifecycle complete in the background.
        runPromise.catch((err: unknown) => {
          console.error('[HAVOC][SW] startRun error:', err);
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendResponse(createCreateRunResponseMessage(undefined, msg));
      }
    })();
    return true; // async response
  }

  // --- REQUEST_OBSERVATION (page → content → SW) ---
  if (isObservationMessage(message)) {
    // Use the real runId if a run is active; fall back to debug placeholder.
    const runId = getCurrentRun()?.runId ?? DEBUG_RUN_ID;
    const event = observationToEvent(message.payload, runId);
    console.log(
      `[HAVOC][SW] event #${event.sequence} ${event.type}`,
      event.resource,
      `(${event.metadata?.status as number}`,
      `${(event.metadata?.duration as number).toFixed(1)}ms)`
    );
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
