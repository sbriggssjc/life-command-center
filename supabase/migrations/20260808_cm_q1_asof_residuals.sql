-- ============================================================================
-- Q1 as-of regeneration — two residuals from acceptance (2026-08-08)
-- Target DB: Dialysis_DB (dia, ref zqzrriwuavgrquhisnoa)
--
-- Residual #1B — annual buyer-pool YTD clamp needs a period_end-keyed quarterly
--   buyer-share view to roll up in JS. gov already ships cm_gov_buyer_share_q;
--   dia never had a quarterly sibling (only the year-rolled cm_dialysis_buyer_
--   share_y), so the exporter had no per-quarter source to sum <= as_of. Create
--   cm_dialysis_buyer_share_q as the dia mirror of cm_gov_buyer_share_q. The dia
--   quarterly base carries no cross-border columns, so cross_border_* = 0
--   (matches cm_dialysis_buyer_share_y, which also hard-codes 0).
--
-- Residual #2 — quartile / snapshot cohort reconciliation. For period_end =
--   2026-03-31 the report's On-Market Snapshot sheet (cm_dialysis_on_market_
--   snapshot_q) and the Active Cap Quartiles sheet (cm_dialysis_asking_cap_
--   quartiles_active_m) disagreed:
--     snapshot   total UQ 7.29 / LQ 6.04   core UQ 6.46 / LQ 5.56
--     quartiles  total UQ 7.74 / LQ 6.00   core UQ 6.76 / LQ 5.84
--   Root cause (diffed live, NOT the disclosed-cap / undisclosed-term / status
--   filters — those are identical): the POOLING WINDOW. The snapshot is a
--   SINGLE-quarter point-in-time cohort; the _m quartile view pooled a trailing
--   24-month window (both total and core) and the _q view pooled a trailing
--   8-month window for its core cohort. Same active listings, different sample
--   set → different quartiles.
--
--   Alignment (per acceptance: "snapshot's disclosed-cap active set is the
--   report's historical basis"): rewrite BOTH quartile views to compute total
--   AND core quartiles from the SINGLE period_end active-listing cohort — the
--   exact set the snapshot uses (active at period_end, disclosed cap in
--   [0.04, 0.12]; core = that set AND is_core_10plus). No trailing pool. Because
--   a month-end and its enclosing quarter-end share the same period_end DATE,
--   the single-period cohort at 2026-03-31 is identical across _m / _q / snapshot,
--   so all three now report 7.29 / 6.04 (total) and 6.46 / 5.56 (core).
--
--   Single-period samples are healthy (n_total 56-311, n_core 18-105 across the
--   history), so dropping the pool does not gap the line. Gate: n_total >= 4 /
--   n_core >= 4 (thin periods → NULL, same convention as before). The prior
--   uqc <= uqt sanity clamp is dropped to match the snapshot's raw percentile
--   (the snapshot applies no such guard); at every sampled period core <= total
--   naturally.
--
-- Discipline: CREATE OR REPLACE VIEW keeps identical column names/order/count
-- (append-only rule). Reversible — the prior view bodies are in
-- 20260605_cm_round68a_task3_core10_pooled_quartiles.sql (_q core 8-month pool)
-- and 20260629_cm_r2a_dia_cap_views_desmooth_term_floor.sql (_m 24-month pool);
-- re-run those to restore. Idempotent.
-- ============================================================================

-- ── Residual #1B — dia quarterly buyer-share view ──────────────────────────
CREATE OR REPLACE VIEW public.cm_dialysis_buyer_share_q AS
SELECT
  period_end,
  subspecialty,
  private_volume,
  reit_volume,
  0::numeric               AS cross_border_volume,
  institutional_volume,
  private_count,
  reit_count,
  0::bigint                AS cross_border_count,
  institutional_count,
  COALESCE(private_volume, 0::numeric)
    + COALESCE(reit_volume, 0::numeric)
    + COALESCE(institutional_volume, 0::numeric) AS total_volume
FROM cm_dialysis_market_quarterly;

GRANT SELECT ON public.cm_dialysis_buyer_share_q TO anon, authenticated, service_role;

-- ── Residual #2 — single-period cohort quartiles (align to the snapshot) ────

CREATE OR REPLACE VIEW public.cm_dialysis_asking_cap_quartiles_active_m AS
WITH per_period AS (
  SELECT
    period_end,
    count(*) FILTER (WHERE last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS n_total,
    count(*) FILTER (WHERE is_core_10plus AND last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS n_core,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY (last_cap_rate::double precision))
      FILTER (WHERE last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS uqt,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY (last_cap_rate::double precision))
      FILTER (WHERE last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS lqt,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY (last_cap_rate::double precision))
      FILTER (WHERE is_core_10plus AND last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS uqc,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY (last_cap_rate::double precision))
      FILTER (WHERE is_core_10plus AND last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS lqc
  FROM cm_dialysis_active_listings_m
  GROUP BY period_end
)
SELECT
  period_end,
  'all'::text AS subspecialty,
  CASE WHEN n_total >= 4 THEN uqt ELSE NULL::double precision END AS upper_q_total,
  CASE WHEN n_total >= 4 THEN lqt ELSE NULL::double precision END AS lower_q_total,
  CASE WHEN n_core  >= 4 THEN uqc ELSE NULL::double precision END AS upper_q_core,
  CASE WHEN n_core  >= 4 THEN lqc ELSE NULL::double precision END AS lower_q_core
FROM per_period
ORDER BY period_end;

CREATE OR REPLACE VIEW public.cm_dialysis_asking_cap_quartiles_active_q AS
WITH per_period AS (
  SELECT
    period_end,
    count(*) FILTER (WHERE last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS n_total,
    count(*) FILTER (WHERE is_core_10plus AND last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS n_core,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY (last_cap_rate::double precision))
      FILTER (WHERE last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS uqt,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY (last_cap_rate::double precision))
      FILTER (WHERE last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS lqt,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY (last_cap_rate::double precision))
      FILTER (WHERE is_core_10plus AND last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS uqc,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY (last_cap_rate::double precision))
      FILTER (WHERE is_core_10plus AND last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS lqc
  FROM cm_dialysis_active_listings_q
  WHERE subspecialty = 'all'
  GROUP BY period_end
)
SELECT
  period_end,
  'all'::text AS subspecialty,
  CASE WHEN n_total >= 4 THEN uqt ELSE NULL::double precision END AS upper_q_total,
  CASE WHEN n_total >= 4 THEN lqt ELSE NULL::double precision END AS lower_q_total,
  CASE WHEN n_core  >= 4 THEN uqc ELSE NULL::double precision END AS upper_q_core,
  CASE WHEN n_core  >= 4 THEN lqc ELSE NULL::double precision END AS lower_q_core
FROM per_period
ORDER BY period_end;

-- ── Document the aligned cohort in the view registry ───────────────────────
UPDATE cm_view_registry
SET notes = 'Listing quartile series — SINGLE-period active cohort at each '
         || 'period_end (active listings, disclosed cap in [0.04,0.12]; core = '
         || 'that set AND is_core_10plus). Identical cohort to '
         || 'cm_dialysis_on_market_snapshot_q — the report''s historical basis. '
         || 'No trailing pool (aligned 2026-08-08, Q1 as-of residual #2).'
WHERE view_name = 'cm_dialysis_asking_cap_quartiles_active_m';

UPDATE cm_view_registry
SET notes = 'Listing quartile series (quarterly sibling) — SINGLE-quarter active '
         || 'cohort at each period_end (active listings, disclosed cap in '
         || '[0.04,0.12]; core = that set AND is_core_10plus). Identical cohort '
         || 'to cm_dialysis_on_market_snapshot_q — the report''s historical '
         || 'basis. No trailing pool (aligned 2026-08-08, Q1 as-of residual #2).'
WHERE view_name = 'cm_dialysis_asking_cap_quartiles_active_q';
