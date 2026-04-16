# portal/ — Data Models

> **Part of**: [portal/](./README.md) · **Lines**: ~130 · **Last updated**: 2026-04-15

## Entities

---

### PortalGroup

```
┌─────────────────────────────────────────────────┐
│ PortalGroup                                     │
├─────────────────────────────────────────────────┤
│ id          : number       — Portal group ID    │
│ name        : string       — Display name       │
│ timezone    : string       — IANA tz (e.g.      │
│                              "Europe/Sofia")    │
│ companies   : number[]     — PortalCompany IDs  │
└─────────────────────────────────────────────────┘
```

**Constraints:**
- `id` is assigned by Portal — never set by the Cockpit.
- `timezone` is authoritative for the session. All time displays use this value.
- `companies` contains IDs of `PortalCompany` objects returned in the same login payload.
- A user belongs to exactly one group. Cross-group access is not supported.

---

### PortalCompany

```
┌─────────────────────────────────────────────────┐
│ PortalCompany                                   │
├─────────────────────────────────────────────────┤
│ id            : number     — Portal company ID  │
│ name          : string     — Short name         │
│ fullName      : string     — Full legal name    │
│ timezone      : string     — IANA tz            │
│ powerPlantIds : number[]   — PortalPlant IDs    │
└─────────────────────────────────────────────────┘
```

**Constraints:**
- `id` maps to `CompanyMapping.companyId` in the asset topology.
- `powerPlantIds` lists all `PortalPlant.id` values owned by this company.
- A company belongs to exactly one group (enforced by Portal).
- `timezone` may differ from `PortalGroup.timezone`; use GCP-level timezone for time-series operations.

---

### PortalPlant

```
┌─────────────────────────────────────────────────┐
│ PortalPlant                                     │
├─────────────────────────────────────────────────┤
│ id       : number    — Portal plant ID          │
│ name     : string    — Display name             │
│ power    : number    — Installed power (MW)     │
│ timezone : string    — IANA tz                  │
│ typeid   : number    — Plant type code          │
│ isSfc    : boolean   — SFC participation flag   │
└─────────────────────────────────────────────────┘
```

**Constraints:**
- `id` maps to `GcpComponent.portalPlantId` (or `GcpSubComponent.portalPlantId` for split components).
- `id` does NOT map to a `GridConnectionPoint`. GCPs have no portal plant equivalent.
- `typeid` is a Portal-internal code. The Cockpit does not rely on it for routing logic.
- `isSfc` indicates participation in the balancing mechanism — informational only.
- `power` is the installed capacity in MW. Used as a hint during auto-mapping.

---

### PortalLoginResponse

```
┌─────────────────────────────────────────────────┐
│ PortalLoginResponse                             │
├─────────────────────────────────────────────────┤
│ accessToken    : string       — Bearer token    │
│ graphQlAuthKey : string       — WS auth key     │
│ plants         : PortalPlant[]                  │
│ companies      : PortalCompany[]                │
│ groups         : PortalGroup[]                  │
└─────────────────────────────────────────────────┘
```

**Constraints:**
- Returned by `POST /api/auth/login`. The server calls the Portal, then stores the token in `express-session`.
- `accessToken` is never forwarded to the client browser — it lives server-side only.
- `plants`, `companies`, `groups` are the complete lists for this user's group. No pagination.

---

### PortalSessionStatus

```
┌─────────────────────────────────────────────────┐
│ PortalSessionStatus                             │
├─────────────────────────────────────────────────┤
│ loggedIn   : boolean                            │
│ plants?    : PortalPlant[]                      │
│ companies? : PortalCompany[]                    │
└─────────────────────────────────────────────────┘
```

**Constraints:**
- Returned by `GET /api/auth/status`. Used by the client on app load to restore session state.
- `plants` and `companies` are present only when `loggedIn === true`.

---

## Entity Relationships

```
PortalGroup (1)
    │
    ├── companies: number[] ──────────────────► PortalCompany (N)
    │                                               │
    │                                               └── powerPlantIds: number[] ──► PortalPlant (N)
    │
    └── timezone ──────────────────────────────────── Session timezone (authoritative)

PortalPlant.id ──────────────────────────────────► GcpComponent.portalPlantId
                                                    (in asset-topology domain)
```

---

## Code References

| Symbol | File |
|--------|------|
| `PortalGroup`, `PortalCompany`, `PortalPlant`, `PortalLoginResponse`, `PortalLoginRequest`, `PortalSessionStatus` | `shared/src/types/auth.types.ts` |
| Login route (calls Portal, writes session) | `server/src/routes/auth.routes.ts` |
| Portal auth service (HTTP wrapper) | `server/src/services/portalAuth.service.ts` |
| Client auth API | `client/src/api/auth.api.ts` |
| Auth context (React state for plants/companies) | `client/src/context/AuthContext.tsx` |

## Related Files

| File | Relationship |
|------|-------------|
| [README.md](./README.md) | Domain overview |
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `GcpComponent.portalPlantId` references `PortalPlant.id` |
| [profile/data-models.md](../profile/data-models.md) | `GroupProfile.id` corresponds to `PortalGroup.id` scope |
| [_ownership.md](../_ownership.md) | Portal entities are externally owned — do not persist or mutate |
