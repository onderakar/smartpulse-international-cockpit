# forecast/ — Production Forecasts

> **Part of**: [concepts/](../_index.md) · **Lines**: ~110 · **Last updated**: 2026-04-15

## Summary

The forecast domain reads production forecasts from the SmartPulse Portal API on a per-component basis. Each `GcpComponent` in the asset topology carries a `portalPlantId` and a `forecastPreference` block that identifies which provider and time offset to use. The server proxies requests to the Portal forecast endpoint and returns typed time-series data to the client.

The domain also supports submitting forecast values back to the Portal via the Production Forecast API. Submissions are made at the `GcpComponent` level using `portalPlantId` as the target unit.

The client renders forecast series in `ForecastPage` using ECharts, driven by `ForecastContext` which manages date navigation, provider selection, and series display state.

## Owned Entities

| Entity | Description |
|--------|-------------|
| `ForecastRequest` | Parameters sent to the Portal API: company, plant, provider, date range, resolution. |
| `ForecastResponse` | Portal API response: time slots, prediction series per question type, provider list. |
| `ForecastPredictionEntry` | A single time/value pair in a prediction series: `PredictionDate`, `PredictionValue`. |
| `ForecastSubmissionRequest` | Payload to submit forecasts back to Portal: units with prediction slots. |
| `ForecastSubmissionUnit` | Per-plant submission block: `unitNo` (portalPlantId) + `predictions[]`. |
| `ForecastSubmissionPrediction` | One delivery slot: local ISO times, UTC offset, MW value. |
| `ForecastSubmissionResponse` | Submission result: `success`, optional `message` and raw `data`. |
| `ForecastSeriesItem` | Client-side chart series: `label`, `data: MetricDataPoint[]`, `color`. |

See [data-models.md](./data-models.md) for full field schemas.

## Referenced By

No other domain currently consumes forecast entities directly. ForecastPage is a standalone read/submit page.

## Depends On

| Dependency | What is used |
|------------|-------------|
| [asset-topology](../asset-topology/README.md) | `GcpComponent.portalPlantId` — target plant for Portal API calls |
| [asset-topology](../asset-topology/README.md) | `GcpComponent.forecastPreference.sourceName` — provider name filter |
| [asset-topology](../asset-topology/README.md) | `GcpComponent.forecastPreference.beforeMinutes` — how far before delivery to look |
| [monitoring](../monitoring/README.md) | `MetricDataPoint` — shared type used in `ForecastSeriesItem.data` |

## Key Concepts

| Concept | Description |
|---------|-------------|
| Per-component fetching | Each BESS component has its own `portalPlantId`. Forecast requests are made per component, not per GCP. |
| Provider preference | `forecastPreference.sourceName` selects a specific forecast provider (e.g. `"Smartpulse"`). |
| `beforeMinutes` | How many minutes before delivery the forecast was published. Filters out predictions made too close to real-time. |
| `ForecastResponse.Questions` | The Portal returns multiple prediction types: `providerPrediction`, `lastPrediction`, `selectedPrediction`, `systemRealProduction`, etc. |
| Submission UTC offset | `ForecastSubmissionPrediction.deliveryStartOffset` carries the UTC offset in minutes — not the timezone string. DST-aware: recalculated per slot. |
| `measureUnit: 1` | Always sent as `1` in submission requests. Portal-required constant. |

## When to Read Which File

| Task | File |
|------|------|
| Understand entity schemas (fields, types, constraints) | [data-models.md](./data-models.md) |
| Find which component to query | [asset-topology/data-models.md](../asset-topology/data-models.md) — `GcpComponent.forecastPreference` |
| Understand time resolution (15/30/60 min slots) | [asset-topology/README.md](../asset-topology/README.md) — `resolutionMinutes` |
| Understand DST-safe time construction | [_validation.md](../_validation.md) |

## Code References

| Symbol | File |
|--------|------|
| `ForecastRequest`, `ForecastResponse`, `ForecastPredictionEntry` | `shared/src/types/forecast.types.ts` |
| `ForecastSubmissionRequest`, `ForecastSubmissionUnit`, `ForecastSubmissionPrediction`, `ForecastSubmissionResponse` | `shared/src/types/forecast.types.ts` |
| `ForecastSeriesItem` | `shared/src/types/forecast.types.ts` |
| Forecast service (Portal proxy, submission) | `server/src/services/forecast.service.ts` |
| Forecast REST routes (`GET /api/forecast`, `POST /api/forecast/submit`) | `server/src/routes/forecast.routes.ts` |
| ForecastContext (client state, date nav, provider selection) | `client/src/context/ForecastContext.tsx` |
| Forecast API client | `client/src/api/forecast.api.ts` |
| ForecastPage (route-level page) | `client/src/pages/ForecastPage.tsx` |

## Related Files

| File | Relationship |
|------|-------------|
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `GcpComponent.portalPlantId` and `forecastPreference` are the entry point for all forecast calls |
| [monitoring/data-models.md](../monitoring/data-models.md) | `MetricDataPoint` is shared with `ForecastSeriesItem.data` |
| [portal/README.md](../portal/README.md) | Portal auth and base URL context for forecast API calls |
| [_validation.md](../_validation.md) | DST handling rules apply to `ForecastSubmissionPrediction` offset fields |
