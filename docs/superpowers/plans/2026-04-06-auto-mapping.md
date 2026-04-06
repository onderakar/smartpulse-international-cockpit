# Auto Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "Auto Mapping" feature that generates the full AssetMapping (GCPs + components) from `Technical_Parameters.csv` (FTP) and the portal plant API, streaming progress to the user via a modal.

**Architecture:** Full server-side pipeline — `POST /api/auto-mapping/run` streams SSE events via `fetch()+ReadableStream`. Phase 1 parses the CSV to build battery GCPs; Phase 2 calls the portal API to create GCPs for unmapped plants. All auth cookies stay on the server.

**Tech Stack:** TypeScript, Express SSE, Node `crypto.randomUUID()`, Vitest (new), React hooks + fetch ReadableStream, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-06-auto-mapping-design.md`

---

## File Map

| File | Status | Responsibility |
|------|--------|---------------|
| `server/package.json` | MODIFY | Add vitest devDependency + test script |
| `server/vitest.config.ts` | CREATE | Vitest config for server workspace |
| `shared/src/types/assetMapping.types.ts` | MODIFY | Add `BessParams`, new optional fields on `GridConnectionPoint` + `GcpComponent`, `AutoMappingReport/Warning/Skipped` |
| `shared/src/constants/translations.ts` | MODIFY | Add `autoMapping.*` translation keys |
| `server/src/utils/autoMappingParser.ts` | CREATE | Pure CSV parse function — `parseAutoMappingCsv()` |
| `server/src/utils/autoMappingParser.test.ts` | CREATE | Vitest unit tests for the parser |
| `server/src/services/autoMapping.service.ts` | CREATE | `runAutoMapping()` + `fetchCompanyPowerPlants()` + helpers |
| `server/src/routes/autoMapping.routes.ts` | CREATE | `POST /api/auto-mapping/run` — SSE streaming route |
| `server/src/routes/index.ts` | MODIFY | Register the new route at `/auto-mapping` |
| `client/src/hooks/useAutoMapping.ts` | CREATE | fetch + ReadableStream SSE consumer, step/report state |
| `client/src/components/settings/AutoMappingModal.tsx` | CREATE | Progress modal — stepper, log panel, summary cards |
| `client/src/components/settings/AutoMappingButton.tsx` | CREATE | Button + ConfirmDialog |
| `client/src/components/settings/AssetMappingForm.tsx` | MODIFY | Mount `AutoMappingButton` at top of form |

---

## Task 1: Test Infrastructure

**Files:**
- Modify: `server/package.json`
- Create: `server/vitest.config.ts`

- [ ] **Step 1: Add vitest to server workspace**

```bash
cd server && npm install --save-dev vitest
```

- [ ] **Step 2: Create vitest config**

Create `server/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
})
```

- [ ] **Step 3: Add test script to server/package.json**

In the `"scripts"` section, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify vitest runs**

```bash
cd server && npm test
```
Expected: "No test files found" or similar — no errors, just 0 tests.

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/vitest.config.ts
git commit -m "chore: add vitest test runner to server workspace"
```

---

## Task 2: Shared Type Extensions

**Files:**
- Modify: `shared/src/types/assetMapping.types.ts`

The current `GridConnectionPoint.id` is `number` — do NOT change it. Add optional fields only.

- [ ] **Step 1: Add `BessParams` interface** after the `BapSource` interface (around line 16):

```typescript
export interface BessParams {
  maxDischargePowerMw: number;
  maxChargePowerMw: number;
  capacityMwh: number;
  chargeEfficiency: number;
  dischargeEfficiency: number;
  minSocPct: number;
  maxSocPct: number;
}
```

- [ ] **Step 2: Add new optional fields to `GcpComponent`** (after the `monitoring?` field, before the closing brace):

```typescript
  // Auto-mapping attributes
  bessParams?: BessParams;
  /** BESS: maxDischargePowerMw. Phase 2 standalone: InstalledPowerMW. NOT set for SOLAR. */
  installedCapacityMw?: number;
  /** SOLAR only: AC-side capacity (PV_Capacity_MW_ac) */
  installedCapacityAcMw?: number;
  /** SOLAR only: DC peak capacity (PV_Capacity_MWp) */
  installedCapacityDcMwp?: number;
```

- [ ] **Step 3: Add new optional fields to `GridConnectionPoint`** (after `components: GcpComponent[]`, before closing brace):

```typescript
  // Auto-mapping attributes
  /** Total_Grid_Capacity_Generation_MW */
  maxInjectionMw?: number;
  /** Total_Grid_Capacity_Consumption_MW */
  maxConsumptionMw?: number;
  /** Porfolio_ID_DAM_GEN (note: original CSV has typo, parser handles it) */
  damPortfolioId?: string;
```

- [ ] **Step 4: Add Auto Mapping result types** at the end of the file (before the final blank line):

