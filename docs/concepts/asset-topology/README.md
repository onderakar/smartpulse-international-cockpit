# asset-topology/ — GCP & Component Topology

> **Part of**: [concepts/](../_index.md) · **Lines**: ~130 · **Last updated**: 2026-04-15

## Summary

Asset Topology is the user-configured physical mapping that connects portal plants to real-world grid connection points. It is the **most critical data structure** in the Cockpit — forecast, schedule, monitoring, FTP, and battery params all depend on it.

The root entity is **AssetMapping**, stored inside `GroupProfile.assetMapping` in `db.json`. It is shared by all users in the group.

The hierarchy is: `AssetMapping → CompanyMapping → GridConnectionPoint → GcpComponent`.

**GridConnectionPoints (GCPs)** are user-created objects. Unlike the Turkey cockpit, there is NO portal plant at the GCP level. Portal plants appear only at the **component** level inside a GCP.

## Owned Entities

| Entity | Description |
|--------|-------------|
| `AssetMapping` | Root of the topology. Holds `companies[]`, `ftpDirection`, `ftpFilename`. |
| `CompanyMapping` | A company entry inside the mapping. References a `PortalCompany` by `companyId`. |
| `GridConnectionPoint` | A physical grid connection point. User-created. Has `id`, `name`, `timezone`, `resolutionMinutes`, `components[]`. |
| `GcpComponent` | A generation/storage unit under a GCP. Maps to a portal plant via `portalPlantId` (or `generation`/`consumption` sub-components for split plants). |
| `GcpSubComponent` | Directional half of a split component (gen-side or con-side). Has its own `portalPlantId`. |
| `BessGcpInfo` | Flat projection used by helpers: `gcpId`, `gcpName`, `timezone`, `bessComponent`. |

See [data-models.md](./data-models.md) for full field schemas.

## Referenced By

| Consumer | What it uses |
|----------|-------------|
| [monitoring/](../monitoring/README.md) | `GcpComponent.monitoring` — masternode and metrics config |
| [schedule/](../schedule/README.md) | `GcpComponent.scheduleFilePattern` — FTP filename template |
| [forecast/](../forecast/README.md) | `GcpComponent.portalPlantId` + `forecastPreference` — which forecast to fetch |
| [battery-params/](../battery-params/README.md) | `GcpComponent.bessParams` — technical parameters |
| [portfolio/](../portfolio/README.md) | `CompanyMapping.companyId` — links company to portfolio |
| [profile/](../profile/README.md) | `GroupProfile.assetMapping` — stores the entire topology |

## Key Concepts

| Concept | Description |
|---------|-------------|
| GCP has NO portalPlantId | `GridConnectionPoint` is purely user-configured. Only `GcpComponent` maps to a portal plant. |
| `resolutionMinutes` | Time resolution per GCP. Default `15` (quarter-hourly). Supports `30` and `60`. If absent, falls back to `GroupProfile.defaultResolutionMinutes`. |
| `ComponentType` enum | `BESS`, `SOLAR`, `WIND`, `HYDRO`, `THERMAL`, `LOAD`, `CONSUMPTION`, `OTHER`. |
| Split component pattern | When a portal plant has separate gen and con plant IDs, use `generation: GcpSubComponent` and `consumption: GcpSubComponent` instead of `portalPlantId`. |
| Direct mapping pattern | When a component maps to exactly one portal plant, use `portalPlantId` directly on `GcpComponent`. Both patterns are valid and coexist. |
| `scheduleFilePattern` | Template on `GcpComponent`. Supported placeholders: `{GCP_ID}`, `{ASSET_ID}`, `{SCHEDULE_ID}`, `{GCP_NAME}`. |
| Helper functions | `getFirstGcp()`, `getAllGcps()`, `getBessGcps()` — exported from `assetMapping.types.ts`. |
| Auto-mapping | `POST /api/config/auto-map` reads the portal plant list + a CSV and builds the topology automatically. Manual override always possible. |
| `migrateAssetMapping()` | Converts old `uevcbs`-based format to `gridConnectionPoints`. Runs transparently on load. |

## When to Read Which File

| Task | File |
|------|------|
| Understand entity schemas (fields, types, constraints) | [data-models.md](./data-models.md) |
| Understand how portal plants are sourced | [portal/README.md](../portal/README.md) |
| Understand how the topology is stored | [profile/README.md](../profile/README.md) |
| Understand schedule FTP file resolution | [schedule/README.md](../schedule/README.md) |
| Understand forecast queries per component | [forecast/README.md](../forecast/README.md) |
| Understand monitoring config per component | [monitoring/README.md](../monitoring/README.md) |

## Code References

| Symbol | File |
|--------|------|
| `AssetMapping`, `CompanyMapping`, `GridConnectionPoint`, `GcpComponent`, `GcpSubComponent`, `ComponentType`, `BessGcpInfo`, `getFirstGcp()`, `getAllGcps()`, `getBessGcps()`, `migrateAssetMapping()` | `shared/src/types/assetMapping.types.ts` |
| Settings UI form for building the topology | `client/src/components/settings/AssetMappingForm.tsx` |
| Auto-mapping service | `server/src/services/autoMapping.service.ts` |
| Config store (persists to db.json) | `server/src/services/configStore.service.ts` |

## Related Files

| File | Relationship |
|------|-------------|
| [portal/README.md](../portal/README.md) | `PortalPlant.id` is the source of `GcpComponent.portalPlantId` |
| [profile/README.md](../profile/README.md) | `GroupProfile.assetMapping` stores this entire structure |
| [monitoring/README.md](../monitoring/README.md) | Uses `GcpComponent.monitoring` config |
| [schedule/README.md](../schedule/README.md) | Uses `GcpComponent.scheduleFilePattern` |
| [forecast/README.md](../forecast/README.md) | Uses `GcpComponent.portalPlantId` + `forecastPreference` |
| [battery-params/README.md](../battery-params/README.md) | Uses `GcpComponent.bessParams` |
| [_ownership.md](../_ownership.md) | Asset topology is Cockpit-owned; portal plants are Portal-owned |
| [_validation.md](../_validation.md) | GCP rules: no portalPlantId, resolutionMinutes constraints |
