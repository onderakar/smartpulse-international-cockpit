# Auto Mapping: Direct vs Subcomponent Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distinguish between direct component-level mapping (single portal plant, no direction keyword) and subcomponent-level mapping (gen/con keywords → `generation`/`consumption` fields), and reflect this correctly in the service logic, domain types, and settings UI.

**Architecture:** `extractDirectionFromName` becomes a 4-value discriminant (`'gen' | 'con' | 'none' | 'ambiguous'`). `buildComponent` maps `'none'` to `portalPlantId` directly on the component and gen/con keywords to subcomponents. `portalPlantId` on `GcpComponent` is un-deprecated and becomes the canonical field for direct mapping. `runAutoMapping` stat counters and standalone detection are updated to handle direct-mapped components. The ComponentEditor UI shows all three plant selectors.

**Tech Stack:** TypeScript, Vitest (server tests). Test runner: `npm run test --workspace=server` — NOT `npx jest`. React 19 (client UI). No Jest.

---

## File Map

| File | Change |
|---|---|
| `server/src/utils/nameParser.ts` | Change `extractDirectionFromName` return type; update `PlantSubComponentEntry.direction` |
| `server/src/utils/nameParser.test.ts` | Update tests for new return values (`'none'`, `'ambiguous'`) |
| `shared/src/types/assetMapping.types.ts` | Un-deprecate `portalPlantId`; remove `no_gen_or_con_keyword` from warning union; remove auto-migration in `migrateComponent` |
| `server/src/services/autoMapping.service.ts` | Update `buildComponent`; update `runAutoMapping` stat counters and `isStandalone` check |
| `client/src/components/settings/PlantSelector.tsx` | Add `onClear?: () => void` prop |
| `client/src/components/settings/AssetMappingForm.tsx` | Update `ComponentEditor` to show direct + gen/con plant selectors |
| `shared/src/constants/translations.ts` | Add translation keys for gen/con plant selector labels |

---

## Background: What Each Direction Value Means

| Return value | Meaning | Action in `buildComponent` |
|---|---|---|
| `'gen'` | Plant name contains gen/generation keyword | Assign to `generation` subcomponent |
| `'con'` | Plant name contains con/consumption keyword | Assign to `consumption` subcomponent |
| `'none'` | No direction keyword found | Direct mapping → `portalPlantId` on component (no subcomponent) |
| `'ambiguous'` | BOTH gen+con keywords found in same name | Warn, assign to `generation` as fallback |

---

## Task 1: Update `nameParser` — fail first, then implement

**Files:**
- Modify: `server/src/utils/nameParser.test.ts`
- Modify: `server/src/utils/nameParser.ts`

The existing tests use `null` for both "no keyword" and "ambiguous" cases. We need to split these into distinct values.

- [ ] **Step 1: Update tests in `nameParser.test.ts`**

Replace the existing `extractDirectionFromName` `test.each` and the "ambiguous" test. The current test block starts at line 10 with `describe('extractDirectionFromName', () => {`. Replace the entire describe block with:

```typescript
describe('extractDirectionFromName', () => {
  test.each([
    ['Bagrentsi BESS Gen', 'gen'],
    ['Bagrentsi BESS Gen ', 'gen'],
    ['Bagrentsi BESS Generation', 'gen'],
    ['Bagrentsi BESS GEN', 'gen'],
    ['Bagrentsi BESS Con', 'con'],
    ['Bagrentsi BESS Consumption', 'con'],
    ['Bagrentsi BESS CON', 'con'],
    ['Bagrentsi BESS', 'none'],      // no direction keyword → direct mapping
    ['Bagrentsi Asset', 'none'],     // no direction keyword → direct mapping
  ])('"%s" → %s', (name, expected) => {
    expect(extractDirectionFromName(name)).toBe(expected)
  })

  test('returns "ambiguous" when both gen and con are present', () => {
    expect(extractDirectionFromName('BESS Gen Con')).toBe('ambiguous')
  })
})
```

Also **replace** (not add — replace) the existing standalone plant test in `describe('groupPlantsByGcp', ...)` (currently at line 107–115):

