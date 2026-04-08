import { apiClient } from './client';
import { TechnicalParameters, MultiBatteryTechParams } from '@shared/types/techParams.types';

export const ftpApi = {
  async readFile(direction: string, filename: string): Promise<{ data: string }> {
    const { data } = await apiClient.post('/ftp/read', { direction, filename });
    return data;
  },

  async readTechParams(direction: string, filename: string): Promise<{ raw: string; parsed: TechnicalParameters }> {
    const { data } = await apiClient.post('/ftp/read-tech-params', { direction, filename });
    return data;
  },

  async writeFile(direction: string, filename: string, content: string): Promise<{ message: string }> {
    const { data } = await apiClient.post('/ftp/write', { direction, filename, data: content });
    return data;
  },

  async readMultiTechParams(direction: string, filename: string): Promise<{ raw: string; parsed: MultiBatteryTechParams }> {
    const { data } = await apiClient.post('/ftp/read-multi-tech-params', { direction, filename });
    return data;
  },

  async writeMultiTechParams(direction: string, filename: string, params: MultiBatteryTechParams): Promise<{ message: string }> {
    const { data } = await apiClient.post('/ftp/write-tech-params', { direction, filename, params });
    return data;
  },

  async syncAttributes(direction: string, filename: string): Promise<{ success: boolean; gcpsUpdated: number; componentsUpdated: number; skipped: number }> {
    const { data } = await apiClient.post('/ftp/sync-attributes', { direction, filename });
    return data;
  },
};
