# Supabase Consolidation — Phase 0 Inventory

> Phase 0 of the migration plan in `SUPABASE_CONSOLIDATION_PLAN.md`.
> Status: **in progress**. Some inventory items I can complete from
> the repo (committed below); two items require user actions in
> external dashboards (flagged at the bottom).
>
> Goal of Phase 0: gather every fact needed to confidently provision
> the consolidated project (Phase 1) and migrate data (Phase 2). No
> destructive moves.

## Phase 0 deliverable summary

| Inventory item | Source | Status |
|---|---|---|
| Supabase project regions, IDs, PG versions | Supabase API (`list_projects`) | ✅ done (in plan doc) |
| Edge function inventory + URLs | `EDGE_FUNCTION_AUDIT.md` | ✅ done |
| LCC env-var references (all `*_SUPABASE_*`) | `api/_shared/*-db.js`, `server.js`, `.env.example` | ✅ done (this doc) |
| Postgres 15 → 17 dialect compatibility test | `pg_dump`/`pg_restore` against Dialysis dump in PG17 sandbox | ⛔ **needs user** |
| Power Automate flow audit | PA flow exports / dashboard | ⛔ **needs user** |
| Provisioning sign-off for new consolidated project | User decision | ⛔ **needs user** |

All three remaining items are no-code; they're administrative checks
in external systems plus one explicit go/no-go decision.

## 1. Verified Supabase project state (cross-ref `SUPABASE_CONSOLIDATION_PLAN.md`)

| Project | Ref | Region | Postgres | Org |
|---|---|---|---|---|
| `Dialysis_DB` | `zqzrriwuavgrquhisnoa` | us-west-1 | 15.8 | `eanpbvwguwcjtpjbgtml` |
| `government` | `scknotsqkcheojiaewwh` | us-west-2 | 17.6 | `eanpbvwguwcjtpjbgtml` |
| `LCC Opps` | `xengecqvemvfknjvbvrq` | us-east-1 | 17.6 | `eanpbvwguwcjtpjbgtml` |

All three live in the same org, simplifying RLS roles and billing.

## 2. Edge function inventory (cross-ref `EDGE_FUNCTION_AUDIT.md`)

Post-consolidation, 16 unique edge functions move to the consolidated
project; 5 are deleted along the way (3 stubs + 2 LCC Opps duplicates,
the third duplicate is the `daily-briefing` clone).

**Migrate to consolidated** (16 functions):

From `Dialysis_DB`:
- `ai-copilot`, `salesforce-enrichment`, `lead-ingest`,
  `intake-receiver`, `copilot-chat`, `template-service`, `data-query`,
  `daily-briefing`, `npi-lookup`, `npi-registry-sync`,
  `context-broker`, `health-check`

From `government`:
- `bulk-import-awards`, `sam-entity-lookup`

From `LCC Opps`:
- `availability-checker` (the only unique function on this project)

**Delete during consolidation** (5 functions):
- `Dialysis_DB`: `sf-test`, `test-function`, `ai-copilot-v2` (stubs)
- `LCC Opps`: `context-broker`, `daily-briefing`, `data-query`
  (duplicates of Dialysis_DB versions; "Gap E" in the audit)

## 3. LCC env-var inventory

Every place LCC server-side code talks to a Supabase project goes
through one of these env vars. All references are environment-variable
based; no Supabase URL is hardcoded in the API handlers themselves.

### Variables to update (Phase 4 of the plan)

After consolidation, all six `*_URL` / `*_KEY` variables point at the
same consolidated project. Schema selection happens at the query
layer (e.g., `rest/v1/gov.properties` or via `Postgrest.schema('gov')`).

| Env var | Today | After consolidation |
|---|---|---|
| `OPS_SUPABASE_URL` | `LCC Opps` (xengecqvemvfknjvbvrq) | consolidated project URL |
| `OPS_SUPABASE_KEY` / `OPS_SUPABASE_SERVICE_KEY` | `LCC Opps` service role key | consolidated service role key |
| `GOV_SUPABASE_URL` | `government` (scknotsqkcheojiaewwh) | consolidated project URL |
| `GOV_SUPABASE_KEY` | `government` service role key | consolidated service role key |
| `DIA_SUPABASE_URL` | `Dialysis_DB` (zqzrriwuavgrquhisnoa) | consolidated project URL |
| `DIA_SUPABASE_KEY` / `DIA_SUPABASE_SERVICE_KEY` | `Dialysis_DB` service role key | consolidated service role key |
| `EDGE_FUNCTION_URL` | `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot` | `https://<consolidated_ref>.supabase.co/functions/v1/ai-copilot` |

**Decision needed**: do we keep the three `OPS/GOV/DIA` env-var pairs
(easier compatibility — no code changes) or collapse to a single
`SUPABASE_URL`/`SUPABASE_KEY` (cleaner)? Recommendation: keep all three
pairs pointing at the same URL/key during Phases 4–7; collapse later
as a separate refactor if desired. Avoids touching every handler.

