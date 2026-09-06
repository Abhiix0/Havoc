import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ShipCheckRun } from '../../../domain/ship-check';
import type { Finding } from '../../../domain/finding';
import type { Remediation } from '../../../domain/remediation';
import type { Evidence } from '../../../domain/evidence';

// Mock repository
vi.mock('../../../storage/repository', () => ({
  getShipCheck: vi.fn(),
  getFindingsByRunId: vi.fn(),
  getRemediationsByFindingId: vi.fn(),
  getEvidenceByRunId: vi.fn(),
  updateShipCheckSyncState: vi.fn().mockResolvedValue(undefined),
}));

import {
  getShipCheck,
  getFindingsByRunId,
  getRemediationsByFindingId,
  getEvidenceByRunId,
  updateShipCheckSyncState,
} from '../../../storage/repository';
import { syncShipCheck, BACKEND_URL_KEY, PROJECT_ID_KEY } from '../sync-client';

describe('syncShipCheck', () => {
  let localStorageMock: Record<string, unknown> = {};

  const sampleShipCheck: ShipCheckRun = {
    shipCheckId: 'sc-123',
    target: {
      tabId: 1,
      origin: 'https://example.com',
      url: 'https://example.com/home',
      frameId: 0,
    },
    steps: [
      { kind: 'fetch_latency', runId: 'r-1', status: 'DONE' },
      { kind: 'fetch_failure', runId: 'r-2', status: 'DONE' },
    ],
    createdAt: 1000,
    completedAt: 5000,
    readiness: 'READY',
  };

  const sampleFinding: Finding = {
    id: 'f-1',
    runId: 'r-1',
    severity: 'HIGH',
    confidence: 0.9,
    description: 'High latency',
    evidenceIds: ['ev-1'],
    checkKind: 'fetch_latency',
  };

  const sampleEvidence: Evidence = {
    id: 'ev-1',
    runId: 'r-1',
    kind: 'event',
    refId: 'ref-1',
    capturedAt: 1200,
  };

  const sampleRemediation: Remediation = {
    id: 'rem-1',
    findingId: 'f-1',
    runId: 'r-1',
    title: 'Cache Request',
    whatHappened: 'Slow network',
    whyItMatters: 'Bad UX',
    howToFix: ['Add caching'],
    fixPrompt: 'Prompt',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock = {};

    // Mock chrome.storage.local
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn((key: string) => Promise.resolve({ [key]: localStorageMock[key] })),
          set: vi.fn((items: Record<string, unknown>) => {
            Object.assign(localStorageMock, items);
            return Promise.resolve();
          }),
        },
      },
    };

    vi.mocked(getShipCheck).mockResolvedValue(sampleShipCheck);
    vi.mocked(getFindingsByRunId).mockImplementation((runId: string) => {
      if (runId === 'r-1') return Promise.resolve([sampleFinding]);
      return Promise.resolve([]);
    });
    vi.mocked(getRemediationsByFindingId).mockImplementation((findingId: string) => {
      if (findingId === 'f-1') return Promise.resolve([sampleRemediation]);
      return Promise.resolve([]);
    });
    vi.mocked(getEvidenceByRunId).mockImplementation((runId: string) => {
      if (runId === 'r-1') return Promise.resolve([sampleEvidence]);
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. No backend URL configured -> resolves immediately without calling fetch or changing syncState', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    await syncShipCheck('sc-123');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updateShipCheckSyncState).not.toHaveBeenCalled();
  });

  it('2. Backend URL configured, fetch resolves 200 -> syncState ends SYNCED with syncedAt set', async () => {
    localStorageMock[BACKEND_URL_KEY] = 'http://localhost:8080';
    localStorageMock[PROJECT_ID_KEY] = 'proj-999';

    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/ship-checks')) {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ id: 'sc-123' }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    });
    globalThis.fetch = fetchSpy;

    await syncShipCheck('sc-123');

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/projects/proj-999/ship-checks',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    expect(updateShipCheckSyncState).toHaveBeenCalledWith('sc-123', {
      syncState: 'SYNCING',
    });
    expect(updateShipCheckSyncState).toHaveBeenCalledWith('sc-123', {
      syncState: 'SYNCED',
      syncedAt: expect.any(Number),
    });
  });

  it('creates default project if project ID is not cached in storage', async () => {
    localStorageMock[BACKEND_URL_KEY] = 'http://localhost:8080';
    // No PROJECT_ID_KEY cached

    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/api/v1/projects')) {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ id: 'created-proj-111' }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 'sc-123' }),
      });
    });
    globalThis.fetch = fetchSpy;

    await syncShipCheck('sc-123');

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/projects',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Default Project' }),
      })
    );
    expect(localStorageMock[PROJECT_ID_KEY]).toBe('created-proj-111');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/projects/created-proj-111/ship-checks',
      expect.any(Object)
    );
  });

  it('3. Backend URL configured, fetch rejects -> syncState ends SYNC_FAILED with lastSyncError without throwing', async () => {
    localStorageMock[BACKEND_URL_KEY] = 'http://localhost:8080';
    localStorageMock[PROJECT_ID_KEY] = 'proj-999';

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    await expect(syncShipCheck('sc-123')).resolves.toBeUndefined();

    expect(updateShipCheckSyncState).toHaveBeenCalledWith('sc-123', {
      syncState: 'SYNC_FAILED',
      lastSyncError: 'Connection refused',
    });
  });

  it('4. Backend URL configured, fetch resolves non-2xx -> syncState ends SYNC_FAILED', async () => {
    localStorageMock[BACKEND_URL_KEY] = 'http://localhost:8080';
    localStorageMock[PROJECT_ID_KEY] = 'proj-999';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'internal error' }),
    });

    await syncShipCheck('sc-123');

    expect(updateShipCheckSyncState).toHaveBeenCalledWith('sc-123', {
      syncState: 'SYNC_FAILED',
      lastSyncError: 'Backend returned HTTP 500',
    });
  });

  it('5. A fetch that never resolves -> syncShipCheck times out and ends SYNC_FAILED with timeout message', async () => {
    vi.useFakeTimers();

    localStorageMock[BACKEND_URL_KEY] = 'http://localhost:8080';
    localStorageMock[PROJECT_ID_KEY] = 'proj-999';

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    const syncPromise = syncShipCheck('sc-123');

    // Advance timers past 10s
    await vi.advanceTimersByTimeAsync(10000);

    await expect(syncPromise).resolves.toBeUndefined();

    expect(updateShipCheckSyncState).toHaveBeenCalledWith('sc-123', {
      syncState: 'SYNC_FAILED',
      lastSyncError: 'Sync request timed out after 10s',
    });

    vi.useRealTimers();
  });
});
