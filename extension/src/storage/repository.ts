/**
 * repository.ts — typed storage operations for HAVOC IndexedDB stores.
 *
 * Object Stores:
 *  - runs       (keyPath: 'runId')
 *  - events     (keyPath: 'id', index: 'runId')
 *  - signals    (keyPath: 'id', index: 'runId')
 *  - findings   (keyPath: 'id', index: 'runId')
 *  - evidence   (keyPath: 'id', index: 'runId')
 *  - recovery   (keyPath: 'id', index: 'runId')
 *
 * Retention:
 *  - Retains the most recent 25 runs (sorted by createdAt).
 *  - Evicting a run cascade-deletes all associated child records across
 *    all stores in a single atomic transaction — leaving no orphaned records.
 */

import { openDatabase, STORES } from './database';
import type { ExperimentRun } from '../domain/run';
import type { HavocEvent } from '../domain/event';
import type { Signal } from '../domain/signal';
import type { Finding } from '../domain/finding';
import type { Evidence } from '../domain/evidence';
import type { Recovery } from '../domain/recovery';
import type { Remediation } from '../domain/remediation';
import type { ShipCheckRun } from '../domain/ship-check';

export const MAX_RUNS_RETENTION = 25;

// ---------------------------------------------------------------------------
// Generic Transaction Helpers
// ---------------------------------------------------------------------------

