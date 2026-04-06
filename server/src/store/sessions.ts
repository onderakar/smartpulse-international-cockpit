import { PortalPlant, PortalCompany, PortalGroup } from '@smartpulse-intl/shared';

export interface UserSession {
  username: string;
  portalAccessToken: string;
  oauthAccessToken: string;
  graphQlAuthKey: string;
  portalCookies: string[];
  plants: PortalPlant[];
  companies: PortalCompany[];
  groups: PortalGroup[];
  groupId: number;
  groupName: string;
  env: string;
  loginTimestamp: number;
}

export interface MonitoringTokenEntry {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

// Extend express-session to include our custom data
declare module 'express-session' {
  interface SessionData {
    portalSession?: UserSession;
  }
}
