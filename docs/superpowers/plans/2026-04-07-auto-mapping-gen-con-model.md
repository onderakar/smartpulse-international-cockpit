# Auto Mapping — Gen/Con Sub-Component Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revise Auto Mapping so each physical component can have separate Generation and Consumption portal plants, discovered through portal plant name analysis instead of direct CSV field lookups.

**Architecture:** New `nameParser.ts` utility extracts direction/type from plant names and groups plants by GCP root name. Service is refactored to fetch portal plants first (required for name resolution), then use the grouping algorithm for Phase 1. Phase 2 is now user-gated via a two-step confirmation modal. The shared `GcpComponent` type gains optional `generation` and `consumption` sub-components replacing the single `portalPlantId`.

**Tech Stack:** TypeScript, React 19, Express, shared monorepo workspace (`@smartpulse-intl/shared`)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `shared/src/types/assetMapping.types.ts` | Modify | Add `GcpSubComponent`, update `GcpComponent`, `AutoMappingReport`, `AutoMappingWarning`, `AutoMappingEvent`, `getBessGcps`, `migrateAssetMapping` |
| `shared/src/constants/translations.ts` | Modify | Add new confirm modal + warning translation keys |
| `server/src/utils/nameParser.ts` | **Create** | All name parsing & plant grouping logic |
| `server/src/utils/nameParser.test.ts` | **Create** | Unit tests for nameParser |
| `server/src/utils/autoMappingParser.ts` | Minimal | `pvAssetId` kept but marked deprecated; no logic change |
| `server/src/services/autoMapping.service.ts` | Rewrite | Portal fetch first, name-based grouping, `runPhase2` param |
| `server/src/routes/autoMapping.routes.ts` | Modify | Read `runPhase2` from request body |
| `client/src/hooks/useAutoMapping.ts` | Modify | Add `modalStage` state, confirm flow methods, updated event dispatch |
| `client/src/components/settings/AutoMappingModal.tsx` | Modify | Confirm stage modals, updated summary cards, new event log lines |

---

## Task 1: Shared Types — Add GcpSubComponent and update GcpComponent

**Files:**
- Modify: `shared/src/types/assetMapping.types.ts`

- [ ] **Step 1: Add `GcpSubComponent` interface and update `GcpComponent`**

In `assetMapping.types.ts`, after the `BessParams` interface, add:

```typescript
export interface GcpSubComponent {
  /** Portal plant ID for this directional side */
  portalPlantId: number;
  /** MW capacity from portal InstalledPowerMW */
  installedPowerMw?: number;
  /** Canonical portal plant name (for display/audit) */
  portalPlantName?: string;
}
```

Then update `GcpComponent` — replace the current `portalPlantId: number` with:

```typescript
export interface GcpComponent {
  componentId: string;
  type: ComponentType;
  displayName: string;

  /** Generation-side portal plant (preferred for forecast/schedule) */
  generation?: GcpSubComponent;
  /** Consumption-side portal plant */
  consumption?: GcpSubComponent;
  /**
   * @deprecated Use generation.portalPlantId. Kept for migration compatibility.
   * Old format components that only have portalPlantId are migrated on load.
   */
  portalPlantId?: number;

  forecastPreference: {
    sourceName: string;
    beforeMinutes: number;
  };
  scheduleId?: string;
  scheduleFilePattern?: string;
  monitoring?: {
    masternode: string;
    metrics: Array<LabeledMetricMapping | BapSource>;
  };
  bessParams?: BessParams;
  /** BESS: maxDischargePowerMw. Phase 2 standalone: InstalledPowerMW. */
  installedCapacityMw?: number;
  installedCapacityAcMw?: number;
  installedCapacityDcMwp?: number;
}
```

- [ ] **Step 2: Update `getBessGcps` to use `generation.portalPlantId`**

Replace the filter condition from `comp.portalPlantId > 0` to:

```typescript
if (comp.type === 'BESS' && ((comp.generation?.portalPlantId ?? 0) > 0 || (comp.portalPlantId ?? 0) > 0)) {
```

- [ ] **Step 3: Update `migrateAssetMapping` to migrate old components**

Inside the `migrateAssetMapping` function, after the existing GCP migration block, add a component-level migration when a component has `portalPlantId` but no `generation`:

Find the line `components: u.components || [],` inside the uevcb migration and replace with:
```typescript
components: (u.components || []).map(migrateComponent),
```

And in the section where `raw.companies` are processed, also apply `migrateComponent` to components. Add `migrateComponent` as a helper before `migrateAssetMapping`:

```typescript
function migrateComponent(comp: any): GcpComponent {
  // If component has old single portalPlantId but no generation sub-component, migrate it
  if (comp.portalPlantId && !comp.generation) {
    return {
      ...comp,
      generation: {
        portalPlantId: comp.portalPlantId,
        installedPowerMw: comp.installedCapacityMw,
      },
    } as GcpComponent;
  }
  return comp as GcpComponent;
}
```

Also apply `migrateComponent` in the companies array map for `raw.companies`:
```typescript
gridConnectionPoints: (c.gridConnectionPoints || []).map((gcp: any) => ({
  ...gcp,
  components: (gcp.components || []).map(migrateComponent),
})),
```

- [ ] **Step 4: Update `AutoMappingReport`, `AutoMappingWarning`, `AutoMappingEvent`**

Replace the existing `AutoMappingReport` interface:

```typescript
export interface AutoMappingReport {
  // Phase 1 stats
  csvBatteriesFound: number;
  phase1GcpsCreated: number;
  phase1BessComponents: number;
  phase1GenSubComponents: number;
  phase1ConSubComponents: number;
  phase1NameGroupsFound: number;
  phase1AmbiguousNames: number;
  // Phase 2 stats
  phase2Ran: boolean;
  phase2PlantsScanned: number;
  phase2GcpsCreated: number;
  phase2StandaloneFound: number;
  phase2GroupedFound: number;
  // Totals (backward-compatible)
  gcpsCreated: number;
  warnings: AutoMappingWarning[];
  skipped: AutoMappingSkipped[];
  overallStatus: 'success' | 'partial' | 'failed';
}
```

Replace `AutoMappingWarning`:

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
    | 'no_gen_or_con_keyword'
    | 'duplicate_direction';
  message: string;
  column?: string;
  plantId?: number;
  plantName?: string;
}
```

Replace `AutoMappingEvent`:

```typescript
export type AutoMappingEvent =
  | { step: 'portal_fetch'; status: 'ok'; plantsFound: number }
  | { step: 'csv_read'; status: 'ok'; batteriesFound: number }
  | { step: 'gcp_phase1'; status: 'ok';
      gcpName: string; gcpRoot: string;
      genPlantId?: number; conPlantId?: number;
      companionComponents: number }
  | { step: 'phase1_done'; status: 'ok';
      gcps: number; bessComponents: number;
      genSubComponents: number; conSubComponents: number;
      nameGroupsFound: number; ambiguousNames: number }
  | { step: 'phase2_scan'; status: 'ok'; plantsScanned: number }
  | { step: 'gcp_phase2'; status: 'ok';
      name: string; plantCount: number; genCount: number; conCount: number }
  | { step: 'phase2_done'; status: 'ok';
      gcpsCreated: number; standalone: number; grouped: number }
  | { step: 'saved'; status: 'ok' }
  | { step: 'done'; status: 'ok'; report: AutoMappingReport }
  | { step: 'warning';
      warnType: AutoMappingWarning['type'];
      i18nKey: string;
      params?: Record<string, string | number> }
  | { step: 'error'; status: 'failed'; i18nKey: string }
