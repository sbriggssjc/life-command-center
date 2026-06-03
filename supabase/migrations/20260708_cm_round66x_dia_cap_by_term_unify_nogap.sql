-- =============================================================================
-- Round 66x (Part 2) — unify the dia cap-rate-by-lease-term cohort definition
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa)
-- Date:    2026-06-03
-- Apply AFTER 20260708_cm_round66x_dia_cap_of_record_tier4_coverage.sql.
--
-- THE ONE DEFINITION (several grains, all consumers return IDENTICAL values for
-- the same period_end):
--   cap of record = sales_transactions.cap_rate_final (implausible nulled),
--                   band 0.04-0.12            -- the single source, per directive
--   term          = firm_term_years_at_sale   -- lease-in-effect-at-sale, frozen
--   buckets (NO 5-6yr GAP):
--        <=5 : t <= 5      6-8 : 5 < t < 8      8-12 : 8 <= t < 12     12+ : t >= 12
--   per-cohort sample gate >= 3 ; centered 9-month smoothing (ROWS -4..+4)
--
-- ROOT CAUSE OF THE CHRONICALLY-LOW 6-8 COHORT: a 5-6yr GAP in the old buckets
-- (<=5 and [6,8) with nothing in between) dropped every deal with 5.1-5.9yr
-- remaining term -- ~16/yr, mostly mid-7% caps -- into NO cohort. Closing it
-- (6-8 := 5 < t < 8) recovers them and lifts 6-8 toward the deck.
--
-- WHY THE THREE SOURCES DISAGREED (now fixed):
--   cm_dialysis_cap_by_term_m       used calculated_cap_rate + GAP buckets
--   cm_dialysis_sold_cap_by_term_dot used cap_rate_final     + GAP buckets
--   master_m cohort cols (export)    used cap_rate_final RAW  + GAP buckets
-- => different cap field AND different smoothing. Now: cm_dialysis_sold_cap_by
-- _term_dot is the CANONICAL series; master_m cohort cols, cap_by_term_m and
-- cap_by_term_q all read it, so they cannot diverge.
--
-- -----------------------------------------------------------------------------
-- ACCEPTANCE EVIDENCE (measured on prod, all values %; deck p.22 = Dec-2025 TTM)
-- -----------------------------------------------------------------------------
-- AFTER (all four consumers IDENTICAL at the shared period_end):
--   period_end   12+    8-12   6-8    <=5     <- deck: 6.89 / 6.84 / 7.28 / 8.29
--   2025-12-31   6.80   6.60   6.88   7.45
--   2019-11-30   6.33   6.60   6.92   6.79
--   2022-08-31   5.42   6.06   6.51   7.09
--   (cap_by_term_q carries only quarter-end rows; 2025-12-31 matches exactly.)
--
-- BEFORE (the three-source divergence this migration removes, Dec-2025):
--   view                              12+    8-12   6-8    <=5
--   cm_dialysis_cap_by_term_m         7.25   6.70   6.87   8.23   (calc, gapped)
--   cm_dialysis_sold_cap_by_term_dot  6.80   6.70   6.81   7.34   (final, gapped)
--   master_m cohort cols (export)    ~7.2x  ~6.7x  ~6.9x  ~7.8x
--
-- DECK MATCH / KNOWN LIMITATION. With the single broker-of-record source the
-- cohort ORDERING matches the deck (8-12 < 12+ < 6-8 < <=5) and 12+ lands on the
-- deck (6.80 vs 6.89, -9 bps), but the SHORT cohorts read below the deck and the
-- fan compresses to ~65 bps (vs the deck's ~140 bps): -24 (8-12), -40 (6-8),
-- -84 (<=5). This is structural, NOT a definition bug: the deck's term premium
-- is a going-in NOI/price phenomenon, while cap_rate_final prefers broker-stated
-- (stabilized) caps that understate short-term going-in yield. The deck's 2019
-- <=5 = 9.46% extreme is not present in our data under ANY field (2019 <=5 n=31,
-- avg calc 7.76 / final 6.84). Fully closing the fan is gated on the SEPARATE
-- Phase-1 rent_at_sale reconciliation (so the noi_derived tier becomes
-- trustworthy enough to promote for short-term deals); see
-- docs/capital-markets/CLAUDE_CODE_PROMPT_dia_data_integrity_MASTER.md Phase 1.
-- =============================================================================

-- (1) CANONICAL series: close the 5-6 gap in the dot view (cap field/term/gate/
--     smoothing already correct after R66j). Surgical edit of the live def so the
--     regex-free body is preserved byte-for-byte except the 6-8 bucket edge.
DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.cm_dialysis_sold_cap_by_term_dot'::regclass, true);
  v := replace(v,
    'c.firm_term_years >= 6::numeric AND c.firm_term_years < 8::numeric',
    'c.firm_term_years > 5::numeric AND c.firm_term_years < 8::numeric');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_dialysis_sold_cap_by_term_dot AS ' || v;
END $$;

-- (2) master_m: source the 4 deck cohort columns from the canonical dot view so
--     the export (cap_12plus_year .. cap_5orless_year) == the chart. Legacy
--     cap_10plus_year / cap_6to10_year / cap_less5_year / cap_outside_firm are
--     left as-is (not part of the deck 4-cohort chart). Targeted string surgery
--     keeps the (regex-heavy) body intact except the 4 outputs + one added join.
--     Guarded so re-running does not append a duplicate join.
DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.cm_dialysis_market_quarterly_master_m'::regclass, true);
  v := replace(v, 'ta.cap_12plus_year,',  'dct.cap_12plus AS cap_12plus_year,');
  v := replace(v, 'ta.cap_8to12_year,',   'dct.cap_8to12 AS cap_8to12_year,');
  v := replace(v, 'ta.cap_6to8_year,',    'dct.cap_6to8 AS cap_6to8_year,');
  v := replace(v, 'ta.cap_5orless_year,', 'dct.cap_5orless AS cap_5orless_year,');
  IF position('cm_dialysis_sold_cap_by_term_dot dct' IN v) = 0 THEN
    v := replace(v,
      'LEFT JOIN cm_dialysis_loan_constant_m lc ON lc.period_end = m.period_end',
      'LEFT JOIN cm_dialysis_loan_constant_m lc ON lc.period_end = m.period_end
       LEFT JOIN cm_dialysis_sold_cap_by_term_dot dct ON dct.period_end = m.period_end AND dct.subspecialty = ''all''::text');
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_dialysis_market_quarterly_master_m AS ' || v;
END $$;

-- (3) cap_by_term_m: 4 deck cohorts now = master_m cohort cols (= canonical dot).
--     Legacy passthrough columns preserved. Column contract unchanged (11 cols).
CREATE OR REPLACE VIEW public.cm_dialysis_cap_by_term_m AS
 SELECT mm.period_end,
    mm.subspecialty,
    mm.cap_10plus_year  AS cap_10plus,
    mm.cap_6to10_year   AS cap_6to10,
    mm.cap_6to10_year   AS cap_5to10,
    mm.cap_less5_year   AS cap_less5,
    mm.cap_outside_firm,
    mm.cap_12plus_year  AS cap_12plus,
    mm.cap_8to12_year   AS cap_8to12,
    mm.cap_6to8_year    AS cap_6to8,
    mm.cap_5orless_year AS cap_5orless
   FROM cm_dialysis_market_quarterly_master_m mm
  ORDER BY mm.period_end;

-- (4) cap_by_term_q: 4 deck cohorts read the canonical dot at quarter-ends (so
--     _q == _m at shared period_ends). Legacy 10+/6-10/<5/outside computed on the
--     single cap_rate_final source (was an inconsistent COALESCE). Contract = 10 cols.
CREATE OR REPLACE VIEW public.cm_dialysis_cap_by_term_q AS
 WITH cs AS (
   SELECT s.sale_date,
     (date_trunc('quarter', s.sale_date::timestamptz) + '3 mons -1 days'::interval)::date AS sale_q,
     CASE WHEN s.cap_rate_quality = 'implausible_unverified' THEN NULL::numeric ELSE s.cap_rate_final END AS cap,
     s.firm_term_years_at_sale AS t
   FROM sales_transactions s
   WHERE s.sale_date IS NOT NULL AND s.sold_price > 0 AND NOT COALESCE(s.exclude_from_market_metrics, false)
     AND (s.transaction_type IS NULL OR s.transaction_type = ANY (ARRAY['Investment','Resale']))
     AND s.sale_date <= cm_last_completed_quarter_end()
 ), qa AS ( SELECT DISTINCT sale_q AS period_end FROM cs ),
 legacy AS (
   SELECT q.period_end,
     avg(c.cap) FILTER (WHERE c.t >= 10 AND c.cap BETWEEN 0.04 AND 0.12)::numeric(8,5) AS cap_10plus,
     avg(c.cap) FILTER (WHERE c.t >= 6 AND c.t < 10 AND c.cap BETWEEN 0.04 AND 0.12)::numeric(8,5) AS cap_6to10,
     avg(c.cap) FILTER (WHERE c.t IS NOT NULL AND c.t < 5 AND c.cap BETWEEN 0.04 AND 0.12)::numeric(8,5) AS cap_less5,
     avg(c.cap) FILTER (WHERE c.t IS NULL OR c.t <= 0)::numeric(8,5) AS cap_outside_firm
   FROM qa q LEFT JOIN cs c ON c.sale_date > (q.period_end - '1 year'::interval)::date AND c.sale_date <= q.period_end
   GROUP BY q.period_end
 )
 SELECT l.period_end,
    'all'::text AS subspecialty,
    l.cap_10plus,
    l.cap_6to10,
    l.cap_less5,
    l.cap_outside_firm,
    dct.cap_12plus::numeric(8,5)  AS cap_12plus,
    dct.cap_8to12::numeric(8,5)   AS cap_8to12,
    dct.cap_6to8::numeric(8,5)    AS cap_6to8,
    dct.cap_5orless::numeric(8,5) AS cap_5orless
   FROM legacy l
   LEFT JOIN cm_dialysis_sold_cap_by_term_dot dct ON dct.period_end = l.period_end AND dct.subspecialty = 'all'
  ORDER BY l.period_end;

-- (5) asking_cap_by_term_m (active-listing ASKING caps; different universe/field)
--     gets the same no-gap bucket edge for consistency.
DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.cm_dialysis_asking_cap_by_term_m'::regclass, true);
  v := replace(v,
    'b.term >= 6::numeric AND b.term < 8::numeric',
    'b.term > 5::numeric AND b.term < 8::numeric');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_dialysis_asking_cap_by_term_m AS ' || v;
END $$;
