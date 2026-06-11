-- ============================================================================
-- GATED — DO NOT APPLY until the 5 gate-sheet decisions are signed off.
-- Target: dia (zqzrriwuavgrquhisnoa) public.available_listings
-- dia's CURRENT snapshot is already 1:1 (the partial unique index + close trigger
-- exist). This backfill is HISTORICAL window repair only — it changes NO active
-- counts. It ends the inflated on-market windows of superseded/sold rows so the
-- R76 point-in-time engine stops reconstructing phantom overlaps, collapses
-- intra-iteration same-day duplicates, normalizes the dirty `status` vocabulary,
-- and resolves the active-but-off_market contradictions.
-- Reversible (logged + notes), never hard-deletes. Ends in ROLLBACK.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.listing_lifecycle_backfill_log (
  id bigserial PRIMARY KEY, batch text NOT NULL, step text NOT NULL,
  listing_id bigint NOT NULL, property_id bigint,
  action text NOT NULL,
  old_is_active boolean, old_status text, old_off_market_date date,
  new_is_active boolean, new_status text, new_off_market_date date,
  applied_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- D2. Collapse same-(property, listing_date) redundant rows (Gate Decision 2:
--     same listing_date = same iteration). Keep one per date (min listing_id);
--     zero-window the rest so they stop overlapping each other.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE d2_losers ON COMMIT DROP AS
SELECT listing_id, property_id, listing_date FROM (
  SELECT listing_id, property_id, listing_date,
         row_number() OVER (PARTITION BY property_id, listing_date ORDER BY listing_id) rn
  FROM public.available_listings
  WHERE listing_date IS NOT NULL AND data_source IS DISTINCT FROM 'synthetic_from_sale'
) x WHERE rn > 1;

INSERT INTO public.listing_lifecycle_backfill_log
  (batch,step,listing_id,property_id,action,old_is_active,old_status,old_off_market_date,new_is_active,new_status,new_off_market_date)
SELECT 'dia_2026_06_11','D2',d.listing_id,d.property_id,'collapse_same_day_dup',
       al.is_active,al.status,al.off_market_date,false,'Superseded',d.listing_date
FROM d2_losers d JOIN public.available_listings al USING (listing_id);

UPDATE public.available_listings al SET
  is_active=false,
  status=CASE WHEN lower(coalesce(al.status,'')) IN ('sold','closed') THEN al.status ELSE 'Superseded' END,
  off_market_date=LEAST(COALESCE(al.off_market_date, d.listing_date), d.listing_date),
  off_market_reason=COALESCE(al.off_market_reason,'duplicate'),
  notes=COALESCE(NULLIF(al.notes,'')||E'\n','')||'[lifecycle_backfill '||CURRENT_DATE||'] D2 same-day duplicate, window zeroed'
FROM d2_losers d WHERE al.listing_id=d.listing_id;

-- ---------------------------------------------------------------------------
-- D1. End each closed/superseded iteration's window at the NEXT iteration's
--     start (the next distinct later listing_date for that property). Only
--     SHRINKS windows (LEAST), never extends; Sold rows keep an earlier real
--     sale date. The current active (latest) iteration has no next start → left
--     open.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE d1_next ON COMMIT DROP AS
SELECT a.property_id, a.listing_date,
       (SELECT min(b.listing_date) FROM (
          SELECT DISTINCT property_id, listing_date FROM public.available_listings
          WHERE listing_date IS NOT NULL AND data_source IS DISTINCT FROM 'synthetic_from_sale') b
        WHERE b.property_id=a.property_id AND b.listing_date > a.listing_date) AS next_start
FROM (SELECT DISTINCT property_id, listing_date FROM public.available_listings
      WHERE listing_date IS NOT NULL AND data_source IS DISTINCT FROM 'synthetic_from_sale') a;

INSERT INTO public.listing_lifecycle_backfill_log
  (batch,step,listing_id,property_id,action,old_is_active,old_status,old_off_market_date,new_is_active,new_status,new_off_market_date)
SELECT 'dia_2026_06_11','D1',al.listing_id,al.property_id,'end_window_at_supersession',
       al.is_active,al.status,al.off_market_date,al.is_active,al.status,
       LEAST(COALESCE(al.off_market_date,n.next_start), n.next_start)
FROM public.available_listings al JOIN d1_next n
  ON al.property_id=n.property_id AND al.listing_date=n.listing_date
WHERE al.data_source IS DISTINCT FROM 'synthetic_from_sale'
  AND al.is_active IS NOT TRUE                         -- only closed rows
  AND n.next_start IS NOT NULL
  AND (al.off_market_date IS NULL OR al.off_market_date > n.next_start);  -- only inflated

UPDATE public.available_listings al SET
  off_market_date = LEAST(COALESCE(al.off_market_date,n.next_start), n.next_start),
  notes=COALESCE(NULLIF(al.notes,'')||E'\n','')||'[lifecycle_backfill '||CURRENT_DATE||'] D1 window ended at next iteration '||n.next_start
FROM d1_next n
WHERE al.property_id=n.property_id AND al.listing_date=n.listing_date
  AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'
  AND al.is_active IS NOT TRUE AND n.next_start IS NOT NULL
  AND (al.off_market_date IS NULL OR al.off_market_date > n.next_start);

-- ---------------------------------------------------------------------------
-- D3. Status vocabulary normalization (hygiene; not overlap-causing). Canonical
--     lowercase. is_active stays AUTHORITATIVE; the 9 desync rows are forced to
--     agree with is_active.
-- ---------------------------------------------------------------------------
INSERT INTO public.listing_lifecycle_backfill_log
  (batch,step,listing_id,property_id,action,old_is_active,old_status,old_off_market_date,new_is_active,new_status,new_off_market_date)
SELECT 'dia_2026_06_11','D3',listing_id,property_id,'normalize_status',is_active,status,off_market_date,
       is_active,
       CASE
         WHEN is_active IS TRUE THEN 'active'
         WHEN lower(coalesce(status,'')) IN ('sold')            THEN 'sold'
         WHEN lower(coalesce(status,'')) IN ('superseded')      THEN 'superseded'
         WHEN lower(coalesce(status,'')) IN ('off market')      THEN 'off_market'
         WHEN lower(coalesce(status,'')) IN ('stale')           THEN 'stale'
         WHEN lower(coalesce(status,'')) IN ('closed','closed but obligated') THEN 'closed'
         WHEN lower(coalesce(status,'')) IN ('active','available') THEN 'superseded' -- inactive but active-like text = desync → inactive
         ELSE lower(coalesce(status,'superseded'))
       END, off_market_date
FROM public.available_listings
WHERE status IS DISTINCT FROM (
       CASE WHEN is_active IS TRUE THEN 'active'
            WHEN lower(coalesce(status,'')) IN ('sold') THEN 'sold'
            WHEN lower(coalesce(status,'')) IN ('superseded') THEN 'superseded'
            WHEN lower(coalesce(status,'')) IN ('off market') THEN 'off_market'
            WHEN lower(coalesce(status,'')) IN ('stale') THEN 'stale'
            WHEN lower(coalesce(status,'')) IN ('closed','closed but obligated') THEN 'closed'
            WHEN lower(coalesce(status,'')) IN ('active','available') THEN 'superseded'
            ELSE lower(coalesce(status,'superseded')) END);

UPDATE public.available_listings al SET status =
  CASE WHEN is_active IS TRUE THEN 'active'
       WHEN lower(coalesce(status,'')) IN ('sold') THEN 'sold'
       WHEN lower(coalesce(status,'')) IN ('superseded') THEN 'superseded'
       WHEN lower(coalesce(status,'')) IN ('off market') THEN 'off_market'
       WHEN lower(coalesce(status,'')) IN ('stale') THEN 'stale'
       WHEN lower(coalesce(status,'')) IN ('closed','closed but obligated') THEN 'closed'
       WHEN lower(coalesce(status,'')) IN ('active','available') THEN 'superseded'
       ELSE lower(coalesce(status,'superseded')) END;

-- ---------------------------------------------------------------------------
-- D4. Active-but-off_market contradictions (47): trust is_active=true, drop the
--     stray off_market stamp (Decision: keep active, clear the contradiction).
-- ---------------------------------------------------------------------------
INSERT INTO public.listing_lifecycle_backfill_log
  (batch,step,listing_id,property_id,action,old_is_active,old_status,old_off_market_date,new_is_active,new_status,new_off_market_date)
SELECT 'dia_2026_06_11','D4',listing_id,property_id,'clear_active_offmarket_contradiction',
       is_active,status,off_market_date,is_active,status,NULL
FROM public.available_listings WHERE is_active IS TRUE AND off_market_date IS NOT NULL;

UPDATE public.available_listings SET off_market_date=NULL, off_market_reason=NULL
WHERE is_active IS TRUE AND off_market_date IS NOT NULL;

-- ---------------------------------------------------------------------------
-- VERIFY (read before COMMIT)
-- ---------------------------------------------------------------------------
WITH w AS (
  SELECT listing_id, property_id, listing_date AS s,
         COALESCE(off_market_date, sold_date, last_seen,
                  CASE WHEN is_active THEN current_date END, listing_date) AS e
  FROM public.available_listings
  WHERE listing_date IS NOT NULL AND data_source IS DISTINCT FROM 'synthetic_from_sale'
)
SELECT 'VERIFY real point-in-time overlaps (target ~0)' k,
  count(DISTINCT a.property_id)::text v
FROM w a JOIN w b ON a.property_id=b.property_id AND a.listing_id<b.listing_id
  AND a.s < b.e AND b.s < a.e        -- STRICT overlap (zero-length windows no longer collide)
UNION ALL SELECT 'VERIFY active snapshot unchanged (806 = 806)',
  (SELECT count(*)||' = '||count(DISTINCT property_id) FROM public.available_listings WHERE is_active IS TRUE)
UNION ALL SELECT 'VERIFY active-but-offmarket (target 0)',
  (SELECT count(*) FROM public.available_listings WHERE is_active IS TRUE AND off_market_date IS NOT NULL)::text
UNION ALL SELECT 'VERIFY status desync (target 0)',
  (SELECT count(*) FROM public.available_listings WHERE (is_active IS TRUE) <> (lower(coalesce(status,''))='active'))::text
UNION ALL SELECT 'INFO rows logged',
  (SELECT count(*) FROM public.listing_lifecycle_backfill_log WHERE batch='dia_2026_06_11')::text;

-- ============================================================================
-- DEFAULT IS A NO-OP. Change to COMMIT; only after the gate verifies the above.
ROLLBACK;
-- COMMIT;
