import axios, { AxiosInstance } from 'axios';
import { PORTAL_BASE_URLS, HUB_BASE_URLS, envConfig } from '../config/env';
import { PortalPlant, PortalCompany, PortalGroup } from '@smartpulse-intl/shared';

export interface PortalLoginResult {
  accessToken: string;
  oauthAccessToken: string;
  graphQlAuthKey: string;
  plants: PortalPlant[];
  companies: PortalCompany[];
  groups: PortalGroup[];
  cookies: string[];
}

export interface PortalSessionInfo {
  valid: boolean;
  plants: PortalPlant[];
  companies: PortalCompany[];
  groups: PortalGroup[];
}

export class PortalAuthService {
  private getBaseUrl(env: string): string {
    return PORTAL_BASE_URLS[env] || PORTAL_BASE_URLS.prod;
  }

  private getHubUrl(env: string): string {
    return HUB_BASE_URLS[env] || HUB_BASE_URLS.prod;
  }

  private createClient(env: string): AxiosInstance {
    return axios.create({
      baseURL: this.getBaseUrl(env),
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Parse Permissions object (shared between Login and CheckUserLoggedIn) */
  private parsePermissions(data: any): { plants: PortalPlant[]; companies: PortalCompany[]; groups: PortalGroup[] } {
    const perms = data.Permissions || data.permissions || data;

    const plantsRaw = perms.plants || perms.Plants || [];
    const plants: PortalPlant[] = (Array.isArray(plantsRaw) ? plantsRaw : []).map((p: any) => ({
      id: p.id || p.Id,
      name: p.name || p.Name || p.fullName || p.FullName,
      power: p.power || p.Power || 0,
      timezone: p.timezone || p.Timezone || p.timeZone || 'Europe/Istanbul',
      typeid: p.typeid || p.typeId || p.TypeId || 0,
      isSfc: p.isSfc ?? p.IsSfc ?? false,
    }));

    const companiesRaw = perms.companies || perms.Companies || [];
    const companies: PortalCompany[] = (Array.isArray(companiesRaw) ? companiesRaw : []).map((c: any) => ({
      id: c.id || c.Id,
      name: c.name || c.Name || '',
      fullName: c.fullname || c.fullName || c.FullName || c.name || c.Name || '',
      timezone: c.timezone || c.Timezone || c.timeZone || 'Europe/Istanbul',
      powerPlantIds: c.powerplants || c.powerPlants || c.PowerPlants || [],
    }));

    const groupsRaw = perms.groups || perms.Groups || [];
    const groups: PortalGroup[] = (Array.isArray(groupsRaw) ? groupsRaw : []).map((g: any) => ({
      id: g.id || g.Id,
      name: g.name || g.Name || '',
      timezone: g.timezone || g.Timezone || g.timeZone || 'Europe/Istanbul',
      companies: g.companies || g.Companies || [],
    }));

    return { plants, companies, groups };
  }

  /**
   * Acquire an OAuth2 access token from the HUB/SSO server.
   * Required for the Production Forecast API.
   *
   * Flow (from docs):
   *   POST https://hub.smartuser.io/oauth2/token  (prod)
   *   POST https://hub-test.smartuser.io/oauth2/token  (staging)
   *
   * Body: grant_type=password&username=...&password=...&redirect_uri=myapp://auth
   *        &client_id=d6lVs0aLV_T7UUf0P2wkXGVHrLoa&scope=openid
   */
  async getOAuthToken(username: string, password: string, env: string): Promise<string> {
    const hubBaseUrl = this.getHubUrl(env);
    const clientId = envConfig.HUB_CLIENT_ID;
    if (!clientId) {
      console.warn('[PortalAuth] HUB_CLIENT_ID not configured — OAuth2 token unavailable');
      return '';
    }

    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'password');
      params.append('username', username);
      params.append('password', password);
      params.append('redirect_uri', 'myapp://auth');
      params.append('client_id', clientId);
      params.append('scope', 'openid');

      console.log(`[PortalAuth] Requesting OAuth2 token from ${hubBaseUrl}/oauth2/token for user=${username}`);

      const response = await axios.post(`${hubBaseUrl}/oauth2/token`, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      });
      const token = response.data?.access_token || '';
      if (token) {
        console.log(`[PortalAuth] OAuth2 token acquired from HUB (${hubBaseUrl}), token length=${token.length}`);
      } else {
        console.warn('[PortalAuth] HUB responded 200 but no access_token in body:', JSON.stringify(response.data).slice(0, 200));
      }
      return token;
    } catch (err: any) {
      console.error(`[PortalAuth] OAuth2 token acquisition failed (${hubBaseUrl}):`, err.response?.status, err.response?.data || err.message);
      return '';
    }
  }

  async login(username: string, password: string, env: string): Promise<PortalLoginResult> {
    // OAuth2 token is NOT needed — forecast submission uses session cookies.
    // The getOAuthToken method is kept for future use if needed.
    const oauthAccessToken = '';

    const client = this.createClient(env);

    const response = await client.post('/Login/Login', { username, password });
    const data = response.data;

    // Extract Set-Cookie headers
    const cookies = response.headers['set-cookie'] || [];

    const { plants, companies, groups } = this.parsePermissions(data);

    console.log(`[PortalAuth] Login: ${plants.length} plants, ${companies.length} companies, ${groups.length} groups, portalToken=${(data.AccessToken || data.accessToken) ? 'yes' : 'no'}`);

    return {
      accessToken: data.AccessToken || data.accessToken || '',
      oauthAccessToken,
      graphQlAuthKey: data.GraphQlAuthKey || data.graphQlAuthKey || '',
      plants,
      companies,
      groups,
      cookies: Array.isArray(cookies) ? cookies : [cookies],
    };
  }

  async checkSession(cookies: string[], env: string): Promise<PortalSessionInfo> {
    try {
      const client = this.createClient(env);
      const response = await client.post('/Login/CheckUserLoggedIn', {}, {
        headers: {
          Cookie: cookies.join('; '),
        },
      });

      if (response.status !== 200 || response.data === false) {
        return { valid: false, plants: [], companies: [], groups: [] };
      }

      // CheckUserLoggedIn returns full Permissions with companies & plants
      const { plants, companies, groups } = this.parsePermissions(response.data);

      console.log(`[PortalAuth] CheckSession: ${plants.length} plants, ${companies.length} companies, ${groups.length} groups`);

      return { valid: true, plants, companies, groups };
    } catch {
      return { valid: false, plants: [], companies: [], groups: [] };
    }
  }

  async getPlantsResolution(cookies: string[], env: string): Promise<any> {
    const client = this.createClient(env);
    const response = await client.post('/Configuration/GetPlantsResolution', {}, {
      headers: {
        Cookie: cookies.join('; '),
      },
    });
    return response.data;
  }
}
