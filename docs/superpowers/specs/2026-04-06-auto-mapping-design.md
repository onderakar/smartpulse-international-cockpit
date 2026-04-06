# Auto Mapping Feature — Design Spec

**Date:** 2026-04-06
**Status:** Approved
**Branch:** feature/asset-mapping-gcp-rename

---

## Overview

Auto Mapping is a one-click feature that automatically generates the full `AssetMapping` structure (GridConnectionPoints + Components) from two sources:

1. **Phase 1 — CSV:** Read `Technical_Parameters.csv` from FTP. Every column (after the first two metadata columns `#` and `Variable`) represents a battery unit. Create one GCP per battery, with a BESS component and optionally a SOLAR component.
2. **Phase 2 — Portal API:** Fetch all PowerPlants for the logged-in group. Plants not referenced in the CSV (neither as `Asset_ID` nor `PV_Asset_ID`) become standalone GCPs with a single component (default type: SOLAR, user updates manually).

The result is saved to `GroupProfile.assetMapping` via the existing config store.

---

## Architecture

**Approach: Full Server-Side Pipeline with SSE streaming.**

All business logic runs on the server. The client triggers a single `POST /api/auto-mapping/run` and receives progress via `fetch()` + `ReadableStream` (not `EventSource` — see SSE Client section). Portal cookies and tokens never leave the server session.

```
[AssetMappingForm]
  │
  ├─ "Auto Mapping" button (top of form, next to Save)
  │      │
  │      ├─ Existing mapping? → ConfirmDialog (shows current GCP/component count)
  │      │       └─ t('autoMapping.confirmProceed') → open progress modal
  │      └─ No mapping → open progress modal directly
  │
  └─ POST /api/auto-mapping/run  (SSE stream)
         │
         ├─ [PHASE 1] FTP read Technical_Parameters.csv
         │       └─ parseAutoMappingCsv() → CsvParseResult
         │
         ├─ [PHASE 1] Build GCPs from CSV battery columns
         │       ├─ 1 GCP per battery column
         │       ├─ 1 BESS component (portalPlantId = Asset_ID row)
         │       └─ 1 SOLAR component if PV_Asset_ID row has a value
         │
         ├─ [PHASE 2] POST /Configuration/GetCompanyPowerPlantConfigurations
         │       └─ Fetch all portal plants for the group
         │
         ├─ [PHASE 2] Filter unmapped plants
         │       └─ plants not in batteryAssetIds ∪ pvAssetIds → standalone GCPs
         │
         └─ Save to configStore → SSE "done" event
```

---

## CSV Format

`Technical_Parameters.csv` structure:

```
#  | Variable                          | BatteryA | BatteryB | ...
1  | Asset_ID                          | 1943     | 1944     |
2  | PV_Asset_ID                       | 3022     | -        |
3  | Masternode                        | SP01...  | SP01...  |
4  | Total_Grid_Capacity_Generation_MW | 50       | 100      |
5  | Total_Grid_Capacity_Consumption_MW| 50       | 100      |
6  | Porfolio_ID_DAM_GEN               | PORTF_1  | PORTF_2  |
7  | Max_Battery_Discharge_Power_MW    | 50       | 100      |
8  | Max_Battery_Charge_Power_MW       | 50       | 100      |
9  | Battery_Capacity_MWh              | 100      | 200      |
10 | Charge_Efficiency_Percentage      | 95       | 95       |
11 | Discharge_Efficiency_Percentage   | 95       | 95       |
12 | Min_SOC_Percentage                | 10       | 10       |
13 | Max_SOC_Percentage                | 90       | 90       |
14 | PV_Capacity_MW_ac                 | 30       | -        |
15 | PV_Capacity_MWp                   | 35       | -        |
```

**Notes:**
- Columns 0 (`#`) and 1 (`Variable`) are metadata — skip them, battery columns start at index 2.
- `-` or empty cell = no value, treat as absent.
- Row key matching is **case-insensitive + trim whitespace** (tolerant parsing).
- `Porfolio_ID_DAM_GEN` has a known typo — the parser must match it via an explicit alias in the key lookup map (alongside the correctly-spelled version).

