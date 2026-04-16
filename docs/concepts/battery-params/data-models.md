# battery-params/ — Data Models

> **Part of**: [battery-params/](./README.md) · **Lines**: ~200 · **Last updated**: 2026-04-15

## Entities

---

### BatteryCore

```
┌──────────────────────────────────────────────────────────────────┐
│ BatteryCore                         [TypeScript interface]       │
├──────────────────────────────────────────────────────────────────┤
│ batteryCapacityMwh    : number  — Usable energy capacity (MWh)   │
│ maxDischargePowerMw   : number  — Maximum discharge power (MW)   │
│ maxChargePowerMw      : number  — Maximum charge power (MW)      │
│ chargeEfficiency      : number  — Charge efficiency ratio (0–1)  │
│ dischargeEfficiency   : number  — Discharge efficiency ratio (0–1) │
│ minSocPct             : number  — Minimum SoC ratio (0–1)        │
│ maxSocPct             : number  — Maximum SoC ratio (0–1)        │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- All fields are required. No optional fields — a `BatteryCore` with missing values is invalid.
- `chargeEfficiency` and `dischargeEfficiency` are ratios: `0.95` means 95% efficient. Despite the CSV key suffix `_Percentage`, the parsed value is already divided by 100.
- `minSocPct` and `maxSocPct` are also ratios: `0.1` = 10% minimum SoC, `0.9` = 90% maximum. Same CSV key suffix caveat applies.
- `maxChargePowerMw` is typically a positive number. During charging, actual power flow is negative (convention), but the parameter itself is stored as positive.
- `batteryCapacityMwh` is usable (net) capacity. It does not include buffer above `maxSocPct` or below `minSocPct`.

**CSV Key Mapping** (`TECH_PARAM_KEY_MAP`):

| CSV key | BatteryCore field |
|---------|------------------|
| `Battery_Capacity_MWh` | `batteryCapacityMwh` |
| `Max_Battery_Discharge_Power_MW` | `maxDischargePowerMw` |
| `Max_Battery_Charge_Power_MW` | `maxChargePowerMw` |
| `Charge_Efficiency_Percentage` | `chargeEfficiency` |
| `Discharge_Efficiency_Percentage` | `dischargeEfficiency` |
| `Min_SOC_Percentage` | `minSocPct` |
| `Max_SOC_Percentage` | `maxSocPct` |

---

### TechnicalParameters

```
┌──────────────────────────────────────────────────────────────────┐
│ TechnicalParameters                 [TypeScript interface]       │
├──────────────────────────────────────────────────────────────────┤
│ battery : BatteryCore                    — Parsed typed params   │
│ raw     : Record<string, string | number | boolean>              │
│               — All original CSV key-value pairs (for round-trip) │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Used for single-unit CSV files (one column only).
- `raw` preserves all rows from the CSV, including any non-`BatteryCore` variables (custom optimizer parameters, etc.). Round-trip CSV write must use `raw` + `variableOrder` to avoid losing unknown rows.
- `battery` is derived from `raw` by applying `TECH_PARAM_KEY_MAP`.

---

### MultiBatteryTechParams

