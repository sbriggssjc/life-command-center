-- R2-D RECOVERY (2026-06-29, dia): recover the real on_market_date for the
-- `date_uncertain` listings from the Salesforce Comp__c.On_Market_Date__c map.
--
-- BACKGROUND (Phase-1 investigation, see docs/capital-markets/R2D_OM_DATE_RECOVERY_YIELD.md):
--   The ~512 dia `on_market_date_source='date_uncertain'` listings are NOT
--   forwarded emails — they are Salesforce **Comp__c** ingests (the LCC
--   staged_intake_items carry `seed_data.sf_entity_id`=Comp__c Id, `source_type`
--   'email' is just the SF→LCC sync channel). So there is NO forwarded-email
--   `Date:` header / internet_message_id / source_email_date / body to mine
--   (all confirmed empty). The ONE real recoverable source is the Salesforce
--   `Comp__c.On_Market_Date__c`, already harvested into LCC Opps
--   `lcc_sf_comp_on_market` (the T4c machinery).
--
--   The T4c recovery (`lcc_apply_on_market_backfill`) silently MISSED this set
--   for two reasons:
--     1. its recovery-map view filters `match_domain IN ('dialysis','government')`
--        but these intakes carry `match_domain='lcc'` (the domain lives in
--        `seed_data.source_vertical='dia'` instead), and
--     2. its apply is fill-`unestablished`-only, but T9d FIX moved these rows to
--        `date_uncertain`.
--   This migration closes both gaps for the `date_uncertain` set.
--
-- SAFETY / DISCIPLINE (constructive recovery, NOT date invention):
--   * Fill-`date_uncertain`-ONLY. Can NEVER overwrite sf_on_market_date /
--     synthetic_from_sale / unestablished / unestablished_historical / any other
--     source. Never touches `listing_date`.
--   * NO fabricated dates — every recovered date is a real
--     Comp__c.On_Market_Date__c.
--   * Re-listing guard: a property re-listed (a 2026 OM) was often matched +
--     MERGED into an OLD already-sold listing row of the same property
--     (promo_action='updated_existing'), so the comp's (real, recent) OMD can
--     POSTDATE that row's sold/off-market date. We therefore pick the LATEST
--     candidate OMD that is `<= COALESCE(off_market_date, sold_date, today)` per
--     listing; a listing whose every candidate postdates its exit is REJECTED
--     (stays date_uncertain — the OMD is real but belongs to a re-listing, not
--     this sold row). Never a future date.
--   * Reversible: prior provenance logged per row in
--     `r2d_date_uncertain_recovery_log`.
--   * Idempotent + re-runnable: the fill-date_uncertain-only guard means a re-run
--     after Scott's full Comp__c pull (the ~173 SF-linked comps not yet in
--     lcc_sf_comp_on_market) picks up newly-recovered comps and never re-touches
--     an already-recovered row.
--   * Recovered rows get `on_market_date_source='sf_on_market_date'`,
--     `confidence='high'` — the SAME real-evidence source as T4c, so the T9d
--     currency model treats them identically (non-synthetic ⇒ on the time axis).

