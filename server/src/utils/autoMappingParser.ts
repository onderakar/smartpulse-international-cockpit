import { BessParams, AutoMappingWarning } from '@smartpulse-intl/shared'

export interface BatteryColumn {
  name: string
  assetId: number | null
  pvAssetId: number | null
  masternode: string | null
  maxInjectionMw: number | null
  maxConsumptionMw: number | null
  damPortfolioId: string | null
  bessParams: Partial<BessParams>
  pvCapacityAcMw: number | null
  pvCapacityDcMwp: number | null
}

export interface CsvParseResult {
  batteries: BatteryColumn[]
  warnings: AutoMappingWarning[]
}

/** Known row key aliases to handle typos / casing variants */
const KEY_ALIASES: Record<string, string> = {
  'porfolio_id_dam_gen': 'portfolio_id_dam_gen',  // known typo in source CSV
}

function normalizeKey(raw: string): string {
  const k = raw.toLowerCase().trim()
  return KEY_ALIASES[k] ?? k
}

function parseNum(raw: string | undefined): number | null {
  if (!raw) return null
  const cleaned = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (cleaned === '' || cleaned === '-') return null
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

function parseStr(raw: string | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  return s === '' || s === '-' ? null : s
}

export function parseAutoMappingCsv(csvContent: string): CsvParseResult {
  const warnings: AutoMappingWarning[] = []
  const lines = csvContent.split(/\r?\n/).filter(l => l.trim() !== '')

  if (lines.length === 0) {
    return { batteries: [], warnings }
  }

  // Parse header row — column 0 is "#" (row number), column 1 is "Variable" label;
  // battery names start at index 2
  const headers = lines[0].split(',')
  const batteryNames = headers.slice(2)

  // Build row map: normalizedKey → values[]  (one value per battery column)
  // Each data row: col[0] = row number, col[1] = variable name, col[2..] = battery values
  const rowMap = new Map<string, string[]>()
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    const key = normalizeKey(cols[1] ?? '')
    if (key) {
      rowMap.set(key, cols.slice(2))
    }
  }

  const getRow = (key: string): string[] => rowMap.get(normalizeKey(key)) ?? []

  const batteries: BatteryColumn[] = batteryNames.map((name, idx) => {
    const col = name.trim()

    const assetIdRaw = getRow('asset_id')[idx]
    const assetId = parseNum(assetIdRaw)
    if (assetId === null) {
      warnings.push({
        type: 'missing_asset_id',
        message: `${col}: Asset_ID is empty or invalid`,
        column: col,
      })
    }

    const bessParams: Partial<BessParams> = {
      maxDischargePowerMw: parseNum(getRow('max_battery_discharge_power_mw')[idx]) ?? undefined,
      maxChargePowerMw:    parseNum(getRow('max_battery_charge_power_mw')[idx]) ?? undefined,
      capacityMwh:         parseNum(getRow('battery_capacity_mwh')[idx]) ?? undefined,
      chargeEfficiency:    parseNum(getRow('charge_efficiency_percentage')[idx]) ?? undefined,
      dischargeEfficiency: parseNum(getRow('discharge_efficiency_percentage')[idx]) ?? undefined,
      minSocPct:           parseNum(getRow('min_soc_percentage')[idx]) ?? undefined,
      maxSocPct:           parseNum(getRow('max_soc_percentage')[idx]) ?? undefined,
    }

    return {
      name: col,
      assetId,
      pvAssetId:        parseNum(getRow('pv_asset_id')[idx]),
      masternode:       parseStr(getRow('masternode')[idx]),
      maxInjectionMw:   parseNum(getRow('total_grid_capacity_generation_mw')[idx]),
      maxConsumptionMw: parseNum(getRow('total_grid_capacity_consumption_mw')[idx]),
      damPortfolioId:   parseStr(getRow('portfolio_id_dam_gen')[idx]),  // alias resolves typo
      bessParams,
      pvCapacityAcMw:   parseNum(getRow('pv_capacity_mw_ac')[idx]),
      pvCapacityDcMwp:  parseNum(getRow('pv_capacity_mwp')[idx]),
    }
  })

  return { batteries, warnings }
}
