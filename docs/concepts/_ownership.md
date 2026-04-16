# Entity Ownership Registry

> Canonical source for each entity. When files disagree, the owner wins.
> **Last updated**: 2026-04-15

## Ownership Table

| Entity | Canonical Owner | Referenced By |
|--------|-----------------|---------------|
| **PortalGroup** | [portal/data-models.md](portal/data-models.md) | profile, asset-topology |
| **PortalCompany** | [portal/data-models.md](portal/data-models.md) | asset-topology |
| **PortalPlant** | [portal/data-models.md](portal/data-models.md) | asset-topology |
| **AssetMapping** | [asset-topology/data-models.md](asset-topology/data-models.md) | profile, monitoring, schedule, forecast |
| **CompanyMapping** | [asset-topology/data-models.md](asset-topology/data-models.md) | profile |
| **GridConnectionPoint** | [asset-topology/data-models.md](asset-topology/data-models.md) | monitoring, schedule, forecast |
| **GcpComponent** | [asset-topology/data-models.md](asset-topology/data-models.md) | monitoring, forecast, battery-params |
| **GcpSubComponent** | [asset-topology/data-models.md](asset-topology/data-models.md) | forecast |
| **BessParams** | [battery-params/data-models.md](battery-params/data-models.md) | asset-topology |
| **BatteryCore** | [battery-params/data-models.md](battery-params/data-models.md) | — |
| **TechnicalParameters** | [battery-params/data-models.md](battery-params/data-models.md) | — |
| **GroupProfile** | [profile/data-models.md](profile/data-models.md) | asset-topology, monitoring |
| **UserProfile** | [profile/data-models.md](profile/data-models.md) | — |
| **DashboardProfile** | [profile/data-models.md](profile/data-models.md) | — |
| **PollingConfig** | [profile/data-models.md](profile/data-models.md) | monitoring |
| **MetricType** | [monitoring/data-models.md](monitoring/data-models.md) | — |
| **DataSource** | [monitoring/data-models.md](monitoring/data-models.md) | — |
| **TimeSeriesData** | [monitoring/data-models.md](monitoring/data-models.md) | intraday |
| **RawMetricPoint** | [monitoring/data-models.md](monitoring/data-models.md) | — |
| **LiveMonitoringData** | [monitoring/data-models.md](monitoring/data-models.md) | — |
| **LiveSnapshot** | [monitoring/data-models.md](monitoring/data-models.md) | — |
| **ScheduleRow** | [schedule/data-models.md](schedule/data-models.md) | — |
| **ScheduleRevision** | [schedule/data-models.md](schedule/data-models.md) | — |
| **ParsedSchedule** | [schedule/data-models.md](schedule/data-models.md) | — |
| **ForecastRequest** | [forecast/data-models.md](forecast/data-models.md) | — |
| **ForecastResponse** | [forecast/data-models.md](forecast/data-models.md) | — |
| **IntradayTransaction** | [intraday/data-models.md](intraday/data-models.md) | — |
| **EntityTimeSeries** | [intraday/data-models.md](intraday/data-models.md) | monitoring |
| **FileSource** | [file-ingestion/data-models.md](file-ingestion/data-models.md) | schedule, battery-params |
| **FileVersion** | [file-ingestion/data-models.md](file-ingestion/data-models.md) | — |
| **PortfolioMapping** | [portfolio/data-models.md](portfolio/data-models.md) | intraday |
| **PortfolioEntry** | [portfolio/data-models.md](portfolio/data-models.md) | — |

## Ownership Rules

1. **Canonical owner defines**: entity name, fields, types, relationships, constraints
2. **Referencing files must**: use exact entity names, link to owner, not redefine behavior
3. **New entities**: add to this table, declare in owner README, update referencing concepts

## Conflict Resolution

1. Identify the canonical owner from the table above
2. Owner's definition wins — no exceptions
3. Update the referencing file to match the owner
4. If the owner is wrong, fix the owner first, then propagate

## Cross-Concept Entities

| Scenario | Resolution |
|----------|------------|
| **AssetMapping** used by profile and monitoring | asset-topology owns definition; profile stores it in GroupProfile.assetMapping |
| **GcpComponent** used by forecast and monitoring | asset-topology owns; forecast uses portalPlantId, monitoring uses monitoring config |
| **EntityTimeSeries** used by intraday and monitoring | intraday owns; monitoring reads via shared DB table |
| **PortalGroup** used by portal and profile | portal owns; profile references groupId for session |

## Related Files

| Topic | File |
|-------|------|
| Navigation hub | [_index.md](./_index.md) |
| Contributing | [_contributing.md](./_contributing.md) |
| Validation | [_validation.md](./_validation.md) |
