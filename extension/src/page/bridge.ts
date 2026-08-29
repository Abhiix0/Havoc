/**
 * bridge.ts — page-world protocol entry point.
 *
 * Message flow handled here:
 *   BRIDGE_HELLO      → sent to content script to initiate handshake
 *   BRIDGE_READY      ← received from content script; activates instrumentation
 *   BRIDGE_ERROR      ← received from content script; deactivates instrumentation
 *   INJECT_CHAOS      ← received from content script (relayed from SW); activates chaos
 *   REMOVE_CHAOS      ← received from content script (relayed from SW); deactivates chaos
 *
 * Protocol messages (BRIDGE_HELLO, REQUEST_OBSERVATION) that originate here
 * and echo back via window.postMessage are silently ignored in the switch.
 */

import { createBridgeMessage } from '../messaging/messages';
import { isBridgeMessage, isChaosMessage, isRemoveChaosMessage } from '../messaging/validator';
import {
  activateInstrumentation,
  deactivateInstrumentation,
  activateChaos,
  deactivateChaos,
} from './instrumentation';

console.log('[HAVOC][page] bridge script running in page world');

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;

  // Chaos commands arrive as plain BridgeMessages — check them before the
  // generic isBridgeMessage path so they get their typed payload validated.
  if (isChaosMessage(event.data)) {
    console.log('[HAVOC][page] INJECT_CHAOS received:', event.data.payload.kind, event.data.payload.injectionId);
    activateChaos(event.data.payload);
    return;
  }

  if (isRemoveChaosMessage(event.data)) {
    console.log('[HAVOC][page] REMOVE_CHAOS received:', event.data.payload.injectionId);
    deactivateChaos(event.data.payload.injectionId);
    return;
  }

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
      deactivateInstrumentation();
      break;

    default:
      // BRIDGE_HELLO / REQUEST_OBSERVATION echoes — ignore.
      break;
  }
});

window.postMessage(createBridgeMessage('BRIDGE_HELLO'), '*');
