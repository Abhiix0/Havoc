import { describe, it, expect } from 'vitest';
import {
  getEventPlausibilityTag,
  getSignalPlausibilityTag,
} from '../../utils/plausibility';
import type { HavocEvent } from '../../../../domain/event';
import type { Signal } from '../../../../domain/signal';

describe('Causal Plausibility Presentation Logic', () => {
  const targetOrigin = 'https://asos.com';

  describe('getEventPlausibilityTag', () => {
    it('returns SAME-ORIGIN · CHAOS-LINKED for same-origin failure with injectionId', () => {
      const event: HavocEvent = {
        id: 'evt-1',
        runId: 'r1',
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

      const tag = getEventPlausibilityTag(event, targetOrigin);
      expect(tag).toEqual({
        label: 'SAME-ORIGIN · CHAOS-LINKED',
        tone: 'chaos',
      });
    });

    it('returns SAME-ORIGIN · AMBIENT for same-origin failure without injectionId', () => {
      const event: HavocEvent = {
        id: 'evt-2',
        runId: 'r1',
        timestamp: 1000,
        sequence: 2,
        type: 'REQUEST_HTTP_FAILURE',
        source: 'page',
        resource: 'https://asos.com/api/cart',
        metadata: {
          status: 500,
        },
      };

      const tag = getEventPlausibilityTag(event, targetOrigin);
      expect(tag).toEqual({
        label: 'SAME-ORIGIN · AMBIENT',
        tone: 'ambient',
      });
    });

    it('returns CROSS-ORIGIN · THIRD-PARTY for cross-origin failure without injectionId', () => {
      const event: HavocEvent = {
        id: 'evt-3',
        runId: 'r1',
        timestamp: 1000,
        sequence: 3,
        type: 'REQUEST_TRANSPORT_FAILURE',
        source: 'page',
        resource: 'https://adservice.google.com/pixel.gif',
        metadata: {
          status: 0,
        },
      };

      const tag = getEventPlausibilityTag(event, targetOrigin);
      expect(tag).toEqual({
        label: 'CROSS-ORIGIN · THIRD-PARTY',
        tone: 'noise',
      });
    });

    it('returns CROSS-ORIGIN · CHAOS-LINKED for cross-origin failure with injectionId', () => {
      const event: HavocEvent = {
        id: 'evt-4',
        runId: 'r1',
        timestamp: 1000,
        sequence: 4,
        type: 'REQUEST_TRANSPORT_FAILURE',
        source: 'page',
        resource: 'https://api.external.com/checkout',
        metadata: {
          injectionId: 'inj-ext-99',
          status: 0,
        },
      };

      const tag = getEventPlausibilityTag(event, targetOrigin);
      expect(tag).toEqual({
        label: 'CROSS-ORIGIN · CHAOS-LINKED',
        tone: 'chaos',
      });
    });

    it('returns null for non-failure events (e.g. REQUEST_COMPLETED, CHAOS_INJECTED, DOM_OBSERVATION)', () => {
      const completedEvent: HavocEvent = {
        id: 'evt-5',
        runId: 'r1',
        timestamp: 1000,
        sequence: 5,
        type: 'REQUEST_COMPLETED',
        source: 'page',
        resource: 'https://asos.com/api/cart',
        metadata: { status: 200 },
      };

      const chaosEvent: HavocEvent = {
        id: 'evt-6',
        runId: 'r1',
        timestamp: 1000,
        sequence: 6,
        type: 'CHAOS_INJECTED',
        source: 'service_worker',
        correlationId: 'inj-1',
      };

      expect(getEventPlausibilityTag(completedEvent, targetOrigin)).toBeNull();
      expect(getEventPlausibilityTag(chaosEvent, targetOrigin)).toBeNull();
    });
  });

  describe('getSignalPlausibilityTag', () => {
    it('returns CHAOS-LINKED tag for RequestFailureObserved with confidence >= 0.97', () => {
      const signal: Signal = {
        id: 'sig-1',
        runId: 'r1',
        type: 'RequestFailureObserved',
        confidence: 0.97,
        derivedFrom: ['evt-1'],
        timestamp: 1000,
      };

      const tag = getSignalPlausibilityTag(signal);
      expect(tag).toEqual({
        label: 'CHAOS-LINKED',
        tone: 'chaos',
      });
    });

    it('returns SAME-ORIGIN · AMBIENT tag for RequestFailureObserved with confidence 0.95', () => {
      const signal: Signal = {
        id: 'sig-2',
        runId: 'r1',
        type: 'RequestFailureObserved',
        confidence: 0.95,
        derivedFrom: ['evt-2'],
        timestamp: 1000,
      };

      const tag = getSignalPlausibilityTag(signal);
      expect(tag).toEqual({
        label: 'SAME-ORIGIN · AMBIENT',
        tone: 'ambient',
      });
    });

    it('returns null for non-failure signals (e.g. LoadingStateDetected, ErrorStateDetected)', () => {
      const loadingSignal: Signal = {
        id: 'sig-3',
        runId: 'r1',
        type: 'LoadingStateDetected',
        confidence: 0.70,
        derivedFrom: ['evt-3'],
        timestamp: 1000,
      };

      expect(getSignalPlausibilityTag(loadingSignal)).toBeNull();
    });
  });
});
