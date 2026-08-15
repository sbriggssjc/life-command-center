-- Prompt 113 / BREAK-3 — expose the owner IDs on the gov portfolio owner-facts view.
--
-- WHY. LCC's asset->owner reconciliation (lcc_property_owner) was resolving only
-- 1,396 of 3,886 assets (35.9%). 1,699 of the unresolved assets DO carry a domain
-- owner, but the LCC mirror (lcc_property_owner_facts) only ever carried the owner
-- NAME -- so the only way to turn a domain owner into an LCC owner ENTITY was a
-- fuzzy name match. Name matching for IDENTITY is the documented footgun (LCC
-- CLAUDE.md: "Realty Income Corporation" strict-cores to the empty string; "Agree
-- Realty Corp" / "Agree Holdings LLC" both score 1.0). The ID is already the
-- canonical join -- external_identities(source_system='gov', source_type='true_owner',
-- external_id = true_owners.true_owner_id) -- so exposing the ID makes the feeder
-- DETERMINISTIC and removes name matching from the path entirely.
--
-- DISCIPLINE. Additive, view-only, reversible (re-create the prior body, kept in the
-- REVERSAL RUNBOOK below). No table DDL, no RLS change: BD columns go on the
-- anon-readable portfolio view, never on the RLS-protected base table (gov CLAUDE.md).
--
-- FOOTGUN OBSERVED: `CREATE OR REPLACE VIEW` is append-only for columns (Postgres
-- 42P16 if a column is inserted mid-list). Every new column is appended at the END
-- of the SELECT, after `updated_at`, and the existing five columns keep their exact
-- position, name and expression so the running mirror is unaffected.

CREATE OR REPLACE VIEW public.v_property_owner_facts_portfolio AS
 SELECT p.property_id,
    ro.name AS recorded_owner_name,
    to2.name AS true_owner_name,
    p.developer AS developer_name,
    GREATEST(p.updated_at, ro.updated_at, to2.updated_at) AS updated_at,
    -- ── Prompt 113 additive columns (append-only: new columns at the END) ──
    p.recorded_owner_id,
    p.true_owner_id,
    -- Follow one merge hop. `apply_owner_merge` retires a loser by stamping
    -- merged_into_true_owner_id rather than repointing every property, so a
    -- property can still reference a merged-away owner (1,213 gov rows carry the
    -- pointer). Resolving it here means LCC joins the SURVIVOR, not a dead shell.
    COALESCE(to2.merged_into_true_owner_id, p.true_owner_id) AS true_owner_effective_id,
    -- gov has no operator/tenant conflation: the tenant is a federal agency and is
    -- never written into true_owners. dia DOES (true_owners.is_operator_not_owner),
    -- so the column exists on both sides with the same name and the LCC feeder can
    -- apply one guard for both domains. Constant false here, deliberately.
    false AS true_owner_is_operator
   FROM properties p
     LEFT JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
     LEFT JOIN true_owners to2 ON to2.true_owner_id = p.true_owner_id
  WHERE COALESCE(p.status, 'active'::text) <> 'archived'::text;

GRANT SELECT ON public.v_property_owner_facts_portfolio TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_property_owner_facts_portfolio IS
  'Anon-readable owner facts for the LCC mirror. Prompt 113 appended '
  'recorded_owner_id / true_owner_id / true_owner_effective_id (one merge hop) / '
  'true_owner_is_operator so LCC can join owner ENTITIES by id instead of by name. '
  'Columns are append-only -- never insert one mid-list (42P16).';

-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSAL RUNBOOK
--   CREATE OR REPLACE VIEW public.v_property_owner_facts_portfolio AS
--    SELECT p.property_id, ro.name AS recorded_owner_name, to2.name AS true_owner_name,
--           p.developer AS developer_name,
--           GREATEST(p.updated_at, ro.updated_at, to2.updated_at) AS updated_at
--      FROM properties p
--      LEFT JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
--      LEFT JOIN true_owners to2 ON to2.true_owner_id = p.true_owner_id
--     WHERE COALESCE(p.status,'active') <> 'archived';
--   -- Dropping columns requires DROP VIEW first (CREATE OR REPLACE cannot remove
--   -- columns); drop and re-create with the body above.
-- ─────────────────────────────────────────────────────────────────────────────
