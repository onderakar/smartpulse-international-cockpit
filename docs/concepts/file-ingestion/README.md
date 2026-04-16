# file-ingestion/ — FTP File Pipeline

> **Part of**: [concepts/](../_index.md) · **Lines**: ~120 · **Last updated**: 2026-04-15

## Summary

The file-ingestion domain provides a generic, reusable pipeline for fetching files from FTP and storing versioned content in the database. A `FileSource` record defines what to fetch (filename, direction, polling interval). A `FileVersion` record stores each distinct file version, identified by SHA-256 content hash.

A background **FileIngestionWorker** polls each enabled `FileSource` on its configured interval. When new content is detected (hash differs from the last known version), a new `FileVersion` is inserted with `isCurrent = true`, and a `FILE_UPDATED` event is emitted on the application event bus.

Domain adapters subscribe to `FILE_UPDATED` and process the new content. Currently, the **DamGenAdapter** processes `dam-gen` files: it parses `DAM_GEN.csv` and writes `dam_trade_volume` and `generation_forecast` series to `EntityTimeSeries`. A parser registry in `file.routes.ts` maps `parserKey` to domain-specific parsers (currently `tech-params` and `dam-gen`).

## Owned Entities

| Entity | Description |
|--------|-------------|
| `FileSource` | Configuration: what file to fetch, how often, which parser to use. One per file type per group. |
| `FileVersion` | Versioned content: raw text, SHA-256 hash, size, fetch timestamp. One row per distinct content seen. |

See [data-models.md](./data-models.md) for full field schemas.

## Referenced By

| Consumer | How it uses file-ingestion |
|----------|---------------------------|
| [schedule/](../schedule/README.md) | Schedule CSV files are fetched via the file-ingestion pipeline |
| [battery-params/](../battery-params/README.md) | `technical-parameters.csv` is a `FileSource` with `parserKey = "tech-params"` |
| [intraday/](../intraday/README.md) | `EntityTimeSeries` is the shared write target for `DamGenAdapter` post-ingestion |

## Key Concepts

| Concept | Description |
|---------|-------------|
| SHA-256 content dedup | `FileVersion` has a `UNIQUE(sourceId, contentHash)` constraint. The same file content is never stored twice — the worker skips write if hash matches current version. |
| `isCurrent` flag | At most one `FileVersion` per `FileSource` has `isCurrent = true`. Queries for "the current file" use this flag for O(1) lookup. |
| `FILE_UPDATED` event | Emitted by the worker after a new `FileVersion` is inserted. Carries `{ sourceId, sourceKey, groupId }`. Domain adapters (e.g. DamGenAdapter) react to this event. |
| Parser registry | `parserKey` in `FileSource` selects a domain parser. Currently: `"tech-params"` (BatteryCore), `"dam-gen"` (DAM position). New parsers are registered in `file.routes.ts`. |
| DamGenAdapter | Post-ingestion hook for `dam-gen` sources. Reads `DAM_GEN.csv`, resolves PORTFOLIO_ID → companyId via `PortfolioMapping`, writes to `EntityTimeSeries`. |
| `direction` field | `"incoming"` = download from FTP to server. `"outgoing"` = upload from server to FTP. Most sources are `"incoming"`. |
| Manual "Refresh Consumers" | Settings UI button that emits `FILE_UPDATED` for all current file versions without re-fetching. Useful to force adapters to reprocess after mapping changes. |
| `fileType` auto-detect | If `fileType` is null, the worker infers type from file extension. Currently `"csv"` and `"json"` are supported. |

## When to Read Which File

| Task | File |
|------|------|
| Understand entity schemas (fields, constraints, indexes) | [data-models.md](./data-models.md) |
| Understand how parsed content reaches battery-params | [battery-params/README.md](../battery-params/README.md) |
| Understand how DAM position data reaches EntityTimeSeries | [portfolio/README.md](../portfolio/README.md) — DamGenAdapter uses PortfolioMapping |
| Understand how schedule files are fetched | [schedule/README.md](../schedule/README.md) |

## Code References

| Symbol | File |
|--------|------|
| `FileSource`, `FileVersion` (Prisma models) | `server/prisma/schema.prisma` |
| FileIngestionWorker (polling, hash check, FILE_UPDATED emit) | `server/src/workers/fileIngestion.worker.ts` |
| File routes (parser registry, manual trigger) | `server/src/routes/file.routes.ts` |
| DamGenAdapter (FILE_UPDATED handler) | `server/src/services/damGen.adapter.ts` |
| eventBus (FILE_UPDATED event definitions) | `server/src/events/eventBus.ts` |
| FileSourcesManager (Settings UI) | `client/src/components/settings/FileSourcesManager.tsx` |
| `useFileSource` hook (client-side current version fetch) | `client/src/hooks/useFileSource.ts` |

## Related Files

| File | Relationship |
|------|-------------|
| [data-models.md](./data-models.md) | Full field schemas for FileSource and FileVersion |
| [battery-params/README.md](../battery-params/README.md) | `tech-params` parser produces `BessParams` from `FileVersion.rawContent` |
| [portfolio/README.md](../portfolio/README.md) | DamGenAdapter uses `PortfolioMapping` to resolve portfolio IDs |
| [intraday/data-models.md](../intraday/data-models.md) | `EntityTimeSeries` is the write target for DamGenAdapter |
| [schedule/README.md](../schedule/README.md) | Schedule CSV files are `FileSource` rows with schedule-specific `parserKey` |
| [_ownership.md](../_ownership.md) | FileSource / FileVersion are group-owned; file content is from external FTP |
