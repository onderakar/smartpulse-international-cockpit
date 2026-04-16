# Design Validation & Compliance

> **Part of**: [concepts/](./_index.md) · **Lines**: ~150 · **Last updated**: 2026-04-15

## Design Validation Checklist

| # | Rule | Area | Priority | Concept File |
|---|------|------|----------|--------------|
| 1 | Timezone hardcode edilmemeli — Group/company timezone kullanilmali, DST desteklenmeli | Timezone | :red_circle: Critical | [asset-topology/README.md](asset-topology/README.md) |
| 2 | GCP seviyesinde portalPlantId olmamali — sadece component seviyesinde | Asset Topology | :red_circle: Critical | [asset-topology/data-models.md](asset-topology/data-models.md) |
| 3 | Ulke/piyasa hardcode edilmemeli — market-agnostic, region login'de belirlenir | Architecture | :red_circle: Critical | [profile/README.md](profile/README.md) |
| 4 | UI'da hardcoded string olmamali — tum text `t('key')` ile i18n uzerinden | UI | :yellow_circle: Moderate | — |
| 5 | Default resolution 15dk — tum time-series feature'lar 15dk desteklemeli | Time Series | :red_circle: Critical | [asset-topology/data-models.md](asset-topology/data-models.md) |
| 6 | IDM revision dedup zorunlu — IntradayTransaction `remoteTradeId` ile upsert | Intraday | :red_circle: Critical | [intraday/data-models.md](intraday/data-models.md) |
| 7 | Net pozisyon hesabi: buy(+) sell(-) — yon karistirilmamali | Intraday | :red_circle: Critical | [intraday/README.md](intraday/README.md) |
| 8 | Session olmadan API cagrisi kabul edilmemeli — `sessionAuth` middleware zorunlu | Auth | :red_circle: Critical | [profile/README.md](profile/README.md) |
| 9 | Group izolasyonu — bir kullanici baska Group'un verisine erisememeli | Auth | :red_circle: Critical | [profile/README.md](profile/README.md) |
| 10 | AG Grid cellRenderer JSX dondurmeli — HTML string render edilmez | UI | :yellow_circle: Moderate | — |

## Compliance Check

| Step | Check | Priority |
|------|-------|----------|
| 1 | Ownership registry matches README declarations | :green_circle: Minor |
| 2 | Terminology consistent across all files | :yellow_circle: Moderate |
| 3 | Cross-references and links valid | :green_circle: Minor |
| 4 | Rules don't contradict across files | :red_circle: Critical |
| 5 | Data models aligned with canonical owners | :yellow_circle: Moderate |

### Priority Levels

| Priority | Criteria |
|----------|----------|
| :red_circle: **Critical** | Contradictory rules; security violation; wrong implementation |
| :yellow_circle: **Moderate** | Inconsistent terminology, outdated names |
| :green_circle: **Minor** | Missing links, formatting, declarations |

## Validation Workflow

1. **STOP** — Do not implement the violating change
2. **DOCUMENT** — Explain which rule is violated and why
3. **ASK** — Request explicit permission to proceed
4. **Only proceed** if the user explicitly confirms the override

## Key Search Patterns

| Rule | Search Pattern | Expected |
|------|---------------|----------|
| No hardcoded timezone | `UTC+3`, `Europe/Istanbul` hardcoded | Should use group/company timezone |
| No portalPlantId on GCP | `primaryPortalPlantId` on GCP type | Should not exist |
| No hardcoded country | `Bulgaria`, `Turkey` hardcoded in logic | Should be market-agnostic |
| Session auth on routes | `router.get\|post` without `sessionAuth` | All routes must have sessionAuth |
| IDM dedup | `remoteTradeId` in upsert/where | Must use remoteTradeId for dedup |
| i18n strings | Hardcoded UI text without `t()` | All UI text via `t('key')` |
| AG Grid JSX | `cellRenderer` returning string | Must return JSX |

## Full Codebase Audit

Trigger: "Conduct a full platform concepts audit"

1. Read all concept files via `_index.md`
2. For each checklist item, search codebase for implementations
3. Verify they follow documented rules
4. Report: `| Area | File:Line | Issue | Concept Violated |`

## Related Files

| Topic | File |
|-------|------|
| Navigation hub | [_index.md](./_index.md) |
| Entity ownership | [_ownership.md](./_ownership.md) |
| Creating concepts | [_contributing.md](./_contributing.md) |
