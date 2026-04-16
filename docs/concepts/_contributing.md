# Contributing to Concept Documentation

> **Part of**: [concepts/](./_index.md) · **Lines**: ~120 · **Last updated**: 2026-04-15

## 8-Step Creation Checklist

1. **Create folder** — `docs/concepts/<name>/` with `README.md` + `data-models.md`
2. **Write README** — Summary, owned entities, referenced-by list
3. **Write data-models** — Entity schemas, field definitions, relationships
4. **Declare ownership** — Add entities to `_ownership.md`
5. **Update `_index.md`** — Add rows to all navigation tables
6. **Add cross-references** — Link to/from related concept files
7. **Run self-audit** — Execute the 7-category audit below
8. **Fix issues** — Resolve anything the audit flags before marking complete

## Rules

| Rule | Requirement |
|------|-------------|
| File size | Each file MUST be <400 lines |
| Single source | Entity schemas only in `data-models.md`, link elsewhere |
| No duplication | Link to authoritative source, never copy content |
| Header format | `> **Part of**: ... · **Lines**: ~XXX · **Last updated**: YYYY-MM-DD` |
| Ownership | Every README must declare "Owned Entities" and "Referenced By" |

---

## 7-Category Self-Audit

| # | Category | What to Check |
|---|----------|---------------|
| 6.1 | Structure | Files <400 lines; README.md exists; data-models.md if entities; headers present |
| 6.2 | Content | Entity defined in ONE data-models.md only; all links resolve; Related Files populated |
| 6.3 | Index | _index.md tables updated: task nav, entity nav, concept overviews, file tree |
| 6.4 | Cross-Refs | Outbound links to related concepts; inbound links exist; reachable from _index.md |
| 6.5 | Consistency | Entity names identical everywhere; field names match; no contradictions |
| 6.6 | Global Index | _index.md <400 lines; all folders in tree; all entities in nav; overviews complete |
| 6.7 | Ownership | README has "Owned Entities" + "Referenced By"; matches _ownership.md exactly |

**On failure:** Fix immediately, re-run check, continue audit, report fixes.

## Related Files

| Topic | File |
|-------|------|
| Navigation hub | [_index.md](./_index.md) |
| Ownership | [_ownership.md](./_ownership.md) |
| Validation | [_validation.md](./_validation.md) |
