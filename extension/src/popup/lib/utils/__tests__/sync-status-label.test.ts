import { describe, it, expect } from 'vitest';
import type { SyncState } from '../../../../domain/ship-check';
import { syncStatusLabel, type SyncStatusTone } from '../sync-status-label';

describe('syncStatusLabel', () => {
  const cases: Array<[SyncState | undefined, { text: string; tone: SyncStatusTone }]> = [
    [undefined, { text: 'Local only', tone: 'muted' }],
    ['NOT_SYNCED', { text: 'Local only', tone: 'muted' }],
    ['SYNCING', { text: 'Syncing…', tone: 'progress' }],
    ['SYNCED', { text: 'Synced', tone: 'success' }],
    ['SYNC_FAILED', { text: 'Sync failed', tone: 'warning' }],
  ];

  it.each(cases)('maps %s to %o', (state, expected) => {
    expect(syncStatusLabel(state)).toEqual(expected);
  });
});