### Where these env vars are referenced

Verified by directory listing of `api/_shared/`:
- `api/_shared/ops-db.js` (7.7 KB) — OPS DB client wrapper
- `api/_shared/domain-db.js` (3 KB) — GOV/DIA DB client wrappers
- Edge function `_shared/supabase-client.ts` files — read same env vars
- `server.js` — imports the shared modules; doesn't reference URLs directly

Nothing references a hardcoded `*.supabase.co` URL in API handler code.
The only hardcoded references are:
- `EDGE_FUNCTION_URL` default in `copilot-chat` edge function (the
  `Dialysis_DB` URL appears as a fallback; replace with consolidated URL)
- CORS `ALLOWED_ORIGINS` in edge function shared modules (these are
  *frontend* URLs, not Supabase URLs; no change needed)

## 4. Postgres 15 → 17 sandbox compatibility test (user action)

**Why this matters**: `Dialysis_DB` runs PG15.8; the consolidated
project will run PG17. PG17 is a strict superset of PG15 functionality,
but a migration may surface deprecated syntax or removed features.

**What to run** (you, in a Supabase free-tier sandbox or local Docker):

```bash
# 1. Spin up a temporary PG17 sandbox
#    Option A: a temporary Supabase free-tier project (will pause in 7 days)
#    Option B: local Docker:
docker run --rm -d --name pg17-sandbox \
  -e POSTGRES_PASSWORD=test -p 5433:5432 \
  postgres:17

# 2. Dump the Dialysis_DB schema only (no data needed for the dialect test)
supabase db dump \
  --db-url 'postgres://postgres.zqzrriwuavgrquhisnoa:<REDACTED>@aws-0-us-west-1.pooler.supabase.com:6543/postgres' \
  --schema-only \
  -f dia_schema.sql

# 3. Restore against the PG17 sandbox
psql -h localhost -p 5433 -U postgres -f dia_schema.sql

# 4. Look for errors. Common things that surface:
#    - WITH OIDS clauses (removed in PG12)
#    - operator class changes
#    - extension version mismatches (e.g., postgis, pg_trgm)
```

**Expected outcome**: clean restore, no errors. If errors appear, list
them here and we'll triage in the consolidation plan before Phase 1.

**Time estimate**: 30 minutes if no errors; 2-4 hours if errors need
fixing.

## 5. Power Automate flow audit (user action)

**Why this matters**: most PA flows hit LCC's `server.js` (not Supabase
directly), so consolidation is transparent to them. But a few may hit
Supabase REST or edge function URLs directly. Those need their target
URL updated during Phase 4.

**What to check** (you, in the Power Automate dashboard):

For each PA flow listed under your account:

1. Open the flow definition
2. Search the JSON for `.supabase.co` (any host containing this string)
3. If found, note:
   - Flow name
   - Which Supabase project it targets (look at the host: `zqzrriwuavgrquhisnoa` = Dialysis, `xengecqvemvfknjvbvrq` = LCC Opps, `scknotsqkcheojiaewwh` = government)
   - Whether it's a REST URL (`/rest/v1/...`) or edge function URL (`/functions/v1/...`)

Known candidates to check first:
- LCC Flagged Email Intake (likely: hits LCC server.js, not Supabase)
- RCM Lead Webhook (could go directly to `lead-ingest` edge function)
- LoopNet Lead Webhook (same)
- Outlook task complete (likely: hits LCC server.js)
- Salesforce → LCC sync (likely: hits LCC server.js)

**Expected outcome**: 0–3 PA flows have direct Supabase URLs. Most use
LCC as an intermediary.

**Time estimate**: 15 minutes for a quick scan, 30 minutes if deep
inspection needed.

## 6. Phase 0 sign-off checklist

Ready to proceed to Phase 1 when **all** of these are checked:

- [x] Supabase project state verified via API
- [x] Edge function inventory complete
- [x] LCC env-var references inventoried
- [ ] PG15 → PG17 sandbox restore test passes
- [ ] PA flow audit complete; any direct-Supabase flows recorded
- [ ] User signs off on provisioning the consolidated project
  (Phase 1 starts the $25/mo billing on the new project; sources
  remain billed until Phase 7)

## What I need from you to close out Phase 0

Three concrete items, each <1 hour:

1. **Run the PG15 → PG17 sandbox restore test** (§ 4 above). Report
   any errors here as a follow-up commit.
2. **Audit PA flows for direct Supabase URLs** (§ 5 above). List any
   findings here.
3. **Approve provisioning the consolidated project**. When you say
   "go," I'll provision via the Supabase MCP (`create_project`),
   start it in us-west-2 with PG17, and run the Phase 1 schema-setup
   SQL committed in this branch.

After all three, Phase 1 takes 2 hours (already scripted) and Phase 2
is a one-weekend job.
