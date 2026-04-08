import { PrismaClient } from '@prisma/client';
import { ScheduleRow, ScheduleSlotRevision, ScheduleRevisionStore } from '@smartpulse-intl/shared';
import { computeRowHash, computeCsvHash } from '../utils/scheduleParser';

const prisma = new PrismaClient();

/**
 * Schedule revision store backed by PostgreSQL via Prisma.
 * Replaces the old LowDB-based implementation.
 */
export class ScheduleStoreService {
  /** No-op — kept for backward compatibility. */
  async init(): Promise<void> {}

  /**
   * Bulk sync schedule from FTP Native File Metadata (Current + Consumed modes)
   */
  async syncScheduleFromFtp(
    plantId: number,
    dateKey: string,
    ftpService: any,
    cookies: string[],
    env: string,
    scheduleBaseName?: string
  ): Promise<{ hasChanges: boolean; rows: ScheduleRow[]; header: string[] }> {
    const baseName = scheduleBaseName || `Battery_Schedule_${plantId}`;

    const currentTask = ftpService.getFileWithMeta(cookies, env, 'outgoing', `${baseName}.csv`)
      .then((res: any) => res && res.FileData ? [res] : [])
      .catch(() => []);

    const consumedTask = ftpService.listFiles(cookies, env, 'outgoing', 'Consumed', baseName, true);

    const [currentFiles, consumedFiles] = await Promise.all([currentTask, consumedTask]);

    const allFiles = [...(currentFiles || []), ...(consumedFiles || [])]
      .filter((f: any) => f && f.FileData && f.ModifyDate)
      .sort((a: any, b: any) => new Date(a.ModifyDate).getTime() - new Date(b.ModifyDate).getTime());

    if (allFiles.length === 0) {
      return { hasChanges: false, rows: [], header: [] };
    }

    const { parseScheduleCsv } = require('../utils/scheduleParser');

    // Load existing revisions from DB into in-memory map for dedup
    const existingRevs = await prisma.scheduleRevision.findMany({
      where: { gcpId: plantId, dateKey },
    });
    const existingSet = new Set(
      existingRevs.map(r => `${r.deliveryStart}:${r.contentHash}:${r.fetchedAt}`)
    );

    let latestHeader: string[] = [];
    const newRevisions: Array<{
      gcpId: number; dateKey: string; deliveryStart: string;
      row: any; fetchedAt: bigint; contentHash: string; source: string;
    }> = [];

    for (const file of allFiles) {
      try {
        const parsed = parseScheduleCsv(file.FileData);
        if (parsed.header.length > 0) latestHeader = parsed.header;

        const modifyTimeMs = new Date(file.ModifyDate).getTime();

        for (const row of parsed.rows) {
          const slotKey = row.Delivery_Start;
          const rowHash = computeRowHash(row);

          // Check if this exact revision already exists
          const key = `${slotKey}:${rowHash}:${modifyTimeMs}`;
          if (existingSet.has(key)) continue;

          // Check if latest revision for this slot has same hash (no real change)
          const latestForSlot = existingRevs
            .filter(r => r.deliveryStart === slotKey)
            .sort((a, b) => Number(a.fetchedAt) - Number(b.fetchedAt));
          const latest = latestForSlot[latestForSlot.length - 1];
          if (latest && latest.contentHash === rowHash) continue;

          newRevisions.push({
            gcpId: plantId,
            dateKey,
            deliveryStart: slotKey,
            row: { ...row },
            fetchedAt: BigInt(modifyTimeMs),
            contentHash: rowHash,
            source: 'ftp',
          });
          existingSet.add(key);
        }
      } catch (err) {
        console.warn(`[ScheduleStore] skipping unparseable FTP file`, err);
      }
    }

    if (newRevisions.length > 0) {
      await prisma.scheduleRevision.createMany({
        data: newRevisions,
        skipDuplicates: true,
      });
    }

    // Get current schedule (latest revision per slot)
    const currentRows = await this.getCurrentSchedule(plantId, dateKey);

    return { hasChanges: newRevisions.length > 0, rows: currentRows, header: latestHeader };
  }

