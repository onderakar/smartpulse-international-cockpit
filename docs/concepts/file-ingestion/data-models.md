# file-ingestion/ — Data Models

> **Part of**: [file-ingestion/](./README.md) · **Lines**: ~185 · **Last updated**: 2026-04-15

## Entities

---

### FileSource

```
┌──────────────────────────────────────────────────────────────────┐
│ FileSource                                    [DB: PostgreSQL]   │
├──────────────────────────────────────────────────────────────────┤
│ id             : Int      — Auto PK                              │
│ key            : String   — Unique domain key: "technical-parameters", │
│                             "dam-gen", etc.                      │
│ displayName    : String   — UI label: "Technical Parameters"     │
│ filename       : String   — Remote filename: "Technical_Parameters.csv" │
│ direction      : String   — "incoming" | "outgoing" (default: "incoming") │
│ fileType?      : String   — "csv" | "json" | "xml" | null (auto) │
│ intervalMinutes: Int      — Poll interval (default: 10)          │
│ enabled        : Boolean  — Whether this source is actively polled │
│ parserKey?     : String   — Domain parser: "tech-params" | "dam-gen" │
│ groupId        : String   — Tenant isolation key                 │
│ lastCheckedAt? : DateTime — Last poll attempt timestamp          │
│ lastError?     : String   — Last error message (null if healthy) │
│ createdAt      : DateTime                                        │
│ updatedAt      : DateTime                                        │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `UNIQUE(groupId, key)` — one source per key per group. The `key` is a stable identifier (do not rename existing keys — it breaks the parser registry and event routing).
- `parserKey` is optional. Sources without a `parserKey` are fetched and stored but no domain adapter reacts to them.
- `enabled = false` stops polling without deleting the source or its version history.
- `intervalMinutes` must be > 0. Minimum effective interval is 1 minute; very short intervals risk FTP overload.
- `direction = "outgoing"` is reserved for schedule file uploads. Most sources are `"incoming"`.

**Indexes:**
- `(groupId, key)` — unique
- `(groupId, enabled)` — worker filters by enabled sources for this group

---

### FileVersion

```
┌──────────────────────────────────────────────────────────────────┐
│ FileVersion                                   [DB: PostgreSQL]   │
├──────────────────────────────────────────────────────────────────┤
│ id          : Int      — Auto PK                                 │
│ sourceId    : Int      — FK → FileSource.id (cascade delete)     │
│ versionNo   : Int      — Monotonically increasing per source     │
│ rawContent  : String   — Full file text content                  │
│ contentHash : String   — SHA-256 hex digest of rawContent        │
│ sizeBytes   : Int      — Byte length of rawContent               │
│ isCurrent   : Boolean  — true = this is the latest version       │
│ fetchedAt   : DateTime — When this version was retrieved         │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `UNIQUE(sourceId, contentHash)` — the dedup constraint. If hash matches the current version, no new row is inserted.
- At most one `FileVersion` per `FileSource` has `isCurrent = true`. When a new version is inserted, the previous `isCurrent` row is updated to `false`.
- `versionNo` starts at 1 and increments by 1 for each new distinct content version (not each poll).
- `rawContent` stores the full raw text. For large files (>1MB), consider the `sizeBytes` field before loading into memory.
- `FileVersion` rows are retained indefinitely (no automatic purge). Delete manually if storage becomes a concern.

**Indexes:**
- `(sourceId, contentHash)` — unique, dedup check
- `(sourceId, isCurrent)` — O(1) current version lookup
- `(sourceId, fetchedAt DESC)` — chronological version history

---

## FileIngestionWorker Behavior

```
startup
  └── for each FileSource where enabled = true:
        └── schedule poll at intervalMinutes

on each poll tick (per source):
  ├── fetch file from FTP (direction = "incoming")
  │     └── on FTP error: update lastError, skip
  │
  ├── compute SHA-256(rawContent)
  │
  ├── compare with current FileVersion.contentHash
  │     └── if equal: skip (content unchanged)
  │
  ├── insert FileVersion
  │     ├── versionNo = max(versionNo) + 1
  │     ├── isCurrent = true
  │     └── set previous isCurrent → false
  │
  └── emit FILE_UPDATED { sourceId, sourceKey: key, groupId }
```

**Post-ingestion hook (DamGenAdapter):**
```
FILE_UPDATED { sourceKey: "dam-gen" }
  └── read FileVersion.rawContent
        └── parse DAM_GEN.csv rows
              └── for each row:
                    ├── resolve PORTFOLIO_ID → companyId via PortfolioMapping
                    └── upsert EntityTimeSeries
                          ├── seriesKey = "dam_trade_volume"
                          └── seriesKey = "generation_forecast"
```

---

## Entity Relationships

```
FileSource (config)
  ├── key ──────────────────────► parser registry (parserKey → domain adapter)
  ├── groupId ──────────────────► tenant scope
  └── versions[]: FileVersion[]
          │
          ├── isCurrent = false  (historical versions — retained)
          └── isCurrent = true   (current version — read by consumers)
                    │
                    ├── FILE_UPDATED event (emit on new version)
                    │         │
                    │         └── DamGenAdapter (parserKey = "dam-gen")
                    │                   └── writes EntityTimeSeries
                    │
                    └── useFileSource hook (client reads current rawContent)
                              └── BatteryParamsPage (parserKey = "tech-params")
```

---

## Code References

| Symbol | File |
|--------|------|
| `FileSource`, `FileVersion` (Prisma models) | `server/prisma/schema.prisma` |
| FileIngestionWorker | `server/src/workers/fileIngestion.worker.ts` |
| File routes (parser registry, `/api/files/...`) | `server/src/routes/file.routes.ts` |
| DamGenAdapter | `server/src/services/damGen.adapter.ts` |
| eventBus | `server/src/events/eventBus.ts` |
| `useFileSource` hook | `client/src/hooks/useFileSource.ts` |
| FileSourcesManager (Settings UI) | `client/src/components/settings/FileSourcesManager.tsx` |

## Related Files

| File | Relationship |
|------|-------------|
| [README.md](./README.md) | Domain overview, key concepts, worker behavior |
| [battery-params/README.md](../battery-params/README.md) | `tech-params` parser reads `FileVersion.rawContent` |
| [portfolio/data-models.md](../portfolio/data-models.md) | DamGenAdapter uses `PortfolioMapping` to resolve portfolio IDs from DAM_GEN.csv |
| [intraday/data-models.md](../intraday/data-models.md) | `EntityTimeSeries` is the write target for DamGenAdapter |
| [schedule/README.md](../schedule/README.md) | Schedule FTP files use the same `FileSource` / `FileVersion` pattern |
