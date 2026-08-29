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

// ---------------------------------------------------------------------------
// Saved originals
// ---------------------------------------------------------------------------
const _originalFetch: typeof window.fetch = window.fetch.bind(window);
const _OriginalXHR: typeof XMLHttpRequest = window.XMLHttpRequest;

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
  window.postMessage(createObservationMessage(obs), '*');
}

/**
 * Emit a CHAOS_INJECTED notification to the page window so it travels up
 * the content-script → SW pipeline and becomes a HavocEvent.
 * The payload is structured as an ObservationPayload so it reuses the
 * existing validated relay path — the SW distinguishes it by `type` in the
 * HavocEvent, not by a different message envelope.
 */
function emitChaosInjected(injectionId: string, runId: string, detail: string): void {
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

  window.fetch = async function havocFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const observationId = generateId();
    const startTime = performance.now();
    const url = input instanceof Request ? input.url : String(input);
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
// Chaos config management
// ---------------------------------------------------------------------------

export function activateChaos(params: ChaosParams): void {
  _chaosConfig = params;
  emitChaosInjected(
    params.injectionId,
    params.runId,
    params.kind === 'fetch_latency'
      ? `fetch_latency +${params.delayMs}ms`
      : `fetch_failure mode=${params.mode}`
  );
  console.log('[HAVOC][instrumentation] chaos activated:', params.kind, params.injectionId);
}

export function deactivateChaos(injectionId: string): void {
  if (_chaosConfig?.injectionId !== injectionId) {
    console.warn('[HAVOC][instrumentation] deactivateChaos: unknown injectionId', injectionId);
    return;
  }
  _chaosConfig = null;
  console.log('[HAVOC][instrumentation] chaos deactivated:', injectionId);
}

export function getActiveChaos(): ChaosParams | null {
  return _chaosConfig;
}

// ---------------------------------------------------------------------------
// XMLHttpRequest wrapper (unchanged from Phase 2 — chaos only targets fetch in V1)
// ---------------------------------------------------------------------------

export function wrapXHR(): void {
  if (_xhrWrapped) return;
  _xhrWrapped = true;

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
      this._havocObservationId = generateId();
      super.open(method, url, async, username ?? null, password ?? null);
    }

    override send(body?: Document | XMLHttpRequestBodyInit | null): void {
      this._havocStartTime = performance.now();

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
