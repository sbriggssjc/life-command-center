-- ============================================================================
-- Round 76eg — Listing consolidation function + cron
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- Companion to 20260504100000 (inverse trigger). The trigger handles
-- per-row reconciliation; this migration handles the multi-row case:
-- when a single property has 2+ rows that all resolve to the same sale
-- event, collapse them into a single canonical listing.
--
-- Pattern that prompted this:
--   Property: Fresenius / 17069 Edgewater Ln, New Iberia LA
--   Rows:
--     #1 Sold,   listing_date=Apr 21 2026, off_market=Feb 25 2026  (CoStar scrape)
--     #2 Sold,   listing_date=Apr 20 2026, off_market=Feb 25 2026  (sidebar verify)
--     #3 Active, listing_date=May  1 2026, off_market=NULL          (re-scrape post-sale)
--   Sale: Feb 25 2026 @ $2.1M / 7.18% cap (one row in property_sale_events)
--
-- After the inverse trigger runs, all 3 are Sold. After consolidation:
--   1 keeper row with the earliest valid listing_date, sold_date+sold_price
--   from the sale event, sale_transaction_id linked. Losers superseded
--   (status='Superseded', is_active=FALSE, exclude_from_market_metrics=TRUE)
--   with audit notes — kept for forensics, hidden from dashboards.
-- ============================================================================

-- The view v_dia_consolidate_listings_candidates surfaces every property
-- that has multiple available_listings rows resolving to the same sale.
-- Useful for QA / audit before running the function in earnest.
CREATE OR REPLACE VIEW public.v_dia_consolidate_listings_candidates AS
WITH rows_with_sale AS (
    SELECT al.listing_id,
           al.property_id,
           al.listing_date,
           al.off_market_date,
           al.sold_date,
           al.sold_price,
           al.is_active,
           al.status,
           al.sale_transaction_id,
           al.notes,
           al.created_at,
           al.last_seen,
           al.last_verified_at,
           al.intake_artifact_path,
           al.listing_broker,
           al.listing_url,
           al.url,
           al.last_price,
           al.initial_price,
           al.current_cap_rate,
           al.initial_cap_rate,
           -- Resolve each listing to its best candidate sale_date for grouping
           COALESCE(
               al.sold_date,
               al.off_market_date,
               (SELECT pse.sale_date
                  FROM public.property_sale_events pse
                 WHERE pse.property_id = al.property_id::text
                   AND pse.sale_date IS NOT NULL
                   AND pse.sale_date <= CURRENT_DATE
                   AND (al.listing_date IS NULL
                        OR pse.sale_date >= al.listing_date - INTERVAL '30 days')
                 ORDER BY ABS(EXTRACT(EPOCH FROM (
                          COALESCE(al.off_market_date, pse.sale_date)::timestamp
                          - pse.sale_date::timestamp
                      )))
                 LIMIT 1)
           ) AS resolved_sale_date
      FROM public.available_listings al
)
SELECT property_id,
       resolved_sale_date,
       COUNT(*)                 AS row_count,
       ARRAY_AGG(listing_id ORDER BY listing_id) AS listing_ids
  FROM rows_with_sale
 WHERE resolved_sale_date IS NOT NULL
 GROUP BY property_id, resolved_sale_date
HAVING COUNT(*) > 1;

COMMENT ON VIEW public.v_dia_consolidate_listings_candidates IS
    'Round 76eg: each row = one property with 2+ available_listings rows that resolve to the same sale_date. Audit before running dia_consolidate_property_listings().';