---

## Data Model Changes

All changes in `shared/src/types/assetMapping.types.ts`.

### GridConnectionPoint — new optional fields

`GridConnectionPoint.id` is currently `number` in the codebase. Auto Mapping keeps it as `number` and generates IDs using `Date.now() + index` (ensures uniqueness within a single run; no migration required).

```typescript
interface GridConnectionPoint {
  id: number;                   // UNCHANGED — auto-mapping uses Date.now() + index
  name: string;
  timezone: string;
  resolutionMinutes: MTUResolution;
  components: GcpComponent[];
  // NEW optional fields
  maxInjectionMw?: number;      // Total_Grid_Capacity_Generation_MW
  maxConsumptionMw?: number;    // Total_Grid_Capacity_Consumption_MW
  damPortfolioId?: string;      // Porfolio_ID_DAM_GEN (typo-tolerant lookup)
}
```

`BessGcpInfo.gcpId` stays `number` — no migration needed.

### GcpComponent — new optional fields

```typescript
interface GcpComponent {
  componentId: string;
  type: ComponentType;
  displayName: string;
  portalPlantId: number;          // Always set — Phase 1: Asset_ID / PV_Asset_ID, Phase 2: PowerPlantId
  forecastPreference: { sourceName: string; beforeMinutes: number };
  scheduleId?: string;
  scheduleFilePattern?: string;
  monitoring?: { masternode: string; metrics: Array<LabeledMetricMapping | BapSource> };
  // NEW optional fields
  bessParams?: BessParams;           // Only populated when type === 'BESS'
  installedCapacityMw?: number;      // BESS: maxDischargePowerMw; Phase 2: InstalledPowerMW
  installedCapacityAcMw?: number;    // SOLAR only: PV_Capacity_MW_ac
  installedCapacityDcMwp?: number;   // SOLAR only: PV_Capacity_MWp
}
```

**`installedCapacityMw` semantics:**
- BESS component → set to `bessParams.maxDischargePowerMw` (discharge = effective installed power)
- SOLAR component → NOT set (use `installedCapacityAcMw` instead); `installedCapacityMw` remains `undefined`
- Phase 2 standalone → set to `PowerPlantLimit.InstalledPowerMW`

### New: BessParams interface

```typescript
interface BessParams {
  maxDischargePowerMw: number;    // Max_Battery_Discharge_Power_MW
  maxChargePowerMw: number;       // Max_Battery_Charge_Power_MW
  capacityMwh: number;            // Battery_Capacity_MWh
  chargeEfficiency: number;       // Charge_Efficiency_Percentage
  dischargeEfficiency: number;    // Discharge_Efficiency_Percentage
  minSocPct: number;              // Min_SOC_Percentage
  maxSocPct: number;              // Max_SOC_Percentage
}
```

### New: Auto Mapping result types (shared)

```typescript
interface AutoMappingReport {
  gcpsCreated: number;
  bessCreated: number;
  solarCreated: number;
  unmappedGcpsCreated: number;
  warnings: AutoMappingWarning[];
  skipped: AutoMappingSkipped[];
  overallStatus: 'success' | 'partial' | 'failed';
}

interface AutoMappingWarning {
  type: 'duplicate_plant_id' | 'missing_asset_id' | 'name_conflict' | 'unknown_type' | 'parse_error';
  message: string;
  column?: string;
}

interface AutoMappingSkipped {
  plantId: number;
  plantName: string;
  reason: string;
}
```

---

## i18n — Translation Keys

All user-facing strings in the Auto Mapping feature **must** use `t('key')` from `useLocale()`. Add the following keys to `shared/src/constants/translations.ts`:

