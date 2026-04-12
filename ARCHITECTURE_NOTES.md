# Architecture Notes — Living Document
# Max 100 lines. Update at end of each session.

## Storage
- PostgreSQL + Prisma 6 (migrated from LowDB)
- GroupProfile/UserProfile: JSONB columns for AssetMapping, polling config
- EntityTimeSeries: generic versioned time series (any entity, any series, isFinal dedup)
- IntradayTransaction: raw trade records (dedup by remoteTradeId)
- FileSource/FileVersion: generic file ingestion with SHA-256 hash-based versioning
- PortfolioMapping: DAM portfolio ID ↔ SmartPulse company (extensible to IDM/AFRR)

## Background Workers
- ScadaWorker: 15s polling, monitoring API → TimeSeriesData (SCADA metrics)
- FileIngestionWorker: per-source configurable interval, FTP → FileVersion
- IntradayWorker: **5 min polling**, fetches today's IDM transactions for all companies
- FileWatcherWorker: watches local data/ftp directory for CSV changes

## Post-Ingestion Hooks (eventBus)
- FILE_UPDATED → fileIngestionHooks → DamGenAdapter
- DamGenAdapter: DAM_GEN.csv → EntityTimeSeries (dam_trade_volume, generation_forecast per company)
- Uses PortfolioMapping to resolve PORTFOLIO_ID → companyId

## EntityTimeSeries Pattern
- Generic: entityType (COMPANY/GCP/COMPONENT) + entityId + seriesKey + deliveryStart
- isFinal flag for O(1) current-value queries, value-based dedup (skip if unchanged)
- Current series: dam_trade_volume, generation_forecast (CSV), idm_net_position (API)
- REST: /api/time-series/current, /multi, /history

## Intraday Flow
- SmartPulse API: POST /IntradayPlanning/GetTransactionReport (bearer token + cookies)
- Per-company parallel fetch (concurrency=3) to avoid timeouts
- Raw transactions stored in IntradayTransaction (upsert by remoteTradeId)
- Aggregated to idm_net_position in EntityTimeSeries (buy + / sell -)
- IntradayWorker: 5 min auto-refresh for today's data (needs cached user session)
- Manual refresh via Settings panel or Intraday Report page

## Auth & Session
- Portal login → express-session + groupSessionCache (in-memory for workers)
- groupSessionCache stores: portalCookies, accessToken, env, username
- Workers use cached session for FTP/API access (no active user needed after first login)

## Key UI Pages
- Dashboard: widget grid (LiveMonitoring, CompanyTrading)
- BatteryParams: uses useFileSource hook (DB instant + FTP background refresh)
- Intraday Report: company+date filter, 4 dashboard widgets, AG Grid with all fields
- Settings: AssetMapping, FileSourcesManager, DamPortfolioManager, IntradayRefreshPanel

## File Ingestion Pipeline
- Settings UI: add file sources (key, filename, direction, interval)
- "Refresh Consumers" button: manually triggers FILE_UPDATED for domain adapters
- Parser registry in file.routes.ts: tech-params, dam-gen

## DAM Portfolio Mapping
- Settings UI: left=company, right=portfolio ID (combo input with CSV suggestions + manual)
- Assigned portfolios hidden from other companies' dropdowns
- DB: PortfolioMapping with dual unique constraints (one portfolio per company per type)
