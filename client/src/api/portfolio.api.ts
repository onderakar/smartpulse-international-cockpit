import { apiClient } from './client';

export const portfolioApi = {
  async refresh(): Promise<{ success: boolean; entityUnitCount: number; portfolioCount: number; totalPortfolioUnits: number }> {
    const { data } = await apiClient.post('/portfolio/refresh');
    return data;
  },
};
