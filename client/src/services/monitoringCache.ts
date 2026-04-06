import { LiveMonitoringData } from '@shared/types/monitoring.types';

export interface CacheSummaryEntry {
  dateKey: string;
  cachedAt: number;
  pointCount: number;
}

interface CachedDayRecord {
  cacheKey: string;
  gcpName: string;
  dateKey: string;
  data: LiveMonitoringData;
  cachedAt: number;
  pointCount: number;
}

const DB_NAME = 'smartpulse-monitoring-cache';
const DB_VERSION = 2;
const STORE_NAME = 'monitoring-days';

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
        store.createIndex('gcpName', 'gcpName', { unique: false });
      } else {
        // Upgrade from v1: delete old store and recreate (cache is ephemeral)
        db.deleteObjectStore(STORE_NAME);
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
        store.createIndex('gcpName', 'gcpName', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function buildKey(gcpName: string, dateKey: string, groupId?: string | number): string {
  const prefix = groupId ? `${groupId}:` : '';
  return `${prefix}${gcpName}:${dateKey}`;
}

function countPoints(data: LiveMonitoringData): number {
  return (
    data.powerComponents.reduce((acc, pc) => acc + pc.data.length, 0) +
    data.batterySoc.length +
    data.batteryActivePower.length +
    (data.netPower?.length ?? 0)
  );
}

async function getCachedDay(
  gcpName: string,
  dateKey: string,
  groupId?: string | number,
): Promise<LiveMonitoringData | null> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(buildKey(gcpName, dateKey, groupId));
      req.onsuccess = () => {
        const record = req.result as CachedDayRecord | undefined;
        resolve(record?.data ?? null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function putCachedDay(
  gcpName: string,
  dateKey: string,
  data: LiveMonitoringData,
  groupId?: string | number,
): Promise<void> {
  try {
    const db = await getDb();
    const record: CachedDayRecord = {
      cacheKey: buildKey(gcpName, dateKey, groupId),
      gcpName,
      dateKey,
      data,
      cachedAt: Date.now(),
      pointCount: countPoints(data),
    };
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch {
    // Cache write failure is non-critical
  }
}

async function listCachedDays(gcpName: string): Promise<CacheSummaryEntry[]> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('gcpName');
      const range = IDBKeyRange.only(gcpName);
      const entries: CacheSummaryEntry[] = [];

      const req = index.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const rec = cursor.value as CachedDayRecord;
          entries.push({
            dateKey: rec.dateKey,
            cachedAt: rec.cachedAt,
            pointCount: rec.pointCount,
          });
          cursor.continue();
        } else {
          entries.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
          resolve(entries);
        }
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

async function clearCachedDaysForGcp(gcpName: string): Promise<number> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('gcpName');
      const range = IDBKeyRange.only(gcpName);
      let count = 0;

      const req = index.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          count++;
          cursor.continue();
        } else {
          resolve(count);
        }
      };
      req.onerror = () => resolve(count);
    });
  } catch {
    return 0;
  }
}

async function clearAllCachedDays(): Promise<void> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch {
    // Non-critical
  }
}

export const monitoringCache = {
  getCachedDay,
  putCachedDay,
  listCachedDays,
  clearCachedDaysForGcp,
  clearAllCachedDays,
};
