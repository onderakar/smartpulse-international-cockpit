# Monitoring Downsampling & Incremental Fetch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate LiveMonitoring widget slowdowns by adding server-side LTTB downsampling and client-side incremental fetch.

**Architecture:** Server applies LTTB per metric type (500 pts each) on full loads. Client fetches incrementally after initial load (only new points since last poll). Widget consumes from MonitoringContext instead of its own fetch loop.

**Tech Stack:** TypeScript, Vitest, Prisma, React, ECharts

**Spec:** `docs/superpowers/specs/2026-04-12-monitoring-downsampling-design.md`

---

## File Structure

| File | Role |
|------|------|
| `server/src/utils/lttb.ts` | **New** — Pure LTTB algorithm function |
| `server/src/utils/lttb.test.ts` | **New** — LTTB unit tests |
| `server/src/routes/monitoring.routes.ts` | **Modify** — Add maxPoints/mode params, apply LTTB |
| `client/src/api/monitoring.api.ts` | **Modify** — Add options to getLiveMetricsV2 |
| `client/src/context/MonitoringContext.tsx` | **Modify** — Incremental fetch, append, buffer mgmt |
| `client/src/components/widgets/LiveMonitoringWidget/LiveMonitoringWidget.tsx` | **Modify** — Remove fetch loop, consume from context |

---

### Task 1: LTTB Algorithm — Tests

**Files:**
- Create: `server/src/utils/lttb.ts` (stub)
- Create: `server/src/utils/lttb.test.ts`

- [ ] **Step 1: Create stub LTTB file**

```ts
// server/src/utils/lttb.ts
export interface LttbPoint {
  timestamp: number;
  value: number;
}

export function lttbDownsample(data: LttbPoint[], targetCount: number): LttbPoint[] {
  throw new Error('Not implemented');
}
```

- [ ] **Step 2: Write failing tests**

```ts
// server/src/utils/lttb.test.ts
import { describe, it, expect } from 'vitest';
import { lttbDownsample, type LttbPoint } from './lttb';

function makePoints(count: number): LttbPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: i * 10000,
    value: Math.sin(i * 0.1) * 100,
  }));
}

describe('lttbDownsample', () => {
  it('returns input unchanged when length <= targetCount', () => {
    const pts = makePoints(5);
    expect(lttbDownsample(pts, 10)).toEqual(pts);
    expect(lttbDownsample(pts, 5)).toEqual(pts);
  });

  it('returns empty array for empty input', () => {
    expect(lttbDownsample([], 10)).toEqual([]);
  });

  it('preserves first and last points', () => {
    const pts = makePoints(1000);
    const result = lttbDownsample(pts, 50);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it('returns exactly targetCount points', () => {
    const pts = makePoints(10000);
    const result = lttbDownsample(pts, 500);
    expect(result).toHaveLength(500);
  });

  it('preserves chronological order', () => {
    const pts = makePoints(5000);
    const result = lttbDownsample(pts, 200);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].timestamp).toBeGreaterThan(result[i - 1].timestamp);
    }
  });

  it('preserves spikes better than uniform sampling', () => {
    // Create flat data with one spike
    const pts: LttbPoint[] = Array.from({ length: 1000 }, (_, i) => ({
      timestamp: i * 1000,
      value: i === 500 ? 1000 : 1, // spike at index 500
    }));
    const result = lttbDownsample(pts, 50);
    const maxVal = Math.max(...result.map(p => p.value));
    expect(maxVal).toBe(1000); // spike must be preserved
  });

  it('handles targetCount < 3 by returning first and last', () => {
    const pts = makePoints(100);
    const result = lttbDownsample(pts, 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(pts[0]);
    expect(result[1]).toEqual(pts[pts.length - 1]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && npx vitest run src/utils/lttb.test.ts`
Expected: FAIL — "Not implemented"

- [ ] **Step 4: Commit stub + tests**

```bash
git add server/src/utils/lttb.ts server/src/utils/lttb.test.ts
git commit -m "test: add LTTB algorithm tests (red)"
```

---

