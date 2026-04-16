# battery-params/ — BESS Technical Parameters

> **Part of**: [concepts/](../_index.md) · **Lines**: ~115 · **Last updated**: 2026-04-15

## Summary

The battery-params domain manages technical parameters for BESS (Battery Energy Storage System) components. Parameters are stored in a `technical-parameters.csv` file on the FTP server and ingested via the [file-ingestion](../file-ingestion/README.md) pipeline. The `tech-params` parser converts the CSV into typed `BatteryCore` objects.

For multi-unit setups, the CSV has one column per portal plant ID, yielding a `MultiBatteryTechParams` map. For single-unit setups, there is one column and a single `BatteryCore` is extracted as a `TechnicalParameters` object.

The `BatteryParamsPage` client page reads the current `FileVersion.rawContent` via the `useFileSource` hook, parses it client-side, and provides an editable table. Edits are serialized back to CSV and uploaded via the file-ingestion outgoing path or directly to FTP.

`BessParams` is the subset of `BatteryCore` attached to `GcpComponent` in the asset-topology, making capacity and power limits available to monitoring (for SoC MWh calculation) and scheduling logic.

## Owned Entities

| Entity | Description |
|--------|-------------|
| `BatteryCore` | Core technical parameters for one BESS unit: capacity, charge/discharge power, efficiency, SoC bounds. |
| `TechnicalParameters` | Single-unit parsed result: a `BatteryCore` plus raw key-value map for round-trip CSV serialization. |
| `MultiBatteryTechParams` | Multi-unit parsed result: a map of `plantId → BatteryCore`, raw key-values per plant, ordered plant IDs and variable names. |
| `BessParams` | Alias/subset of `BatteryCore` fields attached to `GcpComponent` in asset-topology. |

See [data-models.md](./data-models.md) for full field schemas.

## Referenced By

| Consumer | How it uses battery-params |
|----------|---------------------------|
| [asset-topology/](../asset-topology/README.md) | `GcpComponent.bessParams` carries `BessParams` (subset of `BatteryCore`) for monitoring SoC MWh calculation |
| Dashboard widgets | LiveMonitoringWidget uses `GcpComponent.bessParams.capacityMwh` to convert SoC% to MWh |

## Depends On

| Dependency | What is used |
|------------|-------------|
| [file-ingestion/](../file-ingestion/README.md) | `technical-parameters.csv` is a `FileSource` with `parserKey = "tech-params"`. `FileVersion.rawContent` is the source of truth. |
| [asset-topology/](../asset-topology/README.md) | `GcpComponent.portalPlantId` is used as the column key in multi-unit CSV files |

## Key Concepts

| Concept | Description |
|---------|-------------|
| CSV key mapping | The CSV uses verbose snake_case keys (e.g. `Battery_Capacity_MWh`). `TECH_PARAM_KEY_MAP` maps these to camelCase `BatteryCore` fields. `BATTERY_CORE_TO_CSV_KEY` is the reverse for serialization. |
| Multi-column CSV | When multiple BESS units exist, the CSV has one column per portal plant ID. Each column is parsed independently into a `BatteryCore`. |
| `variableOrder` | `MultiBatteryTechParams.variableOrder` preserves the row order from the original CSV. Required for round-trip serialization without reordering rows. |
| `rawByPlant` | Stores all raw key-value pairs per plant, including non-`BatteryCore` variables. Enables round-trip write without losing unknown CSV rows. |
| `useFileSource` hook | Client hook that fetches the current `FileVersion` from the server, with background FTP refresh on page mount. Provides instant DB response while FTP is checked in background. |
| Efficiency as ratio | `chargeEfficiency` and `dischargeEfficiency` are stored as ratios (0–1), not percentages. The CSV key name includes `_Percentage` but the parsed value is already divided by 100. |
| SoC bounds as ratio | `minSocPct` and `maxSocPct` are also stored as ratios (0–1). The CSV key names include `_Percentage`. |

## When to Read Which File

| Task | File |
|------|------|
| Understand entity schemas (fields, types, constraints) | [data-models.md](./data-models.md) |
| Understand how the CSV file is fetched | [file-ingestion/README.md](../file-ingestion/README.md) — `tech-params` FileSource |
| Understand where BessParams lives on a component | [asset-topology/data-models.md](../asset-topology/data-models.md) — `GcpComponent.bessParams` |
| Understand SoC MWh calculation | [monitoring/README.md](../monitoring/README.md) — LiveSnapshot |

## Code References

| Symbol | File |
|--------|------|
| `BatteryCore`, `TechnicalParameters`, `MultiBatteryTechParams` | `shared/src/types/techParams.types.ts` |
| `TECH_PARAM_KEY_MAP`, `BATTERY_CORE_TO_CSV_KEY` | `shared/src/types/techParams.types.ts` |
| BatteryParamsPage (edit table, FTP upload) | `client/src/pages/BatteryParamsPage.tsx` |
| `useFileSource` hook | `client/src/hooks/useFileSource.ts` |
| `tech-params` parser (CSV → BatteryCore) | `server/src/routes/file.routes.ts` (parser registry) |
| `GcpComponent.bessParams` type usage | `shared/src/types/assetMapping.types.ts` |

## Related Files

| File | Relationship |
|------|-------------|
| [data-models.md](./data-models.md) | Full field schemas for all battery-params entities |
| [file-ingestion/README.md](../file-ingestion/README.md) | `FileSource` + `FileVersion` pipeline that delivers the CSV content |
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `GcpComponent.bessParams` — where BessParams is attached to the topology |
| [monitoring/data-models.md](../monitoring/data-models.md) | `LiveSnapshot.socMwh` uses `bessParams.capacityMwh` for MWh conversion |
| [_ownership.md](../_ownership.md) | `BatteryCore` values are group-owned config; CSV source is external FTP |