```

- [ ] **Step 5: Build shared package and verify no type errors**

```bash
cd C:\Projects\smartpulse-international-cockpit
npx tsc -p shared/tsconfig.json --noEmit
```

Expected: no errors. If there are errors in other files that reference `portalPlantId` directly, note them — they will be fixed in later tasks.

- [ ] **Step 6: Commit**

```bash
git add shared/src/types/assetMapping.types.ts
git commit -m "feat(types): add GcpSubComponent, Gen/Con model, new AutoMappingReport/Warning/Event types"
```

---

## Task 2: Translation Keys

**Files:**
- Modify: `shared/src/constants/translations.ts`

- [ ] **Step 1: Add new translation keys**

Open `shared/src/constants/translations.ts` and add the following keys into the existing translations object (find a logical grouping near other `autoMapping.*` keys):

```typescript
// Confirmation modal — Phase 2
'autoMapping.confirmPhase2Title': {
  tr: 'BESS Dışı Tesisler de Eşleştirilsin mi?',
  en: 'Also Map Non-Battery Plants?',
},
'autoMapping.confirmPhase2Body': {
  tr: 'Opsiyonel: Kalan portal tesisleri taranır ve BESS dışı varlıklar için de GCP oluşturulur. Bu işlem daha uzun sürebilir.',
  en: 'Optional: scan all remaining portal plants and create GCPs for non-battery assets. This may take longer.',
},
'autoMapping.confirmPhase2Yes': {
  tr: 'Evet, Tümünü Dahil Et',
  en: 'Yes, include all plants',
},
'autoMapping.confirmPhase2No': {
  tr: 'Hayır, Sadece BESS',
  en: 'No, BESS only',
},
// Report cards
'autoMapping.report.genSubComponents': {
  tr: 'Üretim Alt-Bileş.',
  en: 'Gen Sub-comps',
},
'autoMapping.report.conSubComponents': {
  tr: 'Tüketim Alt-Bileş.',
  en: 'Con Sub-comps',
},
'autoMapping.report.phase2Gcps': {
  tr: 'Phase 2 GCP',
  en: 'Phase 2 GCPs',
},
'autoMapping.report.ambiguousNames': {
  tr: 'Belirsiz İsimler',
  en: 'Ambiguous Names',
},
// New warning types (snake_case to match server i18nKey pattern)
'autoMapping.warn.ambiguous_direction': {
  tr: '{plantName}: hem Gen hem Con içeriyor, Gen olarak atandı',
  en: '{plantName}: contains both Gen and Con keywords, defaulted to Gen',
},
'autoMapping.warn.missing_portal_plant': {
  tr: '{column}: Asset_ID {plantId} portalde bulunamadı, CSV adı kullanıldı',
  en: '{column}: Asset_ID {plantId} not found in portal, using CSV column name as fallback',
},
'autoMapping.warn.no_gen_or_con_keyword': {
  tr: '{plantName}: yön ifadesi bulunamadı, Üretim olarak atandı',
  en: '{plantName}: no direction keyword found, assigned as Generation by default',
},
'autoMapping.warn.duplicate_direction': {
  tr: '{plantName}: {direction} yönünde yinelenen tesis, atlandı',
  en: '{plantName}: duplicate {direction} plant in component group, skipped',
},
// Steps
'autoMapping.step.portalFetch': {
  tr: 'Portal tesisleri getiriliyor',
  en: 'Fetching portal plants',
},
```

- [ ] **Step 2: Verify TypeScript build**

```bash
npx tsc -p shared/tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add shared/src/constants/translations.ts
git commit -m "feat(i18n): add Auto Mapping Gen/Con confirm and warning translation keys"
```

---

## Task 3: Name Parser Utility (New File)

**Files:**
- Create: `server/src/utils/nameParser.ts`
- Create: `server/src/utils/nameParser.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `server/src/utils/nameParser.test.ts`:

```typescript
import {
  extractDirectionFromName,
  extractComponentType,
  extractRootName,
  extractComponentGroupKey,
  groupPlantsByGcp,
  type PortalPlantEntry,
} from './nameParser'

describe('extractDirectionFromName', () => {
  test.each([
    ['Bagrentsi BESS Gen', 'gen'],
    ['Bagrentsi BESS Gen ', 'gen'],
    ['Bagrentsi BESS Generation', 'gen'],
    ['Bagrentsi BESS GEN', 'gen'],
    ['Bagrentsi BESS Con', 'con'],
    ['Bagrentsi BESS Consumption', 'con'],
    ['Bagrentsi BESS CON', 'con'],
    ['Bagrentsi BESS', null],
    ['Bagrentsi Asset', null],
  ])('"%s" → %s', (name, expected) => {
    expect(extractDirectionFromName(name)).toBe(expected)
  })

  test('returns null and is ambiguous when both gen and con present', () => {
    expect(extractDirectionFromName('BESS Gen Con')).toBeNull()
  })
})

describe('extractComponentType', () => {
  test.each([
    ['Bagrentsi BESS Gen', 'BESS'],
    ['Bagrentsi PV Gen', 'SOLAR'],
    ['Bagrentsi Solar', 'SOLAR'],
    ['Bagrentsi Wind Farm', 'WIND'],
    ['Bagrentsi Hydro', 'HYDRO'],
    ['Bagrentsi Thermal', 'THERMAL'],
    ['Bagrentsi Asset', null],
  ])('"%s" → %s', (name, expected) => {
    expect(extractComponentType(name)).toBe(expected)
  })
})

describe('extractRootName', () => {
  test.each([
    ['Bagrentsi BESS Gen', 'bagrentsi'],
    ['Bagrentsi PV Generation', 'bagrentsi'],
    ['Bagrentsi BESS Con', 'bagrentsi'],
    ['Site-A BESS Gen', 'site a'],   // hyphen normalised to space
    ['Site A BESS Gen', 'site a'],
  ])('"%s" → "%s"', (name, expected) => {
    expect(extractRootName(name)).toBe(expected)
  })
})

describe('extractComponentGroupKey', () => {
  test('same key for gen and con of same component', () => {
    expect(extractComponentGroupKey('Bagrentsi BESS Gen')).toBe(extractComponentGroupKey('Bagrentsi BESS Con'))
  })
  test('different key for different type', () => {
    expect(extractComponentGroupKey('Bagrentsi BESS Gen')).not.toBe(extractComponentGroupKey('Bagrentsi PV Gen'))
  })
})

describe('groupPlantsByGcp', () => {
  const plants: PortalPlantEntry[] = [
    { plantId: 101, plantName: 'Bagrentsi BESS Gen', installedPowerMw: 10, companyId: 1, companyName: 'C1' },
    { plantId: 102, plantName: 'Bagrentsi BESS Con', installedPowerMw: 10, companyId: 1, companyName: 'C1' },
    { plantId: 103, plantName: 'Bagrentsi PV Gen',   installedPowerMw: 5,  companyId: 1, companyName: 'C1' },
  ]

  test('groups all three plants under one GCP root', () => {
    const groups = groupPlantsByGcp(plants)
    expect(groups.size).toBe(1)
  })

  test('creates two component groups: BESS and SOLAR/PV', () => {
    const groups = groupPlantsByGcp(plants)
    const gcpGroup = groups.values().next().value!
    expect(gcpGroup.components.size).toBe(2)
  })

  test('BESS component has gen=101 and con=102', () => {
    const groups = groupPlantsByGcp(plants)
    const gcpGroup = groups.values().next().value!
    const components = [...gcpGroup.components.values()]
    const bess = components.find(c => c.componentType === 'BESS')!
    expect(bess.plants.find(p => p.direction === 'gen')?.plant.plantId).toBe(101)
    expect(bess.plants.find(p => p.direction === 'con')?.plant.plantId).toBe(102)
  })

  test('PV component has gen=103 and no con', () => {
    const groups = groupPlantsByGcp(plants)
    const gcpGroup = groups.values().next().value!
    const components = [...gcpGroup.components.values()]
    const pv = components.find(c => c.componentType === 'SOLAR')!
    expect(pv.plants.find(p => p.direction === 'gen')?.plant.plantId).toBe(103)
    expect(pv.plants.find(p => p.direction === 'con')).toBeUndefined()
  })

  test('gcpDisplayName is derived from gen-side plant name (stripped)', () => {
    const groups = groupPlantsByGcp(plants)
    const gcpGroup = groups.values().next().value!
    // "Bagrentsi BESS Gen" → strip type "BESS" → strip dir "Gen" → "Bagrentsi"
    expect(gcpGroup.gcpDisplayName.toLowerCase()).toContain('bagrentsi')
  })

  test('standalone plant without direction keyword is assigned to gen slot', () => {
    const standalone: PortalPlantEntry[] = [
      { plantId: 200, plantName: 'Meridian BESS', installedPowerMw: 8, companyId: 1, companyName: 'C1' },
    ]
    const groups = groupPlantsByGcp(standalone)
    const gcpGroup = groups.values().next().value!
    const compGroup = gcpGroup.components.values().next().value!
    expect(compGroup.plants[0].direction).toBeNull()
  })

  test('two BESS units at same site create two component groups', () => {
    const multiUnit: PortalPlantEntry[] = [
      { plantId: 501, plantName: 'Konya BESS1 Gen', installedPowerMw: 5, companyId: 1, companyName: 'C1' },
      { plantId: 502, plantName: 'Konya BESS1 Con', installedPowerMw: 5, companyId: 1, companyName: 'C1' },
      { plantId: 503, plantName: 'Konya BESS2 Gen', installedPowerMw: 5, companyId: 1, companyName: 'C1' },
      { plantId: 504, plantName: 'Konya BESS2 Con', installedPowerMw: 5, companyId: 1, companyName: 'C1' },
    ]
    const groups = groupPlantsByGcp(multiUnit)
    expect(groups.size).toBe(1)
    const gcpGroup = groups.values().next().value!
    expect(gcpGroup.components.size).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests — verify they FAIL (file doesn't exist yet)**

```bash
cd C:\Projects\smartpulse-international-cockpit
npx jest server/src/utils/nameParser.test.ts --no-coverage 2>&1 | head -30
```

Expected: `Cannot find module './nameParser'`

- [ ] **Step 3: Create `server/src/utils/nameParser.ts`**

```typescript
import { ComponentType } from '@smartpulse-intl/shared'

