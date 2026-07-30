-- ============================================================================
-- W3.7 — gov OM-confirmed NOI write-through RPC (+ reversible ledger)
--
-- The "id=11 shape" (Fort Wayne VA, comp id=11): a Salesforce-linked Northmarq OM
-- states the in-place NOI; that figure lands on properties.noi with
-- confirmed_document / authority_rank=3 provenance and NEVER overwrites a
-- confirmed/manual value. Cowork did this by hand for Fort Wayne on 2026-07-30
-- (properties.noi 592,313 -> 689,805, noi_source='confirmed_sale',
-- field_value_provenance('properties','16261','noi','confirmed_document',3)).
-- This RPC makes that write callable, guarded, idempotent, reversible and
-- dry-run-able so api/_handlers/om-comp-resolver.js can apply it automatically.
--
-- Same write-through pattern as W3.6b (20260731_gov_w3_6b_bulk_refresh_comp_noi):
--   properties.noi := OM NOI, noi_source := 'confirmed_sale'
--   field_value_provenance(... 'confirmed_document', 3 ...)
-- Effect on the cap engine: gov_compute_cap_rate tier 1 selects a
-- noi_source='confirmed_sale' property NOI as HIGH confidence, so on the next
-- comps pull the implied cap is derived from the OM NOI and the row reconciles.
--
-- Discipline: FILL-authoritative-only (never clobbers manual or an existing
-- confirmed value), reversible (gov_om_noi_writethrough_log snapshots the prior
-- value), idempotent (re-run on an already-confirmed row is a no-op),
-- dry-run-default. SECURITY DEFINER, service_role EXECUTE only (W0.7).
-- ============================================================================

-- Reversible ledger — one row per apply attempt (incl. skips) for audit + REVERT.
CREATE TABLE IF NOT EXISTS public.gov_om_noi_writethrough_log (
  id               bigserial PRIMARY KEY,
  property_id      bigint NOT NULL,
  sf_file_id       text,
  prior_noi        numeric,
  prior_noi_source text,
  new_noi          numeric,
  as_of            date,
  decision         text NOT NULL,   -- written | skipped_manual | skipped_confirmed | noop_same | skipped_no_property | skipped_no_noi | dry_run
  reason           text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.gov_om_noi_writethrough_log IS
  'W3.7 audit + reversal ledger for OM-confirmed NOI write-throughs onto properties.noi.';

CREATE OR REPLACE FUNCTION public.gov_apply_om_confirmed_noi(
  p_property_id bigint,
  p_noi         numeric,
  p_as_of       date    DEFAULT NULL,
  p_sf_file_id  text    DEFAULT NULL,
  p_dry_run     boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_noi       numeric;
  v_src       text;
  v_manual    boolean;
  v_decision  text;
  v_reason    text;
BEGIN
  IF p_noi IS NULL OR p_noi <= 0 THEN
    RETURN jsonb_build_object('decision','skipped_no_noi','property_id',p_property_id,
                              'reason','om NOI absent or non-positive');
  END IF;

  SELECT noi, noi_source INTO v_noi, v_src
    FROM public.properties WHERE property_id = p_property_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('decision','skipped_no_property','property_id',p_property_id,
                              'reason','no gov property with that id');
  END IF;

  -- Never overwrite a human/manual value (properties.noi_source='manual' OR a
  -- manual provenance override on the field).
  SELECT bool_or(manual_override IS TRUE OR authority_source = 'manual')
    INTO v_manual
    FROM public.field_value_provenance
   WHERE table_name = 'properties' AND record_id = p_property_id::text AND field_name = 'noi';

  IF v_src = 'manual' OR v_manual IS TRUE THEN
    v_decision := 'skipped_manual';
    v_reason   := 'existing NOI is manual / manual_override — never overwritten';
  ELSIF v_src = 'confirmed_sale' AND v_noi IS NOT NULL
        AND abs(coalesce(v_noi,0) - p_noi) < 1 THEN
    v_decision := 'noop_same';
    v_reason   := 'already confirmed at the same NOI (idempotent)';
  ELSIF v_src = 'confirmed_sale' AND v_noi IS NOT NULL THEN
    -- A different confirmed value already stands — do NOT clobber a confirmed
    -- value with an OM one (conservative; matches W3.6b guard).
    v_decision := 'skipped_confirmed';
    v_reason   := 'existing NOI already confirmed_sale at a different value';
  ELSE
    v_decision := 'written';
    v_reason   := 'OM in-place NOI applied over estimated/blank NOI';
  END IF;

  IF v_decision = 'written' AND p_dry_run THEN
    v_decision := 'dry_run';
  END IF;

  IF v_decision = 'written' THEN
    UPDATE public.properties
       SET noi = p_noi,
           noi_source = 'confirmed_sale',
           noi_as_of_date = COALESCE(p_as_of, noi_as_of_date)
     WHERE property_id = p_property_id;

    INSERT INTO public.field_value_provenance
      (table_name, record_id, field_name, authority_source, authority_rank,
       last_confirmed_at, manual_override)
    VALUES
      ('properties', p_property_id::text, 'noi', 'confirmed_document', 3, now(), false)
    ON CONFLICT (table_name, record_id, field_name) DO UPDATE
      SET authority_source = EXCLUDED.authority_source,
          authority_rank   = EXCLUDED.authority_rank,
          last_confirmed_at = now(),
          updated_at        = now()
      WHERE public.field_value_provenance.manual_override IS NOT TRUE
        AND public.field_value_provenance.authority_rank >= 3;
  END IF;

  -- Ledger EVERY attempt (skips too) for a queryable trail.
  INSERT INTO public.gov_om_noi_writethrough_log
    (property_id, sf_file_id, prior_noi, prior_noi_source, new_noi, as_of, decision, reason)
  VALUES
    (p_property_id, p_sf_file_id, v_noi, v_src, p_noi, p_as_of, v_decision, v_reason);

  RETURN jsonb_build_object(
    'decision', v_decision, 'property_id', p_property_id,
    'prior_noi', v_noi, 'prior_noi_source', v_src, 'new_noi', p_noi,
    'noi_source', CASE WHEN v_decision = 'written' THEN 'confirmed_sale' ELSE v_src END,
    'reason', v_reason);
END;
$fn$;

REVOKE ALL ON FUNCTION public.gov_apply_om_confirmed_noi(bigint,numeric,date,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gov_apply_om_confirmed_noi(bigint,numeric,date,text,boolean) TO service_role;

-- ============================================================================
-- REVERSAL RUNBOOK
--   -- Restore properties.noi to the prior value for every real write:
--   UPDATE public.properties p
--      SET noi = g.prior_noi, noi_source = g.prior_noi_source
--     FROM public.gov_om_noi_writethrough_log g
--    WHERE g.decision = 'written' AND g.property_id = p.property_id;
--   -- Remove the confirmed_document provenance rows this created (leave any that
--   -- predate the ledger's earliest 'written' row):
--   DELETE FROM public.field_value_provenance fvp
--    USING public.gov_om_noi_writethrough_log g
--    WHERE g.decision='written' AND fvp.table_name='properties'
--      AND fvp.record_id = g.property_id::text AND fvp.field_name='noi'
--      AND fvp.authority_source='confirmed_document';
-- ============================================================================
