# Forecast Subcomponent Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix forecast fetching so that a component's forecast is the algebraic sum of all its subcomponent portal plant forecasts (gen + con), and a GCP's forecast is the sum of all its component forecasts.

**Architecture:** Fix a pre-existing missing type file, introduce a pure `sumForecastSeries` utility in shared, update `ForecastContext` to issue one request per subcomponent plant ID and aggregate per component, and update `ForecastPage` sidebar to list each subcomponent plant as a selectable leaf item.

**Tech Stack:** TypeScript, React 19, Vite (client), Vitest (server workspace tests), shared workspace (`@smartpulse-intl/shared`)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `shared/src/types/monitoring.types.ts` | **Create** | Define `MetricDataPoint` (fixes pre-existing broken import) |
| `shared/src/utils/forecastAggregation.ts` | **Create** | Pure `sumForecastSeries` utility |
| `server/src/utils/forecastAggregation.test.ts` | **Create** | Vitest unit tests (server workspace runs vitest; shared has no test runner) |
| `shared/src/index.ts` | **Modify** | Export new type and utility |
| `client/src/context/ForecastContext.tsx` | **Modify** | Fetch all subcomponent plant IDs, aggregate per component |
| `client/src/pages/ForecastPage.tsx` | **Modify** | Sidebar: gen+con as separate leaf items; fix plant-ID lookups |

---

### Task 0: Create missing `monitoring.types.ts`

**Files:**
- Create: `shared/src/types/monitoring.types.ts`
- Modify: `shared/src/index.ts`

#### Background

`shared/src/types/schedule.types.ts` line 1 imports `MetricDataPoint` from `'./monitoring.types'` but that file does not exist. `ForecastContext.tsx` also imports `MetricDataPoint` from `@smartpulse-intl/shared`. This is a pre-existing broken state that causes TypeScript to fail. Fix it before anything else.

- [ ] **Step 1: Create monitoring.types.ts**

Create `shared/src/types/monitoring.types.ts`:

```typescript
export interface MetricDataPoint {
  timestamp: number  // Unix ms
  value: number
}
```

- [ ] **Step 2: Add to shared index**

In `shared/src/index.ts`, add after the other type exports:
```typescript
export * from './types/monitoring.types';
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd C:\Projects\smartpulse-international-cockpit
npm run build --workspace=client 2>&1 | tail -20
```

Expected: No errors about `monitoring.types`. Fix any new errors that surface.

- [ ] **Step 4: Run server tests**

```bash
npm run test --workspace=server
```

Expected: All tests pass (44 passing).

- [ ] **Step 5: Commit**

```bash
git add shared/src/types/monitoring.types.ts shared/src/index.ts
git commit -m "fix: add missing monitoring.types.ts with MetricDataPoint"
```

---

### Task 1: Pure aggregation utility

**Files:**
- Create: `shared/src/utils/forecastAggregation.ts`
- Create: `server/src/utils/forecastAggregation.test.ts`
- Modify: `shared/src/index.ts`

#### Background

`MetricDataPoint` is `{ timestamp: number; value: number }`. The portal already returns correctly signed values (gen positive, con negative). We just algebraically sum across all series by timestamp. This utility will be used both for per-component aggregation and for GCP-total aggregation.

- [ ] **Step 1: Write the failing test**

Create `server/src/utils/forecastAggregation.test.ts` (the server workspace runs vitest; the shared package has no test runner — tests for shared utilities live in `server/src/utils/`, following the pattern of `nameParser.test.ts` and `autoMappingParser.test.ts`):

