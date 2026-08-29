/**
 * service-worker.ts — MV3 background service worker for HAVOC.
 *
 * Startup order:
 *  1. onMessage listener registered synchronously.
 *  2. rehydrate() + openDatabase() in parallel.
 *
 * Phase 5 additions:
 *  - Every HavocEvent is fed through signal-engine.processEvent() immediately
 *    after construction. Derived Signals are logged (no persistence yet).
 *  - DOM_OBSERVATION messages from the content script are received here,
 *    validated, converted to HavocEvents, and fed to the signal engine.
 *  - Run buffer is cleared when a run reaches a terminal state.
 */

import {
  createBridgeMessage,
  createCurrentRunResponseMessage,
  createCreateRunResponseMessage,
  type ObservationPayload,
  type DomObservationPayload,
} from '../messaging/messages';
import {
  isBridgeMessage,
  isGetCurrentRunMessage,
  isObservationMessage,
  isCreateRunMessage,
  isDomObservationMessage,
  isAbortRunMessage,
} from '../messaging/validator';
import { openDatabase } from '../storage/database';
import { saveEvent, saveSignals } from '../storage/repository';
import { rehydrate, getCurrentRun } from './state';
import { startRun, abortRun, nextSequence } from './engine/run-coordinator';
import { processEvent, clearRunBuffer } from './engine/signal-engine';
import type { HavocEvent } from '../domain/event';
import type { Target } from '../domain/target';

console.log('[HAVOC][SW] service worker booted');

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[HAVOC][SW] installed/updated:', details.reason);
});

// ---------------------------------------------------------------------------
// Per-run sequence counters.
// The coordinator also exports nextSequence() — the SW uses it directly
// here rather than maintaining a separate map.
// ---------------------------------------------------------------------------
const DEBUG_RUN_ID = 'debug-run' as const;

// ---------------------------------------------------------------------------
// Build a HavocEvent from a validated ObservationPayload.
// ---------------------------------------------------------------------------
function observationToEvent(obs: ObservationPayload, runId: string): HavocEvent {
  // The sentinel url '__chaos_injected__' carries a CHAOS_INJECTED signal
  // that was emitted by instrumentation.ts. Map it to CHAOS_INJECTED type
  // instead of a REQUEST_* type.
  const isChaosInjectedSentinel = obs.url === '__chaos_injected__' && obs.method === 'CHAOS';

  let type: string;
  if (isChaosInjectedSentinel) {
    type = 'CHAOS_INJECTED';
  } else {
    const typeMap: Record<ObservationPayload['outcome'], string> = {
      success:           'REQUEST_COMPLETED',
      http_failure:      'REQUEST_HTTP_FAILURE',
      transport_failure: 'REQUEST_TRANSPORT_FAILURE',
      timeout:           'REQUEST_TIMEOUT',
    };
    type = typeMap[obs.outcome];
  }

  const event: HavocEvent = {
    id: crypto.randomUUID(),
    runId,
    timestamp: Date.now(),
    sequence: nextSequence(runId),
    type,
    source: 'page',
    ...(isChaosInjectedSentinel ? {} : { resource: obs.url }),
    correlationId: obs.observationId,
    metadata: {
      transport: obs.transport,
      method: obs.method,
      status: obs.status,
      duration: obs.duration,
      ...(obs.errorMessage !== undefined && { errorMessage: obs.errorMessage }),
      ...(obs.injectionId !== undefined && { injectionId: obs.injectionId }),
    },
  };

  return event;
}

