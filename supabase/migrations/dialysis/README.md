# LIVE — this directory owns Dialysis_DB schema objects, and this repo applies them

**Written 2026-09-16 (DEPLOY2-coverage), as the deliberate MIRROR of
[`../government/README.md`](../government/README.md).** Those two directories sit side by side and
looked identical at a glance; they are opposites, and the cost of that resemblance is measured
below.

`life-command-center` **owns** the schema objects of **Dialysis_DB (`zqzrriwuavgrquhisnoa`)**, per
`CLAUDE.md` → "ONE REPO OWNS EACH DATABASE'S OBJECTS":

> | Dialysis_DB | **`life-command-center`** | where the work happens: operator registry, aliases, write guards, comps engine, market-brief producers. The Dialysis repo owns its CMS/NPI **ingestion** (rows, not schema) — if it needs a schema change, it lands here |

So: **new dia schema work belongs here, is applied from here, and is live.**

## Why this file exists — the detector could not see its own incident

The `migration_unapplied` build-brief rule (`scripts/build-brief-collector.mjs`) shipped 2026-09-16
scanning `supabase/migrations/` **root only**, justified in its own header as:

> `dialysis/` and `government/` are historical copies of a database owned by another repo per this
> repo's own "ONE REPO OWNS EACH DATABASE'S OBJECTS" doctrine

That sentence is **true of `government/` and false of this directory.** The `government/`
retirement was generalized here without checking. Measured 2026-09-16:

| directory | README | files carrying `HISTORICAL — DO NOT RE-APPLY` | retirement guard |
|---|---|---|---|
| `../government/` | yes | every file (guard-enforced) | `test/gov-migrations-directory-retired.test.mjs` |
| **this directory** | **none (until now)** | **0 of 282** | **none — and none is wanted** |

The consequence was exact, not hypothetical:
[`20260914150000_dia_ownergap1_fabricated_owner_quarantine.sql`](./20260914150000_dia_ownergap1_fabricated_owner_quarantine.sql)
is **OWNERGAP1** — one of the three "merged but never applied" incidents that motivated the
detector in the first place — and its own header calls it *"the containment that IS in scope from
this repo."* The detector built to catch that class **structurally could not see it.**

## Rules for this directory

- **Applying files here is normal and expected.** They target Dialysis_DB. Nothing here is
  historical, and **no file here carries (or should carry) the `HISTORICAL — DO NOT RE-APPLY`
  marker** — that marker belongs to `../government/` alone.
- **There is deliberately NO retirement guard for this directory.** `government/` has one because
  re-applying a file there would silently restore two known-bad agency mappings; the situation here
  is the opposite. Do not add a guard modelled on the gov one.
- **The build-brief `migration_unapplied` rule scans this directory** and probes what it finds
  against **Dialysis_DB**, not LCC Opps (routing by target database —
  `migrationTargetDatabase()`). The probe RPC it calls here is
  [`20260916130000_dia_deploy2_migration_probe_rpc.sql`](./20260916130000_dia_deploy2_migration_probe_rpc.sql);
  read that file's header before changing its grants (they intentionally differ from the LCC copy's,
  and the difference is time-bounded by GitHub issue #720 Phase 4).
- **`dia_`-prefixed migrations also exist at the ROOT of `supabase/migrations/`** (20 of them, plus
  11 `gov_`-prefixed). Those are routed by filename prefix, not by directory — see
  [`docs/architecture/MIGRATION-COVERAGE-MAP.md`](../../../docs/architecture/MIGRATION-COVERAGE-MAP.md).
  "Root → LCC Opps" is not true and never was.
- **Still open (`ID3a-d-dia`, `docs/os/PLANNED-BACKLOG.md` §P0d):** whether the `Dialysis` repo
  should instead be recorded as Dialysis_DB's formal owner, which would make this directory
  historical the way `government/` is. Scott has not been asked. **Until he is, this directory is
  live** — and the OWNERGAP1 blind spot above is exactly what an unasked assumption costs.
