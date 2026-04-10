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
  contractName: string | null;
  productType: string | null;
  status: number;
  explanation: string | null;
}

export const intradayApi = {
  async refresh(companyIds: number[], startDate: string, endDate: string): Promise<IntradayRefreshResult> {
    const { data } = await apiClient.post('/intraday/refresh', { companyIds, startDate, endDate });
    return data;
  },

  async getTransactions(companyId: number, startDate: string, endDate: string): Promise<{ transactions: IntradayTransactionDto[]; count: number }> {
    const { data } = await apiClient.get('/intraday/transactions', {
      params: { companyId, startDate, endDate },
    });
    return data;
  },
};
