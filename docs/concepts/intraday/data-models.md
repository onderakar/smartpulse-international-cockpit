# intraday/ — Data Models

> **Part of**: [intraday/](./README.md) · **Lines**: ~215 · **Last updated**: 2026-04-15

## Entities

---

### IntradayTransaction

```
┌──────────────────────────────────────────────────────────────────┐
│ IntradayTransaction                           [DB: PostgreSQL]   │
├──────────────────────────────────────────────────────────────────┤
│ id               : Int      — Auto PK                            │
│ groupId          : String   — Tenant isolation key               │
│ remoteTradeId    : String   — SmartPulse unique trade ID (dedup) │
│ companyId        : Int      — PortalCompany.id                   │
│ companyName      : String   — Denormalized for display           │
│ deliveryStart    : DateTime — Slot start (UTC stored)            │
│ deliveryEnd      : DateTime — Slot end (UTC stored)              │
│ direction        : Boolean  — true = buy, false = sell           │
│ quantity         : Float    — MW                                 │
│ price            : Float    — Market price                       │
│ tradeTime        : DateTime — When the trade was executed        │
│ contractId?      : String   — Optional contract identifier       │
│ contractName?    : String                                        │
│ productType?     : String                                        │
│ status           : Int      — Portal trade status code (default 0) │
│ revisionNo       : Int      — Correction generation (default 1)  │
│ isLatestRevision : Boolean  — true = valid current revision      │
│ username?        : String   — Portal user who placed the trade   │
│ explanation?     : String                                        │
│ platformCode?    : String                                        │
│ areaCode?        : String                                        │
│ orderType?       : String                                        │
│ remoteOrderId?   : String                                        │
│ mcp?             : Float    — Market Clearing Price              │
│ smp?             : Float    — System Marginal Price              │
│ smartbotId?      : Int                                           │
│ alertName?       : String                                        │
│ createdAt        : DateTime — Local insert timestamp             │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `UNIQUE(groupId, remoteTradeId)` — the primary dedup constraint. Upsert on this pair.
- `isLatestRevision` is managed by the worker: when a new revision arrives for the same `(contractId, deliveryStart)`, older rows are set `isLatestRevision = false`.
- `direction = true` (buy) contributes positively to net position. `direction = false` (sell) contributes negatively.
- `deliveryStart` / `deliveryEnd` are stored in UTC. Display must convert to the company's timezone (from `CompanyMapping.timezone` in asset-topology).
- `revisionNo` starts at 1. The Portal increments it when a trade is corrected. Always check `isLatestRevision = true` for position calculations.

**Indexes:**
- `(groupId, remoteTradeId)` — unique, dedup upsert
- `(groupId, companyId, deliveryStart)` — company + date queries (Intraday Report filter)
- `(groupId, deliveryStart)` — date range queries
- `(groupId, companyId, isLatestRevision, deliveryStart)` — position calculation (latest-only)

---

### EntityTimeSeries

```
┌──────────────────────────────────────────────────────────────────┐
│ EntityTimeSeries                              [DB: PostgreSQL]   │
├──────────────────────────────────────────────────────────────────┤
│ id            : Int      — Auto PK                               │
│ groupId       : String   — Tenant isolation key                  │
│ entityType    : String   — "COMPANY" | "GCP" | "COMPONENT" |    │
│                            "PORTFOLIO"                           │
│ entityId      : String   — companyId, gcpId, componentId, etc.  │
│ seriesKey     : String   — "idm_net_position" | "dam_trade_volume" │
│                            | "generation_forecast" | ...         │
│ deliveryStart : DateTime — Which MTU slot this value belongs to  │
│ observedAt    : DateTime — When this value was recorded          │
│ value         : Float    — Series-specific unit (MW, MWh, etc.)  │
│ source        : String   — "portal-api" | "dam-gen-csv" | "scada" │
│                            | "manual"                            │
│ isFinal       : Boolean  — true = latest known value for this    │
│                            (entity, series, deliveryStart) tuple │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `isFinal = true` marks the current best-known value per `(groupId, entityType, entityId, seriesKey, deliveryStart)`. At most one row per tuple has `isFinal = true`.
- When a new value arrives for a slot, the existing `isFinal = true` row is set to `false` and a new `isFinal = true` row is inserted — unless the value is unchanged (value-based dedup: skip write if equal).
- `entityId` is always a string. Numeric IDs (companyId, gcpId) are stored as strings.
- `deliveryStart` is UTC. Resolution is not encoded in this table — infer from the gap between consecutive slots.

**Intraday-specific series:**
- `seriesKey = "idm_net_position"`, `entityType = "COMPANY"`, `entityId = companyId.toString()`
- Value unit: MW. Positive = net long (more buys than sells). Negative = net short.
- Source: `"portal-api"`

**REST API:**
- `GET /api/time-series/current?entityType=COMPANY&entityId={id}&seriesKey=idm_net_position` — latest value per slot
- `GET /api/time-series/multi?...` — multiple series in one call
- `GET /api/time-series/history?...&deliveryStart={from}&deliveryEnd={to}` — historical range

**Indexes:**
- `(groupId, entityType, entityId, seriesKey, isFinal)` — O(1) current-value queries
- `(groupId, entityType, entityId, seriesKey, deliveryStart)` — slot history
- `(deliveryStart)` — date-range scans

---

## Net Position Aggregation Flow

```
IntradayWorker (every 5 min)
    │
    ├── POST /IntradayPlanning/GetTransactionReport
    │     (per company, concurrency = 3)
    │
    ├── upsert IntradayTransaction
    │     UNIQUE(groupId, remoteTradeId)
    │     update isLatestRevision on revision conflicts
    │
    └── aggregate idm_net_position per (company, deliverySlot)
          │
          │  net = Σ quantity[direction=buy] - Σ quantity[direction=sell]
          │       where isLatestRevision = true
          │
          └── upsert EntityTimeSeries
                seriesKey = "idm_net_position"
                entityType = "COMPANY"
                isFinal = true (sets prior row to false)
```

---

## Entity Relationships

```
PortalCompany (from asset-topology)
    │
    └── companyId ──────────────────────► IntradayTransaction.companyId
                                               │
                                    (aggregated by worker)
                                               │
                                               ▼
                                        EntityTimeSeries
                                          entityType = "COMPANY"
                                          seriesKey  = "idm_net_position"
                                          isFinal    = true
                                               │
                                               ▼
                                    CompanyTradingWidget
                                    (reads via /api/time-series/current)
```

---

## Code References

| Symbol | File |
|--------|------|
| `IntradayTransaction` (Prisma model) | `server/prisma/schema.prisma` |
| `EntityTimeSeries` (Prisma model) | `server/prisma/schema.prisma` |
| EntityTimeSeries routes | `server/src/routes/entityTimeSeries.routes.ts` |
| IntradayWorker | `server/src/workers/intraday.worker.ts` |
| Intraday routes | `server/src/routes/intraday.routes.ts` |

## Related Files

| File | Relationship |
|------|-------------|
| [README.md](./README.md) | Domain overview, worker behavior, key concepts |
| [portfolio/data-models.md](../portfolio/data-models.md) | `PortfolioMapping` links company to portfolio; company list drives worker fetch |
| [monitoring/data-models.md](../monitoring/data-models.md) | Shares `EntityTimeSeries` pattern; `MetricDataPoint` used for visualization |
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `CompanyMapping.timezone` for display conversion of UTC datetimes |
| [_ownership.md](../_ownership.md) | EntityTimeSeries series key registry and ownership |