```typescript
// Auto Mapping
'autoMapping.button'                // "Auto Mapping"
'autoMapping.confirmTitle'          // "Mevcut Mapping Silinecek"
'autoMapping.confirmBody'           // "{gcpCount} GCP ve {componentCount} bileşen tanımlı. Auto Mapping çalıştırılırsa mevcut yapılandırma silinecek."
'autoMapping.confirmProceed'        // "Evet, Devam Et"
'autoMapping.cancel'                // "İptal"
'autoMapping.modalTitle'            // "Auto Mapping"
'autoMapping.done'                  // "Auto Mapping Tamamlandı"
'autoMapping.viewMapping'           // "Mapping'i Görüntüle"
'autoMapping.statusSuccess'         // "BAŞARILI"
'autoMapping.statusPartial'         // "KISMI BAŞARI"
'autoMapping.statusFailed'          // "BAŞARISIZ"
'autoMapping.step.csvRead'          // "CSV okundu"
'autoMapping.step.phase1Done'       // "Phase 1 GCP'ler oluşturuldu"
'autoMapping.step.portalFetch'      // "Portal plants çekildi"
'autoMapping.step.phase2Done'       // "Phase 2 GCP'ler oluşturuldu"
'autoMapping.step.saved'            // "Mapping kaydedildi"
'autoMapping.error.portalFailed'    // "Portal bağlantısı kurulamadı. Phase 1 sonuçları korundu."
'autoMapping.error.csvFailed'       // "CSV okunamadı. İşlem iptal edildi."
'autoMapping.warn.missingAssetId'   // "{column}: Asset_ID boş, BESS oluşturulmadı"
'autoMapping.warn.duplicatePlantId' // "Plant ID {id} zaten eşleştirildi, atlandı"
'autoMapping.warn.defaultType'      // "Plant#{id} için tip belirlenemedi, varsayılan SOLAR kullanıldı"
'autoMapping.warn.nameNormalized'   // '"{original}" ismi normalize edildi → "{normalized}"'
'autoMapping.warnings'              // "{count} Uyarı"
```

No hardcoded Turkish (or any language) strings in component JSX or SSE `userMessage` fields. Server-side `userMessage` values in SSE error events must use translation keys, not inline strings — the client resolves them via `t()`.

---

## Server: New Endpoint

### `POST /api/auto-mapping/run`

- **Auth:** `sessionAuth` middleware (requires valid portal session)
- **Response:** `text/event-stream` (SSE)
- **Body:** `{}` (no input needed — reads FTP filename and direction from saved profile on server)
- **FTP direction:** uses `profile.assetMapping.ftpDirection` (defaults to `'incoming'` if mapping not yet set)
- **FTP filename:** uses `profile.assetMapping.ftpFilename` (defaults to `'Technical_Parameters.csv'`)
- **Reuses** `ftpService.readFile()` directly — does NOT call `/api/ftp/read-tech-params`

### SSE Event Schema

```typescript
type AutoMappingEvent =
  | { step: 'csv_read';        status: 'ok';    batteriesFound: number }
  | { step: 'gcp_phase1';      status: 'ok';    name: string; bessPlantId: number; pvPlantId?: number }
  | { step: 'phase1_done';     status: 'ok';    gcps: number; bess: number; solar: number }
  | { step: 'portal_fetch';    status: 'ok';    plantsFound: number }
  | { step: 'gcp_phase2';      status: 'ok';    name: string; plantId: number }
  | { step: 'phase2_done';     status: 'ok';    unmappedGcps: number }
  | { step: 'saved';           status: 'ok' }
  | { step: 'done';            status: 'ok';    report: AutoMappingReport }
  | { step: 'warning';         warnType: AutoMappingWarning['type']; i18nKey: string; params?: Record<string, string | number> }
  | { step: 'error';           status: 'failed'; i18nKey: string }
```

All user-facing messages in events carry an `i18nKey` (matching the keys above) plus optional `params` for interpolation. The client calls `t(event.i18nKey, event.params)` — no language-specific strings on the server.

---

## SSE Client (fetch-based)

`EventSource` only supports GET — this endpoint is POST. The `useAutoMapping` hook uses `fetch()` + `ReadableStream`:

```typescript
const response = await fetch('/api/auto-mapping/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
})

const reader = response.body!.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  const text = decoder.decode(value)
  // Parse SSE lines: "data: {...}\n\n"
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      const event: AutoMappingEvent = JSON.parse(line.slice(6))
      dispatch(event)
    }
  }
}
```

No external SSE library needed.

---

## Server: New Service