```typescript
// REPLACE the old test:
// test('standalone plant without direction keyword is assigned to gen slot', () => {
// with this:
test('standalone plant without direction keyword gets direction "none"', () => {
  const standalone: PortalPlantEntry[] = [
    { plantId: 200, plantName: 'Meridian BESS', installedPowerMw: 8, companyId: 1, companyName: 'C1' },
  ]
  const groups = groupPlantsByGcp(standalone)
  const gcpGroup = [...groups.values()][0]
  const compGroup = [...gcpGroup.components.values()][0]
  expect(compGroup.plants[0].direction).toBe('none')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test --workspace=server
```

Expected: failures for the `'none'` and `'ambiguous'` assertions.

- [ ] **Step 3: Add a failing test for `gcpDisplayName` with a direct-mapped (no direction keyword) plant**

In `nameParser.test.ts`, add inside `describe('groupPlantsByGcp', ...)`:

```typescript
test('gcpDisplayName is derived from plant name even when no direction keyword (direct mapping)', () => {
  const standalone: PortalPlantEntry[] = [
    { plantId: 200, plantName: 'Meridian BESS', installedPowerMw: 8, companyId: 1, companyName: 'C1' },
  ]
  const groups = groupPlantsByGcp(standalone)
  const gcpGroup = [...groups.values()][0]
  // Should contain the location name, not the bare lowercase root
  expect(gcpGroup.gcpDisplayName.toLowerCase()).toContain('meridian')
})
```

Run — this should PASS already (the root name logic strips "BESS" leaving "Meridian"). If it does, it still serves as a regression guard. Move on.

- [ ] **Step 4: Update `nameParser.ts`**

Change the return type and body of `extractDirectionFromName`:

```typescript
/** Returns the direction keyword found in the name.
 *  'gen'       → gen/generation keyword found
 *  'con'       → con/consumption keyword found
 *  'none'      → no direction keyword (direct component-level mapping)
 *  'ambiguous' → both gen and con found in same name (warning case)
 */
export function extractDirectionFromName(name: string): 'gen' | 'con' | 'none' | 'ambiguous' {
  resetRegex(DIR_GEN, DIR_CON)
  const hasGen = DIR_GEN.test(name)
  resetRegex(DIR_GEN, DIR_CON)
  const hasCon = DIR_CON.test(name)
  resetRegex(DIR_GEN, DIR_CON)
  if (hasGen && hasCon) return 'ambiguous'
  if (hasGen) return 'gen'
  if (hasCon) return 'con'
  return 'none'
}
```

Update `PlantSubComponentEntry` interface:

```typescript
export interface PlantSubComponentEntry {
  plant: PortalPlantEntry
  /** Direction inferred from plant name keywords */
  direction: 'gen' | 'con' | 'none' | 'ambiguous'
}
```

Also update the `gcpDisplayName` post-processing in `groupPlantsByGcp`. The existing loop only picks up `direction === 'gen'` entries. Add a fallback that uses `'none'`-direction entries when no gen-side plant exists. Find the post-processing block (after the main `for (const plant of plants)` loop) and replace it:

```typescript
// Post-process: set gcpDisplayName from gen-side plant name (preferred),
// falling back to 'none'-direction (direct-mapped) plants
for (const gcpGroup of gcpGroups.values()) {
  let found = false
  // Prefer gen-side
  outer: for (const compGroup of gcpGroup.components.values()) {
    for (const entry of compGroup.plants) {
      if (entry.direction === 'gen') {
        const locationName = stripTypeKeywords(stripDirectionKeywords(entry.plant.plantName)).trim()
        if (locationName) { gcpGroup.gcpDisplayName = locationName; found = true }
        break outer
      }
    }
  }
  // Fallback: use direct-mapped ('none') plant name
  if (!found) {
    outer2: for (const compGroup of gcpGroup.components.values()) {
      for (const entry of compGroup.plants) {
        if (entry.direction === 'none') {
          const locationName = stripTypeKeywords(entry.plant.plantName).trim()
          if (locationName) { gcpGroup.gcpDisplayName = locationName }
          break outer2
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test --workspace=server
```

