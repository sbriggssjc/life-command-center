-- ============================================================================
-- SF-BRIDGE1 (2026-09-23) — our own Salesforce deals arrive with a TYPE, and a
-- stored property address is never erased by the next sync.
-- ----------------------------------------------------------------------------
-- Measured before this migration (LCC Opps, 2026-09-23):
--   * 610 bd_opportunities carry a Salesforce Opportunity id (006…). ALL 610
--     read type IS NULL — 35 of them open (listing_signed 11, off_market_listing
--     8, bov 7, non_refundable 3, qualified_lead 3, loi_executed 2, in_escrow 1).
--   * 0 of 610 carry property_address.
-- Cause: the only writer, mcp/opportunity-sync.js → lcc_upsert_bd_opportunities,
-- never sent `type`, and the RPC had no `type` column in its INSERT at all.
-- Every consumer that asks "is there a deal here?" keys on type='prospect' /
-- 'government_buyer' (v_bd_open_prospect_opportunities, v_priority_queue_live,
-- lcc_open_prospect_opportunity, the property panel's resolveOwnerOppState …),
-- so a live Salesforce listing was invisible and the panel could offer
-- "Create the lead" on it.
--
-- Three changes:
--   1. The CHECK vocabulary gains the Salesforce deal types:
--        listing | bov | buy_side | sf_deal   (sf_deal = side not stated).
--      Every existing consumer names its type explicitly, so no consumer's
--      population moves (census: 12 views/functions, all `type = '<literal>'`).
--   2. lcc_upsert_bd_opportunities writes `type` (only a Salesforce deal type;
--      an LCC-owned type — prospect/buyer/other/government_buyer — is never
--      overwritten) and keeps a stored property_address when the payload has
--      none (fill-forward). The sync runs every 30 minutes over all ~608 deals;
--      without (2) any address written by anyone would be erased within 30 min.
--   3. Backfill `type` from the stored stage for the NULL rows, logged and
--      reversible. The sync refines it on its next run (a deal at a contractual
--      stage with a staged Salesforce Listing__c becomes 'listing') and fills
--      the address from the Salesforce staging tables — one writer, not two.
--
-- Deploy order: this migration is additive and safe BEFORE the JS: the old sync
-- sends no `type`, and the new RPC keeps the stored (backfilled) value.
-- ============================================================================

-- 1. Vocabulary ---------------------------------------------------------------
ALTER TABLE public.bd_opportunities DROP CONSTRAINT IF EXISTS bd_opportunities_type_check;
ALTER TABLE public.bd_opportunities ADD CONSTRAINT bd_opportunities_type_check
  CHECK (type IS NULL OR type = ANY (ARRAY[
    'prospect','buyer','other','government_buyer',          -- LCC-owned
    'listing','bov','buy_side','sf_deal'                     -- Salesforce deal (SF-BRIDGE1)
  ]));

-- 2. Upsert RPC ---------------------------------------------------------------
DROP FUNCTION IF EXISTS public.lcc_upsert_bd_opportunities(jsonb);

CREATE FUNCTION public.lcc_upsert_bd_opportunities(p_deals jsonb)
RETURNS TABLE(
  out_sf_opp_id text,
  outcome text,             -- 'inserted' | 'updated' | 'skipped'
  reason text,              -- populated only when outcome = 'skipped'
  bd_opportunity_id uuid,
  out_entity_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deal jsonb;
  v_ws uuid;
  v_sf text;
  v_entity uuid;
  v_type text;
  v_row_id uuid;
  v_existed boolean;
BEGIN
  FOR v_deal IN SELECT * FROM jsonb_array_elements(COALESCE(p_deals, '[]'::jsonb))
  LOOP
    v_ws := NULLIF(v_deal->>'workspace_id', '')::uuid;
    v_sf := NULLIF(v_deal->>'sf_opp_id', '');

    IF v_ws IS NULL OR v_sf IS NULL THEN
      out_sf_opp_id := v_sf;
      outcome := 'skipped';
      reason := 'missing_workspace_id_or_sf_opp_id';
      bd_opportunity_id := NULL;
      out_entity_id := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_entity := NULLIF(v_deal->>'entity_id', '')::uuid;
    -- Only a Salesforce deal type is accepted from this writer.
    v_type := NULLIF(v_deal->>'type', '');
    IF v_type IS NOT NULL AND v_type <> ALL (ARRAY['listing','bov','buy_side','sf_deal']) THEN
      v_type := NULL;
    END IF;

    SELECT true INTO v_existed
    FROM public.bd_opportunities b
    WHERE b.workspace_id = v_ws AND b.sf_opp_id = v_sf;
    IF NOT FOUND THEN v_existed := false; END IF;

    INSERT INTO public.bd_opportunities AS t (
      workspace_id, entity_id, sf_opp_id, deal_name, property_address, type, stage,
      amount, expected_close_date, closed_at, closed_won, owner_user_id,
      vertical, last_synced_at, metadata
    ) VALUES (
      v_ws,
      v_entity,
      v_sf,
      v_deal->>'deal_name',
      NULLIF(btrim(COALESCE(v_deal->>'property_address', '')), ''),
      v_type,
      v_deal->>'stage',
      NULLIF(v_deal->>'amount', '')::numeric,
      NULLIF(v_deal->>'expected_close_date', '')::date,
      NULLIF(v_deal->>'closed_at', '')::timestamptz,
      NULLIF(v_deal->>'closed_won', '')::boolean,
      NULLIF(v_deal->>'owner_user_id', '')::uuid,
      v_deal->>'vertical',
      COALESCE(NULLIF(v_deal->>'last_synced_at', '')::timestamptz, now()),
      COALESCE(v_deal->'metadata', '{}'::jsonb)
    )
    ON CONFLICT (workspace_id, sf_opp_id) DO UPDATE SET
      entity_id           = EXCLUDED.entity_id,
      deal_name           = EXCLUDED.deal_name,
      -- SF-BRIDGE1: fill-forward — a payload with no address keeps the stored one.
      property_address    = COALESCE(EXCLUDED.property_address, t.property_address),
      -- SF-BRIDGE1: an LCC-owned lane type is never overwritten; a NULL never erases.
      type                = CASE
                              WHEN t.type IN ('prospect','buyer','other','government_buyer') THEN t.type
                              ELSE COALESCE(EXCLUDED.type, t.type)
                            END,
      stage               = EXCLUDED.stage,
      amount              = EXCLUDED.amount,
      expected_close_date = EXCLUDED.expected_close_date,
      closed_at           = COALESCE(t.closed_at, EXCLUDED.closed_at),
      closed_won          = COALESCE(t.closed_won, EXCLUDED.closed_won),
      owner_user_id       = EXCLUDED.owner_user_id,
      vertical            = EXCLUDED.vertical,
      last_synced_at      = EXCLUDED.last_synced_at,
      metadata            = EXCLUDED.metadata,
      updated_at          = now()
    RETURNING t.id INTO v_row_id;

    out_sf_opp_id := v_sf;
    bd_opportunity_id := v_row_id;
    out_entity_id := v_entity;
    outcome := CASE WHEN v_existed THEN 'updated' ELSE 'inserted' END;
    reason := NULL;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_upsert_bd_opportunities(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_upsert_bd_opportunities(jsonb) TO service_role;

-- 3. Logged, reversible backfill of `type` from the stored stage ----------------
CREATE TABLE IF NOT EXISTS public.lcc_sf_bridge1_type_backfill_log (
  id                bigserial PRIMARY KEY,
  batch             text        NOT NULL,
  bd_opportunity_id uuid        NOT NULL,
  sf_opp_id         text,
  stage             text,
  old_type          text,
  new_type          text        NOT NULL,
  logged_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lcc_sf_bridge1_type_backfill_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lcc_sf_bridge1_type_backfill_log FROM public, anon, authenticated;

-- Mirrors deriveDealType() in mcp/opportunity-sync.js for the stage-only case
-- (the SQL side cannot see the domain DBs' Listing__c staging; the sync refines).
CREATE OR REPLACE FUNCTION public.lcc_sf_deal_type_from_stage(p_stage text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_stage = 'bov' THEN 'bov'
    WHEN p_stage IN ('listing_signed','off_market_listing','ela') THEN 'listing'
    ELSE 'sf_deal'
  END
$$;

CREATE OR REPLACE FUNCTION public.lcc_sf_bridge1_backfill_type(p_dry_run boolean DEFAULT true,
                                                               p_batch text DEFAULT 'sf_bridge1_20260923')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_open int; v_all int; v_by jsonb;
BEGIN
  SELECT count(*) FILTER (WHERE is_open), count(*),
         COALESCE(jsonb_object_agg(k, n), '{}'::jsonb)
    INTO v_open, v_all, v_by
  FROM (
    SELECT is_open, public.lcc_sf_deal_type_from_stage(stage) AS k,
           count(*) OVER (PARTITION BY public.lcc_sf_deal_type_from_stage(stage)) AS n
    FROM public.bd_opportunities
    WHERE type IS NULL AND sf_opp_id LIKE '006%'
  ) s;

  IF NOT p_dry_run THEN
    WITH upd AS (
      UPDATE public.bd_opportunities o
         SET type = public.lcc_sf_deal_type_from_stage(o.stage), updated_at = now()
       WHERE o.type IS NULL AND o.sf_opp_id LIKE '006%'
      RETURNING o.id, o.sf_opp_id, o.stage, o.type
    )
    INSERT INTO public.lcc_sf_bridge1_type_backfill_log (batch, bd_opportunity_id, sf_opp_id, stage, old_type, new_type)
    SELECT p_batch, id, sf_opp_id, stage, NULL, type FROM upd;
  END IF;

  RETURN jsonb_build_object('dry_run', p_dry_run, 'batch', p_batch,
                            'rows', v_all, 'open_rows', v_open, 'by_type', v_by);
END;
$$;

-- Reverse: restore the logged old_type (NULL) for a batch — only where the row
-- still carries the value this batch wrote (a later sync refinement is kept).
CREATE OR REPLACE FUNCTION public.lcc_sf_bridge1_unbackfill_type(p_batch text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_n int;
BEGIN
  UPDATE public.bd_opportunities o
     SET type = l.old_type, updated_at = now()
    FROM public.lcc_sf_bridge1_type_backfill_log l
   WHERE l.batch = p_batch AND l.bd_opportunity_id = o.id AND o.type = l.new_type;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_sf_bridge1_backfill_type(boolean, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.lcc_sf_bridge1_unbackfill_type(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_sf_bridge1_backfill_type(boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_sf_bridge1_unbackfill_type(text) TO service_role;

SELECT public.lcc_sf_bridge1_backfill_type(false, 'sf_bridge1_20260923');

-- Privilege assertions (SEC1: read the privilege, never the GRANT just written).
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.lcc_upsert_bd_opportunities(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.lcc_upsert_bd_opportunities(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_upsert_bd_opportunities must not be anon/authenticated executable';
  END IF;
  IF has_function_privilege('anon', 'public.lcc_sf_bridge1_backfill_type(boolean, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.lcc_sf_bridge1_backfill_type(boolean, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.lcc_sf_bridge1_unbackfill_type(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.lcc_sf_bridge1_unbackfill_type(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SF-BRIDGE1 backfill functions must not be anon/authenticated executable';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.lcc_upsert_bd_opportunities(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_upsert_bd_opportunities: service_role EXECUTE grant did not take';
  END IF;
  IF (SELECT count(*) FROM public.bd_opportunities WHERE type IS NULL AND sf_opp_id LIKE '006%') <> 0 THEN
    RAISE EXCEPTION 'SF-BRIDGE1 backfill left Salesforce deals with type NULL';
  END IF;
END $$;
