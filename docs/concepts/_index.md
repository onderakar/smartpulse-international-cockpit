# SmartPulse International Cockpit — Concepts Index

> **AI Agent Instructions**: Read this file first. Use the routing tables below to find the specific file for your task. Each sub-file is <400 lines.

## Quick Navigation by Task

| If you need to... | Read this file |
|-------------------|----------------|
| Understand the portal hierarchy (Group/Company/Plant) | [portal/README.md](portal/README.md) |
| Configure asset mapping (GCP/Component topology) | [asset-topology/README.md](asset-topology/README.md) |
| Work with SCADA/monitoring data | [monitoring/README.md](monitoring/README.md) |
| Handle schedule/BAP files from FTP | [schedule/README.md](schedule/README.md) |
| Read or submit forecasts | [forecast/README.md](forecast/README.md) |
| Work with intraday market trades | [intraday/README.md](intraday/README.md) |
| Configure file ingestion pipeline | [file-ingestion/README.md](file-ingestion/README.md) |
| Map portfolios to companies | [portfolio/README.md](portfolio/README.md) |
| Manage group/user profiles and settings | [profile/README.md](profile/README.md) |
| Read/write battery technical parameters | [battery-params/README.md](battery-params/README.md) |
| Check entity ownership or resolve conflicts | [_ownership.md](_ownership.md) |
| Validate a design against platform rules | [_validation.md](_validation.md) |

## Navigation by Entity

| Entity | Definition | Behavior/Usage |
|--------|------------|----------------|
| **PortalGroup** | [portal/data-models.md](portal/data-models.md) | [profile/README.md](profile/README.md) |
| **PortalCompany** | [portal/data-models.md](portal/data-models.md) | [asset-topology/README.md](asset-topology/README.md) |
| **PortalPlant** | [portal/data-models.md](portal/data-models.md) | [asset-topology/data-models.md](asset-topology/data-models.md) |
| **AssetMapping** | [asset-topology/data-models.md](asset-topology/data-models.md) | [profile/README.md](profile/README.md) |
| **GridConnectionPoint** | [asset-topology/data-models.md](asset-topology/data-models.md) | [monitoring/README.md](monitoring/README.md), [schedule/README.md](schedule/README.md) |
| **GcpComponent** | [asset-topology/data-models.md](asset-topology/data-models.md) | [forecast/README.md](forecast/README.md), [monitoring/README.md](monitoring/README.md) |
| **GroupProfile** | [profile/data-models.md](profile/data-models.md) | [asset-topology/README.md](asset-topology/README.md) |
| **TimeSeriesData** | [monitoring/data-models.md](monitoring/data-models.md) | [intraday/README.md](intraday/README.md) |
| **ScheduleRevision** | [schedule/data-models.md](schedule/data-models.md) | — |
| **IntradayTransaction** | [intraday/data-models.md](intraday/data-models.md) | — |
| **EntityTimeSeries** | [intraday/data-models.md](intraday/data-models.md) | [monitoring/README.md](monitoring/README.md) |
| **FileSource** | [file-ingestion/data-models.md](file-ingestion/data-models.md) | [schedule/README.md](schedule/README.md) |
| **PortfolioMapping** | [portfolio/data-models.md](portfolio/data-models.md) | [intraday/README.md](intraday/README.md) |
| **BessParams** | [battery-params/data-models.md](battery-params/data-models.md) | [asset-topology/README.md](asset-topology/README.md) |

## Cross-Cutting Concerns

| Topic | Primary File | Also See |
|-------|--------------|----------|
| Group-based multi-tenancy | [profile/README.md](profile/README.md) | [_validation.md](_validation.md) |
| Session auth & group isolation | [profile/README.md](profile/README.md) | [_validation.md](_validation.md) |
| AssetMapping (topology root) | [asset-topology/README.md](asset-topology/README.md) | [profile/data-models.md](profile/data-models.md) |
| Timezone & DST handling | [_validation.md](_validation.md) | [asset-topology/README.md](asset-topology/README.md) |
| Event-driven workers | [monitoring/README.md](monitoring/README.md) | [file-ingestion/README.md](file-ingestion/README.md) |

## Concept Overviews

| Concept | README | Description |
|---------|--------|-------------|
| Portal | [portal/](portal/README.md) | External portal hierarchy: Group, Company, Plant |
| Profile | [profile/](profile/README.md) | Group/user config, auth, session management |
| Asset Topology | [asset-topology/](asset-topology/README.md) | User-configured GCP/Component physical topology |
| Monitoring | [monitoring/](monitoring/README.md) | SCADA data collection, time series, live dashboard |
| Schedule | [schedule/](schedule/README.md) | Battery schedule/BAP files via FTP |
| Forecast | [forecast/](forecast/README.md) | Production forecast from portal API |
| Intraday | [intraday/](intraday/README.md) | Intraday market trades and net position |
| File Ingestion | [file-ingestion/](file-ingestion/README.md) | FTP file pipeline with versioning |
| Portfolio | [portfolio/](portfolio/README.md) | DAM/IDM portfolio-to-company mapping |
| Battery Params | [battery-params/](battery-params/README.md) | BESS technical parameters from CSV |

## Meta Documentation

| Purpose | File |
|---------|------|
| Entity ownership & conflict resolution | [_ownership.md](_ownership.md) |
| Creating & editing concepts | [_contributing.md](_contributing.md) |
| Validation & compliance checks | [_validation.md](_validation.md) |

## File Structure

```
docs/concepts/
├── _index.md
├── _ownership.md
├── _contributing.md
├── _validation.md
├── portal/
│   ├── README.md
│   └── data-models.md
├── profile/
│   ├── README.md
│   └── data-models.md
├── asset-topology/
│   ├── README.md
│   └── data-models.md
├── monitoring/
│   ├── README.md
│   └── data-models.md
├── schedule/
│   ├── README.md
│   └── data-models.md
├── forecast/
│   ├── README.md
│   └── data-models.md
├── intraday/
│   ├── README.md
│   └── data-models.md
├── file-ingestion/
│   ├── README.md
│   └── data-models.md
├── portfolio/
│   ├── README.md
│   └── data-models.md
└── battery-params/
    ├── README.md
    └── data-models.md
```

## Design Rules

1. Each file stays under 400 lines
2. Entity schemas defined in exactly ONE `data-models.md`
3. All links are relative — never absolute
4. API routes use `{param}` syntax (NOT `:param`)
5. Every file has the standard header (Part-of, Lines, Last-updated)
6. Every file ends with a Related Files table
7. Ownership defined in `_ownership.md` is canonical

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-15 | @claude | Initial concept documentation |
