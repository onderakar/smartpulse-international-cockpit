import axios, { AxiosInstance } from 'axios';
import { PORTAL_BASE_URLS } from '../config/env';
import { ForecastResponse, ForecastSubmissionRequest } from '@smartpulse-intl/shared';

export interface ForecastParams {
  companyId: number;
  powerPlantId: number;
  provider: string;
  startDate: string; // DD/MM/YYYY
  endDate: string;   // DD/MM/YYYY
  minute: number;
  hour?: string;
  columnId?: number[];
}

export class ForecastService {
  private getBaseUrl(env: string): string {
    return PORTAL_BASE_URLS[env] || PORTAL_BASE_URLS.prod;
  }

  private createClient(cookies: string[], env: string): AxiosInstance {
    return axios.create({
      baseURL: this.getBaseUrl(env),
      timeout: 15_000,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookies.join('; '),
      },
    });
  }

  /**
   * Fetch provider forecast values for a power plant.
   * Uses the Configuration/GetPowerPlantValues portal endpoint.
   */
  async getPowerPlantValues(
    cookies: string[],
    env: string,
    params: ForecastParams,
  ): Promise<ForecastResponse> {
    const client = this.createClient(cookies, env);
    const response = await client.post('/Configuration/GetPowerPlantValues', {
      startDate: params.startDate,
      endDate: params.endDate,
      companyId: params.companyId,
      powerPlantId: params.powerPlantId,
      columnId: params.columnId || [2],
      hour: params.hour || '00:00',
      minute: params.minute,
      provider: params.provider,
      backdays: -1,
    });
    return response.data;
  }

  /**
   * Submit a production forecast for a battery (BESS) unit as a forecast provider.
   *
   * URL:  POST /api/production-forecast/forecasts/resolution/{providerName}
   * Auth: Session cookie from Login/Login (same as other portal endpoints)
   *
   * Based on working VBA client reference — key differences from Postman docs:
   *  - URL path includes "resolution/" segment
   *  - Auth via Cookie, not Bearer token
   */
  async submitForecast(
    cookies: string[],
    env: string,
    providerName: string,
    body: ForecastSubmissionRequest,
  ): Promise<any> {
    const client = this.createClient(cookies, env);
    const url = `/api/production-forecast/forecasts/resolution/${encodeURIComponent(providerName)}`;
    const fullUrl = `${this.getBaseUrl(env)}${url}`;
    console.log(`[ForecastService] POST ${fullUrl}`);
    console.log(`[ForecastService] Cookies count: ${cookies.length}, first cookie prefix: ${cookies[0]?.substring(0, 30) ?? 'NONE'}...`);
    const response = await client.post(url, body);
    console.log(`[ForecastService] Response status: ${response.status}`);
    console.log(`[ForecastService] Response content-type: ${response.headers['content-type']}`);
    console.log(`[ForecastService] Response data type: ${typeof response.data}, isNull: ${response.data === null}`);
    if (typeof response.data === 'string') {
      console.log(`[ForecastService] Response is STRING (first 200 chars): ${response.data.substring(0, 200)}`);
    }
    return response.data;
  }
}
