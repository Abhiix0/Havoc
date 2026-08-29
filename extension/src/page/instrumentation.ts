/**
 * instrumentation.ts — fetch and XHR wrapping, PAGE WORLD ONLY.
 *
 * This module runs inside the page's JavaScript context (injected via a
 * web-accessible script). It has access to the real window.fetch and
 * window.XMLHttpRequest, which is why instrumentation must happen here and
 * not in the content script world — content scripts run in an isolated world
 * that shares the DOM but has its own JS globals. Wrapping fetch in the
 * content script world only intercepts the content script's own fetch calls,
 * not the page's.
 *
 * Design for reversibility: original references are captured before any
 * wrapping occurs. restoreFetch() and restoreXHR() re-assign them. Both are
 * exported so bridge.ts (or a future chaos engine) can call them at teardown.
 *
 * Three distinct outcomes — never collapsed:
 *   success          2xx or any resolved response with ok === true
 *   http_failure     resolved response with ok === false  (4xx / 5xx)
 *   transport_failure fetch rejection / XHR error event  (no response)
 *   timeout          XHR ontimeout / fetch AbortSignal timeout
 *                    (fetch timeout detection stubbed here; wired in Phase 4)
 */

import { createObservationMessage, type ObservationPayload } from '../messaging/messages';

// ---------------------------------------------------------------------------
// Saved originals — captured once at module evaluation time.
// ---------------------------------------------------------------------------
const _originalFetch: typeof window.fetch = window.fetch.bind(window);
const _OriginalXHR: typeof XMLHttpRequest = window.XMLHttpRequest;

let _fetchWrapped = false;
let _xhrWrapped = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  // crypto.randomUUID() is available in all modern browsers including MV3 page worlds.
  return crypto.randomUUID();
}

function emit(obs: ObservationPayload): void {
  window.postMessage(createObservationMessage(obs), '*');
}

// ---------------------------------------------------------------------------
// fetch wrapper
// ---------------------------------------------------------------------------

export function wrapFetch(): void {
  if (_fetchWrapped) return;
  _fetchWrapped = true;

  window.fetch = async function havocFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const observationId = generateId();
    const startTime = performance.now();
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    let response: Response;
    try {
      response = await _originalFetch(input, init);
    } catch (err) {
      // Transport failure — fetch Promise rejected.
      const duration = performance.now() - startTime;
      emit({
        observationId,
        transport: 'fetch',
        outcome: 'transport_failure',
        url,
        method,
        status: 0,
        startTime,
        duration,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err; // re-throw so calling code is unaffected
    }

    const duration = performance.now() - startTime;

    if (response.ok) {
      emit({
        observationId,
        transport: 'fetch',
        outcome: 'success',
        url,
        method,
        status: response.status,
        startTime,
        duration,
      });
    } else {
      // HTTP failure — response received but not ok (4xx / 5xx).
      emit({
        observationId,
        transport: 'fetch',
        outcome: 'http_failure',
        url,
        method,
        status: response.status,
        startTime,
        duration,
      });
    }

    return response;
  };
}

export function restoreFetch(): void {
  if (!_fetchWrapped) return;
  window.fetch = _originalFetch;
  _fetchWrapped = false;
}

// ---------------------------------------------------------------------------
// XMLHttpRequest wrapper
// ---------------------------------------------------------------------------

export function wrapXHR(): void {
  if (_xhrWrapped) return;
  _xhrWrapped = true;

  // Subclass the original XHR so instanceof checks and prototype chains
  // remain intact for code that inspects them.
  class HavocXMLHttpRequest extends _OriginalXHR {
    private _havocObservationId: string = generateId();
    private _havocStartTime: number = 0;
    private _havocUrl: string = '';
    private _havocMethod: string = 'GET';

    override open(
      method: string,
      url: string | URL,
      async: boolean = true,
      username?: string | null,
      password?: string | null
    ): void {
      this._havocMethod = method.toUpperCase();
      this._havocUrl = String(url);
      // Re-generate per open() call so a reused XHR object gets a fresh id.
      this._havocObservationId = generateId();
      super.open(method, url, async, username ?? null, password ?? null);
    }

    override send(body?: Document | XMLHttpRequestBodyInit | null): void {
      this._havocStartTime = performance.now();

      this.addEventListener('load', () => {
        const duration = performance.now() - this._havocStartTime;
        const outcome = this.status >= 200 && this.status < 300 ? 'success' : 'http_failure';
        emit({
          observationId: this._havocObservationId,
          transport: 'xhr',
          outcome,
          url: this._havocUrl,
          method: this._havocMethod,
          status: this.status,
          startTime: this._havocStartTime,
          duration,
        });
      });

      this.addEventListener('error', () => {
        const duration = performance.now() - this._havocStartTime;
        emit({
          observationId: this._havocObservationId,
          transport: 'xhr',
          outcome: 'transport_failure',
          url: this._havocUrl,
          method: this._havocMethod,
          status: 0,
          startTime: this._havocStartTime,
          duration,
          errorMessage: 'XHR network error',
        });
      });

      this.addEventListener('timeout', () => {
        const duration = performance.now() - this._havocStartTime;
        emit({
          observationId: this._havocObservationId,
          transport: 'xhr',
          outcome: 'timeout',
          url: this._havocUrl,
          method: this._havocMethod,
          status: 0,
          startTime: this._havocStartTime,
          duration,
          errorMessage: `XHR timed out after ${this.timeout}ms`,
        });
      });

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
// Convenience: activate / deactivate both at once
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
