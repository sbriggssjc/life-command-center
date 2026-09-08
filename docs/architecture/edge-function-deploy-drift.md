# Edge function deploy drift (DRIFT1)

> Census date: 2026-09-07. Source: Supabase MCP `list_edge_functions` /
> `get_edge_function` against all three projects, cross-referenced against
> the committed `supabase/functions/` directory in this repo.
>
> Originating finding: `docs/os/PLANNED-BACKLOG.md` row **DRIFT1**, itself a
> generalisation of **GOVDUP1-a** (2026-09-05) — a live edge function drifted
> ~400 lines from its committed source and minted 808 duplicate gov
> properties while three separate investigations read the stale committed
> file and correctly-but-wrongly concluded there was no write path.

## Unit 1 — Census (as of 2026-09-07)

| project | slug | version | updated_at | committed_dir_exists | source_drift | writes_db | live | verdict | reason |
|---|---|---:|---|---|---|---|---|---|---|
| LCC Opps | `context-broker` | 34 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| LCC Opps | `daily-briefing` | 25 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| LCC Opps | `data-query` | 26 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| LCC Opps | `availability-checker` | 21 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| LCC Opps | `briefing-intel-snapshot` | 21 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| LCC Opps | `artifact-offload` | 15 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| LCC Opps | `docai-ocr` | 25 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| LCC Opps | `personal-search` | 6 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| LCC Opps | `docai-page-probe` | 3 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| **LCC Opps** | **`cortex-webex-sync`** | 6 | **2026-06-28** | **no → fixed** | n/a (no prior source) | **yes** — `activity_events` (+ `cortex_oauth_tokens` for OAuth state) | **yes** — `cron.job` jobid 159, every 30 min | **commit** | Real Webex-call-history-to-CRM sync, live on a 30-minute cron, no committed source existed. Now committed at `supabase/functions/cortex-webex-sync/index.ts`. |
| **LCC Opps** | **`docai-diag`** | 7 | **2026-07-18** | **no** | n/a | no — every response is a static 410 | no | **retire** | Deployed body is a self-describing disabled diagnostic (`"diagnostic_disabled_safe_to_delete"`, HTTP 410 on every call, no branches). One-off from R58 Unit 4 whose question was already answered. No cron, no caller anywhere in this repo. Not committed and not deleted from the deployment — deleting live infra is out of scope for this reconciliation; an operator can delete it from the Supabase dashboard. |
| dia | `ai-copilot` | 77 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `health-check` | 20 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `context-broker` | 14 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `lead-ingest` | 22 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `intake-receiver` | 14 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `copilot-chat` | 15 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `template-service` | 13 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `data-query` | 36 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `daily-briefing` | 16 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `npi-lookup` | 13 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `npi-registry-sync` | 12 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | **`intake-salesforce`** | 23 | **2026-05-17** | yes | **stale → fixed** | yes — `sf_*_staging` tables, gov/dia `properties` (auto-create), `pending_updates`, ops `sf_sync_log` | yes — the Power Automate "SF → LCC: Object Sync" flow, no cron | **commit (repair)** | `PAYLOAD_VERSION` was committed as `sf-2026-05-v1`, deployed as `sf-2026-05-v8` (GOVDUP1-a). Deployed body — including the auto-create-property path, `sf-config.ts`'s nullable `routeVertical()`, `?action=link-all`/`backfill-pending-updates` — is now committed verbatim. See the incident writeup below. |
| dia | `intake-salesforce-files` | 24 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `sf-promotion-worker` | 15 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `calendar-ics-sync` | 15 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `calendar-caldav-sync` | 20 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `calendar-caldav-push` | 18 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `calendar-capture` | 9 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope |
| dia | `w44-retrain-tick` | 2 | 2026 (recent) | yes | n/a | — | — | — | committed, not in scope — but see below, it's the caller that proves `w41-corpus-export` is live |
| **dia** | **`sf-test`** | 23 | **2026-03-06** | **no** | n/a | **no** | **unknown/no** — no cron, no repo caller | **retire** | SF SOAP-login smoke test, hard-coded to query 5 open Salesforce tasks. Holds live `SF_USERNAME`/`SF_PASSWORD`/`SF_SECURITY_TOKEN` but performs no domain write. Prior audit (`docs/history/EDGE_FUNCTION_AUDIT.md`) verdicted DELETE in 2026-05; nothing has called it since. Not committed, not deleted. |
| **dia** | **`salesforce-enrichment`** | 21 | **2026-03-07** | **no** | n/a | **yes — via `rpc('exec_sql', {query: ...})`**, a generic raw-SQL execution RPC, against `contacts`, `true_owners`, `salesforce_activities`, `contact_links`, `touchpoint_schedule`, `crm_enrichment_logs` | **unknown** — no cron, no repo caller found, no auth check in the function body at all (`verify_jwt:false` and no webhook-secret check) | **file-for-later** | See "Credential/security finding" below — this is not a plain drift item, it is a live, unauthenticated, raw-SQL-executing endpoint on a service-role key. Blocking reason: deciding "commit" vs "retire" requires an operator judgment call (is the 16-step CRM enrichment pipeline still wanted, and should it be re-authenticated before anyone touches it) that this reconciliation should not make unilaterally. Not committed, not disabled. |
| **dia** | **`test-function`** | 21 | **2026-03-09** | **no** | n/a | **no** | **no** — no cron, no caller | **retire** | Returns `{status:"ok", timestamp}` and nothing else. Superseded by the dedicated `health-check` function. Prior audit verdicted DELETE in 2026-05. Not committed, not deleted. |
| **dia** | **`ai-copilot-v2`** | 20 | **2026-03-09** | **no** | n/a | **no** | **no** — no cron, no caller | **retire** | Returns a static `{status:"ok", message:"ai-copilot-v2 test"}`. Never grew past a placeholder. Prior audit verdicted DELETE in 2026-05. Not committed, not deleted. |
| **dia** | **`w41-corpus-export`** | 3 | **2026-07-31** | **no → fixed** | n/a | **no** — Storage upload only (`entity-resolution/w4_1/labeled_pairs.jsonl`) | **yes** — called nightly by `w44-retrain-tick` (`?action=export`), itself fired by `cron.job` jobid 65 `w44-resolver-retrain-nightly`, `30 7 * * *`; also documented for direct operator use in `docs/resolver/W4_1_CORPUS_REPORT.md` | **commit** | Confirmed live by reading the committed `w44-retrain-tick` source, which POSTs to this function by URL every night. No committed source existed. Now committed at `supabase/functions/w41-corpus-export/index.ts`. |
| **dia** | **`w43-sf-link-export`** | 4 | **2026-07-31** | **no → fixed** | n/a | **yes** — gov/dia `w43_splink_batch` (a dedicated ledger table), plus Storage archive | **documented one-time-use tool, re-runnable; no cron, no caller** | **commit** | This is the export/stage utility that ran the W4.3 30,000-row Salesforce-account-link backlog on 2026-07-31 (`docs/audits/ROLLOUT_STATUS.md`, row "W4.3"). Real, narrow, reusable operator tool — not scratch. No committed source existed. Now committed at `supabase/functions/w43-sf-link-export/index.ts`. |
| **gov** | **`bulk-import-awards`** | 4 | **2026-04-20** | **no → fixed** | n/a | **yes** — `federal_lease_awards` (single-table upsert, `onConflict: generated_unique_award_id`) | **unknown** — no `cron.job` entry on gov references it, no caller found in this repo or via GitHub code search (its likely caller, `government-lease/src/ingest_usaspending.py`, is outside this repo's access) | **commit** | Prior audit (`docs/history/EDGE_FUNCTION_AUDIT.md`) verdicted KEEP: "Narrow, idempotent, healthy." Small, well-scoped, structured-payload upsert with no security concern. No committed source existed. Now committed at `supabase/functions/bulk-import-awards/index.ts`; liveness stays unconfirmed — see the runbook below for how to check it going forward. |
| **gov** | **`sam-entity-lookup`** | 5 | **2026-07-29** | **no → fixed** | n/a | **yes** — `sam_entities` upsert, plus `sam_lookup_candidates`/`sam_mark_owner_checked` RPCs that mark `recorded_owners`/`true_owners` checked | **yes** — `cron.job` jobid 9 `sam-entity-enrichment` (`15 */2 * * *`) calls `call_sam_batch_lookup()`, which `net.http_get`s this function | **commit** | Confirmed live via the gov cron table and the SQL function it calls. Also documented at length in gov `CLAUDE.md` §18/§25 (rate-limit correction: the key is valid, SAM.gov just rate-limits a non-federal personal key to ~10 lookups/day). No committed source existed. Now committed at `supabase/functions/sam-entity-lookup/index.ts`. |

Rows marked "committed, not in scope" are functions that already have a
matching `supabase/functions/<slug>/` directory in the repo; DRIFT1 did not
diff their content against the deployment (that is a much larger job — see
the Limitation section below — and was out of scope for this pass, which
targeted the ~10 sourceless deployments plus the one known content-drifted
function, `intake-salesforce`).

## Unit 2 — Incident writeup: `intake-salesforce`

**What happened.** The committed `supabase/functions/intake-salesforce/index.ts`
declared `PAYLOAD_VERSION = "sf-2026-05-v1"` and its header comment stated
*"[the transport] never writes a domain table — promotion is the
sf-promotion-worker's job."* The live deployment (Dialysis_DB project
`zqzrriwuavgrquhisnoa`, function version 23) was `PAYLOAD_VERSION =
"sf-2026-05-v8"` and carried an entire feature the committed file did not:
`linkProbe(autoCreate=true)` → `autoCreateProperty()`, which POSTs a **new
row into the domain `properties` table** (gov or dia) whenever the address
probe finds no confident match, then writes a `_new_property`
`pending_updates` advisory. It also added `?action=link-all`,
`?action=backfill-pending-updates`, a `scope`/`auto_create`/`limit` query
surface on `crawl-complete`, silent-failure auditing (`auditSilentFailure`),
and a three-state `routeVertical()` that can return `null` (unroutable
records are skipped rather than mis-filed).

