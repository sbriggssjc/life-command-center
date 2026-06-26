-- T9c (2026-06-26, dia zqzrriwuavgrquhisnoa) — stop phantom-freshness on
-- SF-recovered comps + close the stale no-live-signal listings.
--
-- Background: 337 available_listings carry on_market_date_source='sf_on_market_date'
-- (the T4c recovery). They are legacy comps (created_at/data_source NULL) with REAL
-- recovered on_market_dates (2014-2024) but a FAKE recent listing_date
-- (listing_date_source='capture_date_fallback', ~2026-06) and a phantom last_seen
-- stamped at OM/comp promotion (intake-promoter). Only 1-2 ever had a URL or were
-- url-checked. The canonical currency gate
--   COALESCE(last_seen, url_last_checked, last_verified_at::date, listing_date) >= period_end-120d
-- is fooled by the phantom last_seen / last_verified_at (the latter advanced by the
-- auto-scrape 'inferred_active' timer with NO URL probe), so these 2014-2024 comps
-- read as "current" once their fake listing_date lands inside a period (the published
-- 2026-03-31 quarter excludes them, but the impending 2026-06-30 quarter balloons
-- 122 -> 405 active, median DOM 1328d, with these 161 SF comps flooding in).
--
-- This migration is the EXIT-side cleanup: it does NOT touch on_market_date and never
-- re-opens a listing. It is reversible (full prior state in t9c_listing_backup) and
-- idempotent (a replay / fresh rebuild finds 0 matching rows and no-ops).
--
-- The companion JS fix (api/_handlers/intake-promoter.js buildDiaListingRow) stops the
-- harvest from stamping last_seen at OM/comp promotion going forward — last_seen is
-- reserved for a GENUINE live sighting (availability-checker URL probe / sidebar capture).
--
-- SURFACED (NOT fixed here, do not bundle): listing_date is ALSO a fake 2026-06
-- capture_date_fallback on these rows and is the LAST term of the currency COALESCE, so
-- it independently passes the gate. After T9c the impending-quarter residual (2026-06-30
-- total ~272 vs published ~122) is dominated by NON-SF rows carrying the same fake
-- listing_date — a separate round (re-key the currency proxy on authoritative
-- on_market_date, or park the fake listing_dates).

-- 0) Additively widen the off_market_reason vocabulary with the audit-honest
--    inferred-stale close reason (mirrors Round 76et-C adding 'inferred_active').
ALTER TABLE public.available_listings DROP CONSTRAINT IF EXISTS al_off_market_reason_check;
ALTER TABLE public.available_listings ADD CONSTRAINT al_off_market_reason_check
  CHECK (off_market_reason IS NULL OR off_market_reason = ANY (ARRAY[
    'sold','expired','withdrawn','unverified_assumed_off','duplicate','other',
    'stale_unverified','withdrawn_inferred_stale'
  ]::text[]));

-- 1) Reversible backup of every row touched (no-genuine-capture SF set).
CREATE TABLE IF NOT EXISTS public.t9c_listing_backup (
  id                      bigserial PRIMARY KEY,
  listing_id              integer NOT NULL,
  units                   text NOT NULL,
  prior_last_seen         date,
  prior_off_market_date   date,
  prior_off_market_reason text,
  prior_status            varchar,
  prior_is_active         boolean,
  prior_notes             text,
  batch_tag               text NOT NULL DEFAULT 't9c',
  snapped_at              timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.t9c_listing_backup IS
  'T9c reversible backup: prior mutable state of SF-recovered available_listings rows '
  'touched by the phantom-freshness cleanup (Unit 1 clear last_seen) + stale-comp close '
  '(Unit 2). Reverse via the runbook at the bottom of the T9c migration. Drop -> zero trace.';

INSERT INTO public.t9c_listing_backup
  (listing_id, units, prior_last_seen, prior_off_market_date, prior_off_market_reason,
   prior_status, prior_is_active, prior_notes)
SELECT al.listing_id,
  CASE WHEN al.status='active' AND al.off_market_date IS NULL
            AND (CURRENT_DATE - al.on_market_date) > 1356
       THEN 'unit1_clear+unit2_close' ELSE 'unit1_clear' END,
  al.last_seen, al.off_market_date, al.off_market_reason, al.status, al.is_active, al.notes
FROM public.available_listings al
WHERE al.on_market_date_source='sf_on_market_date'
  AND al.listing_url IS NULL AND al.url IS NULL AND al.url_last_checked IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.t9c_listing_backup WHERE batch_tag='t9c');

