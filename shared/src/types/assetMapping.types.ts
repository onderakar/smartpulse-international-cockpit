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

export interface BessParams {
  maxDischargePowerMw: number;
  maxChargePowerMw: number;
  capacityMwh: number;
  chargeEfficiency: number;
  dischargeEfficiency: number;
  minSocPct: number;
  maxSocPct: number;
}

export interface GcpSubComponent {
  /** Portal plant ID for this directional side */
  portalPlantId: number;
  /** MW capacity from portal InstalledPowerMW */
  installedPowerMw?: number;
  /** Canonical portal plant name (for display/audit) */
  portalPlantName?: string;
}

export type ComponentType = 'BESS' | 'SOLAR' | 'WIND' | 'HYDRO' | 'THERMAL' | 'LOAD' | 'OTHER';

export interface GcpComponent {
  componentId: string;
  type: ComponentType;
  displayName: string;

  /** Generation-side portal plant (preferred for forecast/schedule) */
  generation?: GcpSubComponent;
  /** Consumption-side portal plant */
  consumption?: GcpSubComponent;
  /**
   * @deprecated Use generation.portalPlantId. Kept for migration compatibility.
   * Old format components that only have portalPlantId are migrated on load.
   */
  portalPlantId?: number;

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

  // Auto-mapping attributes
  bessParams?: BessParams;
  /** BESS: maxDischargePowerMw. Phase 2 standalone: InstalledPowerMW. */
  installedCapacityMw?: number;
  /** SOLAR only: AC-side capacity (PV_Capacity_MW_ac) */
  installedCapacityAcMw?: number;
  /** SOLAR only: DC peak capacity (PV_Capacity_MWp) */
  installedCapacityDcMwp?: number;
}

export interface GridConnectionPoint {
  /** Numeric ID — user-entered now, will map to portal GCP entity in the future */
  id: number;
  name: string;
  timezone: string;
  /** Default: 15 (quarter-hourly) */
  resolutionMinutes: MTUResolution;
  components: GcpComponent[];

  // Auto-mapping attributes
  /** Total_Grid_Capacity_Generation_MW */
  maxInjectionMw?: number;
  /** Total_Grid_Capacity_Consumption_MW */
  maxConsumptionMw?: number;
  /** Porfolio_ID_DAM_GEN (note: original CSV has typo, parser handles it) */
  damPortfolioId?: string;
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
        if (comp.type === 'BESS' && ((comp.generation?.portalPlantId ?? 0) > 0 || (comp.portalPlantId ?? 0) > 0)) {
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

/**
 * Migrates a single component from the legacy format (single `portalPlantId`) to the
 * new Gen/Con sub-component format. If `generation` already exists, returns unchanged.
 * Used inside migrateAssetMapping for all three migration paths.
 */
function migrateComponent(comp: Record<string, unknown>): GcpComponent {
  // If component has old single portalPlantId but no generation sub-component, migrate it
  if (comp.portalPlantId && !comp.generation) {
    return {
      ...comp,
      generation: {
        portalPlantId: comp.portalPlantId as number,
        installedPowerMw: comp.installedCapacityMw as number | undefined,
      },
    } as GcpComponent;
  }
  return comp as unknown as GcpComponent;
}

/**
 * Migrate old AssetMapping formats to current format.
 * Handles three migration paths:
 *  1. Current format (companies.gridConnectionPoints) — applies migrateComponent per component
 *  2. Old format (companies.uevcbs) — converts uevcbs to gridConnectionPoints
 *  3. Legacy single-uevcb format — wraps in company/GCP structure
 */
export function migrateAssetMapping(raw: any): AssetMapping {
  // Already in current format
  if (raw?.companies && Array.isArray(raw.companies)) {
    // Migrate uevcbs → gridConnectionPoints if needed
    const companies = raw.companies.map((c: any) => {
      if (c.gridConnectionPoints) {
        return {
          ...c,
          gridConnectionPoints: (c.gridConnectionPoints || []).map((gcp: any) => ({
            ...gcp,
            components: (gcp.components || []).map(migrateComponent),
          })),
        };
      }
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
              components: (u.components || []).map(migrateComponent),
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
          components: (u.components || []).map(migrateComponent),
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

// ── Auto Mapping ──

export interface AutoMappingReport {
  // Phase 1 stats
  csvBatteriesFound: number;
  phase1GcpsCreated: number;
  phase1BessComponents: number;
  phase1GenSubComponents: number;
  phase1ConSubComponents: number;
  phase1NameGroupsFound: number;
  phase1AmbiguousNames: number;
  // Phase 2 stats
  phase2Ran: boolean;
  phase2PlantsScanned: number;
  phase2GcpsCreated: number;
  phase2StandaloneFound: number;
  phase2GroupedFound: number;
  // Totals (backward-compatible)
  gcpsCreated: number;
  warnings: AutoMappingWarning[];
  skipped: AutoMappingSkipped[];
  overallStatus: 'success' | 'partial' | 'failed';
}

export interface AutoMappingWarning {
  type:
    | 'duplicate_plant_id'
    | 'missing_asset_id'
    | 'name_conflict'
    | 'unknown_type'
    | 'parse_error'
    | 'ambiguous_direction'
    | 'missing_portal_plant'
    | 'no_gen_or_con_keyword'
    | 'duplicate_direction';
  message: string;
  column?: string;
  plantId?: number;
  plantName?: string;
}

export interface AutoMappingSkipped {
  plantId: number;
  plantName: string;
  reason: string;
}

export type AutoMappingEvent =
  | { step: 'portal_fetch'; status: 'ok'; plantsFound: number }
  | { step: 'csv_read'; status: 'ok'; batteriesFound: number }
  | { step: 'gcp_phase1'; status: 'ok';
      gcpName: string; gcpRoot: string;
      genPlantId?: number; conPlantId?: number;
      companionComponents: number }
  | { step: 'phase1_done'; status: 'ok';
      gcps: number; bessComponents: number;
      genSubComponents: number; conSubComponents: number;
      nameGroupsFound: number; ambiguousNames: number }
  | { step: 'phase2_scan'; status: 'ok'; plantsScanned: number }
  | { step: 'gcp_phase2'; status: 'ok';
      name: string; plantCount: number; genCount: number; conCount: number }
  | { step: 'phase2_done'; status: 'ok';
      gcpsCreated: number; standalone: number; grouped: number }
  | { step: 'saved'; status: 'ok' }
  | { step: 'done'; status: 'ok'; report: AutoMappingReport }
  | { step: 'warning';
      warnType: AutoMappingWarning['type'];
      i18nKey: string;
      params?: Record<string, string | number> }
  | { step: 'error'; status: 'failed'; i18nKey: string }
