import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  processEvent,
  clearRunBuffer,
  setRunContext,
  getRunSnapshot,
} from '../signal-engine';
import { evaluateRecovery } from '../recovery-window';
import { deriveFromRecoveryResult } from '../finding-engine';
import type { HavocEvent } from '../../../domain/event';

describe('Signal Engine — Causal Plausibility & Gating Tests', () => {
  const runId = 'test-causal-run';
  const targetOrigin = 'https://asos.com';

  beforeEach(() => {
    clearRunBuffer(runId);
  });

  describe('fetch_failure causal gating', () => {
    it('emits RequestFailureObserved signal (0.97) for same-origin failure with injectionId', () => {
      const event: HavocEvent = {
        id: 'evt-1',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'REQUEST_HTTP_FAILURE',
        source: 'page',
        resource: 'https://asos.com/api/cart',
        metadata: {
          injectionId: 'inj-123',
          status: 503,
        },
      };

      const signals = processEvent(event, { kind: 'fetch_failure', targetOrigin });
      expect(signals).toHaveLength(1);
      expect(signals[0]?.type).toBe('RequestFailureObserved');
      expect(signals[0]?.confidence).toBe(0.97);
      expect(signals[0]?.derivedFrom).toEqual(['evt-1']);
    });

    it('emits RequestFailureObserved signal (0.97) for cross-origin failure with matching injectionId', () => {
      const event: HavocEvent = {
        id: 'evt-2',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'REQUEST_TRANSPORT_FAILURE',
        source: 'page',
        resource: 'https://api.thirdparty.com/checkout',
        metadata: {
          injectionId: 'inj-123',
          status: 0,
        },
      };

      const signals = processEvent(event, { kind: 'fetch_failure', targetOrigin });
      expect(signals).toHaveLength(1);
      expect(signals[0]?.type).toBe('RequestFailureObserved');
      expect(signals[0]?.confidence).toBe(0.97);
    });

    it('emits RequestFailureObserved signal (0.95) for same-origin failure without injectionId', () => {
      const event: HavocEvent = {
        id: 'evt-3',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'REQUEST_HTTP_FAILURE',
        source: 'page',
        resource: 'https://asos.com/api/products',
        metadata: {
          status: 500,
        },
      };

      const signals = processEvent(event, { kind: 'fetch_failure', targetOrigin });
      expect(signals).toHaveLength(1);
      expect(signals[0]?.type).toBe('RequestFailureObserved');
      expect(signals[0]?.confidence).toBe(0.95);
    });

    it('does NOT emit a signal for cross-origin failure with no injectionId (bug fix)', () => {
      const event: HavocEvent = {
        id: 'evt-4',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'REQUEST_HTTP_FAILURE',
        source: 'page',
        resource: 'https://adservice.google.com/pixel.gif',
        metadata: {
          status: 404,
        },
      };

      const signals = processEvent(event, { kind: 'fetch_failure', targetOrigin });
      expect(signals).toHaveLength(0);
    });
  });

  describe('input_stress and viewport_stress failure gating', () => {
    it('does NOT emit any signal for failures during input_stress (same-origin or cross-origin)', () => {
      setRunContext(runId, { kind: 'input_stress', targetOrigin });

      const sameOriginEvent: HavocEvent = {
        id: 'evt-same-inp',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'REQUEST_HTTP_FAILURE',
        source: 'page',
        resource: 'https://asos.com/api/search',
        metadata: { status: 500 },
      };

      const crossOriginEvent: HavocEvent = {
        id: 'evt-cross-inp',
        runId,
        timestamp: 1100,
        sequence: 2,
        type: 'REQUEST_TRANSPORT_FAILURE',
        source: 'page',
        resource: 'https://analytics.tiktok.com/pixel',
        metadata: { status: 0 },
      };

      expect(processEvent(sameOriginEvent)).toHaveLength(0);
      expect(processEvent(crossOriginEvent)).toHaveLength(0);
    });

    it('does NOT emit any signal for failures during viewport_stress', () => {
      setRunContext(runId, { kind: 'viewport_stress', targetOrigin });

      const failureEvent: HavocEvent = {
        id: 'evt-vp',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'REQUEST_TIMEOUT',
        source: 'page',
        resource: 'https://asos.com/api/layout',
        metadata: { status: 0 },
      };

      expect(processEvent(failureEvent)).toHaveLength(0);
    });

    it('ASOS scenario: cross-origin ad pixel failure during input_stress produces no false-positive Finding', () => {
      setRunContext(runId, { kind: 'input_stress', targetOrigin });

      // 1. Chaos Injected event for input_stress
      const chaosEvent: HavocEvent = {
        id: 'evt-chaos-inp',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'CHAOS_INJECTED',
        source: 'service_worker',
        correlationId: 'inj-input-99',
        metadata: { kind: 'input_stress', origin: targetOrigin },
      };

      // 2. Unrelated cross-origin tracking pixel failure
      const adPixelFailure: HavocEvent = {
        id: 'evt-ad-pixel',
        runId,
        timestamp: 1500,
        sequence: 2,
        type: 'REQUEST_HTTP_FAILURE',
        source: 'page',
        resource: 'https://bat.bing.com/action/0',
        metadata: { status: 503 },
      };

      processEvent(chaosEvent);
      const signals = processEvent(adPixelFailure);

      // Verify no RequestFailureObserved signal derived
      expect(signals).toHaveLength(0);

      // Verify downstream autopsy evaluation
      const snapshot = getRunSnapshot(runId);
      expect(snapshot.signals).toHaveLength(0);

      const recoveryResult = evaluateRecovery({
        runId,
        chaosEndTime: 2000,
        windowEnd: 10000,
        events: snapshot.events,
        signals: snapshot.signals,
      });

      expect(recoveryResult.recovery.outcome).toBe('UNKNOWN');

      const findingResult = deriveFromRecoveryResult(
        runId,
        recoveryResult,
        new Map(snapshot.events.map((e) => [e.id, e])),
        new Map()
      );

      // Finding must be null — no false positive HIGH/MEDIUM finding
      expect(findingResult.finding).toBeNull();
    });
  });

  describe('fetch_latency failure gating', () => {
    it('does NOT emit a signal for ambient same-origin failure without injectionId during fetch_latency', () => {
      const ambientFailure: HavocEvent = {
        id: 'evt-amb',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'REQUEST_HTTP_FAILURE',
        source: 'page',
        resource: 'https://asos.com/api/recommendations',
        metadata: { status: 500 }, // no injectionId
      };

      const signals = processEvent(ambientFailure, { kind: 'fetch_latency', targetOrigin });
      expect(signals).toHaveLength(0);
    });

    it('emits RequestFailureObserved signal (0.97) for failure with injectionId during fetch_latency', () => {
      const latencyInjectedFailure: HavocEvent = {
        id: 'evt-lat-fail',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'REQUEST_TIMEOUT',
        source: 'page',
        resource: 'https://asos.com/api/recommendations',
        metadata: { injectionId: 'inj-lat-1', status: 0 },
      };

      const signals = processEvent(latencyInjectedFailure, { kind: 'fetch_latency', targetOrigin });
      expect(signals).toHaveLength(1);
      expect(signals[0]?.type).toBe('RequestFailureObserved');
      expect(signals[0]?.confidence).toBe(0.97);
    });
  });

  describe('Runtime error signal derivation', () => {
    it('emits RuntimeErrorObserved signal (0.98) for UNCAUGHT_EXCEPTION event with derivedFrom === [event.id]', () => {
      const uncaughtEvent: HavocEvent = {
        id: 'evt-uncaught-1',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'UNCAUGHT_EXCEPTION',
        source: 'page',
        metadata: { message: 'Uncaught TypeError: Cannot read property' },
      };

      const signals = processEvent(uncaughtEvent);
      expect(signals).toHaveLength(1);
      expect(signals[0]?.type).toBe('RuntimeErrorObserved');
      expect(signals[0]?.confidence).toBe(0.98);
      expect(signals[0]?.derivedFrom).toEqual(['evt-uncaught-1']);
    });

    it('emits RuntimeErrorObserved signal (0.98) for UNHANDLED_REJECTION event with derivedFrom === [event.id]', () => {
      const rejectionEvent: HavocEvent = {
        id: 'evt-rejection-1',
        runId,
        timestamp: 1200,
        sequence: 2,
        type: 'UNHANDLED_REJECTION',
        source: 'page',
        metadata: { message: 'Unhandled promise rejection' },
      };

      const signals = processEvent(rejectionEvent);
      expect(signals).toHaveLength(1);
      expect(signals[0]?.type).toBe('RuntimeErrorObserved');
      expect(signals[0]?.confidence).toBe(0.98);
      expect(signals[0]?.derivedFrom).toEqual(['evt-rejection-1']);
    });

    it('reconstructs RuntimeErrorObserved signals in getRunSnapshot', () => {
      const uncaughtEvent: HavocEvent = {
        id: 'evt-uncaught-snap',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'UNCAUGHT_EXCEPTION',
        source: 'page',
        metadata: { message: 'Error' },
      };

      processEvent(uncaughtEvent);
      const snapshot = getRunSnapshot(runId);
      expect(snapshot.signals).toHaveLength(1);
      expect(snapshot.signals[0]?.type).toBe('RuntimeErrorObserved');
      expect(snapshot.signals[0]?.confidence).toBe(0.98);
      expect(snapshot.signals[0]?.derivedFrom).toEqual(['evt-uncaught-snap']);
    });
  });

  describe('Secret pattern signal derivation', () => {
    it('emits SecretPatternDetected signal with confidence === 0.60 for SECRET_PATTERN_MATCH event', () => {
      const secretEvent: HavocEvent = {
        id: 'evt-secret-match-1',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'SECRET_PATTERN_MATCH',
        source: 'service_worker',
        metadata: {
          patternId: 'aws_access_key',
          label: 'AWS Access Key',
          severity: 'HIGH',
          redacted: 'AKIA...[REDACTED]...1234',
        },
      };

      const signals = processEvent(secretEvent);
      expect(signals).toHaveLength(1);
      expect(signals[0]?.type).toBe('SecretPatternDetected');
      expect(signals[0]?.confidence).toBe(0.60);
      expect(signals[0]?.derivedFrom).toEqual(['evt-secret-match-1']);
    });

    it('reconstructs SecretPatternDetected signals in getRunSnapshot', () => {
      const secretEvent: HavocEvent = {
        id: 'evt-secret-snap-1',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'SECRET_PATTERN_MATCH',
        source: 'service_worker',
        metadata: {
          patternId: 'generic_api_key',
          label: 'Generic API Key Assignment',
          severity: 'MEDIUM',
          redacted: 'api_...[REDACTED]...456"',
        },
      };

      processEvent(secretEvent);
      const snapshot = getRunSnapshot(runId);
      expect(snapshot.signals).toHaveLength(1);
      expect(snapshot.signals[0]?.type).toBe('SecretPatternDetected');
      expect(snapshot.signals[0]?.confidence).toBe(0.60);
      expect(snapshot.signals[0]?.derivedFrom).toEqual(['evt-secret-snap-1']);
    });
  });

  describe('Layout overflow signal derivation', () => {
    it('emits LayoutOverflowDetected signal with confidence === 0.85 when no CHAOS_INJECTED is in buffer', () => {
      const overflowEvent: HavocEvent = {
        id: 'evt-overflow-1',
        runId,
        timestamp: 2000,
        sequence: 1,
        type: 'DOM_OBSERVATION',
        source: 'content',
        metadata: {
          kind: 'layout_overflow_detected',
          selector: 'html',
          textSnippet: 'overflow 120px',
        },
      };

      const signals = processEvent(overflowEvent);
      expect(signals).toHaveLength(1);
      expect(signals[0]?.type).toBe('LayoutOverflowDetected');
      expect(signals[0]?.confidence).toBe(0.85);
      expect(signals[0]?.derivedFrom).toEqual(['evt-overflow-1']);
    });

    it('emits LayoutOverflowDetected signal with confidence === 0.95 when viewport_stress CHAOS_INJECTED is in buffer', () => {
      const chaosEvent: HavocEvent = {
        id: 'evt-chaos-vp',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'CHAOS_INJECTED',
        source: 'service_worker',
        metadata: {
          kind: 'viewport_stress',
          mode: 'mobile_narrow',
        },
      };

      processEvent(chaosEvent);

      const overflowEvent: HavocEvent = {
        id: 'evt-overflow-2',
        runId,
        timestamp: 2000,
        sequence: 2,
        type: 'DOM_OBSERVATION',
        source: 'content',
        metadata: {
          kind: 'layout_overflow_detected',
          selector: 'html',
          textSnippet: 'overflow 80px',
        },
      };

      const signals = processEvent(overflowEvent);
      expect(signals).toHaveLength(1);
      expect(signals[0]?.type).toBe('LayoutOverflowDetected');
      expect(signals[0]?.confidence).toBe(0.95);
      expect(signals[0]?.derivedFrom).toEqual(['evt-overflow-2', 'evt-chaos-vp']);
    });

    it('reconstructs LayoutOverflowDetected signals in getRunSnapshot', () => {
      const chaosEvent: HavocEvent = {
        id: 'evt-chaos-snap',
        runId,
        timestamp: 1000,
        sequence: 1,
        type: 'CHAOS_INJECTED',
        source: 'service_worker',
        metadata: {
          kind: 'viewport_stress',
        },
      };
      const overflowEvent: HavocEvent = {
        id: 'evt-overflow-snap',
        runId,
        timestamp: 2000,
        sequence: 2,
        type: 'DOM_OBSERVATION',
        source: 'content',
        metadata: {
          kind: 'layout_overflow_detected',
          selector: 'html',
          textSnippet: 'overflow 50px',
        },
      };

      processEvent(chaosEvent);
      processEvent(overflowEvent);

      const snapshot = getRunSnapshot(runId);
      const overflowSignals = snapshot.signals.filter((s) => s.type === 'LayoutOverflowDetected');
      expect(overflowSignals).toHaveLength(1);
      expect(overflowSignals[0]?.confidence).toBe(0.95);
      expect(overflowSignals[0]?.derivedFrom).toEqual(['evt-overflow-snap', 'evt-chaos-snap']);
    });
  });
});
