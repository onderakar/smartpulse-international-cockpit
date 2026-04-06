# SmartPulse International Cockpit

## Project Overview

This is the **international version** of the SmartPulse Battery Cockpit. It was bootstrapped from the Turkey-specific `smartpulse-battery-manager` project by extracting reusable, market-agnostic modules.

**First target market:** Bulgaria (Nord Pool infrastructure)
**Architecture:** Market-agnostic — the group's region/market is determined at login time. Not hardcoded to any specific country.

## Core Domain Concepts

### Portal Hierarchy: Group → Company → Plant

SmartPulse Portal returns a 3-level hierarchy at login:

```
PortalGroup (Grup)
├── PortalCompany (Şirket) — "ALYEL", "ERGUVAN", "SOMA"
│     └── powerPlantIds: number[]  → plant IDs owned by this company
└── PortalCompany ...

PortalPlant (Santral / Virtual Plant) — "Battery Unit 1", "Battery Unit 2"
├── id, name, power (MW), timezone, typeid, isSfc
```

Portal login returns 3 lists: `groups[]`, `companies[]`, `plants[]`. The user belongs to a group. A group contains multiple companies, a company contains multiple plants.

### GridConnectionPoint (GCP) — replaces "UEVCB"

**GridConnectionPoint (GCP)** = a physical grid connection point. Multiple generation/storage components (battery, solar, wind, etc.) can sit behind a single GCP, but they all connect to the grid through one point.

The `UEVCB` interface in the current code models this concept. In the international project, UEVCB is being renamed to **GridConnectionPoint** (or short: **GCP**).

**Critical difference from Turkey:** In TR, each GCP was represented by a PortalPlant in the portal. In the international project, there is NO portal plant that directly represents a GCP. A GCP is purely a user-configured object created in Settings. Portal plants are only mapped at the **component** level beneath a GCP.

### Asset Mapping: User Configuration

Asset Mapping is the configuration the user creates in Settings. It maps portal plants and companies to the real physical topology. This is the most critical data structure in the project — forecast, schedule, monitoring, FTP all depend on it.

```
AssetMapping
├── ftpDirection: 'incoming' | 'outgoing'
├── ftpFilename: string
└── companies: CompanyMapping[]
      │
      └── CompanyMapping
          ├── companyId: number
          ├── companyName: string            → "BG Energy Co."
          ├── timezone: string               → "Europe/Sofia"
          └── gridConnectionPoints: GridConnectionPoint[]   (currently "uevcbs" in code)
                │
                └── GridConnectionPoint
                    ├── id: string                   → unique identifier
                    ├── name: string                 → "Sofia Grid Point"
                    ├── timezone: string             → "Europe/Sofia"
                    ├── resolutionMinutes: 15|30|60  → time resolution (default: 15)
                    └── components: Component[]
                          │
                          └── Component
                              ├── componentId: string
                              ├── type: 'BESS'|'SOLAR'|'WIND'|'HYDRO'|'THERMAL'|'LOAD'|'OTHER'
                              ├── displayName: string         → "Battery Unit 1"
                              ├── portalPlantId: number       → Portal plant ID (component-level only!)
                              ├── forecastPreference: {
                              │     sourceName: string
                              │     beforeMinutes: number
                              │   }
                              ├── scheduleFilePattern?: string
                              │     e.g.: "Battery_Schedule_{GCP_ID}.csv"
                              └── monitoring?: {
                                    masternode: string
                                    metrics: Array<LabeledMetricMapping | BapSource>
                                  }
```

**Concrete example (Bulgaria):**
```
BG Energy Co. (Company, companyId: 99)
└── Sofia Grid Point (GridConnectionPoint, resolutionMinutes: 15)
    ├── Battery_Unit_1  (component, type: BESS, portalPlantId: 5001)
    └── Battery_Unit_2  (component, type: BESS, portalPlantId: 5002)
```
- Sofia Grid Point → NO corresponding portal plant exists
- Battery_Unit_1 → exists in portal as portalPlantId: 5001
- Battery_Unit_2 → exists in portal as portalPlantId: 5002
- Forecast → queried via each component's portalPlantId
- Schedule → GCP-level FTP file via scheduleFilePattern

