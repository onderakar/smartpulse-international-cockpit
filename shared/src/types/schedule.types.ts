import { MetricDataPoint } from './monitoring.types';
import { AssetMapping } from './assetMapping.types';

export const SCHEDULE_POLLING_INTERVAL_SECONDS = 30;

export const DEFAULT_SCHEDULE_FILE_PATTERN = 'Battery_Schedule_{GCP_ID}.csv';

export const SCHEDULE_CSV_COLUMNS = [
  'Delivery_Start',
  'Delivery_End',
  'Asset_Id',
  'Battery_Active_Power_MW',
  'Max_Charge_MW',
  'Max_Discharge_MW',
  'Max_Generation_MW',
  'Min_Generation_MW',
  'Usable_Stored_Energy_MWh',
  'Total_Capacity_MWh',
  'Min_SOC_Percentage',
  'Max_SOC_Percentage',
  'Charge_Efficiency',
  'Discharge_Efficiency',
  'Idle_Depletion_Rate_Per_Hour',
  'Min_Duration_Charge_Hours',
  'Min_Duration_Discharge_Hours',
  'Initial_Stored_Energy_MWh',
  'Schedule_ID',
  'Round_Trip_Efficiency',
  'Max_Ramp_Up_Rate_MW_per_min',
  'Max_Ramp_Down_Rate_MW_per_min',
  'Availability_Flag',
  'Cycle_Limit_Daily',
  'Current_Cycle_Count',
  'Operation_Mode',
] as const;

export type ScheduleCsvColumn = typeof SCHEDULE_CSV_COLUMNS[number];

/** A single 15-minute slot row from the schedule CSV */
export interface ScheduleRow {
  Delivery_Start: string;
  Delivery_End: string;
  Asset_Id: string | number;
  Battery_Active_Power_MW: number;
  Max_Charge_MW: number;
  Max_Discharge_MW: number;
  Max_Generation_MW: number;
  Min_Generation_MW: number;
  Usable_Stored_Energy_MWh: number;
  Total_Capacity_MWh: number;
  Min_SOC_Percentage: number;
  Max_SOC_Percentage: number;
  Charge_Efficiency: number;
  Discharge_Efficiency: number;
  Idle_Depletion_Rate_Per_Hour: number;
  Min_Duration_Charge_Hours: number;
  Min_Duration_Discharge_Hours: number;
  Initial_Stored_Energy_MWh: number;
  Schedule_ID: string;
  Round_Trip_Efficiency: number;
  Max_Ramp_Up_Rate_MW_per_min: number;
  Max_Ramp_Down_Rate_MW_per_min: number;
  Availability_Flag: number;
  Cycle_Limit_Daily: number;
  Current_Cycle_Count: number;
  Operation_Mode: string;
  /** Extra columns not in the standard set */
  [key: string]: string | number;
}

/** Parsed result from schedule CSV */
export interface ParsedSchedule {
  header: string[];
  rows: ScheduleRow[];
}

/** Revision info for a single time slot */
export interface ScheduleSlotRevision {
  deliveryStart: string;
  row: ScheduleRow;
  fetchedAt: number;
  contentHash: string;
  source?: 'ftp' | 'user_save';
}

/** Per-GCP per-day revision store entry */
export interface ScheduleRevisionStore {
  gcpId: number;
  dateKey: string;
  slots: Record<string, ScheduleSlotRevision[]>; // Now maps to an array of revisions!
  lastFetchedAt: number;
  lastCsvHash: string;
}

/** Data returned to client from schedule read API */
export interface ScheduleData {
  rows: ScheduleRow[];
  header: string[];
  lastFetchedAt: number;
  hasChanges: boolean;
}

/** Complete revision history data structure */
export interface ScheduleHistoryData {
  slots: Record<string, ScheduleSlotRevision[]>; // all versions over time per deliveryStart
  lastFetchedAt: number;
}

/** Chart-ready schedule data for dashboard overlay */
export interface ScheduleChartData {
  batteryActivePower: MetricDataPoint[];
  maxGeneration: MetricDataPoint[];
}

/** Context for resolving schedule filename template placeholders */
export interface ScheduleFileContext {
  gcpId: number;          // GridConnectionPoint's id
  assetId?: number;       // Component's portalPlantId
  scheduleId?: string;    // Component's scheduleId
  gcpName?: string;       // GridConnectionPoint's name
}

/** Resolve a schedule filename pattern with context variables */
export function resolveScheduleFilename(pattern: string, ctx: ScheduleFileContext): string {
  return pattern
    .replace(/\{GCP_ID\}/g, String(ctx.gcpId))
    .replace(/\{ASSET_ID\}/g, String(ctx.assetId ?? ctx.gcpId))
    .replace(/\{SCHEDULE_ID\}/g, ctx.scheduleId ?? String(ctx.gcpId))
    .replace(/\{GCP_NAME\}/g, ctx.gcpName ?? '');
}

/** Build the FTP filename for a given GCP id */
export function getScheduleFilename(gcpId: number): string {
  return resolveScheduleFilename(DEFAULT_SCHEDULE_FILE_PATTERN, { gcpId });
}

/** Resolve the schedule filename from the asset mapping config, falling back to default */
export function getScheduleFilenameFromMapping(
  mapping: AssetMapping | null | undefined,
  gcpId: number,
): string {
  if (mapping?.companies) {
    for (const company of mapping.companies) {
      for (const gcp of company.gridConnectionPoints) {
        if (gcp.id === gcpId) {
          const bessComp = gcp.components.find(c => c.type === 'BESS');
          if (bessComp?.scheduleFilePattern) {
            return resolveScheduleFilename(bessComp.scheduleFilePattern, {
              gcpId: gcp.id,
              assetId: bessComp.portalPlantId,
              scheduleId: bessComp.scheduleId,
              gcpName: gcp.name,
            });
          }
        }
      }
    }
  }
  return resolveScheduleFilename(DEFAULT_SCHEDULE_FILE_PATTERN, { gcpId });
}
