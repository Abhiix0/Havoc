/**
 * content-script.ts — trusted relay between the untrusted page world and the
 * privileged service worker.
 *
 * Message flow:
 *   page → content → SW:   BRIDGE_HELLO, REQUEST_OBSERVATION
 *   content → SW:          DOM_OBSERVATION (from MutationObserver, not page world)
 *   SW → content → page:   BRIDGE_READY, BRIDGE_ERROR, INJECT_CHAOS, REMOVE_CHAOS
 *
 * Phase 5 additions:
 *   - A MutationObserver watches the document for loading indicators and error
 *     text. Classified mutations are sent directly to the SW as DOM_OBSERVATION
 *     messages via chrome.runtime.sendMessage. They do NOT pass through the
 *     postMessage/page-world channel — the content script is a trusted context
 *     and has direct chrome.runtime access.
 *   - DOM observation is scoped to the active run's duration. The MutationObserver
 *     is created on document load and disconnected when the content script unloads
 *     (on navigation). The runId is sampled from chrome.storage.session at emission
 *     time via a lightweight in-memory snapshot maintained by listening to
 *     RUN_STATE_UPDATE messages from the SW.
 *
 * Security model:
 *   - Only BRIDGE_HELLO and REQUEST_OBSERVATION are forwarded from the page to SW.
 *   - INJECT_CHAOS / REMOVE_CHAOS are only accepted from chrome.runtime (SW).
 *   - DOM_OBSERVATION originates entirely in the content script — no page input.
 */

import {
  isBridgeMessage,
  isObservationMessage,
  isRunStateUpdateMessage,
  isRuntimeErrorObservationMessage,
} from '../messaging/validator';
import { createBridgeMessage, createDomObservationMessage } from '../messaging/messages';
import type { DomMutationKind } from '../messaging/messages';

console.log('[HAVOC][content] content script loaded on', location.href);

// ---------------------------------------------------------------------------
// Track active runId — updated when the SW broadcasts RUN_STATE_UPDATE.
// Used to attach the correct runId to DOM_OBSERVATION payloads.
// ---------------------------------------------------------------------------
let _activeRunId: string | null = null;

// ---------------------------------------------------------------------------
// SW → content: track run state + relay chaos commands to page world.
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Track run state for DOM observation attribution.
  if (isRunStateUpdateMessage(message)) {
    _activeRunId = message.run?.runId ?? null;
    return false; // no response needed
  }

  if (!isBridgeMessage(message)) return false;

  if (
    message.type === 'INJECT_CHAOS' ||
    message.type === 'REMOVE_CHAOS' ||
    message.type === 'ENABLE_RUNTIME_ERROR_CAPTURE' ||
    message.type === 'DISABLE_RUNTIME_ERROR_CAPTURE'
  ) {
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

  if (isObservationMessage(event.data)) {
    chrome.runtime.sendMessage(event.data, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[HAVOC][content] SW unreachable forwarding observation', chrome.runtime.lastError.message);
      }
      void response;
    });
    return;
  }

  if (isRuntimeErrorObservationMessage(event.data)) {
    chrome.runtime.sendMessage(event.data, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[HAVOC][content] SW unreachable forwarding runtime error', chrome.runtime.lastError.message);
      }
      void response;
    });
    return;
  }

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
// DOM observation via MutationObserver
//
// What we watch for and why:
//
//   loading_indicator_appeared / removed
//     Elements matching class/role/aria heuristics for spinners and skeleton
//     screens. These tell the Signal Engine that the app entered a loading
//     state around the time chaos was injected — useful for LoadingStateDetected.
//
//   error_text_appeared
//     Text nodes or element text that matches common error message patterns
//     (error, failed, unavailable, retry, etc.). This is deliberately a loose
//     heuristic — the Signal Engine applies confidence discounting for it.
//
//   aria_live_changed
//     aria-live="polite|assertive" regions are the accessible mechanism apps
//     use to announce status changes. A change here shortly after a failure
//     event is a stronger signal than arbitrary text appearing.
//
// We do NOT emit every mutation — only classified ones. The throttle (50 ms
// batching from the MutationObserver callback) prevents flooding the SW with
// mutations from virtual-DOM frameworks that rewrite the DOM on every render.
// ---------------------------------------------------------------------------

// Patterns for loading indicator detection (class names, aria roles, test ids).
const LOADING_CLASS_RE = /\b(loading|spinner|skeleton|pending|busy|progress|shimmer)\b/i;
const LOADING_ROLE_RE  = /^(progressbar|status)$/i;

