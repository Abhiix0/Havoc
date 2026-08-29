/**
 * content-script.ts — trusted relay between the untrusted page world and the
 * privileged service worker.
 *
 * Message flow (one-way labels):
 *
 *   page → content → SW:   BRIDGE_HELLO, REQUEST_OBSERVATION
 *   SW → content → page:   BRIDGE_READY, BRIDGE_ERROR (as sendResponse / postMessage)
 *
 * BRIDGE_READY and BRIDGE_ERROR travel FROM the SW back TO the page.
 * They must never be forwarded toward the SW — doing so creates an
 * infinite loop: content posts BRIDGE_ERROR → hears its own postMessage →
 * tries to send to SW → SW fails → posts BRIDGE_ERROR again → repeat.
 *
 * Security model:
 *   - Everything arriving via window.addEventListener('message') is UNTRUSTED.
 *   - isObservationMessage() does a deep payload check before forwarding.
 *   - Only BRIDGE_HELLO and REQUEST_OBSERVATION are forwarded to the SW.
 */

import { isBridgeMessage, isObservationMessage } from '../messaging/validator';
import { createBridgeMessage } from '../messaging/messages';

console.log('[HAVOC][content] content script loaded on', location.href);

// ---------------------------------------------------------------------------
// Relay: page (untrusted) → SW (privileged), validated and filtered first.
// ---------------------------------------------------------------------------
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return; // ignore iframes / foreign windows

  // --- REQUEST_OBSERVATION: page → SW, fire-and-forget ---
  if (isObservationMessage(event.data)) {
    chrome.runtime.sendMessage(event.data, (response) => {
      if (chrome.runtime.lastError) {
        // SW suspension during observation — not critical, just log.
        console.warn(
          '[HAVOC][content] SW unreachable forwarding observation',
          chrome.runtime.lastError.message
        );
      }
      void response;
    });
    return;
  }

  // --- Only BRIDGE_HELLO travels from page → SW ---
  // BRIDGE_READY and BRIDGE_ERROR travel in the opposite direction (SW → page).
  // Forwarding them to the SW would cause an infinite error loop.
  if (!isBridgeMessage(event.data)) return;
  if (event.data.type !== 'BRIDGE_HELLO') return;

  console.log('[HAVOC][content] forwarding BRIDGE_HELLO to service worker');

  chrome.runtime.sendMessage(event.data, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[HAVOC][content] service worker unreachable', chrome.runtime.lastError.message);
      // Notify the page so bridge.ts knows not to activate instrumentation.
      window.postMessage(
        createBridgeMessage('BRIDGE_ERROR', { reason: chrome.runtime.lastError.message }),
        '*'
      );
      return;
    }
    // Relay SW's BRIDGE_READY response back to the page world.
    if (isBridgeMessage(response)) {
      window.postMessage(response, '*');
    }
  });
});

// ---------------------------------------------------------------------------
// Inject the page-world bridge + instrumentation bundle.
// ---------------------------------------------------------------------------
const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/page/bridge.js');
script.type = 'module';
(document.head ?? document.documentElement).appendChild(script);
script.addEventListener('load', () => script.remove(), { once: true });
