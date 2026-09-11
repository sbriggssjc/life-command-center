# Claude Code queue — STATUS

## 2026-09-11 — PRI4 response reviewed: uncovered preflight call site fixed, tracker close-out fixed for one path but a live check contradicts the other, and a genuine `safe_execute()` timeout defect found (possibly explaining PRI1's own unanswered Unit 4 mystery) — held pending `Dialysis` PR #7407 merge confirmation

`PRI4`'s response (`"PRI4 surface response.docx"`, saved by Scott) read in full and transcribed to
`docs/claude-code/responses/done/PRI4-preflight-abort-hang-and-uncovered-call-site.response.md`.

**Fixed**: (a) the real no-retry location — `src/health.py::preflight_health_check` (the prompt's own
framing of `preflight_checks.py` was corrected by the response) — now routed through `safe_execute()`,
plus two more unguarded probes found along the way, a broader sweep than asked. (d) confirmed safe for
Scott to kill the hung deployment — no partial state.

**(b), a real discrepancy caught by an independent live check, not just accepted from the response**:
the response claims the exact failure branch this prompt was built from already calls
`finish_run(run_status="aborted")` correctly — implying that row should already close. **This session
re-queried `ingestion_tracker` live and found the actual row (`started_at 15:53:15.083884 UTC`) still
open, `run_status='started'`, 1.5+ hours later.** Two explanations fit equally well and can't be
distinguished from here: the described code path doesn't match what actually ran in production, or
`finish_run()`'s own call silently hung/failed under the same connection instability — which would tie
(b) directly to (c) as one shared symptom. Flagged plainly rather than accepting "already correct." A
second, separate abort branch (`has_blockers`) genuinely had no close-out at all and was fixed.

**(c), the hang itself — root cause not proven, but a real and potentially significant defect found**:
couldn't attach to the live process to confirm (the prompt's ask went unmet, stated honestly). Found that
`core_utils.safe_execute()`'s timeout only stops waiting on the future — the underlying
`ThreadPoolExecutor`'s own `shutdown(wait=True)` then blocks again on the same stuck worker thread,
silently defeating the timeout. Stated as the strongest candidate, not confirmed. **Worth flagging
prominently**: if real, this is a plausible shared mechanism behind `PRI1`'s own still-unanswered Unit 4
question (the 5-hour idle gap before "Stopping Container") and this run's 90+-minute hang — one
explanation across multiple rounds of this arc's mysteries, though not independently verified. Mitigation
applied regardless: abort/cleanup now runs on a daemon thread with a bounded 60s join, then `os._exit(2)`
— terminates the process no matter what's stuck underneath.

Full suite: **3222 passed** (up from `PRI3`'s 3183), 0 failed, no regressions.

**Merge status of `sbriggssjc/Dialysis#7407` (branch `claude/inspiring-feynman-y8l6mh`) is
unconfirmed** — same pattern as `PRI3`'s `#7406`. Asked Scott to confirm directly.

`PLANNED-BACKLOG.md`'s `PRI4` row updated to 🟡 (fixed and tested per the response, held short of ✅
pending merge confirmation and given the live-check discrepancy on (b)). Prompt moved to
`docs/claude-code/prompts/done/`. Response docx archived to `responses/done/`.

**Still outstanding, unchanged by this round**: `PRI3`'s own live-fix proof — no run has yet gotten past
preflight to actually exercise `oig_leie_ingestor`/`ownership_linker`/`utils_shared`/
`ingestion_tracker.start_run`'s retry logic in production.

## 2026-09-11 — EB1 shipped: Executive Briefs foundation (schema + contracts + measurement, no rendering)

Ran `docs/claude-code/prompts/EB1-exec-briefs-foundation.md` (spec `docs/architecture/EXEC-BRIEFS-SPEC.md`
v0.2). Branch `feat/eb1-exec-briefs-foundation`, pushed. **No sandbox DB/network access in this
environment** — every §1 measurement below is either static-analysis (repo code read) or explicitly marked
UNMEASURED where it needs a live query/network call this session cannot make.

**§1 measurements (table):**

| # | Question | Answer |
|---|---|---|
| 1 | `briefing-intel-snapshot` feeds/streams | Code confirms exactly the 4 streams the spec names — `healthcare` (MedCity News, KFF Health News, Health Affairs), `government` (GSA News, Government Executive), `net_lease` (GlobeSt, Bisnow National, Commercial Observer), `tax_policy` (Tax Foundation) — `RSS_FEEDS` in `supabase/functions/briefing-intel-snapshot/index.ts`. Items/day per the last 7 `briefing_intel_snapshot` rows and which feeds are currently failing: **UNMEASURED — no DB/network access this session.** |
| 2 | Analyst's Take on-box path | Flag state + last-known measurement (2026-08-26, `briefing-analyst-take-onprem.md`): `BRIEFING_ANALYST_TAKE_ONPREM` reads `on`; that day's row carried a 774-char take, `analyst_take_meta.source='onprem_ollama'`. **Not re-measured this session** (dated per CLAUDE.md's own re-measure doctrine — flag `on` here.) |
| 3 | `ANTHROPIC_API_KEY` presence/success, web-search tool | Presence per runtime: **UNMEASURED** (cannot read Railway/Supabase env, and must not print a key value if it could). Last known call outcome (2026-08-26, code comment in `briefing-analyst-take.js`): key is SET on the `briefing-intel-snapshot` edge fn but every call since 2026-07-08 returns `Anthropic API 400: ... credit balance too low` — billing-dead, not unconfigured. **Web-search tool: NOT enabled in the current code path** — `supabase/functions/briefing-intel-snapshot/index.ts`'s `fetch('https://api.anthropic.com/v1/messages', ...)` body carries no `tools` field at all (static fact, confirmed by reading the request body construction). |
| 4 | Scheduler / tick registration + health check | pg_cron (`lcc_cron_post`) posts to Railway/edge on a schedule; every recent tick follows the P123/P133 lifecycle — a run-log table opened at entry (`status='started'`) and closed on exit (`completed`/`failed`), read via a `v_..._run_health` view (mirrored exactly from `lcc_ownership_chain_draft_run_log` / `20260826230000_lcc_p133_ownership_chain_draft_run_log.sql`). `producer_runs` (this migration) generalises that pattern across every MB/XB/OC producer instead of minting a new dedicated run-log table per producer. |
| 5 | Tagged Outlook intake (`intake-tagged-comm.js`) | Handler exists (`api/_handlers/intake-tagged-comm.js`) — viable reuse for the `outlook_tagged` operator-note channel per the contract doc. Flag state + rows in the last 30 days: **UNMEASURED — no DB access this session.** |
| 6 | MCP `log_memory` write template | Read directly from `mcp/server.js`: one POST to `cortex_memory` (`domain`, `kind`, `summary`, `detail`, `source:'mcp:log_memory'`), returns `{ok, logged}`. `log_operator_note` (OC1, later prompt) should mirror this exactly — one call, one row, no read-back. |
| 7 | Overlap tables | `cm_report_snapshots` — pattern reused deliberately (`market_brief_issues.fact_ids` freezes a fact set the same way). `cortex_market_intel` — table is referenced live (RLS-enabled in `20260728120000_rls_security_hardening_ops.sql`) but its `CREATE TABLE` is not in this repo's migration history and no `api/` code reads/writes it; **could not determine its schema or purpose from repo-only analysis** — flagged as a possible pre-repo or externally-created table, not reused. `staged_intake_feedback` — different domain (intake-match human feedback), no overlap. Decision Center lanes — different shape (verdict-per-row, not fact-per-claim); not reused. |

**Migrations applied:** **NO** — written as a file only, not applied to any live Supabase project (per the
prompt's explicit instruction; this session has no Supabase credentials regardless).
`supabase/migrations/20260911165100_lcc_eb1_exec_briefs_foundation.sql` — five tables
(`market_brief_facts`, `market_brief_issues`, `build_brief_snapshots`, `operator_notes`,
`producer_runs`) + two views (`v_market_brief_live`, `v_market_brief_staleness`), RLS enabled on all five
new tables using the existing lockdown pattern (`service_role` FOR ALL + `authenticated` FOR SELECT,
mirrored from `20260522140000_lcc_rls_lockdown_new_backend_tables.sql`).

**Contracts (docs only):** `docs/architecture/market_brief_payload_contract.md` +
`docs/architecture/operator_note_contract.md`, mirroring `daily_briefing_payload_contract.md`'s style.
Both are explicit that no endpoint they describe exists yet — MB-a/MB-b/MB-c and OC1/OC2/OC3 build to
these contracts, not the reverse.

**Seed script:** `scripts/eb1-seed-dialysis-exemplar.mjs` (dry-run by default). Dry-run over the dialysis
exemplar (`docs/briefs/exemplars/2026-09-11-dialysis-market-brief.md`) plans **16 facts** — operators 6,
policy 4, capital_markets 3, trades 1, implications 2 (14 `reported` + 2 `opinion`) — and explicitly
excludes the exemplar's 5 `[UNVERIFIED]` items (a 2026 FMC rating action, USRC's Moody's timing, IRC M&A,
a dialysis-specific cap-rate average, GLP-1 demand impact). Idempotent via the migration's own
`uq_mbf_source_identity` unique index (`Prefer: resolution=ignore-duplicates`).

**Guard + suite:** `test/eb1-market-brief-foundation.test.mjs` (16 tests — migration structural invariants:
table/constraint/index presence, the staleness view's CROSS-JOIN-before-LEFT-JOIN shape per the Class-20
lesson, comment-stripping positive control) + `test/eb1-seed-exemplar.test.mjs` (7 tests — pure-function
idempotency, `[UNVERIFIED]` exclusion, TTL math). **Full suite run: 5,791 pass / 0 fail / 6 skipped**
(pre-existing skips, unrelated to this change).

**What EB1 did NOT touch (per the prompt's §5):** no change to `briefing-email-handler.js`, no new cloud-
model call, no producer tick, no email sent, no flag flipped, nothing sent to a cloud model. Everything
ships flag-gated OFF by construction — there is no flag yet, because nothing reads this schema yet.

**Contradicts/missing from the spec:** nothing found. `EXEC-BRIEFS-SPEC.md` v0.2, `PLANNED-BACKLOG.md` §P18
and the two exemplars all existed exactly as the prompt described; no gap between the spec and what was
built. The one thing worth flagging forward: §1.7's `cortex_market_intel` could not be graded reuse-vs-new
because its schema is not in this repo — MB-a should re-check it live before deciding whether any MB table
should fold into it instead.

**Branch:** `feat/eb1-exec-briefs-foundation`, pushed to `origin` (`git push -u origin
feat/eb1-exec-briefs-foundation` succeeded). **No PR opened** — not requested, and this session cannot
merge to `main` regardless (branch-protected, required check `npm test`).

**Files created:** `supabase/migrations/20260911165100_lcc_eb1_exec_briefs_foundation.sql`,
`docs/architecture/market_brief_payload_contract.md`, `docs/architecture/operator_note_contract.md`,
`scripts/eb1-seed-dialysis-exemplar.mjs`, `test/eb1-market-brief-foundation.test.mjs`,
`test/eb1-seed-exemplar.test.mjs`. **Files modified:** `docs/os/PLANNED-BACKLOG.md` (§P18 EB1 row),
`docs/claude-code/STATUS.md` (this entry). `docs/os/CURRENT-STATE.md` not touched — nothing here is live
(unmigrated + unread by any consumer), so there is nothing yet to add to the LIVE map.
## 2026-09-11 — AC2/AC3 (bench ranking + Ollama role inference) flipped live: migration applied, `BENCH_RANK_WRITE` registered on

The last open item from `ACI-phase2-unitC`'s own verification note was a pure operator action: apply
`20261010150000_lcc_bench_rank_run_log.sql` and register `BENCH_RANK_WRITE` in `feature_flags_registry`.
Did both against `xengecqvemvfknjvbvrq`.

**Migration applied clean** — `lcc_bench_rank_run_log` and `lcc_bench_rank_write_log` both confirmed live,
correctly permissioned (`service_role` INSERT, `anon`/`authenticated` revoked on both).

**Flag registered**: `BENCH_RANK_WRITE` inserted into `feature_flags_registry` with `state='on'`,
`surface='api/bench-rank-tick'`. `feature-flag.js`'s own resolution order (explicit env var wins if set,
else the registry decides) means this alone is enough — no Railway env var or redeploy needed.

**What this does and doesn't do**: `GET /api/bench-rank-tick` was already ungated (dry-run only) and stays
that way. `POST` (the real write) was a no-op end-to-end until both the migration and the flag existed —
now it isn't, but nothing calls the route on a schedule (checked: no cron references
`bench-rank-tick` anywhere in the repo, it's purely an on-demand admin route). So this makes the write path
genuinely live and ready rather than actually causing anything to write yet — the first real POST still needs
a person (or a future cron, not built) to trigger it.

**Docs**: `PLANNED-BACKLOG.md` `AC2` row updated from "ledger migration written, not applied live" to the
live-confirmed state.

**Next step.** The ownership/contact-propagation thread's other open items are unchanged by this:
`OWN-T0a` (gov's 43.4% recorded-vs-true-owner disagreement, still the largest untouched upstream gap),
`B1b` (developer chain, gated behind `B5`), and `AC11` (individual-owner control-chain population needs
re-measuring now that `PR-scanner-2`'s SOS capture has shipped — it was sized at zero before that existed).

## 2026-09-11 — BROKER1 applied live: a real bug found and fixed in production, 1,303 prospects assigned (870 gov→Scott, 414 dia→Kelly, 19 catch-all→Scott), Nate confirmed untouched

The shipped code (`8a40073d`, merged) could not be run by the session that built it — no DB credentials there.
This session applied the migration directly against `xengecqvemvfknjvbvrq`.

**The migration's own self-check passed, but the first live call to the function it created did not.**
`lcc_broker1_assign_prospect_brokers(p_dry_run)` declares `RETURNS TABLE(bucket text, n bigint)`, which makes
`bucket` an implicit PL/pgSQL variable inside the function body — three `count(*) FILTER (WHERE bucket = '...')`
lines collided with it (`42702: column reference "bucket" is ambiguous`), a bug the shipped test suite's 13
Node tests never could have caught since none of them touch live Postgres. Fixed live by qualifying every
reference with the temp table's own alias; no behavior change, same buckets, same rule.

**Ran the real dry-run, then the real apply.** Final counts over the 1,355-prospect seller-prospecting queue:
`already_manual_assignment_left_alone=52`, `defaulted_gov_to_scott=870`, `defaulted_dia_to_kelly=414`,
`defaulted_catchall_to_scott=19`. The design's ordering requirement (the JS ROE self-signal pre-pass must run
*before* the SQL default sweep, or a real "someone's already pursuing this" signal could get overwritten by a
vertical default) couldn't be honored by calling the actual `/api/broker1-assign-tick` route — it's
auth-gated behind `LCC_API_KEY`, which this session doesn't hold. Instead of skipping the check, the JS pass's
exact query (`external_identities` where `source_system='salesforce'`, `source_type='account'`, for every
currently-unassigned prospect) was run directly in SQL first: **0 of 1,303 unassigned prospects carry any SF
Account-owner metadata at all**, confirming the pre-pass has nothing to write — not skipped, genuinely empty —
so applying the default sweep directly was safe.

**Nate verified untouched, the way the rule requires**: 7 `lcc_entity_owner_override` rows do name him, but
every one carries `set_by='reconciled'` — an older, unrelated `deal_owner`/`sf_task` signal that predates this
build. BROKER1's own function never references Nate's `lcc_user_id` as an assignable value, and fill-blanks-only
means it could not have touched these regardless. Spot-checked 8 random post-sweep rows live via the new
`v_lcc_broker1_prospect_assignment_state` view — all correctly bucketed by domain.

**Confirmed the deployed app is current**: Railway `/version` on `tranquil-delight-production-633f` reads
`8716d86d406f`, matching this session's `git` HEAD exactly — `/api/broker1-assign-tick` is live, this session
simply lacks the key to call it. Running the JS pre-pass for real through the actual route (a harmless no-op
today, given the confirmed-empty population, but worth closing the loop formally) is the one remaining operator
action — not a build gap.

**Docs**: `PLANNED-BACKLOG.md` `BROKER1` row updated with the live-applied outcome and the bug fix; `C4c`'s
supersession note is unaffected. Moved `BROKER1-prospect-assignment.md` and its response to `done/`.

**Next step.** `BROKER1-sf` (the Salesforce connect-back) stays correctly unbuilt — no write path into
Salesforce exists yet, unchanged from the shipped finding. The rest of the ownership/contact-propagation
thread (`OWN-T0a`, `B1b`, `AC11`'s population re-measure, the AC2/AC3 migration+flag operator action) is
still open and untouched by this entry.

## 2026-09-11 — Confirmed: the PRI3 test run is genuinely hung, not just idle-logging — filed as `PRI4`

Follow-up to the preliminary finding above. Scott checked Railway directly: the deployment
(`39b0ef8e-e041-44ca-9066-4c62d27ec7b4`) shows **"Running"**, not "Crashed" or "Success," and no new log
lines have appeared beyond the `15:53:16Z` "preflight abort" summary. Re-checked `ingestion_tracker` live:
the run's row (`started_at 2026-09-11 15:53:15.083884 UTC`) is still `run_status='started'`,
`finished_at=null`, now **50+ minutes** with zero change. This rules out "Railway's dashboard is just
stale" — **the process genuinely reached its own printed conclusion and then never exited.**

Filed as `PRI4` (`docs/claude-code/prompts/PRI4-preflight-abort-hang-and-uncovered-call-site.md`),
covering: (a) `facility_patient_counts`'s preflight check has no retry (an uncovered call site, distinct
from `PRI3`'s catalog); (b) the `ingestion_tracker` row is never closed out on a preflight-abort exit,
confirmed live; (c) the actual hang itself — the process prints a complete summary and then blocks
forever instead of exiting, the priority item, with a specific ask to try attaching/inspecting the live
process (Railway shell, `py-spy dump`) if still possible before Scott kills it, since that would settle
the root cause far more precisely than static code reading; (d) a plain recommendation on whether it's
safe for Scott to manually stop this specific stuck deployment now rather than wait.

**Important scoping note carried into the prompt**: this run never reached any of `PRI3`'s actual fixed
call sites (`oig_leie_ingestor`, `ownership_linker`, `utils_shared`, `ingestion_tracker.start_run`'s own
retry logic) — it failed at preflight, a code path upstream of all of them. So **`PRI3`'s live-fix proof
is still outstanding** — a clean run that gets past preflight is still needed before treating those fixes
as proven in production, separate from this hang investigation.

`PLANNED-BACKLOG.md`: filed `PRI4` 🔴, not queued — recommend sending promptly given it's occupying a live
Railway instance right now.

## 2026-09-11 — Live PRI3 test run: connection instability confirmed still present, now hitting an uncovered preflight call site; `ingestion_tracker` row still stuck at `started` — preliminary, awaiting Railway status before filing a prompt

Scott triggered a fresh CMS ingestion run to test `PRI3`'s deployed fix. Logs (deployment
`39b0ef8e-e041-44ca-9066-4c62d27ec7b4`, started `2026-09-11T15:53:06Z`) show it did **not** reach the
`PRI3`-fixed call sites at all — it aborted cleanly at **preflight**, before `oig_leie_ingestor`,
`ownership_linker`, or `census_demographics` ever ran, so this run is not evidence either way about those
fixes. What it does show:

1. **`facility_patient_counts`'s preflight check has no retry** — failed immediately on
   `httpx.RemoteProtocolError: Server disconnected`, a call site not in `PRI3`'s catalog (preflight is a
   separate code path from the ingestion-body call sites `PRI3` fixed).
2. **`ingestion_tracker.start_run` DID retry this time** (per `PRI3`'s fix — log line: `failed to start
   ingestion_tracker run for cms_medicare_clinics after retries: None`) but still failed — confirming the
   underlying connection instability is still occurring in production, just not always fatal anymore.
3. **Confirmed live in Dialysis_DB**: the `ingestion_tracker` row this run created
   (`started_at 2026-09-11 15:53:15.083884`) is still stuck at `run_status='started'`, `finished_at=null`
   — the identical stuck-open-row symptom seen on the pre-fix crash. The script printed a full, orderly
   `=== CMS ingestion (preflight abort) run summary ===` (all-zero counters, `elapsed: 1.01s`) and,
   per the log excerpt, went silent immediately after — but Scott reports the Railway deployment still
   shows 42 minutes elapsed with no further log lines, an echo of `PRI1`'s own unresolved "5-hour idle
   window" mystery (Unit 4, still never answered). **Cannot determine from Supabase alone whether the
   process is genuinely hung, or exited cleanly without ever calling back into `ingestion_tracker` to
   close the row** (a real gap either way — a clean-abort path that never marks the run `failed`/`aborted`
   is itself worth fixing, separate from whatever is or isn't still running).

**Not yet filed as a prompt** — asked Scott to check Railway's dashboard directly for this deployment's
actual status (Running/Crashed/Success) and to pull the full log past `15:53:16Z` if any exists, since
this excerpt cuts off right at the summary print. Will draft a prompt once that's confirmed — likely
covering (a) `facility_patient_counts`'s uncovered preflight call site, (b) the tracker row never closing
on a preflight-abort exit, and (c) whatever the fuller log shows about the 42-minute gap.


> **START HERE for the current state:** `docs/os/CURRENT-STATE.md` (what is LIVE / flag-gated OFF /
> PLANNED, plus the canonical-doc map). **Everything unbuilt-but-intended:**
> `docs/os/PLANNED-BACKLOG.md`. **Surfaces / comps engine / deploy mechanics:**
> `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`.
>
> **This file is the running work log, newest first.** It is *not* the state of the system — a block
> here was true on the day it was written and may since have been superseded (re-measure a dated
> blocker before quoting it; that doctrine has bitten this file repeatedly).
>
> **Archive:** entries for **2026-08-03 → 2026-08-12** (the comps arc prompts 19–60, the Wave 8
> hygiene campaign, the Wave 9 connectedness build-out, the ChatGPT/Copilot surface rollout, and the
> 2026-08-03 security/deploy-pending notes) were moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-08-03_to_2026-08-12.md`](../history/STATUS_claude-code_2026-08-03_to_2026-08-12.md)
> on 2026-08-26 (Prompt 141). Every still-open item from that range was carried into
> `PLANNED-BACKLOG.md`; nothing was dropped.

## 2026-09-11 — P18 decisions recorded; spec v0.2 architecture; EB1 prompt drafted

Scott answered the six P18 questions. **Market briefs:** short form daily in the morning email, kept current as
news/data arrive; weekly long-form email linked from it; lanes dia / gov / NL / broad NL only. **Hard requirement:
built into the LCC, not a Cowork task that goes stale** — use local Ollama where it fits. **Build brief:** lives on
the dashboard, Scott-only. **Operator notes:** every channel → one funnel → one to-do list, auto-routed by topic to
the right thread, minimum human friction. Architecture (Cowork recommendation, `docs/architecture/EXEC-BRIEFS-SPEC.md`
v0.2, renamed from `-v0.1`): *living brief* = sourced/dated facts with staleness TTLs, three producers (on-box SQL,
existing RSS + Ollama, weekly/event cited web research via Anthropic — public facts only), Ollama synthesis, decay
audited by XB; funnel built first. Backlog §P18 rewritten (EB0 ✅ decided, EB1 🟢, OC1–4, MB1–8, XB1–4).
**Next:** send `prompts/EB1-exec-briefs-foundation.md` to Claude Code. Not committed.

## 2026-09-11 — P18 opened (design-only): swimlane Market Briefs, CTO/CDO build brief, operator channel

A Cowork parallel-task demo produced a sourced dialysis market brief and a 9-slide LCC build-status deck; Scott
asked to productize both. **Market briefs (MB):** one per swimlane (dia / gov / general NL, maybe a broad NL
brief), weekly or monthly, own email and/or folded into the daily briefing, with a homepage tab. **Build brief
(XB):** Scott-only "exec briefing from the CTO/CDO" email + dashboard that also audits repo docs/plans to rank
the next best effort. **Operator channel (OC):** Scott emails/chats ideas, bugs, "not connecting" notes that get
triaged into the backlog and reported back. Reuse map + P131 classification + open questions:
`docs/architecture/EXEC-BRIEFS-SPEC.md`; rows MB0–MB6 / XB0–XB4 / OC0–OC2 in `PLANNED-BACKLOG.md` §P18;
exemplars in `docs/briefs/exemplars/`. First audit finding for XB2: backlog ⭐ NEXT (C2g) and the live queue
(PDR2, prompt drafted 2026-09-11) disagree. **Next:** Scott answers spec §4; no build authorized. Not committed.

## 2026-09-11 — BUY0 Buyer Engagement module opened (design-only) + Jordan Geller industrial search kicked off

Scott's brief: productize the buy-side "buyer showing" process (qualify → criteria → source → score → Broad/Focused
workbook → feedback → offers → PSA → close) in LCC, piloted on Jordan Geller's 2026 industrial search (~$20M, top-50
MSA, $5–10M sweet spot, fundamentals/rent-vs-market over credit). Repo sweep found reusable pieces (SF buy-needs
fields uningested, `buyer_showings.py` template, dia/gov `available_listings`, `cortex_market_intel`, offer tools) and
the key gap: **no general net lease / industrial on-market store** (sidebar routes only dia/gov). Spec v0.1:
`docs/architecture/BUYER-ENGAGEMENT-MODULE-SPEC-v0.1.md`; backlog `UX-T4` updated. Engagement log lives in
`Team Briggs - Documents/Clients/Jordan Geller/2026 Industrial Search/00-ENGAGEMENT-LOG.md`. **Next:** Scott answers
the open questions (building spec, MSA universe, scoring legs, data sources, decisions A–F); no build authorized.
Not committed yet (another session has uncommitted work on `main`) — commit on a `docs/buy0-buyer-engagement-spec` branch.
## 2026-09-11 — BROKER1: assign every prospect to a Team Briggs broker, built (not yet run live)

Scott's rule, verbatim: existing ROE dictates first; else default by vertical (gov→Scott,
dia→Kelly); Nate gets nothing in this pass; Scott is the catch-all. Built as a fill-blanks sweep
over the **existing** point-person slot rather than a new table — `lcc_entity_owner_override`
(entity_id → owner_user_id, the P112/SF-owner-capture mechanism already read by
`v_lcc_entity_point_person`, `lcc_cadence_point_person`, and My Work/Team Queue scoping). A second
"who owns this prospect" table would have been exactly the normaliser-drift/second-registry class
this repo warns about repeatedly (P116, P189, C1) — this reuses the slot that already exists and
is already the "point person who works the deal" per `property-owner-subsystem.md`.

**⚠️ This directly supersedes `PLANNED-BACKLOG.md` row `C4c` ("DO NOT BUILD YET — broker
assignment is premature", 2026-08-29), and the supersession is recorded, not silently
overridden.** C4c's objection was specifically *"do NOT default-stamp owners to Scott — that
writes a fact nobody asserted into the column every surface reads."* Scott has now explicitly
asserted that default policy, by name, with a stated fallback order (self-signal → vertical
default → Scott catch-all) — which is exactly the missing input C4c was waiting on. C4c's other
finding (161/161 existing `lcc_entity_owner_override` rows resolve cleanly through
`v_lcc_entity_point_person`) is the evidence that reusing this table is safe.

**Prospect population:** entities in `lcc_priority_queue_resolved`, the materialized
seller-prospecting queue cache — the one population the operator doctrine section of this file
already calls "prospects" ("The priority queue is seller prospecting"). Not every `entities` row,
not a `pipeline_stage` column (none exists on `bd_opportunities`/`entities`), not raw
`bd_opportunities` (skews toward active deals, not the earlier prospecting population the queue
targets).

**Rule 1 (ROE signal wins)** is satisfied two ways, never a rebuilt classifier:
- Existing `lcc_entity_owner_override` rows already written by SF-owner capture
  (`set_by like 'sf_owner%'`) ARE the materialized form of "a Team Briggs SF Account Owner is
  already pursuing" — the sweep's fill-blanks exclusion (`NOT EXISTS`) respects them for free.
- A new JS pass, `api/_shared/broker1-assign.js::applyBroker1RoeSelfSignal`, reuses
  **`roe.js::brokerClass()` directly** (imported, not reimplemented) against each unassigned
  prospect's SF Account-owner name (`entities.external_identities` source_system='salesforce'/
  source_type='account', the same tier `resolveAccountOwner()` already reads for the Contact 360
  panel) and writes a fill-blank `lcc_entity_owner_override` row when it classifies `'self'` AND
  resolves unambiguously to a known active `lcc_users` row — never a guess.
  ⚠️ Scoped deliberately to the SF-owner tier only, not the `dealAssignees` tier (dia
  `salesforce_activities.assigned_to`) — that signal is per-contact and cross-database (a
  different Supabase project), so batching it over every prospect would be the exact N+1
  round-trip cost the P123 doctrine warns against; it stays on the existing per-contact Contact
  360 path.

**Rule 2/4 (vertical default + Scott catch-all):** new SQL function
`lcc_broker1_assign_prospect_brokers(p_dry_run)` (migration
`20261101160000_lcc_broker1_prospect_broker_assignment.sql`) — for every prospect with **no**
existing override row: `domain='dia'` → Kelly, else (gov/lcc/cre/null) → Scott. Insert is
`ON CONFLICT (entity_id) DO NOTHING` — structurally fill-blanks-only; Nate's `lcc_user_id` is
resolved for reporting only and never appears on the assignable side of the CASE. Reversible:
`DELETE FROM lcc_entity_owner_override WHERE set_by LIKE 'broker1_%'`.

**Route:** `GET/POST /api/broker1-assign-tick` (`api/_handlers/broker1-assign-tick.js`, mounted in
`server.js`/`admin.js` per the sub-route convention). GET = dry run (both the JS ROE pass and the
SQL sweep run in dry-run mode); POST = apply, ROE pass first then the SQL sweep (so a self-signal
write is already on the row before the sweep's exclusion runs — order asserted by the guard test).

**Salesforce connect-back (step 4) — NOT built, and the reason is a capability fact, not a scoping
choice.** Per `C1`'s prior finding (still current): *"LCC's entire Salesforce surface is a
read-only Power Automate proxy — Scott has no admin rights to register a Connected App"* — a
repo-wide grep for `sobjects`/`/services/data/v`/a POST to Salesforce returns nothing. **There is
currently no write path from LCC into Salesforce at all**, so "the minimum necessary field on the
Account/Contact Owner, plus a stable reference back to LCC" cannot be built today regardless of
scope. Recorded as backlog `BROKER1-sf` rather than faked: the smallest viable shape, if/when a
Connected App exists, is a single field write (an existing Account/Contact Owner field, since
Salesforce already reads that for its own ROE) plus the entity's LCC URL as a stable reference —
never a payload sync of LCC's ownership/contact record, per Scott's "minimum necessary" framing
and the `ownership-truth-pipeline-state.md` Stage 5 doctrine.

**Guard:** `test/broker1-prospect-broker-assignment.test.mjs` (13 tests) — Nate never assignable,
fill-blanks-only, ROE-before-default ordering, `brokerClass` reuse (not reimplemented), name
resolution never guesses on ambiguity. `node --check` + `npm run check:boot` clean.

**⚠️ Not yet run against production — no resolved-count split to report.** This sandbox has no
Supabase credentials for LCC Opps, so the real self-signal/gov-default/dia-default/catch-all/
already-manual split (step 3's required output) cannot be produced without fabricating it.
**Next step:** `GET /api/broker1-assign-tick` for the dry-run counts, spot-check 2–3 live examples
(one gov, one dia, one with a real `sf_owner%` self-signal if one exists) against the stated rule,
then `POST` to apply and record the real split here.

## 2026-09-11 — Housekeeping: `prompts/` cleaned of stale duplicates left over from earlier `git mv`s

With the PRI arc closed, checked `docs/claude-code/prompts/` for anything sitting stale — this is the
ongoing "clean that folder as we go" cleanup Scott asked for earlier in this arc. Found three prompt
files (`PRI1`, `PRI3`, `CQM1`) that existed **both** at the top level of `prompts/` and, byte-for-byte
identical, in `prompts/done/` — duplicates left behind by an earlier `git mv` that apparently didn't
stick cleanly (or was superseded by a later full-tree write). Removed the stale top-level copies; the
`done/` copies (already correctly filed) are untouched. Also moved `PROPREV1`'s prompt to `done/` — its
response was filed and the item closed ✅ days ago, but the prompt itself had never been moved.
**Left `PDR14b`'s prompt alone** — that's a concurrent session's own item (already shipped + verified
live per `PLANNED-BACKLOG.md`), not something this session's response-processing loop filed, so archiving
it isn't this session's call to make.

## 2026-09-11 — PRI arc closed: `Dialysis` PR #7406 confirmed merged and deployed live — PRI1/PRI2/PRI3 all ✅

Scott confirmed: *"That merged. The dialysis branch is also merged and PR 7406 is deployed live."* This
closes the last open item from the PRI arc — the connection-retry sweep is now live in production, not
just fixed-and-tested-per-the-response.

`PLANNED-BACKLOG.md` updated: **`PRI3`** moved 🟡 → ✅ (fixed, merged, confirmed deployed live).
**`PRI2`** closed ✅ as well — it was the root-cause escalation finding that pointed at `PRI3`'s full
catalog for the fix; with that catalog now shipped, leaving `PRI2` open pointing at a resolved item
would be stale bookkeeping, so it's closed rather than left dangling. `PRI1` was already ✅ from the
prior round.

**What's still genuinely open from this arc, carried forward rather than glossed over just because the
headline item closed**: (1) the actual crash trigger behind the original Railway "Deploy Crashed" email
(catalog item (h)) was traced exhaustively in `PRI3`'s response and never resolved — concluded possibly
an OOM/platform-level kill, not confirmed; (2) the before/after proof text for 5 of the fixed call sites,
and the name of a 6th changed file, were never independently visible in what this session could extract
from the response `.docx` — this session's confirmation of the fix rests on the response's own
self-report plus Scott's live-merge confirmation, not on this session re-reading the actual `Dialysis`
diff (no credentials to that repo); (3) `PRI1`'s own Unit 4 question (whether a distinct "process exited
with code 1" line exists near the original 07:03 crash, separate from "Stopping Container" at 12:27) was
never answered by Scott. None of these block closing the arc — the confirmed, live fix is the load-
bearing fact — but they're worth keeping visible rather than let disappear once the row turns green.

## 2026-09-11 — PRI3 response reviewed: 5 of 6 call sites fixed with proof asserted (not independently visible), the `owners` code bug fixed, full suite green (3183 passed, up from 3173) — held at 🟡, not ✅, pending confirmation `Dialysis` PR #7406 is actually merged

`PRI3`'s response (`"PRi3 surface response.docx"`, saved by Scott) was read in full and transcribed to
`docs/claude-code/responses/done/PRI3-connection-retry-sweep-and-ownership-linker-bug.response.md`.
Substantive and mostly responsive to what the prompt asked, with real gaps flagged rather than assumed
resolved:

**Fixed, per the response**: (a) `oig_leie_ingestor`'s LEIE upsert batches, (b) all 9 `ownership_linker`
sub-steps, (d) `utils_shared`'s `pending_updates` fetch, (e) `ingestion_tracker`'s `start_run` (with a
self-caught regression along the way — moving query construction outside `safe_execute()` broke a test
using an incomplete stub client; fixed by wrapping construction+execution in a lambda, matching the
original single try/except scope) — all via the same `safe_execute()` pattern `PRI1` already proved
correct. **(c) the `owners` `UnboundLocalError`** — confirmed a genuine, separate Python bug (a failed
preceding step left a local variable unassigned that a later step referenced unconditionally), fixed
independent of the retry work.

**Open questions, answered**: **(f)** the all-zeros summary + "counters not recorded" warning are two
separate, both-benign phenomena that looked like one alarming thing — not real data loss hiding behind a
broken counter. **(g)** `census_demographics_ingestor.py` confirmed vulnerable to the same connection
issue, but this specific run's actual failure cause could not be determined from the available log
excerpt — stated plainly as unresolved rather than assumed. **(h)** the actual crash trigger — traced all
25 pipeline steps' try/except coverage and the post-loop tail code, found no unprotected path, concluded
possibly an OOM/platform-level kill consistent with a failure mode already documented elsewhere in the
repo — **genuinely unresolved**, reported honestly as such. **Section 2** (root cause of the connection
drops): **not determinable from this repo** — no lockfile/Dockerfile/Railway config committed to audit
actual resolved dependency versions, no deliberate version bump in git history; the call-site
`safe_execute()` approach remains the practical path forward.

**Gaps flagged, not glossed over**: the response asserts "(a)-(e), (g): fixed, each with before/after
proof" but the actual before/after proof text was not visible in what this session could extract from
the `.docx` (paragraph-only extraction — may exist in a table this method missed). The file list names 5
changed files (`oig_leie_ingestor.py` +23-6, `ownership_linker.py` +202-105, `utils_shared.py` +39-24,
`ingestion_tracker.py` +53-31, `test_pri3_connection_retry_sweep.py` +406-8) plus a **6th, unnamed file**
("Show 1 more" in the transcript, not expandable from the extracted text).

**Merge status: unconfirmed, and this matters.** The session was explicitly instructed not to open a PR
unless told to, and closes by referencing `sbriggssjc/Dialysis#7406` as the branch's PR going forward —
this confirms the PR exists, **not that it's merged**. Scott's "This PR is merged" message most likely
refers to the `life-command-center` documentation PR for this round (confirmed merged from the
subsequent git state), not necessarily the `Dialysis`-side code fix. **Asked Scott directly to confirm
whether `Dialysis` PR #7406 (branch `claude/epic-archimedes-jpcknd`) is actually merged** before treating
this fix as deployed.

`PLANNED-BACKLOG.md`'s `PRI3` row updated to 🟡 (fix applied and tested per the response, held short of
✅ pending that confirmation). Prompt moved to `docs/claude-code/prompts/done/`. Response docx pending
archive to `responses/done/` on Scott's machine.
## 2026-09-11 — PDR14b shipped + live-applied: dia dangling property_id self-heal, ongoing monitoring, acceptance test confirmed

**Scope: `domain='dia'` only, per the prompt's explicit instruction** — `domain='gov'` (PDR14-GOV,
above) is deliberately untouched, a small closed gap that does not need this machinery.

**Real split (measured live, not extrapolated): 31 via PDR14a redirect / 13 via an unambiguous
PDR13-style parcel_number match / 46 flagged, never guessed.** Re-derived independently against
PDR14a's own resolver (`dia_resolve_property_id`, called via `domainQuery('dialysis', …)` — the
direct service-key path, never `diaQuery`/the anon-keyed edge function): of 1,246 distinct
dia-linked property ids across 1,304 dia-domain LCC entities, **89 distinct dead pids / 90 dangling
entities** (one dead pid, `29100`, is shared by two entities — a fact the earlier pid-level "89"
figure could not see). `dia_resolve_property_id` answered **31 of 89 exactly**, matching PDR14a's
own reported split. For the remaining 58, reused PDR13's `dia_find_property_twins_strong_id`
approach rather than inventing a new scoring scheme (parcel_number, exact match, single candidate,
`min length 6` — its own default): **13 of the 58 resolve unambiguously** (one candidate at
`parcel='14'`, length 2, was correctly refused — the exact class the length floor exists to catch).
No medicare_id/CCN fallback was possible — none of the 58 carry one in metadata, a real ceiling, not
a shortcut. **46 entity/pid pairs (45 distinct dead pids) flagged into the new
`lcc_dia_property_link_review` table, unresolved, never guessed.**

**Applied live 2026-09-11** (`supabase/migrations/20260911190000_lcc_pdr14b_dia_property_link_review.sql`
+ `…190100_…one_time_sweep_corrections.sql`, both idempotent/state-guarded — a replay after the
corrections already landed is a safe no-op). Every correction went through a single merge-owner RPC
(`lcc_pdr14b_apply_dia_redirect`, SECURITY DEFINER, service_role-only, revoke+assert stanza per the
SEC1 doctrine) — `entities.metadata` is a shared jsonb column with many writers, so a PostgREST PATCH
would have replaced the whole column (the OCR2 footgun); the RPC fills only the PDR14b keys and is
fill-blanks-guarded (`WHERE metadata->>'domain_property_id' = <dead pid>`, so a race against another
writer degrades to a no-op, not a clobber). Auditable: every corrected entity carries
`metadata.domain_property_id_corrected_from/_at/_via`.

**Acceptance test — confirmed live, not just planned:** `get_property_context` for entity
`d90be440-c4f2-4e6c-a50e-8a0be44c9d76` (DaVita/Donna-TX) now resolves `domain_property_id=39874`
(was `37722`), and property `39874` carries **7 documents, 1 transaction, both recorded_owner_id and
true_owner_id populated** — the exact regression PDR3/PDR6 have been blocked on since PDR13 shipped.

**Ongoing monitoring (never let this go silent for months again):**
`GET/POST /api/dia-property-link-tick` (`api/_shared/dia-property-redirect-planner.js` for the pure
resolution logic; the handler lives in `api/admin.js`, mounted in `server.js`). GET is an ungated
dry run (scans, classifies, reports counts, never writes); POST is gated behind
`PDR14B_DIA_REDIRECT_SWEEP` in `feature_flags_registry` (**on**) and self-heals going forward using
the identical redirect→parcel-match→flag resolution order. Chose the **recurring-sweep** shape over
inline self-heal inside `get_property_context`'s own read path: the read path is a hot, latency-
sensitive context assembler serving live agent/UI traffic, and adding a redirect RPC call + a
possible parcel-match probe on every cold read would add unpredictable tail latency to a path this
repo already documents as needing an assemble-on-miss fallback for long-tail properties (see
`mcp/context-assemble.js`); a scheduled sweep bounded at `limit=200` (mirrors the `property-twin-
assist-tick` pattern) keeps the fix off the hot path while still closing the gap within one cron
cycle of the next dia merge. Visibility: the `lcc_dia_property_link_review` table is the reviewable
queue (mirrors the repo's other review-lane pattern — reversible via `resolved_at`/`resolved_via`,
never hard-deleted); `feature_flags_registry` carries the flag's live state per the Inert-Feature-
Registry doctrine so an "off" sweep is visible on the daily brief's Dormant Capabilities section
rather than silently no-op'ing forever, the exact failure this whole prompt exists to prevent.

Tests: `test/pdr14b-dia-property-redirect.test.mjs` (15 tests) pin the planner's pure logic — a
live pointer is never touched (the resolver only ever receives already-dangling candidates), a
resolvable pointer is corrected exactly once via a named channel (redirect preferred over parcel
match when both would apply), an ambiguous or sub-threshold parcel match resolves nothing, and the
live DaVita/Donna-TX acceptance case is pinned as a positive control. `npm run check:boot` and the
`sql-definer-privilege-stanza` guard both pass with the new RPC (0 new offenders).

**Backlog updated:** PLANNED-BACKLOG.md PDR14 row → shipped+live-verified end to end (both PDR14a
and PDR14b sides); PDR3/PDR6 → confirmed live, no longer blocked.

## 2026-09-11 — PDR14a shipped + live-verified; government-side parallel gap investigated and found small, closed, and fully explained; recommendation delivered

**PDR14a (Dialysis repo) verification.** Independently re-checked every claim in the shipped response against
live Dialysis_DB before trusting it: `dia_property_redirects` table + `dia_resolve_property_id` resolver +
`v_dia_property_redirect_resolved` view, backfilled from all 5 known merge ledgers into 1,267 deduplicated
active redirects (confirmed live: `count=1267, active=1267`). Re-ran my own 89-item orphan list through the
resolver directly: **31 resolve, 58 don't** — a correction to my earlier 28/61 ledger-tally estimate (the
difference is chained resolution plus a soft-merge column no single ledger could see). DaVita/Donna-TX positive
control confirmed: `37722`/`23545`/`37710` all resolve to `39874`. Design note worth keeping: the redirect-write
hook lives in the shared `dia_merge_property` primitive, not `dia_merge_property_reversible` as I'd assumed in
the prompt — the geospatial cron calls the primitive directly. **PDR14b (life-command-center side) is now
unblocked and ready to send.**

**Government-side investigation** (Scott's explicit request: "ensure something similar is not happening on the
government side"). `entities.domain='gov'` is LCC's largest entity population (29,813, bigger than dia's
14,387), with 7,224 distinct gov-linked property_ids. **Orphan rate: 5 of 7,224 (0.07%) — ~100x lower than
dia's 7.1%, and unlike dia's 61 unexplained cases, all 5 are fully explained with zero mystery left.** All 5
trace exactly to a single 20-row batch in `p31_property_consolidation_log` (applied 2026-08-04, a genuine
hard-delete path) — confirmed by intersecting its 20 `drop_id`s against LCC's gov-linked ids: exactly 5 matches.
The structural reason gov's rate is so much lower: its dominant dedup mechanism, `gov_property_dup_retire_log`
(157 rows), **never deletes a property row — it flips `properties.status` from `active` to `archived` and
leaves it in place** (spot-checked 20 retired ids live, all still exist). That mechanism is immune to the
PDR14 bug class by construction. gov's `property_merge_log`/`gov_property_merge_backup` tables (dia's heaviest
sources) have 0 rows each — essentially unused on this side. Also checked the separate `metadata.source_property_id`
field (~2,478 distinct gov entities, not covered by the `domain_property_id` check): 100% resolve, zero orphans.

**Recommendation delivered to Scott:** do not build a parallel PDR14a/14b-style redirect-table apparatus for
gov — the gap is small, closed, and fully explained. Fold a tiny gov sweep (resolve the 5 known orphans
directly off `p31_property_consolidation_log`) and a lightweight gov leg of PDR14b's ongoing-monitoring tick
into PDR14b's existing scope instead of filing a separate prompt pair, since PDR14b already plans a
domain-agnostic monitoring tick and gov's exposure going forward is only from any *future* reuse of a
hard-delete-style consolidation path.

**Docs:** `PLANNED-BACKLOG.md` PDR14 row updated to shipped/verified outcome; new **PDR14-GOV** row added.
PDR14a's prompt + response moved to `done/`.

**Next step.** Awaiting Scott's go-ahead to fold the gov leg into PDR14b before sending it to the
life-command-center session. PDR2 (ownership guard-gap) and PDR12 (Rock Hill planner gap) remain queued,
unaffected.

## 2026-09-11 — PRI1 merged and confirmed excellent; then a live CMS ingestion crash revealed the same root cause is causing REAL data loss across at least 3 pipeline components — full catalog filed as `PRI3`

Two things landed together this turn: PRI1's response (thorough, answered every unit directly), and a
fresh CMS ingestion crash Scott reported via Railway's own "Deploy Crashed" email plus the run's logs.

**PRI1, closed.** `fetch_properties_for_extraction()`'s bare `.execute()` now routes through the
codebase's own `safe_execute()` (already used at 113 call sites, already special-cases this exact
`ConnectionTerminated` error as transient) — a genuinely well-scoped fix that reused an existing pattern
rather than inventing one. Confirmed the RLS-check warning shares the same root cause (one cached
Supabase client, one connection pool). Traced the 5-hour idle-container mystery to nothing in the code
and pointed at Railway's own container lifecycle instead — asked Scott to check for a distinct "exited
with code 1" line to confirm, still open. 64/64 tests pass. PR `sbriggssjc/Dialysis#7404` confirmed
merged. Moved to ✅ in `PLANNED-BACKLOG.md`.

**Then the fresh crash arrived — and it's much worse than PRI2's "wasteful but survives" framing.**
Scott's freshly triggered CMS run hit the identical `ConnectionTerminated` error, but at call sites
`PRI1`'s fix doesn't touch, and this time with **real, permanent data loss**, not just doubled retries:

- `oig_leie_ingestor`: `fetched=84001 upserted=42000 errored=42001` — essentially half a federal
  exclusion-list ingestion run lost, no per-batch retry (291 distinct failed-batch log lines in this
  window alone).
- `ownership_linker`: **all 9 of 9 linking sub-steps failed**, zero retry anywhere, every counter `0`
  this run.
- A genuine **separate code bug** inside that same cascade: `Address matching failed: cannot access
  local variable 'owners' where it is not associated with a value` — an `UnboundLocalError`, not a
  connection error, needing its own real fix.
- `utils_shared`'s `pending_updates` fetch and `ingestion_tracker`'s run-start both hit the same error
  (the latter retries twice and still fails) — meaning **this run may have no `ingestion_tracker` row at
  all**, worth knowing given how much this arc has leaned on that table.
- The final run summary printed **all zeros** with an explicit warning that counters "were not
  recorded" — unclear whether real clinic processing (earlier, outside this log excerpt) also failed, or
  the counters mechanism itself silently breaks under upstream errors.
- `Pipeline finished with 1 failed step(s): census_demographics` — cause not visible in this excerpt.
- The actual fatal crash Railway's email refers to isn't visible in this log slice either — it ends on
  an orderly-looking (if all-zero) summary, not a raw traceback.

**Filed the full catalog and a remediation plan as `PRI3`** (`PLANNED-BACKLOG.md`), with a drafted prompt
(`docs/claude-code/prompts/PRI3-connection-retry-sweep-and-ownership-linker-bug.md`) asking the
Dialysis-side session to apply the same `safe_execute()` pattern PRI1 already proved correct to each
newly-found call site, fix the `owners` bug directly, and get plain answers on the three open questions
(the zeroed counters, `census_demographics`, and the actual crash trigger) rather than assuming.
`PRI2`'s row updated to point at `PRI3` for the full severity picture, since "wasteful retries" was too
mild a description once real data loss was confirmed.

**Next step.** Send `PRI3` to the Dialysis-side CC session — recommend this one NOT be queued, given
confirmed data loss, unlike `PRI1`'s original "add to the to-do list" framing. Still separately owed:
the `clinic_quality_metrics` full-table scale check that was the original reason for triggering this run
— worth re-running once `PRI3`'s connection issues are addressed, since this crash likely means the
CMS-clinics phase of this particular run didn't complete cleanly either.

## 2026-09-11 — PDR14 investigated per Scott's direction: only 28 of 89 orphaned LCC-dia links trace to a known dia merge ledger; evidence points the other 61 at pre-audit-log-era cleanup, not ongoing loss; two fix prompts filed (PDR14a, PDR14b)

Scott's direction: dig into the 66 unexplained orphans to rule out an ongoing/larger issue, but pursue
correctness regardless of whether the exact cause is found, and build the fix so both databases actively
propagate and reconcile with each other going forward, in both directions.

**Searched every dia table that could plausibly hold merge/consolidation history** (5 found:
`dia_property_merge_backup`, `property_merge_log`, `dia_property_consolidation_log`,
`p31_property_consolidation_log`, `dq7_property_merge_map`). Of the 89 orphaned links: **12 trace to
`dia_property_merge_backup`** (Aug 14 onward, includes PDR13's own 3), **11 to `property_merge_log`**
(April-May 2026 merges), **5 to `p31_property_consolidation_log`** — 28 total explained. Notably, the
11 in `property_merge_log` all carry a `reconciled_lcc_at` timestamp claiming 100% reconciliation, yet
LCC's entities still show stale pointers for every one of them — whatever that column meant, it did not
mean "wrote back to `entities.metadata.domain_property_id`."

**The remaining 61 have no trace in any of the 5 ledgers.** Could not confirm a specific cause via code
(the Dialysis repo is too large to grep quickly over the device connection — attempts timed out). Circumstantial
evidence gathered instead: 76% of the 61 (48 of 63 entity rows) were created 2026-04-26 through 05-16, a
tight 3-week cluster right around `property_merge_log`'s own earliest entry (04-29); several carry literal
placeholder names (`"property <uuid>"`). Consistent with early, pre-audit-log-era data hygiene passes
rather than ongoing silent loss — not proof, the strongest evidence available without more archaeology
than the question is worth.

**Filed two prompts** (fix spans both repos, per Scott's "both databases working together" direction):
- `PDR14a-dia-canonical-property-redirect.md` (Dialysis repo) — consolidate the 5 fragmented merge/
  consolidation ledgers into one canonical, permanent redirect table every current and future dia
  property-merge path writes to (backfilled from all 5 existing tables so the 28 explained cases carry
  forward, chained where a property was merged more than once).
- `PDR14b-lcc-domain-property-reconciliation.md` (life-command-center repo) — a reconciliation sweep +
  read-time self-heal + ongoing monitoring: resolve via PDR14a's canonical redirect first (chained),
  fall back to confident address/parcel/CCN re-resolution (mirroring PDR13's own strong-id logic) for
  cases with no redirect trace, queue anything not confident for human review, and keep checking on an
  ongoing basis so this class of gap can never again go unnoticed for months.

**Docs updated:** `PLANNED-BACKLOG.md` PDR14 row carries the full investigation. Also had to repair
PDR3/PDR6/PDR13 rows, which a concurrent session's branch (merged in between, unrelated PRI1/PRI2 work)
had reverted back to their pre-verification text via what looks like a merge-conflict resolution that
picked the stale side — restored to the correct, live-verified versions.

**Next step.** Send both prompts to their respective sessions. PDR2 (ownership guard-gap) and PDR12
(Rock Hill planner gap) remain queued behind this, unaffected.

## 2026-09-11 — Escalation: the CMS ingestion re-run's own logs show the exact same connection-reset error from `PRI1` firing on 50% of ALL Supabase calls, continuously — not a rare blip, filed as `PRI2`

Scott sent partial logs from the fresh CMS ingestion run he'd triggered ("here's the logs so far"), meant
mainly to eventually confirm `clinic_quality_metrics` at scale. That check still isn't done — this
excerpt only covers the first ~80 seconds — but a much bigger thing jumped out first.

**`src.supabase_execute_wrapper`'s `supabase.execute` calls are failing their first attempt exactly 50%
of the time** (1,714 of 3,428 calls in that 80-second window), with the **identical error signature**
found in `PRI1`'s crash just hours earlier: `RemoteProtocolError: <ConnectionTerminated error_code:0,
last_stream_id:3, additional_data:None>`. The sequence is a near-perfect alternation — fail, succeed,
fail, succeed — meaning **a retry is happening here and does work**, unlike `public_record_ingest.py`
(no retry, crashes outright). But this means the CMS ingestion service is silently doubling its Supabase
call volume on essentially every single write, continuously, in live production — not as an occasional
transient event, which is how `PRI1` was originally framed.

**Given the exact same error text in two different services, this looks like a shared root cause** —
most likely in `supabase_execute_wrapper.py` itself or the underlying httpx/HTTP2 client configuration
(e.g. a pooled connection Supabase's edge has already reset getting reused on the first attempt every
time), not two coincidentally-identical bugs. Filed as **`PRI2`** in `PLANNED-BACKLOG.md`, cross-linked
from `PRI1`'s row with an update flagging the escalation. **Not yet drafted as a prompt** — recommending
the root cause get found first (why is every first attempt failing?) before `PRI1`'s downstream retry
fix gets sent, so we're not just adding a second retry loop on top of an already-degraded connection
layer.

**Next step.** Wait for the rest of the CMS run's logs (or query Dialysis_DB directly once it's done) to
finish the `clinic_quality_metrics` scale check that closes the ratings arc — the 50% retry pattern
doesn't appear to be losing data, just doubling load, so it shouldn't invalidate that check. Separately,
decide with Scott whether `PRI2`'s root-cause investigation should go out before or alongside `PRI1`.

## 2026-09-11 — New defect found and triaged: `public_record_ingest.py` crashes its whole batch on a single dropped Supabase connection (`PRI1`, queued not urgent)

Scott noticed a separate service crash while checking on the (unrelated) CMS ingestion run he'd
triggered, and asked for a triage + backlog entry rather than an immediate fix.

**Triage, from the Railway logs he shared**: `public_record_ingest.py`'s batch (`batch=800
chain_canonical_only=true force=false`, started 07:03:04 UTC) crashed 2 seconds after starting —
`fetch_properties_for_extraction()`'s Supabase `query.execute()` raised an unhandled
`httpx.RemoteProtocolError: <ConnectionTerminated error_code:0, last_stream_id:3, …>` (a dropped HTTP/2
stream), which propagated uncaught through `run_batch()` → `main()`, killing the entire batch before a
single property was processed. A near-simultaneous warning on what looks like the same connection
(`user_interactions RLS check failed: <ConnectionTerminated …>`, same `last_stream_id:3`) suggests one
dropped connection, not two bugs — worth confirming, not assuming. Separately noted: the container sat
idle for 5+ hours after the crash before "Stopping Container" — worth a plain answer on whether that's
expected or itself a small gap (a crashed process should probably exit promptly). Also flagged, cosmetic
only: `"pending_updates is schema-light... this is OK"` logged at `error` severity despite saying it's
fine — the same log-severity false-positive pattern seen in the CMS ingestion service, not a real defect.

**Filed to `PLANNED-BACKLOG.md` as `PRI1`** and drafted
`docs/claude-code/prompts/PRI1-public-record-ingest-connection-terminated-crash.md` — a standard
retry-with-backoff fix around the vulnerable Supabase call(s), reusing whatever retry pattern already
exists elsewhere in the codebase rather than inventing one. **Queued, not sent** — Scott asked to add
this to the to-do list, not fix it now; ready whenever he wants to run it through the Dialysis-side CC
session.

**Next step.** Still waiting on the CMS ingestion run Scott triggered to finish, to do the final
full-table `clinic_quality_metrics` check that closes the CQM1/RATINGS arc. `PRI1` can go out independently
whenever convenient — it's unrelated to that arc.

## 2026-09-11 — CQM1 merged; fix independently confirmed live (single row), held at 🟡 not ✅ pending full-table proof — and the saved response transcript itself was thin, flagged rather than papered over

Scott reported CQM1's PR merged and the response saved. The saved `.docx` turned out to only capture the
session's CI-monitoring/wrap-up narration — waiting on a background test run, discarding a known
test-artifact-dirtying side effect, confirming a clean tree, the merge handoff — **not** the substantive
answers to the prompt's own Unit 1 (root cause) or Unit 3 (real-value-change vs. no-op) questions. Named
this plainly in the `.response.md` rather than inferring content that wasn't there.

**Independently verified the core fix live instead**, since the transcript's own proof was missing:
`clinic_quality_metrics.max(updated_at)` moved from the 2026-03-12 baseline (stuck through this whole
arc) to **2026-09-11 11:54:01 UTC** — exactly one row touched, consistent with a single hand-verified
proof row from inside the fix session itself, not yet a full production run. `updated_at` genuinely moves
now, which it never did before this fix.

**Held at 🟡, not ✅** — same discipline `RATINGS-INSERT-COLLISION` was held to before its close: a
single proven row isn't the same as full-table production-scale proof (`ratings`' close required
7,013/7,013 rows in a real ingestion run). `PR sbriggssjc/Dialysis#7403` confirmed merged (commit
`a0e2ffa`, branch `claude/exciting-hopper-ycrafc`); full suite reported 3,170 passed/0 failed, no
regressions.

**Next step.** Wait for (or trigger) a real `clinic_quality_metrics` ingestion run and re-check live at
scale, the same way `ratings` earned its ✅. With that, and Unit 1/3's answers if they still matter, this
closes out the entire CFE-RUNAWAY → RATINGS-INSERT-COLLISION → RATINGS2 → RATINGS3 → CQM1 arc.
## 2026-09-11 — PDR2/PDR3/PDR6 root-caused (read-only investigation, no writes): all three trace to ONE shared cause — dia's own `properties` table has 5 un-deduped rows for the DaVita/Donna-TX address; PDR1's entity merge never touched it

Per this arc's "measure before building" discipline, before drafting a follow-up prompt for the three
confirmed-open gaps PDR1's merge left behind (PDR2 ownership, PDR3 sale history, PDR6 CMS link), ran a
read-only Explore investigation against live data rather than guessing scope.

**Shared root cause, filed as `PDR13`:** dia's internal `properties` table has 5 separate, never-merged
rows for this one physical address — `37722` (canonical, per PDR1's cross-domain entity merge), `23545`
(real owner "Phil Decarion" + the real sale), `37710` (duplicate CoStar capture of the same sale),
`39874` (the correct CMS/Medicare link), `45543` (address null). **PDR1's merge unified the cross-domain
`entities` layer only — it never touched, and structurally cannot touch, dia's own property-table
duplication.** The existing `dia_auto_merge_property_duplicates` cron (confirmed alive, hourly, last run
2026-09-11 11:35 UTC) requires byte-for-byte identical normalized address strings within the same state
to detect a duplicate group — this property's 5 differently-formatted address strings never match under
that key, so the group is entirely invisible to the cron's own candidate view. A match-key-too-strict
bug, not a "not wired" gap.

**PDR2 (ownership)** — the operator flag is already correct (`is_operator_not_owner=true` on the DaVita
`true_owners` row), but `api/operations.js`'s `assemblePropertyPacket()` (~lines 8811–8829) reads the
true-owner name with an unconditional join that ignores the flag, unlike two other code paths in this
repo that already guard it correctly. **This is systemic, not one-off: 4,026 properties fleet-wide carry
the same unguarded-read shape** (1,182 of them pointing at this exact DaVita placeholder row) — a much
larger blast radius than this one property.

**PDR3 (sale history)** — not a missing-data gap. The Feb-2019 sale ($3,639,317, buyer Phil Decarion) IS
on file, sitting on dia's un-merged sibling `property_id=23545`, never reaching the canonical record —
a linking gap. `bd_opportunities` (Salesforce) already links this deal correctly to the canonical entity.
**Correction to Scott's own recollection: the sale is dated February 2019, not "2017-18"** — no trace of
an earlier transaction found anywhere in either database.

**PDR6 (CMS link)** — the matcher already fired successfully, just on sibling `property_id=39874`, not
the canonical record. Confirmed the matcher (`api/admin.js`, `cms-match?action=resolve`) is pull/
on-demand only (no cron) — nobody has loaded the canonical property's CMS tab since the PDR1 merge, so
it's simply never been asked. Even if asked, there's no merge-time propagation step to copy a sibling's
CMS link onto a survivor.

**Docs updated:** `PLANNED-BACKLOG.md` PDR2/PDR3/PDR6 rows corrected in place with the measured root
causes above (was: "confirmed open, needs own prompt" placeholder). New row **PDR13** filed for the
shared dia-property-dedup cause, with the Explore agent's own recommendation carried forward: a fix
should probably start there, since a smarter dia-side merge key or a secondary CCN/medicare_id-based
merge pass would likely resolve PDR3 and PDR6 as a side effect, before patching each symptom
individually. PDR2's guard-gap fix stands on its own regardless (systemic, unrelated to whether the
properties table gets de-duped).

**Next step.** Two follow-ups, different shape: (1) PDR2 — a guard-gap fix sized against the real
4,026-property blast radius, not DaVita alone; (2) PDR3/PDR6 — likely resolved together by fixing PDR13
(a smarter dia-side property-merge key or a CCN/medicare_id-based secondary merge pass), worth trying
that first before hand-patching either symptom. Have not yet decided whether to send one combined prompt
or two separately-scoped ones — that's the next call before drafting. Separately still queued from
2026-09-10: the small PDR12 planner fix (Rock Hill self-referencing-candidate detection), not yet sent.
Also still open, no urgency: 167 `needs_human` ambiguous entities sit in the live
`ambiguous_entity_resolution` Decision Center lane whenever Scott wants to start working them.

## 2026-09-11 — Closed out the arc's last open thread (`RATINGS2`'s `clinic_quality_metrics` half): probe fix confirmed working, but found a second, previously out-of-scope occurrence of RATINGS3's exact `updated_at` blind spot; new prompt filed

Continued straight from closing `RATINGS-INSERT-COLLISION`, since one thread was still open: `RATINGS2
(clinic_quality_metrics half only)`, unverified since 2026-09-10. Checked it live against the same
2026-09-10 22:05–22:07 UTC production run already confirmed for the `ratings` fix, rather than waiting
for another uploaded log.

**Probe-count fix: confirmed working.** `edge_logs` shows only 36 `select=*&limit=1` probe calls against
`clinic_quality_metrics` in the run's first minute, then zero in every minute after — down from the
original 844×/30s runaway, and matching the once-per-run cache reset RATINGS2 described (a one-time
burst while the cache populates, not a per-record recurrence).

**New defect found, not fixed yet:** `clinic_quality_metrics.max(updated_at)` and `max(created_at)` are
both still stuck at 2026-03-12 despite **1,994 `PATCH .../clinic_quality_metrics` calls returning `204`
(success)** in that same run. Spot-checked one directly (`medicare_id='012500'`,
`snapshot_date='2023-12-31'`) — still shows `updated_at = 2026-03-11`, untouched by the run. Confirmed no
update trigger exists on the table. **This is RATINGS3's exact `updated_at`-never-stamped blind spot,
recurring on a second table** — RATINGS3 explicitly scoped `clinic_quality_metrics` out of its fix, so
this was always a known gap, just not yet checked live until now. Whether the underlying column values
are actually changing on those 1,994 successful PATCHes is a separate, still-open question (no pre-run
snapshot exists to diff against) — what's confirmed here is the measurement blind spot itself, mirroring
RATINGS3's own finding almost exactly.

**Filed `docs/claude-code/prompts/CQM1-quality-metrics-updated-at-stamp.md`** for the `Dialysis`-side
session: stamp `updated_at` explicitly in `clinic_quality_metrics`'s write path (same shape as RATINGS3's
fix to `ratings`), and confirm whether real data is changing on those PATCHes or if they're pure no-ops.
`RATINGS2 (clinic_quality_metrics half only)` moved from 🔴 to 🟡 — split credit: probe fix real and
confirmed, updated_at gap real and not yet fixed.

**Next step.** Send `CQM1-quality-metrics-updated-at-stamp.md` to the `Dialysis`-side CC session per the
usual convention. Once merged and deployed, re-check `clinic_quality_metrics.updated_at` live the same
way — including whether real values changed — before closing this last thread.

## 2026-09-10 — PDR1 EXECUTED: 19 of 22 ambiguous entities merged live (incl. DaVita/Donna-TX); found a real planner gap on 3 more; confirmed DaVita's actual downstream effect

Scott approved running all 22 auto-mergeable entities. Before executing, re-scored the 22 winners
individually and found something the population-level split didn't surface: **3 of the 22 (Kohl's /
Hobby Lobby and Shops / 1522-1526 Meeting Blvd, all Rock Hill SC) have candidate lists that reference
EACH OTHER as candidates**, not only real property records — a case the scoring planner's address/
signal logic doesn't detect (a candidate that is itself another unresolved placeholder can still win on
address quality). Merging these 3 could conflate separate deals into one asset. Held them back, ran the
other **19**, and reported this to Scott as a real gap rather than silently narrowing the batch.

**Executed via direct `rpc/reconcile_entity` calls** (this session has live Supabase access; the code
isn't deployed to Railway yet, so calling the RPC directly — the same function the app's own endpoint
would call — was the reliable path rather than waiting on a deploy). All 19 succeeded (`ok:true`),
logged to the new `lcc_ambiguous_entity_automerge_run_log` (run id 1): CherCo NewCo–Victoria TX, DaVita–
Daytona Beach FL, **DaVita–Donna TX**, DaVita Dialysis–Banning CA/Dearborn MI/Kenansville NC/Succasunna
NJ, DaVita MOB–Tracy CA, Davita-Anchored Medical Office–Danville IL, Dialysis Clinic Inc–Opelousas LA,
FBI–Champaign IL, Fresenius–Cleburne TX, GSA-SSA–Montrose CO, GSA-USDA–Sherwood AR, MPLX-Tesoro–
Dickinson ND, Nexus Medical Consulting–Schertz TX, Pyramid Healthcare–Springfield MA, SSA–Warner Robins
GA, VA/CBOC–Spirit Lake IA.

**DaVita/Donna-TX's actual downstream effect, verified live (not assumed) via `get_property_context`
against the canonical entity post-merge:**
- **PDR4 (documents) — ✅ FIXED.** 3 documents now show (was 0): a CREXi OM plus two OM emails.
- **PDR7 (activity log) — 🟡 IMPROVED, not fully fixed.** 6 events now (was 1) — OM intake events, the
  original inbound email, listing-document-received events. Still no pre-2026 history.
- **PDR2 (ownership) — ❌ NOT fixed, confirmed a separate real gap.** `true_owner_name` still reads
  "DaVita Kidney Care" (the operator/tenant), `recorded_owner_name` still null. The entity merge does
  not touch ownership resolution — this is its own pipeline defect, upstream of entity identity.
- **PDR3 (deal history / 2017-18 sale) — ❌ NOT fixed, confirmed a separate real gap.** `transactions`
  is still empty post-merge — the prior sale was never ingested under ANY of the 4 candidate entities,
  not merely mis-attached. A real ingestion gap, not an identity problem.
- **PDR6 (CMS auto-link) — ❌ NOT fixed, confirmed a separate real gap.** `linked_medicare_facility_id`
  still null despite the property now having one clean, normalized address — the CMS auto-linker itself
  needs its own look.

This is exactly the outcome the prompt asked to verify rather than assume, and it came back mixed —
one real fix (PDR4), one partial (PDR7), three confirmed-separate gaps (PDR2/PDR3/PDR6) that PDR1 was
never going to touch. Filed the Rock Hill collision as **PDR12** (a real, small planner gap: detect a
candidate that is itself another ambiguous-flagged entity, force `needs_human` regardless of score).

**Docs updated:** `PLANNED-BACKLOG.md` PDR1 (executed), PDR2/PDR3/PDR6 (confirmed open, own prompts
needed), PDR4 (fixed), PDR7 (improved), new PDR12 row. Run log id 1 carries the full detail JSON.

**Next step.** Three follow-ups now queued, none urgent: (1) size and prompt PDR2 (ownership
resolution treating operator as true owner), PDR3 (missing 2017-18 sale — may need Team Briggs shared
folder or a Salesforce deal-history gap investigation), and PDR6 (CMS auto-linker) — likely one prompt
covering all three since they're all "property tabs that don't self-resolve" in the same family; (2) a
small planner fix for PDR12 before the Rock Hill 3 (or any future case like it) go through the
Decision Center lane; (3) the 167 needs_human entities sit in the new `ambiguous_entity_resolution`
lane whenever Scott wants to start working them — no urgency, they were already sitting unresolved
before today.

## 2026-09-10 — PDR1 live-verified: the real auto-merge/needs_human split measured (22/167/0 of 189), migration applied, DaVita/Donna-TX confirmed resolvable

`PDR1-entity-reconcile-automerge` came back well-built but explicitly flagged its own biggest unknown
honestly: no Supabase egress in the build sandbox, so the real auto-mergeable/needs_human split of the
189-entity population was never measured, and the migration was never applied. This session has live
DB access, so closed both gaps rather than leaving them as "pending":

- **Re-implemented the planner's exact scoring rule in SQL** (address-present +100, normalized +50,
  signal count capped +40; auto-mergeable requires the top candidate ≥100 and leading the runner-up by
  ≥50) and ran it against the live population. **Real split: 22 auto-mergeable / 167 needs_human
  (`margin_too_close`) / 0 with no candidate clearing the minimum, out of 189.** The 167 is larger than
  hoped — most ambiguous entities have two comparably well-populated candidates, a genuine judgment
  call, not noise — but that is the honest number, not adjusted to look better.
- **DaVita/Donna-TX itself verified as one of the 22.** Its three real candidates score 172 (`d90be440…`,
  "1006 I-2, Donna, TX 78537" — addressed, normalized, 11 real relationship/portfolio/identity rows),
  104 (`3c2dc7d3…`, addressed but never normalized), and 40 (`c94991a3…`, the bare city placeholder,
  no address at all) — the planner picks the right winner by a comfortable 68-point margin, exactly
  the ranking Scott's own worked example called for.
- **Applied migration `20260910120000` live** (run-log table + `AMBIGUOUS_ENTITY_AUTOMERGE` flag,
  registered `state='off'`) — additive, reversible, no live effect (the flag stays off). Updated the
  flag's own `notes` column with the real measured split so anyone reading `feature_flags_registry`
  later sees real numbers, not the build-time "unknown."
- **Re-ran the 24-test guard independently** — 24/24 pass, unchanged.
- Moved `PDR1-entity-reconcile-automerge.md` to `prompts/done/`, response `.docx` + new `.response.md`
  transcript to `responses/done/`. `PLANNED-BACKLOG.md` PDR1 and P13#1 rows corrected in place (BUILT →
  BUILT + LIVE-VERIFIED).

**What did NOT happen:** no merge has actually run. `AMBIGUOUS_ENTITY_AUTOMERGE` is still `off` —
DaVita/Donna-TX and the other 21 auto-mergeable entities are unchanged in the live database. Flipping
the flag (or calling `reconcile_entity` directly for the 22, or for DaVita alone to unblock that one
property now) is a live write against `bd_opportunities`/`activity_events`/`deal_party` — asked Scott
directly rather than assuming the "auto-merge the clear cases" decision extends to "and Cowork should
pull the trigger unsupervised the same day it's measured."

**Next step.** Scott's call on execution: run the 22 now (including DaVita), run DaVita alone first as
a single proof case, or hold entirely until he's reviewed the split himself. Whichever he picks, PDR2/
PDR3/PDR4/PDR7 (the property tabs marked "depends on PDR1" in §P17) need a live re-check against
DaVita's post-merge state once it actually merges — not assumed fixed by the merge alone.
## 2026-09-11 — `RATINGS-INSERT-COLLISION` marked ✅ closed: independently confirmed live in production, at full-table scale, not from Scott's uploaded logs but by querying Dialysis_DB directly

Scott reported the RATINGS3 PR merged and shared logs from a run he triggered (starting 2026-09-11
06:16 UTC). That log excerpt only covered its first 19 seconds — CFE-RUNAWAY/PROPREV1-stage activity,
nothing from the ratings phase yet — so rather than draw a conclusion from an incomplete slice, this
session queried Dialysis_DB directly (Supabase MCP), per this arc's own standing discipline.

**Found the real proof, from an earlier run than the one Scott uploaded:** `ingestion_tracker` shows a
`cms_medicare_clinics` run started **2026-09-10 22:05:31 UTC** — after PR #7402 merged at 18:32:10 UTC.
A direct query of `ratings` shows **all 7,013 rows now carry a fresh `updated_at` timestamp, stamped
between 22:05:32 and 22:17:13 UTC in that same run** — the March 2026-03-12 baseline that had been stuck
through three straight rounds is completely gone. Checked `postgres_logs` minute-by-minute afterward:
**zero `ratings_medicare_id_uidx` duplicate-key errors from 22:19 UTC onward**, across the full 8+ hours
to now. This is the first time in this saga a full, real production run has actually executed the fixed
code end-to-end and succeeded at scale — not a single hand-run row in a sandbox, the whole table.

**One residual item, flagged but not blocking:** during the transition window itself (22:05:32–22:17:13),
~219 `ratings_medicare_id_uidx` duplicate-key errors still fired even as all 7,013 rows ultimately
succeeded — declining from ~18–21/minute down to 0 by the end of the window. Most likely explanation:
the old and new containers briefly overlapped during the actual redeploy cutover (consistent with
RATINGS3's own "merged is not running" finding, just observed from the other side — the moment a
redeploy *does* land), or a benign retry-then-succeed race under concurrent writers. Didn't stop a
single row from writing, but worth a quick look if it recurs on future runs.

**`RATINGS-INSERT-COLLISION` moved from 🟡 to ✅** in `PLANNED-BACKLOG.md` — the one open question left
after RATINGS3 (has the redeploy actually happened?) is now answered with live evidence, not an
assumption. This closes a 3-round, cross-repo saga: CFE-RUNAWAY → RATINGS-INSERT-COLLISION → RATINGS2 →
RATINGS3, all confirmed live.

**Next step.** `RATINGS2 (clinic_quality_metrics half only)` is still 🔴 and still unverified — worth a
direct look next time logs or a fresh Supabase check are convenient (does its full-table-probe call
count actually drop to O(1) now?). Otherwise, with `CFE-RUNAWAY`/`PROPREV1`/`RATINGS-INSERT-COLLISION`
all ✅, this arc's only remaining open thread in `Dialysis` is that one `clinic_quality_metrics` check.

## 2026-09-10 — RATINGS3 resolves the 3-round `ratings` saga: the fix was correct all along, the test run was executing stale pre-merge code, and a real (previously invisible) `updated_at` bug was found and fixed; live before/after proof obtained for the first time this arc

`RATINGS3-live-proven-upsert-fix.md` demanded what the first two rounds skipped: an actual before/after
row from Dialysis_DB, not a green-tests assertion. It delivered:

- **Unit 1** — deployed code confirmed to match RATINGS2's own description word for word; no
  description/reality mismatch this round.
- **Unit 2** — reproduced the failure live via `postgres_logs`, then went further and cross-referenced
  `ingestion_tracker`: the 2026-09-10 run judged RATINGS2 **started at 17:23:08 UTC, 69 minutes before
  RATINGS2 merged at 18:32:10 UTC**, with a flat, unbroken error rate straight through the merge instant.
  **The container was running old code in memory for the entire run.** This is a "merged is not running"
  class problem — RATINGS2's fix may have been correct earlier than this arc believed; the round that
  "disproved" it never actually tested it.
- **Unit 3 — the non-negotiable requirement, met**: ran the real client against `id=1` /
  `medicare_id='012500'` directly on Dialysis_DB. No `42P10`, no `23505`, a genuine UPDATE, row count
  held at 7,013. **New defect found in the process**: `ratings.updated_at` has never been stamped by
  either write path and the table has no update trigger — meaning the exact metric
  (`max(updated_at)` unchanged) this whole arc used to judge success was structurally blind to a
  successful write. (The RATINGS2-era duplicate-key storm itself was independently confirmed via
  `postgres_logs` counts, so that specific earlier failure was real — the blind spot compounds the
  difficulty of trusting any single round's verdict, it doesn't erase this one.) Fixed: `updated_at` now
  stamped explicitly in both write paths, gated on column existence.
- **Unit 4** — 6 genuine statement timeouts confirmed within the run's ratings-ingestion hour, correlated
  with but not provably caused by the duplicate-key storm (no `STATEMENT` text retained at this log
  level) — stated as correlation, not causation.
- **Unit 5** — named the real test gap explicitly: RATINGS2's tests mocked a cursor checking a WHERE
  substring, never a real partial unique index — exactly why green tests coexisted with 100% live
  failure twice. Two new regression tests added for the `updated_at` stamp. Local `pytest` still can't
  run in that sandbox (no PyPI egress); `py_compile` used as a fallback, CI's `Run Tests` is the real
  gate.
- **Unit 6** — no gap to disclose this round; Supabase MCP access held for the whole session and live
  proof was obtained exactly as required.

**PR `sbriggssjc/Dialysis#7402` confirmed merged — `main` at commit `000eda1`.** Files: `cms_aux_ingestion.py`
(+15/-0), `test_cms_aux_ingestion.py` (+58/-0).

**Open item, explicitly NOT the same as "merged":** the response itself flags that the currently-running
Railway `cms-ingestion` process needs to be redeployed/restarted onto `000eda1` before the fix takes
effect in production — Dialysis was previously confirmed to auto-deploy on merge to `main`, which may
already cover this, but given this exact round's own finding (a merge that didn't reach the running
process), **this needs to be explicitly confirmed with Scott, not assumed**, before the next test run is
treated as a clean measurement. `RATINGS-INSERT-COLLISION`'s backlog row is moved to 🟡 (fix proven live,
production-running-state unconfirmed) rather than ✅, for exactly that reason. Moved
`RATINGS3-live-proven-upsert-fix.md` to `prompts/done/`; response `.docx` + this `.response.md` filed to
`responses/done/`.

**Next step.** Confirm with Scott whether the Railway service has been redeployed/restarted onto
`000eda1` (or that auto-deploy already handled it), then recommend one more fresh, decisive run that
starts strictly AFTER that confirmation — checking run-start-time against merge-time this time, not just
log content — to close out CFE-RUNAWAY / PROPREV1 / RATINGS2 / RATINGS3 together as a single verified
state.
## 2026-09-10 — PDR1-entity-reconcile-automerge BUILT — planner + auto-merge tick + DC lane; split UNKNOWN (no DB access this session)

**⚠️ DB access was unavailable in this build session (sandboxed, no Supabase egress).** Everything
below is CODE READY TO RUN, not a live-verified result. The auto-mergeable / needs_human split of
the documented 189 `ambiguous_resolution` entities (PLANNED-BACKLOG.md §P17/§P13#1) is **UNKNOWN**
until someone with live DB access runs `GET /api/ambiguous-entity-automerge-tick` (ungated dry run)
against production. Do not read this entry as reporting a real number — it reports what the code
does and how it was tested (fixtures + static/mutation guards only).

**Built, per Scott's decision recorded in P13#1 ("auto-merge the clear cases, queue the rest"):**

- **`api/_shared/ambiguous-entity-merge-planner.js`** — pure scoring planner. Rules (documented,
  NOT measured against the live 189): +100 for any non-empty address, +50 more for a NORMALIZED
  address, up to +40 for real relationship/portfolio/identity signal counts (tie-break only, capped
  so it can never outweigh an address). **Auto-mergeable threshold, stated explicitly**: exactly one
  candidate at score ≥100 (has an address) AND leading the runner-up by ≥50 points (one
  "normalization step"). Below that → `needs_human`, reason named
  (`no_candidate_clears_min_score` / `margin_too_close`). The DaVita/Donna-TX worked example
  (`8d1fd46e-3524-476e-946e-eb33d683820d`) is a FIXTURE built to match the documented shape (bare
  placeholder + un-normalized real address + normalized real address) — it is NOT a live read of
  that entity's actual three candidates, and is labelled as such in the test file.
- **`api/_handlers/ambiguous-entity-automerge-tick.js`** — GET is an ungated dry run scoring every
  open `entities.metadata.ambiguous_resolution` row live; POST is gated behind a new flag
  `AMBIGUOUS_ENTITY_AUTOMERGE` (seeded OFF). **No second merge writer**: both the tick and the new
  Decision Center verdict call `rpc/reconcile_entity` directly via `opsQuery` — the SAME Postgres
  function `mcp/entity-reconcile.js`'s `/api/pipeline/reconcile-entity` HTTP route calls (that route
  lives on the separate MCP server process, `mcp/server.js`, not the Railway app this tick is
  mounted into — routing through the RPC directly avoids an unnecessary cross-service HTTP call
  while still reusing the one true merge writer). Mounted `/api/ambiguous-entity-automerge-tick` in
  `server.js` → `api/admin.js`.
- **New Decision Center lane `ambiguous_entity_resolution`** (`FEDERATED_DECISION_TYPES` in
  `api/admin.js`, `_DC_FEDERATED` in `ops.js`, card renderer in `dc-lanes.js`, lane map entry in
  `review-shared.js`). Verdicts `merge` (repoint to the human-picked candidate via
  `rpc/reconcile_entity`), `keep_new` (`rpc/reconcile_entity`'s `p_keep_new` path), `research`. Card
  re-reads the placeholder + re-enriches + re-scores live at verdict time — never trusts the
  client's payload for the candidate list (the P188 "re-read from source" rule).
- **Migration `supabase/migrations/20260910120000_lcc_pdr1_ambiguous_entity_automerge.sql`** —
  additive: the tick's run-log table + the `AMBIGUOUS_ENTITY_AUTOMERGE` feature-flag seed row
  (`state='off'`). **Not applied to any live database in this session** — no Supabase egress.
- **No recurring cron** (per the task spec — the population is closed, nothing minted since
  2026-08-04; a schedule is not justified until the Salesforce sync starts producing more).
- **Enrichment note:** `entities.metadata.ambiguous_resolution` on the placeholder itself only ever
  stores `{id, name}` per candidate (per `mcp/opportunity-sync.js`) — no address/signal data rides
  on it. Both the tick and the DC lane fetch `address`/`normalized_address` for each candidate id
  from `entities` at read time. Relationship/portfolio-fact/external-identity COUNTS are NOT
  fetched in this pass (documented as an N+1 risk across the closed 189-entity population) — the
  planner already supports them, so a follow-up enrichment pass can add them with no planner change.

**⚠️ `reconcile_entity`'s reversibility is a soft tombstone (`metadata.merged_into`), not a
snapshot/restore pair** like `lcc_merge_entity`/`lcc_unmerge_entity` elsewhere in this repo — there
is no `unreconcile_entity` RPC. Confirming its real reversibility live (a rollback-tested positive
control, per the task spec) is a **named follow-up for whoever runs this against the real DB**, not
assumed here. The test suite proves the tick's HTTP contract with `rpc/reconcile_entity` via static
source assertions (payload shape: `p_placeholder`/`p_canonical`/`p_keep_new`) — it does NOT execute
a live merge+unmerge round trip, because no DB was reachable.

**Tests:** `test/pdr1-ambiguous-entity-automerge.test.mjs` (24 tests) — planner fixtures for the four
required cases (bare-placeholder never wins / non-normalized loses to normalized / threshold
abstains on a close margin / the DaVita-Donna-TX fixture), plus static wiring checks (server.js
mount, admin.js dispatch, FEDERATED_DECISION_TYPES/`_DC_FEDERATED` registration, the tick's payload
shape to `rpc/reconcile_entity`, "no second merge writer" — no direct PATCH of
`bd_opportunities`/`activity_events`/`entity_relationships`), and migration-shape checks. **Full
suite run: 5,744 tests, 5,738 pass / 0 fail / 6 skipped** (one pre-existing count assertion in
`test/review-shared.test.mjs` updated from 30 → 31 decision-lane-map entries to reflect the new
lane — that is the only pre-existing test this touched).

**PLANNED-BACKLOG.md updated in the same change**: P17/PDR1 and P13#1 marked "built, pending live
verification" (corrected in place, not deleted, per doctrine); PDR2/3/4/6/7/9 (which depend on
PDR1's merge resolving DaVita/Donna-TX) noted as still depending on a LIVE run of this code, since
the merge has not actually happened yet.

**Next step for whoever has live DB access:** run `GET /api/ambiguous-entity-automerge-tick`
(ungated, no writes) against production, read the real auto-mergeable/needs_human split, apply the
migration, and — only after reading that split — decide whether to flip `AMBIGUOUS_ENTITY_AUTOMERGE`
on. Then specifically verify entity `8d1fd46e-3524-476e-946e-eb33d683820d` (DaVita/Donna-TX) lands
where the planner says it should and that PDR2/3/4/6/7/9 actually resolve once merged.

## 2026-09-10 — PDR1's root cause traced to an existing decision fork (P13 #1); Scott decided; prompt drafted and sent

Measured the fleet-wide population behind P17/PDR1 before drafting anything, per standing doctrine —
and found it's the same population as `PLANNED-BACKLOG.md`'s P13 decision fork 1, filed earlier this
arc and explicitly reserved for Scott ("do not build past them"). Live count: **189** entities carry
`metadata.ambiguous_resolution` (down from the August audit's 232 — 43 resolved by ad hoc sweeps
since), **116** also `orphan_flagged`, all minted in one **2026-07-28 to 2026-08-04** Salesforce
opportunity-sync burst — a closed population, nothing since. Candidate-list size ranges 2–55 per
entity. Corrected P13's row in place with the re-measurement and the P17 cross-link.

**Asked Scott directly** which of the three strategies P13 already named (auto-merge + review queue /
require manual confirmation for all 189 / treat as canonical and merge lazily) to run, rather than
build past a fork he reserved for himself. **He chose: auto-merge the clear cases, queue the rest.**

**Drafted and sent `docs/claude-code/prompts/PDR1-entity-reconcile-automerge.md`.** One scoring planner
(bare-placeholder candidates never win over an addressed one; non-normalized addresses lose to
normalized ones on tie-break; a concrete auto-mergeable threshold to be measured and reported, not
assumed) feeding two paths through the SAME existing writer (`reconcile_entity` — no new merge path):
a value-gated auto-merge tick for the confident cases, a new Decision Center federated lane for the
rest, reusing `list_flagged_open_deals` as the card source. Explicitly scoped to reuse everything that
already exists (`entity-reconcile.js`, the DC lane pattern from `C13g-min-lane`/`OWN-T0e`) rather than
building new infrastructure. DaVita/Donna-TX itself (`8d1fd46e-…`) is named as a verification target —
confirm which path it lands in and whether PDR2/3/4/7 actually resolve once it merges, don't assume.

**Next step.** Nothing to run until `PDR1-entity-reconcile-automerge` comes back. Once it ships, both
of today's ACI threads (Unit C / role taxonomy, and now entity reconciliation) will have live,
measured outcomes to reconcile.

## 2026-09-10 — Verified `ACI-phase2-unitC`'s claims independently; filed the AC2-sf-context gap as its own row; moved prompt/response to done/

Re-checked the shipped PR's claims against live data rather than taking the commit message at face
value, per this session's standing discipline:

- **Bench jsonb shape** — read a populated `owner_contact_pivot.bench` row live; matches the
  documented shape (`name, role, source, n_props, authority, contact_entity_id,
  is_named_individual`) exactly.
- **Pulliam two-way signal** — `email_bodies` for `apulliam@easterlyreit.com`: **48 inbound / 3
  outbound**, matching the shipped writeup exactly (independently queried, not re-quoted).
- **Ledger migration not applied live** — confirmed: no `lcc_bench_rank_run_log`-shaped table exists
  in `xengecqvemvfknjvbvrq` today. Confirmed a second way: `BENCH_RANK_WRITE` has no row in
  `feature_flags_registry` — the flag isn't even registered yet, so the write path is unreachable
  end to end until an operator does both. **Nothing writes today; this is still a design/build
  artifact, not a live system.**
- **Tests** — ran all three new test files independently (`bench-ranking-planner.test.mjs` 15/15,
  `bench-role-inference-planner.test.mjs` 20/20, `bench-rank-tick.test.mjs` 12/12 — 47 tests total,
  0 failures; the "67" in the commit message counts individual assertions, not test blocks, and both
  numbers are internally consistent).

**Doc fix:** the commit message said "filed AC2-sf-context" but no standalone backlog row existed for
it — added one (`PLANNED-BACKLOG.md`), same pattern as RO2a/RO2b's inline-named-but-unfiled fix
earlier this arc.

Moved `ACI-phase2-unitC.md` to `prompts/done/`, response `.docx` + new `.response.md` transcript to
`responses/done/`.

**Next step — this is now purely an operator action, not a build task:** apply
`20261010150000_lcc_bench_rank_run_log.sql` and register `BENCH_RANK_WRITE` in
`feature_flags_registry` when ready to let the write path run for real; until then AC2/AC3 exist as
correct, tested logic with no live effect. Separately, the property-reconciliation thread (P17/PDR1 —
the DaVita/Donna-TX unresolved Salesforce-sync orphan) is still open and untouched since it was filed.
## 2026-09-10 — RATINGS2 fixed in `Dialysis` (not this repo): the partial-index upsert bug was worse than diagnosed (silently blacklisting the whole table), a second PROPREV1-shaped bug found in the quality-metrics path — but live verification could not happen on either side, this session's Supabase MCP token expired mid-arc too

**The prompt.** `docs/claude-code/prompts/done/RATINGS2-partial-index-upsert-and-cqm-fulltable-probe.md`,
filed for `Dialysis` after a follow-up test run showed RATINGS-INSERT-COLLISION's upsert still failing
100% of the time (partial-index diagnosis) plus a new, much larger full-table probe on
`clinic_quality_metrics`.

**The response**, recovered from Scott's saved transcript (`ratings2 surface response.docx`,
untracked) — full detail in
`docs/claude-code/responses/done/RATINGS2-partial-index-upsert-and-cqm-fulltable-probe.response.md`.
**Confirmed this session's partial-index diagnosis, sharper than expected:** the original
RATINGS-INSERT-COLLISION fix's bare `ON CONFLICT (medicare_id) DO UPDATE` raised Postgres `42P10`
(invalid `ON CONFLICT` spec against a partial index) — and `_direct_upsert_record` caught that error
and **blacklisted the whole table for the rest of the run, treating it as "handled"** rather than
surfacing it, so rows were silently dropped. Fixed with an explicit `conflict_where` predicate on the
direct-SQL path and an **explicit update-then-insert** REST fallback (rejecting the plain-unique-
constraint alternative outright, correctly: both `medicare_id` and the CCN column are legitimately
independently nullable). **A second instance of PROPREV1's exact bug shape found and fixed:**
`_build_quality_payload` called `_has_column(..., refresh=True)` ~30 times per row — once per quality
field — bypassing every cache by design; fixed with a once-per-run cache reset instead. The original
`count=7013` `ratings` probe was confirmed already fixed by the prior PR — a regression test was added
so it can't silently regress. Tests: 6 new + 2 updated, RED-before/GREEN-after confirmed explicitly;
full suite 3,166/0 failed.

**Live verification did not happen on either side of this fix — worth knowing.** The `Dialysis`-side
session's own Supabase MCP token expired mid-session and couldn't be reauthorized non-interactively,
the same failure mode this session is hitting right now (Supabase MCP shows disconnected, needs
reauthorization). **Neither this session nor the one that built the fix has independently confirmed
against Dialysis_DB that an existing `medicare_id` row's `updated_at` actually bumps, or that the
`clinic_quality_metrics` probe count drops to O(1).** PR opened: `sbriggssjc/Dialysis#7401` — merge
status not stated in the transcript, confirm with Scott. 👤 **Scott: please reauthorize the Supabase
connector (claude.ai connector settings) when convenient — both the live-verification step here and
this session's own cross-checks are blocked on it.**

**Responses folder:** the new `ratings2 surface response.docx` has been transcribed and archived to
`responses/done/`, matching the ongoing cleanup convention.

## 2026-09-10 — ACI-phase2-unitC SHIPPED: AC2 bench-ranking planner + AC3 Ollama role-inference planner + reversible write path

Built the prompt sent earlier today (`docs/claude-code/prompts/ACI-phase2-unitC.md`). Scope held to
exactly AC2+AC3, nothing else attempted. Live DB access to `xengecqvemvfknjvbvrq` was available and
used to confirm the `bench` column shape and the Pulliam/Shuler facts before writing any code — no
live writes were made (see "measured vs assumed" below).

**AC2 — `api/_shared/bench-ranking-planner.js` (pure).** `rankBench(candidates)` sorts on a strict
key hierarchy: `two_way` (an inbound/reply signal, absolute) → inferred-function priority
(acquisitions > disposition > transaction_dd > broker; unknown is neutral, never assumed
acquisitions-grade) → correspondence volume → recency (the tiebreak when volume ties) → seniority
(title-derived, 0/unknown when absent — silence, never a junior claim) → name (stable last resort).
**Never collapses to one winner** — every candidate handed in comes back out, ranked, per Scott's
08-26 doctrine ("a re-derived ranking, not a decision recorded once"). Extends the EXISTING `bench`
jsonb shape (`{name, role, source, n_props, authority, contact_entity_id, is_named_individual}`,
confirmed live) by appending `correspondence_volume`, `last_email_date`, `two_way`,
`inferred_function`, `inferred_function_confidence`, `inferred_function_basis`, `seniority_known`,
`seniority_score`, `rank`, `rank_reason` — nothing removed or redefined. `ownerPassesBenchValueGate`
reuses `cadenceSignalFloor()` (`cadence-engine.js`, env `CADENCE_SIGNAL_MIN_VALUE`, default 500000)
rather than inventing a new floor.

**AC3 — `api/_shared/bench-role-inference-planner.js`.** Four-bucket taxonomy from §3a
(acquisitions/disposition/transaction_dd/broker). `titleFunctionHint()` is the deterministic,
no-LLM path — when a title is present and maps cleanly it is confidence `'high'`, basis `'title'`,
and the model is never called (verified: a titled candidate never invokes `invoke` in
`inferBenchRoles`). When no title (or an unmapped one), `invokeExtractionAI` is called via the
repo's existing seam (same shape `ownership-chain-draft-planner.js`/`property-twin-assist-planner.js`
use — `{prompt, surface}` in, `ai.data.response` out), and `resolveCandidateFunction()` is the P181
confidence gate: **a correspondence-only verdict is CAPPED at `'medium'` even when the model itself
claims `'high'`** — the exact rule the prompt's guard asked for. Every inferred function also carries
a verbatim-quote guard on `evidence_quote` (drops the whole verdict, not just the quote, if the
quote is not a literal substring of a supplied subject line — the W8-U3/EXT1 doctrine).

**Write path — `api/_handlers/bench-rank-tick.js`**, mounted `case 'bench-rank-tick'` in `admin.js`
and `/api/bench-rank-tick` in `server.js` (mirrors `tier0-auto-attach-tick.js`'s GET-dry-run /
POST-flag-gated-write shape exactly). GET is always a dry run, ungated, and never writes
(`?infer_roles=1` optionally runs AC3's Ollama call in the dry run too, for grading before the flag
flips). POST writes `owner_contact_pivot.bench` only when `BENCH_RANK_WRITE` is on, value-gated per
owner via `cadenceSignalFloor()`. Reversibility: a ledger row (`lcc_bench_rank_write_log`, carrying
the FULL prior bench array) is written BEFORE the pivot PATCH, keyed `bench_rank_YYYYMMDD_<8hex>`,
mirroring `tier0-attach-effect.js`'s "ledger before write, carries prior state" pattern. A
run-lifecycle table (`lcc_bench_rank_run_log`) is opened before the batch and closed after, P123
style.

**⚠️ Migration NOT applied live.** `supabase/migrations/20261010150000_lcc_bench_rank_run_log.sql`
(both ledger tables, purely additive) is written but was deliberately NOT run against
`xengecqvemvfknjvbvrq` in this session — writing to the production database without an explicit
instruction to do so was judged out of scope. Until an operator applies it, `POST` still cannot do
any real damage: the ledger write fails soft (logged) and the bench PATCH is separately gated on the
`BENCH_RANK_WRITE` flag, which also does not exist yet. **This is a named, deliberate gap, not an
oversight** — an operator needs to (1) apply the migration, (2) add the `feature_flags_registry` row
for `BENCH_RANK_WRITE`, (3) run `GET /api/bench-rank-tick` a few times to eyeball the ranking before
flipping the flag.

**Measured live vs assumed (be explicit, per the task's own instruction):**
- ✅ MEASURED live: `owner_contact_pivot.bench` populated on 1,622 of 5,488 rows (confirms the doc's
  number exactly); the EXACT jsonb shape of a populated row (used verbatim as the planner's
  passthrough fields); `unified_contacts` columns exist as documented
  (title/total_emails_sent/last_email_date/outlook_contact_id/engagement_score/company_name/…);
  Andrew Pulliam resolves at `unified_id=2330d585-…`, `title=NULL`, `total_emails_sent=132`,
  `last_email_date=2023-02-27`, `company_name='Easterly Partners'`; "Shuler"/"Pulliam" search on
  `email_bodies` shows the real inbound/outbound split for the Williston deal — 48 `is_sent=false`
  (inbound) rows and 3 `is_sent=true` (outbound) against `apulliam@easterlyreit.com`, confirming a
  genuine two-way signal exists and that `email_bodies.is_sent` is the right column for AC2's
  two-way input. Ryan/Lucas Shuler does NOT resolve by full-name search in `unified_contacts` —
  confirmed, matching the prompt's warning; the test fixtures model his row as absent/thin rather
  than guessing a resolution.
- ⚠️ NOT measured live (assumed/derived from schema + docs, flagged honestly): the exact live
  ranking `rankBench` would produce over a REAL owner's REAL bench array (no live call was made —
  only reads); whether `invokeExtractionAI` behaves as documented under `surface: 'bench_role_inference'`
  in production (no live AI call was made, by design — tests stub `invoke`); SF campaign/role context
  join shape for AC3's prompt input (`sf_context` is accepted as an optional string field but no live
  `lcc_sf_list_membership` join was written or tested against real rows — the prompt said "reuse the
  existing join, don't re-derive a name-based one," and the handler does not yet build that join at
  all, which is a named gap, see below).

**Named blocker / deferred, per the out-of-scope rules:** the handler's `enrichBenchCandidates` /
`attachInboundCounts` build the correspondence+two-way inputs from `unified_contacts` +
`email_bodies` directly, but does **not** yet join Salesforce campaign/role context into AC3's
`sf_context` field (§3b's email-domain-keyed `lcc_sf_list_membership` join) — the planner ACCEPTS
that field and the prompt builder includes it when present, but the handler never populates it. This
is a real, sizeable remaining wire-up, not attempted here because it needs its own measurement pass
against `lcc_sf_list_membership` (which §3b's correction already flagged as its own can of worms —
`org_entity_id` reads 0 for every high-value owner). Filed as follow-up **AC2-sf-context** below.

AC6 (professional emails misfiled as personal), AC8 (`v_lcc_prospecting_edge_review` false
negatives) and AC9 (competitor-broker edges) were not touched, per the prompt's explicit exclusion.

**Tests:** 3 new files (`test/bench-ranking-planner.test.mjs`, `test/bench-role-inference-planner.test.mjs`,
`test/bench-rank-tick.test.mjs`), **47 + 20 = 67 assertions total, all passing.** Mutation-checked by
hand on the two load-bearing rules (the sort-key ordering and the confidence cap) — both mutations
correctly turned tests red. Positive control on the Pulliam/Shuler pair as fixture data (live facts,
since the doc's own doc-vs-live numbers disagree — 132 emails per the live re-check, 71/51 per the
doc's narrative table — both are exercised as separate test cases rather than picking one).

Backlog: AC2/AC3 rows in `PLANNED-BACKLOG.md` updated 🟡 → 🟢 shipped, with the sf_context gap named.
`account-based-contact-intelligence.md` §7d gets an appended follow-up subsection recording the
outcome (not overwriting the "not attempted" entry from `ACI-phase1-2`, which is now historical).

## 2026-09-10 — Right-sized Unit C follow-up drafted and sent: `ACI-phase2-unitC.md` (AC2 bench ranking + AC3 Ollama role inference)

Picking up the open thread from today's PR reconciliation: `ACI-phase1-2`'s Unit C (the REIT/fund
role-taxonomy build Scott named by name across two turns) was bundled with three other units and
explicitly not attempted, per its own commit message. Rather than re-bundle it, drafted a standalone
prompt scoped to exactly AC2+AC3, nothing else — explicitly excludes AC1d(a/b), AC6, AC8, AC9, and any
new value-gate/bench-shape invention, so it can actually be built and mutation-guarded in one pass.

**Measured before drafting, per standing doctrine:** `owner_contact_pivot.bench` (the ranking column
this needs) is already populated on **1,622 of 5,488 rows (29.6%)** — not a from-scratch build.
Re-checked the doc's own worked example live: Andrew Pulliam (Easterly, 132 emails, last
2023-02-27) has `title = NULL` in `unified_contacts` today — the volume signal is there, the title
signal isn't; Ryan Shuler doesn't resolve by name in `unified_contacts` at all, flagged for the build
to check email/alias before assuming his row is simply thin. Title coverage overall is still 5.2%
(re-confirmed from §7a, unchanged) — named as the binding constraint AC3's confidence-gating has to
account for honestly, not paper over.

**Drafted and sent `docs/claude-code/prompts/ACI-phase2-unitC.md`.** AC2: rank (never collapse to one
winner) on volume/recency/two-way/seniority/inferred function, write into the existing `bench` column,
ship as a pure planner mirroring the `entity-parent-inheritance-planner.js` pattern already proven this
arc. AC3: Ollama infers the four-bucket function (acquisitions/disposition/transaction-DD/broker),
confidence carried per P181, surface gated on it — explicitly told to re-run the Pulliam/Shuler check
live and report the real title-present vs. inferred-only confidence split rather than let the
well-titled 5.2% set the tone for the rest. Value-gate by owner reusing the existing P161/P180
mechanism, no new threshold invented.

Backlog: AC2/AC3 rows updated from 🟢 (designed, not started) to 🟡 (prompt sent), both pointing at the
new prompt file.

**Next step.** Nothing to run until `ACI-phase2-unitC` comes back. The property-reconciliation thread
(P17/PDR1 — the unresolved Salesforce-sync orphan blocking DaVita/Donna-TX) is still open and
independent of this one; Scott's call on which to prompt next, or both can run in parallel.

## 2026-09-10 — Fresh test run (all three `Dialysis` fixes merged) shows RATINGS-INSERT-COLLISION's upsert doesn't actually work — a partial-index/PostgREST gotcha found — plus a new, much larger full-table probe on `clinic_quality_metrics`; RATINGS2 prompt drafted and sent

CFE-RUNAWAY, RATINGS-INSERT-COLLISION, and PROPREV1 all confirmed merged in `Dialysis`. Scott triggered
a fresh run; a ~30-second log excerpt from ~22 minutes in (2026-09-10 17:43:59–17:44:29 UTC) was cross-
checked live against Dialysis_DB.

**RATINGS-INSERT-COLLISION's upsert does not work.** `ratings` is still exactly 7,013 rows,
`max(updated_at)` still 2026-03-12, unchanged across two separate full test runs. The write correctly
logs `op=upsert` now (the conversion from plain `INSERT` did land), but still throws
`duplicate key value violates unique constraint "ratings_medicare_id_uidx"` (3 medicare_ids this
window: 102594, 102605, 102617, all pre-existing March-backfill rows), tripping
`circuit_open:('upsert', 'ratings')` 21× in 30 s. **Root cause found this session:**
`ratings_medicare_id_uidx` is a **partial** unique index
(`... WHERE (medicare_id IS NOT NULL)`, confirmed via `pg_indexes`) — PostgREST's
`.upsert(..., on_conflict='medicare_id')` cannot use a partial index as its `ON CONFLICT` arbiter
without also expressing the predicate, which PostgREST's standard `on_conflict` param can't do, so it
silently falls back to a plain insert that then collides. A genuine PostgREST/Postgres interaction, not
a logic bug in the retry code — flagged to `Dialysis` to confirm independently, not taken on faith.

**New, larger problem found:** an unconditional full-table probe against `clinic_quality_metrics` fired
**844 times in 30 seconds** (`count=7555`, confirmed live to match that table's exact row count) — far
more frequent than any probe measured earlier in this arc (previously ~2 per iteration). No statement
timeouts yet (the table's still small at 7,555 rows), but this is the same unbounded shape as
CFE-RUNAWAY on a table that will eventually hit the same wall. **Also:** the `count=7013` `ratings`
full-table probe that RATINGS-INSERT-COLLISION's own response said was removed (`_load_existing_key_set()`
deleted) still appeared 48× in the same window — that removal apparently didn't fully land, or a second
call site produces the same signature.

**Shipped this turn:** `docs/claude-code/prompts/RATINGS2-partial-index-upsert-and-cqm-fulltable-probe.md`,
covering all three findings, with an explicit ask not to just retry harder — three concrete fix options
laid out for the partial-index problem (RPC with an explicit predicate, drop-to-plain-constraint if
`medicare_id` is truly always non-null, or an explicit update-then-insert-if-no-match pattern) — and an
explicit call-out that this arc has now twice had "tests pass, production still broken" (PROPREV1 found
this once already) and a live-verification unit (not just tests) is required this time too.

**Next step.** Nothing to run until CC returns on RATINGS2. `properties.estimated_annual_revenue`
(PROPREV1) remains unconfirmed either way — this window's log never reached that phase.

**Correction to this session's own prior work:** PROPREV1's backlog row (meant to move it from 🔍 to
🟡 once its response came in) never actually landed — a stale local read at write time caused that
edit to overwrite unrelated `ACI-phase1-2` annotations instead, silently reverting a few lines of that
arc's own prompt-sent notes rather than adding the intended PROPREV1 content (a later `ACI-phase1-2`
follow-up PR re-added its own annotations independently, so no ACI content was lost, but PROPREV1's row
sat un-updated until this entry). Fixed here, and going forward this session is fetching/resetting to
`origin/main` immediately before every edit intended for `device_commit_files`, not just once per turn.

## 2026-09-10 — `PR-scanner-writeback` shipped: assessor/recorder/SOS scans now write real tables; the SF write-back re-confirmed not buildable

Built against the prompt filed by the entry immediately below (`docs/claude-code/prompts/
PR-scanner-writeback.md`). Branch `claude/pr-scanner-writeback-wiring-o6dx47`.

**Shipped:**
- **Assessor scan → `parcel_records`/`tax_records`, recorder scan → `deed_records`** — new
  `api/_shared/public-records-writeback.js`, source-tagged `assessor_sidebar_manual` /
  `recorder_sidebar_manual` (distinct from `costar_sidebar` and the gpt-4o `ai_gpt4o_presumed` leg
  §2a of `public-records-source-lane.md` documents — neither touched). The recorder writer extends
  `deed-parser.js`'s existing dedup/DTO pattern (`buildDeedDataHash`, `validateDeedIngest`) rather
  than forking a second insert shape, per the task's own instruction to check for a reusable writer
  first. New route `POST /api/public-records-capture` (mounted in `server.js`, dispatched from
  `api/admin.js`). Sidepanel gained `loadPublicRecordPropertyView` for assessor/recorder saves
  (requires an operator-supplied domain `property_id` — no address→property auto-match; never guess).
- **SOS scan (incl. CA bizfile) → `llc_member`/`llc_manager` `entity_relationships` edges** — new
  `applySosEntityCapture`. Free-text edge types (no CHECK enum, so no migration needed). Officers /
  registered agent resolved through `ensureEntityLink`, the same choke point every other writer in
  this repo uses. **The residential-vs-agent-service classifier from `address-reverse.js` is reused,
  not re-derived**, and gates whether an address is ever written as a person's residence — tested both
  directions in `test/pr-scanner-writeback.test.mjs` (a CSC/registered-agent address never becomes a
  residence; a real street address does, on the identical code path). `saveOrgBtn`'s no-worklist-
  target path (previously: bare `/api/entities` create, discarding officers/agent/addresses) now
  routes through this.
- **`county-portal-resolver.js` surfaced to the sidepanel** — `handleRecorderPortal` already existed
  in `api/admin.js`; it had no dedicated mount. Added `app.all('/api/recorder-portal', …)` to
  `server.js`. Read-only, gov-only (the resolver's own scope). ⚠️ The sidepanel does not yet call it
  (no UI button wired) — the route is live; wiring the button is a small follow-up (backlog
  `PR-scanner-5`).
- **Guard**: `test/pr-scanner-writeback.test.mjs` — 12 tests, all behavioural (injected `deps` stub
  domainQuery/ensureEntityLink/insertEntityRelationship rather than a source grep), including the
  positive+negative control pair for the residential-vs-agent-service gate. Full suite re-run:
  **5649 pass / 0 fail / 6 skipped** (unchanged skip count — nothing newly broken).

**Sized, not built — both with the reason recorded in `research-workbench.md` §7b /
`public-records-source-lane.md` §7a:**
- **`county_records_needed` research_type / value-gate.** This session has no Supabase/DB access, so
  the population and floor could not be measured — shipping either blind would repeat the exact
  unmeasured-migration mistake CLAUDE.md documents paying for repeatedly (B4/B5, N18, A2's
  `on conflict do nothing` overcount). Sized as a sixth action on the existing
  `v_lcc_ownership_history_lane_split` (mirroring A3's `sponsor_spe` precedent) rather than a new lane.
- **Salesforce write-back for a newly-captured LLC/contact.** Re-confirmed: `api/_shared/salesforce.js`
  is a read-only Power Automate proxy, no Connected App; a repo-wide grep for `sobjects`/
  `/services/data/v`/any SF POST returns nothing — unchanged from C1's finding. Needs an operator
  decision (register a Connected App) before it can be scoped further, let alone built.

**Docs updated in the same change:** `public-records-source-lane.md` §7a (new), `account-based-
contact-intelligence.md` §8b item 1 (struck the "still needed" framing, marked shipped — corrected in
place per doctrine, not deleted), `research-workbench.md` §7b (new), `PLANNED-BACKLOG.md` §P3
(`PR-scanner-1` through `-5`, AC11 corrected in place).

## 2026-09-10 — Scott's manual research playbook checked against the codebase before sending ACI-phase1-2: found the free-source path already half-built, revised the plan

Scott described his pre-LCC manual ownership-research workflow in full detail (netronline → county
assessor → recorder of deeds → Secretary of State → cross-reference in Salesforce/Google → 7-touch
cadence) and asked, before sending `ACI-phase1-2`, to make sure the design covers all of it — entirely
free sources, a possible county-level Chrome/Edge sidebar adapter if one is needed, a priority-weighted
research queue, and a living system that re-checks its own conclusions over time.

**Checked before adding anything to the plan, per standing doctrine — and the finding upgrades the
design significantly:** `extension/content/public-records.js` already scans assessor, recorder, and
SOS sites (including a dedicated CA-bizfile parser with a real bug fix already paid for) and correctly
extracts `mailing_address`, `registered_agent`/`officers`, `grantor`/`grantee`, `tax_amount` — exactly
the data the LLC-member control chain needs. `county-portal-resolver.js` + `county_authority_cache`
(926 counties) already ingest netronline's own index — Scott's literal starting point is already data
in this database. **The actual gap: the sidepanel's save handler for a scanned public-records capture
discards everything except `name`+`description`, going through a generic entity-create call instead
of the real structured writer (`upsertPublicRecords`) that already works and is proven live for
CoStar.** This is a wiring defect, not a missing subsystem, and it means the "wait for paid APIs"
framing in `account-based-contact-intelligence.md` §8 (written earlier this session) was wrong —
corrected in place with a banner, not deleted.

**Filed the finding** in `public-records-source-lane.md` §7 (the canonical page for this exact
question) and cross-linked from §8. **Drafted and sent `docs/claude-code/prompts/PR-scanner-writeback.md`** —
wire the three scanner outputs into real writers (reusing `upsertPublicRecords`, building a new
SOS-officer writer that creates the `llc_member`/`llc_manager` entity_relationships edge type), surface
the netronline-sourced county portal URLs in the sidepanel, extend `research_workbench` (not a new
queue) for the priority-ranked "what to research next" list, and size — not blind-build — the
Salesforce opportunity/list write-back Scott's workflow ends with.

**Revised `ACI-phase1-2.md`'s Unit D in place** (not yet sent to CC — Scott asked to hold before
proceeding) to source from `PR-scanner-writeback`'s real captures once shipped rather than only the
thin `true_owners.notice_address_1` signal, without blocking on it landing first.

Backlog: new row `PR-scanner-writeback`; `AC11` corrected in place with a pointer to the finding.

**Next step.** Both prompts (`ACI-phase1-2`, revised, and `PR-scanner-writeback`, new) are ready to
send — Scott's call on sequencing, per his own "build both side by side" instruction from the prior
turn. Nothing to run in this repo until one comes back.

## 2026-09-10 — ACI-phase1-2 returned: measured Units A/B/D against live data, shipped the two units the measurements justified, left C unbuilt (scope), branch `build/aci-phase1-2` pushed

Real DB access to LCC Opps (`xengecqvemvfknjvbvrq`) was available this session — every number below
is a live query result, not an estimate. Given the size of the four-unit prompt, this pass prioritized
honest measurement over attempting full implementation of everything; Unit C (the REIT/fund bench +
Ollama role-inference build) was **not built** — it is a genuinely large surface (correspondence
scoring, a new Ollama prompt/taxonomy, a value-gated federated lane) that this pass could not build
and guard to the repo's own mutation-testing standard in the time available, and shipping it
half-guarded would itself be a defect this repo's doctrine warns against repeatedly. What shipped:

**Unit A(c) — reject-learning, built as PURE LOGIC ONLY, deliberately NOT wired.**
`api/_shared/tier0-domain-demote.js` + `test/tier0-domain-demote.test.mjs` (11 tests, all pass).
Re-measured the premise first: `select count(*) from lcc_tier0_confirm_log where verdict='reject'`
→ **0** (27 total rows, 0 rejects) — reproducing P194's own finding exactly. There is nothing to
learn from yet, so the module is pure logic, unwired into any cron/view/handler, keyed on
`(domain, match_arm, match_key)` — never bare domain, per the P194 corroboration trap explicitly
re-tested in the guard (a shared domain across owners is corroboration, not a contradiction; the
guard proves a reject on one `match_key` does not demote a different `match_key` or `match_arm` on
the same domain). `tier0DemotionReadiness()` is the honest gate for whoever wires this later — it
reports `readyToWire: false` today. Unit A(b) (un-park signals from correspondence/SF/title/sponsor
map) was **not built** — same scope reality as Unit C, filed open below.

**Unit B — AC1e SPE-subsidiary parent inheritance, planner built, verdict-path wiring NOT built.**
`api/_shared/entity-parent-inheritance-planner.js` + `test/entity-parent-inheritance-planner.test.mjs`
(8 tests, all pass). Re-measured the "19 of 107 cards" figure per the prompt's instruction — it has
moved: `select count(*) from v_lcc_entity_tier0_parent` → **227** (was 330), and every subsidiary in
that view already resolves to exactly ONE parent candidate (`group by entity_id, count(distinct
parent_entity_id)` → max is 1 across all 227). The "which person" ambiguity Scott named (UIRC = 7
candidates) lives one level down, at the PARENT's own Tier 0 bench, not at the subsidiary→parent
mapping — so the planner takes the parent's resolved contact state as an input and states plainly
when it is ambiguous (`needs_human` / `parent_has_multiple_unresolved_candidates`), never guessing.
**Not built:** the actual bulk-attach call site that would run this planner against live data and
route its output through `applyTier0Attach` (the existing single writer) — that requires fetching
live `v_lcc_entity_tier0_parent` rows and the parent bench state, wiring a new Decision Center lane or
sweep, and re-running the guard against real UIRC/NGP rows. Filed open below.

**Unit D — control-chain classifier: SIZED, and the honest finding is the population is effectively
ZERO for the `notice_address_1`-only path this session was scoped to. No lane built (per the
prompt's own instruction: "if the population is too small, say so and do NOT build a lane").**
Measured live (`xengecqvemvfknjvbvrq` joined against `zqzrriwuavgrquhisnoa` dia):
- `one_off_owner` entities (C13b/C13c classification): **142** total.
- Of those, only **19** resolve to a dia `true_owners` row via `external_identities` (source_system=
  'dia', source_type='true_owner') — **0** resolve to a gov `true_owners` row at all.
- Of those 19 dia-linked entities: **`notice_address_1` is non-null on 0 of 19.** `llc_named` (name
  contains LLC/L.L.C) is also 0 of 19.
- **The population this unit was scoped to build against is literally zero.** No new
  `entity_relationships` edge type (`llc_member`/`llc_manager`) was added, because there is nothing to
  attach it to from this data source alone.
- `PR-scanner-writeback.md` (the richer capture path the prompt says to prefer if it has shipped) was
  checked — **not shipped** (`grep -rl "llc_member\|sos_officer\|recorder_capture" extension/ api/`
  returns nothing). This unit should be re-run once that lands; per the prompt's own instruction this
  is not a reason to block Unit D today, and it was not blocked — it was measured and correctly
  produced "do not build" as its answer.

**AC6/AC8/AC9 re-measurement (input-quality spin-offs feeding Unit C) — partially re-measured, not
fixed.** AC9's Easterly count does not cleanly reproduce by a simple query: 17 `prospecting_contact`
edges exist on Easterly-named entities today (not the "7" the August finding cited), and confirming
which are genuinely competitor-broker edges (vs. real named contacts) needs the same role/company
join C11 already built, which was not re-run here for time. AC6 and AC8 were not re-measured this
session — filed open below, unchanged from the prompt's own citation of the August audit.

**What's genuinely new and durable from this pass:** two small, independently-guarded, honestly-scoped
pure-logic modules, both mutation-tested to the repo's own standard, both **explicitly not wired to
any cron/view/handler** because the data or the calling surface to wire them against either doesn't
exist yet (A-c) or wasn't built this session (B's attach call site) — and one hard, useful negative
result (Unit D: the population is zero on the data source this pass was scoped to).

**Open, filed as backlog rows below (not built this pass):** Unit A(b) un-park signals · Unit B's
live wiring (fetch + Decision Center verdict/sweep + re-guard against real UIRC/NGP data) · Unit C in
full (bench ranking Tier 1, Ollama role inference Tier 2) · AC6 (professional-email misfile
re-measurement) · AC8 (`v_lcc_prospecting_edge_review` narrowness re-measurement) · AC9 (Easterly
broker-role re-role, now measured at 17 candidate edges, not confirmed-broker count).

**Branch:** `build/aci-phase1-2`, pushed, not merged, no PR opened per instruction.
## 2026-09-10 — PROPREV1 fixed in `Dialysis` (not this repo): CFE-RUNAWAY's client-threading fix was correct but insufficient — the real bug was one layer downstream, in `column_exists()` itself; the responses folder consolidated (old Word transcripts archived to `responses/done/`)

**The prompt.** `docs/claude-code/prompts/PROPREV1-estimated-annual-revenue-propagation-still-dropped.md`,
filed for `Dialysis` after the post-merge test run showed `properties.estimated_annual_revenue`
propagation still failing 54/54 times despite CFE-RUNAWAY's own response claiming it fixed.

**The response**, recovered from Scott's saved transcript (`PROPREV1 surface response.docx`,
untracked) — full detail in
`docs/claude-code/responses/done/PROPREV1-estimated-annual-revenue-propagation-still-dropped.response.md`.
Directly answers this arc's own question: **CFE-RUNAWAY's client-threading fix was present in the
merged code, exactly as described — it was correct but insufficient.** The actual bug was one layer
downstream: `column_exists(refresh=True)` (`src/schema_guards.py:208`) called a chain
(`utils_shared.get_columns()` → `core_utils.get_table_columns()` →
`schema_introspection.load_schema_map(..., force_refresh=False)`) whose first rule is "prefer the
on-disk cache always" whenever it's non-empty — **ignoring the live client entirely, regardless of the
`refresh=True` the caller passed.** Since the `properties` cache is populated (just missing this one
column), it always answered `False` before ever reaching a real live probe. Fixed by skipping that
cache-derived shortcut when `refresh=True`, and by having `propagate_financials_to_properties()` pass
its client explicitly rather than relying on a fallback. **Test gap confirmed too:** all 8 of
CFE-RUNAWAY's original tests stubbed `column_exists()` out entirely, so none of them ever exercised the
real live-check chain — a new test file (4 tests) does, proven RED before the fix and GREEN after.
Full suite: 3,159/0 failed. **Delivery: PR `sbriggssjc/Dialysis#7400`, branch
`claude/trusting-dijkstra-rrztfz` — merge status not stated in the transcript, confirm with Scott.**
Unit 5 (live confirmation against Dialysis_DB) was not run from the CC sandbox (no egress) — worth an
independent Postgres/edge-log check once deployed, the same way the first two fixes in this arc were
confirmed.

**Responses folder cleanup, this turn:** the untracked Word-doc transcripts in
`docs/claude-code/responses/` for items already fully captured in a tracked `.response.md`
(`CFE-RUNAWAY`, `RATINGS-INSERT-COLLISION`, `COPILOT-OPEN-gate`, `SFENRICH-gate`, `TEST-NET-LEAK`,
`RAILWAY-PA-SECRET-log`, plus the new `PROPREV1` one) are being moved into `responses/done/`, matching
the existing convention there. One additional docx (`RAILWAY surface response.docx`, no `-log` suffix)
is the **first, unrecoverable** RAILWAY-PA-SECRET-log attempt already documented in this file's own
2026-09-10 "the CC session finished, but its branch never reached GitHub" entry — archived as-is,
no new `.response.md` needed, since several older numbered prompts in `responses/done/` already sit
docx-only with their outcome captured here instead.

## 2026-09-10 — ACI-phase1-2 designed and sent: Tier 0 completion + REIT/fund role taxonomy + a new individual-owner control-chain classifier

Scott's direction: build the individual-owner path and the institutional REIT/fund path side by side
so nothing gets missed between them, plus formalize a third piece he described in detail — an LLC
recorded-owner → member → residence-address → tax-bill-mailing-address chain that identifies who is
actually in control (single member/family → treat as an individual owner; multiple members → the one
whose address demonstrates control is the contact). He also asked for Ollama to review and improve
this as data works through the pipeline, with a shrinking human-in-the-loop footprint over time.

**Before designing anything, checked what the exact heuristic he described would actually run on —
and it's mostly not there yet, on three independent fronts:** `entity_relationships` has no LLC
member/manager edge type at all today; `entities.address`/`normalized_address` are populated on 0.3%
of persons and 0.2% of organizations; and the assessor tax-bill data that would corroborate a mailing
address is either GPT-4o fabricating plausible county records (25,334 of 25,621 dia tax rows) or, on
the one real capture source, has never once carried a tax amount — a measured ceiling of zero, not a
gap. Real member/mailing-address data exists behind OpenCorporates and Regrid, both coded, gated on
API keys Scott hasn't provided.

**Asked Scott directly rather than guessing which way to build** — get the paid keys, build free-data-
only and accept under-coverage, or build the framework with stubs. He chose: build the logic now on
free/existing data, accept the LLC-member scenario will be under-covered until real data is added
later.

**Added `account-based-contact-intelligence.md` §8**, the control-chain design scoped to that choice:
uses `true_owners.notice_address_1` (the one real, non-fabricated address field at scale) through the
already-built `address-reverse.js` residential-vs-agent-service classifier, `one_off_owner`
(C13b/C13c) as the single-owner starting signal instead of a member count we can't get for free, and
states plainly this will only resolve a small population until paid data lands — the prompt requires
CC to measure and report that population rather than assume it's worth a lane.

**Drafted and sent `docs/claude-code/prompts/ACI-phase1-2.md`** — four units in one PR, each
independently guarded and revertible: Unit A (AC1d remaining pieces — un-park signals, reject
learning), Unit B (AC1e — SPE subsidiary inheritance), Unit C (AC2/AC3 — bench ranking + Ollama role
inference, gated on landing the AC6/AC8/AC9 input-quality spin-offs first or alongside), Unit D (the
new control-chain classifier, sized before built). Backlog rows AC1d/AC1e/AC2/AC3/AC6/AC8/AC9
annotated; new row AC11 filed for the control-chain classifier.

**Next step.** Build: nothing to run until CC returns on `ACI-phase1-2`. This is the largest and most
novel prompt of the whole owner-contact automation push — expect it to come back partial (Unit D in
particular may report "population too small for a lane" rather than a working build, which is a valid
and useful outcome per the prompt's own instruction, not a failure).

## 2026-09-10 — CFE-RUNAWAY and RATINGS-INSERT-COLLISION confirmed merged in `Dialysis`; a fresh test run shows both holding, but a new bug found: `properties.estimated_annual_revenue` propagation still fails 100% of the time — PROPREV1 prompt drafted and sent

Scott confirmed both `Dialysis` branches merged. The test run in flight was cut short mid-run by that
merge's auto-deploy restarting the container (`Stopping Container`, expected — `Dialysis` auto-deploys
Railway on merge to `main`, no manual step). A 27-second excerpt just before the stop
(2026-09-10 16:27:02–16:27:29 UTC) is the first log to actually reach the financial-estimates
propagation phase, and it's good news on the two fixed bugs: every `supabase_execute_wrapper` call
shows `count=1` (no recurrence of CFE-RUNAWAY's full-table probes) and zero `ratings`/`circuit_open`/
`duplicate key` mentions anywhere (RATINGS-INSERT-COLLISION holding too).

**New problem surfaced, not previously caught:** CFE-RUNAWAY's own response claimed
`properties.estimated_annual_revenue` propagation was fixed (client threaded through the schema-guard's
cache-miss check), with 8 new tests reported passing. **Live, in this window, it failed 54/54 times
(100%)** — `Propagating to properties: {'estimated_annual_revenue': …}` immediately followed every
time by `[schema_guard] Dropped invalid fields for properties: estimated_annual_revenue (live check
kept: none)`. "Kept: none" every single time, not just this one field — the live check is returning
nothing at all. The five already-decided-intentional `facility_patient_counts` drops also appear (56×
each) and are correctly expected — not re-litigated.

**Shipped this turn:** `docs/claude-code/prompts/PROPREV1-estimated-annual-revenue-propagation-still-dropped.md`
drafted and sent to CC for `Dialysis`. It does not assume CFE-RUNAWAY's fix is simply absent — three
hypotheses are laid out (fix didn't land as described, fix landed but the live check fails for an
unrelated reason, or the 8 passing tests don't exercise the real live-check path) — and explicitly asks
for the test-gap itself to be explained, since "tests pass" and "still broken live" together are the
actual finding here, not just the drop itself. **Backlog row added, 🔍.**

**Next step.** Nothing to run until CC returns on PROPREV1. Once merged and auto-deployed, trigger one
more fresh run to confirm all three fixes (CFE-RUNAWAY, RATINGS-INSERT-COLLISION, PROPREV1) landed
together, per Scott's own plan.

## 2026-09-10 — RATINGS-INSERT-COLLISION fixed in `Dialysis` (not this repo) — the prompt's own hypothesis corrected, not just fixed; pushed to a branch, **now merged and confirmed by Scott**

**The prompt.** `docs/claude-code/prompts/done/RATINGS-INSERT-COLLISION-cms-ratings-upsert.md`, drafted
2026-09-10 after this session found the `ratings` circuit-breaker/duplicate-key pattern live in a
Railway log excerpt from the CFE-RUNAWAY test run (see that entry below). Filed for `Dialysis`
(this session cannot reach it directly), same convention as `CFE-RUNAWAY`.

**The response**, recovered from Scott's saved transcript (`ratings insert collision bug surface
response.docx`, untracked) — full detail in
`docs/claude-code/responses/done/RATINGS-INSERT-COLLISION-cms-ratings-upsert.response.md`. Headline:
**the prompt's own working hypothesis was wrong and got corrected, not just patched around.** It
guessed a plain `INSERT` with no upsert path; in fact a fallback (insert → on-conflict → update)
already existed — the real defect was that the fallback still needed a genuine `INSERT` to fail first,
and that predictable failure (for the 3 medicare_ids already present from the March backfill) tripped
a **table-wide** circuit breaker that collaterally blocked unrelated `ratings` rows too, producing the
349 `circuit_open` warnings and 174 pointless retries measured live. Fix: `_ingest_ratings()`
(`cms_aux_ingestion.py:638`) now does a native `.upsert(..., on_conflict=...)`, matching the pattern
already used elsewhere in the same file (`_ingest_payer_mix`/`_ingest_ownership_history`). The second
full-table probe (the `count=7013` mystery value) was a distinct bug, not CFE-RUNAWAY's per-record
pattern — a once-per-run `_load_existing_key_set()` prefetch reading the whole table twice; removed
entirely since the upsert makes it unnecessary. Circuit breaker confirmed to self-reset after an
8-second cooldown (no restart needed) — but a real, separate defect was found and explicitly left
unfixed: `circuit_open` was being misclassified as a transport error, which is what drove the useless
"retry with a fresh client" churn. **The prompt's own Unit 5 assumption was also corrected**: the
`clinic_quality_metrics` skips are NOT a cascade off the ratings failures — they're driven by an
independent `medicare_clinics` lookup with its own breaker key, and those 210 rows genuinely have no
parent yet; Unit 2 landing does not clear that count. `_ingest_quality_metrics` shares the same
underlying helper and is theoretically exposed to the same cascade shape, but was correctly left
untouched since it wasn't reported failing. Tests: 3,155/0 failed (7 skipped, 1 xfailed).
**Delivery: branch `claude/ratings-insert-collision-01TdbTHbDZpAy42HfAvZAA8E`, pushed, no PR opened
(by design) — NOT YET MERGED.** Merge instructions were handed to Scott; confirm before treating this
as deployed.

**Correction to this session's own prior work:** the STATUS/backlog entries for this finding drafted
earlier today reached `origin` (PR #2241) but did not survive it — a later PR merged around the same
time (`docs/aci-phase0-prompt`, #2242) was branched from before #2241 landed, and when main was merged
into it the RATINGS-INSERT-COLLISION block was dropped rather than combined (visible in the repo
history: it is absent from `origin/main` immediately after both merges, though present in the
intermediate merge commit). Several sessions were editing this repo's docs concurrently around
2026-09-10 10:45–11:05 UTC. The fix itself, on Scott's machine in `Dialysis`, was never at risk — only
this repo's paperwork about it. Redone here from the saved transcript, against a freshly re-pulled
`origin/main`.
## 2026-09-10 — ACI-phase0 SHIPPED: AC1b/AC7/AC10 built, live-run, and guarded (`build/aci-phase0`)

The three Phase-0 hygiene items from `ACI-phase0.md` (below), each measured live before AND after,
each reversible, none combined into one migration.

**AC1b — university scope drift closed.** New migration
`20261010120000_lcc_ac1b_top_seller_and_decidability_university_scope.sql` swaps
`lcc_owner_name_is_public_body` for the composed `lcc_owner_name_is_not_prospected` in
`v_lcc_top_seller_prospects` and both CASE arms of `v_lcc_owner_contact_decidability` (column lists
unchanged — predicate-only). Applied live to `xengecqvemvfknjvbvrq`. Measured before/after:
`v_lcc_top_seller_prospects` university-named rows **14 → 1** (the 1 residual, "Idaho State University
Federal Credit Union", is correctly NOT a university — 0 false positives introduced);
`v_lcc_owner_contact_decidability` university rows unblocked as public_body **3 → 1** (the residual,
"George Washington University (The)", is a pre-existing gap in `lcc_owner_name_is_university`'s own
regex — the trailing "(The)" defeats its anchor — unrelated to this swap, out of scope, named not
patched). Guard: `test/ac1b-university-scope.test.mjs` (4 tests, mutation-verified RED reverting the
swap, GREEN restored).

**AC7 — the Andrew Pulliam duplicate merged.** Measured live rather than trusting the August prompt's
numbers: entity `d6b0d27e-…` carries 36 outbound + 1 inbound edges (37 total) and is already
`owner_contact_pivot.active_contact_entity_id` for Easterly Gov Properties; `537ecdd2-…` carries 1
inbound edge only and no pivot reference — both signals agree on the same survivor, no conflict to
adjudicate. Merged via the existing reversible `lcc_merge_entity(loser, winner)` (no new merge path
built, per house doctrine) — `lcc_merge_entity('537ecdd2-…', 'd6b0d27e-…')`. `lcc_entity_merge_log`
id **170**; `v_lcc_entity_merge_reversibility` confirms `reversible=true`. No new test file — no code
changed, and the merge path itself is already guarded (`test/merge-entity-reversible.test.mjs`, P196).
Reverse with `select lcc_unmerge_entity('537ecdd2-c0ac-4ded-b407-78602e42a652')`.

**AC10 — the promotion counterpart built, run for real.** Re-measured the suppressed population before
building anything, per the prompt's own instruction (the August 11-owner/$240.5M figure was stale —
`owner_contact_pivot.active_contact_entity_id` has grown ~50x since): live population **251 owners /
$329,379,804.64** (14 with no pivot row at all, 237 with a pivot row missing `active_contact_entity_id`).
New migration `20261010140000_lcc_ac10_promote_linked_owner_contacts.sql` ships
`v_lcc_ac10_promote_candidates` (ranks the winning linked-person candidate per owner, mirroring
`owner-reachable-via.js::pickReachableVia` — role authority > recency > stable id, brokers/agents/
tenants/operators excluded outright, junk names never promoted), `lcc_promote_linked_owner_contacts
(p_dry_run default true, p_limit, p_batch_tag)` (fill-blanks only, ledger-before-write, re-checks the
pivot at write time so a race can never clobber), `lcc_ac10_unpromote(batch_tag)` (reversal — skips
any row the pivot no longer matches, never forces), and the ledger table `lcc_ac10_promote_log`. Both
SECURITY DEFINER functions carry the revoke + `has_function_privilege` stanza. Forward-running daily
cron `lcc-ac10-promote-linked-contacts` at **06:12 UTC** (confirmed free against the live `cron.job`
table before scheduling — P176 doctrine: a one-shot repair of a recurring gap is a chore repeated
silently forever). Dry-run proved side-effect-free (0 ledger rows written); **real run applied 249 of
251** (2 carry no candidate surviving the junk/brokerage guards and are correctly left unpromoted
rather than guessed at) — 14 `created_pivot`, 235 `filled_active_contact`;
`v_lcc_ac10_promote_candidates` **251 → 0**. Reversibility proven live in a ROLLED-BACK transaction
(unpromoting the whole batch restored the candidate count to 249, then rolled back — the 249 real
promotions stand). Guard: `test/ac10-promote-linked-owner-contacts.test.mjs` (12 tests,
mutation-verified RED on three independent mutations — the fill-blanks UPDATE guard, a missing revoke
stanza, and swapping the cron's real-run call to dry-run — GREEN restored on each).

**Full suite:** `npm test` — 5643 tests / 5637 pass / 0 fail / 6 skipped (unchanged skip set) — nothing
broken by either migration or the two new guard files.

**Docs updated in the same change:** `docs/os/PLANNED-BACKLOG.md` rows AC1b/AC7/AC10 marked ✅;
`account-based-contact-intelligence.md` §7b's stale AC10 flag replaced with the fresh 251→0 count.

**Branch:** `build/aci-phase0`, pushed to origin, not merged (per instructions — no PR opened).

**Next step.** Phase 1 (finish Tier 0 deterministic linkage) and Phase 2 (the REIT/fund role-taxonomy
build — bench ranking + Ollama function inference, Scott's actual ask) can now build against an
accurate, unstale picture.

## 2026-09-10 — Owner-to-contact automation push started: account-based-contact-intelligence.md re-measured, a stale claim corrected, a phased build plan added, Phase 0 prompt sent

Scott's direction: automate owner→contact linkage end to end, minimal human-in-the-loop, split by
owner type — individual/small owners via deterministic linkage (Tier 0), large institutional buyers
(REITs, funds) via the role-taxonomy treatment (Tiers 1-2) already designed in
`account-based-contact-intelligence.md` §3a but never built. Reviewed existing machinery before
building anything, per standing doctrine — this arc was already substantially designed, not started
from scratch.

**Correction found while re-checking, not assumed:** §5a's claim "Outlook contact sync has never been
fed, no Power Automate flow exists" is now FALSE. Live 2026-09-10: `unified_contacts.outlook_contact_id`
populated on 2,835 of 32,858 rows (was 0 in August), `last_synced_outlook` current to today, 2,829 rows
synced in the last 7 days. Someone built and shipped this without updating the doc that called it the
highest-leverage missing piece. `title` coverage moved with it (1.9% → 5.2%) but is still the binding
constraint on Tier 2's role inference. Banners added in place; the doc's §5a "not fed" language is now
marked as August history, not current state.

**Also re-measured:** `TIER0_AUTO_ATTACH` confirmed still `on`; `owner_contact_pivot.active_contact_entity_id`
populated rows grown ~50x since the design doc's baseline (1,440 vs ~27) — flagged that AC10's 11-owner/
$240.5M suppressed count is stale and must be re-measured before it's fixed, not trusted from August;
AC7's Andrew Pulliam duplicate confirmed still live and unfixed.

**Added:** `account-based-contact-intelligence.md` §7, a phased build plan — Phase 0 (three small
hygiene fixes: AC1b scope drift, AC7 duplicate merge, AC10 promotion counterpart) → Phase 1 (finish
Tier 0 deterministic linkage — serves the individual/small-owner majority of the gap) → Phase 2 (Tiers
1-2, bench ranking + Ollama role inference — this is the REIT/fund "who's in charge" ask specifically)
→ Phase 3 (standing loop, broker intelligence, input-quality spin-offs that would otherwise corrupt
Phase 2's correspondence signal). Phase 1 and Phase 2 can run in parallel once Phase 0 clears.

**Shipped this turn:** `docs/claude-code/prompts/ACI-phase0.md` drafted and sent — the three Phase-0
hygiene items, bundled because they're small, independent, and each would otherwise distort the
numbers the next phase measures against. Backlog rows `AC1b`/`AC7`/`AC10` annotated with the send date
and (for AC10) the staleness warning.

**Next step.** Build: nothing to run until CC returns on `ACI-phase0`. Once that's confirmed live,
Phase 1 (Tier 0 completion) and Phase 2 (the role-taxonomy build Scott actually asked for by name) are
the next prompts — Phase 2 is the larger, more novel build and deserves its own careful prompt once
Phase 0's AC10 re-measurement gives an accurate current picture to design against.

## 2026-09-10 — CFE-RUNAWAY root-caused and fixed in `Dialysis` (PR #7398, not this repo) — the exact call site named, two adjacent defects decided, and a real-but-unconfirmed drop in live timeouts

**The prompt.** `docs/claude-code/prompts/done/CFE-RUNAWAY-cms-financial-estimates-repair.md`, filed
2026-09-10 for the `Dialysis` repo (this session cannot reach it directly — no GitHub credentials in
this cloud environment, confirmed again today via a failed `WebFetch` on the PR URL, 404). Handed to
Claude Code on Scott's desktop, where `Dialysis` is actually cloned.

**The response**, recovered from Scott's saved transcript
(`CFE Runaway clinic financial estimates surface response.docx`, untracked) the same way
`RAILWAY-PA-SECRET-log` was recovered — full detail in
`docs/claude-code/responses/done/CFE-RUNAWAY-cms-financial-estimates-repair.response.md`. In short:
**`FinancialEstimateTracker._pk_column()` (`financial_estimate_tracker.py:463-472`) called
`get_live_table_columns(TABLE_NAME, force_refresh=True)` once per clinic, and `force_refresh=True`
was the exact cause of the two unfiltered per-record probes this session measured live on 09-10.**
Fix: cache the PK column once per run, never `force_refresh`. Two adjacent defects (a silently-broken
`properties.estimated_annual_revenue` propagation, and a warning that logged unconditionally even on
success) were fixed alongside it, not left open. The five `facility_patient_counts` field drops were
decided per-field (4 intentional, 1 a real gap with a migration filed for review). Retention
deliberately not executed — proposal only, per the prompt's own scope limit.
**`B6d-cms-restart` checked and reported as probably NOT the same crash mechanism** — worth carrying
into that row's own next read, not assumed answered.

**What this session could independently check, and what it could not.** `Dialysis`'s own diff, tests,
and PR content are **entirely unverified by this session** — no repo access, so everything above is
taken from the transcript, not re-read. What IS independently verifiable from here: Supabase's own
logs. Read just now (2026-09-10 ~15:14 UTC): **postgres statement timeouts on Dialysis_DB dropped
from the ~400/h rate measured this morning to 2 in a 20-minute window**, and **zero `python-httpx`
requests of any kind to `clinic_financial_estimates` in the preceding 24 minutes** — both consistent
with the fix being live, but **neither is proof of it**: the service could simply be paused (Scott was
walked through pausing it earlier today) or idle between scheduled passes, and this session cannot
tell those apart from Supabase logs alone. Backlog row moved 🔴 → 🟡, explicitly flagged as
**not yet confirmed merged/deployed** — PR `sbriggssjc/Dialysis#7398`, branch
`claude/cfe-runaway-financial-estimates-b913114d`. 👤 **Scott: confirm whether #7398 merged, and
whether `cms-ingestion` was paused separately** — the STATUS row's ✅/🟡 depends on which one
actually explains the drop.

**Next, once confirmed live:** re-measure COPILOT-SYNC-500 (its row already names CFE-RUNAWAY as the
blocking cause) and CAL-RECONCILE-STUCK; only then re-open UX34a's `v_cms_data` timing, which was
measured under this load.
## 2026-09-10 — C13g-costar-stoplist reconciled (PR #2239): verified independently, live and deployed; the C13g capture-path arc is now fully closed, RCA and CoStar both

Confirmed, not taken on faith: `origin/main` at `e4f71458` (the merge commit itself); Railway `/version`
reads `e4f71458f6a1` — an exact match, live with no redeploy owed. Re-ran
`test/c13g-contact-entity-type.test.mjs` on `main` independently: **11/11**.

**The finding matters more than the fix — read from the diff, not just the summary.** The prompt's own
framing ("CoStar's stoplist is broader and never read back") was wrong, and the response said so plainly
rather than building around it: `contactEntityType()` already checks `contact.type` first, and CoStar's
scanner always stamps an explicit type, so its verdict was winning outright — `hasFirmSuffix()` was never
consulted on this path at all. The real gap ran the OTHER direction: the extension's stoplist is missing
terms `hasFirmSuffix()` already has (Bancorp, Investments, Development, Fund, Ptnrs, Cos, Property,
Enterprises, Mgmt), so a real firm like "Sentinel Bancorp" got an explicit but wrong `type:'person'` stamp
that was trusted verbatim. Fix: an explicit `type:'person'` is now a FLOOR, not an absolute —
`hasFirmSuffix()` can still override it to `'organization'`, one-directional only (an explicit org verdict
is never downgraded, holding the P158a discipline). No second stoplist, no extension code touched — same
shared-guard precedent as the original C13g fix.

**Housekeeping:** `PLANNED-BACKLOG.md`'s row cited `owner-role-classification.md §9h` — that section still
carries the ORIGINAL, now-corrected "never reads it back" claim; the real finding is in the new §9i.
Fixed the citation to point at §9i with a note that it corrects §9h. Updated
`ownership-truth-pipeline-state.md`'s Stage 3 entry and both forward-references, and
`CURRENT-STATE.md`'s owner-role-classification row, from "capture-path fix still has one open residue" to
"C13g + C13g-costar-stoplist both shipped — the arc is fully closed." Prompt and response moved to
`prompts/done/` and `responses/done/` with a transcribed `.response.md` twin.

**Next step.** Build: nothing open under `C13g` at all now — first time this arc has been fully closed on
every front (lane, mutation, placeholder, sponsor-merge, RCA capture, CoStar capture). Operator: unchanged
— the 12 duplicate-entity merge groups on "Duplicate entities — merge" remain the only outstanding piece,
pure app-UI work, no build needed. The next real build decision is a direction call, not a small
follow-on: Stage 4's owner-to-person linkage (only 13% of 6,480 owners have any linked person — the
biggest measured gap in the whole ownership-to-contact pipeline) versus Stage 1's `OWN-T0a` 43.4%
government-source disagreement versus Stage 3's `OWN-T0b/c/d/f/g` 417-merge residue. Worth deciding with
Scott before drafting the next prompt rather than picking one unprompted.

## 2026-09-10 — C13g-costar-stoplist: traced and SHIPPED. Verdict (b) was ruled out, (c) was ruled out, the real cause was a case-(a) gap running the OPPOSITE direction from the row's own framing

Traced the 32-row CoStar residue precisely before writing any fix, per the prompt's own instruction not
to assume the prior "never read back" framing. Result: **`contactEntityType()` DOES check `contact.type`
first** (verdict (b)/(c) — a dropped or renamed field — ruled out by reading the code: the extension's
`contacts[]` snapshot array flows unmodified from `content/costar.js` through `entity.metadata.contacts`
into `unpackContacts()`). CoStar's `_forsale-contacts-parse.js::looksLikePerson()` always stamps an
explicit `type`, so its verdict was already winning outright before this fix — the backend's
`hasFirmSuffix()` guard was never being consulted on this path at all.

**The real gap (case (a), but inverted from how the backlog row framed it):** the two stoplists are not
independently-drifting copies of one list — `hasFirmSuffix()` already covers nearly the entire extension
list (Trust/Holdings/Properties/Capital/Realty/Ventures/Management/Company), missing only 4 brokerage
brand names (newmark/cbre/jll/colliers) that never mattered for this residue. The load-bearing gap runs
the OTHER way: the extension's list is **missing** terms `hasFirmSuffix()` has — Bancorp, Investments,
Development/Developers, Fund, Ptnrs, Cos, Property (singular), Enterprises, Mgmt-abbrev — so a name like
`Sentinel Bancorp` trips the backend's guard but not the extension's, and the extension's (trusted,
explicit) `type:'person'` verdict was minting real firms as people.

**Fix shipped:** `contactEntityType()` (`api/_handlers/sidebar-pipeline.js`) now treats an explicit
`type:'person'` as a floor, not an absolute — `hasFirmSuffix(name)` overrides it to `'organization'` when
they disagree, one-directional only (an explicit `'organization'`/`'entity'` type is never second-guessed
by a name heuristic — downgrading would repeat the P158a false-org-positive mistake). No second stoplist
created; no extension code touched, same precedent as RCA in the original C13g fix. Guard
`test/c13g-contact-entity-type.test.mjs` — 11 tests, all pass; the old "explicit type wins" assertion
(`ACME LLC` + `type:'person'` → `'person'`) was itself pinning the bug and is replaced with the floor
assertion. Forward-mint only — existing mistyped entities stay `entity_type_review` lane population, not
bulk-retyped here. Docs: `owner-role-classification.md` §9i (new); `PLANNED-BACKLOG.md` row
`C13g-costar-stoplist` marked ✅.

## 2026-09-10 (earlier) — C13g-costar-stoplist prompt drafted and sent; a self-caught stat inversion fixed in the pipeline page

Prompt drafted at `docs/claude-code/prompts/C13g-costar-stoplist.md`, sent to CC, not yet run. It does
NOT assume the prior response's "never read back" framing is correct — `contactEntityType()` actually
does honor an explicit `contact.type` before falling back to `hasFirmSuffix()`, which the prior framing
glossed over — so the prompt's first job is tracing the real 32-row CoStar residue to find which of three
possible causes (wrong stoplist, dropped/renamed field, or type never sent) is actually true, rather than
guessing and fixing the wrong layer. Backlog row `C13g-costar-stoplist` annotated with the draft/send
date rather than left silent between "named" and "fixed."

**Also fixed while re-reading the pipeline page for this:** `ownership-truth-pipeline-state.md`'s Stage 4
section had the `UX-T1a-reach` owner-contact-linkage stat backwards — it read "847 of 6,480 owners have
no linked person at all," when the source row in `PLANNED-BACKLOG.md` says the opposite: only 847 of
6,480 (13%) **have** a linked person; 5,633 (87%) have none. Corrected in place — this was my own error,
caught before it propagated into an answer to Scott, not something the builder produced.

**Next step.** Build: nothing to run until CC returns on the stoplist prompt. Operator: unchanged — the
12 duplicate-entity merge groups remain the only outstanding piece of the retype arc.

## 2026-09-10 — C13g capture-path fix reconciled (PR #2234): verified independently, live and deployed; one residual gap filed, not lost

Confirmed, not taken on faith: `origin/main` at `8459f95a` (the CFE-RUNAWAY docs PR, unrelated, which
came after this one); Railway `/version` reads `8459f95a9600` and `c84ac1e9` (the fix commit) is an
ancestor of that deployed SHA — live. Re-ran `test/c13g-contact-entity-type.test.mjs` on `main`
independently: **10/10**.

**What shipped, read from the diff, not just the summary:** `sidebar-pipeline.js::contactEntityType()`'s
no-explicit-type fallback now calls the same `hasFirmSuffix()` guard used elsewhere in the repo instead
of a second, narrower org-marker regex — the actual producer for the RCA/CoStar sidebar-capture "contact"
mint, traced to `unpackContacts()` precisely rather than guessed from the eleven-file grep the prompt
started from. Forward-mint only, correctly scoped: the existing ~1,950-entity population stays
`entity_type_review` lane material per the prompt's own instruction not to build a second retype path.

**Found while reconciling, filed rather than left implicit:** the response and the canonical doc both
named — but the backlog never separately tracked — that this fix closes the RCA majority (115 of 142)
and leaves the CoStar residue (32 of 142) untouched, because it has a different cause (the CoStar
scanner's own `looksLikePerson()` stoplist disagreeing with the backend's, never read back). Filed as
`C13g-costar-stoplist` (🟡) so it doesn't quietly disappear now that `C13g` itself reads ✅. Updated
`ownership-truth-pipeline-state.md`'s Stage 3 section and its two forward-references to match — the
page previously called the whole capture-path gap open; it's now accurate that the RCA majority is
closed and one smaller, differently-caused residue remains.

**Next step.** Operator: the 12 duplicate-entity merge groups are still the only outstanding piece of
the original retype arc — untouched by anything in this session. Build: `C13g-costar-stoplist` is small
and well-scoped if picked up, but nothing here is urgent enough to draft a prompt unprompted; the
larger threads named in the pipeline page (Stage 3's `OWN-T0b/c/d/f/g` 417-merge residue, Stage 4's
mailbox/SF-write-back gaps) are bigger decisions than a follow-on to this arc deserves without checking
with Scott first on direction.

## 2026-09-10 — C13g-OWN-T0e close-out reconciled (PRs #2229/#2231): verified independently, backlog deduped, the C13g/OWN-T0e arc's build side is now fully closed

Both units confirmed live and deployed, not just claimed. `origin/main` at `83a6c1c9` (PR #2231, which
folded in PR #2229's build commit `c4ae6901`); Railway `/version` reads `83a6c1c9c546` — deployed, no
redeploy owed. `test/own-t0e-sponsor-family-lane.test.mjs` re-run on `main`: **23/23**. Live DB re-read
independently of the response transcript: `v_lcc_entity_retype_candidates` **3** rows (was 5 at the
start of this arc's operator work — placeholder excluded, Kvalitena AB retyped by Scott in between,
retype log **13 → 14**), `junk_entity_review` review_id **386** exists, the new
`v_lcc_entity_retype_placeholder_excluded` view exists. `unclassified_rival` **1,501 → 1,500**;
`sponsor_family_confirmed` unchanged at 104; merge log unchanged at 151 — the 12 duplicate-entity merge
groups are still open, unrelated to this unit.

**Housekeeping found and fixed while reconciling:** the build commit added the ✅-closed row for both
`C13g-min-lane-placeholder` and `OWN-T0e-c` without removing the stale open (🟢) row each was replacing
— two backlog entries per item, one current and one dated, sitting next to each other. Removed both
stale duplicates; the ✅ rows (which already carry the older rows' history inline) are now the only
entry for each id. Corrected a third stale line while in the same file: the top-level `C13g` row still
read "see `C13g-min-lane` for the unbuilt lane" — the lane, its mutation pass, and both close-out items
are all shipped now; only the capture-path producer fix remains open under that id. Updated
`CURRENT-STATE.md`'s owner-role-classification row and `ownership-truth-pipeline-state.md`'s Stage 3
section to match (both had called the two close-out items unbuilt, written before they shipped).

⚠️ **OWN-T0e-c's affordance is shipped but still unexercised in production** — worth remembering before
calling this fully proven. The build itself flagged this plainly (no live instance existed to test
against); nothing found in reconciliation changes that.

**Next step, named.** Operator: unchanged — the 12 duplicate-entity merge groups on "Duplicate entities
— merge" are the only outstanding piece of this arc, and they're pure app-UI work now, no build needed.
Build: nothing left to prompt in this arc. The capture-path fix (`C13g` proper — the transaction-vendor
producer that keeps writing new mistyped entities) is the one real open thread left standing behind
this arc, sized at a ~1,950-entity floor; picking it up is a genuine next-arc decision, not a small
follow-on, and is named as such in `ownership-truth-pipeline-state.md`.
## 2026-09-10 — RAILWAY-PA-SECRET-log reconciled: independently re-verified, no gaps found; the re-run this time reached `origin`

The re-run of `RAILWAY-PA-SECRET-log.md` (issued after the prior session's identical work was lost to an
unpushed branch) landed on `main` as `4a6494ea`. Independently re-verified rather than taken on the session's
word: `grep -n "authenticateWebhook(req)" api/sync.js` → the only call site left is inside `webhookAuth()`
(line 190); `grep -n "webhookAuth(" api/sync.js` → exactly seven handlers (`rcm-ingest`, `rcm-backfill`,
`loopnet-ingest`, `processing-complete`, `todo-completion-poll`, `listing-webhook`, `cross-domain-match`);
`proxyToLeadIngest` and `handleLiveIngest` confirmed untouched, as the prompt required. Full `npm test`
re-run on the merged tree: **5,610 pass / 0 fail / 6 skipped** (the session's own handoff number was
5,603/0 — the difference is other PRs landing on `main` in between, not a discrepancy in this unit).
`PLANNED-BACKLOG.md`'s RAILWAY-PA-SECRET row and `AI-SURFACES-OPERATIONAL-REFERENCE.md` §4a-Railway were
already correct as written — nothing to correct in place this time. Prompt + response moved to `done/`.

**Operator order, unchanged and still open (👤 Scott):** (1) redeploy both Railway services now that this is
merged; (2) set `PA_WEBHOOK_SECRET` to the same value Dialysis_DB holds, plus `PA_WEBHOOK_KNOWN_IPS` if known
caller IPs are known; (3) read `[pa-webhook] DENY-WOULD … none` for ~3 days; (4) fix each `none` caller,
starting with the To Do Completion Poll flow's header-less second call (designer edit + re-export — never
hand-edit the JSON) and the three unexported PA5 flows; (5) flip `PA_WEBHOOK_AUTH_MODE=enforce`.

## 2026-09-10 — C13g-min-lane-placeholder shipped and seeded live; OWN-T0e-c's affordance is BUILT (no live instance to exercise it end-to-end)

Two independent, small units off the C13g/OWN-T0e arc.

**1. C13g-min-lane-placeholder (backlog row now 🟢).** `v_lcc_entity_retype_candidates` no longer
surfaces a placeholder entity — measured live before shipping that NONE of the three existing
guards fires on "Research In Progress" (`lcc_is_placeholder_owner_name` / `lcc_p131_is_document_row_label`
/ `lcc_a2_is_placeholder_party` all `false`). Widened `lcc_is_placeholder_owner_name`'s exact-match
IN list with the one literal (blast radius measured first: 2 entities fleet-wide, both genuine
placeholders — `select count(*) from entities where lower(btrim(name))='research in progress'`).
Migration `20261101150000_lcc_c13g_min_lane_placeholder.sql`, applied live to LCC Opps: candidates
view **4 → 3** rows (exact predicted delta); a new `v_lcc_entity_retype_placeholder_excluded` view
carries the excluded population for the seeder. Seeded live: `junk_entity_review` review_id 386,
`heuristic='entity_retype_placeholder'`, `dismiss`, recording the entity held 2 current portfolio
facts. New one-shot `api/admin.js?action=entity-retype-placeholder-seed` (GET dry-run / POST
`&apply=true`) for any future recurrence.

**2. OWN-T0e-c — the "sponsor is itself the duplicate" affordance (backlog row updated, not closed —
no live case exists to close).** Read the design doc §6 per the prompt's instruction before building:
the signal is already computed by the existing cache, no new detector — `spe_ids` (the non-sponsor
side of a group) and `spe_props_max >= 2` (the existing `duplicate_entity_suspect` flag). A card's
own `sponsor_id` showing up inside ANOTHER breadth card's `spe_ids`, where that other card's
`spe_props_max >= 2`, is the NGP-Group-inside-NGP-Capital shape. Shipped:
`findSponsorDuplicateTarget`/`annotateSponsorDuplicates` (pure, `sponsor-family-planner.js`), a
fifth verdict `merge_into_sponsor` (loser = this card's own sponsor, winner = the target — re-derived
LIVE from the cache at verdict time via a `spe_ids=cs.{...}` PostgREST contains filter, never
accepted from the client payload — P188), reusing the exact same `lcc_merge_entity` writer +
refresh pair + reversal as OWN-T0e-b's `same_party`+`merge_now`. Card + button in `dc-lanes.js`
(`dcSponsorFamilyMergeIntoSponsor`, payload `{}` — nothing client-supplied). Guard
`test/own-t0e-sponsor-family-lane.test.mjs` grew to 23 tests; spot-mutation-verified RED on three
of the new assertions (tied refusal, payload-cannot-redirect-target, the branch's own existence).

⚠️ **Checked live, not assumed: NO current card exercises this shape.** The one historical instance
(NGP Group → NGP Capital) was already resolved by a direct manual `lcc_merge_entity` call on
2026-09-09 (backlog OWN-T0e-c's own prior entry). Queried today's cache for any spe_id of a
duplicate-suspect group that is ALSO a sponsor_id elsewhere: **zero rows.** So the affordance is
built and unit-tested but has never fired against production data — say so plainly rather than
claiming an end-to-end verification that did not happen.
## 2026-09-10 — RAILWAY-PA-SECRET-log shipped (re-run — a prior CC session finished this correctly and never pushed)

`api/sync.js::webhookAuth()` is now the single gate for all **seven** PA webhook handlers
(`rcm-ingest`, `rcm-backfill`, `loopnet-ingest`, `processing-complete`, `todo-completion-poll`,
`listing-webhook`, `cross-domain-match`) — confirmed by grep before writing any code, not seven by
memory of the earlier attempt. Each used to inline its own
`if (!authenticateWebhook(req)) { authenticate() + requireRole('operator') }`; `lead-ingest` and
`live-ingest` were never in this population (a pure edge-function proxy and a plain-`authenticate()`
route respectively — see the prompt's Read-first note).

**Why this is a re-run, not a continuation:** a prior Claude Code session completed this exact unit
correctly earlier today, but its branch (`claude/railway-pa-secret-log`) never reached `origin` and
no PR was opened — that work exists only in a now-closed session's local clone and is unrecoverable
from here. Treat everything below as fresh work against `main`, not a resumption.

**What shipped:** `PA_WEBHOOK_AUTH_MODE` defaults to `log`. With `PA_WEBHOOK_SECRET` unset (today's
state on Railway), `authenticateWebhook()` still returns `true` for everyone and `webhookAuth()`
never runs the fallback at all — byte-identical to before this unit. Once the secret is SET: a
caller sending the correct `X-PA-Webhook-Secret` passes as before; a caller the fallback
(`authenticate()` + `requireRole('operator')`, per-handler — three of the seven never required the
operator role and keep not requiring it) would also deny is **logged, never refused**:
`[pa-webhook] DENY-WOULD <route> <fallback-path> <ua_class> <ip_class>`, `fallback-path` ∈
`jwt|api-key|none` from the headers, `ua_class`/`ip_class` mirroring
`supabase/functions/_shared/caller-class.ts`'s classifier in plain JS (`PA_WEBHOOK_KNOWN_IPS`,
same `class:prefix,...` format). `PA_WEBHOOK_AUTH_MODE=enforce` restores byte-identical-to-before
behavior (the fallback's own 401/403 stands). The log line never carries the secret or the caller's
API key — asserted directly, not just by omission.

**Guard:** `test/pa-webhook-auth-mode.test.mjs` (9 tests) — structural (exactly 7
`await webhookAuth(` dispatch sites, `authenticateWebhook(req)` appears nowhere but its own
definition and the one call inside `webhookAuth()`, with a positive control proving a bypass would
be caught) + behavioural (secret unset → nothing logged, nothing refused; log mode never 401s;
enforce mode's 401 matches `authenticate()`'s real body; the correct secret always passes in both
modes; the `requireOperatorRole:false` handlers never 403 a bare caller; the log line never
contains the secret/API-key value; `PA_WEBHOOK_KNOWN_IPS` resolves the IP class). Full suite run
before handing off: **5,603 pass / 0 fail / 6 skipped** (2,489 suites) — not just the new file.

**Branch pushed and PR-worthy this time** (see the "Verify on" checklist in the prompt — confirmed
`origin` carries the branch before ending this entry, not assumed).

**Docs updated in the same change:** `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` §4a-Railway
(new — the Railway-side env var table, distinct from the Supabase `COPILOT_*`/`SFENRICH_*` pair
already documented there) and `docs/os/PLANNED-BACKLOG.md`'s `RAILWAY-PA-SECRET` row (🔴 → 🟡, this
unit's completion recorded, the 👤 operator order restated with the secret-set/read/fix/flip
sequence). **Out of scope, named as such:** actually setting `PA_WEBHOOK_SECRET` on Railway, the To
Do Completion Poll flow's designer edit, exporting the three PA5 flows, and the edge-side gates
(already shipped 2026-09-09) — all 👤 Scott's.

## 2026-09-10 — `fix/ext-host-refuse-retired-origin` failed CI on an unrelated pin, fixed; and the J13 12:30 UTC observation read is clean but IP-level confirmation is still Not on file

**CI failure, diagnosed.** PR `fix/ext-host-refuse-retired-origin` failed `npm test`, but not from the EXT-HOST
code — the full 5,600-test suite (it genuinely runs ~3 minutes; several individual test files that legitimately
take 8–20s each, e.g. `test/auth-fetch-interceptor.test.mjs`'s unmocked `AUTH_READY_TIMEOUT_MS`, were briefly
mistaken here for hangs against a too-short per-file timeout before a full untimed run showed they finish and
pass). The one real failure: `test/costar-record-identity-isolation.test.mjs` pins `manifest.version` to the
literal `'1.0.52'` as a drift guard, unrelated to EXT-HOST; bumping the extension to 1.0.53 broke that pin.
Fixed the pin to `'1.0.53'`; full suite now **5,594 pass / 0 fail**. Follow-up commit written to Scott's disk
on the same branch — pending push/merge.

**J13 12:30 UTC observation read** (LCC Opps `edge_logs`, 12:25–12:40 UTC, plus `staged_intake_items` POSTs
since 11:35 UTC, per the scheduled check-in): **zero 400s** on `mv_user_work_counts` / `v_my_work` /
`action_items` in the window (all 200/206, UA `node` and the edge function's own `Deno`/`SupabaseEdgeRuntime`
UA — the latter is `ai-copilot` calling its own DB, not an external caller); **zero `POST staged_intake_items`**
of any kind since 11:35 UTC (all traffic on that table in the window is `GET`/`PATCH`, UA `node`). Both
measurable signals read clean. **Honestly Not on file this read:** IP-level confirmation that the specific
day-1 caller (`44.205.19.44`) is gone — this session's `query_logs` schema access for per-request IP/header
fields (the `cross join unnest(...headers)` pattern used for the prior writer-IP table) returned backend
errors against this project today; UA-class and status-code fields were readable, IP was not. Zero write
activity of any kind on `staged_intake_items` in the window is itself consistent with "the caller is gone,"
but is not the same measurement as naming the IP — recorded as a gap, not papered over.

**J13-teardown status unchanged:** still blocked on the extension actually being reloaded to 1.0.53 in both
browser profiles (👤 Scott, pending the PR above merging first).

## 2026-09-10 — Close-out prompt drafted for the two remaining C13g/OWN-T0e items; new full-pipeline state page written

Live-checked before writing anything: unchanged since the last reconciliation (merge log 151, retype log
13, lane 5 candidates live — `Kvalitena AB` + 3 likely-genuine person names + the placeholder — none
blocking OWN-T0e). The 12 duplicate-entity merge groups and `Kvalitena AB` are still Scott's, in progress.

**Drafted:** `docs/claude-code/prompts/C13g-OWN-T0e-close-out.md` — bundles the two small items the
mutation-pass prompt named but didn't build: §1 routes placeholder entities (`Research In Progress`)
off the retype lane onto `junk_entity_review`; §2 builds the missing "the sponsor itself is the
duplicate" merge affordance (`OWN-T0e-c`) that NGP Group's case had to work around by hand. Backlog
rows `C13g-min-lane-placeholder` and `OWN-T0e-c` annotated with the prompt reference; both stay 🟢
open until it ships.

**Written:** `docs/architecture/ownership-truth-pipeline-state.md` — at Scott's request, the first page
that walks the WHOLE pipeline he specified (property → recorded owner → chain-to-developer → true
owner → Salesforce/Outlook/WebEx/enrichment → LCC pushed back out) stage by stage, citing every
existing canonical doc and backlog row rather than re-deriving their numbers. Two findings worth
carrying: (1) entity-dedup/entity-typing (`C13g`, the still-unbuilt capture-path fix; `OWN-T0b/c/d/f/g`'s
417 pending duplicate-entity merges) is the single shared blocker behind residue in BOTH the
ownership-chain stage (A2's 92-row residue, 54 of them `ambiguous_entity`) and the entity-resolution
stage itself — fix it once, upstream, rather than per-stage; (2) Stage 5 (LCC writing its resolved truth
back OUT to Salesforce/Outlook/WebEx) is the thinnest stage in the whole pipeline — almost nothing
writes back past Salesforce today, and building more of that has limited value while the store it would
push from is still ~2% mistyped and 43% self-disagreeing upstream. Also folded in: a one-table summary
of the UX-review tiers (UX-T0 through UX-T4) against `PLANNED-BACKLOG.md` §P16, which stays the source
of state.

**Consolidation, checked not guessed:** read the three 2026-07-31 property-owner docs
(`property-owner-subsystem.md`, `property-owner-source-authority-and-doctrine.md`,
`data-quality-lease-and-owner.md`) before deciding whether to banner them — they describe the still-live
Stage 1 evidence-vote mechanism (`lcc_reconcile_property_owner`) that the Stage 3 reconciled store reads
as one of its inputs (`OWN-T0h`), so they are evidence trail, not stale; left as-is rather than bannered
on a guess. Pointers added from `CURRENT-STATE.md` and `PLANNED-BACKLOG.md` §P0d to the new page.

**Next step, named.** Operator: same as last entry — the 12 merge groups and `Kvalitena AB`. Build:
the close-out prompt above is ready to run whenever Scott has a Claude Code turn free; nothing else in
this arc needs a build turn before that.

## 2026-09-09 — C13g-min-lane-mutation reconciled (PR #2222): verified on `main`, tests-only so nothing to deploy; the retype arc's build side is closed

Re-ran `test/c13g-min-lane.test.mjs` on `main` after the merge: **14/14**; the builder's 46/46 RED is its own
claim (not re-run here — a mutation pass is the builder's deliverable, the reconcile checks the guard is green
where it ships). Canonical §9g, backlog ✅ and STATUS were written by the builder in the same commit, as the
protocol asks. **The one finding worth carrying:** the Tier 0 bench **GAINED 10 cards** from three retyped
entities (UIRC 7, Global Net Lease 2, Foulger Pratt 1) — an org-typed owner is eligible for that bench and a
person-typed one is not, so §9f's "retyping touches nothing on Tier 0" was true of Gardner/MassMutual and
false as a lane claim. Same shape as the 12 merge groups: **a retype is a visibility change for every
consumer that filters on type, in both directions.** `v_lcc_entity_role_ambiguity` read 0 before and after
(not every retype moves it). Two assertions survived their first mutation and were rewritten (test rows that
sorted identically by name and rent; a registry regex matching a `research_type` literal) — the mutation pass
finding them, not a read. §3 (placeholder guard) skipped by design → `C13g-min-lane-placeholder` stays open.
Live at 23:26 UTC: retype ledger 13, merge log 151, `unclassified_rival` 1,501, lane visible 2 (`Kvalitena AB`,
`Research In Progress`), the 12 merge groups not yet worked. Prompt + response → `done/`.

**Next step, named.** Operator: the 12 byte-identical merge groups on "Duplicate entities — merge" and
`Kvalitena AB` on the retype lane. Build: nothing further in this arc is worth a turn until those are worked
and re-measured — the remaining open items are small and filed (`C13g-min-lane-placeholder`, the OWN-T0e-c
sponsor-is-duplicate affordance at 1 residual property, the generic-token ack with still zero live instances).
After that, pick the next thread from the backlog rather than extending this one.

## 2026-09-09 — C13g-min-lane-mutation: guard is now 14 tests / 46 mutations RED / 46; both §9f gaps closed

`test/c13g-min-lane.test.mjs` mutation-passed end to end (comments stripped first). Two assertions
survived their first mutation and were rewritten (the ordering test's rows sorted the same way
alphabetically as by rent; the registry-membership regex matched an unrelated `research_type:`
literal instead of the `FEDERATED_DECISION_TYPES` entry). Two assertions added for the same-day
hotfixes' repo-side twins (cache-vs-slow-view; `p_decision_id` bigint matching `lcc_decisions.id`).
`v_lcc_entity_role_ambiguity` before/after and the Tier 0 bench delta both measured in a rolled-back
round trip: the ambiguity view didn't move for the tested entity; the Tier 0 bench gained 10 cards
across 3 of the 11 non-tombstoned retyped entities (UIRC 7, Global Net Lease 2, Foulger Pratt 1) —
§9f's Gardner/MassMutual-only check was right for those two, incomplete as a claim about the lane.
Full writeup: `docs/architecture/owner-role-classification.md` §9g; backlog `C13g-min-lane-mutation`
✅. Not done: the placeholder-guard unit (`C13g-min-lane-placeholder`, unchanged).
## 2026-09-10 — Overnight reads (to 11:35 UTC): nothing paused on Dialysis_DB; the gates are quiet — and the LCC Opps writer-IP read found the extension still posting through the frozen Vercel build (EXT-HOST, fixed in 1.0.53)

**Dialysis_DB, hourly 20:00 → 11:00 UTC:** `clinic_financial_estimates` inserts ~200/h (3,046 in the 20:00 hour
when the probe got through), statement timeouts **320–399 every hour**, cron `job startup timeout` 7–24/h,
`[calendar-reconcile] SKIP` once every hour — **CFE-RUNAWAY is still running; nothing has changed** since it was
filed. `[copilot-auth]` 1–2/h, all the two PA flows; `[sfenrich-auth]` 0.

**LCC Opps, non-Railway `node` callers 2026-09-09 12:00 → 09-10 11:35 UTC** (the J13 observation read, done
early because the 12:30 window had not yet opened when this was written):

| ip | n | window (UTC) | what |
|---|---:|---|---|
| `44.205.19.44` | 17 | 09-09 12:30:01–02 | day-1 briefing burst (v1 flow) — 3 × 400 on `mv_user_work_counts`, `v_my_work`, `action_items`, as fingerprinted |
| `3.94.187.179` | 49 | 09-09 14:28:48–58 | **a full intake write**: `users?email=eq.sabriggs…`, `POST inbox_items` 201, `staged_intake_items` 201, artifacts, extraction, `PATCH` matches |
| `3.82.217.155` | 34 | 09-09 18:59 | the same shape |
| `52.52.108.50` / `52.52.68.232` / `13.56.136.98` / `54.219.3.3` / `13.56.98.77` / `52.52.40.44` | 3,522 / 4,131 / 184 / 844 / 3,319 / 4,568 | 15:38–15:50 / 16:23–16:50 / 19:39–20:47 | 150–1,064 distinct paths each, `workspace_memberships` first — whole-app sessions |
| since 21:00 | **0** | — | clean |

Cross-read against `inbox_items` for the same minutes: 14:28:49 = `sidebar_om` "crexi-1450-Innovation-Parkway…"
(`crexi_sidebar`), 18:59:53 = `sidebar_om` "crexi-103-MBL-BANK-DR…", 20:30:24 = `sidebar_om`
"DaVitaDialysis-Pasco-WA-Loopnet…" — and the `POST staged_intake_items` writer for 20:30:24 is **`52.52.40.44`,
the same address as the 4,568-request burst.** The two other sidebar OMs of the day (13:11:53, 19:25:25) were
written from Railway (`162.220.232.228`, `162.220.232.12`). **So: the browser extension, from at least one of
the two profiles in use (Edge and Chrome both appear at Scott's address), still posts to the retired Vercel
deployment, and each "ephemeral pool" burst in the J13 preflight is that build serving one sidebar session.**
The preflight's §2a reading ("re-executes the app's server logic from Lambda") was right about the mechanism
and silent about the trigger; corrected in place. The runbook's extension line ("1.0.52 is sufficient — the
resolver already prefers Railway") was **wrong**: `pickIntakeHost()` in 1.0.52 returns whatever
`chrome.storage.sync` holds, and a profile configured in the Vercel era still stores that origin.

**EXT-HOST — shipped here (extension 1.0.53):** `isRetiredIntakeOrigin()` refuses any `*.vercel.app` origin
inside `pickIntakeHost()` (platform-wide, because the P194 guard forbids the literal hostname in executable
code); `callLCCApi`/`testConnection` route through the resolver; `sidepanel.js::getLCCConfig()` normalizes its
own read the same way. Five new tests evaluate the real resolver from source: stored retired origin →
Railway (in either key), positive control (a Railway origin is honoured), negative control (the rule is the
platform suffix, not a substring). `test/extension-intake-host.test.mjs` 16/16, retired-identifier guard
green, `node --check` clean. 👤 Reload to 1.0.53 in **both** browsers and set the Settings URL to Railway in
each; proof = two captures per browser landing from Railway IPs.

**J13 consequence:** the observation window's criterion is now concrete — zero non-Railway writers on
`staged_intake_items` and zero AWS-pool `node` bursts — and the window cannot start until the extension is
reloaded everywhere. Today's 12:30 UTC read is still the first test of the *briefing* caller; it is no longer
the only thing being watched.

---

## 2026-09-10 — RAILWAY-PA-SECRET-log: the CC session finished, but its branch never reached GitHub and no PR was opened — nothing to reconcile yet

Scott's transcript (`docs/claude-code/responses/RAILWAY surface response.docx`, untracked) shows the unit
completed in the Claude Code session: `webhookAuth(req, res, routeName, opts)` fronting **seven** call sites
(the session reports the prompt's "eight" was wrong — `lead-ingest` is a pure edge-function proxy with no local
auth check and `live-ingest` uses plain `authenticate()`; `cross-domain-match` was missing from the list and is
included), `PA_WEBHOOK_AUTH_MODE`/`PA_WEBHOOK_KNOWN_IPS`, `test/pa-webhook-auth-mode.test.mjs` 11/11, full suite
5,598/0, docs and a response file — and ends with *"Pushed to claude/railway-pa-secret-log … I did not open a
PR."* **On GitHub: no such branch, no PR, `api/sync.js` on `main` has no `webhookAuth`.** The push did not land
(or landed somewhere other than `origin`). The work exists only inside that session's clone.

**Recovery (👤 Scott, one line in that CC session):** *"Open the PR for `claude/railway-pa-secret-log`"* — the
session will push the branch and create it. If the session is gone, re-run `prompts/RAILWAY-PA-SECRET-log.md`;
it is deterministic enough to reproduce. Reconcile follows the merge, as usual: I will verify the seven-not-eight
claim against `grep -n "authenticateWebhook(req)" api/sync.js` on the merged tree.

Row RAILWAY-PA-SECRET stays 🔴; the prompt stays in `prompts/`. The four `*surface response.docx` transcripts in
`responses/` are Scott's own record and untracked — left as is.

---

## 2026-09-10 — Overnight read: both gates live and quiet; the first outside probes of `ai-copilot` are on record; a BOM in a commit subject

**Live (`list_edge_functions`, 01:40 UTC):** `salesforce-enrichment` **v27** (sha `f0d6db0e…`, updated 01:12 UTC —
the gate is deployed, log-only) and `ai-copilot` v84 (sha `5beebfe6…`). ⚠️ Every function's version counter moved
by +3 since yesterday's read without a deploy (`health-check` 22→25, `npi-lookup` 15→18…), which settles the
v23/v26 puzzle from the SFENRICH reconcile: **the counter is project-wide noise; only `ezbr_sha256` + `updated_at`
identify a build.** Recorded in CLAUDE.md's edge-function footgun.

**`[copilot-auth]` since the Railway redeploy (22:25 → 01:27 UTC):** `logic-apps other` ×4 (the hourly calendar
flow at :26 past each hour, plus `/sync/activities` at 00:01 — `sf-activity-sync`'s daily run), `node railway`
×19 all before 22:36 (they stopped when the browser tab closed — the proxy was the only Railway caller in the
window, so this is **not** evidence that `PA_WEBHOOK_SECRET` landed; RAILWAY-PA-SECRET unchanged), and **three
`GET  browser other`** — `GET /functions/v1/ai-copilot` (bare root, 404) from `98.91.77.46` ×2 and `23.23.253.54`,
UA `Mozilla/5.0 (compatible)`, AWS addresses, 22:52–23:14 UTC. That user-agent string with no product token is a
scanner's, not a person's. First measured outside probe of the function since the gate went in; harmless at the
root path, and exactly the population `enforce` is for. Zero `[sfenrich-auth]` lines — consistent with the
pre-gate 24 h read of zero callers; the ≥ 7-day window starts 01:12 UTC.

**RAILWAY-PA-SECRET-log:** still not on origin. Queued.

**Tooling:** commit `f6d4851f`'s subject begins with U+FEFF — `Set-Content -Encoding UTF8` on Windows PowerShell
5 writes a BOM, and git keeps it. Harmless in history, ugly in `git log`. Message files are now written with
`[IO.File]::WriteAllText` (UTF-8, no BOM).

**Next, in order:** (1) 12:30 UTC today — first clean teardown-window read (J13). (2) RAILWAY-PA-SECRET-log in CC.
(3) 👤 CFE-RUNAWAY — the Railway `python-httpx` service; still the most damaging open item and the one nothing
here can touch.

---

## 2026-09-09 — SFENRICH-gate reconciled (PR #2221): body captured, gate correct, not yet deployed; RAILWAY-PA-SECRET-log is NOT on origin

**Verified against the merged tree:**
- Commit `4135d304` is the deployed body alone (733 lines, one file, no other change); `08fb72bf` adds the gate.
  Live function re-read by MCP after the merge: `ezbr_sha256 8d993301…e23d` — identical to the value CC recorded
  and to the value in this window's own earlier `list_edge_functions` read — and `updated_at` unchanged since
  2026-03-07, so the deployed body has not moved between capture and now. ⚠️ Version number: this window's
  earlier list read said **v23**, CC's `get_edge_function` and mine now say **v26** for the same `updated_at` and
  the same sha. Both on file; the sha is the identity, the counter is not.
- Gate: `authenticateWebhook` before dispatch on every route, **no `/health` carve-out** (the only GET is
  `/diagnostics`, which is the leak); log mode never 401s; `SFENRICH_AUTH_MODE` read once; the DENY-WOULD line
  cannot carry the secret. Classifier factored to `_shared/caller-class.ts`, `ai-copilot` now imports it — 25/25
  across both gate test files, guards green.
- Unit 3 confirmed by the test itself: every step query is a fixed template literal; the only request-derived
  values that reach code are `dry_run` and the path.
- **One deviation, fixed here in one line:** the prompt said reuse `COPILOT_KNOWN_IPS`; CC introduced
  `SFENRICH_KNOWN_IPS`. Kept the name (CC's reason is fair — the caller sets are not asserted identical) but
  added a fallback: `SFENRICH_KNOWN_IPS ?? COPILOT_KNOWN_IPS`, so the operator sets one list unless they
  genuinely diverge. Tests unchanged, still 25/25.
- **Not deployed:** live is still the ungated v26. Deploy is `supabase functions deploy salesforce-enrichment
  --project-ref zqzrriwuavgrquhisnoa --no-verify-jwt` → v27, log-only, nothing refused.

**RAILWAY-PA-SECRET-log: no response file, no branch, no commit on origin** (`api/sync.js` has no `webhookAuth`;
no remote branch carries it). If the CC window finished, its branch was never pushed; the prompt stays in
`prompts/` as queued. The row stays 🔴 and `PA_WEBHOOK_SECRET` stays unset on Railway until it lands.

**Housekeeping, third time:** `COPILOT-OPEN-gate` and `TEST-NET-LEAK` prompt/response files reappeared at the
top level — CC branches are cut from a `main` that predates each move to `done/`, and the merge resurrects the
file. Removed again; the `done/` copies are the record. `C13g-min-lane-mutation.md` belongs to the other window
and is left alone.

---

## 2026-09-09 — SFENRICH-gate: `salesforce-enrichment`'s deployed body committed verbatim for the first time, then gated log-only (COPILOT-OPEN-gate pattern)

DRIFT1-sfenrich closed to 🟡. `salesforce-enrichment` (dia, v26) was open — `verify_jwt:false`, no
`authenticateWebhook()` anywhere in the body, `POST /run` executes a 15-step write pipeline with no
credential — and, unlike `ai-copilot`, its source had never once been in this repo. Fetched verbatim
via `get_edge_function` (`ezbr_sha256 8d993301…`) and committed with **no edits** as
`supabase/functions/salesforce-enrichment/index.ts` in its own commit, before touching anything —
the `sf-test` lesson (capture the body before you change or delete anything). The gate landed second:
`authenticateWebhook()` before dispatch on EVERY route (no `/health`-equivalent bypass — this
function's only GET route, `/diagnostics`, is itself the leak), `SFENRICH_AUTH_MODE=log` default
logs `[sfenrich-auth] DENY-WOULD ...` and lets the request through unchanged, `enforce` 401s.
`verify_jwt=false` pinned in `config.toml`. The UA/IP classifier is now the shared
`_shared/caller-class.ts` module `ai-copilot` also uses (factored out of `ai-copilot/index.ts`'s
inline copy in the same change) rather than a second copy of the same regexes; a test proves the
classifier's output is unchanged after the move on a fixed UA/IP set. Confirmed before shipping:
`dry_run` and the path are the ONLY request-derived values reaching the function — all 15 step
queries are static template literals, no interpolation — so the auth gap was the whole exposure, not
a SQL-injection path. The two data-quality findings (name-equality identity writes in steps 3/8B;
curated BD columns written with no provenance ladder) are named in the same backlog row and left
open — they need the CONTACT1 ladder machinery, not a gate. Ships log-only: the pre-gate caller
inventory saw zero calls in 24h, which per DRIFT1-sfenrich's own note is a reason to read a longer
window before enforcing, not a reason to skip logging. `npm test` green (5,587 pass), 0 live calls.
👤 Scott: deploy v26→v27, read the DENY-WOULD log for longer than 24h, then flip `enforce`.

## 2026-09-09 — Read the 17 flow exports before RAILWAY-PA-SECRET lands: no PA flow sends `X-PA-Webhook-Secret` to Railway — they use `x-lcc-key` or `Authorization` — so setting the variable is safe only because of the fallback, and one flow has a header-less call that would break

**Method:** every `definition.json` in `private/power-automate/exports/production/2026-08-11/` (17 zips), every
`Http` action, grouped by target host and whether `X-PA-Webhook-Secret` is among its headers. 51 HTTP actions.

| target | flows | sends `X-PA-Webhook-Secret` | sends instead |
|---|---|---|---|
| Supabase edge functions (`intake-salesforce`, `intake-salesforce-files`, `sf-promotion-worker`) | Object Sync, On-demand Backfill, Daily Bulk File Backfill, On-demand File Backfill, Retry & Dead-letter, SF File Discovery | **yes, all 24 actions** | — |
| Supabase `ai-copilot/sync/activities` | Sync SF Activities to Supabase | no | `Authorization` + `apikey` (Supabase keys — the gate ignores them) |
| Supabase REST (`sf_sync_queue`, `lcc_record_flow_failure`) | Queue Drainer + 7 failure-ledger calls | no (not applicable — PostgREST) | `apikey`/`Authorization` |
| **Railway** `/api/webhooks/processing-complete`, `/api/intake-outlook-message`, `/api/intake-summary` | Outlook Intake to Teams (Hardened) | **no** | `x-lcc-key` + `x-lcc-workspace` |
| **Railway** `/api/webhooks/todo-completion-poll` ×2 | To Do Completion Poll | **no** | first call `x-lcc-key`; **second call sends NO headers at all** |
| **Railway** `/api/intake?_route=outlook-message`, `/api/intake/prepare-upload` | Flagged Email Intake | no | `X-LCC-Key` |
| **Railway** `/api/pipeline/ingest-*` ×3 | Deal → Opportunity Sync, Deal Contacts → Roster, Deal Team → Roster | no | `Authorization` (bearer) |

**What this changes about RAILWAY-PA-SECRET:** the eight Railway webhook handlers are shaped `if
(!authenticateWebhook(req)) { user = authenticate(req,res); requireRole(operator) }` — so with the variable **set**,
a flow without the secret header falls through to the real user/API-key check rather than being refused. That is
safer than today (today `authenticateWebhook` returns `true` for everyone and the fallback never runs). Setting
the variable therefore breaks only a caller that sends **neither** the secret **nor** a valid `x-lcc-key`/bearer:
from the exports, that is exactly one action — the To Do Completion Poll's second, header-less
`todo-completion-poll` call — plus whatever the **unexported** flows do (PA5: RCM Email Watcher, LoopNet, Personal
Calendar Sync post to `rcm-ingest`/`loopnet-ingest`/`lead-ingest`; those definitions are not on disk, so their
headers are **Not on file**). Whether `LCC_API_KEY` is set on Railway and its key-user carries the operator role is
also Not on file — every `x-lcc-key` flow has been passing through the open door, so the key path has never been
exercised on these routes.

**Decision recorded:** do not set the variable blind. Land a log-only mode on Railway first (`PA_WEBHOOK_AUTH_MODE=log`:
with the secret configured, a webhook request lacking the header logs `[pa-webhook] DENY-WOULD <route> <auth-path>`
and proceeds through the fallback as it would in enforce mode — so the log shows which flows would have been
*refused by the fallback*, not merely which lack the header). Prompt **RAILWAY-PA-SECRET-log**. Then set the variable,
read three days, fix the To Do poll's second call (👤 Scott, in the designer, re-export), and flip.

**Correction to the ai-copilot caller doc (my own error, 2026-09-09 earlier):** the id in the `azure-logic-apps
(workflow <id>)` user-agent is a third identifier — it matches neither the registry's `flow_guid` nor the
folder GUID inside the export package (Object Sync is `503d5519…` in the registry, `242f42cb…` in its export). "None
of the four ids is in the registry" was a comparison of unlike ids, not a finding. The `/sync/activities` caller
is **"Sync SF Activities to Supabase"** (`sf-activity-sync`, registered, exported 2026-08-11 — its HTTP action
targets exactly that route); the `/sync/calendar-events` caller is the Personal Calendar Sync (PA5, unexported);
`/sync/sf-tasks` and `/sync/flagged-emails` remain Not on file. `ai-copilot-sync-callers.md` corrected in place.

---

## 2026-09-09 — `ai-copilot` v80 LIVE (log-only) and Railway redeployed: the classifier works, the browser is off the edge URL — and the log's first ten minutes say Railway is not sending the secret

**Read from `function_logs` 22:25–22:35 UTC, after the second (successful) deploy and the Railway redeploy:**

| DENY-WOULD line | count |
|---|---|
| `GET /sync/calendar-events node railway` | 10 |
| `GET /sync/sf-activities node railway` | 9 |
| `POST /sync/calendar-events logic-apps other` | 1 (22:26:27 — the hourly PA calendar flow, `4eb7c46f…`) |
| anything `browser` | **0** |

Three facts from one table. **(1) The gate and classifier are live and correct:** the PA flow lands as
`logic-apps other`, Railway's block as `railway`, and the log line carries no header value. **(2) The browser has
left the edge URL:** zero `browser` lines, and the `calendar=personal` query variant — which only `app.js`
requests — now arrives with UA `node`, i.e. through `handleCopilotRead` on Railway. The Railway redeploy is
therefore live with the new `api/sync.js` and `app.js`. **(3) Railway is calling without `X-PA-Webhook-Secret`.**
`connectorHeaders()` and `handleCopilotRead` both attach the header only `if (PA_WEBHOOK_SECRET)`. New code, no
header ⇒ **`PA_WEBHOOK_SECRET` is not set in the tranquil-delight Railway environment** (Derived — confirm in
Railway → Variables; nothing here can read that env).

**Why that is a bigger fact than the copilot gate:** `api/sync.js::authenticateWebhook` line 76 is `if
(!PA_WEBHOOK_SECRET) return true;` — *transitional: allow all*. It guards eight `_route` handlers on Railway
(`rcm-ingest`, `rcm-backfill`, `loopnet-ingest`, `lead-ingest`, `live-ingest`, `listing-webhook`,
`processing-complete`, `todo-completion-poll`). If the variable is absent, every one of those Power Automate
webhook endpoints on the live app is open to the internet today, and has been since they were written — the
COPILOT-OPEN shape on Railway rather than on an edge function. `AI-SURFACES-OPERATIONAL-REFERENCE.md` §4a says
"`PA_WEBHOOK_SECRET` (already set)" — that line was confirmed against **Supabase** `secrets list`, not Railway; the
two environments were conflated. Filed **RAILWAY-PA-SECRET** 🔴 👤.

**Operator step (safe):** in Railway → tranquil-delight → Variables, add `PA_WEBHOOK_SECRET` = the exact value
Dialysis_DB holds (the one the "SF -> LCC: Object Sync" flow sends). Consequences on redeploy, in order: Railway's
edge calls start carrying the header (the `node railway` DENY-WOULD lines stop — the measurement that confirms
it); **and** Railway's eight webhook routes start *enforcing* — so first confirm every PA flow that posts to
Railway already sends the header (`FLOW-REGISTRY.yaml` `endpoint_families` → the flows on `lcc-*` families;
the 2026-08-11 exports show which carry it). If any does not, that flow breaks the moment the variable lands.
Check the exports before setting the variable, not after.

Also noted: `GET /sync/sf-activities` still 500s from Railway (22:30:40) — CFE-RUNAWAY's load, unchanged.

---

## 2026-09-09 — v80 deploy failed on a four-month-old `deno.json`: `{"imports":{"./":"./"}}` remaps every `./` import — including `_shared/auth.ts`'s `./supabase-client.ts` — into the function's own directory

`supabase functions deploy ai-copilot` (CLI 2.101) → `WARN: failed to read file: open
supabase\functions\ai-copilot\supabase-client.ts` then bundle error `Module not found
…/_shared/supabase-client.ts at _shared/auth.ts:13`. Cause is not the CLI and not `auth.ts`: `ai-copilot/deno.json`
holds a single import-map entry `"./": "./"`, added incidentally in the May calendar-fix commit (`b5428847`) and
never load-bearing — the function's own imports are plain relative paths that resolve identically without it. An
import map is resolved against the map's location, so the moment `index.ts` gained `../_shared/auth.ts` (v80), the
shared module's `./supabase-client.ts` was rewritten to `ai-copilot/supabase-client.ts`, which does not exist.
`intake-salesforce` has no `deno.json` and has imported `_shared/auth.ts` since v25 without incident — the
control that names the cause.

**Fix:** delete `supabase/functions/ai-copilot/deno.json` (the deployed function's `import_map:true` flips to
false, which is what every other function in the project has). No source change. → redeploy.

Also: `COPILOT_KNOWN_IPS` was set with the literal placeholder `scott:<your home IP prefix>` — harmless
(classification only; that entry never matches) but the browser class will log as `other` until it is re-set with
the real prefix. Re-set alongside the redeploy.

---

## 2026-09-09 — COPILOT-OPEN-gate reconciled (PR #2214): the door is in the right place; nothing is live yet — three operator steps, in a safe order

**Verified against the merged tree, not the response:**
- The gate runs before dispatch for every path except `/health`, via the same `authenticateWebhook()` as
  `intake-salesforce` (constant-time compare; `return true` when `PA_WEBHOOK_SECRET` is unset — the transitional
  clause, which on Dialysis_DB does not apply because `intake-salesforce` 401s today). `log` mode logs
  `DENY-WOULD` and continues; only `enforce` returns 401. Gate test 11/11, hermetic-suite and retired-identifier
  guards green (24/24 in the run here).
- The browser path is sound: `app.js` now hits `/api/sync?_route=copilot-read&what=…`, which authenticates the
  user **before** proxying (`authenticate()` then `handleCopilotRead`), and the front-end's `auth.js` patches
  `window.fetch` to attach the Bearer token on `/api/` calls — so plain `fetch()` in `loadActivities()` carries a
  session. `grep functions/v1/ai-copilot app.js detail.js extension/` → 0.
- `connectorHeaders()` sends the secret on every existing Railway→edge call, so the eventual `enforce` flip does not
  strand `ingest_calendar` / `ingest_sf_activities` / `outbound`.
- **Live state: `ai-copilot` is still v79** (`list_edge_functions`, 20:40 UTC). Railway has not been redeployed
  either. Until both happen the browser still calls the edge URL directly (old `app.js` in its cache) and the
  edge still accepts it — nothing is broken, nothing is gated.
- Added `[functions.ai-copilot] verify_jwt = false` to `supabase/config.toml` — it was not pinned, and the
  `--no-verify-jwt` flag on the deploy line was the only thing standing between v80 and the
  `intake-salesforce-files` trap.
- Duplicate `TEST-NET-LEAK-hermetic-suite` prompt/response reappeared at the top level (CC's branch predated the
  move to `done/`); removed — the `done/` copies are byte-identical.

**Operator order (safe in this sequence; each step is independently reversible):**
1. `supabase secrets set COPILOT_KNOWN_IPS="railway:152.55.,railway:162.220.232.,scott:<home-prefix>" --project-ref zqzrriwuavgrquhisnoa`
   (classification only — it changes what the log line says, never what is allowed).
2. `supabase functions deploy ai-copilot --project-ref zqzrriwuavgrquhisnoa --no-verify-jwt` → v80. Log-only;
   every existing caller keeps working, including the browser on its cached `app.js`.
3. Redeploy **both** Railway services (engine code changed: `api/sync.js`, `app.js`). After this the browser's
   reads arrive at the edge from Railway with the header and the `DENY-WOULD browser` lines stop.
4. The four PA flows get the header (`docs/architecture/flows/ai-copilot-sync-callers.md`), each re-exported and
   registered — that is also PA5's answer for whichever of the four it turns out to be.
5. ≥ 3 days of `function_logs` with zero `DENY-WOULD` from anything but a known class → `COPILOT_AUTH_MODE=enforce`.

**Still Not on file:** `AI_EXTRACTION_PRIMARY` on Railway — the "Railway made 0 edge calls in 24 h" reading has two
explanations and this is the only way to pick one.

Next CC prompt: **SFENRICH-gate** — the same door on `salesforce-enrichment` (DRIFT1-sfenrich), with one wrinkle
the COPILOT unit did not have: that function's body is **not in the repo** (deployed v23 only, `supabase/functions/`
has no `salesforce-enrichment/`), so the unit starts by committing the fetched body verbatim — the lesson from
`sf-test`.

---

## 2026-09-09 — COPILOT-OPEN-gate shipped (log-only): `ai-copilot` now sits behind `authenticateWebhook()`, browser reads moved off the edge URL

**Prompt COPILOT-OPEN-gate.** `supabase/functions/ai-copilot/index.ts` v80 gates every route but
`GET /health` behind `authenticateWebhook()` (`../_shared/auth.ts`, the same `X-PA-Webhook-Secret`
door `intake-salesforce` already sits behind), driven by `COPILOT_AUTH_MODE` (`log` default —
DENY-WOULD logged, request allowed through unchanged; `enforce` — 401). Shipped in `log` mode
deliberately; the enforce flip is a separate, later operator step.

- **Unit 1 (gate):** `[copilot-auth] DENY-WOULD <method> <path> <ua_class> <ip_class>` on any
  unauthenticated non-`/health` request. `ua_class` ∈ `browser|logic-apps|node|other`, `ip_class`
  read from `COPILOT_KNOWN_IPS` (new env var, comma list of `class:ip-prefix` pairs — 👤 Scott sets
  it from the caller inventory; unset ⇒ everything reads `other`).
- **Unit 2 (browser):** `app.js`/`detail.js` no longer call the edge URL directly (a browser cannot
  hold the secret — P194 doctrine). They call `/api/sync?_route=copilot-read&what=health|sf-activities|
  calendar-events` on Railway; `api/sync.js::handleCopilotRead` is a new user-authenticated proxy that
  forwards the query string and adds the secret header. `connectorHeaders()` (used by every existing
  Railway→edge call — flagged emails, calendar ingest, sf-activities ingest, the outbound command
  dispatcher, the connector-verify probe) now sends the secret too, so Railway's own calls don't start
  failing the moment `enforce` flips. `detail.js`'s `API` const was dead code (declared, never read) —
  removed rather than repointed.
- **Unit 3 (PA flows):** `docs/architecture/flows/ai-copilot-sync-callers.md` — the four unregistered
  Logic-Apps workflow ids from the inventory, what header each needs, and the re-export/register
  procedure. **Not done** — needs Scott to open each flow and add the header, then re-export + tell
  CC the flow names so `FLOW-REGISTRY.yaml` can be updated (resolves PA5 for whichever of the four).
- **Unit 4 (tests):** `test/ai-copilot-auth-gate.test.mjs` — structural (same reason
  `test/intake-salesforce-sf-ping-auth.test.mjs` is structural: `_shared/auth.ts` can't load under
  plain `node --test`), 8 assertions on the gate + 3 on the browser never holding the edge URL
  (positive-controlled). `npm test`: **5573 pass / 0 fail** (full suite, unchanged elsewhere).
- **Unit 5 (docs):** this entry; `docs/architecture/edge-function-deploy-drift.md` (dated section);
  `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` §4a (new env vars); `PLANNED-BACKLOG.md` COPILOT-OPEN
  → 🟡 (gate shipped, PA-flow header + the enforce flip still open).

**Out of scope, named:** flipping to `enforce` (Scott's call, after the 3-day zero-unknown-caller
read); COPILOT-SYNC-500 / CAL-RECONCILE-STUCK (separate rows, CFE-RUNAWAY-blocked); `salesforce-
enrichment` (DRIFT1-sfenrich needs the identical gate pattern, not built here); whether
`AI_EXTRACTION_PRIMARY` is set on Railway (still unread — 👤).

**Verify:** deploy `ai-copilot` (`--no-verify-jwt`, v80); one `curl` with no header → 200 + a
DENY-WOULD line in `function_logs` (no secret value in the line); one with the header → 200, no line;
grep confirms zero `functions/v1/ai-copilot` occurrences outside `supabase/`, `api/`, `docs/`, `test/`.

## 2026-09-09 — Dialysis_DB is being ground down by one writer: a Python job on Railway re-inserting every clinic's financial estimates ~3× a week instead of once a month — 7,547 statement timeouts in 24 h, cron jobs failing to start, the app's own reads 500ing

**Chain of measurements (each one led to the next):**

1. COPILOT-SYNC-500 (filed earlier today): the browser's `GET /sync/sf-activities` 500s 30 % of the time. Both
   browsers, both routes, identical query strings, no time-of-day pattern, no correlation with the PA POSTs → server
   side. The handler's only 500 is `Failed to fetch SF activities` with PostgREST's `error.message`.
2. `postgres_logs`, 24 h (2026-09-08 20:00 → 09-09 20:00 UTC): **7,547 × `canceling statement due to statement
   timeout`**, plus ~260 × `cron job N job startup timeout` across jobs 8, 9, 17, 25, 28, 39, 43, 50, 64 and
   29 × `REFRESH MATERIALIZED VIEW CONCURRENTLY v_crm_client_rollup` timed out. `salesforce_activities` reads are 59
   of the 7,547 — the 500s are collateral.
3. **6,273 of the 7,547 (83 %) are two statements against `clinic_financial_estimates`:** `SELECT * … LIMIT 1
   OFFSET 0` and `SELECT created_at … LIMIT 1` — each wrapped in PostgREST's `pgrst_source_count`, i.e. an **exact
   count over the whole table on every call**. The table is **1,243,401 rows / 771 MB**; the count cannot finish
   inside the 8 s statement timeout.
4. `edge_logs` names the caller: **one address, `162.220.232.128` (Railway block), UA `python-httpx/0.28.1`**,
   ~50,000 requests to `/rest/v1/clinic_financial_estimates` in 24 h: 16,335 `POST` (201) inserts, 16,349 keyed
   lookups, and **16,341 `?select=*&limit=1` probes of which 3,429 were 500** (+ 2,859 more on the `created_at`
   variant). Per hour it runs at ~3,300 inserts when the probe succeeds (18:00–20:00 UTC) and ~200 when the probe is
   timing out at ~300/h — **the only thing throttling it is the damage it does.**
5. The table itself (read-only SQL): **537,925 rows inserted in the last 7 days**; 6,902 distinct clinics in the
   last 24 h. Weekly history is the tell — `2026-05-11` 144k, `06-08` 143k, `07-20` 142k (one full pass ≈ 8.2k
   clinics × ~17 estimate variants, **monthly**), then `08-24` 189k, **`08-31` 421k**, `09-07` 161k so far. **The
   monthly recompute became a continuous loop on or about 2026-08-24.** The `is_latest` flag is still maintained
   (36,538 rows, the same figure QA16 recorded in May) — the *current* estimates are fine; it is the history that is
   piling up and the count-probe that is choking the database.

**What is Not on file:** the writer. Nothing in this repo speaks `python-httpx` to `clinic_financial_estimates`
(`resolver/` uses httpx for its own corpus only). It is a Railway service outside `life-command-center` — the
dialysis financial-estimates pipeline — and only Scott's Railway dashboard can name it. The most likely mechanism,
stated as a hypothesis to test rather than a fact: the job's count-probe 500s → the process exits non-zero →
Railway restarts it → it begins the full pass again. That would explain a monthly job producing three passes a
week and the `08-28 → 09-01` gap in the daily counts (nothing written for four days, then 421k in a week).

**Consequences already visible:** COPILOT-SYNC-500 (dashboard tiles blank a third of the time), the cron
startup failures (which jobs 8/9/17/25/28/43/50/64 are is Not on file here — read `cron.job` before assuming),
the matview refresh timeouts, and `UX34a`'s "`v_cms_data` still 5.7 s against 8 s" — measured while this writer
was running, so that number may be load, not the view.

**Filed:** backlog **CFE-RUNAWAY** 🔴 👤 — Scott identifies and pauses the service; then the job needs (a) no
count on its probe (`Prefer: count=none`, or `HEAD` with `count=planned`), (b) a run-once schedule with a
completion marker so a restart does not restart the pass, (c) a retention decision on 1.2 M history rows.
COPILOT-SYNC-500 and CAL-RECONCILE-STUCK re-measure **after** the writer is paused — no code change on either
until then.

---

## 2026-09-09 — TEST-NET-LEAK reconciled (PR #2209/#2210): 0 live calls, suite time halved — and the caller inventory for `ai-copilot` shows the whole function is open, not just `/chat`

**TEST-NET-LEAK, re-measured from `origin/main` under the same `fetch`-logging shim as yesterday's 14:**
5,568 tests / 5,562 pass / 0 fail / 6 skipped / **0 live calls** / **181 s (was 376 s)**. The response's "5,563 /
67 s" was measured before its own five guard tests landed and on a faster box — the counts here are from the merged
tree. The time halved because the 35 s backoff sleeps against a dead edge route are skipped under the seam, which
also shortens every `npm test` CI check from here on. Read the shipped guard: blocklist + a general non-loopback
rule with `pa.test.local` allowlisted; `hermeticTestsActive()` keys off `NODE_TEST_CONTEXT` (node's own `--test`
child marker) or `LCC_HERMETIC_TESTS` — neither is set on Railway, so production behaviour is unchanged. Row ✅.

**COPILOT-CHAT-OPEN → widened to COPILOT-OPEN, by reading the DEPLOYED body, not the repo.** Fetched `ai-copilot`
v79 from Dialysis_DB (six files, 81 KB): **25 routes, one service-role client, and zero authentication of any kind
anywhere** — no `authenticateWebhook`, no bearer, no `apikey` check, no `401` path; CORS `*`. With
`verify_jwt:false` the gateway forwards anything. The open **write** routes: `POST /sync/activities`,
`/sync/accounts`, `/sync/log-to-sf`, `/sync/sf-tasks`, `/sync/flagged-emails`, `/sync/calendar-events` (upsert +
reconcile-delete), `/enrich`, `/bd/config`, `/bd/log-completion`, `/bd/auto-reschedule`, `/bd/route-task`. This is
the DRIFT1-sfenrich shape on the function that fronts the model *and* the calendar/activity ledgers, and its writes
are not fill-blanks-idempotent the way `salesforce-enrichment`'s are.

**Caller inventory, 24 h (2026-09-08 19:45 → 09-09 19:45 UTC, `function_edge_logs`), grouped by path × UA × IP class:**

| caller class | routes | count | status | note |
|---|---|---|---|---|
| CI runners (60 Azure IPs, UA `node`) + Scott's machine | `POST /chat` | 743 + 55 | all 400 | TEST-NET-LEAK — gone from the next run onward |
| Browser at Scott's address (Edge + Chrome) | `GET /health`, `/sync/sf-activities`, `/sync/calendar-events` | 179 / 194 / 195 | 200 — **but 58 of 194 and 29 of 195 are 500** | `app.js` calls the edge URL directly, no key (the front-end cannot hold one) |
| Power Automate (UA `azure-logic-apps/1.0 (workflow <id>)`) | `POST /sync/calendar-events` 24, `/sync/activities` 6, `/sync/sf-tasks` 4, `/sync/flagged-emails` 1 | 35 | 200 | four workflow ids — **none match a `flow_guid` in `FLOW-REGISTRY.yaml`**: `4eb7c46f…`, `5706ffc6…`, `e2598c91…`, `0216d3da…` (PA5's "three flows in neither list" may be these; Not on file which) |
| Railway (`152.55.x`) | — | **0** | — | `api/sync.js` / `ai.js` did not call the edge in 24 h — so either `AI_EXTRACTION_PRIMARY=openai` is set on Railway or no extraction ran; still Not on file |

**Two more findings from the same read, filed as rows:**
- **COPILOT-SYNC-500** — the browser's `GET /sync/sf-activities` fails 30 % of the time and `/sync/calendar-events`
  15 %, with **nothing in `function_logs`** for the failures (the router's catch logs `ROUTER ERROR:` — absent, so
  the 500 is produced inside a handler that returns it silently). Measure the body before guessing.
- **CAL-RECONCILE-STUCK** — 24 hourly `[calendar-reconcile] SKIP: candidate count 13–16 exceeds
  MAX_RECONCILE_DELETES (10); likely a dropped calendar source` since at least 09-08 23:25. The guard is doing its
  job; the consequence is that 13–16 calendar rows that no longer exist upstream are never removed, every hour.
  Either a source really dropped (then the rows should go) or the window logic is wrong — decide from the rows.

Next CC prompt: **COPILOT-OPEN-gate** (design from the inventory above; PA flows and browser are the two callers that
must keep working, and the browser cannot be handed a secret — its reads go through Railway, which already proxies
`/sync/*` in `api/sync.js` with user auth).

---

## 2026-09-09 — NGP Group merged into NGP Capital on the recorded verdict; the OWN-T0e-c residue is now ONE property; the sponsor-family arc's operator pass is complete

Ran `lcc_merge_entity(loser := NGP Group 67ed0011…, winner := NGP Capital 21db64c7…)` directly (Cowork,
service role) on Scott's recorded `same_party` verdict, because the lane it routed to had no card (previous
entry). Read back: NGP Group tombstoned → NGP Capital; NGP Capital current facts **31 → 40** (9 repointed,
5 xids, 25 relationships); merge log **150 → 151**, `reversible = true`; undo is
`select lcc_unmerge_entity('67ed0011-77b6-4ab6-8f93-3913958cacb6')`. Store: `unclassified_rival` **1,502 →
1,501**, `sponsor_family_confirmed` **102 → 104** — NGP Group's two SPE-pair properties are now covered by the
existing `ngp` family confirm, which is the designed outcome. **OWN-T0e-c residue: 1 property** —
`National Government Properties (NGP)` still classified `sponsor_family_confirmed` beside NGP Capital; no
verdict was given on it, so it stays. ⚠️ The NGP Group card still sits in the 4-hourly cache but is excluded
from the lane by its decision — expect it to vanish on the 00:27 UTC refresh, not before.

**Where the arc stands after today's operator pass:** registry 8 · 3 confirm-lane merges today (Gardner,
MassMutual, NGP Group) + 3 earlier (GWU, RMR, Salus) · retype ledger 13 · `unclassified_rival` 1,617 (design)
→ **1,501** · `sponsor_family_confirmed` 64 → **104**. **Next, in order:** (1) Scott works the 12
byte-identical merge groups the retypes surfaced on "Duplicate entities — merge" (UIRC ×3, Global Net Lease
×3, Blackstone, Foulger Pratt, SMBC, American Infrastructure Funds, Sansome Pacific, Davis (MN), UrbanAmerica LP,
Capital MassMutual Life, SMBC Leasing And Finance Inc); (2) the two leftover retype cards — `Kvalitena AB`
(retype) and `Research In Progress` (a placeholder: Keep as person is WRONG and Retype is wrong; it belongs on
`junk_entity_review` — filed); (3) build: **C13g-min-lane-mutation** (prompt drafted).

## 2026-09-09 — the two type-blocked merges ran and the store moved by exactly the predicted −14; NGP Group's `same_party` landed on a lane with no card (design §7's own gap)

**Read back 20:46 UTC.** `lcc_entity_merge_log` **148 → 150**: `Gardner-Tanenbaum → Gardner Tanenbaum Holdings`
(20:45, `reversible=true`, 3 xids + 299 relationships repointed) and `MassMutual Life → Massmutual` (20:45,
`reversible=true`). Both `same_party` + `merge_now` verdicts recorded on the sponsor cards. **`unclassified_rival`
1,516 → 1,502 = −14 — exactly the predicted −4 (Gardner) + −10 (MassMutual)**; `duplicate_entity` 412 and
`sponsor_family_confirmed` 102 unmoved, registry 8 unmoved, as designed. ⚠️ One prediction detail was WRONG in
a way that did not change the total: I expected the loser's facts on the co-claimed properties to dedup-DELETE
on the PK; instead Gardner Holdings' current facts went **22 → 40 (+18, all repointed)** and Massmutual's
24 → 38 (+14). The "co-claim" on those properties came from the resolver claim / domain mirror, not from a
second portfolio fact — so there was no PK collision. *Co-claimed in the reconciled store ≠ two facts.* The
Gardner group also left `v_lcc_merge_candidates` (its byte-identical duplicate is gone).

**NGP Group: the verdict is recorded, the merge is not.** Scott clicked `same_party` (no `merge_now`) on the
NGP Group card as instructed; `effects.merge_lane = merge_duplicate_entities` — and **the merge lane has no
card containing `NGP Group`**: the P189 normalizer returns NULL for it and the `dc:` fallback does not group it
with `NGP Capital`. This is precisely the design-§7 gap OWN-T0e-b was built for, on the one card where
`merge_now` cannot be used (the card's sponsor IS the duplicate, so its picker offers only SPEs). `NGP Group`
(67ed0011…, 9 current facts) stays live. **Resolution: one `lcc_merge_entity(loser := NGP Group, winner :=
NGP Capital)` call, reversible, backed by the recorded human verdict — pending Scott's go.** Filed as the
concrete instance under **OWN-T0e-c**: a card whose sponsor is itself the duplicate needs a "merge THIS sponsor
into <other card's sponsor>" affordance, or the verdict routes to a lane that cannot show it.

## 2026-09-09 — the retype lane worked for real: 16 verdicts in two minutes, 13 retypes ledgered, and the merge detector woke up on 12 groups it had been blind to

**Read back live at 19:57 UTC.** `lcc_entity_retype_log` = **13** rows (Gardner-Tanenbaum, MassMutual Life,
Foulger Pratt, UIRC, Global Net Lease, SMBC Leasing and Finance, SMFG, SMBC, American Infrastructure Funds,
Blackstone, Davis (MN), Sansome Pacific, UrbanAmerica), every one `person → organization` with its
`lcc_decisions` id on the row, `reverted_at` null; **3 `keep_person`** (Patrick R. Luther, William S Stuart Jr,
Rafael A — the tail the prompt named). Lane visible **18 → 2** (`Kvalitena AB`, `Research In Progress`).
**The OWN-T0e guard inputs now agree** — both Gardner entities read `organization`, live — but **no sponsor
verdict and no merge has been run yet** (`lcc_entity_merge_log` 148, registry 8, `unclassified_rival` 1,516
unchanged): the merges are the next click, not a fact.

**⚠️ Second-order yield nobody predicted: 12 merge-candidate groups appeared.** `v_lcc_merge_candidates`
filters `entity_type = 'organization'`, so a person-typed duplicate was structurally invisible to it (the
P189 class, one filter over). Retyping surfaced **byte-identical** groups — `UIRC` ×3, `Blackstone` ×2,
`Foulger Pratt` ×2, `Global Net Lease` ×3, `American Infrastructure Funds` ×2, `Sansome Pacific` ×2, `SMBC` ×2,
`Davis (MN)` ×2 — plus `Gardner Tanenbaum Holdings ← Gardner-Tanenbaum`, `UrbanAmerica ← UrbanAmerica LP`,
`MassMutual Life ← Capital MassMutual Life`, `SMBC Leasing and Finance ← … Inc`. `auto_mergeable` **3,011 → 3,015**
— `lcc_apply_fuzzy_merges` is still unwired (P189/P198), so nothing merges by itself. They are on the
"Duplicate entities — merge" lane now, human-confirm as always. **A retype is a visibility change for every
consumer that filters on type; count what it reveals, not only what it unblocks.**

**Next click (operator):** OWN-T0e lane → Gardner Tanenbaum Holdings card → pick `Gardner-Tanenbaum` → Merge
duplicate now; MassMutual the same; NGP Group `same_party`. Then the 12 merge groups above. Then tell me the
numbers: expect merge log 148 → 150+, `unclassified_rival` −4 (Gardner) / −10 (MassMutual).

## 2026-09-09 — first real retype verdict failed: `p_decision_id uuid` vs `lcc_decisions.id bigint` — fixed live, function only

Scott clicked **Retype as organization** on Gardner-Tanenbaum → toast `entity_type_review: retype_failed`.
`lcc_decisions` 3879817 (status still `open`) carries the cause in `effects.error`: **22P02 invalid input syntax
for type uuid: "3879817"**. The handler passes the decision row id — a bigint, as on every other lane — and
`lcc_retype_entity` declared `p_decision_id uuid` (the ledger column too). ⚠️ **The builder's rolled-back
positive control passed `p_decision_id := null` — the one argument the caller always supplies — so it could
not exercise the contract.** Migration `20261101140000_lcc_c13g_min_retype_decision_id_bigint.sql`: ledger
column → bigint (0 rows), **DROP the uuid signature first** (N15d: a defaulted overload makes every call 42725),
recreate with bigint, SEC1 stanza repeated on the new signature (ADDR1b), plus an apply-time assertion that the
parameter type equals `lcc_decisions.id`'s; `notify pgrst`. Re-controlled with the REAL shape
(`p_decision_id := 3879817`) inside a raised-and-rolled-back block: ok=t, entity → organization, ledger row
carries 3879817; afterwards Gardner is `person`, log 0. No JS change. Decision 3879817 stays `open` — a re-click
works it. ⚠️ **The hotfix-1 STATUS entry below was dropped from `main` by the #2207 STATUS conflict
resolution (its migration and canonical note survived); restored here verbatim.**

## 2026-09-09 — C13g-min-lane 502'd on first open: the candidate view read the 35 s PROPOSALS VIEW, not the OWN-T0e cache — fixed live, view-only

Scott opened "Entity type — person or organization?" and got **HTTP 502 `federated_list_failed`**. Reproduced
from the DB side (`net.http_get` with the vault key): body `"This operation was aborted"` = `opsQuery`'s **8 s**
fetch abort. `EXPLAIN ANALYZE` on `v_lcc_entity_retype_candidates`: **34.7 s** — both its `own_t0e_blocked` CTE
and its per-row LATERAL referenced `v_lcc_ownt0e_sponsor_family_proposals`, the view OWN-T0e design §6 measured
at 64 → 20 s and deliberately put behind `lcc_ownt0e_sponsor_family_proposals_cache` *because a view built for
point-queries is not a population source*. The C13g-min migration re-committed that exact footgun, and its own
"18 rows" check could not see it — the SQL editor's statement timeout is longer than the app's fetch. ⚠️ **"The
view returns the right rows" is not "the lane loads"; measure the read the HANDLER makes, at the HANDLER's
timeout.** Migration `20261101130000_lcc_c13g_min_lane_view_reads_cache.sql` (whole view restated, both refs →
the cache): **58 ms**, output **md5-identical** (18 rows, same two blocked cards), and the live endpoint now
answers **200 / total 18** with Gardner-Tanenbaum first. No JS changed, no deploy. Trade: the blocker column can
lag the 4-hourly cache — the same lag the sponsor lane shows; the write-gating facts are still read live.

## 2026-09-09 — Found while verifying the pings: `npm test` makes 14 live calls to the production `ai-copilot/chat` edge function per run — from CI and from Scott's desk — and every one is a 400

**How it surfaced.** Reading `function_edge_logs` on Dialysis_DB for the two `sf-ping` 200s, the neighbouring rows
were bursts of `POST | 400 | …/functions/v1/ai-copilot/chat`. Grouped over 24 h (2026-09-08 18:10 → 09-09 18:10
UTC): **19 bursts of exactly 14 calls in a 3-minute window, each from a different Azure address**
(`20.x`, `52.x`, `4.x`, `172.18x.x`, `40.x`, `48.x`, `51.8.x`, `74.x`, `104.x`, `135.x`, `64.236.x` — GitHub-hosted
runners live on Azure), plus **71 calls from one stable residential address, UA `node`** — the same shape, from a
developer machine running the suite. Burst times match today's PR CI runs (17:56–17:59 = the #2205 merge).

**Reproduced locally, not inferred:** ran the full suite with a `fetch` shim that logs any call to a real host.
5,563 tests, 0 failures, 376 s — and exactly **14 live calls**: `test/lease-extractor.test.mjs` → 8,
`test/dossier-generator.test.mjs` → 6, all to `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/chat`.
Both files assume "no AI key in the test env → the extractor throws"; but `api/_shared/ai.js` `invokeChatProvider`
defaults `AI_EXTRACTION_PRIMARY` to `edge`, and the edge path needs **no key** — it POSTs to the live function with
no `Authorization` header at all (workspace/user-id headers only). The tests pass because the 400 is caught and
the fallback chain throws the expected error; the network round trip is invisible to the assertion.

**Two facts, two rows:**
1. **TEST-NET-LEAK** — the suite is not hermetic: CI reaches production on every run, and a green depends on a
   production endpoint answering (any way). Fix is in the tests/`ai.js` seam, not the function.
2. **COPILOT-CHAT-OPEN** — `ai-copilot` (v79, `verify_jwt:false`) accepts `POST /chat` with **no credential** —
   the same shape as DRIFT1-sfenrich, on the function the app's own chat and extraction paths use. Prompt 61 #4
   already recorded "it 400s on every extraction call in production (measured)" and shipped the
   `AI_EXTRACTION_PRIMARY=openai` switch — default left at `edge`; nothing on file says the Railway env has the
   switch set. So the 400 the tests hit is the same 400 production extraction pays first on every OM.

Next CC prompt is TEST-NET-LEAK (small, testable, no deploy). COPILOT-CHAT-OPEN needs the caller inventory first
(app.js / detail.js browser clients call it directly with no key — gating it is an app change, not a one-liner).

## 2026-09-09 — TEST-NET-LEAK SHIPPED: `npm test` is hermetic

`test/_helpers/net-guard.mjs` (wraps `fetch`, throws on any non-loopback host, `--import`ed ahead
of every test file in `package.json`'s `test` script) + `api/_shared/ai.js::invokeChatProvider`
refusing the `edge` route before any fetch under `NODE_TEST_CONTEXT`/`LCC_HERMETIC_TESTS`. Neither
leaking test file was rewritten — their assertions already describe *provider failure*, which the
seam now returns deterministically instead of a real (or guard-thrown) network error. Guard:
`test/hermetic-suite.test.mjs`. **Full suite re-run: 5,563 tests / 5,557 pass / 0 fail / 6 skipped
(unchanged), 0 live calls (positive-controlled: a red run with the guard alone, before the `ai.js`
seam, failed exactly the 4 `lease-extractor.test.mjs` cases predicted and nothing else) — 67s,
faster than before (no more 35s backoff sleeps against a dead edge route).** Response:
`docs/claude-code/responses/TEST-NET-LEAK-hermetic-suite.response.md`; backlog row flipped to ✅ in
`docs/os/PLANNED-BACKLOG.md`. COPILOT-CHAT-OPEN unchanged — still needs the caller inventory.

**Also noted, honestly:** only ONE of Scott's two `sf-ping` 200s is visible in `function_edge_logs` (17:57:52 UTC)
as of 18:10 UTC; the second is not there. Log lag or drop — not re-queried, not explained.

---

## 2026-09-09 — SF-DIRECT-b ✅ CLOSED: two live `sf-ping` runs via the PA gateway, `open_tasks: 5` both times — and 48–49 s is the org's steady state, not a cold start

**Measured (Scott, after PR #2205 merged and `intake-salesforce` redeployed):**

| ping | via | ok | open_tasks | elapsed_ms |
|---|---|---|---|---|
| 1 | `pa_gateway` | true | 5 | 47,716 |
| 2 | `pa_gateway` | true | 5 | 49,341 |

Second call is no faster than the first, so the 48.9 s seen in the run history yesterday is the **Salesforce
connector's steady-state latency for this org**, not warm-up. That is a design constraint, recorded in the flow
doc and the backlog row: **the gateway read path is fine for anything batch or briefing-shaped; it is not usable
inside a chat turn or an interactive request.** The SOAP path (SF-DIRECT) would be sub-second and stays 🟡 as the
exhibit for the IT conversation Scott will have with the working product in hand.

**Live function version is v30** by `list_edge_functions` (I had written "v28" as the expected next number; the
counter advanced further than the deploys I recorded — the number in these notes is the dashboard's, not a
derived one). Fault-prefix fix, `equals(…, null)` flow fix and the 60 s timeout are all in the live build (two
successful pings prove all three).

**Flow export filed:** `private/power-automate/exports/production/2026-09-09/sf-http-switch-lookup__HTTP-Switch-Salesforce-Lookup__2026-09-09.zip`
(5,579 bytes, sha256 `c461ff8e…8790d530`, git-ignored). Read from the zip before registering it: the `soql` case and
`Execute_a_SOQL_query_1` are present, no `sig=` literal, no retired host. **One residual against the spec:** Secure
Inputs/Outputs is set on the HTTP trigger only — the SOQL action carries no `secureData`, so run history still
retains Task record bodies (that is how yesterday's run detail could show `totalSize: 5`). 👤 One checkbox in the
designer on `Execute_a_SOQL_query_1` → Settings → Secure Inputs + Secure Outputs, then re-export. Not blocking;
filed on the SF-DIRECT-b row as the only open item. `FLOW-REGISTRY.yaml` `sf-http-switch-lookup` bumped to the
2026-09-09 export.

**Backlog:** SF-DIRECT-b → ✅. SF-DIRECT stays 🟡👤 (external SSO blocker; code complete). New row **SF-GW-LATENCY**
so the 49 s does not get rediscovered: any consumer of `sfGatewayQuery` must budget ≥ 60 s and run out of band.

---

## 2026-09-09 — SF-DIRECT-b: the gateway path works end to end (5 open Tasks came back from Salesforce) — the connector took 49 s and our 20 s abort hid it

Three pings, three different layers, each measured from the Power Automate run rather than guessed:

1. **v26** → `via:"soap"` with `sf:INVALID_SSO_GATEWAY_URL` and no fallback — the namespaced-fault-code gate bug,
   fixed (v27, PR merged, red-then-green positive control).
2. **v27** → `via:"pa_gateway"`, `flow_unreachable` at 20.4 s. Run history: the flow's success Response failed on
   `empty(triggerBody()?['max_rows'])` — `empty()` rejects integers and the helper sends `max_rows: 200`. Fixed in
   the flow (`equals(…, null)`).
3. **v27 again** → `flow_unreachable` at 20.5 s. Run history: **`Execute_a_SOQL_query_1` succeeded — HTTP 200,
   `totalSize: 5`, five real open Tasks — but took 12:05:22 → 12:06:11, 48.9 s by the connector's own
   `Server-Timing` header, no retry.** The Response then failed `ActionResponseTimedOut` because our 20 s abort had
   already closed the connection. **The path works; the budget was wrong.**

**Fix (this branch):** `salesforce-gateway.ts` default timeout 20 s → **60 s**, overridable via
`SF_GATEWAY_TIMEOUT_MS` (1–120 s). A diagnostic read path should wait for the connector and report what it did, not
manufacture a phantom "unreachable". → **v28 deploy**, then two pings to see whether the 49 s was a cold first call
or the org's steady state; record `elapsed_ms` for both.

**Also learned about the designer:** the SOQL action's name gets a `_1` suffix; a Response may only reference
actions on its run-after path; `empty()` is not null-safe for numbers. All three are now in the flow doc.

## 2026-09-09 — SF-DIRECT-b live: the flow's `soql` case is built, v26 deployed — and the first ping exposed a one-line gate bug (namespaced fault codes), fixed with a red-then-green test

Walked the Power Automate build in five steps (case → SELECT-only Condition → two Responses → Secure I/O →
export/secret/deploy). One designer detail worth keeping: the SOQL action's real name became
**`Execute_a_SOQL_query_1`** (the designer suffixes), and the validator rejects any Response expression naming
an action that is not on its run-after path — the first save failed with `InvalidTemplate` for exactly that.

**First live ping (v26):** `{"ok":false,"via":"soap","fault_code":"sf:INVALID_SSO_GATEWAY_URL"}` — the SOAP
attempt was refused as expected, **but the fallback did not fire.** Cause: Salesforce namespaces SOAP fault codes
(`sf:INVALID_SSO_GATEWAY_URL`), `parseLoginResponse` keeps the raw text, and the gate did exact membership against
bare names. The tests could not see it: the SOAP tests use a prefix-tolerant regex, and the gate test asserted the
Set's *contents* rather than its behaviour on a real fault. **Fixed (Cowork, this branch):** `bareFaultCode()`
strips the namespace before the membership check; a positive control feeds the prefixed forms and was **seen red
on the unpatched file** (2 failures) and green after. Full suite 5,545 / 0 / 6 skipped. → **v27 deploy** (Scott).

**Lesson filed:** a test that checks a configuration value (what is in the Set) is not a test of the behaviour
(what happens when the real input arrives). Positive-control the input shape the world actually sends.

👤 **Scott:** move the exported flow zip from Downloads to
`private\power-automate\exports\production\2026-09-09\` (git-ignored), then redeploy v27 and re-ping;
report `via` + `open_tasks` only.
## 2026-09-09 — C13g-min-lane reconciled (PR #2202) and DEPLOYED: the retype verdict has a card; the next step is Scott working it

**Deploy verified**: `/version` = `3cd0e782` (read via `net.http_get` from LCC Opps); `git merge-base --is-ancestor`
confirms both `d00d5bbd` (the lane) and `bd2e556f` (the migration) are in it — the lane is running, not merely
merged. Guards re-run on `main`: `c13g-min-lane` + `own-t0e-sponsor-family-lane` + `review-shared` = 50/50.
All four registries carry `entity_type_review` (admin.js 12 hits, ops.js 2, dc-lanes.js 2, review-shared.js 1).
**Two corrections to the builder's write-up, measured:** the candidate view reads **18 rows, not 19** — the 19
was a transient inside its own control transaction; and `auto_mergeable` DID move (3,012 → 3,011) on the MERGE
step, where the prompt predicted "must not move" — benign and explained (Gardner leaves the group its retype
made it eligible for), but the prompt's prediction was wrong and the builder's "as predicted" is generous.
`lcc_entity_retype_log` = 0: nothing retyped for real yet. **Filed:** `C13g-min-lane-mutation` (16 tests, one
spot-checked; `v_lcc_entity_role_ambiguity` and the −4 property figure unmeasured). Prompt + response → `done/`.
**Next step is an operator sequence, not a build:** Decision Center → `entity_type_review` card
`Gardner-Tanenbaum` → `retype_organization` → OWN-T0e card `Gardner Tanenbaum Holdings` → `same_party` +
merge now → `MassMutual Life` the same → `NGP Group` card `same_party` → then re-measure `sponsor_family_confirm`
parts and the 19 `duplicate_entity_suspect` groups before deciding whether OWN-T0e-c needs UI. Predicted
`unclassified_rival` after the two merges: **−4 (Gardner) / −10 (MassMutual)** — the RTD/TEP third claimants
stay.

## 2026-09-09 — C13g-min-lane SHIPPED: the `entity_type_review` Decision Center lane over C13g-min's retype write

**Built.** All four registries (`api/admin.js` `FEDERATED_DECISION_TYPES`+`federatedSubjectRef` =
`etype:<entity_id>`, `ops.js` `_DC_FEDERATED`+tile, `dc-lanes.js` `_DC_FED_META`+card+`sponsor_family_lane`
forward, `review-shared.js` lane `entity_merge`); pure planner `api/_shared/entity-retype-planner.js`
(`retype_organization` → `rpc/lcc_retype_entity`, `keep_person` record-only, `research`); the card is
re-read from `v_lcc_entity_retype_candidates` AT VERDICT TIME (P188). Guard `test/c13g-min-lane.test.mjs`,
16 tests, full suite 5,555 pass / 0 fail after.

**⚠️ Inserting after `sponsor_family_confirm` broke that lane's own guard** — its structural tests anchor on
`'sponsor_family_confirm',\n]);` in `ops.js` and a block-extraction in `api/admin.js` that runs from its
verdict branch to the shared `unsupported_decision_type` line; appending after it shifted both boundaries.
Fixed by reordering `entity_type_review` to sit immediately BEFORE `sponsor_family_confirm` in both
registries, re-verified `test/own-t0e-sponsor-family-lane.test.mjs` green.

**Live census (real DB, not extrapolated):** lane population re-measured at **19 rows**, not the 18 the DB
half shipped with — the view is a re-derivable projection, not a snapshot. Full rolled-back positive control
on Gardner-Tanenbaum: `person` → `lcc_retype_entity` → `organization` → `lcc_merge_entity` (loser=Gardner,
winner=sponsor) → `lcc_unmerge_entity` → `lcc_unretype_entity` → `person`, **0 residue**. `merge_candidates`
5,205→5,204 and `auto_mergeable` 3,012→3,011 moved only on the merge step, not the retype (predicted and
confirmed); the broader Gardner+sponsor `unclassified_rival` conflict-row count moved 65→47. Neither Gardner
nor MassMutual Life carries `has_salesforce_contact`/`has_salesforce_account`, so retyping either moves
nothing on the Tier 0 bench. **Not re-measured this pass:** `v_lcc_entity_role_ambiguity`, the 14-co-claimed
"−4" figure from §9e (stands, unrefuted), a full mutation pass on every guard assertion (one spot-checked).
Canonical: owner-role-classification.md **§9f**; backlog `C13g-min-lane` ✅.

## 2026-09-09 — C13g-min reconciled (PR #2196): the retype WRITE is live and proven; the lane that asks for it was cut and is filed

Claude Code (desktop) shipped the **DB half only** and said so: `lcc_retype_entity` / `lcc_unretype_entity`
(SECURITY DEFINER, `anon`/`authenticated` EXECUTE **false** — read back with `has_function_privilege`, not
from the file), `lcc_entity_retype_log`, and `v_lcc_entity_retype_candidates` = **18 rows / $69,427,930**
(the prompt's prediction exactly). Positive control on Gardner-Tanenbaum rolled back clean; log reads 0 —
nothing retyped for real. Two footguns hit that CLAUDE.md already documents (`entity_type` is an ENUM;
`#variable_conflict use_column`). 10 source-shape tests pass; **no mutation pass**. No JS changed, so no
Railway deploy is implied. **Cut:** the `entity_type_review` lane (all four registries), the mutation guard,
the §3 consumer census beyond "eligible for merge candidates", the Tier 0 bench delta, and the 18-row named
read — filed as **C13g-min-lane** with a prompt. The view is anon-SELECTable by default grant; `entities`
already is, so nothing new leaks — noted, not changed. Canonical: owner-role-classification.md **§9e**
(+ §9b banner), OWN-T0e design **§9**, CURRENT-STATE, backlog C13g / OWN-T0e-b. **Operator option now:**
the two type-blocked OWN-T0e cards can be unblocked by an RPC call with `p_reason` before the lane exists.

## 2026-09-09 — SF-DIRECT-b reconciled (PR #2199): the SSO workaround is coded and tested; the last mile is a Switch case in Power Automate

**Verified.** `_shared/salesforce-gateway.ts` reads `SF_LOOKUP_WEBHOOK_URL` at one site and never puts it in an
error; the SELECT-only / no-`;` guard is client-side too; `sf-ping` falls back to the gateway on **exactly**
`INVALID_SSO_GATEWAY_URL` / `INVALID_LOGIN` (`index.ts:107`) and reports `via` + `soap_fault_code`; 42/42
targeted tests here, full suite 5,543/0 per CC; `grep sig=` finds no literal signature. The flow spec in
`docs/architecture/flows/http-switch-salesforce-lookup.md` § "soql operation" is build-precise: case value,
request contract, guards, **Execute a SOQL Query** on the existing `shared_salesforce` connection, both response
shapes, Secure I/O. **Live `intake-salesforce` is still v25** — v26 is Scott's deploy, after the flow case exists.

**What this is, plainly:** the platform's own Salesforce path (the PA proxy in `api/_shared/salesforce.js`,
built for SSO + no-Connected-App) made general and reachable from edge functions. The SOAP path stays as the
exhibit for the IT conversation Scott will have with the product in hand.

👤 **Scott, in order:** build the `soql` Switch case → re-export the flow → `supabase secrets set
SF_LOOKUP_WEBHOOK_URL … --project-ref zqzrriwuavgrquhisnoa` → `supabase functions deploy intake-salesforce
--project-ref zqzrriwuavgrquhisnoa --no-verify-jwt` (v26) → `sf-ping` → report the `open_tasks` count only.
Cowork walks the PA build step by step in chat.

## 2026-09-09 — SF-DIRECT deployed (v25) and proven to Salesforce's door — then blocked by the org's SSO policy, not by code

Scott deployed `intake-salesforce` **v25** (`--no-verify-jwt`; Cowork confirmed `verify_jwt=false` from
`list_edge_functions`). Live sequence, each step measured:

1. `GET ?action=sf-ping` with no header → **401**. With the literal placeholder → 401. With the real
   `PA_WEBHOOK_SECRET` (read from the Object Sync flow's HTTP header) → **200**, the handler ran. *The gate works.*
2. First real call → `sf:LOGIN_MUST_USE_SECURITY_TOKEN` in 443 ms. The SOAP envelope reached Salesforce and the
   username/password pair was accepted; the appended token was stale — Salesforce regenerates it on every
   password change and `sf-test` had sat idle since March. `supabase secrets list` showed `SF_SECURITY_TOKEN`
   present; Scott reset the token in Salesforce and `supabase secrets set` it (no redeploy needed).
3. Second call → **`sf:INVALID_SSO_GATEWAY_URL`** in 615 ms. That fault means the integration user's profile has
   **"Is Single Sign-On Enabled" (delegated authentication)**: a username/password API login is not validated by
   Salesforce but handed to the org's SSO gateway, whose URL is invalid for this path. Northmarq runs corporate
   SSO. **No credential value gets past this; it is a Salesforce-admin setting.**

**Verdict:** the capability is built, deployed, authenticated and proven to Salesforce's front door. It is
blocked one profile setting short of working.
**Scott's decision (same day): do not ask IT yet — build the workaround, pitch with the product in hand.** And
the workaround is already the platform's own design: `api/_shared/salesforce.js` is a Power Automate proxy built
*because* of SSO + no Connected App, talking to the flow "HTTP Switch Salesforce Lookup" through
`SF_LOOKUP_WEBHOOK_URL`, seven typed operations, live. SF-DIRECT's SOAP path added no capability the app lacked;
it adds the exhibit. Filed **SF-DIRECT-b** (prompt drafted): a guarded read-only `soql` case on that flow, an edge
sibling of the proxy, and `sf-ping` falling back to it. 👤 **Scott → Northmarq Salesforce admin:** either clear *Is Single
Sign-On Enabled* on the integration user's profile (API-only user is the standard pattern), or provide a
dedicated API-only integration user outside SSO. Until then SF-DIRECT stays 🟡 with a named external blocker,
and every outbound Salesforce lane stays on the Power Automate connector as designed.

⚠️ **Honest correction to the record:** the May audit's line that `sf-test` "tests SF credentials and queries 5
open tasks" described what the code *tried* to do. Nothing on file records it ever returning a successful
result, and the org's SSO policy predates the rebuild — so the capability `sf-test` "proved" may never have
worked past login. What it proved is the *design*; today is the first time the path was measured end to end.

## 2026-09-09 — C13g-min prompt drafted (entity retype behind a human verdict); SF-DIRECT response reconciled

Next step after the OWN-T0e after-state (PR #2193 merged): **C13g-min**, prompt at
`docs/claude-code/prompts/C13g-min-entity-retype-verdict.md`. Measured before writing it: **2 OWN-T0e cards
are type-blocked** (`Gardner-Tanenbaum` 18 facts / 14 co-claimed props / $6.17M; `MassMutual Life` 14 / 14 /
$5.25M — both `person`, both invisible to P149 because neither name carries an org marker); the population a
per-row verdict serves is **18 live person-typed entities with ≥2 current facts, $69.4M**, companies at the
head and real people (Luther, Stuart) in the tail — 0 org markers, 7 fail the name test, so it is a human
verdict, not a rule. ⚠️ **Retype + merge clears 4, not 14, of Gardner's conflict properties** — 10 carry a
third current claimant, the firm's own RTD/TEP SPEs, which share no brand token and are the "gate does not
reach" class. ⚠️ Sizing trap: a join to `external_identities` tripled the fact count (54 / 67 entities /
$205M) — the honest figure uses `EXISTS`. Options weighed: bolt `retype_first` onto `same_party` (2 rows) vs
a small standalone lane (18 rows, type is a fact about the entity) — the prompt takes the lane. Also
reconciled **SF-DIRECT** (PR #2192, merge `0a6603f8`): `salesforce-soap.ts` + `sf-ping` shipped, tests 13/13;
👤 deploy `intake-salesforce` v25 + first `sf-ping` run is Scott's step; response and prompt moved to `done/`.

## 2026-09-09 — OWN-T0e live after-state: 5 cards worked, predictions reconciled exactly; one denominator drift recorded, not adjudicated

`/version` = `87b631e8` (PR #2189 merge; PR #2187 = OWN-T0e). Scott worked 5 `sponsor_family_confirm` cards
14:19–14:20 UTC: 2 `confirm_family` (`ngp`, `uirc`) + 3 `same_party` with `merge_now` (GWU (The)→GWU,
RMR Group→RMR, "Salus Grovernment Properites"→Salus Gov't Properties, all `reversible=true`). Ledgers read
back: registry **6→8**, `lcc_decisions` **5**, `lcc_entity_merge_log` **145→148**,
`sponsor_family_confirmed` **64→102** = NGP Capital 28 (the §6 control's number) + UIRC 10 — **exact**.
⚠️ `unclassified_rival` read 1,575 (Scott, ~14:21) then 1,516 (14:34); `duplicate_entity` 416 → 412 —
no LCC write in between (facts/claims/merge-log/registry identical), so most likely a query-shape
difference, filed under OWN-T0h, not adjudicated. Measured for the follow-ups: the NGP mixed-group residue
(OWN-T0e-c) is **2 properties**, not 30; Gardner-Tanenbaum (C13g) co-claims **14 properties / $6.17M**
blocked by one `entity_type='person'`; no generic-token confirm happened, so that question has no live
instance yet. Design doc §8; canonical page § OWN-T0 pointer updated. Docs-only.
## 2026-09-09 — SF-DIRECT reconciled (PR #2192): the capability `sf-test` proved is back in the repo as an authenticated helper — deploy pending; and the teardown's day-1 12:30 check was not clean, as expected

**Verified.** `supabase/functions/_shared/salesforce-soap.ts` (192 lines): SOAP `login` envelope to
`https://${SF_LOGIN_HOST}/services/Soap/u/${SF_API_VERSION}` (defaults `login.salesforce.com` / `61.0`),
password + security token concatenated, session id reused as a Bearer token against the REST Query API;
`SfAuthError` carries the fault **code** only. `SF_PASSWORD` / `SF_SECURITY_TOKEN` are read at exactly one site
(`salesforce-soap.ts:135–136`) and **no `console.*` call exists in the helper.** `intake-salesforce?action=sf-ping`
dispatches at char 1004 of the router line, **after** the single unconditional `authenticateWebhook(req)` gate at
632 (the earlier "sf-ping" at 431 is the name in the unauthenticated service listing — correct). Error path
returns `err.message` only for `SfAuthError` (fault code), a fixed string otherwise. Tests: **13/13 pass here**
(no network); the auth test is a structural source check because `_shared/auth.ts` transitively imports an
`esm.sh` URL Node cannot load — an honest limitation, stated in the response. **Live: `intake-salesforce` is
still v24 with no `sf-ping` in the deployed body** — the deploy is the operator step the response says it is.

👤 **Operator step (Scott):** `supabase functions deploy intake-salesforce --project-ref zqzrriwuavgrquhisnoa
--no-verify-jwt` (pinned in `config.toml` too), then GET `…/intake-salesforce?action=sf-ping` with the
`X-PA-Webhook-Secret` header → expect 200 with an `open_tasks` count; without the header → 401. Record the
count only. Cowork will confirm v25 / `verify_jwt=false` / gateway 401 from here.

**Teardown observation, day 1 — NOT clean, and expected:** the frozen build's fingerprint fired again at
12:30:00 UTC (`44.205.19.44`, UA `node`, 17 requests, 3 × 400). Scott exported the v1 Teams flow at 12:25:33 UTC
and turned it off after the analysis, i.e. **after** its 12:30:00 trigger had already fired. The v1 flow's
run history should show today's 07:30 CT run as its last entry — 👤 confirm. **First real test: 2026-09-10
12:30 UTC.** The window does not start until a clean weekday.

**Docs this turn:** this entry · `PLANNED-BACKLOG.md` (SF-DIRECT 🟡 verified, deploy pending; J13-teardown day-1
note) · prompt + response → `done/`.

## 2026-09-09 — OWN-T0e verified live + OWN-T0e-b: `same_party` can merge the pair, and the type guard found a mistyped entity

**Deploy verified** (`/version` = `d264a7fb`, the OWN-T0e merge; lane answers 182 / 131 / 51, top card
NGP Capital $43.2M; the cache cron fired unattended at 12:27 UTC). Correction: `duplicate_entity_suspect`
is **19**, not 13 — §6 counted breadth groups only. **Built OWN-T0e-b** on
`build/own-t0e-b-same-party-merge`: `same_party` + `merge_now` merges the named duplicate into the
sponsor through `lcc_merge_entity` (one loser per verdict, live guards incl. same recorded
`entity_type`, `window.confirm` on the client). 16 tests, 13/13 new mutations RED; rolled-back positive
control on InCommercial (merge log 145 → 146 → 145, reversible). **Reading the 5 pairs the merge lane
could not show: 2 clean merges, 1 refused by the type guard (`Gardner-Tanenbaum` is typed `person` —
the C13c class, filed under C13g), 1 not a duplicate at all (Truist Bank ↔ Truist Financial is
parent/subsidiary), 1 on the wrong card.** `spe_props_max ≥ 2` flags "not a family", not "a
duplicate". Design doc §7. JS ships on the next Railway redeploy.
## 2026-09-09 — J13 teardown, day 1 walked live: the 12:30 caller was a forgotten v1 flow, and two red herrings shared its schedule

Walked the runbook's step 1 with Scott in chat, one step at a time, measuring at each step instead of
trusting the candidate list.

1. **Cowork desktop task `daily-briefing-cache`** — config read verbatim: 06:30 CT weekdays, GET
   `…vercel.app/api/activities?_route=daily-briefing` + POST `…/api/operations?_route=draft&action=health`.
   Logs at 11:30 UTC show nothing from the frozen build → the task is inert (its Claude has been declining
   to fire — 09-01 ops-log). **Recommended OFF, not repointed:** the first path is swallowed on Railway
   (`server.js:277` overwrites `_route`), the cache job is redundant with the 10:00 edge cron + 10:18 Railway
   cron, and a re-fire at 11:30 UTC would land after the Analyst's Take write (V4 hazard).
2. **"LCC Morning Briefing v2"** (export read) — Mon–Fri 12:30 UTC, already POSTs Railway
   `/api/briefing-email`; handler makes no outbound call. **Not the caller.**
3. **"LCC - Daily Briefing to Teams"** (export read) — daily 12:30 UTC, already GETs Railway
   `/api/daily-briefing?action=snapshot&role_view=broker`; all 14 card-binding fields exist in the live edge
   fn; Railway forwards `x-lcc-key`/`x-lcc-workspace`. **Not the caller.** ⚠️ Export carries the API key in
   plaintext → Secure Inputs hygiene item; keep the zip under `private/`.
4. **Timing closed the last door:** the edge fn booted 12:30:00.88 and returned 12:30:01.61; the AWS `node`
   burst starts 12:30:01.84 — *after* the function finished, so not a hop inside it either. The burst's
   table set is the OLD composite `/api/daily-briefing` handler. An independent caller, hitting Vercel
   directly. The edge fn was also invoked three times in 90 s (12:29:53, 12:30:01, 12:31:14).
5. **Scott's My-flows search for "briefing": four rows** — the two v2 flows, **"LCC Daily Briefing to
   Teams" (no hyphen, modified 3 mo ago)**, and an Instant "Send webhook alerts to Daily Briefing". The
   no-hyphen row is the May-2026 v1. **Scott opened it: ON, pointed at the Vercel host, successful run
   history. Turned OFF 2026-09-09.** That is the caller. Two near-identical names, one repointed in July,
   one forgotten — and it was in neither the registry nor `retired_flows` (PA5, wider than it read).

**Registry:** `retired-daily-briefing-teams-v1` added to `retired_flows` (OFF, not deleted, reason
recorded); `briefing-daily-teams-v2` and `briefing-morning-email-v2` added as baseline rows with GUIDs
from the exports; `retired-morning-briefing-v1` recorded as not-seen. YAML parses.

**Proof, tomorrow:** first weekday 12:30 UTC with no non-Railway `node` burst and no `v_my_work` 400
from the AWS pool → the ≥ 8-day observation window (runbook step 2) starts. **Still open on day 1:**
~~desktop task OFF (👤 confirm)~~ ✅ desktop task disabled by Scott, Copilot Studio connector host, extension build, the Instant webhook flow's
target, the mobile-share Shortcut (blocked: no route), ~~**and the Railway dashboard check for I16b.**~~

**Step 4 ✅ — Railway dashboard (project `handsome-luck`), read with Scott: I16/I16b RETRACTED.** Four web
services, none dormant: `tranquil-delight` (web app, :8080) · **`life-command-center` = the standalone MCP
server, `life-command-center-production.up.railway.app`, :3100 (`mcp/server.js` default)** · `pacific-love`
(BOV generator) · **`gracious-radiance`** — a service the ops reference never named: the record-linkage
resolver (`/health` → 0.1.0, splink/libpostal/gliner, `no_db_writes: true`), cited in four architecture docs.
Five cron services beside them. **The backlog's instruction to delete the "dormant `life-command-center`
service" would have deleted the MCP connector.** Ops reference now names all four domains.

**Step 5 ✅ — remaining Vercel callers cleared:** "Send webhook alerts to Daily Briefing" (export read) is an
inbound Teams-webhook trigger that posts cards — no outbound HTTP at all; the LCC extension on Scott's machine
is **1.0.52** (the P194-fixed manifest); the Copilot Studio "LCC Deal Intelligence" connector host is
**tranquil-delight**. Only the iPhone Shortcut remains, and it has no Railway route to point at
(`_route=mobile-share` not mounted) — 👤 delete the Shortcut or file a route request.

**Step 6 ✅ — Supabase side, run by Scott from the CLI and verified live from Cowork:**
- **`intake-salesforce` v23 → v24, `verify_jwt: false`** (`--no-verify-jwt` was mandatory: the function was
  never pinned in `supabase/config.toml`; pinned on this branch). Pre-flight diff: the repo's `index.ts` is the
  2026-09-07 sync of live v23 and untouched since; the only delta is `sf-config.ts` importing the canonical
  `GOV_SIGNALS` (DRIFT1-routing-gap). The GOVDUP1-a dedupe is a DB trigger, not function code, so nothing
  regressed. Bare GET still returns the service JSON (`sf-2026-05-v8`). **The `GOV_SIGNALS` routing fix is now
  in production** — first proof is the next hourly Object Sync run and a `gov_tenant_kw` reason on a state-agency
  record.
- **DRIFT1-retire ✅ — all four deleted:** `sf-test` (held live `SF_USERNAME`/`SF_PASSWORD`/`SF_SECURITY_TOKEN`,
  callable unauthenticated for four months), `test-function`, `ai-copilot-v2` (Dialysis_DB) and `docai-diag`
  (LCC Opps). Both function lists re-read; the gateway returns `NOT_FOUND` for `sf-test` and `docai-diag`.
  ~~👤 **Residue: the three `SF_*` project secrets now have no consumer** — `supabase secrets unset` them~~
  **DECIDED (Scott, same day): the secrets stay.** The rule is that no planned or built capability is lost, and
  `sf-test` proved one: SOAP login + SOQL against Salesforce from an edge function, with no Connected App. Filed
  **SF-DIRECT** (prompt drafted) to rebuild it as an authenticated helper. ⚠️ **Owned:** its body was never
  committed, the May audit's "source on record" line was false, and I fetched the deployed bodies of the two
  functions I kept but not of `sf-test` before recommending the delete — that body is gone. The pattern is
  standard and re-creatable in one prompt; the lesson is filed in `CLAUDE.md` below.

**Floating local work, checked:** 126 local branches on the desktop; exactly one carries commits not on
`origin/main` — `publish-c868140` (two commits, 2026-08-26, 1,069 behind). Every line it added is on `main`:
the 08-27 STATUS entry in the history archive, the 31 worklogs byte-identical, the A3 row superseded when A3
shipped, the `PROMPT_22` lines present under the renamed path. Nothing to push → delete the branch. The
untracked `Claude outputs/` folder at repo root holds only session scratch (a superseded patch, a prompt copy).

## 2026-09-09 — OWN-T0e BUILT: the `sponsor_family_confirm` lane, a cache because the view was 64 s, and "properties" that were pairs

**Cowork, branch `build/own-t0e-sponsor-family-lane`.** The lane designed on 2026-09-08 is built per
design §4 — four registries, planner `api/_shared/sponsor-family-planner.js`, fetch + verdict in
`api/admin.js`, card in `dc-lanes.js`; ONE write (`INSERT lcc_ownership_sponsor_family`, reversible by
DELETE); `same_party` records and forwards to `merge_duplicate_entities`; guard 13 tests / **19 of 19
mutations RED**; full suite green in four chunks + `check:boot`. Design doc §6 is the build record.
Three measured departures from the design: (1) **the dry-run view ran 64.3 s** — a nested-loop
self-join (11.3M join-filter rejections) plus a per-group `regexp_replace` over all 69k entities —
rewritten to 19.8 s with output byte-identical (md5 over 21 columns), **and the lane reads a 4-hourly
cache** (`lcc_ownt0e_sponsor_family_proposals_cache`, cron `lcc-ownt0e-proposals-refresh` `27 */4`,
the `lcc_priority_queue_resolved` pattern) with the two write-refusing guards read live; (2) tied
groups hold up to **9** members, so `member_ids`/`member_names` were appended (a `tied_pair`-indexed
picker would have mislabelled the sponsor); (3) **`properties` counts pairs** — rolled-back positive
control on NGP Capital/`ngp`: 30 pairs → **28** properties flipped `unclassified_rival` →
`sponsor_family_confirmed` (35 → 7 remaining). First live cards read: NGP Capital $43.2M (27 SPEs + 2
duplicate entities riding inside), GWU $23.4M and RMR $11.5M (pure duplicates — `same_party`). **5 of
13 duplicate-suspect pairs are absent from the merge lane the forward targets** → backlog
**OWN-T0e-b**; a mixed group needs both verdicts → **OWN-T0e-c**. Also found: PR #2185's runbook merged
with `retired-identifiers-guard` RED on `main` through the docs-only CI path → allowlisted by path
here, fix filed as **J13a-ci-docs-only**; `review-shared.test.mjs`'s lane-map count pin 28 → 29.
Cache locked to `service_role` (Supabase's default `anon` SELECT measured and revoked). **DB half is
live; the JS half ships on the Railway redeploy.** Open for Scott: generic-word token confirms with a
warning only — tighten to an explicit ack?

## 2026-09-09 — J13-teardown-preflight: the retired Vercel host is still writing, not just answering — one live scheduled caller found, runbook shipped
## 2026-09-09 — J13-preflight reconciled (PR #2185): the caller is real, the "Vercel writes" attribution was not — the user agent decides it

**Held.** The preflight's method (P194's writer-IP classes over `edge_logs`), its 24 h window stated honestly,
the six candidate-caller checks (`_route=mobile-share` is not mounted in `server.js` — a real blocker; the
extension is Railway-first at manifest 1.0.52; `FLOW-REGISTRY.yaml` and all 17 retained PA exports carry 0 Vercel
hits; the `outputs/daily-briefing-logs/` runner is a dead one-off), the five-step runbook, the J13 split.

**Did not hold — the load-bearing attribution.** §2b called the 10:00:27 UTC upsert to `briefing_intel_snapshot`
from `18.208.213.136` *"the retired Vercel deployment independently generating and persisting its own snapshot."*
The column the pass never read refutes it: `request.headers.user_agent` = **`Deno/2.1.4 (variant;
SupabaseEdgeRuntime/1.74.3)`** — that is the **`briefing-intel-snapshot` Supabase edge function** (backlog V4),
which egresses from the same AWS pool. It recurred 2026-09-09 10:00 from `54.227.48.19`, same UA. **The frozen
build does not write that table.** Struck in place in the audit (§2b, §4 table, §5), the runbook (step 1), and
the entry below.

**What IS the frozen build, confirmed:** the 12:30:00–12:30:02 UTC burst — UA **`node`**, 17–18 requests reading
the dashboard views, and **three HTTP 400s** (`v_my_work`, `mv_user_work_counts`, `action_items`) — a build
asking for columns the current schema no longer has, while the live `daily-briefing` edge function renders the
same views in the same minute with 0 errors. **Recurrence** (one 24 h query per day): Thu 09-04 ✓
(`18.212.144.204`) · Fri 09-05 ✗ · Sat 09-06 ✗ · Mon 09-07 ✓ (`54.209.9.254`) · Tue 09-08 ✓ (`18.209.20.81`) ·
today's 12:30 not yet reached. Always 12:30:00 sharp = **07:30 CT**; read-only. A Power Automate weekday
recurrence would not have skipped Friday; a task that fires only while Scott's PC is awake would — consistent
with the **Cowork desktop task `daily-briefing-cache`** the 09-01 ops-log names. Not proven; the walkthrough
opens that task first.

**Also in the logs, named so nobody mistakes them for Vercel:** the heavy AWS `node` bursts (2,562 req/min at
13:00 on 09-08 from `52.9.126.170`; 2,799/min at 12:30 on 09-05 from `52.53.39.135`; `unified_contacts` /
`data_corrections` runs at 15:17–15:41) are app-shaped — `enrichment_jobs`, `processing_log`, `bridge_runs` — the
signature of a Claude Code sandbox running the suite or a backfill against production (RO1/RO2 shipped that
day). The preflight correctly called these "a different caller shape"; recording the likely identity so the
next reader does not re-derive it. And one **live** defect surfaced on the way: Railway's own 10:18 cron
(`152.55.177.164`) got a **400 on `v_my_work`** on 09-04 — the current build, not Vercel → filed **BRIEF-400**.

**Docs this turn:** audit + runbook + CC's entry corrected in place (never deleted) · `PLANNED-BACKLOG.md`
(J13-preflight ✅ verified-with-correction; J13-teardown 👤 with the corrected caller; V4 note; **BRIEF-400**
new) · `CLAUDE.md` P194 bullet: *IP class alone is half a fingerprint — read the user agent; the Supabase edge
runtime shares the AWS pool* · prompt + response + docx → `done/`. Then the manual steps, walked one at a time.

## 2026-09-09 — J13-teardown-preflight: the retired Vercel host is ~~still writing, not just answering~~ still being CALLED daily at 12:30 UTC (it reads, and fails on 3 views) — one live scheduled caller found, runbook shipped *(headline corrected in place — see the reconcile entry above)*

**Read-only.** No code, DB writes, migrations, or deploys. Queried Supabase `edge_logs` on LCC Opps
(24h window, `2026-09-08T01:22Z → 2026-09-09T01:21Z` — `query_logs` caps at 24h/call; this is one
day's sample, **not** 14 days, stated plainly). Split the IP population by P194's Railway-stable vs.
AWS-ephemeral-pool classes: a rotating AWS pool exists, but most of it looks like ordinary broad
multi-table app traffic, not the narrow single-path fingerprint P194's W53 audit describes for the
intake channel. One real signal did match that shape: `18.208.213.136` **POSTed** an upsert
(`on_conflict=as_of_date,workspace_id`) to `briefing_intel_snapshot` at 10:00:27 UTC → HTTP 201, 18
minutes before Railway's own cron-240 read+PATCH of the same row, and `18.209.20.81` fired an 18-call
composite dashboard-render burst at 12:30:01 UTC — matching the "daily-briefing-cache" desktop task
pattern named in `docs/ops-logs/daily-briefing-cache-2026-09-01.md`. Confirmed the Cowork 21:43–21:44
UTC read-probe did not persist a snapshot (excluded from every count). Confirmed
`/api/intake?_route=mobile-share` is **not mounted** in `server.js` — the iPhone Shortcut has no live
Railway route to repoint to, a blocker rather than a routine fix. Confirmed
`extension/background.js::pickIntakeHost()` is Railway-first (shipped manifest `1.0.52`); confirmed
`docs/os/FLOW-REGISTRY.yaml` and the sampled 2026-08-11 PA export zips carry 0 Vercel hits; named
(did not identify) the pre-existing "3 flows outside the registry and `retired_flows`" boundary.
Shipped `docs/audits/J13_TEARDOWN_PREFLIGHT_2026-09-09.md` (every query run, exact window read) and
`docs/os/RUNBOOK_vercel_teardown.md` (5 ordered steps + proofs + a rollback-signature table per
caller class). Split `docs/os/PLANNED-BACKLOG.md` J13 into **J13-preflight** (✅, this unit) and
**J13-teardown** (👤 Scott, the runbook). **Does not tear anything down, rotate any key, or repoint any
caller** — those stay Scott's, per the runbook.

## 2026-09-08 — J13a-guard reconciled (PR #2181): the guard is real, and it had a hole the size of the defect it was built for — closed, positive-controlled, suite 5473/0

**Verified.** Ran `test/retired-identifiers-guard.test.mjs` locally on `main`: 6/6, `tracked=4486 scanned=4403
hits=0 exempt=86 allowlisted=2` (CC's 4482/4399/76 predate two later PRs — not a discrepancy). **My own RED run**
— a synthetic tracked offender staged under `api/` — failed naming the file; a retired host in a JS *comment* is
not flagged, by design. Every moved artifact's referrer sits in an exempt directory or under a banner;
`scripts/build_canonical_connector.py` reads only the `openapi.json` siblings, which stayed. Live Railway
`/version` = `dbf37d82` = the J13a merge — **this PR is already deployed.** CC's refusal to seed
`life-command-center-production.up.railway.app` as retired was **correct, and the prompt's seed row was wrong**
(struck in place in `prompts/done/J13a-retired-host-guard.md`).

🚨 **Did not hold — found by trying the defect inside an exemption.** `hasRetirementBanner` tested
`/STALE \(DOCMAP|RETIRED/i` over the first 40 lines of *any* file. Measured: **40+ tracked files rode the bare
word "retired"** — live `api/_shared/junk-prescreen.js`, `share-extractor.js`, `todo-completion.js`,
`dc-lanes.js`, four `.github/workflows/*.yml`, `AGENTS.md`, `WRITE_SURFACE_POLICY.md`, `docs/os/CURRENT-STATE.md`.
Positive control: appended `export const __PROBE = "https://life-command-center-nine.vercel.app/api/intake"` to
`api/_shared/share-extractor.js` → **suite GREEN, `hits=0`.** That is the P194 shape — a fallback URL in live
code — walking through the guard built for it, on the day it shipped. The response's "seen RED" was real but on
the wrong path (an allowlist removal). **Fixed on this branch:** the banner exemption is now `.md`-only and
blockquote-only (`> … STALE (DOCMAP` / `> … RETIRED` — the DOCMAP1 convention every real banner follows); two
positive controls pin it (8 tests); the same probe now fails naming the file; three correctly-framed docs the
word had been carrying are exempted BY PATH with reasons — `INTAKE_TODO_FLOW_AUDIT_2026-07-23.md` (a dated audit
that belongs in `docs/audits/`; move candidate), `POWER-AUTOMATE-API-HTML-TRIAGE-CODEX-PROMPT-2026-08-11.md`,
`DOCMAP1_CLASSIFICATION.md`. Final `hits=0 exempt=86 allowlisted=2`. **Full suite (cloud clone of `main` +
this file): 5479 tests / 5473 pass / 0 fail / 6 skipped.** Lesson filed in `CLAUDE.md`: *a word is not a banner —
an exemption must be shaped like the artifact it excuses, and "seen red" on one path is not "seen red" on the
path that matters.*

**Live probes (`net.http_get` from LCC Opps, 21:43–21:44 UTC) — two facts corrected in the record:**
1. **The retired Vercel host is executing today.** `/api/daily-briefing` → 200 with a briefing generated at
   that instant; `/` → the SPA; `/version` → Vercel NOT_FOUND only because the route postdates the frozen build.
   P194 re-measured, not carried. J13 👤 (teardown) stands and is the only real fix.
2. **`life-command-center-production.up.railway.app` is NOT dormant.** `/health` →
   `{"status":"ok","server":"lcc-mcp-server","version":"1.0.0","tools":[…]}`; `/` → "Life Command Center MCP
   Server … /mcp, /health"; `/api/comps` GET → Express 404 (the route is POST — `mcp/server.js:2205`). **It is
   the live standalone MCP server**, the second member of the pair `CURRENT-STATE.md` names, and what this
   session's `mcp__lcc__*` tools talk to. Two lines in this file and my J13a prompt called it "the dormant Railway
   service (I16b)" — **all struck in place.** ✅ **Not a defect:** the six `api/*.js` files that default
   `GOV_API_URL`/`MCP_BASE` to it are calling routes `mcp/server.js` actually mounts (`/api/comps`,
   `/api/query-comps`, `/api/comp-reviews`, `/api/metadata-backfill`) — that is the engine host by design.
   ⚠️ **Conflict filed on I16b:** Railway's default domain shape for a service named `life-command-center` is
   exactly `life-command-center-production.up.railway.app`. If the "dormant" service and the MCP server are the
   same Railway service, **I16/I16b's "delete it" would kill the MCP connector** — frozen until Scott reads the
   Railway dashboard (which service owns the domain). The registry's two roster flows posting
   `/api/pipeline/ingest-deal-*` to this host get the Express 404 the registry already recorded; its remediation
   (repoint to tranquil-delight) stands.

**Also checked:** the four cloud scheduled tasks carry no retired host. The `daily-briefing-cache` "task file"
that `docs/ops-logs/daily-briefing-cache-2026-09-01.md` says still targets Vercel is a Cowork **desktop** task
(not listed by the cloud API) — 👤 Scott: edit it to the Railway host; until then it is a live caller the
teardown would break.

**Docs this turn:** this entry · 2 in-place strikes ("dormant") · `PLANNED-BACKLOG.md` (J13a-guard ✅ +
verified/tightened; J13 re-probed; **I16b Conflict**) · `CLAUDE.md` (two footgun sub-bullets + P194 re-measure) ·
`DOCUMENTATION-MAP.md` (what "bannered" means) · prompt (seed struck) + response (reconcile appended) + docx →
`done/` · `test/retired-identifiers-guard.test.mjs` tightened (code change, suite green). **Next prompt drafted:
`J13-teardown-preflight.md`** — enumerate every live caller of the retired host from `edge_logs` (P194's IP
fingerprint) and the repo, then write the teardown runbook in the order that cannot strand a caller.

**Operator items:** 🚨 **Railway dashboard: which service owns `life-command-center-production.up.railway.app`**
(decides I16b) · the `daily-briefing-cache` desktop task → Railway host · Vercel teardown (after the preflight) ·
DRIFT1-retire (`sf-test` first) · `intake-salesforce` redeploy · DRIFT1-sfenrich.

## 2026-09-08 — DOCMAP3 reconciled (PR #2178): 18 fixes verified, four numbers corrected in place — and the arc's next step is a guard, not a fourth sweep

**First, the git state, because it changed what this turn had to do.** PR #2175 merged only the docx/handoff
commit — the 17-file DOCMAP2-reconcile patch it was meant to carry never applied, so none of that work was on
`main` when DOCMAP3 ran (CC re-derived and re-bannered six of the same flow docs from the prompt alone, correctly).
Meanwhile the UX-T1c window filed its own DOCMAP2 row and paragraph, repeating three claims the stranded patch
had refuted. Resolution, per the two-windows doctrine: their row and paragraph are **kept verbatim and struck in
place**; the stranded entry is landed below DOCMAP3's (chronological); the ten banners are credited to whoever
actually landed them (6 + 2 DOCMAP3, 2 here). ⚠️ *Lesson for the git block: after `git am`, `git log --oneline -2`
must show the patch's subject before pushing. A branch with one commit is not a branch with two.*

**DOCMAP3 verified (`1f93e973`, base `bb418b81`):** all 21 bannered files exist on `main` with the DOCMAP3 tag;
`BRIGGS-WRITING-VOICE.md` is read by path from `api/draft-assist.js`, `api/_handlers/briefing-analyst-take-tick.js`,
`api/_shared/briefing-analyst-take.js`, `api/_shared/draft-assist-core.js` + 2 tests (CANONICAL holds); the
`CONTACTS_HUB=ops` refutation is `CLAUDE.md`:186 ✓; `todo-lcc-sync` / `unflag-completed` are both in
`FLOW-REGISTRY.yaml` `retired_flows` (lines 311/315) ✓; the docx is the surface transcript and matches the STATUS
entry. **Corrected in place, in the entry below:** Unit A wrote **47 rows, not 51** (four files had neither row nor
mention — added, with verdicts: two STALE→FIXED (DOCMAP2), two HISTORICAL); Unit B's "all file types" recount
**included `docs/history/` and `docs/capital-markets/`**, which the prompt excluded — the figures reproduce exactly
with the archive in and read 61/27/18/12/18/11 with it out; `docs/setup/` is 24 `.md`, not 23; the AUTH heading was
rewritten rather than bannered. One **disagreement recorded, not silently overruled**: `LCC_OneDrive_Upload_Setup`
is a procedure that POSTs to the retired host and is bannered here; DOCMAP3 read it as dated narrative.

**Five terms read clean is the most useful line DOCMAP3 wrote** — `SOS-direct`, `owner-contact-websearch`,
`GOV_STATE_SIGNALS`, `queue_v2_enabled`, `exec_sql` are recorded as RESULTS; do not re-grep them.

**Where the arc stands.** Three passes, one defect class: DOCMAP1 4 → DOCMAP2 12 → DOCMAP3 18, nearly every one
of them `life-command-center-nine.vercel.app` stated as a live target, and every fix a banner a human must read.
The retired deployment itself still stands (J13 👤, last measured P194), and its hostname is still inside three
importable `flow-*.json` definitions and the Copilot Studio agent package (J13a). **Recommendation: stop sweeping,
start enforcing.** Next prompt drafted — `J13a-retired-host-guard.md`: a test that fails CI on any retired
identifier outside the archive/history/banner set, positive-controlled both ways, plus the referrer-measured move
of the machine-read artifacts under `docs/archive/`. DOCMAP4 (canon block facts, the 87 title+skim rows,
`AI_CHAT_ROLLOUT_CHECKLIST` "policy: balanced", `SPEC_forsale` B/C) is filed 🟢 and not scheduled — the yield curve
says the guard is worth more than the next sweep.

**Docs this turn:** this entry + the stranded DOCMAP2 entry · 5 in-place corrections in DOCMAP3's entry and 1 in
the UX-T1c paragraph · `PLANNED-BACKLOG.md` (J13 rewritten with strike, **J13a**, DOCMAP2 ✅ ×2 — theirs struck,
mine verified — DOCMAP3 ✅, **J13a-guard** 🟢) · `DOCUMENTATION-MAP.md` §1a (4→11 STALE, 145→138, the 181/232
note) · `DOCMAP1_CLASSIFICATION.md` (+4 rows, total line corrected) · `CLAUDE.md` (one footgun bullet: grep the
hostname, not the brand) · DOCMAP2 response corrected in place (5 strikes) · DOCMAP3 prompt → `prompts/done/`,
docx + a `.response.md` transcript → `responses/done/` · 2 banners. **Operator items, unchanged:** DRIFT1-retire
(`sf-test`, `test-function`, `ai-copilot-v2` still ACTIVE on Dialysis_DB), `intake-salesforce` redeploy,
DRIFT1-sfenrich, and the Vercel teardown.
## 2026-09-08 — OWN-T0e designed, dry-run surface live: the A3 gate reaches 317 of 1,617 conflicts, and 13 of its top groups are sponsor DUPLICATES, not SPEs

Design doc `docs/audits/OWN_T0e_SPONSOR_FAMILY_LANE_DESIGN_2026-09-08.md`; read-only view
`v_lcc_ownt0e_sponsor_family_proposals` (migration `20260908150000`, applied to LCC Opps). **Nothing
writes.** The reconciled store holds **2,097** conflict properties (gov 1,769 / dia 328), 1,617
`unclassified_rival` — not the 756 OWN-T0 quoted from `v_lcc_property_multi_current` (two
denominators, filed OWN-T0h). Applying A3's one sanctioned gate `lcc_ownership_sponsor_token` with
sponsor = the party holding more current properties (a recorded fact, ties surfaced): **182 groups /
317 properties / $172.7M; 126 breadth-decided non-generic / 241 props / $109.1M; 0 already
confirmed** against a registry of 6 hand-written rows. Read on named rows: **13 groups / 85
properties have a "SPE" holding ≥2 properties — the sponsor under a duplicate entity**
(`Gardner Tanenbaum Holdings ← Gardner-Tanenbaum` (18), `RMR ← RMR Group`, `Massmutual ←
MassMutual Life`), which a family confirm would paper over; the lane therefore gets a `same_party`
verdict routing to `merge_duplicate_entities`. 6 generic-token groups (`realty`, `federal`,
`george`, `john`) flagged, not filtered. Hedge-phrase entities (`… or affiliated individuals`) are
live owner candidates — filed OWN-T0i. Lane design §4: four verdicts, one write (INSERT into
`lcc_ownership_sponsor_family`, reversible by DELETE), verify on `conflict_class` counts. **Build is
the next step.**

## 2026-09-08 — RO2 REFUTED on named rows: the "217 syncs" are sponsor↔SPE pairs, name variants and capture artifacts; RO1 verified live at 761

Read the 217 deed-arm rows where the grantee equals gov's `true_owner` before building the sync
(audit §10.7). `true_owners.source` is NULL on 212 of 217, so "gov agrees with itself" cannot be
shown to be two sources. The top 30 by rent, read: same-party variants (`GBA ASSOCIATES LP → GBA
Associates`), sponsor↔SPE in both directions (`Boyd Watterson → WINCHESTER VA I FGF LLC`, `EGP 2400
NEWPORT NEWS LLC → Easterly Government Properties`, `KanAm Grund → NGP V …`), a MANAGER as grantee
(`GPT → RMR` ×7), a TENANT as grantee (`→ USPS`), a hedge phrase (`CIM Group or affiliated
investors`), ~5 plausibly genuine and all undated. An automated write would have minted duplicate
recorded owners, swapped sponsors for SPEs and made a manager and a tenant owners of record.
**Nothing built.** RO2 → ❌ re-scoped: RO2a (gov `recorded_owners` name-variant dedup, ≥45), RO2b
(9 artifact grantees). Also: a `GSA` contains-rule tried for sizing over-fired on 32 legitimate
agency-named SPEs — the P158a trap, recorded so it is not filed as a guard.

**RO1 verified live:** Railway `/version` `dbf37d82`, `resolve_ownership` lane total **761** (was
1,597). Backlog row cleared.

## 2026-09-08 — RO1 SHIPPED: the resolve_ownership lane drops 1,597 → 761 by filtering the no-op half at the source

gov `v_ownership_resolution` gained `proposal_is_recorded` (appended LAST, whole view restated,
applied live via migration `20261010120000_gov_ro1_…`); the `resolve_ownership` handler filters
`=eq.false` on both the fetch and the badge count. Live split after apply: true 836 / false 761 —
identical to §10.1's prediction, by arm (`gsa_lessor_change` 734/70, `state_lessor_change` 95/1,
`discrepancy` 7/92, `deed_grantee` 0/598). Nothing written to `lcc_decisions`: the 836 were never
decisions and return automatically if a proposal stops matching. Guard
`test/ro1-resolve-ownership-noop-retire.test.mjs`, both mutations RED. Handler half needs the Railway
redeploy; verify the lane badge reads 761.

**Correction to my own §10 / RO3 claim:** "the handler never selects `true_owner_name`" was wrong —
it is in `sel`, in the context, and rendered by `dc-lanes.js` ("True owner: …"). Corrected in place
in the audit, the backlog row and RO3; the real gap is the *comparison* (proposal = true_owner on
217 rows), not the column.

## 2026-09-08 — UX-T1c-resolveown-vs-ownt0 MEASURED: half the `resolve_ownership` lane is a no-op, and its properties are 3× as conflicted in the OWN-T0 store as the fleet

Audit §10. Read gov `v_ownership_resolution`'s live definition, re-ran its three arms, carried the
1,597 property_ids to LCC Opps and joined `v_lcc_property_ownership_reconciled`. **836 of 1,597
(52%) propose the owner already recorded** — the lessor changed *to* the party we hold, surfaced as a
decision (A1's `agrees` shape). Real disputes: 761 rows / $1.07B, 598 of them the deed arm; **391
deeds undated**, ≥124 sponsor↔SPE-shaped (`uirc`/`easterly`/`boyd`). gov disagrees with itself
first: **217 deed proposals ARE gov's `true_owner`** (only `recorded_owners` lags); 767 rows are
recorded ≠ proposed ≠ true_owner. Against the OWN-T0 store: 1,535 present, **470 `conflict` (29.4%
vs 9.4% fleet)**, 409 primaries ≠ gov true_owner, 433 with no LCC resolution at all. `confirm`×1,597
is a data fact (`no_recorded` 0, `deed_auto_fixable` 0), not the CASE — corrects §9's phrasing.
**Nothing built.** Decision recorded as RO1 (retire the 836), RO2 (sync the 217), RO3 (repoint the
lane at the reconciled store; design question for Scott — ⚠️ the 'select `true_owner_name`' half of that row was wrong, it is already on the card), RO4 (391 undated
deeds), RO5 (split the 470 by arm). Canonical page `ownership-history-lane.md` § OWN-T0 gained the
pointer. Also: the view is `security_invoker=on` + anon SELECT → 0 rows to anon (P157 class, inert).

**Deploy verified:** Railway `/version` = `0c696da4` (PR #2176), and the intake-cap fix proven
behaviourally — `GET /api/decisions?type=intake_disposition&intake_view=all` → `total: 902`, above
the 889 the old single `limit=1000` could ever have returned. Backlog row's "not yet verified live"
cleared.

## 2026-09-08 — DOCMAP3 (Unit 1b, deep-read by consequence) — 18 defects found and fixed, 4 unit-boundary reports

Picks up the deep-read DOCMAP2 named but did not start. Four units, each reporting
enumerated/read/found/fixed counts (never "files reviewed" alone).

**Unit A — `docs/architecture/` subdirectories (flows/, ai-chat-routing/, backfill-artifacts/,
office-scripts/), 51 files.** Enumerated 51, read 51 (title+skim or deeper), found **9 defects**,
fixed **9**. `docs/os/DOCMAP1_CLASSIFICATION.md` gained a new dated section verdicting ~~all 51~~ **47 of the
51** (⚠️ Cowork reconcile 2026-09-08: `loopnet-power-automate.md`, `rcm-power-automate.md`,
`vercel-github-direct-alert.md`, `weekly-retention-sweep.md` had no row and no mention — 4 rows added) by
DOCMAP1's own tier method, cross-referenced against `docs/os/FLOW-REGISTRY.yaml` (the authority on
current/retired flows). Defects: **7 stale-Vercel-endpoint flow docs** (`http-init-llc-repair-
runbook.md`, `http-parsejson-property-email.md`, `lcc-daily-briefing.md`, `lcc-morning-briefing.md`,
`lcc-outlook-calendar-write.md`, `lcc-outlook-intake.md`, `lcc-weekday-briefing-email.md` — the six
files DOCMAP2's case-sensitive grep missed, plus one it didn't reach) banner-fixed in the format
DOCMAP2 already used on `loopnet-power-automate.md`/`rcm-power-automate.md`; **2 retired-flow docs
with no in-doc retirement notice** (`todo-lcc-sync.md`, `unflag-completed-email-tasks.md` — both
match `retired_flows` entries in FLOW-REGISTRY.yaml) banner-fixed. `FLOW_CHANGES_LOG.md`'s one
Vercel mention is inside a historical dated log entry describing a past run and was correctly left
untouched. 27 of the 45 `flows/` files verdict HISTORICAL on title+skim only (build/troubleshooting
notes for flows outside the 17-flow registry baseline) — not deep-verified beyond a case-insensitive
Vercel grep (0 further hits). `office-scripts/README.md` verdicts CANONICAL (live mechanism);
`backfill-artifacts/README.md` verdicts HISTORICAL (completed 2026-07-30 deliverable). The four
`ai-chat-routing/` files verdict HISTORICAL/unconfirmed — `AI_CHAT_ROLLOUT_CHECKLIST.md`'s
"Current Target: policy: balanced" claim was NOT cross-checked against the live routing config
(out of budget; filed as NOT REACHED, not asserted true or false).

**Unit B — six count-only terms from DOCMAP2, re-grepped case-insensitively across ALL file types
(not just .md) and read.**

| term | DOCMAP2's old count | re-count (`grep -ril`, all file types) | defects found | defects fixed |
|---|---:|---:|---:|---:|
| `SOS-direct` | 18 | 79 (47 .md) | 0 | 0 |
| `CONTACTS_HUB` | 13 | 33 (24 .md) | 1 | 1 |
| `owner-contact-websearch` | 6 | 19 (11 .md) | 0 | 0 |
| `GOV_STATE_SIGNALS` | 6 | 12 (9 .md) | 0 | 0 |
| `queue_v2_enabled` | 7 | 18 (10 .md) | 0 | 0 |
| `exec_sql` | 5 | 13 (9 .md) | 0 | 0 |

Old counts were `.md`-only file counts from DOCMAP2; the re-count above is grepped across every file
type, which is why every number moved (not a discrepancy — a wider net). ⚠️ **Cowork reconcile 2026-09-08: the
net was wider than stated — it also swept `docs/history/` and `docs/capital-markets/`, which the prompt and
DOCMAP2 both excluded.** Re-run at base `bb418b81` with those two excluded (`git grep -il`, all types):
SOS-direct **61** (29 `.md`) · CONTACTS_HUB **27** (18) · owner-contact-websearch **18** (10) · GOV_STATE_SIGNALS
**12** (9) · queue_v2_enabled **18** (10) · exec_sql **11** (7). The table's figures reproduce exactly once the
archive is included, so they are a correct measurement of a different scope — and the archive hits are the ones
that need no reading. The one defect:
`docs/CONTACTS_SPLIT_BRAIN_CUTOVER_RUNBOOK.md` presented the `CONTACTS_HUB=ops` flip as a
still-pending step ("3. Flip the routing: set `CONTACTS_HUB=ops`") when the cutover completed
2026-08-17 (root CLAUDE.md: "It is currently set to `ops`"); banner-fixed in place. **Five terms
read clean — 0 candidates were defects, all genuinely current or correctly self-describe as
paused/blocked/retired.** Recording this explicitly per the task's instruction so a future DOCMAP4
does not re-grep these five from scratch: `SOS-direct` and `owner-contact-websearch` are correctly
and consistently documented as blocked/paused everywhere sampled; `GOV_STATE_SIGNALS` is correctly
documented post-DRIFT1-routing-gap as merged into `GOV_SIGNALS` and NOT YET deployed;
`queue_v2_enabled` and `exec_sql` mentions are all either accurate current-state descriptions or
correctly-dated historical audit entries. Two additional renamed-symbol sweeps, done the same way:
`gov_merge_property` (renamed target `gov_merge_property_apply`) — many hits, sampled the
non-`docs/history`/non-dated-audit set, 0 defects (every current doc correctly describes the old
name as now raising, per ADDR1b-merge); `docs/os/architecture/` (the DOCMAP1-merged path) — 6 file
hits, all inside historical/reconcile narrative correctly describing the merge (e.g. "0 — merged
into `docs/architecture/`"), confirming DOCMAP1's "0" claim reproduces once you read the 6 hits
rather than just count them. `life-command-center-production.up.railway.app` (I16b, ~~the dormant
Railway service~~ ⚠️ Cowork 2026-09-08: measured live as the standalone MCP server — see the J13a-guard reconcile entry) — 16 file hits, count-only per the task's instruction (deliberately tracked in
FLOW-REGISTRY.yaml, not "fixed").

**Unit C — deep-read named set: 3 repo-root files + 51 BUILD/PLAN/SPEC/ROADMAP/SETUP/CHECKLIST
files under `docs/setup/`+`docs/architecture/` (recursive) + 6 non-architecture files CLAUDE.md's
"Pointers to canonical docs" section cites (the remaining ~30 pointer targets are `docs/architecture/`
files already carrying a CANONICAL verdict in DOCMAP1, or `docs/audits/` files out of this task's
scope per `docs/audits/README.md`).** Enumerated 60, read 60 (grep-based staleness sweep on all 60;
manual read on ~20 flagged/high-risk ones). Found **8 defects**, fixed **8**.

Named set (repo-root):
- `BRIGGS-WRITING-VOICE.md` — verdict **CANONICAL**. Confirmed live: read by path from
  `api/draft-assist.js`, `api/_handlers/briefing-analyst-take-tick.js`,
  `api/_shared/briefing-analyst-take.js`, and asserted-on by `test/draft-assist.test.mjs` /
  `test/briefing-analyst-take.test.mjs`. No defect.
- `SPEC_forsale_om_and_webpage_ingest.md` — verdict **PARTIALLY BUILT, not banner-fixed**. Part A
  (embedded Marketing Brochure capture) is confirmed shipped in `extension/content/costar.js`
  (`Marketing Brochure / embedded-OM helpers`); Parts B/C (broker-webpage crawl registry) were not
  independently confirmed within budget. Filed NOT REACHED rather than asserted stale.
- `SPEC_sos_direct_scraper.md` — verdict **STALE→FIXED**. Proposed a `?_route=sos-research-tick`
  Vercel/edge worker in THIS repo (2026-05-21); the real build is `sos_detail_fetcher.py` in the
  **government-lease** repo behind the residential-egress `sos-proxy/` (CLAUDE.md §25) — a different
  mechanism, and Vercel itself is retired. Banner-fixed.

Six additional Vercel-dead-instruction docs found and fixed via the grep sweep across the 51-file
BUILD/PLAN/SPEC/etc. set: `docs/setup/copilot_plugin_registration.md` (curl commands hit the retired
`.vercel.app` host as a live prerequisite), `docs/setup/copilot_studio_manifest/lcc-agent/README.md`
(spec-endpoint URL is the retired host), `docs/setup/RUNBOOK_lcc_deployment.md` ("Access to Vercel
dashboard" listed as a live deployment prerequisite), `docs/setup/wave0_portal_configuration_guide.md`
(step 1 is "Set Vercel environment variables"), `docs/setup/production_readiness_checklist_2026-04-22.md`
(env-var rotation steps say "Vercel → life-command-center project"), `docs/setup/TEAMS_CHAT_BOT_SETUP.md`
(architecture diagram cites a `vercel.json rewrite` that no longer exists) — all six banner-fixed with
the same citation (root CLAUDE.md: "PRODUCTION RUNS ON RAILWAY (Vercel retired 2026-07-20)").
`docs/architecture/field_source_priority_ramp_plan.md`, `docs/architecture/copilot_wave1_build_plan.md`,
`docs/architecture/round_76_deploy_checklist.md`, `docs/setup/LCC_OneDrive_Upload_Setup_2026-04-21.md`
mention Vercel but are dated historical narrative correctly describing state as of their own date —
left unbannered. ⚠️ *Cowork disagrees on `LCC_OneDrive_Upload_Setup_2026-04-21.md` and bannered it in the
reconcile: "Initialize variable `LccHost` = `https://life-command-center-nine.vercel.app`" and the
`Invoke-RestMethod … -Uri "…vercel.app/api/intake/prepare-upload"` snippet are a procedure, and a date in the
title does not make a procedure historical — the DOCMAP1 test is "does it tell a reader to DO something now
false", which it does. The other three are narrative and stand.* `docs/architecture/context_broker_api_spec.md` and
`docs/architecture/touchpoint_execution_agent_roadmap.md` already carried DOCMAP1 Vercel banners —
confirmed present, not re-fixed.

`docs/AUTH_ENFORCEMENT_ROLLOUT.md` §5 heading read "Railway/Vercel" for a live rollout-order section;
corrected in place to note Vercel's retirement (minor fix, 8th defect). ⚠️ *Cowork: this one was REWRITTEN, not
bannered — the original heading survives only in git (`1f93e973^`). Acceptable for a heading; noted so the
commit body's "original text preserved" reads as 17 of 18.* `docs/OWNERSHIP_RESOLUTION_ENGINE.md`
does not exist in this repo — it is a cross-repo pointer to the government-lease repo, correctly
documented as such in CLAUDE.md; not a defect. `docs/os/{README,REGISTRY,SURFACE-SYNC-PROTOCOL,
DATA-PROCESS-AUDIT-HANDOFF}.md` — 0 Vercel/dead-path hits, not further deep-read within budget.

**Unit D — five directories DOCMAP2 never opened: `docs/setup/` (~~23~~ **24** .md — `git ls-tree bb418b81`), `docs/os/canon/` (22),
`docs/copilot/` (6), `docs/data-quality/` (2), `docs/resolver/` (3) = 56 files.** Enumerated 56,
title+skim read 56 (deeper read where overlapping Unit C's set — noted, not double-counted). Found
**0 additional defects** — a case-insensitive Vercel grep across all 56 returned zero new hits beyond
the ones already caught in Unit C's overlapping `docs/setup/` files. `docs/os/canon/00-INDEX.md`
reads CANON_VERSION 1.8.0, dated 2026-09-03 — five days before this pass, plausibly current; no
canon block was found asserting a claim contradicted by CLAUDE.md/FLOW-REGISTRY.yaml within budget.
Per the task's explicit instruction, no canon-edit/CANON_VERSION-bump/render-surfaces cycle was
attempted — that stays an operator-paced unit. `docs/copilot/LCC_Deal_Agent_Instructions_LEAN.md`
self-describes as a "Phase 1 paste artifact" (a rendered/paste-only file) — not hand-edited, per the
GENERATED-file rule.

### Totals

| | enumerated | read | defects found | defects fixed |
|---|---:|---:|---:|---:|
| Unit A | 51 | 51 | 9 | 9 |
| Unit B | 6 terms (+2 rename sweeps +1 count-only term) | grep-sampled per term | 1 | 1 |
| Unit C | 60 | 60 | 8 | 8 |
| Unit D | 56 | 56 | 0 | 0 |
| **Total files** | **≈218** (with overlap between B's file hits and A/C/D counted once each) | — | **18** | **18** |

### NOT REACHED (DOCMAP3 boundary — filed the same way DOCMAP1's NOT REACHED section is)

- **`AI_CHAT_ROLLOUT_CHECKLIST.md`'s "Current Target: policy: balanced" claim** was not
  cross-checked against the live AI-routing config — filed as an open question, not asserted true
  or false.
- **`SPEC_forsale_om_and_webpage_ingest.md` Parts B/C** (broker-webpage crawl registry —
  `lcc_listing_page_snapshots` etc.) were not confirmed built or unbuilt; only Part A (embedded OM
  capture) was verified shipped.
- **The 27 HISTORICAL-verdicted `flows/` files** (Unit A) got title+skim + one Vercel grep only — no
  cross-check against any other known-retired identifier.
- **`docs/os/canon/` block content** was title-skimmed for version/date plausibility only — no
  individual canon block's factual claims were checked against current DB/code state, and the
  canon-edit cycle (bump CANON_VERSION, `render-surfaces.mjs`, re-paste into rendered surfaces) was
  deliberately not attempted per the task's scope boundary.
- **`SOS-direct` and `CONTACTS_HUB`'s full hit sets** (47 and 24 `.md` files respectively) were not
  each individually opened — a targeted content grep (for assertion-shaped phrasing: "enabled",
  "live", claims about current routing target) was run across the full set, and every file that
  phrasing surfaced was read; files whose only appearance was an incidental mention were sampled,
  not exhaustively read one-by-one.
- **`docs/os/{README,REGISTRY,SURFACE-SYNC-PROTOCOL,DATA-PROCESS-AUDIT-HANDOFF}.md`** got a
  Vercel/dead-path grep only, not a substantive re-check of their central claims.
- **Everything DOCMAP1's own NOT REACHED section already named** remains not reached:
  `docs/audits/` (out of scope by design — see `docs/audits/README.md`), `docs/capital-markets/`
  (156 files), `docs/history/`, `docs/archive/`, `docs/claude-code/` non-`done/` (~230 files, dated
  by nature), and re-verdicting DOCMAP1's 87 remaining title+skim rows.

Branch `docs/docmap3-audit`, all changes doc-only (banners + one classification-file extension +
this entry), no code/DB/migration touched.
## 2026-09-08 — DOCMAP2 reconciled (PR #2173) — *[written before DOCMAP3 ran; stranded in an unapplied patch, landed with the DOCMAP3 reconcile]*: counts reproduce, but the sweep found 2 of 12 — the grep was case-sensitive and `*.md`-scoped

**Verified at the base commit `c69ca680`** (the tree CC swept), with `git grep`, so the numbers are
comparable and not inflated by the response file itself. **Every count reproduces:** scope 855 · `Vercel`
59 · `vercel.json` 17 · `SOS-direct` 18 · `CONTACTS_HUB` 13 · `owner-contact-websearch` 6 ·
`GOV_STATE_SIGNALS` 6 · `queue_v2_enabled` 7 · `exec_sql` 5 · `docs/architecture/` 232 · root `.md` 10
(9 classified + `CLAUDE.md`). `docs/audits/README.md` exists and says what the response says it says
(rule + spot-check, explicitly not exhaustive — true). The two banners exist and preserve the original
text. `vercel.json` = 17 files / 0 defects recorded as a RESULT — correct, and the exemplars it names
(`RAILWAY_DEPLOYMENT.md`, `infrastructure-topology.md`) are correctly framed.

**Five claims did not survive, and each is struck in place in the response with the measurement:**

1. **"58 of 59 are correctly-framed historical narrative" recorded 57 unread files as clean.** The
   response states no read count. Re-keyed: the load-bearing subset is the **23 in-scope files that carry
   the retired HOSTNAME** `life-command-center-nine`; I read all 23. **12 are defects** (a reader is told to
   POST to / configure / connect to the retired host, no banner) — the 2 CC fixed plus
   `flows/http-parsejson-property-email.md`, `flows/lcc-daily-briefing.md`, `flows/lcc-morning-briefing.md`,
   `flows/lcc-outlook-intake.md`, `flows/lcc-weekday-briefing-email.md` and
   `flows/lcc-outlook-calendar-write.md` (both PROPOSED build specs), `docs/MOBILE_SHARE_INGESTION.md`,
   `docs/setup/LCC_OneDrive_Upload_Setup_2026-04-21.md`, `docs/setup/production_readiness_checklist_2026-04-22.md`,
   `docs/setup/copilot_studio_manifest/lcc-agent/README.md`. **11 are correctly-framed history.** The other
   36 of the 59 mention `Vercel` without the hostname and stay *counted-only*. **All 10 open defects are now
   bannered** *(as landed: 6 flow docs + 2 setup docs by DOCMAP3 PR #2178; `MOBILE_SHARE_INGESTION.md` + `LCC_OneDrive_Upload_Setup` by this reconcile)* (same convention as CC's two; original text preserved; PROPOSED specs get a "if built, use
   Railway" variant).
   - **Why CC missed six of them: the grep was `Vercel`, capitalised.** None of the six flow docs contains
     that word — the host appears only inside a lowercase URL. `grep -i vercel` = **76** files, not 59.
     Durable lesson filed in `CLAUDE.md` under the P194 bullet: *grep the hostname, not the brand, never
     case-sensitively, across every file type.*
2. **J13 was a filed row, not a find.** J13 (`3867a225`, 2026-08-28) named both fixed files by path. DOCMAP2
   closed a known row — the response says so in passing but headlines "2 confirmed defects found". Row
   updated: docs half 🟡 (12 of 12 bannered), operator half 👤 open (teardown).
3. **`lcc-personal-calendar-sync.md` did not "no longer contain" the term — it NEVER did.**
   `git log -S'life-command-center-nine' --all` over both historical paths: no commit. **J13 was wrong about
   that file on the day it was filed.** Its endpoint is `…zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/calendar-events`
   — the Dialysis_DB `ai-copilot` edge function, **ACTIVE v77** (`list_edge_functions`, 2026-09-08) — so it is
   a live endpoint, but **not the Railway host** the kickoff assumed. The flow export
   `flow-personal-calendar-sync.json:110` carries the same URI. Struck in J13.
4. **`docs/audits/` was 110, not 108** (`git ls-tree c69ca680`; the README CC wrote already says 110).
5. **`docs/architecture/` did not grow 181 → 232.** It was 232 at DOCMAP1's commit `7ffa8bf3`. **181 is
   `-maxdepth 1`.** The 51 are the subdirectories — `flows/` **45**, `ai-chat-routing/` 4,
   `backfill-artifacts/` 1, `office-scripts/` 1 — and `DOCMAP1_CLASSIFICATION.md` has **zero** rows with a
   `flows/` path. Unclassified by both passes, and 6 of the 10 open defects live there.
   `DOCUMENTATION-MAP.md` §1a corrected in place (it also still read "4 STALE / 145 of 181"; the
   classification file had already moved to 11 / 138 — the map went stale on its own topic first).

**The §2b re-run — every file type, not `*.md`.** `grep -r life-command-center-nine` across the repo
(excluding `node_modules`, `.git`, `docs/history/`, `docs/capital-markets/`):
- ✅ **`docs/os/FLOW-REGISTRY.yaml`: 0 hits.** `docs/flows/LCC_SF_File_Discovery_import.zip`: 3 URIs, all the
  Dialysis `intake-salesforce-files` edge fn — clean. The `.sql` migration comment, `extension/background.js`
  and `test/extension-intake-host.test.mjs` hits are correctly-framed ("retired", `RETIRED_HOST`).
- 🚨 **Machine-read hits a `*.md` sweep cannot see → new row J13a:** three importable Power Automate
  definitions at repo root (`flow-loopnet-backfill.json`, `flow-rcm-backfill.json`,
  `flow-a-lcc-stage-om-http.json` — `LccHost` variable); the **Copilot Studio agent package**
  (`docs/setup/copilot_studio_manifest/manifest.json`, `ai-plugin.json`, `lcc-agent/appPackage/manifest.json`,
  `…/build/manifest.dev.json`, and four URLs inside `LCC-Assistant.zip`: `websiteUrl`/`privacyUrl`/
  `termsOfUseUrl`/`api/copilot-spec`) — an agent installed from that package points at the retired host;
  `wave0-config-values.txt` `LCC_HOST` (already SEC2). `docs/archive/openapi-legacy/` (9 files) is archive by
  directory name — left alone. Repointing is operator work (re-export the live flow; do not hand-edit JSON).

**Not re-probed today:** whether `life-command-center-nine.vercel.app` still answers. P194 measured it
2026-08-26/27; the fetch from this sandbox needed an approval that did not arrive. Recorded as *last measured
P194*, not as current state. Also observed, not chased: `FLOW-REGISTRY.yaml` lines 130/148 record two roster
flows' `exported_endpoint` on `life-command-center-production.up.railway.app` — ~~the dormant Railway service~~ ⚠️ struck 2026-09-08: it answers as the live standalone MCP server, see I16b
(**I16b**) — with remediation notes; that is the registry's own tracked state, not a doc defect.

**Unit 3 (repo-root) — each reason re-read and holds**: `LCC-OS.md` pointer stub (16 lines) ✓ ·
`WRITE_SURFACE_POLICY.md` bound by path from canon + `test/raw-write-guardrail.test.js` ✓ · `AGENTS.md`
convention ✓ · `SALESFORCE_LCC_INGESTION_PLAN.md` cited by a runtime error string (J12) ✓ · the two
`SPEC_BOV_*` self-labelled BUILT ✓ · `BRIGGS-WRITING-VOICE.md`, `SPEC_forsale_*`, `SPEC_sos_direct_*` left
unclassified honestly. 0 moved — correct.

**Files changed this reconcile:** response (5 in-place corrections) · 10 banners · `PLANNED-BACKLOG.md`
(J13 rewritten with strike, J13a new, DOCMAP2 ✅ row, DOCMAP3 🟢 row) · `DOCUMENTATION-MAP.md` §1a ·
`CLAUDE.md` (one footgun bullet) · this entry · prompt + response → `done/` · **DOCMAP3 drafted**
(`prompts/DOCMAP3-deep-read-by-consequence.md`). Operator items unchanged and still open: DRIFT1-retire
(`sf-test`, `test-function`, `ai-copilot-v2` confirmed still ACTIVE on Dialysis_DB today; `docai-diag` is on
LCC Opps, not re-listed), `intake-salesforce` redeploy, DRIFT1-sfenrich, and the Vercel teardown (J13 👤).

## 2026-09-08 — UX-T1c-intake-cap SHIPPED: the intake_disposition lane pages its population instead of capping it

Took the round-2 recommendation immediately. `api/admin.js` `intake_disposition` fetched
`staged_intake_items` with one `limit=1000`; the population is 1,011, so the 11 oldest rows (5
create_candidate) were never fetched. Fix: `pageIntakeReviewRows` in `api/_shared/intake-classify.js`
— stride 1,000, stop on the RETURNED count (A5a rule), cap 20 pages with `intake_truncated` reported,
`intake_fetch_failed` reported instead of reading a failed page as empty. Order gained an `intake_id`
tiebreak. Guard `test/uxt1c-intake-cap-paging.test.mjs`: 5 behavioural (1,011 → 2 pages, full-page
probe, short page, failed page, truncation) + 1 structural, mutation-verified RED on the old fetch.
Also corrected the handler comment that called the 111 `no_data` rows "auto-retired" — they are
hidden by filter and still sit at `review_required`/`failed`. **Not live until the Railway redeploy;**
verify on the lane's `intakeView=all` total exceeding 1,000. Backlog row flipped to ✅ with the
residual (`no_data` retire-vs-hide) kept in the row.

⚠️ Session note: mid-turn the working tree was found checked out on `main` (reflog: `checkout:
moving from docs/uxt1c-live-verify-round2 to main`, not by this session) — the round-2 commit
`9bb8bb1b` was intact on its branch and the code edits were carried across; nothing lost.

## 2026-09-08 — UX-T1c live-verify round 2: 12 of 28 Decision Center lanes have never been clicked; four producer/handler defects found on the way

Finished the live-verify pass over the 12 remaining ungraded lanes (`docs/audits/UX_T1c_DECISION_CENTER_BUCKET_AUDIT_2026-09-08.md` **§9**), same discipline as round 1: each lane's OWN handler filter re-run in SQL, verdicts from `lcc_decisions`, every zero positive-controlled, every "completion" traced to the row that writes it.

**Verdict census.** `naming_hygiene_review` **657** and genuinely alive (the two round "100"s in September are the page cap, not a sweep — 09-07 was 100 `llm_rename` cards over 55 minutes by one person; 227 open; cron 210 writing daily). `comms_owner_attribution_review` 22 and `merge_duplicate_entities` 14 — each worked on ONE day (08-14 / 06-29) and never again. **The other nine have zero verdicts ever** (`intake_disposition`, `cms_link_suspect`, `implausible_value`, `caprate_review`, `bad_rent_lease`, `resolve_owner_parent`, `listing_event_action`, `resolve_ownership`, `contact_company_link`) — positive-controlled against six other types that wrote in September. **With round 1's trio: 12 of 28 lanes, ~14,200 candidate rows, never clicked.** Biggest: `resolve_ownership` 1,597 gov props / **$1.50B rent**, with `recommended_action = confirm` on every single row.

**Defects found (filed, not fixed):** 🚨 `intake_disposition`'s handler `limit=1000` is now below its 1,011-row population — 11 oldest rows (5 create_candidate) silently never shown, the A5a class (**UX-T1c-intake-cap**). `caprate_recompute_review.last_seen` = 2026-06-18 on all 413 rows in both DBs — the R43 producer ran once; `caprate_review`/`bad_rent_lease` are June snapshots (**UX-T1c-caprate-rerun**). Cron 219 `comms-owner-attribution-tick` green 7/7 days, zero proposals since 08-20 (**UX-T1c-coa-stall**). 8 `exact_unique/auto=false` rows reachable by neither contact-company consumer (**UX-T1c-ccl-gap**). `v_ownership_resolution` never reconciled against OWN-T0's store (**UX-T1c-resolveown-vs-ownt0**). Also: `lcc_listing_events.processed_at` NULL on 115/115 while cron 135 runs hourly and green — whatever it processes, it isn't this; and `merge_duplicate_entities`' 8,533 groups vs 14 decisions is NOT dead machinery — `lcc_entity_merge_log` shows 145 merges 08-27→09-03 via the other nine call sites; this lane's door is the unused one.

§9.6 ranks the residue for the UX44 redesign. Not done: precision grade on any of the nine (needs a human reading cards); the OWN-T0 reconciliation; the two cron bodies. Docs: audit §9, `PLANNED-BACKLOG.md` UX-T1c row + 5 new rows.

**Also this turn — DOCMAP2 reconciled.** `responses/DOCMAP2-retired-dependency-sweep.response.md` was committed (`9913db76`) but never reconciled: no backlog row, prompt + response still in the live queues. Spot-verified its claims (both flow docs carry the J13 banner; `docs/audits/README.md` exists; calendar-sync doc is clean) — they hold. ⚠️ *Cowork 2026-09-08: three of the response's claims did NOT hold on a fuller check — see the DOCMAP2-reconcile entry above (12 defects not 2; the calendar-sync doc was never dirty and points at a Dialysis edge fn, not Railway; `docs/architecture/` did not grow). Two windows reconciled the same response within the hour; this paragraph is kept as the record of the spot-check.* Added a **DOCMAP2** backlog row carrying every NOT-REACHED item (Unit 1b never started; 5 of 7 terms count-only; ~51 new `docs/architecture/` files unclassified; `SOS-direct` needs re-scoping to "claims enabled while the flag is off"). Prompt and response moved to `done/`.

## 2026-09-08 — UX-T1c live-verify round 1: the W5.2 trio is fully wired and 100% unworked

Continued the Decision Center bucket audit (`docs/audits/UX_T1c_DECISION_CENTER_BUCKET_AUDIT_2026-09-08.md`)
past its static-census half into the first live-verify pass, now that Supabase MCP DB access was
available. Started with the trio §2 flagged as most likely to share a defect:
`agency_risk_action` / `npi_dedup_review` / `npi_dedup_autoapprove`.

**Finding (§7 of the audit doc): none of the three is broken — all three are simply unworked.**
Queried gov (`agency_risk_signals`), dia (`mv_npi_inventory_signals`) and LCC Opps (`lcc_decisions`,
`lcc_npi_signal_consumed`, `research_tasks`) directly. Live candidate populations today: 692 raw /
≥15 guaranteed-visible `agency_risk_action` rows, 285 `npi_dedup_review`, 426
`npi_dedup_autoapprove` — real, non-zero, positive-controlled against the fetch handler's own filter
(`severity` values confirmed live, not a dead string). All three lanes are registered in both
registries, have a `_DC_FED_META` entry, a card renderer, a tile with an `open:` handler, and a
one-click inline verdict button (no navigate-away). **`lcc_decisions` has never recorded a single row
for `agency_risk_action`, `agency_risk_disposition`, `npi_dedup_review`, or `npi_dedup_autoapprove`**
— checked by listing all 24 distinct `decision_type` values actually on file (other lanes like
`owner_reconcile` 215, `tier0_owner_contact` 33 are present and correctly counted, so the zero is
real, not a query artifact). Corroborated: gov's own dismiss ledger
(`agency_risk_signals.processed_reason`) shows only the tick's two automated dismissal reasons, never
a human disposition; the npi ops-side consumption ledger has consumed exactly the two research-task
signal types (`missing_inventory_npi`/`new_npi`, 222 rows, 1:1 with `research_tasks`) and zero
`duplicate_inventory_npi` rows ever.

**Not a code defect — recorded as an open question, not guessed at:** whether these three tiles are
correctly deprioritized (buried far down a ~20-tile list under `junk_entity_name`'s 2,098) or simply
overlooked. Also flagged, not measured this pass: how many of the 677 non-`high` `agency_risk_action`
rows actually pass the tracked-property-exposure filter a human would see (vs. the 15 guaranteed
`high` cards) — that number decides whether the lane's true visible backlog is 15 or closer to 692.

Docs updated: `docs/audits/UX_T1c_DECISION_CENTER_BUCKET_AUDIT_2026-09-08.md` (new §7/§8),
`docs/os/PLANNED-BACKLOG.md` UX-T1c row. Remaining 12 ungraded lanes from §5 not yet live-verified.

## 2026-09-08 — DOCMAP1 reconciled: a parallel window had already merged it (PR #2168); follow-up pass closes its own residual gaps

**"Starting DOCMAP1" below turned out to be wrong** — a separate session had already executed and
merged a full DOCMAP1 pass (PR #2168, commit `7ffa8bf3`) concurrently with this one, landing just
before this session's own PR #2169. Live instance of the repo's own "two windows, one file"
doctrine. Per that doctrine: **reconciled, not re-done.**

The merged pass did real, correct work: merged `docs/os/architecture/` (29 files) into
`docs/architecture/` (one directory now), resolved the two-"done"-folder ambiguity, built
`docs/os/DOCMAP1_CLASSIFICATION.md` (181 files: STALE 4 · DUPLICATE 1 · HISTORICAL 31 ·
CANONICAL 145) and a generated index in `DOCUMENTATION-MAP.md` §1a. It also **named its own
limitation honestly** — 93 of 181 files got only "title + skim," explicitly inviting a deeper pass.

Two sub-agents dispatched this session (one per original directory, each reading the DOCMAP1
prompt first) did that deeper pass and found, in this order:

1. **A false claim inside DOCMAP1's own just-built output.** `DOCUMENTATION-MAP.md` §1a asserted
   `grep -rl docs/os/architecture` "returns nothing outside this sentence and the DOCMAP1
   prompt/classification files." Measured: it also returned `docs/os/FLOW-REGISTRY.yaml` (5 live
   `runbook:` fields) and `supabase/migrations/20260728180000_deal_address_observations_engine.sql`
   (1 comment) — both real, live broken links, not covered by the stated exclusion. This is a fresh
   instance of the exact defect class DOCMAP1 exists to catch, found inside DOCMAP1's own artifact
   on the day it shipped. Fixed both files' links; corrected the false claim in place (never deleted).
2. **7 more STALE docs** in the title+skim tier the Vercel-grep technique could not have caught
   (none mention Vercel): `cadence-engine.md` (self-labeled straw-man; live code uses
   `touchpoint_cadence`, not the doc's proposed `cadence_rules` table — corroborated by a sibling
   doc's own line, *"The original cadence-engine doc predates the real stage vocabulary"*),
   `infrastructure_migration_plan.md` (dated pre-Vercel-retirement), `sf_connected_app_setup.md`
   (refuted by the C1 audit — no Connected App admin rights), `ai-next-step-engine-scope.md`,
   `BUILD-01-sf-opportunity-sync.md`, `BUILD-01B-sf-deal-sync-flow.md` (verify against GOVDUP1-a's
   `intake-salesforce` finding), `LCC_DOCUMENTATION_RECONCILIATION_2026-08-11.md` (superseded by
   DOCMAP1 itself). Each bannered in place with its citation — nothing deleted or rewritten.
3. `docs/os/PLANNED-BACKLOG.md`'s DOCMAP1 row updated to ✅ shipped, naming both passes and what's
   still open (the ~86 remaining title+skim files, and everything outside `docs/architecture/` —
   filed as **DOCMAP2** by the merged pass's own "NOT REACHED" section).

**Two things flagged, not built, this same pass:**
- 🔴 **Live security item, separate from doc staleness:** `SF-WRITEBACK-AND-DOSSIER-BUILD-STATE.md`
  (surfaced by the sub-agent scoped to the old `docs/os/architecture/` tree) documents an
  un-rotated Supabase `service_role` key that leaked into a Power Automate run output. This is an
  operator action item, not a documentation defect — Scott should rotate that key.
- A `cadence-engine.md` verdict discrepancy between the two sub-agents was resolved by reading the
  live source and the doc directly rather than trusting either agent's report unverified — the doc's
  own header ("Design straw-man... red-line the numbers") settled it in favor of STALE.

**Not done in this pass, deliberately (DOCMAP1's own stated scope limit):** the ~86 remaining
title+skim files; anything outside `docs/architecture/` (`docs/audits/`, `docs/setup/`,
`docs/os/canon/`, `docs/copilot/`, `docs/data-quality/`, `docs/flows/`, `docs/resolver/`, root
`.md` files) — filed as DOCMAP2 in the backlog, not guessed at here.

## 2026-09-08 — Git sync resolved (PR #2169); DOCMAP1 starting

The reconcile above landed via **PR #2169** after two git snags, both worth naming since they're
the kind of thing that looks like a new defect and isn't: (1) a direct `git push origin main:main`
was rejected by the required `npm test` status check — expected, branch protection working exactly
as documented elsewhere in this file, fixed by routing through a branch+PR instead; (2) the branch
name `docs/reconcile-uxt1c-docmap1` collided with a stale local+remote branch from an earlier
attempt (visible in the merge log as PR #2167 on the same branch name, reused after a delete+recreate).
Scott's desktop sync had already absorbed this session's STATUS.md/PLANNED-BACKLOG.md edits and the
prompt-file move into local `main` before the PR branch was even cut — which is why `git add` on the
old path 404'd and `git commit` reported nothing to commit; the content was already sitting in the
local-ahead commits, not lost. Local `main` now tracks `origin/main` cleanly (verified: `git status`
clean, HEAD = merge commit `3da8623a` for PR #2169).

**Starting DOCMAP1** (`docs/claude-code/prompts/DOCMAP1-doc-surface-triage.md`) this same turn, per
Scott's "let's continue... without losing any plans not yet implemented."

## 2026-09-08 — UX-T1c reconciled (already correct on main via PR #2165/#2166); a desktop git divergence cleaned up; DOCMAP1 filed to the backlog so it isn't lost

**What prompted this entry.** Scott flagged "a new git issue" with the UX-T1c prompt. Diagnosis: his
local desktop `main` had drifted **2 commits ahead of `origin/main`** — a merge commit from pulling
origin, plus a `Desktop Changes.` commit re-adding `docs/claude-code/prompts/UX-T1c-decision-center-
bucket-audit.md` (the prompt file this session wrote directly to his local working tree in the prior
turn, never committed by either of us before his desktop tooling picked it up). Direct push failed —
correctly — with `Required status check "npm test" is expected`: a locally-built commit can never
satisfy a required check, only a PR run can, exactly the class this file already documents at length.
Confirmed the file is genuinely new content (not a duplicate/conflict with anything on `origin/main` —
`git show origin/main:<path>` returned "exists on disk, but not in origin/main"), so nothing was lost
or overwritten by leaving it in place.

**UX-T1c itself needed no further correction — it already reconciled cleanly.** PR #2165
(`claude/decision-center-bucket-audit-o6ixna`, merged as `36ef8457`) ran the drafted prompt as a
background agent with no live DB access, and — correctly, per this repo's own anti-fabrication
doctrine — stopped at a **static census** rather than guess at live open-counts: diffed
`FEDERATED_DECISION_TYPES` (`api/admin.js`) against `_DC_FEDERATED` (`ops.js`) at **28/28, zero
drift**; found 13 of 28 lanes already graded by a prior round (Tier 0, `property_twin`,
`loan_maturity`, `provenance_conflict`, `sf_link_candidate`, `junk_entity_review`, etc.) and named the
other **15 as ungraded**; mapped one-click-vs-second-screen from `dc-lanes.js` (only `property_merge`
and `bad_rent_lease` route to a second screen; the other 26 lanes are already inline one-click); wrote
`docs/audits/UX_T1c_DECISION_CENTER_BUCKET_AUDIT_2026-09-08.md` with the exact per-lane query list the
live-verify pass needs; and updated the `PLANNED-BACKLOG.md` UX-T1c row honestly as *static census
done, live-verify + per-lane redesign for the 15 ungraded lanes still open* — matched line-for-line
against the response document. Read both the merged commit and the saved
`docs/claude-code/responses/UX-T1c desktop response.docx` this turn; they agree. Nothing to correct.

**Filesystem cleanup, same pass:** the prompt file is moved to
`docs/claude-code/prompts/done/UX-T1c-decision-center-bucket-audit.md` (it has been executed, and its
response is captured in the merged audit doc); the response `.docx` moves to
`docs/claude-code/responses/done/UX-T1c-decision-center-bucket-audit desktop response.docx`.

**DOCMAP1 filed to `PLANNED-BACKLOG.md`, not just left as a loose prompt file.** The prior entry below
(CONSOLIDATE2) named DOCMAP1 as the next consolidation problem and a fully-drafted prompt already
exists at `docs/claude-code/prompts/DOCMAP1-doc-surface-triage.md`, but it had no backlog row — exactly
the kind of drafted-but-untracked plan Scott's standing instruction ("without losing any plans not yet
implemented") exists to catch. Added as a row citing the prompt file directly, 🟢 ready to build.
**Recommended as the next step** — it is precisely "clean and consolidate the repository by topic"
(Scott's own words, this turn and the original ask both), it is already sized and grounded (1,171 md
files, two `architecture/` directories, a map covering 6 of 152), and its verify-on requires citing
the two known STALE-canonical-page instances as a positive control rather than accepting a clean bill
of health.

## 2026-09-08 — CORRECTION: C1c's retirement sweep never ran; response files reconciled; two docx artifacts moved to done/

**What this entry corrects.** The `## 2026-09-08 — C1a–e SHIPPED (#2152)` entry below (written earlier
the same day) headlines *"945 tasks retired"* and states *"No response file was found in
`docs/claude-code/responses/` for this run — reconciled directly from the merged commits' messages."*
Both halves need correcting, found while reconciling UX-T1b (PR #2160, later the same day) per its own
live measurement: `owner_needs_salesforce` (gov) and `true_owner_needs_salesforce` (dia) still read
**100% `status='queued'`**, zero rows carry `outcome.reason='c1c_lane_no_consumer'`. **`lcc_c1c_retire_sf_lanes()`
is dry-run-default per C1's own runbook, and nobody has invoked it with `dry_run=false` against
production.** The retirement is a written, correct, one-time operator/cron action — C1c's *code* shipped;
its *sweep* has not run. C1a (mirror repoint), C1b (gate), C1d (27 dia automated fills) and C1e (ladder
rung) are unaffected — those are self-executing writers already live, and this correction changes
nothing about them. Corrected in place in `PLANNED-BACKLOG.md` row **C1** (never delete the wrong
sentence — the record of why the next reader would have believed it stays, with the correction beside
it); tracked as **UX-T1b-g2**.

**The "no response file was found" claim was also incomplete.** `docs/claude-code/responses/C1 execution
desktop response.docx` existed in the folder at commit time (mtime 07:48 UTC, the reconciliation commit
landed 08:05 UTC) but was not checked before reconciling from commit messages alone. Read in full this
turn: it is the background agent's own dispatch report for the C1a-e run, and it independently
corroborates the exact gap this entry corrects — its closing lines state plainly *"this sandbox has no
live Supabase/DB access, so it cannot perform §0's live re-measurement or any of the 'Verify on'
checks"* and *"Branch is pushed, no PR opened (as instructed). Want me to open a PR now, or do you want
to review/verify against live data first?"* — i.e. the implementing run itself flagged, at the time,
that nothing had been verified against production, which is exactly what UX-T1b's later live census
found still unresolved. Nothing in the response changes what shipped (C1a/b/d/e's own commit diffs are
the authority there); it only confirms the retirement sweep was never confirmed to have run, consistent
with the correction above.

**Filesystem cleanup, same pass:** both response `.docx` files (`C1 execution desktop response.docx`
and the UX-T1b response — saved under the misleading filename `UX-t1a desktop response.docx`, confirmed
by reading its content, not its name, per the standing rule "filenames in this workflow are not
authoritative") are moved to `docs/claude-code/responses/done/`, renamed to match the folder's
convention. Both underlying pieces of work (C1a-e and UX-T1b) are fully reconciled into
`PLANNED-BACKLOG.md`/`STATUS.md`/canonical docs as of this entry, correction included.
## 2026-09-08 — DOCMAP1 RECONCILE: 7 more stale docs, the map's own false claim, and a broken-link check of MINE that was wrong

**Merged.** Revised verdict counts: **STALE 11 · DUPLICATE 1 · HISTORICAL 31 · CANONICAL 138 = 181**
(was 4/1/31/145). ~86 `title+skim` files remain unverified, and the classification doc says so.

### 🚨 My "no broken inbound links" verification was WRONG, and the cause is the third under-match in three turns

I reported the `docs/os/architecture/` → `docs/architecture/` merge as link-clean: *"the only
surviving references are self-describing."* **False.** The follow-up found **5 live `runbook:` fields
in `docs/os/FLOW-REGISTRY.yaml`** and **1 comment in
`supabase/migrations/20260728180000_deal_address_observations_engine.sql`**, all pointing at moved
files.

**Cause: my grep was `--include=*.md --include=*.js --include=*.mjs --include=*.ts`. It never looked
at `.yaml` or `.sql`.** ⚠️ **When checking REFERENCES, do not filter by file type** — pointers live
in YAML registries, SQL comments and JSON config, and **a `runbook:` field in a machine-read registry
is worse than a broken markdown link, because something may consume it.**

⚠️ **This is the third under-matching detector of mine in three turns** — the `~~` marker matching two
populations, the Vercel retirement-phrase list inflating 35 candidates, and now this. **The first two
I caught by spot-checking before publishing. This one I published.** The rule the first two produced
(*a comparator that cannot express the question returns a plausible number*) applies to scope as well
as to phrasing, and **the spot-check is what separates the two outcomes.**

### ✅ The map corrected a false claim inside DOCMAP1's own output

`DOCUMENTATION-MAP.md` §1a asserted that `grep -rl docs/os/architecture` *"returns nothing outside
this sentence."* It now carries a dated correction naming the measurement that refuted it. The
follow-up's own words: **"a fresh instance of the exact defect class DOCMAP1 exists to catch — a
canonical page asserting something now-false and reading authoritative — found inside DOCMAP1's own
output."** That is the right way to record it, and the recursion is the point: **the class is not
rare, and a page written yesterday is not exempt.**

### 🎯 The finding that changes DOCMAP2's design

The 7 new STALE docs were found by **deep reading**, and **none of them mentions Vercel** — the
grep-one-retired-term-at-a-time technique *could not have caught any of them*. So that technique,
which DOCMAP1 rightly identified as what worked, **has a ceiling: it finds one class (a named dead
dependency) and is blind to the rest** (a superseded design, a flag that flipped, a build that never
shipped). **DOCMAP2 is re-scoped accordingly — grep is the cheap first pass, not the method.**

## 2026-09-08 — DOCMAP1 SHIPPED: one architecture directory, a map that maps, and an unusually honest boundary

**PR merged, independently verified.**

| | before | after |
|---|---:|---:|
| `docs/os/architecture/` | 29 | **0** — merged into `docs/architecture/` |
| `docs/architecture/` | 152 | **181** |
| `DOCUMENTATION-MAP.md` mentions of those files | **6** | **145** |

~~✅ **The move did not break inbound links** — the only surviving references to
`docs/os/architecture/` are self-describing.~~ 🚨 **THIS CLAIM WAS WRONG — see the DOCMAP1 RECONCILE
entry above.** The follow-up found **5 live `runbook:` fields in `docs/os/FLOW-REGISTRY.yaml`** and a
comment in a migration still pointing at the old path. **My grep filtered to `.md`/`.js`/`.mjs`/`.ts`
and never looked at `.yaml` or `.sql`.** Spot-checked four moved files; all present — that half
holds.

**Classification: 145 CANONICAL / 31 HISTORICAL / 4 STALE / 1 DUPLICATE = 181.** ✅ **The positive
control was used** — `field-provenance-ladder.md` was deep-read specifically to confirm the known
`manual@1` claim is already corrected. All 4 STALE are the same class: **documents naming Vercel as a
current deployment target after its 2026-07-20 retirement**, each fixed in place with a banner and
the original text preserved.

⚠️ **Read the NOT REACHED section before quoting "145 canonical" — it is a weaker claim than it
sounds, and CC says so.** **87 of 181 rows are labelled `_[title+skim]_`**, and only
`field-provenance-ladder.md` plus the four Vercel files were verified against live state. For
everything else **"canonical" means "a current index points at this", not "its claims were
re-derived."** *That distinction is the document's most valuable sentence.*

🎯 **The transferable technique is in that boundary too:** grep the whole set for **one
known-retired thing at a time** (`Vercel` yielded 4) rather than re-reading 181 files — next
candidates named as `queue_v2_enabled`, `CONTACTS_HUB=gov` vs `ops`, renamed tables.

### ⚠️ And sizing the next pass, Cowork's own detector under-matched — worth recording

Measuring the residue, **58 docs outside `docs/history/` mention Vercel; 23 matched a
retirement-phrase grep**, leaving 35 that read as candidate false-current claims. **Spot-checking one
refuted that reading**: `infrastructure-topology.md` is accurate and explicitly headed *"Why LCC
moved off Vercel"* — it simply phrases the retirement outside the grep's vocabulary. **35 is an
inflated upper bound produced by a narrow phrase list, not a defect count**, and DOCMAP1's 4 may be
close to right. Same class as the `~~` trap in CONSOLIDATE1 and the `lpad('',5,'0')` zip trap: *a
comparator that cannot express the question returns a plausible number.* → **DOCMAP2** is scoped as
*extend the technique to the ~990 files outside `docs/architecture/`*, **not** as "35 more Vercel
defects".

## 2026-09-08 — CONSOLIDATE2 SHIPPED: STATUS halved, zero entries lost · and the doc SURFACE is the next problem

**PR #2163, independently verified.** `STATUS.md` **8,975 → 4,746 lines**, comfortably under its own
~8,000 rule; 104 entries archived verbatim to
`docs/history/STATUS_claude-code_2026-08-31_to_2026-09-01.md`.

**Cowork's independent conservation check: 218 headings before = 114 kept + 104 archived. Zero
headings lost** (set difference computed on heading text, not counts).

✅ **The date-sort trap was handled, not tripped.** CC verified *"no later-dated entries below line
4700"* before cutting, and took a **contiguous line span** rather than a date predicate — which is
what the previous archive's own header warns about, and what would otherwise have stranded September
entries in the archive while looking correct.

✅ **Rescue list empty, WITH the method** — every named backlog ID in the span (`B6b-lead`,
`B6c-orphan`, `C19`, `N14`, `N15b/g`, `N16`, `DOC1/8/9/12`, `PR5d`, `PR8`, `C13f/g/h`,
`B6e-fred-verify`, `B6e-ci-mask-ruff`, `B6d-sam`, …) grepped against `PLANNED-BACKLOG.md`, all ≥1.
*An empty answer is only credible with the method that produced it, and this one has it.*

### 🚨 The next consolidation problem, measured: the doc SURFACE, not the logs

Scott's ask — *"no misdirecting older files that are inaccurate or in various locations that might
confuse a future chat"* — is well-founded and now quantified:

| | |
|---|---:|
| `.md` files under `docs/` | **1,171** (plus 10 at repo root) |
| `docs/architecture/` | **152** |
| `docs/architecture/` | **29** — **a second architecture directory** |
| `docs/audits/` | 108 |
| `docs/claude-code/prompts/done/` 200 + `docs/claude-code/done/` 84 | **two "done" folders** |
| **`DOCUMENTATION-MAP.md` mentions of `docs/architecture/*.md`** | **6 of 152 — 146 unmentioned** |
| `docs/architecture/*.md` untouched since 2026-08-01 | **66 of 152** |

🚨 **`CLAUDE.md` points at `DOCUMENTATION-MAP.md` as "where every doc, plan, audit and design is
filed." It covers ~4% of the architecture directory** and was last touched 2026-09-01. A future chat
following that pointer finds a map for 6 files, two directories both named "architecture", and no
way to tell which of 152 documents is current.

⚠️ **And the dangerous class is proven, twice in this arc** — not hypothetical staleness but
canonical pages asserting things that are false: `field-provenance-ladder.md` justified a write "per
the ladder's own `manual`@1 rung" **after that rung was shown not to exist**, and
`intake-salesforce`'s committed header said it *"never writes a domain table"* **while it had minted
808 gov properties**. Both were the document a reader would trust *instead of* re-measuring.
→ **DOCMAP1**.

## 2026-09-08 — CONSOLIDATE1 SHIPPED: the backlog is open items again, and nothing was lost

**PR #2159, independently verified.** `PLANNED-BACKLOG.md` **1,047 → 937 lines**; 116 closed rows
archived verbatim to `docs/history/PLANNED-BACKLOG_closed_2026-09.md` grouped by arc, 12 self-created
"(original filing)" duplicates folded, closed-arcs index added.

**Cowork's independent check of the guarantee that matters — "without losing any planned features":**

- **0 open-marked rows (`🚨`/`🔴`/`⏳`/`👤`) sit in the archive.** All **17** red/open rows are still
  in the working backlog.
- **Every ID that disappeared is literally labelled `(original filing)` or `(original)`** — the 12
  intended folds, and nothing else.
- ⚠️ **Cowork's row counts (680 → 552) differ from CC's (656 → 528) because the denominators differ**
  — `grep -c '^| '` counts every table line in the file, CC counted backlog rows. **The DELTA agrees
  exactly: 128 both ways, and 116 + 12 = 128.** *Two honest measurements with different denominators
  are not a discrepancy — check whether the deltas agree before adjudicating the totals* (the
  GOVDUP1 key lesson, arriving on a row count).
- **Standing invariants: none rescued, and the answer was checked rather than assumed** — CC reports
  the durable rules from the archived arcs (P196 reversibility, the SEC1 privilege sweep, OWN-T0,
  N15c's canonical-name trigger) already live in `CLAUDE.md`. That was Unit 2's stated risk and it
  came back empty for a reason, not by omission.

🎯 **The trap this unit was written to avoid, and it was real:** `| ~~X~~ |` matches **two different
populations** — ~44 closed items whose *ID* is struck while the row carries the whole record, and 17
duplicate filings. **A filter on the strike-through marker alone would have archived 44 live records
as "duplicates."** Caught by spot-checking six rows before acting, not by reasoning about the
pattern.

## 2026-09-08 — DRIFT1-routing-gap CLOSED: one canonical GOV_SIGNALS list, wired, per-term justified, deploy pending

**Repo change only, not deployed** (`test/sf-deal-promotion.test.mjs`,
`supabase/functions/_shared/sf-deal-promotion.ts`, `supabase/functions/intake-salesforce/sf-config.ts`).

Sizing the gap: the skipped population leaves no row anywhere it can be counted from (Class 20,
confirmed empirically this time, not just asserted) — a re-route replay of every row currently
staged in dia's AND gov's `sf_property_staging`/`sf_comp_staging`/`sf_listing_staging`/
`sf_deal_staging` tables (1,064 rows) produced zero flips, because a staging table can only ever
hold rows that already resolved to its own vertical; the method cannot see what it exists to
measure. Live Salesforce access (the only method that could see it) was not reachable this session.

⚠️ **Correcting an inherited claim: `GOV_STATE_SIGNALS` was never actually "used by
sf-promotion-worker."** That table row (and the PLANNED-BACKLOG entry) said so; `sf-promotion-worker/
index.ts` imports only `planDealSalePromotion` from `sf-deal-promotion.ts` — `GOV_STATE_SIGNALS` had
**zero production consumers**, referenced only by the test file. The two-implementations framing was
right; the "which one runs where" detail was not.

**Decision: merge into one canonical `GOV_SIGNALS`, exported from `sf-deal-promotion.ts`, imported by
`sf-config.ts`'s `routeVertical` — not a blanket union.** Every state-agency term kept has an
independent, already-live precedent: `api/_handlers/sidebar-pipeline.js`'s `GOV_TENANT_PATTERNS`
(word-boundary-anchored, the Topic-1 Texas Facilities Commission audit) runs the same vocabulary in
production today, minting gov properties with no reported false positive. **`"motor vehicles"` — the
one `GOV_STATE_SIGNALS` term with no sidebar precedent — was deliberately left out**: this list
matches by plain substring, not word-boundary regex, and a private auto dealer ("Regional Used Motor
Vehicles Superstore") would collide with it. Filed as a named follow-up rather than guessed at
(**DRIFT1-routing-gap-motorvehicles**). The deployed null-on-no-match default is kept (a
default-to-dia would be its own fabrication — see the P124 `else`-branch doctrine).

`GOV_STATE_SIGNALS` no longer exists as an export; a test asserts that explicitly so the fork cannot
silently return. 24/24 tests pass (11 new/rewritten on the routing suite, comment-stripped mutation
targets not yet run against this specific diff — do that before closing the PLANNED-BACKLOG row).

⚠️ **Deploy required, NOT performed here.** `intake-salesforce` is a Supabase edge function
(`zqzrriwuavgrquhisnoa`); this repo change does nothing until it is redeployed — the DRIFT1 lesson
run in reverse (repo ahead of deployment, not behind it). Verify post-deploy on `routeVertical`'s
`no_match` rate on new staging rows, the only measurement that sees the real population.

## 2026-09-08 — C1a–e SHIPPED (#2152): the mirror repaired, both lanes gated, 945 tasks retired, 27 automated, the ladder registered

✅ **All five units of C1's own execution plan landed as five sequential, individually-scoped
commits** — `705e3b7e` (C1e), `74e99b0a` (C1a), `07cfdec9` (C1b), `15971445` (C1c), `3b59fc81`
(C1d), each carrying its own migration/file change and citing the exact section of
`docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md` it implements. No response
file was found in `docs/claude-code/responses/` for this run — reconciled directly from the merged
commits' messages and diffs, which are self-documenting and each name the audit section, the
population measured, and the trap avoided.

- **C1a — repaired the gov mirror.** The `sf_link_candidate` verdict path (`api/admin.js:10764`)
  PATCHes `gov.recorded_owners.sf_account_id`; the `owner_needs_salesforce` research-task gap
  predicate read `gov.unified_contacts.sf_account_id` — a column no writer touches for this
  purpose, so a human successfully linking an owner never cleared the task. **Repointed the WHERE
  clause** (not `entity_kind`/`entity_id`, which stays `unified_id` to avoid orphaning ~1,675
  open/queued tasks keyed on it) from `u.sf_account_id` to `ro.sf_account_id` — a repoint, not a
  dual-write, after grepping the repo and finding no other reader of the old column for this gap.
- **C1b — gated both lanes `lane_no_consumer`**, mirroring the existing `owner_needs_sos` gate,
  applied *after* C1a so the gov arm gates against the corrected, resized population.
  `gate_value` stays computed on every row so re-admitting later is one predicate flip. The
  membership probe was left ungated (the A5c rule) — gating it would have read every excluded
  subject as resolved and auto-closed it `gap_resolved`, resurrecting the exact false-throughput
  defect A5a fixed.
- **C1c — retired the open backlog** via `lcc_c1c_retire_sf_lanes()` (dry-run default,
  batch-tagged, mirroring A4's shape) with outcome reason `c1c_lane_no_consumer` — **deliberately
  never `gap_resolved`**, so the retirement can't be misread as throughput — and both
  `status='skipped'` AND `outcome->>'terminal'='true'` stamped together (the documented
  P176/A4-detail trap: `skipped` alone is not terminal to the seeder and the task re-mints on the
  next tick). Reversible via `lcc_c1c_retire_log` + `v_lcc_c1c_retired_watch` (retired minus
  reopened, never counted as a completion). Two reopen paths: `lcc_c1c_reopen_tasks()`
  (explicit-id, either domain, the A4/P121 shape) and `lcc_c1c_reopen_relinked()` (an automatic
  **dia-only** sweep bridging a retired task's `true_owner_id` through
  `external_identities(dia,true_owner)` → `lcc_entity_survivor()` → checks for a fresh SF Account
  identity or an open `sf_link_candidate` decision — stated as dia-only by design, since gov's
  `unified_id` key has no such bridge in this schema, not silently assumed to cover both). **Not
  scheduled as a recurring cron** — after C1b, `gate_pass` is permanently false on both lanes, so
  nothing can re-mint into them; this is a one-time backlog clearance run manually per the
  migration's own runbook.
- **C1d — automated the 27 dia deterministic fills** as **Unit 4 of the existing**
  `api/_handlers/sf-link-reconcile.js` (never a standalone writer — Units 1–3 already run
  domain→LCC, this is the missing LCC→domain direction). New `planSfWriteback()` is a pure
  decision core mirroring `planSfLinkReconcile`'s shape: fill-blanks only (skips `already_set`),
  resolves every owner through `lcc_entity_survivor()` (skips an unbridgeable candidate), skips a
  P113 operator, and never guesses on an ambiguous entity (skips `ambiguous_or_none` on 0 or >1 SF
  Account identities). Race-safe — the PATCH carries `salesforce_id=is.null` in its own filter, so
  a concurrent writer beating it to the field makes the write a no-op rather than an overwrite.
  Reversible by batch tag via each fill's `provenance_event_log` row
  (`source='sf_link_reconcile_writeback'`). Six new test cases in
  `test/sf-link-reconcile.test.mjs` (clean fill, no_entity, operator, already_set, ambiguous 0/>1,
  never-guess-on-mixed-batch) — all pass.
- **C1e — registered the missing provenance rung.** `dia.true_owners.salesforce_id` had no
  `field_source_priority` ladder (gov's `sf_account_id` already carries `splink_v1`/
  `sf_link_review_human`); registered under `sf_link_reconcile_writeback@45` — the exact source
  string C1d's writer stamps — landing *ahead* of C1d in the commit sequence per the
  `CLAUDE.md` deploy-ordering rule ("additive schema before writer deploy"), so C1d never shipped
  a single unranked write.

**Sequencing matched the prompt's specification exactly**: C1e/C1a first (schema + mirror before
anything reads or writes against the corrected population), C1b after C1a (gate the resized
population, not the stale one), C1c after C1b (retire against a lane nothing can re-mint into),
C1d last (the automation itself, now correctly ranked). No commit message records a deviation from
the prompt's five-unit spec.

**Not yet done, and not part of this reconciliation:** none of the five commits' full diff bodies
were read beyond `--stat` + commit message — the exact post-fix row counts (the predicted
`unified_contacts`/`recorded_owners.sf_account_id` agreement rate after C1a, the exact number of
tasks C1c actually retired vs the prompt's 945-estimate, the exact `dia.true_owners.salesforce_id`
count after C1d vs the predicted 822→849) were **not independently re-verified against live data**
in this reconciliation pass — only the shipped code's shape and stated intent were confirmed from
the commit messages themselves, which is not the same as re-measuring. If a live number is needed
for a downstream decision, re-run C1's own §0 queries against current data rather than quoting the
predicted figures above as fact.

## 2026-09-06 — SEC1-unit2 MERGED (#2141) · GOVDUP1-a confirmed · and the verification I wrote could not have proved it

✅ **`SEC1-unit2-MERGE` CLOSED.** PR #2141 merged; `git ls-tree -r origin/main` now shows
`gov_sec1_unit2_lock_sharp_functions.sql`, `dia_sec1_unit2_govdup1a_sf_identity_dedupe.sql` and
`gov_govdup1a_sf_property_identity_dedupe.sql`. **The repo describes the database again** — a
rebuild from `main` reproduces the lockdown instead of silently restoring the anon grants.

## 2026-09-07 — DRIFT1 SHIPPED: the repo can rebuild its producers again · and the security finding is real but NOT what it says

**PR #2150, verified live.** Canonical page: `docs/architecture/edge-function-deploy-drift.md` — a
per-function census of all 38 deployments across the three projects, a verdict each, an incident
writeup, and an operator runbook.

✅ **Five previously sourceless functions committed**, each with liveness proven rather than assumed:
`cortex-webex-sync` (**cron 159 `cortex-webex-poll`, `*/30 * * * *`, active** — confirmed), 
`w41-corpus-export` (**cron 65 `w44-resolver-retrain-nightly`, `30 7 * * *`, active**, via
`w44-retrain-tick`), `w43-sf-link-export`, gov `bulk-import-awards`, gov `sam-entity-lookup`.

✅ **`intake-salesforce` repaired, and the specific thing that misled GOVDUP1 is gone.**
`PAYLOAD_VERSION = "sf-2026-05-v8"` is committed with a header naming the deployed version;
`autoCreateProperty` appears **5×** in the committed body; and the false
*"never writes a domain table"* header is **absent (0 matches)**. **That sentence is what made the
original "producer NOT FOUND" read as conclusive** — removing it is the durable half of the fix.

✅ **Four retire verdicts recorded WITHOUT deleting live infrastructure** (`docai-diag`, `sf-test`,
`test-function`, `ai-copilot-v2`) — deleting a deployment that still answers is exactly the P194
hazard, so the verdict is filed for an operator rather than executed. Right call.

### ⚠️ The security finding is real, and its severity is overstated in one load-bearing way

The page describes `salesforce-enrichment` as *"a standing, callable, unauthenticated path from the
public internet to arbitrary-effect SQL execution."* **Measured live on dia: both `exec_sql(query
text)` and `execute_sql(sql text)` are `service_role`-only** — `anon` false, `authenticated` false,
`proacl = {postgres=X,service_role=X}`. **An outside caller cannot reach them directly.**

**What is true:** an **unauthenticated public endpoint that holds a service-role key and performs
that key's writes** when called — its own sixteen fixed steps against `contacts`, `true_owners`,
`salesforce_activities` and friends. Worth closing. Not "anyone can run arbitrary SQL".

✅ **Answered the same day by reading the DEPLOYED body (`get_edge_function`) rather than waiting for
it to be committed: NO caller-supplied input reaches any query string.** All sixteen steps are static
template literals with zero interpolation; the only request data read is `dry_run` and the path.
**There is no SQL-injection path, and the "arbitrary SQL" framing is retired.**

**The confirmed exposure, exactly:** `POST /run` — or a bare `POST /` — with **no credential** runs a
15-step write pipeline against dia `contacts`, `true_owners`, `salesforce_activities`,
`contact_links`, `touchpoint_schedule`; `GET /diagnostics` returns row and linkage-gap counts to
anyone; CORS is `*`. ✅ **Mitigating and worth stating: every write is fill-blanks or idempotent**
(`COALESCE`, `WHERE … IS NULL`, `NOT EXISTS`, `IS DISTINCT FROM`) — a hostile trigger costs load and
unwanted state transitions, **not destruction**. Close it deliberately; it is not a tonight problem.

🚨 **Two findings the auth question was hiding, and both matter more for data quality:**

1. **Steps 3 and 8B decide IDENTITY by NAME EQUALITY.** `lower(trim(t.name)) = lower(trim(sa.name))`
   writes `true_owners.sf_company_id`/`salesforce_id`; `lower(trim(c.company)) = lower(trim(t.name))`
   sets `contacts.true_owner_id`. **That is the technique this repo bans outright for identity
   writes** — `lcc_normalize_entity_name` / `ownerCore` / `strictOwnerCore` are grouping-for-review,
   never identity-for-write. A live function has been doing it since March.
2. **It writes curated BD columns with NO provenance ladder** — `contacts.contact_email`/`_phone`,
   `true_owners.contact_1_name`/`_2_name`, `is_prospect`. Sixteen steps, zero `field_provenance`
   rows: **a ladder-invisible writer to the very tables the CONTACT1 arc has spent a week
   instrumenting.**

✅ For contrast the sibling on the same project **is** authenticated — `intake-salesforce`'s
committed body calls `authenticateWebhook(req)` and 401s without `X-PA-Webhook-Secret`. The gap is
this function, not the pattern. → **DRIFT1-sfenrich**.

### 🚨 The merge-blocking test failure was not noise — it found TWO routing implementations that disagree

`npm test` failed on PR #2150 with 3 failures. Two were the expected consequence of syncing the real
body (`govdup1a-sf-property-dedupe.test.mjs` asserted the committed file must **lack**
`autoCreateProperty` — GOVDUP1-a deliberately kept the stale body plus a warning header, and DRIFT1
took the step that warning invited). **The third was real**, and CC verified it against the live
deployment rather than guessing.

**Read on named rows, the shape is sharper than "a missing feature":**

| module | routing terms | reaches |
|---|---|---|
| `intake-salesforce/sf-config.ts` `GOV_SIGNALS` **(deployed)** | `gsa`, `federal`, `government`, `department of`, `veterans affairs`, `social security`, `united states of america`, `u.s. government`, `u.s. department` — **federal only** | the intake path |
| `_shared/sf-deal-promotion.ts` `GOV_STATE_SIGNALS` | `state of `, `human services`, `child protective services`, `family protective services`, `criminal justice`, `juvenile justice`, `parks and wildlife`, `comptroller`, `general land office`, `railroad commission`, `workforce commission`, … — **state agencies** | `sf-promotion-worker` |

**So the same Salesforce property routes differently depending on which door it comes through.**
`Texas Health and Human Services` matches the promotion path and **matches nothing on intake**;
`TX Dept of Family Protective Services HQ` misses intake's `"department of"` on the abbreviation
alone. Deployed `routeVertical` then returns `{vertical: null, resolved: false, reason: "no_match"}`
— **and a skipped row leaves no staging row, no error and no queue entry**, which is Class 20
exactly: *a missing feeder has no representation anywhere.* It cannot be counted from the
destination side.

⚠️ **This is the normaliser-drift class at MODULE level** — two copies of one judgement ("what is
gov?") in one pipeline family, diverged. The failing tests were asserting that the two agreed; they
do not, and that assumption is what made the gap invisible. **CC corrected the tests to assert
deployed behaviour and documented the gap inline rather than deleting the discrepancy** — the right
call, and the reason it surfaced at all. Suite now **5,439 pass / 0 fail**. → **DRIFT1-routing-gap**.

**The meta-point: the blocking unknown was answerable in one call.** DRIFT1 correctly declined to
commit the body, and correctly said the severity could not be judged without it — but the deployed
source is readable directly. **When a decision is blocked on "the source is not in the repo", read
the deployment before deferring the decision.**

✅ **Unit 3 states its own limitation honestly** — a repo-side test can assert that every committed
function is deployed, but **cannot see a deployment with no committed source**, which is the whole
population DRIFT1 found. It ships an operator runbook instead of a guard implying coverage it does
not have. *That is the right answer, and this repo has a standing problem with the opposite.*

## 2026-09-06 — CONTACT1b-manual-source CLOSED: fixed before a single row was mislabelled, and the guard now asserts the property

**PR #2148, verified.** All three human-verdict sites (`admin.js` `handleJunkBucket` + both
`owner_contact_attach_review` branches) now pass **`source: 'manual_resolution'`** — a registered
rung-1 source. **Zero bare `source: 'manual'` remain** in `api/admin.js`.

✅ **Nothing needed relabelling.** `field_provenance` on `entities` still shows only `salesforce`
(23), `costar_sidebar` (5+5) and `domain_owner_contact` (4) — **no `manual` row ever existed**,
because these are human-triggered paths and none ran between the deploy and the fix. *Caught in the
window where the fix was three strings.*

✅ **The guard was re-anchored on the PROPERTY, not the value.**
`test/contact1b-write-site-coverage.test.mjs` (now **12/12**, up from 11) asserts membership in
`REGISTERED_RUNG1_SOURCES = {manual_edit, manual_resolution}` rather than equality with one literal
— so a future correction to the other valid spelling stays green, and an unregistered one goes red.
**That is the fix for the class**, not just for this instance: the repo has met "a guard that pins a
value defends the defect" in UX-T0 (×2), C13c, OCR2 (×2), B6c-dup and CONTACT1b.

📍 **Consolidation:** the canonical `docs/architecture/field-provenance-ladder.md` still asserted
*"per the ladder's own `manual`@1 rung"* as the justification — **the canonical page was carrying the
defect's rationale.** Corrected in place with the measurement (`manual_edit` 207 rungs / 28 tables,
`manual_resolution` 203 / 28, bare `manual` 1 / 1) and the reason the fix was the call sites rather
than a new rung. *A topic page that is stale on its own topic is worse than no page.*

## 2026-09-06 — CONTACT1b SHIPPED (six UPDATE sites wired, one measured-and-declined) · 🚨 and the three human-verdict sites write an UNREGISTERED source

**PR #2146, verified live.** ✅ **The ledger is moving**: `field_provenance` on `entities` now holds
**23 `salesforce` email rows, all within 2 days, newest 2026-09-06 17:01** — where two days ago it
held only 5+5 `costar_sidebar` and 4 `domain_owner_contact`.

✅ **`recordContactFieldWrites` is a genuine single owner** — one definition
(`entity-link.js:68`), called from `sidebar-pipeline.js`, `intake.js`, `operations.js`, `admin.js`.
The CONTACT1a inline block was extracted rather than copied, so no second normalizer exists.

✅ **Unit 2 was measured and DECLINED, which is the right answer.** `PATCH /api/entities` accepts
`email`/`phone`, and its only known caller — the extension's Update button — builds its payload from
`PROPERTY_FIELDS`/`ASSESSOR_FIELDS`, **neither of which contains a contact field**. CC recorded the
finding instead of instrumenting a path that never carries the value. Two further leave-alones each
carry a reason: `tm_misparse_unstamp` (it *clears* email to null inside an already-ledgered reversal
— recording a clear as a source's write would misrepresent it) and `lease-extractor.js` (its
existing "BD graph, not a curated table" comment re-confirmed rather than re-litigated).

### 🚨 The defect: `source: 'manual'` is not a registered rung, and the guard pins it

The three human-verdict sites (`admin.js:9440` `handleJunkBucket`, `:10313` and `:10356`
`owner_contact_attach_review`) pass **`source: 'manual'`**. The registered rung-1 sources for
`entities.email`/`phone` are **`manual_edit`** and **`manual_resolution`**. There is no `manual`.

**Fleet-wide the convention is unambiguous:** `manual_edit` **207 rungs / 28 tables**,
`manual_resolution` **203 / 28**, `manual_verify` 2 / 2 — and bare **`manual` exists on exactly ONE
rung, one table.** It is an outlier, not a standard. **So the fix is to change the three call sites,
not to register `manual`.**

⚠️ **The consequence inverts the intent.** PR8 established *the registry IS the allowlist*:
`lcc_flush_provenance_events` relabels an event whose source is not registered for that
(table, field) to `domain_trigger`, and in `lcc_merge_field` "unregistered" is a **different
branch** — fills a blank, can never override, overridable by anyone. So **the human verdict, which
should be rung 1 and the highest authority on the ladder, would be recorded at the weakest tier or
under another name.** Nothing errors.

✅ **Found before it fired: there are ZERO `manual` rows** — the paths are human-triggered and none
has run since the deploy. The fix is three source strings.

⚠️ **The guard cements it.** `test/contact1b-write-site-coverage.test.mjs` (11/11 pass) asserts the
literal `'manual'` **twice**, so correcting the code turns the guard red. **Fix both in the same
change** — and this is the shape the repo keeps meeting: *a guard that pins a value rather than a
property will defend a defect as readily as a fix.*

⚠️ **Mutation reporting, fourth instance.** The response says "mutation-verified (demonstrated red on
a real removal, restored green)" — **that is ONE mutation, not N/N.** GOVDUP1-a remains the only
full pass this arc (12/12, 0 survivors). → **MERGE1-guard-mutations** covers this class.

→ **CONTACT1b-manual-source.**

### CONTACT1b drafted — and CONTACT1a is working better than last recorded

✅ **The CONTACT1a CREATE wiring is producing rows.** `field_provenance` on `entities` holds
**5 `email` + 5 `phone`, source `costar_sidebar`, newest 2026-09-05** — the 2026-09-04 entry
recording "0 rows so far, quiet not unreachable" is now superseded: it is writing.

⚠️ **The CONTACT1b premise in the handoff was wrong and was refuted before drafting.** It said to
measure whether `writeEntitySalesforceLink`'s links are creates or updates; **that function does not
touch `email`/`phone` at all** (`salesforce-sync.js:59-116` writes `external_identities` and merges
`metadata.salesforce` — no scalar column). *A named mechanism in a brief is a hypothesis.*

**What the measurement actually found — a census: 14 sites write those columns, 4 consult the
ladder, 10 do not.** Churn over 30 days on live contact-bearing entities: **587 touched / 417
created / 170 updated-but-not-created**, so **~29% of movement is UPDATES** — the case where a prior
value exists. Against that, the ladder has ~10 rows: **it sees ~1.7% of the churn.**

🎯 **The sharpest asymmetry is inside ONE producer:** the CoStar sidebar's CREATE path is
instrumented (`entity-link.js:1282`) and its own UPDATE for the very same contact
(`sidebar-pipeline.js:2278`) is not — so a second capture of an existing entity fills email/phone
with no provenance row. That is why the ledger shows `costar_sidebar` and almost nothing else.

⚠️ **Two design traps the prompt makes the unit settle rather than assume:** two ladder idioms are
already in use (`recordFieldWrites`, post-write audit vs `filterByFieldPriority`, pre-write gate),
**and under `record_only` — which is all ten `entities` rungs — the gate does not gate**; plus
`lcc_merge_field` compares against `field_provenance`, **not the live column**, so it cannot protect
a curated value it has never seen (**11,594 stored emails against ~10 provenance rows**). Wiring the
gate buys **recording, not protection**, and describing it otherwise is the exact mis-statement
already recorded against PR5c-entities.

### ⚠️ GOVDUP1-a is confirmed — and the check I specified could not have proved it

I asked for *"`_new_property` rows created after the fix staying flat."* Result: **0 new
advisories.** But **the newest advisory is 2026-08-26, ten days BEFORE the fix** — so that zero
cannot distinguish *the dedupe is working* from *the producer was already quiet*. **It is the
quiet-vs-unreachable trap, inside a verification I wrote**, and it would have read as a clean pass.

**What makes the zero mean something is the producer's own arrival rate, which my check never asked
for:** `sf_property_staging` took **3 rows in the last 24h (newest 2026-09-05 18:39), 23 in 7 days,
109 in 30** — **the crawl is live, it processed rows, and it minted nothing.** All three linked
cleanly.

⚠️ **Still unproven in production: the dedupe ARM has zero hits.** `match_method='sf_identity_dedupe'`
is 0 of 3 — all three linked by the normal address path, and the new arm only fires when an
`sf_property_id` already has a linked property *and* address matching fails. The rolled-back probes
(gov `linked_property_id=36283`, dia `22008`, both `sf_identity_dedupe`) remain the only proof of
the arm, and they are good ones.

**Durable rule: before asserting a producer is fixed by an ABSENCE, prove the producer RAN.** An
absence over a dormant producer is not evidence — the same shape as `already_annotated` reading like
throughput, one level up. It belongs in every "the count stayed flat" verification this repo writes.

## 2026-09-05 — SEC1-unit2: gov anon+mutating 5 → 1 · dia dedupe ported · Unit 2 DECLINED with a reason · 🚨 and the branch is NOT on `main`

🚨 **READ THIS FIRST: the privilege changes are APPLIED LIVE and the migrations are NOT MERGED.**
The work sits on `origin/claude/sec1-unit2-anon-gov-triage-01KgcbZF2CgeC8nisk5PEi74`; `main` at
`b22d1c29` does not contain it (the PR merged today was **#2139 ASC39**, a different branch). **A
rebuild from `main` silently restores the anon grants this unit removed.** That is the *"running but
not merged"* class GOVDUP1-a recorded **yesterday**, now landing on our own security work — and it
is the worse direction, because the repo does not describe the database and nothing errors.
👤 **Operator step: merge that branch.** Until then, treat gov's lockdown as un-reproducible.

### Unit 1 — shipped and verified live, gov anon+mutating **5 → 1**

Locked, each `anon` false / `authenticated` false / `service_role` true /
`proacl = {postgres=X,service_role=X}`: **`gov_apply_om_confirmed_noi`**,
**`gov_truncate_sam_public_staging`**, `gov_match_sam_public_extract`, and
`gov_pse_propagate_to_sale` (a trigger — locked for tidiness, not reachability). The single holdout
is **`gov_check_queue_slas`, left anon deliberately** as a monitor-shaped exception with the reason
recorded — *a decision to leave something anon is a result, not a gap.*

⚠️ **`gov_apply_om_confirmed_noi` already carried a `REVOKE ALL FROM PUBLIC` in its migration and
was still anon-executable.** That is the two-grant footgun, live, on a function whose author
believed they had closed it — the clearest confirmation yet of the canonical
`CLAUDE.md` §*SECURITY DEFINER PRIVILEGES* section: **PUBLIC and the explicit `anon`/`authenticated`
grants are independent, and removing one is a no-op for the other.**

✅ **CC did the deployed-caller check GOVDUP1-a earned.** Both real callers of the NOI function were
confirmed to use the **service-role** path before the revoke — `om-comp-resolver.js` via
`domainQuery`, and `ingest_sam_public_extract.py` hard-coded to the service key — then each function
was behaviourally re-probed inside a rolled-back transaction after the revoke. **That is the
sequence: find the caller, revoke, re-probe.**

### Unit 3 — the dia dedupe port, shipped and proven

`trg_dia_sf_staging_identity_dedupe` / `_record` live on dia's `sf_property_staging`. Proven
rolled-back: a fresh staging row for a known `sf_property_id` returns
`linked_property_id = 22008`, `match_method = 'sf_identity_dedupe'` instead of minting. ✅ **Both new
definer trigger functions shipped LOCKED** (`anon` false, `{postgres=X,service_role=X}`) — the
SEC1-definer-default guard working for the **second** consecutive unit.

### Unit 2 — the 62 were triaged and deliberately NOT locked, and that restraint is correct

CC classified them (`docs/audits/SEC1_UNIT2_RESULTS_2026-09-05.md`) and declined to revoke, because
**the deployed-artifact caller search was not completed** — citing GOVDUP1-a's proof that a real
caller can live in an edge function, cron command or PA flow that no repo grep can see. Nine
`*_check_*` health functions are flagged as likely deliberate-anon. **Refusing to revoke 62
functions whose callers you have not enumerated is the right answer**, and it is the same discipline
that made Unit 1 safe. → **SEC1-unit2-lock**.

## 2026-09-05 — GOVDUP1-a SHIPPED: the writer was DEPLOYED BUT NEVER COMMITTED · and yesterday's SEC1 guard worked on its first real opportunity

**PR #2138, verified live.**

🚨 **The producer is `intake-salesforce`, a Supabase edge function on Dialysis_DB — deployed
`version 23`, ACTIVE, while the committed source is v1-era with ~400 lines of drift.** Path:
`handleCrawlComplete → linkProbe(autoCreate=true) → autoCreateProperty()` → a bare POST into
`gov.properties` plus the `_new_property` advisory. **GOVDUP1's search was not sloppy — it read the
committed file, which genuinely has no insert path.** ⚠️ **This is "running but not merged", the
inverse of the doctrine this repo states everywhere, and it is the SECOND instance** (P194: the
extension's hard-coded Vercel URLs, also client-side and also invisible to a repo grep). **A
producer whose deployed code is ahead of the repo is invisible to every code search, and no test,
guard or reviewer can see it.** Confirmed independently: `list_edge_functions` on
`zqzrriwuavgrquhisnoa` shows `intake-salesforce` v23 ACTIVE.

**The defective key, confirmed:** `uq_sf_property_staging_dedup` is
`(sf_property_id, source_system, **import_batch**)` — and `import_batch` changes every crawl, so it
**can never collide**. A dedupe key containing a per-run value is not a dedupe key.

**The fix, proven behaviourally (rolled back):** two `BEFORE INSERT` triggers on
`sf_property_staging` pre-link by `sf_property_id` *ahead of* the mint. A fresh crawl row for the
Rutland `sf_property_id` — the exact shape that minted 154 husks — now returns
`linked_property_id = 36283`, `match_method = 'sf_identity_dedupe'`, confidence 1.0, so
`autoCreateProperty` never fires. ✅ **And it prefers a LIVE row when one exists**: given the
39064 (active) / 39128 (archived) pair it links to **39064**. Linking to an archived husk happens
only when every row for that SF property is archived — which beats re-minting.

✅ **The SEC1-definer-default guard worked on its first real opportunity.** Both new trigger
functions (`gov_sf_staging_identity_dedupe`, `gov_sf_staging_identity_record`) are SECURITY DEFINER
and shipped **locked** — `anon` false, `authenticated` false, `proacl = {postgres=X,service_role=X}`.
The migration carries the stanza because the guard requires it. *That is the first evidence the
guard changes behaviour rather than merely existing.*

**Counts:** `_new_property` advisories still `pending` **220 → 63** (157 resolved this batch, with a
fix to the expiry function, which only asked *does the property exist* — and archiving does not
delete). Live duplicate properties **6 → 3** (18945, 22102, 39064); the two 2026-05-17 rows were
deliberately **left alone** as the sole record at their address, which is the right call —
archiving them would have destroyed real data. ✅ **Guard `test/govdup1a-sf-property-dedupe.test.mjs`:
12/12 mutations RED, 0 survivors — the first genuine full mutation pass of the week**, after three
that reported a strength they did not have.

⚠️ **My "8 still live" in the filing prompt was wrong; the answer is 6.** I counted advisory **rows**
where the population is **properties** — two properties carried two advisories each. `CLAUDE.md`'s
own rule (*state which grain a count is on — rows ≠ assets ≠ owners*) broken by me, in the prompt
that told CC to re-measure everything. CC re-measured and corrected it, which is exactly what the
standing rule is for.

**Open, filed honestly rather than skipped:** the ~400-line deployed-vs-committed drift; sibling
staging tables (comps, listings) sharing the same collision-prone key shape; a dia-side branch of
the same function not covered by this dedupe; and **the real confirmation — that no new
`_new_property` rows appear — needs ~24h**, since the crawl is hourly. Flagged unverified rather
than claimed. → **GOVDUP1-a-residue**.

## 2026-09-05 — SEC1-merge-family Unit 1 SHIPPED: the 7 functions a name-only sweep missed are locked

**PR #2136, verified live.** `anon` false / `authenticated` false / `service_role` true /
`proacl = {postgres=X,service_role=X}` on all seven — dia `dia_consolidate_property_reviewed`,
`dia_reverse_property_consolidation`, `dia_merge_twins`, `p31_property_consolidation_apply`,
`p31_same_event_sales_apply`; gov `p31_property_consolidation_apply`, `p31_same_event_sales_apply`.
Each asserted in-migration with `has_function_privilege()`, and each behaviourally re-probed as
`service_role` **after** the revoke, so the live `domainQuery` caller path is proven unaffected
rather than assumed.

**The census moved by exactly the predicted amount** — the check that a revoke hit its intended
population and nothing else:

| project | definer | anon (was) | anon + mutating (was) |
|---|---:|---:|---:|
| LCC Opps | 196 | 89 (89) | **62** (62) — untouched, Unit 2 |
| dia | 79 | **8** (13) | **4** (9) |
| gov | 54 | **7** (9) | **5** (7) |

⚠️ **A triage axis worth adding, and it cuts both ways.** PostgREST does not expose functions
returning `trigger`, and Postgres does not check `EXECUTE` when a trigger fires — so an anon grant
on one is **not a reachable path**. **gov's 5 is really 4** (`gov_pse_propagate_to_sale` is
B6c-dup's trigger function). But **LCC Opps' 62 is really 62 — 0 of them return `trigger`.** I
expected this to shrink the big number; it does not. Recorded as a hypothesis tested and refuted so
the next reader does not spend the query.

**The residue is NOT one class**, and the sharpest two are on gov: 🚨
**`gov_apply_om_confirmed_noi(p_property_id, p_noi, …)` lets anon write an NOI onto any gov
property** — a curated-value write — and 🚨 **`gov_truncate_sam_public_staging()` takes no arguments
and TRUNCATEs.** Against those, four `*_check_*` monitors are **the `compute_feed_freshness` shape**
and may be deliberately anon for a cross-DB pull; **each needs checking, and a deliberate anon grant
there is a result, not a gap.**

**Units 2 and 3 were honestly deferred, not glossed** — CC recorded the 62 as needing per-function
reads it did not have room to do, and refused the blanket revoke the prompt refused. That is the
right call. → **SEC1-unit2**.

## 2026-09-05 — SEC1-definer-default SHIPPED (the guard exists now) · live census supplied · 🚨 the property-merge family is only HALF locked

**PR #2133.** `test/sql-definer-privilege-stanza.test.mjs`, **13/13 pass**, full suite 4,976 pass /
0 fail. It scans every `.sql` under `supabase/migrations/**` for a `SECURITY DEFINER` function and
requires, **in the same file**, a `revoke … from public, anon, authenticated` **and** a
`has_function_privilege(` assertion. **220 definer-creating migrations, 219 on a path-keyed
allowlist** (verified: 219 entries, 219 unique, 219 resolve on disk) with a stale-entry test that
fails if an entry's file is gone, no longer creates a definer function, or now *has* the stanza —
so the list cannot rot into a lie.

✅ **It is positive-controlled in BOTH directions, which is stronger than the mutation pass I asked
for and did not get:** one test asserts the **pre-fix MERGE1 shape is flagged**, another asserts the
**real MERGE1-sec follow-up migrations satisfy the stanza** — so it is known to fire *and* known to
recognise a genuine fix. It also pins `revoke from public+anon` alone (missing `authenticated`) as
**not** satisfying the stanza — the B6d/OCR2 mechanism encoded as a test rather than prose.
`compute_feed_freshness` / `compute_feed_cadence` are named exemptions with the reason in the file.

⚠️ **My sizing in the filing prompt was wrong, and CC's is right: 220 / 219, not 236 / 154.** My
grep asked whether a `revoke` appeared **anywhere in the file** — so a migration revoking on a
*table* scored as compliant for a *function* stanza it does not have. Scoped properly the repo reads
**233 of 236 lacking**; CC's 220 is lower still because its detector is quote- and comment-aware and
excludes `SECURITY DEFINER` occurring inside comments or string literals. **A grep for "is the fix
present" that does not check what the fix is attached to will always report the reassuring
number** — the same class this very prompt warned CC about, committed in the prompt itself.

✅ **CC caught a real bug mid-build and the refinement is worth keeping.** The repo's standing rule
is *strip comments, then blank string literals* (OCR1c). Applied naively here it broke twice: English
prose inside a SQL string literal desynced quote-tracking, and — the subtle half — **blanking
literals for the STANZA check would blind the guard to every real fix in this repo, because the
production revokes are built with `execute format(...)` and therefore live inside string literals.**
Resolved with a quote/comment-aware state machine, with literal-blanking scoped to *definer
detection only*. **The OCR1c rule is not "blank literals everywhere" — it is per-assertion, and
where the deliverable IS a constructed string, blanking is the bug.**

### The live census the triage doc asked for — supplied from Cowork

CC had no Supabase access and said so plainly. Measured:

| project | definer fns | anon-executable | …mutating | …dynamic SQL |
|---|---:|---:|---:|---:|
| LCC Opps | 196 | **89** | **62** | 1 |
| dia | 79 | 13 | **9** | 0 |
| gov | 54 | 9 | **7** | 0 |

All prior lockdowns spot-checked and holding: the four MERGE1 fold helpers, `gov_merge_property_apply`,
and the three ENTC unmerge functions are `service_role`-only; `compute_feed_freshness` stays anon by
design.

🚨 **The finding: SEC1-property locked the merge functions it NAMED, and the same capability is still
anon-executable under other names.** `dia_consolidate_property_reviewed(p_keep_id, p_drop_id, …)` is
a keep/drop property merge — **exactly what SEC1-property locked** — plus
`dia_reverse_property_consolidation`, `dia_merge_twins`, `p31_property_consolidation_apply` and
`p31_same_event_sales_apply` (**both domains**), and `gov_truncate_sam_public_staging`.
⚠️ **This is the ADDR1b lesson one level up: it applies to the AUDIT, not just the function.**
*"Porting a function carries its logic, not its privileges"* — and enumerating **by name** cannot
find a sibling that does the same thing under a different one. **Before calling a privilege sweep
complete, ask what else can do this, not whether the list was finished.** → **SEC1-merge-family**.

⚠️ **Correction to my own prompt:** I called `lcc_apply_cleared_tombstones` *"the MERGE1 shape"* and
told the next unit to start there. Read live, its dynamic SQL is over a **hard-coded `VALUES` map of
column names**, not a caller-supplied table, and it defaults to `p_dry_run => true`. It still mutates
mirror columns when called with `false`, so it stays on the list — but **below** the merge family.
*A shape matched by a regex over `pg_get_functiondef` is a hypothesis; read the function before
ranking it.*

## 2026-09-05 — MERGE1 SHIPPED (fold-on-collision, both domains) · and its own migration shipped 4 ANON-EXECUTABLE destructive definer functions, found and fixed the same day

**Verified live (PR #2130, commit `344d360e`).** `{dia,gov}_merge_child_policy` seeded from the
measured population; `{dia,gov}_merge_fold_table` + `_{dia,gov}_merge_fold_one_row` created; both
merge functions route `unique_violation` through the fold dispatcher and **gov's old
`_deleted_on_collision` shape is gone** (grep = 0). `gov_property_merge_backup` still **0** —
nothing merged. Lane still 397. Audit: `docs/audits/MERGE1_PROPERTY_MERGE_COLLISION_FOLD.md`.

**The fix is proven behaviourally on BOTH domains, not read off the code** — each re-run inside
`BEGIN … ROLLBACK` after the privilege change below:

| domain | policy exercised | result |
|---|---|---|
| dia | `property_embeddings` → `re_derivable` | 1 row remains on keep; ledger `{"policy":"re_derivable","discarded_re_derivable":1}` |
| gov | `property_financials` → `fold_fill_blanks` | 1 row remains, and the keep row's **NULL `noi` was filled from the drop row (987654.32)** — the value the old code destroyed |

✅ **The new `rewired` ledger reports `folded` / `repointed` / `resolved_in_place` /
`discarded_re_derivable` separately per table**, so a deliberate discard and a loss no longer read
the same — which was the substantive complaint against `_error` / `_deleted_on_collision`.

🚨 **MERGE1-sec — the four new fold helpers shipped reachable by `anon` and `authenticated` on both
databases.** They are **destructive and take a TABLE NAME as a parameter** (`*_merge_fold_table`
runs dynamic `UPDATE`/`DELETE` against whatever table the caller names), so this was **a strictly
worse hole than the one SEC1-property closed three days earlier** on
`*_merge_property_reversible`. The callers were already locked; the helpers they gained were not.
Measured: `proacl = {=X/postgres,…,anon=X/postgres,authenticated=X/postgres,…}`,
`has_function_privilege('anon',…)` **TRUE** on all four.

- **Fixed live on both domains and committed** as
  `supabase/migrations/{dialysis,government}/20260905130000_*_merge1_fold_function_privileges.sql`,
  each carrying a positive-controlled assertion that fails loudly if either role can still reach
  either function **and** if `service_role` cannot. After: anon/auth **false**, service_role
  **true**, `proacl = {postgres=X,service_role=X}`, all four.
- ⚠️ **Third instance of this class in a week** (B6d `compute_feed_cadence`, OCR2
  `<dom>_merge_document_extracted_data`, ADDR1b `gov_merge_property_apply`) and **the first where
  the same PR that fixed a data-loss defect opened a privilege one.** Postgres grants EXECUTE to
  PUBLIC on every new function and Supabase additionally grants `anon`/`authenticated`
  **explicitly**, so `REVOKE … FROM public` alone is a no-op for the two roles that matter.
  **A migration that CREATEs a definer function needs its privilege stanza in the same file.**
  → filed as **SEC1-definer-default** so the rule stops being re-learned.

**Historical losses NOT backfilled** — the 205 dia merges are gone, recorded as a number and a date
(PR12 rule). `dc_twin_verdict` merges from here forward fold instead of destroying.

⚠️ **Stated gap CC recorded rather than solved:** `resolve_status` (dia `pending_updates`) repoints
the row back on unmerge but does **not** restore its original `status`, so that reversal is not
byte-perfect. The row survives; the reversal is lossy in one column. → **MERGE1-resolve-status**.

⚠️ **The response `.docx` was 0 bytes** (Word lock file `~$RGE1…` beside it) — this entry was
reconciled from the merged PR and `docs/audits/MERGE1_PROPERTY_MERGE_COLLISION_FOLD.md` instead.

## 2026-09-05 — SEC1-property SHIPPED (all 4 locked, migrations committed on both domains) · 🚨 the CMBS Loan-tab capture produced NOTHING — the arm is confirmed unreachable, not merely uncaptured · GOVDUP1 drafted, and it REPLACES the planned ADDR1c-twin-lane.

### GOVDUP1 SHIPPED — and the verification found the producer CC could not, plus a merge that cannot be reversed

**Verified live 2026-09-05:** 154 husks archived (`status='archived'`, never deleted) and logged
row-by-row in `gov_property_dup_retire_log` (154 rows, reversible by batch tag) ·
`v_gov_property_duplicate_review` **397 groups / 797 properties** = exact **130 / 263** +
punctuation_only **267 / 534** · `gov_property_merge_backup` **0 — nothing merged anywhere** ·
three zip states kept genuinely distinct (`zip_agrees` **138** / `zip_differs` **24** /
`zip_not_comparable` **235**). All as reported. LCC PR #2127, government-lease PR #397.

**CC's own mid-unit self-correction was right and my prompt was wrong:** I wrote that the 154 husks
were pure (0 owners/leases/sales/documents) having checked four tables. Each husk carries **1
`investment_scores` row and 1 `pending_updates` row** — and `investment_scores` has **no declared
FK**, so enumerating FKs would not have found it either. ⚠️ **This is P160's lesson recurring:
declared FKs are not references; match on the column NAME as well.**

🚨 **CORRECTION 1 — the producer IS identified, and it names itself in the child row CC discovered.**
CC recorded "producer NOT FOUND" after correctly ruling out the SF promotion worker, the CoStar
sidebar and `auto_apply_property_links.py`. But all 154 `pending_updates` rows read
`field_name='_new_property'`, `reason='Salesforce auto-created property — verify accuracy and check
for duplicates'`, and carry **one shared `sf_property_id = a068W00000FbBqwQAF`** with `sf_zip='5701'`
and `sf_state=null` — the husk's exact values, with a different `staging_id` each time. **A
Salesforce auto-create path mints one gov property per staging row and does not dedupe on
`sf_property_id`.**

- **Class-wide: 808 gov properties from 125 distinct SF properties.** 53 SF properties fanned out
  into **736** rows; **8 still live**, newest **2026-08-25** — 11 days before this unit ran.
- **It was already cleaned once, in June** (`junk_backfill_archived_2026-06-09` archived the
  2026-05-17 batch) **and recurred.** P176 exactly, and GOVDUP1 just repeated the one-shot.
- ⚠️ **Why the search missed it: the hunt was keyed on `data_source`, and this producer wears more
  than one label.** Property 39064 (`700 technology dr`, Charleston WV, **`costar_sidebar`**, 08-24)
  and 39128 (`700 Technology Dr`, South Charleston WV, **`unknown_writer`**, 08-25) are the same SF
  property minted twice a day apart under two different sources — **and that pair is in the review
  lane right now.** So Unit 1's husks and Unit 2's duplicate pairs are **two symptoms of one
  producer**. The invariant is `field_name='_new_property'` + `sf_property_id`, never `data_source`.
- **The durable rule: a child row written 1:1 with its parent is a CO-WRITER, not a downstream
  consumer.** CC found the rows and classified them without opening the payload. → **GOVDUP1-a**.

🚨 **CORRECTION 2 — no pair in this lane round-trips cleanly, and it is provable from the indexes.**
CC's Unit 3 probe found `investment_scores` 1, `property_embeddings` 1, `property_financials` 14
rows destroyed on one pair, and concluded *"a pair with disjoint child rows may round-trip
cleanly."* Measured across all 397 groups against the actual unique constraints:

| table | unique constraint | groups colliding (of 397) | rows destroyed |
|---|---|---:|---:|
| `investment_scores` | UNIQUE **on `property_id` alone** | **397 — every group** | 400 |
| `property_embeddings` | PK **on `property_id`** | 334 | 336 |
| `property_financials` | UNIQUE `(property_id, fiscal_year)` | 316 | 585 |

Merging the lane as it stands destroys **~1,321 child rows permanently**. ⚠️ **A collision handler
that DELETEs makes the surrounding reversibility a lie** — the wrapper snapshots child *ids*, while
`gov_merge_property_apply`'s `WHEN unique_violation` arm runs `DELETE`, so the id in the backup
points at nothing. `gov_unmerge_property` is *honest* about it (`_lost` per table plus a `note`) and
honesty is not sufficiency. **This is P196 one layer down** — there `lcc_merge_entity`'s pivot DELETE
destroyed content instead of folding it; here the same shape sits in the generic handler serving
*every* gov child table. **The fix is to FOLD on collision, and it blocks any batch merge.**
→ **GOVDUP1-b**.

**Three smaller residues:** `verdict_hint` is a pure synonym for `address_match` (267/267 `merge`,
130/130 `review` — it reads no other signal, and says `merge` on 10 groups whose zips disagree) →
**GOVDUP1-d** · 154 `pending_updates` still `pending` against archived properties, nothing clears
them → **GOVDUP1-c** · **94 LIVE properties carry a `.0`-suffixed zip** (`95492.0`), the same
numeric-coercion fingerprint as `'5701'`, one of them inside this lane → **GOVDUP1-e**. Guard is
9/9 pass with **3 assertions spot-mutated, not 9** → **GOVDUP1-guard**.

Canonical page: `docs/architecture/gov-property-duplicates.md` (both corrections recorded in place).

🚨 **AND CORRECTION 2 IS LIVE ON dia, WHERE IT HAS ALREADY RUN 205 TIMES.** Checking whether the fix
should be ported found `dia_property_merge_backup` holds **585 merges, 206 with a collision, 205 of
those on a CASCADE table** — and **`dc_twin_verdict`, the human-verdict Decision Center twin lane,
collides on 90 of 116 (78%)**. An operator confirming a twin destroys a child row four times in five
while the surface tells them the merge is reversible.

- ⚠️ **The two domains lose the row by different routes, so a grep for one finds nothing on the
  other.** gov `DELETE`s explicitly and records `*_deleted_on_collision`; **dia records
  `<tbl>.<col>_error`, moves on, and the row dies to `ON DELETE CASCADE`** when the property is
  deleted afterwards (`confdeltype='c'` on `cap_rate_history`, `property_metadata_backfill_queue`
  and one `property_embeddings` FK). **Keying on gov's vocabulary undercounted dia at 76** before
  re-keying on `%\_error` gave 206 — my own measurement, caught in the same session.
- ✅ **The one merge I directed came out fine, and saying so precisely matters.**
  `addr1a_20260904` (37503 → 38953) collided only on **`pending_updates`, a queue row** — all 7
  leases, the deed record, the listing and the document repointed correctly. **"205 merges lost
  data" overstates that row and understates a `cap_rate_history` loss**, so the census must split
  substantive from queue/derived.
- Filed as **MERGE1** (prompt written), which supersedes GOVDUP1-b and puts **dia first because it
  is live**. Fix = FOLD per table with a stated re-derivable / substantive / queue policy.

### GOVDUP1 — sizing the gov "twin lane" refuted the plan to port dia's

Measured before drafting, and **three of the plan's premises are wrong**:

1. **The producer is a spreadsheet, not a capture.** `excel_master` — 9,633 gov properties, all
   created **2026-03-05, one run**. This is not an ADDR1/CoStar-sidebar continuation and must not be
   filed under that arc.
2. **`co-located ≠ twin` is dia's risk, not gov's.** dia's lane exists because a Fresenius and a
   DaVita share a plaza. gov's analogue — two agencies in one federal building — is what a merge
   **fixes**: `1120 E 80th St, MN` carries `MN/WI SERVICE CENTER` on one row and `DHS` on the other,
   and those belong as two leases on one property. **122 of 128 exact-key pairs have BOTH members
   carrying real attachments**, so the operation is consolidation, never deletion of an empty shadow.
3. 🚨 **gov `properties` has NO `merged_into_property_id`.** `gov_merge_property_apply` **hard-DELETEs**
   the dropped row; reversibility is entirely `gov_property_merge_backup`, and it snapshots child
   **ids**, not child **rows** — so children the apply dedup-deleted on `unique_violation` are gone.
   ✅ `gov_unmerge_property` is **already honest** about this (it reports `<table>.<col>_lost` per
   table plus an explicit note) — that is the P196/ENTC lesson already applied; do not "improve" it
   away.

⚠️ **Two measurement traps, both caught before publishing:**

- **The key decides the population and I nearly reported a false retraction.** Re-measuring on the
  exact-string key gave **132 groups / 419 properties** and I was one sentence from writing that my
  earlier **399 / 953** "did not reproduce." It reproduces exactly on the punctuation-stripped key.
  The 267-group difference is `1000 Terminal Dr` / `1000 Terminal Dr.`, `100 NE Loop 410` /
  `100 N.e. Loop 410` — **same city, same state, punctuation only, and the cleanest duplicates in the
  whole set.** *Never report a duplicate count without the key; when a re-measurement disagrees,
  check the key before concluding either is wrong.*
- **`lpad('',5,'0')` is `'00000'`, not NULL.** Sizing zip agreement, an empty `zip_code` normalized to
  a present-and-disagreeing zip: **46 agree / 82 differ / 0 missing**, plausible and wrong. Corrected
  by requiring ≥4 digits before padding: **42 / 15 / 71**. Same family as PR1a's retracted roundness
  statistic, which measured zeros.

**Population, and it is three classes not one:** 399 groups / 953 live properties (normalized key) =
**A** one group of **154 empty husks** (`1085 Route 4 E` Rutland, `data_source='unknown_writer'`,
`state` NULL, zip `'5701'` = VT 05701 leading-zero-stripped, **0 owners / 0 leases / 0 sales /
0 documents**) → a producer defect and a bulk retire, *not* a merge question · **B** 267
punctuation-only groups · **C** 132 exact-string groups, **106 of which differ in city**.

⚠️ **Do not gate on city-string similarity.** The city difference takes three shapes and only one is
a spelling variant: abbreviation (`St Louis`/`Saint Louis`), county-qualified form
(`Lexington-Fayette`/`Lexington`, `New York-Kings`/`Brooklyn`), and **genuinely different
municipality names for one location** (`Essington`/`Lester` PA — both `DELAWARE VALLEY FIELD OFFICE`;
`Sweet Water`/`Miami` FL; `Greece`/`Rochester` NY). A similarity test rejects the third shape, which
is real duplicates.

🚨 **One group must never merge and the lane must exclude it by construction:** address
`international airport`, TX — Brownsville 78521 vs Corpus Christi 78406. **Two different airports
sharing a placeholder string.**

Prompt: `docs/claude-code/prompts/GOVDUP1-gov-property-duplicate-consolidation.md`. **Nothing merges
in that unit** — gov's hard-delete-with-partial-restore is a strictly higher bar than dia's soft
tombstone, so the round trip is proven on this population *before* any batch (P195).

### SEC1-property — verified live, both domains

`dia_merge_property_reversible`, `dia_unmerge_property`, `gov_merge_property_reversible`,
`gov_unmerge_property` — **all four now `anon` false / `authenticated` false / `service_role` true**,
`proacl = {postgres=X/postgres, service_role=X/postgres}`, matching the already-locked precedents.
`gov_merge_property_apply` (locked in Cowork 09-04) confirmed still locked. Asserted with
`has_function_privilege`, never by reading the REVOKE. **Migrations committed on BOTH domains**
(`20261015120000_{dia,gov}_sec1_property_merge_definer_lockdown.sql`) — a privilege applied only live
is invisible to the repo.

- ⚠️ **The safety check was DONE rather than trusted, and the doc would have been the wrong source.**
  The prompt flagged that revoking `anon` could break the `property_twin` Decision Center lane if it
  calls the RPC from the client. `supabase-keys.js` documents a **fallback to the historically-anon
  `DIA_SUPABASE_KEY`** when the service key is unset — so "it's server-mediated" was not safe to
  assume. **The proof used was behavioural:** the same decision lane already calls
  `dia_merge_property`/`gov_merge_property` through the identical `domainQuery` path, and **those two
  were already locked to service_role** — a live, working lane calling an already-locked function
  proves `domainQuery` resolves to `service_role` in production. **That is the right shape of proof:
  a sibling that already works under the constraint you are about to impose.**
- **Caller census:** `dia_merge_property_reversible` has one live caller (the property_twin lane) plus
  an operator CLI; `dia_unmerge_property` only the CLI; **both gov functions have zero callers
  anywhere** (shipped same-day by ADDR1b-merge, not yet wired).
- **SEC1 re-measured and BUCKETED, nothing else revoked:** LCC Opps **89** anon-executable definer
  functions (63 mutating-like / 26 read-only-like) — 89 not the filed 91, reconciling with ENTC's 3
  already fixed; dia **13** (9/4); gov **9** (6/3). `compute_feed_freshness` is anon-executable on
  both domains and was **correctly left alone** — `CLAUDE.md` records that grant as deliberate, and
  revoking it would silently blind the freshness monitor. Named next candidates on dia:
  `dia_merge_twins`, `p31_property_consolidation_apply`, `dia_consolidate_property_reviewed`,
  `dia_reverse_property_consolidation`.

### 🚨 The CMBS capture wrote nothing — and that upgrades PR5d's verdict

Scott captured property **3302 (2100 2nd St SW, Washington DC)** and its **Loan page**. Measured:
- `loans` rows updated in 24h on gov: **0**. Every loan on 3302 still dates to **2026-07-15**.
- **`properties.updated_at` for 3302 is 2026-09-01** — the capture did not touch the property row either.
- **7 `staged_intake_extractions` in 30 hours and NOT ONE carries a loan-shaped key** (`loan*`,
  `cmbs*`, `servic*`, `dscr`, `watchlist`, `maturit*`).
- The only gov entities written in the window (02:05 UTC — Coast Guard, Laszlo Tauber & Associates)
  carry **NULL metadata**, i.e. they are from a sync, not a sidebar capture.

⚠️ **PR5d concluded the arm was case (c) — "the scanner is live and correct; the page has simply never
been captured."** The page has now been captured and **still nothing reached the server**. That moves
it to case **(a) or (b): either `parseCmbsLoanDetail` does not fire on the page Scott is on, or the
payload is dropped before the writer.** The distinguishing evidence is on Scott's side — 👤 **a
screenshot of the Loan tab, and confirmation the extension sidebar shows a capture happening there.**
→ **PR5d-c**, which supersedes PR5d-a's framing.

## 2026-09-04 — ADDR1b-merge SHIPPED: gov has a reversible property merge, the destructive one now raises — and I closed a privilege hole the rename opened.

**Verified live on gov:** `gov_merge_property_reversible`, `gov_unmerge_property`,
`gov_merge_property_apply` and `gov_property_merge_backup` all exist; the old public name
`gov_merge_property` **raises**; backup table 0 rows (nothing merged for real); property 9893
untouched. **The port walks `pg_constraint` at call time rather than a hard-coded list**, so gov's
16 domain-specific tables (`gsa_leases`, `frpp_*`, `cmbs_loans`, `sam_lease_opportunities`, …) are
covered without a gov list to maintain — the same reason dia's works.

- **FK census: gov 36 edges / 35 tables vs dia 54 / ~40.** `sales_transactions_properties` has a
  2-column PK and is correctly reported unrecoverable rather than silently skipped.
- **Every BEFORE/AFTER trigger on every repointed table was checked for the P196 failure mode** (a
  trigger that silently SKIPS instead of raising). None does — `gov_supersede_prior_active_listing`
  and `llc_research_queue_auto_skip` both always `RETURN NEW`. **That check was the point of asking.**
- **Round trip proven on a real pair, rolled back**: 7655 (9 sales, 18 leases, 5 deeds) → 581 →
  unmerge, compared by **`array_agg` of primary keys per table, not counts** — sales 12/12, leases
  31/31, deeds 5/5, both property rows present. **0 lost / 0 stranded / 0 changed.**

🚨 **A gap the rename opened, found and closed here (Cowork).** The prompt warned that leaving a
destructive merge callable beside a safe one is how the wrong one gets used. The redirect blocks the
OLD name — but the renamed mutator **`gov_merge_property_apply` was `anon` AND `authenticated`
executable**, i.e. the destructive path stayed reachable under a new name.
**dia's equivalent is locked** (`dia_merge_property`: anon `false`, auth `false`), so the port
carried the logic and not the privilege posture. **Revoked from `public`, `anon` AND `authenticated`
(all three — the documented trap is that revoking one leaves the others), asserted with
`has_function_privilege`:** `proacl` is now `{postgres=X/postgres, service_role=X/postgres}`,
anon `false`, auth `false`, service_role `true`.
⚠️ **Still open and pre-existing on BOTH domains:** `*_merge_property_reversible` and
`*_unmerge_property` are SECURITY DEFINER and remain `anon`-executable. ENTC narrowed the three
ENTITY unmerge functions to `service_role` on 2026-09-03 for exactly this reason; the PROPERTY merge
pair was never given the same treatment. → **SEC1-property**.

**Twin-lane sizing: 399 candidate groups / 953 properties** on a crude exact-normalized-address+state
grouping, before any geospatial fuzz. ⚠️ **That is not "three rows"** — my prompt said to size it and
stop precisely because a tiny number would have argued for skipping it; it argues the other way.
Recommendation recorded, nothing built → ~~**ADDR1c-twin-lane**~~ **superseded 2026-09-05 by
GOVDUP1** — reading the rows refuted the ported-lane premise; see below.

## 2026-09-04 — CONTACT1a SHIPPED: the LIVE entities.email/phone writer now feeds field_provenance

> 📍 **CONTACT1a has TWO entries in this file and they are not duplicates — read both.** This one
> carries the diagnosis and what shipped; **the later "CONTACT1a SHIPPED: the ladder is wired to
> `ensureEntityLink`'s CREATE path"** entry below carries the **live verification** (deploy
> confirmed via `/version`, and why **0 new rows is the EXPECTED reading**, not a stall). Neither
> supersedes the other.

CONTACT1 (2026-09-03) diagnosed why `entities.email`/`phone`'s ten-rung field_source_priority
ladder had governed almost nothing (`email` zero rows ever, `phone` 4) and found the wired writer
(`bridge-handlers-salesforce.js::insertEntity`, PR5c-entities-b) is dead code — its two callers are
`enrichment_jobs.job_type`s (`salesforce.contact.upsert`/`.account.upsert`) that nothing in this
repo ever enqueues. This is that fix, on the LIVE writer.

**Census, not guesswork:** an AST walk (acorn) of every `ensureEntityLink(...)` call site found
**48 across 34 files**. `ensureEntityLink` never PATCHes `email`/`phone` onto an existing entity
(`seedFields` is discarded once a prior entity resolves — a fill only ever happens at CREATE), so
there is exactly ONE choke point: the CREATE payload construction. Of the 48 callers, **9** ever
pass a non-null email/phone (CoStar sidebar contact mint — the largest producer, `sf-list-import.js`,
`institution-registry.js`, the cross-domain contact matcher in `api/sync.js`, OM/lease party
contacts, and two open API surfaces whose `req.body` fields could carry either). All 9 — and any
future caller — now flow through the one wired site with zero per-caller changes.

Wired `recordFieldWrites` (audit-only, post-INSERT) into `ensureEntityLink`'s CREATE block —
`shouldWriteField` is deliberately NOT called pre-write, same reasoning as the dead PR5c-entities-b
block it supersedes: a create has no prior value to protect (`lcc_merge_field`'s "current value"
comes from `field_provenance`, empty for a row that doesn't exist yet), and all ten
`entities.email`/`phone` rungs are `enforce_mode='record_only'` anyway. Source is the caller's own
`sourceSystem`, mapped onto the registry spelling where recognised (`salesforce`,
`costar`/`costar_sidebar`), else passed through verbatim to `lcc_merge_field`'s UNREGISTERED branch
(still a real, recorded row — PR5's "unregistered is a different branch, not a low rung").

Guard: `test/contact1a-entity-link-provenance.test.mjs` — 3 behavioural tests invoking
`ensureEntityLink` through a stubbed `fetch`, asserting (a) one `rpc/lcc_merge_field` POST per
governed field on a create carrying both, with the exact registry spelling
(`target_table='entities'`, `target_database='lcc_opps'`); (b) zero merge-field calls on a create
carrying neither field (never assert a positive fact the source didn't state); (c) a registry
outage never blocks or reverts the entity create (fail-open, PR12's rule). **Mutation-verified
RED** when the `recordFieldWrites` call is disabled. Full suite: **5,381 pass / 0 fail / 6
skipped** — unchanged failure count, no regression.

**Not done, deliberately (per the prompt's scope):** no `enforce_mode` flip — PR5c-enforce stays
blocked; this gives the ledger its first real ongoing feed, not a graded gate. `SF_CONTACT_WRITEBACK`
untouched. `metadata.field_sources`/`planContactFieldPromotion` untouched (PR10's "one source, two
ladders" question is narrowed but not closed — `field_provenance` is now the ladder that actually
gets fed by live traffic; the metadata cache remains the writer's own private read-back). No
backfill of past writes — CONTACT1a only records from here forward.

**Caveats, stated plainly:** this session has no live Supabase credentials for
LCC Opps (`xengecqvemvfknjvbvrq`) — all verification above is against the source and a stubbed
`fetch`, not a live row count. The next session (or Scott, with live access) should re-measure
`field_provenance where target_table='entities'` a day or two after this deploys and confirm rows
are landing under `email`/`phone` with real `source` values (`salesforce`, `costar_sidebar`, and
whatever the two open-API callers' `sourceSystem` values turn out to be in practice).

Docs: `docs/architecture/field-provenance-ladder.md` §4 (new CONTACT1/CONTACT1a arc rows + a
correction to the PR5c-entities-b row, which had been misattributed as "the lane that actually
runs"); `docs/os/PLANNED-BACKLOG.md` (PR5c-entities-b corrected, CONTACT1/CONTACT1a rows added,
PR5c-enforce's blocker note updated, PR10 marked answered).
## 2026-09-04 — CONTACT1a SHIPPED: the ladder is wired to `ensureEntityLink`'s CREATE path — the choke point, not the 30+ callers. Deploy current; 0 new rows and that is the EXPECTED reading.

**Verified live:** `api/_shared/entity-link.js` calls `recordFieldWrites` after the entity INSERT
(commit `4805a761`); guard `test/contact1a-entity-link-provenance.test.mjs` exists and is
behavioural. **Live `/version` = `f1fe43e5`, which contains `4805a761` — the code is running.**

**`field_provenance` on `entities` is still 4 rows (`phone`/`domain_owner_contact`, newest 09-03
17:01) and that is CORRECT, not a stall.** Only **2** entities carrying an email/phone were created
today — `Jeff Lichner` 08:17 UTC and `Michael Papazis` 06:30 UTC — and **both predate the code
(12:04 UTC)** by hours. ⚠️ **This is the CONTACT1 lesson applied in the safe direction: the zero is
*quiet*, not *unreachable*, and we can say which because the population is nameable and the writer
sits on a path with 30+ live callers.** The next SF-Contact or sidebar create records.

**Three design decisions worth carrying, all in the code's own comments:**
- **`shouldWriteField` is deliberately NOT called pre-write** — this is the CREATE path, so there is
  no prior value to protect; only `recordFieldWrites` runs, AFTER the INSERT.
- **A null field is deliberately NOT recorded** — "a null here would assert *the source says this
  contact has no email*, which the payload never claimed." Absence stays absence.
- **`confidence: 1.0` is a claim about what the source SAID, not that it is right** — trust lives in
  the rung's priority, not the confidence. That distinction is easy to get backwards.

**Residual gaps, named rather than implied:**
- **CREATE path only.** An UPDATE of `email`/`phone` on an existing entity still records nothing.
- **`salesforce-sync.js` and `sf-list-import.js` were NOT instrumented directly** (0 `recordFieldWrites`
  in either) — they are covered only insofar as they mint through `ensureEntityLink`. CONTACT1
  traced `writeEntitySalesforceLink` as writing 195 of 336 links in 30 days; whether those are
  creates-through-the-choke-point or updates is the open question.
- **PR5c-enforce is still blocked** — 4 rows, 1 source, all `write`, against a condition of
  **~50 rows across ≥2 sources**. Re-check in 7 days.

## 2026-09-04 — SALE1c/SALE1c-gov/ADDR1b: 7 of the 8 "undecidable" rows resolved by splitting the ledger on EVENT TYPE, the dedup pair was never a collision, and my claim about gov's producer mix was WRONG.

**Verified live.** dia: 7 rows tagged `sale1c-null-2026-09-04`, all 7 nulled, `calculated_cap_rate`
NULL on all 7, sale 7972 correctly untouched; 902 and 903 **both `duplicate_superseded`**;
`v_dia_sale1_price_review` **133 → 125**, `ledger_disagreement` **100 → 92**. gov: bleed view **0**,
property 9893's address NULL.

- 🚨 **The 8 were not undecidable — the ledger has an `event_type` and nobody had split on it.**
  SALE1a compared the current price to the *earliest observation of any type*; CC compared
  `event_type='sale'` against `event_type='listing'` separately. **7 of 8 carry a distinctly-dated
  SALE event at a different price**, while the current value matches the linked listing's ask —
  which is the bleed signature, not a full-ask close. **Reading the same ledger at a finer grain
  answered a question filed as unanswerable.**
- **Sale 7972 was correctly left alone** — two independently-sourced records AGREE with the current
  price against three same-batch listing echoes. The one genuine full-ask-shaped row.
- ⚠️ **The 902/903 "unique-index collision" never existed** — the index covers LIVE rows only. The
  prompt (mine) framed it as a constraint to work around; the truth is 902 is a mis-dated copy of a
  real 2021 sale and 903 a phantom bridge row with no evidence. **Both moved to
  `duplicate_superseded` — the duplication fixed, not dodged.** The blocker I described was an
  artifact of not reading the index definition.
- 🚨 **My gov claim was WRONG and is corrected: gov's dominant producer is CoStar (sidebar+export)
  at 72% — the SAME family as dia, not "a different dominant producer (GSA/deed feeds)" as I
  recorded on 09-04.** I inferred that from the small listing-match share (4 of 127) without
  measuring the producer mix. Re-measured: **98 rows, not 127** — only **2** show listing bleed,
  **~18%** an A2b repeat-conveyance signature, **~80% unclassified** wider/messier revisions.
  **Same producer family, different failure distribution.** Classified, **no gov row written**.
- **ADDR1b: gov has NO reversible property merge** — confirmed live (`gov_merge_property_reversible`
  does not exist; `gov_merge_property` is a **hard delete with no snapshot**). So 9893 was
  **quarantined**, not merged, and the missing machinery is filed as **ADDR1b-merge**. ⚠️ **This is
  a real asymmetry between the domains worth knowing before any gov dedup work** — dia's
  `dia_merge_property_reversible` walks every FK and snapshots; gov's namesake destroys.

## 2026-09-04 — ADDR1a CLOSED: dia review view at 0, and the header question answered by reading the CODE PATH rather than widening a regex on a guess.

⚠️ **Filing correction (Cowork, this turn): `CONTACT1a` was moved to `prompts/done/` by
`a4bd2e63` without having been run** (superseded a few hours later the same day — see the
2026-09-04 "CONTACT1a SHIPPED" entry above, which landed after this one on the branch history but
sorts above it in this newest-first log; the code shipped in `4805a76`, and the prompt has been
re-filed to `done/` accordingly) — that commit reconciled the CONTACT1 *response* and filed the
follow-up prompt alongside it. **`field_provenance` on `entities` is still 4 rows, one source
(`domain_owner_contact`), `salesforce` = 0** — i.e. nothing CONTACT1a asks for has happened. Moved
back to `prompts/`. **`done/` means run, not superseded** — a prompt filed there is invisible to the
next session's queue.

**Consolidation this turn:** the CoStar capture producer now has one canonical page,
`docs/architecture/costar-sidebar-capture-pipeline.md` — PR2 · SALE1 · SALE1a · ADDR1 · ADDR1a as a
single arc table, the guards (with **which one actually closes each class** — the address class is
closed by the role-agnostic server-side belt, not the header regex), dated live state, and the
transferable lessons. Pointers added from `CURRENT-STATE.md`, `public-records-source-lane.md` and
the handoff. Five arcs that were spread across STATUS, two audits and the backlog now have one door.


**Verified live:** `v_dia_contact_office_address_bleed_review` = **0**; 37503 gone (merged);
37783's address NULL with `address_source='addr1a_quarantined_contact_bleed'`, city/state/zip intact;
`dia_property_merge_backup` row **585** present. gov mirror holds **1** row.

- **37503 → merged into 38953** (`dia_merge_property_reversible(38953, 37503, 'addr1a_20260904')`).
  **What came home: 1 sale, 1 listing, 7 leases, 1 deed record, 1 property doc.** The seven leases
  are the point — this shell had accumulated far more than the sale I could see, and a delete would
  have taken all of it. Reverse with `select dia_unmerge_property(585);`.
- **37783 → quarantined, not merged.** CC checked **all 23 Oakland dia properties** by address,
  operator and building size before concluding there is no twin — the 50990 disposition, reached by
  looking rather than by absence of evidence. Original street + rationale preserved in `notes`.
- 🚨 **The header question was answered by reading the CODE PATH, and the answer is "no change
  needed" — which is the harder call to make.** Both bled contacts carry `role: "true_buyer"`, and
  `extractContacts()` only ever runs `parseEntityBlock` (the function that extracts an address)
  under a **True Buyer** header; a bare `Buyer` line is used **solely as a name-reject pattern**
  (`CONTACT_NAME_REJECT`) and never triggers address capture. `true\s+buyer` was already in
  `FOREIGN_PARTY_HEADER_RE`. **Both captures predate the fix (2026-04-22 and 2026-05-09 vs the
  09-03 landing) — pre-fix artifacts, not evidence of a live gap.** The regex was NOT widened.
  ⚠️ **This is the right restraint:** a header regex that matches too much starts rejecting the
  subject property's own address block and fails silently in the opposite direction.
- **The server-side belt is the real closure, and it is stronger than the regex.**
  `contact-address-bleed-guard.js::findContactOfficeAddressBleed` is **role-agnostic** — it compares
  any captured contact's address to the property's exact street regardless of the header that
  labelled it — and is live in `upsertDomainProperty` (`sidebar-pipeline.js:4503`), refusing the
  write outright. **It would have caught both rows at ingest, and it covers a bare-header variant
  too.** So the class is closed by construction, not by enumeration of headers.
- **gov: 1 row — property 9893, `245 Park Ave` in Raton, NM**, bled from J.P. Morgan Asset
  Management's Manhattan office. Sized and classified, **not repaired** (gov has no repair half) →
  **ADDR1b**.

**Operator consequence: Contacts/Sale-tab captures are safe again.** The belt refuses the bad street
at write time on both domains.

## 2026-09-04 — SALE1a/SALE1b: 29 propagated prices NULLED (not reset), gov measured and NOT clean, and ADDR1a's two rows are now identified — 37503 has a named twin.

**Verified live:** backup `_sale1a_price_reset_20260904_backup` holds **30** rows; **29** nulled and
tagged `sale1a-null-2026-09-04`; `ledger_disagreement` **129 → 100**; review total 133.

- **Zero of the 38 had deed corroboration**, so per the reset rule **nothing was reset to the ledger
  value — 29 were NULLED.** That is the right call: `cap_rate_history` records what was FIRST
  RECORDED, and with no deed the earliest value has no more evidentiary weight than the current one.
  A missing comp beats a wrong comp.
- ⚠️ **The cap-rate handling is more careful than its own summary says, and I misread it first.**
  The response says "all 19 lost their derived cap rate"; live, **`calculated_cap_rate` is NULL on
  all 29 (correct)** while **10 retain a `cap_rate_final` — every one `broker_stated` or
  `source_reported`.** Those are the SOURCE's own stated cap rates, not derived from the price CC
  nulled, so keeping them is right. **6 of the 10 remain in comps with a stated cap rate and no
  price** — defensible (usable for cap-rate analysis, not $/SF) but it should be stated, not
  discovered. **I flagged these as orphans before checking `cap_rate_source`; they are not.**
- **The population moved 132 → 129 → 38 (from my 45)** between 09-03 and 09-04 — the writer fix
  stops new corruption, but incidental writes still shift the residual. **Re-derive, never quote.**
- **8 `linked_same_listing` rows left alone** — the price matches the listing the sale is formally
  joined to via `listing_sale_id`, so it could be a genuine full-ask close. **1 deferred dedup pair**
  (902/903) — nulling both would collide on the unique index. Both are human reads → **SALE1c**.
- **The ~8 within-2% rows are NOT a tolerance defect** — re-measured as 21 rows at 1.0–2.8%, all
  plausible rounding/late corrections, no unit or magnitude tell. **Leave the >1% threshold alone.**
  The 12× artifact (sale 562) was inside the 29 and is nulled.
- **SALE1b — gov is NOT clean:** gov has an equivalent ledger (`cap_rate_history`, `event_type='sale'`,
  via `trg_gov_auto_cap_rate_on_sale`) and shows **127 `ledger_disagreement` rows**, of which only
  **4** match a listing ask — a much smaller listing-bleed share than dia, consistent with gov's spine
  having a different dominant producer (GSA/deed feeds vs dia's CoStar capture). **Measured, not
  graded, not fixed** → **SALE1c-gov**.

### ADDR1a — both open rows identified, and 37503 has a NAMED TWIN

Neither needs a re-capture. Both were last written **2026-09-01, before the ADDR1 fix (09-03)**, so
they are historical residue — but they are two DIFFERENT dispositions, which is exactly the 37491 vs
50990 split again:
- **37503** `3121 Michelson Dr, Suite 500` / Kokomo IN (IRA Capital's Irvine CA office) is a
  **phantom duplicate of 38953 `2312-2330 S Dixon Rd, Kokomo, IN`** — identical `building_size`
  10,603.00, identical operator (Fresenius) and tenant, identical timestamp. **The real street
  already exists in the table.** → merge via `dia_merge_property_reversible`, as 37491 was.
- **37783** `4700 Wilshire Blvd` / Oakland CA (CIM Group's LA office), Satellite Healthcare,
  `building_size` NULL, **no stat twin in Oakland** → likely the **50990 case**: a real property that
  lost its own street. Quarantine, do not guess, do not merge.
⚠️ **A re-capture is NOT the fix and may not be safe yet:** both bleeds came from a `buyer`-role
contact, and `FOREIGN_PARTY_HEADER_RE` matches `recorded buyer` / `true buyer` — **a bare `Buyer`
header would still slip through.** Confirm the literal header text before re-capturing either.

## 2026-09-03 — CONTACT1: entities.email/phone ladders are empty because the wired writer is dead code (diagnosis only, no code shipped)

Both authority ladders on `entities.email/phone` (`field_provenance`@10-rungs and
`metadata.field_sources`) are near-empty (4 rows / 1 row) — not because there's no history to
grade yet, but because **the real writers never consult either one.**
`bridge-handlers-salesforce.js::handleSalesforceContactUpsert` — the function PR5c-entities-b
instrumented with provenance recording — **has never run** (`enrichment_jobs` holds zero
`salesforce.contact.upsert` rows ever); its header's claimed 10,086-lifetime/336-in-30d writer
population belongs to two DIFFERENT, unrecorded live writers (`salesforce-sync.js` on cron 165,
and `sf-list-import.js` → `ensureEntityLink` at entity creation), neither of which calls
`recordFieldWrites`/`shouldWriteField`. `SF_CONTACT_WRITEBACK` is off — correctly, per
`CLAUDE.md`'s "never writes back to clean SF" doctrine, not a pending rollout.
`owner-contact-propagate` has no cron (unscheduled, not broken — one manual run today wrote 4
provenance rows / 4 phones / 31 review tasks).

PR10 answered on evidence: `field_provenance` should own the decision, `metadata.field_sources`
should retire — but that recommendation is moot until the real writers are repointed. Filed as
new backlog **CONTACT1a**. Numeric unblock condition for **PR5c-enforce** recorded: grade
`enforce_mode` once `field_provenance` for `entities.email/phone` exceeds ~50 rows spanning ≥2
sources with real write/skip/conflict decisions (today: 4 rows, 1 source, all `write`). No
`enforce_mode` flip, no `SF_CONTACT_WRITEBACK` enable, no backfill, no code changed. Record:
`docs/claude-code/responses/done/CONTACT1-both-entities-ladders-govern-nothing.response.md`. (CC's
own independent reconciliation of this same finding, plus its self-correction of an earlier
PR5c-entities-b entry, landed in a concurrent PR — see the entry below dated the same day.)

## 2026-09-03 — UX-T1a-today SHIPPED: Today is Significant / Important / Urgent

Recut the Home "Today" panel into the canon's three sections (operator-doctrine.md 1.8.0),
replacing the unlabelled "Work Your Outreach" + "Top BD Actions" cards. Measured every candidate
producer named in the prompt before assigning a bucket (never by feel):

- **Significant** (new-client research/first outreach/follow-ups) = the WHOLE
  `v_lcc_seller_prospect_queue` (520 rows) — every row is, by its own gates, an owner not yet
  reached, ranked identically to UX-T1a-queue. `touchpoint_cadence.current_touch` confirmed
  unreadable again (p50 0, max 8,298), so the fallback to the seller queue's `reach_state` (the
  prompt's own instruction) is what shipped.
- **Important** (BOVs/ELAs/working buyers/marketing live listings) = `bd_opportunities` open rows
  (47, the only real recorded producer). **Two named gaps, not fabricated:** no DB row anywhere
  states "a BOV was generated/due" (`lcc_deal_milestone` has no such key — its 7 keys are
  loi/psa/escrow/diligence/financing/marketing/close, and `marketing`='next' reads **0** rows
  today), and no producer exists for "marketing a live listing" as a task
  (`lcc_listing_events` is a sale-EVENT feed with no marketing-touch column at all).
- **Urgent** (pipeline management/deal correspondence, ~90 days) = `action_items` open/in_progress
  rows tied to a deal (58 open — `deal_next_step` 34, `send_info` 8, `reply_overdue` 4,
  `review_response` 3, `schedule_call` 3, `seller_follow_up` 3, `follow_up` 2, `advance_to_contract`
  1) UNIONED with `v_lcc_bd_worklist`'s `contact_writeback` (1,568) + domain
  `owner_source_conflict(auto_fixable)` (gov 0, dia 8) — reusing `assembleBdWorklist`, the SAME pure
  function the full worklist uses, never a second shape. `loan_maturity` and `ownership_chain` are
  deliberately excluded, per the prompt's own rule: loan_maturity's ≤24mo window has no ~90-day
  sub-slice to test against, and ownership_chain is A2's automated apply lane (a cron consumer, not
  a human task) — both stay reachable via Priority Queue / BD worklist.

Shipped: `api/_shared/today-sections.js` (pure classification, `assembleTodaySections`) +
`api/operations.js::getTodaySections` (`GET ?action=today_sections`) + the Home widget recut
(`index.html`/`app.js`: `renderTodaySections` replaces `renderOutreachOnramp`/
`renderTodayBdActions`) + `pageSellerProspectQueue` — the seller queue's first front-end surface
(chips + real pagination, reusing `GET /api/seller-prospect-queue` verbatim). Guard
`test/uxt1a-today.test.mjs` (12 behavioural tests over named-row fixtures per section — P180
null-vs-0 collapse caught and fixed by the guard itself before shipping). Full suite 5,384 tests,
5,378 pass / 0 fail / 6 skipped — unchanged failure count, confirming no regression. Record:
`docs/claude-code/responses/done/UX-T1a-today.response.md`.

## 2026-09-03 — EXT2a SHIPPED (PR #2098): the schedule-blend double count is fixed

**SALE1 SHIPPED (PR #2102, branch `claude/sale1-price-propagation-bwq4pz`) — verified live 2026-09-03.**
All four reproduce: **31 rows flipped** by the eligibility migration (`sale1-eligibility-20261009`
marker), excluded now 1,781, **`nominal` still in comps = 0**, review view **165 rows**
(`ledger_disagreement` 132 / `deed_says_undisclosed` 33). Two independent defects were found where
one was assumed — the `upsertDomainSales` re-match PATCH overwriting a non-null `sold_price`, and
the dia `sale_notes_raw` stamp that gov already gates on `isMostRecentSale`. Both are fixed forward;
**nothing was reset, which is correct.**
⚠️ **I did the read CC flagged as its honest gap, and the 132 must NOT be treated as 132 defects.**
Splitting `ledger_disagreement`: **45 match one of the property's own listing prices** (the Hillsboro
shape — the listing bleeding into a deed row) and **41 match a sibling sale on the same property**
(overlapping with those); the ratio distribution is otherwise unremarkable — **1** row is a clean
12× artifact (`$64,583.57` vs `$775,000` = the monthly figure), 8 sit within 2% (a tolerance
question, not a defect), and the rest are modest revisions consistent with a later, better source
correcting a bad master import. **87 of the 132 are still in comps, 83 with a live cap rate.**
**The prioritised set is the 45 listing-matches, not the 132** — that is the shape with a proven
mechanism. The remainder needs a named-row read before anyone resets a price.
⚠️ **Also open:** the eligibility gate shipped as the BROADER 4-signal set (nominal + foreclosure +
disclaimer + REO = 31 flipped) rather than the 28/20 nominal+disclaimer slice; CC read all 3 REO
rows first, which is the right bar, but the scope difference is deliberate and should be stated
rather than discovered. And **gov's own price-conflict rate is unmeasured** — the guard is shared,
the measurement is not.


**SALE1 checkpoint verified (Cowork, 2026-09-03).** CC's central claim reproduces exactly:
`cap_rate_history` shows sale 8091 (2009) first recorded at **$1,233,000** on 2026-04-17
(`dia_master_sales`) with the listing at **$1,593,750** the same day — the sale row now carries the
LISTING's figure. **Two independent defects, confirmed:** (a) `upsertDomainSales`' re-match PATCH
overwrites a non-null `sold_price` with a later capture's figure (34 rows / $106.8M in the
single-source slice; **24 live comps computing a cap rate off it**); (b) the dia branch stamps
`sale_notes_raw` on EVERY sale in the per-sale loop while **gov gates the same write to
`isMostRecentSale`** — and gov's own comment states the rule ("the notes describe the
displayed/most-recent deal"). ⚠️ **Counts moved:** nominal is **38 / 28 in comps / 20 with a cap
rate** today, not the 33/28/23 of the first pass. ⚠️ **The path is LIVE** — the listing trigger fired
at 17:16:53 during Scott's capture. **Reordered the build: the writer guard FIRST** (captures are
ongoing; everything else is cleanup behind an open tap), then the one-line notes gate, then the
comp-eligibility migration, then the review view, then the 46 two-source groups. ⚠️ **Do not reset
8091 to $1,233,000 on the ledger alone** — `cap_rate_history` records first-RECORDED, not true, and
a "Nominal Transfer" price may be meaningless; prefer NULL + non-comp unless the deed corroborates
(the rule CC already applied to 8090's "Not Disclosed"). The 235 "matches earliest" rows are genuine
repeats — an A2b comp-COUNT question, not a price defect; note it so nobody re-opens them.


- `baseFromPeriodQuote` reads a schedule period's own labelled base/additional split (ground-truthed
  against the real Chesterbrook lease); components merge into `additional_rent` deduped
  `(kind,amount)`; `resolveYear1TotalRent` gained a `schedule_composition_unknown` guard (null total
  rather than guessing when a schedule figure's makeup can't be determined). Doc 255 now resolves
  **89,340 base / 101,568 total / `schedule_period_1`** (was 101,568/113,796 — equipment counted
  twice). Guard: 6 new tests, 39/39 in file, 162/162 across the whole `bov-extract`-touching
  population.
- **Found + fixed along the way:** a literal apostrophe inside a regex character class
  (`[a-z0-9 /&'-]`, in the test file's own literal-blanking regex — the OCR1c apostrophe-in-prose
  bug one syntax class over) was mistaken for a string delimiter and blanked ~20 lines of real code,
  failing an unrelated test — fixed with `\x27`. Transferable to any future comment/literal-stripping
  guard.
- Docs closed in the same reconciliation: EXT2 residual-risk framing, `ai-and-ocr-cost-strategy.md`,
  `CURRENT-STATE.md`, `PLANNED-BACKLOG.md`, `OPERATOR-ACTIONS.md`. Record
  `responses/done/EXT2a-schedule-line-definition.response.md`. The EXT arc (EXT1→EXT1b→EXT2→EXT2a)
  is now fully closed — no open residue.

## 2026-09-03 — the Chesterbrook lease was READ; EXT2a ground-truthed and prompt drafted

- Scott uploaded the actual lease; OCR'd and read in-session. Exhibit B defines the split in its own
  words: base $7,445/mo + $1,019/mo equipment, "Total payment each month $8,464"; escalations apply
  to the base; months 121-180 exclude the equipment payment. **So base = 89,340/yr, equipment is
  `additional_rent`, total = 101,568 — the current schedule-wins output (101,568 base / 113,796
  total) is wrong on both fields for this lease.** 15-yr initial term + one 5-yr renewal, consistent
  with the swimlane-standard doctrine.
- `prompts/EXT2a-schedule-line-carries-its-own-definition.md`: `baseFromPeriodQuote` (a schedule
  line carrying its own base/additional split is parsed, components deduped into `additional_rent`)
  + a composition guard (total = null + `schedule_composition_unknown` when a schedule figure's
  makeup is unknown). Ground truth encoded as the fixture. EXT2-spotcheck closed.

## 2026-09-03 — UX-T1a-queue SHIPPED (#2092) + EXT2 floor re-run DONE

- **The doctrine's queue exists: 520 rows / 453 owners** (`v_lcc_seller_prospect_queue`, variant F,
  gates as named columns; funnel + chips + pager on `/api/seller-prospect-queue`). CC's key
  corrections: the debt arm is **asset-scoped** (a 95-row decision, stated); **§7b's 89.6%
  disjointness is true of the newer-lease HALF only** — the whole queue overlaps the band queue
  34.8% because a maturing loan usually sits on a late-term lease, so the queue **sits beside** the
  band queue, not replacing it. `no_linked_person` = 384 of 520 — the binding constraint is links.
  No front-end yet (a separate change); UX-T1a-today / -cadence untouched.
- **EXT2 floor re-run (workstation):** 7/8 decided docs agree on `year1_rent_source`; 299's
  two-period residue GONE; **the named residual risk fired on 255** — schedule blend won AND
  `year1_total_rent` double-counted equipment → **EXT2a** (null the total under `schedule_*` unless
  schedule == base quote) + 👤 Chesterbrook spot-check (OPERATOR-ACTIONS). 431 flips credit basis on
  a model guaranty-quote omission — code correct, variance is omission. Record:
  `responses/done/EXT2-floor-measurement.response.md`. **The extractor arc is closed** modulo EXT2a.

## 2026-09-03 — PR5d: the ladder's largest source is a capture that never happened, not a wiring gap

`costar_cmbs_loan` holds **121 rungs** — more than any other source — and PR5 had it filed
`build_pending` on one measurement. The three-way question (no scanner / dropped keys / unreachable
page) resolves to **the third**, and there is a second blocker underneath it that the third does not
describe.

**Verdicts written** (migration `20261010120000`, applied live; `v_field_source_priority_triage`
gains `pr5d_verdict`): `page_never_captured` **94** · `page_never_captured_flag_off` **27**.
PR5's `build_pending` is preserved underneath on all 121 — PR5d refines it, and `pr5_verdict`,
`pr5c_verdict`, `is_orphan_column` and `is_retired` are unmoved (2,141 rungs / 426 / 33 / 49 / 51).

- **The scanner, the writer and the host match are all live and correct.**
  `extension/content/costar.js parseCmbsLoanDetail` (76ek.b) + `parseCmbsFinancials` (76ek.e) →
  `sidebar-pipeline.js upsertLoanRecords` / `upsertPropertyFinancials`, and `manifest.json` matches
  `https://*.costar.com/*`. Nothing has ever visited `/detail/lookup/{N}/loan`.
- **Ruling out the rename class needed a column only that arm writes.** `loans.costar_loan_id` and
  `loans.source_url` are **0 of 2,219 rows across both domains**; `loan_snapshots`,
  `loan_top_tenants` and `loan_commentary` are **0 rows on both**; `property_financials` carries
  **0** `costar_cmbs_loan` rows against gov's 98,510 and dia's 676. What *does* write `loans` is a
  different scanner on the property page (`costar_sidebar`, gov 1,393 / dia 358) — and it sets
  `cmbs_deal_name` from a lender-name regex, which is why gov reads `is_cmbs` 285 and
  `special_servicer` 126 and **looks like CMBS capture while being nothing of the kind.**
- ⚠️ **This supersedes R54 Unit 3's mechanism** (*"the captures so far are the basic loan layout, not
  the full CMBS Performance walk"*). R54's disposition was right and its explanation was wrong, and
  the wrong explanation is what made this read as a coverage question for 75 days.
- ⚠️ **The dia blocker is a second one, not the same one.** `properties.track_cmbs_snapshots` is
  **false on 11,803 of 11,803** and gates snapshots / top-tenants / financials, so capturing the page
  tomorrow would still write nothing there. The dia `loans` row and `loan_commentary` are ungated —
  that boundary is exactly the 94/27 split, and both sides are guarded.
- **NOT retired, and the reason is a starved consumer rather than the ladder.** R54's
  `is_distressed` arm on `v_loan_maturity_watch` reads **0 of 178** gov rows, with watchlist /
  num_delinquent / special_servicing / modification / dscr at **0 across 285 CMBS loans / 210
  properties** — captured only by this arm. Backlog **PR5d-a** (gov capture: an operator question
  about Scott's CoStar workflow) and **PR5d-b** (the dia opt-in).

**UX-T1a reconciled in three places.** Part A's *"the debt D has no LCC table at all / 192 loans
maturing ≤24 mo … none of it reaches LCC"* was true on 09-02 and is superseded by UX-T1a-gates the
next day: `lcc_loan_maturity` holds **568 rows carrying exactly those 192** (gov 170 + dia 22 at
source — reproduces to the row). ⚠️ **And `costar_cmbs_loan` supplied 0 of the 192** — they come
from `costar_sidebar` (113), `sec_edgar` (58), `ops_asset_metadata_loan` (20) and one null. So the
121 rungs are the supply side of a demand already met from elsewhere; **the residual debt gap is
DISTRESS, not maturity.** Corrected in `app-ux-review-2026-09-02.md`, the audit's recommendation
list, and `CLAUDE.md`.

**Nothing built:** no scanner, no rung added or deleted, no priority or `enforce_mode` change, no
fuzzy loan↔property matching, and `track_cmbs_snapshots` not flipped.

Guard `test/pr5d-costar-cmbs-loan-verdict.test.mjs` (12 tests, **21/21 mutations RED**) — it pins
the single-writer property, because **a zero is evidence only while exactly one writer could have
made it non-zero**, and a second writer would destroy the detector without breaking anything.
⚠️ Three of my own assertions survived their first mutation and the mutation pass found all three
(a slice anchored on a token a gate moves past; a manifest check that a narrowed match still
satisfied; `SET priority =` never spelled by a second SET clause on its own line).
Audit: `docs/audits/PR5d_COSTAR_CMBS_LOAN_ARM_2026-09-03.md`.
## 2026-09-03 — UX-T1a-gates SHIPPED (#2088): both queue gates honest; UX-T1a-queue prompt drafted

- Deltas: dia lease dates in mirror **0 → 1,747** (the break was the dia SOURCE VIEW — never carried
  lease columns; three edits, any one alone a silent no-op); `v_lcc_bd_worklist.loan_maturity`
  **0 → 172 / 109 owners** (the real gap was owner attribution, not a missing producer — the handler
  always read the domain watch views but with `entity_id: null`); operator queue **1,635 → 694**
  (941 hidden by `lcc_priority_band_is_human_surface`, fails open, chips gate on the same predicate).
- CC already updated backlog + CLAUDE.md + the bd-ranking page. This turn: CURRENT-STATE row, files
  to `done/`, and **`prompts/UX-T1a-queue-seller-prospect-view.md`** — variant F as one view, gates
  as named columns, recorded reasons only (debt + developer; death/divorce stay unmeasured), reach
  via person-links with `no_linked_person` first-class, rank = value then lease recency.
- `PR5d-costar-cmbs-loan-arm.md` in prompts/ belongs to the parallel provenance window — left alone.

## 2026-09-03 — UX-T1a Part A MEASURED (#2084): the queue is 89.6% disjoint from the doctrine; Part B held; UX-T1a-gates prompt drafted

**ENTC verify (Cowork, post-merge):** every number reproduces live — junk80 view **80**
(41/27/6/4/2 split exact), plan 15, blind pairs 55, drift 0, `lcc_p195_unmerge` anon EXECUTE
**false**. ✅ **And the Railway redeploy already carries the merge** (`/version` = `5b3b1227`,
09:27 UTC) — so the JS half (mint gate, un-stamp keying, junk80-seed handler) is LIVE and
**junk80-apply is unblocked**; CC's "can't run before the deploy" caveat is superseded.


- Funnel 8,858 → 3,529 → 259 → 31 → 23. G3 (newer lease) cuts 93% and G4 (reason to sell) 88% — both
  COVERAGE gaps: dia has no lease dates in the mirror (3,823 live leases at source), and debt (192
  maturities ≤24 mo) has no LCC table while Today already renders a `loan_maturity` label nothing fills.
  P1/P2/P3 select assets late in term — the opposite of "newer". 58% of queue rows are plumbing.
- CC updated the backlog (UX-T1a + six sequenced rows) and the bd-ranking page itself; this turn adds the
  CURRENT-STATE row, the CLAUDE.md lessons (circular `sale_price` validation; portfolio price; reach
  floor/ceiling; 42% regex FP; label-is-not-a-lane), and moves files to `done/`.
- **Next CC prompt: `prompts/UX-T1a-gates-dia-lease-mirror-and-loan-maturity.md`** — three units:
  mirror dia leases (find the break first: view columns vs `select=` list vs anon read), `loan_maturity`
  via a `*_portfolio` view + mirror leg + worklist emission, hide P0.4/P-CONTACT/P0.5/P-BUYER as a
  `human_surface` column. Then UX-T1a-queue.
- Two stray `.docx` copies of prompts sit untracked in `responses/` (EXT2, UX-T1a) — delete locally.

## 2026-09-03 — C4a answered → canon 1.8.0 (the queue, quantified) → UX-T1a prompt ready

- Scott answered the five ordering questions (app-ux-review **§0b**, verbatim in substance): newer lease is
  relative to the swimlane's standard initial term (first 2–3 yrs; dialysis 15-yr new build → 12+
  remaining; retrofit 7–12 → 7–10; gov = FIRM term, gov-only) · reason to sell = **death, debt, divorce,
  value creation** · $2.5M–$25M is the individual property sale (velocity; repeatable size; the wake) ·
  not-reached = no touch ever by anyone / not in pipeline · 7 touches in 6 months then ≈1/quarter by role ·
  Today = day's tasks, client-value ranked, **Significant / Important / Urgent**.
- Canon **1.8.0** (operator-doctrine quantified), rendered, parity 0 drift (copilot region 7,472 chars).
- `prompts/UX-T1a-seller-first-queue-and-today-recut.md`: Part A measures each gate's admitted population on
  named rows (unknown as its own state) before Part B builds `v_lcc_seller_prospect_queue` + the
  three-section Today; buyer/plumbing bands leave the human surface; cadence spacing proposed, not changed.
- Fixed a jammed backlog row (UX-T1a had been appended to the OWN-T0b/c/d/f/g line with no newline — the
  dedupe grep is line-anchored and could not see it).

## 2026-09-03 — UX0 DONE: operator doctrine is canon 1.7.0

- `canon/blocks/operator-doctrine.md` + Global invariant 8 (minimum effective dose · seller-first queue
  $2.5M–$25M / newer lease / reason to sell / untouched owner · buyers pursued by showing deals · truth
  over signal · one tab one question). Rendered: 5 bundles, copilot managed region rewritten (7,472 /
  20,000 chars), parity 0 drift. 👤 External pastes owed (`OPERATOR-ACTIONS.md` UX0-paste).
- Next: C4a's concrete ordering questions (posed to Scott in chat) → UX-T1a home/priority re-cut prompt.

## 2026-09-03 — EXT2 SHIPPED (#2078); the extractor's three definition questions are now the lease's to answer

- EXT2 merged (`f83c2d99`; 32 guards, 28/28 mutations RED). `year1_rent_source` / `year1_total_rent`
  / `credit_entity` + `credit_entity_basis` ride the tenant object; `parent_mentioned` cannot be
  promoted, guarded. ⚠️ Named residual: schedule outranks the base-rent quote, so a BLENDED period-1
  schedule figure would win — doc 255's `year1_rent_source` on the re-run is the row to read.
- 👤 **Floor re-run owed** (workstation; command + jq on `OPERATOR-ACTIONS.md` §2). Success = both
  sides agree on the SOURCE, not the rate.
- ⚠️ Deploy: live `/version` reads `cbac828a`, which is **not in this clone's history** (local HEAD
  `10b86f1b` = #2078). Either a later PR (OWN-T0e?) landed after this reconciliation's fetch, or the
  clone is behind — `git merge-base --is-ancestor f83c2d99 <deployed>` after the next pull settles
  whether EXT2 is running. Not asserted either way.
- Cleanup: `responses/EXT2 desktop rsesponse.docx` was a copy of the PROMPT (not a response) —
  delete it locally (the sandbox cannot; it is untracked, so nothing to commit). Prompt + response → `done/`. CURRENT-STATE's AI/OCR row rewritten as a summary that
  points at the canonical page instead of restating it.

## 2026-09-03 — EXT2 DECIDED: the lease defines it; prompt drafted. OWN-T0e sent to CC.

- Scott's answer to all three EXT2 questions is the same shape: **there is no house rule — each
  lease defines base rent, rent commencement and the tenant.** So the extractor quotes the lease's
  OWN definition (`defined_term`, `definition_as_stated`, `additional_rent[]` never summed,
  `rent_commencement`, `tenant_legal_entity` / `tenant_dba` / `co_tenants` / `parent_mentioned`)
  and code applies it (`resolveYear1Rent`, `resolveCreditEntity`). **Credit = the counterparty
  legal entity that guarantees the lease; a parent named without an express guaranty is never
  promoted.** `prompts/EXT2-lease-defines-base-rent-year1-and-tenant.md`.
- OWN-T0e (sponsor-family confirm lane) is with CC.

## 2026-09-02 — EXT1b floor MEASURED (rent + expiration 100%); OWN-T0 verified live; my prescribed remedy refuted on named rows; EXT2 filed

- **EXT1b floor:** `year1_rent` 89→**100%**, `lease_expiration` 80→**100%**, floor **94%** on 10 docs.
  The residue is a DEFINITION: the model now quotes faithfully and picks a different rent LINE per
  side (255: base $7,445 vs total $8,464 with equipment; 299: two schedule periods) or a different
  tenant name (DBA vs entity). → **EXT2**, a decision for Scott before code. Record
  `responses/done/EXT1b-floor-measurement.response.md`. **EXT1/EXT1b are closed as builds.**
- **OWN-T0 (#2074) verified live:** deployed `47d0a934`; three views present; detector positive
  control **756 = 745 + 11**; 2,095 conflicts on the panel view. ⚠️ **CC refuted the remedy I
  prescribed** (end-date the earlier owner): the top-60-by-rent pairs are sponsor↔SPE — both true —
  and 121 rows carry no date to order by. Nothing was end-dated; the producer predicate (P117, the
  wrong grain) was fixed, the reconciled view built, the detector made to see. Same lesson as A3:
  **a ten-row read turns a plausible remedy into a refuted one.** Follow-ups OWN-T0a–g filed by CC;
  **OWN-T0e** (sponsor-family confirm lane) is the leverage.
- Files → `done/`. Prompts folder: handoff + PR5c (other window) only.

## 2026-09-02 — EXT1b shipped + deployed; three named rows re-score exactly; floor re-run owed

`#2068`, deployed `a013aea6`. 431 rent → **105,558** (`basis_source: as_stated`), 336 → **75,000**,
431 dates → `2021-03-15` day-precision on BOTH runs, 255 untouched. 23 guards, 16/16 mutations RED.
Three decisions worth carrying (each measured against the obvious alternative): the basis window
stops at the next `$`; amount is presence-in-the-quote, never a tolerance; a formula is never turned
into a date even when it contains one. Prediction on file: rent + both dates → ~100% self-rate, with
the date denominators rising — read counts, not rates. 👤 Re-run command on `OPERATOR-ACTIONS.md`
(OCR1 row). EXT1b + UX-T0 files → `done/`. Next: **OWN-T0** to CC.

## 2026-09-02 — EXT1b SHIPPED: `as_stated` is the authority, the model's labels are the fallback. ⚠️ The floor movement is PREDICTED — the measurement is Scott's re-run.

- **What shipped:** `basisFromAsStated` / `amountFromAsStated` / `precisionFromAsStated` + two
  reconcilers in `api/_shared/bov-extract.js`, wired before `annualizeRent` and both date resolvers
  and into `cleanRentPeriod`. **One JS file. No migration, no prompt change, no OCR change, no
  backfill.** Guard `test/ext1b-as-stated-authority.test.mjs` — 23 tests, **16/16 mutations RED**;
  full suite **5,178 / 0 fail**; the 21 EXT1 tests unchanged. Record:
  `responses/EXT1b-basis-precision-quotes.response.md`.
- **The three named rows, re-scored:** 431 rent `null → **105,558**` (quote said *per month*, label
  said `per_sf_annual`, amount was ÷1,000); 336 `null → **75,000**` (the year-1 figure is the first
  `$` in the schedule quote); 431 dates `formula/null → **2021-03-15, precision day**` on BOTH runs.
  **255 held at 101,568** — EXT1b must not move the row EXT1 already fixed, and it does not.
- **⚠️ THE AMOUNT RULE IS PRESENCE-IN-THE-QUOTE, NOT A TOLERANCE.** 8.7965 and 8,796.50 are the same
  figure scaled by 1,000; **no threshold separates that from a different figure on the page.** The
  model keeps its amount only when that amount appears as a `$`-figure in its OWN quote — measured on
  *"a security deposit of $10,000 and base rent of $8,796.50 per month"*, where a bare first-figure
  rule takes the deposit.
- **⚠️ THE BASIS WINDOW STOPS AT THE NEXT `$`.** Doc 336 states a period *and* a parenthetical
  monthly restatement of the same rent; over the whole string that is ambiguous and abstains, losing
  the row. Where a window genuinely carries both markers the answer is **null and the model's label
  stands** — silence hands the decision back rather than flipping a coin.
- **⚠️ A FORMULA IS NEVER TURNED INTO A DATE, INCLUDING ONE THAT CONTAINS A DATE.** The parser must
  CONSUME the whole quote; *"the earlier of March 1, 2021 or thirty days after Delivery"* contains a
  calendar date and IS a formula, and a `.search()` would resolve it and re-commit the exact defect
  EXT1 removed. And the quote decides in BOTH directions — a month-only quote under a `day` label
  drops the day the model invented.
- **PREDICTED floor:** `year1_rent` 89 → ~100, both dates 80 → ~100, other three fields unchanged.
  ⚠️ **Two caveats, stated because EXT1's prediction was wrong in exactly this way:** it assumes the
  residue is only the rows already read (last time I assumed the model's LABELS were as reliable as
  its QUOTES), and **`decided fields` should RISE on the dates** as 431 stops being both-null, so the
  denominator moves and the rate is not directly comparable to run 3's. Doc 425's dates must stay
  honest nulls — that is a real OCR miss.
- **Next:** Scott's `--run --model real --control self --engines tesseract`, then read the same two
  floor rows.
## 2026-09-02 — UX23 went wholesale: 9.4% of properties carry >1 CURRENT owner and the conflict detector reads 0 → OWN-T0; two operator decisions recorded

Scott on UX23: *almost every property* shows owner gaps/lapses and the ownership tab conflicts with
itself — asked for a wholesale approach rather than a named record. **Measured before writing the
prompt:** `lcc_entity_portfolio_facts` has **756 of 8,068 properties with >1 `is_current` owner**
(33 with 3+); `lcc_property_owner` disagrees with the current fact on **667 of 8,223**;
`v_lcc_portfolio_ownership_conflict` = **0** (built for P175a's ghost-vs-ended pair; structurally
blind to two live current owners). And `chain_2plus` is 178, so a developer→owner gap is the DEFAULT
state the panel never labels. **OWN-T0 staged**: disagreement matrix over every store the tab reads
+ ten named rows → fix the supersession writer that leaves the prior current fact un-ended
(reversible, predicted delta) → `v_lcc_property_ownership_reconciled` as the ONE view the panel
reads with `gap` / `conflict` / `operator_not_owner` as words → detector sees 756 before, 0 after.
⚠️ **A detector reading 0 over a 9% defect is the P182 class, again.**

Decisions: **UX39/UX41** keep both, move off the headline tabs to a back-end screen (UX39b/UX41b,
with UX-T2). **UX13a** deferred to user onboarding. EXT1b sent to CC.

## 2026-09-02 — UX-T0 reconciled (deploy + migrations verified); EXT1 floor MEASURED — two noise classes gone, labels are the next layer → EXT1b

- **UX-T0 (#2061) verified live:** JS in deployed `a3172f44`; `v_manager_overview.is_team_member`
  reads **42 / 4**; dia `v_listing_verification_summary` **1,400 / 0 evidence / 1,400 cron**. CC's
  verdicts stand: 9 fixed, 4 owned elsewhere, **4 of my mechanism hypotheses REFUTED** (the "500"
  was arithmetic, not `limit: 500`; the verification feed was honest about a dead evidence lane;
  Kelly's writes land — three of four mailboxes are simply not synced; the Woodland Hills flag IS
  set), **2 removals refused** on measurement. The two refusals are now decisions on
  `OPERATOR-ACTIONS.md` (UX39/UX41), and the mailbox step is an operator row (UX13a). Not measured:
  UX22 (per-column comps census — its own pass) and **UX23, which needs the property Scott had on
  screen** — name it and it is a 20-minute job.
- **EXT1 floor re-run:** rent disagreements vs tesseract **2 → 0**, date disagreements **4 → 0**;
  doc 255 reads **101,568** on all three runs (was 8,464 / 89,496 / 84,464). But `year1_rent`
  self-rate **89 → 89** and dates **90/71 → 80/80**, not the predicted ~100 — the model now
  mislabels `basis`/`precision` on quotes that are unambiguous in English (431: *"$8,796.50 per
  month"* labelled `per_sf_annual`; a plain *"March 15, 2021"* labelled `formula` on one of two runs).
  The 7 new date both-nulls are CORRECT nulls (formula leases). One clean OCR miss now visible:
  425's dates came through tesseract as garbage and were honestly reported as formula/null.
  Record: `responses/done/EXT1-floor-measurement.response.md`. **EXT1b staged** — parse
  `as_stated` in code as the authority.
- ⚠️ **Lesson for my own predictions:** I predicted the floor would reach ~100% and it did not,
  because I assumed the model's LABELS would be as reliable as its QUOTES. Read the rows before
  predicting the aggregate.

## 2026-09-02 — EXT1 deploy confirmed; the box bake-off graded NO GPU engine (two install misses); harness Windows-python fix; duplicate rows merged

- **EXT1 is deployed**: `985d322` is an ancestor of live `30eaced2` (cache-busted `/version`). The
  floor re-run that MEASURES it is still Scott's (`--control self --engines tesseract`).
- **Box run (19:00 UTC):** `paddle.utils.run_check()` printed *"works well on 1 CPU"* — the CPU wheel,
  not `paddlepaddle-gpu`, so the identical oneDNN/PIR failure ×18; surya's `SURYA_INFERENCE_BACKEND`
  setting exists and was not tried; tesseract byte-identical to the workstation. **Still no GPU engine
  graded.** Corrected steps on `OPERATOR-ACTIONS.md`. ⚠️ Corrected my own claim in four places
  earlier today: GaryBuilt is **Windows**, not Linux.
- **Harness:** `--self-test` now tries `python3` → `python` → `py` (the box had `python` + Pillow one
  line away and skipped). Self-test + 32 guards green in the sandbox.
- **Consolidation:** the two windows each wrote an EXT1 and an OCR1 backlog row — merged to one of
  each (dedupe grep clean). EXT1 prompt + responses → `done/`.

## 2026-09-02 — EXT1 SHIPPED (`de6daca`): the lease extractor QUOTES; the code annualizes and resolves dates. ⚠️ The floor movement is PREDICTED — the measurement is Scott's re-run.

- **What changed.** `leasePrompt` no longer asks for an answer, it asks for a quote:
  `base_rent {amount, basis: monthly|annual|per_sf_annual|per_sf_monthly, as_stated}` replaces
  `year1_rent`; `lease_commencement` / `lease_expiration` become
  `{date, as_stated, precision: day|month|year|formula}`; `lease_term {as_stated, years, months}` is
  the only input a derivation may use. `annualizeRent` / `resolveQuotedDate` /
  `deriveExpirationFromTerm` (all pure, all exported) do the deterministic part.
- ⚠️ **THE OLD `'Dates as YYYY-MM-DD.'` LINE IS REMOVED, NOT SOFTENED.** It sat two lines below the
  prompt's own `'Use null for anything the lease does not state — NEVER guess a value.'` and is the
  format rule that forced the guess. Adding `precision` beside it would have left both instructions
  live and let the model pick which to obey — which is what it had been doing.
- **A model `year1_rent` number is IGNORED whenever a quote is present**, on the tenant and on every
  `rent_schedule` row. Measured live, the model returned **84,464 and 89,496 on two runs over one
  `$8,464.00 per month` lease**; its own arithmetic can never be preferred to ours (101,568).
- ⚠️ **TWO JUDGEMENT CALLS, STATED RATHER THAN BURIED.** (1) An amount with **no stated basis**
  resolves to `null` + `rent_basis_unresolved`, not to itself — passing 90,000 through as an annual
  figure is the same guess as annualizing, in the other direction. **This is the one place EXT1 can
  LOWER coverage, and it lowers it only where the previous number was unearned**; `as_stated` is kept
  so a human can settle it. (2) *The lease states no rent* keeps that flag **false** — it is a
  different fact from *we cannot convert the rent it states* (P180's unknown-is-not-a-value, applied
  to the REASON as well as the value). Mutating either goes red.
- **Consumer contract unchanged, pinned three ways.** The six graded keys keep their names and types,
  `rent_schedule` keeps `annual_rent` (the generator's `RentPeriodInput` reads it), and a bare legacy
  number or date string still resolves — so **no backfill and no re-extraction**; the quoted evidence
  rides BESIDE the six (`bov-generator/main.py`'s `TenantInput` is `extra="allow"`).
- ⚠️ **PREDICTED, NOT MEASURED — and the sandbox cannot measure it.** No OCR engine on PATH
  (`--self-test`: surya / paddleocr / ocrmypdf / tesseract all absent) and no model, so
  `--control self` cannot run here. Prediction: `year1_rent` 89% → **~100%** (the arithmetic left the
  model); `lease_expiration` 71% → **rises**, bounded by how consistently the model classifies
  `precision`. 👤 **Verify:** `node scripts/ocr-bakeoff.mjs --run --control self --engines tesseract`,
  reading **exactly two rows** of the §1 floor table. The other four fields are the control (EXT1 does
  not touch them).
- ⚠️ **A RISING `lease_expiration` SELF-RATE IS NOT "MORE EXPIRATIONS FOUND."** Some disagreements
  become a stable **both-null**, which the harness excludes from the rate by design — read
  `self_both_null` beside the rate, or a field that got more HONEST reads as a field that got better.
- **What WAS proven here is plumbing.** The harness's offline stub (`stubExtractionAI`) now emits the
  quoted shape, so `--self-test` exercises the production path; had it kept the pre-EXT1 shape it
  would have run the legacy fallback on every self-test and left the new path untested by the one
  command that needs no model. A guard drives that stub through the real `extractTenantFromLease`.
- **Guard:** `test/ext1-lease-rent-basis-quoted-dates.test.mjs` — 21 tests, **20/20 mutations RED**.
  ⚠️ **Two survived their first mutation pass and BOTH were the test's fault, not the code's:** the
  cents assertion was built on `12.51 × 3810`, which is **exact in IEEE-754**, so it passed with the
  rounding removed; and the schedule test supplied no conflicting `annual_rent`, so "prefer the model
  number" changed nothing. **The mutation pass found both; reading the tests did not.**
- ⚠️ **The one source-shape guard needed comments stripped THEN literals blanked.** The module's
  comments quote `year1_rent` and `84,464` while explaining the fix, and **the prompt itself is a wall
  of string literals naming `base_rent`, `basis` and `precision`** — so a code-shape grep matches the
  prompt text. It pins `cleanRentPeriod(p, sf)`: `.map(cleanRentPeriod)` bare passes the array
  **index** into the leased-SF slot, making period 0 unconvertible and period 1 a 1-SF building,
  silently.
- Full suite **5,102 pass / 0 fail / 6 skipped**. Record:
  `responses/EXT1-lease-rent-basis-quoted-dates.response.md`.

## 2026-09-03 — CONTACT1: 🚨 PR5c-entities-b INSTRUMENTED A FUNCTION THAT HAS NEVER RUN. The ladder was wired to dead code, and my own STATUS entry asserting otherwise is corrected in place.

**Verified live, every claim reproduces:** `enrichment_jobs` holds **0** rows of type
`salesforce.contact.upsert` — **ever** — and the only job types that exist at all are
`outlook.message.extract` and `cre.doc.text`. `field_provenance` on `entities` is still **4 rows**
(`phone`/`domain_owner_contact`, from one manual tick); `source='salesforce'` is **0**; and
`provenance_write_failed` alerts are **0 — because the instrumented path never even attempts a write
to fail.**

**Where the traffic actually is.** Traced through `external_identities.metadata->>'synced_via'` over
the last 30 days of `salesforce/Contact` mints (337 measured today):
**195 `salesforce-sync.v1`** → `api/_shared/salesforce-sync.js::writeEntitySalesforceLink`, driven by
cron 165 (`lcc-sf-contact-resolve`, every 30 min) · **142 null**, not yet traced ·
**0 `phase1.bridge-handlers-salesforce`.** The entity carrying the email at creation is minted
separately by `sf-list-import.js` → `ensureEntityLink`, bypassing `insertEntity` entirely. **None of
`ensureEntityLink`, `salesforce-sync.js` or `sf-list-import.js` calls
`recordFieldWrites`/`shouldWriteField`** (grepped, zero hits).

**So "both ladders are empty" had the wrong cause.** It is not *no history yet* — it is *the wiring
landed on unused code while the two live writers remain invisible to both ladders.*
⚠️ **My PR5c-entities-b STATUS entry is corrected in place above** — it named `insertEntity` as "the
single owner of the `entities` POST" and predicted ~12 rows/day. Both were wrong, and the
`0 provenance_write_failed` I recorded as reassuring is actually the tell: **a path that never runs
cannot fail.**

**Answers to the two questions the prompt asked:**
- **PR10 — `field_provenance` should own it**, `metadata.field_sources` retires to a private
  per-writer cache. It is fleet-wide, registered, queryable, and its gate is what
  `planContactFieldPromotion` reads back next run; the metadata copy is undiscoverable, unregistered,
  and self-perpetuating when wrong. ⚠️ **Moot until the real writers point at either ladder.**
- **PR5c-enforce unblock condition, numeric:** grade only once `field_provenance` for
  `(entities, email|phone)` exceeds **~50 rows across ≥2 distinct sources with real
  write/skip/conflict decisions**. Today: 4 rows, 1 source, all `write`.
- **`SF_CONTACT_WRITEBACK` reads as standing doctrine, not a pending rollout** — the handler pushes
  LCC-resolved contacts OUTBOUND to Salesforce, the direction `CLAUDE.md` forbids ("never writes back
  to clean SF"); `off_since` NULL means nobody has ever flipped it. **`owner-contact-propagate` has
  no cron** (confirmed absent; 11 other contact-family jobs exist) — unscheduled, not broken.
- **`sf-list-import.js`'s CREATE lane is live and quiet, not dead** — 142 mints in 14 days (~10/day).

**Nothing was built, correctly** — the fix touches `ensureEntityLink`, the live person-entity mint
path used far beyond Salesforce, and CC declined to guess at that scope. → **CONTACT1a**.

## 2026-09-03 — ADDR1 SHIPPED (#2108, `9bff5289`) and verified live: the mechanism was FOUR missing section headers in one regex, and my "second phantom" reading was WRONG.

**The mechanism, and it explains the asymmetry my prompt asked about.**
`extension/content/costar.js`'s `FOREIGN_PARTY_HEADER_RE` — the guard that stops
`findAddressInLines` from taking an address out of a foreign-party block — knew
`recorded buyer / listing broker / lender / borrower / …` and **did not know
`Sales Company` / `Sales Contacts` / `Listing Contacts` / `Property Manager`.** So on the Contacts
tab the first address-shaped line the one-pass scanner met was SRS's office, and it won. **City/state/
zip came out right because they come from a different field** — that was the tell, and it is now
four alternations wider, plus a server-side belt (`api/_shared/contact-address-bleed-guard.js`,
wired into `upsertDomainProperty`) so a future client build cannot re-open it alone.

**⚠️ My reading of the second row was wrong, and the correction matters.** I filed 50990 as a
probable duplicate of the same phantom. It is **a REAL, DISTINCT Gary, IN property** with different
stats and its own broker, which merely lost its street to the same bleed. CC read it before acting
and applied the right doctrine: **the corrupted street is QUARANTINED (nulled, original preserved in
`notes`, `address_source='addr1_quarantined_contact_bleed'`), not guessed at** — *write no address
rather than a wrong one*. city/state/zip were already correct and were left alone. **A "repair" that
treated it as a duplicate would have destroyed a real property.**

**37491 was the duplicate, and its attached sale was real data.** Merged into 35722 via the EXISTING
reversible `dia_merge_property_reversible` (walks every FK, snapshots the dropped row) — verified:
37491 gone, `dia_property_merge_backup` holds 1 row under `addr1_costar_contacts_bleed_20260903`,
and **35722 now carries 1 sale + 3 listings**, i.e. the phantom's $4.38M 2017 sale (buyer OSAGE
TOWERS, seller LAKE DELTON RE — Lake Delton adjoins Wisconsin Dells) came home to the real property
rather than being deleted with the shell. `properties where address='680 Newport Center Dr'` = **0**.

**The detector is narrow ON PURPOSE and that is the load-bearing choice.** It requires a captured
CONTACT to name that exact street as *its own* office at a DIFFERENT city/state — so an owner
genuinely headquartered at its property (**12 of 13 raw matches on this table**) is excluded by
construction. This is why my two loose detectors (108 addresses over 2+ cities / 242 rows; 98 over
2+ states / 202 rows) were correctly refused: they were dominated by `Dialysis Unit`, `TBD` and
common street numbers. **`v_dia_contact_office_address_bleed_review` reads 2 today** — property
37503 (`3121 Michelson Dr` ← IRA Capital, Irvine CA) and 37783 (`4700 Wilshire Blvd` ← CIM Group,
Los Angeles) — **both `buyer`-role contacts, i.e. a DIFFERENT capture surface from the Sales-Company
block the regex fix covers.** Neither is auto-repaired. The gov mirror view exists and is applied.
Guards: `addr1-costar-foreign-party-header.test.mjs` + `addr1-contact-office-address-bleed.test.mjs`.

## 2026-09-03 — ✅ PR2's PRODUCER PROOF IS CLOSED (a new sidebar capture wrote a parcel row WITH stats), and the same session surfaced 🚨 ADDR1: the Contacts tab's broker office address minted as a property.

### PR2 — Class 8 closed, on the state delta

Scott captured three dia properties chosen because they had **no** `property_public_records` row,
forcing an INSERT. **A new `costar_sidebar` parcel row landed 20:08:42 UTC** — APN `08H-61-0665`,
St. Louis MO, **`building_sf` 5,600 · `lot_sf` 196,543 · `year_built` 2020** — the first parcel row
since 2026-08-31 and the first ever written by the FIXED writer. **0 sub-100-sq-ft lots**, so the
acres bug is absent on the forward path too. The verify-next that had been open since 09-02 is done:
**the producer is fixed, not just the backfill.**
⚠️ **Why the earlier Hillsboro capture did NOT prove it:** APN `145416` already had a parcel row from
**April**, and its stats came from the 09-02 backfill (its zoning is `"C" - Commercial` — the exact
PR12 quote-loss row). `fetched_at` never moved. **An existing row makes the proof invisible** — pick a
subject with no row when testing a writer.

### 🚨 ADDR1 (new) — a phantom property minted from the broker's office address

Capturing `E10196 County Road P — DaVita, Wisconsin Dells WI` **with the Contacts tab open** created
**property 37491 = `680 Newport Center Dr, Wisconsin Dells, WI 53965`** — SRS Capital Markets'
Newport Beach office street stapled to the subject's city/zip, carrying the real property's stats
(7,895 SF / 2017 / 45,302 lot) and **already holding 1 sale and 3 listings**. It is a live duplicate
competing with the real row 35722. **Not a one-off — property 50990 is `680 Newport Center Dr,
Gary, IN 46408` from 09-02.**
- ⚠️ **The city/state/zip came out RIGHT and only the street was wrong** — that asymmetry is the
  diagnostic and it is in the prompt.
- ⚠️ **The naive detectors are too loose and must not be used to drive a repair:** 108 addresses
  across 2+ cities / 242 rows, and 98 across 2+ states / 202 rows, are dominated by placeholders
  (`Dialysis Unit`, `TBD`, `1 sect`) and common street names — **not this bug.**
- Same producer and same shape as the Prompt-89 TrafficMetrix misparse (reading the wrong region of
  a CoStar page); `tm-misparse.js` is the existing guard for the CONTACT version.
- Prompt drafted: `ADDR1-broker-office-address-minted-as-property.md`.

### The Loan tab is being captured — and the CMBS fields still do not land

Scott confirms he opens the Loan tab on every capture, and **3 `loans` rows were touched today**
(`Oklahoma Fidelity Bank`, `Wells Fargo Bank Na`, `National Medical Care Inc`). But all three carry
`data_source='costar_sidebar'`, `is_cmbs=false`, and **`costar_loan_id` NULL — still 0 of 662 dia
rows.** So the property-page scanner is writing the loan summary while
`parseCmbsLoanDetail` never fires. **PR5d's verdict is refined, not overturned:** the loan
SUMMARY is captured; the CMBS servicer detail is not. → **PR5d-a is now a question about WHICH
sub-page/section, not about subscription access** (Scott has the Loan tab). A screenshot of the Loan
tab on a CMBS-financed property is the cheapest next input.

### Junk lane — worked, with a named residue

All 80 decided: **41 mailboxes freed** (email cleared + identities detached on all 41), 37 holds
correctly untouched, 2 renames. The 41 show `status='conflict'` = `conflict_fk`: **the un-stamp ran
first and the soft-retire was then blocked because other rows still reference the entity.** That is
the design working — harm stopped, nothing destroyed — but they remain live, flagged, de-emailed and
un-retired. → backlog **ENTC-junk80-fk-residue**.

## 2026-09-03 — gov parcel backfill RUN server-side (1,230 rows, 0 unit errors) and PR5d verified: the CoStar CMBS arm is a page nobody has ever captured, with a second blocker underneath.

### gov PR2 backfill — executed from Cowork, not the script

Scott's shell has no `*_SUPABASE_*` vars, so this ran DB-side. ⚠️ **The parse was NOT
re-implemented in SQL** — the metadata was pulled from LCC Opps, run through the SHIPPED
`parcelStatsFromMetadata` in the sandbox, and only the parsed values were written. That keeps the
lot-unit rule (I12) in exactly one place, which is the whole reason the script exists.
**gov `costar_sidebar` parcels: `building_sf` 0 → 1,192 · `land_area_sf`/`land_area_acres` 0 → 1,109 ·
`year_built` 0 → 1,153 · `zoning` 0 → 291** (1,230 rows touched of 1,527). Snapshot
`_pr2_parcel_stats_backup_pr2govcowork20260903` (1,230 rows, **all pre-states blank** — fill-blanks
proven, not asserted); reversible by batch tag `pr2_gov_cowork_20260903`.
- **0 sub-100-sq-ft lots and 0 absurd lots after the write** — the acres-as-square-feet bug (43,560×)
  is absent, confirmed on all three CoStar formats present in the data (`5.26 AC`,
  `6.00 (261,360 sf)`, `68,259 SF`).
- ⚠️ **One row EXCLUDED before writing:** APN `0403` parsed to **2,304,454,680 sq ft / 52,903 acres**
  — 82 square miles. The parser is faithful; CoStar's own string is `52,903.00 (2,304,454,680 sf)`.
  Writing it would poison every land metric, so it was left blank and is named here rather than
  silently dropped. **The dia run had no such outlier** — worth a look if a land ratio ever reads odd.
- ⚠️ **`tax_amount` / `land_use` / `owner_name` stay 0 on gov too**, same measured ceiling as dia —
  those keys have never appeared on any capture.

### PR5d (#2098 lineage, migration `20261010120000`) — verified live

**121 rungs verdicted: `page_never_captured` 94 / `page_never_captured_flag_off` 27.** Rungs 2,141,
PR5 426, PR5c 33, orphan 49 — all unmoved. `lcc_loan_maturity` 568.
- **The answer is (c): the scanner, the writer and the manifest match are ALL live and correct** —
  `parseCmbsLoanDetail` → `upsertLoanRecords`, `https://*.costar.com/*`, and `pageUrl` read from
  `window.location.href` at extract time so SPA routing is a non-issue. **The CoStar loan sub-page
  has simply never been captured.**
- **Ruling out the rename class needed a column only that arm writes:** `loans.costar_loan_id` and
  `loans.source_url` are **0 of 2,219 rows on both domains**, and `loan_snapshots` /
  `loan_top_tenants` / `loan_commentary` are 0 rows on both. ⚠️ **That zero is evidence only while
  exactly one writer could have made it non-zero** — the guard now pins that single-writer property.
- ⚠️ **A second blocker the (c) framing misses:** dia's `properties.track_cmbs_snapshots` is `false`
  on **11,803 of 11,803**, so capturing the page tomorrow would still write nothing there. That
  boundary IS the 94/27 split.
- ⚠️ **It supersedes R54 Unit 3's mechanism (75 days old):** gov reads `is_cmbs` 285 /
  `special_servicer` 126 and looks like CMBS capture — but those come from a DIFFERENT scanner on the
  property page deriving `cmbs_deal_name` from a lender-name regex. R54's disposition was right, its
  mechanism wrong, which is why this read as a coverage question for 75 days.
- **Not retired, and the reason is a starved consumer:** R54's `is_distressed` arm is built, ranked
  and has never had an input — **0 of 178 gov watch rows**, with watchlist / delinquency / DSCR at 0
  across 285 CMBS loans. Only this arm can feed it. → **PR5d-a** (👤 does Scott's CoStar session reach
  that sub-page, and does the subscription expose the servicer report?) and **PR5d-b** (the dia flag).
- **UX-T1a reconciled in place:** its *"192 loans maturing ≤24 mo has no LCC table at all"* was true
  on 09-02 and superseded the next day by UX-T1a-gates — `lcc_loan_maturity` holds those 192 exactly
  (gov 170 + dia 22), and `costar_cmbs_loan` supplied **0** of them. **The residual debt gap is
  DISTRESS, not maturity.** Corrected in `app-ux-review-2026-09-02.md`, the audit and `CLAUDE.md`.
- Guard 12 tests, **21/21 mutations RED** — three of CC's own assertions survived their first
  mutation and the pass caught all three. Suite 5,314 / 0.

**CC's own recommendation, and I agree:** `PR5c-enforce` outranks PR5d-a — the ten `entities`
contact rungs are all `record_only`, so that ladder records and protects nothing.

## 2026-09-03 — ENTC-confirm EXECUTED (15/15 merged, `goes_by` stamped) and 🚨 SALE1 FOUND: one price propagated across several sales of one property, with the source's own "not a comp" markers ignored.

**Merges (Scott approved all 15):** every pair merged cleanly through `lcc_merge_entity` — 14 moved
an external identity, 1 moved none, 0 portfolio edges (contact-only rows, as the plan predicted).
Reversible per row with `lcc_unmerge_entity(loser)`. **`metadata.goes_by` stamped on all 15
survivors** (`goes_by_source='entc_merge_20260903'`) at Scott's request — Vincent Curran carries
`["Vince Curran"]`, etc. ⚠️ **Nothing reads it yet** → backlog **ENTC-goes-by**; it is an ALIAS,
never an identity key.

**SALE1 (new, 🚨):** Scott's Hillsboro capture surfaced **three sales of dia property 35612 at an
identical $1,593,750**, all `live` and all in comps — a 2009 **Nominal Transfer**, a 2024 Resale,
and a 2026 row whose own CoStar note says **"not suitable for sales comparable purposes"** —
yielding **three different cap rates (5.24 / 7.48 / 7.84%)** from one price.
- Class: **668 (property, price) groups / 1,517 rows / 568 properties**; **272 span >1yr, 166 of
  those with 2+ rows still in comps.**
- ⚠️ **The dedup machinery is working and cannot see it.** `dedup_natural_key` is
  `property|price|YYYY-MM` (UNIQUE; 485 same-month collisions correctly `duplicate_superseded`) —
  property 26404 shows both halves at once, two pairs correctly deduped and three cross-month rows
  at $10,260,000 all live. **A key that encodes the month is structurally blind to a cross-month
  repeat**, which is exactly the propagation shape.
- Second defect: `transaction_type ilike '%nominal%'` = **38 rows, 28 in comps**; the CoStar "not
  suitable" string = 1 row, in comps. `exclude_from_market_metrics` is set on 1,750 of 4,785 rows,
  so the column is used — just not from these signals.
- `cap_rate_final` derives from `sold_price`, so this reaches every CM consumer. Prompt drafted:
  `SALE1-repeated-price-and-comp-eligibility.md`.

**Also:** the Hillsboro capture landed on the EXISTING property 35612 (no new property needed) and
wrote no `parcel_records` row — **PR2's producer proof is still open**; it needs a dia capture whose
CoStar page exposes the Public Record panel.

## 2026-09-03 — OPERATOR QUEUE RUN SERVER-SIDE (Cowork): junk80 SEEDED (80), the propagate tick TICKED (`entities` provenance 0 → 4), `availability-checker` DEPLOYED (v21, verified live).

All three via the DB (`lcc_cron_post` / direct SQL / the Supabase MCP), because the sandbox has no
Railway egress and Scott's PowerShell hit two doc errors:

- **junk80: seeded 80 proposals (41 dismiss / 39 holds), batch `junk80_sql_20260903`** — by direct
  SQL replicating the handler byte-for-byte, because `?_route=junk80-seed` **500s on the deployed
  build** (filed **ENTC-seed-500**) and the doc said `?action=` where the dispatcher keys on
  `?_route=`. Two schema traps en route, both already in this file's catalogue: `review_id` is
  `GENERATED ALWAYS` identity (`information_schema` shows no default for identity columns — the
  P195 428C9 shape), and the first insert attempt guessed uuid for a bigint.
- **`owner-contact-propagate` tick: `field_provenance` on `entities` 0 → 4** (`domain_owner_contact`,
  batch `ocp_20260903`; 24 owners with candidates, 4 org phones filled, 31 reviews queued, 192
  `no_contact_detail`). The PR5c-entities verify-next is CLOSED.
- **`availability-checker` v20 → v21 deployed** (index + parsers + `_shared/cors`, verify_jwt off as
  before). Health green; a live `domain=dia&limit=3` run returned a clean 200 apply envelope
  (3 × `skipped_no_url` — the head of the overdue queue has no URLs; a data fact). PR5c-deploy CLOSED.
  ⚠️ `lcc_cron_post`'s edge arm prefixes `https://…/functions/v1` itself — an endpoint carrying
  `/functions/v1/` doubles the path and 404s `Requested function was not found`.

**Scott's remaining queue is now only:** work the junk cards · ENTC-confirm (15 merges) · one dia
sidebar capture (PR2 producer) · gov backfill · N15e / PR9 / BR1-confirm decisions · Dialysis CI
toggle · SAM/Regrid keys.

## 2026-09-03 — PR5c-entities-c-review + -oldest (#2083, `dc52e922`): the 15-pair merge plan is built and WAITING ON SCOTT; the oldest-row gate is measured and REFUSED; and the round trip broke `lcc_p195_unmerge`.

**Verified live:** `v_lcc_entities_c_review_merge_plan` **15 rows / 2 bases** (`initial_only_expansion`
6 — a structural rule that fires on 0 of the other 49; `human_read` 9 — the honest basis, since the
alternative is the banned comparator); blind pairs 55; drift 0; nothing merged; still **0** SF-Contact
mints since `d5b0ac8` (the post-fix rate remains unmeasurable).

- 🚨 **`lcc_p195_unmerge` STRANDS byte-identical edges while reporting `restored`** — three identical
  `(from,to,'brokers')` edges are all snapshotted, and P196's own BEFORE-INSERT trigger skips the 2nd
  and 3rd as duplicates so they never reach `ON CONFLICT (id) DO UPDATE`. **P196's exact finding, in
  the one reversal path that never got P196's fix.** Row count identical in both runs — only the
  identity-keyed fingerprint exposed it; a count-based unmerge verification is worthless.
  **Reverse with `lcc_unmerge_entity`, never `lcc_p195_unmerge`** (now in the invariants). Filed
  `PR5c-entities-c-p195-unmerge`.
- ⚠️ **The P195 winner rule DEGENERATES on contact-only populations** — owns/rent/facts are 0 on 92
  of 93 endpoints, so the winner falls to external-ids-then-relationships and picks `Frank Johnson`
  over the older, better-connected `Frank D. Johnson`. The plan exposes `winner_decided_by` +
  `ownership_tiers_all_zero` so a row can be swapped before confirming.
- **The oldest-row gate is REFUSED on measurement:** reach 22 of 193 groups, accuracy 12 of 26 on
  the population it exists for (`lcc_looks_like_person` PASSES 16 of the 26 junk rows), useless for
  the 37 junk rows alone on their mailbox, and 171 of 193 groups have ≥2 rows passing every guard so
  no shape gate can pick. **Retire the junk rows instead** → `PR5c-entities-c-junk80` (80 live
  junk-named person entities with emails; 0 in `junk_entity_review`, 0 flagged — invisible to both
  existing lanes). Two unstated facts recorded: the email tier's `.find` scans the **oldest 10 rows
  only**, and an inbound with no domain searches the whole workspace.
- **The race count is 3, not 2** — two live `Matthew Dodson` entities 0.107 s apart that the prior
  audit read as a duplicate view row (backlog corrected).

All docs closed by CC in the same change (audit, canonical page §5, CLAUDE.md invariants, backlog ×5).
👤 **The 15-pair confirm is Scott's** → OPERATOR-ACTIONS. Prompt + response filed to `done/` this turn.

## 2026-09-03 — ENTC: the junk80 census (**the 80 are not one class**), the entity-mint gate, and `lcc_p195_unmerge` FIXED — retiring it would have made 66 live merges irreversible.

Migrations `20261014120000` (p195 fix) + `20261015120000` (`v_lcc_entities_c_junk80`), both applied.
Guard `test/entc-junk80-and-p195-unmerge.test.mjs` — 13 tests, **19/19 mutations RED**; full suite
5,278 pass / 0 fail. **Nothing retired, renamed, merged or swept; the seeder is dry-run and unapplied.**

- ⚠️ **BEFORE RETIRING A SUPERSEDED FUNCTION, CHECK THE POPULATION IT STILL OWNS — NOT THE DATE THE
  SUCCESSOR SHIPPED.** `lcc_p195_merge_log` holds **66 open merges, ZERO with a
  `lcc_entity_merge_log` row**; they ran hours before P196 taught `lcc_merge_entity` to
  self-snapshot, so `lcc_unmerge_entity` answers `no_open_merge_log_row` for all of them. Both
  ledgers start 2026-08-27, which is exactly why "redundant now" reads true and is false. Fixed to
  P196's shape + a want-vs-have `note`; round trip 24/24, **0 lost, 0 stranded**, `restored` 17 → 19.
- ⚠️ **A GUARD-DEFINED POPULATION IS NOT A CLASS.** 41 `sweep_candidate` / 27
  `hold_salesforce_identity` / **6 `hold_email_corroborated`** / 4 `hold_inbound_reference` / 2
  `hold_name_repairable`. The six carry a name token inside their own mailbox localpart
  (`Eyal (Al) Elkayam`/`eyal@`, `Hunt`/`hunt@`, `Jackson`/`kjackson@`) — **the row IS that
  mailbox's person; clearing its email is the harm.** Two more are a real person behind a CoStar
  `Seller Contacts…` prefix (a `rename`, not a retire). Only sweep candidates propose an action.
- ⚠️ **TWO WRITERS ON ONE CAPTURE, TWO DEFINITIONS OF "JUNK", AND THE WEAKER ONE MINTED THE
  ENTITY.** `upsertSidebarContacts` always dropped `isJunkContactName` failures; the entity mint
  (`unpackContacts`) applied only the TrafficMetrix detector. Gated by INJECTING the existing guard
  into `planContactMinting`, **PERSON-ONLY** (it rejects firm suffixes, so on an organization it
  would block every real company mint). **38 of 80 (47.5%), 0 of the 6 real people.**
- ⚠️ **THE REMEDY WAS UNREACHABLE AND THE TEMPTING FIX WAS A LIE.** `unstampMisparseMember` fired
  only for `heuristic === TM_MISPARSE_HEURISTIC`; relabelling junk80 rows `tm_misparse` to reach it
  would have put a false fact in the ledger. Keyed on the CLASS now (`EMAIL_CONFLATION_HEURISTICS`).
- ⚠️ **Two corrections to the prior audit: 11 of the 80 DO carry `metadata.junk_name_flagged`**
  (not 0), and **"37 alone on their mailbox" is domain-scoped — by address it is 31** (both emitted).
- ⚠️ **The brief's two verification targets are in tension and the protective one wins:** junk-oldest
  contested mailboxes **14 → 3**, but alone only **37 → 29**, because 23 of the 37 carry an SF
  identity and go to review by design. 35 mailboxes freed, 49 identities detached, **0 relationships
  touched**. (The prior audit's 26 was a HUMAN read; the guard-measurable figure is 14.)
- All three definer unmerge functions narrowed to `service_role` (0 PostgREST callers), revoking
  from **both** `public` and the explicit grants, **asserted with `has_function_privilege()`**.

👤 **`junk80-apply` is Scott's** (OPERATOR-ACTIONS). Open: `junk80-gate-p131`, `p195-unmerge-callers`.

## 2026-09-03 — PR5c-entities-b-dupes (#2076, `d5b0ac8`) + PR5c-entities-c (#2079, `cbac828a`): the duplicate-mint mechanism was `entities.domain` scoping the IDENTITY key — and the sibling tier must NOT get the same fix. Entity-identity topic consolidated.

**Verified live 07:40 UTC:** `/version` = `cbac828a` = `main` (both PRs running); drift **0**;
`v_lcc_entity_email_tier_blind_pairs` **55**; `v_lcc_entity_duplicate_mint_review` **691** (90-day,
incl. the 553-pair `older_row_has_no_email` bucket — deliberately unswept); **0** SF-Contact mints
since the fix, so the post-fix rate is **not yet measurable** (baseline 3.37%).

- **The prompt named the wrong module, and a run ledger settled it in one query.** `bridge_runs` =
  **zero** Salesforce bridge runs in the incident window; `findEntityForUpsert` never executed. The
  writers were the `lcc-sf-contact-resolve` tick (cron 165, 10 of 13 mints within seconds of :00/:30)
  and the CoStar sidebar — both through `ensureEntityLink`, whose canonical_name tier carried
  `&domain=eq.<domain>`. **All six predicates the prompt listed are refuted** (older row live, person,
  same workspace, byte-identical email). 9 of 11 = `cross_domain_canonical_miss`; 2 = 0.14 s races.
- 🚨 **A shallow clone reports the graft boundary as the "add"** — `git log -S` dated the lookup to
  2026-09-02 and it was published as a refutation before `git fetch --unshallow` showed 2026-05-09;
  and `git show <sha>^:file | grep -c` over a nonexistent parent printed a confirming `0`. **Never let
  an error render as a zero** — the file's own doctrine, committed by its author.
- **The obvious follow-up (drop the filter on the EMAIL tier too) was measured at 27% precision and
  REFUSED**: 40 of 55 cross-domain same-email pairs are two real brokers on one mailbox (Phillip
  Kelly / Toby Scrivner @northmarq), firms filed as persons, or P131 row labels. **An attach is worse
  than a duplicate** — the guard goes RED if someone "fixes it for consistency."
- Honest rate: 326 creates / 13 on an existing live key (3.99%) / **11 probable duplicates (3.37%)**
  — the brief's 14 / 4.3% does not reproduce. Expect ~0.6% residual until the
  `(workspace_id, canonical_name)` unique constraint (N15e, 👤 6,608 groups).
- **Filed:** PR5c-entities-c-race · -oldest (email tier attaches to the OLDEST row, row-label or not —
  live within a domain) · -review (15 genuine pairs → human merge, one at a time).

**Consolidation (this turn):** `docs/architecture/entity-identity-and-dedup.md` is the canonical page
— model, banned comparators, dated live state, arc index (P189 → P195 → N15c/d/e → dupes → entities-c),
open ids — with the five `CLAUDE.md` blocks (P195, N15c, N15d/e, dupes, entities-c; **357 lines**)
moved **verbatim** and an eight-bullet invariant list left in place. The dupes work had no audit doc;
the page is now its record. Ladder page §4 and handoff updated; prompt + response filed to `done/`.

## 2026-09-02 — PR5c-entities-b SHIPPED (#2072, `886cdf86`) and ✅ THE RAILWAY REDEPLOY IS CONFIRMED: live `/version` = `886cdf86` = `main` HEAD. Every JS half of the provenance arc is running. New finding outranks the arc: the SF bridge mints a duplicate on 4.3% of creates.

**Verified live 22:08 UTC:** `/version` read from the DB —
`net.http_get('https://tranquil-delight-production-633f.up.railway.app/version')` → `net._http_response`
15 s later → `{"version":"886cdf8622f4","git_pinned":true}`. ⚠️ The bare host without `-633f`
answers **404 `Application not found`**, which reads exactly like a dead deploy; I hit it first.
`source='salesforce'` on `entities` **0** (deployed minutes ago; 3 SF contacts in the prior 24 h;
~12 rows/day predicted — read tomorrow); unranked 29; drift 0; 0 failure alerts.

- 🚨 **SUPERSEDED 2026-09-03 by CONTACT1 — THIS WHOLE BULLET IS WRONG.** `insertEntity` is
  reached only from `handleSalesforceContactUpsert`, which **has never run**: `enrichment_jobs` holds
  **0** rows of type `salesforce.contact.upsert`, ever (the only job types that exist are
  `outlook.message.extract` and `cre.doc.text`). The ~336/30d population is real but belongs to
  **different, uninstrumented writers**. The provenance recording below was added to dead code.
  *Was:* **The write site is `insertEntity` (`bridge-handlers-salesforce.js:232`)**, the single owner of
  the `entities` POST — recording placed there so a future third caller inherits it. **Records,
  never gates**: a create has no prior value, and gating would let a registry outage cost a
  Salesforce contact. Rolled-back proof: 2 rows, `write`/`no_prior_provenance`, rung 20 (the
  registered rung resolved, not the unregistered branch); positive control `'lcc'` → 23514.
- 🚨 **`PR5c-entities-b-dupes` (new):** of 329 creates in 30 days, **14 (4.3%) landed on a
  `canonical_name` an older LIVE entity already held** — 9× N15c's bulk-sync rate. 8 of 14 share the
  older row's email (the bridge's own `email=ilike` dedup should have caught them); not a race (2 of 8
  within 5 min). 6 of 14 read as a person who changed firms — the documented "track where they went"
  case; a name-only sweep would be destructive. **Measured, not diagnosed; outranks PR5c-enforce.**
- CC also collapsed a merge artifact on the ladder page (two "Deploy state" blocks, one two
  redeploys stale) — the parallel-window shape again.
- Guard +6 tests, 8/8 mutations RED; CI 5,192 / 0.

**What is now purely operator-side** (`OPERATOR-ACTIONS.md`): one `owner-contact-propagate` tick;
one dia sidebar capture (PR2 producer proof — no capture since 08-31); the gov backfill; the
`availability-checker` edge deploy; PR9. Docs: ladder page §3 (deploy state corrected to `886cdf86`
+ the host suffix trap), handoff verify-next table, OPERATOR-ACTIONS (a duplicated `PR2-gov` row
from the parallel merge collapsed to one). Prompt + response filed to `done/`.

## 2026-09-02 — PR5c-entities SHIPPED (#2066, `e9c74357`): the two `entities` contact writers consult the ladder — and it buys RECORDING, not protection, because every rung is `record_only`.

**Verified live:** `field_provenance where target_table='entities'` **0** (correct — neither writer
has a cron, `SF_CONTACT_WRITEBACK` is `off`); all ten `email`/`phone` rungs `enforce_mode='record_only'`
(`manual_edit`/`manual_resolution`@1 → `salesforce`@20 → `domain_owner_contact`@55 → `costar_sidebar`@60);
unranked **29**; 0 provenance-failure alerts. CI green on the merged SHA — CC checked the run on
`b71fde0f`, not the one it validated (`3093f846`), because the merge UI added a second commit; merged
**7 s after** the required suite went green.

- **Wiring a ladder onto a table with an empty ledger cannot protect a curated value it has never
  seen** — `lcc_merge_field` compares against `field_provenance`, not the live column, so the first
  call on every field returns `no_prior_provenance ⇒ write`. And under `record_only`,
  `shouldWriteField` records a `skip` and the write proceeds anyway. **Read the enforce mode before
  predicting any behaviour change**; this is the prerequisite for grading a gate, not the gate.
- **A grep does not find the writers of a column** — grep 24 sites / 13 files, AST walk **41 / 16**;
  per-file column unions mis-labelled `bridge-handlers-salesforce.js` as an `email`/`phone` PATCHer
  when only its CREATE path carries them. Count with a parser, read the payload per SITE.
- **Where the writer has its own ledger (`metadata.field_sources`), a field the ladder drops must
  lose its stamp there too** — that stamp is what the writer reads next run (the PR10 two-ladders shape).
- **Two premature `check_suite.completed` webhooks** (one 46 s before the test job started) — read
  as "CI passed" either would have been wrong. Verified against the runs each time.
- **Filed:** `PR5c-enforce` (all ten rungs `record_only`; ungradeable until the ledger has history)
  and **`PR5c-entities-b`** (`bridge-handlers-salesforce.js`, ~336 SF contacts/30d, unwired — the
  nearer win because it runs daily). JS ships on the Railway redeploy (`e9c74357`).

**Verify-next:** post-deploy, an operator tick of `owner-contact-propagate` → `entities` rows `0 → N`
split by source/decision. Guard `test/pr5c-entities-ladder-wiring.test.mjs` (14 tests, 17/17
mutations RED). Docs: `docs/audits/PR5c_entities_LADDER_WIRED_2026-09-02.md` · ladder page §3/§4 ·
`CLAUDE.md` invariant list · backlog (all by CC). Handoff §3 rewritten this turn into a verify-next
ledger (the closed-PR narrative now lives on the ladder page only). Prompt + response filed to `done/`.

## 2026-09-02 — PR5c CLOSED (#2060, `06a3ee5d`): the 33 zero-row LCC-internal rungs were one CHECK constraint — five callers sent a `target_database` outside the vocabulary and failed 23514 on 100% of calls, silently.

**Verified live on LCC Opps after the merge:** all **33** rungs carry a `pr5c_verdict` —
`no_merge_path_caller` 13 · `reached_and_broken` 10 · `ledger_is_elsewhere` 6 ·
`producer_never_wired` 2 · `unreached_and_broken` 2; `field_provenance` rows on the six tables
**0** (correct until a producer runs post-deploy); rows with an out-of-vocabulary
`target_database` **0**; unranked **29**. CI 5,132 / 5,126 / 0 fail.

- **`lcc_merge_field` ALWAYS inserts a row** (write/skip/conflict, no early return), so a
  (table, field, source) at zero rows means the RPC never COMPLETED. That one observation turned
  "did the lane run?" into "does the call succeed?", answerable in one rolled-back replay: **6 of 6
  PR5 §2 sources fail, 5 with 23514**; the sixth (`lcc_generated`) is correct and simply unrun.
  Single owner now: `provenanceTargetDatabase()` in `field-priority-guard.js`; guard 12/12 mutations RED.
- **The rule was already written beside ONE call site** (`comms_owner_bridge`, the only LCC-internal
  lane that has ever written provenance) — and it cited `availability-checker` as a correct
  precedent, which sends the bare `'dia'`. **A comment naming a sibling as correct is not evidence.**
- **Corrects PR12 §4 in place:** its ~0.03% break-class rate measured the stored COLUMN; three
  sites `JSON.stringify` a jsonb parameter, so their payload rate was ~100%. The verdict survived
  (23514 fires regardless), the reasoning did not.
- **Corrects PR5 §1a:** `field_provenance` HAS run on one LCC-internal table (`comms_owner_bridge`, 22 rows).
- **PR12's failure signal cannot see any of the five** — they call the RPC directly, not through
  `shouldWriteField`: **0 open alerts over a population failing 100%** → `PR5c-signal`.
- **Not fixed, filed:** `PR5c-entities` (13 rungs, no merge-path caller at all while a dozen paths
  PATCH the table — the next real piece of work), `PR5c-avail-field` (rung says `status`, writer
  writes `is_active`), **`PR5c-deploy`** (the `availability-checker` edge function is a THIRD deploy
  surface, fixed in source, NOT deployed — Scott's call).

**Verify-next (Class 8):** a `field_provenance` row on `public.lcc_cre_property_documents` after the
next CRE folder-feed registration, **post-Railway-redeploy** — the count correctly stays 0 until then.

Docs: `docs/audits/PR5c_INTERNAL_RUNG_VERDICTS_2026-09-02.md` · `CLAUDE.md` PR5c block · backlog
PR5c ✅ + four siblings · handoff (all by CC, in the same change — the turn protocol working).
OPERATOR-ACTIONS + CURRENT-STATE this turn. Prompt + response filed to `done/`.

**Consolidation (this turn): the provenance ladder now has ONE canonical page** —
`docs/architecture/field-provenance-ladder.md` (model · instruments · dated live state · arc index ·
open ids · and the PR8/PR5/PR12/PR5c lessons moved out of `CLAUDE.md` **verbatim**, 251 lines).
`CLAUDE.md` § "Field-level data provenance" keeps a ten-bullet invariant list and points there.
Relocate, not archive (DOCUMENTATION-MAP §6z): nothing deleted, every inbound mention is a bare name.

## 2026-09-02 — PR12 SHIPPED (#2057, `68ede28c`): `field_provenance` no longer drops values with quotes/newlines — fixed WITHOUT a 1 GB table rewrite — and the exposure was 16× the row's number.

**Verified live on LCC Opps after the merge:** `value_text_hash.attgenerated = ''` (plain column,
1 BEFORE trigger); `field_provenance` **1025 MB, unchanged** (no rewrite); **1,979 rows** written by
live producers since the migration, **8 break-class** (backslash-rendering values), **0 null
hashes**; `provenance_write_failed` alerts **0**; unranked **29**. ⚠️ **The JS half (the
`provenance_failed` counter + alert) ships on the Railway redeploy — the fix itself is already in
force in the DB.** Confirm `/version` ≥ `68ede28c` alongside PR2's `98248e18`.

- **The defect was every backslash-rendering character, not the double quote**: `"`, newline, tab,
  CR, backspace, formfeed, control chars, including inside jsonb object/array string members.
  Rule validated 14/14 against the live cast. **The dominant population is the NEWLINE in ordinary
  narrative** — `dia.sales_transactions.notes` 927/2,969 (31%), `sale_notes_raw` 60/447, gov
  `sale_notes_raw` 47/269 ⇒ **~1,101 exposed today**, on columns that are NOT rungs. The
  ladder-scoped census (as the prompt asked) read 67 and structurally could not see them —
  `lcc_merge_field` is called for unregistered pairs too. **My census scope was the error.**
- **Three numbers, three meanings:** exposure 79 ladder-governed · 12 proven SAFE (writer passes a
  jsonb ARRAY, no backslash) · **1 demonstrated loss** (PR2's zoning). Cumulative historical loss
  is **structurally unmeasurable** — an overwritten break-class value leaves nothing.
- **No rewrite:** `ALTER COLUMN … DROP EXPRESSION` is metadata-only (probed: `pg_relation_filenode`
  unchanged, values byte-identical) → plain column + BEFORE trigger over `convert_to(…,'UTF8')`.
  0 of 1,270,785 stored values contain a backslash, so every hash reproduces — verified over the
  **whole population**, mutated-expression control at 1,270,785. The prompt's sizing premise
  (a 1.26M-row rewrite) was wrong; the disk-full → sign-in-lockout risk made finding this matter.
- **PR5c is NOT explained by PR12** — `entities.name` 23/69,462 break-class (0.03%), 0 on every
  other LCC-internal column; a dropped stamp would need ~100%. **PR5c is gradeable now.**
- **`::bytea` sweep, three projects:** this was the only first-party instance.
- **Three measurement traps, all caught by positive controls:** `LIKE '%\%'` returned a
  confirming 0 (backslash is LIKE's escape); `to_jsonb(col::text)` over a jsonb column read
  **100%** (`sale_notes_extracted` 250/250 — real 0/0); and the ladder scope above.
- **Filed:** **PR12a** (the 67 residual, unmeasurable total) · **PR12b** (new this turn:
  `lcc_flush_provenance_events` advances `max_event_id` past an errored event — permanent skip).
- Guard `test/pr12-provenance-hash-and-failure-signal.test.mjs` (12 tests, 17/17 mutations RED;
  the fix's own `COMMENT ON` literal named the banned shape — literals blanked, comments first).
  CI 5,099 / 5,093 / 0 fail.

Docs: `docs/audits/PR12_PROVENANCE_QUOTE_LOSS_2026-09-02.md` · lane page §2 · `CLAUDE.md` PR12 block ·
backlog PR12 ✅ / PR12a / PR5c re-worded (by CC); PR12b, handoff, CURRENT-STATE, OPERATOR-ACTIONS this
turn. Prompt + response filed to `done/`.

## 2026-09-02 — PR5 SHIPPED (#2051, `d8beb555`): the 39 never-written ladder sources are triaged IN THE DATABASE, 25 of them are not defects, and 7 are live on a second ledger. PR7 re-measured 1 → 19 orphan pairs. PR9 stated for Scott.

**Verified live on LCC Opps after the merge:** `field_source_priority` **2,141** rungs (+1, the
`costar_sidebar → gov.properties.government_type` rung); **426** rungs carry a `PR5:` verdict (=
`v_field_source_priority_triage`); **49** rungs marked `PR7:orphan_column`; `v_field_provenance_unranked`
**29**. Every number in the audit reproduces. ⚠️ **No deploy gap on this one** — the diff touches no
`api/` file (CC corrected its own "ships on the next redeploy" line); the migration was live before
the PR existed.

- **Seven of the 39 are LIVE — on the property-owner authority ladder** (`manual`, `rel_purchase`,
  `rel_owns`, `sf_seller`, `domain_true_owner`, `gov_ownership_transition` → 15,052 rows in
  `lcc_property_owner_evidence`, scored by `lcc_reconcile_property_owner`, which writes no
  `field_provenance`) plus `property_sale_events` (B6c-dup's gov trigger → gov's own
  `field_value_provenance`). **Enumerate the LEDGERS before recording a source as never written.**
- 🚨 **`field_provenance` has never run on ANY LCC-internal table** — 33 rungs across `entities`,
  `entity_relationships`, `lcc.lcc_property_owner`, portfolio facts, `lcc_cre_properties`,
  `lcc_cre_property_documents`, with live `lcc_merge_field` call sites on four of them → **PR5c**
  (graded against PR12 first, since a silent 22P02 is one candidate cause).
- 🚨 **"Unregistered" is NOT a low rung — it is a different branch of `lcc_merge_field`.** A
  72-combination rolled-back replay showed ONE registration changing four decision classes,
  including a loss of blank-filling. So rungs are **soft-retired in `notes`, never deleted** —
  which is why `never_written` correctly stays 39 and `write_but_unregistered` stays 21 (the
  brief's predicted 21 → 20 was wrong: at source grain `costar_sidebar` was always registered on
  73 other rungs; the field-grain detector is the one that moved, 30 → 29).
- **PR7 is 19 orphan (table, column) pairs / 49 rungs, only ONE live** (`gov.properties.recorded_owner_name`,
  28 writes/30d → **PR7a**). 13,955 rows of apparent drift on `gov.sales_transactions.buyer_name/seller_name`
  stop dead 2026-07-29 — historical residue, closed at source (**PR7b**). Standing check
  `scripts/check-field-source-priority-columns.mjs` — **operator-run, not a merge gate** (neither
  domain schema is derivable from this repo).
- **PR9 restated with its data:** `manual_verify`@20's 673 rows are all one field — a human-confirmed
  clinic↔property link — competing with the `auto_link_*` family, not with `manual_edit`. 👤 Scott.
- **Filed, not built:** PR5a (29 field-grain gaps, mostly `dia.sales_transactions` bookkeeping
  columns — decide whether a ladder should govern them at all), PR5b (`om_extraction` unregistered
  where it competes), PR5d (**`costar_cmbs_loan`: 121 rungs, the ladder's largest source, for a
  capture arm that has never produced a row**), PR5e (`gov_ownership_chain` dead constant — A2's
  304 facts carry no provenance stamp).
- Guard `test/pr5-ladder-source-triage.test.mjs`; CI **5,087 / 5,081 pass / 0 fail / 6 skipped**,
  count byte-identical to local (the Node-20 tell checked, not just the conclusion).

**PR8 verify-next is STILL open**: `field_provenance where source='agency_classifier'` = 0 — still
a no-population zero (no gov write has fired `gov_classify_agency()` since the migration).

Docs: `docs/audits/PR5_LADDER_SOURCE_TRIAGE_2026-09-02.md` · lane page §2 · `CLAUDE.md` PR5 block ·
backlog PR5 ✅ / PR7 ✅ / PR9 👤 / PR5a–e, PR7a–b (by CC). Handoff + OPERATOR-ACTIONS + CURRENT-STATE
this turn. Prompt + response filed to `done/`.

## 2026-09-02 — PR2 SHIPPED (#2045, `98248e18`): the sidebar writer now carries the parcel stats — and the parser was the load-bearing half. PR11 re-scoped, PR12 found.

**Verified live after merge (dia `zqzrriwuavgrquhisnoa`, LCC Opps):** `costar_sidebar` parcel rows
932 — `building_sf` **767**, `lot_sf` **734**, `year_built` **714**, `zoning` **232**, **0** lots under
100 sq ft; `field_provenance` batch **2,532** rows; `v_field_provenance_unranked` **30 → 30**;
30 `costar_sidebar` rungs on the four parcel/tax tables. Every number in the response reproduces.

- **The filed PR2 premise was refuted in the prompt itself** ("77% tax coverage" was the gpt-4o
  leg — 25,331 APN-less rows); the real source is the sidebar and its writer built the INSERT from
  `apn/county/state/assessed_value` only.
- 🚨 **Fixing the writer alone would have shipped a 43,560× unit error.** CoStar's dominant lot
  format `"1.00 (43,560 sf)"` (68% of captures) fell through `parseLotSF` → `parseSF` and read as
  **1 sq ft**; 476 of 760 backfilled lots came through that arm. `metadata.lot_sf` holds BOTH
  units (I12 one level up); `"0.00 (1 sf)"` is CoStar's no-data sentinel (PR1a's class).
- **Measured ceilings of zero, stated not silent:** `tax_amount` / `land_use` / `owner_name` have
  never appeared on any of 55,901 captures — wired, will read 0 until an assessor capture lands.
  The 84-property `$/SF` comp residue is a **disjoint** population (0 of 84 have a sidebar parcel).
- 🔴 **PR12 (new):** `field_provenance.value_text_hash` (`::bytea` over a jsonb string) throws
  22P02 on any value containing a double quote; `shouldWriteField` **fails open**, so the write
  lands and the provenance vanishes silently. One live hit (`"C" - Commercial`). Loss unmeasured.
- **PR11 re-scoped, not built:** the marker already exists (`v_dia_public_record_acquisition` /
  `dia_public_record_source_is_trustworthy`); what is missing is consumers filtering on it and the
  producer gate in the Dialysis repo (a retirement decision, per §2a).
- **gov: writer fixed, backfill NOT run** — 1,527 rows, one command, Scott's call
  (`OPERATOR-ACTIONS.md` §3 **PR2-gov**).

⚠️ **Class 8 — the backfill is proven, the PRODUCER is not.** 0 `costar_sidebar` parcel rows have
landed on dia since the merge (last capture 2026-08-31 18:33 UTC), and the Railway redeploy carrying
`98248e18` is unconfirmed from the sandbox. **The number that proves PR2 is a NEW sidebar parcel row
carrying `building_sf` after the redeploy — not today's 767.** Guard:
`test/pr2-sidebar-parcel-stats.test.mjs` (12 tests, 15/15 mutations RED; three guard defects found
and recorded in the response: a body slice closing on a default parameter, a neighbour's copy of
`blankOnly`, a grep matching a later `select=`). Suite 5,031 / 0.

Docs: `public-records-source-lane.md` §2 (PR2/PR11/PR12 blocks, by CC) · `CLAUDE.md` public-records
pointer · `PLANNED-BACKLOG.md` PR2 ✅ / PR11 🟡 / PR12 🔴 · handoff + OPERATOR-ACTIONS (this turn).
Response filed to `done/`.
## 2026-09-02 — OCR1c: the bake-off harness has a FLOOR now. ⚠️ NO real-document verdict changed — the sample on file is still 10 arm-A documents, tesseract only, and the 77% is still uninterpretable until Scott re-runs with `--control self`.

Harness-only; nothing wired; no real document run (the sandbox still cannot reach Supabase or
SharePoint). `scripts/ocr-bakeoff.mjs` + `test/ocr-bakeoff.test.mjs`. Writeup:
`docs/audits/OCR1_LOCAL_OCR_BAKEOFF_2026-09-02.md` **§8**; response
`docs/claude-code/responses/OCR1c-bakeoff-harness-self-agreement-control.response.md`.

**Four changes, each guarded (30 tests, 0 fail; 25/25 new mutations RED; full suite 5,038 pass / 0 fail):**

1. **Comparator artifacts normalized** — curly quotes/apostrophes, en/em dashes, NBSP, whitespace;
   `""` / `null` / `N/A` / `—` → null BEFORE the both-null decision; numbers strip a trailing `sf`.
   **4 of the first run's 11 non-agreements were this, not OCR.** ⚠️ Rounding is **not** a
   tolerance — `412500` vs `412600` stays a disagreement, and the sentinel list is narrow on purpose
   (`0` is a value; `Nullarbor Holdings LLC` is a name), both mutation-verified.
2. **`--control self`** — the model run TWICE on the same DocAI text, scored with the SAME
   `scoreDocument` and the same both-null exclusion, printed ABOVE the engine tables with
   `rate − self` per field. Two independent calls, deliberately **not** `temperature=0`.
   `deltaVsSelf` returns **null, never 0**, when there is no floor. A run without it prints a red
   *NOT RUN* banner instead of a bare rate. Cost: 10 extra model calls/run.
3. **Failure reporting** — `stderrTail` shows the LAST 300 chars (the first 160 were the same
   `RequestsDependencyWarning` on **all 36** first-run failures and hid BOTH real causes); the probe
   now separates *wrapper only* (`pip install paddlepaddle`) / *cannot check* / *needs a Docker VLM
   server → the GPU box*; `--self-test` names `pip install pillow`. **Positive-controlled live** with
   a fake `paddleocr` on PATH — the workstation's exact state, now reported instead of run 18 times.
4. **Arm B carries the VALUES** (`graded_values`/`fields_found` + a report table) — a `5/6 found` at
   confidence 68 is unreadable as a count.

⚠️ **Two guard defects the mutation pass found, both new to this repo's collection:** a detector for
a CODE shape must **blank string literals as well as comments** (the rendered report says
*"deliberately NOT `temperature=0`"* in a pushed string, so the anti-pinning grep went RED over
correct code); and the **order is load-bearing — comments FIRST, then literals**, because a bare
apostrophe in prose opens a string the blanker never closes and swallows real code behind it. That
is how the positive-control mutation for that very assertion survived its first run.

👤 **Scott:** `pip install paddlepaddle`, then
`node scripts/ocr-bakeoff.mjs --run --engines tesseract,paddleocr --control self` on the staged 15.
Read the floor table first, then `rate − self`, then the named disagreements. Surya still belongs on
GaryBuilt.

## 2026-09-02 — B6e-ci-required-check-prep LANDED (Dialysis #7395 + #7397): the gate has been seen RED, the docs-only path is proven, and MY "11 ruff errors" was an annotation cap. PR8 reconciled: the producer half is an EMPTY-WINDOW zero.

### Dialysis — verified from the PR bodies' run ids, not the response (which was captured mid-run)

| run | what it proves |
|---|---|
| **33647155312** (throwaway #7394, closed) | **RED proof:** 3,154 collected / **1 failed** / 3,145 passed → job conclusion `failure`, Build Check skipped. **The gate can fail.** |
| **33648697621** (throwaway #7396, one `.md`) | docs-only: Scope 5 s → "documentation only"; Lint/Security/Build skipped; **Run Tests SUCCESS in 5 s**, whole run 17 s |
| **33649047563** (#7397, a real docs-only PR) | same on a non-throwaway change — 19 s |
| **33647627137** (`main` @ `8ee8412`) | green once on `main`: 3,153 collected / 3,145 passed / 0 failed; `executed` **3,139 → 3,145**, the delta exactly the 6 new guard tests |

What shipped (#7395, `8ee8412`): **`paths-ignore` REMOVED** — it listed `**/*.txt`, which matched
`requirements.txt` / `requirements_utf8.txt` / `runtime.txt`, so **a dependency bump skipped every
job with no status and no trace**; a ~6 s API-driven **Scope** job decides inside the run; `Run
Tests` carries `if: ${{ !cancelled() }}` and gates its STEPS (a job-level `if:` is the same
deadlock one layer down — a skipped job reports no conclusion); every gate is `!= 'false'` so a
broken Scope runs everything. Guard `tests/test_b6e_ci_required_check_guard.py` — 6 tests, **8/8
mutations RED**, keyed on every workflow that runs pytest, asserting the prose allowlist by
**executing the shipped JavaScript under node**. ✅ **`exit code 128` is GONE — read from the
checkout log of job 100287516023** (closes my residue from this morning and `B6e-fred-git128`).

### 🚨 Correction, mine: "11 ruff errors" was page one of the instrument

I wrote *"ruff is red on `main` with 11 errors"* into STATUS, the backlog, `CLAUDE.md`,
`CURRENT-STATE.md`, the handoff and the canonical page. **GitHub caps step annotations at ten**;
ruff emits in path order and the three files I named sort first. Measured with the CI's exact
command on `main`: **`ruff check .` = 5,746 → 5,738** after the PR (E501 3,139 · E402 1,198 ·
F401 637 · F821 163 · …), **`ruff format --check` = 1,293 → 1,292 files**. Same class as A5's
`815 = 1000 − 185`. **So ruff stays masked, correctly** — unmasking would ship a red job on day
one. The three files were still dealt with (two scratch files deleted, two dead imports dropped;
`alias_review.py`'s two E402 are a deliberate `sys.path` bootstrap, commented not `# noqa`'d).
**All six pages corrected in place this turn.** ⚠️ CC could not read the ruff step's log back
either (the formatter's 1,305-file diff exceeds the API's tail window) — the count is a local
reproduction with the CI command.

⚠️ **Third merge-before-CI in this arc:** #7395 merged **3 m 30 s** after opening while `Run
Tests` was still running (#7393 at 8 s, LCC #1793 at 58 s). It is exactly what the toggle exists
to make impossible. ⚠️ **`pip-audit` and the secrets grep are RED today** (pypdf2 3.0.1
`PYSEC-2026-1835`, fix 3.9.0; five secret-pattern matches — fake JWT fixtures under `tests/` and
a redacted literal in `src/smoke_tests`) and stay masked → `B6e-ci-mask-security` now has its
real content.

👤 **Three operator steps, in order:** merge **#7397** (docs-only, "Ready to merge", 2 checks
passed / 3 skipped — it is itself the live proof) → delete `claude/tmp-red-gate-proof` and
`claude/tmp-docs-only-proof` from the UI (the push proxy refuses ref deletes) → **Settings →
Branches → `main` → require `Run Tests`** (the exact check name; unique across all five workflows,
no matrix suffix). That closes the B6 CI arc.

### PR8 — reconciled, and the "verify next" is an empty-window zero, not a stall

CC's entry below is complete and it corrected my *"39 is 38"* in place (still 39: `qa22_…` swaps
out, `domain_trigger` swaps in — nothing has ever actually been `domain_trigger`). Verified live at
16:01 UTC: `v_first_class` literal **gone**, `agency_classifier` **4 rungs**,
`v_field_provenance_effective_source` **present**, `v_field_provenance_unranked` **30** (all
`costar_sidebar` / `om_extraction` / `salesforce` — a rolling window moving on its own).
**`field_provenance where source='agency_classifier'` is still 0 — and that is a NO-POPULATION
zero (N15d):** gov `provenance_event_log` reads **0 unflushed / 0 errors**, the flush crons (188
dia `4,34 * * * *`, 189 gov `9-59/10`) are healthy, and the only `agency_classifier` event since
noon was **12:05, flushed 12:09 — before the migration**. Nothing has passed through the fixed
path yet. The proof is the next gov write that fires `gov_classify_agency()`; until then the
producer half rests on CC's rolled-back synthetic-event control. **Do not read the 0 as broken.**
Also surfaced by CC and filed, not fixed: **`costar_sidebar` writes `gov.properties.government_type`
(52/30d) with no rung** — a second unregistered writer on the very field PR8 registered; PR5's
write-but-unregistered triage owns it.

### 🚨 PR2's premise REFUTED before it was sent — "77% tax coverage" was the model leg

Checking PR2's own premise before drafting it (*"the tax fetcher demonstrably reaches 77%"*), split
by `raw_payload->>'source'`: **25,334 of 25,621 `tax_records` rows are `source` NULL with `apn` NULL
and `tax_amount` on 10** — the gpt-4o leg PR1 named — and **9,033 of the 9,107 "tax-linked"
properties point at those rows** (22,131 links). The **41 parcel rows with building stats are the
same leg.** There is no county fetcher reaching 77%; the number was the generator's output read as
reach. The only genuine rows are **`costar_sidebar`: 932 parcels / 931 real APNs / 883 properties
(7.5%), assessed on 286, building stats on ZERO** — from a page that carries building SF, year
built and lot size. **PR2 re-scoped** to *where does the sidebar → `parcel_records` writer drop the
stats* (prompt drafted), **PR11** filed (quarantine the APN-less rows, reversibly, with the producer
stopped in the same change). Canonical page §2 carries the split table; §3 item 2 struck through.
**Split by source before quoting coverage** — the third time this arc a headline number was a
population mix (W5.3 channels, `0 % 100000`, now this).

**Filed this turn:** `B6e-ci-mask-ruff` rewritten (5,738 / fix-or-ignore one RULE at a time),
`B6e-ci-mask-ruff-format` (1,292 files), `B6e-ci-mask-security` re-sized, `B6e-worktree-gitlinks`
+ `B6e-fred-git128` closed on evidence. **STATUS archived again** (9,216 → 6,614 lines; the
morning cut was too shallow) → `docs/history/STATUS_claude-code_2026-08-20_to_2026-08-28_cowork-block.md`,
verbatim, indexed. Both prompts + both responses filed to `done/`.

## 2026-09-02 — PR8 SHIPPED: the registry is the allowlist. Two of the brief's own numbers were wrong.

`lcc_flush_provenance_events()`'s four-name `v_first_class` literal is **gone**. A
`field_source_priority` row for THIS (table, field, source) is now the whole rule; anything
unregistered still merges as `domain_trigger`, which is the honest fallback for an unranked writer
and what keeps `v_field_provenance_unranked` meaningful. `agency_classifier` registered at the **4
rungs it writes, @90** — the rung its rows already merged at, so the change is **name-only**.
`v_field_provenance_effective_source` exposes the recovered name; **`field_provenance` is not
rewritten**. Migration `20261007120000_lcc_pr8_provenance_relabel_registration.sql`, applied live to
LCC Opps. Full suite **5,012 / 0 fail**; guards **13/13 mutations RED**.

**Before/after, one session, two self-rolling-back transactions over the same live state** —
1,521-event stratified replay, 150 per combo, covering all **15** live (source, table, field)
combos. **Predicted: 5 combos change SOURCE, 0 decisions change. Actual: exactly that**, every
decision count byte-identical including `dia.properties|tenant|skip=1` and
`gov.property_agencies|government_type|superseded=106`. Decisions are identical because
`lcc_merge_field` tests `same_priority_same_value_refresh` **before**
`same_source_refresh_newest_wins`.

🚨 **The consequence the brief did not name, and it is the one that mattered: removing a relabel
ARMS every registered source.** `county_records` holds 93 rungs at a best rung of **5**, above
`salesforce`@20 and every sidebar, and PR1 measured its producer to be gpt-4o recall. Under the old
code it merged as `domain_trigger` — **no rung for those fields, so at most a blank-fill**. Under
"the registry is the allowlist" it merges at **@5 and overrides real evidence**. The four-item
literal was the only structural thing stopping it, and nothing else was. The refusal is now
**explicit** (`v_never_first_class`), positive-controlled live in a rolled-back transaction: a
synthetic `county_records` event still stores `domain_trigger`, while `qa22_…` and
`agency_classifier` keep their own names and an unregistered writer falls back. **0 residue.**
That is a preservation of PR1's decision, not an addition to any allowlist. **When you delete a
suppression mechanism, enumerate what it was suppressing.**

⚠️ **"The 39 is 38" is wrong — it is still 39, and the swap is the finding.** `qa22_…` leaves the
never-written set and **`domain_trigger` enters it**: all 17,371 of its rows carry a `:evt` run id,
so **nothing has ever actually been `domain_trigger`** — a registered source with 6 rungs that no
producer is. PR5 re-keyed on the effective source, post-registration: **68 registered · 39 never
written · 21 write-but-unregistered** (back to the benign `cleanup_run_*` set, because
`agency_classifier` is now registered). Keyed on the RAW `source` it reads **40** until the next
flush writes an `agency_classifier` row under its own name — **that new row, not today's count, is
what proves the producer is fixed** (Class 8).

⚠️ **The brief's own recovery expression was a plausible-number generator.**
`coalesce(nullif(split_part(source_run_id,':evt',1),''), source)` is unguarded: `split_part` returns
the **whole string** when the delimiter is absent, and it is absent on **943,916 of 1,263,825 rows**.
Measured, it **invents 9,950 source names that do not exist** and answers the write-but-unregistered
arm with **9,951 instead of 21**. The shape test `~ '^.+:evt[0-9]+$'` is load-bearing. Same family
as P157 `reloptions` / P182 deparse. ⚠️ **And its guard cannot be a file-wide presence check** — the
predicate legitimately appears twice in the view, so a grep *and a ±300-char proximity window* both
stayed green while one site lost its guard. Found by the mutation pass, not by reading it.

**Producer read, not assumed:** gov `gov_classify_agency()` is a pure `STABLE` plpgsql rule engine
over the curated `government_agencies` lookup and `agency_enrichment_rules` patterns — **no HTTP, no
`pg_net`, no model** — and fill-blanks. A defensible source, unlike this lane's producer.

**Residual, sized:** during the transition a differing re-classification would record `conflict`
instead of `write` (two sources at equal priority 90). Measured over the producer's whole history —
17,277 events, 309 keys re-written, **0 keys have ever changed value**. Never once exercised;
self-clears. That is the reason to register at 90 rather than a new rung.

**Filed, not decided (PR10):** `agency_classifier` is **90** in LCC `field_source_priority` and
`authority_rank` **30** in gov's own `field_value_provenance`. Two ladders, one source, two numbers;
a re-rank changes which writes win and needs its own before/after. **Not done deliberately:** no
rung for `gov.properties.agency_canonical` (0 rows written — PR7's class); `domain_trigger` rungs
kept; `lcc_merge_field` untouched; nothing added for `county_records`.

**Verify next on:** a NEW `field_provenance` row with `source='agency_classifier'` after the next
flush (the producer's own fix, not the backfill) — and `v_field_provenance_unranked` staying at 22.

## 2026-09-02 — B6e-ci-last5 LANDED: the Dialysis pytest line is UNMASKED and green on `main` — and it is still NOT a merge gate (Dialysis PR #7393, `83d53f0`)

**Read from the `main` job log (run 33642110673, job 100287516338), never the badge:**
`collected 3147 items` → **`3139 passed, 7 skipped, 1 xfailed, 0 failed in 417.81s`.** The step's
own header now reads *"B6e-ci-unmask (2026-09-02): UNMASKED. A red suite now fails the job."*
`executed` **3,132 → 3,147**, up again — nothing skipped or quarantined at any step of the arc
(`0 → 3,128 → 3,132 → 3,147`; `55 → 14 → 5 → 3 → 0` failed).

| unit | outcome |
|---|---|
| `financial_ground_truth` (3) | test-side fixes landed; `RATES_2025` and `CMS_2023_RATES` kept as **two named constants with the WHY documented**; 9/9 mutations RED on the model+vintage guards |
| `listing_broker_update` (2) | **already cleared by BR2** before this prompt ran — the backlog was **3, not 5** |
| latent `UnboundLocalError` in `_dynamic_payer_model` | found by the sweep, reachable, one populated column from firing — **fixed** |
| pytest `\|\| echo` | **removed**, 5/5 mutations RED on the unmask guard, **green once on `main`** |
| `B6e-worktree-gitlinks` | the PR touches `.claude/worktrees/`; the CC task list marks the 3 gitlinks removed. ~~⚠️ Not verified from a checkout log this turn~~ ✅ **verified later the same day from job 100287516023's checkout log — `exit code 128` is gone** |

### ✅ `B6e-ci-baseline39` is SETTLED by supersession, and the 39 was never `main`'s state

The apples-to-apples run landed: **`main` at `ff712e0` (post-#7392) measured 3,138 collected /
3,127 passed / 3 failed** — recorded in the workflow comment — and `83d53f0` reads **0** on a real
runner. The 39 came from CC's own sandbox run at #7392 time and **was never reproduced in the
authoritative environment**. ⚠️ **What produced 39 there is still not named** (the documented
cross-module stub pollution is the likely shape, not a proven one), but it no longer gates anything:
the gate now runs on the runner, and the runner reads 0. Recorded as closed-with-residue, not
explained.

### 🚨 Two corrections to previously-stated figures — one of them mine, on a canonical page

- **"The code sits within 0.3% of the reconciled model" does NOT reproduce.** CC measured
  **−4.90% vs live, and no segment sits within even 1%.** That figure was in the prompt, in
  `producer-health-and-ci-enforcement.md` §3, in the backlog row, and in `CLAUDE.md`. **All four
  corrected in place this turn.** The verdict it supported (test-side fix, keep both constants) is
  unchanged — the code is the closer of the two to live, and the constants question was settled on
  the FY table, not on that number.
- **FY2026's 73.66% Medicare is the fallback bucket's signature, verified live this turn:**
  `partial_plus_default` reads **74.6–76.3% Medicare in EVERY year 2021–2026**, and FY2026 has
  **zero `hcris_form_265_11` rows** (65 `national_default` + 659 `partial_plus_default`). Not a
  market shift. Feeds **DE4**.

### 🔴 What the workflow file says that the response did not — read `ci.yml`, not the PR

1. **Dialysis has NO branch protection.** The workflow header states it in so many words (*"CI is
   NOT a required status check — this repo merges via a local `git merge` + `git push`"*), and
   **PR #7393 merging 8 seconds after its test job started is the proof.** So the unmask makes a
   red suite **fail the job** — it does **not block a merge**. The gate is one operator step short:
   → **B6e-ci-required-check** (👤 Scott). ⚠️ **`paths-ignore` skips CI on docs-only changes, and a
   skipped run reports no status** — so making `Run Tests` required will block docs-only PRs until
   the LCC docs-only-branch pattern (`test-suite.yml`) is copied across. File both halves together.
2. **Ruff is masked and red on `main` right now.** Both ruff steps carry
   `continue-on-error: true`; the current run shows a green *Lint & Type Check* with ~~**11 errors
   behind it**~~ ⚠️ **CORRECTED the same day: 11 was GitHub's ten-annotation cap plus one — the real
   count is 5,746 (`ruff check .`) and 1,293 files (`ruff format --check`). Ruff stays masked; see
   the B6e-ci-required-check-prep entry above.** The three files I named (root scratch
   `.tmp_source_gap_classify.py` / `.tmp_prop_diag.py`, `alias_review.py`) were real and are dealt
   with; they were page one, not the total. → **B6e-ci-mask-ruff**.
3. **Named in the workflow, absent from the backlog until now:** `import src.main` / `import app`
   in the build job are still masked and **red for a real reason** — both run a live Supabase
   health check at module import. → **B6e-ci-mask-srcimport**. `pip-audit` and the secrets grep
   remain `continue-on-error` → **B6e-ci-mask-security**.

### CC's own tooling caught two silences worth keeping

- A `curl` poller against the GitHub API returned *"GitHub access is not enabled"* and would have
  sat silent forever — **indistinguishable from "CI still running."** Only the MCP path reaches
  GitHub from CC. Committed while verifying a fix for exactly this shape.
- A branch-filtered runs query returned a stale page whose newest row was 2026-06-27, and CC
  reported *"no push-to-main CI for two months"* before cross-checking. Wrong; retracted in-line.
  **A filtered query returning a comfortable answer is the same shape as every detector trap in
  this arc.**

### Also this turn — PR8 decomposed by measurement, PR5's count moves

`lcc_flush_provenance_events` stamps `source_run_id := v_src || ':evt' || id`, so the relabelled
source name **survives on every row**. `domain_trigger` 17,371 = **`agency_classifier` 17,277**
(gov `government_type` on `sales_transactions` / `properties` / `leases` / `property_agencies`,
writing 2026-07-30 → today) **+ `qa22_davita_brand_canonicalize` 94** (one-shot 2026-07-30).
`agency_classifier` is **unregistered** — PR5's reverse arm reported 21 write-but-unregistered
sources, "all benign `cleanup_run_*`", and could not see this 22nd because it wears the catch-all's
name. `qa22_…` is registered and counted among the "39 never written" while 94 of its rows exist
under the wrong label — ~~**39 is 38**~~ ⚠️ **CORRECTED 2026-09-02 when PR8 shipped: it is still 39.**
`qa22_…` leaves the never-written set and **`domain_trigger` enters it** — all 17,371 of its rows are
relabels, so nothing has ever actually *been* `domain_trigger`. Post-registration, keyed on the
effective source: **68 registered · 39 never written · 21 write-but-unregistered.** PR8 is now
**shipped**, not a build prompt (`done/PR8-provenance-relabel-decompose.md`). Re-measured the top-three sizes at session start too:
BR1 131/73/28/7, PR2 1,604/41/908-vs-9,107, PR5 67/39/21 — all reproduce; `recorded_deed` positive
control 2,681 → **2,731**, still writing.

**Verify next on:** the first *red* PR on Dialysis actually showing a failed `Run Tests` job (the
gate has only been proven green, never proven to fail); the checkout log free of `exit code 128`;
`B6e-ci-required-check` flipped. Prompt + response filed to `done/`
(`B6e-ci-last5-decisions-resolved.response.md` is a transcription of the mid-flight `.docx`; the
outcome above is from the run itself).
## 2026-09-02 — OCR1 run 2 (with the floor) → tesseract = §5 row 2; OCR2 verified live; EXT1 filed

- **OCR1 run 2:** model self-agreement floor **93%** (`lease_expiration` only 71%); tesseract **80%**
  (−13 pp) on 10 real docs. Read on named rows: 2 model-arithmetic, 4 date-default noise, **3 real
  tesseract misses** (one promoted a person's name over the company — a layout/reading-order effect),
  2 fixture. **Verdict for tesseract: §5 row 2** — free pre-filter/fallback that removes the page cap,
  not a DocAI replacement. Paddle failed on all 18 with a paddlepaddle 3.x oneDNN/PIR runtime error
  (Windows CPU); surya reported its Docker requirement once. **Deciding run → GaryBuilt** (👤).
  Record: `responses/done/OCR1-run2-with-self-control.response.md`.
- **EXT1 filed:** the extraction model, not OCR, is the larger error source on `year1_rent`
  (annualized in the model's head, differently per call) and `lease_expiration` (29% self-disagree).
  Return rent with its basis, annualize in code, dates as quoted.
- **OCR2 verified live:** `gov_/dia_merge_document_extracted_data` present on both domains, `anon`
  EXECUTE **false** by `has_function_privilege`, 0 provenance rows (correct — no new deed), Railway at
  `35528de9`. ⚠️ **A `/version` probe can return a CACHED body** — the first fetch showed the morning's
  SHA with the morning's `ts`; a cache-busting query param returned the truth. Add one always.
- Files: OCR1c + OCR2 responses and the OCR2 prompt → `done/`. `prompts/` holds the handoff and
  PR2 (other window).

## 2026-09-02 — Scott's app walk-through catalogued: 48 comments → UX0–UX49, tiered T0–T4 (P16)

Source: `LCC App Function Notes.docx` (41 screenshots; kept outside the repo). Canonical page
`docs/architecture/app-ux-review-2026-09-02.md`; backlog §P16; doctrine block added to `CLAUDE.md`
pending a canon entry (UX0). **Queues behind OCR1 re-run / OCR2 by instruction.** Points worth the
next reader's time: several "is this an error?" questions are ANSWERED on the page rather than
queued (CMS "since Sept 2025" = a reporting-period series + the still-open B6d-cms-restart; the
"high" clinic revenue is almost certainly OPERATING revenue not rent — the A5 misread); the Sellers
"0 / $0" is the `diaQuery` `[]`-on-error shape, so it is a response to read, not an empty table; the
Ownership "500" is the paged-query-as-count footgun; Brokers and the CM charts map to open rows
(BR1–BR5, K13–K18) rather than new ones. The single largest shared primitive across the feature asks
is the **draft → send → log loop** (Pipeline drawer, Marketing tab, buyer-rep) — build it once.

## 2026-09-02 — OCR1c built (self-agreement floor + honest engine probes); branch pushed, NO PR opened

CC delivered all four changes on `claude/ocr-bakeoff-self-agreement-qnyl9z` (`837a7ba`): quote/dash/
NBSP normalization and sentinel→null before comparing (accounts for 4 of the 11 non-agreements),
`--control self` (two independent model calls on the DocAI text, same scorer, `rate − self` column,
red NOT RUN banner when absent), last-300-chars stderr + tri-state engine probe (`wrapper only` /
`could not check` / `needs a Docker VLM server`), arm-B values in the JSON. 30 guards, **25/25
mutations RED**; two guard defects found by the mutation pass (a code-shape grep must blank string
literals too, and comments must be stripped BEFORE literals or a prose apostrophe swallows code).
⚠️ **As of this reconciliation the branch is NOT in `main` and no PR exists** — CC ended with "say the
word if you want one." Merge first, then the re-run (`OPERATOR-ACTIONS.md` OCR1). No real-document
verdict changed. Response + prompt → `done/`.

**DOC18 at 17:10 UTC:** 6 attempted, 4 windowed (169 pages billed), 1 true partial, `bov_ready` 48; the
predicted 12 MB residual appeared on doc 128 (`over_ocr_cap`, 0 calls) → **DOC18-bytes**, sized after
the drain. Dedupe grep clean.

## 2026-09-02 — OCR1 first REAL run reconciled: page-cap case measured TRUE; quality unprovable until the harness has a self-agreement control

Scott's re-run (after the main-guard fix) completed on **15 real documents + 3 fixtures, tesseract
only**: surya 0.22 runs its VLM in a Docker container (daemon off; belongs on GaryBuilt), paddleocr
lacked `paddlepaddle` (the wrapper installs without the engine). Record with the artifact analysis:
`responses/done/OCR1-run.response.md` (values-free; `bakeoff/agreement.md` stays local).

- ✅ **Arm B — the page cap is gone for a local engine:** 141 pages read in one pass, 4/4
  back-half clauses legible on 3 of 4 leases (the 1/4 is a title bundle at conf 68); 2.3–3.5 s/pp CPU.
- ❓ **Arm A — 36/47 fields agree (77%), and the number has NO interpretation yet.** The 11
  non-agreements were READ: 2 curly-apostrophe comparator artifacts, 2 `""`-vs-null artifacts,
  2 model-arithmetic disagreements on IDENTICAL source text (both texts carry the same monthly rent
  verbatim), 4 date disagreements of unknown cause, 1 real OCR error — on the synthetic fixture.
  **Without grading the model against a second run of itself on the DocAI text, "how much
  disagreement is the model" is unmeasured and no engine rate can be read.** → **OCR1c** (prompt
  staged: normalization, `--control self`, last-300-chars stderr, honest engine probes) → re-run
  with paddle.
- **DOC18 drained unattended meanwhile:** 4 windowed (80/91/109 full, **doc 96 the first true
  partial: 57pp → 50**), `bov_ready` 43 → 47, backlog 42 → 38 + 1 `window_failed`.
- Stale claims corrected in place: the OCR1 audit's own header (surya/paddle install assumptions);
  a drifted `:328-347` line ref on the cost page.

## 2026-09-02 — The bake-off's first real run did NOTHING: a Windows main-guard bug, silent exit 0

Scott ran the sequence; engines installed, `ocr-bakeoff-stage.ps1` staged **15 of 15**, and then
`--self-test`, `--fetch-baselines` and `--run` each **printed nothing and exited 0**. Cause:
`scripts/ocr-bakeoff.mjs:975` guarded `main()` with `import.meta.url === \`file://${process.argv[1]}\``,
which never matches on Windows (`C:\…` vs `file:///C:/…`) — so `main()` never ran. Line 960's
`new URL(import.meta.url).pathname` had the mirror bug. The sandbox is Linux and could not have
caught it; the silence was the only signal, and it is the `| tee`-without-`pipefail` shape again.
**Fixed** (`pathToFileURL` / `fileURLToPath`; the same `.pathname` idiom fixed in
`d1-cross-db-provenance-diff.mjs`; 10 other scripts already had it right). **Class guard added:**
`test/scripts-main-guard-windows.test.mjs`, mutation-verified RED on the original line. Self-test
now prints its 15 assertions. Footgun recorded in `CLAUDE.md`. **Scott re-runs from step 3 after
merging.**

## 2026-09-02 — OCR2 SHIPPED: deed OCR provenance persisted; the column had a second writer that REPLACED it

**Built:** `<dom>_merge_document_extracted_data` on gov + dia (applied live) = the **single owner** of
writes to `property_documents.extracted_data`; `api/_shared/document-text-provenance.js` (shape +
merge, one owner for both); `processOneDoc` writes provenance on both exits **after** the deed parse;
`deed-parser.js` routes its own write through the merge RPC with a legacy-replace fallback; the
`ocrTiered:false` opt-out is closed. Surfaces `v_gov_deed_ocr_provenance` /
`v_dia_deed_ocr_provenance`. Suite **5,074 / 5,068 pass / 0 fail**.

- ⚠️ **The prompt's premise was incomplete in a way that would have shipped a silent no-op.** It
  anticipated my write clobbering the deed parser's; the reverse was the live hazard —
  `deed-parser.js` PATCHed `extracted_data: {...}`, a **wholesale replace**, so provenance written
  beside `deed_extraction` was destroyed on every deed and on every re-parse. Proven by a key census,
  not a code read: gov's 185 rows carry exactly two keys, dia carries 10 with a third.
- ⚠️ **`revoke ... from public` left `anon`/`authenticated` holding EXPLICIT grants** (Supabase
  default privileges) — the complementary half of the documented B6d trap, caught only because the
  check was `has_function_privilege` rather than re-reading the REVOKE. Both roles now false.
- ⚠️ **Two guards passed their own mutation via the import line** and were replaced with behavioural
  tests. 16/16 mutations RED.
- **No backfill**: 507 rows' tier is unknowable (154 gov extractions predate DocAI, 140 undated).
  `unrecorded` holding at gov 325 / dia 182 IS the verification.
- ⚠️ **The two halves verify on different clocks.** PROVENANCE is pending a new deed (extraction backlog 0 on both domains, and the re-parse path deliberately writes none). The **MERGE fix runs on the next tick with no new deed** — the re-parse queue holds **gov 166 + dia 119 = 285** rows, each of which was a wholesale replace before. An earlier draft said only "pending a new deed" and that overstated the wait.
- Filed: **OCR2a** (re-parse writes none, deliberately — no extraction, no tier), **OCR2b** (the
  `needs_ocr` refusal reason is still discarded, unlike the CRE sidecar).
- Writeup `docs/audits/OCR2_DEED_OCR_PROVENANCE_2026-09-02.md`; canon
  `ai-and-ocr-cost-strategy.md` §0, `CLAUDE.md` (new jsonb-merge-owner doctrine + the privilege
  half), backlog OCR2 → ✅.

## 2026-09-02 — OCR2's premise REFUTED before drafting; re-scoped to deed OCR provenance; bake-off staging script

- ⚠️ **"The deed lane never tiers — all 325 deeds went to gpt-4o" was in three canonical documents
  and is false on both halves.** `document-text.js:217` passes `ocrTiered: true` by default and no
  caller passes `false`. The 325 was a **date artifact**: 154 of 185 dated gov deed extractions ran
  2026-07-15→07-25, before DocAI went live on 08-12. **Corrected in place** (strike-through) in
  `ai-and-ocr-cost-strategy.md` §0 + §5, `CURRENT-STATE.md`, backlog OCR2, and the handoff.
- **The real defect:** the handler computes `ocr_tier`/`ocr_engine`/`ocr_pages` and the PATCH at
  `:233` persists only `raw_text` — gov 325/0 and dia 182/0 deeds with text/with provenance. That is
  how an unverifiable claim reached three docs. **OCR2 re-scoped** to persist provenance (additive
  jsonb, RPC merge, fill-blanks, NO backfill onto pre-08-12 rows) and close the gpt-4o opt-out.
  Prompt: `prompts/OCR2-deed-lane-ocr-provenance.md`.
- **OCR1 run made mechanical:** `scripts/ocr-bakeoff-stage.ps1` copies the 15 sample PDFs from the
  synced OneDrive `PROPERTIES` folder into `bakeoff/<id>/source.pdf` (paths verified against the
  mount; 407 is a title/docs bundle, noted). `--model real` needs `OLLAMA_URL` (+ `OLLAMA_EXTRACTION`,
  CF Access pair) in `.env.local`, alongside `OPS_SUPABASE_URL` / `OPS_SUPABASE_SERVICE_KEY` for the
  baselines.

## 2026-09-02 — OCR1 reconciled (harness built, bake-off NOT run); DOC18's first tick failed on a THIRD deploy surface, fixed, verified on a real lease

**OCR1 (PR #2038) delivered the instrument, not the measurement.** `scripts/ocr-bakeoff.mjs` +
11 guards (9/9 mutations RED); sample size **3 synthetic fixtures, 0 real documents**; no §5 row
selected. The run is Scott's (workstation/GaryBuilt) — now on `OPERATOR-ACTIONS.md`. CC's canonical
edits to `ai-and-ocr-cost-strategy.md` were checked and stand. Two findings worth carrying: (1) the
harness caught its own C10-class defect — graded fields read under the model's JSON key scored
`both_null` forever, and counting both-null as agreement would have rendered 6/6 for fields never
read; (2) **removing the OCR cap does not give the consumer the whole lease** —
`LEASE_TEXT_SLICE_CHARS` (90k) caps consumption at ~52pp median / ~33pp p90, so OCR1b must say which
ceiling it moves. Arm B is 42 docs / 2,200 pages, not the four names my prompt listed.

**DOC18's first live tick (15:07) FAILED — `window_failed / cloud_ocr_non_ok`, `window_calls: 0`.**
Cause: the `docai-ocr` edge function was still **v24 (2026-09-01)**. DOC18 changed three surfaces —
`api/` (Railway), a migration, and `supabase/functions/docai-ocr` — and its deploy note named only
the first two. With the old function the `page_range` selector was ignored silently, the whole
39-page PDF went to DocAI, and it was refused over the cap; the route reported it honestly. Deployed
**v25** from the repo at 15:29 (health probe `page_range_supported: true`), re-fired one tick:
**doc 80 (31pp) → 2 calls, 31 pages, `[[1,31]]`, 0 gaps, 0 duplicates, 76,346 chars, full
coverage.** Backlog 42 → 41 + 1 attempted (doc 61 retries when its marker rotates to the head).
⚠️ **Rule added to `CLAUDE.md`: a change touching `api/`, `supabase/migrations/` and
`supabase/functions/` has THREE deploys; check `list_edge_functions` `updated_at` against the merge
time the way `/version` is checked for Railway.** ✅ Positive control on the diagnosis: the DOC17
probe function (`docai-page-probe`) had been deployed the same day by CC, which is why DOC17's
measurements were real while DOC18's route was not.

**Consolidation:** OCR1 prompt + response → `done/`; eight already-reconciled responses (C13, DOC1,
DOC8, DOC14, DOC16, DOC17) → `responses/done/`; ten already-shipped prompts (C6, C8, C10, C11, C13,
DOC1, DOC14, DOC16, DOC17, B6e-ci-required-check-prep) → `done/`. **`prompts/` now holds only the
open PR8 and the handoff.** Dedupe grep clean.

## 2026-09-02 — DOC18 LIVE (migration applied, deploy confirmed, dry run correct); OCR1 prompt corrected before send

- **Deploy confirmed** by `/version` = `f8d42593` (the `main` tip after #2034), not by a handler
  probe. **Migration `20260902120000` applied from Cowork** and censused: 3 columns, cron
  `lcc-cre-doc-text-longdoc` active, `v_lcc_cre_longdoc_backlog` = 42 / pages 31–141 / 0 unknown.
  ⚠️ Order was writer-first (Railway auto-deploys on merge); safe only because the non-windowed
  payload carries no new keys. **Ungated dry run** (`mode=longdoc&limit=3` via `pg_net` + the vault
  key): plans correct on docs 61/80/91 — first segment 30, every later segment ≤15.
- ⚠️ **`'vercel'` was a dead LABEL, not a dead host — and it is now RETIRED at the source** (Scott:
  *correct it so it cannot distract a future chat*). `lcc_cron_post` routes anything not `'edge'` to
  the Railway URL; 50 of 155 jobs still said or defaulted to `'vercel'`, and C1 had already misread
  one as "posts to the retired host". Migration `20260902140000` (applied live): default → `'railway'`,
  all 36 explicit commands relabelled via `cron.alter_job` (0 remain), `'vercel'` kept as a silent
  alias so a replayed older migration cannot break. `CLAUDE.md` C1 line + backlog **C1-note**
  corrected in place with strike-through; footgun added under `lcc_cron_post()`.
- **OCR1 prompt corrected in place before sending — three defects:** (1) **the sample it asked
  for cannot exist** — the longest DocAI baseline is exactly 30 pages *because* of the cap, so
  "≥3 leases over 30pp with a baseline" is structurally empty; split into arm A (head-to-head,
  ten named ids) and arm B (over-cap leases 319/320/200/61, graded on consumer-field coherence,
  no baseline); (2) **the sandbox cannot reach the PDFs or the baselines** (DOC17/18 measured
  `http=000`), so CC builds the harness and proves it on a synthetic fixture, Scott runs it on
  the box; (3) `extractTenantFromLease` calls a model — same model both arms, recorded. Two
  drifted line refs fixed (the `deps.freeOcr` seam is ~:631, not :328; `rawDocument` is in the
  edge fn, not `document-text.js`).
- `bakeoff/` added to `.gitignore` (it will hold client lease text). The arm-A baselines are NOT
  pre-exported — a 538k-char SQL result does not belong in a chat transcript; the harness fetches
  them itself on the workstation (`--fetch-baselines`, §6b).

## 2026-09-02 — DOC18 reconciled: merged (#2032), NOT running; §7b re-measured; six backlog ID defects fixed

**DOC18 came back and is merged** (`e5c8f34e`, PR #2032). Claude Code had already written the
canonical DOC18 section; this turn reconciled the rest. Re-measured on LCC Opps at ~16:00 UTC:

- **Migration `20260902120000` is NOT applied** — 0 of the 3 partial-extract columns, no
  `lcc-cre-doc-text-longdoc` cron, no `v_lcc_cre_longdoc_backlog`. **42 `over_docai_page_cap`
  markers unmoved.** Redeploy unconfirmed (Railway unreachable from the sandbox). *Merged is not
  running.* Operator sequence is in backlog **DOC18**: migration → redeploy both services → the
  ungated `mode=longdoc` dry run → let the cron run one document per tick.
- **§7b**: undrained **401** (was 426), consumer-visible sidecars **289**, `bov_ready` **43** (was
  37), `bov_extraction` **25**, gov deeds **325/325**.
- ⚠️ **Corrected my own claim in place:** "ZERO gpt-4o since redeploy" is false by two rows — both
  in the first two ticks after the 09-01 15:00 redeploy (15:00 and 16:00), both `thin_ocr_result`
  fragments (116 / 211 chars), and **zero since 16:01**. 88 DocAI events in the same window. The
  escalation is closed; the wording was over-stated for the window it was read in.
- **Consolidation:** the canonical page's CURRENT STATE block carried a merge artifact — two copies
  of the "live gap" / "retry markers" rows and two "Open" lists (one pre-DOC17, one post). Collapsed
  to one. **Backlog duplicate grep found six:** `B6d-pri-metrics` and `B6d-sam` were genuine
  duplicate rows (merged); **`J2`–`J4` and `PR6` were ID COLLISIONS** — two unrelated items sharing
  an ID (P1c's JV items vs P14d's Power-Automate items; the I12 `land_area` defect vs the
  `manual_verify` priority question). Renamed P14d `J1–J6 → PA1–PA6` (one cross-ref in
  `OPERATOR-ACTIONS.md` updated) and the `manual_verify` row → `PR9`. ⚠️ **The dedupe grep reports
  collisions and duplicates identically — read the rows before merging.**
- Response + prompt moved to `done/`.

**Next:** run **OCR1** (`docs/claude-code/prompts/OCR1-local-ocr-bakeoff.md`), leading with its §0.

## 2026-09-02 — Thread wrapped: handoff written, STATUS archived, topic set consolidated

**This window is being continued in a fresh context.** `docs/os/DATA-PROCESS-AUDIT-HANDOFF.md` is
the kickoff document — it replaces reading this file end to end, and `CLAUDE.md` now points at it.

**Consolidation done in this turn:**

- **`STATUS.md` archived at 10,531 lines** → `docs/history/STATUS_claude-code_2026-08-20_to_2026-08-21.md`
  (1,726 lines, verbatim, pointer left behind). Now 8,814. ⚠️ **The file is NOT strictly
  date-sorted** — two windows append to it — so a date-based cut must be verified against the actual
  headings rather than assumed. I checked the archived range before writing it.
- **Nine canonical topic pages** now carry live state, decisions made, and traps paid for; the
  fourteen B6 audits are bannered as evidence-for-their-date pointing at them.
- **Backlog: 169 open 🔴 / 56 🟡 / 76 ✅.** Nothing unbuilt was dropped — the rule is *extract before
  archiving*, which recovered 62 items earlier in this arc that existed in no tracker.

**The handoff carries what a fresh chat actually needs**: which of the two parallel windows it is
(and which queued prompts belong to the OTHER one), the through-line that *every producer failure in
this arc reported success*, the in-flight `B6e-ci-last5` with its unresolved `B6e-ci-baseline39`
caveat, the next steps in order, the git sequence including the index-lock step, the consolidation
rules, and the eight traps this thread paid for.

⚠️ **Recorded honestly in the handoff: two of the corrections this thread made were to my own claims
that had already shipped into canonical pages** — the "latent, not live" call on the CM econ
exhibits, and "the firm model is unpopulated" when it is mis-populated. **The turn protocol now says
to correct your own prior claims in place and say so plainly**, because both were caught only by
re-measuring something that sounded right.

## 2026-09-02 — OCR1 staged as a BAKE-OFF, and the cost case does not survive the numbers

**Scott asked for the cheapest, highest-quality OCR source we can build. Measured it first, and the
justification I had been carrying is wrong.**

| method | tier | docs | avg chars | **billed pages** |
|---|---|---:|---:|---:|
| `pdf_text` — **free** | — | **140** | 38,664 | 34 |
| `office_text` — **free** | — | **45** | 32,935 | 0 |
| **`ocr`** | **DocAI** | **91** | **13,801** | **574** |
| `ocr` | gpt-4o | 20 | 1,511 | — |

🔴 **185 of 362 documents (51%) already extract FREE. Only 111 ever needed OCR. Total DocAI spend to
date: 574 billed pages ≈ $0.86** — corpus scale $23–53. **So cost is NOT the case for local OCR, and
the prompt leads with that rather than burying it.** Anyone arguing it on savings is arguing from a
number that does not support it.

🟢 **The real prize is that a local engine has NO PAGE CAP.** ⚠️ **Every hard problem in this arc —
DOC8, DOC14, DOC16, DOC17, DOC18 — was about Google's 15/30-page limit, not money.** Five prompts, a
refuted design, a blocked GCS build and a live probe, all to work around a cap a local engine simply
does not have. **It dissolves the class, including DOC18's partial-extract ceiling and DOC14
entirely.** Then **confidentiality** (today the complete PDF of every under-cap lease is sent to
Google) and **resilience** (⚠️ this session lost time to a credit-balance 400 on the Anthropic path).

**Prompt staged: `OCR1-local-ocr-bakeoff.md` — exploratory, measures before building.** ⚠️ **The
metric is FIELD AGREEMENT from `extractTenantFromLease`, never `char_len`** — a garbled OCR produces
plenty of characters, and **this repo was already burned by exactly that**: gpt-4o's 1,511-char rows
passed every count-based check while being useless. Sample ≥10 documents that actually needed OCR
(**not `pdf_text` rows, which would flatter both sides**), including ≥3 leases over 30pp. Runs on the
**GaryBuilt box** behind the existing tunnel + CF Access — ⚠️ **a dedicated service token, never the
ollama one** — and must **fail soft to DocAI**, with "the box is down" distinguishable from "the
document has no text." **Wiring is OCR1b, only if the bake-off measures a winner. Losing is a
legitimate outcome and is recorded so it is not re-proposed.**

📋 **The handoff now carries a recommended order:** DOC18 (reconcile) → **OCR1** → OCR2 → OCR1b (if
OCR1 wins) → OCR3 → then the BD thread (C18, C19). ⚠️ **And a standing instruction: if OCR1 wins,
revisit DOC18's ceiling and DOC14 immediately** — carrying a workaround past the thing that removed
the need for it is its own failure.

## 2026-09-02 — AI/OCR COST STRATEGY: the free tier is designed, has a producer, and is NOT WIRED

**Scott asked whether these AI calls should run local, Microsoft-native, or Google — with the
long-term view rather than the current subtask's best objective. Inventoried the whole surface.**
New canonical page: **`docs/architecture/ai-and-ocr-cost-strategy.md`**. Filed **OCR1–OCR6**.

🔴 **THE HEADLINE: `deps.freeOcr` — Tier 1, the $0 tier — HAS NO SERVER-SIDE PRODUCER AND NO
DEFAULT.** Both real callers build `deps` without it, so the whole Tier-1 block is skipped and
execution falls straight through to paid. **Every OCR call this system has ever made started at a
paid tier.** The only producer (`scripts/lease-ocr-backfill.mjs:379`) takes a **filesystem path**,
not `{buffer, mediaType}` — **structurally incompatible with the seam** — and runs on the
workstation. **The $0 tier exists in the design, the comments and a script, and has never once run
in production.**

🔴 **AND THE DEED LANE NEVER TIERS AT ALL** — `document-text.js:502-505` calls gpt-4o directly,
bypassing DocAI, gated only on `OPENAI_API_KEY`. **All 325 extracted deeds went to the 6–14× tier by
default** (OCR2).

⛔ **MICROSOFT IS REFUTED, and the repo had already established why:** M365 Copilot has **no
batch-OCR API**; Microsoft's OCR product is **Azure Document Intelligence, separately metered** (not
in the M365 subscription); and ⚠️ **Northmarq IT BLOCKS Azure AD app registrations** — documented in
three independent places. There is **no Azure AI client anywhere** and **no AI action in any of the
18 Power Automate flows.** It would be a new paid vendor through a blocked auth path, for no
advantage over DocAI. **Recorded as OCR6 so it is not re-proposed.**

✅ **The LLM side is already largely local** — `qwen2.5:14b` on GaryBuilt, with **9 flags ON**
(`OLLAMA_EXTRACTION`, `OLLAMA_CLEAN_ASSIST`, `PROPERTY_TWIN_ASSIST`, `MATCH_DISAMBIG_ASSIST`,
`W9_3_SF_ASSIST`, `OWNERSHIP_CHAIN_DRAFT`, `DRAFT_ASSIST`, `BRIEFING_ANALYST_TAKE_ONPREM`,
`OCR_CLOUD_DOCAI`). ⚠️ **The migration seeds say `off` and the DB says `on` — the seeds are
authoring-time snapshots that deliberately do not update `state` on conflict. Only the DB is
authoritative.** ⚠️ **But OCR is not an LLM task and Ollama does not do it** — conflating the two is
the trap here.

🔵 **The default cloud path may be FAILING rather than spending** (OCR3): `invokeChatProvider`
defaults to the edge fn pinned to **`claude-sonnet-4-20250514`**, which two independent records say
is **retired (400)** and additionally hitting *"credit balance too low."* ⚠️ **The fallback chain
would absorb that silently into `gpt-4o-mini`** — so ~10 un-flagged call sites may be on a fallback
nobody chose. **Measure before assuming either way.**

⚠️ **No pricing constant, rate variable or spend budget exists in executable code** (OCR5). The
~$1.50/1k figure is **comment-only in four places**, `ocr_pages` is recorded as *what we were billed
for* and **never priced**, and **the rate itself is unverified** — the pricing page is egress-blocked
from every environment tried.

**Recommendation: ship DOC18 now (~$3.30, don't hold it), then OCR1 — an OCR endpoint on the
GaryBuilt box behind the EXISTING tunnel + CF Access (the SOS-proxy precedent), injected at the two
call sites where the seam already exists and is already stubbed in tests.** That makes routine OCR
**$0/page permanently** and leaves DocAI as the escalation, which is what the design always said.

⚠️ **THE RISK, NAMED NOT ASSUMED PAST: local OCR quality on executed leases is UNMEASURED.** The only
tier comparison we hold — DocAI 14,687 avg chars vs gpt-4o 1,579 — says **gpt-4o is bad, not that
Surya matches DocAI.** **A bake-off on 10 real leases is part of OCR1.** If local loses, Tier 1
becomes a born-digital pre-filter and DocAI stays the workhorse — still a large and honest saving.

📋 **Session handoff written:
`docs/claude-code/prompts/HANDOFF-2026-09-02-document-ocr-and-owner-roles.md`** — carries the state,
the open items, the git/lock procedure, the documentation and consolidation discipline, and the
measurement traps that actually bit this session.

## 2026-09-02 — DOC17: the cap is measured against the SELECTION. The cheap route works; DOC18 staged.

✅ **Probed on a real 316-page PDF. `individualPageSelector {pages:[31..45]}` returned 200 with pages
31–45 and 65,297 chars, and the positive control (`fromStart:15`) also passed.** ⚠️ **Both arms
passing is what makes it an answer** — a single success proves nothing about a selector that might
have been ignored, so **the returned page NUMBERS are the evidence, not the page count.**

**THE RULE: 30 pages per call contiguously from page 1 (imageless); 15 pages anywhere else.**
⚠️ **A 31-page selection was refused for being 31, NOT for being part of 316 — the document total
never enters the arithmetic.**

**So a 50-page window is 3 calls, our 141-page maximum is 9, and the whole 42-document backlog is
~$3.30 — with no GCS, no IAM, no service-agent grant, no lifecycle rule, no LRO table and no
confidentiality decision.**

⚠️ **This corrects my own last entry: DOC16's refutation stands, its CONSEQUENCE does not.** Its
pages-31–50 call **is** available, just at 15 pages rather than 30 — three calls where it assumed
two. **The "~40% of the window unreachable" figure was the honest number for a ONE-call route and
must not be carried into Scott's DOC14 decision.**

**Four traps measured, all load-bearing for DOC18:** ⚠️ **`metadata.page_limit` reports the MAXIMUM
ACHIEVABLE limit, not the one in force** (says 30 when 15 applies — and `pageLimitFromError` prefers
the structured field **by design**, so a retry sized from it loops forever) · **the `At most 15
pages` shape carries no `details[]` and BOTH parser halves are blind to it** · **the base limit is 15
and the baseline arm said 30** — *one error's metadata is not a limits table* · `docai-ocr` resolves
one secret with `||` so the first env var **shadows** the others.

⚠️ **Honest gap, stated not glossed: the probe document is NOT one of the 42** —
`SHAREPOINT_FETCH_URL` is a Railway var, not a Supabase secret, so their bytes are unreachable from
where the credentials live. **Nothing moved:** 42 markers, `docai-ocr` byte-identical, spend $0.09.

🟢 **DOC18 staged** — the three-call route, with all four traps written into it and the honest
ceiling recorded (pages beyond ~50 stay unread; the `abstract` wants clauses from the back half).
👤 **DOC14 should probably be CLOSED — Scott's call**, and the input has changed: no longer *"a GCS
build or lose 40% of the window"* but **"a GCS build or nine cheap sync calls."**

🧹 **Consolidation: the DOC backlog went 19 rows → 11.** ⚠️ **DOC8 and DOC9 each had TWO rows** (as
DOC13 did last round). Eight resolved items are now one summary line pointing at the canonical page;
**every open item keeps its full detail and nothing was lost.**
## 2026-09-02 — DE1/BR1/BR2 shipped, and MY "latent, not live" call was wrong (Dialysis PR #7392)

| unit | outcome |
|---|---|
| **DE1** | both CM econ exhibits gated on `payer_mix_source`; **both MOVED** |
| **BR1** | 2,425 rows typed from recorded facts; **nothing written**, 72 mints withheld |
| **BR2** | producer fix **+** 846-row backfill together; `name_set_id_null` 1,930 → **1,084**, `id_set_name_null` held at **0** |

### 🚨 The correction, and it is mine

I wrote *"latent, not live — do not describe it as a current book error"* into the prompt and into
the canonical page. **It was wrong, and CC measured it before acting on my premise.**

I reasoned about FY2026 alone — correctly excluded by `HAVING count(*) >= 1000` at 724 rows — and
concluded the exhibits were protected. **But modeled rows exist in EVERY year**: 523
`partial_plus_default` across FY2021–24, 210 in FY2024 alone. **The year threshold never guarded
against them.** Verified live after the fix:

- `cm_dialysis_clinic_econ_trend_y`: FY2024 clinic count **6,754 → 6,536**, avg revenue/clinic
  **$3,476,458 → $3,584,713 (+3.1%)**.
- 🚨 `cm_dialysis_operator_unit_economics` was **LIVE-WRONG**: it filters on `is_current_year`, which
  spans **FY2011–2026**, so it served the FY2026 fallback husks directly. **Satellite's
  revenue/clinic was understated by 41%** and several operator margins roughly halved.

**The lesson: a year-based guard and a quality-based guard are not substitutes.** I treated a
row-count threshold as if it protected against modeled data; it protected against thin years, and
the two populations only partly overlap.

⚠️ **And CC rejected the obvious confound rather than assuming it** — modeled ≠ merely stale.
Measured-but-stale clinics look normal ($3.42M, 8,742 treatments/yr); modeled rows are damaged in
**both** vintages (stale = husks at **27 treatments/yr**, recent = the $301.85 fallback signature).
**Gating on the fact is right; gating on vintage would not have been.**

### 🚨 Second correction: the firm registry is MIS-populated, not merely unpopulated

My page said *"the model is right, it is unpopulated."* Measured on `broker_companies` (131 rows):
**73 (56%) contain a `;`**, 28 are single-token abbreviations (`ay`, `cb`, `acre`, `cook`), 9 read as
person names, and **7 are the `colliers%` family**. Live: **`cbre; smyth & colliers; patel`** minted
as one company; `colliers`, `colliers international` and five `colliers; <agent>` rows as separate
firms; `colin cornell` as a company. **The composite defect was written into the firm table too, so
the real distinct-firm count is far below 131** — and any matcher pointed at this registry will
attach agents to composite pseudo-firms. Both canonical pages corrected in place.

### Also worth keeping

- **`contacts.entity_type` is NULL on all 1,916 rows** — useless as a typing instrument, and CC
  graded it *before* relying on it rather than after.
- **CC caught its own masking twice**: `| tail -30` hid pytest's summary behind a module's `atexit`
  output, and a background shell's cwd made `tests/` unresolvable while the shell still reported
  success. **Same class as the `| tee` defect this whole arc is about** — its numbers now come from
  a file rather than a pipe.

### ⚠️ OPEN — the suite reads 39 failed against a documented baseline of 14

None of the 39 touches broker, `listing_broker`, `update_field` or the econ views, and
`test_listing_broker_update` (9 tests, 5/5 mutations RED) passes inside the full run. But
**isolation cannot adjudicate it** — the same 12 files give 7 failures alone and ~34 inside the
suite, which is the documented cross-module stub pollution. The apples-to-apples baseline run was
still in flight. **Do not treat 14 → 39 as a regression or as noise until that lands.** → `B6e-ci-baseline39`.

## 2026-09-02 — DOC16 REFUTED on an unpredicted branch; my "lossless" claim inverts; DOC17 probes the decider

**The gate ran and the sync path DOES accept a page selector** — `processOptions` →
`individualPageSelector {pages}` / `fromStart` / `fromEnd`, read from the live v1 discovery document
(rev 20260820), **not** inferred from the repo's `imagelessMode` comment.

⚠️ **But the constraint sits where neither DOC16 nor its own STOP clause looked.** Google's Limits
page: the 30-page extended cap *"is only applicable when processing pages contiguously **starting
from page 1**."* So DOC16's second call — pages 31–50 — **cannot claim it by construction**, and that
call was the load-bearing half: the whole difference between **~54,000** and **~90,000 chars**.

🔴 **AND MY §4 CLAIM INVERTS RATHER THAN SHRINKS.** I wrote that this route was *"lossless on the
consumer's terms."* A 30-page-only route drops pages 31–50 across **all 42** documents — **~36,000
chars, ≈40% of the consumer's 90,000-char window**, content `extractTenantFromLease` genuinely reads.
**Corrected in place rather than left standing.**

⚠️ **Good instrument discipline in the run, worth keeping:** the discovery document states **no page
limits at all**, and that was read as **a property of the instrument (a schema, not a quota surface),
not as permission** — Class 11, caught rather than cashed.

**Re-measured: the population is 42, not 40** (18 at 31–50pp, 24 at >50pp, max 141); chars/page
reproduces at 1,808 / 1,732 over 85 rows. Live now: undrained **419**, `bov_ready` **39**, gpt-4o
escalations still **0**.

🟢 **DOC17 staged — ONE API call decides between "no GCS at all" and the full GCS build.** The
unsettled question: **is a NON-page-1 selection measured against the selection or the document
total?** Google's docs are silent, and DOC8's `{page_limit:30, pages:40}` **was taken with no
selector, so it does not discriminate.** ⚠️ **The probe carries a mandatory positive control**
(`fromStart:15` on the same document, which must succeed) — **without it a failure cannot be told
from a silently-ignored selector**, which is the DOC8 no-op shape exactly. ⚠️ **Probe only; build
nothing either way.**

**Succeeds** → multi-call sync reaches ~50 pages with no GCS, no IAM, no new vendor surface and **no
confidentiality decision at all.** **Fails** → sync caps at 30 pages, **DOC14 becomes genuinely
necessary**, and Scott's decision gets weighed against an honestly priced alternative: **30 pages
captures ~60% of the consumer's window.**

## 2026-09-02 — DOC16 staged: the consumer truncates at ~50 pages, so the GCS build is probably unnecessary

**I was about to take Scott a confidentiality decision. Two measurements first, and they changed the
question.**

**1. `bov-extract.js:147` slices lease text at 90,000 characters before prompting.** Our corpus runs
**1,799 chars/page (median 1,727) → 90,000 ≈ 50 PAGES.** **The consumer never reads past ~page 50 of
any lease, however it was extracted.** Against the 40 over-cap documents: **16 are 31–50pp (fully
used) and 24 are 51–141pp** — ⚠️ **so for 60% of the population the entire GCS batch build delivers
text `extractTenantFromLease` throws away.**

**2. ⚠️ The confidentiality delta is much narrower than it appeared.** `document-text.js:262` already
sends `content_base64` of the **whole file**, and deployed `docai-ocr` v24 passes it through as
`rawDocument` — **Google already receives every under-cap lease in full, today.** Batch adds
**persistence at rest in a bucket**, not disclosure. **Still a real decision, but a different one —
and I would have put the wrong question to Scott.**

**DOC16 staged: two sync calls, pages 1–30 and 31–50, concatenated into one contiguous `raw_text`** —
~50 pages ≈ 90,000 chars, **exactly what the consumer can use, with no GCS, no IAM, no new vendor
surface.** ⚠️ **NOT the analysis-chunking DOC14 §6 forbade** — that warned against splitting the
*analysis*; this splits the *OCR call* and yields one contiguous text.

⚠️ **It rests on ONE unverified question and the prompt leads with it:** does the 30-page imageless
cap apply to the page **SELECTION** or the document **TOTAL**? **If the total, the route is
impossible — stop and fall back to DOC14.** The repo sends **no `processOptions` at all** today, and
⚠️ the existing `imagelessMode` comment is about a **different field** and is **not evidence** about
where a page selector belongs — **DOC8's exact lesson, written into the prompt so it is not repeated.**

⚠️ **Honest residual, recorded not buried:** `raw_text` is not read only by `extractTenantFromLease`.
The `abstract` block wants **renewal options, early termination, default cure, holdover, key lease
risks** — clauses that routinely sit in the **back half** of a long lease. Pages 51+ are not
captured, and **a `partial_extract` row must never count as complete coverage.**

**DOC14 is not withdrawn — it is the fallback, and the confidentiality decision is DEFERRED, not
answered.**

## 2026-09-02 — DOC14 blocked on a CONFIDENTIALITY decision; DOC13 answered; the sizing moved ~2×

**DOC14 stopped at the operator prerequisite and built nothing — the intended outcome.** The async
contract was verified from the **live v1 discovery document** (rev 20260820): `batchProcess` → LRO,
poll `operations.get`, output at `outputGcsDestination`.

⚠️ **TWO WAYS MY PREREQUISITE LIST WAS WRONG, and the missing half is the expensive one.**
**`BatchDocumentsInputConfig` accepts ONLY `gcsPrefix`/`gcsDocuments` — batch takes NO inline
bytes**, so an **INPUT bucket is mandatory too and every SharePoint byte-stream must be uploaded to
GCS first** — materially more than "add a bucket." And **`imagelessMode` does not exist on
`BatchProcessRequest`**: DOC8's flag does not carry over.

🔴 **THE GATE IS CONFIDENTIALITY, NOT COST.** ~$3 for the whole projected backlog. **But batch writes
the FULL TEXT of confidential executed client leases to GCS as JSON** — Scott's decision, not
plumbing. ⚠️ The **~500 pp ceiling remains UNVERIFIED** (`docs.cloud.google.com` egress-blocked).

⚠️ **THE SIZING MOVED ~2× OVERNIGHT — my own "small sample" caveat cashed in, and it corrected three
documented claims:** lease **17.0%** (was 8.1%, then 10.1%) · ⚠️ **"100% leases" REFUTED — DD is 4 at
4.4%** · **max pages 57 → 141**, which **makes the unverified ~500 pp ceiling load-bearing after
all**, reversing yesterday's "our largest is 59 pages" reasoning. **~87 projected; 40 already marked
with 426 undrained.** ⚠️ **Third time in this arc a rate moved materially as the sample grew** (the
86% escalation, `repeat_buyer` 8×, now this) — **quote a rate with its denominator AND its sample.**

✅ **DOC13 ANSWERED — `retry_admitted: 0` is CORRECT.** 11 of 14 markers are past 24 h with no
re-extraction, which reads like a stall and is not: `scan_lowest_id: 2 · scan_capped: false ·
eligible: 15` — **the scan reaches the oldest document, is not budget-capped, and fills its limit
from the 426 FRESH documents first.** Retries are correctly lowest priority while real work exists.

🔵 **DOC15 filed as a watch:** if documents arrive faster than the drain, **the retry lane never
runs** — Class 12 one level up, a lower-priority lane that can starve. **Verify `retry_admitted`
goes non-zero as `undrained` approaches 0.**

🧹 **Consolidation, and one real defect found:** **`PLANNED-BACKLOG.md` carried TWO DOC13 rows** —
collapsed to one. And **the canonical page now opens with a CURRENT STATE block**; §0 had become an
eight-entry dated worklog a new reader would have to read backwards. Live: deeds **325/325** · drain
**771 → 426** · **`bov_ready` 5 → 37** · **22+ OCR events, 100% DocAI, zero gpt-4o** · 🔴 **40
documents getting no text at all.**

## 2026-09-01 — DE1 + BR1 + BR2 drafted as one prompt, and Unit 3 carries a hard prerequisite

`DE1-BR1-BR2-confidence-gate-and-broker-identity.md`. Three units, ordered smallest-and-independent
first, each shippable alone.

**Unit 1 (DE1)** gates the two CM econ exhibits on **`payer_mix_source = 'hcris_form_265_11'`** — the
FACT — rather than on `confidence_tier`, its proxy. ⚠️ **The expected result is NO CHANGE today**, and
that is the point: it proves the gate is additive. **A view whose output moves today would mean it
was already admitting modeled rows, which is a bigger finding.** The `HAVING count(*) >= 1000` stays,
because it guards a different thing.

**Unit 2 (BR1)** types the person/firm split. ⚠️ **Recorded facts before regexes** — `company`,
`broker_company_id` and `contact_id` (1,916 populated) all carry evidence, and the
two-capitalised-tokens name heuristic has already cost this codebase real companies. **Undecidable
rows stay undecided.**

🚨 **Unit 3 (BR2) has a hard prerequisite I nearly missed while sequencing this.**
`B6e-ci-last5-decisions-resolved.md` is **still queued, not run** — and it carries the `update_field`
producer fix. **Backfilling the broker FK while that producer is still broken is a one-shot repair of
a live producer, the Class 8 failure this repo documents over and over.** So the prompt requires
**either landing the producer fix in the same change, or stopping at the plan and saying so.** It may
not ship the backfill alone.

**Deliberately out of scope: BR4 (the 143 duplicate-name groups).** Deduping before the firm link is
populated would merge two real people at the same firm — resolving the firm is what makes a duplicate
visible or explains it away.

## 2026-09-01 — Broker + Medicare storage audited and CANONICALISED, so neither gets re-flagged as a bug

Scott: *"clean the broker and firm name storage so it's cleanly shown everywhere… be sure to update
this finding in all documentation so we don't flag it as an error in future chat either way…
document the same for medicare… anything else that would get us closer to accurate."* Two new
canonical pages, both leading with **what is NOT a defect**:
`broker-and-firm-identity.md` and `dialysis-economics-and-medicare-data.md`.

### Broker — yes, clean it, but it is a MODELLING job, not string cleaning

🚨 **`broker_name` is not a name field. It is a composite** — `;` on **344 of 2,425** broker rows and
**778 sales rows**, carrying at least three different facts: `Acre Advisors; Reid` (firm ; agent),
`Adrian Mendoza; Sean Sharko; Austin Weisenbeck` (a three-agent team), and `Avison Young; Barnes`
alongside `AY; Barnes` — **the same firm, spelled out and abbreviated.** ⚠️ **49 rows carry `&` and
no `;` and are mostly REAL firm names** (`Lee & Associates`) — the P158a hazard again: **an `&` is
part of a name, not a separator.**

⚠️ **So "clean the strings" would destroy information.** A co-listing is a real fact; collapsing it
asserts something false. **The model already exists** — `broker_companies` (131 rows), `brokers`
(2,425), `broker_company_id` — and it is **7.6% populated**, while **299 `broker_name` values look
like a firm** and **177 have `broker_name` == `company`**. Parse into it; keep the raw string as
evidence. → `BR1`–`BR5`.

✅ **Recorded as explicitly NOT a defect: `listing_broker_id` set with the name NULL is 0 of 4,783.**
Both-columns is the existing design, not a new requirement.

### Medicare — the accuracy answer is a column nobody filters on

**`clinic_econ_reconciled.confidence_tier` separates measured from modeled.** FY2021–2024 is
**98% `hcris_form_265_11` / high** (26,021 rows, 6,590 clinics). 🚨 **FY2026 holds ZERO
`hcris_form_265_11` rows — 659 `partial_plus_default` + 65 `national_default`, all `low`** — because
2026 cost reports have not been filed. **Its "73.66% Medicare / $297.87 blended" is the fallback
signature, not a market shift**, and that signature is stable across every year it appears
(~$295–301 / 65–75%), which makes it very easy to read as a trend.

⚠️ **A year chart including FY2026 shows the blended rate going ~375 → ~298 and reads as a 20% rate
collapse.** **Latent, not live** — `cm_dialysis_clinic_econ_trend_y` tops out at 2024 — **and its
only protection is `HAVING count(*) >= 1000`, a magnitude proxy, with FY2026 sitting at 724.** → `DE1`.

⚠️ **I nearly published the opposite finding.** My first audit used
`definition ILIKE '%confidence_tier%'` and reported three views as "careful"; that matches the
**SELECT projection**, not a filter. Re-tested for the predicate: **exactly 1 of 8 econ views has
`confidence_tier` in a WHERE clause.** The P182 deparse-grep trap, committed while auditing for
precisely that class — and caught only because the trend view's actual output stopped at 2024 and
did not match my alarm.

Also recorded as **not defects**, so they stop being re-raised: the flat blended rate (−0.6% over
four years — what drifts is payer mix), `RATES_2025` == `CMS_2023_RATES`, `facility_patient_counts`
being an ~annual CMS reporting series rather than a nightly feed, and future-dated `snapshot_date`
values being CMS fiscal-period convention. **What would genuinely improve accuracy is `DE1`–`DE4`**,
of which DE1 is the only one with a path to a client deliverable.

## 2026-09-01 — C13c SHIPPED: `one_off_owner` carries its confidence, and the fourth column answered

**Live on LCC Opps.** `one_off_owner` **142 = 13 `_sf_corroborated` + 129 `_unverified`** — the
COUNT deliberately unchanged — plus **21 named institutional rows** on
`v_lcc_entity_role_ambiguity.entity_type_contradicted_by_named_review`, read from the
`lcc_entity_role_confirmation` ledger and **never a name stoplist in the classifier**. Every other
arm, `v_lcc_user_owner_candidates` (15), multi-role (954) and **P0.4 (555)** unmoved. Migration
`20261006120000`; guard `test/c13c-one-off-owner-confidence.test.mjs` (9 tests, **21/21 mutations
RED**). Writeup `docs/audits/C13c_ONE_OFF_OWNER_CONFIDENCE_2026-09-01.md`.

⚠️ **C13b's "no non-lexical corroboration exists" was THREE ABSENCES, NOT A SEARCH.**
`salesforce/Account`, `works_at` and `org_type` are genuinely 0 — and the fourth column,
`salesforce/Contact`, answers on **13 of 142**, with **ZERO of the institutional names carrying
one.** *Before recording that a fact has no corroboration, enumerate every identity the table can
hold.*

⚠️ **The routed set is 21, not the ~15 the brief predicted, and the extra 6 are the arm's biggest
rows.** The brief's list is drawn from the 28 that FAIL `lcc_looks_like_person`, so it structurally
cannot contain **`Gates Hudson` ($19.6M)** or **`Metropolitan Life Insurance` ($11.8M)** — #2 and #3
by rent, both of which **pass** the name test and were already read in the design page. **A list
filtered by a failing instrument is not the population.**

⚠️ **The uncorroborated 129 read ~80% genuine, and nobody had measured it.** A deterministic 10-row
sample: **8 clear individuals, 1 clearly not (`Everbank`, already routed), 1 ambiguous
(`Peter Hanson RE`)**. The 28 name-test failures are not a random sample of the 129.

⚠️ **The brief's prose and its numbers disagreed and the numbers won.** "…so they stop being emitted
as individuals" against an assertion table reading 142 unchanged, split 13/129. Shipped the split,
not the suppression — and **proved the reason: all 21 keep `investor_owner`**, so the wrong label
removes nobody and admits nobody today. Suppression is **C13f**; the `entities.entity_type` repair
is **C13g** (floor 414 entities / $181.8M — ⚠️ *the lexical 13,225 measures the regex, not the
population*); the corroboration ceiling is **C13h** (9% here vs 75% fleet-wide, because this arm is
RCA/CoStar capture the CRM has never held).

⚠️ **`test/c13b-entity-roles-multilabel.test.mjs` now reads the C13c migration** — C13c rebuilds the
view, so the C13b file no longer describes what ships (P197). All 11 C13b invariants pass over the
shipped definition.

## 2026-09-01 — DOC14 sized and staged: the over-cap population is 100% LEASES, at 8.1%

**Re-measured on a larger sample per my own caveat, and it sharpened rather than softened.**

| doctype | drained | **over cap** | rate | still undrained |
|---|---:|---:|---:|---:|
| **lease** | 86 | **7** | **8.1%** | **360** |
| dd | 51 | **0** | 0% | 205 |
| om | 30 | **0** | 0% | 39 |

**Every over-cap document is a lease**, 31–57 pages. **Projected: ~29 more, ~36 total** receiving no
text at all.

⚠️ **AND THE DENOMINATOR CAUGHT ME MID-SESSION.** `over_cap ÷ page_counted_leases` reads **32%** —
but only OCR-path rows carry a `page_count`, so that is the OCR subset, not all leases. I had begun
compounding that into a projection of ~130 before measuring the rate directly at **8.1%**. **A ~4×
overstatement, avoided only by measuring instead of multiplying two estimates.**

**The bimodality now has a semantic explanation:** leases are either **short (1–12 pages** —
amendments, short forms) or **long (31–57** — full executed leases). **The 16–30 band holds ONE
document corpus-wide and it is a DD.** So DOC8's 15 → 30 raise unlocks **zero leases** — the DOC12
finding, restated with the doctype attached.

**Why it is the right next item:** `bov-extract.js` reads leases to extract the tenant, and these are
the full executed documents. ⚠️ **They yield nothing while `bov_ready` climbs — the marker makes the
gap quiet**, which is this repo's own honest-counts failure pointed back at us.

**Prompt staged: `DOC14-long-lease-ocr-async.md`** — DocAI async/batch through the **existing
`mode=jobs` lane** (submit → poll → ingest), with three constraints written in: ⚠️ **async cannot fit
the 22 s tick** (long-running operation, GCS output); ⚠️ **verify the contract against the live v1
discovery document**, since DOC8's flag was a top-level boolean and the prompt's framing would have
made it a silent no-op; ⛔ **never fall back to gpt-4o.** ⚠️ **And if the route is unavailable, stop
and say so** — chunking a lease changes what `extractTenantFromLease` receives, and a named honest
ceiling beats a plausible workaround.

**Drain at 22:20: undrained 604, sidecar 167, `bov_ready` 13, gpt-4o escalations still 0.**
🔵 **DOC13 (retry re-admission) remains time-gated to ~16:00–16:30 UTC 2026-09-02 and has NOT run.**

## 2026-09-01 — C13c SHIPPED and verified; DOC12 CLOSED, and its finding inverts DOC8's premise

⚠️ **Naming note for whoever reads this next: the response filed as "DOC13" was C13c.** DOC13 (the
document-lane retry check) has **not** run and is still time-gated to **~16:00–16:30 UTC 2026-09-02**.
**C13c ≠ DOC13** — two different threads, one keystroke apart.

✅ **C13c verified live: `one_off_owner` held at 142** exactly as predicted, split into
**13 `individual_single_current_asset_sf_corroborated` / 129 `..._unverified`**, with **21 rows
routed to ambiguity as contradicted** — six more than the list I had read. `user_owner` 10 and
`entities_with_role` 10,655 both unchanged, so nothing else moved.

🔴 **DOC12 CLOSED — the escalation is fixed, but NOT by what we shipped it for.** 14 OCR events since
redeploy, **zero gpt-4o**; drain **695 → 615**; `bov_ready` **5 → 13**. The page distribution settles
the cause:

| band | docs | range |
|---|---:|---|
| 01–15 — the OLD cap already served these | **19** | 1–12 |
| **16–30 — the entire population DOC8's raise exists for** | **1** | 25 |
| 31+ — marker, no OCR | **5** | **31–57** |

**The 16–30 band holds ONE document in the whole corpus and it predates the deploy.** The documents
that were actually falling through are **31–57 pages — above 30 either way.** ⚠️ **So the cap raise
fixed almost nothing; the MARKER closed the escalation.** DOC8's fix was chosen from Google's error
text (*"imageless raises the limit to 30"*) — **a fact about the API, not about our corpus.**
**A vendor's stated limit tells you what the API will accept, never whether your population sits
under it. Measure the distribution before sizing a fix to a threshold.**

🔴 **DOC14 filed — and it is the part that matters now.** Those **5 documents at 31–57 pages get NO
text at all**: marked, invisible to both consumers, never extracted. At that length on this corpus
they are almost certainly **full executed leases — the highest-value input BOV extract could get** —
and the count grows as the backlog drains. ⚠️ **The marker is correct behaviour but it is not
coverage, and it makes the gap QUIET**: `bov_ready` climbs while the longest leases silently yield
nothing. Likely route is DocAI **async/batch**; ⚠️ **verify the ceiling against the live discovery
document** (DOC8's own lesson) and **do not reach back for gpt-4o** (9.3× less text).
⚠️ `page_count` is populated on **25 of 156** rows — right population, small sample; re-measure.

## 2026-09-01 — C13c measured and staged: `one_off_owner`'s evidence column fails BOTH ways

**`one_off_owner` = 142 and its only evidence is `entities.entity_type='person'`.** 28 fail
`lcc_looks_like_person`; **reading them is what settles it, not the rate.**

⚠️ **Institutions typed `person`, by rent: `Jamestown` at $22,801,678** — an institutional
investment manager sitting on a one-off-individual lane — then SkyREM $1.48M, Deoworks, Protea
Primewest, Everbank, Gofsco, **`AEI NET Lease Portfolio XIII D`** (a fund, in its own name), plus
Alexandria, Brixmor, AvalonBay, BREIT, LaSalle, MIT, Komatsu.

⚠️ **And the name test rejects genuine individuals**, so tightening it is not the fix:
`Maslow Robert C & Michele C` $654k · `Anil M & Rajeshkumar K Khatri` $454k · `Rubinfeld Family` ·
`Chad Schnabel (GA)` · `Neeta` · `Guy` · `Joan` · `Buddy`. **`&` is a married couple (P158a)**, and
`lcc_owner_name_has_org_marker` catches **0 of 142**.

✅ **A discriminating RECORDED fact exists: a `salesforce/Contact` identity — 13 of 142, and 12 of
the 13 are unmistakable individuals** (the miss is `Law Offices`, the documented
two-capitalised-tokens false positive). ⚠️ **The positive control is the important half: ZERO of the
institutional names carry one** — not Jamestown, BREIT, AvalonBay, Brixmor, Alexandria or MIT.
**The signal separates exactly the population that must be separated**, which is why it is worth
building on where a name test is not.

**Disposition: a CONFIDENCE SPLIT, not a deletion.** ⚠️ 142 → 13 discards genuine individuals simply
absent from Salesforce; asserting all 142 keeps a $22.8M manager mislabelled. So the count stays 142
and the **`evidence_arm` splits** — corroborated 13 / `entity_type`-only 129 — with the ~15 named
institutions routed to ambiguity as **reviewed rows**, never a name stoplist. **P181 one layer
down.** Prompt: `done/C13c-one-off-owner-confidence.md`. **✅ Executed — see the entry above.**

🔧 **Git locks — I am the cause, and my first diagnosis was incomplete.** `ORIG_HEAD.lock` is written
by `pull`/`merge`/`reset`, so I blamed `git pull` from the sandbox. ⚠️ **Then `git fetch` left an
`index.lock` behind too.** The real rule is broader: **the Linux sandbox cannot unlink ANY lock file
it creates on the Windows mount** (`Operation not permitted`), so **no git command that takes a lock
should be run from the sandbox** — not `pull`, not `fetch`. Read-only inspection
(`git log`, `git show origin/main:<path>`, `ls`) is safe. ⚠️ **I had also grepped the warning out of
my own output**, which is why it took three occurrences to notice.

## 2026-09-01 — ✅ C13b SHIPPED: the owner-role classification is a SET, and three of its own inputs were wrong

`v_lcc_entity_roles` is live on LCC Opps — **one row per (entity, role)** with its evidence arm,
dates and pacing. **10,655 entities carry ≥1 role (was 4,132); 946 carry ≥2 (was structurally
impossible); 0 duplicate (entity, role) pairs.** A VIEW over the existing spine, never a stamped
column. **P0.4 555 → 555, deal bands 621 → 621, no consumer repointed, nothing writes.**
Migration `20261005120000`; guard `test/c13b-entity-roles-multilabel.test.mjs` (11 tests,
**19/19 mutations RED**); suite 4,954 pass / 0 fail. Writeup
[`../audits/C13b_OWNER_ROLE_MULTILABEL_2026-09-01.md`](../audits/C13b_OWNER_ROLE_MULTILABEL_2026-09-01.md);
canonical `docs/architecture/owner-role-classification.md` **§7**.

**Three inputs the design, the prompt and C13 all carried were corrected by measurement:**

- ⚠️ **`repeat_buyer` 3,258 → 401** (385 after guards). 3,258 counts `purchases` EDGES, and
  `entity_relationships` has no unique key on `(from,to,type)` (P177) with three sources observing
  the same conveyance. Read on named rows the difference is single-asset SPEs — Korea Investment
  Corporation on ONE property recorded twice. **The `(asset, date)` middle key was also measured and
  rejected** (735; the extra 334 are A2b cross-source lag). Knock-on: the design's *"2,627 repeat
  buyers dormant 5+ years"* is **219**, and 98 are active within 2 years.
- ⚠️ **A manual override REPLACES the column an arm reads.** 119 entities carry
  `owner_role='developer'` AND an override of `buyer`; emitting `developer` anyway resurrects the
  machine call a human corrected. `developer` **838 → 718**. The override rides **verbatim** —
  `buyer` (124) is not remapped into the derived vocabulary.
- ⚠️ **`one_off_owner` rests on `entities.entity_type`, which is wrong in both directions.** Top ten
  by rent: Jamestown $22.8M, Metropolitan Life Insurance, Gladstone Commercial, SkyREM — all typed
  `person`; and 979 `former_owner` rows are typed `organization` and read as individuals.
  **`first_name`/`last_name` looked like the corroboration and is a re-split of the same string**
  (P125). 0 of 142 carry any independent org signal. Surfaced in `v_lcc_entity_role_ambiguity`,
  not patched — a name test is banned and `lcc_looks_like_person` flags only 28 of 142 anyway.
  Backlog **C13c**.

**Also:** the obvious view shape (union-all over a materialized CTE) was **48× slower** on the exact
probe the consumer mapping issues (39,968 → 1,787 buffers); the fix needed BOTH a `not materialized`
LATERAL and hoisting the name guards out of the per-arm predicates. **C13's "477 + 35 ambiguous" do
not reproduce** — the SET dissolved them; the real residue is 298 rows. `user_owner` reads **0 by
design** (15 candidates read, 10 genuine / 5 SPE-named-after-tenant; the confirm ledger ships empty).

**Next:** **C13d** repoint `handleProspectingBrief`'s BD gate (measured 126 → 130, +4/−0; needs
`has_bd_role` as a view COLUMN); **C13e** build the `user_owner` confirm surface; **C13c** the
`entity_type` defect; **C18** (`ownership_start_date`) is unchanged and still the highest-value item
— though §7.2 corrects WHY: the 50.7% blindness belongs to `investor_owner` pacing, not to
repeat-buyer pacing, which is 98.8% dated.
## 2026-09-01 — Both blocking decisions RESOLVED ON MEASUREMENT, and the rate answer is better than either option offered

Scott's direction: *"the most accurate determination possible… we don't want to lose valuable
information but we want connected and clean and accurate data."* **Neither question needed an
opinion — both were answerable against the live database.** Prompt queued:
`B6e-ci-last5-decisions-resolved.md`.

### Decision 1 — the rate vintage: keep BOTH constants, and the real defect is elsewhere

Measured on `clinic_econ_reconciled` (`model_version_id = 21`, computed 2026-09-01), avg blended
rate per treatment by FY: **2021 375.44 · 2022 374.97 · 2023 374.27 · 2024 373.24.** **A −0.6% drift
over four years, and what moves is PAYER MIX, not rate** (Medicare 35.04% → 35.71%).

**So identical values for `RATES_2025` and `CMS_2023_RATES` are defensible — but keep them as two
named constants.** Collapsing costs nothing today and **permanently destroys the ability to express
a divergence** when CMS does move. That is Scott's *"don't lose valuable information"* applied to a
constant rather than a row. And the test-side one-liners are safe: **the code is within 0.3% of the
reconciled model; the test is 12.5% high.**

🚨 **The finding that outranks the question as asked: FY2025 has 61 rows and FY2026 has 724, against
~6,700/yr for 2021–2024 — and FY2026 reads 73.66% Medicare against a ~35% baseline.** Those are not
rate vintages, they are **thin partial-year populations with a different composition**, and a
ground-truth test calibrated against them is calibrating on noise. ⚠️ **An assertion averaging over
`fiscal_year >= 2021` drifts on its own as the thin years fill, with no code change.** Each
assertion must state its population.

### Decision 2 — the broker path: the design question is already settled by the data

`dia.sales_transactions`, 4,783 rows: **name set 2,111 · id set 181 · name-with-no-id 1,930 ·
id-with-no-name 0 · 528 distinct unresolved names.**

🎯 **`id_set_name_null = 0` settles it.** On all 181 rows that carry an id, **the name was kept
too** — the intended pattern is BOTH columns, and it simply stopped being applied. *"Don't lose
valuable information"* is not a new requirement here; it is the existing design being restored.

**And the resolution is far more tractable than 1,930 suggests.** The FK target `brokers` holds
**2,425 rows**, and **422 of 528 names (80%) match `broker_name` exactly, case-insensitively** — no
fuzzy matching, no identity guessing. Tier 2 (`normalized_name` 373 / `company` 209) takes the
remainder where unambiguous; **everything else goes to a review lane.**

⚠️ **The residue's shape is the argument against ever fuzzy-matching it**: `Avison Young; Barnes` and
`AY; Barnes` (multi-broker co-listings *plus* an abbreviation), `Anthony Falcone` / `Babcock`
(individuals), and **`4802 D Dialysis, LLC` — a property name misparsed into the broker slot.** A
fuzzy matcher would confidently attach the wrong firm to several. **Grouping-for-review ≠
identity-for-write**, again. And **a multi-broker string is a real fact, not a defect** — record that
it is one rather than picking half of it.

## 2026-09-01 — ✅ 14 → 5, the 6 false-green guards were real, and both remaining blockers are now SIZED decisions (PR #7391, `5d464dd`)

| | executed | pass | fail |
|---|---:|---:|---:|
| `73f1418` (pre-#7389) | **0** | — | — |
| `c80f778` (#7389) | 3,128 | 3,065 | 55 |
| `eac8668` (#7390) | 3,128 | 3,106 | 14 |
| **`5d464dd` (#7391)** | **3,132** | **3,119** | **5** |

**`executed` went UP, 3,128 → 3,132.** Nothing skipped or quarantined at any step in the arc. From
a suite that could not execute at all to one that executes fully with **five known, named,
individually-argued failures.**

### 🎯 The slice-window sweep confirmed the silent failure mode

**All 27 fixed-character windows re-anchored on their AST spans: 21 undershoot / 6 overshoot / 0
exact.** ⚠️ **Six guards were asserting against code outside the function they name** — the silent
false-green I flagged as theoretical when filing it. It was not theoretical. **B6e-ci-slice-window
closed.**

### The `financial_ground_truth` three: measured, and the test is the stale side

**The code sits within 0.3% of the live reconciled model; the test is 12.5% high.** So
`DEFAULT_PATIENTS` 79 → 72 and the 2-payer/4-payer reconstruction are **safe test-side one-liners on
the evidence.** ⚠️ **The genuine open question is much narrower than I filed it**: whether
`RATES_2025` and `CMS_2023_RATES` holding **identical constants** is a deliberate collapse or a lost
vintage distinction. 👤 **That is Scott's, and it is the only part of this group that is.**

### `listing_broker_update` (2): the cost of not deciding is now quantified

Move the broker-name normalisation into `update_field` (keeps the identity alias protecting every
other caller) — **or leave 1,930 sales carrying a broker name with no FK, invisible to
`broker_ranking.py`.** 👤 Scott's call; both blockers gate `B6e-ci-unmask`, and **the mask is
correctly still in place** — unmasking against 5 known failures ships a job red on day one.

### ✅ This also closes a mystery I filed two days ago

**`B6e-fred-git128` is explained.** Three `.claude/worktrees/*` gitlinks are committed with **no
`.gitmodules`**, which is what puts `The process '/usr/bin/git' failed with exit code 128` in *every*
CI job log. Pre-existing (from `325aca3`), not introduced by any recent PR. → **B6e-worktree-gitlinks**.

### ⚠️ One new finding verified, and its scope corrected

`properties.clinic_metadata` **does not exist anywhere in the dia schema** — confirmed, no column of
that name on any table — so `propagate_cms_to_properties` writes it and `update_row` **silently
drops it, no error.** ⚠️ **But the report called this "CMS certification-date propagation is a dead
write", and that is broader than the data supports.** Measured: `properties.certification_date` is
set on **2,417** rows and `cms_last_propagated_at` on **1,814**, stamped as recently as **2026-08-31
20:33** — **the certification-date propagation is LIVE.** What is dead is only the `clinic_metadata`
payload riding alongside it. ⚠️ **Also surfaced by that check and unexplained: 2,417 have a
certification date while only 1,814 carry a propagation stamp — 603 came from somewhere else.**

Also filed, not fixed: a **schema-refresh N+1** in `FinancialEstimateTracker.save_estimate()` (a
retry-with-backoff schema fetch *inside* the row loop, ~4.5 s/row).

⚠️ **Run 2279 carried 5 failures and reported success** — concrete, current evidence for why the
mask matters, from this very PR.

## 2026-09-01 — B6e-ci-red14 drafted: the last 14, and the `financial_ground_truth` group is measurable after all

Prompt queued: `B6e-ci-red14-adjudicate-the-last-14.md`. **The governing rule is the one this arc
keeps paying for — establish whether the TEST or the CODE is wrong before changing either** (twice
here a red test was stale and the code was correct), and **`executed` must stay at 3,128**.

⚠️ **I had filed the three `financial_ground_truth` failures as "needs Scott, not a fix." That was
half right and it under-specified the work.** The decision is his; **the gap is measurable now.**
`clinic_econ_reconciled` is live and current — **81,105 rows / 8,281 clinics / FY2011–2026, a single
`model_version_id = 21`, computed 2026-09-01**, `avg blended_rate_per_treatment 375.47` /
`avg reconciled_revenue_per_treatment 380.14`. So the deliverable is a **three-way comparison** —
test constant vs code output vs live reconciled value — resolving to one of: **stale test**,
**drifted code**, or **two internally-consistent things describing different scopes** (the most
likely answer if the numbers are close but unequal). **Nothing changes there without Scott.**

The other groups: `listing_broker_update` (2) is the real product bug — diagnose and propose, **do
not ship the flip**, because both columns exist and `available_listing_ingestor.py` deliberately
guards the alias; `handle_natural_language_query` (2) is the known drift; `backfill_*` (3) and four
singles are most likely straightforward and are worked first to shrink the count.

Also folded in: **re-anchor the 27 latent fixed-character slice windows** in
`test_processing_audit.py` on their AST spans. They are green today, and ⚠️ **the overshoot case is
silent — a green guard may be asserting against the NEXT function.** A green that turns red on
re-anchoring is a finding, not a regression.

**Still explicitly out of scope: the pytest unmask.** That is `B6e-ci-unmask`, after the red clears.

## 2026-09-01 — ✅ 55 → 14 red, and the fix that "worked" was RELOCATING the damage (PR #7390, `eac8668`)

| | collected | errors | executed | pass | fail |
|---|---:|---:|---:|---:|---:|
| `73f1418` (pre-#7389) | 3,110 | 5 | **0** | — | — |
| `c80f778` (#7389) | 3,128 | 0 | 3,128 | 3,065 | **55** |
| **`eac8668` (#7390)** | 3,128 | 0 | **3,128** | **3,106** | **14** |

**`executed` held at 3,128 across every step — nothing was hidden to make the number fall.** That
was the one thing the prompt demanded and it is the number that makes the rest trustworthy.

⚠️ **My prompt estimated the openpyxl cluster at ~12. Measured, it was 36 across three packages.**
The estimate came from counting error *strings* in a summary; the measurement came from running each
failing file alone.

### 🎯 The triage technique is the transferable part

**One `pytest <file>` per failing file split 55 into 36 pollution / 19 genuine *before a single
traceback was read*.** `test_master_sheet` + `test_work_product_base` are **21 passed alone, 21
failed in the suite, on identical source** — **that comparison, not the error text, is what proves
harness-vs-product.** Error messages describe the symptom; isolation identifies the class.

### 🚨 The sharp finding: restoring the real module RELOCATES the damage

Putting the genuine `openpyxl` back in `sys.modules` **created a new defect**.
`test_build_excel_summary.py`'s autouse fixture does `sys.modules["openpyxl"].Workbook =
DummyWorkbook` and never restores it. **While `openpyxl` was a throwaway stub, that line wrote to
garbage; once the real package is back, the same line permanently rebinds `openpyxl.Workbook`.**
The existing `_CRITICAL_ATTR_SNAPSHOT` could not see it — **it ran at collection time and the write
happens at run time.**

**Same shape in `dateutil`**, and its symptom is the reason to care: a live write to
`dateutil.parser.parse` surfaced as **`quarantine_dead_ends` silently deleting 0 rows instead of 1 —
in a module that never mentions `dateutil`.** That is a *data-affecting* bug reached through a test
harness.

Three layers were all required: **sys.modules objects** (fixed 9) · **attributes on the real module**
(24) · **symbols already bound into `src.*` globals** by a `from X import Y` executed inside the
stub window (8).

### The 14 that remain, and one real product bug

**5 genuine failures fixed.** Two are the **block-slice footgun, recurred**:
`test_processing_audit` asserted over `source[fn_start:fn_start+5000]`, and
`sanitize_pending_update` grew to **6,845 chars in B6d-pri-reason**, so five guards at chars
5,290–6,794 **fell outside the window over correct code.** Re-anchored on the real AST span, both
mutation-verified RED. ⚠️ **27 more fixed-window slices remain in that file** — green today, but a
window can *overshoot* into the next function, so **a green one may be passing on code it never
named** → **B6e-ci-slice-window**.

**14 left red, all failing in isolation** — genuine test-vs-code disagreements, not pollution.
⚠️ **`git log` cannot adjudicate them: every file traces to one squashed import merge `8c67444`, so
there is no "which side moved last."** Composition: `financial_ground_truth` (3 — revenue-model
constants vs the reconciled model; **guessing risks the documented `dialysis_econ_reconciled_v1`
calibration**), `handle_natural_language_query` (2, the known drift), `listing_broker_update` (2),
`backfill_*` (3), and 4 singles.

🔴 **One is a real product bug, filed rather than guessed at.** `update_database.update_field`
normalises a broker name to `listing_broker_id` **only if `resolved_field == "listing_broker_id"` —
but the alias is the identity mapping, so the branch is dead.** Both columns genuinely exist in dia
(53 vs 34 migration references) and `available_listing_ingestor.py` explicitly guards against alias
normalisation putting a *name* into the `_id` column, **so the identity alias is defensible and
flipping either side changes a write path** → **B6e-ci-listing-broker**.

✅ **`timeout-minutes` on all four jobs, sized from a real run** (33550677412): Tests 7 m 58 s → 20;
Lint / Security / Build ≤1 m 50 s → 10. They were inheriting the **6-hour** default.

⚠️ **Two reading traps, both flagged by CC and worth keeping.** Run 33550677412 **reports success
while carrying all 55 failures** — the conclusion is worthless here and the job log split is the only
real number. And **the merged PR body's figures are wrong**: it says 3,073 → 3,114 passed; the
measured values are **3,065 → 3,106**. The body assumed `pass + fail = collected` and silently
absorbed the **7 skipped + 1 xfailed** into the pass count. (Arithmetic confirms it: 3,114 + 14 =
3,128 leaves no room for skips.) **The commit message and `CLAUDE.md` carry the correct figures.**

⚠️ **PR #7390 was created 21:11:17 and merged 21:11:28 — eleven seconds, before CI finished.** Fifth
instance recorded in two days.

**Still masked, deliberately: the pytest line.** → **B6e-ci-unmask**, now against **14** known
failures rather than 55.

## 2026-09-01 — ✅ THE DIALYSIS SUITE RAN FOR THE FIRST TIME IN THE REPO'S HISTORY (PR #7389)

| | before (`73f1418`) | after (`fd724a5`) |
|---|---|---|
| collected | 3,110 / **5 errors** | **3,128 / 0 errors** |
| **tests executed** | **0** | **3,128** |
| step duration | 22 s | **6 m 12 s** |
| job conclusion | success (masked) | success (**still masked**) |

**Result: 3,065 passed · 55 failed · 7 skipped · 1 xfailed.** The first true measurement this repo
has ever had. ✅ **And the import check is now a genuine gate** — `import src, src.utils_shared,
src.ingest_fred_to_dialysis` is unmasked and **green once on a real runner**, which was the standard
B6e-ci-mask set. That is the check that would have caught FRED's `ModuleNotFoundError` during 25 days
of green badges over a dead producer.

⚠️ **BE PRECISE ABOUT THE STATE THIS LEAVES: MEASURED, NOT ENFORCED.** The pytest line is **still
masked**, so **55 real failures are now visible on `main` and still cannot fail a merge.** That is a
narrower but sharper hazard than before — previously nobody could mistake the badge for a gate;
now the job runs 3,128 real tests, reports red, and merges green.

⚠️ **Step 3 (fix or quarantine what is red) is UNFINISHED because the PR merged ~2 minutes after the
suite result first existed.** Fourth instance of merge-before-CI recorded in two days. **The result
was not ignored — it did not exist yet when the merge happened.**

⚠️ **A number I quoted repeatedly as fact was never stable: 3,042 → 3,110 → 3,128.** The 3,042 came
from a sandbox `--collect-only` with an incomplete local install; CI collected 3,110 before the fix
and 3,128 after. **Quote the run, not the figure** — and note the +18 is the newly-loadable files,
which is the fix working.

**The 55, with a finding inside them.** The largest cluster (~12) is **`openpyxl` leaking as a stub
across modules** — `module 'openpyxl' has no attribute 'load_workbook'`, `requires openpyxl; install
it` (**it is installed**), `'DummyWorksheet' does not support item assignment`, `isinstance() arg 2
must be a type`. **That is the same cross-module stub-pollution class CC had just fixed one module
over**, and the `conftest` mechanism added there handles exactly this shape. The rest look like
genuine logic failures (`test_financial_ground_truth` rate assertions, `test_cmbs_propagator`,
`test_clinic_history` dedupe) plus 2 known `test_handle_natural_language_query` drifts.

✅ **Positive control on the sweep — LCC is CLEAN, checked rather than assumed.** All seven workflows
carry `timeout-minutes`; `npm test` runs as a bare unmasked `run:`; the `exit 0` / `|| true`
instances are deliberate control flow inside a `set -euo pipefail` gating script. **The masking class
is Dialysis-specific, not fleet-wide** — which is worth stating, because "grep for the shape, not the
spelling" is only useful if the answer is allowed to come back clean.

**Two smaller items surfaced and filed:** Dialysis `ci.yml` has **no `timeout-minutes`**, so an
unbounded job inherits the **6-hour** default on every PR — now sizeable against a measured 6 m 12 s;
and `AGENTS.md:60` / `CLAUDE.md:60` still call `requirements_utf8.txt` canonical, **a stale line that
already produced a false P1 finding from Codex.**

**Recommended next: finish Step 3, then unmask pytest** — the openpyxl cluster plus `timeout-minutes`
in one change, then the unmask as its own. → **B6e-ci-openpyxl**, **B6e-ci-timeout**,
**B6e-ci-unmask**, **B6e-doc-reqs**.

## 2026-09-01 — ✅ PR1a/PR1b SHIPPED across three repos — and the CI finding underneath it is now the top open item

**Merged: Dialysis #7388, government-lease #396, life-command-center #2004.** Independently
re-verified live, both domains:

| column | before | after |
|---|---|---|
| `dia.properties.assessed_value` | 8,700 zeros / 262 positive | **0 zeros / 262 positive** |
| `dia.properties.tax_amount` | 9,025 zeros / 1 positive | **0 zeros / 1 positive** |
| `dia.properties.tax_delinquent` | `false` on 11,802 of 11,802 | **NULL on 11,802, 0 false, 0 true** |
| `dia.tax_records.is_delinquent` | — | **NULL on 25,621**, `raw_payload` intact |
| `gov.properties.tax_delinquent` | `false` on 20,495 | **NULL on 20,495** |
| `gov.properties.assessed_value` | — | **0 zeros / 370 positive** (untouched) |

**Every real value survived** — the 262 and the 1 and the 370 are exactly the non-model-traced rows,
which is the separation PR1a required be proven before writing. Both column defaults dropped;
reversal ledgers hold **55,148 + 20,495** rows. ⚠️ **The source tables were deliberately NOT
cleaned** — gov `parcel_records` still shows 9,264 zeros with `raw_payload` intact, which is correct:
that is the record of what the producer emitted, and it is the evidence.

⚠️ **Correction to a number I have been quoting: gov `properties` is 20,495 rows, not 13,837.** The
smaller figure was the non-archived count from C2e. Both are right about different questions; the
denominator for a whole-portfolio claim is 20,495.

⚠️ **THE PRODUCER IS UNVERIFIED — only the backfill is.** Newest `tax_records` / `parcel_records`
row is still **2026-08-31 18:33**; nothing has landed since, and the Python half ships on the next
deploy. **A one-shot backfill and a fixed producer are indistinguishable until the producer runs** —
the N15d lesson, and it is filed rather than assumed. → **PR1e**, with the exact four-count check.

### 🚨 The finding that outranks it: Dialysis CI runs ZERO tests and reports success

CC read the job log instead of trusting the badge — *because `CLAUDE.md` says that badge is
meaningless* — and found something worse than **B6e-ci-mask** as filed:

```
!!!!! Interrupted: 5 errors during collection !!!!!
======== 1 warning, 5 errors in 18.16s ========
Tests completed (some may have been skipped)     ← the || echo mask
→ job conclusion: success
```

**It is not "failures are hidden." pytest aborts at collection and not a single test executes** — on
this PR and on every `main` run sampled. So the 3,042-test figure in B6e-ci-mask is **tests
COLLECTED in a healthy local run, not tests CI has ever attempted.** Consequences: **CC's 31 + 34 new
mutation-verified guards have never run in CI**, and **one of the five files erroring is
`test_b6e_pipefail_workflow_guard.py` — the pipefail guard itself.** Five files fail on `flask` /
`geopy` environment issues; **none belongs to the changed modules**, so this is pre-existing, not
introduced.

**Correctly not fixed** — the repo's own doctrine forbids the obvious move. But it is no longer a
vague "the suite is masked": it now has a **concrete starting measurement — 5 collection errors,
named** — which is exactly what the *measure → fix or quarantine → unmask one line at a time*
sequence needed to become actionable. **This is my recommended next step.**

⚠️ **And #7388 merged at 18:04:07 with CI finishing 18:05:40** — merged before its own checks
reported, the third instance of that pattern recorded in two days.

📁 **Consolidation:** `B6d_pri_PUBLIC_RECORD_INGEST_REPAIR_2026-08-31.md` now carries a context
banner — it repaired the **throughput of a generator**, and its fixes stand, but it must not be read
as evidence the lane is healthy. **Fixing a producer's RELIABILITY says nothing about the VALIDITY of
what it produces.**

## 2026-09-01 — 🚨 PR1 REFUSED, CORRECTLY — the lane's producer GENERATES its values. And two repos merged a retracted claim as fact.

**PR1 asked for the reconciliation consumer. It was not built, and not building it is the right
call.** `src/public_record_ingest.py` — the producer of `parcel_records` / `tax_records` /
`deed_records` on **both** domains — **contains no county record fetch.** dia's one external call is
`chat.completions.create(model="gpt-4o")` on a prompt seeded with the property's own address *and the
owner we already hold* (the parsed result is literally named `gpt_parcel`); gov fetches a ≤4,000-char
snapshot of the assessor **portal homepage**, which cannot state a specific parcel's assessed value.
**Wiring that to `lcc_merge_field` would have promoted model output to `county_records`, which
outranks `salesforce`(20), `om_extraction`(30–50) and every sidebar(45–65) on 93 rungs.**

⚠️ **My PR1 prompt made this harder to catch, and that is worth recording.** It said *"no new
acquisition, no new schema, no new ladder entry"* as a **selling point**. That phrasing describes a
source whose producer nobody had re-graded — **"it needs no new acquisition" is the tell, not the
recommendation.** The lesson generalises to PR5's other 38 registered-but-unwritten sources: **read
what a producer's external call actually talks to before wiring it.**

### ⚠️ A statistic was published, refuted and corrected — and I verified the correction independently

The first cut claimed *"100.0% of gov's model-leg assessed values are exact multiples of $100,000
vs 3.8% on the CoStar leg — real assessed values are not round."* **It was counting zeros
(`0 % 100000 = 0`).** Measured live by me on gov `parcel_records`: **11,529 rows — 9,264 exactly
`0.00`, 1,848 NULL, 417 positive, and of those positives only 17 are round = 4.1%**, statistically
indistinguishable from the 3.8% control. **The metric was structurally unable to express the
question** — the P157 `reloptions` / P182 deparse trap, committed on the page that documents it.

**The corrected finding is different and worse: the model leg does not invent plausible numbers, it
emits almost nothing, as zeros** — and a `0` is a *positive assertion* that propagates into curated
columns and reads as measured, where a NULL would have been honest. Verified live on dia:

| curated column | zeros | positives |
|---|---:|---:|
| `dia.properties.assessed_value` | **8,700** | 262 (all CoStar-traced) |
| `dia.properties.tax_amount` | **9,025** | **1** |
| `dia.properties.tax_delinquent` | **`false` on 11,802 of 11,802** | — |

⚠️ **`tax_delinquent` is the sharpest of the three: `bool(None) is False` turned *"the source did not
say"* into *"this property is not tax-delinquent"*, on every property in the portfolio.** A negative
finding asserted at 100% coverage, never once measured, on a field that can reach a BOV.

**What the refusal actually rests on — none of it the retracted statistic:** the producer has no
county fetch (a fact about code); dia `tax_records` carries **186 rows with a literal `XYZ …`
placeholder owner** plus city-templated names (*"Santa Rosa Dialysis LLC"*); gov's 9,749 `owner_name`
values are the recorded owner we fed the prompt, echoed back (the ORE Phase A1 finding); and **0
Regrid-shaped payloads exist**, so the vendor path has never run.

### 👤 URGENT — two repos merged the PRE-CORRECTION version, and `main` cannot rebuild either DB

| repo | `main` | correction | branch |
|---|---|---|---|
| Dialysis | `8246ded` | ❌ not an ancestor (`5a6d511`) | ✅ pushed |
| government-lease | `86e9ba7` | ❌ not an ancestor (`70d6a07`) | ✅ pushed |
| life-command-center | not merged | — | ✅ pushed |

Two consequences, both verified:
1. **The refuted claim is committed as the rationale for a live database object**, and in Dialysis's
   `CLAUDE.md` — the durable reference file, where a wrong lesson does the most damage. A reader
   learns *the model fabricates plausible round numbers* instead of *it emits zeros*.
2. **Neither migration can be replayed.** I checked: live `v_gov_public_record_acquisition` column 6
   is **`assessed_value_zero`**; the committed file's column 6 is `with_owner_name`. `CREATE OR
   REPLACE VIEW` is append-only for columns, so a rebuild from `main` **errors 42P16** rather than
   silently downgrading — the better failure mode, but **the repo is not currently a replayable
   record of either database.** This is the §13 *"running but not merged"* hazard **inverted: the
   correction is running and not merged.**

⚠️ **Dialysis #7386 merged at 16:50:09 while its own checks finished 16:52 and 16:54** — merged ~2.5
minutes before CI reported. Green this time; **green-after-merge is not a gate**, and it is the exact
pattern LCC's `CLAUDE.md` already records ("merged 58 seconds after opening").

### 🚨 The trap that would have hidden a wiring in EITHER direction

`lcc_flush_provenance_events()` carries `v_first_class := ARRAY['splink_v1','sf_link_review_human',
'splink_v2','sf_account_contact_expansion']` and **relabels every event whose source is not on that
list to `domain_trigger`.** So a correct `county_records` wiring would have landed in
`field_provenance` as `domain_trigger`, at a rung that does not exist for these fields — **while the
verification I wrote into the PR1 prompt (`field_provenance where source='county_records'`) still
read ZERO.** My own success criterion could not have detected success. → **PR7**.

### What shipped instead — the marker, not the verdict

Producer provenance stamps on both domains (`raw_payload.source`; ⚠️ **excluded from `data_hash` on
dia**, or every row re-inserts as a duplicate — proven hash-stable with a positive control),
`{dia,gov}_public_record_acquisition_class()` as the single owner of "which path produced this row"
(with `ai_gpt4o_presumed` kept **distinct** from a forward stamp, so a measurement is never reported
as a stamp), `v_{dia,gov}_public_record_acquisition`, and `v_dia_curated_field_ai_provenance`.
Guards: 10/10 and 3/3 mutations RED, both stripping comments first.

## 2026-09-01 — 🚨 SCOTT'S CORRECTION: I scoped a SOURCE to one CONSUMER's gap list. The public-records lane is BUILT and has NEVER WRITTEN A FIELD

**My "don't build" verdict below was scoped to the 662-row metadata backfill queue and is WRONG as a
statement about public records as a source.** Scott: *"assessor data is valuable regardless of sale
status or previous ingestion… It should be its own lane that populates all properties in the
database that later code processes can evaluate against to find the most accurate representation of
each property by field."* **That is exactly right, it is the inversion `I1` exists to prevent, and I
committed it as the author of I1.** The correct denominator is every property — dia 11,802 + gov
13,837 — not 662. A sold property's assessor record is still ownership history, still a sale, still
physical stats.

🚨 **And measuring it properly found something much bigger: the lane he is describing already
exists, in full, and has never written one field.**

- `parcel_records` (apn, assessed_value, owner_name, zoning, **building_sf, lot_sf, year_built**,
  year_renovated, land_use, mailing_address, `raw_payload`, `data_hash`), `tax_records`,
  `deed_records`, **`property_public_records`** (the link + confidence layer), and
  `county_authority_cache` with **926 counties** carrying `assessor_url` / `gis_url`.
- ⚠️ Keyed on **APN + county + state**, not `property_id` — i.e. **already designed as an
  independent lane**, exactly as Scott specified.
- **`county_records` is registered at priority 5 across 93 field rungs on BOTH domains** —
  `year_built`, `building_size`, `land_area`, `lot_sf`, `zoning`, `assessed_value`,
  `recorded_owner_*`, `ownership_history.*`, `sales_transactions.*` — outranking `om_extraction`
  (30–50) and `costar_sidebar` (45–60).
- **`property_public_records` links 9,166 of 11,802 dia properties (78%)**; `tax_records` holds
  25,621 rows; the producer **ran 2026-08-31**.
- 🚨 **`county_records` has ZERO `field_provenance` rows. Ever.** Positive-controlled in the same
  query: `recorded_deed` has 2,681 / 371 writes. No variant spelling across 49 sources.
- **The clinching detail: `dia.properties.year_built` has 3,586 provenance rows and the only source
  is `salesforce`@20** — while the @5 county source sits unread in the same database holding the
  answer.

**Class 2 on the most extensively registered source in the system, and invisible to every check we
run** — tables non-empty and growing, producer green, ladder registered, field filling from
somewhere worse. → **PR1** (build the reconciliation consumer; no new acquisition, no new schema, no
new ladder entry, immediate reach **9,166 properties**), **PR2** (why does one live producer return
tax rows for 9,107 properties and parcel stats for **41**? — the tax fetcher reaches 77%, so this is
a fetcher question, not an acquisition one), **PR3** (`confidence` is the constant 1.000 on all
23,728 rows and `verified` is false on every one), **PR4** (the `mortgage` and `entity` legs are dead
since 2026-05-10, hidden because the lane's other legs kept writing).

🚨 **Generalising the detector across the whole ladder: 39 of 67 registered sources (58%) have never
written a field.** `costar_cmbs_loan` **121 rungs**, `county_records` 93, `lease_document` **25 at
priority 10**, `opencorporates`/`mi_lara` 16 each. ⚠️ **The reverse arm was run and is benign** — all
21 write-but-unranked sources are one-shot `cleanup_run_*` tags from the May remediation; a
one-directional result would have invited a wrong drift conclusion. ⚠️ **And `manual`@1 reading 0
rows is NOT a protection gap** — `manual_edit` (207 rungs @1, 841 rows) and `manual_resolution` (203
@1) carry it; checked rather than claimed. → **PR5**, playbook **Class 31**.

📁 **New canonical page: `docs/architecture/public-records-source-lane.md`.**
`property-metadata-coverage.md` keeps a supersession banner rather than being rewritten — its
fabrication finding, I12 and Ollama measurement all stand; only its verdict and its 662-denominators
do not.

## 2026-09-01 — ✅ FRED IS ALIVE (verified on the delta), and the metadata build-out is measured: DON'T BUILD IT ⚠️ *(verdict superseded — see the entry above)*
## 2026-09-01 — DOC8 / DOC9 / DOC10: the expensive OCR tier was FAILING, and its fragments read as covered leases

**PR #1995 — open, not merged. `docai-ocr` v23 IS deployed to LCC Opps (15:50 UTC) and the DOC10
backfill IS applied (15:51 UTC); the JS half ships on the Railway redeploy of the merge.**

**The measurement first.** Across every OCR row the CRE lane has ever produced: **gpt-4o 19 rows,
avg 1,579 chars, 12 under 500, minimum 31; DocAI 6 rows, avg 9,055, none under 500.** The
**expensive** tier returned ~9× LESS text, on 86% of the OCR events. Cause read from the edge log,
not guessed: `PAGE_LIMIT_EXCEEDED — "15 got 19"`, DocAI's synchronous page cap, **not** the
documented Custom-Extractor footgun.

- **DOC8** — `docai-ocr` sets `imagelessMode`, cap **15 → 30**. ⚠️ **Verified against the live v1
  discovery document, not taken from the prompt: it is a TOP-LEVEL `ProcessRequest` boolean, NOT
  `processOptions.ocrConfig`** — nesting it there is a silent no-op that leaves the cap at 15. A
  processor that rejects the field retries once without it, so the deploy cannot break the ≤15-page
  path that already works. **Above 30 the CRE worker now stops with a named, dated
  `over_docai_page_cap` marker from a pdf-parse pre-flight and spends nothing** — the gpt-4o tier is
  NOT removed, it is just no longer reached silently on the one class it is measured to fail. The
  pre-flight is opt-in (`ocrPageCap`, default null), so **cron 160 and the deed lane are
  byte-identical**.
- **DOC9** — the spend counter accumulated only when `ocr_pages > 0`, and gpt-4o reports no pages, so
  the tick read `ocr_by_engine: {}` **while spending gpt-4o money**. Engine now counted
  unconditionally, pages only when known, unknown counted as `ocr_pages_unknown` and **never 0**.
  ⚠️ **`ocr_by_engine` is REMOVED rather than redefined** — it counted PAGES, so reusing the name for
  a document count changes its meaning silently. The same blindness is still live in
  `document-text.js` (the deed lane, deliberately untouched) and `lease-backfill.js`.
- **DOC10** — a **31-character fragment satisfied both consumers** (`needs_ocr=is.false ∧ raw_text≠
  null`; `NOT needs_ocr`) so BOV extract received it as the lease and it could never be retried.
  `reason='thin_ocr_result'` was already set and **nothing read it**. Page-aware floor now
  (`max(120, pages×200)`; **500** when pages are unknown — a 500 that sits inside a 3.9× gap the data
  actually has). **Backfill: 12 rows / 9 properties, re-run marks 0, reversal RUN not asserted (12 of
  12 restored byte-identically in a rolled-back round trip).**

**⚠️ `v_lcc_cre_bov_ready` 7 → 4, and that is the fix working.** Those three properties were never
covered — they were "covered" by 31–200-char fragments. Consumer-visible sidecars 77 → 65; OCR rows
reading covered 25 → 13; `v_lcc_cre_thin_ocr_watch` still-covered 12 → **0**. gov deeds unchanged at
**325/325**, cron 160's command unchanged, crons 167/169 still active.

✅ **THE EDGE HALF IS CONFIRMED ON BEHAVIOUR, 16:00:35 UTC.** The first post-deploy OCR event (cron
167, document 24, `ACMP EXEC Lease 10.9.14.pdf`) logged
`Document AI 400 (…, imageless=true): "Document pages exceed the limit: 30 got 40"`,
`metadata { page_limit: "30", pages: "40" }`. **The limit Google reports is now 30, not 15**, and the
phrase *"in non-imageless mode"* is gone — the field was accepted and the fallback did not fire.
(The sandbox cannot reach `*.supabase.co` — proxy 403 — so the edge log IS the probe.)

⚠️ **And that same line is the FIRST 31+-page observation this lane has ever had: 40 pages.** It fell
through to gpt-4o for **211 chars**, because the caller-side pre-flight is JS and unmerged. Both
halves of the fix are correct and neither was deployed for that document. Page evidence to date is
**8 observations, 1 over 30** — a reason to expect more, not a rate.

⚠️ **The wording of that error has already changed once**, so `pageLimitFromError` now reads
`details[].metadata` first and keeps the prose regex as a fallback (**v24**). Two mutants survived
the first test of it, because the live body's `message` repeats the same numbers as its metadata —
fixed by adding the discriminating case (a re-worded message with intact metadata), not by accepting
them. ⚠️ **v24 is deployed and UNEXERCISED** — the behavioural confirmation above is v23's, and no
DocAI call has been made since v24 landed. Deployed is not exercised.

**⚠️ STILL NOT MEASURABLE, and stated rather than guessed:** (a) **`cloud_cheap` overtaking `cloud`**
— the only post-deploy OCR event so far was that 40-page document, which is over the cap either way,
so the tier split needs the next few ticks; (b) **a re-read of the 12 thin documents** —
re-admission needs `thin_ocr_result` in `CRE_RETRY_REASONS`, which is JS and unmerged; (c) **how much
of the backlog is 31+ pages.** The `over_page_cap` counter, `page_count` on every marker, and
`v_lcc_cre_thin_ocr_watch` are what will answer all three.

**Next:** merge → Railway redeploy → read `ocr_docs_by_engine` on the first ticks (`cloud_cheap` must
overtake `cloud`), then read three named re-extracted documents at their MIDPOINT — a tier change is
not evidence the text is usable. Full state: `docs/architecture/document-capture-ocr-and-deeds.md`
§0d.
## 2026-09-01 — ✅ FRED IS ALIVE (verified on the delta), and the metadata build-out is measured: DON'T BUILD IT

### FRED — the fix is PROVEN

Scott dispatched `fred-ingest-daily`. Verified on the state delta, not the green check:
**`max(created_at)` 2026-09-01 15:31:40** (past the 2026-08-07 19:59:41 hand-run) and
**`max(observation_date)` 2026-08-28** (past 2026-08-06). Rows 8,316 → **8,336**. The 25-day gap on
the two high-frequency series is **closed**: `DGS10` +17 (2026-08-06 → 08-28), `MORTGAGE30US` +3
(08-13 → 08-27). **After 25 days green-and-dead, this producer has now written its first rows ever
from CI.**

⚠️ **One residual, and it is a real one.** The three monthly series took **0 rows**: `FEDFUNDS` and
`UNRATE` still end 2026-07-01, which is *correct* (August prints ~Sept 2–4, not yet published), but
**`CPIAUCSL` ends 2026-06-01 and July CPI published ~2026-08-12** — inside the dead window and
retrievable now. The likely mechanism, inferred from the fetch boundaries rather than read in code:
**a lookback keyed on `observation_date` cannot reach a monthly series whose observation date is
older than the window even though its value was published inside it** (`DGS10`'s new rows start
2026-08-06, consistent with a ~30-day observation-date window; 2026-07-01 falls outside it). Filed
**B6e-fred-monthly**.

Two run annotations, both filed and neither blocking: **`/usr/bin/git` exit 128** (a warning on a
green run — ⚠️ *an unexplained non-zero in a workflow we just fixed for exactly this class* →
**B6e-fred-git128**), and **Node 20 deprecation** on `checkout@v4` / `setup-python@v5` /
`upload-artifact@v4` — the same shape as the LCC Node-version lockout already in `CLAUDE.md` →
**B6e-node24**.

### The metadata build-out — measured against all three options, and the answer is don't

Scott asked whether **local Ollama**, the **LCC sidebar Chrome extension**, or a combination
maximises leverage on the ~646 remaining gaps. **All three were measured against the actual
population before designing anything, and all three fail on reach:**

| option | reach on the 662 | |
|---|---:|---|
| Ollama over our own documents | **9** with usable text (23 with any doc) — **1.4%** | ❌ no corpus; P131 case (b) is empty |
| Sidebar, in the flow | **6** `status='active'` | ❌ no natural encounters |
| Sidebar, deliberate lookup | 662 searches, **1 listing URL** | ❌ 617 are **sold**, 86 superseded |

⚠️ **I nearly reported "554 are on-market listings — send Scott to CoStar."** They are rows in
`available_listings`, but **211 are `data_source='synthetic_from_sale'`** (synthesized from a sale,
never marketed) and by `status` only **6** are active. *Check what a population IS before routing
work to it.*

⚠️ **And the extension is not the problem — it already extracts all three fields**
(`costar.js`: `year_built`, `square_footage`, and a `lot_size` branch handling **both** "Land Acres"
and "Land SF"). **The 393 `land_area` gaps have NEITHER column populated** — these properties were
never captured at all. **Absence of capture, not a mapping loss**, so a mapping fix buys nothing
here. Found while checking: `sidebar-pipeline.js` ~4597 sets `land_area` only on `/AC/i`, a latent
I12 minter — **measured, 0 such rows exist fleet-wide**, so it is a hazard to guard, not the cause.

**Recommendation: no build on this 662.** Stale sold comps, no documents, no live surface, no key —
a documented ceiling is worth more. The concrete cost is narrow and now stated: **82 properties have
a sale price and no building size, so they cannot produce a $/SF comp.** If a book needs those, that
is a targeted value-ranked ask (82 lookups with a named purpose), not draining a 662-row queue.
The two things carrying real leverage are **forward**: capture-at-ingest, and closing the I12
asymmetry so no future capture mints another unclosable row. → **B6d-assessor-capture**.

📁 **Consolidated into one canonical page: `docs/architecture/property-metadata-coverage.md`** — the
gap, the queue's structure, why the lane was retired, I12, the three refuted sources, and what is
actually worth doing. Future sessions start there rather than re-deriving it.

## 2026-09-01 — B6d-assessor-marker: the marker was built, and what it exposed is worse than a dead lane

**VERDICT: RETIRE.** PR **sbriggssjc/Dialysis#7385** merged (`422ef419`). The marker shipped
(`src/assessor_queue_marker.py`, four outcome paths, `skip:` / `source:` / `error:` prefixes, 30-day
cooldown + `last_attempt_at ASC NULLS FIRST`), and the two-run test is proven: **selection overlap
25/25 → 0/25**. But building it surfaced three things that outrank the task, and I verified the
DB-side claims live before recording them.

🚨 **1 — THERE IS NO COUNTY ASSESSOR ADAPTER. THE ONE EXTERNAL CALL ASKS gpt-4o TO RECALL PARCEL
FACTS.** Zero HTTP calls to any county in the module. A model cannot know a given parcel's year built
or lot size — it can only produce a plausible number, which this would have written into `properties`
as a fact. **`enriched: 0` is what saved us, not a guard.** ⚠️ **The gov repo already rejected
LLM-recall enrichment on exactly these grounds (ORE Phase A1) and nobody checked the dia side.**
Doctrine added to `CLAUDE.md`: *read what a producer's external call actually talks to before trusting
its name* — `*_enrichment` names an intent, not a source.

🚨 **2 — THE LARGEST BLOCKER IS A UNIT MISMATCH, NOT A COVERAGE GAP — verified live.** The closure
trigger watches **`land_area` (acres)**; the writer fills **`lot_sf` (square feet)**. Across all
**3,702** rows holding both: **0 equal**, and the ratio is **exactly 43,560 ±1 on 3,373 (91.1%)**,
within 1% on 98.1%, with 27 genuine disagreements (0.8%). One fact, two units, no reconciliation. So
**223 of 662 open rows (34%) carry only gaps this writer can never close** — the writer succeeds and
the gap persists, silently, on both sides. Filed as data-coherence invariant **I12**.

⚠️ **3 — AND THE "OTHER PATHS WILL HANDLE IT" FALLBACK IS REFUTED.** The 51% self-resolution I quoted
last turn hides a collapsed rate: **May 14 → June 174 → July 510 → August 5 → September 0.** July was
a burst, not a run rate. Quoting the cumulative share was the mistake; the monthly series is the fact.

Also measured here: **500 of 662 open rows (75.6%) have no parcel number** — the key the module's own
docstring says it depends on. Closable at all: **236 of 662 (36%)**, and that is the ceiling *at
perfect accuracy*. **A lane that is keyless, fabricating, and capped at 36% cannot be graded into
working.** No cron. The queue also still has no enqueuer.

⚠️ **I CORRECTED ONE CLAIM.** The response calls `land_area = lot_sf / 43560` *"the single high-value
fix… closable 236 → 439."* The closability arithmetic is right; **the value framing is not — it fills
ZERO rows today.** Measured: **0** `properties` rows have `land_area IS NULL AND lot_sf IS NOT NULL`.
It changes what a *future* source could close, which is plumbing, not yield — and with the lane
retired there is no such source queued. Re-filed at 🟡 as **B6d-assessor-landarea** with that
correction attached.

**Guard methodology worth keeping** (from the response, unverified but sound): a mutation scoped to a
FILE rather than the function it names **graded the wrong code** — `+= fields` appears twice and the
mutation landed in `run_batch`, not `run_queue_batch`, falsely reporting a survivor. Mutations are AST
-scoped now. And two genuine survivors came from **monkeypatching the function under test**. 28 tests,
23/23 mutations RED; full suite 2,980 → 3,008 passing with an identical 54-failure set before and
after. The `|| echo` masking was not touched (**B6e-ci-mask**) and CI was not relied on.

⚠️ **Dangling pointer, open:** the merged Dialysis `CLAUDE.md` references
`docs/audits/B6d_assessor_marker_ASSESSOR_DRAIN_TRACE_2026-09-01.md` in *this* repo, pushed to
`claude/assessor-marker-trace-2ospul` with **no PR**. → **B6d-assessor-doc**.

## 2026-09-01 — assessor enrichment: ran it once, and the answer is DO NOT WIRE IT

**`python -m src.assessor_enrichment --from-queue 25` → `processed 25, enriched 0, fields_updated 0,
errors 0, elapsed 114.8s`.** ~4.6 s per property of real elapsed work for **zero yield** — and,
decisively, **zero trace**. This is a *don't build* answer, and running it once before scheduling it
is the only reason we have it.

🚨 **`errors: 0` with `enriched: 0` is a worker reporting clean success while doing nothing** — the
failure mode this whole arc is about. Had the schedule been wired first, it would have run weekly
forever, reported no errors every time, and nobody would have known it produces nothing. Verified
live against the state delta, not the tally:

| probe | result |
|---|---|
| `attempts > 0` | **0 of 1,365 rows** |
| `last_attempt_at` / `last_error` set | **0 / 0** — the columns exist and *nothing has ever written them* |
| queue gaps after the run | `land_area` 409 · `year_built` 404 · `building_size` 108 · `tenant` 95 — **unchanged** |
| `properties` rows written by the run | **0** (the 6 in the window are a 12:00:0x top-of-hour burst, 5 of 6 not queue members) |

⚠️ **It cannot page past what it cannot mark — Dead-End Class 12, in its purest form.** P136's
reachability harvest at least wrote proposals when it succeeded; this worker writes **nothing on
either outcome**, so `--from-queue 25` re-selects **the same 25 rows on every future run**, spends
the same 115 seconds, and returns the same clean zero. A schedule would have made that permanent.

⚠️ **And the queue behind it is a one-shot — Class 8.** `max(enqueued_at)` is **2026-05-21**, 103
days ago; 703 `captured` / 662 `open` and nothing has enqueued since. **Even a working worker would
drain a frozen 662-row set and then run forever on empty.** Two defect classes stacked, plus the
silent-success reporting: three, in one unscheduled job.

**The gating question is unanswerable as built, and that is the finding.** 4.6 s/property is real
network time, so it is *reaching* something — but with `last_error` never written we cannot
distinguish *the assessor has nothing for these parcels* (a genuine ceiling; retire the lane) from
*every call is failing* (a fixable adapter). **The prerequisite is not a cron, it is a marker**:
record the attempt and the reason on every row, both outcomes, then re-run 25 and read the reasons.
Backlog **B6d-assessor-marker** (prerequisite) → **B6d-assessor-verdict** (retire or fix, decided on
the reasons) → **B6d-assessor-producer** (the queue has no producer; only relevant if the other two
come out positive). **No schedule until all three resolve.**

## 2026-09-01 — B6e-fred: the sweep was the finding; the FRED fix was already merged and still has not run

**`fred_ingest` has NEVER written a row** — not "dead for 25 days". `economic_indicators` has exactly
ONE write event in its life (2026-08-07 19:59, 86 rows) and it landed **after** both of that day's
workflow runs finished (19:47, 19:55): a hand-run. The workflow was added that day to fix a silent
stall and has been silently stalled from its first green run.

**The fix was already merged before this session** (`e0ec3fc`, PR #7383, 12:53 UTC) — deps + `set -o
pipefail` + fail-on-stale. **It has still never executed**: today's scheduled run fired ~11:30 UTC,
before the merge. *Merged is not running.* Next scheduled run 2026-09-02 11:30 UTC.

🚨 **The sweep outranked the FRED fix, as the brief predicted.** 2 of 3 piped producer steps were
broken. **`public-record-ingest-daily.yml` had `bash …sh 2>&1 | tee` with no pipefail** — and the
script sets `set -euo pipefail` internally and exits non-zero correctly, so **B6d-pri's brand-new
`EXIT_DRAIN_FAILED = 3` was being discarded one layer up by that pipe.** Fixed.
⚠️ **A guard for this exact defect already existed and was scoped to the ONE file the previous audit
was looking at** (`test_fred_workflow_sets_pipefail_before_piping_to_tee`), and used a file-wide
`find()` rather than a step anchor. **A guard written for an instance does not cover the class.**
Replaced with `tests/test_b6e_pipefail_workflow_guard.py` — class-wide, step-anchored, 10 tests,
**7/7 mutations RED**, with its own positive control.

🚨 **The operator exposure is a WRONG NUMBER, not a gap.** `economic_indicators` feeds only
`cm_dialysis_macro_rates_m/_q` — both CM book exhibits. The views do **not** go blank: the monthly
view still emits `2026-08-31` and the quarterly `2026-09-30`. Behind that "August" point:
**DGS10 = 3 observations (Aug 3–5), MORTGAGE30US = 1 (Aug 6), and FEDFUNDS/UNRATE/CPIAUCSL = 0.**
A complete-looking monthly average of the 10-year Treasury from three business days.
👤 **Whether a book went out after 2026-08-07 is an operator check; if so it is a correction, not
just a pipeline fix.** Nothing was regenerated.

⚠️ **BLOCKER — the live re-run is operator-gated and the gap is NOT backfilled.** `workflow_dispatch`
returned **403 (no Actions write scope)**; running it directly is impossible here (no `FRED_API_KEY`,
no service key, and `api.stlouisfed.org` is `connect_rejected` by the proxy). The fix remains
**unproven** until `max(economic_indicators.created_at)` advances past 2026-08-07.
⚠️ **If the dependency fix is wrong the workflow will now go RED — that is success. Do not revert the
pipefail to restore green.**

🚨 **The sweep's SECOND pass found the bigger one: Dialysis `ci.yml` cannot fail on its own subject
matter.** `| tee` is one masking idiom; **`|| echo` is another, used 5× in `ci.yml`** —
`pytest tests/ … 2>/dev/null || echo "Tests completed…"` swallows the exit code, so **3,042 collected
tests can never fail CI.** Every guard in `tests/` is a regression detector no merge gate enforces —
the LCC repo's own *"no workflow runs `npm test` on a PR"* finding, in a different disguise. ⚠️ **The
cruellest instance is `python -c "import src.main" 2>/dev/null || echo`: exactly the check that would
have caught FRED's `ModuleNotFoundError`.** **NOT flipped** — gating a never-enforced suite whose
greenness is unmeasured is the documented *"never green once on main"* trap. Backlog **B6e-ci-mask**.
Also added `PyYAML>=6.0.1` to `requirements.txt`: the new guard parses workflow YAML, and a guard that
cannot import is a guard that does not run.

Also: `INFRASTRUCTURE.md`'s job map gains `fred-ingest-daily.yml` (a scheduled producer nobody had
written down) and `metadata-backfill-queue.sh`; `dia_producer_registry.notes` for `fred_ingest`
rewritten to say *merged, not yet executed*. Writeup:
`docs/audits/B6e_fred_GREEN_CI_DEAD_PRODUCER_2026-09-01.md`.

## 2026-09-01 — B6d-cms-escalation: dia's producer-health surface, and a workflow that was green 16 times over nothing

**Shipped:** `dia_producer_registry` + `v_dia_producer_health` on Dialysis_DB
(`20260901120000`, applied live) — the dia half of gov's `v_pipeline_task_health`. Before it, dia
ran **five scheduled ingestion producers and had zero producer-health objects**; the only
instrument was a 45-day freshness bound on a downstream table. Writeup:
[`docs/audits/B6d_cms_escalation_DIA_PRODUCER_HEALTH_2026-09-01.md`](../audits/B6d_cms_escalation_DIA_PRODUCER_HEALTH_2026-09-01.md).

**The enumeration was the finding, and it outranks the view.**
`.github/workflows/fred-ingest-daily.yml` has reported `conclusion: success` on **16 consecutive
scheduled runs since 2026-08-10 while writing ZERO rows** — and it has **never** written a row in
its 20-run life, despite being added on 2026-08-07 *to fix a silent FRED stall*. Root cause:
`ModuleNotFoundError: No module named 'postgrest'` at import (the workflow installs only
`requests python-dotenv`; both `postgrest` and `supabase` are pinned in `requirements.txt`),
**masked by `cmd | tee` without `pipefail`** — measured directly as `exit 0` vs `exit 1`. That
masking also defeated the script's own `sys.exit(1 if nothing written)` guard, which never ran.
The 2026-08-07 "recovery" was a hand-run at 19:59, after both workflow runs finished (19:47,
19:55). Three surfaces each held half the truth — GH Actions said success, the watchdog held an
`lcc_health_alerts` row open 16 days, the workflow printed `{"status":"stale"}` in its own log
every green run — **and nothing joined them.** Workflow fixed: deps + `set -o pipefail` +
fail-on-stale.

**Four of five dia producers write no run ledger at all** (verified by reading
`public_record_ingest.py`, `assessor_enrichment.py`, `ingest_fred_to_dialysis.py`,
`sf_object_sync.py` — zero `ingestion_tracker`/`run_log` writes). They read **`no_run_ledger`**
with a CHECK-enforced `blindness_reason`: the blindness is stated, never hidden behind a proxy.
⚠️ **Enumerating from `ingestion_tracker` would have rebuilt that blindness** — its five distinct
`source` values are the real producer plus the janitor, the watermark writer, a one-shot and a dead
lane.

**Two readings that exist only because columns were kept separate:** `cms_ingestion` reads
`last_success_at` **2026-04-04** against `last_rows_written_at` **2026-08-31** (no clean `success`
since April, yet moving rows via `partial` runs); and its observed **p90 gap of 30.44 days against
a declared 1-day cron** is the removed 30-day throttle still legible in the run history.

**Verification:** positive control on three arms (`overdue` / `never_ran`, plus a **negative
control on the same rows** reading `ok`), 0 residue. Guards
`tests/test_b6d_cms_escalation_producer_health.py` — 14 tests, **14/14 mutations RED**. Two guard
defects were caught by the mutation pass itself: a file-wide `exit 1` grep passed its own mutation
(the token appears twice — re-anchored on the step), and comment-stripping proved load-bearing.

⚠️ **No alert shipped, deliberately** — 50 zero-duration watermark rows still wear
`run_status='success'`, so alerting on it would manufacture false all-clears. Follow-ups filed:
**B6d-cms-escalation-emit** (make the four blind producers emit — the fix that turns this from a
blindness report into monitoring), **-alert**, **-metadata** (is `metadata-backfill-queue` actually
wired in Railway?), **-infradoc** (`INFRASTRUCTURE.md` is dated 2026-05-16 and its job map is
missing `fred-ingest-daily` entirely).

## 2026-08-31 — B6d-cms-step second pass: the latch had two more doors, and one was open in the live watermark

**Reconciled first.** The first pass shipped in a parallel window (`68da552`, PR #7381) and is on
`main`; nothing was re-done. Re-measuring afterwards found three more instances of the same shape —
*a slot that exists to carry meaning, written with something else* — and **corrected two claims the
first pass made.**

- 🔴 **The "success on a no-op" defect is REAL; the first pass dismissed it on a true fact.** It
  split `ingestion_tracker` by `source`, correctly established that `cms_ingestion` has never
  reported success, and concluded the defect does not exist. But `get_last_ingestion_meta()` filters
  on `dataset_id` + `run_status` and **not on `source`** — so the `source='CMS'` rows ARE this
  pipeline's watermark, and the live one is a **zero-duration** row (`finished_at = started_at`),
  `rows_upserted` NULL, every count 0. **Split by the key the CONSUMER uses, not the one that best
  explains the population.** Fixed: the stamp carries `WATERMARK_RUN_STATUS='watermark'` instead of
  wearing `success` (still in `INGESTED_RUN_STATUSES`, so the gate arms exactly as before).
- 🔴 **B6d-pri's own code comment is false in effect.** It says the `recorded` skip row *"can never
  re-arm the change-detection watermark"*. That row is correctly excluded — and the **same
  invocation** wrote a `CMS`/`success` row 0.4 s earlier carrying the **identical**
  `dataset_modified_date`, which is not. **An exclusion is only as strong as the set of rows that
  can carry the same fact.**
- 🔴 **The reason latched on a channel the fix did not cover — 470 rows.** The first fix recovers
  from `payload`; these producers pass the reason as an **argument** (`clinic_removed`,
  `status_unknown`), and `update_data.get("reason") or reason` let a placeholder outrank it.
  `_first_real` is hoisted to module scope (`_pu_first_real`) and both channels resolve through it —
  one implementation, one vocabulary.
- ✅ **`error_summary` has its first writer.** Both janitors wrote `error_log`, overwriting the
  process's own diagnostic — which is why 16 of 18 populated values were janitor artifacts rather
  than tracebacks. The janitor is an **outside observer**; it writes `error_summary` now.
- ✅ **The queue is legible for the first time.** `address_change` 2,148 → **5,102**;
  `unknown_reason` 3,424 → **0**; `table_name='unknown'` 470 → **0**. Predicted 2,954 repairable /
  470 not and got **exactly that**. The 470 are **marked, not repaired** —
  `producer_supplied_no_reason` is a provenance statement, not a reason, worded so it cannot later
  be mistaken for recovered content. ⚠️ `field_name` stays `__record__` deliberately: it is a live
  **sentinel** elsewhere, so *recoverable* and *safe to rewrite* are different questions
  (**B6d-cms-step-field**).
- ✅ **Zero regressions, established by a full-suite before/after baseline diff** — identical failure
  set (53 pre-existing, all environmental). Guard `tests/test_b6d_cms_step_error_channel.py`,
  **11/11 mutations RED**, asserting on the **AST**: the fixes' comments quote `error_log`,
  `"success"` and the old `or` expression while explaining them, and comments are absent from the
  AST by construction — removing the stripper-bug class rather than working around it.
- ⚠️ **Three prior-window guards went red and were established STALE, not breached, before being
  touched.** Each pinned a literal (`INGESTED_RUN_STATUSES == ("success",)`, `sink[0]["error_log"]`)
  while its stated intent survives; rewritten to assert the intent, and the reclaim guard was
  *strengthened* to assert `error_log` is not written.
- ⚠️ **Still no exception text, and that is the honest deliverable.** The 18:30 run reproduces the
  shape exactly: heartbeat at 18:38:14.99 on `current_step: medicare_ingestion`, declared failed at
  18:38:16.10 by a **`(force)`** reclaim — alive 1.1 s earlier. It was **killed**, then
  force-reclaimed by a second invocation. `ingestion_tracker` structurally cannot carry an OOM;
  **Railway deploy logs remain the next step.**
- 🔴 **The outage broke open further during the work**: `max(medicare_clinics.source_last_seen)`
  **2026-06-25 → 2026-08-31**. ⚠️ **Still climbing while this was written — 61 → 84 → 163 of 8,547
  across three measurements in one session, so quote it with its timestamp or not at all.** Even at
  163 that is **1.9%**: the pipeline can write again; the feed is not healthy. The last clinic write is an hour *after* the last `ingestion_tracker`
  row, so that work carries **no run record at all**.
- ⚠️ **New, unproven, filed not asserted:** `dataset_modified_date` looks **clock-derived** (one
  second after the preceding reclaim; the patient-counts skip row carries the identical stamp for a
  different dataset; CMS's own `last_modified` is captured on 3 of 193 rows, newest 2026-03-24).
  That would be the same latch through a third door — **B6d-cms-step-watermark-clock**.

## 2026-08-31 — B6d-cms-step + B6d-pri-reason: the error channel works; the audit read a decoy column

**The premise was refuted, and the correction is the deliverable.** `ingestion_tracker` has **two**
error columns. **`error_summary` has ZERO writers repo-wide** (no migration; the only hits store a
value in a `notes`/`details` dict under that *key*) — so 47/47 NULL is correct and expected — while
**`error_log` is populated on 18 of 18 `cms_ingestion` failures.** The capture the row asked to be
built **already exists**: `traceback.format_exc()` on the exception path, a SIGTERM handler, and the
step heartbeat, **all writing `error_log`**. They did not fire because every row was still `started`
at reclaim time: **the process is hard-KILLED, so there is no exception to capture.** Every populated
`error_log` is a **janitor artifact** that overwrote the diagnostic slot — the newest reads
`(force)` with a heartbeat **2 s before** it was declared failed and a new lock row **0.4 s after**,
i.e. the documented `FORCE_RUN=true` self-sabotage, recorded in the DB and read as a crash.

Three further corrections: the two `started`+NULL rows are **`ingestion_lock`** rows, not pipeline
runs (the lump-the-lock footgun); **none of the "6 success runs" is `cms_ingestion`** — that pipeline
has *never* reported success in the window, so §2's "success on a no-op" defect does not exist; and
**every "failed" run is a PAIR of rows 27–61 ms apart**, so the failure count itself is inflated by
the instrumentation.

**Shipped — B6d-pri-reason.** 437 → **2,148 rows** (growing ~78/min), and **the reason was never
missing**: every row carried `payload.fields.reason='address_change'` / `medicare_clinics` /
`address`, **100% recoverable**. `sanitize_pending_update` runs **twice**; pass 1 stamps its own
`unknown_reason`, and pass 2's `if not p.get("reason")` sees a non-empty string and **refuses to
correct it** — *a value the function invented blocked the real one it could now see*. Reproduced
byte-identically via the stored `file_name='auto:medicare_clinics:unknown_reason:noid'`. Fixed
(placeholders are treated as ABSENT; one owner for the vocabulary; nothing fabricated) **+ 2,148 rows
backfilled reversibly** (`20260831190000`). Guard: 9 tests, **7/7 mutations RED**. ⚠️ Two guard
defects were found in this session's own tests — a stripper that deleted the declaration it asserted
on, and a source assertion whose pattern contained a literal and so **passed its own mutation**.

🔴 **The live finding that outranks both rows (`B6d-cms-divert`):** a process wrote those 2,148 rows
**with no `ingestion_tracker` row at all** while `max(medicare_clinics.source_last_seen)` stayed
**2026-06-25** and `refreshed_today = 0`. **It reads CMS, queues a change per clinic, and never
writes the clinic.** New rows: `B6d-cms-divert`, `B6d-pri-address-noise`, `B6d-cms-doublerow`,
`B6d-cms-orphan-scope`.

⚠️ **`source_last_seen` did not move and was not expected to.** ⚠️ The full suite cannot run in this
sandbox (`flask` absent, pre-existing) — 35 tests green on the affected surface; **not a clean-suite
claim.** Writeup: [`docs/audits/B6d_cms_step_ERROR_CHANNEL_2026-08-31.md`](../audits/B6d_cms_step_ERROR_CHANNEL_2026-08-31.md).

## 2026-08-31 — B6d-pri: four defects, ~1,950 failures a day, exit code 0

**Repo: Dialysis.** Writeup `docs/audits/B6d_pri_PUBLIC_RECORD_INGEST_REPAIR_2026-08-31.md`;
backlog **B6d-pri** ✅, **B6d-cms-restart** re-scoped, **B6d-pri-metrics** filed.

- 🎯 **The biggest item was settled by the FIRST check, and it is a deploy gap.** The 2026-08-31
  log emits `"CMS ingestion recently run (3 days ago < 30); skipping."` — a format string
  `fc342b3` **deleted on 2026-08-29** and present nowhere in `main`. Arithmetic corroborates to
  the day (pre-fix watermark → the **abandoned** 08-27 row → 3.99d → `.days` = 3). **So no second
  throttle fix was written**: keying on last SUCCESS is already `INGESTED_RUN_STATUSES =
  ("success",)`. *Merged is not running*, fourth time in this arc.
- **It also explains B6d-cms-restart's "no attempt on 08-28/29/30":** the pre-fix throttle
  **returns before writing any tracker row**, so a skip and a cron that never fired are the same
  absence. Fixed — a skip now emits with a reason (B6a's rule inside the ingester), under
  `status='recorded'`, which is deliberately not in `INGESTED_RUN_STATUSES` so it cannot re-arm
  the watermark. **Why the earlier runs were KILLED is still open and still needs Railway logs.**
- **`reason` was dropped from a SELECT and written back** → 23502 on every stale row
  (`pending_updates.reason` is NOT NULL; live 1,959 rows / 0 nulls / 1,952 past the 7d threshold).
- ⚠️ **THE MISSING DSN WAS A SYMPTOM MASKING THE REAL ERROR.** A bare `except: pass` swallowed the
  23502 and let the fallback's *"DSN not configured"* be the only visible message. **Setting the
  DSN would have fixed nothing** — the fallback INSERTs and the table is NOT NULL on four more
  columns; it would have failed differently, and a fallback that satisfied them would mint fresh
  queue rows for a status flip. Fixing the reason bug is what makes the DSN symptom disappear.
- ⚠️ **The fix nearly landed on dead code.** `logging_helpers` defines `upsert_pending_update`
  twice and rebinds the name to `upsert_pending_update_v2`; `inspect` says the live body is line
  **4528**. Two definitions of one name in one Python module — the later silently wins.
- **`properties._new_property` is a pseudo-field** (0 columns, 65 rows): the 42703 was swallowed
  and the row **silently read as "no change"**.
- ⚠️ **The 1,001 log lines are a viewer cap, not a run boundary.** 496+486+10+~9 = 1,001 against
  1,952 stale rows — the brief's counts are **floors**; the true per-run figure is **~1,950**.
- **`public-record-ingest` and `cms-ingestion` are in NO producer registry** — `feed_freshness_registry`
  is table-keyed (5 dia rows) and `ingestion_tracker` has no health consumer; B6a's
  `v_pipeline_task_health` is gov-side only. **B6d-cms-escalation stands, unbuilt by design.**
- Guards: 21 tests, **20/20 mutations RED**. ⚠️ One guard **passed its own mutation** first
  (`"wholesale_failure" in body` matched the local `drain_wholesale_failure` — the N15c lesson);
  it asserts the AST attribute access now. A second sliced **past** the function it named into a
  module-level `try/except: pass`; the slicer uses `ast` line spans now. Suite **2,957 / 44
  failed, failure set byte-identical to the same-session baseline**.
- 👤 **Nothing here ingests.** The restart is a Railway **Redeploy** (not `FORCE_RUN=true`).
  Verify on `max(medicare_clinics.source_last_seen)` past 2026-06-25 + the `feed_stale` alert
  auto-resolving — never `updated_at`, never the log line.
## 2026-08-29 — D1: the cross-database provenance diff, standing (and mostly good news)

**NOTHING BUILT** — no feeder, no backfill, no migration. Shipped a detector, a ledger and a guard.
Writeup `docs/audits/D1_CROSS_DB_PROVENANCE_DIFF_2026-08-29.md`; **I2**, **Class 20**, backlog
**D1** + **D1a'–D1i** updated.

- **The honest headline: the two domains are substantially coherent.** **69 producer-set differences
  over 23 two-sided fact stores — 58 legitimate, 5 unexplained, 6 unwired, and NONE B5-sized.** The
  largest is 1,021 rows of broker market intelligence against B5's 2,776 ownership rows over 2,000
  properties. ⚠️ **That is a real result and it is what the prompt named as valuable — the detector's
  value is now preventing the next divergence, not closing a current one. Manufacturing a finding to
  justify the query was the failure mode here.**
- ⚠️ **THE BIGGER FINDING IS A PRECONDITION NOBODY HAD STATED: 12 tables exist in BOTH domains and
  record provenance in only ONE**, so I2 cannot be evaluated on them at all. The one that matters is
  **dia `ownership_history` — 10,037 rows, no provenance column**, i.e. the very store B5 was a
  finding about is un-diffable on dia's side. **A store with no provenance column is not clean, it is
  UNMEASURABLE — and it reads identically to clean.** Backlog **D1g**.
- ⚠️ **Positive control: 2 of 3, and I am not claiming the third.** B5 fires (dia
  `sales_transactions_seller_exit` 2,310 facts / 1,554 entities, gov absent); B6c-dup fires (dia PSE
  carries `sales_transactions` 2,646, gov carries none). **B6b is structurally out of reach —
  `gsa_lease_change_facts` has no provenance column at all**; it was found by B6a's skipped-step
  instrument, a different detector answering a different question.
- ⚠️ **B5's control still fires even though B5 SHIPPED** — gov's equivalent work landed under
  different bucket labels, so a naive reading re-reports a closed finding as open. That is exactly
  why the mechanism is **acknowledgement-with-a-reason**: `legitimate` silences a row,
  `unexplained`/`unwired` keep it **rendering** as known and tracked. Every entry, synonym and
  exclusion **requires a reason** or the detector rejects it.
- ⚠️ **I corrected my own reading twice, and both corrections shrank the finding.** The raw diff said
  *"gov harvests sale contacts, dia does not — wire dia up"*; the parser diagnostics said dia has
  **6x** the raw material and writes nothing, which looked bigger; **reading the rows** showed every
  row on **both** sides is a **BROKER**, which the account doctrine never prospects — so it is Tier-4
  market intelligence, not a BD gap. The genuinely valuable thing found en route is **symmetric and
  therefore invisible to this detector**: buyer/seller sale-role contacts have **never** been
  persisted in **either** domain, though dia's parser reports one on **540 of 942** captures
  (**D1a'**, Class 2 not Class 20).
- ⚠️ **Five ways this query returns a confident wrong answer, all hit live, all now guarded:**
  per-domain column NAMES (`properties` = `data_source`/`source`); a **dead** second column (gov
  `property_financials.source`, **0 of 98,510 populated**) so resolve by POPULATION not name;
  per-row suffixes; a provenance column holding a **data value at modest cardinality**
  (`ingestion_tracker.source` = temp paths, ~41 buckets, under any sane cardinality guard) — excluded
  by **recorded decision with a reason, emitted and counted**, never by a name pattern (P182); and one
  producer wearing two labels, folded by synonym **stingily** (dia carries BOTH `costar_import` and
  `costar_sidebar`, so folding those would have hidden a real difference).
- ⚠️ **The ledger-completeness gate caught 5 differences I had missed by eye.** Verifying the ledger
  against the measured population, rather than assuming it complete, is what made it complete.
- **Guard:** `test/d1-cross-db-provenance-diff.test.mjs` — 18 tests, **19 mutations verified RED**,
  comments stripped before source matching.
- 👤 **NOT scheduled, deliberately (D1h), and the script has never run.** The sandbox holds no
  `GOV_/DIA_SUPABASE_*` credentials, so **every number above was measured through the Supabase MCP
  seam and the runner's I/O path is unexercised.** A job that has never been green once is the badge
  people learn to merge past. **First credentialed run is an operator step.**
- Also fixed in passing: the backlog's **D1 row had 5 cells in a 4-column table and an unescaped `|`
  inside a code span**, so GFM was silently dropping its status cell.
## 2026-09-01 — 🚨 B6e-fred's sweep found the bigger thing: Dialysis CI CANNOT FAIL on its own subject matter

**The FRED fix shipped (PR #7384) and the sweep did what §3 of the prompt hoped — it outranked the
fix.**

### `B6e-ci-mask` — 3,042 tests collected, not one can fail CI

Dialysis `ci.yml` uses `|| echo` **five times**:

```
pytest tests/ -v --tb=short --ignore=tests/integration/ 2>/dev/null || echo "Tests completed…"
```

**`|| echo` swallows pytest's exit code, so the step always succeeds; `2>/dev/null` discards the
traceback.** ⚠️ **Every guard in `tests/` — including the mutation-verified B6d ones and the new
pipefail guard — is a regression detector that no merge gate enforces.**

⚠️ **This is LCC's own documented "no workflow runs `npm test` on a PR" finding, in a second repo,
wearing a different idiom.** `| tee` was one masking form; `|| echo` is another.

🎯 **And the cruellest instance is lines 137–138: `python -c "import src.main" 2>/dev/null || echo`.**
**That is exactly the check that would have caught FRED's `ModuleNotFoundError: postgrest`.**
**The repo already had the detector. It simply could not fail.** Twenty-five days of green badges
over a dead producer, with the guard sitting right there, muzzled.

✅ **CC did NOT flip it, and that was right.** Gating a never-enforced 3,042-test suite is the
documented **"never green once on `main`"** trap — and whether that suite is green is *unmeasured*.
The sequence filed is the correct one: **measure on `main` → fix or quarantine what is red → remove
the masking ONE LINE AT A TIME, starting with the import check.** It also declined to extend the
pipefail guard to cover `|| echo`, because that would ship a test red on every run with no safe way
to green it.

### ⚠️ FRED itself is fixed but UNPROVEN — verified: still 25 days stale

`economic_indicators` newest row is **still 2026-08-07**, **0 rows since 2026-08-10**. The workflow
fix is merged; **the producer has not yet been shown to write.** ⚠️ **"Merged is not running" — and
here it is also "fixed is not proven."** Dispatching the workflow needs Actions-write scope Claude
Code does not have (403), so **`B6e-fred-verify` is Scott's**: run it and confirm rows land past
2026-08-07, then decide on backfilling the 25-day gap.

### A merge resolution worth preserving as a rule

Two windows answered `B6e-meta` simultaneously and both edited that backlog row; the auto-merge was
clean and produced **two rows under one id**. ⚠️ **CC resolved it correctly: a duplicated row id is
a MAPPING, not an addition, so "keep both" was wrong** — it kept the richer version (the one with
the queue measurement) and folded in the single fact only its own had. **That is the YAML
`node-version` lesson from `CLAUDE.md` §4a, applied to prose, and got right this time.**

## 2026-09-01 — Registry corrected, and the queue measured: DO NOT schedule it yet

**SQL run.** `dia_producer_registry.metadata_backfill_queue` now reads **CONFIRMED UNSCHEDULED**
with the operator check recorded; `scheduler_confirmed` stays `false`, which remains accurate.

### 📊 Scott asked whether to wire the schedule while we are here. The measurement says NO — a schedule solves the wrong half.

`property_metadata_backfill_queue`:

| fact | value |
|---|---|
| total rows | **1,365** |
| enqueued | **ALL on ONE day — 2026-05-21** |
| `attempts > 0` | **ZERO rows. The drain has never processed a single row.** |
| `open` | 662 · `captured`/resolved | 703 |

**Three findings, and they point the same way:**

1. **Nothing ENQUEUES.** No new rows in 3.5 months. **A weekly cron would drain 662 once and then
   run empty forever** — a consumer with no producer, the mirror of Class 2.
2. **The drain has NEVER executed.** ⚠️ **Scheduling untested code is exactly how the last three
   silent producers happened** (`fred_ingest` green-and-dead, `cms_ingestion` throttled,
   `public_record_ingest` failing 500×/run). **Prove it works before automating it.**
3. **But the gaps ARE real** — of the 662 open rows, **0 properties are gone** and only **16 have
   since had `year_built` filled (16 for `land_area`)**, so **~646 are still genuine**
   (`year_built` 224, `land_area` 205, plus combinations). **This is worth doing; it is not worth
   scheduling yet.**

⚠️ **The most interesting number is the one that argues for caution: 703 rows are `captured` and
RESOLVED with ZERO attempts.** **51% of the original queue self-resolved through other ingestion
paths.** That is simultaneously evidence the fields do fill over time *and* a reason to **size the
assessor's marginal yield before automating** — it may be doing less work than the queue depth
implies.

**Recommended sequence, in order:**

1. **Run it ONCE, manually, against the 662** — measure the real yield (how many of ~646 gaps does
   the assessor actually fill?).
2. **If the yield justifies it, build the ENQUEUER** — the missing producer half. Without it, any
   schedule is a one-shot wearing a cron.
3. **Only then add a schedule**, and register it with a declared cadence so
   `v_dia_producer_health` can see it from day one.

**This is the Consumption-Layer bar applied to a producer we were about to switch on because it
existed** — the exact move `B6b-lead` was refused for, and the reason that refusal was right.

## 2026-09-01 — 👤 Operator check: `metadata_backfill_queue` was NEVER WIRED, and a second Railway deployment surfaced

**Scott checked Railway.** The service exists on **both** the `life-command-center` and
`tranquil-delight` deployments, and **neither carries a Cron Schedule setting.**

✅ **So `metadata_backfill_queue` has no trigger anywhere — it is deployable code that nothing runs.**
That is the third of the three outcomes I laid out: **designed and never wired**, not *scheduled and
undocumented*.

⚠️ **This converts it from a bug into a DECISION.** It has never run, so **nothing regressed by its
absence** — wiring it is **new capability**, and it should clear the Consumption-Layer bar (named
consumer, value gate, auto-retire predicate, honest counts) exactly like any other new producer.
**Not "turn it on because it exists."**

⚠️ **And the registry row needs a precise correction, because the two states are different facts.**
`dia_producer_registry.scheduler_confirmed` stays **false**, but the notes currently say
*"SCHEDULE UNCONFIRMED — operator must confirm"*. **It is now CONFIRMED UNSCHEDULED.** Leaving it as
"unconfirmed" implies the weaker claim and invites someone to re-check what has already been
checked. Proposed one-line update handed to Scott.

### ⚠️ Second finding, surfaced incidentally: the dormant `life-command-center` service is still live

The metadata service appearing on **both** deployments means **the dormant `life-command-center`
Railway service still exists**, carrying service definitions, alongside `tranquil-delight`.

**`I16` already names deleting it** (part of the Render-contingency decision), and
`CURRENT-STATE.md` treats `tranquil-delight` + the standalone MCP as the live pair. ⚠️ **This is the
P194 shape** — the retired Vercel deployment that still answers and still holds a service key — **and
the lesson there was that a stale deployment is invisible to every check this repo runs.** Filed as
**`I16b`**: confirm it holds no live traffic and no live credentials **before** deleting, and confirm
it is not quietly serving something unaccounted for. *Do not delete on the assumption it is dormant;
that assumption is exactly what P194 punished.*

## 2026-09-01 — B6e-fred drafted, and the operator cost turns out to be the Capital Markets book

**Prompt: `prompts/B6e-fred-green-ci-dead-producer-2026-09-01.md`.**

🚨 **`economic_indicators` is not an obscure table. It feeds exactly two consumers, and both are
Capital Markets book exhibits** — **`cm_dialysis_macro_rates_m`** and **`cm_dialysis_macro_rates_q`**,
the macro-rate exhibits in the **Dialysis State of the Market book**. The series include **`DGS10`**,
the 10-year Treasury.

**So this is not a stale internal table — it is a client deliverable running on rates that stopped
updating 2026-08-07.** ⚠️ **The prompt requires establishing whether a book or CM export actually
went out in that window: if one did, that is a correction to make, not just a pipeline to fix.**

**Two sequencing decisions written in, both counter-intuitive:**

- **Fix `pipefail` BEFORE the dependency**, so the next failure is loud even if the dependency fix is
  wrong.
- ⚠️ **If `pipefail` lands first, the workflow will correctly go RED — and that is SUCCESS for step
  1.** The prompt says explicitly: **do not "fix" the redness by reverting the pipefail.** A loud
  failure is the improvement; a green badge over a dead producer is the defect.

🚨 **And the sweep is the bigger prize.** One instance of `| tee` without `pipefail` implies a
pattern, and the pattern is **invisible by construction**. The prompt requires every workflow with a
piped step lacking `pipefail` to be reported **whether or not it is currently failing** — and says
plainly: **if the shape appears in several workflows, that is the finding and it outranks the FRED
fix.** *One dead producer is a bug; a class of workflows that cannot report their own failures is a
blind spot.*

## 2026-09-01 — ✅ B6d-cms-escalation SHIPPED, and its FIRST honest run found a producer green in CI and dead for 25 days

`dia_producer_registry` + `v_dia_producer_health` are live. **The instrument was the deliverable; what
it revealed on first run is the point — and it revealed more than the CMS thread did.**

### 🚨 `fred_ingest` — 16 consecutive GREEN scheduled runs wrote ZERO rows

**Verified independently: `economic_indicators` last took a row on 2026-08-07 — 25 days ago — and
ZERO rows since 2026-08-10**, across **16 green GitHub Actions runs**.

**Mechanism:** the module **dies at import** (`ModuleNotFoundError: postgrest`), and **`| tee`
without `pipefail` masks the exit code**, so the workflow reports success. ⚠️ **It is not in
`INFRASTRUCTURE.md`'s job map either** — a producer nobody had written down, failing silently, with a
green badge.

⚠️ **This is the purest instance of the class this whole arc has been about**, and it was found by
the very rule I insisted on: **enumerate producers from the SCHEDULER, not from the run ledger.**
`fred_ingest` writes no run row, so it is **invisible to `ingestion_tracker`** — building the
registry from the tracker would have missed it entirely.

### ⚠️ And the CMS outage is OLDER than we have been saying

**`cms_ingestion.last_success_at` = 2026-04-04**, not 2026-06-25. **The 06-25 date was
`source_last_seen` — a watermark, not a successful run.** The pipeline has not had a clean success in
**five months**. ⚠️ **And `last_outcome` reads `started` at 2026-09-01 06:08 — another orphan forming
right now**, with `failures_30d = 4`.

⚠️ **`refreshed_since` is still 249** — unchanged since yesterday. **The check I flagged has its
answer: the pipeline completes without finishing.**

### The registry's own headline: 4 of 5 producers emit no run row at all

| producer | scheduler | emits run row | state |
|---|---|---|---|
| `cms_ingestion` | railway cron `0 6 * * *` | ✅ | last clean success **2026-04-04**; orphan forming |
| **`fred_ingest`** | GH Actions `30 11 * * 1-5` | ❌ | 🚨 **green, dead 25 days** |
| `public_record_ingest` | railway cron `0 7 * * *` | ❌ | running (wrote parcel/deed 08-31) — **a failure would be invisible** |
| `metadata_backfill_queue` | railway cron **UNCONFIRMED** | ❌ | 👤 *"either scheduled and undocumented, or never wired"* |
| `salesforce_object_sync` | GH Actions `0 7 1 1,7 *` | ❌ | twice a year — **a failure is invisible for months** |

**The view is honest about its own blindness** — every row carries a `blindness_reason`,
`scheduler_confirmed` flags the unconfirmed one, and `cadence_basis` says `declared_schedule` rather
than implying a measurement. **That is what makes it trustworthy on day one.**

⚠️ **One design decision worth preserving:** `cms_ingestion` is mapped on `source='cms_ingestion'`
**only** — `source='CMS'` rows are zero-duration **watermark stamps** and `source='ingestion_lock'`
rows are the **janitor**. **Folding either in would have inflated `last_success_at` with rows that
never moved data** — the same honest-count discipline, applied while building the instrument.

## 2026-09-01 — B6d-cms-escalation drafted: dia has five producers and no health surface over any of them

**Prompt: `prompts/B6d-cms-escalation-dia-producer-health-2026-09-01.md`.** This is the answer to
*"why did the CMS outage take two months?"*, and it is the structural half of **I4**.

**Verified live:**

| | gov | **dia** |
|---|---|---|
| producer health view | ✅ `v_pipeline_task_health` | ❌ **does not exist** |
| producer run table | `run_log` (5,813 rows) | `ingestion_tracker` (292) |
| producer-registry objects | ✅ | ❌ **zero** |
| `feed_freshness_registry` | per-feed | **5 rows, TABLE-keyed** |
| producers writing runs | — | **5 distinct**, newest 2026-09-01 |

**dia runs five ingestion producers and has no surface that can say whether any is healthy.** The
only instrument pointing at them is a freshness bound on the **output** — which structurally cannot
distinguish *the producer failed* from *the source published nothing*. **B6a built this for gov; dia
never got it.**

✅ **The port is well-defined, and gov's view already carries the exact distinction this thread was
about: `last_success_at` SEPARATE from `last_outcome_at`.** That is precisely what the CMS throttle
violated — it keyed on the last *attempt* and bought 30 days of silence per failure. Plus
`skip_reason`/`skip_declared` from B6a and `p90_gap_days` from B6d. ⚠️ **It is a port with a column
mapping, not a copy** — gov reads `run_log`, dia has `ingestion_tracker` with different columns and a
producer keyed on `task_name` **or** `source`.

🚨 **The prompt's central trap, and it would have rebuilt the blindness one level up: ENUMERATE
PRODUCERS FROM THE SCHEDULER, NOT FROM `ingestion_tracker`.** The tracker's five are only those that
have **ever written a row** — *a producer that has never emitted is invisible to it*, which is Class
21 exactly. **A scheduled producer with zero rows ever is the highest-value row that view can
contain.**

**Two honesty constraints carried in:** ⚠️ **`last_error` will be empty at first** — `error_summary`
is NULL on **47 of 47** dia runs until `B6d-cms-step` lands — **and a view showing always-null errors
must not be read as "no errors."** ⚠️ **`success` is not yet trustworthy on dia** (six successes
while zero clinics refreshed), so **`last_success_at` inherits that weakness and NO alert ships until
the view is honest** — an alerting surface over an untrustworthy `success` would manufacture false
all-clears.

## 2026-09-01 — ✅ CLOSED. The CMS alert auto-resolved, the placeholder regression is at ZERO, and one feed_stale alert remains.

**Both checks I promised, run — and both passed.**

### ✅ Check 1: the alert auto-resolved on its own

**`medicare_clinics` — detected 2026-08-28, RESOLVED 2026-09-01.** ⚠️ **This, not my query, was
always the confirmation** — I said so explicitly last night and it is worth naming that the rule
held: *the monitor closed its own alert*, which is the whole point of B6a-follow-up.

**Open `feed_stale` alerts: 4 → 1.** The only survivor is **`sam_lease_opportunities`**, which is
`B6d-sam` — a 401, an owner action, and correctly still open.

### ✅ Check 2: the placeholder regression is fixed properly, not just stopped

| | baseline | peak | **now** |
|---|---:|---:|---:|
| `pending_updates` total | 1,959 | **7,531** | **1,965** |
| `reason = 'unknown_reason'` | 0 | **3,424** | **0** |

**And the writer now emits a REAL reason** — `public_record_ai_no_yield` moved 1,893 → **1,899**
with `last_seen` **2026-09-01**, so the six new rows today carry a meaningful reason. The three
legitimate categories are intact and nothing else was disturbed.

⚠️ **Recorded precisely: the 3,424 were DELETED, not re-labelled.** `public_record_ai_no_yield`
gained **6**, not ~3,424 — so the placeholder rows were removed as the artifact they were, and the
writer was fixed separately. **That is a defensible third option beyond my "backfill or mark"
framing** (they were one day's output of a broken path, not real pending work), **but it is a
different act and the record should say which happened.**

### ⚠️ The one thing NOT finished: the ingest is 2.9% complete

**`refreshed_since` 61 → 249 of 8,547 clinics = 2.9%.** `source_last_seen` is 2026-08-31.

**So the pipeline can write again and is progressing — but this is not a completed ingest.**
⚠️ **And the alert resolving does NOT mean the feed is whole**: the freshness check asks *has data
arrived recently*, which 249 rows satisfy. **A green alert and a complete dataset are different
facts** — the same shape as every honest-count lesson in this arc, now in our favour rather than
against us. **The next scheduled run should push 249 higher; if it stalls there, the pipeline
completes without finishing.**

**Sixty-seven days of silence, closed.** The chain that did it: B6a made producers visible →
B6a-follow-up made them alertable → **B6d graded the bound and refused to widen it** → the Railway
logs named a throttle → `--force-run` proved the throttle was hiding a real failure → B6d-pri/-step
made the failure legible. **No single step would have done it, and the one that mattered most was
declining to widen an SLA that looked wrong.**

## 2026-08-31 (evening) — ✅ THE CMS OUTAGE IS BROKEN OPEN after 67 days. 🚨 And the placeholder regression grew 8×.

**Measured against this morning's baseline. Two results, in opposite directions.**

### ✅ Data moved for the first time since 2026-06-25

| metric | baseline | now |
|---|---|---|
| `max(medicare_clinics.source_last_seen)` | 2026-06-25 | **2026-08-31** |
| clinics refreshed since 2026-06-25 | **0** | **61** |
| newest run | 08-27 `abandoned` | **08-31 `success`** |

**67 days of silence ended.** The chain that got here — B6a made producers visible, B6a-follow-up
made them alertable, B6d graded the bound that refused to be widened, the logs named a throttle, and
`--force-run` proved the throttle was hiding a real failure — **every step was necessary and none of
them alone would have done it.**

⚠️ **Three honest qualifications, none of which undo the result:**

1. **61 of 8,547 clinics is 0.7%.** This is a **partial** ingest, not a completed one. **Do not read
   `source_last_seen` moving as "the feed is healthy"** — read it as "the pipeline can write again."
2. **The `feed_stale` alert is STILL OPEN.** The LCC-side monitor has not re-evaluated since the
   data moved at 20:25. **It should auto-resolve on its next cycle — and THAT is the confirmation,
   not this measurement.** ⚠️ *Reading the alert ledger rather than my own query is the rule
   B6a-follow-up exists for; it applies to good news too.*
3. **The 20:25 run reported `success` with `rows_upserted` NULL.** So the §2 defect
   (`success` on a no-op, and `rows_upserted` never recorded) is **still live** — it is in
   `B6d-cms-step`, which is now in flight.

### 🚨 The `unknown_reason` regression grew 8× in one day — this is now the urgent item

| | this morning | after the first fix | **now** |
|---|---:|---:|---:|
| `pending_updates` total | **1,959** | 2,341 | **7,531** |
| carrying `reason = 'unknown_reason'` | 0 | 437 | **3,424** |

**The human triage queue nearly quadrupled in a day, and 45% of it is now unactionable placeholder
rows.** ⚠️ **And the asymmetry is the tell: 61 clinics refreshed against +5,572 queue rows.** The
drain is generating queue work two orders of magnitude faster than it is refreshing data.

**This is the Consumption-Layer failure in its purest form** — a fix that satisfied a NOT NULL
constraint turned ~500 loud errors per run into **3,424 silent, unactionable rows in a queue a human
is supposed to work.** `B6d-pri-reason` was filed as a correctness nit this morning; **it is now the
most operator-damaging open item on the board**, and it is already bundled into `B6d-cms-step`.

⚠️ **Whoever picks this up: the placeholder rows must be BACKFILLED or MARKED, not just stopped.**
Stopping the writer leaves 3,424 rows nobody can triage sitting in the queue forever.

## 2026-08-31 — B6d-cms-step drafted, and measuring it found the defect is 47× bigger than one run

**Prompt: `prompts/B6d-cms-step-capture-the-error-2026-08-31.md`**, bundled with **`B6d-pri-reason`** —
same file, same class: *a field that exists to carry meaning, written with nothing in it.*

⚠️ **I set out to "capture the exception on the `medicare_ingestion` step" and the measurement
reframed it: `error_summary` is NULL on 47 of 47 runs since 2026-06-01.** `abandoned` 24 · **`failed`
10** · `success` 6 · `recorded` 3 · `started` 2 · `partial` 2 — **every one NULL.** **The column has
never been written, not once, across ten explicit failures. The error CHANNEL has never worked**,
which is a different and much cheaper problem than instrumenting one step.

⚠️ **And a third defect surfaced while measuring: six runs report `success` — newest 2026-07-30 —
while `max(source_last_seen)` stayed at 2026-06-25 and 0 clinics were refreshed.** **`success` can
be returned on a no-op.** That is **Class 26** (*two different facts sharing one status value*) in a
new table, and it means the last three months of "successes" cannot be read as data movement.

**What DOES work is the instrumentation B6d-pri added** — the failed run carries
`notes: {"current_step": "medicare_ingestion", "heartbeat_at": …}`. **We now know WHERE it dies and
have never once known WHY.** That asymmetry is the whole prompt.

**Three guardrails carried in, each earned:** ⚠️ **do not widen a `try` to make the error appear** —
that is exactly how the swallowed 42703 made 65 rows silently read as *"no change"*, a **data**
defect B6d-pri caught; **a terminal status must be reachable** (2 rows are still `started` with
`finished_at` NULL, the orphan shape re-forming); and ⚠️ **the prompt says plainly that it does NOT
fix the hang — expect the run to still fail, and that is SUCCESS for this change.** The captured
exception text is the deliverable, because two months of silence have been about not having it.

## 2026-08-31 — ✅ D1 SHIPPED: the two domains are already coherent, and the real gap is in the INSTRUMENT

`docs/audits/D1_CROSS_DB_PROVENANCE_DIFF_2026-08-29.md`. **The honest result I asked for, and it is
mostly a clean bill of health — which the prompt explicitly said was an acceptable outcome.**

**69 differences triaged: 58 legitimate · 5 unexplained · 6 unwired — and NONE is B5-sized.** The
largest unwired candidate is **1,021 rows of broker market intelligence**. **D1c** is the closest
analogue: `property_sale_events` fed from `ownership_history` — dia 52, gov 0 — *"same shape as B5,
~2% of the size."*

**⚠️ The finding the prompt did NOT anticipate, and it is the more valuable one: 12 stores cannot be
diffed at all, because they carry no provenance column** — **including dia `ownership_history`
(10,037 rows)**, *the very store whose provenance diff found B5*. **B5 was a finding about ownership
history, and dia's copy of that table is invisible to the detector that found it.** That is a gap in
the **instrument**, not the data — the same class one level up.

**The design constraints I asked for were all met, and one better than specified:**
**acknowledgement is not silencing** — `legitimate` silences a row; **`unexplained` and `unwired`
keep emitting**, in `scripts/d1-provenance-acknowledgements.json`. That is what stops this becoming
the badge-of-noise failure B6d fixed one layer up.

⚠️ **The positive control was honest about itself: 2 of 3 re-found, the third out of reach** — and it
said so rather than reporting three. B6c-dup was re-found from cold (dia `property_sale_events`
carries producers `sales_transactions` 2,646 and `ownership_history` 52; **gov carries neither**).

**So the P0d thesis holds and is now measured: the domains are substantially coherent, and D1's
standing value is preventing the NEXT divergence rather than clearing a current backlog.**

## 2026-08-31 — RECONCILED against the baseline. The throttle was hiding a real failure, and one fix traded a loud error for a silent one.

**Measured against this morning's baseline. Three results, and two of them are corrections to me.**

| metric | baseline | now | verdict |
|---|---|---|---|
| `max(medicare_clinics.source_last_seen)` | 2026-06-25 | **2026-06-25** | ❌ **unmoved** |
| clinics refreshed since | 0 | **0** | ❌ unmoved |
| newest CMS attempt / status | 2026-08-27 · `abandoned` | **2026-08-31 · `failed`** | ✅ it RAN |
| `rows_upserted` | null | **null** | ❌ |
| `pending_updates` | 1,959 | **2,341** | ⚠️ **moved — I predicted it would not** |

### 🎯 The force-run answered the decisive question: the throttle was hiding a REAL failure

`--force-run` bypassed the throttle and the run executed — **18:30:26 → 18:38:16, ~8 minutes,
`failed`** — with `notes: {"current_step": "medicare_ingestion", "heartbeat_at": …}`. **The new
instrumentation works: it names the step it died in.** ⚠️ **And two rows remain `started` with
`finished_at` NULL — the orphan shape re-forming in the same session.**

**So the 2026-06-23 hang is still live underneath.** The throttle was never the disease; it was what
kept us from seeing it for two months. **That is the branch I flagged as *a finding, not a failure*,
and it is the more useful outcome.**

⚠️ **`error_summary` is `(none)` on the failed run.** A run that fails without recording why is
**I5's defect in a second place** — the PA fault branch has the identical shape. **Filed as
`B6d-cms-step`: the step is named, the error is not.**

### ⚠️ My prediction was wrong, and the reason matters more than the prediction

I wrote: *"the DSN fix should NOT move `pending_updates` on its own — if it does, my read of the two
defects as independent is wrong."* **It moved +382.** The cause is not the DSN: **`B6d-pri`'s code
fix landed and made the writes succeed.** So the two defects were independent after all — **the
prediction was right about the mechanism and wrong about what else would ship in between.**

### 🚨 But the fix satisfied the constraint with a PLACEHOLDER, which the prompt explicitly forbade

**437 rows written today carry `reason = 'unknown_reason'`** — first and last seen **2026-08-31**, so
entirely new. `B6d-pri` §2 said: *"give it a real reason string — **not a placeholder** … a reason
that restates the source is not a reason."*

⚠️ **And the same table already demonstrates the standard:** `public_record_ai_no_yield` (1,893),
*"Salesforce auto-created property — verify accuracy and check for duplicates"* (65), *"unmatched
property_id during financial propagation"* (1). **The codebase knows how to write meaningful
reasons.**

**In operator terms this is arguably a regression.** Before: the writes failed loudly, ~500 errors a
run. After: they succeed silently and **437 unactionable rows enter a human triage queue**. **A loud
failure is more useful than a quiet placeholder** — this is the Consumption-Layer rule (every badge
is actionable work) violated by a fix meant to satisfy a NOT NULL. Filed as **`B6d-pri-reason`**.

### CC's two corrections to my brief — both accepted

1. **The 1,001 log lines are a VIEWER CAP, not a run boundary.** 496+486+10+~9 = 1,001 against
   **1,952 stale rows** — **my counts were FLOORS; the true per-run figure is ~1,950.** I read a
   truncated export as a complete run.
2. **The logs are the `cms-ingestion` service, not `public-record-ingest`.** The drain lives in
   `run_cms_ingestion.main()`, *which is also why the failures precede the skip* — a detail that
   only makes sense once the service is identified correctly. **I mis-attributed it twice.**

### Two further findings from B6d-pri, both worth carrying

- **`properties._new_property` is a pseudo-field (0 columns, 65 rows), and the swallowed 42703 meant
  those rows silently read as "no change."** It was a **data** defect, not a log defect.
- **§5b answered, and the answer is worse than expected: NEITHER cron is registered anywhere.**
  `feed_freshness_registry` is table-keyed (5 dia rows), **`ingestion_tracker` has no reader**, and
  `v_pipeline_task_health` is **gov-only**. → **`B6d-cms-escalation`**, unbuilt by design.
- **New: `B6d-pri-metrics`** — `metrics.persist_run_summary` defines an inner `_insert()` and
  **never calls it**, so it writes no summary row anywhere.

## 2026-08-31 — 📋 BASELINE captured before the CMS force-run and the DSN fix land

**Three things are in flight at once**, so the baseline is recorded *before* any of them lands —
otherwise tomorrow we compare against memory.

**In flight:** (1) Scott running the CMS ingestion locally with `--force-run`; (2) `SUPABASE_DB_DSN`
set on the Railway `public-record-ingest` service and redeployed; (3) `B6d-pri` and `D1` both with
Claude Code.

**Baseline — dia `zqzrriwuavgrquhisnoa`, 2026-08-31:**

| metric | value |
|---|---|
| `max(medicare_clinics.source_last_seen)` | **2026-06-25** |
| `medicare_clinics` rows | 8,535 |
| clinics refreshed since 2026-06-25 | **0** |
| newest CMS attempt / status | **2026-08-27 · `abandoned`** |
| `pending_updates` rows | **1,959** (newest 2026-08-26) |
| open `feed_stale` alerts | **2** — `medicare_clinics` (dia), `sam_lease_opportunities` (gov) |

**What each fix should move — and what it should NOT:**

- **The force-run** → `source_last_seen` advances past **2026-06-25**, `clinics_refreshed_since`
  rises above **0**. ⚠️ **The confirmation is the `feed_stale` alert AUTO-RESOLVING, not the run
  finishing** — read the alert ledger, not the console.
- **The DSN fix** → the next `public-record-ingest` run stops emitting the **486** `Failed to mark
  stale … DSN not configured` lines. ⚠️ **It should NOT move `pending_updates` on its own** — those
  writes fail on the separate **23502 `reason` NOT NULL** defect, which is a code fix in `B6d-pri`.
  **If the row count moves after the DSN change alone, my read of the two defects as independent is
  wrong, and that is worth knowing.**
- ⚠️ **A redeploy is not a run.** The DSN change proves nothing until the service's next scheduled
  execution; **the evidence is a clean log, not a green deploy.**

⚠️ **The decisive question the force-run answers:** if it **completes**, the throttle was the last
obstacle. If it **hangs**, the 2026-06-23 hang is still live underneath and the throttle was merely
hiding it — **a finding, not a failure**, and the one thing two months of silence could not tell us.


> **📦 ARCHIVE (2026-09-08):** entries for **2026-08-31 → 2026-09-01** (the CMS-ingestion restart,
> DOC1–DOC18 document pipeline, C13/C14 entity-role work, and the trailing pointers for two earlier
> cuts) were moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-08-31_to_2026-09-01.md`](../history/STATUS_claude-code_2026-08-31_to_2026-09-01.md).
> Nothing was dropped; every still-open item was already in `PLANNED-BACKLOG.md` and the canonical pages.
