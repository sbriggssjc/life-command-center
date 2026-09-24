-- SF-BRIDGE1-opened-at (POSTSHIP-R73, 2026-09-24)
--
-- The SF Deal → LCC Opportunity Sync PA flow sends CreatedDate since round 73,
-- but nothing mapped it: bd_opportunities.opened_at read NULL on 610 of 612
-- Salesforce deals (measured live 2026-09-24). mcp/opportunity-sync.js now sends
-- `opened_at` (normalizeDeal → sfCreatedDate); this RPC writes it.
--
-- Fill-forward only: `opened_at = COALESCE(t.opened_at, EXCLUDED.opened_at)`.
-- A stored value is never overwritten, and a payload without CreatedDate
-- (an older flow version, a Copilot call) never clears one.
--
-- The rest of the body is byte-identical to the live definition read on
-- 2026-09-24 (pg_get_functiondef), which is the 20261102270000 SF-BRIDGE1 body.
--
-- Deploy order: this migration first (additive — an old writer sends no
-- opened_at key and gets NULL, exactly today's behaviour), then the MCP/Railway
-- redeploy of mcp/opportunity-sync.js.

CREATE OR REPLACE FUNCTION public.lcc_upsert_bd_opportunities(p_deals jsonb)
 RETURNS TABLE(out_sf_opp_id text, outcome text, reason text, bd_opportunity_id uuid, out_entity_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      vertical, last_synced_at, metadata, opened_at
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
      COALESCE(v_deal->'metadata', '{}'::jsonb),
      NULLIF(v_deal->>'opened_at', '')::timestamptz
    )
    ON CONFLICT (workspace_id, sf_opp_id) DO UPDATE SET
      entity_id           = EXCLUDED.entity_id,
      deal_name           = EXCLUDED.deal_name,
      property_address    = COALESCE(EXCLUDED.property_address, t.property_address),
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
      opened_at           = COALESCE(t.opened_at, EXCLUDED.opened_at),
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
$function$;

REVOKE ALL ON FUNCTION public.lcc_upsert_bd_opportunities(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_upsert_bd_opportunities(jsonb) TO service_role;

-- Privilege assertions (SEC1: read the privilege, never the GRANT just written).
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.lcc_upsert_bd_opportunities(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.lcc_upsert_bd_opportunities(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_upsert_bd_opportunities must not be anon/authenticated executable';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.lcc_upsert_bd_opportunities(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_upsert_bd_opportunities: service_role EXECUTE grant did not take';
  END IF;
END $$;
