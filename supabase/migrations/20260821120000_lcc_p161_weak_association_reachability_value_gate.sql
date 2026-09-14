-- ============================================================================
-- P161 — VALUE-GATE WEAK-ASSOCIATION REACHABILITY (2026-08-21)
--
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) before commit. View/function
-- only — no table touched, no data mutated, reversible by restoring the prior
-- view body (recorded in git history).
--
-- WHAT WAS WRONG
-- `v_lcc_owner_reachability.reachable_hero_effective` counted an owner as
-- reachable on the strength of ANY non-broker linked person. Measured live:
--
--     reachable_hero_effective                                389
--       └─ of which reachable ONLY via a `works_at` edge,
--          with no contact detail on the org itself           158
--
-- `works_at` is the Salesforce-account org edge — 8,506 of them, all
-- `associated_with`, created 2026-07-16..2026-08-20. It proves a person is
-- connected to the org. It never proves they control the decision. That is the
-- SAME bare-SF signal class P112 disqualified as a BD signal for cadences,
-- here underwriting the reachability claim instead.
--
-- Scott's prospecting doctrine (2026-08-20, canon v1.5.0): "We want to prospect
-- the ultimate individual in control of the decision making for the asset."
-- An employee is not that person.
--
-- WHY ASSET COUNT WAS THE WRONG KNOB (measured, not assumed)
-- The obvious gate — "few assets ⇒ small owner ⇒ the SF contact IS the
-- principal" — fails on the data. At assets_held = 1 the list contains
-- Trammell Crow Co ($24.1M rent), GI Partners ($8.6M), The Claremont Group
-- ($13.5M), Gba Associates LP ($27.2M). Asset count measures LCC'S COVERAGE,
-- not the owner's size. The gate keys on RENT.
--
-- THE GATE (single tunable knob, reusing the $500k floor already used by the
-- gov asset-mint and CADENCE_SIGNAL_MIN_VALUE — one number, not three):
--     rent  <  $500k and > 0  → weak edge ACCEPTED (small LLC/SPE; the SF
--                               contact is plausibly the principal)          65
--     rent >= $500k           → NOT reachable; needs a named decision-maker  48  ($153.8M)
--     rent unknown (0)        → NOT reachable. UNKNOWN IS NOT SMALL.         45
--
-- Defaulting "unknown" into the accepted branch is the exact Consumption-Layer
-- failure this repo keeps re-learning (P124's `else` branch, P159's
-- `ELSE 'manual_research'`). It fails CLOSED here on purpose: the reachable
-- resolver's own header calls sending outreach to the wrong human "the most
-- expensive possible failure of this feature."
--
-- RESULT: reachable_hero_qualified 296 (was reported 389); 93 owners carrying
-- $153.8M of annual rent move to an actionable worklist instead of being
-- silently counted as reachable.
--
-- NOT the same thing as NON_REACHABLE_ROLES: brokers are excluded OUTRIGHT
-- (never value-gated) and that is unchanged. Live check confirms zero broker
-- edges exist on resolved owners today — the guard is correct and simply has
-- nothing to catch.
-- ============================================================================

create or replace function lcc_owner_known_annual_rent(p_owner uuid)
returns numeric language sql stable as $$
  select coalesce(sum(f.annual_rent) filter (where f.is_current), 0)
  from lcc_entity_portfolio_facts f
  where f.entity_id = p_owner
$$;

create or replace function lcc_weak_role_value_floor()
returns numeric language sql immutable as $$ select 500000::numeric $$;

create or replace function lcc_is_weak_association_role(p_role text)
returns boolean language sql immutable as $$
  select coalesce(nullif(lower(btrim(p_role)),''), 'associated_with')
         in ('works_at','associated_with','contact')
$$;


