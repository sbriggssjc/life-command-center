-- ============================================================================
-- HP1-P1a-fix (2026-11-01) — the SF opportunity upsert has NEVER updated a row.
-- ----------------------------------------------------------------------------
-- Diagnosed live (docs/claude-code/prompts/HP1-P1a-fix-opportunity-upsert-never-updated.md):
-- `SF Deal -> LCC Opportunity Sync` posts 608 records every 30 minutes, every
-- POST returns HTTP 200, and Postgres logs show 608x
-- "duplicate key value violates unique constraint bd_opportunities_workspace_id_sf_opp_id_key"
-- in the same second — i.e. the write reaches PostgREST as a PLAIN INSERT, never
-- the intended `ON CONFLICT (workspace_id, sf_opp_id) DO UPDATE`.
--
-- MECHANISM (Unit 1, read from source rather than re-probed live — the fix does
-- not depend on this answer, per the prompt's own time-box): mcp/opportunity-sync.js
-- called `opsQuery('POST', 'bd_opportunities?on_conflict=...', row,
-- { Prefer: 'resolution=merge-duplicates,return=representation' })`. That fourth
-- argument is a single OBJECT. mcp/opportunity-sync.js is mounted on TWO
-- incompatible opsQuery signatures: `api/_shared/ops-db.js`'s
-- opsQuery(method, path, body, opts) treats a plain `{Prefer: ...}` object as
-- legacy headers (correct); the standalone MCP's own
-- `mcp/server.js::opsQuery(method, path, body, prefer)` treats the 4th arg as a
-- single STRING it interpolates directly as the header value
-- (`Prefer: prefer || 'return=representation'`) — handed an object, undici's
-- Headers coerces it to the literal string "[object Object]", which PostgREST
-- cannot parse as a Prefer directive, so PostgREST silently falls back to a
-- plain INSERT with no ON CONFLICT handling. This migration removes the
-- dependency on that header entirely rather than reconciling the two
-- signatures — this repo's own standing rule
-- ("PostgREST's write surface is NARROWER than SQL's ... use an RPC taking a
-- jsonb array, not a PostgREST upsert") applies verbatim.
--
-- Discipline: SECURITY DEFINER, service_role only (never anon/authenticated —
-- SEC1-definer-default). Idempotent (ON CONFLICT DO UPDATE). Reversible: this
-- migration changes no data, only adds a function + a one-time pre-fix
-- snapshot table (see below). `processDeal` (mcp/opportunity-sync.js) is the
-- only caller.
--
-- Snapshot: per the prompt's caution ("608 rows change at once, six weeks of
-- stage drift lands in a single batch, and it is the first UPDATE this table
-- has ever taken from this path"), a one-time backup of bd_opportunities is
-- taken here, before this fix's first live run can touch a row.
-- Reverse a stage/close-date regression by comparing against
-- `_hp1_p1a_bd_opportunities_pre_fix_backup` (never auto-restored — read,
-- diff, and hand-repair any row that regressed).
-- 
-- ⚠️ SUPERSEDED IN PART by 20261101170100_..._fix_out_param_ambiguity.sql.
-- The function below declares OUT params `sf_opp_id` and `entity_id`, which
-- collide with columns of the same name and raise 42702 at RUNTIME (a plpgsql
-- body is not parsed at CREATE time). This migration applies cleanly and the
-- function then fails on every call. The next migration drops and recreates it.
-- Do not copy this function definition forward.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public._hp1_p1a_bd_opportunities_pre_fix_backup AS
SELECT b.*, now() AS backed_up_at
FROM public.bd_opportunities b;

COMMENT ON TABLE public._hp1_p1a_bd_opportunities_pre_fix_backup IS
  'HP1-P1a-fix: one-time snapshot of bd_opportunities taken immediately before '
  'the opportunity-upsert-never-updated fix''s first live run. Read-only '
  'reference for diffing what the first correct UPDATE pass changed. Never '
  'auto-restored.';

-- ----------------------------------------------------------------------------
-- lcc_upsert_bd_opportunities(p_deals jsonb)
--
-- Takes a jsonb ARRAY of already-resolved bd_opportunities row shapes (the
-- `row` object `processDeal` already builds: workspace_id, entity_id,
-- sf_opp_id, deal_name, property_address, stage, amount,
-- expected_close_date, closed_at, closed_won, owner_user_id, vertical,
-- last_synced_at, metadata) and performs ONE INSERT ... ON CONFLICT
-- (workspace_id, sf_opp_id) DO UPDATE per element, returning a per-row
-- outcome so the caller can count honestly (never trust an HTTP 200 alone —
-- CLAUDE.md's standing rule, re-earned by this exact defect).
--
-- Unit 4 (never re-stamp a real close date): `closed_at` and `closed_won` are
-- preserved once set — COALESCE(existing, incoming) — so a deal that is
-- already closed keeps its ORIGINAL close timestamp on every future sync
-- instead of being overwritten with "now()" on each 30-minute pass. They are
-- only ever set on the genuine transition into closed (existing NULL,
-- incoming non-null).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_upsert_bd_opportunities(p_deals jsonb)
RETURNS TABLE(
  sf_opp_id text,
  outcome text,             -- 'inserted' | 'updated' | 'skipped'
  reason text,               -- populated only when outcome = 'skipped'
  bd_opportunity_id uuid,
  entity_id uuid
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
      sf_opp_id := v_sf;
      outcome := 'skipped';
      reason := 'missing_workspace_id_or_sf_opp_id';
      bd_opportunity_id := NULL;
      entity_id := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_entity := NULLIF(v_deal->>'entity_id', '')::uuid;

    -- Was this (workspace_id, sf_opp_id) already on file? Determines
    -- inserted vs updated for the honest count; the WRITE itself is a single
    -- statement below (no read-then-write race).
    SELECT true INTO v_existed
    FROM public.bd_opportunities b
    WHERE b.workspace_id = v_ws AND b.sf_opp_id = v_sf;
    IF NOT FOUND THEN v_existed := false; END IF;

    INSERT INTO public.bd_opportunities (
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
      -- Unit 4: preserve an existing non-null closed_at/closed_won; set only
      -- on the genuine transition into closed.
      closed_at           = COALESCE(bd_opportunities.closed_at, EXCLUDED.closed_at),
      closed_won          = COALESCE(bd_opportunities.closed_won, EXCLUDED.closed_won),
      owner_user_id       = EXCLUDED.owner_user_id,
      vertical            = EXCLUDED.vertical,
      last_synced_at      = EXCLUDED.last_synced_at,
      metadata            = EXCLUDED.metadata,
      updated_at          = now()
    RETURNING id INTO v_row_id;

    sf_opp_id := v_sf;
    bd_opportunity_id := v_row_id;
    entity_id := v_entity;
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
  'Prefer: resolution=merge-duplicates header was being silently mangled to the '
  'literal string "[object Object]" by the standalone MCP''s opsQuery(prefer:string) '
  'signature. Preserves closed_at/closed_won once set (never re-stamps a real '
  'close date on a later sync). Returns inserted/updated/skipped per row so the '
  'caller can count honestly instead of trusting an HTTP 200.';
