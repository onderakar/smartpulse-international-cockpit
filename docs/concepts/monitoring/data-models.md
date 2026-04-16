# monitoring/ — Data Models

> **Part of**: [monitoring/](./README.md) · **Lines**: ~185 · **Last updated**: 2026-04-15

## Entities

---

### RawMetricPoint

```
┌────────────────────────────────────────────────────────────────┐
│ RawMetricPoint                                                 │
├────────────────────────────────────────────────────────────────┤
│ timestamp : number   — Unix milliseconds                       │
│ type      : string   — Metric type tag (e.g. 'SOC', 'BAP',    │
│                        'POWER_5001')                           │
│ value     : number   — Float value                             │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Returned from monitoring API and stored in-memory by the ScadaWorker.
- `type` is the raw string from the monitoring API. Common values: `SOC`, `BAP`, `POWER_{portalPlantId}`.
- `timestamp` is milliseconds since epoch (Unix ms), not seconds.
- Points are stored per GCP, keyed by `GCP_{gcpId}`.

---

### MetricDataPoint

```
┌────────────────────────────────────────────────────────────────┐
│ MetricDataPoint                                                │
├────────────────────────────────────────────────────────────────┤
│ timestamp : number   — Unix milliseconds                       │
│ value     : number   — Float value                             │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Chart-ready form used in `LiveMonitoringData`, `ScheduleChartData`, and the intraday domain.
- After LTTB downsampling, each metric type is reduced to ~500 points.
- Shared type used across monitoring, schedule, and intraday domains.

---

### PowerComponent

```
┌────────────────────────────────────────────────────────────────┐
│ PowerComponent                                                 │
├────────────────────────────────────────────────────────────────┤
│ componentId  : string           — Matches GcpComponent.componentId │
│ displayName  : string           — UI label                     │
│ type         : string           — ComponentType value          │
│ data         : MetricDataPoint[] — LTTB-downsampled time series │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- One `PowerComponent` per `GcpComponent` that has monitoring configured.
- `data` is already downsampled — do not apply LTTB again on the client.
- `type` matches `GcpComponent.type` (e.g. `'BESS'`, `'SOLAR'`).

---

### LiveMonitoringData

```
┌────────────────────────────────────────────────────────────────┐
│ LiveMonitoringData                                             │
├────────────────────────────────────────────────────────────────┤
│ powerComponents    : PowerComponent[]  — Per-component power   │
│ batterySoc         : MetricDataPoint[] — SOC % time series     │
│ batteryActivePower : MetricDataPoint[] — BAP MW time series    │
│ netPower?          : MetricDataPoint[] — Net grid power series │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Returned by `GET /api/monitoring/live?gcpId={id}&since={ms}`.
- `since` parameter enables incremental fetch. Omit for full window (first load).
- `batterySoc` and `batteryActivePower` are GCP-level aggregates (sum of all BESS components).
- `netPower` is optional — present only when the GCP has a net power metric configured.
- All series use the same time axis. Points are not guaranteed to be aligned across series.

---

### LiveSnapshot

```
┌────────────────────────────────────────────────────────────────┐
│ LiveSnapshot                                                   │
├────────────────────────────────────────────────────────────────┤
│ socPercent : number | null   — Latest SoC (%)                  │
│ socMwh     : number | null   — Latest SoC (MWh)                │
│ bapMW      : number | null   — Latest battery active power (MW)│
│ timestamp  : number | null   — Unix ms of latest data point    │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `null` values indicate no data is available (worker not yet fetched, or monitoring offline).
- `socMwh` is derived: `socPercent / 100 * GcpComponent.bessParams.capacityMwh`.
- `timestamp` is the timestamp of the most recent point across all metrics.
- Used for the summary cards (header row) in the LiveMonitoringWidget.

---

## ScadaWorker Behavior

The ScadaWorker is a background process that runs in-process on the Express server:

```
startup
  └── fetch last 1h for each GCP (initial window)

every 30s
  └── for each GCP with monitoring config:
        └── fetch points since last known timestamp
              └── store in-memory buffer (keyed GCP_{gcpId})

every 10min (health check)
  └── scan last 26h for each GCP
        └── if gap detected: backfill missing interval
```

**Memory model:** Points accumulate in a circular buffer per GCP. The server retains ~26 hours of data in memory. On server restart, the 1-hour lookback is re-fetched.

---

## Entity Relationships

```
GcpComponent.monitoring
    │  masternode ─────────────────────────────► Monitoring API node
    │  metrics[]: LabeledMetricMapping | BapSource
    │
    ▼
ScadaWorker (polls every 30s)
    │
    ├── raw points → RawMetricPoint[]
    │                    │
    │                    └── grouped by GCP_{gcpId}
    │
    └── on client request:
            │
            ├── LTTB(500pts) per metric type
            │
            └── LiveMonitoringData
                    ├── powerComponents[]: PowerComponent[]
                    ├── batterySoc:        MetricDataPoint[]
                    ├── batteryActivePower: MetricDataPoint[]
                    └── netPower?:         MetricDataPoint[]

LiveSnapshot ────── latest scalar from LiveMonitoringData
```

---

## Code References

| Symbol | File |
|--------|------|
| `MetricDataPoint`, `PowerComponent`, `LiveMonitoringData`, `LiveSnapshot`, `RawMetricPoint` | `shared/src/types/monitoring.types.ts` |
| `LabeledMetricMapping`, `BapSource`, `MetricTag` | `shared/src/types/assetMapping.types.ts` |
| ScadaWorker | `server/src/workers/scada.worker.ts` |
| Monitoring service (LTTB, incremental fetch logic) | `server/src/services/monitoring.service.ts` |
| Monitoring routes | `server/src/routes/monitoring.routes.ts` |
| MonitoringContext (client-side state) | `client/src/context/MonitoringContext.tsx` |
| LiveMonitoringWidget (dashboard widget) | `client/src/components/widgets/LiveMonitoringWidget/` |

## Related Files

| File | Relationship |
|------|-------------|
| [README.md](./README.md) | Domain overview and worker behavior |
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `GcpComponent.monitoring` is the source config for ScadaWorker |
| [profile/data-models.md](../profile/data-models.md) | `GroupProfile.monitoringCredentials` used by ScadaWorker |
| [intraday/data-models.md](../intraday/data-models.md) | `MetricDataPoint` and EntityTimeSeries shared pattern |
| [schedule/data-models.md](../schedule/data-models.md) | `ScheduleChartData` uses `MetricDataPoint` |
| [_ownership.md](../_ownership.md) | In-memory time series is Cockpit-owned; source is external SCADA |
