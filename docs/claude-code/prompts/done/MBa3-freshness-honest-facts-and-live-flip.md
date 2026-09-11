# MB-a3 — Freshness-honest on-box facts (CMS feed gate), then live-verify and flip the market-brief ticks

**Repo: `life-command-center`.** Small correctness fix, then the live verification MB-a2 couldn't run. Flags flip
only at §4.

**Read first:** `api/_shared/market-brief-facts.js` (CMS builder ~L250–295) · `api/_handlers/market-brief-psql-tick.js`
· `api/_handlers/market-brief-rss-tick.js` · `docs/architecture/EXEC-BRIEFS-SPEC.md` §1 + §9 (addenda "MB-a reconcile",
"MB-a2 reconcile") · `docs/os/PLANNED-BACKLOG.md` §P18 MB1, MB1b, MB1c, **MB1d** and the **B6d-cms** family (CMS
ingest outage) · `CLAUDE.md` doctrines.

## Why this, why now

MB-a2 fixed the four source defects and applied both migrations. Railway `tranquil-delight` has since been
redeployed at `e42dbcb7` (PR #2307 merge), so both ticks are live behind OFF flags and their crons are active
(07:15 / 10:10 UTC). Cowork's live check on 2026-09-11 (read-only) found one more problem that **would publish a
false-fresh fact the moment the flag flips**:

- `buildCmsOperatorFacts` sets `source_date` = **the tick's run date** and `confidence 0.9`. The census behind it
  is not fresh. For **DaVita and Fresenius, `max(last_seen_date)` = 2026-01-22**; for US Renal Care it's 2025-07-11.
  No clinic has `is_active`/`is_operating = false`, and `last_ingested_at` is NULL. This is the known CMS ingest
  outage (B6d-cms*; the backlog records 87% of clinics beyond the feed's 45-day SLA).
- **DaVita = Fresenius = exactly 2,450** eligible rows, both with 2,450 distinct `medicare_id`s. An exact tie between
  the two largest chains is implausible, and both sit below their publicly reported US footprints (the exemplar
  brief cites DaVita at 2,671 US centers). That's consistent with a capped or partial import.
- The consequence: "DaVita operates 2,450 dialysis clinics", dated today, would render as a current fact. Its net-change
  facts would also read zero forever, because nothing ever changes in a dead feed.

Doctrine violated: *the living brief's staleness comes from the source's own as-of, never the run time* (spec §1).

## 1. Make every on-box fact's `source_date` the source's own as-of

- CMS counts: extend `v_market_brief_cms_operator_counts` (Dialysis_DB, additive migration) with
  `source_as_of = max(last_seen_date)` per operator (or the CMS feed's documented as-of if a better field exists —
  check `cms_last_checked`, `cms_updated_at`, `source_last_seen`, `feed_freshness_registry`; pick one and justify).
  Facts carry that date and `stale_after = source_as_of + TTL`.
- Apply the same rule to the comps band (latest `sale_date` in the window), trades, and on-market (the listing
  refresh date). Add a test that fails if any P-SQL builder sets `source_date` from `asOfIso`/`now()`.
- **Feed gate:** if a source's as-of is older than its feed SLA (CMS: 45 days per `feed_freshness_registry`), don't
  write count facts. Record a named gap (`cms_census_stale_since:<date>`, citing B6d-cms) so XB and the staleness
  view show the section honestly as missing. Net-change facts are suppressed while the feed is stale.

## 2. Settle the 2,450 tie (read-only investigation)

Is 2,450 a real coincidence or an import artifact? Check the CMS ingest code/scripts for a per-chain or page cap,
compare against the source file/API row counts for each chain if reachable, and look at `data_source` /
`created_at` distributions. Report findings. If it's a cap, **file it into the B6d-cms family** (don't fix the
ingester here). Either way §1's gate keeps it out of the brief until the feed is fresh.

## 3. P-RSS readiness

The RSS tick fails closed without `OLLAMA_URL` on Railway. Confirm how the live Analyst's Take reaches Ollama and
whether `tranquil-delight` has `OLLAMA_URL`. If it's missing, name the operator step. Don't route to a cloud model.

## 4. Verify live, then flip

On the deployed service: GET dry-run each tick (`gaps[]` empty or every entry explained, including the new CMS
gap); POST once per tick with the flag forced on for that run; report facts written, superseded and conflicted
per section, `v_market_brief_staleness` for dialysis before and after, the band vs a `query_comps` call for the
same window, and 5 sample facts with their `source_date`s. **Then flip `MARKET_BRIEF_PSQL` on.** Flip
`MARKET_BRIEF_PRSS` only if §3 shows Ollama is reachable. Otherwise leave it off with the named reason.

## Guard + ship

Tests: source-date-from-source rule, feed gate (stale → gap, fresh → facts), net-change suppression, view column
contract. Full suite green. Branch → PR → CI → merge → **redeploy BOTH Railway services** (the standalone MCP still
lacks OC-a's `log_operator_note`/`get_operator_inbox`; this redeploy should carry them too — confirm by listing
its tools).

## Ship + record

Update `PLANNED-BACKLOG.md` §P18 (MB1, MB1d, MB2, OC-v item 1) plus any B6d-cms filing, `STATUS.md`,
`CURRENT-STATE.md` and spec §9. Your reply should include: the source-date fixes per source, the tie
investigation, Ollama readiness, the live dry-run/POST results, staleness before and after, and flag states.
