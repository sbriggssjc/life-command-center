# MB-a — Market brief producers, dialysis lane first: on-box facts (P-SQL) + daily news facts (P-RSS)

**Repo: `life-command-center`.** Producers only — **no rendering, no email, no UI, no cloud-model calls.**
Ticks ship flag-gated; flip after §5 live verification.

**Read first:** `docs/architecture/EXEC-BRIEFS-SPEC.md` (§1 living brief, §2 producers, §3 cadence/TTLs, §9
measured state + addendum) · `docs/architecture/market_brief_payload_contract.md` · `docs/os/PLANNED-BACKLOG.md`
§P18 (MB1, MB2, EB1b) · migration `20260911165100_lcc_eb1_exec_briefs_foundation.sql` (facts/producer_runs/
staleness views — **live**, 16 seeded dialysis facts) · exemplar `docs/briefs/exemplars/2026-09-11-dialysis-market-brief.md`
· `api/_handlers/operator-triage-tick.js` + `briefing-analyst-take-tick.js` (tick + run-log + on-box Ollama
patterns) · `supabase/functions/briefing-intel-snapshot/index.ts` (RSS) · comps engine docs
(`AI-SURFACES-OPERATIONAL-REFERENCE.md`) · `CLAUDE.md` doctrines · `.github/AI_INSTRUCTIONS.md`.

## Why this, why now

Scott wants the dialysis brief's quality **recalled daily by brokers and kept current as data and news arrive —
built into the system, not a stale Cowork task.** The substrate is live (EB1a). Two of the three producers need no
cloud model, so they ship now; P-WEB waits on **EB1b** (Anthropic credit exhausted). Today the only live dialysis
facts are the 16 seeded from a one-off research pass; `v_market_brief_staleness` shows 15 of 20 cells missing.

## 1. Measure first (read-only)

- Which on-box sources can answer each dialysis section of the exemplar: comps engine (`query_comps`
  views/RPCs), Dialysis_DB `available_listings`/`v_dia_on_market`, sales/trades tables, CMS facility tables
  (clinic counts by operator, openings/closures over time — **can we reproduce "Fresenius exited ~100 U.S.
  clinics" from our own CMS data?**), `cortex_market_intel` (922 rows live, email-parsed alerts with
  tenant/cap_rate/price — filter to dialysis tenants; **find and document its writer**, which is outside the repo).
- For each candidate fact: freshness of the source (last write), row counts, and whether it is (a) structured.
- RSS: per-feed item yield for healthcare over the last 14 `briefing_intel_snapshot` rows; propose 2–4
  additional dialysis/kidney-care feeds (public, stable) and verify each returns items.

## 2. P-SQL producer (MB1) — dialysis

A tick (`producer='p_sql'`, lane `dialysis`), flag `MARKET_BRIEF_PSQL`, nightly + callable on ingest. Emits
deterministic facts into `market_brief_facts` per the contract — at minimum: our trailing-12-month dialysis
cap-rate band (median/IQR, n, by operator where n suffices) from the comps engine; trades since last run;
on-market count + median ask cap; CMS clinic counts by top operators and net change vs prior period. `origin
'onbox_sql'`, `fact_kind 'derived'` or `'reported'`, `source_url` = an internal citation (view/RPC + as-of),
TTL per spec §3. **Supersede, never duplicate:** same (lane, section, fact_key) → new row supersedes old
(add a stable `fact_key` column if the migration lacks one — additive migration). Small-n → do not emit
(render "Not on file" later), never interpolate. Where our number conflicts with a seeded web fact, mark
`status 'conflict'` on both; don't pick.

## 3. P-RSS producer (MB2) — healthcare stream → dialysis facts

A tick (`producer='p_rss'`), flag `MARKET_BRIEF_PRSS`, daily after the snapshot (10:00 UTC). Reads the snapshot's
`sector_news.healthcare` (+ new feeds from §1 if added to the edge fn — separate small change, same PR ok), and
uses **on-box Ollama only** to (1) keep/discard for dialysis relevance, (2) extract at most N candidate facts per
article as short claims, each carrying the article URL/title/date. Deterministic post-checks: every number in a
claim must appear verbatim in the article text/snippet; else drop. `origin 'rss'`, `fact_kind 'reported'`,
TTL 7 days. Ollama down → `producer_runs.status='skipped'` with reason, no facts.

## 4. What NOT to do

No `briefing-email-handler.js` changes; no homepage tab; no Anthropic/web-search calls (EB1b); no gov/NL lanes
yet — but structure the fact builders per lane so MB-b can add them by config; no writes to domain DBs.

## Guard + ship

Tests: fact builders (fixtures), supersede chain, small-n suppression, conflict marking, RSS number-verbatim
check, Ollama-down skip. Full suite green. Branch `feat/mba-market-brief-producers-dialysis` → PR → CI → merge.
`api/` touched → redeploy BOTH Railway services. Register flag rows in `feature_flags_registry` (**insert them**
— OC-a found its flag was never registered) and the pg_cron jobs, both OFF/disabled until §5.

## 5. Verify live, then flip

Run each tick once manually with the flag on for that run. Report: facts written/superseded/conflicted per
section, `v_market_brief_staleness` before/after for the dialysis lane, and 5 sample facts with citations. Then
flip both flags on and enable the cron jobs.

## Ship + record

`PLANNED-BACKLOG.md` §P18 (MB1/MB2 states + measurements; new rows for gaps found, e.g. the `cortex_market_intel`
writer, CMS closure derivation), `STATUS.md` newest first, `CURRENT-STATE.md` for what is live, spec §9 addendum.
Reply with: §1 source table, facts per section, staleness before/after, samples, and anything contradicting the spec.
