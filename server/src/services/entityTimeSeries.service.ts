import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface TimeSeriesPoint {
  entityType: string;     // "COMPANY" | "GCP" | "COMPONENT" | "PORTFOLIO"
  entityId: string;       // companyId, gcpId, etc.
  seriesKey: string;      // "dam_trade_volume", "generation_forecast", etc.
  deliveryStart: Date;    // which MTU slot
  value: number;
  source: string;         // "dam-gen-csv", "portal-api", "manual"
}

export interface IngestResult {
  inserted: number;
  skipped: number;        // same value, no change
}

export class EntityTimeSeriesService {

  /**
   * Ingest a batch of time series points.
   * For each point: if the current isFinal value differs → insert new row, update isFinal flags.
   * If value is the same → skip (dedup).
   */
  async ingestBatch(groupId: string, points: TimeSeriesPoint[]): Promise<IngestResult> {
    let inserted = 0;
    let skipped = 0;

    // Group by (entityType, entityId, seriesKey, deliveryStart) for efficient lookup
    // Process in chunks to avoid overwhelming DB
    const CHUNK_SIZE = 200;

    for (let i = 0; i < points.length; i += CHUNK_SIZE) {
      const chunk = points.slice(i, i + CHUNK_SIZE);
      const results = await this.processChunk(groupId, chunk);
      inserted += results.inserted;
      skipped += results.skipped;
    }

    return { inserted, skipped };
  }

  private async processChunk(groupId: string, points: TimeSeriesPoint[]): Promise<IngestResult> {
    let inserted = 0;
    let skipped = 0;

    await prisma.$transaction(async (tx) => {
      for (const point of points) {
        // Find current isFinal record for this (entity, series, delivery)
        const current = await tx.entityTimeSeries.findFirst({
          where: {
            groupId,
            entityType: point.entityType,
            entityId: point.entityId,
            seriesKey: point.seriesKey,
            deliveryStart: point.deliveryStart,
            isFinal: true,
          },
          select: { id: true, value: true },
        });

        // Dedup: same value → skip
        if (current && current.value === point.value) {
          skipped++;
          continue;
        }

        // Unmark old isFinal
        if (current) {
          await tx.entityTimeSeries.update({
            where: { id: current.id },
            data: { isFinal: false },
          });
        }

        // Insert new record
        await tx.entityTimeSeries.create({
          data: {
            groupId,
            entityType: point.entityType,
            entityId: point.entityId,
            seriesKey: point.seriesKey,
            deliveryStart: point.deliveryStart,
            value: point.value,
            source: point.source,
            isFinal: true,
          },
        });

        inserted++;
      }
    });

    return { inserted, skipped };
  }

  /**
   * Get current (isFinal) values for an entity+series on a given date.
   * Returns all deliveryStart slots for that day.
   */
  async getCurrentValues(
    groupId: string,
    entityType: string,
    entityId: string,
    seriesKey: string,
    dateStart: Date,
    dateEnd: Date,
  ) {
    return prisma.entityTimeSeries.findMany({
      where: {
        groupId,
        entityType,
        entityId,
        seriesKey,
        isFinal: true,
        deliveryStart: { gte: dateStart, lt: dateEnd },
      },
      orderBy: { deliveryStart: 'asc' },
      select: {
        deliveryStart: true,
        value: true,
        observedAt: true,
        source: true,
      },
    });
  }

  /**
   * Get multiple series for an entity on a given date (e.g., dam_trade_volume + generation_forecast).
   */
  async getMultiSeries(
    groupId: string,
    entityType: string,
    entityId: string,
    seriesKeys: string[],
    dateStart: Date,
    dateEnd: Date,
  ) {
    const rows = await prisma.entityTimeSeries.findMany({
      where: {
        groupId,
        entityType,
        entityId,
        seriesKey: { in: seriesKeys },
        isFinal: true,
        deliveryStart: { gte: dateStart, lt: dateEnd },
      },
      orderBy: { deliveryStart: 'asc' },
      select: {
        seriesKey: true,
        deliveryStart: true,
        value: true,
        observedAt: true,
        source: true,
      },
    });

    // Group by seriesKey
    const result: Record<string, Array<{ deliveryStart: Date; value: number; observedAt: Date; source: string }>> = {};
    for (const key of seriesKeys) result[key] = [];
    for (const row of rows) {
      result[row.seriesKey]?.push({
        deliveryStart: row.deliveryStart,
        value: row.value,
        observedAt: row.observedAt,
        source: row.source,
      });
    }
    return result;
  }

  /**
   * Get version history for a specific slot (how a value changed over time).
   */
  async getSlotHistory(
    groupId: string,
    entityType: string,
    entityId: string,
    seriesKey: string,
    deliveryStart: Date,
  ) {
    return prisma.entityTimeSeries.findMany({
      where: {
        groupId,
        entityType,
        entityId,
        seriesKey,
        deliveryStart,
      },
      orderBy: { observedAt: 'asc' },
      select: {
        observedAt: true,
        value: true,
        source: true,
        isFinal: true,
      },
    });
  }
}
