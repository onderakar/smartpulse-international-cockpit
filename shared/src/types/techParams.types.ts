export interface BatteryCore {
  batteryCapacityMwh: number;
  maxDischargePowerMw: number;
  maxChargePowerMw: number;
  chargeEfficiency: number;    // ratio 0-1
  dischargeEfficiency: number; // ratio 0-1
  minSocPct: number;           // ratio 0-1
  maxSocPct: number;           // ratio 0-1
}

export interface TechnicalParameters {
  battery: BatteryCore;
  raw: Record<string, string | number | boolean>;
}

/** CSV key -> BatteryCore field mapping */
export const TECH_PARAM_KEY_MAP: Record<string, keyof BatteryCore> = {
  'Battery_Capacity_MWh': 'batteryCapacityMwh',
  'Max_Battery_Discharge_Power_MW': 'maxDischargePowerMw',
  'Max_Battery_Charge_Power_MW': 'maxChargePowerMw',
  'Charge_Efficiency_Percentage': 'chargeEfficiency',
  'Discharge_Efficiency_Percentage': 'dischargeEfficiency',
  'Min_SOC_Percentage': 'minSocPct',
  'Max_SOC_Percentage': 'maxSocPct',
};

/** Reverse mapping: BatteryCore field → CSV key (for serialization) */
export const BATTERY_CORE_TO_CSV_KEY: Record<keyof BatteryCore, string> = {
  batteryCapacityMwh: 'Battery_Capacity_MWh',
  maxDischargePowerMw: 'Max_Battery_Discharge_Power_MW',
  maxChargePowerMw: 'Max_Battery_Charge_Power_MW',
  chargeEfficiency: 'Charge_Efficiency_Percentage',
  dischargeEfficiency: 'Discharge_Efficiency_Percentage',
  minSocPct: 'Min_SOC_Percentage',
  maxSocPct: 'Max_SOC_Percentage',
};

/** Multi-column CSV: one BatteryCore per portal plant ID column */
export interface MultiBatteryTechParams {
  /** plantId (string) → parsed BatteryCore */
  batteries: Record<string, BatteryCore>;
  /** plantId → all raw key-value pairs (includes non-BatteryCore vars) */
  rawByPlant: Record<string, Record<string, string | number | boolean>>;
  /** Ordered plant IDs as they appear in CSV header columns */
  plantIds: string[];
  /** Ordered variable names as they appear in CSV rows (for round-trip serialization) */
  variableOrder: string[];
}
