import { apiClient } from './client';

export interface PortfolioMappingDto {
  id: number;
  portfolioType: string;
  externalId: string;
  displayName: string | null;
  companyId: number;
  companyName: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface DamPortfoliosResponse {
  portfolios: string[];
  sourceVersion: { versionNo: number; fetchedAt: string } | null;
  message?: string;
}

export const portfolioMappingApi = {
  async getMappings(): Promise<{ mappings: PortfolioMappingDto[] }> {
    const { data } = await apiClient.get('/portfolio-mapping');
    return data;
  },

  async getDamPortfolios(): Promise<DamPortfoliosResponse> {
    const { data } = await apiClient.get('/portfolio-mapping/dam-portfolios');
    return data;
  },

  async saveMappings(portfolioType: string, mappings: Array<{ externalId: string; companyId: number }>): Promise<{ saved: number }> {
    const { data } = await apiClient.put('/portfolio-mapping', { portfolioType, mappings });
    return data;
  },

  async deleteMapping(id: number): Promise<void> {
    await apiClient.delete(`/portfolio-mapping/${id}`);
  },
};