  /**
   * Process a freshly fetched schedule CSV. (LEGACY fallback)
   */
  async processSchedule(
    plantId: number,
    dateKey: string,
    rows: ScheduleRow[],
    csvContent: string
  ): Promise<{ hasChanges: boolean }> {
    const now = Date.now();
    let hasChanges = false;

    // Load existing latest revisions per slot
    const existing = await this.getLatestRevisionPerSlot(plantId, dateKey);

    const newRevisions: Array<{
      gcpId: number; dateKey: string; deliveryStart: string;
      row: any; fetchedAt: bigint; contentHash: string; source: string;
    }> = [];

    for (const row of rows) {
      const slotKey = row.Delivery_Start;
      const rowHash = computeRowHash(row);
      const latest = existing.get(slotKey);

      if (!latest || latest.contentHash !== rowHash) {
        hasChanges = true;
        newRevisions.push({
          gcpId: plantId,
          dateKey,
          deliveryStart: slotKey,
          row: { ...row },
          fetchedAt: BigInt(now),
          contentHash: rowHash,
          source: 'ftp',
        });
      }
    }

    if (newRevisions.length > 0) {
      await prisma.scheduleRevision.createMany({
        data: newRevisions,
        skipDuplicates: true,
      });
    }

    return { hasChanges };
  }

  /**
   * Get the current schedule (latest revision of each slot).
   */
  async getCurrentSchedule(plantId: number, dateKey: string): Promise<ScheduleRow[]> {
    // Get all revisions, then pick latest per deliveryStart in JS
    // (Prisma doesn't support DISTINCT ON)
    const revisions = await prisma.scheduleRevision.findMany({
      where: { gcpId: plantId, dateKey },
      orderBy: { fetchedAt: 'asc' },
    });

    const latestBySlot = new Map<string, any>();
    for (const rev of revisions) {
      latestBySlot.set(rev.deliveryStart, rev);
    }

    return Array.from(latestBySlot.values())
      .map(rev => rev.row as ScheduleRow)
      .sort((a, b) => a.Delivery_Start.localeCompare(b.Delivery_Start));
  }

  /**
   * Record a user save with source: 'user_save'.
   */
  async recordUserSave(plantId: number, rows: ScheduleRow[]): Promise<void> {
    const now = Date.now();

    // Group by dateKey
    const byDate = new Map<string, ScheduleRow[]>();
    for (const row of rows) {
      const dateKey = row.Delivery_Start.slice(0, 10);
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey)!.push(row);
    }

