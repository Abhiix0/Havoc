import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as safetyController from '../safety-controller';
import * as signalEngine from '../signal-engine';
import * as repository from '../../../storage/repository';
import {
  registerPassiveCheckExecutor,
  getPassiveCheckExecutor,
  startPassiveCheck,
  type PassiveCheckExecutor,
} from '../passive-check-runner';
import type { Target } from '../../../domain/target';
import type {
  PassiveCheckDefinition,
  PassiveCheckKind,
} from '../../../domain/passive-check';
import type { HavocEvent } from '../../../domain/event';

// Stub chrome APIs for testing
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
  },
  storage: {
    session: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
  tabs: {
    get: vi.fn(),
  },
});

describe('Passive Check Runner', () => {
  const target: Target = {
    tabId: 101,
    origin: 'https://example.com',
    url: 'https://example.com/app',
    frameId: 0,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({}),
      },
      storage: {
        session: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
        },
      },
      tabs: {
        get: vi.fn(),
      },
    });
    vi.spyOn(safetyController, 'verifyTarget').mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. registerPassiveCheckExecutor + getPassiveCheckExecutor round-trip', () => {
    const dummyExecutor: PassiveCheckExecutor = async () => ({ events: [] });
    registerPassiveCheckExecutor('runtime_errors', dummyExecutor);

    const retrieved = getPassiveCheckExecutor('runtime_errors');
    expect(retrieved).toBe(dummyExecutor);
  });

  it('2. startPassiveCheck with an unregistered kind -> run ends in FAILED with clear error message', async () => {
    const unregisteredDef: PassiveCheckDefinition = {
      id: 'check-secret-scan',
      kind: 'secret_scan' as PassiveCheckKind,
      name: 'Secret Scanner',
      description: 'Scan page for exposed keys',
      params: {},
    };

    // Ensure secret_scan has no executor registered
    // (or register undefined)
    const run = await startPassiveCheck(unregisteredDef, target);

    expect(run.state).toBe('FAILED');
    expect(run.runId).toBeDefined();
    expect(run.definition.kind).toBe('secret_scan');
  });

  it('3. startPassiveCheck when verifyTarget returns {ok:false} -> ends in TARGET_LOST, executor never invoked', async () => {
    vi.spyOn(safetyController, 'verifyTarget').mockResolvedValue({
      ok: false,
      reason: 'TAB_NOT_FOUND',
      detail: 'Tab 101 no longer exists',
    });

    const executorMock = vi.fn().mockResolvedValue({ events: [] });
    registerPassiveCheckExecutor('runtime_errors', executorMock);

    const def: PassiveCheckDefinition = {
      id: 'check-runtime',
      kind: 'runtime_errors',
      name: 'Runtime Error Detector',
      description: 'Inspect console and unhandled errors',
      params: {},
    };

    const run = await startPassiveCheck(def, target);

    expect(run.state).toBe('TARGET_LOST');
    expect(executorMock).not.toHaveBeenCalled();
  });

  it('4. startPassiveCheck with a stub executor returning 2 HavocEvents -> saveEvent called twice, processEvent called twice, run ends COMPLETED', async () => {
    const event1: HavocEvent = {
      id: 'evt-passive-1',
      runId: 'pending-run-id',
      timestamp: Date.now(),
      sequence: 1,
      type: 'REQUEST_HTTP_FAILURE',
      source: 'page',
      resource: 'https://example.com/api/test',
      metadata: { status: 500, method: 'GET', duration: 10, transport: 'fetch' },
    };

    const event2: HavocEvent = {
      id: 'evt-passive-2',
      runId: 'pending-run-id',
      timestamp: Date.now(),
      sequence: 2,
      type: 'DOM_OBSERVATION',
      source: 'content',
      metadata: { kind: 'error_text_appeared', selector: '.error-banner' },
    };

    const stubExecutor: PassiveCheckExecutor = async (_target, _def, runId) => {
      event1.runId = runId;
      event2.runId = runId;
      return { events: [event1, event2] };
    };

    registerPassiveCheckExecutor('runtime_errors', stubExecutor);

    const saveEventSpy = vi.spyOn(repository, 'saveEvent').mockResolvedValue(undefined);
    vi.spyOn(repository, 'saveSignals').mockResolvedValue(undefined);
    const processEventSpy = vi.spyOn(signalEngine, 'processEvent');

    const def: PassiveCheckDefinition = {
      id: 'check-runtime-success',
      kind: 'runtime_errors',
      name: 'Runtime Error Detector',
      description: 'Observe errors',
      params: {},
    };

    const run = await startPassiveCheck(def, target);

    expect(run.state).toBe('COMPLETED');
    expect(saveEventSpy).toHaveBeenCalledTimes(2);
    expect(saveEventSpy).toHaveBeenNthCalledWith(1, event1);
    expect(saveEventSpy).toHaveBeenNthCalledWith(2, event2);
    expect(processEventSpy).toHaveBeenCalledTimes(2);
    expect(processEventSpy).toHaveBeenNthCalledWith(1, event1);
    expect(processEventSpy).toHaveBeenNthCalledWith(2, event2);
  });

  it('5. startPassiveCheck with an executor that never resolves -> ends in FAILED within ~10s', async () => {
    vi.useFakeTimers();

    // Hanging executor that never resolves
    const hangingExecutor: PassiveCheckExecutor = () => new Promise(() => {});
    registerPassiveCheckExecutor('runtime_errors', hangingExecutor);

    const def: PassiveCheckDefinition = {
      id: 'check-hanging',
      kind: 'runtime_errors',
      name: 'Hanging Check',
      description: 'Hangs forever',
      params: {},
    };

    const promise = startPassiveCheck(def, target);

    // Fast-forward 10s
    await vi.advanceTimersByTimeAsync(10_000);

    const run = await promise;
    expect(run.state).toBe('FAILED');
  });
});