### Task 2: LTTB Algorithm — Implementation

**Files:**
- Modify: `server/src/utils/lttb.ts`

- [ ] **Step 1: Implement LTTB**

```ts
// server/src/utils/lttb.ts
export interface LttbPoint {
  timestamp: number;
  value: number;
}

/**
 * Largest Triangle Three Buckets downsampling.
 * O(n) — preserves visual shape by keeping the point in each bucket
 * that forms the largest triangle with its neighbors.
 */
export function lttbDownsample(data: LttbPoint[], targetCount: number): LttbPoint[] {
  const len = data.length;
  if (len <= targetCount) return data.slice();
  if (targetCount < 3) return [data[0], data[len - 1]];

  const sampled: LttbPoint[] = [];
  // Always keep the first point
  sampled.push(data[0]);

  const bucketSize = (len - 2) / (targetCount - 2);

  let prevSelectedIndex = 0;

  for (let i = 0; i < targetCount - 2; i++) {
    // Current bucket range
    const bucketStart = Math.floor((i) * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, len - 1);

    // Next bucket average (for triangle calculation)
    const nextBucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextBucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len - 1);

    let avgX = 0;
    let avgY = 0;
    const nextBucketLen = nextBucketEnd - nextBucketStart;
    if (nextBucketLen > 0) {
      for (let j = nextBucketStart; j < nextBucketEnd; j++) {
        avgX += data[j].timestamp;
        avgY += data[j].value;
      }
      avgX /= nextBucketLen;
      avgY /= nextBucketLen;
    } else {
      // Last bucket — use the last point
      avgX = data[len - 1].timestamp;
      avgY = data[len - 1].value;
    }

    // Find point in current bucket with largest triangle area
    const prevX = data[prevSelectedIndex].timestamp;
    const prevY = data[prevSelectedIndex].value;

    let maxArea = -1;
    let selectedIndex = bucketStart;

    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs(
        (prevX - avgX) * (data[j].value - prevY) -
        (prevX - data[j].timestamp) * (avgY - prevY)
      );
      if (area > maxArea) {
        maxArea = area;
        selectedIndex = j;
      }
    }

    sampled.push(data[selectedIndex]);
    prevSelectedIndex = selectedIndex;
  }

  // Always keep the last point
  sampled.push(data[len - 1]);

  return sampled;
}
```

- [ ] **Step 2: Run tests**

Run: `cd server && npx vitest run src/utils/lttb.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/utils/lttb.ts
git commit -m "feat: implement LTTB downsampling algorithm"
```

---

### Task 3: Server Route — Add Downsampling

**Files:**
- Modify: `server/src/routes/monitoring.routes.ts` (lines 16-47, the `GET /v2/metrics` handler)

- [ ] **Step 1: Add maxPoints and mode params + LTTB to the route**

In `monitoring.routes.ts`, first add the import at the top of the file (after existing imports):

```ts
import { lttbDownsample } from '../utils/lttb';
```

Then replace the `GET /v2/metrics` handler (lines 16-47) with:

