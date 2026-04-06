import { apiClient } from './client';
import { DashboardProfile } from '@shared/types/dashboard.types';
import { GipWsConfig } from '@shared/types/gip.types';

export const configApi = {
  async loadProfile(): Promise<DashboardProfile | null> {
    const { data } = await apiClient.get('/config/profile');
    return data.profile;
  },

  async saveProfile(profile: DashboardProfile): Promise<{ success: boolean; profileId: string }> {
    const { data } = await apiClient.post('/config/profile', { profile });
    return data;
  },

  async getPlantsResolution(): Promise<any> {
    const { data } = await apiClient.post('/config/plants-resolution');
    return data;
  },

  async testGqlQuery(query: string): Promise<any> {
    const { data } = await apiClient.post('/config/test-gql', { query });
    return data;
  },

  async getGipWsConfig(): Promise<GipWsConfig> {
    const { data } = await apiClient.get('/config/gip-ws-config');
    return data;
  },
};
