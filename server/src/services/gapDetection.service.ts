import { PrismaClient } from '@prisma/client';
import { eventBus, EVENTS } from '../eventBus';
import { ScadaWorker } from '../workers/scada.worker';

const prisma = new PrismaClient();

const BUCKET_MS = 5 * 60 * 1000; // 5 minutes
const DEBOUNCE_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface GapDetectionParams {
  assetName: string;
  assetId: number;
  gcpId: string;
  companyId: number;
  start: string;
  end: string;
  timezone: string;
  profile: any;
}

export async function detectGapsAndBackfill(params: GapDetectionParams): Promise<void> {
  const { assetName, assetId, gcpId, companyId, start, end, timezone, profile } = params;

  try {
    // 1. Cleanup old attempts (>24h)
    await prisma.backfillAttempt.deleteMany({
      where: { attemptedAt: { lt: new Date(Date.now() - CLEANUP_AGE_MS) } },
    });

    // 2. Query raw data timestamps for this asset in the requested range
    const startDate = new Date(start);
    const endDate = new Date(end);
    const now = new Date();
    const effectiveEnd = endDate > now ? now : endDate;

    if (effectiveEnd <= startDate) return;

    const rawPoints = await prisma.timeSeriesData.findMany({
      where: {
        assetId: assetId,
        effectiveTime: { gte: startDate, lte: effectiveEnd },
      },
      select: { effectiveTime: true },
    });

    // 3. Bucket into 5-min intervals
    const startMs = startDate.getTime();
    const endMs = effectiveEnd.getTime();
    const bucketCount = Math.ceil((endMs - startMs) / BUCKET_MS);
    const occupied = new Set<number>();

    for (const pt of rawPoints) {
      const bucketIdx = Math.floor((pt.effectiveTime.getTime() - startMs) / BUCKET_MS);
      occupied.add(bucketIdx);
    }

    // 4. Find empty buckets and merge into contiguous gap ranges
    const gaps: Array<{ gapStart: Date; gapEnd: Date }> = [];
    let gapStartIdx: number | null = null;

    for (let i = 0; i < bucketCount; i++) {
      const bucketEnd = new Date(startMs + (i + 1) * BUCKET_MS);
      if (bucketEnd > now) break;

      if (!occupied.has(i)) {
        if (gapStartIdx === null) gapStartIdx = i;
      } else {
        if (gapStartIdx !== null) {
          gaps.push({
            gapStart: new Date(startMs + gapStartIdx * BUCKET_MS),
            gapEnd: new Date(startMs + i * BUCKET_MS),
          });
          gapStartIdx = null;
        }
      }
    }
    if (gapStartIdx !== null) {
      const trailEnd = new Date(Math.min(startMs + bucketCount * BUCKET_MS, now.getTime()));
      gaps.push({
        gapStart: new Date(startMs + gapStartIdx * BUCKET_MS),
        gapEnd: trailEnd,
      });
    }

    if (gaps.length === 0) return;

    // 5. For each gap, check debounce and trigger backfill
    for (const gap of gaps) {
      const recentAttempt = await prisma.backfillAttempt.findFirst({
        where: {
          assetName,
          rangeStart: { lte: gap.gapEnd },
          rangeEnd: { gte: gap.gapStart },
          attemptedAt: { gt: new Date(Date.now() - DEBOUNCE_MS) },
        },
      });

      if (recentAttempt) continue;

      const attempt = await prisma.$transaction(async (tx) => {
        const existing = await tx.backfillAttempt.findFirst({
          where: {
            assetName,
            rangeStart: { lte: gap.gapEnd },
            rangeEnd: { gte: gap.gapStart },
            attemptedAt: { gt: new Date(Date.now() - DEBOUNCE_MS) },
          },
        });
        if (existing) return null;

        return tx.backfillAttempt.create({
          data: {
            assetName,
            rangeStart: gap.gapStart,
            rangeEnd: gap.gapEnd,
          },
        });
      });

      if (!attempt) continue;

      try {
        const count = await ScadaWorker.fetchAndIngestAdhoc({
          gcpId,
          companyId,
          start: gap.gapStart.toISOString(),
          end: gap.gapEnd.toISOString(),
          profile,
        });

        await prisma.backfillAttempt.update({
          where: { id: attempt.id },
          data: { pointsFound: count },
        });

        if (count > 0) {
          const dateKey = gap.gapStart.toLocaleDateString('en-CA', { timeZone: timezone });
          eventBus.emit(EVENTS.BACKFILL_COMPLETE, {
            assetId,
            gcpId,
            companyId,
            dateKey,
          });
        }
      } catch (err: any) {
        console.error(`[GapDetection] Backfill failed for ${assetName} [${gap.gapStart.toISOString()} - ${gap.gapEnd.toISOString()}]:`, err.message);
      }
    }
  } catch (err: any) {
    console.error('[GapDetection] Error:', err.message);
  }
}