That gap minted **808 gov properties from 125 Salesforce properties** (53 of
them fanning out into 736 rows) and survived three separate cleanup attempts,
because each investigation read the committed file, correctly concluded
"there is no INSERT path into `gov.properties` here," and was reasoning about
a program that was not running. Full mechanism and the DB-side dedupe that
stops the duplication (writer-agnostic, since the write path itself was
invisible from the repo): `docs/architecture/gov-property-duplicates.md`
§GOVDUP1-a.

**The fix (GOVDUP1-a, 2026-09-05).** A guarded header comment was added
naming the deployed version and the missing feature, so the next reader
would check before reasoning from the stale file. It did **not** sync the
drifted content — that repair was filed as backlog item **GOVDUP1-a-drift**.

**This DRIFT1 pass (2026-09-07) closes GOVDUP1-a-drift.** Both
`supabase/functions/intake-salesforce/index.ts` and its companion
`sf-config.ts` now hold the deployed `sf-2026-05-v8` body verbatim, pulled via
Supabase MCP `get_edge_function` against project `zqzrriwuavgrquhisnoa`. The
header comment now states the deployed version and the sync date, and the
false "never writes a domain table" claim is corrected to describe the real
auto-create behaviour. The committed file and the live deployment are, as of
this sync, identical in content (module structure aside — the deployed
bundle's `_shared/cors.ts`/`auth.ts`/`utils.ts` are an older, simpler snapshot
of what this repo's current `supabase/functions/_shared/` holds; those were
**not** overwritten, since the current shared files are richer supersets used
by many other functions and the deployed function's imports remain
compatible with them).