```ts
  // GET /api/monitoring/v2/metrics
  router.get('/v2/metrics', sessionAuth, async (req, res, next) => {
    try {
      const { gcpId, companyId, start, end, maxPoints: maxPointsStr, mode } = req.query;
      if (!gcpId || !companyId || !start || !end) {
        return res.status(400).json({ message: 'gcpId, companyId, start, end required' });
      }

      const maxPoints = maxPointsStr ? parseInt(maxPointsStr as string, 10) : 500;
      const isIncremental = mode === 'incremental';

      const asset = await prisma.asset.findUnique({ where: { name: `GCP_${gcpId}` } });
      if (!asset) {
        return res.status(404).json({ message: `Asset GCP_${gcpId} not found` });
      }

      const metrics = await prisma.timeSeriesData.findMany({
        where: {
          assetId: asset.id,
          effectiveTime: isIncremental
            ? { gt: new Date(start as string), lte: new Date(end as string) }
            : { gte: new Date(start as string), lte: new Date(end as string) },
        },
        include: { metricType: true },
        orderBy: { effectiveTime: 'asc' },
      });

      let result = metrics.map((m: any) => ({
        timestamp: m.effectiveTime.getTime(),
        type: m.metricType.name.toUpperCase(),
        value: m.value,
      }));

      // Apply LTTB in full mode when maxPoints > 0
      if (!isIncremental && maxPoints > 0 && result.length > maxPoints) {

        // Group by metric type
        const groups = new Map<string, typeof result>();
        for (const pt of result) {
          if (!groups.has(pt.type)) groups.set(pt.type, []);
          groups.get(pt.type)!.push(pt);
        }

        // LTTB per group
        const downsampled: typeof result = [];
        for (const [type, points] of groups) {
          if (points.length > maxPoints) {
            const lttbInput = points.map(p => ({ timestamp: p.timestamp, value: p.value }));
            const sampled = lttbDownsample(lttbInput, maxPoints);
            const sampledSet = new Set(sampled.map((s: any) => s.timestamp));
            downsampled.push(...points.filter(p => sampledSet.has(p.timestamp)));
          } else {
            downsampled.push(...points);
          }
        }

        result = downsampled.sort((a, b) => a.timestamp - b.timestamp);
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  });
```

- [ ] **Step 2: Verify server compiles**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/monitoring.routes.ts
git commit -m "feat: add LTTB downsampling + incremental mode to metrics endpoint"
```

---

### Task 4: Client API — Add Options

**Files:**
- Modify: `client/src/api/monitoring.api.ts`

- [ ] **Step 1: Add options param to getLiveMetricsV2**

Replace the `getLiveMetricsV2` method:

```ts
  async getLiveMetricsV2(
    gcpId: number,
    companyId: number,
    startIso: string,
    endIso: string,
    options?: { maxPoints?: number; mode?: 'full' | 'incremental' },
  ): Promise<RawMetricPoint[]> {
    const { data } = await apiClient.get('/monitoring/v2/metrics', {
      params: {
        gcpId,
        companyId,
        start: startIso,
        end: endIso,
        ...(options?.maxPoints !== undefined && { maxPoints: options.maxPoints }),
        ...(options?.mode && { mode: options.mode }),
      },
    });
    return data;
  },