Expected: all 43 tests pass (the two changed tests now pass with `'none'`/`'ambiguous'`).

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/nameParser.ts server/src/utils/nameParser.test.ts
git commit -m "refactor: extractDirectionFromName returns 'none'|'ambiguous' instead of null"
```

---

## Task 2: Update `assetMapping.types.ts` — domain model cleanup

**Files:**
- Modify: `shared/src/types/assetMapping.types.ts`

No new tests for this task (pure type and migration logic change).

- [ ] **Step 1: Un-deprecate `portalPlantId` on `GcpComponent` — add clarifying JSDoc**

Find the `@deprecated` comment block on `portalPlantId` in `GcpComponent`. Replace it with:

```typescript
/**
 * Direct component-level portal plant mapping.
 * Use this when the component maps to exactly one SmartPulse plant
 * and no gen/con direction split is needed.
 *
 * When a gen/con split is needed, use `generation` and/or `consumption` instead.
 * Both patterns are valid — choose based on how the portal plant data is structured.
 */
portalPlantId?: number;
```

- [ ] **Step 2: Remove `no_gen_or_con_keyword` from `AutoMappingWarning.type` union**

With the new model, a plant with no direction keyword is a **valid direct mapping** — not a warning condition. Remove `'no_gen_or_con_keyword'` from the union:

```typescript
export interface AutoMappingWarning {
  type:
    | 'duplicate_plant_id'
    | 'missing_asset_id'
    | 'name_conflict'
    | 'unknown_type'
    | 'parse_error'
    | 'ambiguous_direction'
    | 'missing_portal_plant'
    | 'duplicate_direction';
  message: string;
  column?: string;
  plantId?: number;
  plantName?: string;
}
```

- [ ] **Step 3: Remove the auto-migration in `migrateComponent`**

The current `migrateComponent` converts `portalPlantId → generation`. This is wrong for the new model: a component with `portalPlantId` and no gen/con subcomponents is a **valid direct mapping**, not a legacy artifact.

Replace the entire `migrateComponent` function with a pass-through:

```typescript
/**
 * Components are returned as-is.
 * portalPlantId is a valid direct-mapping field (not a legacy format).
 * generation/consumption are valid subcomponent mapping fields.
 * Both patterns coexist; no automatic conversion needed.
 */
