# schedule/ — Data Models

> **Part of**: [schedule/](./README.md) · **Lines**: ~230 · **Last updated**: 2026-04-15

## Entities

---

### ScheduleRow

```
┌────────────────────────────────────────────────────────────────┐
│ ScheduleRow   (one 15-min delivery slot)                       │
├────────────────────────────────────────────────────────────────┤
│ Delivery_Start                 : string  — ISO datetime        │
│ Delivery_End                   : string  — ISO datetime        │
│ Asset_Id                       : string | number               │
│ Battery_Active_Power_MW        : number                        │
│ Max_Charge_MW                  : number                        │
│ Max_Discharge_MW               : number                        │
│ Max_Generation_MW              : number                        │
│ Min_Generation_MW              : number                        │
│ Usable_Stored_Energy_MWh       : number                        │
│ Total_Capacity_MWh             : number                        │
│ Min_SOC_Percentage             : number                        │
│ Max_SOC_Percentage             : number                        │
│ Charge_Efficiency              : number                        │
│ Discharge_Efficiency           : number                        │
│ Idle_Depletion_Rate_Per_Hour   : number                        │
│ Min_Duration_Charge_Hours      : number                        │
│ Min_Duration_Discharge_Hours   : number                        │
│ Initial_Stored_Energy_MWh      : number                        │
│ Schedule_ID                    : string                        │
│ Round_Trip_Efficiency          : number                        │
│ Max_Ramp_Up_Rate_MW_per_min    : number                        │
│ Max_Ramp_Down_Rate_MW_per_min  : number                        │
│ Availability_Flag              : number  — 0 or 1              │
│ Cycle_Limit_Daily              : number                        │
│ Current_Cycle_Count            : number                        │
│ Operation_Mode                 : string                        │
│ [extraColumn: string]          : string | number  — extras     │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `Delivery_Start` and `Delivery_End` are ISO 8601 strings. Their difference equals `GCP.resolutionMinutes`.
- `Delivery_Start` is used as the revision key in `ScheduleRevisionStore.slots`.
- Extra columns beyond the 26 standard are preserved in the index signature — they pass through unchanged.
- `Asset_Id` may be a string or number depending on how the optimizer writes the CSV.
- Efficiency fields (`Charge_Efficiency`, `Discharge_Efficiency`, `Round_Trip_Efficiency`) are fractional (0–1), not percentage.

---

### ParsedSchedule

```
┌────────────────────────────────────────────────────────────────┐
│ ParsedSchedule                                                 │
├────────────────────────────────────────────────────────────────┤
│ header : string[]      — Column names from CSV header row      │
│ rows   : ScheduleRow[] — One entry per delivery slot           │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `header` preserves the original column order from the CSV (including extra columns).
- `rows` length equals the number of delivery slots in the day (typically 96 for 15-min resolution).

---

### ScheduleRevisionStore

```
┌────────────────────────────────────────────────────────────────┐
│ ScheduleRevisionStore   (per GCP per day)                      │
├────────────────────────────────────────────────────────────────┤
│ gcpId        : number   — GridConnectionPoint.id               │
│ dateKey      : string   — "YYYY-MM-DD"                         │
│ slots        : Record<Delivery_Start, ScheduleSlotRevision[]>  │
│ lastFetchedAt: number   — Unix ms of last successful FTP read  │
│ lastCsvHash  : string   — MD5/SHA hash of last CSV content     │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Primary key: `(gcpId, dateKey)`. One store entry per GCP per calendar day.
- `lastCsvHash` is compared on each FTP poll. If unchanged, the ingestion is skipped entirely.
- `slots` keys are `Delivery_Start` ISO strings from `ScheduleRow`.
- Each slot value is an array of revisions — appended on every ingest that changes that slot.
- Stored in `db.json` under the group's schedule store.

> **Note:** `ScheduleRevisionStore` is an in-memory/application-level structure. Individual slot revisions are persisted to PostgreSQL as the `ScheduleRevision` Prisma model.

---

### ScheduleSlotRevision

```
┌────────────────────────────────────────────────────────────────┐
│ ScheduleSlotRevision                                           │
├────────────────────────────────────────────────────────────────┤
│ deliveryStart : string         — ISO datetime (slot key)       │
│ row           : ScheduleRow    — Full row data at this revision│
│ fetchedAt     : number         — Unix ms when recorded         │
│ contentHash   : string         — Hash of this row's content    │
│ source?       : 'ftp'                                          │
│               | 'user_save'    — Origin of this revision       │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `contentHash` is per-slot (not per-file). If only some slots change, only those slots get new revisions.
- `source` defaults to `'ftp'` when absent.
- Revisions are append-only — never deleted or modified.

---

### ScheduleData

