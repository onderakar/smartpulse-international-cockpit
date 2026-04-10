import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { PORTAL_BASE_URLS } from '../config/env';
import { EntityTimeSeriesService, TimeSeriesPoint } from './entityTimeSeries.service';

const prisma = new PrismaClient();

interface TransactionRow {
  Id: number;
  RemoteTradeId: string;
  PlatformCode: string;
  AreaCode: string;
  ContractId: string;
  ContractName: string;
  ProductType: string;
  DeliveryStart: string;
  DeliveryEnd: string;
  CompanyId: number;
  CompanyName: string;
  OrderDirection: boolean; // true = buy, false = sell
  Quantity: number;
  Price: number;
  TradeTime: string;
  Status: number;
  RevisionNo: number;
  Username: string;
  Explanation: string;
}

interface TransactionReportResponse {
  RowData: TransactionRow[];
  RowCount: number;
}

export class IntradayService {
  private ets = new EntityTimeSeriesService();

  /**
   * Fetch intraday transactions from SmartPulse Portal API,
   * store raw transactions (dedup by remoteTradeId),
   * then aggregate net position per delivery slot into EntityTimeSeries.
   */
  /**
   * Fetch intraday transactions for multiple companies in parallel (one API call per company),
   * store raw transactions, then aggregate net positions.
   */
  async refreshTransactions(
    groupId: string,
    companyIds: number[],
    startDate: string,
    endDate: string,
    accessToken: string,
    portalCookies: string[],
    env: string,
  ): Promise<{ newTransactions: number; skipped: number; aggregated: { inserted: number; skipped: number } }> {
    const CONCURRENCY = 3; // max parallel API calls

    let totalNew = 0;
    let totalSkip = 0;

    // Process companies in parallel batches
    for (let i = 0; i < companyIds.length; i += CONCURRENCY) {
      const batch = companyIds.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(companyId =>
          this.fetchAndStoreForCompany(groupId, companyId, startDate, endDate, accessToken, portalCookies, env)
        )
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          totalNew += r.value.newCount;
          totalSkip += r.value.skipCount;
        } else {
          console.error(`[Intraday] Company batch error:`, r.reason?.message?.substring(0, 200));
        }
      }
    }

    // Aggregate net position for all companies
    const aggregated = await this.aggregateNetPositions(groupId, companyIds, startDate, endDate);

    console.log(
      `[Intraday] group=${groupId}: ${totalNew} upserted, ${totalSkip} errors across ${companyIds.length} companies, ` +
      `aggregated: ${aggregated.inserted} inserted, ${aggregated.skipped} unchanged`
    );

    return { newTransactions: totalNew, skipped: totalSkip, aggregated };
  }

  /** Fetch + store transactions for a single company */
  private async fetchAndStoreForCompany(
    groupId: string,
    companyId: number,
    startDate: string,
    endDate: string,
    accessToken: string,
    portalCookies: string[],
    env: string,
  ): Promise<{ newCount: number; skipCount: number }> {
    const baseUrl = PORTAL_BASE_URLS[env] || PORTAL_BASE_URLS.prod;
    const headers: Record<string, string> = { Cookie: portalCookies.join('; ') };
    if (accessToken) headers.Authorization = `bearer ${accessToken}`;

    const response = await axios.post<TransactionReportResponse>(
      `${baseUrl}/IntradayPlanning/GetTransactionReport`,
      {
        CompanyIds: [companyId],
        StartDate: startDate,
        EndDate: endDate,
        StartRow: 0,
        EndRow: 100000,
        Directions: [],
      },
      { headers, timeout: 60_000 },
    );

    const rows = response.data?.RowData ?? [];
    console.log(`[Intraday] Company ${companyId}: ${rows.length} transactions fetched`);

    let newCount = 0;
    let skipCount = 0;

    for (const row of rows) {
      const tradeId = row.RemoteTradeId || String(row.Id);
      if (!tradeId) continue;

      try {
        await prisma.intradayTransaction.upsert({
          where: { groupId_remoteTradeId: { groupId, remoteTradeId: tradeId } },
          update: {
            quantity: Number(row.Quantity) || 0,
            price: Number(row.Price) || 0,
            status: Number(row.Status) || 0,
            revisionNo: Number(row.RevisionNo) || 1,
            explanation: row.Explanation ?? null,
          },
          create: {
            groupId,
            remoteTradeId: tradeId,
            companyId: Number(row.CompanyId),
            companyName: row.CompanyName ?? '',
            deliveryStart: new Date(row.DeliveryStart),
            deliveryEnd: new Date(row.DeliveryEnd),
            direction: Boolean(row.OrderDirection),
            quantity: Number(row.Quantity) || 0,
            price: Number(row.Price) || 0,
            tradeTime: new Date(row.TradeTime),
            contractId: row.ContractId ?? null,
            contractName: row.ContractName ?? null,
            productType: row.ProductType ?? null,
            status: Number(row.Status) || 0,
            revisionNo: Number(row.RevisionNo) || 1,
            username: row.Username ?? null,
            explanation: row.Explanation ?? null,
            platformCode: row.PlatformCode ?? null,
            areaCode: row.AreaCode ?? null,
          },
        });
        newCount++;
      } catch (err: any) {
        skipCount++;
        if (skipCount <= 1) {
          console.warn(`[Intraday] Upsert error company=${companyId} trade="${tradeId}":`, String(err).substring(0, 300));
        }
      }
    }

    return { newCount, skipCount };
  }

  /**
   * Aggregate raw transactions into idm_net_position per (company, deliveryStart).
   * Buy (+) / Sell (-) → net MW per slot.
   */
  private async aggregateNetPositions(
    groupId: string,
    companyIds: number[],
    startDate: string,
    endDate: string,
  ): Promise<{ inserted: number; skipped: number }> {
    // Query all transactions for these companies in date range
    const transactions = await prisma.intradayTransaction.findMany({
      where: {
        groupId,
        companyId: { in: companyIds },
        deliveryStart: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      select: {
        companyId: true,
        deliveryStart: true,
        direction: true,
        quantity: true,
      },
    });

    // Aggregate: sum by (companyId, deliveryStart)
    const netMap = new Map<string, { companyId: number; deliveryStart: Date; net: number }>();

    for (const tx of transactions) {
      const key = `${tx.companyId}_${tx.deliveryStart.toISOString()}`;
      const existing = netMap.get(key);
      const signedQty = tx.direction ? tx.quantity : -tx.quantity; // buy + / sell -

      if (existing) {
        existing.net += signedQty;
      } else {
        netMap.set(key, { companyId: tx.companyId, deliveryStart: tx.deliveryStart, net: signedQty });
      }
    }

    // Write to EntityTimeSeries
    const points: TimeSeriesPoint[] = [...netMap.values()].map(entry => ({
      entityType: 'COMPANY',
      entityId: String(entry.companyId),
      seriesKey: 'idm_net_position',
      deliveryStart: entry.deliveryStart,
      value: Math.round(entry.net * 1000) / 1000, // 3 decimal precision
      source: 'portal-api',
    }));

    if (points.length === 0) return { inserted: 0, skipped: 0 };

    return this.ets.ingestBatch(groupId, points);
  }

  /**
   * Query stored transactions for a company in a date range.
   */
  async getTransactions(
    groupId: string,
    companyId: number,
    startDate: string,
    endDate: string,
  ) {
    return prisma.intradayTransaction.findMany({
      where: {
        groupId,
        companyId,
        deliveryStart: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      orderBy: [{ deliveryStart: 'asc' }, { tradeTime: 'asc' }],
    });
  }
}
