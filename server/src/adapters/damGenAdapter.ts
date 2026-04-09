import { PrismaClient } from '@prisma/client';
import { EntityTimeSeriesService, TimeSeriesPoint } from '../services/entityTimeSeries.service';
import { parseDamGenCsv } from '../utils/damGenParser';

const prisma = new PrismaClient();

/**
 * DAM_GEN CSV → EntityTimeSeries adapter.
 *
 * Called after FileIngestionWorker detects a new version of a DAM_GEN file.
 * Resolves PORTFOLIO_ID → companyId via PortfolioMapping, then writes
 * dam_trade_volume and generation_forecast series to the generic time series store.
 */
export class DamGenAdapter {
  private ets = new EntityTimeSeriesService();

  /**
   * Process a DAM_GEN.csv raw content and write to EntityTimeSeries.
   * Returns ingestion stats.
   */
  async process(groupId: string, rawContent: string): Promise<{ inserted: number; skipped: number; unmapped: string[] }> {
    const parsed = parseDamGenCsv(rawContent);
    if (parsed.rows.length === 0) {
      return { inserted: 0, skipped: 0, unmapped: [] };
    }

    // Load portfolio → company mappings
    const mappings = await prisma.portfolioMapping.findMany({
      where: { groupId, portfolioType: 'DAM' },
    });
    const portfolioToCompany = new Map(mappings.map(m => [m.externalId, m.companyId]));

    const points: TimeSeriesPoint[] = [];
    const unmappedSet = new Set<string>();

    for (const row of parsed.rows) {
      const companyId = portfolioToCompany.get(row.portfolioId);
      if (!companyId) {
        unmappedSet.add(row.portfolioId);
        continue;
      }

      const deliveryStart = new Date(row.deliveryStart);
      if (isNaN(deliveryStart.getTime())) continue;

      const entityId = String(companyId);

      // DAM Trade Volume
      points.push({
        entityType: 'COMPANY',
        entityId,
        seriesKey: 'dam_trade_volume',
        deliveryStart,
        value: row.damTradeVolume,
        source: 'dam-gen-csv',
      });

      // Generation Forecast
      points.push({
        entityType: 'COMPANY',
        entityId,
        seriesKey: 'generation_forecast',
        deliveryStart,
        value: row.generationForecast,
        source: 'dam-gen-csv',
      });
    }

    if (points.length === 0) {
      return { inserted: 0, skipped: 0, unmapped: [...unmappedSet] };
    }

    const result = await this.ets.ingestBatch(groupId, points);

    console.log(
      `[DamGenAdapter] group=${groupId}: ${result.inserted} inserted, ${result.skipped} skipped` +
      (unmappedSet.size > 0 ? `, ${unmappedSet.size} unmapped portfolio(s)` : '')
    );

    return { ...result, unmapped: [...unmappedSet] };
  }
}
