# LCC Error Triage — living board

_Opened 2026-07-28. Standing directive: complete architecture/build-out + triage all errors before un-parking
the per-broker delivery flow (Flow B). This is the master board; each slice is a self-contained sweep._

Severity: 🔴 critical (data exposure / breakage) · 🟠 high (systemic, needs a decision) · 🟡 medium (cleanup,
low risk) · ⚪ low / toggle. **"Triage" = enumerate + prioritize + assess blast radius; fixes are separate,
confirmed steps** (several below are security-setting or prod-DDL changes I won't apply unilaterally).

---

## Slice 1 — Supabase advisors (OPS project `xengecqvemvfknjvbvrq`) — ✅ RESOLVED 2026-07-28
Ran `get_advisors` security (577 lints) + performance (218 lints). Categorized below. **Scope caveat:** this is
the OPS/deal-spine database only; GOV and DIA projects + engine-runtime + PA-flow errors are later slices.

> **OUTCOME: security ERROR count 135 → 0.** Applied three migrations (below). Verified live afterward — the
> engine reads `lcc_users`/`bd_opportunities` (cadence-scan: 21 open, 4 overdue, unchanged) and a dozen `v_*`
> views (`get_pipeline_health` returned full data) via the **service_role** key, which bypasses RLS. **Zero
> breakage.** Root fact that made it safe: `OPS_SUPABASE_KEY` is the service_role key (decoded from `.env.local`),
> and the frontend/extension use the anon key **only for Supabase Auth**, never direct table reads (verified:
> `auth.js` only calls `.auth.*`; `public/` + `extension/` have zero `.from()` table reads).

### What was applied
1. `rls_lockdown_cortex_oauth_tokens` — 🔴 enabled RLS + revoked anon/authenticated on `cortex_oauth_tokens`
   (held `access_token`/`refresh_token` exposed via API). Now service_role-only.
2. `rls_enable_exposed_public_tables` — 🟠 enabled RLS on the other 33 exposed tables (deny-all for
   anon/authenticated; engine unaffected via service_role).
3. `views_security_invoker_on` — enabled `security_invoker = on` on all 100 flagged views (they now respect the
   caller's RLS; service_role still sees everything, anon/authenticated see nothing). Matviews auto-skipped.

### Remaining (all WARN/INFO — no ERRORs left) — next hardening pass, lower urgency
- **136 `rls_enabled_no_policy` (INFO)** — expected/intended: these backend tables are now deny-all for
  non-service roles. Only add policies if a table ever needs authenticated direct-read (none do today).
- **130 `function_search_path_mutable` (WARN)** + **103+103 anon/authenticated `security_definer_function_executable`**
  — set `search_path` on functions and revoke EXECUTE from anon/authenticated. Safe (engine calls via
  service_role) but 130 functions each need a light check, so staged as a deliberate pass, not a blanket ALTER.
- **2 `materialized_view_in_api`, 1 `extension_in_public`, 1 `auth_leaked_password_protection`** — minor toggles.

### 🟡 Performance (unchanged, deferrable) — 129 unused indexes, 39 unindexed FKs, 40 multi-permissive policies,
3 no-PK, 3 duplicate indexes. Revisit after the function hardening.

### 🔴 1. `cortex_oauth_tokens` — OAuth tokens exposed via API without RLS
Table holds `access_token` + `refresh_token`, sits in `public`, reachable through the PostgREST API, **no RLS**.
If the anon/publishable key is ever used client-side (extension sidebar, browser), these tokens are readable.
- **Blast radius: low to fix.** No engine/api code references `cortex_oauth_tokens` (grepped `mcp/`, `api/`), so
  enabling RLS with no policy (→ service-role-only access) should not break the deal engine.
- **Caveat before applying:** whatever *writes* the tokens (the Cortex OAuth flow — likely an edge function)
  must use the service_role key, or token storage breaks. Confirm that, then:
  ```sql
  alter table public.cortex_oauth_tokens enable row level security;
  -- no policy = only service_role can read/write; anon & authenticated are denied
  ```
- **Recommend:** fix first, after confirming the OAuth writer uses service_role. _Awaiting Scott's go._

### 🟠 2. Systemic: `public` schema broadly exposed (the big one — a decision, not a quick fix)
- **34 tables** RLS-disabled in `public` (`rls_disabled_in_public`) — incl. `lcc_users`, `cortex_*`, many
  `lcc_owner_*` reconcile tables, backups.
- **100 views** are `security_definer` (`security_definer_view`) — run with creator's rights, bypass caller RLS.
- **130 functions** with mutable `search_path` (`function_search_path_mutable`) + 103 anon- and 103
  authenticated-executable security-definer functions.
- **102** `rls_enabled_no_policy` (INFO) — RLS on, but no policy = currently deny-all for non-service roles.
- **Blast radius: HIGH / unknown until we confirm the OPS key type.** The engine's OPS connection uses
  `OPS_SUPABASE_KEY` (unlike GOV/DIA which explicitly prefer `*_SERVICE_KEY`). **If OPS uses service_role**,
  enabling RLS everywhere is safe (service_role bypasses RLS) — a clean hardening pass. **If OPS uses anon**,
  enabling RLS will break the engine's reads/writes and must be paired with per-table policies.
- **Next action (no DDL yet):** confirm whether Railway's `OPS_SUPABASE_KEY` is the service_role or anon key.
  That single fact decides whether #2 is a one-line-per-table hardening or a policy-authoring project.

### 🟡 3. Performance / hygiene (low risk, deferrable)
- 129 `unused_index` — drop candidates (reclaim write cost); verify not used by rare jobs first.
- 39 `unindexed_foreign_keys` — add covering indexes where the FK is queried.
- 40 `multiple_permissive_policies` + 3 `auth_rls_initplan` — policy consolidation once RLS strategy (#2) is set.
- 3 `no_primary_key` tables, 3 `duplicate_index` — quick cleanups.

### ⚪ 4. Toggles
- `auth_leaked_password_protection` off — enable in Auth settings (1 click; low urgency for a service DB).
- `extension_in_public` (1), `materialized_view_in_api` (2) — minor placement warnings.

**Slice 1 verdict:** one genuine 🔴 (oauth tokens, cheap to fix pending one confirmation); one 🟠 systemic RLS
posture that hinges on the OPS key type (need that fact before any DDL); the rest is low-risk cleanup that can
wait until the RLS strategy is decided.

---

## Slice 2 — Live operational alerts (surfaced by `get_pipeline_health`, 2026-07-28)
`get_pipeline_health` reports **16 open LCC automation alerts** — real recurring failures, the highest-signal
error surface after the DB. Grouped:

### 🟠 Recurring Power Automate flow failures — ROOT-CAUSED 2026-07-28 (browser run-history review)
**Single shared root cause: a Microsoft To-Do list was deleted/renamed, orphaning hardcoded list IDs in two
flows.** Both fail at a To-Do "List…" action with **404 NotFound** (the alert's `failed_action` was the skipped
downstream step, not the true failure). These run hourly/half-hourly, not just daily — failing every run.
- **`To Do - Life Command Center Sync`** (flow id `fee2a0fe-…`, Scheduled, hourly) — action
  **`List to-do's by folder (V2) 2`** returns **statusCode 404 / "Item not found"**. Inputs: connection
  `shared_todo`, op `ListToDosByFolderV2`, `folderId = AAMkADI4MzMxOTI5LTEyM2ItNGQ2MC1iNz…` (dead). The FIRST
  `List to-do's by folder (V2)` succeeds — only this second list ID is stale.
- **`LCC To Do Completion Poll`** (flow id `a77e7a00-…`, Scheduled, every 30 min — this is the alert's
  "Unflag Completed Email Tasks") — action **`List Flagged Tasks`** returns **NotFound**; downstream
  `Apply to each` (the alerted action) is skipped as a result. Uses the Office 365 Outlook + To-Do connections.

**Fix (Scott, in the flow editor — one per flow):** open the failing To-Do action and re-pick the correct list
from the folder/list dropdown. If the referenced To-Do list was intentionally deleted, either recreate it or
delete that action + its dependent branch. This is a To-Do list-ID repair; I can't pick the right replacement
list for you (and editing re-auths the connection), so it needs your hands. Repairing the list reference should
clear both flows at once since they share the cause.
- **`HTTP-Switch`** — failed once at "flow body" (07-28 17:00Z); single occurrence, likely transient — watch,
  don't fix yet.

### Cron / feed failures
- ✅ **`field-provenance-prune`** (pg_cron jobid 23, `30 4 * * *`) — **FIXED 2026-07-28**
  (`supabase/migrations/20260728130000_fix_field_provenance_prune.sql`). Two bugs: the self-FK
  `superseded_by_id` was unindexed (per-row FK check on a bulk DELETE over 1.6M rows → 2min statement-timeout),
  and the bulk DELETE could remove a row still referenced by a kept row (→ FK violation). Fix = partial index on
  `superseded_by_id` + rewrite prune to batched (5k), FK-safe (nulls external referrers first), time-budgeted
  (exits by 90s, under the 2min timeout). Verified: one run deleted 14,224 eligible rows, nulled 66 refs, exited
  cleanly; dry-run after = 0 candidates. The 947MB table is legit audit volume, not prune backlog.
- 🟡 **Feed stale:** `feed:gov:loans` — last data 06-23, **31d old vs 30d SLA**. Feed may have stopped; GOV-domain
  ingest, needs a look at the loans ingest job. Lower priority (informational alert, not a hard failure).

### ⚪ Stale-but-not-failing pipelines (informational)
- dialysis `cms_ingestion` last ran 33d ago; dialysis `email` 117d ago; several gov pipelines 13–27d
  (quarterly/FEMA/Geocodio/Census run on long cadences — likely fine, confirm the two dialysis ones).

**Next action for Slice 2:** pull `get_logs` (postgres + edge-function) and the PA run history for the three
failing flows to get the actual error strings, then fix root cause. These are notify-only alerts today, so no
data is being lost — but the To-Do sync + Unflag flows failing daily means those automations are effectively down.

---

## Slice 3 — GOV + DIA Supabase advisor sweeps — ✅ RESOLVED 2026-07-28
Same pattern as OPS, no 🔴 critical (neither had a sensitive-token table). Both engine connections use
service/secret keys with **no anon key configured**, and both are backend warehouses (server-side ingestion,
no frontend), so the hardening is safe. Verified after each: `get_pipeline_health` government + dialysis both
`ok` with full data.

> **GOV (`scknotsqkcheojiaewwh`): security ERROR 304 → 0.** 108 tables RLS-enabled, 196 views → security_invoker.
> Migration: `supabase/migrations/government/20260728140000_gov_rls_security_hardening.sql`.
> **DIA (`zqzrriwuavgrquhisnoa`): security ERROR 489 → 0.** 215 tables RLS-enabled, 274 views → security_invoker.
> Migration: `supabase/migrations/dialysis/20260728140000_dia_rls_security_hardening.sql`.
> DIA's first bulk attempt deadlocked against a live CMS ingestion → switched to a lock_timeout + per-object-skip
> pass (deadlock-proof, idempotent). Final: 0 tables without RLS on either project.

**Running total across all three DBs: 928 security ERRORs cleared (OPS 135 + GOV 304 + DIA 489), zero breakage.**
Remaining everywhere = WARN/INFO only: `function_search_path_mutable`, `*_security_definer_function_executable`,
`rls_enabled_no_policy` (intended deny-all), plus DIA `vulnerable_postgres_version` (PG15 — upgrade) and a few
`materialized_view_in_api` (matviews can't take security_invoker; revoke-from-anon is the fix, low urgency since
no anon exists). These are the "function hardening + minor toggles" follow-up pass, not ERRORs.

## Slice 6 — Pre-rollout audit follow-ups — 2026-07-29
Ran during the pre-rollout SYSTEM-AUDIT re-check. Two items surfaced and were actioned:

- 🔴→✅ **OPS security ERRORs regressed 0 → 2, now back to 0.** Two tables created *after* the 2026-07-28
  hardening sweep had RLS off: `feature_flags_registry` and `staged_intake_feedback_backfill_w1_1_log`. Applied
  `20260729120000_rls_enable_two_stragglers_ops.sql` (enable-RLS-no-policy; service_role bypasses, frontend never
  reads OPS with anon). **Verified: OPS security ERROR count 2 → 0.** GOV/DIA remain 0 ERRORs (WARN/INFO only).
  *Lesson: new public tables need RLS-on at creation — fold an `enable row level security` default into future
  table-creating migrations so this can't regress again.*
- 🟡 **`feed:gov:loans` root-caused (not a broken job).** GOV `loans` inserts tapered from ~592/wk (mid-May) to 1
  in the week of 06-22, then stopped; newest row 2026-06-23 (now ~36d vs 30d SLA). **There is no loans-ingest
  pg_cron in either the GOV or OPS project** — the only loans job, `lcc-gov-sales-enrich-from-loans-tick`, merely
  *reads* loans to enrich sales and is running green hourly. So loans is fed by an **external/upstream pull**
  (data-provider or PA/manual job) that halted ~06-23. Monitoring + freshness sync are healthy (`lcc-feed-
  freshness-sync` ran green today). **Action = 🧑 restart the upstream GOV loans source**; nothing to fix in-DB.
  Non-blocking for rollout (deal-spine is OPS, unaffected).

## Slice 7 — Function hardening pass (WARN) — 2026-07-29
Cleared the long-standing WARN `function_search_path_mutable` across all three DBs, plus a pollution backstop.

- ✅ **`search_path` pinned on every function we own** — OPS 84, GOV + DIA the rest (migrations
  `…_pin_function_search_path_{ops,gov,dia}.sql`). Value `public, extensions, pg_temp` (a superset — can't break
  unqualified refs — while making search_path non-mutable, closing the SECURITY DEFINER injection surface).
  Extension-owned functions skipped by design (not ours to alter), so the advisor will still list those few as
  WARN — expected, not actionable. **Verified: 0 of our functions unpinned on any DB; OPS engine smoke test
  green (helper/threshold/addr_key/reconcile sweep), get_pipeline_health full, no new alerts.** Lock-safe on
  GOV/DIA (short lock_timeout + per-function skip; DIA PG15 has live CMS ingestion). Reversible per-function.
- ✅ **Self-healing display-name trigger** (`…_users_display_name_selfheal_trigger.sql`) — a BEFORE INSERT/UPDATE
  guard on `users` that rewrites the hardcoded "Scott Briggs" literal onto a non-Scott email to an email-derived
  name. Prevents the actor-registry pollution (Slice/attribution work) from recurring no matter which writer
  creates the row.
- ✅ **EXECUTE revoked from anon/authenticated on all SECURITY DEFINER functions** — migrations
  `…_revoke_execute_sd_functions_{ops,gov,dia}.sql`. Clears `anon_/authenticated_security_definer_function_executable`.
  Grant structure confirmed first: EXECUTE was a *direct* grant to `authenticated` (+ `postgres`, `service_role`),
  so revoking PUBLIC/anon/authenticated leaves `postgres` + `service_role` intact — engine unaffected. Safe: no
  `.rpc()`/`.from()` anywhere in the frontend/extension (anon key = Auth only); GOV/DIA have no anon key.
  **Verified: 0 SD functions left exposed to anon/authenticated on any DB; service_role retained; engine smoke
  green (get_pipeline_health full for gov + dia).** Reversible.

**DIA Postgres version (reviewed 2026-07-29):** still `supabase-postgres-15.8.1.044` — the upgrade has NOT been
applied to this project. WARN `vulnerable_postgres_version` (security patches available). It's a Supabase
dashboard/infra action (Settings → Infrastructure → Upgrade, maintenance window) — cannot run via SQL/MCP. 🧑.

Remaining WARN/INFO everywhere = extension-owned function search_path / execute grants (not ours to change),
`rls_enabled_no_policy` (intended deny-all), DIA `vulnerable_postgres_version` (dashboard upgrade — 🧑), a few
`materialized_view_in_api` (matviews can't take security_invoker; no anon key to exploit — low urgency).
**No ERROR-level items on any DB.** The security audit is effectively complete: the only actionable security WARN
left (DIA PG patch) requires the dashboard.

## Later slices (planned)
- **Slice 4 — Engine runtime errors** — `get_logs` (api/postgres/edge-function) + Railway logs for 4xx/5xx.
- **Slice 5 — Known functional gaps** — matcher recall misses (e.g. Innovative Renal Care), deal_name not
  stored on `bd_opportunities`, contact-entity resolution backfill (5,651/17,289 resolve).
- **Follow-up hardening** — the function `search_path` + EXECUTE-revoke pass (from Slice 1 remaining).