// Patterns for error text detection (loose, low-confidence).
const ERROR_TEXT_RE = /\b(error|failed|failure|unavailable|something went wrong|couldn'?t|unable to|retry|try again|network|timeout|timed out|offline)\b/i;

function buildSelector(el: Element): string {
  try {
    // Fast path: id gives a unique selector.
    if (el.id) return `#${CSS.escape(el.id)}`;
    // Include tag + first two class names for readability.
    const classes = Array.from(el.classList).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
    return `${el.tagName.toLowerCase()}${classes}`;
  } catch {
    return el.tagName.toLowerCase();
  }
}

function emitDomObservation(kind: DomMutationKind, el: Element, text: string): void {
  const msg = createDomObservationMessage({
    observedAt: performance.now(),
    timestamp: Date.now(),
    kind,
    selector: buildSelector(el).slice(0, 120),
    textSnippet: text.trim().slice(0, 80),
    runId: _activeRunId,
  });

  chrome.runtime.sendMessage(msg, (response) => {
    if (chrome.runtime.lastError) {
      // SW may be suspended — DOM observations are best-effort.
      void chrome.runtime.lastError;
    }
    void response;
  });
}

function classifyAddedNode(node: Node): void {
  if (!(node instanceof Element)) return;

  const el = node;
  const role = el.getAttribute('role') ?? '';
  const ariaLive = el.getAttribute('aria-live') ?? '';
  const classes = el.className;
  const text = el.textContent ?? '';

  // Loading indicator appeared?
  if (LOADING_CLASS_RE.test(classes) || LOADING_ROLE_RE.test(role)) {
    emitDomObservation('loading_indicator_appeared', el, '');
    return;
  }

  // aria-live region with content?
  if ((ariaLive === 'polite' || ariaLive === 'assertive') && text.trim().length > 0) {
    emitDomObservation('aria_live_changed', el, text);
    return;
  }

  // Error text appeared?
  if (ERROR_TEXT_RE.test(text) && text.trim().length > 4) {
    emitDomObservation('error_text_appeared', el, text);
  }
}

function classifyRemovedNode(node: Node): void {
  if (!(node instanceof Element)) return;
  const el = node;
  const classes = el.className;
  const role = el.getAttribute('role') ?? '';
  if (LOADING_CLASS_RE.test(classes) || LOADING_ROLE_RE.test(role)) {
    emitDomObservation('loading_indicator_removed', el, '');
  }
}

function classifyAttributeMutation(record: MutationRecord): void {
  if (!(record.target instanceof Element)) return;
  const el = record.target;
  const ariaLive = el.getAttribute('aria-live') ?? '';
  if ((ariaLive === 'polite' || ariaLive === 'assertive') && record.attributeName?.startsWith('aria-')) {
    const text = el.textContent ?? '';
    if (text.trim().length > 0) {
      emitDomObservation('aria_live_changed', el, text);
    }
  }
}

function classifyCharacterDataMutation(record: MutationRecord): void {
  const parent = record.target.parentElement;
  if (!parent) return;
  const text = parent.textContent ?? '';
  if (ERROR_TEXT_RE.test(text) && text.trim().length > 4) {
    emitDomObservation('error_text_appeared', parent, text);
  }
}

// Batch-process mutations — the MutationObserver fires callbacks in
// microtask batches; we process them all together.
const _observer = new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === 'childList') {
      record.addedNodes.forEach(classifyAddedNode);
      record.removedNodes.forEach(classifyRemovedNode);
    } else if (record.type === 'attributes') {
      classifyAttributeMutation(record);
    } else if (record.type === 'characterData') {
      classifyCharacterDataMutation(record);
    }
  }
});

// Start observing once the DOM is ready.
function startObserver(): void {
  _observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-live', 'aria-busy', 'aria-hidden', 'class', 'hidden', 'style'],
    characterData: true,
    characterDataOldValue: false,
  });
  console.log('[HAVOC][content] DOM observer active');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserver, { once: true });
} else {
  startObserver();
}

// ---------------------------------------------------------------------------
// Inject the page-world bridge + instrumentation bundle.
// ---------------------------------------------------------------------------
const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/page/bridge.js');
script.type = 'module';
(document.head ?? document.documentElement).appendChild(script);
script.addEventListener('load', () => script.remove(), { once: true });