```
┌──────────────────────────────────────────────────────────────────┐
│ MultiBatteryTechParams              [TypeScript interface]        │
├──────────────────────────────────────────────────────────────────┤
│ batteries    : Record<string, BatteryCore>                       │
│                   — plantId (string) → parsed BatteryCore        │
│ rawByPlant   : Record<string, Record<string, string|number|boolean>> │
│                   — plantId → all raw key-value pairs            │
│ plantIds     : string[]   — Ordered plant IDs from CSV header    │
│ variableOrder: string[]   — Ordered variable names from CSV rows │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Used for multi-unit CSV files (one column per portal plant ID).
- `plantIds` preserves the column order from the CSV header. Do not sort — column order is significant for round-trip CSV serialization.
- `variableOrder` preserves the row order from the CSV. Required for round-trip serialization without reordering variable rows.
- `batteries` keys are string plant IDs (matching CSV header column names). These correspond to `GcpComponent.portalPlantId.toString()`.
- `rawByPlant` stores all key-value pairs per plant, including unknown rows not in `TECH_PARAM_KEY_MAP`. Use this for round-trip write to avoid data loss.
- When a plant ID in the CSV does not match any `GcpComponent.portalPlantId`, it is still parsed and stored — do not silently drop unknown plant columns.

---

### BessParams

`BessParams` is not a separate interface in the codebase — it is the set of `BatteryCore` fields attached directly to `GcpComponent` in the asset-topology. It carries the same fields as `BatteryCore` but is optional on the component.

```
┌──────────────────────────────────────────────────────────────────┐
│ GcpComponent.bessParams  (optional)                              │
├──────────────────────────────────────────────────────────────────┤
│ (similar to BatteryCore but different field name)                 │
│ capacityMwh           : number                                   │
│ maxDischargePowerMw   : number                                   │
│ maxChargePowerMw      : number                                   │
│ chargeEfficiency      : number  — ratio 0–1                      │
│ dischargeEfficiency   : number  — ratio 0–1                      │
│ minSocPct             : number  — ratio 0–1                      │
│ maxSocPct             : number  — ratio 0–1                      │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Only present on `GcpComponent` entries with `type = "BESS"`.
- Populated by the Settings AssetMappingForm when the user saves the asset topology alongside the parsed CSV.
- `socMwh` in monitoring is derived: `socPercent / 100 * bessParams.capacityMwh`. If `bessParams` is absent, `socMwh` will be `null`.

---

## CSV Structure Example

**Single-unit CSV:**
```
Variable,Value
Battery_Capacity_MWh,10.0
Max_Battery_Discharge_Power_MW,5.0
Max_Battery_Charge_Power_MW,5.0
Charge_Efficiency_Percentage,0.95
Discharge_Efficiency_Percentage,0.95
Min_SOC_Percentage,0.10
Max_SOC_Percentage,0.90
```

**Multi-unit CSV (two plants):**
```
Variable,5001,5002
Battery_Capacity_MWh,10.0,12.0
Max_Battery_Discharge_Power_MW,5.0,6.0
Max_Battery_Charge_Power_MW,5.0,6.0
Charge_Efficiency_Percentage,0.95,0.92
Discharge_Efficiency_Percentage,0.95,0.92
Min_SOC_Percentage,0.10,0.10
Max_SOC_Percentage,0.90,0.90
```

---

## Entity Relationships

```
FileSource { key: "technical-parameters", parserKey: "tech-params" }
    │
    └── FileVersion.rawContent  (CSV text)
              │
              ▼ (tech-params parser)
    ┌─────────────────────────────────────────┐
    │  single column?                         │
    │    └── TechnicalParameters              │
    │          ├── battery: BatteryCore       │
    │          └── raw: Record<string, any>   │
    │                                         │
    │  multiple columns?                      │
    │    └── MultiBatteryTechParams           │
    │          ├── batteries: {plantId → BatteryCore} │
    │          ├── rawByPlant: {plantId → Record} │
    │          ├── plantIds: string[]         │
    │          └── variableOrder: string[]    │
    └─────────────────────────────────────────┘
              │
              ▼ (user saves asset mapping)
    GcpComponent.bessParams  (subset of BatteryCore)
              │
              └── monitoring: LiveSnapshot.socMwh
                    = socPercent / 100 * bessParams.capacityMwh
```

---

## Code References

| Symbol | File |
|--------|------|
| `BatteryCore`, `TechnicalParameters`, `MultiBatteryTechParams` | `shared/src/types/techParams.types.ts` |
| `TECH_PARAM_KEY_MAP`, `BATTERY_CORE_TO_CSV_KEY` | `shared/src/types/techParams.types.ts` |
| `GcpComponent` (with `bessParams`) | `shared/src/types/assetMapping.types.ts` |
| BatteryParamsPage | `client/src/pages/BatteryParamsPage.tsx` |
| `useFileSource` hook | `client/src/hooks/useFileSource.ts` |
| `tech-params` parser registration | `server/src/routes/file.routes.ts` |

## Related Files

| File | Relationship |
|------|-------------|
| [README.md](./README.md) | Domain overview, key concepts, code entry points |
| [file-ingestion/data-models.md](../file-ingestion/data-models.md) | `FileSource` and `FileVersion` deliver the CSV content |
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `GcpComponent.bessParams` is where BatteryCore fields live in the topology |
| [monitoring/data-models.md](../monitoring/data-models.md) | `LiveSnapshot.socMwh` derived from `bessParams.capacityMwh` |
