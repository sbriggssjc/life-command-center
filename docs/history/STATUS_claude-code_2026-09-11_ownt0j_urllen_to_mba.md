# STATUS archive — Claude Code queue, 2026-09-11 (OWN-T0j URL-length → MB-a reconcile)

Moved **verbatim** out of `docs/claude-code/STATUS.md` on 2026-09-12 to bring that file back under its line
budget (`test/status-line-budget.test.mjs`, 2,500 lines) after a merge from `main` pushed it to 2,503.
Nothing was reworded, summarised or dropped — this is a contiguous span lifted whole. Every still-open item
named below is tracked in `docs/os/PLANNED-BACKLOG.md`, which remains the canonical open-work list; read that
first and treat this file as the narrative record of how those rows came to exist.

Covers 5 entries, from *2026-09-11 -- OWN-T0j: URL-length fix confirmed live, then a SECOND bug found -- POST always 401'd* to *2026-09-11 — MB-a reconciled (PR #2301 merged): live check finds 4 source defects; MB-a2 fix prompt drafted*.

---

## 2026-09-11 -- OWN-T0j: URL-length fix confirmed live, then a SECOND bug found -- POST always 401'd

Confirmed the previous fix (fix/ownt0j-true-owners-url-length) deployed: Railway /version now reads e42dbcb7,
an ancestor check confirms the fix commit is included, and curling the live GET route returns 200 with the
exact classification counts independently verified earlier (5,133/2,462/482/1,980).

Tried to trigger the real POST immediately rather than waiting ~30 min for the next cron fire -- called
`select public.lcc_cron_post('/api/ownt0j-sponsor-classify-tick', '{}'::jsonb, 'railway')` directly (the exact
call the cron makes, with the real X-LCC-Key pulled from Supabase Vault). It came back 401
`{"error":"unauthorized"}` -- with the correct key. That is not how an auth check should ever behave, so this
was investigated rather than shrugged off as a fluke.

**Root cause, in the same handler as the last fix**: `authenticate(req, res)` (api/_shared/auth.js) is async
and returns a user object, or null having already sent its own 401 -- the contract every other handler in this
repo follows (`const user = await authenticate(req, res); if (!user) return;`, per that file's own header
comment). OWN-T0j's tick instead called `authenticate(req)` with one argument and no `await`, then checked
`auth.ok` -- a property that does not exist on the real return shape, and would not exist even if awaited
correctly (authenticate() returns a user object or null, never {ok, status, error}). The unawaited Promise's
`.ok` is always undefined, so the POST path 401'd unconditionally, key or no key.

**Fixed** (branch `fix/ownt0j-auth-call-convention`): rewrote the auth check to the real calling convention.
node --check clean; the 11 existing classifier tests (pure functions, untouched) still pass.

**Why two bugs shipped in one handler**: both are HTTP/auth-layer mistakes in the one part of OWN-T0j that
had no test coverage -- the 11 shipped tests are all against the pure classifier functions
(api/_shared/ownt0j-sponsor-classifier.js), and nothing exercises api/_handlers/ownt0j-sponsor-classify-tick.js
itself end-to-end. Worth a look for a follow-up: a lightweight handler-level test (mocked domainQuery/opsQuery)
would have caught both.

**Docs**: PLANNED-BACKLOG.md OWN-T0j row appended again.

**Next step.** Get this fix merged and deployed, then re-trigger via lcc_cron_post (or wait for the next
`39 */4 * * *` fire) and confirm the cache table actually populates -- that's still the one thing not yet
verified end-to-end.

## 2026-09-11 — MB-a2: P-SQL source defects fixed against the live schema + both migrations applied; flags still OFF, live tick unverified

