# Asset Mapping International Adaptation — Design Spec

**Date:** 2026-04-06
**Status:** Approved

## Goal

Adapt the Settings Asset Mapping form and its underlying types for the international project. Rename UEVCB to GridConnectionPoint (GCP), remove `primaryPortalPlantId` from GCP level, clean out TR-specific features, and ensure all UI text uses `t('key')`.

## Key Design Decisions

1. **`gcp.id` is `number`** — reserved for future SmartPulse portal GCP integration. User enters it manually for now, but the type stays numeric so it can later bind to a portal GCP entity.
2. **Schedule is component-based** — in European markets, schedules are per-component (per battery unit), not per-GCP. The `scheduleFilePattern` and schedule read/write operate at component level.
3. **GCP forecast = sum of component forecasts** — GCP has no direct portal forecast. At runtime, each component's forecast is queried via `component.portalPlantId`, then aggregated (summed) to produce the GCP-level forecast. No portal API call at GCP level.

## Type Changes (`shared/src/types/assetMapping.types.ts`)

### Interface Renames

| Old | New |
|-----|-----|
| `UEVCB` | `GridConnectionPoint` |
| `uevcbId` | `id` (`number`, user-entered, for future portal GCP binding) |
| `UEVCBComponent` | `Component` |
| `UEVCBComponentType` | `ComponentType` |
| `BessUevcbInfo` | `BessGcpInfo` |

### Field Changes on GridConnectionPoint

- `uevcbId` → `id: number`
- `primaryPortalPlantId` → **removed** (no portal plant at GCP level)
- `timezone` — kept (defaults to company timezone, user can override)
- `resolutionMinutes` — kept, default changed to `15`
- `components` — kept, type renamed to `Component[]`
- `name` — kept

### CompanyMapping

- `uevcbs: UEVCB[]` → `gridConnectionPoints: GridConnectionPoint[]`

### BessGcpInfo

Old `BessUevcbInfo` had `primaryPortalPlantId` and singular `bessComponent`. New structure preserves the per-component pattern but drops the portal plant ID:

```typescript
interface BessGcpInfo {
  gcpId: number;
  gcpName: string;
  timezone: string;
  bessComponent: Component;  // singular, one entry per BESS component (same pattern as old code)
}
```

`getBessGcps()` returns one `BessGcpInfo` per BESS component (flattened), same as the old `getBessUevcbs()` pattern.

### Helper Function Renames

| Old | New |
|-----|-----|
| `getFirstUevcb(mapping)` | `getFirstGcp(mapping)` |
| `getAllUevcbs(mapping)` | `getAllGcps(mapping)` |
| `getBessUevcbs(mapping)` | `getBessGcps(mapping)` |
| `migrateAssetMapping(raw)` | Keep + extend to handle `uevcbs[]` → `gridConnectionPoints[]` migration |

## Schedule Types (`shared/src/types/schedule.types.ts`)

- `DEFAULT_SCHEDULE_FILE_PATTERN`: `'Battery_Schedule_{UEVCB_ID}.csv'` → `'Battery_Schedule_{GCP_ID}.csv'`
- Template variables: `{UEVCB_ID}` → `{GCP_ID}`, `{UEVCB_NAME}` → `{GCP_NAME}`
- `ScheduleFileContext.uevcbId` → `gcpId: number`
- `ScheduleRevisionStore.uevcbPlantId` → `gcpId: number`
- `resolveScheduleFilename`: update parameter names and template replacement
- `getScheduleFilenameFromMapping`: `plantId: number` → `gcpId: number`
- `getScheduleFilename(primaryPortalPlantId)` → `getScheduleFilename(gcpId)`

Note: Schedule is component-based in European markets. The schedule file pattern lives on the component (`component.scheduleFilePattern`), but the GCP ID is still used as the template variable `{GCP_ID}` and as the key for revision tracking in the schedule store.

## primaryPortalPlantId Removal Strategy

`primaryPortalPlantId` is removed from GCP. All consumers migrate to `gcp.id` (number). Forecast moves to component level.

| Usage Context | Old | New |
|---------------|-----|-----|
| Schedule read/save | `uevcb.primaryPortalPlantId` | `gcp.id` |
| Schedule store (revision tracking) | `uevcbPlantId` as key | `gcpId` as key |
| Alert engine (active schedule) | `uevcb.primaryPortalPlantId` | `gcp.id` |
| Battery params (parent ref) | `uevcb.primaryPortalPlantId` | `gcp.id` |
| Forecast query | `uevcb.primaryPortalPlantId` (UEVCB-level FinalForecast) | **Removed.** Each component queried via `component.portalPlantId`, results summed at runtime for GCP-level view |
| Header (active display) | `getFirstUevcb()` | `getFirstGcp()` — uses GCP name |
| Cache management | `uevcb.primaryPortalPlantId` | `gcp.id` |
| Monitoring cache | uevcb identifier | `gcp.id` |

### ForecastContext Change

The current `ForecastContext.tsx` makes a UEVCB-level `FinalForecast` call using `primaryPortalPlantId`. This call is **removed**. Instead:
- Each component's forecast is fetched individually via `component.portalPlantId`
- GCP-level forecast = sum of all component forecasts (computed at runtime)
- No portal API call at GCP level

## AssetMappingForm.tsx — Full Rewrite

### Removed (TR-specific)

- `handleTestTrade` / Trade Test button and result panel
- `handleTestKgup` / KGUP Test button and result panel
- `KgupTestResultPanel` component
- PlantSelector-based UEVCB creation flow
- All `primaryPortalPlantId` references

