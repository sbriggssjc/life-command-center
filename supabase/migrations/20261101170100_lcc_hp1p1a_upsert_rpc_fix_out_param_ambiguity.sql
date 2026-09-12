-- ============================================================================
-- HP1-P1a-fix, CORRECTION (applied live 2026-09-12) — the shipped RPC could
-- never have run.
-- ----------------------------------------------------------------------------
-- 20261101170000_lcc_hp1p1a_opportunity_upsert_rpc.sql declared OUT parameters
-- named `sf_opp_id` and `entity_id`. Both collide with columns of the same name
-- on public.bd_opportunities. A plpgsql body is NOT parsed at CREATE time, so
-- that migration applied cleanly and then raised, on the first execution:
--
--   ERROR: 42702: column reference "sf_opp_id" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- i.e. it would have failed on all 608 deals of every 30-minute run — a second
-- total-failure of exactly the shape HP1-P1a-fix exists to eliminate, and one
-- an HTTP 200 would again have hidden. Caught by a rolled-back probe BEFORE the
-- first live run (Class 11 / "verify on UPDATED_not_inserted, never on a 200").
--
-- Two changes, both mechanical:
--   1. OUT params renamed `out_sf_opp_id` / `out_entity_id`. The only caller,
--      mcp/opportunity-sync.js::processDeal, reads `outcome`, `reason` and
--      `bd_opportunity_id` only, so the wire contract is unchanged and no JS
--      change is required.
--   2. The INSERT target is aliased `AS t` so `t.closed_at` / `t.closed_won`
--      (Unit 4's preserve-once-set COALESCE) and `RETURNING t.id` resolve
--      unambiguously.
--
-- LIVE PROOF (rolled back, 2026-09-12, sf_opp_id 00TVs00001J3iCfMAJ):
--   outcome='updated', stage 'identified' -> 'PROBE_ROLLED_BACK',
--   closed_at NULL -> set, closed_won NULL -> true, last_synced_at advanced.
--   A payload with no workspace_id/sf_opp_id returns outcome='skipped'.
--
-- Discipline unchanged: SECURITY DEFINER, service_role only, asserted below.
-- ============================================================================

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

    SELECT true INTO v_existed
    FROM public.bd_opportunities b
    WHERE b.workspace_id = v_ws AND b.sf_opp_id = v_sf;
    IF NOT FOUND THEN v_existed := false; END IF;

    INSERT INTO public.bd_opportunities AS t (
      workspace_id, entity_id, sf_opp_id, deal_name, property_address, stage,
      amount, expected_close_date, closed_at, closed_won, owner_user_id,
      vertical, last_synced_at, metadata
    ) VALUES (
      v_ws,
      v_entity,
      v_sf,
      v_deal->>'deal_name',
      v_deal->>'property_address',
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
      property_address    = EXCLUDED.property_address,
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

DO $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.lcc_upsert_bd_opportunities(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_upsert_bd_opportunities: service_role EXECUTE grant did not take';
  END IF;
  IF has_function_privilege('anon', 'public.lcc_upsert_bd_opportunities(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_upsert_bd_opportunities: anon must NOT be able to execute this (mutating)';
  END IF;
  IF has_function_privilege('authenticated', 'public.lcc_upsert_bd_opportunities(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_upsert_bd_opportunities: authenticated must NOT be able to execute this (mutating)';
  END IF;
END $$;

COMMENT ON FUNCTION public.lcc_upsert_bd_opportunities(jsonb) IS
  'HP1-P1a-fix: single INSERT ... ON CONFLICT (workspace_id, sf_opp_id) DO UPDATE '
  'per jsonb array element, replacing the PostgREST upsert whose '
  'Prefer: resolution=merge-duplicates header was mangled to the literal string '
  '"[object Object]" by the standalone MCP''s opsQuery(prefer:string) signature. '
  'OUT params carry an out_ prefix because sf_opp_id/entity_id collide with table '
  'columns and raise 42702 at runtime. Preserves closed_at/closed_won once set. '
  'Returns inserted/updated/skipped per row so the caller counts honestly instead '
  'of trusting an HTTP 200.';
