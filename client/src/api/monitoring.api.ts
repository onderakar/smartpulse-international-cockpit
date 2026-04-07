/** Stub monitoring API — will be implemented when monitoring integration is built. */

interface RawMetricPoint {
  timestamp: number
  value: number
  type: string
}

export const monitoringApi = {
  testMetric: async (_masternode: string, _node: string, _nodeidentity: number): Promise<any> => {
    console.warn('[monitoringApi] testMetric not implemented');
    return {};
  },
  refetchLiveMetricsDay: async (
    _gcpId: number,
    _companyId: number,
    _startIso: string,
    _endIso: string,
  ): Promise<void> => {
    console.warn('[monitoringApi] refetchLiveMetricsDay not implemented');
  },
  getLiveData: async (_masternode: string, _metrics: any[]): Promise<any> => {
    console.warn('[monitoringApi] getLiveData not implemented');
    return { data: [] };
  },
  getLiveMetricsV2: async (
    _gcpId: number,
    _companyId: number,
    _startIso: string,
    _endIso: string,
  ): Promise<RawMetricPoint[]> => {
    console.warn('[monitoringApi] getLiveMetricsV2 not implemented');
    return [];
  },
};
