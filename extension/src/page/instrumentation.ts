/**
 * instrumentation.ts — fetch and XHR wrapping + chaos injection, PAGE WORLD ONLY.
 *
 * V1 scope note: chaos applies to ALL fetches on the instrumented page.
 * Selective per-URL filtering is not implemented in V1 — this is a deliberate
 * explicit choice, not an oversight. The experiment intentionally targets the
 * entire fetch surface of the application under test. A 'urlPattern' field
 * will be added in a future phase to narrow scope.
 *
 * Chaos is applied inside the EXISTING fetch wrapper from Phase 2 — we do not
 * re-wrap fetch again. Instead, the wrapper checks a module-level _chaosConfig
 * slot on every request and applies the configured behaviour before calling
 * through to the original fetch.
 */

import {
  createObservationMessage,
  createBridgeMessage,
  type ObservationPayload,
  type ChaosParams,
  type FetchLatencyChaosParams,
  type FetchFailureChaosParams,
} from '../messaging/messages';
import { sanitizeUrl } from '../shared/sanitize-url';
import { getSessionNonce } from './bridge';

// ---------------------------------------------------------------------------
// Saved originals
// ---------------------------------------------------------------------------
let _originalFetch: typeof window.fetch =
  typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : ((() => {}) as unknown as typeof window.fetch);
let _OriginalXHR: typeof XMLHttpRequest =
  typeof window !== 'undefined'
    ? window.XMLHttpRequest
    : (class {} as unknown as typeof XMLHttpRequest);

let _fetchWrapped = false;
let _xhrWrapped = false;

// ---------------------------------------------------------------------------
// Active chaos config — null when no chaos is active.
// ---------------------------------------------------------------------------
let _chaosConfig: ChaosParams | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return crypto.randomUUID();
}

function emitObservation(obs: ObservationPayload): void {
  const nonce = getSessionNonce();
  const sanitized: ObservationPayload = {
    ...obs,
    url: sanitizeUrl(obs.url),
    ...(nonce !== null && { nonce }),
  };
  window.postMessage(createObservationMessage(sanitized), '*');
}

/**
 * Emit a CHAOS_INJECTED notification to the page window so it travels up
 * the content-script → SW pipeline and becomes a HavocEvent.
 * The payload is structured as an ObservationPayload so it reuses the
 * existing validated relay path — the SW distinguishes it by `type` in the
 * HavocEvent, not by a different message envelope.
 */
function emitChaosInjected(injectionId: string, runId: string, detail: string): void {
  const nonce = getSessionNonce();
  window.postMessage(
    createBridgeMessage('REQUEST_OBSERVATION', {
      observationId: injectionId,
      transport: 'fetch',
      outcome: 'success',        // sentinel — the SW maps this to CHAOS_INJECTED
      url: '__chaos_injected__', // sentinel URL the SW recognises
      method: 'CHAOS',
      status: 0,
      startTime: performance.now(),
      duration: 0,
      injectionId,
      runId,
      chaosDetail: detail,       // extra metadata for the CHAOS_INJECTED event
      ...(nonce !== null && { nonce }),
    }),
    '*'
  );
}

// ---------------------------------------------------------------------------
// Chaos application helpers (called from inside the fetch wrapper)
// ---------------------------------------------------------------------------

async function applyLatencyChaos(
  config: FetchLatencyChaosParams,
  input: RequestInfo | URL,
  init: RequestInit | undefined
): Promise<Response> {
  await new Promise<void>((resolve) => setTimeout(resolve, config.delayMs));
  return _originalFetch(input, init);
}

