# forecast/ — Data Models

> **Part of**: [forecast/](./README.md) · **Lines**: ~210 · **Last updated**: 2026-04-15

## Entities

---

### ForecastRequest

```
┌──────────────────────────────────────────────────────────────────┐
│ ForecastRequest                                                  │
├──────────────────────────────────────────────────────────────────┤
│ companyId   : number   — PortalCompany.id                        │
│ powerPlantId: number   — GcpComponent.portalPlantId              │
│ provider    : string   — Forecast provider name (e.g. "Smartpulse") │
│ startDate   : string   — "DD/MM/YYYY" (Portal date format)       │
│ endDate     : string   — "DD/MM/YYYY"                            │
│ minute      : number   — Resolution in minutes (15 | 30 | 60)   │
│ hour?       : string   — Optional hour filter                    │
│ columnId?   : number[] — Optional column subset                  │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `minute` must match `GridConnectionPoint.resolutionMinutes` (default: 15).
- `startDate` / `endDate` use `DD/MM/YYYY` format — Portal API requirement. Not ISO 8601.
- `powerPlantId` is always a component-level plant ID. GCPs have no portal plant.

---

### ForecastPredictionEntry

```
┌──────────────────────────────────────────────────────────────────┐
│ ForecastPredictionEntry                                          │
├──────────────────────────────────────────────────────────────────┤
│ PredictionDate : string         — ISO timestamp string from Portal │
│ PredictionValue: number | null  — MW value; null = missing data  │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `null` values must be handled — Portal omits data for slots without a forecast.
- `PredictionDate` is the delivery slot start in the component's local timezone.

---

### ForecastResponse

```
┌──────────────────────────────────────────────────────────────────┐
│ ForecastResponse                                                 │
├──────────────────────────────────────────────────────────────────┤
│ CompanyId    : number                — Echo of request           │
│ PowerPlantId : number                — Echo of request           │
│ Time         : string[]              — Delivery slot timestamps  │
│ Questions    : {                                                 │
│   providerPrediction         : ForecastPredictionEntry[] | null  │
│   lastPrediction             : ForecastPredictionEntry[] | null  │
│   selectedPrediction         : ForecastPredictionEntry[] | null  │
│   selectedProviderPrediction : ForecastPredictionEntry[] | null  │
│   systemRealProduction       : ForecastPredictionEntry[] | null  │
│   [key: string]              : any   — Portal may add more keys  │
│ }                                                                │
│ Providers    : { ProviderId: string; ProviderName: string }[]    │
│ isError      : boolean                                           │
│ ErrorMessage : string | null                                     │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Any `Questions` entry may be `null` if that prediction type has no data.
- `Time[]` is the shared time axis for all entries in `Questions`.
- `isError: true` signals a Portal-side failure — check `ErrorMessage` before rendering.
- `Providers[]` contains all providers available for this plant; use `forecastPreference.sourceName` to filter.

---

### ForecastSubmissionPrediction

```
┌──────────────────────────────────────────────────────────────────┐
│ ForecastSubmissionPrediction                                     │
├──────────────────────────────────────────────────────────────────┤
│ deliveryStart       : string  — ISO local time "2025-10-11T00:00:00" │
│ deliveryStartOffset : number  — UTC offset in minutes (DST-aware) │
│ deliveryEnd         : string  — ISO local time                   │
│ deliveryEndOffset   : number  — UTC offset in minutes (DST-aware) │
│ value               : number  — MW; negative = charging (BESS)   │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `deliveryStartOffset` and `deliveryEndOffset` must be computed per slot — DST transitions cause them to differ within the same day (e.g. 180 vs 120 in autumn clock change).
- `value` is in MW. Negative values are valid for BESS (charging mode).
- `deliveryStart` / `deliveryEnd` are local times without timezone suffix (no `Z`, no `+03:00`).

---

### ForecastSubmissionUnit

```
┌──────────────────────────────────────────────────────────────────┐
│ ForecastSubmissionUnit                                           │
├──────────────────────────────────────────────────────────────────┤
│ unitNo      : number                      — GcpComponent.portalPlantId │
│ predictions : ForecastSubmissionPrediction[] — All slots for day │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- One `ForecastSubmissionUnit` per BESS component being submitted.
- `predictions` must cover all slots for the target day (96 for 15-min, 48 for 30-min, 24 for 60-min).

---

### ForecastSubmissionRequest

```
┌──────────────────────────────────────────────────────────────────┐
│ ForecastSubmissionRequest                                        │
├──────────────────────────────────────────────────────────────────┤
│ measureUnit : number                  — Always 1 (Portal constant) │
│ description : string                  — User-provided label      │
│ forecasts   : ForecastSubmissionUnit[] — One entry per plant     │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `measureUnit` must always be `1`. This is a fixed Portal API requirement.
- `description` is free text displayed in the Portal's submission history.

---

### ForecastSeriesItem

```
┌──────────────────────────────────────────────────────────────────┐
│ ForecastSeriesItem  (client-side only)                           │
├──────────────────────────────────────────────────────────────────┤
│ label : string           — Display name for chart legend         │
│ data  : MetricDataPoint[] — {timestamp: ms, value: float}[]     │
│ color : string           — Hex or CSS color string               │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `data` uses `MetricDataPoint` (shared with monitoring domain) — timestamps are Unix milliseconds.
- `ForecastSeriesItem` is constructed client-side from `ForecastResponse.Questions` entries.
- Not persisted — rebuilt on each page load / date navigation.

---

## Entity Relationships

```
GcpComponent
  ├── portalPlantId ──────────────────► ForecastRequest.powerPlantId
  └── forecastPreference
        ├── sourceName ────────────────► filter ForecastResponse.Providers[]
        └── beforeMinutes ─────────────► filter prediction entries by publish time

ForecastRequest ──► Portal API ──► ForecastResponse
                                        └── Questions
                                              └── ForecastPredictionEntry[]
                                                    │
                                                    ▼ (client transform)
                                              ForecastSeriesItem[]
                                                    └── data: MetricDataPoint[]

ForecastSubmissionRequest
  └── forecasts[]: ForecastSubmissionUnit
        ├── unitNo ────────────────────► GcpComponent.portalPlantId
        └── predictions[]: ForecastSubmissionPrediction
              └── (one per slot, DST-aware offsets)
```

---

## Code References

| Symbol | File |
|--------|------|
| All forecast types | `shared/src/types/forecast.types.ts` |
| `MetricDataPoint` (used in `ForecastSeriesItem`) | `shared/src/types/monitoring.types.ts` |
| Forecast service (Portal proxy, submission logic) | `server/src/services/forecast.service.ts` |
| Forecast routes | `server/src/routes/forecast.routes.ts` |
| ForecastContext | `client/src/context/ForecastContext.tsx` |

## Related Files

| File | Relationship |
|------|-------------|
| [README.md](./README.md) | Domain overview, key concepts, code entry points |
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `GcpComponent.portalPlantId` and `forecastPreference` feed every request |
| [monitoring/data-models.md](../monitoring/data-models.md) | `MetricDataPoint` shared type |
| [_validation.md](../_validation.md) | DST offset calculation rules |
