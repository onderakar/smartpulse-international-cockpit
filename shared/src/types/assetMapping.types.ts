import { MTUResolution } from './plant.types';

export type MetricTag = 'SoC' | 'ActivePower' | 'Power' | 'Other';

export interface LabeledMetricMapping {
  tag: MetricTag;
  customLabel?: string;
  node: string;
  nodeidentity: number;
}

export interface BapSource {
  tag: 'ActivePower';
  source: 'response.data.bap';
}

export type ComponentType = 'BESS' | 'SOLAR' | 'WIND' | 'HYDRO' | 'THERMAL' | 'LOAD' | 'OTHER';

export interface GcpComponent {
  componentId: string;
  type: ComponentType;
  displayName: string;
  portalPlantId: number;
  forecastPreference: {
    sourceName: string;
    beforeMinutes: number;
  };

  scheduleId?: string;
  /** Template pattern for schedule FTP filename, e.g. "Battery_Schedule_{GCP_ID}.csv"
   *  Supported placeholders: {GCP_ID}, {ASSET_ID}, {SCHEDULE_ID}, {GCP_NAME} */
  scheduleFilePattern?: string;

  monitoring?: {
    masternode: string;
    metrics: Array<LabeledMetricMapping | BapSource>;
  };
}

export interface GridConnectionPoint {
  /** Numeric ID — user-entered now, will map to portal GCP entity in the future */
  id: number;
  name: string;
  timezone: string;
  /** Default: 15 (quarter-hourly) */
  resolutionMinutes: MTUResolution;
  components: GcpComponent[];
}

export interface CompanyMapping {
  companyId: number;
  companyName: string;
  fullName?: string;
  timezone: string;
  gridConnectionPoints: GridConnectionPoint[];
}

export interface AssetMapping {
  companies: CompanyMapping[];
  ftpDirection: 'incoming' | 'outgoing';
  ftpFilename: string;
}

/** Get the first GCP across all companies. */
export function getFirstGcp(mapping: AssetMapping | null | undefined): GridConnectionPoint | null {
  if (!mapping?.companies?.length) return null;
  for (const company of mapping.companies) {
    if (company.gridConnectionPoints?.length) return company.gridConnectionPoints[0];
  }
  return null;
}

/** Get all GCPs across all companies. */
export function getAllGcps(mapping: AssetMapping | null | undefined): GridConnectionPoint[] {
  if (!mapping?.companies?.length) return [];
  return mapping.companies.flatMap(c => c.gridConnectionPoints || []);
}

/** Info about a BESS component within a GCP. One entry per BESS component (flattened). */
export interface BessGcpInfo {
  gcpId: number;
  gcpName: string;
  timezone: string;
  bessComponent: GcpComponent;
}

/** Get all GCPs that contain a BESS component with a valid portalPlantId. */
export function getBessGcps(mapping: AssetMapping | null | undefined): BessGcpInfo[] {
  if (!mapping?.companies) return [];
  const result: BessGcpInfo[] = [];
  for (const company of mapping.companies) {
    for (const gcp of (company.gridConnectionPoints || [])) {
      for (const comp of gcp.components) {
        if (comp.type === 'BESS' && comp.portalPlantId > 0) {
          result.push({
            gcpId: gcp.id,
            gcpName: gcp.name,
            timezone: gcp.timezone,
            bessComponent: comp,
          });
        }
      }
    }
  }
  return result;
}

/** Migrate old AssetMapping formats to current format. */
export function migrateAssetMapping(raw: any): AssetMapping {
  // Already in current format
  if (raw?.companies && Array.isArray(raw.companies)) {
    // Migrate uevcbs → gridConnectionPoints if needed
    const companies = raw.companies.map((c: any) => {
      if (c.gridConnectionPoints) return c;
      if (c.uevcbs) {
        return {
          ...c,
          gridConnectionPoints: c.uevcbs.map((u: any) => {
            // primaryPortalPlantId is preferred; uevcbId was string so parse it
            const numId = u.primaryPortalPlantId ?? (typeof u.uevcbId === 'string' ? parseInt(u.uevcbId, 10) : u.uevcbId) ?? u.id ?? 0;
            return {
              id: isNaN(numId) ? 0 : numId,
              name: u.name,
              timezone: u.timezone,
              resolutionMinutes: u.resolutionMinutes ?? 15,
              components: u.components || [],
            };
          }),
          uevcbs: undefined,
        };
      }
      return c;
    });
    return { ...raw, companies } as AssetMapping;
  }
  // Legacy single-UEVCB format
  if (raw?.uevcb) {
    const u = raw.uevcb;
    return {
      companies: [{
        companyId: 0,
        companyName: 'Migrated',
        timezone: u.timezone || 'UTC',
        gridConnectionPoints: [{
          id: u.primaryPortalPlantId ?? 0,
          name: u.name || 'Migrated',
          timezone: u.timezone || 'UTC',
          resolutionMinutes: u.resolutionMinutes ?? 15,
          components: u.components || [],
        }],
      }],
      ftpDirection: raw.ftpDirection || 'incoming',
      ftpFilename: raw.ftpFilename || 'Technical_Parameters.csv',
    };
  }
  return {
    companies: [],
    ftpDirection: 'incoming',
    ftpFilename: 'Technical_Parameters.csv',
  };
}