-- 2) UNIT 2 — close the no-live-signal SF comps on-market beyond the market-typical
--    max DOM. cap = p90 of genuine (non-synthetic) closed DOM = 1356 days (~3.7yr); a
--    generous cap so anything plausibly still-marketed (DOM <= cap) is PRESERVED.
--    off_market_date = a real (non-excluded) sale date inside the on-market horizon if
--    the property sold, else inferred = LEAST(on_market_date + cap, today) (never future).
--    EXIT-only: status withdrawn/Sold + is_active=false (fn_listing_close_if_sold
--    early-returns on a closed-list status, so no auto-override).
WITH cs AS (
  SELECT al.listing_id, al.on_market_date, al.notes,
    LEAST(al.on_market_date + 1356, CURRENT_DATE) AS cap_date,
    (SELECT min(s.sale_date) FROM public.sales_transactions s
       WHERE s.property_id = al.property_id
         AND s.sale_date >= al.on_market_date
         AND s.sale_date <= LEAST(al.on_market_date + 1356, CURRENT_DATE)
         AND COALESCE(s.exclude_from_market_metrics,false)=false) AS sale_close
  FROM public.available_listings al
  WHERE al.on_market_date_source='sf_on_market_date'
    AND al.status='active' AND al.off_market_date IS NULL
    AND al.listing_url IS NULL AND al.url IS NULL AND al.url_last_checked IS NULL
    AND (CURRENT_DATE - al.on_market_date) > 1356
)
UPDATE public.available_listings al
SET off_market_date   = COALESCE(cs.sale_close, cs.cap_date),
    off_market_reason = CASE WHEN cs.sale_close IS NOT NULL THEN 'sold' ELSE 'withdrawn_inferred_stale' END,
    status            = CASE WHEN cs.sale_close IS NOT NULL THEN 'Sold' ELSE 'withdrawn' END,
    is_active         = false,
    notes             = COALESCE(NULLIF(al.notes,'') || E'\n','') ||
                        '[T9c ' || CURRENT_DATE || '] closed no-live-signal SF comp: ' ||
                        CASE WHEN cs.sale_close IS NOT NULL
                             THEN 'matched sale ' || cs.sale_close
                             ELSE 'inferred withdrawn = on_market(' || cs.on_market_date || ') + 1356d p90-DOM cap' END
FROM cs
WHERE al.listing_id = cs.listing_id;

-- 3) UNIT 1 (data) — clear the phantom last_seen on SF-recovered rows with no genuine
--    capture (no URL, never url-checked). last_verified_at is left to the verification
--    system; closing (Unit 2) removes the active set from the auto-scrape queue so the
--    'inferred_active' re-stamping stops for them.
UPDATE public.available_listings al
SET last_seen = NULL
WHERE al.on_market_date_source='sf_on_market_date'
  AND al.listing_url IS NULL AND al.url IS NULL AND al.url_last_checked IS NULL
  AND al.last_seen IS NOT NULL;

-- ── REVERSAL RUNBOOK (run only to undo T9c) ──────────────────────────────────────────
-- UPDATE public.available_listings al
-- SET last_seen        = b.prior_last_seen,
--     off_market_date  = b.prior_off_market_date,
--     off_market_reason= b.prior_off_market_reason,
--     status           = b.prior_status,
--     is_active        = b.prior_is_active,
--     notes            = b.prior_notes
-- FROM public.t9c_listing_backup b
-- WHERE al.listing_id = b.listing_id AND b.batch_tag='t9c';
-- -- then (optionally) restore the prior CHECK without 'withdrawn_inferred_stale', and
-- -- DROP TABLE public.t9c_listing_backup;