```

- [ ] **Step 2: Commit**

```bash
git add client/src/api/monitoring.api.ts
git commit -m "feat: add maxPoints/mode options to monitoring API client"
```

---

### Task 5: MonitoringContext — Incremental Fetch

**Files:**
- Modify: `client/src/context/MonitoringContext.tsx`

This is the largest change. Key modifications:
1. Add `lastTimestamp` state for incremental tracking
2. Split `loadInitialData` into full load + incremental poll
3. Add buffer management (per-metric-type LTTB trim when > 1500 per type)
4. Add gap recovery (full reload if gap > 120s)
5. Reset on dateKey change

- [ ] **Step 1: Add client-side LTTB utility at top of file**

Add after the existing imports, before the `getSocketUrl` function:

```ts
// Client-side simple downsampling (every-Nth) for buffer management
function trimBuffer(metrics: RawMetricPoint[], maxPerType: number): RawMetricPoint[] {
  const groups = new Map<string, RawMetricPoint[]>();
  for (const m of metrics) {
    if (!groups.has(m.type)) groups.set(m.type, []);
    groups.get(m.type)!.push(m);
  }

  const result: RawMetricPoint[] = [];
  for (const [, points] of groups) {
    if (points.length > maxPerType) {
      // Keep every Nth point + always keep first and last
      const step = Math.ceil(points.length / maxPerType);
      const trimmed: RawMetricPoint[] = [points[0]];
      for (let i = step; i < points.length - 1; i += step) {
        trimmed.push(points[i]);
      }
      trimmed.push(points[points.length - 1]);
      result.push(...trimmed);
    } else {
      result.push(...points);
    }
  }
  return result.sort((a, b) => a.timestamp - b.timestamp);
}
```

- [ ] **Step 2: Refactor fetchAllMetricsV2 to accept options and return rawMetrics**

Replace the entire `fetchAllMetricsV2` function (lines ~97-167) with:

```ts
async function fetchAllMetricsV2(
  mapping: AssetMapping,
  startISO: string,
  endISO: string,
  options?: { maxPoints?: number; mode?: 'full' | 'incremental' },
): Promise<{ liveData: LiveMonitoringData; rawMetrics: RawMetricPoint[] }> {
  const gcp = getFirstGcp(mapping);
  if (!gcp) {
    return {
      liveData: { powerComponents: [], batterySoc: [], batteryActivePower: [], netPower: [] },
      rawMetrics: [],
    };
  }

  const companyMatch = mapping.companies?.find(c =>
    c.gridConnectionPoints?.some(g => g.id === gcp.id)
  );
  const companyId = companyMatch?.companyId ?? 0;

  const rawMetrics = await monitoringApi.getLiveMetricsV2(gcp.id, companyId, startISO, endISO, options);

  const data: LiveMonitoringData = {
    powerComponents: [], batterySoc: [], batteryActivePower: [], netPower: [],
  };
  const compMap = new Map<string, MetricDataPoint[]>();

  rawMetrics.forEach((m: RawMetricPoint) => {
    const pt: MetricDataPoint = { timestamp: m.timestamp, value: m.value };
    if (m.type === 'SOC') {
      data.batterySoc.push(pt);
    } else if (m.type === 'BAP') {
      data.batteryActivePower.push(pt);
    } else if (m.type.includes('POWER')) {
      const matchedComp = gcp.components?.find(c =>
        c.monitoring?.metrics?.some(x => {
          const tagUp = x.tag.toUpperCase();
          if (tagUp === m.type) return true;
          if ('nodeidentity' in x && x.nodeidentity && m.type === `${tagUp}_${x.nodeidentity}`) return true;
          return false;
        })
      );
      const key = matchedComp?.componentId || 'power_agg';
      const arr = compMap.get(key) || [];
      arr.push(pt);
      compMap.set(key, arr);
    }
  });

  compMap.forEach((pts, compId) => {
    let cName = 'Aggregated Power';
    if (compId !== 'power_agg') {
      const c = gcp.components?.find(x => x.componentId === compId);
      if (c) cName = c.displayName || cName;
    }
    data.powerComponents.push({
      componentId: compId,
      displayName: cName,
      type: gcp.components?.find(x => x.componentId === compId)?.type || 'OTHER',
      data: pts.sort((a, b) => a.timestamp - b.timestamp),
    });
  });

  const allComponentData = data.powerComponents.map(pc => pc.data);
  const totalRenewable = sumMetrics(allComponentData);
  data.netPower = computeNetPower(totalRenewable, data.batteryActivePower);

  return { liveData: data, rawMetrics };
}
```

- [ ] **Step 3: Add incremental state and rewrite load/poll logic in MonitoringProvider**

Add new state after existing state declarations (around line 248-249):

```ts
  const [rawMetricsBuffer, setRawMetricsBuffer] = useState<RawMetricPoint[]>([]);
  const [lastTimestamp, setLastTimestamp] = useState<number | null>(null);
