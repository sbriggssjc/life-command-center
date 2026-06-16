# Audit — metric consistency / single-source-of-truth (live 2026-06-16)

**Question (Scott):** different LCC views show conflicting counts for the "same" thing
(properties on-market, sold last-12-months, Capital Markets chart figures). Find the source
of the inconsistencies and address each at the source — one unified, connected data flow.

## Verdict: the same metric is computed by 3+ independent paths with DIFFERENT filters
There is no shared "metric layer." Each surface re-derives on-market / sold-TTM from the
base tables with its own window + filter set. Quantified live, the SAME metric differs by
2–20×:

### "Sold in last 12 months" (transactions) — three answers
| path | gov | dia | filters |
|---|---|---|---|
| **Briefing RPC** `lcc_briefing_market_stats` (live) — drives Today "Market Intelligence" / daily briefing | **61** ($871M) | **161** ($687M) | rolling 365d, `>$100k`, exclude `is_northmarq`, exclude `exclude_from_market_metrics`, cap 2–20% |
| **Overview MV** `mv_gov_overview_stats` (materialized) — domain dashboards | **126** ($1.70B) | **201** ($857M) | trailing 12mo, `>$0`, **no** NM/flag exclusion, cap 1–25% |
| **CM aggregator** `capital_markets_agg.py` → `capital_markets_quarterly` (snapshot) — Capital Markets export/report | **~1,300** | **253** | calendar-quarter + TTM rollup, **no filters at all** (counts price-less rows) |

### "On market" (active listings) — three answers (gov)
| path | gov | filters |
|---|---|---|
| Briefing RPC | **854** | `is_active`, exclude NM |
| Authoritative view `v_available_listings` | **628** | `is_active` + `exclude_from_listing_metrics` + 60-day sale-overlap exclusion |
| raw `is_active` | **868** | none |
(dia on-market = 812 `is_active` only — see schema-drift below.)

## The root drivers (each an "address at the source" item)
1. **`exclude_from_market_metrics` honored by only ONE of three consumers.** Briefing
   respects it; Overview MV and CM ignore it. **63 gov + 82 dia** large sales are flagged —
   the dominant TTM swing (gov 61→126 = +$831M of flagged sales reappearing).
2. **CM aggregator counts price-less rows as transactions** — gov ~1,300 "transactions"
   vs 126 priced (≈1,174 null/$0-price rows: lease comps, placeholders). The published CM
   transaction_count is inflated ~10×. (Clear bug.)
3. **Price floor inconsistent** — briefing `>$100k`, overview `>$0`, CM none.
4. **Date window inconsistent** — rolling 365 days (briefing) vs trailing 12-month interval
   (overview) vs calendar-quarter + 4-quarter TTM rollup (CM). Causes the day-to-day jitter
   (63→67→63 on the Today tile) AND structural mismatch with the CM report.
5. **Cap-rate range inconsistent** — 2–20% (briefing) vs 1–25% (overview) vs none (CM) —
   makes "avg cap rate" differ across surfaces.
6. **`is_northmarq` exclusion inconsistent** — briefing excludes NM; overview + CM include.
   (0 NM in the gov window today, so not the current driver — but a latent divergence.)
7. **Three storage modes / refresh cadences** — live RPC vs materialized MV (refresh cron)
   vs snapshot table (aggregator run). Even with identical filters these drift in time.
8. **Schema drift between domains** — gov `available_listings` has
   `exclude_from_listing_metrics` / `is_northmarq` / `transaction_state`; dia
   `available_listings` has only `is_active` / `sold_price`. So on-market can't even be
   defined identically across dia/gov without column parity.

## The fix shape — one canonical metric layer, but the definition is a BUSINESS choice
The engineering fix is clear: **one canonical per-domain metric source (a small set of
views/RPCs with agreed filters) that EVERY surface reads** — briefing, overview MV, domain
dashboards, Today, and the CM export — instead of each re-deriving. But "one number"
requires deciding WHAT it includes (NM? flagged? price floor? window?). That's Scott's call
and it's the gate for the whole fix.

### Two hard constraints
- **The Capital Markets report is a PUBLISHED client deliverable.** Aligning CM to the
  canonical definition WILL change published figures (incl. fixing the price-less-row count
  bug). Per standing rule, no published CM number changes without Scott's explicit sign-off
  after seeing exact before/after. So: align the INTERNAL surfaces now; stage the CM
  alignment behind sign-off with a before/after diff.
- Canonical definition must be **domain-aware** (dia lacks gov's listing flags) — so the
  shared layer abstracts per-domain column availability, or dia gets the missing flag
  columns first (schema parity).

## Recommended canonical doctrine (for Scott to ratify)
- **One "market sale" definition** used everywhere: priced (`sold_price > $100k` floor),
  arm's-length (`exclude_from_market_metrics = false`), real cap rate (single agreed range,
  e.g. 1–25%), with **Northmarq deals shown as a labeled separate cut** (not silently
  mixed). Price-less rows NEVER counted as transactions.
- **One window convention**: trailing-12-months for all "TTM" surfaces; CM keeps its
  calendar-quarter buckets for the report but its TTM rollup uses the SAME inclusion filters.
- **One source per metric**: a canonical `v_market_metrics` (or RPC) per domain that the
  briefing RPC, overview MV, dashboards, and CM aggregator all consume — so a definition
  change happens in exactly one place.

## Decision needed before building → see the question to Scott
The inclusion rule (strict-curated vs inclusive vs dual labeled metric) determines the
canonical numbers and which surfaces change. Captured next; the fix prompt(s) follow the
ratified definition, with the CM piece gated on before/after sign-off.
