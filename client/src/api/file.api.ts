import { apiClient } from './client';

export interface FileSourceDto {
  id: number;
  key: string;
  displayName: string;
  filename: string;
  direction: string;
  fileType: string | null;
  intervalMinutes: number;
  enabled: boolean;
  parserKey: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  versions?: Array<{
    id: number;
    versionNo: number;
    fetchedAt: string;
    contentHash: string;
    sizeBytes: number;
  }>;
}

export interface LatestParsedDto<T = unknown> {
  raw: string;
  parsed: T | null;
  parseError?: string | null;
  fileType: string;
  versionNo: number;
  fetchedAt: string;
  contentHash: string;
  sizeBytes: number;
}

export const fileApi = {
  // Sources CRUD
  async listSources(): Promise<FileSourceDto[]> {
    const { data } = await apiClient.get('/files/sources');
    return data;
  },
  async createSource(input: Partial<FileSourceDto>): Promise<FileSourceDto> {
    const { data } = await apiClient.post('/files/sources', input);
    return data;
  },
  async updateSource(id: number, input: Partial<FileSourceDto>): Promise<FileSourceDto> {
    const { data } = await apiClient.put(`/files/sources/${id}`, input);
    return data;
  },
  async deleteSource(id: number): Promise<void> {
    await apiClient.delete(`/files/sources/${id}`);
  },

  // Versions
  async getLatestParsed<T = unknown>(key: string): Promise<LatestParsedDto<T>> {
    const { data } = await apiClient.get(`/files/${key}/latest/parsed`);
    return data;
  },
  async getVersions(key: string, take = 20, skip = 0) {
    const { data } = await apiClient.get(`/files/${key}/versions`, { params: { take, skip } });
    return data;
  },

  // Actions
  async forceRead(key: string): Promise<{ created: boolean; versionId?: number; versionNo?: number }> {
    const { data } = await apiClient.post(`/files/${key}/force-read`);
    return data;
  },
  async forceReadAndSync(key: string): Promise<any> {
    const { data } = await apiClient.post(`/files/${key}/force-read-and-sync`);
    return data;
  },
  async test(key: string): Promise<{ rawContent: string; parsed: unknown; fileType: string; sizeBytes: number }> {
    const { data } = await apiClient.post(`/files/${key}/test`);
    return data;
  },
  async saveBack(key: string, content: string): Promise<{ success: boolean; message: string }> {
    const { data } = await apiClient.post(`/files/${key}/save`, { content });
    return data;
  },
};
