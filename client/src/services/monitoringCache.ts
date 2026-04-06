import { LiveMonitoringData } from '@shared/types/monitoring.types';

export interface CacheSummaryEntry {
  dateKey: string;
  cachedAt: number;
  pointCount: number;
}

interface CachedDayRecord {
  cacheKey: string;
  uevcbName: string;
  dateKey: string;
  data: LiveMonitoringData;
  cachedAt: number;
  pointCount: number;
}

const DB_NAME = 'smartpulse-monitoring-cache';
const DB_VERSION = 1;
const STORE_NAME = 'monitoring-days';

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
        store.createIndex('uevcbName', 'uevcbName', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function buildKey(uevcbName: string, dateKey: string, groupId?: string | number): string {
  const prefix = groupId ? `${groupId}:` : '';
  return `${prefix}${uevcbName}:${dateKey}`;
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
  uevcbName: string,
  dateKey: string,
  groupId?: string | number,
): Promise<LiveMonitoringData | null> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(buildKey(uevcbName, dateKey, groupId));
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
  uevcbName: string,
  dateKey: string,
  data: LiveMonitoringData,
  groupId?: string | number,
): Promise<void> {
  try {
    const db = await getDb();
    const record: CachedDayRecord = {
      cacheKey: buildKey(uevcbName, dateKey, groupId),
      uevcbName,
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

async function listCachedDays(uevcbName: string): Promise<CacheSummaryEntry[]> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('uevcbName');
      const range = IDBKeyRange.only(uevcbName);
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

async function clearCachedDaysForUevcb(uevcbName: string): Promise<number> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('uevcbName');
      const range = IDBKeyRange.only(uevcbName);
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
  clearCachedDaysForUevcb,
  clearAllCachedDays,
};
