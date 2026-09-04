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
import {
  activateRuntimeErrorCapture,
  deactivateRuntimeErrorCapture,
} from './runtime-error-capture';

let _sessionNonce: string | null = null;

export function setSessionNonce(nonce: string | null): void {
  _sessionNonce = nonce;
}

export function getSessionNonce(): string | null {
  return _sessionNonce;
}

if (typeof window !== 'undefined') {
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
      case 'BRIDGE_READY': {
        const payload = event.data.payload as { nonce?: string } | undefined;
        const nonce = typeof payload?.nonce === 'string' ? payload.nonce : null;
        setSessionNonce(nonce);
        console.log('[HAVOC][page] handshake complete — activating instrumentation');
        activateInstrumentation();
        break;
      }

      case 'BRIDGE_ERROR':
        console.error(
          '[HAVOC][page] bridge error from content script — instrumentation NOT activated',
          event.data.payload
        );
        setSessionNonce(null);
        deactivateInstrumentation();
        break;

      case 'ENABLE_RUNTIME_ERROR_CAPTURE':
        console.log('[HAVOC][page] ENABLE_RUNTIME_ERROR_CAPTURE received');
        activateRuntimeErrorCapture();
        break;

      case 'DISABLE_RUNTIME_ERROR_CAPTURE':
        console.log('[HAVOC][page] DISABLE_RUNTIME_ERROR_CAPTURE received');
        deactivateRuntimeErrorCapture();
        break;

      default:
        // BRIDGE_HELLO / REQUEST_OBSERVATION echoes — ignore.
        break;
    }
  });

  window.postMessage(createBridgeMessage('BRIDGE_HELLO'), '*');
}
