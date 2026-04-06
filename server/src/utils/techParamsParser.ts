import { BatteryCore, TechnicalParameters, MultiBatteryTechParams, TECH_PARAM_KEY_MAP } from '@smartpulse-intl/shared';

/**
 * Parse Technical_Parameters.csv content (key-value format).
 * CSV structure: Variable,<AssetColumnName>
 * Each row is a key,value pair.
 */
export function parseTechParams(csvContent: string): TechnicalParameters {
  const lines = csvContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length < 2) {
    throw new Error('Technical parameters CSV is empty or has only a header');
  }

  // Skip header row
  const raw: Record<string, string | number | boolean> = {};
  const batteryPartial: Partial<BatteryCore> = {};

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Split by comma or semicolon
    const parts = line.split(/[,;]/).map(p => p.trim());
    if (parts.length < 2) continue;

    const key = parts[0];
    const rawValue = parts[1];

    // Parse value
    let parsedValue: string | number | boolean = rawValue;
    const numVal = parseFloat(rawValue);

    if (!isNaN(numVal) && rawValue !== '') {
      // Check if it's a boolean flag (0/1)
      if (rawValue === '0' || rawValue === '1') {
        // Store as both number and boolean
        parsedValue = numVal;
      } else {
        parsedValue = numVal;
      }
    }

    raw[key] = parsedValue;

    // Map to BatteryCore if key matches
    const batteryField = TECH_PARAM_KEY_MAP[key];
    if (batteryField && typeof parsedValue === 'number') {
      (batteryPartial as any)[batteryField] = parsedValue;
    }
  }

  // Build BatteryCore with defaults for missing fields
  const battery: BatteryCore = {
    batteryCapacityMwh: batteryPartial.batteryCapacityMwh ?? 0,
    maxDischargePowerMw: batteryPartial.maxDischargePowerMw ?? 0,
    maxChargePowerMw: batteryPartial.maxChargePowerMw ?? 0,
    chargeEfficiency: batteryPartial.chargeEfficiency ?? 1,
    dischargeEfficiency: batteryPartial.dischargeEfficiency ?? 1,
    minSocPct: batteryPartial.minSocPct ?? 0,
    maxSocPct: batteryPartial.maxSocPct ?? 1,
  };

  return { battery, raw };
}

function parseValue(rawValue: string): string | number | boolean {
  const trimmed = rawValue.trim();
  if (trimmed === '') return '';
  const numVal = parseFloat(trimmed);
  if (!isNaN(numVal)) return numVal;
  return trimmed;
}

function buildBatteryCore(partial: Partial<BatteryCore>): BatteryCore {
  return {
    batteryCapacityMwh: partial.batteryCapacityMwh ?? 0,
    maxDischargePowerMw: partial.maxDischargePowerMw ?? 0,
    maxChargePowerMw: partial.maxChargePowerMw ?? 0,
    chargeEfficiency: partial.chargeEfficiency ?? 1,
    dischargeEfficiency: partial.dischargeEfficiency ?? 1,
    minSocPct: partial.minSocPct ?? 0,
    maxSocPct: partial.maxSocPct ?? 1,
  };
}

/**
 * Parse multi-battery Technical_Parameters.csv.
 * CSV structure: Variable,<PlantId1>,<PlantId2>,...
 * Each row contains a variable name followed by values per plant.
 */
export function parseMultiBatteryTechParams(csvContent: string): MultiBatteryTechParams {
  const lines = csvContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length < 1) {
    return { batteries: {}, rawByPlant: {}, plantIds: [], variableOrder: [] };
  }

  // Parse header row
  const headers = lines[0].split(/[,;]/).map(h => h.trim());
  const plantIds = headers.slice(1); // first column is "Variable"

  const rawByPlant: Record<string, Record<string, string | number | boolean>> = {};
  const batteryPartials: Record<string, Partial<BatteryCore>> = {};
  const variableOrder: string[] = [];

  // Initialize per-plant structures
  for (const pid of plantIds) {
    rawByPlant[pid] = {};
    batteryPartials[pid] = {};
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(/[,;]/).map(p => p.trim());
    if (parts.length < 2) continue;

    const variable = parts[0];
    variableOrder.push(variable);

    const batteryField = TECH_PARAM_KEY_MAP[variable];

    for (let col = 0; col < plantIds.length; col++) {
      const pid = plantIds[col];
      const raw = parts[col + 1] ?? '';
      const parsed = parseValue(raw);
      rawByPlant[pid][variable] = parsed;

      if (batteryField && typeof parsed === 'number') {
        (batteryPartials[pid] as any)[batteryField] = parsed;
      }
    }
  }

  // Build BatteryCore per plant
  const batteries: Record<string, BatteryCore> = {};
  for (const pid of plantIds) {
    batteries[pid] = buildBatteryCore(batteryPartials[pid]);
  }

  return { batteries, rawByPlant, plantIds, variableOrder };
}

/**
 * Serialize MultiBatteryTechParams back to CSV.
 * Preserves column order and variable order from the original parse.
 */
export function serializeMultiBatteryTechParams(params: MultiBatteryTechParams): string {
  const { plantIds, variableOrder, rawByPlant } = params;

  const header = `Variable,${plantIds.join(',')}`;
  const rows = [header];

  for (const variable of variableOrder) {
    const values = plantIds.map(pid => {
      const val = rawByPlant[pid]?.[variable];
      if (val === undefined || val === '') return '';
      return String(val);
    });
    rows.push(`${variable},${values.join(',')}`);
  }

  return rows.join('\r\n');
}