### `server/src/utils/autoMappingParser.ts`

```typescript
interface CsvParseResult {
  batteries: BatteryColumn[];
  warnings: AutoMappingWarning[];
}

interface BatteryColumn {
  name: string;                  // column header, e.g. "Nikolichevtsi"
  assetId: number | null;        // Asset_ID row
  pvAssetId: number | null;      // PV_Asset_ID row; null if '-' or empty
  masternode: string | null;
  maxInjectionMw: number | null;
  maxConsumptionMw: number | null;
  damPortfolioId: string | null;
  bessParams: Partial<BessParams>;
  pvCapacityAcMw: number | null;
  pvCapacityDcMwp: number | null;
}

function parseAutoMappingCsv(csvContent: string): CsvParseResult
```

**Parse rules:**
- Read rows into `Map<normalizedKey, string[]>` where key = `value.toLowerCase().trim()`
- Key alias map: `porfolio_id_dam_gen` → same handler as `portfolio_id_dam_gen`
- Battery columns = all columns from index 2 onwards (skip `#` and `Variable`)
- For each value: strip whitespace; if `-`, `''`, or `undefined` → `null`
- Numeric parse: strip spaces, replace `,` with `.`, then `parseFloat`; on NaN → `null` + emit `parse_error` warning
- `pvAssetId`: if column value is `-` or empty → `null` (no SOLAR component)

### `server/src/services/autoMapping.service.ts`

```typescript
async function runAutoMapping(
  session: PortalSession,
  profile: GroupProfile,
  emit: (event: AutoMappingEvent) => void
): Promise<void>

async function fetchCompanyPowerPlants(
  cookies: string[],
  env: string,
  accessToken: string
): Promise<CompanyPowerPlantConfig[]>
```

---

## Portal API Integration

Called from server during Phase 2:

```
POST {PORTAL_BASE_URL}/Configuration/GetCompanyPowerPlantConfigurations
Headers:
  Cookie: <session.portalCookies joined>
  Authorization: Bearer <session.portalAccessToken>
Body: {}
```

**Response model used:**
```typescript
interface CompanyPowerPlantConfig {
  CompanyId: number;
  CompanyName: string;
  PowerPlantLimits: PowerPlantLimit[];
  // IsSfk, ignored for EU
}

interface PowerPlantLimit {
  PowerPlantId: number;
  PowerPlantName: string;
  InstalledPowerMW: number;
  // Pfk*, Sfk* fields ignored for EU
}
```

---

## Company Assignment Strategy

Phase 2's portal response (`CompanyPowerPlantConfig[]`) is used for **both** company grouping and phase2 GCPs. The algorithm:

1. Build a lookup: `plantIdToCompany: Map<number, { CompanyId, CompanyName }>` from the full portal response.
2. **Phase 1 GCPs** → look up each `battery.assetId` in `plantIdToCompany` to determine which `CompanyMapping` they belong to.
3. **Phase 2 GCPs** → already grouped by `CompanyId` from the portal response.
4. Merge all GCPs into `CompanyMapping[]`, creating new `CompanyMapping` entries as needed (matched by `companyId`).

