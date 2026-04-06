import { apiClient } from './client';
import { PortalPlant, PortalCompany, PortalGroup } from '@shared/types/auth.types';
import { DashboardProfile } from '@shared/types/dashboard.types';

export interface LoginParams {
  username: string;
  password: string;
  env: string;
}

export interface LoginResult {
  plants: PortalPlant[];
  companies: PortalCompany[];
  groups: PortalGroup[];
  groupId: number;
  groupName: string;
  username: string;
  profile: DashboardProfile | null;
}

export interface SessionCheckResult {
  loggedIn: boolean;
  plants?: PortalPlant[];
  companies?: PortalCompany[];
  username?: string;
  groupId?: number;
  groupName?: string;
}

export const authApi = {
  async login(params: LoginParams): Promise<LoginResult> {
    const { data } = await apiClient.post('/auth/portal-login', params);
    return data;
  },

  async checkSession(): Promise<SessionCheckResult> {
    const { data } = await apiClient.post('/auth/portal-check');
    return data;
  },

  async logout(): Promise<void> {
    await apiClient.post('/auth/portal-logout');
  },
};