```typescript
import { describe, it, expect } from 'vitest'
import { sumForecastSeries } from '@smartpulse-intl/shared'

describe('sumForecastSeries', () => {
  it('returns empty array for no input', () => {
    expect(sumForecastSeries([])).toEqual([])
  })

  it('returns single series unchanged', () => {
    const pts = [{ timestamp: 1000, value: 10 }, { timestamp: 2000, value: 20 }]
    expect(sumForecastSeries([pts])).toEqual(pts)
  })

  it('sums two series with matching timestamps (positive + negative)', () => {
    const a = [{ timestamp: 1000, value: 100 }, { timestamp: 2000, value: 200 }]
    const b = [{ timestamp: 1000, value: -30 }, { timestamp: 2000, value: -50 }]
    const result = sumForecastSeries([a, b])
    expect(result).toEqual([
      { timestamp: 1000, value: 70 },
      { timestamp: 2000, value: 150 },
    ])
  })

  it('handles sparse timestamps (union)', () => {
    const a = [{ timestamp: 1000, value: 10 }]
    const b = [{ timestamp: 2000, value: 20 }]
    const result = sumForecastSeries([a, b])
    expect(result).toHaveLength(2)
    expect(result.find(p => p.timestamp === 1000)?.value).toBe(10)
    expect(result.find(p => p.timestamp === 2000)?.value).toBe(20)
  })

  it('ignores empty arrays in input', () => {
    const a = [{ timestamp: 1000, value: 5 }]
    const result = sumForecastSeries([[], a, []])
    expect(result).toEqual(a)
  })

  it('returns results sorted ascending by timestamp', () => {
    const a = [{ timestamp: 3000, value: 1 }, { timestamp: 1000, value: 2 }]
    const result = sumForecastSeries([a])
    expect(result[0].timestamp).toBe(1000)
    expect(result[1].timestamp).toBe(3000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:\Projects\smartpulse-international-cockpit
npm run test --workspace=server 2>&1 | grep -A5 "forecastAggregation"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the utils directory and implement the utility**

Create `shared/src/utils/forecastAggregation.ts`:

```typescript
import { MetricDataPoint } from '../types/monitoring.types'

/**
 * Algebraically sum multiple forecast series by timestamp.
 * Portal values are already correctly signed (gen positive, con negative) — just add them.
 * Takes a union of all timestamps. Returns points sorted ascending by timestamp.
 */
export function sumForecastSeries(series: MetricDataPoint[][]): MetricDataPoint[] {
  const map = new Map<number, number>()
  for (const pts of series) {
    for (const pt of pts) {
      map.set(pt.timestamp, (map.get(pt.timestamp) ?? 0) + pt.value)
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timestamp, value]) => ({ timestamp, value }))
}
```

- [ ] **Step 4: Export from shared index**

In `shared/src/index.ts`, add after the existing exports:
```typescript
export { sumForecastSeries } from './utils/forecastAggregation';
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test --workspace=server
```

Expected: all tests pass (previously 44, now 44 + 6 = 50).

- [ ] **Step 6: Commit**

```bash
git add shared/src/utils/forecastAggregation.ts shared/src/utils/forecastAggregation.test.ts shared/src/index.ts
git commit -m "feat: add sumForecastSeries utility for subcomponent forecast aggregation"
```

---

### Task 2: ForecastContext — aggregate per component

**Files:**
- Modify: `client/src/context/ForecastContext.tsx` (lines ~166–186, ~238–254)

#### Background

Currently (line 170):
```typescript
const plantId = comp.generation?.portalPlantId ?? comp.consumption?.portalPlantId ?? comp.portalPlantId ?? 0
```
This picks only ONE plant ID. We need to collect ALL plant IDs for a component, fetch them in parallel, then sum the resulting point arrays into one series per component.

Two mapping modes (mutually exclusive):
- **Direct**: `comp.portalPlantId` is set AND `comp.generation`/`comp.consumption` are absent → one request
- **Subcomponent**: `comp.generation` and/or `comp.consumption` are set → one request per subcomponent

After `Promise.allSettled`, group resolved results by `componentId`, then call `sumForecastSeries` on the point arrays to produce one aggregated series per component.

`forecastPreference` (sourceName + beforeMinutes) stays at component level and applies to all subcomponents equally. The optional chaining `comp.forecastPreference?.sourceName` is defensive coding for potentially-incomplete migrated records — do NOT change `forecastPreference` to optional in the type.

- [ ] **Step 1: Add import for sumForecastSeries**

At the top of `ForecastContext.tsx`, find the shared import line (around line 15):
```typescript
import { MetricDataPoint, FORECAST_COLORS } from '@smartpulse-intl/shared';
```
Change to:
```typescript
import { MetricDataPoint, FORECAST_COLORS, sumForecastSeries } from '@smartpulse-intl/shared';
```

- [ ] **Step 2: Replace the request-building block**

Find and replace the "Component forecasts" block (lines ~169–186):

**Old:**
```typescript
    // Component forecasts
    for (const comp of activeGcp.components) {
      const plantId = comp.generation?.portalPlantId ?? comp.consumption?.portalPlantId ?? comp.portalPlantId ?? 0
      if (comp.forecastPreference?.sourceName && plantId > 0) {
        requests.push({
          label: `${comp.displayName} Forecast`,
          promise: forecastApi.getValues({
            companyId,
            powerPlantId: plantId,
            provider: comp.forecastPreference.sourceName,
            startDate: dayStr,
            endDate: dayStr,
            minute: 0,
            hour: '12:30',
            columnId: [6, 7, 10, 1, 2, 3, 4, 11, 12, 13, 14],
          }),
        });
      }
    }
