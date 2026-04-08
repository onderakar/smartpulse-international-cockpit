import { apiClient } from './client';
import type { RawMetricPoint } from '@shared/types/monitoring.types';

export const monitoringApi = {
  async login(credentials: { username: string; password: string }) {
    const { data } = await apiClient.post('/monitoring/login', credentials);
    return data as { success: boolean; expiresAt: number };
  },

  async getLiveMetricsV2(
    gcpId: number,
    companyId: number,
    startIso: string,
    endIso: string,
  ): Promise<RawMetricPoint[]> {
    const { data } = await apiClient.get('/monitoring/v2/metrics', {
      params: { gcpId, companyId, start: startIso, end: endIso },
    });
    return data;
  },

  async refetchLiveMetricsDay(
    gcpId: number,
    companyId: number,
    startIso: string,
    endIso: string,
  ): Promise<{ success: boolean; message: string }> {
    const { data } = await apiClient.post('/monitoring/v2/refetch', {
      gcpId, companyId, start: startIso, end: endIso,
    });
    return data;
  },

  async testMetric(
    masternode: string,
    node: string,
    nodeidentity: number,
  ): Promise<{ success: boolean; count: number; sample: any }> {
    const { data } = await apiClient.post('/monitoring/v2/test-metric', {
      masternode, node, nodeidentity,
    });
    return data;
  },
};
