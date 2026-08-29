import { isBridgeMessage } from '../messaging/validator';

console.log('[HAVOC][content] content script loaded on', location.href);

// Relay: page (untrusted) -> service worker (privileged), validated first.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;       // ignore messages from iframes/other windows
  if (!isBridgeMessage(event.data)) return;   // reject anything not shaped like our protocol

  console.log('[HAVOC][content] forwarding', event.data.type, 'to service worker');

  chrome.runtime.sendMessage(event.data, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[HAVOC][content] service worker unreachable', chrome.runtime.lastError.message);
      return;
    }
    if (isBridgeMessage(response)) {
      window.postMessage(response, '*');
    }
  });
});

// Inject the page-world bridge script so it can hook fetch/XHR later.
const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/page/bridge.js');
script.type = 'module';
(document.head || document.documentElement).appendChild(script);
script.onload = () => script.remove();