```

**New:**
```typescript
    // Component forecasts — one request per subcomponent plant ID, tagged with componentId for grouping
    interface ForecastRequest {
      componentId: string
      label: string
      promise: Promise<ForecastResponse>
    }
    const requests: ForecastRequest[] = []

    for (const comp of activeGcp.components) {
      if (!comp.forecastPreference?.sourceName) continue

      const apiParams = {
        companyId,
        provider: comp.forecastPreference.sourceName,
        startDate: dayStr,
        endDate: dayStr,
        minute: 0,
        hour: '12:30',
        columnId: [6, 7, 10, 1, 2, 3, 4, 11, 12, 13, 14] as number[],
      }

      // Direct-mapped component (single plant, no gen/con subcomponents)
      if (comp.portalPlantId && !comp.generation && !comp.consumption) {
        requests.push({
          componentId: comp.componentId,
          label: comp.displayName,
          promise: forecastApi.getValues({ ...apiParams, powerPlantId: comp.portalPlantId }),
        })
        continue
      }

      // Subcomponent-mapped: gen and/or con as separate requests
      if (comp.generation?.portalPlantId) {
        requests.push({
          componentId: comp.componentId,
          label: `${comp.displayName} (Gen)`,
          promise: forecastApi.getValues({ ...apiParams, powerPlantId: comp.generation.portalPlantId }),
        })
      }
      if (comp.consumption?.portalPlantId) {
        requests.push({
          componentId: comp.componentId,
          label: `${comp.displayName} (Con)`,
          promise: forecastApi.getValues({ ...apiParams, powerPlantId: comp.consumption.portalPlantId }),
        })
      }
    }
