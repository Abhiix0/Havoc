const DB_NAME = 'havoc';
const DB_VERSION = 1;

export const STORES = {
  runs: 'runs',
  events: 'events',
  signals: 'signals',
  findings: 'findings',
  evidence: 'evidence',
  recovery: 'recovery',
} as const;

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORES.runs)) {
        db.createObjectStore(STORES.runs, { keyPath: 'runId' });
      }

      if (!db.objectStoreNames.contains(STORES.events)) {
        const events = db.createObjectStore(STORES.events, { keyPath: 'id' });
        events.createIndex('runId', 'runId');
        events.createIndex('sequence', 'sequence');
        events.createIndex('timestamp', 'timestamp');
        events.createIndex('type', 'type');
        events.createIndex('correlationId', 'correlationId');
      }

      if (!db.objectStoreNames.contains(STORES.signals)) {
        db.createObjectStore(STORES.signals, { keyPath: 'id' }).createIndex('runId', 'runId');
      }

      if (!db.objectStoreNames.contains(STORES.findings)) {
        db.createObjectStore(STORES.findings, { keyPath: 'id' }).createIndex('runId', 'runId');
      }

      if (!db.objectStoreNames.contains(STORES.evidence)) {
        db.createObjectStore(STORES.evidence, { keyPath: 'id' }).createIndex('runId', 'runId');
      }

      if (!db.objectStoreNames.contains(STORES.recovery)) {
        db.createObjectStore(STORES.recovery, { keyPath: 'id' }).createIndex('runId', 'runId');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}