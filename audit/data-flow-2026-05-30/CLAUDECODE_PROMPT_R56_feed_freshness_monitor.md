# Claude Code — R56: feed-freshness health monitor (so the system tells you when a pipe dies)

## Why (consolidation audit live 2026-06-20 — see AUDIT_consolidation_feed_freshness_2026-06-20.md)
The recurring vulnerability across the whole build arc: a recurring ingestion feed silently goes
stale and is found months later by accident — USAJobs (dead since March, fixed this session), SAM
(expired key, fixed), and **GSA monthly diff (still stalled at 2026-03-01 — R53's suspected-sale
feed is dead)**. The premise is "improving as new info is ingested," but nothing alerts when a feed
STOPS. Build the monitor so the system self-reports.

## House rules
Reuse the existing `lcc_health_alerts` + daily-briefing / `v_cron_health_summary` machinery — don't
fork an alert system. Read-only over the feed tables; additive; idempotent; ≤12 `api/*.js`;
`node --check`/suites green; DB live after a dry-run. Per-domain (gov + dia + LCC feeds).

## Unit 1 — the freshness registry + view
A small config table (or seeded view) `feed_freshness_registry`: one row per monitored ingestion
feed with `feed_name`, `domain`, the table + timestamp column to check
(`max(<ts_col>)`), and an `expected_max_age_days` (the cadence SLA). Seed it with the feeds that
matter, each with a sane SLA:
- gov: `gsa_lease_events` (diff — 35d), `gsa_leases` snapshot (35d), `sales_transactions` (45d),
  `available_listings` (21d), `deed_records` ingest (30d), `loans` (30d), `agency_risk_signals`
  (14d), `opm_agency_location_rollups` (120d), `usajobs_market_signals` (14d),
  `sam_lease_opportunities` (14d), `federal_lease_awards` (14d), `investment_scores` scored (30d).
- dia: `medicare_clinics` (CMS, 35d), `sales_transactions` (45d), `deed_records` (45d), `loans`
  (45d), `clinic_financial_estimates` (45d).
Then `v_feed_freshness` (per domain) computing `latest`, `age_days`, `expected_max_age_days`,
`is_stale` (age > expected). Use the INGEST timestamp where the source is capture-driven
(deed_records.created_at) and the DATA timestamp where it's a real feed (snapshot_date,
sale_date) — the registry row specifies which, so deed-capture cadence isn't falsely flagged.

## Unit 2 — alert wiring
A function `lcc_check_feed_freshness()` (run on the existing hourly/daily health cron — fold into
`lcc-cron-health-check` or a sibling) that opens a `feed_stale` alert in `lcc_health_alerts` for
each feed crossing its SLA (one open alert per feed; idempotent; auto-resolves when the feed
refreshes). Surface in `v_cron_health_summary` + the daily briefing so a stalled feed shows up the
day it crosses the SLA — not months later. Cross-DB: the gov/dia feeds are checked via the existing
domain-read path the health cron already uses (or a small per-domain `v_feed_freshness` the LCC
checker reads); don't build a new cross-DB mechanism if one exists.

## Unit 3 — first run = the current report
On first run it will (correctly) flag the known-stale feeds — **GSA diff (gsa_lease_events,
~110d)** and **OPM (~95d)**. That's the validation: the monitor reproduces what the audit found by
hand. Report the first-run stale list.

## Verify (report back)
`v_feed_freshness` returns a row per registered feed with age vs SLA; `is_stale` correctly flags
gsa_lease_events + opm and NOT the fresh feeds (USAJobs/SAM/loans/agency_risk); a synthetic
stale→fresh round-trip opens then auto-resolves the alert (0 residue); the check is wired to the
health cron + briefing. ≤12 api/*.js; suites green.

## Two operational to-dos this audit surfaced (NOT code — Scott)
1. **Catch up the GSA diff** — run the three `python -m src.gsa_monthly_diff --diff PREV CURR`
   Mar→Jun pairs (R53 Unit 5 runbook) so `gsa_lease_events` is current and R53's lessor-change
   suspected sales start surfacing. Then ensure the diff step runs with each monthly snapshot
   ingest.
2. **Apply R49 v3 to gov** — apply `sql/20260620_gov_r49_investment_scores_v3.sql` + run the v3
   scorer on the live gov DB (it never landed — 0 v3 columns), THEN review the v2-vs-v3 diff via
   `?action=activation_review`, THEN flip `SCORING_MODEL_ACTIVE=v3`.

## Bottom line
The arc fixed "captured but not fed back," but a signal is only as live as its feed — and feeds die
silently. R56 makes the system self-report a stalled feed the day it crosses its cadence SLA
(reusing the existing health-alert + briefing machinery), so the next USAJobs/SAM/GSA stall is
caught automatically instead of months later. Plus two operational catch-ups (GSA diff, R49 v3)
that close the loop on the arc.