```typescript
// ── Auto Mapping ──

export interface AutoMappingReport {
  gcpsCreated: number;
  bessCreated: number;
  solarCreated: number;
  unmappedGcpsCreated: number;
  warnings: AutoMappingWarning[];
  skipped: AutoMappingSkipped[];
  overallStatus: 'success' | 'partial' | 'failed';
}

export interface AutoMappingWarning {
  type: 'duplicate_plant_id' | 'missing_asset_id' | 'name_conflict' | 'unknown_type' | 'parse_error';
  message: string;
  column?: string;
}

export interface AutoMappingSkipped {
  plantId: number;
  plantName: string;
  reason: string;
}

export type AutoMappingEvent =
  | { step: 'csv_read';     status: 'ok';     batteriesFound: number }
  | { step: 'gcp_phase1';   status: 'ok';     name: string; bessPlantId: number; pvPlantId?: number }
  | { step: 'phase1_done';  status: 'ok';     gcps: number; bess: number; solar: number }
  | { step: 'portal_fetch'; status: 'ok';     plantsFound: number }
  | { step: 'gcp_phase2';   status: 'ok';     name: string; plantId: number }
  | { step: 'phase2_done';  status: 'ok';     unmappedGcps: number }
  | { step: 'saved';        status: 'ok' }
  | { step: 'done';         status: 'ok';     report: AutoMappingReport }
  | { step: 'warning';      warnType: AutoMappingWarning['type']; i18nKey: string; params?: Record<string, string | number> }
  | { step: 'error';        status: 'failed'; i18nKey: string };
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd shared && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add shared/src/types/assetMapping.types.ts
git commit -m "feat(shared): add BessParams, GCP/Component auto-mapping fields, AutoMappingEvent types"
```

---

## Task 3: Translation Keys

**Files:**
- Modify: `shared/src/constants/translations.ts`

- [ ] **Step 1: Add `autoMapping.*` keys** to the `T` object. Place them after the last existing key group (find `common.*` entries and add after them):

```typescript
  // ==================== Auto Mapping ====================
  'autoMapping.button':                { tr: 'Otomatik Eşleştir', en: 'Auto Mapping' },
  'autoMapping.confirmTitle':          { tr: 'Mevcut Mapping Silinecek', en: 'Existing Mapping Will Be Replaced' },
  'autoMapping.confirmBody':           { tr: '{gcpCount} GCP ve {componentCount} bileşen tanımlı. Otomatik eşleştirme çalıştırılırsa mevcut yapılandırma silinecek.', en: '{gcpCount} GCPs and {componentCount} components are defined. Running Auto Mapping will replace the existing configuration.' },
  'autoMapping.confirmProceed':        { tr: 'Evet, Devam Et', en: 'Yes, Proceed' },
  'autoMapping.cancel':                { tr: 'İptal', en: 'Cancel' },
  'autoMapping.modalTitle':            { tr: 'Otomatik Eşleştirme', en: 'Auto Mapping' },
  'autoMapping.done':                  { tr: 'Eşleştirme Tamamlandı', en: 'Mapping Complete' },
  'autoMapping.viewMapping':           { tr: "Mapping'i Görüntüle", en: 'View Mapping' },
  'autoMapping.statusSuccess':         { tr: 'BAŞARILI', en: 'SUCCESS' },
  'autoMapping.statusPartial':         { tr: 'KISMI BAŞARI', en: 'PARTIAL SUCCESS' },
  'autoMapping.statusFailed':          { tr: 'BAŞARISIZ', en: 'FAILED' },
  'autoMapping.step.csvRead':          { tr: 'CSV okundu', en: 'CSV read' },
  'autoMapping.step.phase1Done':       { tr: "Phase 1 GCP'ler oluşturuldu", en: 'Phase 1 GCPs created' },
  'autoMapping.step.portalFetch':      { tr: 'Portal plants çekildi', en: 'Portal plants fetched' },
  'autoMapping.step.phase2Done':       { tr: "Phase 2 GCP'ler oluşturuldu", en: 'Phase 2 GCPs created' },
  'autoMapping.step.saved':            { tr: 'Mapping kaydedildi', en: 'Mapping saved' },
  'autoMapping.error.portalFailed':    { tr: 'Portal bağlantısı kurulamadı. Phase 1 sonuçları korundu.', en: 'Portal connection failed. Phase 1 results were kept.' },
  'autoMapping.error.csvFailed':       { tr: 'CSV okunamadı. İşlem iptal edildi.', en: 'Could not read CSV. Operation aborted.' },
  'autoMapping.warn.missingAssetId':   { tr: '{column}: Asset_ID boş, BESS oluşturulmadı', en: '{column}: Asset_ID is empty, BESS skipped' },
  'autoMapping.warn.duplicatePlantId': { tr: 'Plant ID {id} zaten eşleştirildi, atlandı', en: 'Plant ID {id} already mapped, skipped' },
  'autoMapping.warn.defaultType':      { tr: 'Plant#{id} için tip belirlenemedi, varsayılan SOLAR kullanıldı', en: 'Plant#{id} type unknown, defaulting to SOLAR' },
  'autoMapping.warn.nameNormalized':   { tr: '"{original}" ismi normalize edildi → "{normalized}"', en: '"{original}" name normalized → "{normalized}"' },
  'autoMapping.warnings':              { tr: '{count} Uyarı', en: '{count} Warning(s)' },
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd shared && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add shared/src/constants/translations.ts
git commit -m "feat(shared): add autoMapping i18n translation keys"
```

---

## Task 4: CSV Parser (TDD)

**Files:**
- Create: `server/src/utils/autoMappingParser.ts`
- Create: `server/src/utils/autoMappingParser.test.ts`

### Step 1–4: Write failing tests first

- [ ] **Step 1: Create the test file**