```

**Scoping note:** The existing code at line 166 declares `const requests: { label: string; promise: Promise<ForecastResponse> }[] = []` at the outer block level (same scope as `Promise.allSettled`). The new code moves the declaration into the replacement block — BUT `requests` MUST remain in the same scope as the `Promise.allSettled` call in Step 3, because Step 3 accesses `requests[idx].componentId`. The interface declaration `interface ForecastRequest` and `const requests: ForecastRequest[]` must appear at the **outer block level** (not inside any inner `for` loop or `if` block). Remove the old `const requests` declaration and place the new one at the same level where the old one was.

- [ ] **Step 3: Replace the Promise.allSettled results block**

Find the block from `Promise.allSettled(requests.map(r => r.promise)).then(results => {` to `});` and replace it with:

```typescript
    Promise.allSettled(requests.map(r => r.promise)).then(results => {
      if (fetchId !== fetchIdRef.current) return; // stale

      // Group parsed prediction points by componentId
      const perComponent = new Map<string, MetricDataPoint[][]>()
      let foundIlkKgup: MetricDataPoint[] | undefined;
      let foundRkgup: MetricDataPoint[] | undefined;
      let foundOsos: MetricDataPoint[] | undefined;

      results.forEach((result, idx) => {
        if (result.status !== 'fulfilled') return;
        const res = result.value;
        if (res.isError) return;

        // Extract firstKgup / latestKgup / osos from *any* successful response
        const times = res.Time || [];
        if (!foundIlkKgup && res.Questions?.firstKgup) {
          const pts = Array.isArray(res.Questions.firstKgup) && res.Questions.firstKgup.length > 0 && typeof res.Questions.firstKgup[0] !== 'object'
            ? parseNumberArray(times, res.Questions.firstKgup, tzOffsetMs)
            : parsePredictions(res.Questions.firstKgup, tzOffsetMs);
          if (pts.length > 0) foundIlkKgup = pts;
        }
        if (!foundRkgup && res.Questions?.latestKgup) {
          const pts = Array.isArray(res.Questions.latestKgup) && res.Questions.latestKgup.length > 0 && typeof res.Questions.latestKgup[0] !== 'object'
            ? parseNumberArray(times, res.Questions.latestKgup, tzOffsetMs)
            : parsePredictions(res.Questions.latestKgup, tzOffsetMs);
          if (pts.length > 0) foundRkgup = pts;
        }
        if (!foundOsos && res.Questions?.osos) {
          const pts = Array.isArray(res.Questions.osos) && res.Questions.osos.length > 0 && typeof res.Questions.osos[0] !== 'object'
            ? parseNumberArray(times, res.Questions.osos, tzOffsetMs)
            : parsePredictions(res.Questions.osos, tzOffsetMs);
          if (pts.length > 0) foundOsos = pts;
        }

        const predictions = res.Questions?.providerPrediction
          ?? res.Questions?.selectedProviderPrediction
          ?? res.Questions?.lastPrediction
          ?? [];
        if (!predictions || predictions.length === 0) return;

        const points = parsePredictions(predictions, tzOffsetMs);
        if (points.length === 0) return;

        const { componentId } = requests[idx];
        if (!perComponent.has(componentId)) perComponent.set(componentId, []);
        perComponent.get(componentId)!.push(points);
      });

      // Build one series per component by summing its subcomponent point arrays
      const series: ForecastSeriesItem[] = [];
      let colorIdx = 0;
      for (const comp of activeGcp.components) {
        const arrays = perComponent.get(comp.componentId);
        if (!arrays || arrays.length === 0) continue;
        const summed = sumForecastSeries(arrays);
        if (summed.length > 0) {
          series.push({
            label: comp.displayName,
            data: summed,
            color: FORECAST_COLORS[colorIdx % FORECAST_COLORS.length],
          });
          colorIdx++;
        }
      }

      // Aggregate component forecasts into a GCP total series when more than one
      if (series.length > 1) {
        series.unshift({
          label: `${activeGcp.name} Total`,
          data: sumForecastSeries(series.map(s => s.data)),
          color: FORECAST_COLORS[series.length % FORECAST_COLORS.length],
        });
      }

      // Store in cache (including KGUP/OSOS data)
      const cacheKey = buildCacheKey(gcpId, dateKey);
      forecastCache.set(cacheKey, {
        series,
        ilkKgup: foundIlkKgup,
        rkgup: foundRkgup,
        osos: foundOsos,
      });
```

The rest of the existing code after the cache set (setLoading, dispatch, etc.) remains unchanged.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd C:\Projects\smartpulse-international-cockpit
npm run build --workspace=client 2>&1 | tail -20
```

Expected: No TypeScript errors. Fix any type issues.

- [ ] **Step 5: Commit**

```bash
git add client/src/context/ForecastContext.tsx
git commit -m "feat: aggregate subcomponent forecasts per component in ForecastContext"
```

---

### Task 3: ForecastPage — sidebar with gen+con leaf items

**Files:**
- Modify: `client/src/pages/ForecastPage.tsx` (lines ~147–182, ~256)

#### Background

`ForecastPage` has a sidebar that lists selectable plants. Currently one entry per component. For gen+con components we need TWO selectable items (one per subcomponent plant ID), so the user can view/submit each plant's individual forecast. For direct-mapped components, one item as before.

`ForecastPlantItem` interface: `{ companyId, plantId, displayName, isParent, resolutionMinutes }` — no change needed.

Line ~256 also has `gcp.components.find(c => c.portalPlantId === selectedPlantId)` which won't find gen+con components — fix it.

- [ ] **Step 1: Fix gcpGroups useMemo (lines ~155–168)**

Find and replace the "Add child components" block inside the `gcpGroups` useMemo:

**Old:**
```typescript
        // Add child components
        for (const comp of gcp.components) {
          const plantId = comp.generation?.portalPlantId ?? comp.consumption?.portalPlantId ?? comp.portalPlantId ?? 0
          if (plantId > 0 && !seenIds.has(plantId)) {
            seenIds.add(plantId);
            children.push({
              companyId: company.companyId,
              plantId,
              displayName: comp.displayName,
              isParent: false,
              resolutionMinutes: gcp.resolutionMinutes ?? 60,
            });
          }
        }
```

**New:**
```typescript
        // Add child components — direct-mapped get one entry; gen+con get separate entries
        for (const comp of gcp.components) {
          // Direct-mapped component (single portal plant, no gen/con subcomponents)
          if (comp.portalPlantId && !comp.generation && !comp.consumption) {
            if (!seenIds.has(comp.portalPlantId)) {
              seenIds.add(comp.portalPlantId);
              children.push({
                companyId: company.companyId,
                plantId: comp.portalPlantId,
                displayName: comp.displayName,
                isParent: false,
                resolutionMinutes: gcp.resolutionMinutes ?? 60,
              });
            }
            continue;
          }

          // Subcomponent-mapped: gen and/or con as separate selectable entries
          if (comp.generation?.portalPlantId && !seenIds.has(comp.generation.portalPlantId)) {
            seenIds.add(comp.generation.portalPlantId);
            children.push({
              companyId: company.companyId,
              plantId: comp.generation.portalPlantId,
              displayName: `${comp.displayName} (Gen)`,
              isParent: false,
              resolutionMinutes: gcp.resolutionMinutes ?? 60,
            });
          }
          if (comp.consumption?.portalPlantId && !seenIds.has(comp.consumption.portalPlantId)) {
            seenIds.add(comp.consumption.portalPlantId);
            children.push({
              companyId: company.companyId,
              plantId: comp.consumption.portalPlantId,
              displayName: `${comp.displayName} (Con)`,
              isParent: false,
              resolutionMinutes: gcp.resolutionMinutes ?? 60,
            });
          }
        }
```

- [ ] **Step 2: Fix component lookup for actual production (line ~256)**

Find:
```typescript
              const comp = gcp.components.find(c => c.portalPlantId === selectedPlantId);
```

Replace with:
```typescript
              const comp = gcp.components.find(c =>
                c.portalPlantId === selectedPlantId ||
                c.generation?.portalPlantId === selectedPlantId ||
                c.consumption?.portalPlantId === selectedPlantId
              );
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build --workspace=client 2>&1 | tail -20
```

Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ForecastPage.tsx
git commit -m "feat: show gen/con subcomponents as separate sidebar items in ForecastPage"
```

---

## Testing Checklist

After all tasks complete, manually verify in the running app:

- [ ] `npm run build --workspace=client` — no TypeScript errors
- [ ] `npm run test --workspace=server` — all tests pass (50)
- [ ] Component with only `portalPlantId` → one entry in sidebar, forecast fetched normally
- [ ] Component with `generation` + `consumption` → two entries in sidebar (e.g. "Battery1 (Gen)" and "Battery1 (Con)"), each selectable
- [ ] Selecting "(Gen)" entry shows that plant's individual forecast and allows submission
- [ ] In ForecastContext chart (GCP view), component series = sum of gen+con forecasts; GCP total = sum of all component series
- [ ] No regression in KGUP/OSOS display
