import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResourceRegistry } from '../resource-registry';

describe('ResourceRegistry', () => {
  let registry: ResourceRegistry;

  beforeEach(() => {
    registry = new ResourceRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cleans up resources in LIFO order (last registered, first cleaned)', async () => {
    const cleanedOrder: string[] = [];

    registry.register({
      id: 'A',
      scope: 'run-lifetime',
      cleanup: () => {
        cleanedOrder.push('A');
      },
    });

    registry.register({
      id: 'B',
      scope: 'run-lifetime',
      cleanup: () => {
        cleanedOrder.push('B');
      },
    });

    registry.register({
      id: 'C',
      scope: 'run-lifetime',
      cleanup: () => {
        cleanedOrder.push('C');
      },
    });

    expect(registry.size).toBe(3);

    const result = await registry.cleanupAll();

    expect(cleanedOrder).toEqual(['C', 'B', 'A']);
    expect(result.succeeded).toEqual(['C', 'B', 'A']);
    expect(result.failed).toEqual([]);
    expect(registry.size).toBe(0);
  });

  it('isolates failures: a failing resource does not stop other cleanups', async () => {
    registry.register({
      id: 'A',
      scope: 'run-lifetime',
      cleanup: () => {},
    });

    registry.register({
      id: 'B',
      scope: 'run-lifetime',
      cleanup: () => {
        throw new Error('Explosion during B cleanup');
      },
    });

    registry.register({
      id: 'C',
      scope: 'run-lifetime',
      cleanup: () => {},
    });

    const result = await registry.cleanupAll();

    expect(result.succeeded).toEqual(['C', 'A']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toEqual({
      id: 'B',
      error: 'Explosion during B cleanup',
    });
    expect(registry.size).toBe(0);
  });

  it('times out hanging cleanups after 5000ms and reports them in failed', async () => {
    vi.useFakeTimers();

    registry.register({
      id: 'hanging',
      scope: 'run-lifetime',
      cleanup: () => new Promise<void>(() => {}), // never resolves
    });

    const cleanupPromise = registry.cleanupAll();

    // Fast-forward past the 5000ms timeout
    await vi.advanceTimersByTimeAsync(5001);

    const result = await cleanupPromise;

    expect(result.succeeded).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.id).toBe('hanging');
    expect(result.failed[0]?.error).toBe('cleanup timed out');
    expect(registry.size).toBe(0);
  });

  it('cleanupScope cleans only resources matching the given scope', async () => {
    registry.register({
      id: 'res-run-1',
      scope: 'run-lifetime',
      cleanup: vi.fn(),
    });

    registry.register({
      id: 'res-tab-1',
      scope: 'tab-lifetime',
      cleanup: vi.fn(),
    });

    registry.register({
      id: 'res-tab-2',
      scope: 'tab-lifetime',
      cleanup: vi.fn(),
    });

    registry.register({
      id: 'res-exp-1',
      scope: 'experiment-lifetime',
      cleanup: vi.fn(),
    });

    expect(registry.size).toBe(4);

    const result = await registry.cleanupScope('tab-lifetime');

    expect(result.succeeded).toEqual(['res-tab-2', 'res-tab-1']);
    expect(result.failed).toEqual([]);
    expect(registry.size).toBe(2);
  });
});
