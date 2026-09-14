-- Prompt 113 / BREAK-3 — expose the owner IDs (and the OPERATOR flag) on the dia
-- portfolio owner-facts view. gov companion:
-- supabase/migrations/government/20260906120000_gov_p113_owner_facts_portfolio_ids.sql
--
-- WHY (see the gov companion for the shared rationale): the LCC mirror carried only
-- the owner NAME, so turning a domain owner into an LCC owner ENTITY required a
-- fuzzy name match. The ID is the canonical join
-- (external_identities(source_system='dia', source_type='true_owner',
-- external_id = true_owners.true_owner_id)), so exposing it makes the feeder
-- deterministic.
--
-- WHY THE OPERATOR FLAG MATTERS MORE HERE THAN ANYWHERE ELSE. dia conflates the
-- OPERATOR with the owner at scale: 7,926 of 11,783 dia properties point at a
-- true_owner row flagged `is_operator_not_owner`, and on the currently-unresolved
-- assets the top domain owner names are "DaVita Inc." (348), "Fresenius Medical
-- Care" (334), "DaVita Kidney Care" (67), "U.S. Renal Care" (31)... A feeder that
-- promoted those would stamp the TENANT as the building owner on hundreds of
-- assets -- precisely what the P0.1 display guard exists to prevent, and what the
-- Prompt 113 brief warns against ("Deed-sourced owners must not stamp the
-- operator/tenant as owner").
--
-- Rather than invent a name-based operator test, this exposes the SAME column the
-- P0.1 display guard already reads: v_ownership_current.true_owner_is_operator
-- (= COALESCE(true_owners.is_operator_not_owner,false)), surfaced in the panel as
-- `own.true_owner_is_operator`. One definition, two consumers.
--
-- DISCIPLINE. Additive, view-only, reversible, no table DDL, no RLS change.
-- FOOTGUN OBSERVED: `CREATE OR REPLACE VIEW` is append-only for columns (42P16) --
-- every new column is appended at the END and the existing five are untouched.

CREATE OR REPLACE VIEW public.v_property_owner_facts_portfolio AS
 SELECT p.property_id,
    ro.name AS recorded_owner_name,
    to2.name AS true_owner_name,
    p.developer AS developer_name,
    GREATEST(p.updated_at, ro.updated_at, to2.updated_at) AS updated_at,
    -- ── Prompt 113 additive columns (append-only: new columns at the END) ──
    p.recorded_owner_id,
    p.true_owner_id,
    -- One merge hop: a property can still reference a merged-away true_owner
    -- (132 dia rows carry merged_into_true_owner_id), so resolve to the survivor.
    COALESCE(to2.merged_into_true_owner_id, p.true_owner_id) AS true_owner_effective_id,
    -- THE operator guard. Same expression as v_ownership_current.true_owner_is_operator.
    COALESCE(to2.is_operator_not_owner, false) AS true_owner_is_operator
   FROM properties p
     LEFT JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
     LEFT JOIN true_owners to2 ON to2.true_owner_id = p.true_owner_id;

GRANT SELECT ON public.v_property_owner_facts_portfolio TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_property_owner_facts_portfolio IS
  'Anon-readable owner facts for the LCC mirror. Prompt 113 appended '
  'recorded_owner_id / true_owner_id / true_owner_effective_id (one merge hop) / '
  'true_owner_is_operator (= true_owners.is_operator_not_owner, the same flag the '
  'P0.1 property-panel display guard reads) so LCC can join owner ENTITIES by id '
  'and never promote an OPERATOR to owner. Columns are append-only (42P16).';

-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSAL RUNBOOK
--   DROP VIEW public.v_property_owner_facts_portfolio;
--   CREATE VIEW public.v_property_owner_facts_portfolio AS
--    SELECT p.property_id, ro.name AS recorded_owner_name, to2.name AS true_owner_name,
--           p.developer AS developer_name,
--           GREATEST(p.updated_at, ro.updated_at, to2.updated_at) AS updated_at
--      FROM properties p
--      LEFT JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
--      LEFT JOIN true_owners to2 ON to2.true_owner_id = p.true_owner_id;
--   GRANT SELECT ON public.v_property_owner_facts_portfolio TO anon, authenticated, service_role;
-- ─────────────────────────────────────────────────────────────────────────────
