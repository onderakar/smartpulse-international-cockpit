# asset-topology/ — Data Models

> **Part of**: [asset-topology/](./README.md) · **Lines**: ~220 · **Last updated**: 2026-04-15

## Entities

---

### AssetMapping

```
┌────────────────────────────────────────────────────────────────┐
│ AssetMapping                                                   │
├────────────────────────────────────────────────────────────────┤
│ companies    : CompanyMapping[]                                │
│ ftpDirection : 'incoming' | 'outgoing'                        │
│ ftpFilename  : string  — Technical parameters CSV filename     │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Stored at `GroupProfile.assetMapping`. There is exactly one `AssetMapping` per group.
- `ftpDirection` controls whether the FTP client reads from or writes to the FTP server.
- `ftpFilename` is the technical parameters CSV (BessParams source), not the schedule file.

---

### CompanyMapping

```
┌────────────────────────────────────────────────────────────────┐
│ CompanyMapping                                                 │
├────────────────────────────────────────────────────────────────┤
│ companyId              : number    — PortalCompany.id          │
│ companyName            : string    — Short name                │
│ fullName?              : string    — Full legal name           │
│ timezone               : string    — IANA tz (e.g. Europe/Sofia) │
│ gridConnectionPoints   : GridConnectionPoint[]                 │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `companyId` must reference a valid `PortalCompany.id` from the login payload.
- `timezone` is the company's operating timezone. Used for schedule and forecast time alignment.
- `gridConnectionPoints` may be empty during initial setup.

---

### GridConnectionPoint

```
┌────────────────────────────────────────────────────────────────┐
│ GridConnectionPoint                                            │
├────────────────────────────────────────────────────────────────┤
│ id                  : number      — Numeric GCP identifier     │
│ name                : string      — Display name               │
│ timezone            : string      — IANA tz                    │
│ resolutionMinutes?  : 15 | 30 | 60 — Time resolution override  │
│ components          : GcpComponent[]                           │
│ maxInjectionMw?     : number      — Grid injection capacity    │
│ maxConsumptionMw?   : number      — Grid consumption capacity  │
│ damPortfolioId?     : string      — DAM portfolio identifier   │
│ attributes?         : ExtensionAttributes                      │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `id` is user-entered (numeric). It does NOT correspond to any `PortalPlant.id`.
- **There is NO `portalPlantId` on `GridConnectionPoint`** — portal plants appear only on components.
- `resolutionMinutes` defaults to `GroupProfile.defaultResolutionMinutes` (15) when absent.
- `timezone` is used for all time-series operations for this GCP.
- Monitoring asset key: `GCP_{id}`.
- Schedule filename: resolved from `GcpComponent.scheduleFilePattern` using `id` as `{GCP_ID}`.

---

### GcpComponent

```
┌────────────────────────────────────────────────────────────────┐
│ GcpComponent                                                   │
├────────────────────────────────────────────────────────────────┤
│ componentId            : string      — Unique within GCP       │
│ type                   : ComponentType                         │
│ displayName            : string      — UI display name         │
│                                                                │
│ — Portal plant mapping (choose one pattern) —                  │
│ portalPlantId?         : number      — Direct 1:1 mapping      │
│ generation?            : GcpSubComponent — Gen-side plant      │
│ consumption?           : GcpSubComponent — Con-side plant      │
│                                                                │
│ forecastPreference     : {                                     │
│   sourceName   : string  — Forecast provider name             │
│   beforeMinutes: number  — Fetch offset before delivery       │
│ }                                                              │
│ scheduleId?            : string      — For {SCHEDULE_ID}       │
│ scheduleFilePattern?   : string      — FTP filename template   │
│                                                                │
│ monitoring?            : {                                     │
│   masternode : string                                          │
│   metrics    : Array<LabeledMetricMapping | BapSource>        │
│ }                                                              │
│                                                                │
│ bessParams?            : BessParams  — BESS tech params        │
│ installedCapacityMw?   : number      — Nameplate MW            │
│ installedCapacityAcMw? : number      — Solar AC MW             │
│ installedCapacityDcMwp?: number      — Solar DC MWp            │
│ attributes?            : ExtensionAttributes                   │
└────────────────────────────────────────────────────────────────┘
```

**ComponentType values:** `'BESS'` | `'SOLAR'` | `'WIND'` | `'HYDRO'` | `'THERMAL'` | `'LOAD'` | `'CONSUMPTION'` | `'OTHER'`

**Constraints:**
- Use `portalPlantId` when the component maps to exactly one portal plant (simple case).
- Use `generation` and/or `consumption` when the portal has separate plant IDs for each direction (split case). Both patterns are valid and can coexist in the same mapping.
- `forecastPreference` is required — must name a valid forecast source provider.
- `scheduleFilePattern` supports placeholders: `{GCP_ID}`, `{ASSET_ID}`, `{SCHEDULE_ID}`, `{GCP_NAME}`.
- `monitoring.masternode` is the monitoring API node identifier for this component.

---

### GcpSubComponent

```
┌────────────────────────────────────────────────────────────────┐
│ GcpSubComponent                                                │
├────────────────────────────────────────────────────────────────┤
│ portalPlantId    : number    — PortalPlant.id                  │
│ installedPowerMw?: number    — From portal InstalledPowerMW    │
│ portalPlantName? : string    — For display/audit               │
│ attributes?      : ExtensionAttributes                         │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Used only inside `GcpComponent.generation` or `GcpComponent.consumption`.
- `portalPlantId` must reference a valid `PortalPlant.id`.