Fixed all four MB1c defects (verified live via Supabase MCP, not guessed). Cap-rate band + trades-since-
last-run now call the comps engine's own `rpc/rpc_query_comps` RPC (the same one `query_comps` uses)
instead of a raw `sales_transactions` select missing `operator_name/address/city/state`; cap value reads
`reliableCompCap()` (the engine's displayed rent÷price basis via `displayedCompCap()` imported from
`mcp/comps-tools.js`, falling back to the RPC's own `coalesce(cap_rate_final, cap_rate)`) — measured live:
RPC returns 200 TTM rows (175 dialysis_db + 25 salesforce, 98+21 with a cap) vs the raw table's 94
market-eligible, a proper superset. `v_dia_on_market` now reads `current_cap_rate`. CMS operator counts
now read a new server-side view `v_market_brief_cms_operator_counts` (migration
`dialysis/20260911190000_dia_mba2_cms_operator_counts_view.sql`, **APPLIED to Dialysis_DB**,
`sum(clinic_count)=6695` confirmed against the full 6,695-row population). Every paged read carries a
`truncationGap()` tripwire. Migration `20260911180000_lcc_mba_market_brief_producers.sql` is now
**APPLIED to LCC Opps** (`fact_key` + partial unique index present; both flags `off`; both crons scheduled,
no collision checked against live `cron.job`). Guard: `test/mba2-market-brief-psql-source-fixes.test.mjs`
(12 tests, mutation-verified). Full repo suite: 5,913 pass / 0 fail / 6 skipped. MB2 (P-RSS) swept for the
same defect class and found clean (ops-side JSON, no domain-DB row limits). **⚠️ NOT verified: a live tick
call** — this session has Supabase DB access but no Railway/API reach, so the code is committed and the
DB is applied, but `/api/market-brief-psql-tick` has not been redeployed to or exercised, and the flags
stay `off`. **Operator next step:** merge the PR, redeploy both Railway services, `GET
/api/market-brief-psql-tick?lane=dialysis` and confirm `gaps[]` is empty, one flag-forced `POST`, compare
against a direct `query_comps` call for the same window, flip both flags.
## 2026-09-11 -- OWN-T0j reviewed: classification logic verified correct, but the deployed route 502s -- found and fixed a real bug

Scott: "the OWN-T0j prompt is done and the response is saved... review and update all documentation and plans
accordingly." Reviewed by independently reproducing the numbers, not by re-reading the response.

**Classification logic verified correct, byte-for-byte.** Ran the identical classification directly against
both live Supabase projects (not through the app): 5,133 comparable / 2,462 disagree / 482 sponsor_family_confirmed
(19.6%) / 1,980 unclassified_rival (80.4%) -- matches the shipped PLANNED-BACKLOG claim exactly. The Boyd
Watterson positive control also holds live.

**But the deployed route is broken -- curled it directly and got a 502.** `GET /api/ownt0j-sponsor-classify-tick`
on the live Railway deploy (confirmed current: `/version` matches this session's git HEAD) returns
`{"error":"gov true_owners fetch failed at chunk 0"}`. Root cause: the true_owners fetch batches up to 1,000
UUID ids into a single PostgREST `in.(...)` filter -- roughly 39KB of query string, which Railway's edge
rejects. The properties fetch just above it uses the identical shape but with short numeric ids (~8KB for
1,000), which is why only this one fetch failed -- and why the shipped 11-test suite (pure classifier functions
only) could not have caught it; nothing in that suite exercises an HTTP fetch.

**Fixed** (branch `fix/ownt0j-true-owners-url-length`): scan `true_owners` unfiltered, paged by limit/offset
like the transitions fetch already does, and keep only the needed ids via a client-side Set lookup -- no
`in.()` filter, no URL-length ceiling regardless of population size (16,274 total true_owners today).
`node --check` clean; the 11 existing classifier tests (they test pure functions, untouched by this fix)
still pass.

**The cache table remains empty in production** -- this fix hasn't shipped yet. Once it's merged and Railway
redeploys, the next `lcc-ownt0j-sponsor-classify-refresh` cron fire should populate it for real; that's the
thing to re-check next, not the classification math (already independently confirmed correct).

**Docs**: `PLANNED-BACKLOG.md` `OWN-T0j` row appended with the verification + bug fix. Did not touch the
`OWN-T0a`/`OWN-T0e`/`AC11` rows from the prior entry -- nothing here changes those findings.

**Next step.** Get this fix branch pushed and merged, confirm the Railway redeploy, then re-check the cache
table and the reporting view actually populate on the next cron fire.

## 2026-09-11 — PRI5 response reviewed: both real root causes found and fixed (not "undetermined" again), the orphaned-row gap resolved with live before/after, `census_demographics`'s months-old bug finally identified — held pending `Dialysis` PR #7408 merge confirmation

`PRI5`'s response (`"PR15 surface response.docx"`, saved by Scott) read in full and transcribed to
`docs/claude-code/responses/done/PRI5-orphaned-tracker-row-on-start-run-failure-and-census-demographics.response.md`.
A strong round — this is the first time `census_demographics` got an actual root cause instead of
"confirmed vulnerable, cause undetermined."

**(a) The orphaned `ingestion_tracker` row — fixed with live proof.** `start_run()` returns `None` on
exhausted retries but is never checked by its caller — the pipeline just proceeds, and nothing ever
revisits the row it tried to create. Confirmed this session's own flagged row
(`c817274e…`) is exactly this mechanism. **Found a second, distinct orphan class unprompted**:
`ingestion_lock`'s own acquire call can leave a second row type orphaned the same way — 6 total orphans
existed, not the 5 this session's own live count caught (which only checked one source). Fixed with a
new `reclaim_stale_started_runs()` — deliberately not a lock, only touches rows past a 2-hour safety
window so an in-flight run's own row is never touched — with a real rejected alternative explained (why
reusing `acquire_ingestion_lock` for the outer row would create a lock collision with the inner sub-step).
**Live before/after applied**: 2 of 6 orphans (past the safety window) closed immediately; the other 4,
including this session's own flagged row, correctly left alone since they're still within the window.

**(b) `census_demographics` — actual root cause found.** `_fetch_acs_data()` is a bare, unguarded HTTP
call to `api.census.gov` (unrelated to this arc's Supabase connection-instability story) with no retry
and no auth (`CENSUS_API_KEY` never configured, so every call hits Census's more rate-limited
unauthenticated tier). The tell: `oig_leie_ingestor`'s equivalent fetch already has this exact guard
pattern — `census_demographics_ingestor.py`'s own comment claims it was fixed "alongside" LEIE in an
earlier round, but only the upsert-loop hardening was copied, never the fetch guard. **Confirmed against
live data**: 3 snapshot rows from April/May/June 2026 show the identical months-old orphan pattern. Fixed
to mirror LEIE's guard exactly. **Bonus fix found while wiring this in**: the step-loop's own success/
failure check would have silently treated a clean `{"error": ...}` return as success — generalized the
check to every step so this and `oig_leie_exclusions` (same latent gap) report honestly. Recommended
(not required) setting `CENSUS_API_KEY` in Railway as a config action to reduce recurrence.

**(c) The "benign all-zeros" conclusion — actually re-checked, not re-asserted.** Traced which modules
populate the summary counter machinery — neither `run_cms_ingestion.py` nor
`census_demographics_ingestor.py` appears in that list, so structurally `census_demographics` cannot be
the cause either way. Confirmed live for this specific run: `facility_patient_counts` (the sub-step that
does feed the counter) had zero new rows this date, matching the repo's documented near-annual CMS
publish cadence — an expected no-op, not a defect.

Tests: 7 new, full adjacent surface 285/286 passing (1 pre-existing, unrelated failure disclosed
explicitly, reproduces on unmodified `main`).

**PR `sbriggssjc/Dialysis#7408` was actually opened this round** (a step further than `PRI3`/`PRI4`,
which only referenced a tracking PR number) — **merge status still unconfirmed**, same open item as every
round. Asked Scott to confirm directly.

`PLANNED-BACKLOG.md`'s `PRI5` row updated to 🟡. Prompt moved to `docs/claude-code/prompts/done/`.
Response docx pending archive to `responses/done/` on Scott's machine.

## 2026-09-11 — MB-a reconciled (PR #2301 merged): live check finds 4 source defects; MB-a2 fix prompt drafted

Processed `responses/MB-a desktop response.docx` → `done/` (CC had already filed the prompt). MB-a built MB1 (P-SQL)
+ MB2 (P-RSS, Ollama-only, verbatim-number check), 74 tests, 5,890/0, filed MB1a (`cortex_market_intel` writer) and
MB1b (CMS closures are net-count only). **Cowork live check (read-only):** migration `20260911180000` **not applied**;
0 `producer_runs`. Against Dialysis_DB: `sales_transactions` has no `operator_name/address/city/state` (→ 400);
raw `cap_rate` on 37 TTM rows vs `cap_rate_final` on 106 with 66 excluded rows (→ band must come from the shared comps
engine); `v_dia_on_market` has `current_cap_rate` not `cap_rate` (→ 400); `medicare_clinics` read capped at 1,000 of
6,695 (→ **silent** undercount). New backlog row **MB1c**; two design rules added to spec §9 (comps-engine parity for
every cap-rate fact; SQL aggregation + truncation tripwire + column contracts). OPERATOR-ACTIONS **MBa-hold**: do not
flip MB flags. **OC-v unchanged** (0 notes, no triage flag row, MCP not redeployed). **Next:** send
`prompts/MBa2-psql-source-fixes-and-live-verify.md`; redeploy both Railway services after it merges (ships OC-a too).

> **📦 ARCHIVE (2026-09-12, third span):** the **OWN-T0j → BUY0 Phase 0** run of 2026-09-11 entries
> (gov sponsor/rival split; the `ownership_linker` non-crash and `PRI5`; MB-a market-brief producers;
> OC-a operator funnel; PRI4 deploy; OWN-T0a re-investigation; BUY0 Geller sourcing) was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-11_ownt0j_to_buy0.md`](../history/STATUS_claude-code_2026-09-11_ownt0j_to_buy0.md)
> for the same line-budget reason as the two spans below. Nothing was dropped; every still-open item it named
> is tracked in `PLANNED-BACKLOG.md`.


> **📦 ARCHIVE (2026-09-12):** entries for **2026-08-29 → 2026-09-11** (the B6d/B6e CI-and-producer-
> health arc tail, the PRI2–PRI5 ingestion-hang investigation, BROKER1, the P18/BUY0 design opens, the
> AC-series contact/address work, and a long ID-series/C13-C14 run) were moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-08-29_to_2026-09-11.md`](../history/STATUS_claude-code_2026-08-29_to_2026-09-11.md).
> Nothing was dropped; every still-open item was already in `PLANNED-BACKLOG.md` and the canonical pages.
>
> **📦 ARCHIVE (2026-09-12, second span):** a further **PRI4 → BROKER1** run of 2026-09-11 entries
> (preflight/tracker/timeout defects; EB1 Executive Briefs foundation; AC2/AC3 bench-ranking flip;
> BROKER1 prospect assignment) sat ABOVE this pointer — STATUS.md is not strictly date-sorted — and
> was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-11_pri4_to_broker1.md`](../history/STATUS_claude-code_2026-09-11_pri4_to_broker1.md)
> to bring the file back under its line budget (`test/status-line-budget.test.mjs`). Nothing was
> dropped; every still-open item named in that span was already tracked in `PLANNED-BACKLOG.md`.

---