async function applyFailureChaos(
  config: FetchFailureChaosParams,
  input: RequestInfo | URL,
  init: RequestInit | undefined
): Promise<Response> {
  switch (config.mode) {
    case 'transport_error':
      throw new TypeError('HAVOC: simulated network failure');

    case 'synthetic_http_error': {
      const status = config.syntheticStatus ?? 503;
      return new Response(null, {
        status,
        statusText: `HAVOC synthetic ${status}`,
      });
    }

    case 'synthetic_timeout': {
      const ms = config.timeoutMs ?? 30_000;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), ms);
      try {
        // Delegate to original but with an abort signal — this will throw
        // an AbortError after timeoutMs, simulating a real timeout.
        return await _originalFetch(input, { ...init, signal: ac.signal });
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// fetch wrapper
// ---------------------------------------------------------------------------

export function wrapFetch(): void {
  if (_fetchWrapped) return;
  _fetchWrapped = true;
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    _originalFetch = window.fetch.bind(window);
  }

  window.fetch = async function havocFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const observationId = generateId();
    const startTime = performance.now();
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = sanitizeUrl(rawUrl);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    // Attach the active injectionId so the SW can link this observation
    // back to the CHAOS_INJECTED event.
    const activeInjectionId = _chaosConfig?.injectionId;

    let response: Response;
    try {
      if (_chaosConfig?.kind === 'fetch_latency') {
        response = await applyLatencyChaos(_chaosConfig, input, init);
      } else if (_chaosConfig?.kind === 'fetch_failure') {
        response = await applyFailureChaos(_chaosConfig, input, init);
      } else {
        response = await _originalFetch(input, init);
      }
    } catch (err) {
      const duration = performance.now() - startTime;
      emitObservation({
        observationId,
        transport: 'fetch',
        outcome: 'transport_failure',
        url,
        method,
        status: 0,
        startTime,
        duration,
        errorMessage: err instanceof Error ? err.message : String(err),
        ...(activeInjectionId !== undefined && { injectionId: activeInjectionId }),
      });
      throw err;
    }

    const duration = performance.now() - startTime;

    // Determine outcome — for synthetic_timeout the AbortError is caught
    // above as transport_failure; here we classify the HTTP response.
    const outcome = response.ok ? 'success' : 'http_failure';
    emitObservation({
      observationId,
      transport: 'fetch',
      outcome,
      url,
      method,
      status: response.status,
      startTime,
      duration,
      ...(activeInjectionId !== undefined && { injectionId: activeInjectionId }),
    });

    return response;
  };
}

export function restoreFetch(): void {
  if (!_fetchWrapped) return;
  window.fetch = _originalFetch;
  _fetchWrapped = false;
}

// ---------------------------------------------------------------------------
// Input Stress (Passive Only) & Viewport Stress (CSS Layout Constraints)
// ---------------------------------------------------------------------------

interface RestorableInput {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  originalValue: string;
  originalChecked?: boolean | undefined;
}

const _restorableInputs = new Map<string, RestorableInput[]>();
const _viewportStyles = new Map<string, HTMLStyleElement>();

function getStressValue(mode: string | undefined, inputType: string, index: number): string {
  switch (mode) {
    case 'empty':
      return '';
    case 'whitespace':
      return '   \t\n   ';
    case 'unicode':
      return '᚛᚛ᚉᚑᚅᚅᚐᚉᚈ᚜᚜ \u202E\u0000\uFEFF\u0007\u001B';
    case 'emoji':
      return '💥💣🧪🚀⚡🔥👾👻💀🤖🚨🚩⚠️';
    case 'long_text':
      return 'A'.repeat(5000) + '🔥' + 'B'.repeat(5000);
    case 'numeric_extreme':
      return inputType === 'number' || inputType === 'range' ? '999999999999' : '1e308';
    case 'all':
    default: {
      const candidates = [
        '᚛᚛ᚉᚑᚅᚅᚐᚉᚈ᚜᚜ \u202E\u0000\uFEFF',
        '💥💣🧪🚀⚡🔥',
        '   \t\n   ',
        'A'.repeat(1200),
        '9999999999',
        '',
      ];
      return candidates[index % candidates.length] ?? '';
    }
  }
}

function applyInputStress(params: import('../messaging/messages').InputStressChaosParams): void {
  const elements = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input:not([type="submit"]):not([type="button"]):not([type="image"]):not([type="hidden"]):not([type="password"]), textarea, select'
    )
  );

  const saved: RestorableInput[] = [];

  elements.forEach((el, index) => {
    saved.push({
      element: el,
      originalValue: el.value,
      originalChecked: el instanceof HTMLInputElement ? el.checked : undefined,
    });

    const inputType = (el instanceof HTMLInputElement ? el.type : el.tagName).toLowerCase();

    if (inputType === 'checkbox' || inputType === 'radio') {
      if (el instanceof HTMLInputElement) {
        el.checked = !el.checked;
      }
    } else {
      el.value = getStressValue(params.mode, inputType, index);
    }

    // PASSIVE ONLY: Dispatch standard input/change events for UI reaction,
    // but NEVER invoke form.submit() or trigger clicks on submit buttons.
    try {
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    } catch {
      // safe ignore
    }
  });

  _restorableInputs.set(params.injectionId, saved);
}