---

### LabeledMetricMapping

```
┌────────────────────────────────────────────────────────────────┐
│ LabeledMetricMapping                                           │
├────────────────────────────────────────────────────────────────┤
│ tag          : MetricTag   — 'SoC' | 'ActivePower'             │
│                             | 'Power' | 'Other'               │
│ customLabel? : string      — Override display label            │
│ node         : string      — Monitoring API node identifier    │
│ nodeidentity : number      — Monitoring node identity          │
└────────────────────────────────────────────────────────────────┘
```

---

### BapSource

```
┌────────────────────────────────────────────────────────────────┐
│ BapSource                                                      │
├────────────────────────────────────────────────────────────────┤
│ tag    : 'ActivePower'              (always)                   │
│ source : 'response.data.bap'        (always)                   │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Used in `GcpComponent.monitoring.metrics[]` as an alternative to `LabeledMetricMapping`.
- Signals that the BAP value comes from the API response body directly, not from a metric node.

---

## Entity Relationships

```
AssetMapping
    └── companies: CompanyMapping[] (N)
            │  companyId ──────────────────────────► PortalCompany.id (portal domain)
            │
            └── gridConnectionPoints: GridConnectionPoint[] (N)
                    │  id ─── used as {GCP_ID} in scheduleFilePattern
                    │  id ─── used as GCP_{id} in monitoring asset key
                    │
                    └── components: GcpComponent[] (N)
                            │
                            ├── portalPlantId ──────────────────► PortalPlant.id (portal domain)
                            ├── generation.portalPlantId ────────► PortalPlant.id
                            └── consumption.portalPlantId ───────► PortalPlant.id

Helper functions (exported from assetMapping.types.ts):
    getFirstGcp(mapping)   → GridConnectionPoint | null
    getAllGcps(mapping)     → GridConnectionPoint[]
    getBessGcps(mapping)   → BessGcpInfo[]
```

---

## Code References

| Symbol | File |
|--------|------|
| All entities above, helper functions, `migrateAssetMapping()` | `shared/src/types/assetMapping.types.ts` |
| Settings form (user builds the topology) | `client/src/components/settings/AssetMappingForm.tsx` |
| Auto-mapping service | `server/src/services/autoMapping.service.ts` |
| Config store (persists to db.json) | `server/src/services/configStore.service.ts` |

## Related Files

| File | Relationship |
|------|-------------|
| [README.md](./README.md) | Domain overview and key concepts |
| [portal/data-models.md](../portal/data-models.md) | `PortalPlant.id` and `PortalCompany.id` are referenced here |
| [profile/data-models.md](../profile/data-models.md) | `GroupProfile.assetMapping` stores the root entity |
| [monitoring/README.md](../monitoring/README.md) | `GcpComponent.monitoring` config consumed by ScadaWorker |
| [schedule/README.md](../schedule/README.md) | `GcpComponent.scheduleFilePattern` consumed by schedule service |
| [forecast/README.md](../forecast/README.md) | `GcpComponent.portalPlantId` + `forecastPreference` consumed by forecast |
| [battery-params/data-models.md](../battery-params/data-models.md) | `BessParams` schema lives in battery-params |
| [_ownership.md](../_ownership.md) | Asset topology is Cockpit-owned |
