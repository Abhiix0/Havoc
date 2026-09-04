import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  wrapXHR,
  restoreXHR,
  activateChaos,
  deactivateChaos,
  getActiveChaos,
} from '../instrumentation';
import type {
  FetchLatencyChaosParams,
  FetchFailureChaosParams,
} from '../../messaging/messages';

// Mock base XMLHttpRequest class to track calls
class MockOriginalXMLHttpRequest extends EventTarget {
  static readonly UNSENT = 0;
  static readonly OPENED = 1;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly DONE = 4;

  readonly UNSENT = 0;
  readonly OPENED = 1;
  readonly HEADERS_RECEIVED = 2;
  readonly LOADING = 3;
  readonly DONE = 4;

  readyState: number = 0;
  status: number = 0;
  statusText: string = '';
  response: unknown = '';
  responseText: string = '';
  timeout: number = 0;

  onload: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  ontimeout: ((ev: Event) => void) | null = null;
  onreadystatechange: ((ev: Event) => void) | null = null;

  sendCalled: boolean = false;
  sentBody: unknown = null;

  open(_method: string, _url: string | URL, _async?: boolean, _username?: string | null, _password?: string | null): void {
    this.readyState = MockOriginalXMLHttpRequest.OPENED;
  }

  send(body?: unknown): void {
    this.sendCalled = true;
    this.sentBody = body;
  }

  // Helper to simulate successful response
  simulateResponse(status: number, responseText: string = ''): void {
    this.readyState = MockOriginalXMLHttpRequest.DONE;
    this.status = status;
    this.responseText = responseText;
    this.response = responseText;
    const readystateEvt = new Event('readystatechange');
    this.onreadystatechange?.(readystateEvt);
    this.dispatchEvent(readystateEvt);

    const loadEvt = new Event('load');
    this.onload?.(loadEvt);
    this.dispatchEvent(loadEvt);
  }

  // Helper to simulate timeout
  simulateTimeout(): void {
    this.readyState = MockOriginalXMLHttpRequest.DONE;
    const timeoutEvt = new Event('timeout');
    this.ontimeout?.(timeoutEvt);
    this.dispatchEvent(timeoutEvt);
  }
}

class MockProgressEvent extends Event {
  lengthComputable: boolean = false;
  loaded: number = 0;
  total: number = 0;
}

if (typeof ProgressEvent === 'undefined') {
  vi.stubGlobal('ProgressEvent', MockProgressEvent);
}

