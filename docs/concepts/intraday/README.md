# intraday/ — Intraday Market Trades

> **Part of**: [concepts/](../_index.md) · **Lines**: ~115 · **Last updated**: 2026-04-15

## Summary

The intraday domain fetches IDM (Intraday Market) transactions from the SmartPulse API and stores them as raw trade records. A background **IntradayWorker** polls every 5 minutes to keep today's data current. Trades are deduplicated by `remoteTradeId` — the same trade is never stored twice.

Raw trades are then aggregated into `idm_net_position` entries in the shared **EntityTimeSeries** table: buy trades add to the net position, sell trades subtract from it. Each delivery slot gets one `isFinal = true` row representing the current best-known net position.

The Intraday Report page presents trades in an AG Grid with full field visibility. Dashboard widgets (CompanyTrading) visualize net position as a time series.

## Owned Entities

| Entity | Description |
|--------|-------------|
| `IntradayTransaction` | Raw trade record from SmartPulse API. Deduplicated by `remoteTradeId`. Includes revision tracking. |
| `EntityTimeSeries` | Generic versioned time-series row. Intraday domain writes `idm_net_position` series. Shared with other domains. |

See [data-models.md](./data-models.md) for full field schemas.

## Referenced By

| Consumer | How it uses intraday data |
|----------|--------------------------|
| [monitoring/](../monitoring/README.md) | Shares the `EntityTimeSeries` table pattern for generic series storage |
| Dashboard widgets | CompanyTradingWidget reads `idm_net_position` via `/api/time-series/current` |

## Depends On

| Dependency | What is used |
|------------|-------------|
| [portfolio/](../portfolio/README.md) | Company list drives per-company parallel fetch in the IntradayWorker |
| [profile/](../profile/README.md) | Cached group session (portalCookies + accessToken) used for API auth |

## Key Concepts

| Concept | Description |
|---------|-------------|
| IntradayWorker | Background worker. Polls `POST /IntradayPlanning/GetTransactionReport` every 5 minutes for today's trades per company. Concurrency = 3. |
| `remoteTradeId` dedup | Upsert by `(groupId, remoteTradeId)`. If the trade exists, it is updated (revisions). Never double-counted. |
| Revision tracking | `revisionNo` tracks correction generations. `isLatestRevision = true` marks the current valid version of a trade for a given (contract, deliveryStart). |
| Net position aggregation | After upsert, a separate step calculates net position per slot: sum of buy quantities minus sum of sell quantities. Written to `EntityTimeSeries` as `idm_net_position`. |
| `isFinal` flag | `EntityTimeSeries` rows use `isFinal = true` to mark the current value for a (entity, series, deliveryStart) tuple. Older rows retain `isFinal = false`. Enables O(1) current-value queries. |
| Session dependency | The IntradayWorker reads the `groupSessionCache` (in-memory). If no user has logged in for this group, the worker cannot authenticate. The first portal login populates the cache. |
| Manual refresh | Settings panel and Intraday Report page expose a manual refresh button that calls the same worker logic on-demand. |
| `direction` encoding | `true` = buy (positive net position contribution), `false` = sell (negative). |

## When to Read Which File

| Task | File |
|------|------|
| Understand entity schemas (fields, constraints, indexes) | [data-models.md](./data-models.md) |
| Understand how EntityTimeSeries is queried | [data-models.md](./data-models.md) — EntityTimeSeries section |
| Understand company-level trade aggregation | [portfolio/README.md](../portfolio/README.md) |
| Understand auth session for workers | [profile/README.md](../profile/README.md) |
| Check series key naming conventions | [_ownership.md](../_ownership.md) |

## Code References

| Symbol | File |
|--------|------|
| `IntradayTransaction` (Prisma model) | `server/prisma/schema.prisma` |
| `EntityTimeSeries` (Prisma model) | `server/prisma/schema.prisma` |
| EntityTimeSeries REST routes (`/api/time-series/current`, `/multi`, `/history`) | `server/src/routes/entityTimeSeries.routes.ts` |
| IntradayWorker (polling, upsert, aggregation) | `server/src/workers/intraday.worker.ts` |
| Intraday routes (manual refresh, report query) | `server/src/routes/intraday.routes.ts` |
| Intraday Report page | `client/src/pages/IntradayReportPage.tsx` |
| CompanyTradingWidget (net position chart) | `client/src/components/widgets/CompanyTradingWidget/` |

## Related Files

| File | Relationship |
|------|-------------|
| [data-models.md](./data-models.md) | Full field schemas for IntradayTransaction and EntityTimeSeries |
| [portfolio/README.md](../portfolio/README.md) | Company list drives per-company fetch in IntradayWorker |
| [monitoring/README.md](../monitoring/README.md) | Shares EntityTimeSeries pattern; `MetricDataPoint` is also used for series visualization |
| [profile/README.md](../profile/README.md) | `groupSessionCache` provides auth credentials to IntradayWorker |
| [_ownership.md](../_ownership.md) | EntityTimeSeries series keys and ownership rules |
