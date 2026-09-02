import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  currentShipCheck,
  shipCheckLoading,
  shipCheckError,
  isShipCheckActive,
  startShipCheck,
  loadShipCheck,
  setupShipCheckStore,
  handleShipCheckMessage,
} from '../ship-check';
import {
  saveShipCheck,
  saveFinding,
  saveRemediation,
} from '../../../../storage/repository';
import { createShipCheckStepUpdateMessage } from '../../../../messaging/messages';
import type { ShipCheckRun } from '../../../../domain/ship-check';
import type { Finding } from '../../../../domain/finding';
import type { Remediation } from '../../../../domain/remediation';

describe('Ship Check Store', () => {
  beforeEach(() => {
    currentShipCheck.set(null);
    shipCheckLoading.set(false);
    shipCheckError.set(null);

    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 101, url: 'https://example.com/app' }]),
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ type: 'CREATE_SHIP_CHECK_RESPONSE' }),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    });
  });

  it('computes isShipCheckActive correctly based on completedAt', () => {
    expect(get(isShipCheckActive)).toBe(false);

    const activeRun: ShipCheckRun = {
      shipCheckId: 'sc-1',
      target: { tabId: 101, origin: 'https://example.com', url: 'https://example.com/app', frameId: 0 },
      steps: [
        { kind: 'runtime_errors', runId: 'r-1', status: 'RUNNING' },
        { kind: 'fetch_latency', runId: '', status: 'PENDING' },
      ],
      createdAt: 1000,
      readiness: 'UNKNOWN',
    };

    currentShipCheck.set(activeRun);
    expect(get(isShipCheckActive)).toBe(true);

    const completedRun: ShipCheckRun = {
      ...activeRun,
      completedAt: 5000,
      readiness: 'READY',
    };

    currentShipCheck.set(completedRun);
    expect(get(isShipCheckActive)).toBe(false);
  });

  it('startShipCheck sends CREATE_SHIP_CHECK message with resolved target and returns true on success', async () => {
    const result = await startShipCheck();
    expect(result).toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CREATE_SHIP_CHECK',
        target: {
          tabId: 101,
          origin: 'https://example.com',
          url: 'https://example.com/app',
          frameId: 0,
        },
      })
    );
    expect(get(shipCheckError)).toBeNull();
    expect(get(shipCheckLoading)).toBe(false);
  });

  it('startShipCheck sets error when chrome.runtime.sendMessage returns error', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({
      type: 'CREATE_SHIP_CHECK_RESPONSE',
      error: 'Could not resolve a target tab',
    });

    const result = await startShipCheck();
    expect(result).toBe(false);
    expect(get(shipCheckError)).toBe('Could not resolve a target tab');
    expect(get(shipCheckLoading)).toBe(false);
  });

  it('handleShipCheckMessage updates currentShipCheck on SHIP_CHECK_STEP_UPDATE message', () => {
    const run: ShipCheckRun = {
      shipCheckId: 'sc-update-1',
      target: { tabId: 101, origin: 'https://example.com', url: 'https://example.com/app', frameId: 0 },
      steps: [
        { kind: 'runtime_errors', runId: 'r-1', status: 'DONE' },
      ],
      createdAt: 1000,
      readiness: 'UNKNOWN',
    };

    const msg = createShipCheckStepUpdateMessage(run);
    handleShipCheckMessage(msg);

    expect(get(currentShipCheck)?.shipCheckId).toBe('sc-update-1');
    expect(get(currentShipCheck)?.steps[0]?.status).toBe('DONE');
  });

  it('setupShipCheckStore registers and cleans up runtime listener', () => {
    const cleanup = setupShipCheckStore();
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    cleanup();
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
  });

  it('loadShipCheck loads ShipCheckRun with all associated findings and remediations', async () => {
    const shipCheck: ShipCheckRun = {
      shipCheckId: 'sc-idb-1',
      target: { tabId: 101, origin: 'https://example.com', url: 'https://example.com/app', frameId: 0 },
      steps: [
        { kind: 'runtime_errors', runId: 'r-step-1', status: 'DONE' },
        { kind: 'secret_scan', runId: 'r-step-2', status: 'DONE' },
      ],
      createdAt: 1000,
      completedAt: 6000,
      readiness: 'BLOCKED',
    };

    const finding1: Finding = {
      id: 'f-1',
      runId: 'r-step-1',
      severity: 'HIGH',
      confidence: 0.98,
      description: 'Runtime error finding',
      evidenceIds: [],
      checkKind: 'runtime_errors',
    };

    const remediation1: Remediation = {
      id: 'rem-1',
      findingId: 'f-1',
      runId: 'r-step-1',
      title: 'Fix unhandled promise rejection',
      whatHappened: 'Error thrown on click',
      whyItMatters: 'Breaks flow',
      howToFix: ['Add catch handler'],
      fixPrompt: 'Fix prompt text',
    };

    await saveShipCheck(shipCheck);
    await saveFinding(finding1);
    await saveRemediation(remediation1);

    const details = await loadShipCheck('sc-idb-1');
    expect(details.shipCheck?.shipCheckId).toBe('sc-idb-1');
    expect(details.findings).toHaveLength(1);
    expect(details.findings[0]?.id).toBe('f-1');
    expect(details.remediations).toHaveLength(1);
    expect(details.remediations[0]?.id).toBe('rem-1');
  });
});
