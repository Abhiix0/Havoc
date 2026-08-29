/**
 * bridge.ts — page-world protocol entry point.
 *
 * Responsibilities (protocol transport only — no instrumentation logic here):
 *   1. Send BRIDGE_HELLO to announce the page script is live.
 *   2. Listen for BRIDGE_READY from the content script and activate
 *      instrumentation only after the handshake is confirmed, so we
 *      never emit observations before the relay pipeline is ready.
 *   3. Forward any BRIDGE_ERROR gracefully (log + leave instrumentation off).
 *
 * Instrumentation concerns live entirely in instrumentation.ts.
 */

import { createBridgeMessage } from '../messaging/messages';
import { isBridgeMessage } from '../messaging/validator';
import { activateInstrumentation, deactivateInstrumentation } from './instrumentation';

console.log('[HAVOC][page] bridge script running in page world');

// ---------------------------------------------------------------------------
// Inbound handler — listens for replies from the content script.
// ---------------------------------------------------------------------------
window.addEventListener('message', (event: MessageEvent) => {
  // Ignore messages that didn't originate from this same window (e.g. iframes).
  if (event.source !== window) return;
  if (!isBridgeMessage(event.data)) return;

  switch (event.data.type) {
    case 'BRIDGE_READY':
      console.log('[HAVOC][page] handshake complete — activating instrumentation');
      activateInstrumentation();
      break;

    case 'BRIDGE_ERROR':
      console.error(
        '[HAVOC][page] bridge error from content script — instrumentation NOT activated',
        event.data.payload
      );
      // Ensure instrumentation is not left in a partial state if something
      // sent BRIDGE_ERROR after a BRIDGE_READY (shouldn't happen in Phase 2,
      // but deactivate defensively).
      deactivateInstrumentation();
      break;

    default:
      // REQUEST_OBSERVATION and BRIDGE_HELLO echo back from the window — ignore.
      break;
  }
});

// ---------------------------------------------------------------------------
// Kick off the handshake.  The content script will validate and respond with
// BRIDGE_READY (relayed back via window.postMessage) or BRIDGE_ERROR.
// ---------------------------------------------------------------------------
window.postMessage(createBridgeMessage('BRIDGE_HELLO'), '*');
