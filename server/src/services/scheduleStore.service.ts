import path from 'path';
import fs from 'fs/promises';
import { ScheduleRow, ScheduleSlotRevision, ScheduleRevisionStore } from '@smartpulse-intl/shared';
import { computeRowHash, computeCsvHash } from '../utils/scheduleParser';

interface ScheduleDbSchema {
  schedules: Record<string, ScheduleRevisionStore>;
}

const DEFAULT_DATA: ScheduleDbSchema = { schedules: {} };

export class ScheduleStoreService {
  private db: any = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    const dbPath = path.resolve(__dirname, '../../data/schedules.json');
    const dbDir = path.dirname(dbPath);
    await fs.mkdir(dbDir, { recursive: true });

    const { Low } = await import('lowdb');
    const { JSONFile } = await import('lowdb/node');

    const adapter = new JSONFile<ScheduleDbSchema>(dbPath);
    this.db = new Low<ScheduleDbSchema>(adapter, DEFAULT_DATA);

    await this.db.read();
    if (!this.db.data) {
      this.db.data = DEFAULT_DATA;
      await this.db.write();
    }

    console.log(`[ScheduleStore] LowDB initialized at ${dbPath}`);
  }

  private getDb() {
    if (!this.db) {
      throw new Error('ScheduleStoreService not initialized. Call init() first.');
    }
    return this.db;
  }

  /**
   * Bulk sync schedule from FTP Native File Metadata (Current + Consumed modes)
   * This is entirely idempotent and traces history using Portal's true modification metrics.
   */
  async syncScheduleFromFtp(
    plantId: number,
    dateKey: string,
    ftpService: any,
    cookies: string[],
    env: string,
    scheduleBaseName?: string
  ): Promise<{ hasChanges: boolean; rows: ScheduleRow[]; header: string[] }> {
    const db = this.getDb();
    await db.read();

    const baseName = scheduleBaseName || `Battery_Schedule_${plantId}`;

    // Fetch active schedule via direct file read (root directory bug workaround)
    const currentTask = ftpService.getFileWithMeta(cookies, env, 'outgoing', `${baseName}.csv`)
      .then((res: any) => res && res.FileData ? [res] : [])
      .catch(() => []);

    // Fetch historical backups via GetFiles
    const consumedTask = ftpService.listFiles(cookies, env, 'outgoing', 'Consumed', baseName, true);

    const [currentFiles, consumedFiles] = await Promise.all([currentTask, consumedTask]);

    // Combine and sort by true modification date ascending
    const allFiles = [...(currentFiles || []), ...(consumedFiles || [])]
      .filter((f: any) => f && f.FileData && f.ModifyDate)
      .sort((a: any, b: any) => new Date(a.ModifyDate).getTime() - new Date(b.ModifyDate).getTime());

    const { parseScheduleCsv, computeRowHash } = require('../utils/scheduleParser');

    const storeKey = `${plantId}:${dateKey}`;
    const previousStore = db.data.schedules[storeKey] as ScheduleRevisionStore | undefined;

    // Start from existing store to preserve ALL previous revisions (ftp + user_save)
    const slots: Record<string, ScheduleSlotRevision[]> = {};
    if (previousStore?.slots) {
      for (const key of Object.keys(previousStore.slots)) {
        const revs = previousStore.slots[key];
        slots[key] = Array.isArray(revs) ? [...revs] : [revs as any];
      }
    }

    let latestHeader: string[] = [];

    if (allFiles.length === 0) {
      return { hasChanges: false, rows: [], header: [] };
    }

    // Add FTP file revisions (only if they don't already exist)
    for (const file of allFiles) {
      try {
        const parsed = parseScheduleCsv(file.FileData);
        if (parsed.header.length > 0) {
          latestHeader = parsed.header;
        }

        const modifyTimeMs = new Date(file.ModifyDate).getTime();

        for (const row of parsed.rows) {
          const slotKey = row.Delivery_Start;
          const rowHash = computeRowHash(row);

          if (!slots[slotKey]) {
            slots[slotKey] = [];
          }

          // Check if this exact revision (same hash + same timestamp) already exists
          const alreadyExists = slots[slotKey].some(
            r => r.contentHash === rowHash && Math.abs(r.fetchedAt - modifyTimeMs) < 1000
          );

          if (!alreadyExists) {
            const existingVersions = slots[slotKey];
            const latestVersion = existingVersions[existingVersions.length - 1];

            if (!latestVersion || latestVersion.contentHash !== rowHash) {
              slots[slotKey].push({
                deliveryStart: slotKey,
                row: { ...row },
                fetchedAt: modifyTimeMs,
                contentHash: rowHash,
                source: 'ftp',
              });
            }
          }
        }
      } catch (err) {
        console.warn(`[ScheduleStore] skipping unparseable FTP file ${file.FileName}`, err);
      }
    }

    // Sort all slot revisions by fetchedAt
    for (const key of Object.keys(slots)) {
      slots[key].sort((a, b) => a.fetchedAt - b.fetchedAt);
    }

    let hasChanges = true;

    db.data.schedules[storeKey] = {
      gcpId: plantId,
      dateKey,
      slots,
      lastFetchedAt: Date.now(),
      lastCsvHash: '', // irrelevant now
    };
    await db.write();

    // Extract current active snapshot for the requested dateKey
    const targetDatePrefix = dateKey;
    const currentRows = Object.values(slots)
      .map(versions => versions[versions.length - 1].row)
      .filter(row => row.Delivery_Start.startsWith(targetDatePrefix))
      .sort((a, b) => a.Delivery_Start.localeCompare(b.Delivery_Start));

    return { hasChanges, rows: currentRows, header: latestHeader };
  }

  /**
   * Process a freshly fetched schedule CSV. (LEGACY fallback)
   * Compares with stored revisions and only updates changed slots.
   */
  async processSchedule(
    plantId: number,
    dateKey: string,
    rows: ScheduleRow[],
    csvContent: string
  ): Promise<{ hasChanges: boolean }> {
    const db = this.getDb();
    await db.read();

    const storeKey = `${plantId}:${dateKey}`;
    const csvHash = computeCsvHash(csvContent);
    const now = Date.now();

    const existing = db.data.schedules[storeKey] as ScheduleRevisionStore | undefined;

    // Quick check: if CSV hash is the same, no changes
    if (existing && existing.lastCsvHash === csvHash) {
      // Update fetch timestamp only
      existing.lastFetchedAt = now;
      await db.write();
      return { hasChanges: false };
    }

    // Row-level diff
    let hasChanges = false;
    const slots: Record<string, ScheduleSlotRevision[]> = existing?.slots ? { ...existing.slots } : {};

    // Backward compatibility for existing schemas. Convert legacy objects to arrays.
    for (const key of Object.keys(slots)) {
      if (!Array.isArray(slots[key])) {
        slots[key] = [slots[key] as any];
      }
    }

    for (const row of rows) {
      const slotKey = row.Delivery_Start;
      const rowHash = computeRowHash(row);
      const existingVersions = slots[slotKey] || [];
      const latestVersion = existingVersions[existingVersions.length - 1];

      if (!latestVersion || latestVersion.contentHash !== rowHash) {
        hasChanges = true;

        slots[slotKey] = [
          ...existingVersions,
          {
            deliveryStart: slotKey,
            row: { ...row },
            fetchedAt: now,
            contentHash: rowHash,
            source: 'ftp',
          }
        ];
      }
    }

    db.data.schedules[storeKey] = {
      gcpId: plantId,
      dateKey,
      slots,
      lastFetchedAt: now,
      lastCsvHash: csvHash,
    };
    await db.write();

    return { hasChanges };
  }

  /**
   * Get the current schedule (latest revision of each slot).
   */
  async getCurrentSchedule(plantId: number, dateKey: string): Promise<ScheduleRow[]> {
    const db = this.getDb();
    await db.read();

    const storeKey = `${plantId}:${dateKey}`;
    const store = db.data.schedules[storeKey] as ScheduleRevisionStore | undefined;

    if (!store?.slots) return [];

    return Object.values(store.slots)
      .map(versions => (Array.isArray(versions) ? versions[versions.length - 1] : versions).row)
      .sort((a, b) => a.Delivery_Start.localeCompare(b.Delivery_Start));
  }

  /**
   * Record a user save to LowDB with source: 'user_save'.
   * Called after FTP write succeeds.
   */
  async recordUserSave(plantId: number, rows: ScheduleRow[]): Promise<void> {
    const db = this.getDb();
    await db.read();

    const now = Date.now();

    // Group rows by dateKey (derived from Delivery_Start)
    const byDate = new Map<string, ScheduleRow[]>();
    for (const row of rows) {
      const dateKey = row.Delivery_Start.slice(0, 10);
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey)!.push(row);
    }

    for (const [dateKey, dateRows] of byDate) {
      const storeKey = `${plantId}:${dateKey}`;
      const existing = db.data.schedules[storeKey] as ScheduleRevisionStore | undefined;
      const slots: Record<string, ScheduleSlotRevision[]> = existing?.slots ? { ...existing.slots } : {};

      // Ensure arrays
      for (const key of Object.keys(slots)) {
        if (!Array.isArray(slots[key])) {
          slots[key] = [slots[key] as any];
        }
      }

      let savedCount = 0;
      for (const row of dateRows) {
        const slotKey = row.Delivery_Start;
        const rowHash = computeRowHash(row);
        const existingVersions = slots[slotKey] || [];
        const latestVersion = existingVersions[existingVersions.length - 1];

        if (!latestVersion || latestVersion.contentHash !== rowHash) {
          slots[slotKey] = [
            ...existingVersions,
            {
              deliveryStart: slotKey,
              row: { ...row },
              fetchedAt: now,
              contentHash: rowHash,
              source: 'user_save',
            },
          ];
          savedCount++;
        }
      }
      console.log(`[ScheduleStore] recordUserSave: plantId=${plantId} dateKey=${dateKey} — ${savedCount} new user_save revisions (${dateRows.length} rows total)`);

      db.data.schedules[storeKey] = {
        gcpId: plantId,
        dateKey,
        slots,
        lastFetchedAt: now,
        lastCsvHash: existing?.lastCsvHash ?? '',
      };
    }

    await db.write();
  }

  /**
   * Merge FTP-read rows with protected past slots from LowDB.
   * Handles TWO scenarios:
   *   1. Past slots ZEROED in FTP → restore last non-zero value from history
   *   2. Past slots REMOVED from FTP → add them back from history
   */
  async mergeWithProtectedPast(
    plantId: number,
    dateKey: string,
    ftpRows: ScheduleRow[]
  ): Promise<ScheduleRow[]> {
    const db = this.getDb();
    await db.read();

    const storeKey = `${plantId}:${dateKey}`;
    const store = db.data.schedules[storeKey] as ScheduleRevisionStore | undefined;

    if (!store?.slots) return ftpRows;

    const nowIso = new Date().toISOString();
    let protectedCount = 0;
    let restoredCount = 0;

    // Phase 1: Protect zeroed past slots in ftpRows
    const result = ftpRows.map(row => {
      // If this slot's Delivery_End is in the future, use FTP value as-is
      if (row.Delivery_End > nowIso) return row;

      // Past slot — check if FTP zeroed it but we have history
      const slotKey = row.Delivery_Start;
      const revisions = store.slots[slotKey];
      if (!revisions || !Array.isArray(revisions) || revisions.length === 0) return row;

      const ftpBap = Number(row.Battery_Active_Power_MW) || 0;

      // If FTP still has a non-zero value, trust it
      if (ftpBap !== 0) return row;

      // FTP returned 0 for a past slot — look for a better value in history
      // Prefer user_save, then any source
      const restored = this.findLastNonZeroBap(revisions);
      if (restored) {
        protectedCount++;
        console.log(`[ScheduleStore] PROTECTED past slot ${slotKey}: FTP=0 → restored ${restored.bap} MW (${restored.source})`);
        return { ...row, Battery_Active_Power_MW: restored.bap };
      }

      // All revisions are 0 — genuinely idle
      return row;
    });

    // Phase 2: Restore past slots that were REMOVED from FTP entirely
    const ftpSlotKeys = new Set(ftpRows.map(r => r.Delivery_Start));

    for (const [slotKey, revisions] of Object.entries(store.slots)) {
      if (ftpSlotKeys.has(slotKey)) continue; // already in FTP response
      if (!Array.isArray(revisions) || revisions.length === 0) continue;

      // Use the latest revision's row to check Delivery_End
      const latestRow = revisions[revisions.length - 1].row;
      if (latestRow.Delivery_End > nowIso) continue; // future/active — don't add

      // Find last non-zero value from history
      const restored = this.findLastNonZeroBap(revisions);
      if (restored) {
        restoredCount++;
        console.log(`[ScheduleStore] RESTORED removed slot ${slotKey}: ${restored.bap} MW (${restored.source})`);
        // Use the full row from the revision that had the non-zero value
        result.push({ ...restored.row, Battery_Active_Power_MW: restored.bap });
      }
    }

    // Sort by Delivery_Start to maintain order
    result.sort((a, b) => a.Delivery_Start.localeCompare(b.Delivery_Start));

    if (protectedCount > 0 || restoredCount > 0) {
      console.log(`[ScheduleStore] mergeWithProtectedPast: plantId=${plantId} dateKey=${dateKey} — ${protectedCount} zeroed slots protected, ${restoredCount} removed slots restored`);
    }

    return result;
  }

  /**
   * Find the last non-zero BAP value in a slot's revision history.
   * Prefers user_save source, falls back to any source.
   */
  private findLastNonZeroBap(revisions: ScheduleSlotRevision[]): { bap: number; source: string; row: ScheduleRow } | null {
    // First pass: prefer user_save
    for (let i = revisions.length - 1; i >= 0; i--) {
      const rev = revisions[i];
      const bap = Number(rev.row.Battery_Active_Power_MW) || 0;
      if (rev.source === 'user_save' && bap !== 0) {
        return { bap, source: 'user_save', row: rev.row };
      }
    }
    // Second pass: any source
    for (let i = revisions.length - 1; i >= 0; i--) {
      const rev = revisions[i];
      const bap = Number(rev.row.Battery_Active_Power_MW) || 0;
      if (bap !== 0) {
        return { bap, source: rev.source || 'ftp', row: rev.row };
      }
    }
    return null;
  }

  /**
   * Get revision history for a specific slot.
   */
  async getSlotHistory(plantId: number, dateKey: string, deliveryStart: string): Promise<ScheduleSlotRevision[]> {
    const db = this.getDb();
    await db.read();

    const storeKey = `${plantId}:${dateKey}`;
    const store = db.data.schedules[storeKey] as ScheduleRevisionStore | undefined;

    if (!store?.slots) return [];

    const revisions = store.slots[deliveryStart];
    if (!revisions || !Array.isArray(revisions)) return [];

    return revisions;
  }

  /** Get complete revision history */
  async getScheduleHistory(plantId: number, dateKey: string) {
    const db = this.getDb();
    await db.read();

    const storeKey = `${plantId}:${dateKey}`;
    const store = db.data.schedules[storeKey] as ScheduleRevisionStore | undefined;

    if (!store?.slots) return { slots: {}, lastFetchedAt: 0 };
    return {
      slots: store.slots,
      lastFetchedAt: store.lastFetchedAt,
    };
  }
}