function restoreInputStress(injectionId: string): void {
  const saved = _restorableInputs.get(injectionId);
  if (!saved) return;

  for (const item of saved) {
    if (document.contains(item.element)) {
      item.element.value = item.originalValue;
      if (item.element instanceof HTMLInputElement && item.originalChecked !== undefined) {
        item.element.checked = item.originalChecked;
      }
      try {
        item.element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        item.element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      } catch {
        // safe ignore
      }
    }
  }

  _restorableInputs.delete(injectionId);
}

function applyViewportStress(params: import('../messaging/messages').ViewportStressChaosParams): void {
  const styleEl = document.createElement('style');
  styleEl.id = `havoc-viewport-stress-${params.injectionId}`;

  let css = '';
  switch (params.mode) {
    case 'overflow_squeeze':
      css = `
        html, body {
          max-width: 280px !important;
          width: 280px !important;
          overflow-x: auto !important;
          box-shadow: 0 0 30px rgba(255, 0, 80, 0.4) !important;
        }
      `;
      break;
    case 'extreme_zoom':
      css = `
        html {
          zoom: 2.0 !important;
        }
      `;
      break;
    case 'mobile_narrow':
    default:
      css = `
        html, body {
          max-width: 320px !important;
          min-width: 320px !important;
          width: 320px !important;
          margin: 0 auto !important;
          overflow-x: auto !important;
          box-shadow: 0 0 30px rgba(0, 240, 255, 0.4) !important;
        }
      `;
      break;
  }

  styleEl.textContent = css;
  (document.head ?? document.documentElement).appendChild(styleEl);
  _viewportStyles.set(params.injectionId, styleEl);

  try {
    window.dispatchEvent(new Event('resize'));
  } catch {
    // safe ignore
  }
}

