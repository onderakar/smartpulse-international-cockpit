# profile/ — Configuration & Auth

> **Part of**: [concepts/](../_index.md) · **Lines**: ~110 · **Last updated**: 2026-04-15

## Summary

The profile system manages authentication and persistent configuration at two scopes. **GroupProfile** is shared by all users belonging to the same portal group and holds the asset mapping, polling config, monitoring credentials, and other group-wide settings. **UserProfile** is per-user and holds only widget layout preferences.

Auth is session-based: the user logs in via Portal SSO, which returns an access token. The server stores the token in an express-session and uses it for all subsequent portal API calls on behalf of the user. Group isolation ensures that each user can only read and write data belonging to their own group.

The `/api/config/profile` endpoint returns a **DashboardProfile** — a merged view of `GroupProfile` + `UserProfile` — consumed by the client to bootstrap the dashboard.

## Owned Entities

| Entity | Scope | Description |
|--------|-------|-------------|
| `GroupProfile` | Group | Shared config: `assetMapping`, `polling`, `monitoringCredentials`, `portalEnv`, `defaultResolutionMinutes` |
| `UserProfile` | User | Personal config: `widgetLayout` |
| `DashboardProfile` | Merged | Read-only view returned to client; combines both profiles |
| `PollingConfig` | Group | Data fetch intervals: `intervalSeconds`, `maxWindowHours`, `incrementalWindowMinutes`, `scheduleIntervalSeconds` |
| `WidgetLayoutItem` | User | Per-widget position and size on the dashboard grid |

See [data-models.md](./data-models.md) for full field schemas.

## Referenced By

| Consumer | What it uses |
|----------|-------------|
| [asset-topology/](../asset-topology/README.md) | `GroupProfile.assetMapping` — the root of all physical topology |
| [monitoring/](../monitoring/README.md) | `GroupProfile.monitoringCredentials` for SCADA API auth |
| All server routes | `sessionAuth` middleware reads `req.session.groupId` to scope queries |

## Key Concepts

| Concept | Description |
|---------|-------------|
| Session-based auth | Portal SSO → `express-session`. The Portal access token lives in the session. No JWT on the client. |
| Group isolation | Every db.json query is filtered by `groupId`. Users cannot access other groups' data. |
| Market-agnostic | Region/market is derived from `PortalGroup.timezone` at login. No country is hardcoded. |
| Two-level profile | `GroupProfile` (shared) + `UserProfile` (personal). `DashboardProfile` merges both for the client. |
| Default resolution | `GroupProfile.defaultResolutionMinutes` defaults to `15`. GCP-level `resolutionMinutes` overrides it. |
| `portalEnv` | Switches the portal base URL between `prod`, `staging`, and `demo` environments. |
| `scheduleBapEditable` | Feature flag — when `false`, the BAP schedule grid is read-only for all users in the group. |

## When to Read Which File

| Task | File |
|------|------|
| Understand profile entity schemas (fields, types, constraints) | [data-models.md](./data-models.md) |
| Understand asset mapping (topology root inside GroupProfile) | [asset-topology/README.md](../asset-topology/README.md) |
| See session auth middleware | `server/src/middleware/sessionAuth.ts` |
| Understand polling intervals | [data-models.md](./data-models.md) — `PollingConfig` |

## Code References

| Symbol | File |
|--------|------|
| `GroupProfile`, `UserProfile`, `DashboardProfile`, `PollingConfig`, `WidgetLayoutItem` | `shared/src/types/dashboard.types.ts` |
| Config store (read/write GroupProfile and UserProfile to db.json) | `server/src/services/configStore.service.ts` |
| Session auth middleware | `server/src/middleware/sessionAuth.ts` |
| Profile API routes (`GET /api/config/profile`, `PUT /api/config/profile`) | `server/src/routes/config.routes.ts` |
| Profile context (client-side state) | `client/src/context/ProfileContext.tsx` |
| Auth context (session state, login/logout) | `client/src/context/AuthContext.tsx` |

## Related Files

| File | Relationship |
|------|-------------|
| [portal/README.md](../portal/README.md) | Portal login populates the session that profile reads |
| [asset-topology/README.md](../asset-topology/README.md) | `GroupProfile.assetMapping` is the root of the topology |
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `AssetMapping` schema lives in asset-topology |
| [_ownership.md](../_ownership.md) | `GroupProfile` is Cockpit-owned; `PortalGroup` is Portal-owned |
| [_validation.md](../_validation.md) | Group isolation rules, session expiry behavior |
