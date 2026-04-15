import { apiClient } from './client';

export interface IntradayRefreshResult {
  newTransactions: number;
  skipped: number;
  aggregated: { inserted: number; skipped: number };
}

export interface IntradayTransactionDto {
  id: number;
  remoteTradeId: string;
  companyId: number;
  companyName: string;
  deliveryStart: string;
  deliveryEnd: string;
  direction: boolean;
  quantity: number;
  price: number;
  tradeTime: string;
  contractId: string | null;
  contractName: string | null;
  productType: string | null;
  status: number;
  revisionNo: number;
  username: string | null;
  explanation: string | null;
  platformCode: string | null;
  areaCode: string | null;
  orderType: string | null;
  remoteOrderId: string | null;
  mcp: number | null;
  smp: number | null;
  smartbotId: number | null;
  alertName: string | null;
}

export interface PaginatedTransactionsResponse {
  transactions: IntradayTransactionDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats: {
    totalBuyMWh: number;
    totalSellMWh: number;
    buyCount: number;
    sellCount: number;
    weightedBuyDelta: number | null;
    weightedSellDelta: number | null;
  };
}

export interface TransactionQuery {
  companyId: number;
  startDate: string;
  endDate: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  filters?: Record<string, string>;
}

export const intradayApi = {
  async refresh(companyIds: number[], startDate: string, endDate: string): Promise<IntradayRefreshResult> {
    const { data } = await apiClient.post('/intraday/refresh', { companyIds, startDate, endDate });
    return data;
  },

  async getTransactions(query: TransactionQuery): Promise<PaginatedTransactionsResponse> {
    const params: Record<string, any> = {
      companyId: query.companyId,
      startDate: query.startDate,
      endDate: query.endDate,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 50,
    };
    if (query.sortBy) params.sortBy = query.sortBy;
    if (query.sortDir) params.sortDir = query.sortDir;
    if (query.filters) {
      for (const [k, v] of Object.entries(query.filters)) {
        if (v) params[k] = v;
      }
    }
    const { data } = await apiClient.get('/intraday/transactions', { params });
    return data;
  },

  async getDistinctValues(
    companyId: number,
    startDate: string,
    endDate: string,
    column: string,
  ): Promise<string[]> {
    const { data } = await apiClient.get('/intraday/transactions/distinct', {
      params: { companyId, startDate, endDate, column },
    });
    return data.values;
  },

  async exportAll(query: Omit<TransactionQuery, 'page' | 'pageSize'>): Promise<{ transactions: IntradayTransactionDto[]; total: number }> {
    const params: Record<string, any> = {
      companyId: query.companyId,
      startDate: query.startDate,
      endDate: query.endDate,
    };
    if (query.sortBy) params.sortBy = query.sortBy;
    if (query.sortDir) params.sortDir = query.sortDir;
    if (query.filters) {
      for (const [k, v] of Object.entries(query.filters)) {
        if (v) params[k] = v;
      }
    }
    const { data } = await apiClient.get('/intraday/transactions/export', { params });
    return data;
  },

  async getHeatmapData(
    companyId: number,
    startDate: string,
    endDate: string,
  ): Promise<HeatmapResponse> {
    const { data } = await apiClient.get('/intraday/transactions/heatmap', {
      params: { companyId, startDate, endDate },
    });
    return data;
  },
};

export interface HeatmapResponse {
  deliverySlots: string[];
  bucketLabels: string[];
  data: Array<[number, number, number, { buyQty: number; sellQty: number; count: number; avgPrice: number }]>;
}
