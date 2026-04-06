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

export type UEVCBComponentType = 'BESS' | 'SOLAR' | 'WIND' | 'HYDRO' | 'THERMAL' | 'LOAD' | 'OTHER';

export interface UEVCBComponent {
  componentId: string;
  type: UEVCBComponentType;
  displayName: string;
  portalPlantId: number;
  forecastPreference: {
    sourceName: string;
    beforeMinutes: number;
  };

  scheduleId?: string;
  /** Template pattern for schedule FTP filename, e.g. "Battery_Schedule_{UEVCB_ID}.csv"
   *  Supported placeholders: {UEVCB_ID}, {ASSET_ID}, {SCHEDULE_ID}, {UEVCB_NAME} */
  scheduleFilePattern?: string;

  // Monitoring configurations explicitly mapped to this physical component
  monitoring?: {
    masternode: string;
    metrics: Array<LabeledMetricMapping | BapSource>;
  };
}

export interface UEVCB {
  uevcbId: string;
  name: string;
  primaryPortalPlantId: number;
  timezone: string;
  resolutionMinutes: MTUResolution;
  components: UEVCBComponent[];
}

export interface CompanyMapping {
  companyId: number;
  companyName: string;
  fullName?: string;
  timezone: string;
  uevcbs: UEVCB[];
}

export interface AssetMapping {
  companies: CompanyMapping[];
  ftpDirection: 'incoming' | 'outgoing';
  ftpFilename: string;
}

/** Get the first UEVCB across all companies (for backward-compat consumers). */
export function getFirstUevcb(mapping: AssetMapping | null | undefined): UEVCB | null {
  if (!mapping?.companies?.length) return null;
  for (const company of mapping.companies) {
    if (company.uevcbs?.length) return company.uevcbs[0];
  }
  return null;
}

/** Get all UEVCBs across all companies. */
export function getAllUevcbs(mapping: AssetMapping | null | undefined): UEVCB[] {
  if (!mapping?.companies?.length) return [];
  return mapping.companies.flatMap(c => c.uevcbs || []);
}

/** Get all UEVCBs that contain a BESS component with a valid portalPlantId. */
export interface BessUevcbInfo {
  uevcbId: string;
  name: string;
  primaryPortalPlantId: number;
  timezone: string;
  bessComponent: UEVCBComponent;
}

export function getBessUevcbs(mapping: AssetMapping | null | undefined): BessUevcbInfo[] {
  if (!mapping?.companies) return [];
  const result: BessUevcbInfo[] = [];
  for (const company of mapping.companies) {
    for (const uevcb of company.uevcbs) {
      for (const comp of uevcb.components) {
        if (comp.type === 'BESS' && comp.portalPlantId > 0) {
          result.push({
            uevcbId: uevcb.uevcbId,
            name: uevcb.name,
            primaryPortalPlantId: uevcb.primaryPortalPlantId,
            timezone: uevcb.timezone,
            bessComponent: comp,
          });
        }
      }
    }
  }
  return result;
}

/** Migrate old single-UEVCB AssetMapping to new Company-based format. */
export function migrateAssetMapping(raw: any): AssetMapping {
  if (raw?.companies && Array.isArray(raw.companies)) {
    return raw as AssetMapping;
  }
  if (raw?.uevcb) {
    return {
      companies: [{
        companyId: 0,
        companyName: 'Migrated',
        timezone: raw.uevcb.timezone || 'Europe/Istanbul',
        uevcbs: [raw.uevcb],
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
