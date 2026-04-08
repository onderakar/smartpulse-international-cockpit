import axios from 'axios';
import { envConfig } from '../config/env';
import { MonitoringTokenEntry } from '../store/sessions';

const TOKEN_REFRESH_BUFFER_MS = 60_000; // refresh 60s before expiry

export class MonitoringAuthService {
  private tokens: Map<string, MonitoringTokenEntry> = new Map();
  private credentials: Map<string, { username: string; password: string }> = new Map();

  async login(username: string, password: string, sessionId: string): Promise<MonitoringTokenEntry> {
    const response = await axios.post(`${envConfig.MONITORING_BASE_URL}/api/v1/auth/login`, {
      username,
      password,
    }, {
      timeout: 15_000,
    });

    const entry: MonitoringTokenEntry = {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresAt: Date.now() + (response.data.expires_in * 1000),
    };
    this.tokens.set(sessionId, entry);
    this.credentials.set(sessionId, { username, password });
    return entry;
  }

  async getValidToken(sessionId: string): Promise<string> {
    const entry = this.tokens.get(sessionId);
    if (!entry) {
      const newToken = await this.tryReLogin(sessionId);
      if (newToken) return newToken;

      const err: any = new Error('Monitoring API not authenticated');
      err.code = 'MONITORING_NOT_AUTHENTICATED';
      throw err;
    }

    if (Date.now() >= entry.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.refresh(sessionId, entry);
    }
    return entry.accessToken;
  }

  invalidateToken(sessionId: string): void {
    this.tokens.delete(sessionId);
  }

  async tryReLogin(sessionId: string): Promise<string | null> {
    const creds = this.credentials.get(sessionId);
    if (!creds) return null;
    try {
      const entry = await this.login(creds.username, creds.password, sessionId);
      return entry.accessToken;
    } catch {
      return null;
    }
  }

  private async refresh(sessionId: string, entry: MonitoringTokenEntry): Promise<string> {
    try {
      const response = await axios.post(`${envConfig.MONITORING_BASE_URL}/api/v1/auth/renew`, {
        refresh_token: entry.refreshToken,
      }, {
        timeout: 15_000,
      });

      const updated: MonitoringTokenEntry = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: Date.now() + (response.data.expires_in * 1000),
      };
      this.tokens.set(sessionId, updated);
      return updated.accessToken;
    } catch {
      const newToken = await this.tryReLogin(sessionId);
      if (newToken) return newToken;
      throw new Error('Token refresh and re-login both failed');
    }
  }

  removeSession(sessionId: string): void {
    this.tokens.delete(sessionId);
    this.credentials.delete(sessionId);
  }
}
