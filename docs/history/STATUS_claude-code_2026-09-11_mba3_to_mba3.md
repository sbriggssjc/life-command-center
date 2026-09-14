# STATUS archive — 2026-09-11 (MB-a3 reconciled → B1b graded → MB-a3 freshness-honest)

> Moved **verbatim** out of `docs/claude-code/STATUS.md` on 2026-09-12 (sixth span) to stay under
> the 2,500-line budget, archived BEFORE pushing per that file's convention block. Nothing was
> reworded or dropped; every still-open item these entries name is tracked in
> `docs/os/PLANNED-BACKLOG.md`.

## 2026-09-11 — MB-a3 reconciled (PR #2313 merged): deployed + dry-run verified by Cowork; MB1e found; MB-b drafted

Filed `responses/MB-a3 desktop response.docx` → `done/`; prompt → `prompts/done/`. MB-a3 fixed `source_date` (source
as-of, never run time; justified exceptions for on-market count and zero-trades), added the CMS 45-day feed gate,
confirmed the DaVita = Fresenius = 2,450 tie is a single import batch (17 s apart; B6d-cms, Dialysis repo), declined to
flip because its sandbox saw a pre-fix build. **Cowork (read-only):** `/version` via pg_net = `78082f46` (the MB-a3 merge),
so the fix is live. GET dry-runs via pg_net with the vault key: **P-SQL `gaps:[]`**, 17 candidates — TTM band median
7.00% IQR 5.69–8.03% n=169; 211 on-market, 6.00% median ask; 8 `cms_census_gap:*` facts, no stale counts. **P-RSS:
Ollama reachable** (6 articles, 0 model failures), 0 facts (no dialysis content). New **MB1e**: operator-band
fragmentation (`Fresenius` vs `Fresenius Medical Care`, `DaVita` vs `DaVita Dialysis`), windowless/daily-keyed trades
zero-fact, no dialysis feed. Removed the duplicate 🔴 MB1d row the merge left behind. Spec design rule 4 (canonical fact
identity). **MBa-hold can lift — Scott's call** (flip SQL in OPERATOR-ACTIONS). OC-v still half done: standalone MCP not
redeployed (still 21 tools), 0 notes, no triage flag row. **Next:** `prompts/MBb-lane-briefs-daily-block-and-tab.md`.

## 2026-09-11 -- B1b graded: developer-chain floor NOT lifted (only 1.4% resolvable)

Picked up B1b as the next recommended step after OWN-T0j closed out. B1's own audit had
deliberately left `trace_ownership_to_developer`'s 983 below-floor skips (gov 514, dia 469) ungated,
pending grading its consumer (cron 145 / `developer-chain-resolve-tick`) the way A2 was graded for
`establish_ownership_history`.

Confirmed cron 145 is active (`cron.job`, every 6h, gov-only, limit=50) and its handler
(`api/_handlers/developer-chain-resolve.js`) is a mature, already-fully-automated, correctly
auth-gated consumer with two auto-write tiers (`bts_origin` conf 0.85, `developer_keyword` conf
0.7). But `lcc_chain_lane_has_auto_consumer()` is **hardcoded** to `gov + establish_ownership_history`
only -- it was never updated to recognize this lane, so `lcc_b1_reopen_below_floor()` is gated off
for it (`gov_has_consumer=false`, `dia_has_consumer=false`, confirmed live via
`pg_get_functiondef`).

Replicated the handler's exact classifier (`classifyDeveloperOrigin` -- read in full from source,
faithfully ported the bank/REIT/financier/agency/junk-shape/placeholder/dev-keyword/dev-brand
regexes into SQL) against the live 514 gov below-floor properties, joined to
`v_developer_chain_candidate` (0 missing from the view). Result: **only 7/514 (1.4%) would
auto-resolve** -- all 7 via Tier A `bts_origin`, zero via Tier B `developer_keyword`. The rest: 465
`ambiguous_generic_org`/`origin_is_person`, 36 `origin_equals_current`, 6 `no_chain`. dia's 469 have
no automated consumer at all -- the handler hard-returns a no-op for any domain other than `gov`.

This is a real, load-bearing contrast with A2's 89% automation rate for the other lane -- it
confirms B1a's "expect COVERAGE, not depth" caution was correct, and gives a live number behind it.
**Recommendation: do not lift the floor for this lane.** Reopening all 514 would mostly just refill
the queue with tasks cron 145 will immediately not-resolve (`origin_is_person`/`ambiguous_generic_org`
stay queued, retried every 7 days, forever). The 7 `bts_origin` resolves are few enough to hand-verify
and write directly if wanted, without reopening the other 507.

Also corrected a stale note found along the way: B1b's row said "Do B5 first" -- B5
(`docs/audits/B5_GOV_SELLER_EXIT_FEEDER_2026-08-28.md`) already shipped 2026-08-28. This grading ran
against B5's already-updated `gov.ownership_history`, so the prerequisite is satisfied; the note was
just never removed. Fixed in the same edit.

`PLANNED-BACKLOG.md` B1b row rewritten with the full grading result and marked closed
(graded · declined -- deliberately not automating this lane further, not a build left undone).

## 2026-09-11 -- MB-a3: freshness-honest on-box facts (CMS feed gate) -- flags withheld pending redeploy

Closed MB1d (`market-brief-facts.js`/`market-brief-psql-tick.js`): every P-SQL-derived fact's
`source_date` now comes from the SOURCE's own as-of, not the tick's run date. CMS operator counts
gate per-operator on `max(last_seen_date)` vs a 45-day SLA (mirrors dia `feed_freshness_registry`);
a stale operator (DaVita and Fresenius both measured live at max(last_seen_date)=2026-01-22, ~8
months stale, while their `cms_last_checked`/`source_last_seen` touch columns read days-old --
exactly the B6d-cms nightly-reupsert trap one column over) writes a named `cms_census_gap:<op>`
fact instead of a confident count. Cap-rate bands and the trades-since-last-run fact now date off
the newest comp `sale_date`, not `asOfIso`. Migration applied to Dialysis_DB (appended
`source_as_of` to `v_market_brief_cms_operator_counts`). 15 new tests, full suite 5,925/0/6-skipped.

Investigated the DaVita=Fresenius=2,450 tie (read-only): both operators' live rows share an
identical `created_at` batch window ending 2026-01-22 (max timestamps 17s apart) -- strong evidence
of a shared import-cap/pagination artifact in the last real CMS ingest before the outage, not
coincidence. Filed to the Dialysis repo's B6d-cms backlog; not fixed here (cross-repo, out of scope).

Verified live via `net.http_get` from LCC Opps: `tranquil-delight` `/version` still reads
`fc863b43d48f` -- this fix is committed, not deployed. **Deliberately did NOT flip
`MARKET_BRIEF_PSQL`/`MARKET_BRIEF_PRSS`** -- both are DB-controlled (`feature_flags_registry.state`,
via the env-OR-registry resolver), so flipping now would activate the OLD pre-fix code the moment it
next runs, re-shipping the exact staleness bug this unit closes. Flip only after a post-merge
Railway redeploy is confirmed (`/version` + `merge-base --is-ancestor`). P-RSS's `OLLAMA_URL`
reachability from `tranquil-delight` could not be confirmed from this session (no Railway env
access) -- named as an operator-verification item, not assumed either way.

See `docs/os/PLANNED-BACKLOG.md` §P18 row MB1d and `docs/architecture/EXEC-BRIEFS-SPEC.md` §9
"MB-a3" addendum for full detail.