Create `server/src/utils/autoMappingParser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseAutoMappingCsv } from './autoMappingParser'

const MINIMAL_CSV = `#,Variable,BatteryA,BatteryB
1,Asset_ID,1943,1944
2,PV_Asset_ID,3022,-
3,Masternode,SP01010860,SP01010829
4,Total_Grid_Capacity_Generation_MW,50,100
5,Total_Grid_Capacity_Consumption_MW,50,100
6,Porfolio_ID_DAM_GEN,PORTF_1,PORTF_2
7,Max_Battery_Discharge_Power_MW,50,100
8,Max_Battery_Charge_Power_MW,50,100
9,Battery_Capacity_MWh,100,200
10,Charge_Efficiency_Percentage,95,95
11,Discharge_Efficiency_Percentage,95,95
12,Min_SOC_Percentage,10,10
13,Max_SOC_Percentage,90,90
14,PV_Capacity_MW_ac,30,-
15,PV_Capacity_MWp,35,-`

describe('parseAutoMappingCsv', () => {
  it('returns one BatteryColumn per battery column', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries).toHaveLength(2)
    expect(result.batteries[0].name).toBe('BatteryA')
    expect(result.batteries[1].name).toBe('BatteryB')
  })

  it('parses Asset_ID as number', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries[0].assetId).toBe(1943)
    expect(result.batteries[1].assetId).toBe(1944)
  })

  it('parses PV_Asset_ID; returns null for dash', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries[0].pvAssetId).toBe(3022)
    expect(result.batteries[1].pvAssetId).toBeNull()
  })

  it('parses Masternode', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries[0].masternode).toBe('SP01010860')
  })

  it('parses GCP attributes', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries[0].maxInjectionMw).toBe(50)
    expect(result.batteries[0].maxConsumptionMw).toBe(50)
    expect(result.batteries[0].damPortfolioId).toBe('PORTF_1')
  })

  it('handles typo Porfolio_ID_DAM_GEN as alias for Portfolio_ID_DAM_GEN', () => {
    // The minimal CSV already uses the typo variant — verified above
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries[0].damPortfolioId).toBe('PORTF_1')
  })

  it('parses bessParams', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries[0].bessParams.maxDischargePowerMw).toBe(50)
    expect(result.batteries[0].bessParams.capacityMwh).toBe(100)
    expect(result.batteries[0].bessParams.chargeEfficiency).toBe(95)
  })

  it('parses PV capacity fields; returns null when dash', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries[0].pvCapacityAcMw).toBe(30)
    expect(result.batteries[0].pvCapacityDcMwp).toBe(35)
    expect(result.batteries[1].pvCapacityAcMw).toBeNull()
    expect(result.batteries[1].pvCapacityDcMwp).toBeNull()
  })

  it('is case-insensitive on row keys', () => {
    const csv = `#,Variable,BatteryA\n1,asset_id,1943`
    const result = parseAutoMappingCsv(csv)
    expect(result.batteries[0].assetId).toBe(1943)
  })

  it('trims whitespace in values', () => {
    const csv = `#,Variable,BatteryA\n1,Asset_ID, 1943 `
    const result = parseAutoMappingCsv(csv)
    expect(result.batteries[0].assetId).toBe(1943)
  })

  it('returns null for empty Asset_ID and emits missing_asset_id warning', () => {
    const csv = `#,Variable,BatteryA\n1,Asset_ID,`
    const result = parseAutoMappingCsv(csv)
    expect(result.batteries[0].assetId).toBeNull()
    expect(result.warnings.some(w => w.type === 'missing_asset_id')).toBe(true)
  })

  it('returns no warnings for a well-formed CSV', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.warnings).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to see them fail**

```bash
cd server && npm test
```
Expected: All tests FAIL with "Cannot find module './autoMappingParser'"

- [ ] **Step 3: Create the parser**

Create `server/src/utils/autoMappingParser.ts`:

```typescript
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

  // Parse header row — columns 0 and 1 are metadata (#, Variable); battery names start at index 2
  const headers = lines[0].split(',')
  const batteryNames = headers.slice(2)

  // Build row map: normalizedKey → values[]  (one value per battery column)
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
```

- [ ] **Step 4: Run tests — all should pass**

```bash
cd server && npm test
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/autoMappingParser.ts server/src/utils/autoMappingParser.test.ts
git commit -m "feat(server): add parseAutoMappingCsv with unit tests"
```

---

## Task 5: Auto Mapping Service

**Files:**
- Create: `server/src/services/autoMapping.service.ts`

- [ ] **Step 1: Create the service file**

Create `server/src/services/autoMapping.service.ts`:

```typescript
import crypto from 'node:crypto'
import axios from 'axios'
import {
  GridConnectionPoint, GcpComponent, CompanyMapping, AssetMapping,
  BessParams, AutoMappingEvent, AutoMappingReport, AutoMappingWarning,
} from '@smartpulse-intl/shared'
import { UserSession } from '../store/sessions'
import { GroupProfile } from '@smartpulse-intl/shared'
import { FtpService } from './ftp.service'
import { ConfigStoreService } from './configStore.service'
import { parseAutoMappingCsv, BatteryColumn } from '../utils/autoMappingParser'
import { PORTAL_BASE_URLS } from './ftp.service'  // reuse existing URL map

const DEFAULT_FORECAST_PREFERENCE = { sourceName: 'FinalForecast', beforeMinutes: 60 }

function generateId(): string {
  return crypto.randomUUID()
}

function resolveGroupTimezone(session: UserSession): string {
  return session.groups.find(g => g.id === session.groupId)?.timezone ?? 'UTC'
}

function sanitizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, '_')
}

function resolveNameConflict(base: string, used: Set<string>): string {
  if (!used.has(base)) { used.add(base); return base }
  let i = 2
  while (used.has(`${base}_${i}`)) i++
  const name = `${base}_${i}`
  used.add(name)
  return name
}

function fallbackCompany(session: UserSession): { CompanyId: number; CompanyName: string } {
  const first = session.companies?.[0]
  return first
    ? { CompanyId: first.id, CompanyName: first.name }
    : { CompanyId: 0, CompanyName: 'Auto Mapped' }
}

interface PortalCompanyConfig {
  CompanyId: number
  CompanyName: string
  PowerPlantLimits: Array<{
    PowerPlantId: number
    PowerPlantName: string
    InstalledPowerMW: number
  }>
}

export async function fetchCompanyPowerPlants(
  cookies: string[],
  env: string,
  accessToken: string,
): Promise<PortalCompanyConfig[]> {
  const baseUrl = (PORTAL_BASE_URLS as Record<string, string>)[env] ?? (PORTAL_BASE_URLS as Record<string, string>)['prod']
  const response = await axios.post(
    `${baseUrl}/Configuration/GetCompanyPowerPlantConfigurations`,
    {},
    {
      headers: {
        Cookie: cookies.join('; '),
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  )
  return response.data as PortalCompanyConfig[]
}

export async function runAutoMapping(
  session: UserSession,
  profile: GroupProfile,
  ftpService: FtpService,
  configStore: ConfigStoreService,
  emit: (event: AutoMappingEvent) => void,
): Promise<void> {
  const warnings: AutoMappingWarning[] = []
  const timezone = resolveGroupTimezone(session)
  const ftpDirection = (profile.assetMapping as any)?.ftpDirection ?? 'incoming'
  const ftpFilename  = (profile.assetMapping as any)?.ftpFilename  ?? 'Technical_Parameters.csv'

  // ── PHASE 1: CSV ──
  let csvContent: string
  try {
    csvContent = await ftpService.readFile(session.portalCookies, session.env, ftpDirection, ftpFilename)
  } catch (err) {
    emit({ step: 'error', status: 'failed', i18nKey: 'autoMapping.error.csvFailed' })
    return
  }

  const parsed = parseAutoMappingCsv(csvContent)
  for (const w of parsed.warnings) {
    warnings.push(w)
    emit({ step: 'warning', warnType: w.type, i18nKey: `autoMapping.warn.${w.type}`, params: { column: w.column ?? '' } })
  }
  emit({ step: 'csv_read', status: 'ok', batteriesFound: parsed.batteries.length })

  const batteryAssetIds = new Set<number>()
  const pvAssetIds      = new Set<number>()
  const seenPlantIds    = new Set<number>()
  const usedNames       = new Set<string>()
  const phase1Gcps: GridConnectionPoint[] = []
  const idBase = Date.now()
  let bessCount = 0, solarCount = 0

  for (let idx = 0; idx < parsed.batteries.length; idx++) {
    const battery = parsed.batteries[idx]

    if (battery.assetId === null) {
      // warning already emitted by parser
      continue
    }
    if (seenPlantIds.has(battery.assetId)) {
      warnings.push({ type: 'duplicate_plant_id', message: `Plant ID ${battery.assetId} already mapped`, column: battery.name })
      emit({ step: 'warning', warnType: 'duplicate_plant_id', i18nKey: 'autoMapping.warn.duplicatePlantId', params: { id: battery.assetId } })
      continue
    }
    seenPlantIds.add(battery.assetId)
    batteryAssetIds.add(battery.assetId)

    const rawName = sanitizeName(battery.name) + '_GCP'
    const gcpName = resolveNameConflict(rawName, usedNames)
    if (gcpName !== rawName) {
      emit({ step: 'warning', warnType: 'name_conflict', i18nKey: 'autoMapping.warn.nameNormalized', params: { original: rawName, normalized: gcpName } })
    }

    const bp = battery.bessParams
    const bessComponent: GcpComponent = {
      componentId: generateId(),
      type: 'BESS',
      displayName: battery.name,
      portalPlantId: battery.assetId,
      forecastPreference: DEFAULT_FORECAST_PREFERENCE,
      monitoring: battery.masternode ? { masternode: battery.masternode, metrics: [] } : undefined,
      bessParams: Object.keys(bp).length > 0 ? bp as BessParams : undefined,
      installedCapacityMw: bp.maxDischargePowerMw ?? undefined,
    }
    bessCount++

    const components: GcpComponent[] = [bessComponent]

    if (battery.pvAssetId !== null && !seenPlantIds.has(battery.pvAssetId)) {
      seenPlantIds.add(battery.pvAssetId)
      pvAssetIds.add(battery.pvAssetId)
      components.push({
        componentId: generateId(),
        type: 'SOLAR',
        displayName: battery.name + '_PV',
        portalPlantId: battery.pvAssetId,
        forecastPreference: DEFAULT_FORECAST_PREFERENCE,
        monitoring: battery.masternode ? { masternode: battery.masternode, metrics: [] } : undefined,
        installedCapacityAcMw: battery.pvCapacityAcMw ?? undefined,
        installedCapacityDcMwp: battery.pvCapacityDcMwp ?? undefined,
      })
      solarCount++
    }

    const gcp: GridConnectionPoint = {
      id: idBase + idx,
      name: gcpName,
      timezone,
      resolutionMinutes: 15,
      components,
      maxInjectionMw:   battery.maxInjectionMw   ?? undefined,
      maxConsumptionMw: battery.maxConsumptionMw ?? undefined,
      damPortfolioId:   battery.damPortfolioId   ?? undefined,
    }
    phase1Gcps.push(gcp)
    emit({ step: 'gcp_phase1', status: 'ok', name: gcpName, bessPlantId: battery.assetId, pvPlantId: battery.pvAssetId ?? undefined })
  }

  emit({ step: 'phase1_done', status: 'ok', gcps: phase1Gcps.length, bess: bessCount, solar: solarCount })

  // ── PHASE 2: Portal ──
  let portalConfigs: PortalCompanyConfig[] = []
  const plantIdToCompany = new Map<number, { CompanyId: number; CompanyName: string }>()
  let phase2Success = false
  const phase2Gcps: GridConnectionPoint[] = []
  const excludedIds = new Set([...batteryAssetIds, ...pvAssetIds])

  try {
    portalConfigs = await fetchCompanyPowerPlants(session.portalCookies, session.env, session.portalAccessToken)
    let totalPlants = 0
    for (const config of portalConfigs) {
      for (const plant of config.PowerPlantLimits) {
        plantIdToCompany.set(plant.PowerPlantId, { CompanyId: config.CompanyId, CompanyName: config.CompanyName })
        totalPlants++
      }
    }
    emit({ step: 'portal_fetch', status: 'ok', plantsFound: totalPlants })
    phase2Success = true
  } catch (err) {
    emit({ step: 'error', status: 'failed', i18nKey: 'autoMapping.error.portalFailed' })
    emit({ step: 'phase2_done', status: 'ok', unmappedGcps: 0 })
  }

  if (phase2Success) {
    for (const config of portalConfigs) {
      for (const plant of config.PowerPlantLimits) {
        if (plant.PowerPlantId <= 0) continue
        if (excludedIds.has(plant.PowerPlantId) || seenPlantIds.has(plant.PowerPlantId)) continue
        seenPlantIds.add(plant.PowerPlantId)

        const rawName = sanitizeName(plant.PowerPlantName) + '_GCP'
        const gcpName = resolveNameConflict(rawName, usedNames)

        phase2Gcps.push({
          id: idBase + phase1Gcps.length + phase2Gcps.length,
          name: gcpName,
          timezone,
          resolutionMinutes: 15,
          components: [{
            componentId: generateId(),
            type: 'SOLAR',
            displayName: plant.PowerPlantName,
            portalPlantId: plant.PowerPlantId,
            forecastPreference: DEFAULT_FORECAST_PREFERENCE,
            installedCapacityMw: plant.InstalledPowerMW > 0 ? plant.InstalledPowerMW : undefined,
          }],
        })
        emit({ step: 'gcp_phase2', status: 'ok', name: gcpName, plantId: plant.PowerPlantId })
      }
    }
    emit({ step: 'phase2_done', status: 'ok', unmappedGcps: phase2Gcps.length })
  }

  // ── COMPANY ASSIGNMENT ──
  const companyMap = new Map<number, CompanyMapping>()

  const getOrCreateCompany = (info: { CompanyId: number; CompanyName: string }): CompanyMapping => {
    if (!companyMap.has(info.CompanyId)) {
      const portalCo = session.companies?.find(c => c.id === info.CompanyId)
      companyMap.set(info.CompanyId, {
        companyId: info.CompanyId,
        companyName: info.CompanyName,
        timezone: portalCo?.timezone ?? timezone,
        gridConnectionPoints: [],
      })
    }
    return companyMap.get(info.CompanyId)!
  }

  for (const gcp of phase1Gcps) {
    const bessPlantId = gcp.components.find(c => c.type === 'BESS')?.portalPlantId
    const companyInfo = (bessPlantId ? plantIdToCompany.get(bessPlantId) : undefined) ?? fallbackCompany(session)
    getOrCreateCompany(companyInfo).gridConnectionPoints.push(gcp)
  }

  if (phase2Success) {
    for (const config of portalConfigs) {
      for (const gcp of phase2Gcps) {
        const plant = config.PowerPlantLimits.find(p => p.PowerPlantId === gcp.components[0]?.portalPlantId)
        if (plant) getOrCreateCompany({ CompanyId: config.CompanyId, CompanyName: config.CompanyName }).gridConnectionPoints.push(gcp)
      }
    }
  }

  const existingMapping = profile.assetMapping as AssetMapping | undefined
  const newMapping: AssetMapping = {
    companies: [...companyMap.values()],
    ftpDirection: existingMapping?.ftpDirection ?? 'incoming',
    ftpFilename:  existingMapping?.ftpFilename  ?? 'Technical_Parameters.csv',
  }

  await configStore.saveProfile(session.username, { ...profile, assetMapping: newMapping } as any, String(session.groupId))
  emit({ step: 'saved', status: 'ok' })

  emit({
    step: 'done',
    status: 'ok',
    report: {
      gcpsCreated: phase1Gcps.length + phase2Gcps.length,
      bessCreated: bessCount,
      solarCreated: solarCount,
      unmappedGcpsCreated: phase2Gcps.length,
      warnings,
      skipped: [],
      overallStatus: phase2Success ? 'success' : 'partial',
    },
  })
}
```

