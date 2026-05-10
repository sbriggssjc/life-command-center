# Supabase Consolidation Plan

> Status: **planning only** — nothing in this branch is destructive.
> Branch: `claude/consolidate-supabase-projects-MJG3K`.
> Last reviewed: 2026-05-10.
>
> Pairs with `LONG_TERM_HOSTING_STRATEGY.md` (Months 2–3 sequencing entry).
> Cross-references `EDGE_FUNCTION_AUDIT.md` for the per-function URL inventory.

## Goal

Collapse three Supabase Pro projects into one, saving **$50/mo recurring**
and removing cross-region traffic for cross-domain queries. The savings
is exactly the same as the LCC compute spend (~$5–$7/mo) repeated ten
times — by far the largest single line item still on the table.

This doc is **planning only**. Nothing here is executed automatically.
All destructive steps are gated behind explicit sign-off (see
§ "Stop-and-check-in points").

## Verified current state (2026-05-10)

| Project | Ref | Region | Postgres | Status | Created |
|---|---|---|---|---|---|
| `Dialysis_DB` | `zqzrriwuavgrquhisnoa` | us-west-1 | 15.8 | ACTIVE_HEALTHY | 2025-02-25 |
| `government` | `scknotsqkcheojiaewwh` | us-west-2 | 17.6 | ACTIVE_HEALTHY | 2026-03-05 |
| `LCC Opps` | `xengecqvemvfknjvbvrq` | us-east-1 | 17.6 | ACTIVE_HEALTHY | 2026-03-17 |

All three live in the same Supabase organization
(`eanpbvwguwcjtpjbgtml`), which simplifies billing, RLS roles, and
org-level auth.

**Postgres version mismatch**: Dialysis_DB is on PG15.8, the other two
on PG17.6. The consolidated project will be PG17 (latest GA).
Dialysis data migrates forward — PG17 is a strict superset of PG15
functionality, so this is safe, but Phase 0 should run a `pg_dump`
restore test against a PG17 sandbox before the real migration.

## Target topology

One Supabase Pro project, region us-west-2 (matches majority of current
load), Postgres 17, with logical schemas:

| Schema | Replaces | What it holds |
|---|---|---|
| `gov` | `government` project's `public` schema | Government lease data, properties, ownership, prospect leads |
| `dia` | `Dialysis_DB`'s `public` schema | Dialysis clinics, NPI registry, leases, sales transactions |
| `lcc` | `LCC Opps`'s `public` schema | Operational entities, inbox, queue, action items |
| `ops` | `LCC Opps`'s admin/operational tables (subset) | Workspace memberships, sync errors, signals, context_packets |
| `<future_n>` | net-new | Each new subspecialty (industrial NNN, retail NNN, medical office) gets its own schema in this same project |

Future subspecialties are added as new schemas, **not** new projects.
The entire architecture stays at $25/mo until Supabase Pro caps hit
(8 GB DB, 250 GB egress/month). At ~80 MB combined data today, that's
~100x headroom.

## Region decision

Consolidate into **us-west-2** (matches existing `government` project).

Rationale:
- 2 of 3 projects already in us-west (us-west-1 + us-west-2)
- LCC Opps moves us-east → us-west; LCC Opps is the smallest by data
  volume so the egress bill for the one-time migration is cheapest
  here
- Cross-region calls today add 60–120 ms per query (us-east↔us-west);
  consolidating into us-west collapses that to in-region (~1–5 ms)
- Team is geographically central US; us-west-2 vs us-east-1 latency
  difference for end users is minor (~30 ms) compared to the
  cross-region savings between services

