import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  runtimeErrorObserverExecutor,
  runtimeErrorToEvent,
} from '../runtime-error-observer';
import { createRuntimeErrorObservationMessage } from '../../../messaging/messages';
import type { Target } from '../../../domain/target';
import type { PassiveCheckDefinition } from '../../../domain/passive-check';
import type { RuntimeErrorPayload } from '../../../messaging/messages';

describe('Runtime Error Observer Executor', () => {
  const target: Target = {
    tabId: 42,
    origin: 'https://example.com',
    url: 'https://example.com/app',
    frameId: 0,
  };

  const definition: PassiveCheckDefinition = {
    id: 'check-runtime-errors',
    kind: 'runtime_errors',
    name: 'Runtime Error Detection',
    description: 'Capture uncaught exceptions and unhandled promise rejections',
    params: { observeMs: 1000 },
  };

  let messageListenerCallback:
    | ((
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (res?: unknown) => void
      ) => boolean | undefined)
    | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();

    messageListenerCallback = null;

    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: vi.fn((cb) => {
            messageListenerCallback = cb;
          }),
          removeListener: vi.fn((_cb) => {
            messageListenerCallback = null;
          }),
        },
      },
      tabs: {
        sendMessage: vi.fn().mockResolvedValue({}),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('converts RuntimeErrorPayload to HavocEvent correctly', () => {
    const payload: RuntimeErrorPayload = {
      observationId: 'obs-err-1',
      kind: 'uncaught_exception',
      message: 'Uncaught TypeError: Cannot read property of undefined',
      filename: 'https://example.com/app.js',
      lineno: 42,
      colno: 10,
      timestamp: 123456789,
      runId: null,
    };

    const event = runtimeErrorToEvent(payload, 'run-test-1', 1);

    expect(event.type).toBe('UNCAUGHT_EXCEPTION');
    expect(event.runId).toBe('run-test-1');
    expect(event.sequence).toBe(1);
    expect(event.source).toBe('page');
    expect(event.correlationId).toBe('obs-err-1');
    expect(event.metadata?.message).toBe(payload.message);
    expect(event.metadata?.filename).toBe(payload.filename);
    expect(event.metadata?.lineno).toBe(42);
    expect(event.metadata?.colno).toBe(10);
  });

  it('enables capture, collects 3 runtime errors from target tab, and disables capture in order', async () => {
    let sequenceCounter = 0;
    const nextSequence = () => ++sequenceCounter;

    const promise = runtimeErrorObserverExecutor(
      target,
      definition,
      'run-err-xyz',
      nextSequence
    );

    // Yield to microtask queue so addListener runs
    await Promise.resolve();
    await Promise.resolve();

    // Verify ENABLE message was sent immediately
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      target.tabId,
      expect.objectContaining({ type: 'ENABLE_RUNTIME_ERROR_CAPTURE' })
    );

    // Simulate 3 error messages arriving while the observer is active
    expect(messageListenerCallback).toBeDefined();

    const sender: chrome.runtime.MessageSender = {
      tab: {
        id: target.tabId,
        index: 0,
        pinned: false,
        highlighted: false,
        windowId: 1,
        active: true,
        incognito: false,
        selected: true,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      },
    };

    const payload1: RuntimeErrorPayload = {
      observationId: 'obs-1',
      kind: 'uncaught_exception',
      message: 'Error 1',
      filename: 'https://example.com/main.js',
      lineno: 10,
      colno: 5,
      timestamp: Date.now(),
      runId: null,
    };

    const payload2: RuntimeErrorPayload = {
      observationId: 'obs-2',
      kind: 'unhandled_rejection',
      message: 'Unhandled Promise Rejection: Network failed',
      filename: '',
      lineno: 0,
      colno: 0,
      timestamp: Date.now(),
      runId: null,
    };

    const payload3: RuntimeErrorPayload = {
      observationId: 'obs-3',
      kind: 'uncaught_exception',
      message: 'Error 3',
      filename: 'https://example.com/vendor.js',
      lineno: 99,
      colno: 1,
      timestamp: Date.now(),
      runId: null,
    };

    messageListenerCallback!(
      createRuntimeErrorObservationMessage(payload1),
      sender,
      vi.fn()
    );
    messageListenerCallback!(
      createRuntimeErrorObservationMessage(payload2),
      sender,
      vi.fn()
    );
    messageListenerCallback!(
      createRuntimeErrorObservationMessage(payload3),
      sender,
      vi.fn()
    );

    // Also simulate a message from a different tab — should be ignored
    const otherSender: chrome.runtime.MessageSender = {
      tab: {
        id: 999,
        index: 1,
        pinned: false,
        highlighted: false,
        windowId: 1,
        active: false,
        incognito: false,
        selected: false,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      },
    };
    messageListenerCallback!(
      createRuntimeErrorObservationMessage({
        ...payload1,
        observationId: 'obs-other-tab',
      }),
      otherSender,
      vi.fn()
    );

    // Fast-forward past observeMs (1000ms)
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;

    expect(result.events).toHaveLength(3);
    expect(result.events[0]?.type).toBe('UNCAUGHT_EXCEPTION');
    expect(result.events[0]?.metadata?.message).toBe('Error 1');
    expect(result.events[1]?.type).toBe('UNHANDLED_REJECTION');
    expect(result.events[1]?.metadata?.message).toBe('Unhandled Promise Rejection: Network failed');
    expect(result.events[2]?.type).toBe('UNCAUGHT_EXCEPTION');
    expect(result.events[2]?.metadata?.message).toBe('Error 3');

    // Verify DISABLE message was sent in finally
    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(
      target.tabId,
      expect.objectContaining({ type: 'DISABLE_RUNTIME_ERROR_CAPTURE' })
    );

    // Verify listener was removed
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
  });

  it('sends DISABLE message even if an unexpected error occurs during execution', async () => {
    vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementationOnce(() => {
      throw new Error('Listener registration failure');
    });

    await expect(
      runtimeErrorObserverExecutor(target, definition, 'run-err-fail', () => 1)
    ).rejects.toThrow('Listener registration failure');

    // Verify DISABLE was still called in finally block
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      target.tabId,
      expect.objectContaining({ type: 'DISABLE_RUNTIME_ERROR_CAPTURE' })
    );
  });
});
