-- T4c RECOVERY (2026-06-24, gov): backfill the HELD on_market_date rows from
-- the recovered Comp__c.On_Market_Date__c map (LCC v_lcc_on_market_backfill_map).
--
-- Reversible (every write logged), idempotent + re-runnable (the fill-HELD-only
-- guard means a re-run after the full PA Comp__c pull picks up newly-recovered
-- comps and never re-touches an already-backfilled row), and SAFE: it ONLY
-- writes rows whose on_market_date_source='unestablished' (the held set), so it
-- can NEVER overwrite synthetic_from_sale / master_curated / unestablished_
-- historical / any real-evidence source, and never touches listing_date.

CREATE TABLE IF NOT EXISTS public.lcc_on_market_backfill_log (
  id                   bigserial PRIMARY KEY,
  listing_id           text NOT NULL,
  sf_comp_id           text,
  prior_on_market_date date,
  prior_source         text,
  prior_confidence     text,
  new_on_market_date   date,
  new_source           text,
  new_confidence       text,
  batch_tag            text,
  applied_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lcc_on_market_backfill_log IS
  'T4c recovery audit/undo ledger: prior on_market_date provenance for every listing backfilled from a recovered Comp__c date.';

-- p_rows: jsonb array of {listing_id, on_market_date, source, confidence, sf_comp_id}.
-- Returns matched (listing exists), would_update (matched AND still held),
-- updated (rows written; 0 on dry run), skipped_not_held (matched but not held).
CREATE OR REPLACE FUNCTION public.lcc_apply_on_market_backfill(
  p_rows      jsonb,
  p_dry_run   boolean DEFAULT true,
  p_batch_tag text    DEFAULT 't4c_recovery'
) RETURNS TABLE(matched integer, would_update integer, updated integer, skipped_not_held integer)
LANGUAGE plpgsql
AS $fn$
DECLARE v_matched integer; v_would integer; v_updated integer := 0;
BEGIN
  CREATE TEMP TABLE _bf (
    listing_id text, omd date, source text, confidence text, sf_comp_id text
  ) ON COMMIT DROP;

  INSERT INTO _bf
  SELECT e->>'listing_id',
         NULLIF(e->>'on_market_date','')::date,
         COALESCE(NULLIF(e->>'source',''),     'sf_on_market_date'),
         COALESCE(NULLIF(e->>'confidence',''), 'high'),
         e->>'sf_comp_id'
  FROM jsonb_array_elements(p_rows) e
  WHERE NULLIF(e->>'on_market_date','') IS NOT NULL;   -- never write a NULL date

  SELECT count(*) INTO v_matched
  FROM _bf b JOIN public.available_listings a ON a.listing_id::text = b.listing_id;

  SELECT count(*) INTO v_would
  FROM _bf b JOIN public.available_listings a
    ON a.listing_id::text = b.listing_id AND a.on_market_date_source = 'unestablished';

  IF p_dry_run THEN
    RETURN QUERY SELECT v_matched, v_would, 0, v_matched - v_would;
    RETURN;
  END IF;

  INSERT INTO public.lcc_on_market_backfill_log
    (listing_id, sf_comp_id, prior_on_market_date, prior_source, prior_confidence,
     new_on_market_date, new_source, new_confidence, batch_tag)
  SELECT a.listing_id::text, b.sf_comp_id, a.on_market_date, a.on_market_date_source,
         a.on_market_date_confidence, b.omd, b.source, b.confidence, p_batch_tag
  FROM _bf b JOIN public.available_listings a
    ON a.listing_id::text = b.listing_id AND a.on_market_date_source = 'unestablished';

  UPDATE public.available_listings a
  SET on_market_date            = b.omd,
      on_market_date_source     = b.source,
      on_market_date_confidence = b.confidence
  FROM _bf b
  WHERE a.listing_id::text = b.listing_id
    AND a.on_market_date_source = 'unestablished';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN QUERY SELECT v_matched, v_would, v_updated, v_matched - v_updated;
END
$fn$;

COMMENT ON FUNCTION public.lcc_apply_on_market_backfill(jsonb, boolean, text) IS
  'T4c recovery: fill-HELD-only on_market_date backfill from recovered Comp__c dates. Dry-run by default. Reverse via lcc_on_market_backfill_log.';