function migrateComponent(comp: Record<string, unknown>): GcpComponent {
  return comp as unknown as GcpComponent;
}
```

- [ ] **Step 4: Verify TypeScript compiles for shared workspace**

```bash
npx tsc --noEmit -p shared/tsconfig.json 2>&1 | head -20
```

Expected: no errors from `assetMapping.types.ts`.

- [ ] **Step 5: Commit**

```bash
git add shared/src/types/assetMapping.types.ts
git commit -m "refactor: portalPlantId is first-class direct-mapping field; remove auto-migration"
```

---

## Task 3: Update `autoMapping.service.ts` — `buildComponent` + stat counters

**Files:**
- Modify: `server/src/services/autoMapping.service.ts`

Two changes: (1) `buildComponent` maps `'none'` to direct `portalPlantId`, (2) `runAutoMapping` stat counters and `isStandalone` are updated to handle direct-mapped components.

Note: `directInstalledPowerMw` is intentionally used as a fallback for `installedCapacityMw` on BESS components — when the CSV has no `max_battery_discharge_power_mw`, the portal's `InstalledPowerMW` is the best available capacity estimate.

- [ ] **Step 1: Replace `buildComponent` in `autoMapping.service.ts`**

The existing function starts at `function buildComponent(` and ends at the closing `}` before `export async function runAutoMapping`. Replace the entire function:

```typescript
function buildComponent(
  compGroup: ComponentGroup,
  csvBattery: BatteryColumn | null,
  masternode: string | null,
  emitWarn: (type: AutoMappingWarning['type'], i18nKey: string, params?: Record<string, string | number>) => void,
): GcpComponent {
  let generation: GcpSubComponent | undefined
  let consumption: GcpSubComponent | undefined
  let directPortalPlantId: number | undefined
  let directInstalledPowerMw: number | undefined

  for (const { plant, direction } of compGroup.plants) {
    const sub: GcpSubComponent = {
      portalPlantId: plant.plantId,
      installedPowerMw: plant.installedPowerMw > 0 ? plant.installedPowerMw : undefined,
      portalPlantName: plant.plantName,
    }

    if (direction === 'none') {
      // Direct component-level mapping — no gen/con subcomponent wrapping
      if (directPortalPlantId !== undefined) {
        // Multiple direction-less plants in same component group → ambiguous
        emitWarn('ambiguous_direction', 'autoMapping.warn.ambiguous_direction', { plantName: plant.plantName })
      } else {
        directPortalPlantId = plant.plantId
        directInstalledPowerMw = plant.installedPowerMw > 0 ? plant.installedPowerMw : undefined
      }
    } else if (direction === 'gen') {
      if (generation) {
        emitWarn('duplicate_direction', 'autoMapping.warn.duplicate_direction', { plantName: plant.plantName, direction: 'gen' })
      } else {
        generation = sub
      }
    } else if (direction === 'con') {
      if (consumption) {
        emitWarn('duplicate_direction', 'autoMapping.warn.duplicate_direction', { plantName: plant.plantName, direction: 'con' })
      } else {
        consumption = sub
      }
    } else {
      // 'ambiguous': both gen+con keywords in the same plant name
      emitWarn('ambiguous_direction', 'autoMapping.warn.ambiguous_direction', { plantName: plant.plantName })
      if (!generation) generation = sub
    }
  }

  const type = compGroup.componentType ?? 'SOLAR'

  const comp: GcpComponent = {
    componentId: generateId(),
    type,
    displayName: compGroup.componentKey,
    // Direct mapping if no gen/con keywords; subcomponent mapping otherwise
    ...(directPortalPlantId !== undefined
      ? { portalPlantId: directPortalPlantId }
      : { generation, consumption }
    ),
    forecastPreference: { ...DEFAULT_FORECAST_PREFERENCE },
    monitoring: masternode ? { masternode, metrics: [] } : undefined,
  }

  if (csvBattery && type === 'BESS') {
    const bp = csvBattery.bessParams
    if (Object.values(bp).some(v => v !== undefined)) {
      comp.bessParams = bp as BessParams
    }
    // Prefer CSV max discharge power; fall back to portal InstalledPowerMW for direct-mapped components
    comp.installedCapacityMw = bp.maxDischargePowerMw ?? directInstalledPowerMw ?? undefined
  }

  return comp
}
```

- [ ] **Step 2: Update Phase 1 gen/con stat counters in `runAutoMapping`**

Find the stat accumulation block inside the `for (const compGroup of gcpGroup.components.values())` loop (around lines 300–311 in the original). It currently checks `comp.generation` and `comp.consumption`. Update it to also handle direct-mapped components (which have `comp.portalPlantId` instead):

```typescript
if (isBess) {
  phase1BessComponents++
  if (comp.generation) { phase1GenSubComponents++; gcpGenPlantId = comp.generation.portalPlantId }
  if (comp.consumption) { phase1ConSubComponents++; gcpConPlantId = comp.consumption.portalPlantId }
  // Direct mapping: counts as one gen equivalent for tracking
  if (comp.portalPlantId && !comp.generation && !comp.consumption) {
    phase1GenSubComponents++
    gcpGenPlantId = comp.portalPlantId
  }
} else {
  if (comp.generation) { phase1GenSubComponents++; if (!gcpGenPlantId) gcpGenPlantId = comp.generation.portalPlantId }
  if (comp.consumption) { phase1ConSubComponents++; if (!gcpConPlantId) gcpConPlantId = comp.consumption.portalPlantId }
  if (comp.portalPlantId && !comp.generation && !comp.consumption) {
    phase1GenSubComponents++
    if (!gcpGenPlantId) gcpGenPlantId = comp.portalPlantId
  }
}

