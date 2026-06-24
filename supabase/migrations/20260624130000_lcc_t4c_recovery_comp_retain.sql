-- T4c RECOVERY (2026-06-24): retain the Salesforce Comp__c -> On_Market_Date__c
-- map durably, so the timing backfill survives the sf_sync_log 30-day prune.
--
-- WHY: T4c (PR #1327) added on_market_date provenance to dia/gov
-- available_listings and HELD the artifact-clock-dated rows
-- (on_market_date_source='unestablished'). The real market-entry date is
-- Comp__c.On_Market_Date__c, which the SF -> LCC crawler already carries in
-- sf_sync_log.payload (top-level ->>'On_Market_Date__c'). BUT sf_sync_log
-- prunes terminal object_intake rows to ~30 days (sf-sync-log-prune cron), so
-- relying on it alone recovers only the recently/repeatedly-synced comps
-- (~535 distinct / 453 with a date) — ~48% of the 941 held-linked comps. The
-- rest were pruned. This migration adds a RETAINED table + an hourly harvest so
-- (a) what the crawler syncs is never lost to the prune again, and (b) a future
-- FULL Comp__c crawl (the Power Automate "SF -> LCC: Object Sync" flow, where
-- the SF OAuth lives) lands every comp here permanently for the backfill to
-- consume.
--
-- Additive + reversible: DROP the table/function/view + unschedule the cron to
-- revert. Touches NOTHING outside LCC Opps. No domain writes here (the dia/gov
-- backfill functions, applied separately, consume the recovery-map view).

-- ── retained comp -> on-market-date map (survives the sf_sync_log prune) ─────
CREATE TABLE IF NOT EXISTS public.lcc_sf_comp_on_market (
  sf_comp_id      text PRIMARY KEY,           -- Comp__c 18-char Id (= intake seed_data.sf_entity_id)
  on_market_date  date,                       -- Comp__c.On_Market_Date__c (the real timing truth; NULL = comp seen, no date)
  created_date    date,                       -- Comp__c CreatedDate (low-confidence fallback only)
  has_omd         boolean NOT NULL DEFAULT false,
  first_seen      timestamptz NOT NULL DEFAULT now(),
  last_seen       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lcc_sf_comp_on_market IS
  'T4c recovery: durable Comp__c -> On_Market_Date__c map harvested from sf_sync_log before the 30d prune. Source of truth for the dia/gov on_market_date backfill. Drop to revert.';

-- ── harvest: pull Comp__c (key prefix a1Y) OMD + CreatedDate from sf_sync_log ─
-- Runs hourly; the prune only removes rows older than 30 days, so a fresh full
-- crawl (age 0) is always harvested with weeks of headroom. ON CONFLICT keeps
-- the latest non-null OMD and the earliest CreatedDate.
CREATE OR REPLACE FUNCTION public.lcc_harvest_sf_comp_on_market()
RETURNS TABLE(harvested integer, with_omd integer)
LANGUAGE plpgsql
AS $fn$
DECLARE v_h integer; v_o integer;
BEGIN
  WITH comp AS (
    SELECT payload->>'Id' AS sf_comp_id,
           max(NULLIF(payload->>'On_Market_Date__c','')::date)            AS omd,
           min(NULLIF(payload->>'CreatedDate','')::timestamptz)::date     AS created_dt
    FROM public.sf_sync_log
    WHERE sync_type = 'object_intake'
      AND payload IS NOT NULL
      AND payload->>'Id' IS NOT NULL
      AND left(payload->>'Id', 3) = 'a1Y'      -- NorthMarq Comp__c key prefix
    GROUP BY 1
  ),
  up AS (
    INSERT INTO public.lcc_sf_comp_on_market AS t
      (sf_comp_id, on_market_date, created_date, has_omd, last_seen)
    SELECT sf_comp_id, omd, created_dt, (omd IS NOT NULL), now()
    FROM comp
    ON CONFLICT (sf_comp_id) DO UPDATE SET
      on_market_date = COALESCE(EXCLUDED.on_market_date, t.on_market_date),
      created_date   = COALESCE(t.created_date, EXCLUDED.created_date),
      has_omd        = t.has_omd OR EXCLUDED.has_omd,
      last_seen      = now()
    RETURNING (t.on_market_date IS NOT NULL) AS has_date
  )
  SELECT count(*)::int, count(*) FILTER (WHERE has_date)::int INTO v_h, v_o FROM up;
  RETURN QUERY SELECT v_h, v_o;
END
$fn$;

-- ── recovery map: held-linked listings -> recoverable date ──────────────────
-- One row per (domain, listing_id) reachable from an SF-comp intake
-- (seed_data.sf_entity_id -> extraction_result.promotion_listing_id), with the
-- recoverable on_market_date / created_date. The dia/gov backfill functions
-- read this and apply the fill-HELD-only guard on their side.
CREATE OR REPLACE VIEW public.v_lcc_on_market_backfill_map AS
SELECT
  match_domain,
  listing_id,
  (array_agg(sf_comp_id   ORDER BY (on_market_date IS NOT NULL) DESC, on_market_date DESC NULLS LAST))[1] AS sf_comp_id,
  max(on_market_date)                                                                                     AS on_market_date,
  -- CreatedDate fallback used only when no comp for this listing has an OMD:
  CASE WHEN bool_or(on_market_date IS NOT NULL) THEN NULL
       ELSE max(created_date) END                                                                         AS created_date_fallback
FROM (
  SELECT DISTINCT
    lower(s.raw_payload->'extraction_result'->>'match_domain')          AS match_domain,
    s.raw_payload->'extraction_result'->>'promotion_listing_id'         AS listing_id,
    s.raw_payload->'seed_data'->>'sf_entity_id'                         AS sf_comp_id,
    c.on_market_date,
    c.created_date
  FROM public.staged_intake_items s
  JOIN public.lcc_sf_comp_on_market c
    ON c.sf_comp_id = s.raw_payload->'seed_data'->>'sf_entity_id'
  WHERE s.raw_payload->'seed_data'->>'sf_entity_id' IS NOT NULL
    AND s.raw_payload->'extraction_result'->>'promotion_listing_id' IS NOT NULL
    AND lower(s.raw_payload->'extraction_result'->>'match_domain') IN ('dialysis','government')
) z
GROUP BY match_domain, listing_id;

COMMENT ON VIEW public.v_lcc_on_market_backfill_map IS
  'T4c recovery: per held-linked listing, the recoverable Comp__c on_market_date (high) or CreatedDate fallback (low). Consumed by the dia/gov lcc_apply_on_market_backfill functions.';

-- ── hourly harvest cron ─────────────────────────────────────────────────────
SELECT cron.unschedule('lcc-sf-comp-omd-harvest')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-sf-comp-omd-harvest');
SELECT cron.schedule(
  'lcc-sf-comp-omd-harvest',
  '7 * * * *',
  $cron$SELECT public.lcc_harvest_sf_comp_on_market()$cron$
);