describe('XMLHttpRequest Chaos Parity', () => {
  let postedMessages: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    postedMessages = [];

    const mockWindow = {
      XMLHttpRequest: MockOriginalXMLHttpRequest as unknown as typeof XMLHttpRequest,
      fetch: vi.fn(),
      postMessage: vi.fn((message: unknown) => {
        postedMessages.push(message as Record<string, unknown>);
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };

    vi.stubGlobal('window', mockWindow);

    wrapXHR();
  });

  afterEach(() => {
    const active = getActiveChaos();
    if (active) {
      deactivateChaos(active.injectionId);
    }
    restoreXHR();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('1. fetch_latency: send() is delayed by config.delayMs before underlying request fires', () => {
    const params: FetchLatencyChaosParams = {
      kind: 'fetch_latency',
      delayMs: 800,
      injectionId: 'inj-latency-42',
      runId: 'run-lat-1',
    };
    activateChaos(params);

    const xhr = new window.XMLHttpRequest();
    xhr.open('POST', 'https://example.com/api/save');
    xhr.send('payload=test');

    const mockInstance = xhr as unknown as MockOriginalXMLHttpRequest;

    // At t=0, underlying super.send should NOT have been called yet
    expect(mockInstance.sendCalled).toBe(false);

    // Fast-forward by 799ms - still not called
    vi.advanceTimersByTime(799);
    expect(mockInstance.sendCalled).toBe(false);

    // Fast-forward to 800ms - now super.send is called
    vi.advanceTimersByTime(1);
    expect(mockInstance.sendCalled).toBe(true);
    expect(mockInstance.sentBody).toBe('payload=test');

    // Simulate completion and verify observation correlation
    mockInstance.simulateResponse(200, '{"ok":true}');

    const obsMsg = postedMessages.find(
      (m) => m.type === 'REQUEST_OBSERVATION' && (m.payload as { transport?: string })?.transport === 'xhr'
    );
    expect(obsMsg).toBeDefined();
    const obsPayload = obsMsg?.payload as Record<string, unknown>;
    expect(obsPayload).toMatchObject({
      transport: 'xhr',
      outcome: 'success',
      method: 'POST',
      url: 'https://example.com/api/save',
      status: 200,
      injectionId: 'inj-latency-42',
    });
  });

  it('2. fetch_failure "transport_error": fires app-facing error path with status 0, readyState 4 without super.send', () => {
    const params: FetchFailureChaosParams = {
      kind: 'fetch_failure',
      mode: 'transport_error',
      injectionId: 'inj-fail-transport-1',
      runId: 'run-fail-1',
    };
    activateChaos(params);

    const xhr = new window.XMLHttpRequest();
    xhr.open('GET', 'https://example.com/api/items');

    let appErrorFired = false;
    let appStatusAtError = -1;
    let appReadyStateAtError = -1;

    xhr.addEventListener('error', () => {
      appErrorFired = true;
      appStatusAtError = xhr.status;
      appReadyStateAtError = xhr.readyState;
    });

    xhr.send();

    const mockInstance = xhr as unknown as MockOriginalXMLHttpRequest;
    // super.send should NOT be called
    expect(mockInstance.sendCalled).toBe(false);

    // Error event is dispatched asynchronously via setTimeout(0)
    expect(appErrorFired).toBe(false);
    vi.advanceTimersByTime(0);

    expect(appErrorFired).toBe(true);
    expect(appStatusAtError).toBe(0);
    expect(appReadyStateAtError).toBe(4);
    expect(xhr.status).toBe(0);
    expect(xhr.readyState).toBe(4);

    // Verify HAVOC emitted a transport_failure observation with the injectionId
    const obsMsg = postedMessages.find(
      (m) => m.type === 'REQUEST_OBSERVATION' && (m.payload as { transport?: string })?.transport === 'xhr'
    );
    expect(obsMsg).toBeDefined();
    const obsPayload = obsMsg?.payload as Record<string, unknown>;
    expect(obsPayload).toMatchObject({
      transport: 'xhr',
      outcome: 'transport_failure',
      method: 'GET',
      url: 'https://example.com/api/items',
      status: 0,
      injectionId: 'inj-fail-transport-1',
    });
  });

  it('3. fetch_failure "synthetic_timeout": sets xhr.timeout to config.timeoutMs before send', () => {
    const params: FetchFailureChaosParams = {
      kind: 'fetch_failure',
      mode: 'synthetic_timeout',
      timeoutMs: 3500,
      injectionId: 'inj-timeout-88',
      runId: 'run-to-1',
    };
    activateChaos(params);

    const xhr = new window.XMLHttpRequest();
    xhr.open('GET', 'https://example.com/api/slow');
    xhr.send();

    const mockInstance = xhr as unknown as MockOriginalXMLHttpRequest;
    expect(mockInstance.sendCalled).toBe(true);
    expect(xhr.timeout).toBe(3500);

    // Simulate timeout event
    mockInstance.simulateTimeout();

    const obsMsg = postedMessages.find(
      (m) => m.type === 'REQUEST_OBSERVATION' && (m.payload as { transport?: string })?.transport === 'xhr'
    );
    expect(obsMsg).toBeDefined();
    const obsPayload = obsMsg?.payload as Record<string, unknown>;
    expect(obsPayload).toMatchObject({
      transport: 'xhr',
      outcome: 'timeout',
      method: 'GET',
      url: 'https://example.com/api/slow',
      status: 0,
      injectionId: 'inj-timeout-88',
    });
  });

  it('4. fetch_failure "synthetic_http_error": achieves full response interception with syntheticStatus and readyState 4', () => {
    /**
     * Fidelity Note:
     * Full parity with fetch synthetic_http_error is achieved by intercepting send() without
     * sending a real request, defining instance properties (status, statusText, readyState, response, responseText)
     * via Object.defineProperty, and asynchronously dispatching readystatechange, load, and loadend.
     * The application's load/readystatechange handlers receive the exact configured synthetic status code (e.g. 503),
     * and HAVOC's observation logger records an http_failure correlated with the active injectionId.
     */
    const params: FetchFailureChaosParams = {
      kind: 'fetch_failure',
      mode: 'synthetic_http_error',
      syntheticStatus: 503,
      injectionId: 'inj-synthetic-503',
      runId: 'run-http-1',
    };
    activateChaos(params);

    const xhr = new window.XMLHttpRequest();
    xhr.open('POST', 'https://example.com/api/checkout');

    let appLoadFired = false;
    let appStatusAtLoad = -1;
    let appStatusTextAtLoad = '';
    let appReadyStateAtLoad = -1;

    xhr.addEventListener('load', () => {
      appLoadFired = true;
      appStatusAtLoad = xhr.status;
      appStatusTextAtLoad = xhr.statusText;
      appReadyStateAtLoad = xhr.readyState;
    });

    xhr.send('{"cartId":"c-123"}');

    const mockInstance = xhr as unknown as MockOriginalXMLHttpRequest;
    // Real send is suppressed so no unintended backend mutations occur
    expect(mockInstance.sendCalled).toBe(false);

    // Dispatched asynchronously
    expect(appLoadFired).toBe(false);
    vi.advanceTimersByTime(0);

    expect(appLoadFired).toBe(true);
    expect(appStatusAtLoad).toBe(503);
    expect(appStatusTextAtLoad).toBe('HAVOC synthetic 503');
    expect(appReadyStateAtLoad).toBe(4);
    expect(xhr.status).toBe(503);
    expect(xhr.readyState).toBe(4);

    // Verify HAVOC emitted an http_failure observation with status 503 and injectionId
    const obsMsg = postedMessages.find(
      (m) => m.type === 'REQUEST_OBSERVATION' && (m.payload as { transport?: string })?.transport === 'xhr'
    );
    expect(obsMsg).toBeDefined();
    const obsPayload = obsMsg?.payload as Record<string, unknown>;
    expect(obsPayload).toMatchObject({
      transport: 'xhr',
      outcome: 'http_failure',
      method: 'POST',
      url: 'https://example.com/api/checkout',
      status: 503,
      injectionId: 'inj-synthetic-503',
    });
  });

  it('5. Inactive chaos (_chaosConfig is null): XHR behaves completely unchanged from stock XMLHttpRequest', () => {
    const xhr = new window.XMLHttpRequest();
    xhr.open('GET', 'https://example.com/api/stock');
    xhr.send('unmodified');

    const mockInstance = xhr as unknown as MockOriginalXMLHttpRequest;
    // super.send should be called immediately and synchronously
    expect(mockInstance.sendCalled).toBe(true);
    expect(mockInstance.sentBody).toBe('unmodified');

    // Simulate standard successful response
    mockInstance.simulateResponse(200, '{"data":1}');

    const obsMsg = postedMessages.find(
      (m) => m.type === 'REQUEST_OBSERVATION' && (m.payload as { transport?: string })?.transport === 'xhr'
    );
    expect(obsMsg).toBeDefined();
    const obsPayload = obsMsg?.payload as Record<string, unknown>;
    expect(obsPayload).toMatchObject({
      transport: 'xhr',
      outcome: 'success',
      method: 'GET',
      url: 'https://example.com/api/stock',
      status: 200,
    });
    // No injectionId attached when chaos is inactive
    expect(obsPayload?.injectionId).toBeUndefined();
  });
});