CREATE TABLE IF NOT EXISTS public.r2d_date_uncertain_recovery_log (
  id                   bigserial PRIMARY KEY,
  listing_id           text NOT NULL,
  sf_comp_id           text,
  prior_on_market_date date,
  prior_source         text,
  prior_confidence     text,
  new_on_market_date   date,
  new_source           text,
  new_confidence       text,
  exit_date            date,
  batch_tag            text,
  applied_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.r2d_date_uncertain_recovery_log IS
  'R2-D recovery audit/undo ledger: prior on_market_date provenance for every date_uncertain listing dated from a recovered Comp__c On_Market_Date__c.';

-- p_rows: jsonb array of CANDIDATE pairs {listing_id, on_market_date, sf_comp_id}.
--   A listing may appear multiple times (re-listings) — the function picks the
--   latest candidate that does not postdate the listing's exit.
-- Returns:
--   matched          = listings that exist AND are currently date_uncertain
--   would_update     = of matched, those with >=1 candidate <= exit (applyable)
--   updated          = rows written (0 on dry-run)
--   rejected_after_exit = matched listings whose every candidate postdates the
--                         exit (re-listing into a sold row — left date_uncertain)
CREATE OR REPLACE FUNCTION public.lcc_apply_r2d_date_uncertain_recovery(
  p_rows      jsonb,
  p_dry_run   boolean DEFAULT true,
  p_batch_tag text    DEFAULT 'r2d_recovery'
) RETURNS TABLE(matched integer, would_update integer, updated integer, rejected_after_exit integer)
LANGUAGE plpgsql
AS $fn$
DECLARE v_matched integer; v_would integer; v_reject integer; v_updated integer := 0;
BEGIN
  -- Raw candidates (one row per listing x comp date).
  CREATE TEMP TABLE _cand (listing_id text, omd date, sf_comp_id text) ON COMMIT DROP;
  INSERT INTO _cand
  SELECT e->>'listing_id',
         NULLIF(e->>'on_market_date','')::date,
         e->>'sf_comp_id'
  FROM jsonb_array_elements(p_rows) e
  WHERE NULLIF(e->>'on_market_date','') IS NOT NULL;   -- never write a NULL date

  -- Best consistent OMD per CURRENTLY-date_uncertain listing: the latest
  -- candidate that does not postdate the listing's exit (or today, if active).
  CREATE TEMP TABLE _best ON COMMIT DROP AS
  SELECT a.listing_id::text AS listing_id,
         a.on_market_date            AS prior_omd,
         a.on_market_date_source     AS prior_source,
         a.on_market_date_confidence AS prior_conf,
         COALESCE(a.off_market_date, a.sold_date) AS exit_date,
         max(c.omd) FILTER (
           WHERE c.omd <= COALESCE(a.off_market_date, a.sold_date, CURRENT_DATE)
         ) AS best_omd,
         (array_agg(c.sf_comp_id ORDER BY c.omd DESC)
            FILTER (WHERE c.omd <= COALESCE(a.off_market_date, a.sold_date, CURRENT_DATE)))[1] AS best_comp
  FROM public.available_listings a
  JOIN _cand c ON c.listing_id = a.listing_id::text
  WHERE a.on_market_date_source = 'date_uncertain'
  GROUP BY a.listing_id, a.on_market_date, a.on_market_date_source,
           a.on_market_date_confidence, a.off_market_date, a.sold_date;

  SELECT count(*) INTO v_matched FROM _best;
  SELECT count(*) INTO v_would   FROM _best WHERE best_omd IS NOT NULL;
  SELECT count(*) INTO v_reject  FROM _best WHERE best_omd IS NULL;

  IF p_dry_run THEN
    RETURN QUERY SELECT v_matched, v_would, 0, v_reject;
    RETURN;
  END IF;

  INSERT INTO public.r2d_date_uncertain_recovery_log
    (listing_id, sf_comp_id, prior_on_market_date, prior_source, prior_confidence,
     new_on_market_date, new_source, new_confidence, exit_date, batch_tag)
  SELECT listing_id, best_comp, prior_omd, prior_source, prior_conf,
         best_omd, 'sf_on_market_date', 'high', exit_date, p_batch_tag
  FROM _best WHERE best_omd IS NOT NULL;

  UPDATE public.available_listings a
  SET on_market_date            = b.best_omd,
      on_market_date_source     = 'sf_on_market_date',
      on_market_date_confidence = 'high'
  FROM _best b
  WHERE a.listing_id::text = b.listing_id
    AND b.best_omd IS NOT NULL
    AND a.on_market_date_source = 'date_uncertain';   -- re-guard at write time
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN QUERY SELECT v_matched, v_would, v_updated, v_reject;
END
$fn$;

COMMENT ON FUNCTION public.lcc_apply_r2d_date_uncertain_recovery(jsonb, boolean, text) IS
  'R2-D recovery: fill-date_uncertain-only on_market_date recovery from Comp__c OMD candidates, latest OMD <= exit per listing. Dry-run by default. Reverse via r2d_date_uncertain_recovery_log.';

-- ============================================================================
-- REVERSAL (run on the dia DB to undo a batch):
--   UPDATE public.available_listings a
--   SET on_market_date            = l.prior_on_market_date,
--       on_market_date_source     = l.prior_source,
--       on_market_date_confidence = l.prior_confidence
--   FROM public.r2d_date_uncertain_recovery_log l
--   WHERE a.listing_id::text = l.listing_id
--     AND l.batch_tag = 'r2d_recovery'
--     AND a.on_market_date_source = 'sf_on_market_date';
-- ============================================================================
