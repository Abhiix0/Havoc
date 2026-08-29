/**
 * content-script.ts — trusted relay between the untrusted page world and the
 * privileged service worker.
 *
 * Message flow:
 *   page → content → SW:   BRIDGE_HELLO, REQUEST_OBSERVATION
 *   SW   → content → page: BRIDGE_READY, BRIDGE_ERROR, INJECT_CHAOS, REMOVE_CHAOS
 *
 * Phase 4 additions:
 *   - chrome.runtime.onMessage now handles INJECT_CHAOS and REMOVE_CHAOS sent
 *     by the SW via chrome.tabs.sendMessage. These are forwarded to the page
 *     world via window.postMessage so bridge.ts can apply them.
 *   - INJECT_CHAOS and REMOVE_CHAOS are NOT forwarded back to the SW from
 *     window.addEventListener('message') — they originate from the SW, not
 *     the page, so relaying them back would be a loop.
 *
 * Security model (unchanged):
 *   - Everything arriving via window.addEventListener('message') is UNTRUSTED.
 *   - Only BRIDGE_HELLO and REQUEST_OBSERVATION are forwarded to the SW.
 *   - INJECT_CHAOS / REMOVE_CHAOS are only accepted from chrome.runtime
 *     (the SW), never from the untrusted page world.
 */

import { isBridgeMessage, isObservationMessage } from '../messaging/validator';
import { createBridgeMessage } from '../messaging/messages';

console.log('[HAVOC][content] content script loaded on', location.href);

// ---------------------------------------------------------------------------
// SW → page relay: INJECT_CHAOS, REMOVE_CHAOS, and any future SW→page commands.
// Registered synchronously so the SW can send commands immediately after startup.
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isBridgeMessage(message)) return false;

  // These message types originate in the SW and must be forwarded to the page.
  if (message.type === 'INJECT_CHAOS' || message.type === 'REMOVE_CHAOS') {
    window.postMessage(message, '*');
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Page → SW relay: BRIDGE_HELLO, REQUEST_OBSERVATION.
// ---------------------------------------------------------------------------
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;

  // --- REQUEST_OBSERVATION: page → SW, fire-and-forget ---
  if (isObservationMessage(event.data)) {
    chrome.runtime.sendMessage(event.data, (response) => {
      if (chrome.runtime.lastError) {
        console.warn(
          '[HAVOC][content] SW unreachable forwarding observation',
          chrome.runtime.lastError.message
        );
      }
      void response;
    });
    return;
  }

  // --- Only BRIDGE_HELLO travels page → SW ---
  if (!isBridgeMessage(event.data)) return;
  if (event.data.type !== 'BRIDGE_HELLO') return;

  console.log('[HAVOC][content] forwarding BRIDGE_HELLO to service worker');

  chrome.runtime.sendMessage(event.data, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[HAVOC][content] service worker unreachable', chrome.runtime.lastError.message);
      window.postMessage(
        createBridgeMessage('BRIDGE_ERROR', { reason: chrome.runtime.lastError.message }),
        '*'
      );
      return;
    }
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
