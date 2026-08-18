-- ===========================================================================
-- P128 -- seed cadences on the top seller prospects we were not pursuing
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- ===========================================================================
-- P127 measured the gap: 312 real, reachable owners carrying $97.6M of annual
-- rent with NO cadence. This puts them on one, so the outreach machine points at
-- the biggest owners in gov + dia rather than at whoever happened to be in
-- Salesforce.
--
-- CONSUMPTION-LAYER CHECK (a new producer needs all five):
--   1. VALUE-GATED    portfolio rent > 0 and >= p_min_rent -- the measured top
--                     owners, not one row per captured party.
--   2. NAMED CONSUMER Scott works them; the 7-touch arc in cadence-engine.js
--                     already governs everything after seeding.
--   3. AUTO-RETIRE    the existing P112 sweeps already cover these rows; nothing
--                     new needed, nothing bypassed.
--   4. RANKED/CAPPED  p_limit caps a run; v_lcc_top_seller_prospects is the
--                     value-ranked surface.
--   5. HONEST COUNTS  every seeded row is a reachable owner with real rent, so
--                     the cadence badge stays actionable work.
--
-- GATES, all reusing single existing definitions rather than new ones:
--   * reachability precondition (P112) -- never seed a party who can never
--     advance and would only age into "overdue".
--   * brokerage / operator / junk exclusions inherited from
--     v_lcc_top_seller_prospects.
--   * NOT EXISTS a cadence on the entity -- fill-blanks, never a second row.
--
-- TIER from the spec ("Tier A: ... or high portfolio value"):
--   rent >= p_tier_a_rent (default $1M) -> A, else B. Tier A runs the arc 30%
--   faster via TIER_MULTIPLIERS. No Tier C: an owner with real rent is not
--   "research phase".
--
-- SCHEDULE: current_touch 0, next_touch_due = now() -- Touch 1 due immediately,
-- engine owns every later date. Deliberately NOT back-dated; these are new
-- pursuits and inventing history would corrupt the arc.
--
-- owner_user_id LEFT NULL ON PURPOSE: touchpoint_cadence.owner_user_id FKs
-- public.users(id) while lcc_users(lcc_user_id) is a DIFFERENT id space --
-- stamping the wrong one FK-violates every row (the documented P116 collision).
-- Assignment goes through v_lcc_entity_point_person as a separate step.
--
-- VERIFIED LIVE: 312 seeded (Tier A 12 / Tier B 300), all 312 reachable,
-- v_lcc_top_seller_prospects READY count 312 -> 0, re-run seeds nothing,
-- prospecting cadences 241 -> 553. The 2 entities holding two cadences each
-- (Starwood Capital, Boyd Watterson) are PRE-EXISTING -- neither was seeded here;
-- each has one row with an sf_contact_id and one without, which the unique index
-- permits. Worth a separate cleanup.
--
-- REVERSAL: DELETE FROM touchpoint_cadence WHERE metadata->>'seeded_by'='p128';
-- ===========================================================================

CREATE OR REPLACE FUNCTION lcc_seed_top_prospect_cadences(
  p_dry_run     boolean DEFAULT true,
  p_limit       int     DEFAULT NULL,
  p_min_rent    numeric DEFAULT 0,
  p_tier_a_rent numeric DEFAULT 1000000
)
RETURNS TABLE(verdict text, n bigint, total_rent numeric, largest_rent numeric)
LANGUAGE plpgsql
AS $fn$
#variable_conflict use_column
DECLARE v_seeded bigint := 0;
BEGIN
  CREATE TEMP TABLE _p128 ON COMMIT DROP AS
  SELECT p.entity_id, p.owner_name, p.annual_rent, p.domains,
         CASE WHEN p.annual_rent >= p_tier_a_rent THEN 'A' ELSE 'B' END AS tier,
         CASE
           WHEN p.on_cadence               THEN 'skip_already_pursuing'
           WHEN NOT p.reachable            THEN 'skip_unreachable'
           WHEN p.annual_rent < p_min_rent THEN 'skip_below_floor'
           ELSE 'seed'
         END AS verdict
  FROM public.v_lcc_top_seller_prospects p;

  IF p_limit IS NOT NULL THEN
    DELETE FROM _p128 c
    WHERE c.verdict = 'seed'
      AND c.entity_id NOT IN (
        SELECT entity_id FROM _p128 WHERE verdict = 'seed'
        ORDER BY annual_rent DESC LIMIT p_limit);
  END IF;

  IF NOT p_dry_run THEN
    INSERT INTO public.touchpoint_cadence
      (entity_id, phase, priority_tier, current_touch,
       next_touch_due, next_touch_type, next_touch_template, domain, metadata)
    SELECT c.entity_id, 'prospecting', c.tier, 0,
           now(), 'email', 'T-001',
           NULLIF(split_part(c.domains, '/', 1), ''),
           jsonb_build_object('seeded_by','p128', 'seeded_at', now()::text,
                              'seed_reason','top_seller_prospect_not_pursued',
                              'seed_annual_rent', c.annual_rent)
    FROM _p128 c
    WHERE c.verdict = 'seed'
    ON CONFLICT (COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 COALESCE(sf_contact_id, ''::text))
    DO NOTHING;
    GET DIAGNOSTICS v_seeded = ROW_COUNT;
  END IF;

  RETURN QUERY
  SELECT c.verdict, count(*)::bigint, sum(c.annual_rent), max(c.annual_rent)
  FROM _p128 c GROUP BY c.verdict
  UNION ALL
  SELECT CASE WHEN p_dry_run THEN 'DRY_RUN_no_write' ELSE 'rows_seeded' END,
         CASE WHEN p_dry_run THEN 0::bigint ELSE v_seeded END, NULL::numeric, NULL::numeric;
END;
$fn$;

COMMENT ON FUNCTION lcc_seed_top_prospect_cadences(boolean,int,numeric,numeric) IS
  'P128: seed prospecting cadences on top seller prospects (v_lcc_top_seller_prospects) that are reachable and not yet pursued. Tier A above p_tier_a_rent. Dry-run default. Reverse: DELETE FROM touchpoint_cadence WHERE metadata->>''seeded_by''=''p128''.';
