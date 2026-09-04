import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createBridgeMessage,
  createObservationMessage,
  createRuntimeErrorObservationMessage,
  type BridgeMessage,
} from '../../messaging/messages';

describe('Content Script Session Nonce Verification', () => {
  let messageListeners: Array<(event: MessageEvent) => void> = [];
  let postedMessages: Array<BridgeMessage> = [];
  let chromeSendMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    messageListeners = [];
    postedMessages = [];

    // Mock chrome API
    chromeSendMessageMock = vi.fn((message, callback) => {
      if (message.type === 'BRIDGE_HELLO') {
        callback?.(createBridgeMessage('BRIDGE_READY'));
      } else {
        callback?.({ ok: true });
      }
    });

    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: chromeSendMessageMock,
        onMessage: { addListener: vi.fn() },
        getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
      },
    });

    // Mock window and document
    const mockWindow = {
      addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') {
          messageListeners.push(listener);
        }
      }),
      removeEventListener: vi.fn(),
      postMessage: vi.fn((message: BridgeMessage) => {
        postedMessages.push(message);
      }),
    };

    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('location', { href: 'https://example.com/test' });

    // Mock document
    const mockElement = {
      appendChild: vi.fn(),
      addEventListener: vi.fn(),
      remove: vi.fn(),
      setAttribute: vi.fn(),
      getAttribute: vi.fn(),
      classList: { slice: vi.fn() },
    };

    vi.stubGlobal('document', {
      createElement: vi.fn(() => mockElement),
      head: mockElement,
      documentElement: mockElement,
      readyState: 'complete',
      addEventListener: vi.fn(),
    });

    // Mock MutationObserver
    vi.stubGlobal('MutationObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
    });

    // Import content-script (or re-execute)
    // To ensure fresh module state, dynamically import
    vi.resetModules();
    await import('../content-script');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function simulatePageMessage(data: unknown): void {
    const event = {
      source: window,
      data,
    } as unknown as MessageEvent;

    for (const listener of messageListeners) {
      listener(event);
    }
  }

  it('1. drops REQUEST_OBSERVATION and RUNTIME_ERROR_OBSERVATION messages with missing or mismatched nonce', () => {
    // 1. Handshake via BRIDGE_HELLO
    simulatePageMessage(createBridgeMessage('BRIDGE_HELLO'));

    expect(chromeSendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BRIDGE_HELLO' }),
      expect.any(Function)
    );

    // BRIDGE_READY should be posted down to the page with a nonce
    const readyMsg = postedMessages.find((m) => m.type === 'BRIDGE_READY');
    expect(readyMsg).toBeDefined();
    const validNonce = (readyMsg?.payload as { nonce?: string })?.nonce;
    expect(typeof validNonce).toBe('string');
    expect(validNonce?.length).toBeGreaterThan(0);

    // Clear sendMessage spy calls
    chromeSendMessageMock.mockClear();

    // 2. Send forged observation without nonce
    const forgedObsNoNonce = createObservationMessage({
      observationId: 'obs-forged-1',
      transport: 'fetch',
      outcome: 'http_failure',
      url: 'https://example.com/api',
      method: 'GET',
      status: 500,
      startTime: 100,
      duration: 50,
    });
    simulatePageMessage(forgedObsNoNonce);
    expect(chromeSendMessageMock).not.toHaveBeenCalled();

    // 3. Send forged observation with wrong nonce
    const forgedObsWrongNonce = createObservationMessage({
      observationId: 'obs-forged-2',
      transport: 'fetch',
      outcome: 'http_failure',
      url: 'https://example.com/api',
      method: 'GET',
      status: 500,
      startTime: 100,
      duration: 50,
      nonce: 'invalid-attacker-nonce-1234',
    });
    simulatePageMessage(forgedObsWrongNonce);
    expect(chromeSendMessageMock).not.toHaveBeenCalled();

    // 4. Send forged runtime error without nonce
    const forgedErrNoNonce = createRuntimeErrorObservationMessage({
      observationId: 'err-forged-1',
      kind: 'uncaught_exception',
      message: 'Attacker injected error',
      filename: 'app.js',
      lineno: 1,
      colno: 1,
      timestamp: 1000,
      runId: null,
    });
    simulatePageMessage(forgedErrNoNonce);
    expect(chromeSendMessageMock).not.toHaveBeenCalled();

    // 5. Send forged runtime error with wrong nonce
    const forgedErrWrongNonce = createRuntimeErrorObservationMessage({
      observationId: 'err-forged-2',
      kind: 'uncaught_exception',
      message: 'Attacker injected error',
      filename: 'app.js',
      lineno: 1,
      colno: 1,
      timestamp: 1000,
      runId: null,
      nonce: 'fake-nonce-xyz',
    });
    simulatePageMessage(forgedErrWrongNonce);
    expect(chromeSendMessageMock).not.toHaveBeenCalled();
  });

  it('2. relays legitimate messages containing the correct current-session nonce', () => {
    // 1. Handshake via BRIDGE_HELLO
    simulatePageMessage(createBridgeMessage('BRIDGE_HELLO'));

    const readyMsg = postedMessages.find((m) => m.type === 'BRIDGE_READY');
    const sessionNonce = (readyMsg?.payload as { nonce?: string })?.nonce;
    expect(sessionNonce).toBeDefined();

    chromeSendMessageMock.mockClear();

    // 2. Legitimate observation with valid nonce
    const legitObs = createObservationMessage({
      observationId: 'obs-legit-1',
      transport: 'xhr',
      outcome: 'success',
      url: 'https://example.com/api/data',
      method: 'POST',
      status: 200,
      startTime: 200,
      duration: 30,
      nonce: sessionNonce,
    });
    simulatePageMessage(legitObs);

    expect(chromeSendMessageMock).toHaveBeenCalledWith(
      legitObs,
      expect.any(Function)
    );

    chromeSendMessageMock.mockClear();

    // 3. Legitimate runtime error with valid nonce
    const legitErr = createRuntimeErrorObservationMessage({
      observationId: 'err-legit-1',
      kind: 'unhandled_rejection',
      message: 'Real runtime promise rejection',
      filename: 'bundle.js',
      lineno: 42,
      colno: 10,
      timestamp: 2000,
      runId: null,
      nonce: sessionNonce,
    });
    simulatePageMessage(legitErr);

    expect(chromeSendMessageMock).toHaveBeenCalledWith(
      legitErr,
      expect.any(Function)
    );
  });

  it('3. a fresh BRIDGE_HELLO regenerates a new nonce and invalidates the previous nonce', () => {
    // 1. First handshake
    simulatePageMessage(createBridgeMessage('BRIDGE_HELLO'));

    const firstReadyMsg = postedMessages.find((m) => m.type === 'BRIDGE_READY');
    const firstNonce = (firstReadyMsg?.payload as { nonce?: string })?.nonce;
    expect(firstNonce).toBeDefined();

    // 2. Second (fresh) handshake
    postedMessages = [];
    simulatePageMessage(createBridgeMessage('BRIDGE_HELLO'));

    const secondReadyMsg = postedMessages.find((m) => m.type === 'BRIDGE_READY');
    const secondNonce = (secondReadyMsg?.payload as { nonce?: string })?.nonce;
    expect(secondNonce).toBeDefined();
    expect(secondNonce).not.toBe(firstNonce);

    chromeSendMessageMock.mockClear();

    // 3. Attempt to use stale firstNonce -> must be DROPPED
    const staleObs = createObservationMessage({
      observationId: 'obs-stale-1',
      transport: 'fetch',
      outcome: 'success',
      url: 'https://example.com/api',
      method: 'GET',
      status: 200,
      startTime: 300,
      duration: 10,
      nonce: firstNonce,
    });
    simulatePageMessage(staleObs);
    expect(chromeSendMessageMock).not.toHaveBeenCalled();

    // 4. Use active secondNonce -> must be RELAYED
    const currentObs = createObservationMessage({
      observationId: 'obs-current-1',
      transport: 'fetch',
      outcome: 'success',
      url: 'https://example.com/api',
      method: 'GET',
      status: 200,
      startTime: 350,
      duration: 15,
      nonce: secondNonce,
    });
    simulatePageMessage(currentObs);
    expect(chromeSendMessageMock).toHaveBeenCalledWith(
      currentObs,
      expect.any(Function)
    );
  });
});