## Credential/security finding: `salesforce-enrichment`

Separate from the drift question: `supabase/functions/salesforce-enrichment`
(dia project) is a **live, unauthenticated, raw-SQL-executing endpoint**
running with a service-role key. Specifically:

- `verify_jwt: false`, and the function body itself performs **no auth check
  at all** — no `X-PA-Webhook-Secret` comparison, no API key check, nothing.
  Any request to its URL runs.
- Every one of its 16 pipeline steps calls
  `db.rpc("exec_sql", { query: "<raw SQL>" })` — a generic SQL-execution RPC —
  to run `UPDATE`/`INSERT` statements against `contacts`, `true_owners`,
  `salesforce_activities`, `contact_links`, `touchpoint_schedule`, and
  `crm_enrichment_logs`.
- `POST /run` (no `dry_run` param) executes the full 16-step pipeline
  immediately, and `GET /diagnostics` reports table-level row counts —
  neither requires any credential.

> ⚠️ **SEVERITY CORRECTED 2026-09-07 (Cowork, measured): the RPCs are `service_role`-only, so this
> is NOT "arbitrary SQL from the internet".** Live on dia, both `exec_sql(query text)` and
> `execute_sql(sql text)` read `anon` **false**, `authenticated` **false**, `service_role` **true**,
> `proacl = {postgres=X/postgres,service_role=X/postgres}` — an outside caller cannot reach them
> directly. **The real exposure is one step removed and still real: an unauthenticated public
> endpoint that holds a service-role key and, when called, performs that key's writes.** The SQL
> executed is the function's own sixteen fixed steps.
>
> ✅ **ANSWERED 2026-09-07 by reading the DEPLOYED body (`get_edge_function`): NO caller-supplied
> input reaches any query string.** All sixteen steps are static template literals with zero
> interpolation; the only request data the function reads is `searchParams.get("dry_run")` (compared
> to the string `"true"`) and `url.pathname`. **There is no SQL-injection path.** Combined with the
> `service_role`-only RPCs above, the "arbitrary-effect SQL execution" framing is retired.
>
> **The confirmed exposure, stated exactly:** `POST /run` — or a bare `POST /` — with **no
> credential of any kind** runs a 15-step write pipeline against dia `contacts`, `true_owners`,
> `salesforce_activities`, `contact_links` and `touchpoint_schedule`, then inserts a
> `crm_enrichment_logs` row; and `GET /diagnostics` returns table row counts and linkage-gap counts
> to anyone. CORS is `*`. **Mitigating and worth stating: every write is fill-blanks or
> idempotent** (`COALESCE`, `WHERE … IS NULL`, `NOT EXISTS`, `IS DISTINCT FROM`), so a hostile
> trigger costs load and unwanted state transitions — **not destruction.** That is why this is
> "close it deliberately", not "pull the plug tonight".
>
> 🚨 **Two findings the auth question was hiding, both worse than the auth question for data
> quality:**
> 1. **Step 3 and Step 8 Pass B link identity by NAME** — `lower(trim(t.name)) = lower(trim(sa.name))`
>    writes `true_owners.sf_company_id` / `salesforce_id`, and `lower(trim(c.company)) =
>    lower(trim(t.name))` sets `contacts.true_owner_id`. **Name-equality deciding an identity write
>    is the technique this repo bans outright** (`lcc_normalize_entity_name`, `ownerCore`,
>    `strictOwnerCore` — grouping-for-review, never identity-for-write).
> 2. **It writes curated BD columns with NO provenance ladder** — `contacts.contact_email`/`_phone`,
>    `true_owners.contact_1_name`/`contact_2_name`, `is_prospect`. Sixteen steps, zero
>    `field_provenance` rows. It is a ladder-invisible writer to the same tables the CONTACT1 arc
>    has spent a week instrumenting.
>
> ✅ For contrast, the sibling on the same project **is** authenticated: `intake-salesforce`'s
> now-committed body calls `authenticateWebhook(req)` and 401s without `X-PA-Webhook-Secret`. The
> gap is specific to this function, not the pattern.

