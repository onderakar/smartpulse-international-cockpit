# monitoring/ — SCADA Data & Live Dashboard

> **Part of**: [concepts/](../_index.md) · **Lines**: ~115 · **Last updated**: 2026-04-15

## Summary

The monitoring domain collects live SCADA data from the monitoring API and makes it available to the dashboard. A background **ScadaWorker** polls the monitoring API every 30 seconds, accumulates time-series points, and stores them in memory (the server process). The dashboard reads these points via a REST endpoint with LTTB downsampling to limit payload size.

Data is organized per GCP, using the asset identifier pattern `GCP_{gcpId}`. Each data point carries a metric type (e.g. `SOC`, `BAP`, `POWER_<plantId>`), a Unix timestamp, and a float value.

An incremental fetch strategy is used: on first load, the client receives the full window; subsequent calls fetch only new points since the last known timestamp.

## Owned Entities

| Entity | Description |
|--------|-------------|
| `RawMetricPoint` | Raw point from monitoring API: `timestamp` (Unix ms), `type` (string tag), `value` (float). |
| `MetricDataPoint` | Chart-ready point: `timestamp` (Unix ms), `value` (float). |
| `PowerComponent` | Per-component power series for the dashboard: `componentId`, `displayName`, `type`, `data: MetricDataPoint[]`. |
| `LiveMonitoringData` | Full response to the client: `powerComponents[]`, `batterySoc[]`, `batteryActivePower[]`, `netPower[]`. |
| `LiveSnapshot` | Latest scalar values: `socPercent`, `socMwh`, `bapMW`, `timestamp`. Used for the summary cards. |

See [data-models.md](./data-models.md) for full field schemas.

## Referenced By

| Consumer | How it uses monitoring |
|----------|----------------------|
| [intraday/](../intraday/README.md) | Shares the `MetricDataPoint` / time-series pattern (EntityTimeSeries) |

## Key Concepts

| Concept | Description |
|---------|-------------|
| ScadaWorker | Background worker that polls monitoring API on a 30s interval. Runs in-process on the server. |
| 1-hour lookback | On worker start, fetches the last 1 hour of data to populate the initial window. |
| LTTB downsampling | Largest-Triangle-Three-Buckets algorithm. Reduces each metric type to ~500 points before sending to client. Preserves visual shape. |
| Incremental fetch | Client passes `since` timestamp; server returns only points after that. First load = full window. |
| Health check | Runs every 10 minutes. Scans the last 26 hours for gaps (missing intervals). Backfills if gaps found. |
| Asset naming | Monitoring data is keyed by `GCP_{gcpId}` — derived from `GridConnectionPoint.id` in asset topology. |
| Metric types | `SOC` (state of charge %), `BAP` (battery active power MW), `POWER_{portalPlantId}` (per-plant power). |
| `GcpComponent.monitoring` | Config block on the component. Contains `masternode` (API node identifier) and `metrics[]` (metric tag + node mapping). |
| `LabeledMetricMapping` | Maps a `MetricTag` (`SoC`, `ActivePower`, `Power`, `Other`) to a monitoring node and optional custom label. |
| `BapSource` | Special source marker: reads BAP from `response.data.bap` rather than a metric node. Tag is always `ActivePower`. |
| Monitoring credentials | Stored in `GroupProfile.monitoringCredentials` (username/password). Used by ScadaWorker to authenticate. |

## When to Read Which File

| Task | File |
|------|------|
| Understand entity schemas (fields, types, constraints) | [data-models.md](./data-models.md) |
| Configure which metrics a component exposes | [asset-topology/data-models.md](../asset-topology/data-models.md) — `GcpComponent.monitoring` |
| Understand monitoring credentials storage | [profile/README.md](../profile/README.md) |
| Understand the EntityTimeSeries shared pattern | [intraday/README.md](../intraday/README.md) |

## Code References

| Symbol | File |
|--------|------|
| `MetricDataPoint`, `PowerComponent`, `LiveMonitoringData`, `LiveSnapshot`, `RawMetricPoint` | `shared/src/types/monitoring.types.ts` |
| `LabeledMetricMapping`, `BapSource`, `MetricTag` | `shared/src/types/assetMapping.types.ts` |
| ScadaWorker (polling, backfill, health check) | `server/src/workers/scada.worker.ts` |
| Monitoring REST routes (`GET /api/monitoring/live`) | `server/src/routes/monitoring.routes.ts` |
| Monitoring service (LTTB, incremental fetch) | `server/src/services/monitoring.service.ts` |
| Monitoring context (client-side state + polling) | `client/src/context/MonitoringContext.tsx` |
| LiveMonitoringWidget | `client/src/components/widgets/LiveMonitoringWidget/` |

## Related Files

| File | Relationship |
|------|-------------|
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `GcpComponent.monitoring` configures what the ScadaWorker fetches |
| [profile/README.md](../profile/README.md) | `GroupProfile.monitoringCredentials` — SCADA API auth |
| [intraday/README.md](../intraday/README.md) | Shares `MetricDataPoint` and EntityTimeSeries pattern |
| [_ownership.md](../_ownership.md) | `TimeSeriesData` is Cockpit-owned; source data is from external SCADA |
