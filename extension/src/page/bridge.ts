import { createBridgeMessage } from '../messaging/messages';
import { isBridgeMessage } from '../messaging/validator';

console.log('[HAVOC][page] bridge script running in page world');

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!isBridgeMessage(event.data)) return;

  if (event.data.type === 'BRIDGE_READY') {
    console.log('[HAVOC][page] bridge ready — handshake complete');
  }
});

window.postMessage(createBridgeMessage('BRIDGE_HELLO'), '*');