if (comp.generation) phase1UsedPlantIds.add(comp.generation.portalPlantId)
if (comp.consumption) phase1UsedPlantIds.add(comp.consumption.portalPlantId)
if (comp.portalPlantId) phase1UsedPlantIds.add(comp.portalPlantId)
```

- [ ] **Step 3: Update Phase 2 `isStandalone` check**

Find the `isStandalone` line in the Phase 2 block (inside `if (runPhase2)`):

```typescript
// Old — only checks generation subcomponent:
const isStandalone = components.length === 1 && components[0].generation && !components[0].consumption
```

Replace with:

```typescript
// Updated — handles both direct (portalPlantId) and subcomponent (generation only) cases
const isStandalone = components.length === 1 && (
  (components[0].portalPlantId && !components[0].generation && !components[0].consumption) ||
  (components[0].generation && !components[0].consumption && !components[0].portalPlantId)
)
```

- [ ] **Step 4: Also update Phase 2 `genCount`/`conCount` cosmetic counters**

In the Phase 2 loop (inside `if (runPhase2)`), find the `genCount`/`conCount` accumulation after each `buildComponent` call. These are reported in the `gcp_phase2` event for display only. Update to also count direct-mapped components:

```typescript
if (comp.generation) genCount++
if (comp.consumption) conCount++
if (comp.portalPlantId && !comp.generation && !comp.consumption) genCount++ // direct = counts as gen
```

- [ ] **Step 5: Run tests**

```bash
npm run test --workspace=server
```

Expected: 43+ tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/autoMapping.service.ts
git commit -m "feat: buildComponent uses portalPlantId for direct mapping; update stat counters"
```

---

## Task 4: Update `PlantSelector` and `ComponentEditor` UI

**Files:**
- Modify: `client/src/components/settings/PlantSelector.tsx`
- Modify: `client/src/components/settings/AssetMappingForm.tsx`
- Modify: `shared/src/constants/translations.ts`

**Important:** Update `PlantSelector` FIRST (Step 1–2), then write `ComponentEditor` JSX (Step 3+). The JSX uses `onClear` which must exist in `PlantSelector` before the editor is updated.

- [ ] **Step 1: Add `onClear` prop to `PlantSelector.tsx`**

The current `PlantSelector` has no way to deselect a plant. Add `onClear?: () => void`:

```typescript
interface PlantSelectorProps {
  selectedPlantId: number | null;
  onSelect: (plant: PortalPlant) => void;
  filterPlantIds?: number[];
  excludePlantIds?: number[];
  label?: string;
  onClear?: () => void;   // ← new: deselect/clear the current plant
}
```

Update the component to accept and use this prop. The select should gain a "— None —" option at the top (when `onClear` is provided) that calls `onClear` when chosen:

```typescript
export function PlantSelector({
  selectedPlantId, onSelect, filterPlantIds, excludePlantIds, label, onClear,
}: PlantSelectorProps) {
  const { plants } = useAuth();
  const { t } = useLocale();

  const resolvedLabel = label ?? t('assetMapping.portalPlant');

  let filtered = filterPlantIds
    ? plants.filter(p => filterPlantIds.includes(p.id))
    : plants;

  if (excludePlantIds?.length) {
    filtered = filtered.filter(p => !excludePlantIds.includes(p.id));
  }

  return (
    <div>
      {resolvedLabel && <label className="block text-sm text-gray-400 mb-1">{resolvedLabel}</label>}
      <select
        value={selectedPlantId ?? ''}
        onChange={(e) => {
          if (e.target.value === '') {
            onClear?.();
            return;
          }
          const id = parseInt(e.target.value, 10);
          const plant = filtered.find(p => p.id === id);
          if (plant) onSelect(plant);
        }}
        className="w-full bg-dark-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        <option value="">{onClear ? '— None —' : t('assetMapping.selectPlant')}</option>
        {filtered.map(p => (
          <option key={p.id} value={p.id}>
            {p.name} (ID: {p.id})
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Add translation keys in `translations.ts`**

Find the `'assetMapping.clearAll'` line (recently added) and add below the existing `assetMapping.*` keys:

```typescript
'assetMapping.directPlant':      { tr: 'Doğrudan Portal Santrali', en: 'Direct Portal Plant' },
'assetMapping.generationPlant':  { tr: 'Üretim (Gen) Santrali', en: 'Generation Plant' },
'assetMapping.consumptionPlant': { tr: 'Tüketim (Con) Santrali', en: 'Consumption Plant' },
'assetMapping.plantMappingNote': { tr: 'Doğrudan VEYA Gen/Con kullanın — ikisini birden değil', en: 'Use Direct OR Gen/Con — not both at once' },
```

- [ ] **Step 3: Update `ComponentEditor` — replace plant selector section**

In `ComponentEditor` (bottom half of `AssetMappingForm.tsx`), find the existing 2-column grid that has `PlantSelector` and the forecast source input (around lines 554–571 in current file):

```tsx
<div className="grid grid-cols-2 gap-4 mb-3">
  <div>
    <PlantSelector
      selectedPlantId={comp.portalPlantId || null}
      ...
    />
  </div>
  <div>
    <label ...>{t('assetMapping.forecastSource')}</label>
    <input ... />
  </div>
