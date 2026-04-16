# profile/ — Data Models

> **Part of**: [profile/](./README.md) · **Lines**: ~155 · **Last updated**: 2026-04-15

## Entities

---

### GroupProfile

```
┌────────────────────────────────────────────────────────────────┐
│ GroupProfile                                                   │
├────────────────────────────────────────────────────────────────┤
│ id                       : string      — Portal group ID       │
│ name                     : string      — Group display name    │
│ portalEnv                : 'prod'                              │
│                           | 'staging'                         │
│                           | 'demo'     — Portal environment    │
│ assetMapping             : AssetMapping — GCP topology root    │
│ polling                  : PollingConfig                       │
│ monitoringCredentials?   : { username, password }             │
│ graphQlApiKey?           : string      — Portal WS auth key    │
│ scheduleBapEditable?     : boolean     — BAP edit flag         │
│ defaultResolutionMinutes?: 15 | 30 | 60 — Default MTU         │
│ customAttributeDefinitions?: AttributeDefinition[]            │
│ portfolioSnapshot?       : PortfolioSnapshot                  │
│ createdAt                : string      — ISO timestamp         │
│ updatedAt                : string      — ISO timestamp         │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `id` matches `PortalGroup.id`. One `GroupProfile` per portal group.
- `assetMapping` is the root of the entire physical topology — all GCPs and components live here.
- `defaultResolutionMinutes` defaults to `15` when absent. GCP-level `resolutionMinutes` takes precedence.
- `portalEnv` determines which Portal base URL the server uses for API calls.
- `scheduleBapEditable` defaults to `true` when absent — the BAP grid is editable.
- `monitoringCredentials` are encrypted at rest in `db.json` (AES-256). Never logged.
- `customAttributeDefinitions` extends the system-seeded attribute definitions for GCPs/components.

---

### UserProfile

```
┌────────────────────────────────────────────────────────────────┐
│ UserProfile                                                    │
├────────────────────────────────────────────────────────────────┤
│ id           : string             — Portal user ID             │
│ groupId      : string             — Links to GroupProfile.id   │
│ widgetLayout?: WidgetLayoutItem[] — Dashboard layout           │
│ createdAt    : string             — ISO timestamp              │
│ updatedAt    : string             — ISO timestamp              │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- `groupId` must match the logged-in user's `PortalGroup.id`. Cross-group access is rejected.
- `widgetLayout` is optional — if absent, the dashboard renders the default layout.
- Multiple users in the same group each have their own `UserProfile` (different widget arrangements).

---

### DashboardProfile

```
┌────────────────────────────────────────────────────────────────┐
│ DashboardProfile  (merged read-only view)                      │
├────────────────────────────────────────────────────────────────┤
│ — All fields from GroupProfile                                 │
│ widgetLayout?            : WidgetLayoutItem[]  (from User)     │
│ groupId?                 : string              (from User)     │
└────────────────────────────────────────────────────────────────┘
```

**Constraints:**
- Returned by `GET /api/config/profile`. Never written directly — write via separate group/user endpoints.
- UserProfile fields overlay GroupProfile fields. There are no naming conflicts in the current schema.

---

### PollingConfig

```
┌────────────────────────────────────────────────────────────────┐
│ PollingConfig                                                  │
├────────────────────────────────────────────────────────────────┤
│ intervalSeconds          : number  — Forecast poll (seconds)   │
│ maxWindowHours           : number  — Initial fetch window (h)  │
│ incrementalWindowMinutes : number  — Incremental window (min)  │
│ scheduleIntervalSeconds? : number  — FTP schedule poll (sec)   │
└────────────────────────────────────────────────────────────────┘
```

**Defaults (from `DEFAULT_POLLING_CONFIG`):**
- `intervalSeconds`: 60
- `maxWindowHours`: 3
- `incrementalWindowMinutes`: 10
- `scheduleIntervalSeconds`: 300

**Constraints:**
- `scheduleIntervalSeconds` defaults to 300 (5 minutes) when absent.
- `maxWindowHours` limits the historical window on first fetch — prevents large data pulls.
- All values must be positive integers.

---

### WidgetLayoutItem

```
┌────────────────────────────────────────────────────────────────┐
│ WidgetLayoutItem                                               │
├────────────────────────────────────────────────────────────────┤
│ widgetId   : string      — Unique widget instance ID           │
│ widgetType : WidgetType  — Widget type key                     │
│ x          : number      — Grid column (0-based)               │
│ y          : number      — Grid row (0-based)                  │
│ w          : number      — Width in grid columns               │
│ h          : number      — Height in grid rows                 │
│ minW?      : number      — Minimum width                       │
│ minH?      : number      — Minimum height                      │
└────────────────────────────────────────────────────────────────┘
```

**WidgetType values:** `'live-monitoring'` | `'market-prices'` | `'company-trading'` | `'current-schedule'` | `'live-battery-power'` | `'energy-flow'` | `'gip-market'`

**Constraints:**
- `widgetId` is unique per user layout. Multiple instances of the same `widgetType` may coexist with different `widgetId`s.
- `x`, `y`, `w`, `h` follow the react-grid-layout coordinate system.

---

## Entity Relationships

```
PortalGroup.id ──────────────────────► GroupProfile.id (1:1)
                                            │
                                            └── assetMapping: AssetMapping ──► (asset-topology domain)
                                            └── polling: PollingConfig
                                            └── monitoringCredentials

PortalUser.id ───────────────────────► UserProfile.id (1:1)
                                            │
                                            └── groupId ──────────────────────► GroupProfile.id

GET /api/config/profile returns:
    DashboardProfile = GroupProfile merged with UserProfile.widgetLayout
```

---

## Code References

| Symbol | File |
|--------|------|
| `GroupProfile`, `UserProfile`, `DashboardProfile`, `PollingConfig`, `WidgetLayoutItem`, `WidgetType`, `DEFAULT_POLLING_CONFIG` | `shared/src/types/dashboard.types.ts` |
| Config store (CRUD for GroupProfile and UserProfile in db.json) | `server/src/services/configStore.service.ts` |
| Session auth middleware (reads groupId, rejects cross-group) | `server/src/middleware/sessionAuth.ts` |
| Profile API routes | `server/src/routes/config.routes.ts` |
| Profile context (client state) | `client/src/context/ProfileContext.tsx` |

## Related Files

| File | Relationship |
|------|-------------|
| [README.md](./README.md) | Domain overview |
| [portal/data-models.md](../portal/data-models.md) | `PortalGroup.id` is the source of `GroupProfile.id` |
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `AssetMapping` schema (stored inside GroupProfile) |
| [_ownership.md](../_ownership.md) | GroupProfile and UserProfile are Cockpit-owned |
| [_validation.md](../_validation.md) | Group isolation rules |