    for (const [dateKey, dateRows] of byDate) {
      const existing = await this.getLatestRevisionPerSlot(plantId, dateKey);

      const newRevisions: Array<{
        gcpId: number; dateKey: string; deliveryStart: string;
        row: any; fetchedAt: bigint; contentHash: string; source: string;
      }> = [];

      let savedCount = 0;
      for (const row of dateRows) {
        const slotKey = row.Delivery_Start;
        const rowHash = computeRowHash(row);
        const latest = existing.get(slotKey);

        if (!latest || latest.contentHash !== rowHash) {
          newRevisions.push({
            gcpId: plantId,
            dateKey,
            deliveryStart: slotKey,
            row: { ...row },
            fetchedAt: BigInt(now),
            contentHash: rowHash,
            source: 'user_save',
          });
          savedCount++;
        }
      }

      if (newRevisions.length > 0) {
        await prisma.scheduleRevision.createMany({
          data: newRevisions,
          skipDuplicates: true,
        });
      }
      console.log(`[ScheduleStore] recordUserSave: plantId=${plantId} dateKey=${dateKey} — ${savedCount} new user_save revisions`);
    }
  }

  /**
   * Merge FTP-read rows with protected past slots from DB.
   */
  async mergeWithProtectedPast(
    plantId: number,
    dateKey: string,
    ftpRows: ScheduleRow[]
  ): Promise<ScheduleRow[]> {
    const revisions = await prisma.scheduleRevision.findMany({
      where: { gcpId: plantId, dateKey },
      orderBy: { fetchedAt: 'asc' },
    });

    if (revisions.length === 0) return ftpRows;

    // Group revisions by deliveryStart
    const slotRevisions = new Map<string, typeof revisions>();
    for (const rev of revisions) {
      if (!slotRevisions.has(rev.deliveryStart)) slotRevisions.set(rev.deliveryStart, []);
      slotRevisions.get(rev.deliveryStart)!.push(rev);
    }

    const nowIso = new Date().toISOString();
    let protectedCount = 0;
    let restoredCount = 0;

    // Phase 1: Protect zeroed past slots
    const result = ftpRows.map(row => {
      if (row.Delivery_End > nowIso) return row;

      const slotKey = row.Delivery_Start;
      const slotRevs = slotRevisions.get(slotKey);
      if (!slotRevs || slotRevs.length === 0) return row;

      const ftpBap = Number(row.Battery_Active_Power_MW) || 0;
      if (ftpBap !== 0) return row;

      const restored = this.findLastNonZeroBap(slotRevs);
      if (restored) {
        protectedCount++;
        return { ...row, Battery_Active_Power_MW: restored.bap };
      }
      return row;
    });

    // Phase 2: Restore removed past slots
    const ftpSlotKeys = new Set(ftpRows.map(r => r.Delivery_Start));

    for (const [slotKey, slotRevs] of slotRevisions) {
      if (ftpSlotKeys.has(slotKey)) continue;
      if (slotRevs.length === 0) continue;

      const latestRow = slotRevs[slotRevs.length - 1].row as ScheduleRow;
      if (latestRow.Delivery_End > nowIso) continue;

      const restored = this.findLastNonZeroBap(slotRevs);
      if (restored) {
        restoredCount++;
        result.push({ ...restored.row, Battery_Active_Power_MW: restored.bap });
      }
    }

    result.sort((a, b) => a.Delivery_Start.localeCompare(b.Delivery_Start));

    if (protectedCount > 0 || restoredCount > 0) {
      console.log(`[ScheduleStore] mergeWithProtectedPast: plantId=${plantId} dateKey=${dateKey} — ${protectedCount} protected, ${restoredCount} restored`);
    }

    return result;
  }

  private findLastNonZeroBap(revisions: any[]): { bap: number; source: string; row: ScheduleRow } | null {
    // Prefer user_save
    for (let i = revisions.length - 1; i >= 0; i--) {
      const rev = revisions[i];
      const row = rev.row as ScheduleRow;
      const bap = Number(row.Battery_Active_Power_MW) || 0;
      if (rev.source === 'user_save' && bap !== 0) {
        return { bap, source: 'user_save', row };
      }
    }
    // Any source
    for (let i = revisions.length - 1; i >= 0; i--) {
      const rev = revisions[i];
      const row = rev.row as ScheduleRow;
      const bap = Number(row.Battery_Active_Power_MW) || 0;
      if (bap !== 0) {
        return { bap, source: rev.source || 'ftp', row };
      }
    }
    return null;
  }

  async getSlotHistory(plantId: number, dateKey: string, deliveryStart: string): Promise<ScheduleSlotRevision[]> {
    const revisions = await prisma.scheduleRevision.findMany({
      where: { gcpId: plantId, dateKey, deliveryStart },
      orderBy: { fetchedAt: 'asc' },
    });

    return revisions.map(r => ({
      deliveryStart: r.deliveryStart,
      row: r.row as ScheduleRow,
      fetchedAt: Number(r.fetchedAt),
      contentHash: r.contentHash,
      source: r.source,
    }));
  }

  async getScheduleHistory(plantId: number, dateKey: string) {
    const revisions = await prisma.scheduleRevision.findMany({
      where: { gcpId: plantId, dateKey },
      orderBy: { fetchedAt: 'asc' },
    });

    const slots: Record<string, ScheduleSlotRevision[]> = {};
    for (const r of revisions) {
      if (!slots[r.deliveryStart]) slots[r.deliveryStart] = [];
      slots[r.deliveryStart].push({
        deliveryStart: r.deliveryStart,
        row: r.row as ScheduleRow,
        fetchedAt: Number(r.fetchedAt),
        contentHash: r.contentHash,
        source: r.source,
      });
    }

    const lastRev = revisions[revisions.length - 1];
    return {
      slots,
      lastFetchedAt: lastRev ? Number(lastRev.fetchedAt) : 0,
    };
  }

  // ── Private helpers ──

  private async getLatestRevisionPerSlot(plantId: number, dateKey: string): Promise<Map<string, { contentHash: string }>> {
    const revisions = await prisma.scheduleRevision.findMany({
      where: { gcpId: plantId, dateKey },
      orderBy: { fetchedAt: 'asc' },
      select: { deliveryStart: true, contentHash: true },
    });

    const latest = new Map<string, { contentHash: string }>();
    for (const r of revisions) {
      latest.set(r.deliveryStart, { contentHash: r.contentHash });
    }
    return latest;
  }
}
