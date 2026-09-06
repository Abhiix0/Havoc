import {
  getShipCheck,
  getFindingsByRunId,
  getRemediationsByFindingId,
  getEvidenceByRunId,
  updateShipCheckSyncState,
} from '../../storage/repository';
import type { Finding } from '../../domain/finding';
import type { Remediation } from '../../domain/remediation';
import type { Evidence } from '../../domain/evidence';
import { buildSyncPayload } from '../../domain/sync-payload';

export const BACKEND_URL_KEY = 'havoc_backend_url';
export const PROJECT_ID_KEY = 'havoc_project_id';
export const DEFAULT_PROJECT_NAME = 'Default Project';
export const SYNC_TIMEOUT_MS = 10000;

async function getStorageItem<T>(key: string): Promise<T | undefined> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return undefined;
  }
  const res = await chrome.storage.local.get(key);
  return res[key] as T | undefined;
}

async function setStorageItem<T>(key: string, value: T): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  await chrome.storage.local.set({ [key]: value });
}

async function getOrCreateProjectId(backendUrl: string, signal: AbortSignal): Promise<string> {
  const cached = await getStorageItem<string>(PROJECT_ID_KEY);
  if (cached && typeof cached === 'string' && cached.trim().length > 0) {
    return cached.trim();
  }

  const res = await fetch(`${backendUrl}/api/v1/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DEFAULT_PROJECT_NAME }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Failed to create default project (HTTP ${res.status})`);
  }

  const data = (await res.json()) as { id?: string };
  if (!data.id) {
    throw new Error('Project creation response missing id');
  }

  await setStorageItem(PROJECT_ID_KEY, data.id);
  return data.id;
}

export async function syncShipCheck(shipCheckId: string): Promise<void> {
  try {
    const backendUrl = await getStorageItem<string>(BACKEND_URL_KEY);
    if (!backendUrl || typeof backendUrl !== 'string' || backendUrl.trim().length === 0) {
      // No backend configured -> no-op
      return;
    }

    const sanitizedUrl = backendUrl.trim().replace(/\/+$/, '');

    await updateShipCheckSyncState(shipCheckId, { syncState: 'SYNCING' });

    const shipCheck = await getShipCheck(shipCheckId);
    if (!shipCheck) {
      await updateShipCheckSyncState(shipCheckId, {
        syncState: 'SYNC_FAILED',
        lastSyncError: 'Ship check record not found locally',
      });
      return;
    }

    const allFindings: Finding[] = [];
    for (const step of shipCheck.steps) {
      if (step.runId) {
        const stepFindings = await getFindingsByRunId(step.runId);
        allFindings.push(...stepFindings);
      }
    }

    const allRemediations: Remediation[] = [];
    const evidenceByFindingId = new Map<string, Evidence[]>();

    for (const finding of allFindings) {
      const rems = await getRemediationsByFindingId(finding.id);
      allRemediations.push(...rems);

      const stepEvidence = await getEvidenceByRunId(finding.runId);
      const evMap = new Map(stepEvidence.map((e) => [e.id, e]));
      const findingEvidence = finding.evidenceIds
        .map((id) => evMap.get(id))
        .filter((e): e is Evidence => e !== undefined);
      evidenceByFindingId.set(finding.id, findingEvidence);
    }

    const payload = buildSyncPayload(
      shipCheck,
      allFindings,
      allRemediations,
      evidenceByFindingId
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

    try {
      const projectId = await getOrCreateProjectId(sanitizedUrl, controller.signal);

      const syncRes = await fetch(
        `${sanitizedUrl}/api/v1/projects/${projectId}/ship-checks`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!syncRes.ok) {
        const errMsg = `Backend returned HTTP ${syncRes.status}`;
        await updateShipCheckSyncState(shipCheckId, {
          syncState: 'SYNC_FAILED',
          lastSyncError: errMsg.slice(0, 200),
        });
        return;
      }

      await updateShipCheckSyncState(shipCheckId, {
        syncState: 'SYNCED',
        syncedAt: Date.now(),
      });
    } catch (fetchErr: unknown) {
      clearTimeout(timeoutId);
      let message = 'Sync failed';
      if (fetchErr instanceof Error) {
        if (fetchErr.name === 'AbortError') {
          message = 'Sync request timed out after 10s';
        } else {
          message = fetchErr.message || 'Network request failed';
        }
      }
      await updateShipCheckSyncState(shipCheckId, {
        syncState: 'SYNC_FAILED',
        lastSyncError: message.slice(0, 200),
      });
    }
  } catch (err: unknown) {
    // Catch-all: Never throw out of syncShipCheck
    const msg = err instanceof Error ? err.message : String(err);
    await updateShipCheckSyncState(shipCheckId, {
      syncState: 'SYNC_FAILED',
      lastSyncError: msg.slice(0, 200),
    }).catch(() => {});
  }
}
