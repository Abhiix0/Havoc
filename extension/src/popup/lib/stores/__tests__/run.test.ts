import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  currentRun,
  activeTab,
  loading,
  error,
  starting,
  aborting,
  events,
  signals,
  recovery,
  findings,
  activeTabNav,
  isRunActive,
  canStart,
  getStepIndex,
  formatRelativeTime,
  formatConfidence,
  resolveActiveTab,
  syncState,
  loadRunDetails,
  handleRuntimeMessage,
  handleStartRun,
  handleAbortRun,
  setupRunStore,
} from '../run';
import {
  saveRun,
  saveEvent,
  saveSignal,
  saveRecovery,
  saveFinding,
} from '../../../../storage/repository';
import {
  createRunStateUpdateMessage,
  createCreateRunResponseMessage,
} from '../../../../messaging/messages';
import type { ExperimentRun } from '../../../../domain/run';
import type { ExperimentDefinition } from '../../../../domain/experiment';
import type { Target } from '../../../../domain/target';

const mockTarget: Target = {
  tabId: 42,
  origin: 'https://example.com',
  url: 'https://example.com/checkout',
  frameId: 0,
};

describe('HAVOC Run Store (Phase 0 Refactor)', () => {
  beforeEach(() => {
    currentRun.set(null);
    activeTab.set(null);
    loading.set(true);
    error.set(null);
    starting.set(false);
    aborting.set(false);
    events.set([]);
    signals.set([]);
    recovery.set(undefined);
    findings.set([]);
    activeTabNav.set('timeline');

    // Global chrome mock
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42, url: 'https://example.com/checkout' }]),
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ type: 'CURRENT_RUN_RESPONSE', run: null }),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    });
  });

  describe('Derived State & Formatting Helpers', () => {
    it('accurately computes isRunActive and canStart across lifecycle states', () => {
      expect(get(isRunActive)).toBe(false);
      expect(get(canStart)).toBe(false); // loading is true

      loading.set(false);
      expect(get(canStart)).toBe(true);

      currentRun.set({
        runId: 'run-1',
        target: mockTarget,
        state: 'ACTIVE',
        definition: { id: 'd1', name: 'Test', kind: 'fetch_latency', description: 'Test exp', params: { delayMs: 800, durationMs: 5000, recoveryWindowMs: 8000 } },
        createdAt: 1000,
        updatedAt: 1000,
      });

      expect(get(isRunActive)).toBe(true);
      expect(get(canStart)).toBe(false);

      currentRun.set({
        runId: 'run-1',
        target: mockTarget,
        state: 'COMPLETED',
        definition: { id: 'd1', name: 'Test', kind: 'fetch_latency', description: 'Test exp', params: { delayMs: 800, durationMs: 5000, recoveryWindowMs: 8000 } },
        createdAt: 1000,
        updatedAt: 6000,
      });

      expect(get(isRunActive)).toBe(false);
      expect(get(canStart)).toBe(true);
    });

    it('calculates step indices and formats confidence and relative timestamps', () => {
      expect(getStepIndex('CREATED')).toBe(0);
      expect(getStepIndex('ACTIVE')).toBe(2);
      expect(getStepIndex('COMPLETED')).toBe(6);

      expect(formatRelativeTime(1500, 1000)).toBe('+0.50s');
      expect(formatRelativeTime(800, 1000)).toBe('-0.20s');

      expect(formatConfidence(0.954)).toBe('95%');
      expect(formatConfidence(1.0)).toBe('100%');
    });
  });

  describe('Tab Resolution & State Synchronization', () => {
    it('resolves active tab origin and tabId', async () => {
      await resolveActiveTab();
      const tab = get(activeTab);
      expect(tab).not.toBeNull();
      expect(tab?.tabId).toBe(42);
      expect(tab?.origin).toBe('https://example.com');
    });

    it('syncs state from background worker or falls back to IndexedDB', async () => {
      const mockRun: ExperimentRun = {
        runId: 'idb-run-99',
        target: mockTarget,
        state: 'COMPLETED',
        definition: { id: 'd1', name: 'Test', kind: 'fetch_latency', description: 'Test exp', params: { delayMs: 800, durationMs: 5000, recoveryWindowMs: 8000 } },
        createdAt: 2000,
        updatedAt: 7000,
      };

      await saveRun(mockRun);
      await syncState();

      expect(get(currentRun)?.runId).toBe('idb-run-99');
      expect(get(loading)).toBe(false);
    });

    it('loads associated telemetry records for a run', async () => {
      const runId = 'rec-test-1';
      await saveEvent({
        id: 'evt-1',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'CHAOS_INJECTED',
        source: 'content',
      });

      await saveSignal({
        id: 'sig-1',
        runId,
        timestamp: 1200,
        type: 'RequestFailureObserved',
        confidence: 0.9,
        derivedFrom: ['evt-1'],
      });

      await saveRecovery({
        id: 'rec-1',
        runId,
        outcome: 'RECOVERED',
        windowStart: 1000,
        windowEnd: 5000,
        evaluatedAt: 5500,
      });

      await saveFinding({
        id: 'fnd-1',
        runId,
        recoveryId: 'rec-1',
        severity: 'HIGH',
        confidence: 0.95,
        description: 'Test finding',
        evidenceIds: ['evt-1'],
      });

      await loadRunDetails(runId);

      expect(get(events).length).toBe(1);
      expect(get(signals).length).toBe(1);
      expect(get(recovery)?.outcome).toBe('RECOVERED');
      expect(get(findings).length).toBe(1);
    });
  });

  describe('Runtime Messages and Run Lifecycle', () => {
    it('updates run state and triggers details load on RUN_STATE_UPDATE message', () => {
      const updatedRun: ExperimentRun = {
        runId: 'update-run-1',
        target: mockTarget,
        state: 'ACTIVE',
        definition: { id: 'd1', name: 'Latency', kind: 'fetch_latency', description: 'Latency exp', params: { delayMs: 800, durationMs: 5000, recoveryWindowMs: 8000 } },
        createdAt: 1000,
        updatedAt: 1500,
      };

      handleRuntimeMessage(createRunStateUpdateMessage(updatedRun, 'PREPARING'));

      expect(get(currentRun)?.state).toBe('ACTIVE');
    });

    it('launches experiment via handleStartRun and returns true on success', async () => {
      const newRun: ExperimentRun = {
        runId: 'new-run-77',
        target: mockTarget,
        state: 'CREATED',
        definition: { id: 'd1', name: 'Latency', kind: 'fetch_latency', description: 'Latency exp', params: { delayMs: 800, durationMs: 5000, recoveryWindowMs: 8000 } },
        createdAt: 3000,
        updatedAt: 3000,
      };

      vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(
        createCreateRunResponseMessage(newRun)
      );

      const def: ExperimentDefinition = {
        id: 'd1',
        name: 'Latency',
        kind: 'fetch_latency',
        description: 'Latency exp',
        params: { delayMs: 800, durationMs: 5000, recoveryWindowMs: 8000 },
      };

      const result = await handleStartRun(def);

      expect(result).toBe(true);
      expect(get(currentRun)?.runId).toBe('new-run-77');
      expect(get(activeTabNav)).toBe('timeline');
      expect(get(starting)).toBe(false);
      expect(get(error)).toBeNull();
    });

    it('returns false and sets error when chrome.runtime.sendMessage response contains an error', async () => {
      vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(
        createCreateRunResponseMessage(undefined, 'Target tab not found or closed')
      );

      const def: ExperimentDefinition = {
        id: 'd1',
        name: 'Latency',
        kind: 'fetch_latency',
        description: 'Latency exp',
        params: { delayMs: 800, durationMs: 5000, recoveryWindowMs: 8000 },
      };

      const result = await handleStartRun(def);

      expect(result).toBe(false);
      expect(get(currentRun)).toBeNull();
      expect(get(error)).toBe('Target tab not found or closed');
      expect(get(starting)).toBe(false);
    });

    it('returns false and sets error when chrome.runtime.sendMessage rejects', async () => {
      vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(
        new Error('Extension context invalidated')
      );

      const def: ExperimentDefinition = {
        id: 'd1',
        name: 'Latency',
        kind: 'fetch_latency',
        description: 'Latency exp',
        params: { delayMs: 800, durationMs: 5000, recoveryWindowMs: 8000 },
      };

      const result = await handleStartRun(def);

      expect(result).toBe(false);
      expect(get(currentRun)).toBeNull();
      expect(get(error)).toBe('Extension context invalidated');
      expect(get(starting)).toBe(false);
    });

    it('aborts active experiment via handleAbortRun', async () => {
      currentRun.set({
        runId: 'abort-run-88',
        target: mockTarget,
        state: 'ACTIVE',
        definition: { id: 'd1', name: 'Latency', kind: 'fetch_latency', description: 'Latency exp', params: { delayMs: 800, durationMs: 5000, recoveryWindowMs: 8000 } },
        createdAt: 1000,
        updatedAt: 1500,
      });

      vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({
        type: 'ABORT_RUN_RESPONSE',
        success: true,
      });

      await handleAbortRun();
      expect(get(aborting)).toBe(true);
    });

    it('setupRunStore initializes listeners and polling interval with cleanup', () => {
      const cleanup = setupRunStore();
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
      cleanup();
      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
    });
  });
});
