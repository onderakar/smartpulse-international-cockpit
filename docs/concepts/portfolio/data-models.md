# portfolio/ — Data Models

> **Part of**: [portfolio/](./README.md) · **Lines**: ~185 · **Last updated**: 2026-04-15

## Entities

---

### PortfolioMapping

```
┌──────────────────────────────────────────────────────────────────┐
│ PortfolioMapping                              [DB: PostgreSQL]   │
├──────────────────────────────────────────────────────────────────┤
│ id            : Int      — Auto PK                               │
│ groupId       : String   — Tenant isolation key                  │
│ portfolioType : String   — "DAM" | "IDM" | "AFRR"               │
│                            (default: "DAM")                      │
│ externalId    : String   — External portfolio ID (e.g. "B00214-10") │
│ displayName?  : String   — Optional user-provided label          │
│ companyId     : Int      — SmartPulse PortalCompany.id           │
│ companyName   : String   — Denormalized for display              │
│ createdAt     : DateTime                                         │
│ updatedAt     : DateTime                                         │
│ updatedBy?    : String   — Portal username of last editor        │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `UNIQUE(groupId, portfolioType, externalId)` — one company per external portfolio ID per type. A portfolio ID cannot be assigned to two companies.
- `UNIQUE(groupId, portfolioType, companyId)` — one portfolio per company per type. A company cannot have two DAM portfolios.
- `portfolioType` is case-sensitive. Always use uppercase: `"DAM"`, `"IDM"`, `"AFRR"`.
- `companyName` is denormalized from `CompanyMapping.companyName` at save time. Update both if the company name changes.
- `externalId` is the raw string from the exchange data file (e.g. IBEX CSV column `PORTFOLIO_ID`). Must match exactly — no normalization applied.
- `updatedBy` captures the portal session username. Populated by the route handler from `req.session`.

**Indexes:**
- `(groupId, portfolioType, externalId)` — unique, DamGenAdapter lookup key
- `(groupId, portfolioType, companyId)` — unique, company assignment check
- `(groupId, portfolioType)` — list all mappings for a group/type (Settings UI)

---

### PortalEntityUnit

```
┌──────────────────────────────────────────────────────────────────┐
│ PortalEntityUnit                    [read-only, not persisted]   │
├──────────────────────────────────────────────────────────────────┤
│ unitNo    : number   — Portal plant/unit ID                      │
│ unitType  : string   — "PP" = Power Plant, other types possible  │
│ shortName : string | null   — Abbreviated name                   │
│ fullName  : string          — Full display name                  │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Fetched from Portal API as part of `PortfolioSnapshot`. Never persisted.
- `unitNo` matches `GcpComponent.portalPlantId` — used to cross-reference portal plants with portfolio assignments.
- `unitType = "PP"` is the standard value for generation/storage assets.

---

### PortfolioUnitRef

```
┌──────────────────────────────────────────────────────────────────┐
│ PortfolioUnitRef                    [read-only, not persisted]   │
├──────────────────────────────────────────────────────────────────┤
│ unitNo   : number   — Portal plant ID                            │
│ unitType : string   — Asset type ("PP", etc.)                    │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Lightweight reference used inside `PortfolioEntry.portfolioUnits[]`.
- A subset of `PortalEntityUnit` — only the IDs, no names.

---

### PortfolioEntry

```
┌──────────────────────────────────────────────────────────────────┐
│ PortfolioEntry                      [read-only, not persisted]   │
├──────────────────────────────────────────────────────────────────┤
│ id             : number              — Portal portfolio ID       │
│ name           : string             — Portfolio display name     │
│ portfolioType  : string             — "Unknown" | "TSO" | "AFRR" │
│                                       (Portal classification)    │
│ eicForTps?     : string | null      — EIC code for TPS          │
│ eicForPps?     : string | null      — EIC code for PPS          │
│ portfolioUnits : PortfolioUnitRef[] — Assigned plant unit refs   │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Fetched from Portal API. Displayed in Settings combo-box as available portfolio options.
- `portfolioType` here is the Portal's own classification (e.g. `"TSO"`) — different from the cockpit's `PortfolioMapping.portfolioType` (e.g. `"DAM"`).
- `portfolioUnits` shows which plants are currently assigned to this portfolio in the Portal.
- Used only for the Settings UI combo-box. The DamGenAdapter works only with persisted `PortfolioMapping` rows.

---

### PortfolioSnapshot

```
┌──────────────────────────────────────────────────────────────────┐
│ PortfolioSnapshot                   [read-only, not persisted]   │
├──────────────────────────────────────────────────────────────────┤
│ entityUnits : PortalEntityUnit[]   — All portal plants for group │
│ portfolios  : PortfolioEntry[]     — All portfolios from Portal  │
│ fetchedAt   : string               — ISO timestamp of fetch      │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Fetched on demand when the user opens the DamPortfolioManager Settings panel.
- Not cached or persisted — always fresh from Portal.
- `fetchedAt` is informational — shown in the Settings UI so the user knows data freshness.
- May be incomplete: some portfolio IDs in exchange files may not appear in the Portal snapshot. The Settings combo-box allows manual text entry for this case.

---

## Entity Relationships

```
Portal API
    └── PortfolioSnapshot
          ├── entityUnits[]: PortalEntityUnit[]   (read-only, for UI)
          └── portfolios[]:  PortfolioEntry[]     (read-only, for UI combo-box)
                                    │
                                    ▼ (user selects and saves)
                              PortfolioMapping    (persisted to DB)
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
              externalId                       companyId
                    │                               │
                    ▼                               ▼
          DAM_GEN.csv PORTFOLIO_ID      PortalCompany (from asset-topology)
                    │
                    └── DamGenAdapter resolves → EntityTimeSeries
                              seriesKey = "dam_trade_volume"
                              seriesKey = "generation_forecast"
```

---

## Code References

| Symbol | File |
|--------|------|
| `PortfolioMapping` (Prisma model) | `server/prisma/schema.prisma` |
| `PortfolioEntry`, `PortalEntityUnit`, `PortfolioUnitRef`, `PortfolioSnapshot` | `shared/src/types/portfolio.types.ts` |
| Portfolio routes | `server/src/routes/portfolio.routes.ts` |
| DamPortfolioManager (Settings UI) | `client/src/components/settings/DamPortfolioManager.tsx` |
| DamGenAdapter (reads PortfolioMapping) | `server/src/services/damGen.adapter.ts` |

## Related Files

| File | Relationship |
|------|-------------|
| [README.md](./README.md) | Domain overview, key concepts, Settings UI behavior |
| [file-ingestion/data-models.md](../file-ingestion/data-models.md) | DamGenAdapter is triggered by FILE_UPDATED from FileIngestionWorker |
| [intraday/data-models.md](../intraday/data-models.md) | Writes to shared `EntityTimeSeries` table |
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `CompanyMapping.companyId` is the target side of every `PortfolioMapping` |
| [portal/README.md](../portal/README.md) | Portal API is the source of `PortfolioSnapshot` data |
