# Monitoring Downsampling & Incremental Fetch

**Date:** 2026-04-12
**Status:** Approved
**Problem:** LiveMonitoring widget slows down as the day progresses — ~25,000+ raw points transferred and rendered every 30s polling cycle.

## Architecture

Two-layer downsampling strategy:

1. **LTTB (base layer)** — visually faithful downsampling of raw ~10s data, preserves spikes/valleys. Default 500 points per metric type.
2. **Interval aggregation (future layer)** — user-selectable 5min/15min/30min/60min bucketing with avg/min/max. Separate spec, mutually exclusive with LTTB.

This spec covers layer 1 only. The API is designed so layer 2 can be added without breaking changes.

## API Changes

### `GET /api/monitoring/v2/metrics`

New query parameters:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `maxPoints` | number | 500 | Target points **per metric type** after LTTB. 0 = no downsampling. Ignored in incremental mode. |
| `mode` | `'full' \| 'incremental'` | `'full'` | `full`: LTTB applied per metric type. `incremental`: raw points returned, no LTTB. |

Existing params unchanged: `gcpId`, `companyId`, `start`, `end`.

**Response shape unchanged** — same `RawMetricPoint[]`. No breaking change for existing consumers (they get LTTB-downsampled data by default, which is strictly better).

**Incremental boundary rule:** `start` is treated as **exclusive** (`effectiveTime > start`) to avoid duplicating the last point from the previous batch.

### Full mode flow (initial load + periodic re-sync)

```
Client: GET /v2/metrics?gcpId=1&start=dayStart&end=now&maxPoints=500
Server:
  1. SELECT * FROM TimeSeriesData WHERE assetId=X AND effectiveTime BETWEEN start AND end ORDER BY effectiveTime ASC
  2. Group by metricType.name → { BAP: [...], SOC: [...], POWER_3054: [...] }
  3. Per group: if group.length > maxPoints → apply LTTB(group, maxPoints)
  4. Flatten all groups back to RawMetricPoint[], return
```

Each metric type independently gets up to `maxPoints` points. With 3 metric types and maxPoints=500, the response contains up to 1500 points total. This avoids the problem of unequal metric densities — a sparse metric (50 points) passes through untouched while a dense one (25,000 points) is properly downsampled.

### Incremental mode flow (polling every 30s)

```
Client: GET /v2/metrics?gcpId=1&start=lastTimestamp&end=now&mode=incremental
Server:
  1. SELECT WHERE effectiveTime > start (exclusive) AND effectiveTime <= end
  2. NO LTTB applied (only 3-5 points per metric in a 30s window)
  3. Return raw points
```

`maxPoints` is ignored in incremental mode. The narrow time window naturally limits the result set.

## LTTB Algorithm

New file: `server/src/utils/lttb.ts`

**Largest Triangle Three Buckets** — O(n) algorithm that selects `targetCount` points from an input array while preserving visual shape. Each bucket keeps the point forming the largest triangle with its neighbors.

Input: `Array<{ timestamp: number; value: number }>`, `targetCount: number`
Output: `Array<{ timestamp: number; value: number }>` of length `targetCount`

Edge cases:
- If input.length <= targetCount, return input unchanged
- First and last points always preserved
- targetCount < 3 returns first + last only

## Client Changes

### Fetch loop consolidation

Currently both `MonitoringContext` and `LiveMonitoringWidget` have independent fetch loops hitting the same endpoint. **LiveMonitoringWidget will be refactored to consume data from MonitoringContext** instead of maintaining its own fetch loop. This eliminates 2x polling load and duplicate state management.

The widget keeps its own `selectedGcpId` state and chart rendering, but reads metrics from the context.

### MonitoringContext.tsx — Incremental fetch

```
State:
  rawMetrics: RawMetricPoint[]      // accumulated buffer
  lastTimestamp: number | null       // latest point timestamp for incremental

Initial load (on mount, date change, GCP change):
  GET /v2/metrics?...&maxPoints=500&mode=full
  → setRawMetrics(data), setLastTimestamp(max timestamp from response)
  → Reset: lastTimestamp = null triggers full mode

Polling (every pollingMs):
  if lastTimestamp exists:
    GET /v2/metrics?...&start=lastTimestamp&end=now&mode=incremental
    → append new points to rawMetrics, update lastTimestamp
  else:
    full load (same as initial)

Day rollover:
  When dateKey changes (detected via toDateKeyInTz), reset rawMetrics and lastTimestamp to null.
  This triggers a fresh full load for the new day.

Buffer management:
  After appending incremental points, group rawMetrics by metricType.
  If any group exceeds 1500 points, apply client-side LTTB to trim that group to 500.
  Re-flatten into rawMetrics.
  This prevents unbounded growth over a full day of polling.
```

### Gap recovery

If an incremental fetch returns 0 points AND `(now - lastTimestamp) > 120 seconds`, assume a gap occurred (server downtime, network error). Trigger a full reload to recover. This handles:
- Temporary network failures where polling missed several cycles
- Server restarts where the ScadaWorker stopped briefly

### monitoring.api.ts

Add `maxPoints` and `mode` optional params to `getLiveMetricsV2`:

```ts
async getLiveMetricsV2(
  gcpId: number,
  companyId: number,
  startIso: string,
  endIso: string,
  options?: { maxPoints?: number; mode?: 'full' | 'incremental' }
): Promise<RawMetricPoint[]>
```

## Performance Impact

| Metric | Before | After |
|--------|--------|-------|
| Initial load payload | ~25,000 points (~1MB) | ~1,500 points (~60KB) — 500 per metric type |
| Polling payload (30s) | ~25,000 points (~1MB) | ~3-5 points (~200B) |
| ECharts render points | ~25,000 | ~500-1,500 |
| Daily network (30s poll, 24h) | ~2.8GB | ~60KB initial + ~0.5MB/day incremental |
| Polling requests | 2x (context + widget) | 1x (context only) |

## Files Changed

| File | Change |
|------|--------|
| `server/src/utils/lttb.ts` | **New** — LTTB algorithm, pure function, no dependencies |
| `server/src/routes/monitoring.routes.ts` | Add maxPoints/mode params, apply LTTB in full mode, exclusive start in incremental |
| `client/src/api/monitoring.api.ts` | Add options param to getLiveMetricsV2 |
| `client/src/context/MonitoringContext.tsx` | Incremental fetch, append, buffer management, day rollover reset, gap recovery |
| `client/src/components/widgets/LiveMonitoringWidget.tsx` | Remove independent fetch loop, consume from MonitoringContext |

## Notes

- v1 monitoring routes are not affected (no v1 exists, v2 is the only version)
- The `maxPoints` default of 500 per metric type means worst case ~1500 total points (3 types). This is well within ECharts comfortable range.
- Client-side LTTB reuse: the same algorithm can be shipped as a shared util if needed, but for now server-only is sufficient. Client buffer trimming can use a simpler every-Nth-point approach since it only kicks in as a safety net.

## Future: Interval Aggregation (Layer 2)

Not in this spec, but the API is ready for it:

```
GET /v2/metrics?gcpId=1&start=...&end=...&interval=15m&aggregation=avg
```

When `interval` is provided, server buckets data into fixed intervals and applies the aggregation function (avg/min/max). LTTB is not applied when interval aggregation is active — they are mutually exclusive modes. This will be a separate spec.