### New GCP Creation Flow

User clicks "+ Add GCP" under a company → inline form appears:
- **GCP ID** (number input, required, user enters manually)
- **GCP Name** (text input, required)
- Timezone defaults to parent company's timezone
- Resolution defaults to 15 minutes

### Form Hierarchy

```
Asset Mapping Section
├── [+ Add Company] dropdown (portal companies)
├── CompanyPanel (expandable)
│   ├── Company Name (readonly) + Timezone (readonly) + [Remove]
│   ├── [+ Add GCP] → inline ID (number) + Name input
│   └── GcpPanel (expandable)
│       ├── GCP ID (readonly after creation)
│       ├── GCP Name (editable)
│       ├── Timezone (editable, default: company timezone)
│       ├── Resolution: 15min (default) / 30min / 60min
│       ├── Components Section
│       │   ├── [+ Add Component]
│       │   └── ComponentEditor
│       │       ├── Type dropdown (BESS|SOLAR|WIND|HYDRO|THERMAL|LOAD|OTHER)
│       │       ├── Display Name (text)
│       │       ├── Portal Plant (dropdown from portal plants list)
│       │       ├── Forecast Source + beforeMinutes
│       │       ├── Schedule ID + File Pattern
│       │       │   Pattern help: {GCP_ID}, {ASSET_ID}, {SCHEDULE_ID}, {GCP_NAME}
│       │       └── Monitoring (masternode + metrics)
│       └── [Remove GCP]
├── FTP Settings (direction + filename)
└── [Save Mapping]
```

### ComponentEditor

Kept from TR version, cleaned up:
- Type selector, display name, portal plant dropdown
- Forecast preference (source name, beforeMinutes)
- Schedule ID + file pattern (shown for all component types — schedule is component-based)
- Monitoring section (masternode + metrics editor)
- No test buttons

## Translation Key Changes

### Removed
- `assetMapping.testKgup`
- `assetMapping.testKgupTrade`
- `assetMapping.testKgupLoading`
- `assetMapping.testKgupTradeData`
- `assetMapping.testKgupPlants`
- `assetMapping.testKgupNoPlants`
- `assetMapping.testKgupPrimaryMatch`
- `assetMapping.testKgupPrimaryMissing`
- `assetMapping.testKgupValues`

### Renamed
- `assetMapping.addUevcb` → `assetMapping.addGcp`
- `assetMapping.noUevcbs` → `assetMapping.noGcps`
- `assetMapping.uevcbName` → `assetMapping.gcpName`
- `assetMapping.description` text updated (UEVCB → GCP)
- `assetMapping.scheduleFilePatternHelp` updated ({UEVCB_ID} → {GCP_ID}, {UEVCB_NAME} → {GCP_NAME})
- `cache.noUevcb` → `cache.noGcp`

### Added
- `assetMapping.gcpId` — "GCP ID"
- `assetMapping.gcpIdPlaceholder` — placeholder text for ID input
- `assetMapping.gcpNamePlaceholder` — placeholder text for name input

## Files to Modify

| File | Change Type |
|------|-------------|
| `shared/src/types/assetMapping.types.ts` | Interface + helper rename, remove primaryPortalPlantId |
| `shared/src/types/schedule.types.ts` | Template vars, param names, ScheduleRevisionStore.uevcbPlantId → gcpId |
| `shared/src/types/dashboard.types.ts` | Import update |
| `shared/src/constants/translations.ts` | Key renames, additions, removals |
| `shared/src/index.ts` | Exports (automatic via re-export) |
| `client/src/components/settings/AssetMappingForm.tsx` | Full rewrite |
| `client/src/context/ForecastContext.tsx` | Remove UEVCB-level FinalForecast call, use component-level queries + sum |
| `client/src/pages/BatteryProgramPage.tsx` | getBessGcps, gcp.id |
| `client/src/pages/BatteryParamsPage.tsx` | gcp.id |
| `client/src/pages/ForecastPage.tsx` | UEVCB → GCP references, ForecastUevcbGroup → ForecastGcpGroup |
| `client/src/hooks/useAlertEngine.ts` | getFirstGcp, gcp.id |
| `client/src/hooks/useScheduleData.ts` | plantId type stays number (gcp.id is number) |
| `client/src/components/layout/Header.tsx` | getFirstGcp |
| `client/src/components/settings/CacheManagement.tsx` | getFirstGcp, gcp.id, fix hardcoded UTC+3 timezone |
| `client/src/services/monitoringCache.ts` | uevcb → gcp references |
| `server/src/services/scheduleStore.service.ts` | uevcb → gcp references, uevcbPlantId → gcpId |
| `server/src/services/metadata.service.ts` | uevcb → gcp references, UEVCB_ naming pattern → GCP_ |
| `server/src/services/configStore.service.ts` | Migration code for uevcbs → gridConnectionPoints |
| `server/src/routes/schedule.routes.ts` | primaryPortalPlantId → gcp.id |

## Migration

`migrateAssetMapping()` extended to handle:
1. Old single-UEVCB format → company-based format (existing)
2. `uevcbs[]` field → `gridConnectionPoints[]` field (new)
3. `uevcbId` → `id`, `primaryPortalPlantId` → dropped

`configStore.service.ts` migration code updated to recognize both old formats.

## Default Values

- `resolutionMinutes`: **15** (quarter-hourly)
- `timezone`: inherited from parent company
- `ftpDirection`: 'incoming' (matches existing code default)
- Component type on add: 'BESS'
