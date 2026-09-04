import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Target } from '../../../domain/target';
import type { ExperimentDefinition } from '../../../domain/experiment';
import { ResourceRegistry } from '../resource-registry';
import {
  buildChaosParams,
  injectChaos,
  ContentScriptUnavailableError,
} from '../chaos-injector';

describe('Chaos Injector', () => {
  const target: Target = {
    tabId: 42,
    origin: 'https://example.com',
    url: 'https://example.com/checkout',
    frameId: 0,
  };

  beforeEach(() => {
    vi.stubGlobal('chrome', {
      tabs: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  describe('buildChaosParams', () => {
    it('builds fetch_latency params with provided delayMs or 500ms default', () => {
      const defProvided: ExperimentDefinition = {
        id: 'd-1',
        name: 'Latency',
        kind: 'fetch_latency',
        description: 'Test',
        params: { delayMs: 1200 },
      };
      const params1 = buildChaosParams(defProvided, 'run-1');
      expect(params1).toEqual({
        kind: 'fetch_latency',
        delayMs: 1200,
        injectionId: expect.any(String),
        runId: 'run-1',
      });

      const defDefault: ExperimentDefinition = {
        id: 'd-2',
        name: 'Latency',
        kind: 'fetch_latency',
        description: 'Test',
        params: {},
      };
      const params2 = buildChaosParams(defDefault, 'run-2');
      expect(params2).toEqual({
        kind: 'fetch_latency',
        delayMs: 500,
        injectionId: expect.any(String),
        runId: 'run-2',
      });
    });

    it('builds fetch_failure params with mode, syntheticStatus, timeoutMs or defaults', () => {
      const defFull: ExperimentDefinition = {
        id: 'd-3',
        name: 'Failure',
        kind: 'fetch_failure',
        description: 'Test',
        params: {
          mode: 'synthetic_http_error',
          syntheticStatus: 503,
          timeoutMs: 8000,
        },
      };
      const params1 = buildChaosParams(defFull, 'run-3');
      expect(params1).toEqual({
        kind: 'fetch_failure',
        mode: 'synthetic_http_error',
        syntheticStatus: 503,
        timeoutMs: 8000,
        injectionId: expect.any(String),
        runId: 'run-3',
      });

      const defDefault: ExperimentDefinition = {
        id: 'd-4',
        name: 'Failure',
        kind: 'fetch_failure',
        description: 'Test',
        params: {},
      };
      const params2 = buildChaosParams(defDefault, 'run-4');
      expect(params2).toEqual({
        kind: 'fetch_failure',
        mode: 'transport_error',
        injectionId: expect.any(String),
        runId: 'run-4',
      });
    });

    it('builds input_stress params with mode or defaults to "all"', () => {
      const def: ExperimentDefinition = {
        id: 'd-5',
        name: 'Input Stress',
        kind: 'input_stress',
        description: 'Test',
        params: { mode: 'xss' },
      };
      const params = buildChaosParams(def, 'run-5');
      expect(params).toEqual({
        kind: 'input_stress',
        mode: 'xss',
        injectionId: expect.any(String),
        runId: 'run-5',
      });

      const defDefault: ExperimentDefinition = {
        id: 'd-5-def',
        name: 'Input Stress',
        kind: 'input_stress',
        description: 'Test',
        params: {},
      };
      const paramsDefault = buildChaosParams(defDefault, 'run-5-def');
      expect(paramsDefault).toEqual({
        kind: 'input_stress',
        mode: 'all',
        injectionId: expect.any(String),
        runId: 'run-5-def',
      });
    });

    it('builds viewport_stress params with mode or defaults to "mobile_narrow"', () => {
      const def: ExperimentDefinition = {
        id: 'd-6',
        name: 'Viewport',
        kind: 'viewport_stress',
        description: 'Test',
        params: { mode: 'tablet' },
      };
      const params = buildChaosParams(def, 'run-6');
      expect(params).toEqual({
        kind: 'viewport_stress',
        mode: 'tablet',
        injectionId: expect.any(String),
        runId: 'run-6',
      });

      const defDefault: ExperimentDefinition = {
        id: 'd-6-def',
        name: 'Viewport',
        kind: 'viewport_stress',
        description: 'Test',
        params: {},
      };
      const paramsDefault = buildChaosParams(defDefault, 'run-6-def');
      expect(paramsDefault).toEqual({
        kind: 'viewport_stress',
        mode: 'mobile_narrow',
        injectionId: expect.any(String),
        runId: 'run-6-def',
      });
    });
  });

  describe('injectChaos', () => {
    it('throws ContentScriptUnavailableError when receiving end does not exist', async () => {
      vi.mocked(chrome.tabs.sendMessage).mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.')
      );

      const registry = new ResourceRegistry();
      const params = {
        kind: 'fetch_latency' as const,
        delayMs: 800,
        injectionId: 'inj-1',
        runId: 'run-1',
      };

      await expect(
        injectChaos(target, params, registry, () => 1)
      ).rejects.toThrow(ContentScriptUnavailableError);
    });

    it('throws a regular Error on other message failures', async () => {
      vi.mocked(chrome.tabs.sendMessage).mockRejectedValueOnce(
        new Error('Frame was detached')
      );

      const registry = new ResourceRegistry();
      const params = {
        kind: 'fetch_latency' as const,
        delayMs: 800,
        injectionId: 'inj-1',
        runId: 'run-1',
      };

      const promise = injectChaos(target, params, registry, () => 1);
      await expect(promise).rejects.toThrow(
        'Failed to send INJECT_CHAOS to tab 42: Frame was detached'
      );
      await expect(promise).rejects.not.toBeInstanceOf(ContentScriptUnavailableError);
    });

    it('success path: sends INJECT_CHAOS, emits CHAOS_INJECTED event with nextSequence, and registers cleanup', async () => {
      const registry = new ResourceRegistry();
      const params = {
        kind: 'fetch_latency' as const,
        delayMs: 800,
        injectionId: 'inj-1',
        runId: 'run-1',
      };

      const handle = await injectChaos(target, params, registry, (rId) => {
        expect(rId).toBe('run-1');
        return 7;
      });

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          type: 'INJECT_CHAOS',
          payload: params,
        })
      );

      expect(handle.injectionId).toBe('inj-1');
      expect(handle.chaosEvent.type).toBe('CHAOS_INJECTED');
      expect(handle.chaosEvent.sequence).toBe(7);
      expect(handle.chaosEvent.metadata?.kind).toBe('fetch_latency');
      expect(handle.chaosEvent.metadata?.delayMs).toBe(800);

      // Verify cleanup resource was registered
      expect(registry.size).toBe(1);

      await registry.cleanupAll();

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          type: 'REMOVE_CHAOS',
          payload: { injectionId: 'inj-1' },
        })
      );
    });
  });
});