This is a materially larger exposure than "an old function nobody
remembers": it is a standing, callable, unauthenticated path from the public
internet to arbitrary-effect SQL execution on a live production database,
via a generic `exec_sql` RPC that this reconciliation did not create and does
not have visibility into (its full permission surface is whatever that RPC
allows — potentially unbounded). It is called out here as its own finding,
not folded into the general "some deployments have no committed source"
tidiness note, because the remedy (disable/re-authenticate/retire) is a
security decision for an operator, not a repo-reconciliation one — and
because `verify_jwt`/secrets changes and redeploys were explicitly out of
scope for this task. No other sourceless function in this census carries the
same shape (`sf-test` holds a real Salesforce credential but performs no
write; `bulk-import-awards` and `sam-entity-lookup` take structured payloads
into narrow, single-table upserts with no free-form SQL execution).

**Recommended next step (not executed here):** an operator should either
confirm `salesforce-enrichment` is genuinely retired (in which case disable
or delete the deployment — outside this task's scope) or, if the 16-step
enrichment pipeline is still wanted, gate it behind the same
`X-PA-Webhook-Secret` pattern every other write-capable function in this
repo uses before it is ever called again.

## Unit 3 — Operator runbook: how to check for edge function drift

Run this periodically (there is no automated schedule for it — see the
Limitation section). It takes three MCP calls per project plus one repo
listing.

1. **List every deployed function per project:**
   ```
   mcp__Supabase__list_edge_functions  project_id=xengecqvemvfknjvbvrq   # LCC Opps
   mcp__Supabase__list_edge_functions  project_id=zqzrriwuavgrquhisnoa   # dia / Dialysis_DB
   mcp__Supabase__list_edge_functions  project_id=scknotsqkcheojiaewwh   # gov
   ```
   Each returns `slug`, `version`, `created_at`, `updated_at`, `status`,
   `verify_jwt`. **`version` counts deployments, not content** — a function
   redeployed with byte-identical source still bumps its version number, so
   never use the version count alone to infer whether the code changed.

2. **List the committed directories:**
   ```
   ls supabase/functions/
   ```
   Every subdirectory name is a slug this repo claims to have source for.

3. **Diff the two sets.** Any deployed `slug` from step 1 with no matching
   directory from step 2 is a sourceless deployment — the exact class this
   document's Unit 1 census enumerates. For each one found:
   - Pull its live body: `mcp__Supabase__get_edge_function
     project_id=<project> function_slug=<slug>`.
   - Check whether it writes to a database table (`.from(`, `.insert(`,
     `.update(`, `rpc(` calls with mutating RPC names, raw `POST`/`PATCH`
     REST calls) — this is the severity signal.
   - Check liveness: grep the project's `cron.job` table
     (`mcp__Supabase__execute_sql` `select jobid, jobname, schedule, command
     from cron.job where command ilike '%<slug>%'`) and grep this repo's
     `api/` and `docs/` for the slug name. A function can also be live via
     another edge function's runtime `fetch()` call to it (as
     `w44-retrain-tick` calls `w41-corpus-export`) — read the source of any
     function that looks like an orchestrator, not just the cron table.
   - Decide: **commit** (real, load-bearing or at minimum harmless and
     documented — pull the body into `supabase/functions/<slug>/index.ts`
     with a header noting the sync date and deployed version), **retire**
     (scratch/stub/superseded, no caller found — leave it deployed, just
     record the evidence; deleting live infrastructure is a separate,
     deliberate operator action, not a repo-reconciliation one), or
     **file-for-later** (can't confidently decide — say exactly what is
     blocking the decision, e.g. an unauthenticated write surface that needs
     an operator security call, or liveness that can't be determined from
     what this session can see).