```
┌────────────────────────────────────────────────────────────────┐
│ ScheduleData   (API response to client)                        │
├────────────────────────────────────────────────────────────────┤
│ rows          : ScheduleRow[]  — Current slot data             │
│ header        : string[]       — Column order                  │
│ lastFetchedAt : number         — Unix ms of last FTP fetch     │
│ hasChanges    : boolean        — True if file changed since    │
│                                  last fetch                    │
└────────────────────────────────────────────────────────────────┘
```

---

### ScheduleHistoryData

```
┌────────────────────────────────────────────────────────────────┐
│ ScheduleHistoryData   (API response for revision history)      │
├────────────────────────────────────────────────────────────────┤
│ slots         : Record<Delivery_Start, ScheduleSlotRevision[]> │
│ lastFetchedAt : number                                         │
└────────────────────────────────────────────────────────────────┘
```

---

### ScheduleChartData

```
┌────────────────────────────────────────────────────────────────┐
│ ScheduleChartData   (dashboard chart overlay)                  │
├────────────────────────────────────────────────────────────────┤
│ batteryActivePower : MetricDataPoint[]  — BAP MW per slot      │
│ maxGeneration      : MetricDataPoint[]  — Max gen MW per slot  │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Projection of `ScheduleRow` fields into chart-ready `MetricDataPoint` pairs.
- `MetricDataPoint.timestamp` is derived from `Delivery_Start` parsed to Unix ms.

---

### ScheduleFileContext

```
┌────────────────────────────────────────────────────────────────┐
│ ScheduleFileContext   (placeholder resolution)                 │
├────────────────────────────────────────────────────────────────┤
│ gcpId      : number   — GridConnectionPoint.id → {GCP_ID}      │
│ assetId?   : number   — GcpComponent.portalPlantId → {ASSET_ID}│
│ scheduleId?: string   — GcpComponent.scheduleId → {SCHEDULE_ID}│
│ gcpName?   : string   — GridConnectionPoint.name → {GCP_NAME}  │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Passed to `resolveScheduleFilename(pattern, ctx)` to build the actual FTP filename.
- `{ASSET_ID}` falls back to `gcpId` if `assetId` is absent.
- `{SCHEDULE_ID}` falls back to `gcpId` if `scheduleId` is absent.

---

## Entity Relationships

```
GcpComponent.scheduleFilePattern
    │
    └── resolveScheduleFilename(pattern, ScheduleFileContext)
            │
            └── FTP filename (e.g. "Battery_Schedule_42.csv")

FTP CSV read
    │
    └── ParsedSchedule { header[], rows: ScheduleRow[] }
            │
            └── content hash compared to ScheduleRevisionStore.lastCsvHash
                    │
                    ├── SAME → skip (no new revision)
                    └── DIFFERENT → per-slot content hash check
                                        │
                                        └── append ScheduleSlotRevision to
                                            ScheduleRevisionStore.slots[deliveryStart]

Client reads:
    GET /api/schedule?gcpId={id}&date={YYYY-MM-DD}     → ScheduleData
    GET /api/schedule/history?gcpId={id}&date={date}   → ScheduleHistoryData

Chart projection:
    ScheduleRow[] ──projection──► ScheduleChartData
```

---

## Code References

| Symbol | File |
|--------|------|
| `ScheduleRow`, `ParsedSchedule`, `ScheduleRevisionStore`, `ScheduleSlotRevision`, `ScheduleData`, `ScheduleHistoryData`, `ScheduleChartData`, `ScheduleFileContext`, `SCHEDULE_CSV_COLUMNS`, `DEFAULT_SCHEDULE_FILE_PATTERN`, `resolveScheduleFilename()`, `getScheduleFilename()`, `getScheduleFilenameFromMapping()` | `shared/src/types/schedule.types.ts` |
| Schedule service (FTP read, parse, revision store) | `server/src/services/schedule.service.ts` |
| Schedule routes | `server/src/routes/schedule.routes.ts` |
| BAP grid page | `client/src/pages/BatteryProgramPage.tsx` |
| Schedule chart | `client/src/components/schedule/ScheduleChart.tsx` |

## Related Files

| File | Relationship |
|------|-------------|
| [README.md](./README.md) | Domain overview and ingestion flow |
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `GcpComponent.scheduleFilePattern` drives filename resolution |
| [monitoring/data-models.md](../monitoring/data-models.md) | `MetricDataPoint` (shared type used in `ScheduleChartData`) |
| [file-ingestion/data-models.md](../file-ingestion/data-models.md) | FTP pipeline entities |
| [profile/data-models.md](../profile/data-models.md) | `PollingConfig.scheduleIntervalSeconds`, `scheduleBapEditable` |
| [_ownership.md](../_ownership.md) | `ScheduleRevisionStore` is Cockpit-owned |