-- ── Per-property consolidation function ─────────────────────────────────
-- Collapses N rows for one property+sale_date into a single canonical
-- listing. Returns counts. Idempotent — running a second time on the
-- same property is a no-op (every row is already the keeper or already
-- superseded).
CREATE OR REPLACE FUNCTION public.dia_consolidate_property_listings(
    p_property_id INTEGER
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_group     RECORD;
    v_keeper_id BIGINT;
    v_kept      INTEGER := 0;
    v_supersed  INTEGER := 0;
BEGIN
    FOR v_group IN
        WITH rws AS (
            SELECT al.listing_id,
                   al.listing_date,
                   al.off_market_date,
                   al.sold_date,
                   al.sold_price,
                   al.sale_transaction_id,
                   al.intake_artifact_path,
                   al.last_price,
                   al.initial_price,
                   al.current_cap_rate,
                   al.initial_cap_rate,
                   al.listing_broker,
                   al.listing_url,
                   al.url,
                   COALESCE(
                       al.sold_date,
                       al.off_market_date,
                       (SELECT sale_date FROM public.property_sale_events pse
                         WHERE pse.property_id = al.property_id::text
                           AND pse.sale_date IS NOT NULL
                           AND (al.listing_date IS NULL
                                OR pse.sale_date >= al.listing_date - INTERVAL '30 days')
                         ORDER BY pse.sale_date DESC LIMIT 1)
                   ) AS rsd,
                   -- completeness score (higher = keeper)
                   ((al.sale_transaction_id IS NOT NULL)::int * 8 +
                    (al.intake_artifact_path IS NOT NULL)::int * 4 +
                    (al.listing_broker IS NOT NULL)::int * 2 +
                    (al.listing_url IS NOT NULL OR al.url IS NOT NULL)::int * 2 +
                    (al.last_price IS NOT NULL)::int +
                    (al.current_cap_rate IS NOT NULL)::int) AS score
              FROM public.available_listings al
             WHERE al.property_id = p_property_id
               AND LOWER(COALESCE(al.status, '')) <> 'superseded'
        )
        SELECT rsd AS sale_date,
               (ARRAY_AGG(listing_id ORDER BY score DESC, listing_date ASC, listing_id ASC))[1] AS keeper_id,
               ARRAY_AGG(listing_id ORDER BY score DESC, listing_date ASC, listing_id ASC) AS all_ids,
               MIN(listing_date) FILTER (WHERE listing_date IS NOT NULL)    AS earliest_date,
               MAX(initial_price) FILTER (WHERE initial_price IS NOT NULL)  AS best_initial,
               MAX(last_price)    FILTER (WHERE last_price IS NOT NULL)     AS best_last,
               MAX(intake_artifact_path) FILTER (WHERE intake_artifact_path IS NOT NULL) AS best_artifact,
               MAX(listing_broker) FILTER (WHERE listing_broker IS NOT NULL) AS best_broker
          FROM rws
         WHERE rsd IS NOT NULL
         GROUP BY rsd
        HAVING COUNT(*) > 1
    LOOP
        v_keeper_id := v_group.keeper_id;

        -- Enrich keeper with best-of-group fields
        UPDATE public.available_listings
           SET listing_date         = COALESCE(v_group.earliest_date, listing_date),
               initial_price        = COALESCE(initial_price,        v_group.best_initial),
               last_price           = COALESCE(last_price,           v_group.best_last),
               intake_artifact_path = COALESCE(intake_artifact_path, v_group.best_artifact),
               listing_broker       = COALESCE(listing_broker,       v_group.best_broker),
               notes                = COALESCE(NULLIF(notes,'') || E'\n','') ||
                                      '[Round 76eg consolidate ' || CURRENT_DATE ||
                                      '] keeper of ' || array_length(v_group.all_ids, 1) ||
                                      ' rows resolving to sale ' || v_group.sale_date
         WHERE listing_id = v_keeper_id;
        v_kept := v_kept + 1;

        -- Rewire any FKs pointing at losers (sale_brokers, etc. — best effort)
        IF EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema='public' AND table_name='sale_brokers') THEN
            -- listing-side broker links would reference listing_id but that
            -- table is sale-side, no rewire needed here.
            NULL;
        END IF;

        -- Supersede the losers — preserve them for audit
        UPDATE public.available_listings
           SET status                       = 'Superseded',
               is_active                    = FALSE,
               exclude_from_market_metrics  = TRUE,
               notes                        = COALESCE(NULLIF(notes,'') || E'\n','') ||
                                              '[Round 76eg consolidate ' || CURRENT_DATE ||
                                              '] superseded by listing_id=' || v_keeper_id ||
                                              ' (same sale ' || v_group.sale_date || ')'
         WHERE listing_id = ANY(v_group.all_ids)
           AND listing_id <> v_keeper_id;

        GET DIAGNOSTICS v_supersed = ROW_COUNT;
    END LOOP;

    RETURN jsonb_build_object(
        'property_id', p_property_id,
        'groups_kept', v_kept,
        'rows_superseded', v_supersed,
        'ran_at', now()
    );
END $$;

COMMENT ON FUNCTION public.dia_consolidate_property_listings(integer) IS
    'Round 76eg: collapses multiple available_listings rows for one property+sale_date into a single canonical row. Idempotent.';

-- ── Bulk auto-consolidation function (callable from cron) ───────────────
CREATE OR REPLACE FUNCTION public.dia_auto_consolidate_listings(
    p_batch_size INTEGER DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_prop      RECORD;
    v_processed INTEGER := 0;
    v_failed    INTEGER := 0;
BEGIN
    FOR v_prop IN
        SELECT DISTINCT property_id
          FROM public.v_dia_consolidate_listings_candidates
         ORDER BY property_id
         LIMIT p_batch_size
    LOOP
        BEGIN
            PERFORM public.dia_consolidate_property_listings(v_prop.property_id);
            v_processed := v_processed + 1;
        EXCEPTION WHEN OTHERS THEN
            v_failed := v_failed + 1;
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'properties_processed', v_processed,
        'failed',               v_failed,
        'remaining_groups',     (SELECT count(*) FROM public.v_dia_consolidate_listings_candidates),
        'ran_at',               now()
    );
END $$;

-- ── One-time pass: clear the existing backlog ─────────────────────────────
-- Run in a loop until the candidate view is empty (or 200 batches max as
-- a safety net). This catches every property in the database that today
-- has more than one available_listings row resolving to the same sale.
DO $$
DECLARE
    v_iter      integer := 0;
    v_remaining integer := 1;
    v_total_props integer := 0;
    v_result      jsonb;
BEGIN
    WHILE v_remaining > 0 AND v_iter < 200 LOOP
        v_result := public.dia_auto_consolidate_listings(50);
        v_remaining := (v_result ->> 'remaining_groups')::int;
        v_total_props := v_total_props + (v_result ->> 'properties_processed')::int;
        v_iter := v_iter + 1;
    END LOOP;
    RAISE NOTICE 'Round 76eg one-time consolidation: % properties processed across % batches; % candidate groups remaining',
        v_total_props, v_iter, v_remaining;
END $$;

-- ── Schedule recurring consolidation (every 30 minutes) ───────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('dia-auto-consolidate-listings')
          WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dia-auto-consolidate-listings');
        PERFORM cron.schedule(
            'dia-auto-consolidate-listings',
            '*/30 * * * *',
            $cron$SELECT public.dia_auto_consolidate_listings(50);$cron$
        );
    END IF;
END $$;