> **Note on `PORTAL_BASE_URLS`:** This map is private in `ftp.service.ts`. If it's not exported, either export it or duplicate the tiny map in `autoMapping.service.ts`. Check `server/src/services/ftp.service.ts` — if `PORTAL_BASE_URLS` is not exported, add `export` to it.

- [ ] **Step 2: Export `PORTAL_BASE_URLS` from ftp.service.ts if needed**

Open `server/src/services/ftp.service.ts`, find the `PORTAL_BASE_URLS` constant. If it starts with `const`, change to `export const`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/autoMapping.service.ts server/src/services/ftp.service.ts
git commit -m "feat(server): add runAutoMapping service and fetchCompanyPowerPlants"
```

---

## Task 6: SSE Route + Register

**Files:**
- Create: `server/src/routes/autoMapping.routes.ts`
- Modify: `server/src/routes/index.ts`

- [ ] **Step 1: Create the route file**

Create `server/src/routes/autoMapping.routes.ts`:

```typescript
import { Router } from 'express'
import { sessionAuth } from '../middleware/sessionAuth'
import { FtpService } from '../services/ftp.service'
import { ConfigStoreService } from '../services/configStore.service'
import { runAutoMapping } from '../services/autoMapping.service'
import { AutoMappingEvent } from '@smartpulse-intl/shared'

