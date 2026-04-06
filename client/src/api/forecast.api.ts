import { apiClient } from './client';
import { ForecastResponse, ForecastSubmissionRequest, ForecastSubmissionResponse } from '@smartpulse-intl/shared';

export interface ForecastValuesParams {
  companyId: number;
  powerPlantId: number;
  provider: string;
  startDate: string; // DD/MM/YYYY
  endDate: string;   // DD/MM/YYYY
  minute: number;
  hour?: string;
  columnId?: number[];
}

export interface ForecastSubmitParams {
  providerName: string;
  measureUnit?: number;
  description?: string;
  forecasts: ForecastSubmissionRequest['forecasts'];
}

export const forecastApi = {
  async getValues(params: ForecastValuesParams): Promise<ForecastResponse> {
    const { data } = await apiClient.post('/forecast/values', params);
    return data;
  },

  async submitForecast(params: ForecastSubmitParams): Promise<ForecastSubmissionResponse> {
    const { data } = await apiClient.post('/forecast/submit', params);
    return data;
  },
};
