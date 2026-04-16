# schedule/ — Battery Schedule & BAP

> **Part of**: [concepts/](../_index.md) · **Lines**: ~105 · **Last updated**: 2026-04-15

## Summary

Schedule files are delivered via FTP as CSV. Each file represents the battery operating schedule for one GridConnectionPoint for a given delivery day. Each row in the CSV corresponds to a single 15-minute delivery slot (96 rows per day at default resolution) and carries battery parameters: active power setpoint, charge/discharge limits, SoC bounds, efficiency factors, and operational flags.

The server polls FTP on a configurable interval (default 300 seconds) and reads the schedule file. A **content hash** prevents duplicate ingestion — if the file has not changed, no new revision is created. Each delivery slot accumulates a revision history over time, so the dashboard can show how the schedule evolved.

Users can also edit the schedule directly in the BAP grid and save it back to FTP (if `scheduleBapEditable` is enabled).

## Owned Entities

| Entity | Description |
|--------|-------------|
| `ScheduleRow` | One 15-min slot from the CSV. 26 standard columns plus optional extras. |
| `ParsedSchedule` | Result of CSV parse: `header[]` (column names) + `rows[]` (ScheduleRow array). |
| `ScheduleRevisionStore` | Per-GCP per-day revision container. Key: `gcpId + dateKey`. Holds `slots` map and `lastCsvHash`. |
| `ScheduleSlotRevision` | One historical revision of a slot: `deliveryStart`, `row`, `fetchedAt`, `contentHash`, `source`. |
| `ScheduleData` | API response to client: `rows[]`, `header[]`, `lastFetchedAt`, `hasChanges`. |
| `ScheduleHistoryData` | Full revision history response: `slots` map (all versions per `deliveryStart`). |
| `ScheduleChartData` | Chart-ready projection: `batteryActivePower[]` and `maxGeneration[]` as `MetricDataPoint[]`. |
| `ScheduleFileContext` | Placeholder resolution context: `gcpId`, `assetId`, `scheduleId`, `gcpName`. |

See [data-models.md](./data-models.md) for full field schemas.

## Key Concepts

| Concept | Description |
|---------|-------------|
| FTP-based CSV ingestion | Schedule files arrive on an FTP server. The Cockpit reads (and optionally writes) them via FTP client. |
| `scheduleFilePattern` | Template on `GcpComponent`. Example: `"Battery_Schedule_{GCP_ID}.csv"`. Resolved with `resolveScheduleFilename()`. |
| Supported placeholders | `{GCP_ID}`, `{ASSET_ID}`, `{SCHEDULE_ID}`, `{GCP_NAME}`. |
| Content hash dedup | `lastCsvHash` is stored per GCP/day. If the new file hash matches, the ingestion is skipped entirely. |
| Per-slot revision history | Each `deliveryStart` key in `slots` maps to an array of `ScheduleSlotRevision`. Appended on each ingest. |
| `source` field | `'ftp'` for automated FTP reads, `'user_save'` for manual saves from the BAP grid. |
| `scheduleBapEditable` | `GroupProfile` flag. When `false`, the BAP grid is read-only and save-to-FTP is disabled. |
| Default pattern | `Battery_Schedule_{GCP_ID}.csv`. Used when `GcpComponent.scheduleFilePattern` is not set. |
| Polling interval | Default 300 seconds (`SCHEDULE_POLLING_INTERVAL_SECONDS = 30` is a base constant; actual interval comes from `GroupProfile.polling.scheduleIntervalSeconds`). |

## When to Read Which File

| Task | File |
|------|------|
| Understand entity schemas (fields, types, constraints) | [data-models.md](./data-models.md) |
| Understand FTP file ingestion pipeline | [file-ingestion/README.md](../file-ingestion/README.md) |
| Configure the schedule filename pattern for a GCP | [asset-topology/data-models.md](../asset-topology/data-models.md) — `GcpComponent.scheduleFilePattern` |
| Understand polling interval configuration | [profile/README.md](../profile/README.md) — `PollingConfig.scheduleIntervalSeconds` |

## Code References

| Symbol | File |
|--------|------|
| `ScheduleRow`, `ParsedSchedule`, `ScheduleRevisionStore`, `ScheduleSlotRevision`, `ScheduleData`, `ScheduleHistoryData`, `ScheduleChartData`, `ScheduleFileContext`, `resolveScheduleFilename()`, `getScheduleFilename()`, `getScheduleFilenameFromMapping()`, `SCHEDULE_CSV_COLUMNS`, `DEFAULT_SCHEDULE_FILE_PATTERN` | `shared/src/types/schedule.types.ts` |
| Schedule service (FTP read, parse, persist revisions) | `server/src/services/schedule.service.ts` |
| Schedule routes (`GET /api/schedule`, `POST /api/schedule/save`, `GET /api/schedule/history`) | `server/src/routes/schedule.routes.ts` |
| BAP grid page (edit and save schedule) | `client/src/pages/BatteryProgramPage.tsx` |
| Schedule chart overlay | `client/src/components/schedule/ScheduleChart.tsx` |

## Related Files

| File | Relationship |
|------|-------------|
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `GcpComponent.scheduleFilePattern` determines the FTP filename |
| [file-ingestion/README.md](../file-ingestion/README.md) | FTP polling and file pipeline |
| [profile/README.md](../profile/README.md) | `GroupProfile.polling.scheduleIntervalSeconds` and `scheduleBapEditable` |
| [_ownership.md](../_ownership.md) | `ScheduleRevisionStore` is Cockpit-owned |