Alternatives considered:
- **us-east-1** (LCC Opps's current region): would force the larger
  `government` and `Dialysis_DB` data sets to migrate cross-region,
  larger one-time egress cost
- **us-west-1** (Dialysis_DB's current region): same idea but the
  region is older and has fewer Supabase features; us-west-2 is the
  modern equivalent

## Schema-per-domain vs database-per-domain

Use **schema-per-domain**.

| | Schema-per-domain | Database-per-domain |
|---|---|---|
| Cross-domain queries | Native: `SELECT ... FROM gov.properties JOIN dia.clinics` | Requires Foreign Data Wrapper (FDW) setup |
| Backup | One backup, one restore | One per database |
| Connection pool | One | One per database |
| RLS surface | Per-schema policies | Per-database policies |
| Operational complexity | Low | Medium |
| Blast radius isolation | Schema-level (via RLS + roles) | Database-level (stronger) |
| Cost | $25/mo total | $25/mo total |

Schema-per-domain wins on operational simplicity and native
cross-domain query support. Cross-domain joins are already used today
in LCC's data-query proxy and the copilot context broker; FDW would
make those slower.

## RLS strategy

Each domain schema gets its own policy set, scoped to `workspace_id`
(LCC's existing pattern in the `lcc` schema).

Gov and Dia data is currently mostly read-by-app, write-by-cron and
doesn't have workspace_id columns. Two options:

1. **Add `workspace_id` columns** to gov/dia tables during migration
   and backfill from a default workspace. Most flexible long-term —
   supports multi-tenant subspecialty separation if you ever sell or
   spin off a vertical.
2. **Schema-level grants** instead of row-level. Service-role keys
   read freely; read-only roles get SELECT on entire schemas. Simpler
   today; less future-proof.

**Recommendation**: option 2 for gov/dia (preserve current behavior),
option 1 for `lcc` and `ops` (already workspace-scoped). Reassess if
you ever onboard a third-party subspecialty operator.

## Migration sequence (7 phases)

### Phase 0 — Pre-flight (1 day)

1. Stand up new "consolidated" Supabase Pro project in us-west-2,
   PG17. Get its project ref + connection string.
2. Take Supabase backups of all three source projects via
   `supabase db dump` or the dashboard. Store in S3 / Drive.
3. Inventory edge function project URLs — see `EDGE_FUNCTION_AUDIT.md`
   for the 21-function list.
4. Inventory PA flow targets that hit Supabase project URLs **directly**
   (not via LCC server.js).
5. Inventory `.env` files in the LCC repo and on Render/Railway for
   any `*_SUPABASE_URL` / `*_SUPABASE_KEY` references.
6. Run a PG15 → PG17 `pg_dump`/`pg_restore` test against a sandbox
   to confirm Dialysis schema migrates cleanly. Look for deprecated
   syntax (e.g., `WITH OIDS`, `int8` aliases that changed in PG17).

**Stop and check in with user before Phase 1.**

### Phase 1 — Schema setup (2 hours)

Against the new consolidated project:

1. Run `consolidation/sql/00_schema_setup.sql` (this branch) to
   create `gov`, `dia`, `lcc`, `ops` schemas + grants.
2. Provision RLS roles (mirror existing roles from LCC Opps).
3. Create a `workspace_id` column on a sample lcc table to validate
   the policy template.

### Phase 2 — Data migration (4–8 hours one weekend)

For each source project, in order:

1. **government** (smallest, simplest, oldest data — lowest risk first)
   - `pg_dump --schema=public --no-owner -F custom` from
     `db.scknotsqkcheojiaewwh.supabase.co`
   - Run a `sed` rewrite: `public.` → `gov.` in the dump
   - `pg_restore` into the consolidated project's `gov` schema
   - Verify row counts: `SELECT COUNT(*)` on each table on both
     sides, must match exactly

2. **Dialysis_DB** (largest, also the cross-version migration)
   - Same flow with `public.` → `dia.`
   - Watch for PG15→17 syntax surprises during restore
   - Verify row counts

3. **LCC Opps** (most active writes — do this last during a quiet window)
   - Split: `public.` operational tables → `lcc.` schema
   - Workspace/sync/signals tables → `ops.` schema
   - Verify row counts

Budget 8 hours total for this. The actual `pg_dump`/`restore` is fast
(seconds for ~80 MB total); the time goes to verification.

### Phase 3 — Edge function migration (3 hours)

For each function listed in `EDGE_FUNCTION_AUDIT.md`:

1. Update `Deno.env.get("...SUPABASE_URL")` references in the function
   source. Most use `OPS_SUPABASE_URL` / `GOV_SUPABASE_URL` /
   `DIA_SUPABASE_URL` env vars; consolidate to a single `SUPABASE_URL`
   plus optional schema-prefix env var (e.g., `LCC_DEFAULT_SCHEMA`).
2. Update SQL queries that hit `public.foo` to use `gov.foo`,
   `dia.foo`, `lcc.foo` as appropriate.
3. Redeploy each function to the **consolidated** project (not the
   source projects).
4. Test each via its `?action=health` route.
5. Delete the old project's edge function only after the consolidated
   one is verified working (Phase 6).

Reuse `EDGE_FUNCTION_AUDIT.md` Gap E here — the LCC Opps duplicates
should be retired during this phase, not migrated.

### Phase 4 — Application layer (1 hour)

1. Update LCC `server.js` env vars on Railway (or Render):
   - `OPS_SUPABASE_URL`, `OPS_SUPABASE_KEY` → consolidated values
   - `GOV_SUPABASE_URL`, `GOV_SUPABASE_KEY` → consolidated values
   - `DIA_SUPABASE_URL`, `DIA_SUPABASE_KEY` → consolidated values
   - All four point at the same project URL, possibly with different
     schema search paths configured per query
2. Update `EDGE_FUNCTION_URL` to point at the consolidated project's
   `ai-copilot` function.
3. Update PA flows that hit Supabase URLs directly (likely few, most
   go through LCC).
4. Update `.env.example` with the new env-var pattern (single URL,
   schema-aware).

### Phase 5 — Dual-running validation (1 week)

During this week, application code reads from consolidated and writes
to **both** old and new (transparent dual-write at the LCC server
layer). Daily reconciliation:

- Row counts match between source and consolidated for every table
- Sample diff (10 random rows per table per domain): zero
- Edge function logs show no schema-resolution errors
- LCC daily briefing renders correctly
- Cross-domain queries work (e.g., `gov.properties` JOIN
  `dia.clinics` via property_id)
- PA flows still complete
- Office Add-ins still work
- AI copilot returns same context as before (compare side-by-side)

Hold any production schema changes for the duration of this window.

### Phase 6 — Cut-over (30 min)

**Stop and check in with user before Phase 6.**

1. Stop the dual-write code path; LCC writes only to consolidated.
2. Run a final reconciliation check (row counts + sample).
3. Pause source projects via Supabase dashboard — do **not** delete
   yet. Pausing keeps the data + DB intact for fast un-pause if a
   regression appears in the next 1–2 weeks.
4. Deploy the dual-write removal commit.

### Phase 7 — Retirement (after 1–2 weeks of stable operation)

**Stop and check in with user before Phase 7.**

1. Cancel `Dialysis_DB` and `government` Pro subscriptions.
2. Delete the old projects from Supabase dashboard.
3. Update LCC `INFRASTRUCTURE.md` to reflect the consolidated topology.
4. **Saves $50/mo recurring** going forward.

## Edge function URL inventory (cross-ref `EDGE_FUNCTION_AUDIT.md`)

Post-consolidation, all edge functions live on the consolidated
project. Inventory of what gets migrated vs deleted:

**Migrate to consolidated** (16 unique functions, post-stub-deletion):
- From `Dialysis_DB`: `ai-copilot`, `salesforce-enrichment`,
  `lead-ingest`, `intake-receiver`, `copilot-chat`, `template-service`,
  `data-query`, `daily-briefing`, `npi-lookup`, `npi-registry-sync`,
  `context-broker`, `health-check`
- From `government`: `bulk-import-awards`, `sam-entity-lookup`
- From `LCC Opps` (unique only): `availability-checker`

**Delete during consolidation** (5 functions):
- `Dialysis_DB`: `sf-test`, `test-function`, `ai-copilot-v2` (stubs;
  see Edge Function Audit)
- `LCC Opps`: `context-broker`, `daily-briefing`, `data-query`
  (duplicates of Dialysis_DB versions; Gap E)

## Power Automate flow inventory (Phase 0 task)

Most PA flows hit LCC's `server.js` rather than Supabase directly, so
the expected count of PA flows needing URL updates is **low**.
Phase 0 should grep PA flow exports for any `*.supabase.co` URLs to
confirm.

Known direct-to-Supabase PA targets to verify:
- `?action=outlook-message` on `intake-receiver` (Dialysis_DB) — if
  PA's flagged-email flow is configured with the edge URL directly
  rather than via LCC, this needs updating
- `?action=rcm` / `?action=loopnet` on `lead-ingest` (Dialysis_DB)
  — same question

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PG15 → PG17 migration surprises Dialysis_DB | Low | Medium | Phase 0 sandbox restore test; run before scheduling Phase 2 |
| Cross-region egress bill spike during migration | Low | Low | Tiny data volume (~80 MB total); migration egress fee is pennies |
| Edge function URL update misses one caller | Medium | Medium | Phase 0 inventory + Phase 5 dual-running window catches this |
| RLS policy mismatch causes data-leak between schemas | Low | High | Per-schema policy review; verify with `SET ROLE` tests |
| `workspace_id` backfill on gov/dia introduces NULLs | Medium | Low | Use schema-level grants for gov/dia (no workspace_id needed) |
| LCC writes to old project after cut-over | Low | Medium | Pause (don't delete) source projects; un-pause restores in <5 min |
| PA flow hits stale URL post-migration | Medium | Medium | Phase 5 dual-running; post-cutover monitoring of PA flow run history |

## Rollback plan

If Phase 5 dual-running reveals data drift or performance issues:
- Don't pause source projects yet
- Stop dual-write
- Revert LCC `server.js` env vars to source-project URLs
- Investigate before retrying

If Phase 6 cut-over shows issues:
- Source projects are paused (not deleted)
- Un-pause via dashboard, point env vars back, write resumes against
  source projects
- Total recovery: ~10 min if caught fast

If Phase 7 retirement was premature:
- After Phase 7, source projects are gone. Restore from the Phase 0
  backup into a new Supabase project. Recovery: ~hours, not minutes
- Hence the 1–2 week wait between Phase 6 and Phase 7

## Validation checklist for dual-running (Phase 5)

Daily during the week:

- [ ] Row counts match (every table, every domain)
- [ ] Sample diff zero (10 random rows per table)
- [ ] All RPC functions callable on consolidated project
- [ ] Edge function logs show no schema-resolution errors
- [ ] LCC daily briefing renders correctly
- [ ] Cross-domain queries work (gov ↔ dia, gov ↔ lcc)
- [ ] PA flows still complete (run a test of each named flow)
- [ ] Office add-ins still work
- [ ] AI copilot returns context comparable to baseline
- [ ] No new entries in LCC `sync_errors` table

Four green days in a row → ready for Phase 6.

## Timeline estimate

| Phase | Wall-clock | Active work |
|---|---|---|
| Phase 0 (pre-flight) | 1 day | 4–6 hours |
| Phase 1 (schema setup) | 2 hours | 2 hours |
| Phase 2 (data migration) | 1 weekend | 4–8 hours |
| Phase 3 (edge functions) | 3 hours | 3 hours |
| Phase 4 (app layer) | 1 hour | 1 hour |
| Phase 5 (dual-running validation) | 1 week | 30 min/day |
| Phase 6 (cut-over) | 30 min | 30 min |
| Phase 7 (retirement) | 1–2 weeks elapsed | 30 min |
| **Total** | **~3 weeks elapsed** | **~2–3 days active** |

## Stop-and-check-in points

The user must explicitly approve before:

1. **Phase 1 start** (creating the new consolidated project — the
   only point that incurs new cost; ~$25 prorated on the first month)
2. **Phase 6 cut-over** (destructive in spirit — changes prod write
   target)
3. **Phase 7 retirement** (the savings happen here; also irreversible
   without a restore from backup)

No migration work is done in this branch. This is a planning artifact.
