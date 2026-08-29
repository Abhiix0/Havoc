import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceRegistry } from '../resource-registry';
import {
  evaluateAdmission,
  shouldCoalesceDomEvent,
  clearBackpressureState,
} from '../backpressure';
import { processEvent, clearRunBuffer } from '../signal-engine';
import { evaluateRecovery } from '../recovery-window';
import { deriveFromRecoveryResult } from '../finding-engine';
import { buildChaosParams } from '../chaos-injector';
import type { HavocEvent } from '../../../domain/event';
import type { ExperimentDefinition } from '../../../domain/experiment';

describe('HAVOC Phase 9 — Hardening Golden Tests', () => {
  const runId = 'test-run-hardening';

  beforeEach(() => {
    clearRunBuffer(runId);
    clearBackpressureState(runId);
  });

  describe('Golden Test 1: Event Backpressure & Priority Drop Policy', () => {
    it('coalesces rapid duplicate DOM observations on the same selector', () => {
      const domEvent1: HavocEvent = {
        id: 'dom-1',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'DOM_OBSERVATION',
        source: 'content',
        metadata: {
          kind: 'loading_indicator_appeared',
          selector: '.spinner-loading',
        },
      };

      const domEvent2: HavocEvent = {
        id: 'dom-2',
        runId,
        timestamp: 1050, // 50ms later (< 250ms window)
        sequence: 2,
        type: 'DOM_OBSERVATION',
        source: 'content',
        metadata: {
          kind: 'loading_indicator_appeared',
          selector: '.spinner-loading',
        },
      };

      const coalesced1 = shouldCoalesceDomEvent(domEvent1);
      const coalesced2 = shouldCoalesceDomEvent(domEvent2);

      expect(coalesced1).toBe(false); // first one admitted
      expect(coalesced2).toBe(true);  // rapid duplicate coalesced
    });

    it('drops noisy DOM events when buffer reaches limit but preserves critical network events', () => {
      const buffer: HavocEvent[] = [];
      const MAX_LIMIT = 5;

      // Fill buffer with 5 DOM events
      for (let i = 1; i <= 5; i++) {
        buffer.push({
          id: `dom-${i}`,
          runId,
          timestamp: 1000 + i * 10,
          sequence: i,
          type: 'DOM_OBSERVATION',
          source: 'content',
          metadata: { kind: 'error_text_appeared', selector: `#err-${i}` },
        });
      }

      // Try adding another DOM event (P2)
      const noisyEvent: HavocEvent = {
        id: 'dom-overflow',
        runId,
        timestamp: 1100,
        sequence: 6,
        type: 'DOM_OBSERVATION',
        source: 'content',
        metadata: { kind: 'loading_indicator_appeared' },
      };

      const decision1 = evaluateAdmission(noisyEvent, buffer, MAX_LIMIT);
      expect(decision1.admit).toBe(false);
      expect(decision1.reason).toBe('BUFFER_FULL_P2_DROPPED');
      expect(buffer).toHaveLength(5); // buffer unchanged

      // Now add a critical network failure event (P1)
      const networkFailureEvent: HavocEvent = {
        id: 'net-crit-1',
        runId,
        timestamp: 1150,
        sequence: 7,
        type: 'REQUEST_TRANSPORT_FAILURE',
        source: 'page',
        resource: 'https://api.example.com/data',
      };

      const decision2 = evaluateAdmission(networkFailureEvent, buffer, MAX_LIMIT);
      expect(decision2.admit).toBe(true);
      expect(decision2.reason).toBe('P2_EVICTED_FOR_HIGH_PRIORITY');
      expect(decision2.droppedEventId).toBe('dom-1'); // oldest DOM event evicted
      expect(buffer).toHaveLength(4); // room created

      buffer.push(networkFailureEvent);
      expect(buffer.map((e) => e.id)).toEqual(['dom-2', 'dom-3', 'dom-4', 'dom-5', 'net-crit-1']);
    });
  });

  describe('Golden Test 2: Resource Registry Partial Failure & Fault Isolation', () => {
    it('cleans up remaining resources when one resource cleanup throws', async () => {
      const registry = new ResourceRegistry();
      let cleanedB = false;
      let cleanedC = false;

      // Register failing resource
      registry.register({
        id: 'resource-a-failing',
        scope: 'run-lifetime',
        cleanup: async () => {
          throw new Error('Simulated network timeout during cleanup');
        },
      });

      // Register succeeding resources
      registry.register({
        id: 'resource-b-good',
        scope: 'run-lifetime',
        cleanup: async () => {
          cleanedB = true;
        },
      });

      registry.register({
        id: 'resource-c-good',
        scope: 'run-lifetime',
        cleanup: async () => {
          cleanedC = true;
        },
      });

      const result = await registry.cleanupAll();

      // Assert fault isolation: failure did not block other cleanups
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.id).toBe('resource-a-failing');
      expect(result.failed[0]?.error).toContain('Simulated network timeout');

      expect(result.succeeded).toHaveLength(2);
      expect(cleanedB).toBe(true);
      expect(cleanedC).toBe(true);
    });
  });

  describe('Golden Test 3: Causal Event Ordering & Traceable Provenance', () => {
    it('correlates chaos injection with failure signals and produces traceable autopsy evidence', () => {
      const injectionId = 'inj-golden-99';

      // 1. Chaos Injected Event
      const chaosEvent: HavocEvent = {
        id: 'evt-chaos',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'CHAOS_INJECTED',
        source: 'service_worker',
        correlationId: injectionId,
      };

      // 2. Failure Event caused by chaos (linked via injectionId)
      const failureEvent: HavocEvent = {
        id: 'evt-fail',
        runId,
        timestamp: 1500,
        sequence: 2,
        type: 'REQUEST_TRANSPORT_FAILURE',
        source: 'page',
        resource: 'https://api.example.com/checkout',
        metadata: {
          injectionId,
        },
      };

      // Ingest events into signal engine
      processEvent(chaosEvent);
      const signals = processEvent(failureEvent);

      expect(signals).toHaveLength(1);
      const signal = signals[0];
      expect(signal?.type).toBe('RequestFailureObserved');
      expect(signal?.confidence).toBe(0.97); // boost for injectionId linkage
      expect(signal?.derivedFrom).toEqual(['evt-fail']);

      // Evaluate recovery
      const events = [chaosEvent, failureEvent];
      const allSignals = [signal!];
      const recoveryResult = evaluateRecovery({
        runId,
        chaosEndTime: 2000,
        windowEnd: 10000,
        events,
        signals: allSignals,
      });

      expect(recoveryResult.recovery.outcome).toBe('FAILED');
      expect(recoveryResult.contributingEventIds).toContain('evt-fail');
      expect(recoveryResult.contributingSignalIds).toContain(signal!.id);

      // Derive finding
      const eventIndex = new Map(events.map((e) => [e.id, e]));
      const signalIndex = new Map(allSignals.map((s) => [s.id, s]));

      const findingResult = deriveFromRecoveryResult(
        runId,
        recoveryResult,
        eventIndex,
        signalIndex
      );

      expect(findingResult.finding).toBeDefined();
      expect(findingResult.finding?.severity).toBe('HIGH');
      expect(findingResult.finding?.confidence).toBe(0.95);
      expect(findingResult.evidence.length).toBeGreaterThan(0);

      // Every evidenceId in finding points to verified evidence
      const evidenceMap = new Map(findingResult.evidence.map((e) => [e.id, e]));
      for (const evId of findingResult.finding!.evidenceIds) {
        expect(evidenceMap.has(evId)).toBe(true);
      }
    });
  });

  describe('Golden Test 4: Input Stress and Viewport Stress Definitions', () => {
    it('builds valid chaos parameters for input_stress and viewport_stress', () => {
      const inputDef: ExperimentDefinition = {
        id: 'def-input',
        kind: 'input_stress',
        name: 'Input Stress Unicode',
        description: 'Test unicode injection',
        params: { mode: 'unicode' },
      };

      const params1 = buildChaosParams(inputDef, 'run-inp');
      expect(params1?.kind).toBe('input_stress');
      if (params1?.kind === 'input_stress') {
        expect(params1.mode).toBe('unicode');
        expect(params1.runId).toBe('run-inp');
      }

      const viewportDef: ExperimentDefinition = {
        id: 'def-viewport',
        kind: 'viewport_stress',
        name: 'Viewport Narrow',
        description: 'Test layout constraint',
        params: { mode: 'overflow_squeeze' },
      };

      const params2 = buildChaosParams(viewportDef, 'run-vp');
      expect(params2?.kind).toBe('viewport_stress');
      if (params2?.kind === 'viewport_stress') {
        expect(params2.mode).toBe('overflow_squeeze');
        expect(params2.runId).toBe('run-vp');
      }
    });
  });

  describe('Golden Test 5: Abort Lifecycle & Timeout Isolation', () => {
    it('times out hanging resource cleanups without blocking other resources', async () => {
      const { vi } = await import('vitest');
      vi.useFakeTimers();

      const registry = new ResourceRegistry();
      let resourceBCompleted = false;

      // Register a resource that never resolves (simulating a hung tab / deadlock)
      registry.register({
        id: 'hung-resource',
        scope: 'run-lifetime',
        cleanup: () => new Promise<void>(() => {}), // never resolves
      });

      // Register a healthy resource
      registry.register({
        id: 'healthy-resource',
        scope: 'run-lifetime',
        cleanup: () => {
          resourceBCompleted = true;
        },
      });

      const cleanupPromise = registry.cleanupAll();

      // Fast-forward past the 5000ms per-resource timeout
      await vi.advanceTimersByTimeAsync(5100);

      const result = await cleanupPromise;

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.id).toBe('hung-resource');
      expect(result.failed[0]?.error).toBe('cleanup timed out');
      expect(result.succeeded).toContain('healthy-resource');
      expect(resourceBCompleted).toBe(true);

      vi.useRealTimers();
    });

    it('short-circuits openRecoveryWindow immediately when AbortSignal fires', async () => {
      const { openRecoveryWindow } = await import('../recovery-window');
      const abortCtrl = new AbortController();

      const startTime = Date.now();
      const recoveryPromise = openRecoveryWindow(
        {
          runId: 'run-abort-test',
          chaosEndTime: startTime,
          windowMs: 8000,
          signal: abortCtrl.signal,
          events: [],
          signals: [],
        },
        () => ({ events: [], signals: [] }),
        abortCtrl.signal
      );

      // Abort after 50ms
      setTimeout(() => {
        abortCtrl.abort();
      }, 50);

      const result = await recoveryPromise;
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(1000); // resolved within <1s instead of waiting 8s
      expect(result.recovery.outcome).toBe('UNKNOWN');
    });
  });

  describe('Golden Test 6: Watchdog & Fallback Abort Isolation', () => {
    it('detects stale run and transitions to TIMED_OUT on watchdog alarm', async () => {
      const { checkRunWatchdog } = await import('../run-coordinator');
      const { checkpoint, getCurrentRun } = await import('../../state');

      // Create a stale run (e.g. stuck in CLEANING for 40s)
      const staleRun: import('../../../domain/run').ExperimentRun = {
        runId: 'stale-run-123',
        target: { tabId: 1, origin: 'https://example.com', url: 'https://example.com', frameId: 0 },
        definition: {
          id: 'def-1',
          name: 'Stale Exp',
          description: 'Stale test',
          kind: 'fetch_latency',
          params: { durationMs: 2000, recoveryWindowMs: 2000 },
        },
        state: 'CLEANING',
        createdAt: Date.now() - 50_000,
        updatedAt: Date.now() - 40_000, // 40s ago (> 30s threshold)
      };

      await checkpoint(staleRun);
      expect(getCurrentRun()?.state).toBe('CLEANING');

      // Run watchdog
      await checkRunWatchdog();

      // Checkpoint cleared
      expect(getCurrentRun()).toBeNull();
    });

    it('forces fallback abort when _abortController is null but active run exists', async () => {
      const { abortRun } = await import('../run-coordinator');
      const { checkpoint, getCurrentRun } = await import('../../state');

      // Mock an active run left in session storage after SW restart
      const zombieRun: import('../../../domain/run').ExperimentRun = {
        runId: 'zombie-run-456',
        target: { tabId: 1, origin: 'https://example.com', url: 'https://example.com', frameId: 0 },
        definition: {
          id: 'def-2',
          name: 'Zombie Exp',
          description: 'Zombie test',
          kind: 'fetch_latency',
          params: {},
        },
        state: 'ACTIVE',
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 5_000,
      };

      await checkpoint(zombieRun);
      expect(getCurrentRun()?.state).toBe('ACTIVE');

      // Call abortRun without an active in-memory _abortController
      await abortRun();

      // Checkpoint cleared and run aborted
      expect(getCurrentRun()).toBeNull();
    });
  });
});