// ── Direction patterns ──────────────────────────────────────────────────────
// Word-boundary + case-insensitive. Stateful /g flag requires lastIndex reset.
const DIR_GEN = /\b(gen|generation)\b/gi
const DIR_CON = /\b(con|consumption)\b/gi

// ── Component type patterns (priority order — BESS before PV/SOLAR) ─────────
const TYPE_PATTERNS: Array<{ pattern: RegExp; type: ComponentType }> = [
  { pattern: /\bBESS\b/gi,    type: 'BESS'    },
  { pattern: /\bPV\b/gi,      type: 'SOLAR'   },
  { pattern: /\bsolar\b/gi,   type: 'SOLAR'   },
  { pattern: /\bwind\b/gi,    type: 'WIND'    },
  { pattern: /\bhydro\b/gi,   type: 'HYDRO'   },
  { pattern: /\bthermal\b/gi, type: 'THERMAL' },
]

function resetRegex(...regexes: RegExp[]) {
  regexes.forEach(r => { r.lastIndex = 0 })
}

/** Returns 'gen', 'con', or null (null means no keyword OR ambiguous — both present). */
export function extractDirectionFromName(name: string): 'gen' | 'con' | null {
  resetRegex(DIR_GEN, DIR_CON)
  const hasGen = DIR_GEN.test(name)
  resetRegex(DIR_GEN, DIR_CON)
  const hasCon = DIR_CON.test(name)
  resetRegex(DIR_GEN, DIR_CON)
  if (hasGen && hasCon) return null
  if (hasGen) return 'gen'
  if (hasCon) return 'con'
  return null
}

/** Returns the dominant component type keyword found in the name, or null. */
export function extractComponentType(name: string): ComponentType | null {
  for (const { pattern, type } of TYPE_PATTERNS) {
    pattern.lastIndex = 0
    const found = pattern.test(name)
    pattern.lastIndex = 0
    if (found) return type
  }
  return null
}

function stripDirectionKeywords(name: string): string {
  resetRegex(DIR_GEN, DIR_CON)
  const result = name.replace(DIR_GEN, '').replace(DIR_CON, '')
  resetRegex(DIR_GEN, DIR_CON)
  return result.replace(/\s+/g, ' ').trim()
}