</div>
```

Replace with a bordered mapping section followed by the forecast input:

```tsx
{/* Portal Plant Mapping */}
<div className="border border-gray-700 rounded-lg p-3 mb-3 space-y-2">
  <p className="text-[10px] text-gray-500 italic">{t('assetMapping.plantMappingNote')}</p>

  <PlantSelector
    label={t('assetMapping.directPlant')}
    selectedPlantId={comp.portalPlantId ?? null}
    filterPlantIds={companyPlantIds.length > 0 ? companyPlantIds : undefined}
    excludePlantIds={excludePlantIds}
    onSelect={(p) => onChange({ portalPlantId: p.id })}
    onClear={() => onChange({ portalPlantId: undefined })}
  />

  <PlantSelector
    label={t('assetMapping.generationPlant')}
    selectedPlantId={comp.generation?.portalPlantId ?? null}
    filterPlantIds={companyPlantIds.length > 0 ? companyPlantIds : undefined}
    excludePlantIds={excludePlantIds}
    onSelect={(p) => onChange({
      generation: { ...(comp.generation ?? {}), portalPlantId: p.id },
    })}
    onClear={() => onChange({ generation: undefined })}
  />

  <PlantSelector
    label={t('assetMapping.consumptionPlant')}
    selectedPlantId={comp.consumption?.portalPlantId ?? null}
    filterPlantIds={companyPlantIds.length > 0 ? companyPlantIds : undefined}
    excludePlantIds={excludePlantIds}
    onSelect={(p) => onChange({
      consumption: { ...(comp.consumption ?? {}), portalPlantId: p.id },
    })}
    onClear={() => onChange({ consumption: undefined })}
  />
</div>

{/* Forecast Source */}
<div className="mb-3">
  <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.forecastSource')}</label>
  <input
    value={comp.forecastPreference.sourceName}
    onChange={(e) => handleForecastChange('sourceName', e.target.value)}
    placeholder="e.g. OptBESS, EpiasForecast"
    className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
  />
</div>
```

- [ ] **Step 4: Update component header badge to show whichever mapping is set**

In the component header (inside `ComponentEditor`), find the `{comp.portalPlantId ? ... }` badge and replace:

```tsx
{(comp.portalPlantId || comp.generation?.portalPlantId || comp.consumption?.portalPlantId) ? (
  <span className="text-xs text-gray-500">
    {comp.portalPlantId
      ? `Plant: ${comp.portalPlantId}`
      : [
          comp.generation  && `Gen: ${comp.generation.portalPlantId}`,
          comp.consumption && `Con: ${comp.consumption.portalPlantId}`,
        ].filter(Boolean).join(' / ')
    }
  </span>
) : null}
```

- [ ] **Step 5: Verify client compiles without new errors**

```bash
npx tsc --noEmit -p client/tsconfig.json 2>&1 | grep "AssetMappingForm\|PlantSelector" | head -20
```

Expected: no new errors in `AssetMappingForm.tsx` or `PlantSelector.tsx`.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/settings/PlantSelector.tsx \
        client/src/components/settings/AssetMappingForm.tsx \
        shared/src/constants/translations.ts
git commit -m "feat: ComponentEditor shows direct and gen/con plant selectors"
```

---

## Verification Checklist

After all tasks:

- [ ] `npm run test --workspace=server` — 43+ tests pass
- [ ] Auto Mapping with a BESS that has Gen/Con plants → `generation`/`consumption` set, `portalPlantId` NOT set
- [ ] Auto Mapping with a plant that has NO direction keyword → `portalPlantId` set, `generation`/`consumption` NOT set
- [ ] Settings > ComponentEditor shows all three selectors; existing data loads without losing plant assignments
- [ ] `isStandalone` in Phase 2 correctly identifies single direct-mapped components
