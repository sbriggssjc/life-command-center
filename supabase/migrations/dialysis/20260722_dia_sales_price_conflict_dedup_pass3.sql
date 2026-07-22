-- ============================================================================
-- 20260722_dia_sales_price_conflict_dedup_pass3.sql
-- Dia — sales_dedup_tick: Pass 3 = same (property_id, sale_date) PRICE-conflict
--                          collapse to a quality-chosen survivor.
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL, zqzrriwuavgrquhisnoa)
--
-- Problem (grounded live 2026-07-22): ~125 (property_id, sale_date) groups
-- (~144 extra rows) among LIVE sales carry the SAME property on the SAME date
-- with MULTIPLE DIFFERENT sold_prices (e.g. property 25379 / 2017-12-28 -> 5
-- rows $2.48M-$3.75M; property 23632 / 2017-02-07 -> $4.47M-$8.61M), from mixed
-- sources (costar_sidebar / master_xlsx_backfill / historical_csv_import /
-- null-source legacy CSV). A single dialysis property sold on one date is ONE
-- transaction; the differing prices are conflicting RECORDS of that one sale
-- (source disagreement), not separate deals. They skew cap-rate charts and force
-- the comps de-dup (rpc_query_comps -> mcp/comps-tools.js dedupe) to pick a
-- surviving price arbitrarily.
--
-- Why the existing tick did NOT collapse them: Pass 1 keys on dedup_natural_key
-- = (property | price rounded $1k | YYYY-MM), so a DIFFERENT price -> a DIFFERENT
-- key -> the conflict reads as distinct sales. Pass 2 (cross-month proximity)
-- requires price within $1k, so it also misses them (every one of the 125 groups
-- differs by > $1k).
--
-- Pass 3 (this migration) collapses these price-conflicts to the highest-quality
-- record. Losers move OUT of the live lane (transaction_state='duplicate_superseded',
-- dedup_group_id=survivor) -- NEVER hard-deleted -- and every demotion is logged
-- to a reversible ledger. Same function signature; idempotent (2nd run = 0);
-- Pass 1 & Pass 2 unchanged.
--
-- SURVIVOR RULE (per group, ascending = better):
--   1. quality_rank  -- validated/curated cap-rate quality first; implausible LAST
--   2. source_rank   -- trusted data_source order (deed/county > excel/master_xlsx
--                       > sjc > historical_csv > costar_export > costar_sidebar
--                       > rca > null)
--   3. conf_rank     -- cap_rate_confidence high > medium > low > suspect > null
--   4. updated_at    -- most recent
--   5. sale_id       -- deterministic final tiebreaker
-- Quality DOMINATES source: an implausible_unverified row NEVER wins on source
-- alone (verified live: master_xlsx rows flagged implausible are demoted under a
-- non-implausible broker_stated/noi_derived row).
--
-- CONSERVATIVE GUARD (surface, do not merge when ambiguous): a group is EXCLUDED
-- from auto-collapse when it shows a same-day ownership CHAIN / circular pattern
-- -- i.e. one row's normalized buyer == another row's normalized seller
-- (A->B, B->C same-day double-close / flip, or a B->A circular disagreement).
-- Since property_id is constant there is no multi-parcel/portfolio case; the real
-- ambiguous class is the same-day flip, where each transfer is a REAL distinct
-- sale. Those 14 groups stay LIVE and are surfaced in v_sales_price_conflict_review
-- for human judgment -- never auto-collapsed.
--
-- exclude_from_market_metrics semantics are KEPT INTACT: Pass 3 never writes that
-- column and never uses it in survivor selection. NOTE (surfaced, not acted on):
-- in 49 groups the chosen quality survivor is exclude_from_market_metrics=true
-- while a lower-quality loser was included, so those property-dates drop out of
-- market metrics after collapse. v_sales_price_conflict_dedup_plan.survivor_excluded
-- + the doc surface this for a separate curated exclude-flag review.
--
-- Reverse a Pass-3 demotion:
--   UPDATE public.sales_transactions s
--      SET transaction_state='live', dedup_group_id=NULL, updated_at=now()
--     FROM public.sales_price_conflict_dedup_log l
--    WHERE s.sale_id=l.loser_sale_id AND s.transaction_state='duplicate_superseded';
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Reversible demotion ledger (append-only; one row per demoted loser)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_price_conflict_dedup_log (
  loser_sale_id     integer PRIMARY KEY,
  survivor_sale_id  integer NOT NULL,
  property_id       integer,
  sale_date         date,
  loser_price       numeric,
  survivor_price    numeric,
  reason            text NOT NULL DEFAULT 'same_date_price_conflict',
  first_demoted_at  timestamptz NOT NULL DEFAULT now(),
  last_demoted_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.sales_price_conflict_dedup_log IS
  'Reversible audit of sales_dedup_tick Pass 3 demotions: same (property_id, sale_date) price-conflict losers moved to duplicate_superseded. Reverse by setting the logged loser_sale_ids back to transaction_state=live.';

-- ----------------------------------------------------------------------------
-- 2. Base ranked view over all LIVE same-(property,date) price-conflict rows
--    (single source of truth for the plan + review views AND the tick).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_sales_price_conflict_ranked AS
WITH base AS (
  SELECT s.sale_id, s.property_id, s.sale_date, s.sold_price, s.data_source,
         s.cap_rate_quality, s.cap_rate_source, s.cap_rate_confidence, s.updated_at,
         s.exclude_from_market_metrics, s.buyer_name, s.seller_name,
         lower(regexp_replace(coalesce(s.buyer_name,''),  '[^a-z0-9]', '', 'g')) AS bkey,
         lower(regexp_replace(coalesce(s.seller_name,''), '[^a-z0-9]', '', 'g')) AS skey
  FROM public.sales_transactions s
  WHERE s.transaction_state = 'live'
    AND s.property_id IS NOT NULL
    AND s.sale_date IS NOT NULL
    AND s.sold_price IS NOT NULL AND s.sold_price > 0
    AND coalesce(s.data_source,'') NOT LIKE 'ownership_change_stub%'
),
grp AS (  -- conflict groups: same (property, date) with > 1 DISTINCT price
  SELECT property_id, sale_date
  FROM base
  GROUP BY property_id, sale_date
  HAVING count(DISTINCT sold_price) > 1
),
gr AS (
  SELECT b.* FROM base b JOIN grp g USING (property_id, sale_date)
),
chain AS (  -- ambiguous: cross-row buyer == seller (same-day flip / chain / circular)
  SELECT DISTINCT a.property_id, a.sale_date
  FROM gr a JOIN gr b USING (property_id, sale_date)
  WHERE a.sale_id <> b.sale_id AND length(a.bkey) >= 4 AND a.bkey = b.skey
)
SELECT
  gr.sale_id, gr.property_id, gr.sale_date, gr.sold_price, gr.data_source,
  gr.cap_rate_quality, gr.cap_rate_source, gr.cap_rate_confidence, gr.updated_at,
  gr.exclude_from_market_metrics, gr.buyer_name, gr.seller_name,
  ((gr.property_id, gr.sale_date) IN (SELECT property_id, sale_date FROM chain)) AS is_chain,
  CASE
    WHEN coalesce(gr.cap_rate_quality,'') ~ 'implausible' THEN 4
    WHEN gr.cap_rate_source = 'master_curated'
      OR coalesce(gr.cap_rate_quality,'') IN
         ('validated','cmbs_audited','om_actual','om_confirmed','deed_verified','confirmed','lease_confirmed') THEN 1
    WHEN gr.cap_rate_quality IS NOT NULL THEN 2
    ELSE 3
  END AS quality_rank,
  CASE
    WHEN gr.data_source LIKE 'county_deed:%'             THEN 1
    WHEN gr.data_source = 'excel_master'
      OR gr.data_source LIKE 'master_xlsx_backfill%'     THEN 2
    WHEN gr.data_source = 'sjc_track_record_v2'          THEN 3
    WHEN gr.data_source = 'historical_csv_import'        THEN 4
    WHEN gr.data_source = 'costar_export'                THEN 5
    WHEN gr.data_source = 'costar_sidebar'               THEN 6
    WHEN gr.data_source LIKE 'rca_sidebar%'              THEN 7
    WHEN gr.data_source IS NULL                          THEN 8
    ELSE 10
  END AS source_rank,
  CASE gr.cap_rate_confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2
       WHEN 'low' THEN 3 WHEN 'suspect' THEN 4 ELSE 5 END AS conf_rank
FROM gr;
COMMENT ON VIEW public.v_sales_price_conflict_ranked IS
  'All LIVE rows in same-(property_id, sale_date) price-conflict groups, with the survivor rank ladder (quality_rank, source_rank, conf_rank) + is_chain ambiguity flag. Source of truth for v_sales_price_conflict_dedup_plan / _review and sales_dedup_tick Pass 3.';

-- ----------------------------------------------------------------------------
-- 3. Dry-run / plan view (collapsible groups only): survivor + losers per group.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_sales_price_conflict_dedup_plan AS
WITH ranked AS (
  SELECT r.*,
    row_number()          OVER w AS rn,
    first_value(r.sale_id)    OVER w AS survivor_sale_id,
    first_value(r.sold_price) OVER w AS survivor_price,
    bool_or(r.exclude_from_market_metrics IS DISTINCT FROM true)
      OVER (PARTITION BY r.property_id, r.sale_date) AS group_has_included_row
  FROM public.v_sales_price_conflict_ranked r
  WHERE NOT r.is_chain
  WINDOW w AS (PARTITION BY r.property_id, r.sale_date
               ORDER BY r.quality_rank, r.source_rank, r.conf_rank,
                        r.updated_at DESC NULLS LAST, r.sale_id)
)
SELECT
  property_id, sale_date, sale_id, sold_price, data_source,
  cap_rate_quality, cap_rate_source, cap_rate_confidence, exclude_from_market_metrics,
  quality_rank, source_rank, conf_rank, updated_at,
  rn, survivor_sale_id, survivor_price,
  CASE WHEN rn = 1 THEN 'survivor' ELSE 'loser' END AS role,
  'same_date_price_conflict'::text AS reason,
  -- metric-participation surface (kept intact; NOT acted on): survivor is excluded
  -- while an included loser existed -> this property-date leaves market metrics.
  (rn = 1 AND exclude_from_market_metrics IS true AND group_has_included_row) AS survivor_excluded_metric_drop
FROM ranked;
COMMENT ON VIEW public.v_sales_price_conflict_dedup_plan IS
  'DRY-RUN + tick source of truth: per-row plan for collapsible (non-chain) same-date price-conflict groups. role=survivor|loser; survivor_excluded_metric_drop flags groups whose quality survivor is exclude_from_market_metrics=true while an included loser existed (surface for a separate exclude-flag review).';

-- ----------------------------------------------------------------------------
-- 4. Review view: ambiguous (same-day chain / circular) groups -- left LIVE.
--    Auto-retiring: a group drops off once a human collapses it or the chain
--    resolves.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_sales_price_conflict_review AS
SELECT
  property_id, sale_date, sale_id, sold_price, data_source,
  buyer_name, seller_name, cap_rate_quality, cap_rate_source, exclude_from_market_metrics,
  'possible_same_day_ownership_chain'::text AS review_reason
FROM public.v_sales_price_conflict_ranked
WHERE is_chain
ORDER BY property_id, sale_date, sold_price;
COMMENT ON VIEW public.v_sales_price_conflict_review IS
  'Same-(property,date) price-conflict groups showing a same-day ownership CHAIN / circular buyer<->seller pattern (a genuine same-day flip = real distinct transfers). NOT auto-collapsed by sales_dedup_tick Pass 3 -- surfaced here for human judgment.';

-- ----------------------------------------------------------------------------
-- 5. Extend sales_dedup_tick() with Pass 3. Pass 1 & Pass 2 unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_dedup_tick()
 RETURNS TABLE(groups_seen bigint, rows_quarantined bigint, run_at timestamp with time zone)
 LANGUAGE plpgsql AS $function$
DECLARE v_groups BIGINT := 0; v_rows BIGINT := 0; v_rows2 BIGINT := 0; v_rows3 BIGINT := 0;
BEGIN
  -- Pass 1: exact natural-key (property | price rounded $1k | YYYY-MM) dupes.
  WITH ranked AS (
    SELECT sale_id, dedup_natural_key,
      CASE
        WHEN data_source LIKE 'county_deed:%' THEN 1 WHEN data_source = 'excel_master' THEN 2
        WHEN data_source = 'sjc_track_record_v2' THEN 3 WHEN data_source = 'historical_csv_import' THEN 4
        WHEN data_source = 'costar_export' THEN 5 WHEN data_source = 'costar_sidebar' THEN 6
        WHEN data_source = 'rca_sidebar_manual_bootstrap' THEN 7 WHEN data_source IS NULL THEN 8
        WHEN data_source LIKE 'ownership_change_stub%' THEN 9 ELSE 10 END AS prio
    FROM public.sales_transactions
    WHERE transaction_state = 'live' AND dedup_natural_key IS NOT NULL
      AND COALESCE(data_source,'') NOT LIKE 'ownership_change_stub%'
  ),
  groups AS (SELECT dedup_natural_key FROM ranked GROUP BY dedup_natural_key HAVING COUNT(*) > 1),
  group_rows AS (
    SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.dedup_natural_key ORDER BY r.prio ASC, r.sale_id ASC) AS rn,
           FIRST_VALUE(r.sale_id) OVER (PARTITION BY r.dedup_natural_key ORDER BY r.prio ASC, r.sale_id ASC) AS survivor_sale_id
    FROM ranked r WHERE r.dedup_natural_key IN (SELECT dedup_natural_key FROM groups)
  ),
  losers AS (SELECT sale_id, survivor_sale_id FROM group_rows WHERE rn > 1),
  patched AS (
    UPDATE public.sales_transactions s SET transaction_state='duplicate_superseded', dedup_group_id=losers.survivor_sale_id, updated_at=now()
      FROM losers WHERE s.sale_id = losers.sale_id AND s.transaction_state='live' RETURNING s.sale_id
  )
  SELECT (SELECT COUNT(*) FROM groups), (SELECT COUNT(*) FROM patched) INTO v_groups, v_rows;

  -- Pass 2: cross-month proximity dupes (same property, price within $1k, within 60 days).
  WITH live AS (
    SELECT sale_id, property_id, sold_price, sale_date,
      CASE
        WHEN data_source LIKE 'county_deed:%' THEN 1 WHEN data_source = 'excel_master' THEN 2
        WHEN data_source = 'sjc_track_record_v2' THEN 3 WHEN data_source = 'historical_csv_import' THEN 4
        WHEN data_source = 'costar_export' THEN 5 WHEN data_source = 'costar_sidebar' THEN 6
        WHEN data_source = 'rca_sidebar_manual_bootstrap' THEN 7 WHEN data_source IS NULL THEN 8 ELSE 10 END AS prio
    FROM public.sales_transactions
    WHERE transaction_state='live' AND sold_price > 0
      AND COALESCE(data_source,'') NOT LIKE 'ownership_change_stub%'
  ),
  losers2 AS (
    SELECT b.sale_id AS loser_id, (array_agg(a.sale_id ORDER BY a.prio, a.sale_id))[1] AS survivor_id
    FROM live b JOIN live a
      ON a.property_id=b.property_id AND a.sale_id<>b.sale_id
     AND abs(a.sold_price-b.sold_price) <= 1000 AND abs(a.sale_date-b.sale_date) <= 60
     AND (a.prio < b.prio OR (a.prio = b.prio AND a.sale_id < b.sale_id))
    GROUP BY b.sale_id
  ),
  patched2 AS (
    UPDATE public.sales_transactions s SET transaction_state='duplicate_superseded', dedup_group_id=losers2.survivor_id, updated_at=now()
      FROM losers2 WHERE s.sale_id = losers2.loser_id AND s.transaction_state='live' RETURNING s.sale_id
  )
  SELECT COUNT(*) FROM patched2 INTO v_rows2;

  -- Pass 3: same (property_id, sale_date) PRICE-conflict collapse to quality survivor.
  --         Reads the plan view (which recomputes over the post-Pass1/2 live set),
  --         demotes losers, and records each demotion in the reversible ledger.
  --         Chain/ambiguous groups are excluded by the plan view (left live).
  WITH losers3 AS (
    SELECT sale_id AS loser_id, survivor_sale_id, property_id, sale_date,
           sold_price AS loser_price, survivor_price
    FROM public.v_sales_price_conflict_dedup_plan
    WHERE role = 'loser'
  ),
  patched3 AS (
    UPDATE public.sales_transactions s
       SET transaction_state='duplicate_superseded', dedup_group_id=l.survivor_sale_id, updated_at=now()
      FROM losers3 l
     WHERE s.sale_id = l.loser_id AND s.transaction_state='live'
    RETURNING s.sale_id, l.survivor_sale_id, l.property_id, l.sale_date, l.loser_price, l.survivor_price
  ),
  logged3 AS (
    INSERT INTO public.sales_price_conflict_dedup_log
      (loser_sale_id, survivor_sale_id, property_id, sale_date, loser_price, survivor_price, reason, last_demoted_at)
    SELECT sale_id, survivor_sale_id, property_id, sale_date, loser_price, survivor_price,
           'same_date_price_conflict', now()
    FROM patched3
    ON CONFLICT (loser_sale_id) DO UPDATE
      SET survivor_sale_id = EXCLUDED.survivor_sale_id,
          survivor_price   = EXCLUDED.survivor_price,
          last_demoted_at  = now()
    RETURNING loser_sale_id
  )
  SELECT COUNT(*) FROM logged3 INTO v_rows3;

  RETURN QUERY SELECT v_groups, v_rows + v_rows2 + v_rows3, now();
END;
$function$;

COMMENT ON FUNCTION public.sales_dedup_tick IS
  'B1 continuous-propagation dedup worker (cron lcc-dia-sales-dedup-tick, */15). Pass 1 exact natural-key dupes; Pass 2 cross-month proximity dupes (+-$1k / +-60d); Pass 3 same (property_id, sale_date) PRICE-conflicts collapsed to a quality-chosen survivor (chain/circular groups excluded -> v_sales_price_conflict_review; demotions logged to sales_price_conflict_dedup_log). Idempotent; losers never hard-deleted.';

-- ----------------------------------------------------------------------------
-- 6. Grants (inspectable; mirror sibling dia analytics views).
-- ----------------------------------------------------------------------------
GRANT SELECT ON public.v_sales_price_conflict_ranked     TO anon, authenticated, service_role;
GRANT SELECT ON public.v_sales_price_conflict_dedup_plan TO anon, authenticated, service_role;
GRANT SELECT ON public.v_sales_price_conflict_review     TO anon, authenticated, service_role;
GRANT SELECT ON public.sales_price_conflict_dedup_log    TO anon, authenticated, service_role;
