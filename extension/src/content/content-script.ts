/**
 * content-script.ts — trusted relay between the untrusted page world and the
 * privileged service worker.
 *
 * Security model:
 *   - Everything arriving via window.addEventListener('message') is UNTRUSTED.
 *     The page world can post arbitrary data; we re-validate every message
 *     structurally before forwarding anything to chrome.runtime.
 *   - isObservationMessage() does a deep payload check (not just the envelope)
 *     so a malicious page cannot craft a message that passes the type guard
 *     without correct field types and value ranges.
 *   - We never echo raw page data back to the SW; we only forward messages
 *     that have passed validation.
 */

import { isBridgeMessage, isObservationMessage } from '../messaging/validator';
import { createBridgeMessage } from '../messaging/messages';

console.log('[HAVOC][content] content script loaded on', location.href);

// ---------------------------------------------------------------------------
// Relay: page (untrusted) → service worker (privileged), validated first.
// ---------------------------------------------------------------------------
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return; // ignore iframes / foreign windows

  // --- REQUEST_OBSERVATION (deep-validated including payload) ---
  if (isObservationMessage(event.data)) {
    chrome.runtime.sendMessage(event.data, (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          '[HAVOC][content] SW unreachable forwarding observation',
          chrome.runtime.lastError.message
        );
      }
      // Observations are fire-and-forget; no response expected.
      void response;
    });
    return;
  }

  // --- Bridge protocol messages (BRIDGE_HELLO / BRIDGE_READY / BRIDGE_ERROR) ---
  if (!isBridgeMessage(event.data)) return;

  console.log('[HAVOC][content] forwarding', event.data.type, 'to service worker');

  chrome.runtime.sendMessage(event.data, (response) => {
    if (chrome.runtime.lastError) {
      // SW is unreachable — send BRIDGE_ERROR back to the page so bridge.ts
      // knows not to activate instrumentation.
      console.error('[HAVOC][content] service worker unreachable', chrome.runtime.lastError.message);
      window.postMessage(
        createBridgeMessage('BRIDGE_ERROR', { reason: chrome.runtime.lastError.message }),
        '*'
      );
      return;
    }
    // Relay the SW's response (BRIDGE_READY) back to the page world.
    if (isBridgeMessage(response)) {
      window.postMessage(response, '*');
    }
  });
});

// ---------------------------------------------------------------------------
// Inject the page-world bridge + instrumentation bundle.
// Using web_accessible_resources so the page world can load our module.
// The script is injected at document_start so fetch/XHR wrapping happens
// before any page script can make a request.
// ---------------------------------------------------------------------------
const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/page/bridge.js');
script.type = 'module';
(document.head ?? document.documentElement).appendChild(script);
script.addEventListener('load', () => script.remove(), { once: true });
