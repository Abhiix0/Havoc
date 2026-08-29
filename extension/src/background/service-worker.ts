import { createBridgeMessage } from '../messaging/messages';
import { isBridgeMessage } from '../messaging/validator';
import { openDatabase } from '../storage/database';

console.log('[HAVOC][SW] service worker booted');

openDatabase()
  .then(() => console.log('[HAVOC][SW] IndexedDB ready'))
  .catch((err) => console.error('[HAVOC][SW] IndexedDB failed to open', err));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isBridgeMessage(message)) return false;

  console.log('[HAVOC][SW] received', message.type, 'from tab', sender.tab?.id);

  if (message.type === 'BRIDGE_HELLO') {
    sendResponse(createBridgeMessage('BRIDGE_READY'));
    return true; // keep the message channel open for the async sendResponse
  }

  return false;
});