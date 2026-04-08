import { AssetMapping } from './assetMapping.types';
import { MTUResolution } from './plant.types';
import { AttributeDefinition } from './attributes.types';
import { PortfolioSnapshot } from './portfolio.types';

export interface PollingConfig {
  intervalSeconds: number;
  maxWindowHours: number;
  incrementalWindowMinutes: number;
  scheduleIntervalSeconds?: number;
}

export type WidgetType = 'live-monitoring' | 'market-prices' | 'company-trading' | 'current-schedule' | 'live-battery-power' | 'energy-flow' | 'gip-market';

export interface WidgetLayoutItem {
  widgetId: string;
  widgetType: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

/** Group-level settings shared across all users in the same group */
export interface GroupProfile {
  id: string;
  name: string;
  portalEnv: 'prod' | 'staging' | 'demo';
  assetMapping: AssetMapping;
  polling: PollingConfig;
  monitoringCredentials?: {
    username: string;
    password: string;
  };
  graphQlApiKey?: string;
  scheduleBapEditable?: boolean;
  /** Sistem geneli varsayılan zaman çözünürlüğü. GCP override yoksa bu değer kullanılır. Default: 15 */
  defaultResolutionMinutes?: MTUResolution;
  /** Admin-defined attribute definitions (beyond system seed) */
  customAttributeDefinitions?: AttributeDefinition[];
  /** Portfolio mapping fetched from SmartPulse Portal (portfolioNo → data) */
  portfolioSnapshot?: PortfolioSnapshot;
  createdAt: string;
  updatedAt: string;
}

/** User-level settings personal to each user */
export interface UserProfile {
  id: string;
  groupId: string;
  widgetLayout?: WidgetLayoutItem[];
  createdAt: string;
  updatedAt: string;
}

/** Merged view combining group + user settings (backward-compatible) */
export interface DashboardProfile {
  id: string;
  name: string;
  portalEnv: 'prod' | 'staging' | 'demo';
  assetMapping: AssetMapping;
  polling: PollingConfig;
  monitoringCredentials?: {
    username: string;
    password: string;
  };
  graphQlApiKey?: string;
  scheduleBapEditable?: boolean;
  defaultResolutionMinutes?: MTUResolution;
  customAttributeDefinitions?: AttributeDefinition[];
  portfolioSnapshot?: PortfolioSnapshot;
  widgetLayout?: WidgetLayoutItem[];
  groupId?: string;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_POLLING_CONFIG: PollingConfig = {
  intervalSeconds: 60,
  maxWindowHours: 3,
  incrementalWindowMinutes: 10,
  scheduleIntervalSeconds: 300,
};