**If Phase 2 fails (portal error):**
- Phase 1 GCPs cannot be looked up for company assignment.
- Fallback: place all Phase 1 GCPs under a single `CompanyMapping` using the first company from `session.companies[]` (the logged-in user's group companies from the original login response).
- If `session.companies` is also empty, use `companyId: 0, companyName: 'Auto Mapped'` as a placeholder.
- Emit `phase2_done` with `unmappedGcps: 0` and mark `overallStatus: 'partial'`.
- Phase 1 result is always saved regardless of Phase 2 outcome.

---

## Mapping Algorithm (Pseudo-code)

```
FUNCTION runAutoMapping(session, profile, emit):

  // === PHASE 1 ===
  ftpDirection = profile.assetMapping?.ftpDirection ?? 'incoming'
  ftpFilename  = profile.assetMapping?.ftpFilename  ?? 'Technical_Parameters.csv'

  TRY:
    csvContent = ftpService.readFile(session.cookies, session.env, ftpDirection, ftpFilename)
  CATCH:
    emit({ step: 'error', i18nKey: 'autoMapping.error.csvFailed' })
    RETURN

  result = parseAutoMappingCsv(csvContent)
  emit({ step: 'csv_read', batteriesFound: result.batteries.length })
  FOR EACH w IN result.warnings: emit({ step: 'warning', ...w })

  batteryAssetIds = new Set<number>()
  pvAssetIds = new Set<number>()
  seenPlantIds = new Set<number>()
  phase1Gcps: GridConnectionPoint[] = []
  idBase = Date.now()

  FOR EACH (index, battery) IN result.batteries:
    IF battery.assetId IS NULL:
      emit warning: missing_asset_id, i18nKey: 'autoMapping.warn.missingAssetId', column: battery.name
      CONTINUE

    IF battery.assetId IN seenPlantIds:
      emit warning: duplicate_plant_id
      CONTINUE

    seenPlantIds.add(battery.assetId)
    batteryAssetIds.add(battery.assetId)

    gcpName = sanitizeName(battery.name) + '_GCP'
    // Name collision: append _2, _3 until unique within this run
    gcpName = resolveNameConflict(gcpName, usedNames)
    IF name was changed: emit warning name_conflict

    gcp: GridConnectionPoint = {
      id: idBase + index,
      name: gcpName,
      timezone: resolveGroupTimezone(session),
      resolutionMinutes: 15,
      maxInjectionMw: battery.maxInjectionMw ?? undefined,
      maxConsumptionMw: battery.maxConsumptionMw ?? undefined,
      damPortfolioId: battery.damPortfolioId ?? undefined,
      components: []
    }

    bessComponent: GcpComponent = {
      componentId: generateId(),
      type: 'BESS',
      displayName: battery.name,
      portalPlantId: battery.assetId,
      forecastPreference: DEFAULT_FORECAST_PREFERENCE,
      monitoring: battery.masternode
        ? { masternode: battery.masternode, metrics: [] }
        : undefined,
      bessParams: normalizeBessParams(battery.bessParams),
      installedCapacityMw: battery.bessParams.maxDischargePowerMw ?? undefined,
    }
    gcp.components.push(bessComponent)

    IF battery.pvAssetId IS NOT NULL AND NOT IN seenPlantIds:
      seenPlantIds.add(battery.pvAssetId)
      pvAssetIds.add(battery.pvAssetId)

      pvComponent: GcpComponent = {
        componentId: generateId(),
        type: 'SOLAR',
        displayName: battery.name + '_PV',
        portalPlantId: battery.pvAssetId,
        forecastPreference: DEFAULT_FORECAST_PREFERENCE,
        monitoring: battery.masternode
          ? { masternode: battery.masternode, metrics: [] }
          : undefined,
        installedCapacityAcMw: battery.pvCapacityAcMw ?? undefined,
        installedCapacityDcMwp: battery.pvCapacityDcMwp ?? undefined,
        // installedCapacityMw NOT set for SOLAR (use installedCapacityAcMw)
      }
      gcp.components.push(pvComponent)

    phase1Gcps.push(gcp)
    emit({ step: 'gcp_phase1', name: gcpName, bessPlantId: battery.assetId, pvPlantId: battery.pvAssetId })

  emit({ step: 'phase1_done', gcps: phase1Gcps.length, ... })

  // === PHASE 2 ===
  portalConfigs: CompanyPowerPlantConfig[] = []
  plantIdToCompany = new Map()
  phase2Success = false

  TRY:
    portalConfigs = fetchCompanyPowerPlants(session.cookies, session.env, session.portalAccessToken)
    FOR EACH config IN portalConfigs:
      FOR EACH plant IN config.PowerPlantLimits:
        plantIdToCompany.set(plant.PowerPlantId, { CompanyId: config.CompanyId, CompanyName: config.CompanyName })
    emit({ step: 'portal_fetch', plantsFound: total })
    phase2Success = true
  CATCH:
    emit({ step: 'error', i18nKey: 'autoMapping.error.portalFailed' })
    emit({ step: 'phase2_done', unmappedGcps: 0 })  // Always emit to close Phase 2 in UI
    // Do NOT abort — continue with Phase 1 only

  excludedIds = batteryAssetIds ∪ pvAssetIds
  phase2Gcps: GridConnectionPoint[] = []

  IF phase2Success:
    FOR EACH config IN portalConfigs:
      FOR EACH plant IN config.PowerPlantLimits:
        IF plant.PowerPlantId IN excludedIds: CONTINUE
        IF plant.PowerPlantId IN seenPlantIds:
          emit warning: duplicate_plant_id
          CONTINUE
        IF plant.PowerPlantId <= 0: CONTINUE  // guard against invalid IDs

        seenPlantIds.add(plant.PowerPlantId)
        gcpName = sanitizeName(plant.PowerPlantName) + '_GCP'
        gcpName = resolveNameConflict(gcpName, usedNames)

        gcp = {
          id: idBase + phase1Gcps.length + phase2Gcps.length,
          name: gcpName,
          timezone: resolveGroupTimezone(session),
          resolutionMinutes: 15,
          components: [{
            componentId: generateId(),
            type: 'SOLAR',   // default, user updates manually
            displayName: plant.PowerPlantName,
            portalPlantId: plant.PowerPlantId,
            installedCapacityMw: plant.InstalledPowerMW > 0 ? plant.InstalledPowerMW : undefined,
            forecastPreference: DEFAULT_FORECAST_PREFERENCE,
          }]
        }
        phase2Gcps.push(gcp)
        emit({ step: 'gcp_phase2', name: gcpName, plantId: plant.PowerPlantId })

    emit({ step: 'phase2_done', unmappedGcps: phase2Gcps.length })

  // === COMPANY ASSIGNMENT ===
  companyMap = new Map<number, CompanyMapping>()

  // Phase 1: assign to company via portal lookup (or fallback)
  FOR EACH gcp IN phase1Gcps:
    bessPlantId = gcp.components.find(BESS)?.portalPlantId
    companyInfo = plantIdToCompany.get(bessPlantId)
      ?? fallbackCompany(session)  // first from session.companies or { id:0, name:'Auto Mapped' }

    IF NOT companyMap.has(companyInfo.CompanyId):
      companyMap.set(companyInfo.CompanyId, newCompanyMapping(companyInfo, session.groupTimezone))
    companyMap.get(companyInfo.CompanyId).gridConnectionPoints.push(gcp)

  // Phase 2: already grouped by CompanyId
  IF phase2Success:
    FOR EACH config IN portalConfigs:
      FOR EACH gcp IN phase2Gcps that belong to this config:
        IF NOT companyMap.has(config.CompanyId):
          companyMap.set(config.CompanyId, newCompanyMapping(config, session.groupTimezone))
        companyMap.get(config.CompanyId).gridConnectionPoints.push(gcp)

  newMapping: AssetMapping = {
    companies: [...companyMap.values()],
    ftpDirection: profile.assetMapping?.ftpDirection ?? 'incoming',
    ftpFilename:  profile.assetMapping?.ftpFilename  ?? 'Technical_Parameters.csv',
  }

  configStore.saveProfile(session.username, { ...profile, assetMapping: newMapping }, session.groupId)
  emit({ step: 'saved' })

  overallStatus = phase2Success ? 'success' : 'partial'
  emit({ step: 'done', report: buildReport(phase1Gcps, phase2Gcps, warnings, overallStatus) })
```

---

## Default Values & Helpers

```typescript
// server/src/services/autoMapping.service.ts

const DEFAULT_FORECAST_PREFERENCE = {
  sourceName: 'FinalForecast',  // Valid for prod/staging/demo portal environments
  beforeMinutes: 60,
}

// componentId generation — Node built-in, no extra dependency
function generateId(): string {
  return crypto.randomUUID()  // Node 14.17+ built-in (node:crypto)
}

// Derive GCP timezone from session group
function resolveGroupTimezone(session: UserSession): string {
  return session.groups.find(g => g.id === session.groupId)?.timezone ?? 'UTC'
  // PortalGroup.timezone is populated at login from the portal login response
  // session.groupId identifies which group the user belongs to
}
```

`'FinalForecast'` is a known-valid source name across all supported SmartPulse portal environments (prod, staging, demo).

Replace all `session.groupTimezone` references in the pseudo-code with `resolveGroupTimezone(session)`.

---

## Frontend

### Button placement

In `AssetMappingForm.tsx`, top of form alongside Save button:

```tsx
<button onClick={handleAutoMapping}>
  {t('autoMapping.button')}
</button>
```

### Components to create

| Component | Location | Purpose |
|-----------|----------|---------|
| `AutoMappingButton.tsx` | `client/src/components/settings/` | Button + confirm dialog |
| `AutoMappingModal.tsx` | `client/src/components/settings/` | Progress modal with SSE stream |
| `useAutoMapping.ts` | `client/src/hooks/` | fetch-based SSE + step state |

### useAutoMapping hook

```typescript
function useAutoMapping() {
  const [isRunning, setIsRunning] = useState(false)
  const [steps, setSteps] = useState<AutoMappingStep[]>([])
  const [report, setReport] = useState<AutoMappingReport | null>(null)

  async function run(): Promise<void>  // POST → ReadableStream parse → dispatch events
  function reset(): void

  return { isRunning, steps, report, run, reset }
}
```

---

## UI Flow

1. User clicks **Auto Mapping** button
2. If existing mapping (`companies.length > 0`):
   - **ConfirmDialog**: shows current GCP + component counts, uses `t('autoMapping.confirmTitle')` etc.
   - "Evet, Devam Et" → proceed; "İptal" → abort
3. **AutoMappingModal** opens, `fetch` stream starts
4. Steps animate in real-time (✓ done, ⟳ active, ○ pending)
5. Progress bar fills as steps complete; log panel streams messages
6. On completion: summary cards (total GCP, BESS, SOLAR, warnings count), warnings listed
7. **"Mapping'i Görüntüle →"** closes modal and triggers profile reload so form reflects new state

---

## Edge Cases & Validation

| Scenario | Handling |
|----------|---------|
| `Asset_ID` empty / `-` | Skip BESS, emit `missing_asset_id` warning |
| `PV_Asset_ID` is `-` or empty | No SOLAR component, continue |
| Same `PowerPlantId` appears twice | Emit `duplicate_plant_id` warning, skip second |
| GCP name collision within run | Append `_2`, `_3` suffix, emit `name_conflict` warning |
| Numeric parse fails (locale/spaces) | Strip whitespace, `,`→`.`, `parseFloat`; NaN → `null` + `parse_error` warning |
| Row key casing/spaces | Normalise: `key.toLowerCase().trim()` |
| `Porfolio_ID_DAM_GEN` typo | Explicit alias in key lookup map |
| Portal API fails (Phase 2) | Emit error event, use fallback company assignment, mark `overallStatus: 'partial'` |
| FTP read fails (Phase 1) | Emit error, abort with `overallStatus: 'failed'` |
| `PowerPlantId <= 0` | Skip silently |
| EU fields (`IsSfk`, `Pfk*`, `Sfk*`) | Ignored |
| Phase 2 company lookup miss | Fallback to `session.companies[0]` or `{ id:0, name:'Auto Mapped' }` |

---

## File Structure

```
server/src/
├── routes/
│   └── autoMapping.routes.ts       NEW
├── services/
│   └── autoMapping.service.ts      NEW
└── utils/
    └── autoMappingParser.ts        NEW

client/src/
├── components/settings/
│   ├── AutoMappingButton.tsx       NEW
│   └── AutoMappingModal.tsx        NEW
└── hooks/
    └── useAutoMapping.ts           NEW

shared/src/
├── types/
│   └── assetMapping.types.ts       MODIFIED — BessParams + 6 optional fields
└── constants/
    └── translations.ts             MODIFIED — autoMapping.* keys
```

---

## Out of Scope

- Partial/additive merge of existing mapping (always replace on confirm)
- Component type auto-detection from portal `typeId` (user updates manually)
- Monitoring metrics auto-population (only `masternode` is set from CSV; `metrics[]` starts empty)
- Schedule file pattern auto-generation (left at system default)