export function createAutoMappingRoutes(
  ftpService: FtpService,
  configStore: ConfigStoreService,
): Router {
  const router = Router()

  // POST /api/auto-mapping/run  — SSE stream
  router.post('/run', sessionAuth, async (req, res) => {
    const session = req.session.portalSession!

    // Load current group profile
    const profile = await configStore.loadGroupProfile(String(session.groupId))
    if (!profile) {
      res.status(400).json({ code: 'NO_PROFILE', message: 'Group profile not found' })
      return
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const emit = (event: AutoMappingEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    try {
      await runAutoMapping(session, profile, ftpService, configStore, emit)
    } catch (err: any) {
      emit({ step: 'error', status: 'failed', i18nKey: 'autoMapping.error.csvFailed' })
    } finally {
      res.end()
    }
  })

  return router
}
```

- [ ] **Step 2: Register route in `server/src/routes/index.ts`**

Add the import at the top:
```typescript
import { createAutoMappingRoutes } from './autoMapping.routes'
```

Add mounting line after the existing routes (before `return router`):
```typescript
router.use('/auto-mapping', createAutoMappingRoutes(ftpService, configStore))
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Run all tests**

```bash
cd server && npm test
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/autoMapping.routes.ts server/src/routes/index.ts
git commit -m "feat(server): add POST /api/auto-mapping/run SSE endpoint"
```

---

## Task 7: useAutoMapping Hook

**Files:**
- Create: `client/src/hooks/useAutoMapping.ts`

- [ ] **Step 1: Create the hook**

Create `client/src/hooks/useAutoMapping.ts`:

```typescript
import { useState, useRef, useCallback } from 'react'
import { AutoMappingEvent, AutoMappingReport, AutoMappingWarning } from '@shared/types/assetMapping.types'

export type StepStatus = 'pending' | 'active' | 'done' | 'error'

export interface AutoMappingStep {
  key: string
  i18nKey: string
  status: StepStatus
  badge?: string        // e.g. "8 batarya"
}

export interface AutoMappingState {
  isRunning: boolean
  isComplete: boolean
  steps: AutoMappingStep[]
  logLines: string[]
  report: AutoMappingReport | null
  warnings: AutoMappingWarning[]
  run: () => Promise<void>
  reset: () => void
}

const STEP_KEYS = [
  { key: 'csv_read',     i18nKey: 'autoMapping.step.csvRead' },
  { key: 'phase1_done',  i18nKey: 'autoMapping.step.phase1Done' },
  { key: 'portal_fetch', i18nKey: 'autoMapping.step.portalFetch' },
  { key: 'phase2_done',  i18nKey: 'autoMapping.step.phase2Done' },
  { key: 'saved',        i18nKey: 'autoMapping.step.saved' },
]

function makeInitialSteps(): AutoMappingStep[] {
  return STEP_KEYS.map(s => ({ ...s, status: 'pending' }))
}

export function useAutoMapping(onComplete: () => void): AutoMappingState {
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [steps, setSteps] = useState<AutoMappingStep[]>(makeInitialSteps())
  const [logLines, setLogLines] = useState<string[]>([])
  const [report, setReport] = useState<AutoMappingReport | null>(null)
  const [warnings, setWarnings] = useState<AutoMappingWarning[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const addLog = (line: string) => setLogLines(prev => [...prev, line])

  const setStepStatus = (key: string, status: StepStatus, badge?: string) => {
    setSteps(prev => prev.map(s =>
      s.key === key ? { ...s, status, ...(badge ? { badge } : {}) } : s
    ))
  }

  const dispatch = useCallback((event: AutoMappingEvent) => {
    switch (event.step) {
      case 'csv_read':
        setStepStatus('csv_read', 'done', `${event.batteriesFound} battery`)
        addLog(`[OK] CSV read — ${event.batteriesFound} batteries`)
        setStepStatus('phase1_done', 'active')
        break
      case 'gcp_phase1':
        addLog(`[OK] ${event.name} → BESS(${event.bessPlantId})${event.pvPlantId ? ` + SOLAR(${event.pvPlantId})` : ''}`)
        break
      case 'phase1_done':
        setStepStatus('phase1_done', 'done', `${event.gcps} GCP`)
        setStepStatus('portal_fetch', 'active')
        break
      case 'portal_fetch':
        setStepStatus('portal_fetch', 'done', `${event.plantsFound} plants`)
        setStepStatus('phase2_done', 'active')
        break
      case 'gcp_phase2':
        addLog(`[OK] ${event.name} (plant #${event.plantId})`)
        break
      case 'phase2_done':
        setStepStatus('phase2_done', 'done', `${event.unmappedGcps} GCP`)
        setStepStatus('saved', 'active')
        break
      case 'saved':
        setStepStatus('saved', 'done')
        break
      case 'done':
        setReport(event.report)
        setIsRunning(false)
        setIsComplete(true)
        onComplete()
        break
      case 'warning':
        setWarnings(prev => [...prev, { type: event.warnType, message: event.i18nKey, column: event.params?.column as string | undefined }])
        addLog(`[WARN] ${event.i18nKey} ${JSON.stringify(event.params ?? {})}`)
        break
      case 'error':
        addLog(`[ERROR] ${event.i18nKey}`)
        setSteps(prev => prev.map(s => s.status === 'active' ? { ...s, status: 'error' } : s))
        setIsRunning(false)
        setIsComplete(true)
        break
    }
  }, [onComplete])

  const run = useCallback(async () => {
    setIsRunning(true)
    setIsComplete(false)
    setSteps(makeInitialSteps())
    setLogLines([])
    setReport(null)
    setWarnings([])

    // Mark first step as active
    setStepStatus('csv_read', 'active')

    abortRef.current = new AbortController()

    try {
      const response = await fetch('/api/auto-mapping/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: abortRef.current.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        for (const line of text.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const event: AutoMappingEvent = JSON.parse(line.slice(6))
              dispatch(event)
            } catch {
              // malformed SSE line — ignore
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        addLog(`[ERROR] Network error: ${err.message}`)
        setIsRunning(false)
        setIsComplete(true)
      }
    }
  }, [dispatch])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setIsRunning(false)
    setIsComplete(false)
    setSteps(makeInitialSteps())
    setLogLines([])
    setReport(null)
    setWarnings([])
  }, [])

  return { isRunning, isComplete, steps, logLines, report, warnings, run, reset }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useAutoMapping.ts
