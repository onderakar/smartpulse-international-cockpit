# portfolio/ — DAM/IDM Portfolio Mapping

> **Part of**: [concepts/](../_index.md) · **Lines**: ~115 · **Last updated**: 2026-04-15

## Summary

The portfolio domain maps external market portfolio IDs (from exchanges like IBEX) to SmartPulse companies. Users configure these mappings in the Settings UI (DamPortfolioManager). The primary consumer is the **DamGenAdapter**, which reads `DAM_GEN.csv` after file ingestion and needs to resolve each row's `PORTFOLIO_ID` column to a `companyId` in the SmartPulse system.

The domain stores two types of data: `PortfolioMapping` rows (user-configured, persisted to PostgreSQL) and read-only `PortfolioSnapshot` / `PortfolioEntry` structures fetched from the Portal API to populate the Settings UI combo-box.

Portfolio types are extensible: currently `DAM` (Day-Ahead Market), with `IDM` (Intraday Market) and `AFRR` (frequency regulation) reserved for future use.

## Owned Entities

| Entity | Description |
|--------|-------------|
| `PortfolioMapping` | User-configured mapping: external portfolio ID ↔ SmartPulse companyId. Persisted to DB. |
| `PortfolioEntry` | Read-only portal portfolio descriptor. Fetched from Portal API for Settings UI. Not persisted. |
| `PortalEntityUnit` | A portal plant/unit (unitNo, type, names). Part of PortfolioSnapshot. Not persisted. |
| `PortfolioSnapshot` | Full portal portfolio state at fetch time: entityUnits + portfolios + timestamp. Not persisted. |

See [data-models.md](./data-models.md) for full field schemas.

## Referenced By

| Consumer | How it uses portfolio data |
|----------|---------------------------|
| [intraday/](../intraday/README.md) | Company list may use portfolio associations for trade aggregation context |
| file-ingestion DamGenAdapter | Resolves `PORTFOLIO_ID` from `DAM_GEN.csv` rows to `companyId` via `PortfolioMapping` |

## Depends On

| Dependency | What is used |
|------------|-------------|
| [asset-topology/](../asset-topology/README.md) | `CompanyMapping.companyId` / `companyName` — the target side of every `PortfolioMapping` |
| [portal/](../portal/README.md) | Portal API provides `PortfolioSnapshot` (for Settings UI combo-box) |

## Key Concepts

| Concept | Description |
|---------|-------------|
| `externalId` | The portfolio identifier as it appears in external data files (e.g. `"B00214-10"` in IBEX DAM_GEN.csv). This is the lookup key in the DamGenAdapter. |
| `portfolioType` | `"DAM"` = Day-Ahead Market position. `"IDM"` and `"AFRR"` are reserved for future use. Each type has its own unique constraint — one portfolio per company per type. |
| One-to-one per type | A single company can have at most one `DAM` portfolio and one `IDM` portfolio. `UNIQUE(groupId, portfolioType, companyId)` enforces this. |
| Unique external IDs | A given `externalId` can only be assigned to one company per type. `UNIQUE(groupId, portfolioType, externalId)` prevents double-assignment. |
| Settings UI behavior | In the DamPortfolioManager, already-assigned portfolio IDs are hidden from other companies' dropdown options. This prevents accidental reassignment. |
| Combo input | The Settings portfolio selector combines CSV suggestions (from `PortfolioSnapshot.portfolios`) with free-text manual entry, for cases where the Portal API doesn't return all portfolio IDs. |
| `updatedBy` | Tracks which portal username last changed the mapping. Useful for audit. |
| DamGenAdapter lookup | When parsing DAM_GEN.csv, the adapter queries `PortfolioMapping` where `(groupId, portfolioType = "DAM", externalId = row.PORTFOLIO_ID)` to get `companyId`. Rows with unresolved portfolio IDs are skipped. |

## When to Read Which File

| Task | File |
|------|------|
| Understand entity schemas (fields, constraints, indexes) | [data-models.md](./data-models.md) |
| Understand how DAM position data flows into EntityTimeSeries | [file-ingestion/README.md](../file-ingestion/README.md) — DamGenAdapter |
| Understand company model (companyId, companyName) | [asset-topology/data-models.md](../asset-topology/data-models.md) — CompanyMapping |
| Understand portal portfolio fetch | [portal/README.md](../portal/README.md) |

## Code References

| Symbol | File |
|--------|------|
| `PortfolioMapping` (Prisma model) | `server/prisma/schema.prisma` |
| `PortfolioEntry`, `PortalEntityUnit`, `PortfolioSnapshot` | `shared/src/types/portfolio.types.ts` |
| Portfolio routes (`GET /api/portfolio/mappings`, `PUT`, `DELETE`) | `server/src/routes/portfolio.routes.ts` |
| DamPortfolioManager (Settings UI) | `client/src/components/settings/DamPortfolioManager.tsx` |
| DamGenAdapter (uses `PortfolioMapping` for resolution) | `server/src/services/damGen.adapter.ts` |

## Related Files

| File | Relationship |
|------|-------------|
| [data-models.md](./data-models.md) | Full field schemas for all portfolio entities |
| [file-ingestion/README.md](../file-ingestion/README.md) | DamGenAdapter subscribes to FILE_UPDATED and uses PortfolioMapping to parse DAM_GEN.csv |
| [intraday/README.md](../intraday/README.md) | IntradayWorker fetches by company; portfolio context may be used for reporting |
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `CompanyMapping` provides `companyId` and `companyName` stored in `PortfolioMapping` |
| [portal/README.md](../portal/README.md) | Portal API source for `PortfolioSnapshot` displayed in Settings |
| [_ownership.md](../_ownership.md) | `PortfolioMapping` is group-owned; `PortfolioSnapshot` is portal-owned read-only |
