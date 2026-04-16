# portal/ — External Portal Hierarchy

> **Part of**: [concepts/](../_index.md) · **Lines**: ~90 · **Last updated**: 2026-04-15

## Summary

SmartPulse Portal is an external service that manages the customer hierarchy. At login, the Portal returns a 3-level read-only hierarchy: **Group → Company → Plant**. These entities are owned by the Portal — they are never user-configured in the Cockpit. The Cockpit uses them as reference data to drive asset mapping, forecast queries, and session scoping.

Portal data is fetched once at login and stored in the server-side session. It is not persisted to `db.json`. If the session expires, the user must log in again.

## Owned Entities

| Entity | Description |
|--------|-------------|
| `PortalGroup` | Top-level organizational unit. Scopes all group data in the Cockpit. |
| `PortalCompany` | A company belonging to a group. Holds a list of portal plant IDs. |
| `PortalPlant` | An individual generation/storage unit (battery, solar, etc.). Appears only at the **component** level in asset topology — never at GCP level. |

See [data-models.md](./data-models.md) for full field schemas.

## Referenced By

| Consumer | How it uses Portal data |
|----------|------------------------|
| [profile/](../profile/README.md) | `PortalGroup.id` scopes the session; `timezone` sets the display timezone |
| [asset-topology/](../asset-topology/README.md) | `PortalPlant.id` maps to `GcpComponent.portalPlantId`; `PortalCompany.id` maps to `CompanyMapping.companyId` |

## Key Concepts

| Concept | Description |
|---------|-------------|
| Read-only hierarchy | Portal entities are never modified by the Cockpit. They are source-of-truth from SmartPulse Portal. |
| Login payload | `PortalLoginResponse` carries `plants[]`, `companies[]`, `groups[]` — all three lists in one call. |
| Session scoping | The logged-in user belongs to exactly one `PortalGroup`. All Cockpit data is filtered by `group.id`. |
| No GCP at portal level | `PortalPlant` maps to a **component** inside a GCP — not to a GCP itself. GCPs are user-configured. |
| Timezone from group | `PortalGroup.timezone` is the authoritative timezone for the user's session. All time displays use this. |

## When to Read Which File

| Task | File |
|------|------|
| Understand portal entity schemas (fields, types, constraints) | [data-models.md](./data-models.md) |
| Understand how portal plants are mapped to GCPs/components | [asset-topology/README.md](../asset-topology/README.md) |
| Understand how the group session is managed | [profile/README.md](../profile/README.md) |
| See the login API flow | [data-models.md](./data-models.md) |

## Code References

| Symbol | File |
|--------|------|
| `PortalGroup`, `PortalCompany`, `PortalPlant`, `PortalLoginResponse` | `shared/src/types/auth.types.ts` |
| Login handler (calls Portal, writes session) | `server/src/routes/auth.routes.ts` |
| Portal auth service (HTTP client wrapper) | `server/src/services/portalAuth.service.ts` |
| Client-side auth API | `client/src/api/auth.api.ts` |
| Auth context (stores plants/companies in React state) | `client/src/context/AuthContext.tsx` |

## Related Files

| File | Relationship |
|------|-------------|
| [profile/README.md](../profile/README.md) | Session and group isolation |
| [asset-topology/README.md](../asset-topology/README.md) | Maps portal plants to GCP components |
| [asset-topology/data-models.md](../asset-topology/data-models.md) | `GcpComponent.portalPlantId` references `PortalPlant.id` |
| [_ownership.md](../_ownership.md) | Portal entities are externally owned |