git commit -m "feat(client): add useAutoMapping hook with SSE ReadableStream consumer"
```

---

## Task 8: AutoMappingModal Component

**Files:**
- Create: `client/src/components/settings/AutoMappingModal.tsx`

- [ ] **Step 1: Create the modal**

Create `client/src/components/settings/AutoMappingModal.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { useLocale } from '../../context/LocaleContext'
import { AutoMappingState, StepStatus } from '../../hooks/useAutoMapping'

interface Props {
  state: AutoMappingState
  onClose: () => void
}

const STATUS_ICON: Record<StepStatus, string> = {
  pending: '○',
  active:  '⟳',
  done:    '✓',
  error:   '✗',
}

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: 'text-slate-500',
  active:  'text-blue-400 animate-spin',
  done:    'text-green-400',
  error:   'text-red-400',
}

export function AutoMappingModal({ state, onClose }: Props) {
  const { t } = useLocale()
  const logRef = useRef<HTMLDivElement>(null)

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [state.logLines])

  const doneSteps = state.steps.filter(s => s.status === 'done').length
  const progress = Math.round((doneSteps / state.steps.length) * 100)

  const overallStatus = state.report?.overallStatus
  const headerBadge = overallStatus
    ? overallStatus === 'success'
      ? { label: t('autoMapping.statusSuccess'), cls: 'bg-green-900 text-green-300' }
      : overallStatus === 'partial'
        ? { label: t('autoMapping.statusPartial'), cls: 'bg-yellow-900 text-yellow-300' }
        : { label: t('autoMapping.statusFailed'), cls: 'bg-red-900 text-red-300' }
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[520px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-slate-800 px-4 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm text-slate-100">
            {state.isComplete ? t('autoMapping.done') : t('autoMapping.modalTitle')}
          </span>
          {headerBadge && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${headerBadge.cls}`}>
              {headerBadge.label}
            </span>
          )}
        </div>

        <div className="p-4 space-y-4">

          {/* Step list */}
          <div className="space-y-1.5">
            {state.steps.map(step => (
              <div key={step.key} className="flex items-center gap-2.5">
                <span className={`text-sm w-4 text-center ${STATUS_COLOR[step.status]}`}>
                  {STATUS_ICON[step.status]}
                </span>
                <span className={`text-xs ${step.status === 'done' ? 'text-slate-400 line-through' : step.status === 'active' ? 'text-slate-100 font-medium' : 'text-slate-600'}`}>
                  {t(step.i18nKey)}
                </span>
                {step.badge && (
                  <span className="ml-auto text-[10px] px-2 py-0.5 rounded bg-green-900/60 text-green-300">
                    {step.badge}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div className="bg-slate-700 rounded h-1.5">
            <div
              className={`h-1.5 rounded transition-all duration-300 ${overallStatus === 'failed' ? 'bg-red-500' : overallStatus === 'partial' ? 'bg-yellow-400' : 'bg-blue-500'}`}
              style={{ width: `${state.isComplete ? 100 : progress}%` }}
            />
          </div>

          {/* Summary cards — shown after completion */}
          {state.isComplete && state.report && (
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'GCP', value: state.report.gcpsCreated, cls: 'text-green-400' },
                { label: 'BESS', value: state.report.bessCreated, cls: 'text-green-400' },
                { label: 'SOLAR', value: state.report.solarCreated, cls: 'text-green-400' },
                { label: t('autoMapping.warnings'), value: state.report.warnings.length, cls: state.report.warnings.length > 0 ? 'text-yellow-400' : 'text-green-400' },
              ].map(card => (
                <div key={card.label} className="bg-slate-800 border border-slate-600 rounded p-2 text-center">
                  <div className={`text-lg font-bold ${card.cls}`}>{card.value}</div>
                  <div className="text-[9px] text-slate-400 mt-0.5">{card.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Log area */}
          <div
            ref={logRef}
            className="bg-slate-950 border border-slate-800 rounded p-2.5 h-28 overflow-y-auto font-mono text-[10px] space-y-0.5"
          >
            {state.logLines.map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith('[OK]') ? 'text-green-400' :
                  line.startsWith('[WARN]') ? 'text-yellow-400' :
                  line.startsWith('[ERROR]') ? 'text-red-400' :
                  'text-slate-500'
                }
              >
                {line}
              </div>
            ))}
          </div>

          {/* Warnings detail */}
          {state.isComplete && state.warnings.length > 0 && (
            <div className="bg-yellow-950/40 border border-yellow-800/50 rounded p-2.5 text-xs space-y-1">
              <div className="text-yellow-400 font-semibold">
                ⚠ {t('autoMapping.warnings', { count: String(state.warnings.length) })}
              </div>
              {state.warnings.map((w, i) => (
                <div key={i} className="text-yellow-200/80">• {w.message}{w.column ? ` (${w.column})` : ''}</div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            {state.isComplete ? (
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
              >
                {t('autoMapping.viewMapping')} →
              </button>
            ) : (
              <button
                disabled
                className="px-4 py-1.5 rounded bg-slate-700 text-slate-500 text-xs cursor-not-allowed"
              >
                {t('autoMapping.cancel')}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/settings/AutoMappingModal.tsx
git commit -m "feat(client): add AutoMappingModal with stepper, log, and summary cards"
```

---

## Task 9: AutoMappingButton + ConfirmDialog

**Files:**
- Create: `client/src/components/settings/AutoMappingButton.tsx`

- [ ] **Step 1: Create the component**

Create `client/src/components/settings/AutoMappingButton.tsx`:

```tsx
import { useState } from 'react'
import { useLocale } from '../../context/LocaleContext'
import { CompanyMapping } from '@shared/types/assetMapping.types'
import { useAutoMapping } from '../../hooks/useAutoMapping'
import { AutoMappingModal } from './AutoMappingModal'

interface Props {
  companies: CompanyMapping[]
  onMappingComplete: () => void  // called when mapping is saved — triggers profile reload
}

export function AutoMappingButton({ companies, onMappingComplete }: Props) {
  const { t } = useLocale()
  const [showConfirm, setShowConfirm] = useState(false)
  const [showModal, setShowModal] = useState(false)

  const mappingState = useAutoMapping(() => {
    // no-op here — onClose handles the reload
  })

  const totalGcps = companies.reduce((n, c) => n + c.gridConnectionPoints.length, 0)
  const totalComponents = companies.reduce(
    (n, c) => n + c.gridConnectionPoints.reduce((m, g) => m + g.components.length, 0),
    0,
  )
  const hasExisting = companies.length > 0

  const handleButtonClick = () => {
    if (hasExisting) {
      setShowConfirm(true)
    } else {
      startMapping()
    }
  }

  const startMapping = () => {
    setShowConfirm(false)
    setShowModal(true)
    mappingState.run()
  }

  const handleModalClose = () => {
    setShowModal(false)
    mappingState.reset()
    if (mappingState.report) {
      onMappingComplete()
    }
  }

  return (
    <>
      <button
        onClick={handleButtonClick}
        className="px-3 py-1.5 rounded border border-blue-500 text-blue-400 hover:bg-blue-500/10 text-sm font-medium transition-colors"
      >
        ⚡ {t('autoMapping.button')}
      </button>

      {/* Confirm Dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-96 shadow-2xl">
            <div className="text-sm font-semibold text-slate-100 mb-2">
              ⚠ {t('autoMapping.confirmTitle')}
            </div>
            <div className="text-xs text-slate-400 mb-4 leading-relaxed">
              {t('autoMapping.confirmBody', {
                gcpCount: String(totalGcps),
                componentCount: String(totalComponents),
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-3 py-1.5 rounded border border-slate-600 text-slate-400 hover:bg-slate-700 text-xs"
              >
                {t('autoMapping.cancel')}
              </button>
              <button
                onClick={startMapping}
                className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-semibold"
              >
                {t('autoMapping.confirmProceed')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress Modal */}
      {showModal && (
        <AutoMappingModal
          state={mappingState}
          onClose={handleModalClose}
        />
      )}
    </>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/settings/AutoMappingButton.tsx
git commit -m "feat(client): add AutoMappingButton with ConfirmDialog"
```

---

## Task 10: Wire Into AssetMappingForm

**Files:**
- Modify: `client/src/components/settings/AssetMappingForm.tsx`

- [ ] **Step 1: Add imports to `AssetMappingForm.tsx`**

At the top of the file, add:
```typescript
import { AutoMappingButton } from './AutoMappingButton'
```

- [ ] **Step 2: Add `handleMappingComplete` callback**

Inside the `AssetMappingForm` function body, after the existing state declarations, add:
```typescript
const handleMappingComplete = () => {
  // Reload profile from server so the form reflects the new auto-mapped state
  // useProfile's updateProfile re-fetches when called with undefined (or use the existing reload)
  // The profile context should expose a reload function; if not, reload the page as fallback
  window.location.reload()
}
```
> **Note:** If `ProfileContext` exposes a `reloadProfile()` function, use that instead of `window.location.reload()`. Check `client/src/context/ProfileContext.tsx` — if a reload function exists, use it here.

- [ ] **Step 3: Mount the button in the form JSX**

Find the save button area at the top of the form JSX (search for `t('common.save')` or `t('common.saving')`). Add `<AutoMappingButton>` adjacent to it:

```tsx
<div className="flex items-center gap-2">
  <AutoMappingButton
    companies={companies}
    onMappingComplete={handleMappingComplete}
  />
  {/* existing save button stays here */}
</div>
```

Wrap the existing save button in the same `<div>` if it isn't already grouped.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 5: Run server tests one final time**

```bash
cd server && npm test
```
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/settings/AssetMappingForm.tsx
git commit -m "feat(settings): wire AutoMappingButton into AssetMappingForm"
```

---

## Manual Smoke Test

After all tasks are complete, do a manual end-to-end check:

1. Start the dev server: `npm run dev` from the project root
2. Log in via the portal
3. Navigate to **Settings → Asset Mapping**
4. Confirm the **Auto Mapping** button appears next to Save
5. Click it — if mapping exists, the confirm dialog should appear
6. Proceed — the modal should open, SSE events should stream in real time
7. After completion, click **"Mapping'i Görüntüle →"** and verify the form shows the generated GCPs
8. Test edge case: log in with a group whose `Technical_Parameters.csv` has a battery column with no `Asset_ID` — confirm warning is shown without crashing

---

## Out of Scope (do not implement)

- Partial/additive merge (always replace)
- Component type auto-detection from portal `typeId`
- Monitoring metrics auto-population (only `masternode` set, `metrics[]` stays empty)
- Schedule file pattern auto-generation
