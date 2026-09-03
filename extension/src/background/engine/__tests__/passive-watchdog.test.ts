import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PassiveCheckRun } from '../../../domain/passive-check';
import { checkRunWatchdog } from '../run-coordinator';
import { getCurrentPassiveRun, checkpointPassiveRun, getCurrentRun } from '../../state';

vi.mock('../../state', () => ({
  checkpoint: vi.fn().mockResolvedValue(undefined),
  getCurrentRun: vi.fn().mockReturnValue(null),
  checkpointPassiveRun: vi.fn().mockResolvedValue(undefined),
  getCurrentPassiveRun: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../storage/repository', () => ({
  saveRun: vi.fn().mockResolvedValue(undefined),
  saveEvent: vi.fn().mockResolvedValue(undefined),
  saveRecovery: vi.fn().mockResolvedValue(undefined),
  saveFinding: vi.fn().mockResolvedValue(undefined),
  saveAllEvidence: vi.fn().mockResolvedValue(undefined),
  applyRetention: vi.fn().mockResolvedValue([]),
}));

describe('Passive Check Watchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentRun).mockReturnValue(null);
  });

  it('forces stale passive run to FAILED and clears checkpoint', async () => {
    const stalePassiveRun: PassiveCheckRun = {
      runId: 'stale-passive-1',
      target: { tabId: 101, origin: 'https://example.com', url: 'https://example.com', frameId: 0 },
      definition: {
        id: 'p-1',
        kind: 'runtime_errors',
        name: 'Runtime errors',
        description: 'Test',
        params: { observeMs: 5000 },
      },
      state: 'RUNNING',
      createdAt: Date.now() - 40_000,
      updatedAt: Date.now() - 35_000, // 35s ago (> 30s threshold)
    };

    vi.mocked(getCurrentPassiveRun).mockReturnValue(stalePassiveRun);

    await checkRunWatchdog();

    expect(checkpointPassiveRun).toHaveBeenCalledWith(null);
  });

  it('does nothing for a fresh, recently updated passive run', async () => {
    const activePassiveRun: PassiveCheckRun = {
      runId: 'active-passive-1',
      target: { tabId: 101, origin: 'https://example.com', url: 'https://example.com', frameId: 0 },
      definition: {
        id: 'p-1',
        kind: 'runtime_errors',
        name: 'Runtime errors',
        description: 'Test',
        params: { observeMs: 5000 },
      },
      state: 'RUNNING',
      createdAt: Date.now() - 2_000,
      updatedAt: Date.now() - 1_000,
    };

    vi.mocked(getCurrentPassiveRun).mockReturnValue(activePassiveRun);

    await checkRunWatchdog();

    expect(checkpointPassiveRun).not.toHaveBeenCalled();
  });

  it('ignores passive runs in terminal states', async () => {
    const terminalPassiveRun: PassiveCheckRun = {
      runId: 'terminal-passive-1',
      target: { tabId: 101, origin: 'https://example.com', url: 'https://example.com', frameId: 0 },
      definition: {
        id: 'p-1',
        kind: 'runtime_errors',
        name: 'Runtime errors',
        description: 'Test',
        params: { observeMs: 5000 },
      },
      state: 'COMPLETED',
      createdAt: Date.now() - 50_000,
      updatedAt: Date.now() - 50_000,
    };

    vi.mocked(getCurrentPassiveRun).mockReturnValue(terminalPassiveRun);

    await checkRunWatchdog();

    expect(checkpointPassiveRun).not.toHaveBeenCalled();
  });
});
