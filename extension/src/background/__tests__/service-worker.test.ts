import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkpoint } from '../state';
import { handleIncomingMessage } from '../service-worker';
import { getEventsByRunId } from '../../storage/repository';
import { clearRunBuffer, getRunSnapshot } from '../engine/signal-engine';
import { createBridgeMessage, createDomObservationMessage } from '../../messaging/messages';
import type { ExperimentRun } from '../../domain/run';
import type { Target } from '../../domain/target';
import type { ExperimentDefinition } from '../../domain/experiment';

// Ensure chrome APIs exist before testing
vi.stubGlobal('chrome', {
  alarms: {
    onAlarm: { addListener: vi.fn() },
    get: vi.fn(),
    create: vi.fn(),
  },
  runtime: {
    onInstalled: { addListener: vi.fn() },
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue({}),
  },
  storage: {
    session: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
});

describe('Service Worker Observation Ingestion & Tab Gating', () => {
  const activeTabId = 42;
  const unrelatedTabId = 99;
  const runId = 'test-sw-tab-run';

  const target: Target = {
    tabId: activeTabId,
    origin: 'https://asos.com',
    url: 'https://asos.com/checkout',
    frameId: 0,
  };

  const definition: ExperimentDefinition = {
    id: 'def-fetch-fail',
    name: 'Fetch Failure Mode',
    description: 'Inject network errors',
    kind: 'fetch_failure',
    params: { mode: 'transport_error' },
  };

  const activeRun: ExperimentRun = {
    runId,
    definition,
    target,
    state: 'ACTIVE',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(async () => {
    clearRunBuffer(runId);
    clearRunBuffer('debug-run');
    await checkpoint(null);
  });

  describe('REQUEST_OBSERVATION tab gating', () => {
    it('accepts and attributes observation when sender.tab.id matches active run target.tabId', async () => {
      await checkpoint(activeRun);

      const message = createBridgeMessage('REQUEST_OBSERVATION', {
        observationId: 'obs-match-1',
        transport: 'fetch',
        outcome: 'http_failure',
        url: 'https://asos.com/api/cart',
        method: 'GET',
        status: 503,
        startTime: 1000,
        duration: 15,
      });

      const sender: chrome.runtime.MessageSender = {
        tab: {
          id: activeTabId,
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

      const sendResponse = vi.fn();
      const handled = handleIncomingMessage(message, sender, sendResponse);

      expect(handled).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith(null);

      // Verify event was saved and attributed to current run
      const snapshot = getRunSnapshot(runId);
      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0]?.runId).toBe(runId);
      expect(snapshot.events[0]?.resource).toBe('https://asos.com/api/cart');
    });

    it('discards observation when sender.tab.id does not match active run target.tabId', async () => {
      await checkpoint(activeRun);

      const message = createBridgeMessage('REQUEST_OBSERVATION', {
        observationId: 'obs-mismatch-1',
        transport: 'fetch',
        outcome: 'http_failure',
        url: 'https://flipkart.com/api/cart',
        method: 'GET',
        status: 500,
        startTime: 1000,
        duration: 15,
      });

      const sender: chrome.runtime.MessageSender = {
        tab: {
          id: unrelatedTabId, // Tab 99 != target tab 42
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

      const sendResponse = vi.fn();
      const handled = handleIncomingMessage(message, sender, sendResponse);

      expect(handled).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith(null);

      // Verify event was NOT saved or attributed to the active run
      const snapshot = getRunSnapshot(runId);
      expect(snapshot.events).toHaveLength(0);
    });

    it('discards observation when sender.tab is undefined (non-tab context)', async () => {
      await checkpoint(activeRun);

      const message = createBridgeMessage('REQUEST_OBSERVATION', {
        observationId: 'obs-notab-1',
        transport: 'fetch',
        outcome: 'success',
        url: 'https://asos.com/api/search',
        method: 'GET',
        status: 200,
        startTime: 1000,
        duration: 10,
      });

      const sender: chrome.runtime.MessageSender = {}; // No tab property

      const sendResponse = vi.fn();
      const handled = handleIncomingMessage(message, sender, sendResponse);

      expect(handled).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith(null);

      const snapshot = getRunSnapshot(runId);
      expect(snapshot.events).toHaveLength(0);
    });

    it('discards observation when there is no active run (getCurrentRun is null) without DEBUG_RUN_ID fallback', async () => {
      await checkpoint(null); // No active run

      const message = createBridgeMessage('REQUEST_OBSERVATION', {
        observationId: 'obs-norun-1',
        transport: 'fetch',
        outcome: 'transport_failure',
        url: 'https://example.com/api',
        method: 'GET',
        status: 0,
        startTime: 1000,
        duration: 5,
      });

      const sender: chrome.runtime.MessageSender = {
        tab: {
          id: activeTabId,
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

      const sendResponse = vi.fn();
      const handled = handleIncomingMessage(message, sender, sendResponse);

      expect(handled).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith(null);

      // Confirm no events created for debug-run or any run
      const debugEvents = await getEventsByRunId('debug-run');
      expect(debugEvents).toHaveLength(0);
    });
  });

  describe('DOM_OBSERVATION tab gating', () => {
    it('accepts and attributes DOM observation when sender.tab.id matches active run target.tabId', async () => {
      await checkpoint(activeRun);

      const message = createDomObservationMessage({
        kind: 'loading_indicator_appeared',
        selector: '.spinner-active',
        observedAt: 1000,
        timestamp: 1000,
        textSnippet: '',
        runId: null,
      });

      const sender: chrome.runtime.MessageSender = {
        tab: {
          id: activeTabId,
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

      const sendResponse = vi.fn();
      const handled = handleIncomingMessage(message, sender, sendResponse);

      expect(handled).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith(null);

      const snapshot = getRunSnapshot(runId);
      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0]?.runId).toBe(runId);
      expect(snapshot.events[0]?.type).toBe('DOM_OBSERVATION');
    });

    it('discards DOM observation when sender.tab.id does not match even if payload.runId matches current runId', async () => {
      await checkpoint(activeRun);

      const message = createDomObservationMessage({
        kind: 'error_text_appeared',
        selector: '#error-msg',
        textSnippet: 'Network error',
        observedAt: 1000,
        timestamp: 1000,
        runId, // Content script self-reported active runId, but from wrong tab!
      });

      const sender: chrome.runtime.MessageSender = {
        tab: {
          id: unrelatedTabId, // Tab 99 != target tab 42
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

      const sendResponse = vi.fn();
      const handled = handleIncomingMessage(message, sender, sendResponse);

      expect(handled).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith(null);

      // Verify event was NOT admitted to active run
      const snapshot = getRunSnapshot(runId);
      expect(snapshot.events).toHaveLength(0);
    });

    it('discards DOM observation when there is no active run (getCurrentRun is null)', async () => {
      await checkpoint(null);

      const message = createDomObservationMessage({
        kind: 'loading_indicator_appeared',
        selector: '.spinner',
        observedAt: 1000,
        timestamp: 1000,
        textSnippet: '',
        runId: null,
      });

      const sender: chrome.runtime.MessageSender = {
        tab: {
          id: activeTabId,
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

      const sendResponse = vi.fn();
      const handled = handleIncomingMessage(message, sender, sendResponse);

      expect(handled).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith(null);

      const debugEvents = await getEventsByRunId('debug-run');
      expect(debugEvents).toHaveLength(0);
    });
  });
});