function restoreViewportStress(injectionId: string): void {
  const styleEl = _viewportStyles.get(injectionId);
  if (styleEl) {
    styleEl.remove();
    _viewportStyles.delete(injectionId);
    try {
      window.dispatchEvent(new Event('resize'));
    } catch {
      // safe ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Chaos config management
// ---------------------------------------------------------------------------

export function activateChaos(params: ChaosParams): void {
  _chaosConfig = params;

  let detail = '';
  if (params.kind === 'fetch_latency') {
    detail = `fetch_latency +${params.delayMs}ms`;
  } else if (params.kind === 'fetch_failure') {
    detail = `fetch_failure mode=${params.mode}`;
  } else if (params.kind === 'input_stress') {
    applyInputStress(params);
    detail = `input_stress mode=${params.mode ?? 'all'}`;
  } else if (params.kind === 'viewport_stress') {
    applyViewportStress(params);
    detail = `viewport_stress mode=${params.mode ?? 'mobile_narrow'}`;
  }

  emitChaosInjected(params.injectionId, params.runId, detail);
  console.log('[HAVOC][instrumentation] chaos activated:', params.kind, params.injectionId);
}

export function deactivateChaos(injectionId: string): void {
  if (_chaosConfig?.injectionId !== injectionId) {
    console.warn('[HAVOC][instrumentation] deactivateChaos: unknown injectionId', injectionId);
    return;
  }

  if (_chaosConfig.kind === 'input_stress') {
    restoreInputStress(injectionId);
  } else if (_chaosConfig.kind === 'viewport_stress') {
    restoreViewportStress(injectionId);
  }

  _chaosConfig = null;
  console.log('[HAVOC][instrumentation] chaos deactivated:', injectionId);
}

export function getActiveChaos(): ChaosParams | null {
  return _chaosConfig;
}

// ---------------------------------------------------------------------------
// XMLHttpRequest wrapper (fetch_latency and fetch_failure chaos parity)
// ---------------------------------------------------------------------------

export function wrapXHR(): void {
  if (_xhrWrapped) return;
  _xhrWrapped = true;
  if (typeof window !== 'undefined' && window.XMLHttpRequest) {
    _OriginalXHR = window.XMLHttpRequest;
  }

  class HavocXMLHttpRequest extends _OriginalXHR {
    private _havocObservationId: string = generateId();
    private _havocStartTime: number = 0;
    private _havocUrl: string = '';
    private _havocMethod: string = 'GET';
    private _havocInjectionId?: string | undefined;

    override open(
      method: string,
      url: string | URL,
      async: boolean = true,
      username?: string | null,
      password?: string | null
    ): void {
      this._havocMethod = method.toUpperCase();
      this._havocUrl = sanitizeUrl(String(url));
      this._havocObservationId = generateId();
      super.open(method, url, async, username ?? null, password ?? null);
    }

    override send(body?: Document | XMLHttpRequestBodyInit | null): void {
      this._havocStartTime = performance.now();
      const cfg = _chaosConfig;
      this._havocInjectionId = cfg?.injectionId;

      this.addEventListener('load', () => {
        const duration = performance.now() - this._havocStartTime;
        const outcome = this.status >= 200 && this.status < 300 ? 'success' : 'http_failure';
        emitObservation({
          observationId: this._havocObservationId,
          transport: 'xhr',
          outcome,
          url: this._havocUrl,
          method: this._havocMethod,
          status: this.status,
          startTime: this._havocStartTime,
          duration,
          ...(this._havocInjectionId !== undefined && { injectionId: this._havocInjectionId }),
        });
      });

      this.addEventListener('error', () => {
        const duration = performance.now() - this._havocStartTime;
        emitObservation({
          observationId: this._havocObservationId,
          transport: 'xhr',
          outcome: 'transport_failure',
          url: this._havocUrl,
          method: this._havocMethod,
          status: 0,
          startTime: this._havocStartTime,
          duration,
          errorMessage: 'XHR network error',
          ...(this._havocInjectionId !== undefined && { injectionId: this._havocInjectionId }),
        });
      });

      this.addEventListener('timeout', () => {
        const duration = performance.now() - this._havocStartTime;
        emitObservation({
          observationId: this._havocObservationId,
          transport: 'xhr',
          outcome: 'timeout',
          url: this._havocUrl,
          method: this._havocMethod,
          status: 0,
          startTime: this._havocStartTime,
          duration,
          errorMessage: `XHR timed out after ${this.timeout}ms`,
          ...(this._havocInjectionId !== undefined && { injectionId: this._havocInjectionId }),
        });
      });

      if (cfg?.kind === 'fetch_latency') {
        setTimeout(() => {
          super.send(body);
        }, cfg.delayMs);
        return;
      }

      if (cfg?.kind === 'fetch_failure') {
        switch (cfg.mode) {
          case 'transport_error': {
            setTimeout(() => {
              try {
                Object.defineProperty(this, 'readyState', { value: 4, configurable: true, writable: true });
                Object.defineProperty(this, 'status', { value: 0, configurable: true, writable: true });
              } catch {
                // Ignore defineProperty errors
              }
              const Evt = typeof ProgressEvent !== 'undefined' ? ProgressEvent : Event;
              this.dispatchEvent(new Event('readystatechange'));
              this.dispatchEvent(new Evt('error'));
              this.dispatchEvent(new Evt('loadend'));
            }, 0);
            return;
          }

          case 'synthetic_http_error': {
            const status = cfg.syntheticStatus ?? 503;
            const statusText = `HAVOC synthetic ${status}`;
            setTimeout(() => {
              try {
                Object.defineProperty(this, 'readyState', { value: 4, configurable: true, writable: true });
                Object.defineProperty(this, 'status', { value: status, configurable: true, writable: true });
                Object.defineProperty(this, 'statusText', { value: statusText, configurable: true, writable: true });
                Object.defineProperty(this, 'response', { value: '', configurable: true, writable: true });
                Object.defineProperty(this, 'responseText', { value: '', configurable: true, writable: true });
              } catch {
                // Ignore defineProperty errors
              }
              const Evt = typeof ProgressEvent !== 'undefined' ? ProgressEvent : Event;
              this.dispatchEvent(new Event('readystatechange'));
              this.dispatchEvent(new Evt('load'));
              this.dispatchEvent(new Evt('loadend'));
            }, 0);
            return;
          }

          case 'synthetic_timeout': {
            this.timeout = cfg.timeoutMs ?? 30_000;
            super.send(body);
            return;
          }
        }
      }

      super.send(body);
    }
  }

  window.XMLHttpRequest = HavocXMLHttpRequest as unknown as typeof XMLHttpRequest;
}

export function restoreXHR(): void {
  if (!_xhrWrapped) return;
  window.XMLHttpRequest = _OriginalXHR;
  _xhrWrapped = false;
}

// ---------------------------------------------------------------------------
// Convenience: activate / deactivate instrumentation (not chaos)
// ---------------------------------------------------------------------------

export function activateInstrumentation(): void {
  wrapFetch();
  wrapXHR();
  console.log('[HAVOC][instrumentation] fetch and XHR wrapped');
}

export function deactivateInstrumentation(): void {
  restoreFetch();
  restoreXHR();
  console.log('[HAVOC][instrumentation] fetch and XHR restored');
}