4. **For any function whose committed directory DOES exist**, don't assume
   it matches the deployment — pull a content marker (a version string like
   `PAYLOAD_VERSION`, or the whole body if it's small) and diff it against
   the committed file. This is how `intake-salesforce`'s drift was originally
   found (GOVDUP1-a) and it is the more expensive direction to check — see
   the Limitation below for why it can't be made routine cheaply.

5. **Never redeploy a stale committed file "to tidy up."** If the deployment
   is ahead of the repo (the common case — see GOVDUP1-a), deploying the
   repo's stale file over it rolls production back. Always diff first, sync
   the repo to the deployment (not the reverse), and only redeploy when a
   human has reviewed the actual code change being shipped.

## Limitation: this direction cannot be a repo-side test

A test suite living in this repo can assert one direction cheaply: *"every
committed `supabase/functions/<slug>/` directory corresponds to a function
that is deployed somewhere"* — that's a lookup a CI job could run today,
given credentials to call `list_edge_functions`.

**It cannot assert the reverse.** There is no way for anything running
inside this repository — a test, a lint rule, a pre-commit hook, a CI
workflow — to discover that a live Supabase project has a deployed function
with *no* committed source at all, because the fact of that deployment
exists only in Supabase's control plane, not in anything the repo can see
about itself. The ~10-function gap this document exists to close was
invisible to every check this repo runs (`npm test`, `boot-check.yml`, every
guard named in `CLAUDE.md`) for exactly that reason, for months.

Closing that gap requires an operator (or a future session with Supabase MCP
access) to actually run Unit 3 above against the live projects — there is no
substitute that runs automatically inside the repo. If a future session
wants this checked on a schedule, the mechanism has to live outside the
repo's own test suite: a Routine/cron that has Supabase MCP access, or a
scheduled job that calls `list_edge_functions` from *somewhere with
credentials* and diffs it against `git ls-tree` of `supabase/functions/`.
Do not claim "CI covers this" — it does not, and cannot, without that
external credentialed step.

## DRIFT1-routing-gap — a downstream defect this reconciliation surfaced (2026-09-08)

Syncing `intake-salesforce/sf-config.ts` to the deployed body (Unit 2) exposed a second, unrelated
defect: `routeVertical` (the deployed function's `GOV_SIGNALS`) and `_shared/sf-deal-promotion.ts`'s
`GOV_STATE_SIGNALS` were two independent judgements of "does this Salesforce row belong to gov?",
and they disagreed — the same shape as this document's committed-vs-deployed drift, but at MODULE
level inside one already-synced repo, not at the deploy boundary.

- **Resolved 2026-09-08, repo-side:** merged into one canonical `GOV_SIGNALS`, exported from
  `sf-deal-promotion.ts`, imported by `sf-config.ts`. Full writeup, sizing method, and the per-term
  decision: `docs/claude-code/STATUS.md` (2026-09-08 entry) and `test/sf-deal-promotion.test.mjs`.
- **⚠️ Still pending: the redeploy.** Per this document's own rule 5 above (never redeploy without a
  human reviewing the change) — this session made the code change and explicitly did NOT deploy it.
  `routeVertical`'s live behavior is unchanged until an operator redeploys `intake-salesforce`
  (project `zqzrriwuavgrquhisnoa`) and confirms via `get_edge_function` that the new body matches.
- **The sizing hit this document's own Limitation from a different angle.** The population of
  Salesforce rows that route to `null` and get silently skipped leaves no row in either domain's
  staging tables — a re-route replay of what IS staged cannot see what never arrived, exactly as
  the Limitation above says a repo-side check cannot see a deployment it was never told about.