// ---------------------------------------------------------------------------
// Build a HavocEvent from a validated DomObservationPayload.
// ---------------------------------------------------------------------------
function domObservationToEvent(obs: DomObservationPayload, runId: string): HavocEvent {
  return {
    id: crypto.randomUUID(),
    runId,
    timestamp: obs.timestamp,
    sequence: nextSequence(runId),
    type: 'DOM_OBSERVATION',
    source: 'content',
    metadata: {
      kind: obs.kind,
      selector: obs.selector,
      textSnippet: obs.textSnippet,
      observedAt: obs.observedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Emit a HavocEvent: log it, persist it, and feed it to the Signal Engine.
// ---------------------------------------------------------------------------
function emitEvent(event: HavocEvent): void {
  if (event.type !== 'DOM_OBSERVATION') {
    // Log network/chaos events with detail; DOM events are high-volume so
    // only log if the kind is interesting.
    console.log(
      `[HAVOC][SW] event #${event.sequence} ${event.type}`,
      event.resource ?? event.metadata?.kind ?? '',
      event.metadata?.status !== undefined
        ? `(${event.metadata.status as number} ${(event.metadata.duration as number | undefined)?.toFixed(1) ?? '?'}ms)`
        : ''
    );
  } else {
    console.debug(
      `[HAVOC][SW] DOM #${event.sequence}`,
      event.metadata?.kind,
      event.metadata?.selector
    );
  }

  // Persist event to IndexedDB
  saveEvent(event).catch((err: unknown) => {
    console.error('[HAVOC][SW] Failed to persist event:', err);
  });

  // Feed to Signal Engine — returns derived Signals.
  const signals = processEvent(event);
  if (signals.length > 0) {
    saveSignals(signals).catch((err: unknown) => {
      console.error('[HAVOC][SW] Failed to persist derived signals:', err);
    });
  }
}

// ---------------------------------------------------------------------------
// Resolve the active tab for CREATE_RUN.
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
  return { tabId: tab.id, origin, url: tab.url, frameId: 0 };
}

// ---------------------------------------------------------------------------
// Message listener — registered synchronously.
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // --- CREATE_RUN (popup → SW) ---
  if (isCreateRunMessage(message)) {
    (async () => {
      try {
        let target: Target | null = message.target ?? null;
        if (target === null) target = await resolveActiveTab();
        if (target === null) {
          sendResponse(createCreateRunResponseMessage(undefined, 'Could not resolve a target tab — open a web page first'));
          return;
        }

        const runPromise = startRun(message.definition, target);
        await Promise.resolve();
        const initialRun = getCurrentRun();
        sendResponse(createCreateRunResponseMessage(initialRun ?? undefined));

        runPromise
          .then((finalRun) => {
            // Clear the signal engine buffer when the run terminates.
            clearRunBuffer(finalRun.runId);
          })
          .catch((err: unknown) => {
            console.error('[HAVOC][SW] startRun error:', err);
          });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendResponse(createCreateRunResponseMessage(undefined, msg));
      }
    })();
    return true;
  }

  // --- DOM_OBSERVATION (content script → SW) ---
  if (isDomObservationMessage(message)) {
    // Use the run the content script tagged this observation with, or the
    // currently active run, or fall back to the debug placeholder.
    const runId = message.payload.runId ?? getCurrentRun()?.runId ?? DEBUG_RUN_ID;
    const event = domObservationToEvent(message.payload, runId);
    emitEvent(event);
    sendResponse(null);
    return true;
  }

  // --- REQUEST_OBSERVATION (page → content → SW) ---
  if (isObservationMessage(message)) {
    const runId = getCurrentRun()?.runId ?? DEBUG_RUN_ID;
    const event = observationToEvent(message.payload, runId);
    emitEvent(event);
    sendResponse(null);
    return true;
  }

  // --- GET_CURRENT_RUN (popup → SW) ---
  if (isGetCurrentRunMessage(message)) {
    console.log('[HAVOC][SW] GET_CURRENT_RUN from', sender.tab?.id ?? 'popup');
    sendResponse(createCurrentRunResponseMessage(getCurrentRun()));
    return true;
  }

  // --- ABORT_RUN (popup → SW) ---
  if (isAbortRunMessage(message)) {
    console.log('[HAVOC][SW] ABORT_RUN from', sender.tab?.id ?? 'popup');
    abortRun()
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
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
