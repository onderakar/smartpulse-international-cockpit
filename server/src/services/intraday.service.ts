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
            mcp: row.Mcp != null ? Number(row.Mcp) : null,
            smp: row.Smp != null ? Number(row.Smp) : null,
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
            orderType: row.OrderType ?? null,
            remoteOrderId: row.RemoteOrderId ?? null,
            mcp: row.Mcp != null ? Number(row.Mcp) : null,
            smp: row.Smp != null ? Number(row.Smp) : null,
            smartbotId: row.SmartbotId != null ? Number(row.SmartbotId) : null,
            alertName: row.AlertName ?? null,
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
   * Aggregate raw transactions into three series, all at 15-min resolution:
   *   idm_net_position_q  — only quarter-hourly products (deliveryEnd - deliveryStart = 15min)
   *   idm_net_position_h  — only hourly products (spread into 4 quarter slots, qty / 4)
   *   idm_net_position    — total (q + h combined)
   */
  private async aggregateNetPositions(
    groupId: string,
    companyIds: number[],
    startDate: string,
    endDate: string,
  ): Promise<{ inserted: number; skipped: number }> {
    const transactions = await prisma.intradayTransaction.findMany({
      where: {
        groupId,
        companyId: { in: companyIds },
        deliveryStart: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      select: {
        companyId: true,
        deliveryStart: true,
        deliveryEnd: true,
        direction: true,
        quantity: true,
      },
    });

    // Maps: key = "companyId_isoSlot" → net MW
    const qMap = new Map<string, { companyId: number; deliveryStart: Date; net: number }>();
    const hMap = new Map<string, { companyId: number; deliveryStart: Date; net: number }>();

    const addToMap = (map: Map<string, { companyId: number; deliveryStart: Date; net: number }>, companyId: number, slot: Date, qty: number) => {
      const key = `${companyId}_${slot.toISOString()}`;
      const existing = map.get(key);
      if (existing) {
        existing.net += qty;
      } else {
        map.set(key, { companyId, deliveryStart: slot, net: qty });
      }
    };

    for (const tx of transactions) {
      const durationMin = (tx.deliveryEnd.getTime() - tx.deliveryStart.getTime()) / 60_000;
      const signedQty = tx.direction ? tx.quantity : -tx.quantity;

      if (durationMin <= 15) {
        // Quarter-hourly product → directly into qMap
        addToMap(qMap, tx.companyId, tx.deliveryStart, signedQty);
      } else {
        // Hourly (or longer) product → spread evenly into 15-min slots
        const slotCount = Math.round(durationMin / 15);
        const qtyPerSlot = signedQty / slotCount;
        for (let i = 0; i < slotCount; i++) {
          const slot = new Date(tx.deliveryStart.getTime() + i * 15 * 60_000);
          addToMap(hMap, tx.companyId, slot, qtyPerSlot);
        }
      }
    }

    // Build total map (q + h)
    const totalMap = new Map<string, { companyId: number; deliveryStart: Date; net: number }>();
    for (const [key, entry] of qMap) {
      totalMap.set(key, { ...entry });
    }
    for (const [key, entry] of hMap) {
      const existing = totalMap.get(key);
      if (existing) {
        existing.net += entry.net;
      } else {
        totalMap.set(key, { ...entry });
      }
    }

    const round3 = (v: number) => Math.round(v * 1000) / 1000;

    const toPoints = (map: Map<string, { companyId: number; deliveryStart: Date; net: number }>, seriesKey: string): TimeSeriesPoint[] =>
      [...map.values()].map(e => ({
        entityType: 'COMPANY',
        entityId: String(e.companyId),
        seriesKey,
        deliveryStart: e.deliveryStart,
        value: round3(e.net),
        source: 'portal-api',
      }));

    const allPoints = [
      ...toPoints(qMap, 'idm_net_position_q'),
      ...toPoints(hMap, 'idm_net_position_h'),
      ...toPoints(totalMap, 'idm_net_position'),
    ];

    if (allPoints.length === 0) return { inserted: 0, skipped: 0 };

    return this.ets.ingestBatch(groupId, allPoints);
  }

  /**
   * Query stored transactions for a company in a date range (unpaginated, kept for backward compat).
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

  /**
   * Heatmap data: for each delivery slot, aggregate trade volume by minutes-before-delivery buckets.
   */
  async getHeatmapData(
    groupId: string,
    companyId: number,
    startDate: string,
    endDate: string,
  ) {
    const transactions = await prisma.intradayTransaction.findMany({
      where: {
        groupId,
        companyId,
        deliveryStart: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      select: {
        deliveryStart: true,
        tradeTime: true,
        quantity: true,
        direction: true,
        price: true,
      },
      orderBy: { deliveryStart: 'asc' },
    });

    // Bucket definitions: [label, minMinutes, maxMinutes)
    const BUCKETS = [
      { label: '0-5m', min: 0, max: 5 },
      { label: '5-15m', min: 5, max: 15 },
      { label: '15-30m', min: 15, max: 30 },
      { label: '30-60m', min: 30, max: 60 },
      { label: '1-2h', min: 60, max: 120 },
      { label: '2-4h', min: 120, max: 240 },
      { label: '4-8h', min: 240, max: 480 },
      { label: '8h+', min: 480, max: Infinity },
    ];

    // Aggregate: deliverySlot → bucket → { totalQty, buyQty, sellQty, tradeCount, avgPrice }
    const slotMap = new Map<string, Map<string, { totalQty: number; buyQty: number; sellQty: number; count: number; priceSum: number }>>();

    for (const tx of transactions) {
      const deliveryKey = tx.deliveryStart.toISOString();
      const minutesBefore = (tx.deliveryStart.getTime() - tx.tradeTime.getTime()) / 60000;

      const bucket = BUCKETS.find(b => minutesBefore >= b.min && minutesBefore < b.max) ?? BUCKETS[BUCKETS.length - 1];

      if (!slotMap.has(deliveryKey)) {
        slotMap.set(deliveryKey, new Map());
      }
      const bucketMap = slotMap.get(deliveryKey)!;
      if (!bucketMap.has(bucket.label)) {
        bucketMap.set(bucket.label, { totalQty: 0, buyQty: 0, sellQty: 0, count: 0, priceSum: 0 });
      }
      const agg = bucketMap.get(bucket.label)!;
      agg.totalQty += tx.quantity;
      agg.count += 1;
      agg.priceSum += tx.price * tx.quantity;
      if (tx.direction) agg.buyQty += tx.quantity;
      else agg.sellQty += tx.quantity;
    }

    // Convert to array format for ECharts
    const deliverySlots = [...new Set(transactions.map(t => t.deliveryStart.toISOString()))].sort();
    const bucketLabels = BUCKETS.map(b => b.label);

    const data: Array<[number, number, number, { buyQty: number; sellQty: number; count: number; avgPrice: number }]> = [];

    for (let y = 0; y < deliverySlots.length; y++) {
      const bucketMap = slotMap.get(deliverySlots[y]);
      for (let x = 0; x < bucketLabels.length; x++) {
        const agg = bucketMap?.get(bucketLabels[x]);
        if (agg && agg.totalQty > 0) {
          data.push([x, y, Math.round(agg.totalQty * 10) / 10, {
            buyQty: Math.round(agg.buyQty * 10) / 10,
            sellQty: Math.round(agg.sellQty * 10) / 10,
            count: agg.count,
            avgPrice: Math.round(agg.priceSum / agg.totalQty * 100) / 100,
          }]);
        }
      }
    }

    return { deliverySlots, bucketLabels, data };
  }

  /**
   * Get distinct values for a text column (for filter dropdowns).
   */
  async getDistinctValues(
    groupId: string,
    companyId: number,
    startDate: string,
    endDate: string,
    column: string,
  ): Promise<string[]> {
    const rows = await prisma.intradayTransaction.findMany({
      where: {
        groupId,
        companyId,
        deliveryStart: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      select: { [column]: true },
      distinct: [column as any],
      orderBy: { [column]: 'asc' },
    });

    return rows
      .map((r: any) => r[column])
      .filter((v: any) => v != null && v !== '')
      .map(String);
  }

  /**
   * Export all filtered transactions (no pagination, max 3000 rows).
   */
  async exportTransactions(
    groupId: string,
    companyId: number,
    startDate: string,
    endDate: string,
    opts: {
      sortBy: string;
      sortDir: 'asc' | 'desc';
      filters: Record<string, string>;
    },
  ): Promise<{ transactions: any[]; total: number }> {
    const where: any = {
      groupId,
      companyId,
      deliveryStart: { gte: new Date(startDate), lte: new Date(endDate) },
    };

    for (const [key, val] of Object.entries(opts.filters)) {
      if (key === 'direction') {
        where.direction = val === 'true' || val === 'BUY';
      } else if (key.endsWith('_min')) {
        const field = key.replace('_min', '');
        where[field] = { ...where[field], gte: parseFloat(val) };
      } else if (key.endsWith('_max')) {
        const field = key.replace('_max', '');
        where[field] = { ...where[field], lte: parseFloat(val) };
      } else if (key.endsWith('_in')) {
        const field = key.replace('_in', '');
        const values = val.split(',').filter(Boolean);
        if (field === 'status') {
          where[field] = { in: values.map(v => parseInt(v)) };
        } else if (field === 'direction') {
          if (values.length === 1) {
            where.direction = values[0] === 'true';
          }
        } else {
          where[field] = { in: values };
        }
      } else if (key === 'status') {
        where.status = parseInt(val);
      } else {
        where[key] = { contains: val, mode: 'insensitive' };
      }
    }

    const allowedSort = [
      'id', 'deliveryStart', 'deliveryEnd', 'tradeTime', 'quantity', 'price',
      'mcp', 'smp', 'direction', 'contractName', 'contractId', 'productType',
      'username', 'status', 'platformCode', 'areaCode', 'orderType',
      'explanation', 'remoteTradeId', 'remoteOrderId', 'companyName',
      'revisionNo', 'smartbotId', 'alertName',
    ];
    const sortField = allowedSort.includes(opts.sortBy) ? opts.sortBy : 'deliveryStart';

    const MAX_EXPORT = 3000;
    const [transactions, total] = await Promise.all([
      prisma.intradayTransaction.findMany({
        where,
        orderBy: { [sortField]: opts.sortDir },
        take: MAX_EXPORT,
      }),
      prisma.intradayTransaction.count({ where }),
    ]);

    return { transactions, total };
  }

  /**
   * Paginated + filtered + sorted query for transaction grid.
   */
  async getTransactionsPaginated(
    groupId: string,
    companyId: number,
    startDate: string,
    endDate: string,
    opts: {
      page: number;
      pageSize: number;
      sortBy: string;
      sortDir: 'asc' | 'desc';
      filters: Record<string, string>;
    },
  ) {
    const where: any = {
      groupId,
      companyId,
      deliveryStart: { gte: new Date(startDate), lte: new Date(endDate) },
    };

    // Apply column filters
    for (const [key, val] of Object.entries(opts.filters)) {
      if (key === 'direction') {
        where.direction = val === 'true' || val === 'BUY';
      } else if (key.endsWith('_min')) {
        // Numeric range: min
        const field = key.replace('_min', '');
        where[field] = { ...where[field], gte: parseFloat(val) };
      } else if (key.endsWith('_max')) {
        // Numeric range: max
        const field = key.replace('_max', '');
        where[field] = { ...where[field], lte: parseFloat(val) };
      } else if (key.endsWith('_in')) {
        // Multi-select: comma-separated values
        const field = key.replace('_in', '');
        const values = val.split(',').filter(Boolean);
        if (field === 'status') {
          where[field] = { in: values.map(v => parseInt(v)) };
        } else if (field === 'direction') {
          // Prisma Boolean fields don't support `in` — use equals or skip if both selected
          if (values.length === 1) {
            where.direction = values[0] === 'true';
          }
          // If both [true, false] selected → all rows, no filter needed
        } else {
          where[field] = { in: values };
        }
      } else if (key === 'status') {
        where.status = parseInt(val);
      } else {
        // Text contains filter (case-insensitive)
        where[key] = { contains: val, mode: 'insensitive' };
      }
    }

    // Validate sortBy against allowed columns
    const allowedSort = [
      'id', 'deliveryStart', 'deliveryEnd', 'tradeTime', 'quantity', 'price',
      'mcp', 'smp', 'direction', 'contractName', 'contractId', 'productType',
      'username', 'status', 'platformCode', 'areaCode', 'orderType',
      'explanation', 'remoteTradeId', 'remoteOrderId', 'companyName',
      'revisionNo', 'smartbotId', 'alertName',
    ];
    const sortField = allowedSort.includes(opts.sortBy) ? opts.sortBy : 'deliveryStart';

    const [transactions, total] = await Promise.all([
      prisma.intradayTransaction.findMany({
        where,
        orderBy: { [sortField]: opts.sortDir },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
      }),
      prisma.intradayTransaction.count({ where }),
    ]);

    // Summary stats (on full filtered set, not just current page)
    const stats = await prisma.intradayTransaction.aggregate({
      where,
      _sum: { quantity: true },
      _count: true,
    });

    // Buy/sell breakdown + MCP delta (weighted average)
    const [buyStats, sellStats, mcpRows] = await Promise.all([
      prisma.intradayTransaction.aggregate({
        where: { ...where, direction: true },
        _sum: { quantity: true },
        _count: true,
      }),
      prisma.intradayTransaction.aggregate({
        where: { ...where, direction: false },
        _sum: { quantity: true },
        _count: true,
      }),
      // Fetch rows with MCP for weighted delta calc
      prisma.intradayTransaction.findMany({
        where: { ...where, mcp: { not: null } },
        select: { direction: true, quantity: true, price: true, mcp: true },
      }),
    ]);

    // Weighted MCP Delta: Buy = (MCP-Price)*Qty / sumQty, Sell = (Price-MCP)*Qty / sumQty
    const buyMcp = mcpRows.filter(r => r.direction === true);
    const sellMcp = mcpRows.filter(r => r.direction === false);

    const buyQtySum = buyMcp.reduce((s, r) => s + r.quantity, 0);
    const weightedBuyDelta = buyQtySum > 0
      ? buyMcp.reduce((s, r) => s + (r.mcp! - r.price) * r.quantity, 0) / buyQtySum
      : null;

    const sellQtySum = sellMcp.reduce((s, r) => s + r.quantity, 0);
    const weightedSellDelta = sellQtySum > 0
      ? sellMcp.reduce((s, r) => s + (r.price - r.mcp!) * r.quantity, 0) / sellQtySum
      : null;

    return {
      transactions,
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      totalPages: Math.ceil(total / opts.pageSize),
      stats: {
        totalBuyMWh: buyStats._sum.quantity ?? 0,
        totalSellMWh: sellStats._sum.quantity ?? 0,
        buyCount: buyStats._count,
        sellCount: sellStats._count,
        weightedBuyDelta,
        weightedSellDelta,
      },
    };
  }
}