```

Replace `loadInitialData` (lines 271-290) with two functions:

```ts
  // Full load — used on mount, date change, gap recovery
  const loadFull = useCallback(async () => {
    if (!mapping || !gcp) return;
    setIsLoading(true);
    setError(null);
    try {
      if (socket) socket.emit('subscribe:asset', gcp.id);

      const endISO = getEndISO();
      const { liveData, rawMetrics } = await fetchAllMetricsV2(mapping, startISO, endISO, { maxPoints: 500, mode: 'full' });
      setData(liveData);
      setRawMetricsBuffer(rawMetrics);
      const maxTs = rawMetrics.length > 0 ? Math.max(...rawMetrics.map(m => m.timestamp)) : null;
      setLastTimestamp(maxTs);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [mapping, gcp, startISO, getEndISO, socket]);

  // Incremental poll — appends new points
  const pollIncremental = useCallback(async () => {
    if (!mapping || !gcp || !lastTimestamp) {
      return loadFull();
    }
    try {
      const endISO = getEndISO();
      const { rawMetrics: newPoints } = await fetchAllMetricsV2(
        mapping,
        new Date(lastTimestamp).toISOString(),
        endISO,
        { mode: 'incremental' },
      );

      // Gap recovery: if no new points and gap > 120s, full reload
      const now = Date.now();
      if (newPoints.length === 0 && (now - lastTimestamp) > 120_000) {
        console.log('[MonitoringContext] Gap detected (>120s with no data), triggering full reload');
        return loadFull();
      }

      if (newPoints.length > 0) {
        setRawMetricsBuffer(prev => {
          const merged = [...prev, ...newPoints];
          // Buffer management: trim if any type exceeds 1500 points
          const hasOversized = (() => {
            const counts = new Map<string, number>();
            for (const m of merged) counts.set(m.type, (counts.get(m.type) || 0) + 1);
            return Array.from(counts.values()).some(c => c > 1500);
          })();
          return hasOversized ? trimBuffer(merged, 500) : merged;
        });

        const maxTs = Math.max(...newPoints.map(m => m.timestamp));
        setLastTimestamp(maxTs);
        setLastUpdated(new Date());
      }
    } catch (err: any) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [mapping, gcp, lastTimestamp, getEndISO, loadFull]);
```

- [ ] **Step 4: Add effect to rebuild LiveMonitoringData from rawMetricsBuffer**

Add after the state declarations:

```ts
  // Rebuild LiveMonitoringData whenever rawMetricsBuffer changes
  useEffect(() => {
    if (rawMetricsBuffer.length === 0 || !gcp) return;

    const newData: LiveMonitoringData = {
      powerComponents: [], batterySoc: [], batteryActivePower: [], netPower: [],
    };
    const compMap = new Map<string, MetricDataPoint[]>();

    for (const m of rawMetricsBuffer) {
      const pt: MetricDataPoint = { timestamp: m.timestamp, value: m.value };
      if (m.type === 'SOC') {
        newData.batterySoc.push(pt);
      } else if (m.type === 'BAP') {
        newData.batteryActivePower.push(pt);
      } else if (m.type.includes('POWER')) {
        const matchedComp = gcp.components?.find(c =>
          c.monitoring?.metrics?.some(x => {
            const tagUp = x.tag.toUpperCase();
            if (tagUp === m.type) return true;
            if ('nodeidentity' in x && x.nodeidentity && m.type === `${tagUp}_${x.nodeidentity}`) return true;
            return false;
          })
        );
        const key = matchedComp?.componentId || 'power_agg';
        if (!compMap.has(key)) compMap.set(key, []);
        compMap.get(key)!.push(pt);
      }
    }

    compMap.forEach((pts, compId) => {
      let cName = 'Aggregated Power';
      if (compId !== 'power_agg') {
        const c = gcp.components?.find(x => x.componentId === compId);
        if (c) cName = c.displayName || cName;
      }
      newData.powerComponents.push({
        componentId: compId,
        displayName: cName,
        type: gcp.components?.find(x => x.componentId === compId)?.type || 'OTHER',
        data: pts.sort((a, b) => a.timestamp - b.timestamp),
      });
    });

    const allComponentData = newData.powerComponents.map(pc => pc.data);
    const totalRenewable = sumMetrics(allComponentData);
    newData.netPower = computeNetPower(totalRenewable, newData.batteryActivePower);

    setData(newData);
  }, [rawMetricsBuffer, gcp]);
```

- [ ] **Step 5: Update initial load effect and polling to use new functions**

Replace the `useEffect` at line 292-294 and `usePolling` at line 296-303:

```ts
  useEffect(() => {
    loadFull();
  }, [loadFull]);

  const pollingMs = (profile?.polling?.intervalSeconds ?? 60) * 1000;

  usePolling({
    callback: pollIncremental,
    intervalMs: pollingMs,
    enabled: !error?.includes('NOT_AUTHENTICATED') && !isLoading,
    immediate: false,
  });
```

- [ ] **Step 6: Update dateKey reset to also clear lastTimestamp**

In the existing `useEffect` that resets on dateKey change (line 252-256), add:

```ts
  useEffect(() => {
    setData(emptyData);
    setRawMetricsBuffer([]);
    setLastTimestamp(null);
    setLastUpdated(null);
    setError(null);
  }, [dateKey, emptyData]);
```

- [ ] **Step 7: Update WebSocket handler to use incremental**

Replace the WebSocket listener (lines 306-324) — on `live_metrics` event, just call `pollIncremental` instead of re-fetching everything:

```ts
  useEffect(() => {
    if (!socket || !isToday) return;

    const handler = () => {
      pollIncremental();
    };

    socket.on('live_metrics', handler);
    return () => {
      socket.off('live_metrics', handler);
    };
  }, [socket, isToday, pollIncremental]);
```

- [ ] **Step 8: Update refresh to use loadFull**

```ts
  const refresh = useCallback(loadFull, [loadFull]);
```

- [ ] **Step 9: Verify client compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors (or only pre-existing ones)

- [ ] **Step 10: Commit**

```bash
git add client/src/context/MonitoringContext.tsx
git commit -m "feat: incremental fetch + buffer management in MonitoringContext"
```

---

### Task 6: LiveMonitoringWidget — Consume from Context

**Files:**
- Modify: `client/src/components/widgets/LiveMonitoringWidget/LiveMonitoringWidget.tsx`

The widget currently has its own fetch loop (lines 66-101). Remove it and consume from `useMonitoring()` context instead.

- [ ] **Step 1: Remove independent fetch loop, use context**

Replace the entire widget with:

```tsx
import { useState, useEffect, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useProfile } from '../../../context/ProfileContext';
import { useLocale } from '../../../context/LocaleContext';
import { useMonitoring } from '../../../context/MonitoringContext';
import {
  getAllGcps,
} from '@smartpulse-intl/shared';
import type { MetricDataPoint } from '@smartpulse-intl/shared';

// Colors
const COMPONENT_COLORS = ['#29B6F6', '#FFB300', '#00BFA5', '#5C6BC0', '#FF7043', '#66BB6A', '#AB47BC', '#EF5350'];
const TOTAL_COLOR = '#B0BEC5';

interface ComponentSeries {
  componentId: string;
  displayName: string;
  type: string;
  data: MetricDataPoint[];
}

export function LiveMonitoringWidget() {
  const { profile } = useProfile();
  const { t } = useLocale();
  const { data, isLoading, error } = useMonitoring();
  const mapping = profile?.assetMapping ?? null;

  const allGcps = useMemo(() => getAllGcps(mapping), [mapping]);
  const [selectedGcpId, setSelectedGcpId] = useState<number | null>(null);

  useEffect(() => {
    if (allGcps.length > 0 && selectedGcpId === null) {
      const withMonitoring = allGcps.find(g =>
        g.components?.some(c => c.monitoring?.metrics?.length)
      );
      setSelectedGcpId(withMonitoring?.id ?? allGcps[0].id);
    }
  }, [allGcps, selectedGcpId]);

  const selectedGcp = useMemo(
    () => allGcps.find(g => g.id === selectedGcpId) ?? null,
    [allGcps, selectedGcpId]
  );

  // Transform context data into chart series
  const { componentSeries, totalSeries, socSeries } = useMemo(() => {
    if (!data) return { componentSeries: [], totalSeries: [], socSeries: [] };

    const series: ComponentSeries[] = data.powerComponents.map(pc => ({
      componentId: pc.componentId,
      displayName: pc.displayName,
      type: pc.type,
      data: pc.data,
    }));

    // Add BAP as BESS component series
    if (data.batteryActivePower.length > 0) {
      const bessComp = selectedGcp?.components?.find(c => c.type === 'BESS');
      series.push({
        componentId: bessComp?.componentId || 'bap',
        displayName: bessComp?.displayName || 'Battery (BAP)',
        type: 'BESS',
        data: data.batteryActivePower,
      });
    }

    // Compute total
    const tsMap = new Map<number, number>();
    for (const s of series) {
      for (const pt of s.data) {
        tsMap.set(pt.timestamp, (tsMap.get(pt.timestamp) || 0) + pt.value);
      }
    }
    const total = Array.from(tsMap.entries())
      .map(([timestamp, value]) => ({ timestamp, value }))
      .sort((a, b) => a.timestamp - b.timestamp);

    return {
      componentSeries: series,
      totalSeries: total,
      socSeries: data.batterySoc,
    };
  }, [data, selectedGcp]);

  // Point count for display
  const pointCount = useMemo(() => {
    if (!data) return 0;
    return data.batterySoc.length + data.batteryActivePower.length +
      data.powerComponents.reduce((sum, pc) => sum + pc.data.length, 0);
  }, [data]);

  // ECharts option — same as before
  const chartOption = useMemo<EChartsOption>(() => {
    const now = Date.now();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date();
    dayEnd.setHours(23, 59, 59, 999);

    const series: any[] = [];

    componentSeries.forEach((cs, i) => {
      series.push({
        name: cs.displayName,
        type: 'line',
        smooth: 0.2,
        sampling: 'lttb',
        data: cs.data.map(p => [p.timestamp, p.value]),
        color: COMPONENT_COLORS[i % COMPONENT_COLORS.length],
        lineStyle: { width: 2 },
        showSymbol: false,
        yAxisIndex: 0,
      });
    });

    if (totalSeries.length > 0 && componentSeries.length > 1) {
      series.push({
        name: `${selectedGcp?.name || 'GCP'} Total`,
        type: 'line',
        smooth: 0.2,
        sampling: 'lttb',
        data: totalSeries.map(p => [p.timestamp, p.value]),
        color: TOTAL_COLOR,
        lineStyle: { width: 2.5, type: 'dashed' as const },
        showSymbol: false,
        yAxisIndex: 0,
      });
    }

    if (socSeries.length > 0) {
      series.push({
        name: 'SoC (MWh)',
        type: 'bar',
        data: socSeries.map(p => [p.timestamp, p.value]),
        yAxisIndex: 1,
        barWidth: '80%',
        itemStyle: {
          color: 'rgba(76, 175, 80, 0.2)',
          borderRadius: [1, 1, 0, 0],
        },
        silent: true,
        z: 0,
      });
    }

    if (series.length > 0 && !series[0].markLine) {
      series[0].markLine = {
        silent: true,
        symbol: 'none',
        animation: false,
        data: [{ xAxis: now }],
        lineStyle: { type: 'dashed', color: 'rgba(255,255,255,0.25)', width: 1 },
        label: { show: false },
      };
    }

    return {
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 58, right: 58, top: 16, bottom: 50, containLabel: false },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', crossStyle: { color: 'rgba(255,255,255,0.2)' } },
        backgroundColor: 'rgba(20,20,40,0.92)',
        borderColor: 'rgba(255,255,255,0.12)',
        textStyle: { color: '#e0e0e0', fontSize: 11 },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const time = new Date(params[0].value[0]).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          let html = `<div style="font-weight:600;margin-bottom:4px">${time}</div>`;
          for (const p of params) {
            const val = typeof p.value[1] === 'number' ? p.value[1].toFixed(3) : p.value[1];
            const unit = p.seriesName?.includes('SoC') ? 'MWh' : 'MW';
            html += `<div>${p.marker} ${p.seriesName}: <b>${val}</b> ${unit}</div>`;
          }
          return html;
        },
      },
      legend: {
        show: true,
        bottom: 0,
        textStyle: { color: '#a0a0b0', fontSize: 10 },
        icon: 'roundRect',
        itemWidth: 14,
        itemHeight: 3,
      },
      xAxis: {
        type: 'time',
        min: dayStart.getTime(),
        max: dayEnd.getTime(),
        axisLine: { lineStyle: { color: '#2a2a3e' } },
        axisLabel: {
          color: '#a0a0b0',
          fontSize: 10,
          formatter: (val: number) => new Date(val).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          showMaxLabel: false,
        },
        splitLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        axisTick: { lineStyle: { color: '#2a2a3e' } },
      },
      yAxis: [
        {
          type: 'value',
          position: 'left',
          name: 'MW',
          nameTextStyle: { color: '#a0a0b0', fontSize: 10 },
          axisLine: { show: true, lineStyle: { color: '#2a2a3e' } },
          axisLabel: { color: '#a0a0b0', fontSize: 11 },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
        },
        {
          type: 'value',
          position: 'right',
          name: 'MWh',
          nameTextStyle: { color: '#a0a0b0', fontSize: 10 },
          axisLine: { show: true, lineStyle: { color: '#2a2a3e' } },
          axisLabel: { color: '#a0a0b0', fontSize: 11 },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'filter' },
        {
          type: 'slider',
          xAxisIndex: 0,
          filterMode: 'filter',
          bottom: 22,
          height: 18,
          textStyle: { color: '#a0a0b0' },
          borderColor: 'transparent',
          fillerColor: 'rgba(79, 195, 247, 0.2)',
          handleStyle: { color: '#a0a0b0' },
        },
      ],
      series,
    };
  }, [componentSeries, totalSeries, socSeries, selectedGcp]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.1))',
        flexShrink: 0,
      }}>
        <label style={{ fontSize: 11, color: 'var(--color-text-muted, #a0a0b0)', whiteSpace: 'nowrap' }}>
          GCP:
        </label>
        <select
          value={selectedGcpId ?? ''}
          onChange={e => setSelectedGcpId(Number(e.target.value))}
          style={{
            flex: 1,
            background: 'var(--color-surface, #1c1c35)',
            color: 'var(--color-text, #e0e0e0)',
            border: '1px solid var(--color-border, rgba(255,255,255,0.15))',
            borderRadius: 4,
            padding: '3px 6px',
            fontSize: 12,
            outline: 'none',
            maxWidth: 260,
          }}
        >
          {allGcps.map(gcp => (
            <option key={gcp.id} value={gcp.id}>
              {gcp.name} ({gcp.components?.length || 0} comp)
            </option>
          ))}
        </select>
        {isLoading && (
          <span style={{ fontSize: 10, color: '#a0a0b0' }}>Loading...</span>
        )}
        {pointCount > 0 && (
          <span style={{ fontSize: 10, color: '#666', marginLeft: 'auto' }}>
            {pointCount.toLocaleString()} pts
          </span>
        )}
      </div>

      {error && (
        <div style={{ padding: '8px 10px', color: '#EF5350', fontSize: 11 }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        {pointCount === 0 && !isLoading ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#666',
            fontSize: 12,
          }}>
            {selectedGcp ? 'No monitoring data for this GCP' : 'Select a GCP'}
          </div>
        ) : (
          <ReactECharts
            option={chartOption}
            style={{ width: '100%', height: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge={true}
          />
        )}
      </div>
    </div>
  );
}
```

Key changes:
- Removed: `monitoringApi` import, `rawMetrics` state, `fetchData`, `pollingRef`, entire fetch useEffect
- Added: `useMonitoring()` hook, reads `data`, `isLoading`, `error` from context
- Added: `sampling: 'lttb'` to ECharts line series (extra safety net)
- `pointCount` computed from context data instead of rawMetrics.length

- [ ] **Step 2: Verify client compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/components/widgets/LiveMonitoringWidget/LiveMonitoringWidget.tsx
git commit -m "refactor: widget consumes from MonitoringContext, remove duplicate fetch loop"
```

---

### Task 7: Run Tests + Final Verification

- [ ] **Step 1: Run LTTB tests**

Run: `cd server && npx vitest run src/utils/lttb.test.ts`
Expected: All PASS

- [ ] **Step 2: Run all server tests**

Run: `cd server && npx vitest run`
Expected: All PASS

- [ ] **Step 3: Verify full build**

Run: `cd client && npx tsc --noEmit && cd ../server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit any fixes if needed**