function putItem<T>(storeName: string, item: T): Promise<void> {
  return openDatabase().then((db) => {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

function putItems<T>(storeName: string, items: T[]): Promise<void> {
  if (items.length === 0) return Promise.resolve();
  return openDatabase().then((db) => {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const item of items) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

function getItem<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return openDatabase().then((db) => {
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  });
}

function getAllItems<T>(storeName: string): Promise<T[]> {
  return openDatabase().then((db) => {
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  });
}

function getByIndex<T>(storeName: string, indexName: string, value: IDBValidKey): Promise<T[]> {
  return openDatabase().then((db) => {
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const req = index.getAll(IDBKeyRange.only(value));
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  });
}

// ---------------------------------------------------------------------------
// Runs Store Operations
// ---------------------------------------------------------------------------

export async function saveRun(run: ExperimentRun): Promise<void> {
  return putItem(STORES.runs, run);
}

export async function getRun(runId: string): Promise<ExperimentRun | undefined> {
  return getItem<ExperimentRun>(STORES.runs, runId);
}

export async function getAllRuns(): Promise<ExperimentRun[]> {
  return getAllItems<ExperimentRun>(STORES.runs);
}

// ---------------------------------------------------------------------------
// Events Store Operations
// ---------------------------------------------------------------------------

export async function saveEvent(event: HavocEvent): Promise<void> {
  return putItem(STORES.events, event);
}

export async function saveEvents(events: HavocEvent[]): Promise<void> {
  return putItems(STORES.events, events);
}

export async function getEventsByRunId(runId: string): Promise<HavocEvent[]> {
  const events = await getByIndex<HavocEvent>(STORES.events, 'runId', runId);
  return events.sort((a, b) => a.sequence - b.sequence);
}

// ---------------------------------------------------------------------------
// Signals Store Operations
// ---------------------------------------------------------------------------

export async function saveSignal(signal: Signal): Promise<void> {
  return putItem(STORES.signals, signal);
}

export async function saveSignals(signals: Signal[]): Promise<void> {
  return putItems(STORES.signals, signals);
}

export async function getSignalsByRunId(runId: string): Promise<Signal[]> {
  const signals = await getByIndex<Signal>(STORES.signals, 'runId', runId);
  return signals.sort((a, b) => a.timestamp - b.timestamp);
}

// ---------------------------------------------------------------------------
// Findings Store Operations
// ---------------------------------------------------------------------------

export async function saveFinding(finding: Finding): Promise<void> {
  return putItem(STORES.findings, finding);
}

export async function getFindingsByRunId(runId: string): Promise<Finding[]> {
  return getByIndex<Finding>(STORES.findings, 'runId', runId);
}

// ---------------------------------------------------------------------------
// Evidence Store Operations
// ---------------------------------------------------------------------------

export async function saveEvidence(evidence: Evidence): Promise<void> {
  return putItem(STORES.evidence, evidence);
}

export async function saveAllEvidence(evidenceList: Evidence[]): Promise<void> {
  return putItems(STORES.evidence, evidenceList);
}

export async function getEvidenceByRunId(runId: string): Promise<Evidence[]> {
  const evidenceList = await getByIndex<Evidence>(STORES.evidence, 'runId', runId);
  return evidenceList.sort((a, b) => a.capturedAt - b.capturedAt);
}

// ---------------------------------------------------------------------------
// Recovery Store Operations
// ---------------------------------------------------------------------------

export async function saveRecovery(recovery: Recovery): Promise<void> {
  return putItem(STORES.recovery, recovery);
}

export async function getRecoveriesByRunId(runId: string): Promise<Recovery[]> {
  return getByIndex<Recovery>(STORES.recovery, 'runId', runId);
}

export async function getRecoveryByRunId(runId: string): Promise<Recovery | undefined> {
  const recoveries = await getRecoveriesByRunId(runId);
  return recoveries[0];
}

// ---------------------------------------------------------------------------
// Remediation Store Operations
// ---------------------------------------------------------------------------

export async function saveRemediation(remediation: Remediation): Promise<void> {
  return putItem(STORES.remediations, remediation);
}

export async function getRemediationsByFindingId(findingId: string): Promise<Remediation[]> {
  return getByIndex<Remediation>(STORES.remediations, 'findingId', findingId);
}

export async function getRemediationsByRunId(runId: string): Promise<Remediation[]> {
  return getByIndex<Remediation>(STORES.remediations, 'runId', runId);
}

// ---------------------------------------------------------------------------
// Ship Check Store Operations
// ---------------------------------------------------------------------------

export async function saveShipCheck(shipCheck: ShipCheckRun): Promise<void> {
  return putItem(STORES.shipChecks, shipCheck);
}

export async function getShipCheck(shipCheckId: string): Promise<ShipCheckRun | undefined> {
  return getItem<ShipCheckRun>(STORES.shipChecks, shipCheckId);
}

export async function getAllShipChecks(): Promise<ShipCheckRun[]> {
  return getAllItems<ShipCheckRun>(STORES.shipChecks);
}

// ---------------------------------------------------------------------------
// Cascade Deletion & Retention
// ---------------------------------------------------------------------------

/**
 * Cascade-delete a run and ALL associated records across events, signals,
 * findings, evidence, recovery, and remediations in a single atomic transaction.
 * Guarantees zero orphaned records.
 */
export async function deleteRunCascade(runId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [
        STORES.runs,
        STORES.events,
        STORES.signals,
        STORES.findings,
        STORES.evidence,
        STORES.recovery,
        STORES.remediations,
      ],
      'readwrite'
    );

    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();

    // 1. Delete run record
    const runsStore = tx.objectStore(STORES.runs);
    runsStore.delete(runId);

    // 2. Cascade delete from all child stores using their runId index
    const childStores = [
      STORES.events,
      STORES.signals,
      STORES.findings,
      STORES.evidence,
      STORES.recovery,
      STORES.remediations,
    ] as const;

    for (const storeName of childStores) {
      const store = tx.objectStore(storeName);
      const index = store.index('runId');
      const keyReq = index.getAllKeys(IDBKeyRange.only(runId));
      keyReq.onsuccess = () => {
        const keys = keyReq.result;
        for (const key of keys) {
          store.delete(key);
        }
      };
    }
  });
}

/**
 * Retain only the most recent `maxRuns` (default 25) runs.
 * Evicts older runs and cascade-deletes all associated child records.
 * Returns the list of evicted run IDs.
 */
export async function applyRetention(maxRuns: number = MAX_RUNS_RETENTION): Promise<string[]> {
  const runs = await getAllRuns();
  if (runs.length <= maxRuns) {
    return [];
  }

  // Sort runs oldest first by createdAt
  runs.sort((a, b) => a.createdAt - b.createdAt);

  const evictCount = runs.length - maxRuns;
  const toEvict = runs.slice(0, evictCount);
  const evictedIds: string[] = [];

  for (const run of toEvict) {
    await deleteRunCascade(run.runId);
    evictedIds.push(run.runId);
    console.log(`[HAVOC][retention] evicted run ${run.runId} (state=${run.state})`);
  }

  return evictedIds;
}

/**
 * Retain only the most recent `maxShipChecks` (default 25) Ship Checks.
 * Evicts older Ship Checks, cascade-deletes each step's run records,
 * and deletes the ShipCheckRun record from the shipChecks store.
 * Returns the list of evicted Ship Check IDs.
 */
export async function applyShipCheckRetention(
  maxShipChecks: number = MAX_RUNS_RETENTION
): Promise<string[]> {
  const shipChecks = await getAllShipChecks();
  if (shipChecks.length <= maxShipChecks) {
    return [];
  }

  // Sort ship checks oldest first by createdAt
  shipChecks.sort((a, b) => a.createdAt - b.createdAt);

  const evictCount = shipChecks.length - maxShipChecks;
  const toEvict = shipChecks.slice(0, evictCount);
  const evictedIds: string[] = [];

  const db = await openDatabase();

  for (const sc of toEvict) {
    // 1. Cascade delete all underlying steps' run data
    for (const step of sc.steps) {
      if (step.runId) {
        await deleteRunCascade(step.runId);
      }
    }

    // 2. Delete the ShipCheckRun record itself
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORES.shipChecks], 'readwrite');
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
      tx.objectStore(STORES.shipChecks).delete(sc.shipCheckId);
    });

    evictedIds.push(sc.shipCheckId);
    console.log(`[HAVOC][retention] evicted ship check ${sc.shipCheckId}`);
  }

  return evictedIds;
}
