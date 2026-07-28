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

### 🟠 Recurring Power Automate flow failures (daily, ongoing)
- **`To Do - Life Command Center Sync`** — fails daily at action **"Update file"** (~04:00Z). Most persistent;
  failing every day 07-24 → 07-28. Likely a stale file handle / renamed-or-locked target file in the sync.
- **`Unflag Completed Email Tasks`** — fails daily at **"Apply to each"** (~03:15–03:45Z). Likely an empty/null
  collection or a per-item action erroring (mirrors the old matcher Apply-to-each pattern).
- **`HTTP-Switch`** — failed at **"flow body"** (07-28 17:00Z).

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

## Later slices (planned)
- **Slice 3 — GOV + DIA advisor sweeps** (same DB treatment, other two projects).
- **Slice 4 — Engine runtime errors** — `get_logs` (api/postgres/edge-function) + Railway logs for 4xx/5xx.
- **Slice 5 — Known functional gaps** — matcher recall misses (e.g. Innovative Renal Care), deal_name not
  stored on `bd_opportunities`, contact-entity resolution backfill (5,651/17,289 resolve).
- **Follow-up hardening** — the function `search_path` + EXECUTE-revoke pass (from Slice 1 remaining).