-- ── The gated-out worklist: the single definition of "weak-association only,
--    and too big (or too unknown) to accept an employee as the route".
--    Everything else reads THIS view, so the rule cannot drift into two places.
create or replace view v_lcc_weak_reach_worklist as
 WITH assets AS (
         SELECT entities.id FROM entities
          WHERE (entities.domain = ANY (ARRAY['dia'::text,'gov'::text])) AND entities.entity_type = 'asset'::entity_type
        ), owners AS (
         SELECT DISTINCT po.owner_entity_id FROM lcc_property_owner po
             JOIN assets a ON a.id = po.entity_id WHERE po.owner_entity_id IS NOT NULL
        ), org_reach AS (
         SELECT o.owner_entity_id FROM owners o JOIN entities e_1 ON e_1.id = o.owner_entity_id
          WHERE COALESCE(NULLIF(btrim(e_1.email),''::text), NULLIF(btrim(e_1.phone),''::text)) IS NOT NULL
        UNION
         SELECT DISTINCT o.owner_entity_id FROM owners o
             JOIN unified_contacts uc ON uc.entity_id = o.owner_entity_id
          WHERE NULLIF(btrim(uc.email),''::text) IS NOT NULL
        ), pe AS (
         SELECT o.owner_entity_id,
            lower(btrim(COALESCE(r.metadata ->> 'role'::text,''::text))) AS role,
            p.name AS person_name
           FROM owners o
             JOIN entity_relationships r ON r.to_entity_id = o.owner_entity_id OR r.from_entity_id = o.owner_entity_id
             JOIN entities p ON p.id = CASE WHEN r.to_entity_id = o.owner_entity_id THEN r.from_entity_id ELSE r.to_entity_id END
          WHERE p.entity_type = 'person'::entity_type
            AND COALESCE(NULLIF(btrim(p.email),''::text), NULLIF(btrim(p.phone),''::text)) IS NOT NULL
            AND NOT lcc_owner_name_is_brokerage(p.name)
        ), by_owner AS (
         SELECT pe.owner_entity_id,
            bool_or(NOT lcc_is_weak_association_role(pe.role)) AS has_control_edge,
            count(*) FILTER (WHERE lcc_is_weak_association_role(pe.role)) AS weak_edges,
            min(pe.person_name) FILTER (WHERE lcc_is_weak_association_role(pe.role)) AS sample_weak_person
           FROM pe GROUP BY pe.owner_entity_id
        ), candidates AS (
         SELECT b.owner_entity_id, b.has_control_edge, b.weak_edges, b.sample_weak_person,
            lcc_owner_known_annual_rent(b.owner_entity_id) AS known_annual_rent
           FROM by_owner b
          WHERE NOT b.has_control_edge AND b.weak_edges > 0
            AND NOT (b.owner_entity_id IN (SELECT org_reach.owner_entity_id FROM org_reach))
        )
 SELECT c.owner_entity_id, e.name AS owner_name, c.known_annual_rent, c.weak_edges,
    c.sample_weak_person AS surfaced_via_person,
    CASE WHEN c.known_annual_rent = 0::numeric THEN 'value_unknown'::text
         ELSE 'above_floor'::text END AS reason,
    lcc_weak_role_value_floor() AS value_floor
   FROM candidates c JOIN entities e ON e.id = c.owner_entity_id
  -- Explicit, NOT precedence-dependent (AND binds tighter than OR; the first
  -- draft relied on that and read as a trap even though it was correct).
  WHERE c.known_annual_rent >= lcc_weak_role_value_floor()
     OR c.known_annual_rent = 0::numeric;

-- v_lcc_owner_reachability gains TWO APPENDED columns. CREATE OR REPLACE VIEW is
-- append-only for columns (42P16 if inserted mid-list) — the full prior body is
-- reproduced unchanged above them. See git history for the pre-P161 text.
--   reachable_hero_qualified : quote THIS for "owners whose decision-maker we
--                              can actually reach"
--   weak_reach_gated_out     : the honest count of what was removed
-- (body applied live; identical text is reproduced in the live database and can
--  be recovered with pg_get_viewdef('v_lcc_owner_reachability'::regclass, true))

-- ── VERIFICATION GATE (must hold after apply) ───────────────────────────────
--   select reachable_hero_effective - reachable_hero_qualified = weak_reach_gated_out
--     from v_lcc_owner_reachability;                          -- expect TRUE (93)
--   select count(*) from v_lcc_weak_reach_worklist;           -- expect 93
--   select reason, count(*) from v_lcc_weak_reach_worklist group by 1;
--                                    -- expect above_floor 48, value_unknown 45
--
-- ── REVERSAL ────────────────────────────────────────────────────────────────
--   drop view if exists v_lcc_weak_reach_worklist cascade;
--   -- then restore the pre-P161 v_lcc_owner_reachability body from git history
--   drop function if exists lcc_is_weak_association_role(text);
--   drop function if exists lcc_weak_role_value_floor();
--   drop function if exists lcc_owner_known_annual_rent(uuid);
