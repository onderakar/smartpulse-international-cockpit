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
  async refreshTransactions(
    groupId: string,
    companyIds: number[],
    startDate: string,
    endDate: string,
    accessToken: string,
    env: string,
  ): Promise<{ newTransactions: number; skipped: number; aggregated: { inserted: number; skipped: number } }> {
    const baseUrl = PORTAL_BASE_URLS[env] || PORTAL_BASE_URLS.prod;

    // 1. Fetch from SmartPulse API
    const response = await axios.post<TransactionReportResponse>(
      `${baseUrl}/IntradayPlanning/GetTransactionReport`,
      {
        CompanyIds: companyIds,
        StartDate: startDate,
        EndDate: endDate,
        StartRow: 0,
        EndRow: 100000,
        Directions: [],
      },
      {
        headers: { Authorization: `bearer ${accessToken}` },
        timeout: 30_000,
      },
    );

    const rows = response.data?.RowData ?? [];
    console.log(`[Intraday] Fetched ${rows.length} transactions for companies [${companyIds.join(',')}]`);

    // 2. Store raw transactions (upsert by remoteTradeId)
    let newCount = 0;
    let skipCount = 0;

    for (const row of rows) {
      if (!row.RemoteTradeId) continue;

      try {
        await prisma.intradayTransaction.upsert({
          where: {
            groupId_remoteTradeId: { groupId, remoteTradeId: row.RemoteTradeId },
          },
          update: {
            // Update mutable fields on re-fetch
            quantity: row.Quantity,
            price: row.Price,
            status: row.Status,
            revisionNo: row.RevisionNo,
            explanation: row.Explanation ?? null,
          },
          create: {
            groupId,
            remoteTradeId: row.RemoteTradeId,
            companyId: row.CompanyId,
            companyName: row.CompanyName,
            deliveryStart: new Date(row.DeliveryStart),
            deliveryEnd: new Date(row.DeliveryEnd),
            direction: row.OrderDirection,
            quantity: row.Quantity,
            price: row.Price,
            tradeTime: new Date(row.TradeTime),
            contractId: row.ContractId ?? null,
            contractName: row.ContractName ?? null,
            productType: row.ProductType ?? null,
            status: row.Status,
            revisionNo: row.RevisionNo,
            username: row.Username ?? null,
            explanation: row.Explanation ?? null,
            platformCode: row.PlatformCode ?? null,
            areaCode: row.AreaCode ?? null,
          },
        });
        newCount++;
      } catch (err: any) {
        // Duplicate or other constraint error — skip
        skipCount++;
      }
    }

    // 3. Aggregate net position per (companyId, deliveryStart) → EntityTimeSeries
    const aggregated = await this.aggregateNetPositions(groupId, companyIds, startDate, endDate);

    console.log(
      `[Intraday] group=${groupId}: ${newCount} upserted, ${skipCount} errors, ` +
      `aggregated: ${aggregated.inserted} inserted, ${aggregated.skipped} unchanged`
    );

    return { newTransactions: newCount, skipped: skipCount, aggregated };
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
