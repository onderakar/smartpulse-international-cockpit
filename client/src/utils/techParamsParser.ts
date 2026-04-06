import { BatteryCore, TechnicalParameters, TECH_PARAM_KEY_MAP } from '@shared/types/techParams.types';

/**
 * Client-side CSV parser for Technical_Parameters.csv preview.
 * Mirrors server/src/utils/techParamsParser.ts logic.
 */
export function parseTechParamsCSV(csvContent: string): TechnicalParameters {
  const lines = csvContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length < 2) {
    throw new Error('CSV is empty or has only a header');
  }

  const raw: Record<string, string | number | boolean> = {};
  const batteryPartial: Partial<BatteryCore> = {};

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(/[,;]/).map(p => p.trim());
    if (parts.length < 2) continue;

    const key = parts[0];
    const rawValue = parts[1];
    const numVal = parseFloat(rawValue);

    let parsedValue: string | number | boolean = rawValue;
    if (!isNaN(numVal) && rawValue !== '') {
      parsedValue = numVal;
    }

    raw[key] = parsedValue;

    const batteryField = TECH_PARAM_KEY_MAP[key];
    if (batteryField && typeof parsedValue === 'number') {
      (batteryPartial as any)[batteryField] = parsedValue;
    }
  }

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
