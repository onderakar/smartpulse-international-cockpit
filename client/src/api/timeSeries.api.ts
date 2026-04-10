import { apiClient } from './client';

export interface TimeSeriesPoint {
  deliveryStart: string;
  value: number;
  observedAt: string;
  source: string;
}

export const timeSeriesApi = {
  async getMultiSeries(
    entityType: string,
    entityId: string,
    seriesKeys: string[],
    dateStart: string,
    dateEnd: string,
  ): Promise<Record<string, TimeSeriesPoint[]>> {
    const { data } = await apiClient.get('/time-series/multi', {
      params: { entityType, entityId, seriesKeys: seriesKeys.join(','), dateStart, dateEnd },
    });
    return data;
  },

  async getSlotHistory(
    entityType: string,
    entityId: string,
    seriesKey: string,
    deliveryStart: string,
  ): Promise<Array<{ observedAt: string; value: number; source: string; isFinal: boolean }>> {
    const { data } = await apiClient.get('/time-series/history', {
      params: { entityType, entityId, seriesKey, deliveryStart },
    });
    return data;
  },
};
