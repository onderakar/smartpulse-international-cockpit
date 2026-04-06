# Asset Mapping International Adaptation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename UEVCB to GridConnectionPoint (GCP) throughout the codebase, remove `primaryPortalPlantId` from GCP level, rewrite the AssetMappingForm without TR-specific features, and ensure all consumers compile correctly.

**Architecture:** Bottom-up approach — start from shared types (the foundation), then update server-side consumers, then client-side consumers, and finally rewrite the AssetMappingForm. Task 1 adds backward-compat type aliases so the monorepo can compile at each step. Aliases are removed in Task 8. TypeScript compiler is the primary verification tool.

**Tech Stack:** TypeScript, React 19, Express, LowDB, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-06-asset-mapping-international-design.md`

---

### Task 1: Rename Core Types in `assetMapping.types.ts`

This is the foundation — every other task depends on this.

**Files:**
- Modify: `shared/src/types/assetMapping.types.ts`

- [ ] **Step 1: Rename interfaces and type aliases**

Replace the entire file content. Key changes:
- `UEVCBComponentType` → `ComponentType`
- `UEVCBComponent` → `GcpComponent`  (not `Component` to avoid React conflict)
- `UEVCB` → `GridConnectionPoint` with `id: number` instead of `uevcbId: string`, remove `primaryPortalPlantId`
- `CompanyMapping.uevcbs` → `CompanyMapping.gridConnectionPoints`
- `BessUevcbInfo` → `BessGcpInfo` with `gcpId: number`, no `primaryPortalPlantId`, keep singular `bessComponent`
- Default `resolutionMinutes` to `15` in comment

```typescript
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
    for (const gcp of company.gridConnectionPoints) {
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

// ── Backward-compat aliases (remove in Task 8) ──
/** @deprecated Use GridConnectionPoint */
export type UEVCB = GridConnectionPoint;
/** @deprecated Use GcpComponent */
export type UEVCBComponent = GcpComponent;
/** @deprecated Use ComponentType */
export type UEVCBComponentType = ComponentType;
/** @deprecated Use getFirstGcp */
export const getFirstUevcb = getFirstGcp;
/** @deprecated Use getAllGcps */
export const getAllUevcbs = getAllGcps;
/** @deprecated Use getBessGcps */
export const getBessUevcbs = getBessGcps;
/** @deprecated Use BessGcpInfo */
export type BessUevcbInfo = BessGcpInfo;
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd shared && npx tsc --noEmit`
Expected: No errors in assetMapping.types.ts (other files will have errors since they still use old names — that's expected)

- [ ] **Step 3: Commit**

```bash
git add shared/src/types/assetMapping.types.ts
git commit -m "refactor: rename UEVCB to GridConnectionPoint in core types"
```

---

### Task 2: Update Schedule Types

**Files:**
- Modify: `shared/src/types/schedule.types.ts`

- [ ] **Step 1: Update schedule types and functions**

Apply these changes:

1. `DEFAULT_SCHEDULE_FILE_PATTERN`: change `{UEVCB_ID}` to `{GCP_ID}`
2. `ScheduleRevisionStore.uevcbPlantId` → `gcpId: number`
3. `ScheduleFileContext`: rename fields (`uevcbId` → `gcpId`, `uevcbName` → `gcpName`) and update comment
4. `resolveScheduleFilename`: replace `{UEVCB_ID}`, `{UEVCB_NAME}` with `{GCP_ID}`, `{GCP_NAME}`
5. `getScheduleFilename(primaryPortalPlantId)` → `getScheduleFilename(gcpId: number)`
6. `getScheduleFilenameFromMapping`: update to use `gcp.id` instead of `uevcb.primaryPortalPlantId`, iterate `company.gridConnectionPoints`

```typescript
// Line 6 — change pattern
export const DEFAULT_SCHEDULE_FILE_PATTERN = 'Battery_Schedule_{GCP_ID}.csv';

// Lines 87-93 — rename field
export interface ScheduleRevisionStore {
  gcpId: number;
  dateKey: string;
  slots: Record<string, ScheduleSlotRevision[]>;
  lastFetchedAt: number;
  lastCsvHash: string;
}

// Lines 115-121 — rename context fields
export interface ScheduleFileContext {
  gcpId: number;          // GridConnectionPoint's id
  assetId?: number;       // Component's portalPlantId
  scheduleId?: string;    // Component's scheduleId
  gcpName?: string;       // GridConnectionPoint's name
}

// Lines 123-130 — update template replacements
export function resolveScheduleFilename(pattern: string, ctx: ScheduleFileContext): string {
  return pattern
    .replace(/\{GCP_ID\}/g, String(ctx.gcpId))
    .replace(/\{ASSET_ID\}/g, String(ctx.assetId ?? ctx.gcpId))
    .replace(/\{SCHEDULE_ID\}/g, ctx.scheduleId ?? String(ctx.gcpId))
    .replace(/\{GCP_NAME\}/g, ctx.gcpName ?? '');
}

// Lines 132-135 — rename parameter
export function getScheduleFilename(gcpId: number): string {
  return resolveScheduleFilename(DEFAULT_SCHEDULE_FILE_PATTERN, { gcpId });
}

// Lines 137-160 — use gridConnectionPoints and gcp.id
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
```

- [ ] **Step 2: Commit**

```bash
git add shared/src/types/schedule.types.ts
git commit -m "refactor: rename UEVCB references in schedule types to GCP"
```

---

### Task 3: Update Translation Keys

**Files:**
- Modify: `shared/src/constants/translations.ts`

- [ ] **Step 1: Update asset mapping translation keys**

Apply these changes in the `Asset Mapping Form` section (around lines 206-261):

1. `assetMapping.description` — change "UEVCB" to "GCP" in both tr and en
2. `assetMapping.addUevcb` → `assetMapping.addGcp` with text "GCP Ekle" / "Add GCP"
3. `assetMapping.noUevcbs` → `assetMapping.noGcps` with text "GCP yok. Yukaridaki formu kullanarak ekleyin." / "No GCPs. Use the form above to add one."
4. `assetMapping.uevcbName` → `assetMapping.gcpName` with text "GCP Adi" / "GCP Name"
5. `assetMapping.scheduleFilePatternHelp` — change `{UEVCB_ID}` to `{GCP_ID}`, `{UEVCB_NAME}` to `{GCP_NAME}`
6. Remove: `assetMapping.testKgup`, `assetMapping.testKgupTrade`, `assetMapping.testKgupLoading`, `assetMapping.testKgupTradeData`, `assetMapping.testKgupPlants`, `assetMapping.testKgupNoPlants`, `assetMapping.testKgupPrimaryMatch`, `assetMapping.testKgupPrimaryMissing`, `assetMapping.testKgupValues`
7. Add: `assetMapping.gcpId` — "GCP ID" / "GCP ID"
8. Add: `assetMapping.gcpIdPlaceholder` — "GCP ID girin" / "Enter GCP ID"
9. Add: `assetMapping.gcpNamePlaceholder` — "GCP adini girin" / "Enter GCP name"
10. `cache.noUevcb` → `cache.noGcp` with text "GCP yapilandirilmamis..." / "No GCP configured..."

- [ ] **Step 2: Commit**

```bash
git add shared/src/constants/translations.ts
git commit -m "refactor: update translation keys for UEVCB → GCP rename"
```

---

### Task 4: Update Server-Side Consumers

**Files:**
- Modify: `server/src/services/scheduleStore.service.ts`
- Modify: `server/src/services/metadata.service.ts`
- Modify: `server/src/services/configStore.service.ts`
- Modify: `server/src/routes/schedule.routes.ts`

- [ ] **Step 1: Update `scheduleStore.service.ts`**

All methods use `plantId` as a parameter name — these can stay as `plantId` semantically (it still identifies which entity's schedule we're reading) but the stored field must change:

1. Every place that writes `uevcbPlantId: plantId` → change to `gcpId: plantId` (lines 153, 232, 314)
2. Type casts `as ScheduleRevisionStore` are already correct since we changed the interface in Task 2

- [ ] **Step 2: Update `metadata.service.ts`**

Line 24-31: Change `UEVCB_${plantId}` to `GCP_${plantId}` in the asset name pattern.

```typescript
// Line 24 and 29
name: `GCP_${plantId}`,
```

- [ ] **Step 3: Update `configStore.service.ts`**

Line 108: The migration check `(groupProfile.assetMapping as any).uevcb` already handles legacy format. The `migrateAssetMapping` function (updated in Task 1) now handles `uevcbs → gridConnectionPoints` conversion too. No code change needed here — `migrateAssetMapping` does the work.

Verify that `migrateAssetMapping` import still works (it's imported from `@smartpulse-intl/shared` which re-exports from `assetMapping.types.ts`).

- [ ] **Step 4: Update `schedule.routes.ts`**

The route uses `getScheduleFilenameFromMapping(profile?.assetMapping, plantId)` — this function was updated in Task 2 to accept `gcpId: number` parameter. The variable name `plantId` in the route can stay (it comes from `req.body.plantId`) — the semantics are: "the numeric ID identifying the GCP for schedule lookup". No renaming needed in the route itself since the function signature accepts a `number` parameter.

Optionally rename the request body field comment for clarity, but the actual field name stays `plantId` for API backward compatibility.

- [ ] **Step 5: Verify server compilation**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add server/src/services/scheduleStore.service.ts server/src/services/metadata.service.ts server/src/services/configStore.service.ts server/src/routes/schedule.routes.ts
git commit -m "refactor: update server-side consumers for GCP rename"
```

---

### Task 5: Update Client-Side Consumers (Non-Form)

**Files:**
- Modify: `client/src/components/layout/Header.tsx`
- Modify: `client/src/hooks/useAlertEngine.ts`
- Modify: `client/src/hooks/useScheduleData.ts`
- Modify: `client/src/context/ForecastContext.tsx`
- Modify: `client/src/components/settings/CacheManagement.tsx`
- Modify: `client/src/services/monitoringCache.ts`

- [ ] **Step 1: Update `Header.tsx`**

```typescript
// Line 4: change import
import { getFirstGcp } from '@shared/types/assetMapping.types';

// Line 13: change function call
const activeGcp = getFirstGcp(profile?.assetMapping);

// Line 68: change variable reference
{activeGcp && (
  <span className="text-xs text-gray-400 bg-dark-700 px-3 py-1 rounded-full">
    {activeGcp.name}
  </span>
)}
```

- [ ] **Step 2: Update `useAlertEngine.ts`**

```typescript
// Line 9: change import
import { getFirstGcp } from '@shared/types/assetMapping.types';

// Line 21: change function call
const gcp = useMemo(() => getFirstGcp(mapping), [mapping]);
const tz = gcp?.timezone || 'UTC';

// Line 24: change to gcp.id
const scheduleGcpId = gcp?.id ?? null;

// Line 30-33: update useScheduleData call
const { rows: scheduleRows } = useScheduleData({
  plantId: scheduleGcpId,
  dateKey: scheduleDateKey,
  enabled: scheduleGcpId !== null,
});
```

- [ ] **Step 3: Update `ForecastContext.tsx`**

```typescript
// Line 14: change imports
import { getFirstGcp, getAllGcps } from '@shared/types/assetMapping.types';

// Line 25-26: change cache key comment
// Cache — keyed by "gcpId::dateKey" so data is reused across screens

// Line 36-38: rename cache key builder
function buildCacheKey(gcpId: number, dateKey: string): string {
  return `${gcpId}::${dateKey}`;
}

// Line 111-112: update function calls
const allGcps = useMemo(() => getAllGcps(mapping), [mapping]);
const activeGcp = allGcps[0] ?? getFirstGcp(mapping);

// Line 116: update timezone access
const tz = activeGcp?.timezone || 'UTC';

// Line 134: update null check
if (!companyId || !activeGcp) {

// Line 139: update cache key source
const gcpId = activeGcp.id;

// Line 143: update cache key call
const cacheKey = buildCacheKey(gcpId, dateKey);

// Lines 167-185: component forecasts stay the same (already component-level)

// Lines 187-200: REMOVE the UEVCB-level FinalForecast request block entirely.
// GCP forecast = sum of component forecasts, computed at runtime.
// After Promise.allSettled, add aggregation logic:
// For each time point across all component forecast series, sum the values
// to produce a single "GCP Aggregate Forecast" series.
// Example aggregation (add after building individual series):
//
// if (series.length > 1) {
//   const aggregateMap = new Map<number, number>();
//   for (const s of series) {
//     for (const pt of s.data) {
//       aggregateMap.set(pt.timestamp, (aggregateMap.get(pt.timestamp) ?? 0) + pt.value);
//     }
//   }
//   const aggregateData = [...aggregateMap.entries()]
//     .sort((a, b) => a[0] - b[0])
//     .map(([timestamp, value]) => ({ timestamp, value }));
//   series.unshift({
//     label: `${activeGcp.name} Total`,
//     data: aggregateData,
//     color: FORECAST_COLORS[series.length % FORECAST_COLORS.length],
//   });
// }

// Line 253: update cache key call
const cacheKey = buildCacheKey(gcpId, dateKey);
```

- [ ] **Step 4: Update `CacheManagement.tsx`**

```typescript
// Line 4: change import
import { getFirstGcp } from '@shared/types/assetMapping.types';

// Line 13: change function call
const gcp = getFirstGcp(mapping);

// Line 37: change to gcp.id
if (!gcp?.id) return;

// Lines 39-41: update company matching to use gridConnectionPoints
const companyMatch = mapping?.companies?.find((c: any) =>
  c.gridConnectionPoints.some((g: any) => g.id === gcp.id)
);

// Lines 49-50: Replace hardcoded UTC+3 with dynamic timezone computation.
// Use the same approach as ForecastContext (toLocaleString UTC vs TZ diff):
const now = new Date();
const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
const tzStr = now.toLocaleString('en-US', { timeZone: gcp.timezone || 'UTC' });
const tzOffsetMs = new Date(tzStr).getTime() - new Date(utcStr).getTime();
const tzOffsetHours = tzOffsetMs / 3600000;
const sign = tzOffsetHours >= 0 ? '+' : '-';
const absHours = String(Math.floor(Math.abs(tzOffsetHours))).padStart(2, '0');
const absMinutes = String(Math.round((Math.abs(tzOffsetHours) % 1) * 60)).padStart(2, '0');
const offsetStr = `${sign}${absHours}:${absMinutes}`;
const start = new Date(`${dateStr}T00:00:00.000${offsetStr}`);
const end = new Date(`${dateStr}T23:59:59.999${offsetStr}`);

// Line 52-53: use gcp.id
await monitoringApi.refetchLiveMetricsDay(
  gcp.id,
  companyId,
  start.toISOString(),
  end.toISOString()
);

// Line 138: update null check variable
{!gcp ? (
  <p className="text-gray-500 text-sm">{t('cache.noGcp')}</p>
```

- [ ] **Step 5: Update `monitoringCache.ts`**

The `monitoringCache.ts` uses `uevcbName` as its IndexedDB index and cache key parameter. This is a display name used for cache partitioning, not a type reference. Rename the parameter/field names:

```typescript
// Line 11: rename field
interface CachedDayRecord {
  cacheKey: string;
  gcpName: string;    // was uevcbName
  dateKey: string;
  data: LiveMonitoringData;
  cachedAt: number;
  pointCount: number;
}

// Line 32: update index name
store.createIndex('gcpName', 'gcpName', { unique: false });

// Line 41: rename parameter
function buildKey(gcpName: string, dateKey: string, groupId?: string | number): string {
  const prefix = groupId ? `${groupId}:` : '';
  return `${prefix}${gcpName}:${dateKey}`;
}

// Update all function signatures: uevcbName → gcpName
// getCachedDay, putCachedDay, listCachedDays, clearCachedDaysForUevcb → clearCachedDaysForGcp
```

**NOTE:** Changing the IndexedDB index name requires bumping `DB_VERSION` to 2 and handling the upgrade. Add upgrade logic:

```typescript
const DB_VERSION = 2;

request.onupgradeneeded = (event) => {
  const db = request.result;
  if (!db.objectStoreNames.contains(STORE_NAME)) {
    const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
    store.createIndex('gcpName', 'gcpName', { unique: false });
  } else {
    // Upgrade from v1: delete old store and recreate (cache is ephemeral)
    db.deleteObjectStore(STORE_NAME);
    const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
    store.createIndex('gcpName', 'gcpName', { unique: false });
  }
};
```

- [ ] **Step 6: Commit**

```bash
git add client/src/components/layout/Header.tsx client/src/hooks/useAlertEngine.ts client/src/context/ForecastContext.tsx client/src/components/settings/CacheManagement.tsx client/src/services/monitoringCache.ts
git commit -m "refactor: update client-side consumers for GCP rename"
```

Note: `useScheduleData.ts` needs no changes — its `plantId: number | null` parameter is already compatible with `gcp.id: number`.

---

### Task 6: Rewrite `AssetMappingForm.tsx`

This is the largest change. The form is rewritten from ~1019 lines to a cleaner version without TR-specific features.

**Files:**
- Modify: `client/src/components/settings/AssetMappingForm.tsx`

- [ ] **Step 1: Rewrite the form**

Key structural changes:
1. **Remove imports**: `kgupApi`, `monitoringApi` (for test), `KgupResponse`, `PlantSelector` (for UEVCB creation — keep for component portal plant selection)
2. **Remove state**: `tradeTestResults`, `kgupTestResults`
3. **Remove functions**: `handleTestTrade`, `handleTestKgup`
4. **Remove components**: `KgupTestResultPanel`
5. **Rename imports**: `UEVCB` → `GridConnectionPoint`, `UEVCBComponent` → `GcpComponent`, `UEVCBComponentType` → `ComponentType`
6. **Change GCP creation**: Replace `PlantSelector`-based flow with inline ID (number) + Name input
7. **Default `resolutionMinutes`**: `15` instead of `60`
8. **Schedule fields**: Show for all component types (not just BESS) — schedule is component-based
9. **All hardcoded TR strings**: Replace with `t('key')` calls
10. **Rename all internal variables**: `uevcb` → `gcp`, `uevcbId` → `gcpId`, `expandedUevcbs` → `expandedGcps`

The rewritten form should be approximately 600-700 lines (down from 1019) with this structure:

```
AssetMappingForm (main export)
├── State: companies, ftpDirection, ftpFilename, expandedCompanies/Gcps/Components, newGcpForm
├── Company operations: handleAddCompany, handleRemoveCompany, toggleCompany
├── GCP operations: handleAddGcp (from inline form), handleRemoveGcp, toggleGcp, updateGcp
├── Component operations: handleAddComponent, handleRemoveComponent, updateComponent
├── Save: handleSave
├── JSX: Company panels → GCP panels → ComponentEditor
└── FTP Settings + Save button

ComponentEditor (internal component, kept from TR with cleanup)
├── Props: comp, companyPlantIds, excludePlantIds, onChange, onRemove
├── Type selector, display name, portal plant (PlantSelector)
├── Forecast preference (source + beforeMinutes)
├── Schedule ID + file pattern (all types, not just BESS)
├── Monitoring (masternode + metrics editor)
└── NO test buttons (forecast test removed, metric test removed)
```

Write the complete file. Critical implementation details:

**New GCP creation flow** — inline form under each company:
```tsx
// State for the inline "add GCP" form
const [newGcpForm, setNewGcpForm] = useState<Record<number, { id: string; name: string }>>({});

const handleAddGcp = (companyIdx: number) => {
  const form = newGcpForm[companies[companyIdx].companyId];
  if (!form?.id || !form?.name) return;
  const gcpId = parseInt(form.id, 10);
  if (isNaN(gcpId)) return;

  const newGcp: GridConnectionPoint = {
    id: gcpId,
    name: form.name,
    timezone: companies[companyIdx].timezone,
    resolutionMinutes: 15,
    components: [],
  };
  // ... add to companies state, expand, clear form
};
```

**GCP panel header** — show ID (readonly) + component count:
```tsx
<span className="text-sm text-gray-200">{gcp.name}</span>
<span className="text-xs text-gray-500">ID: {gcp.id}</span>
<span className="text-xs text-gray-500">| {gcp.components.length} comp</span>
```

**GCP body** — editable timezone, resolution (default 15), name:
```tsx
<div className="grid grid-cols-3 gap-4">
  <div>
    <label>{t('assetMapping.timezone')}</label>
    <input value={gcp.timezone}
      onChange={(e) => updateGcp(cIdx, gIdx, { timezone: e.target.value })} />
  </div>
  <div>
    <label>{t('assetMapping.resolution')}</label>
    <select value={gcp.resolutionMinutes}
      onChange={(e) => updateGcp(cIdx, gIdx, { resolutionMinutes: parseInt(e.target.value) as MTUResolution })}>
      <option value={15}>{t('assetMapping.min15')}</option>
      <option value={30}>{t('assetMapping.min30')}</option>
      <option value={60}>{t('assetMapping.min60')}</option>
    </select>
  </div>
  <div>
    <label>{t('assetMapping.gcpName')}</label>
    <input value={gcp.name}
      onChange={(e) => updateGcp(cIdx, gIdx, { name: e.target.value })} />
  </div>
</div>
```

**ComponentEditor** — simplified, no test buttons:
- Remove `handleTestForecast`, `handleTestMetric`, `testResult`, `metricTestResult` state
- Remove forecast test popup and metric test popup modals
- Remove `monitoringApi` import
- Keep: type selector, display name, PlantSelector for portal plant, forecast source input, schedule ID + file pattern (all component types), monitoring section with metrics editor
- All placeholder text via `t()` calls

- [ ] **Step 2: Verify compilation**

Run: `cd client && npx tsc --noEmit`
Expected: No errors in AssetMappingForm.tsx

- [ ] **Step 3: Commit**

```bash
git add client/src/components/settings/AssetMappingForm.tsx
git commit -m "feat: rewrite AssetMappingForm for international GCP model"
```

---

### Task 7: Update Remaining Client Pages

These files reference UEVCB types but aren't part of the form. They need import and usage updates.

**Files:**
- Modify: `client/src/pages/BatteryProgramPage.tsx`
- Modify: `client/src/pages/BatteryParamsPage.tsx`
- Modify: `client/src/pages/ForecastPage.tsx`

- [ ] **Step 1: Update `BatteryProgramPage.tsx`**

This page uses `getBessUevcbs()` and `selectedBess.primaryPortalPlantId`. Read the full file first, then apply:

1. Import: `getBessUevcbs` → `getBessGcps`, `BessUevcbInfo` → `BessGcpInfo`
2. All calls: `getBessUevcbs(...)` → `getBessGcps(...)`
3. All `selectedBess.primaryPortalPlantId` → `selectedBess.gcpId`
4. All `selectedBess.uevcbId` → `selectedBess.gcpId`
5. Variable names: `bessUevcbs` → `bessGcps`, etc.
6. **Structural change**: The page iterates `company.uevcbs` arrays. These must change to `company.gridConnectionPoints`. Search for `.uevcbs` property access and replace with `.gridConnectionPoints`.
7. Schedule read/save calls use `plantId` parameter — keep as-is (gcp.id is number, matches the API).
8. `bessComponent.portalPlantId` access stays unchanged (component-level, not GCP-level).

Use find-and-replace within the file for bulk renames, then manually verify structural changes.

- [ ] **Step 2: Update `BatteryParamsPage.tsx`**

This page uses `primaryPortalPlantId` as `parentPlantId`. Change to `gcp.id`:

1. Import updates for renamed types
2. `uevcb.primaryPortalPlantId` → `gcp.id`
3. Variable renames as needed

Read the file first to identify exact locations.

- [ ] **Step 3: Update `ForecastPage.tsx`**

This page has `ForecastUevcbGroup` interface and uses `uevcb` variable names. Read the full file first, then apply:

1. Rename interface: `ForecastUevcbGroup` → `ForecastGcpGroup`
2. All `uevcb` variable names → `gcp`
3. All `uevcbId` field access → `gcp.id` (note: gcp.id is `number`, old uevcbId was `string` — ensure any string comparisons are updated to number comparisons)
4. All `primaryPortalPlantId` → `gcp.id` (for GCP identification) or `component.portalPlantId` (for forecast queries)
5. `company.uevcbs` → `company.gridConnectionPoints`
6. Import updates for renamed types
7. **Timezone**: If there's a hardcoded `TZ_OFFSET_MS = 3 * 3600_000` (UTC+3 Istanbul), replace with dynamic timezone from GCP: use `gcp.timezone` to compute offset.

- [ ] **Step 4: Verify full client compilation**

Run: `cd client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/BatteryProgramPage.tsx client/src/pages/BatteryParamsPage.tsx client/src/pages/ForecastPage.tsx
git commit -m "refactor: update remaining client pages for GCP rename"
```

---

### Task 8: Remove Backward-Compat Aliases & Final Verification

- [ ] **Step 1: Remove backward-compat type aliases from `assetMapping.types.ts`**

Remove the aliases added in Task 1 (the `// Backward-compat aliases` block at the end of the file):
- `export type UEVCB = GridConnectionPoint;`
- `export type UEVCBComponent = GcpComponent;`
- `export type UEVCBComponentType = ComponentType;`
- `export const getFirstUevcb = getFirstGcp;`
- `export const getAllUevcbs = getAllGcps;`
- `export const getBessUevcbs = getBessGcps;`
- `export type BessUevcbInfo = BessGcpInfo;`

- [ ] **Step 2: Full monorepo TypeScript check**

Run from project root:
```bash
cd shared && npx tsc --noEmit && cd ../server && npx tsc --noEmit && cd ../client && npx tsc --noEmit
```
Expected: All three packages compile without errors.

- [ ] **Step 3: Search for any remaining UEVCB references**

```bash
grep -ri "uevcb" --include="*.ts" --include="*.tsx" shared/ client/ server/ | grep -v node_modules | grep -v ".d.ts"
```
Expected: No results (or only in comments/migration code).

- [ ] **Step 4: Search for remaining primaryPortalPlantId references**

```bash
grep -ri "primaryPortalPlantId" --include="*.ts" --include="*.tsx" shared/ client/ server/ | grep -v node_modules
```
Expected: No results (or only in migration code within `migrateAssetMapping`).

- [ ] **Step 5: Commit any stragglers and create final commit**

```bash
git add -A
git status
# If clean, no commit needed. If files remain:
git commit -m "refactor: clean up remaining UEVCB references"
```
