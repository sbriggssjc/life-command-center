-- ============================================================================
-- R55 Unit 2 (2026-06-20): one unified, value-ranked BD worklist.
--
-- The eight rounds R46-R54 each built a BD signal but in separate lanes/views.
-- This view is the LCC-resident UNION of the two signal sources that live ON
-- LCC Opps, normalized to one shape the operator works top-down (value-first):
--   contact_writeback (R52 v_lcc_contact_writeback_candidates) — push contact to CRM
--   ownership_chain   (R46 v_ownership_chain_worklist)         — resolve to developer
--
-- The OTHER three signal classes — loan_maturity (R54 v_loan_maturity_watch),
-- suspected_sale (R53 v_suspected_sale), owner_source_conflict (R51 workable
-- subset) — live on the DOMAIN DBs (gov/dia), not LCC Opps. A single SQL view
-- cannot union them without a cross-DB MIRROR, and a mirror would be a
-- RECOMPUTE (forbidden by the round scope — "union the existing sources, do not
-- recompute"). So they are merged into the worklist at the API boundary
-- (api/operations.js getBdWorklist fans out to the domain views and merges them
-- with this view, ranking across all five by $ value). This view is the
-- LCC-side half of that union + a stable SQL artifact for any pure-SQL consumer.
--
-- READ-ONLY / additive. security_invoker so it respects the caller's RLS.
-- DROP VIEW -> zero trace. Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.v_lcc_bd_worklist
WITH (security_invoker = true) AS
-- ── contact_writeback (R52) ─────────────────────────────────────────────────
SELECT
  'contact_writeback'::text          AS signal_type,
  cw.domain::text                    AS source_domain,
  NULL::text                         AS property_id,
  cw.entity_id                       AS entity_id,
  cw.workspace_id                    AS workspace_id,
  'Push contact to Salesforce'::text AS what,
  cw.name                            AS who,
  cw.rank_value::numeric             AS rank_value,
  cw.rank_property_count::int        AS rank_property_count,
  NULL::text AS address, NULL::text AS city, NULL::text AS state,
  jsonb_build_object(
    'email',         cw.email,
    'company',       cw.company,
    'sf_account_id', cw.sf_account_id
  )                                  AS detail
FROM public.v_lcc_contact_writeback_candidates cw
UNION ALL
-- ── ownership_chain (R46) ───────────────────────────────────────────────────
SELECT
  'ownership_chain'::text                         AS signal_type,
  ch.source_domain::text                          AS source_domain,
  ch.source_property_id::text                     AS property_id,
  ch.current_owner_entity_id                      AS entity_id,
  ch.workspace_id                                 AS workspace_id,
  'Resolve ownership chain to developer'::text    AS what,
  ch.current_owner_name                           AS who,
  ch.rank_value::numeric                          AS rank_value,
  NULL::int                                       AS rank_property_count,
  ch.address, ch.city, ch.state,
  jsonb_build_object(
    'gap',                     ch.gap,
    'suggested_research_type', ch.suggested_research_type,
    'true_owner_name',         ch.true_owner_name,
    'developer_name',          ch.developer_name
  )                                               AS detail
FROM public.v_ownership_chain_worklist ch;

COMMENT ON VIEW public.v_lcc_bd_worklist IS
  'R55 Unit 2: LCC-resident half of the unified BD worklist (contact_writeback + ownership_chain), value-ranked. Domain-resident signals (loan_maturity / suspected_sale / owner_source_conflict) merge at the api/operations.js getBdWorklist boundary.';

GRANT SELECT ON public.v_lcc_bd_worklist TO authenticated, service_role;

COMMIT;
