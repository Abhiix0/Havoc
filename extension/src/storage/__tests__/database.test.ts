import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDatabase, closeDatabase, getDatabaseError } from '../database';

function createFailingOpenRequest(errorMessage: string) {
  const req: Record<string, unknown> = {
    error: new DOMException(errorMessage, 'AbortError'),
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
  };
  return req as unknown as IDBOpenDBRequest;
}

describe('Database open and error tracking', () => {
  beforeEach(() => {
    closeDatabase();
    vi.restoreAllMocks();
  });

  it('openDatabase() opens successfully and getDatabaseError() is null', async () => {
    const db = await openDatabase();
    expect(db).toBeDefined();
    expect(getDatabaseError()).toBeNull();
  });

  it('openDatabase() rejecting records non-null Error in getDatabaseError()', async () => {
    closeDatabase();
    const fakeReq = createFailingOpenRequest('Simulated IndexedDB failure');
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      queueMicrotask(() => {
        if (typeof fakeReq.onerror === 'function') {
          fakeReq.onerror(new Event('error'));
        }
      });
      return fakeReq;
    });

    await expect(openDatabase()).rejects.toThrow('Simulated IndexedDB failure');
    const dbErr = getDatabaseError();
    expect(dbErr).toBeInstanceOf(Error);
    expect(dbErr?.message).toContain('Simulated IndexedDB failure');
  });

  it('subsequent successful openDatabase() clears getDatabaseError() back to null', async () => {
    closeDatabase();
    const fakeReq = createFailingOpenRequest('Simulated failure 1');
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      queueMicrotask(() => {
        if (typeof fakeReq.onerror === 'function') {
          fakeReq.onerror(new Event('error'));
        }
      });
      return fakeReq;
    });

    await expect(openDatabase()).rejects.toThrow('Simulated failure 1');
    expect(getDatabaseError()).not.toBeNull();

    // Restore normal indexedDB.open behavior and open again
    openSpy.mockRestore();
    closeDatabase();

    const db = await openDatabase();
    expect(db).toBeDefined();
    expect(getDatabaseError()).toBeNull();
  });
});
