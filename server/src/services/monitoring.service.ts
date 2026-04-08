import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { envConfig } from '../config/env';

export interface MetricsRequestParams {
  masternode: string;
  node: string;
  nodeidentity: number;
  start: string;
  end: string;
}

export class MonitoringService {
  async getMetrics(token: string, params: MetricsRequestParams): Promise<any> {
    const response = await axios.post(
      `${envConfig.MONITORING_BASE_URL}/api/v1/metrics/get`,
      {
        transactionid: uuidv4(),
        masternode: params.masternode,
        node: params.node,
        nodeidentity: params.nodeidentity,
        start: params.start,
        end: params.end,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
      }
    );

    return response.data;
  }
}