### How Asset Mapping Is Used (Code Flow)

1. **Login** → Portal returns plants[] and companies[]
2. **Settings > AssetMappingForm** → User selects company, adds GCPs (independent of portal plants, manually defined), maps portal plants as components under each GCP
3. **Save** → Written to db.json as profile.assetMapping (GroupProfile level, shared by all users)
4. **Forecast** → component.portalPlantId + component.forecastPreference determines which provider's forecast to read for which component
5. **Schedule/BAP** → component.scheduleFilePattern determines the correct FTP file
6. **Monitoring** → component.monitoring.masternode + metrics[] fetches the right metrics
7. **Dashboard** → helper functions retrieve relevant GCP/component lists

### Helper Functions

```
getFirstGcp(mapping)      → returns first GCP across all companies
getAllGcps(mapping)        → returns all GCPs as flat list
getBessGcps(mapping)      → returns only GCPs that have BESS components
migrateAssetMapping(raw)  → converts old format to new (may not be needed, kept for safety)
```

### Profile System: Group vs User

The database (db.json) maintains two-level profiles:

**GroupProfile** (group-level, shared by all users in the group):
- assetMapping — company/GCP/component configuration
- polling — data fetch intervals
- monitoringCredentials — monitoring API username/password
- portalEnv — prod/staging/demo
- scheduleBapEditable — whether BAP is editable

**UserProfile** (user-specific):
- widgetLayout — dashboard widget positions

**DashboardProfile** = GroupProfile + UserProfile merged view. The `/api/config/profile` endpoint returns this merged view.

### UEVCB → GridConnectionPoint Rename Map

| Current (TR) | New (International) |
|---|---|
| `UEVCB` interface | `GridConnectionPoint` |
| `uevcbId` | `gcpId` or `id` |
| `uevcbs: UEVCB[]` | `gridConnectionPoints: GridConnectionPoint[]` |
| `primaryPortalPlantId` | **Remove** (no portal plant at GCP level) |
| `getFirstUevcb()` | `getFirstGcp()` |
| `getAllUevcbs()` | `getAllGcps()` |
| `getBessUevcbs()` | `getBessGcps()` |
| `{UEVCB_ID}` placeholder | `{GCP_ID}` |

## Architecture

Full-stack monorepo with npm workspaces:

```
client/     → React 19 + Vite + Tailwind CSS + AG Grid + ECharts
server/     → Express + TypeScript + LowDB + Socket.io
shared/     → Types + Constants (shared between client & server)
```

### What's Already Here (inherited from TR cockpit)

| Module | Description | Status |
|--------|-------------|--------|
| **Login/Auth** | Portal SSO login, session management | Ready |
| **Forecast Reading** | Read forecast predictions from portal API, display in ForecastPage | Ready |
| **FTP Read/Write** | Read/write schedule files via FTP, file watcher worker | Ready |
| **Battery Params** | Technical parameters editor (BatteryParamsPage) | Ready |
| **Battery Program** | Schedule/BAP grid editor with revision history (BatteryProgramPage) | Ready |
| **Dashboard Framework** | Widget grid infrastructure (WidgetGrid, WidgetContainer, drag-drop layout) | Ready — no widgets yet |
| **Settings** | Profile management, asset mapping, polling config, cache management | Ready |
| **Theme** | Light/dark mode with CSS variables, Mulish font | Ready |
| **i18n** | Locale system with `useLocale()` hook, translations in shared/constants | Ready |

### What Needs to Be Built

