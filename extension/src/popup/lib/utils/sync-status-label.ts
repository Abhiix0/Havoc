import type { SyncState } from '../../../domain/ship-check';

export type SyncStatusTone = 'muted' | 'progress' | 'success' | 'warning';

export interface SyncStatusDisplay {
  text: string;
  tone: SyncStatusTone;
}

export function syncStatusLabel(state: SyncState | undefined): SyncStatusDisplay {
  switch (state) {
    case 'SYNCING':
      return { text: 'Syncing…', tone: 'progress' };
    case 'SYNCED':
      return { text: 'Synced', tone: 'success' };
    case 'SYNC_FAILED':
      return { text: 'Sync failed', tone: 'warning' };
    default:
      return { text: 'Local only', tone: 'muted' };
  }
}
