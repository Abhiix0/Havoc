/**
 * service-worker.ts — MV3 background service worker for HAVOC.
 *
 * Startup order matters:
 *  1. rehydrate() is awaited first, before any message handler can fire, so
 *     the first GET_CURRENT_RUN is never answered from a cold/empty state.
 *  2. openDatabase() is kicked off in parallel (IndexedDB is for durable run
 *     history; session storage is for crash-resistant hot state).
 *  3. Message listeners are registered synchronously so Chrome can queue
 *     messages while the async startup is in flight.
 */

import { createBridgeMessage } from '../messaging/messages';
import { createCurrentRunResponseMessage } from '../messaging/messages';
import { isBridgeMessage, isGetCurrentRunMessage } from '../messaging/validator';
import { openDatabase } from '../storage/database';
import { rehydrate, getCurrentRun } from './state';

console.log('[HAVOC][SW] service worker booted');

// ---------------------------------------------------------------------------
// Register message listener synchronously — Chrome queues messages until the
// SW is ready, but the listener registration itself must be synchronous.
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // --- popup ↔ SW runtime messages ---
  if (isGetCurrentRunMessage(message)) {
    console.log('[HAVOC][SW] GET_CURRENT_RUN from', sender.tab?.id ?? 'popup');
    sendResponse(createCurrentRunResponseMessage(getCurrentRun()));
    return true;
  }

  // --- page ↔ SW bridge messages (relayed via content-script) ---
  if (!isBridgeMessage(message)) return false;

  console.log('[HAVOC][SW] received', message.type, 'from tab', sender.tab?.id);

  if (message.type === 'BRIDGE_HELLO') {
    sendResponse(createBridgeMessage('BRIDGE_READY'));
    return true;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Async startup — rehydrate before anything can respond to messages, open DB
// in parallel since it is not needed to answer GET_CURRENT_RUN.
// ---------------------------------------------------------------------------
const startupPromise = Promise.all([
  rehydrate(),
  openDatabase()
    .then(() => console.log('[HAVOC][SW] IndexedDB ready'))
    .catch((err) => console.error('[HAVOC][SW] IndexedDB failed to open', err)),
]);

startupPromise.catch((err) => console.error('[HAVOC][SW] startup error', err));