| Module | Description | Priority |
|--------|-------------|----------|
| **DAM Position** | Read `dam_gen.csv` from external software (not portal KGÜP) | HIGH |
| **Intraday Market** | Nord Pool IDM integration (replaces TR GİP) | HIGH |
| **Market Prices** | Nord Pool day-ahead & intraday prices (replaces TR PTF/SMF) | HIGH |
| **Monitoring/SCADA** | New monitoring integration | MEDIUM |
| **Dashboard Widgets** | New widgets for market data, plant status, etc. | MEDIUM |

### Key Differences from Turkey Cockpit

| Aspect | Turkey (old project) | International (this project) |
|--------|---------------------|------------------------|
| Time resolution | Hourly (1h = 24 slots/day) | Quarter-hourly default (15min = 96 slots/day), supports 30/60 too |
| Day-ahead position | Portal KGÜP API | `dam_gen.csv` file from external optimizer |
| Intraday market | GİP via SmartPulse GraphQL WS | Nord Pool IDM API |
| Market prices | PTF/SMF from EPIAS | Nord Pool DAM/IDM prices |
| GCP topology | UEVCB = portal plant (1:1) | GCP is user-configured, no portal plant at GCP level |
| Schedule concept | KGÜP-based (portal) | Component-based (per battery unit) |
| Timezone | UTC+3 (Turkey, no DST) | From group info at login (e.g. Europe/Sofia with DST) |
| Region | Hardcoded Turkey/EPIAS | Market-agnostic, determined by group at login |

## Development

```bash
# Install dependencies
npm install

# Run dev (client + server concurrently)
npm run dev

# Run individually
npm run dev:client   # Vite on :5173
npm run dev:server   # Express on :3001
```

### Environment Variables

Copy `.env.example` to `.env` and configure:
- `PORTAL_BASE_URL` — SmartPulse Portal URL
- `MONITORING_BASE_URL` — Monitoring API URL
- `SESSION_SECRET` — Express session secret

## STRICT Rules

- **NO hardcoded strings in UI**: All user-facing text MUST use `t('key')` from `useLocale()` with translations in `shared/src/constants/translations.ts`
- **Quarter-hourly default**: Default resolution is 15 minutes (96 slots/day). All new time-series features MUST support 15-minute resolution natively. resolutionMinutes also supports 30 and 60 but 15 is the default.
- **AG Grid cellRenderer**: MUST return JSX, NOT HTML strings (strings render as escaped text)
- **DST awareness**: Timezone comes from group info at login. All time logic must handle DST transitions. Do NOT assume fixed UTC offset like the TR cockpit does.
- **No portal plant at GCP level**: GridConnectionPoint does NOT have a primaryPortalPlantId. Only components have portalPlantId.
- **Market-agnostic**: Do NOT hardcode Bulgaria or any specific country. The region/market is determined by the group at login.

## File Structure Quick Reference

```
client/src/
├── api/          → Axios API clients (auth, config, forecast, ftp, schedule)
├── components/
│   ├── battery-params/  → Technical parameters editor
│   ├── common/          → Shared UI (DateNav)
│   ├── dashboard/       → Widget infrastructure (WidgetGrid, WidgetContainer)
│   ├── layout/          → App shell, header, routing
│   ├── schedule/        → Schedule grid, chart, revision popup
│   └── settings/        → Settings form components
├── context/      → React contexts (Auth, Forecast, Alert, Locale, Profile, Theme)
├── hooks/        → Custom hooks (polling, schedule, alerts, tech params)
├── pages/        → Route-level page components
├── services/     → Client-side caches
├── styles/       → Global CSS + AG Grid theme
└── utils/        → Time helpers, parsers

server/src/
├── config/       → Environment configuration
├── middleware/    → Express middleware (auth, logging, errors)
├── routes/       → API route handlers
├── services/     → Business logic (auth, config, forecast, FTP, schedule)
├── store/        → Session store
├── utils/        → Parsers, HTTP client
├── workers/      → Background workers (file watcher)
└── websocket.ts  → Socket.io setup

shared/src/
├── types/        → TypeScript interfaces shared between client & server
└── constants/    → Defaults, translations, endpoints
```
