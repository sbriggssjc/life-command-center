-- ============================================================================
-- GATED — DO NOT APPLY until the 5 gate-sheet decisions are signed off.
-- Target: gov  (scknotsqkcheojiaewwh)  public.available_listings
-- Collapses live simultaneous-active duplicates to one active row per property,
-- closes the unambiguous close-on-sale gaps, repairs phantom over-stamps, and
-- withdraws stale opens. Idempotent (queries live state), reversible (every
-- change logged), NEVER hard-deletes.
--
-- HOW TO RUN AT THE GATE:
--   1. Run the whole file as-is (it ends in ROLLBACK) and read the VERIFY output.
--   2. Inspect the G1/G2 preview SELECTs and the final verification counts.
--   3. When satisfied, change the final `ROLLBACK;` to `COMMIT;` and re-run.
--   4. Then run gov_writer_guards.sql (index CONCURRENTLY runs outside a txn).
-- ============================================================================
BEGIN;

-- 0. Provenance / reversal log + review queue --------------------------------
CREATE TABLE IF NOT EXISTS public.listing_lifecycle_backfill_log (
  id bigserial PRIMARY KEY,
  batch text NOT NULL, step text NOT NULL,
  listing_id uuid NOT NULL, property_id bigint,
  action text NOT NULL,
  old_is_active boolean, old_status text, old_off_market_date date, old_off_market_reason text,
  new_is_active boolean, new_status text, new_off_market_date date, new_off_market_reason text,
  applied_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.listing_lifecycle_review (
  listing_id uuid PRIMARY KEY, property_id bigint, reason text,
  recommended text, detail jsonb, created_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- G1. Collapse re-ingest / multi-source duplicates → one active per property
--     Keeper rule (Gate Decision 1 = recency-first):
--       listing_date DESC NULLS LAST, first_seen_at DESC, source-rank tiebreak.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE g1_rank ON COMMIT DROP AS
SELECT listing_id, property_id, listing_source, listing_broker, listing_date, asking_price, first_seen_at,
  row_number() OVER (PARTITION BY property_id ORDER BY
    listing_date DESC NULLS LAST, first_seen_at DESC NULLS LAST,
    CASE listing_source WHEN 'costar_sidebar' THEN 1 WHEN 'crexi' THEN 2
      WHEN 'salesforce_ascendix' THEN 3 WHEN 'master_curated_sale' THEN 4
      WHEN 'lcc_intake_om' THEN 5 ELSE 6 END) AS rn,
  (first_value(listing_date) OVER (PARTITION BY property_id ORDER BY
     listing_date DESC NULLS LAST, first_seen_at DESC NULLS LAST)) AS keeper_listing_date
FROM public.available_listings
WHERE is_active IS TRUE AND COALESCE(exclude_from_market_metrics,false)=false AND property_id IS NOT NULL;

-- PREVIEW (read this at the gate): every dup property, keeper marked KEEP
SELECT 'G1_PREVIEW' tag, property_id, rn, listing_source, listing_broker, listing_date, asking_price,
       CASE WHEN rn=1 THEN 'KEEP' ELSE 'supersede' END verdict
FROM g1_rank
WHERE property_id IN (SELECT property_id FROM g1_rank GROUP BY property_id HAVING count(*)>1)
ORDER BY property_id, rn;

CREATE TEMP TABLE g1_losers ON COMMIT DROP AS
SELECT r.listing_id, r.property_id, r.keeper_listing_date
FROM g1_rank r
WHERE r.rn > 1
  AND r.property_id IN (SELECT property_id FROM g1_rank GROUP BY property_id HAVING count(*)>1);

INSERT INTO public.listing_lifecycle_backfill_log
  (batch,step,listing_id,property_id,action,old_is_active,old_status,old_off_market_date,old_off_market_reason,
   new_is_active,new_status,new_off_market_date,new_off_market_reason)
SELECT 'gov_2026_06_11','G1',l.listing_id,l.property_id,'supersede_duplicate',
       al.is_active, al.listing_status, al.off_market_date, al.off_market_reason,
       false,'superseded', COALESCE(al.off_market_date, l.keeper_listing_date), 'duplicate'
FROM g1_losers l JOIN public.available_listings al USING (listing_id);

-- NB: gov is_active is GENERATED ALWAYS AS (listing_status IN ('active','under_contract')).
-- It CANNOT be assigned (even in a BEFORE trigger) — set listing_status and is_active follows.
UPDATE public.available_listings al SET
  listing_status = 'superseded',
  off_market_date = COALESCE(al.off_market_date, l.keeper_listing_date),
  off_market_reason = COALESCE(al.off_market_reason, 'duplicate'),
  updated_at = now()
FROM g1_losers l WHERE al.listing_id = l.listing_id;

-- ---------------------------------------------------------------------------
-- G2. Close-on-sale (Gate Decision 3 = two-tier). Queries POST-G1 live state.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE g2_cand ON COMMIT DROP AS
SELECT l.listing_id, l.property_id, l.listing_date,
  s.sale_date, s.sale_id, s.sold_price,
  CASE WHEN l.listing_date IS NULL OR s.sale_date >= l.listing_date THEN 'tier1_close'
       ELSE 'tier2_review' END AS tier
FROM public.available_listings l
JOIN LATERAL (
  SELECT st.sale_date, st.sale_id, st.sold_price
  FROM public.sales_transactions st
  WHERE st.property_id = l.property_id
    AND st.sale_date IS NOT NULL AND st.sale_date <= CURRENT_DATE
    AND COALESCE(st.exclude_from_market_metrics,false)=false
    AND st.sale_date >= COALESCE(l.listing_date, l.first_seen_at::date) - 30
    AND st.sale_date >= CURRENT_DATE - INTERVAL '24 months'
  ORDER BY st.sale_date DESC, st.sale_id DESC LIMIT 1
) s ON true
WHERE l.is_active IS TRUE AND COALESCE(l.exclude_from_market_metrics,false)=false;

SELECT 'G2_PREVIEW' tag, listing_id, property_id, listing_date, sale_date, tier FROM g2_cand ORDER BY tier, property_id;

-- Tier 1: auto-close
INSERT INTO public.listing_lifecycle_backfill_log
  (batch,step,listing_id,property_id,action,old_is_active,old_status,old_off_market_date,old_off_market_reason,
   new_is_active,new_status,new_off_market_date,new_off_market_reason)
SELECT 'gov_2026_06_11','G2',c.listing_id,c.property_id,'close_on_sale',
       al.is_active,al.listing_status,al.off_market_date,al.off_market_reason,
       false,'sold',c.sale_date,'sold'
FROM g2_cand c JOIN public.available_listings al USING (listing_id) WHERE c.tier='tier1_close';

UPDATE public.available_listings al SET
  listing_status='sold',
  off_market_date=COALESCE(al.off_market_date,c.sale_date),
  off_market_reason=COALESCE(al.off_market_reason,'sold'),
  sale_transaction_id=COALESCE(al.sale_transaction_id, c.sale_id),
  updated_at=now()
FROM g2_cand c WHERE al.listing_id=c.listing_id AND c.tier='tier1_close';

-- Tier 2: review only (no mutation)
INSERT INTO public.listing_lifecycle_review (listing_id, property_id, reason, recommended, detail)
SELECT c.listing_id, c.property_id, 'listing_postdates_sale', 'supersede_stale',
       jsonb_build_object('listing_date',c.listing_date,'sale_date',c.sale_date)
FROM g2_cand c WHERE c.tier='tier2_review'
ON CONFLICT (listing_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- G3. Phantom over-stamp repair (12 rows: null listing_date + off_market_date
--     + unverified_assumed_off). Restore an on-market start, drop the backward
--     stamp, re-queue verification. Keeps the row active for re-check.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE g3_rows ON COMMIT DROP AS
SELECT listing_id, property_id, first_seen_at FROM public.available_listings
WHERE listing_date IS NULL AND off_market_date IS NOT NULL
  AND off_market_reason = 'unverified_assumed_off';

INSERT INTO public.listing_lifecycle_backfill_log
  (batch,step,listing_id,property_id,action,old_is_active,old_status,old_off_market_date,old_off_market_reason,
   new_is_active,new_status,new_off_market_date,new_off_market_reason)
SELECT 'gov_2026_06_11','G3',g.listing_id,g.property_id,'phantom_repair',
       al.is_active,al.listing_status,al.off_market_date,al.off_market_reason,
       al.is_active,al.listing_status,NULL,NULL
FROM g3_rows g JOIN public.available_listings al USING (listing_id);

UPDATE public.available_listings al SET
  listing_date = COALESCE(al.listing_date, g.first_seen_at::date),
  off_market_date = NULL, off_market_reason = NULL,
  verification_due_at = now(), updated_at = now()
FROM g3_rows g WHERE al.listing_id=g.listing_id;

-- ---------------------------------------------------------------------------
-- G4. Stale opens (active, last_seen_at older than 90d). POST-G1/G2 live state.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE g4_rows ON COMMIT DROP AS
SELECT listing_id, property_id, last_seen_at FROM public.available_listings
WHERE is_active IS TRUE AND COALESCE(exclude_from_market_metrics,false)=false
  AND last_seen_at < now() - INTERVAL '90 days';

INSERT INTO public.listing_lifecycle_backfill_log
  (batch,step,listing_id,property_id,action,old_is_active,old_status,old_off_market_date,old_off_market_reason,
   new_is_active,new_status,new_off_market_date,new_off_market_reason)
SELECT 'gov_2026_06_11','G4',g.listing_id,g.property_id,'withdraw_stale',
       al.is_active,al.listing_status,al.off_market_date,al.off_market_reason,
       false,'withdrawn',g.last_seen_at::date,'unverified_assumed_off'
FROM g4_rows g JOIN public.available_listings al USING (listing_id);

UPDATE public.available_listings al SET
  listing_status='withdrawn',
  off_market_date=COALESCE(al.off_market_date, g.last_seen_at::date),
  off_market_reason=COALESCE(al.off_market_reason,'unverified_assumed_off'),
  updated_at=now()
FROM g4_rows g WHERE al.listing_id=g.listing_id;

-- ---------------------------------------------------------------------------
-- VERIFY (read before COMMIT) — every line should meet its target
-- ---------------------------------------------------------------------------
SELECT 'VERIFY props_with_>1_active (target 0)' k,
  (SELECT count(*) FROM (SELECT property_id FROM public.available_listings
     WHERE is_active IS TRUE AND COALESCE(exclude_from_market_metrics,false)=false AND property_id IS NOT NULL
     GROUP BY property_id HAVING count(*)>1) x)::text v
UNION ALL SELECT 'VERIFY active_rows = distinct_props',
  (SELECT count(*)||' = '||count(DISTINCT property_id) FROM public.available_listings
     WHERE is_active IS TRUE AND COALESCE(exclude_from_market_metrics,false)=false AND property_id IS NOT NULL)
UNION ALL SELECT 'VERIFY tier1 close-on-sale remaining (target 0)',
  (SELECT count(*) FROM public.available_listings l WHERE l.is_active IS TRUE
     AND COALESCE(l.exclude_from_market_metrics,false)=false
     AND EXISTS (SELECT 1 FROM public.sales_transactions s WHERE s.property_id=l.property_id
        AND COALESCE(s.exclude_from_market_metrics,false)=false
        AND s.sale_date >= l.listing_date AND s.sale_date <= CURRENT_DATE))::text
UNION ALL SELECT 'VERIFY phantom backward windows (target 0)',
  (SELECT count(*) FROM public.available_listings WHERE listing_date IS NULL AND off_market_date IS NOT NULL
     AND off_market_reason='unverified_assumed_off')::text
UNION ALL SELECT 'VERIFY stale opens >90d (target 0)',
  (SELECT count(*) FROM public.available_listings WHERE is_active IS TRUE
     AND COALESCE(exclude_from_market_metrics,false)=false AND last_seen_at < now()-INTERVAL '90 days')::text
UNION ALL SELECT 'INFO rows logged this run',
  (SELECT count(*) FROM public.listing_lifecycle_backfill_log WHERE batch='gov_2026_06_11')::text
UNION ALL SELECT 'INFO tier2 review rows',
  (SELECT count(*) FROM public.listing_lifecycle_review)::text;

-- ============================================================================
-- DEFAULT IS A NO-OP. Change to COMMIT; only after the gate verifies the above.
ROLLBACK;
-- COMMIT;