function stripTypeKeywords(name: string): string {
  let s = name
  for (const { pattern } of TYPE_PATTERNS) {
    pattern.lastIndex = 0
    s = s.replace(pattern, '')
    pattern.lastIndex = 0
  }
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * GCP root key — strips BOTH direction AND type keywords, lowercases,
 * normalises hyphens to spaces.
 * Example: "Bagrentsi BESS Gen" → "bagrentsi"
 */
export function extractRootName(name: string): string {
  return stripTypeKeywords(stripDirectionKeywords(name))
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Component group key — strips direction only (keeps type keyword), lowercases.
 * Example: "Bagrentsi BESS Gen" → "bagrentsi bess"
 *          "Bagrentsi BESS Con" → "bagrentsi bess"  ← same key = same component
 */
export function extractComponentGroupKey(name: string): string {
  return stripDirectionKeywords(name)
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Grouping structures ──────────────────────────────────────────────────────

export interface PortalPlantEntry {
  plantId: number
  plantName: string
  installedPowerMw: number
  companyId: number
  companyName: string
}

export interface PlantSubComponentEntry {
  plant: PortalPlantEntry
  /** null means no direction keyword found OR ambiguous (both gen+con) */
  direction: 'gen' | 'con' | null
}

export interface ComponentGroup {
  componentKey: string
  componentType: ComponentType | null
  plants: PlantSubComponentEntry[]
}

export interface PlantGroup {
  gcpRootName: string
  /** Display name derived from the Generation-side plant name (preferred) */
  gcpDisplayName: string
  components: Map<string, ComponentGroup>
}

/**
 * Groups portal plants into a Map keyed by GCP root name.
 * Within each GCP group, plants are further grouped into ComponentGroups
 * by their component group key (type keyword retained, direction stripped).
 */
export function groupPlantsByGcp(plants: PortalPlantEntry[]): Map<string, PlantGroup> {
  const gcpGroups = new Map<string, PlantGroup>()

  for (const plant of plants) {
    const gcpRoot   = extractRootName(plant.plantName)
    const compKey   = extractComponentGroupKey(plant.plantName)
    const direction = extractDirectionFromName(plant.plantName)
    const compType  = extractComponentType(plant.plantName)

    if (!gcpGroups.has(gcpRoot)) {
      gcpGroups.set(gcpRoot, {
        gcpRootName: gcpRoot,
        gcpDisplayName: gcpRoot,   // updated in post-processing below
        components: new Map(),
      })
    }
    const gcpGroup = gcpGroups.get(gcpRoot)!

    if (!gcpGroup.components.has(compKey)) {
      gcpGroup.components.set(compKey, { componentKey: compKey, componentType: compType, plants: [] })
    }
    gcpGroup.components.get(compKey)!.plants.push({ plant, direction })
  }

  // Post-process: set gcpDisplayName from gen-side plant name (preferred)
  for (const gcpGroup of gcpGroups.values()) {
    outer: for (const compGroup of gcpGroup.components.values()) {
      for (const entry of compGroup.plants) {
        if (entry.direction === 'gen') {
          // Strip direction and type keywords to get the location name
          const locationName = stripTypeKeywords(stripDirectionKeywords(entry.plant.plantName)).trim()
          if (locationName) {
            gcpGroup.gcpDisplayName = locationName
          }
          break outer
        }
      }
    }
  }

  return gcpGroups
}
```

- [ ] **Step 4: Run tests — verify they PASS**

```bash
npx jest server/src/utils/nameParser.test.ts --no-coverage
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/nameParser.ts server/src/utils/nameParser.test.ts
git commit -m "feat(server): add nameParser utility for plant name grouping"
```

---

## Task 4: Refactor `autoMapping.service.ts`

**Files:**
- Modify: `server/src/services/autoMapping.service.ts`

This is the largest change. The service is rewritten to:
1. Accept `runPhase2: boolean` parameter
2. Fetch portal plants **before** Phase 1 (required for canonical name lookup)
3. Use `groupPlantsByGcp` for Phase 1 BESS name-based discovery
4. Skip `pvAssetId`-based SOLAR creation
5. Phase 2 only runs when `runPhase2 === true`
6. Use new `AutoMappingReport` shape

- [ ] **Step 1: Replace the service file content**

Replace the entire file `server/src/services/autoMapping.service.ts` with:

```typescript
import crypto from 'node:crypto'
import axios from 'axios'
import {
  GridConnectionPoint,
  GcpComponent,
  GcpSubComponent,
  CompanyMapping,
  AssetMapping,
  BessParams,
  AutoMappingEvent,
  AutoMappingReport,
  AutoMappingWarning,
  GroupProfile,
  DashboardProfile,
} from '@smartpulse-intl/shared'
import { UserSession } from '../store/sessions'
import { FtpService } from './ftp.service'
import { ConfigStoreService } from './configStore.service'
import { parseAutoMappingCsv, BatteryColumn } from '../utils/autoMappingParser'
import { PORTAL_BASE_URLS } from '../config/env'
import {
  groupPlantsByGcp,
  extractRootName,
  PortalPlantEntry,
  ComponentGroup,
} from '../utils/nameParser'

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
  const baseUrl = PORTAL_BASE_URLS[env] ?? PORTAL_BASE_URLS['prod']
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

/**
 * Build a GcpComponent from a ComponentGroup (one physical component's plant entries).
 * Assigns gen/con sub-components based on direction keywords in plant names.
 * @param csvBattery  BatteryColumn from CSV — only provided for BESS components in Phase 1
 * @param masternode  Masternode string from CSV, or null
 * @param emitWarn    Callback to emit a warning event
 */
function buildComponent(
  compGroup: ComponentGroup,
  csvBattery: BatteryColumn | null,
  masternode: string | null,
  emitWarn: (type: AutoMappingWarning['type'], i18nKey: string, params?: Record<string, string | number>) => void,
): GcpComponent {
  let generation: GcpSubComponent | undefined
  let consumption: GcpSubComponent | undefined
  let ambiguousCount = 0

  for (const { plant, direction } of compGroup.plants) {
    const sub: GcpSubComponent = {
      portalPlantId: plant.plantId,
      installedPowerMw: plant.installedPowerMw > 0 ? plant.installedPowerMw : undefined,
      portalPlantName: plant.plantName,
    }

    if (direction === 'gen') {
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
      // direction === null: either no keyword or ambiguous (both gen+con)
      // Check if ambiguous by re-testing
      const nameL = plant.plantName.toLowerCase()
      const hasGen = /\b(gen|generation)\b/.test(nameL)
      const hasCon = /\b(con|consumption)\b/.test(nameL)
      if (hasGen && hasCon) {
        ambiguousCount++
        emitWarn('ambiguous_direction', 'autoMapping.warn.ambiguous_direction', { plantName: plant.plantName })
        // Still try to assign as gen if generation slot is free
        if (!generation) generation = sub
      } else {
        // No direction keyword — assign to gen slot as default
        emitWarn('no_gen_or_con_keyword', 'autoMapping.warn.no_gen_or_con_keyword', { plantName: plant.plantName })
        if (!generation) generation = sub
        else if (!consumption) consumption = sub
      }
    }
  }

  const type = compGroup.componentType ?? 'SOLAR'

  const comp: GcpComponent = {
    componentId: generateId(),
    type,
    displayName: compGroup.componentKey,
    generation,
    consumption,
    forecastPreference: { ...DEFAULT_FORECAST_PREFERENCE },
    monitoring: masternode ? { masternode, metrics: [] } : undefined,
  }

  if (csvBattery && type === 'BESS') {
    const bp = csvBattery.bessParams
    if (Object.values(bp).some(v => v !== undefined)) {
      comp.bessParams = bp as BessParams
    }
    comp.installedCapacityMw = bp.maxDischargePowerMw ?? undefined
  }

  return comp
}

export async function runAutoMapping(
  session: UserSession,
  profile: GroupProfile,
  ftpService: FtpService,
  configStore: ConfigStoreService,
  runPhase2: boolean,
  emit: (event: AutoMappingEvent) => void,
): Promise<void> {
  const timezone = resolveGroupTimezone(session)
  const assetMapping = profile.assetMapping as AssetMapping | undefined
  const ftpDirection = assetMapping?.ftpDirection ?? 'incoming'
  const ftpFilename = assetMapping?.ftpFilename ?? 'Technical_Parameters.csv'
  const allWarnings: AutoMappingWarning[] = []

  const emitWarn = (
    type: AutoMappingWarning['type'],
    i18nKey: string,
    params?: Record<string, string | number>,
  ) => {
    const warn: AutoMappingWarning = {
      type,
      message: i18nKey,
      ...(params?.column    && { column:    String(params.column)    }),
      ...(params?.plantId   && { plantId:   Number(params.plantId)   }),
      ...(params?.plantName && { plantName: String(params.plantName) }),
    }
    allWarnings.push(warn)
    emit({ step: 'warning', warnType: type, i18nKey, params })
  }

  // === STEP 0: Fetch portal plants (required before Phase 1) ===
  let portalConfigs: PortalCompanyConfig[] = []
  const portalPlantMap = new Map<number, PortalPlantEntry>()  // plantId → entry
  const plantIdToCompany = new Map<number, { CompanyId: number; CompanyName: string }>()
  const allPortalPlants: PortalPlantEntry[] = []

  try {
    portalConfigs = await fetchCompanyPowerPlants(session.portalCookies, session.env, session.portalAccessToken)
    for (const config of portalConfigs) {
      for (const plant of config.PowerPlantLimits) {
        const entry: PortalPlantEntry = {
          plantId: plant.PowerPlantId,
          plantName: plant.PowerPlantName,
          installedPowerMw: plant.InstalledPowerMW,
          companyId: config.CompanyId,
          companyName: config.CompanyName,
        }
        portalPlantMap.set(plant.PowerPlantId, entry)
        plantIdToCompany.set(plant.PowerPlantId, { CompanyId: config.CompanyId, CompanyName: config.CompanyName })
        allPortalPlants.push(entry)
      }
    }
    emit({ step: 'portal_fetch', status: 'ok', plantsFound: allPortalPlants.length })
  } catch {
    emit({ step: 'error', status: 'failed', i18nKey: 'autoMapping.error.portalFailed' })
    return
  }

  // === PHASE 1: CSV ===
  let csvContent: string
  try {
    csvContent = await ftpService.readFile(session.portalCookies, session.env, ftpDirection, ftpFilename)
  } catch {
    emit({ step: 'error', status: 'failed', i18nKey: 'autoMapping.error.csvFailed' })
    return
  }

  const parsed = parseAutoMappingCsv(csvContent)
  for (const w of parsed.warnings) {
    allWarnings.push(w)
    emit({ step: 'warning', warnType: w.type, i18nKey: `autoMapping.warn.${w.type}`, params: { column: w.column ?? '' } })
  }
  emit({ step: 'csv_read', status: 'ok', batteriesFound: parsed.batteries.length })

  const seenAssetIds = new Set<number>()
  const usedNames = new Set<string>()
  const phase1UsedPlantIds = new Set<number>()
  const phase1GcpRoots = new Set<string>()
  const phase1Gcps: GridConnectionPoint[] = []
  const idBase = Date.now()
  let phase1BessComponents = 0
  let phase1GenSubComponents = 0
  let phase1ConSubComponents = 0
  let phase1AmbiguousNames = 0
  let phase1NameGroupsFound = 0

  for (let index = 0; index < parsed.batteries.length; index++) {
    const battery = parsed.batteries[index]
    if (battery.assetId === null) continue

    if (seenAssetIds.has(battery.assetId)) {
      emitWarn('duplicate_plant_id', 'autoMapping.warn.duplicate_plant_id', { column: battery.name, plantId: battery.assetId })
      continue
    }
    seenAssetIds.add(battery.assetId)

    // Resolve canonical name from portal
    const refPlant = portalPlantMap.get(battery.assetId)
    if (!refPlant) {
      emitWarn('missing_portal_plant', 'autoMapping.warn.missing_portal_plant', { column: battery.name, plantId: battery.assetId })
      // Fallback: use CSV column name as a synthetic plant entry
    }

    const canonicalName = refPlant?.plantName ?? battery.name
    const gcpRoot = extractRootName(canonicalName)

    // Skip if this GCP root was already processed by a previous battery column
    if (phase1GcpRoots.has(gcpRoot)) continue
    phase1GcpRoots.add(gcpRoot)
    phase1NameGroupsFound++

    // Find all portal plants sharing this GCP root name
    const companionPlants = allPortalPlants.filter(p => extractRootName(p.plantName) === gcpRoot)

    const gcpGroups = groupPlantsByGcp(companionPlants)
    const gcpGroup = gcpGroups.get(gcpRoot)

    if (!gcpGroup) continue  // should not happen

    const components: GcpComponent[] = []
    let gcpGenPlantId: number | undefined
    let gcpConPlantId: number | undefined

    for (const compGroup of gcpGroup.components.values()) {
      // Pass CSV battery data only for BESS components
      const isBess = compGroup.componentType === 'BESS'
      const prevWarnCount = allWarnings.length

      const comp = buildComponent(
        compGroup,
        isBess ? battery : null,
        battery.masternode,
        emitWarn,
      )
      components.push(comp)

      // Track ambiguous names from this component
      const newWarns = allWarnings.slice(prevWarnCount)
      if (newWarns.some(w => w.type === 'ambiguous_direction')) phase1AmbiguousNames++

      if (isBess) {
        phase1BessComponents++
        if (comp.generation) { phase1GenSubComponents++; gcpGenPlantId = comp.generation.portalPlantId }
        if (comp.consumption) { phase1ConSubComponents++; gcpConPlantId = comp.consumption.portalPlantId }
      } else {
        if (comp.generation) { phase1GenSubComponents++; if (!gcpGenPlantId) gcpGenPlantId = comp.generation.portalPlantId }
        if (comp.consumption) { phase1ConSubComponents++; if (!gcpConPlantId) gcpConPlantId = comp.consumption.portalPlantId }
      }

      // Mark all plant IDs in this component as used
      if (comp.generation) phase1UsedPlantIds.add(comp.generation.portalPlantId)
      if (comp.consumption) phase1UsedPlantIds.add(comp.consumption.portalPlantId)
    }

    let gcpName = sanitizeName(gcpGroup.gcpDisplayName)
    gcpName = resolveNameConflict(gcpName, usedNames)

    const gcp: GridConnectionPoint = {
      id: idBase + index,
      name: gcpName,
      timezone,
      resolutionMinutes: 15,
      components,
      maxInjectionMw: battery.maxInjectionMw ?? undefined,
      maxConsumptionMw: battery.maxConsumptionMw ?? undefined,
      damPortfolioId: battery.damPortfolioId ?? undefined,
    }

    phase1Gcps.push(gcp)
    emit({
      step: 'gcp_phase1',
      status: 'ok',
      gcpName,
      gcpRoot,
      genPlantId: gcpGenPlantId,
      conPlantId: gcpConPlantId,
      companionComponents: components.length,
    })
  }

  emit({
    step: 'phase1_done',
    status: 'ok',
    gcps: phase1Gcps.length,
    bessComponents: phase1BessComponents,
    genSubComponents: phase1GenSubComponents,
    conSubComponents: phase1ConSubComponents,
    nameGroupsFound: phase1NameGroupsFound,
    ambiguousNames: phase1AmbiguousNames,
  })

  // === PHASE 2: Portal (optional) ===
  const phase2Gcps: GridConnectionPoint[] = []
  let phase2Standalone = 0
  let phase2Grouped = 0

  if (runPhase2) {
    // Filter: exclude plants used in Phase 1 AND plants belonging to Phase 1 GCP roots
    const remainingPlants = allPortalPlants.filter(p =>
      p.plantId > 0 &&
      !phase1UsedPlantIds.has(p.plantId) &&
      !phase1GcpRoots.has(extractRootName(p.plantName))
    )

    emit({ step: 'phase2_scan', status: 'ok', plantsScanned: remainingPlants.length })

    const phase2Groups = groupPlantsByGcp(remainingPlants)

    for (const [gcpRoot, plantGroup] of phase2Groups) {
      const components: GcpComponent[] = []
      let genCount = 0
      let conCount = 0

      for (const compGroup of plantGroup.components.values()) {
        const comp = buildComponent(compGroup, null, null, emitWarn)
        components.push(comp)
        if (comp.generation) genCount++
        if (comp.consumption) conCount++
      }

      const isStandalone = components.length === 1 && components[0].generation && !components[0].consumption
      if (isStandalone) phase2Standalone++
      else phase2Grouped++

      let gcpName = sanitizeName(plantGroup.gcpDisplayName)
      gcpName = resolveNameConflict(gcpName, usedNames)

      const gcp: GridConnectionPoint = {
        id: idBase + phase1Gcps.length + phase2Gcps.length,
        name: gcpName,
        timezone,
        resolutionMinutes: 15,
        components,
      }

      phase2Gcps.push(gcp)
      emit({ step: 'gcp_phase2', status: 'ok', name: gcpName, plantCount: components.length, genCount, conCount })
    }

    emit({ step: 'phase2_done', status: 'ok', gcpsCreated: phase2Gcps.length, standalone: phase2Standalone, grouped: phase2Grouped })
  }

  // === COMPANY ASSIGNMENT ===
  const companyMap = new Map<number, CompanyMapping>()

  const getOrCreateCompany = (info: { CompanyId: number; CompanyName: string }): CompanyMapping => {
    if (!companyMap.has(info.CompanyId)) {
      companyMap.set(info.CompanyId, {
        companyId: info.CompanyId,
        companyName: info.CompanyName,
        timezone,
        gridConnectionPoints: [],
      })
    }
    return companyMap.get(info.CompanyId)!
  }

  const resolveCompanyForGcp = (gcp: GridConnectionPoint): { CompanyId: number; CompanyName: string } => {
    // Use the generation portalPlantId of the first BESS component, then any component
    for (const comp of gcp.components) {
      const pid = comp.generation?.portalPlantId ?? comp.consumption?.portalPlantId ?? comp.portalPlantId
      if (pid != null && plantIdToCompany.has(pid)) {
        return plantIdToCompany.get(pid)!
      }
    }
    return fallbackCompany(session)
  }

  for (const gcp of phase1Gcps) {
    getOrCreateCompany(resolveCompanyForGcp(gcp)).gridConnectionPoints.push(gcp)
  }
  for (const gcp of phase2Gcps) {
    getOrCreateCompany(resolveCompanyForGcp(gcp)).gridConnectionPoints.push(gcp)
  }

  const newMapping: AssetMapping = {
    companies: [...companyMap.values()],
    ftpDirection: assetMapping?.ftpDirection ?? 'incoming',
    ftpFilename: assetMapping?.ftpFilename ?? 'Technical_Parameters.csv',
  }

  await configStore.saveProfile(
    session.username,
    { ...profile, assetMapping: newMapping } as unknown as DashboardProfile,
    String(session.groupId),
  )
  emit({ step: 'saved', status: 'ok' })

  const gcpsCreated = phase1Gcps.length + phase2Gcps.length
  emit({
    step: 'done',
    status: 'ok',
    report: {
      csvBatteriesFound: parsed.batteries.length,
      phase1GcpsCreated: phase1Gcps.length,
      phase1BessComponents,
      phase1GenSubComponents,
      phase1ConSubComponents,
      phase1NameGroupsFound,
      phase1AmbiguousNames,
      phase2Ran: runPhase2,
      phase2PlantsScanned: runPhase2 ? allPortalPlants.length - phase1UsedPlantIds.size : 0,
      phase2GcpsCreated: phase2Gcps.length,
      phase2StandaloneFound: phase2Standalone,
      phase2GroupedFound: phase2Grouped,
      gcpsCreated,
      warnings: allWarnings,
      skipped: [],
      overallStatus: 'success',
    } satisfies AutoMappingReport,
  })
}
```

- [ ] **Step 2: Compile server to check types**

```bash
npx tsc -p server/tsconfig.json --noEmit
```

Expected: no errors. Fix any type errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/autoMapping.service.ts
git commit -m "feat(server): refactor autoMapping service — name-based grouping, Gen/Con sub-components, optional Phase 2"
```

---

## Task 5: Update Route — Accept `runPhase2` from Request Body

**Files:**
- Modify: `server/src/routes/autoMapping.routes.ts`

- [ ] **Step 1: Read `runPhase2` from body and pass to service**

In `autoMapping.routes.ts`, change the `runAutoMapping` call:

```typescript
// After the session line:
const { runPhase2 = false } = req.body as { runPhase2?: boolean }

// Then change the runAutoMapping call from:
await runAutoMapping(session, profile, ftpService, configStore, emit)
// To:
await runAutoMapping(session, profile, ftpService, configStore, runPhase2, emit)
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc -p server/tsconfig.json --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/autoMapping.routes.ts
git commit -m "feat(server): pass runPhase2 from request body to autoMapping service"
```

---

## Task 6: Update `useAutoMapping` Hook

**Files:**
- Modify: `client/src/hooks/useAutoMapping.ts`

The hook gains a `modalStage` state machine and new confirm-flow methods. The `run()` function is renamed to an internal method; the public API exposes `startConfirmFlow`, `confirmPhase1`, `confirmPhase2`.

- [ ] **Step 1: Rewrite the hook**

Replace the entire file with:

```typescript
import { useState, useRef, useCallback } from 'react'
import { AutoMappingEvent, AutoMappingReport, AutoMappingWarning } from '@shared/types/assetMapping.types'

export type StepStatus = 'pending' | 'active' | 'done' | 'error'
export type ModalStage = 'idle' | 'confirm1' | 'confirm2' | 'running' | 'complete'

export interface AutoMappingStep {
  key: string
  i18nKey: string
  status: StepStatus
  badge?: string
}

export interface AutoMappingState {
  modalStage: ModalStage
  isRunning: boolean
  isComplete: boolean
  steps: AutoMappingStep[]
  logLines: string[]
  report: AutoMappingReport | null
  warnings: AutoMappingWarning[]
  startConfirmFlow: () => void
  confirmPhase1: () => void
  confirmPhase2: (runPhase2: boolean) => void
  reset: () => void
  cancel: () => void
}

const BASE_STEP_KEYS = [
  { key: 'portal_fetch', i18nKey: 'autoMapping.step.portalFetch' },
  { key: 'csv_read',     i18nKey: 'autoMapping.step.csvRead'     },
  { key: 'phase1_done',  i18nKey: 'autoMapping.step.phase1Done'  },
  { key: 'saved',        i18nKey: 'autoMapping.step.saved'       },
]

const PHASE2_STEP_KEY = { key: 'phase2_done', i18nKey: 'autoMapping.step.phase2Done' }

function makeInitialSteps(includePhase2: boolean): AutoMappingStep[] {
  const keys = includePhase2
    ? [...BASE_STEP_KEYS.slice(0, 3), PHASE2_STEP_KEY, BASE_STEP_KEYS[3]]
    : BASE_STEP_KEYS
  return keys.map(s => ({ ...s, status: 'pending' as StepStatus }))
}

export function useAutoMapping(onComplete: () => void): AutoMappingState {
  const [modalStage, setModalStage] = useState<ModalStage>('idle')
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [steps, setSteps] = useState<AutoMappingStep[]>(makeInitialSteps(false))
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
      case 'portal_fetch':
        setStepStatus('portal_fetch', 'done', `${event.plantsFound} plants`)
        addLog(`[OK] Portal fetch — ${event.plantsFound} plants`)
        setStepStatus('csv_read', 'active')
        break
      case 'csv_read':
        setStepStatus('csv_read', 'done', `${event.batteriesFound} batteries`)
        addLog(`[OK] CSV read — ${event.batteriesFound} batteries`)
        setStepStatus('phase1_done', 'active')
        break
      case 'gcp_phase1':
        addLog(`[OK] ${event.gcpName} (root: ${event.gcpRoot}) → Gen(${event.genPlantId ?? '-'}) Con(${event.conPlantId ?? '-'}) | ${event.companionComponents} component(s)`)
        break
      case 'phase1_done':
        setStepStatus('phase1_done', 'done', `${event.gcps} GCP`)
        addLog(`[OK] Phase 1 done — ${event.gcps} GCPs, ${event.bessComponents} BESS, gen=${event.genSubComponents} con=${event.conSubComponents}`)
        setStepStatus('phase2_done', 'active')  // no-op if step not in list
        setStepStatus('saved', 'active')         // fallback if no phase2
        break
      case 'phase2_scan':
        addLog(`[OK] Phase 2 scan — ${event.plantsScanned} remaining plants`)
        break
      case 'gcp_phase2':
        addLog(`[OK] Phase2: ${event.name} — ${event.plantCount} component(s) gen=${event.genCount} con=${event.conCount}`)
        break
      case 'phase2_done':
        setStepStatus('phase2_done', 'done', `${event.gcpsCreated} GCP`)
        addLog(`[OK] Phase 2 done — ${event.gcpsCreated} GCPs (${event.standalone} standalone, ${event.grouped} grouped)`)
        setStepStatus('saved', 'active')
        break
      case 'saved':
        setStepStatus('saved', 'done')
        break
      case 'done':
        setReport(event.report)
        setIsRunning(false)
        setIsComplete(true)
        setModalStage('complete')
        onComplete()
        break
      case 'warning':
        setWarnings(prev => [...prev, {
          type: event.warnType,
          message: event.i18nKey,
          column: event.params?.column as string | undefined,
          plantId: event.params?.plantId as number | undefined,
          plantName: event.params?.plantName as string | undefined,
        }])
        addLog(`[WARN] ${event.i18nKey} ${JSON.stringify(event.params ?? {})}`)
        break
      case 'error':
        addLog(`[ERROR] ${event.i18nKey}`)
        setSteps(prev => prev.map(s => s.status === 'active' ? { ...s, status: 'error' as StepStatus } : s))
        setIsRunning(false)
        setIsComplete(true)
        setModalStage('complete')
        break
    }
  }, [onComplete])

  const runMapped = useCallback(async (runPhase2: boolean) => {
    setIsRunning(true)
    setIsComplete(false)
    setSteps(makeInitialSteps(runPhase2))
    setLogLines([])
    setReport(null)
    setWarnings([])

    // Activate first step
    setSteps(prev => prev.map(s => s.key === 'portal_fetch' ? { ...s, status: 'active' as StepStatus } : s))

    abortRef.current = new AbortController()

    try {
      const response = await fetch('/api/auto-mapping/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runPhase2 }),
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
    } catch (err: unknown) {
      const error = err as Error
      if (error.name !== 'AbortError') {
        addLog(`[ERROR] Network error: ${error.message}`)
        setIsRunning(false)
        setIsComplete(true)
        setModalStage('complete')
      }
    }
  }, [dispatch])

  const startConfirmFlow = useCallback(() => {
    setModalStage('confirm1')
  }, [])

  const confirmPhase1 = useCallback(() => {
    setModalStage('confirm2')
  }, [])

  const confirmPhase2 = useCallback((runPhase2: boolean) => {
    setModalStage('running')
    runMapped(runPhase2)
  }, [runMapped])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setIsRunning(false)
    setIsComplete(false)
    setSteps(makeInitialSteps(false))
    setLogLines([])
    setReport(null)
    setWarnings([])
    setModalStage('idle')
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setIsRunning(false)
    setIsComplete(true)
    setModalStage('complete')
  }, [])

  return { modalStage, isRunning, isComplete, steps, logLines, report, warnings, startConfirmFlow, confirmPhase1, confirmPhase2, reset, cancel }
}
```

- [ ] **Step 2: Check for TypeScript errors in client**

```bash
npx tsc -p client/tsconfig.json --noEmit 2>&1 | head -40
```

Fix any errors, particularly around the updated `AutoMappingEvent` shape.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useAutoMapping.ts
git commit -m "feat(client): add modal stage machine and confirm flow to useAutoMapping hook"
```

---

## Task 7: Update AutoMappingModal and Caller

**Files:**
- Modify: `client/src/components/settings/AutoMappingModal.tsx`
- Identify caller: grep for `AutoMappingModal` to find the settings page that uses it

- [ ] **Step 1: Find the caller(s) of the modal**

```bash
grep -r "AutoMappingModal\|useAutoMapping\|startConfirmFlow\|state\.run" \
  C:\Projects\smartpulse-international-cockpit\client\src --include="*.tsx" -l
```

Note the file paths. The caller likely uses `state.run()` — this must be changed to `state.startConfirmFlow()`.

- [ ] **Step 2: Update `AutoMappingModal.tsx`**

Replace the entire file with:

```tsx
import { useEffect, useRef } from 'react'
import { useLocale } from '../../context/LocaleContext'
import { TranslationKey } from '@shared/constants/translations'
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

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [state.logLines])

  // ── Confirm Stage 1 ───────────────────────────────────────────────────────
  if (state.modalStage === 'confirm1') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="w-[420px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
          <div className="bg-slate-800 px-4 py-3">
            <span className="font-semibold text-sm text-slate-100">{t('autoMapping.modalTitle')}</span>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-sm text-slate-300">{t('autoMapping.confirmBody')}</p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold"
              >
                {t('autoMapping.cancel')}
              </button>
              <button
                onClick={state.confirmPhase1}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
              >
                {t('autoMapping.confirm')}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Confirm Stage 2 ───────────────────────────────────────────────────────
  if (state.modalStage === 'confirm2') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="w-[440px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
          <div className="bg-slate-800 px-4 py-3">
            <span className="font-semibold text-sm text-slate-100">
              {t('autoMapping.confirmPhase2Title')}
            </span>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-sm text-slate-300">{t('autoMapping.confirmPhase2Body')}</p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => state.confirmPhase2(false)}
                className="px-4 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold"
              >
                {t('autoMapping.confirmPhase2No')}
              </button>
              <button
                onClick={() => state.confirmPhase2(true)}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
              >
                {t('autoMapping.confirmPhase2Yes')}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Running / Complete ────────────────────────────────────────────────────
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
      <div className="w-[540px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">

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
                  {t(step.i18nKey as TranslationKey)}
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
                { label: 'GCPs',                                        value: state.report.gcpsCreated,           cls: 'text-green-400' },
                { label: 'BESS',                                        value: state.report.phase1BessComponents,  cls: 'text-green-400' },
                { label: t('autoMapping.report.genSubComponents'),      value: state.report.phase1GenSubComponents,cls: 'text-blue-400'  },
                { label: t('autoMapping.report.conSubComponents'),      value: state.report.phase1ConSubComponents,cls: 'text-blue-400'  },
                { label: t('autoMapping.report.phase2Gcps'),            value: state.report.phase2GcpsCreated,     cls: 'text-slate-400' },
                { label: t('autoMapping.report.ambiguousNames'),        value: state.report.phase1AmbiguousNames,  cls: state.report.phase1AmbiguousNames > 0 ? 'text-yellow-400' : 'text-slate-500' },
                { label: t('autoMapping.warnings').replace('{count}', ''), value: state.report.warnings.length,   cls: state.report.warnings.length > 0 ? 'text-yellow-400' : 'text-green-400' },
              ].map(card => (
                <div key={card.label} className="bg-slate-800 border border-slate-600 rounded p-2 text-center">
                  <div className={`text-lg font-bold ${card.cls}`}>{card.value}</div>
                  <div className="text-[9px] text-slate-400 mt-0.5 leading-tight">{card.label}</div>
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
                  line.startsWith('[OK]')    ? 'text-green-400' :
                  line.startsWith('[WARN]')  ? 'text-yellow-400' :
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
                ⚠ {t('autoMapping.warnings').replace('{count}', String(state.warnings.length))}
              </div>
              {state.warnings.map((w, i) => (
                <div key={i} className="text-yellow-200/80">
                  • {t(w.message as TranslationKey)
                      .replace('{column}', w.column ?? '')
                      .replace('{plantName}', w.plantName ?? '')
                      .replace('{plantId}', String(w.plantId ?? ''))
                      .replace('{direction}', '')}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            {!state.isComplete ? (
              <button
                onClick={state.cancel}
                className="px-4 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold"
              >
                {t('autoMapping.cancel')}
              </button>
            ) : state.report ? (
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
              >
                {t('autoMapping.viewMapping')} →
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold"
              >
                {t('autoMapping.close')}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Update caller — change `state.run()` to `state.startConfirmFlow()` and add missing translation keys**

Open the settings page file that renders `<AutoMappingModal>` (found in Step 1).

Find the button that calls `state.run()` and change it to `state.startConfirmFlow()`.
Also update the condition that shows the modal from `state.isRunning || state.isComplete` to `state.modalStage !== 'idle'`.

Example change:
```tsx
// Before:
<button onClick={state.run}>Auto Mapping</button>
{(state.isRunning || state.isComplete) && <AutoMappingModal state={state} onClose={state.reset} />}

// After:
<button onClick={state.startConfirmFlow}>Auto Mapping</button>
{state.modalStage !== 'idle' && <AutoMappingModal state={state} onClose={state.reset} />}
```

- [ ] **Step 4: Add missing translation keys for confirm stage 1**

In `translations.ts`, verify these keys exist (add if missing):
```typescript
'autoMapping.confirmBody': {
  tr: 'Auto Mapping çalıştırılırsa mevcut yapılandırma sıfırlanacak. Devam etmek istiyor musunuz?',
  en: 'Running Auto Mapping will replace the existing configuration. Do you want to continue?',
},
'autoMapping.confirm': {
  tr: 'Evet, Devam Et',
  en: 'Yes, Proceed',
},
```

- [ ] **Step 5: TypeScript compile check**

```bash
npx tsc -p client/tsconfig.json --noEmit 2>&1 | head -40
```

Fix any errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/settings/AutoMappingModal.tsx
git add client/src/hooks/useAutoMapping.ts
git add shared/src/constants/translations.ts
git commit -m "feat(client): add two-step confirm modal and updated Gen/Con summary cards for Auto Mapping"
```

---

## Task 8: Full End-to-End Verification

- [ ] **Step 1: Run all tests**

```bash
cd C:\Projects\smartpulse-international-cockpit
npx jest --no-coverage 2>&1 | tail -20
```

Expected: all suites pass.

- [ ] **Step 2: Start dev server and manually verify**

```bash
npm run dev
```

1. Navigate to Settings → Asset Mapping
2. Click "Auto Mapping" button
3. Verify Confirm Stage 1 modal appears
4. Click "Yes, Proceed" → Confirm Stage 2 modal appears
5. Click "No, BESS only" → Running modal appears; SSE stream starts with portal_fetch as first step
6. Verify log shows `[OK] Portal fetch — N plants` first
7. Verify `[OK] CSV read — N batteries`
8. Verify `[OK] GCP: <name> (root: <root>) → Gen(<id>) Con(<id>) | N component(s)`
9. Verify summary cards show Gen Sub-comps, Con Sub-comps, Phase 2 GCPs
10. Verify warning messages show translated text (not raw i18nKey)
11. Repeat: click "Yes, include all plants" and verify phase2_done step appears in the step list

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "test: verify Auto Mapping Gen/Con model end-to-end"
```

---

## Task 9: Migrate Existing `portalPlantId` Usages

**Context:** `GcpComponent.portalPlantId` changed from `required number` to `optional number`. All existing code that accesses it directly (e.g. `comp.portalPlantId > 0`) will produce TypeScript errors and wrong runtime behavior for components created by the new Auto Mapping logic (which use `generation`/`consumption` instead).

**Helper pattern** (use everywhere):
```typescript
// Preferred: generation-side plant ID, fallback to consumption, fallback to deprecated field
function resolvePortalPlantId(comp: GcpComponent): number {
  return comp.generation?.portalPlantId ?? comp.consumption?.portalPlantId ?? comp.portalPlantId ?? 0
}
```

**Files:**
- Modify: `client/src/context/ForecastContext.tsx`
- Modify: `client/src/pages/ForecastPage.tsx`
- Modify: `client/src/pages/BatteryParamsPage.tsx`
- Modify: `client/src/pages/BatteryProgramPage.tsx`
- Modify: `shared/src/types/assetMapping.types.ts` (fix `getBessGcps` return type usage)
- Modify: `client/src/components/settings/AssetMappingForm.tsx`

- [ ] **Step 1: Compile client to find all direct `portalPlantId` access errors**

```bash
npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep "portalPlantId"
```

Note all files and line numbers reported. These are the exact locations to fix.

- [ ] **Step 2: Fix `ForecastContext.tsx`**

Find the line: `if (comp.forecastPreference?.sourceName && comp.portalPlantId > 0)`

Replace with:
```typescript
const plantId = comp.generation?.portalPlantId ?? comp.consumption?.portalPlantId ?? comp.portalPlantId ?? 0
if (comp.forecastPreference?.sourceName && plantId > 0) {
  requests.push({
    ...
    powerPlantId: plantId,
```

- [ ] **Step 3: Fix `ForecastPage.tsx`**

Find the pattern: `if (comp.portalPlantId > 0 && !seenIds.has(comp.portalPlantId))`

Replace with:
```typescript
const plantId = comp.generation?.portalPlantId ?? comp.consumption?.portalPlantId ?? comp.portalPlantId ?? 0
if (plantId > 0 && !seenIds.has(plantId)) {
  seenIds.add(plantId)
  // use plantId instead of comp.portalPlantId below
```

- [ ] **Step 4: Fix `BatteryParamsPage.tsx`**

Find: `if (comp.type === 'BESS' && comp.portalPlantId > 0)`

Replace with:
```typescript
const plantId = comp.generation?.portalPlantId ?? comp.consumption?.portalPlantId ?? comp.portalPlantId ?? 0
if (comp.type === 'BESS' && plantId > 0) {
  result.push({ plantId, ... })
```

- [ ] **Step 5: Fix `BatteryProgramPage.tsx`**

Find both occurrences of `selectedBess.bessComponent.portalPlantId` and replace with:
```typescript
const plantId = selectedBess.bessComponent.generation?.portalPlantId
  ?? selectedBess.bessComponent.consumption?.portalPlantId
  ?? selectedBess.bessComponent.portalPlantId
  ?? 0
```

- [ ] **Step 6: Fix `AssetMappingForm.tsx` — display-only update**

Find: `{comp.portalPlantId ? (<span ...>Plant: {comp.portalPlantId}</span>)`

Replace with:
```tsx
{(comp.generation || comp.consumption || comp.portalPlantId) && (
  <span className="text-xs text-gray-500">
    {comp.generation && `Gen: ${comp.generation.portalPlantId}`}
    {comp.generation && comp.consumption && ' / '}
    {comp.consumption && `Con: ${comp.consumption.portalPlantId}`}
    {!comp.generation && !comp.consumption && comp.portalPlantId && `Plant: ${comp.portalPlantId}`}
  </span>
)}
```

Find: `selectedPlantId={comp.portalPlantId || null}`
Replace with:
```tsx
selectedPlantId={comp.generation?.portalPlantId ?? comp.portalPlantId ?? null}
```

- [ ] **Step 7: Verify compile — zero errors**

```bash
npx tsc -p client/tsconfig.json --noEmit
npx tsc -p server/tsconfig.json --noEmit
npx tsc -p shared/tsconfig.json --noEmit
```

All three must report zero errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/context/ForecastContext.tsx
git add client/src/pages/ForecastPage.tsx
git add client/src/pages/BatteryParamsPage.tsx
git add client/src/pages/BatteryProgramPage.tsx
git add client/src/components/settings/AssetMappingForm.tsx
git commit -m "fix: migrate all comp.portalPlantId accesses to generation/consumption pattern"
```

---

## Notes for Agent Workers

- The `GcpComponent.portalPlantId` field is kept as `@deprecated optional` for migration. Do NOT remove it in this plan — it will be cleaned up after the codebase is fully migrated.
- The `autoMappingParser.ts` file is **not changed** in this plan. It still produces `pvAssetId` in `BatteryColumn` — the service simply ignores it.
- `GridConnectionPoint.id` remains `number` — the `idBase + index` pattern is preserved.
- The `autoMapping.confirmBody` and `autoMapping.confirm` translation keys may already exist; check before adding.
- TypeScript errors in files that use `bessComponent.portalPlantId` (e.g. forecast, schedule hooks) should be fixed by reading `comp.generation?.portalPlantId ?? comp.portalPlantId ?? 0`. This is a follow-up, not blocking for this plan.
