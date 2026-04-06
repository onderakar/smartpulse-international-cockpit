import dotenv from 'dotenv';
import path from 'path';
// Load .env from project root (parent of server/)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Resolve DB path relative to server directory (not CWD)
const defaultDbPath = path.resolve(__dirname, '../../data/db.json');

export const envConfig = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  SESSION_SECRET: process.env.SESSION_SECRET || 'change-me-in-production',
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  // Portal environment base URL
  PORTAL_BASE_URL: process.env.PORTAL_BASE_URL || 'https://portal.smartpulse.io',

  // Monitoring API base URL
  MONITORING_BASE_URL: process.env.MONITORING_BASE_URL || 'https://api.connectivity.smartpulse.io',

  // LowDB database file path
  DB_PATH: process.env.DB_PATH || defaultDbPath,

  // Worker Credentials
  PORTAL_USERNAME: process.env.PORTAL_USERNAME,
  PORTAL_PASSWORD: process.env.PORTAL_PASSWORD,

  // SSO / OAuth2 settings for Production Forecast API
  HUB_CLIENT_ID: process.env.HUB_CLIENT_ID || 'd6lVs0aLV_T7UUf0P2wkXGVHrLoa',
} as const;

export const PORTAL_BASE_URLS: Record<string, string> = {
  prod: 'https://portal.smartpulse.io',
  staging: 'https://portal.staging.smartpulse.io',
  demo: 'https://portal.demo.smartpulse.io',
};

// SSO HUB URLs per environment (domain: smartuser.io)
export const HUB_BASE_URLS: Record<string, string> = {
  prod: 'https://hub.smartuser.io',
  staging: 'https://hub-test.smartuser.io',
  demo: 'https://hub-test.smartuser.io',
};
