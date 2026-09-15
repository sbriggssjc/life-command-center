# Migration-coverage map — which repo watches which database for unapplied migrations

**Created 2026-09-16 (DEPLOY2-coverage).** One short table, kept short on purpose. It exists so the
**uncovered** database is *visible and attributed* rather than quietly absent — the failure this
whole arc is about is a check that looks like it ran.

Linked from the `migration_unapplied` rule header in
[`scripts/build-brief-collector.mjs`](../../scripts/build-brief-collector.mjs).

## The three Supabase projects

| database | ref | repo that OWNS its schema objects | unapplied-migration detector | where it lives |
|---|---|---|---|---|
| **LCC Opps** | `xengecqvemvfknjvbvrq` | `life-command-center` | ✅ **yes** | `scripts/build-brief-collector.mjs` → `migration_unapplied`, probing `lcc_probe_schema_objects` (migration `20260916120100`) |
| **Dialysis_DB** | `zqzrriwuavgrquhisnoa` | `life-command-center` (per `CLAUDE.md` ownership table; see [`ID3a-d-dia`](../os/PLANNED-BACKLOG.md) for the open question of whether the `Dialysis` repo should take it) | ✅ **yes, since 2026-09-16** | same rule, routed by target database; probe RPC ported as `supabase/migrations/dialysis/20260916130000_dia_deploy2_migration_probe_rpc.sql` |
| **government** | `scknotsqkcheojiaewwh` | **`government-lease`** (Scott, 2026-09-12, ID3a-d) | ❌ **NO — nothing watches it** | not built. Backlog **GOVDEPLOY1** 👤 — the correct owner is `government-lease`, not this repo |

## Why the government project has no detector here — and why that is a decision, not an oversight

`GOV_SUPABASE_URL` / `GOV_SUPABASE_KEY` **are** present in this repo's Production environment, so
building it here is possible. Scott declined it on 2026-09-16: `life-command-center` auditing a
database it deliberately handed over on 2026-09-12 is the exact ownership confusion ID3a-d ended.

⛔ **Do not close the gap by scanning `supabase/migrations/government/`.** That directory is retired
and [its own README](../../supabase/migrations/government/README.md) states that re-applying its
files *"would silently restore two known-bad mappings"* (`TEXAS DEPARTMENT OF AGRICULTURE` →
`USDA`; `Immigration & Customs Enforcement` → `CBP`). A detector reading those stale files would
report the **live, correct** government database as wrong.

Machinery to port when `government-lease` picks this up: `lcc_probe_schema_objects(jsonb)` plus
`parseDeclaredObjects` / `classifyMigrationApplication` / `migrationTargetDatabase` /
`sortMigrationsByAddDate` from the collector — and the three window lessons DEPLOY2-coverage paid
for (git add-date, not filename sort; an unknown add-date sorts NEWEST; route by target and fail
closed).

## ⚠️ The root-prefix asymmetry — "government is out of scope" ≠ "no file here touches it"

Only the first of those two statements is true, and conflating them is a live false-positive
generator.

**31 root-level migrations in `supabase/migrations/` carry a `gov_` or `dia_` prefix** and target
the *other two* projects — measured 2026-09-16: 11 `gov_`, 20 `dia_`. Examples:

```
20260812120000_gov_credit_classifier_expand_state_federal.sql
20260811191115_gov_dom_pct_ask_density_display_policy.sql
20260808120000_dia_prompt78_property_documents_source.sql
```

Probed live, the first declares `public.gov_credit_buckets_from_text`, which is **absent from LCC
Opps (count 0)**. So *"root → LCC Opps"* — the rule the detector shipped with — emits a **false
`unapplied` at `critical`**, the loudest severity on the most trusted rule, about a migration that
is perfectly applied to the database it was written for.

It never fired only because **0 of those 31 fell inside the filename-sorted window**. That was luck,
not design, and the git-add-date window destroys it: the window reshuffles, and any *new* root-level
`gov_`/`dia_` file lands in scope immediately.

Hence the routing rule, in `migrationTargetDatabase()`:

- **directory first** — `dialysis/` → Dialysis_DB, `government/` → government;
- **then the first filename token after the timestamp** — `lcc_` → LCC Opps, `gov_`/`government_` →
  government, `dia_`/`dialysis_` → Dialysis_DB;
- **anything else fails CLOSED** — a `cm_`, `field_`, `property_`-prefixed root file is emitted as
  **UNVERIFIABLE with the reason "target database undetermined"**, never defaulted to LCC Opps.
  Defaulting is what produces the false critical, and a rule that guesses wrong loudly is worse than
  one that says it does not know.

A file routed to **government** is likewise emitted as UNVERIFIABLE, naming GOVDEPLOY1 — it is never
probed against LCC Opps, and this repo does not probe the government project at all.

## What "no detector" costs, stated plainly

A migration merged to `main` in `government-lease` and never applied to the government database is
invisible to every automated check in either repo today. That is the same class as HP1-P1a-fix,
OWNERGAP1 and XB2-precision — three occurrences in one week on the two projects that *do* have a
detector now.
