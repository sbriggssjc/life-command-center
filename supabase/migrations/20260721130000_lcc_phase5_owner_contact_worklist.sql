-- UI Phase 5 (2026-06-24) — LCC Opps. The "Owners Missing a Contact" BD worklist.
--
-- The BD spine is owner-centric, but valued owners with NO human to call were
-- surfaced nowhere as a ranked worklist (P-CONTACT only covers cadence-bearing
-- contactless owners; v_owner_active_contact only the bridged-with-domain-signals
-- slice). Grounded live 2026-06-24: 3,826 owners with a current portfolio rollup
-- rent > 0 carry no linked person and no Salesforce Contact; 507 of those ≥ $1M.
-- After the honest exclusions (operator-as-owner, junk-named, buyer-SPE/parent)
-- the clean worklist is 3,521 (358 ≥ $1M).
--
-- Consumption-Layer doctrine: value-GATE (rollup rent > 0), value-RANK
-- (rank_value), auto-RETIRE (a view — once an owner gains a person link / SF
-- Contact it drops out next read, no sweep needed). The surface defaults to the
-- workable ≥$1M top-N with a show-all toggle; counts are actionable, not raw.
--
-- Reuses the CONTACT-SELECTION Slice-1 guards (lcc_is_operator_owner_name) + the
-- R5/R7 buyer registry (lcc_buyer_parents / lcc_buyer_spe_resolved) + the R34
-- value sources (v_entity_portfolio_all rollup, lcc_entity_connected_value). The
-- engine is the existing CONTACT-SELECTION picker (?action=buyer_contacts →
-- select_prospecting_contact) + owner-contact-enrich worker — this is the missing
-- SURFACE, not new acquisition logic. SECURITY INVOKER / additive / read-only.
-- Drop the view → zero trace.

BEGIN;

CREATE OR REPLACE VIEW public.v_owner_contact_worklist
WITH (security_invoker = true) AS
WITH valued AS (
  -- value-GATE: owner entity carrying a current portfolio rollup rent > 0.
  -- Exclusions (honest worklist): dia operator-as-owner artifacts (DaVita/
  -- Fresenius/… — the R8 artifact, reuse the Slice-1 guard) + junk-named entities.
  SELECT pa.entity_id, e.name AS owner_name, e.workspace_id,
         pa.current_annual_rent_total AS rollup,
         pa.current_property_count, pa.primary_domain, pa.is_cross_vertical
  FROM public.v_entity_portfolio_all pa
  JOIN public.entities e ON e.id = pa.entity_id
  WHERE pa.current_annual_rent_total > 0
    AND e.merged_into_entity_id IS NULL
    AND NOT public.lcc_is_operator_owner_name(e.name)
    AND COALESCE((e.metadata->>'junk_name_flagged')::boolean, false) = false
),
linked_person AS (
  -- A real contact: an edge to a person entity via a contact-relationship type.
  SELECT DISTINCT o.entity_id
  FROM valued o
  JOIN public.entity_relationships er
    ON (er.from_entity_id = o.entity_id OR er.to_entity_id = o.entity_id)
   AND er.relationship_type IN ('associated_with','contact_at','works_at')
  JOIN public.entities pe
    ON pe.id = CASE WHEN er.from_entity_id = o.entity_id THEN er.to_entity_id ELSE er.from_entity_id END
   AND pe.entity_type = 'person'
   AND pe.merged_into_entity_id IS NULL
),
sf_contact AS (
  SELECT DISTINCT entity_id FROM public.external_identities
  WHERE source_system = 'salesforce' AND source_type = 'Contact'
)
SELECT
  v.entity_id,
  v.owner_name,
  v.workspace_id,
  -- rank_value: rollup rent, falling back to R17 connected-property value.
  COALESCE(NULLIF(v.rollup, 0), cv.connected_property_value) AS rank_value,
  v.current_property_count AS property_count,
  v.primary_domain,
  v.is_cross_vertical,
  -- enrichment hint (sos_manager_lookup / address_reverse_lookup /
  -- public_company_ir / manual_research) from the CONTACT-SELECTION bench when
  -- the owner is bridged with domain signals; NULL ⇒ acquire/research.
  ac.enrichment_action,
  COALESCE(ac.bench_size, 0) AS bench_size
FROM valued v
LEFT JOIN public.lcc_entity_connected_value cv ON cv.entity_id = v.entity_id
LEFT JOIN public.v_owner_active_contact ac ON ac.entity_id = v.entity_id
WHERE v.entity_id NOT IN (SELECT entity_id FROM linked_person)
  AND v.entity_id NOT IN (SELECT entity_id FROM sf_contact)
  -- buyer SPEs / parents run the P-BUYER buy-side flow, not prospecting (R5).
  AND NOT EXISTS (SELECT 1 FROM public.lcc_buyer_spe_resolved s WHERE s.entity_id = v.entity_id)
  AND NOT EXISTS (SELECT 1 FROM public.lcc_buyer_parents bp WHERE bp.parent_entity_id = v.entity_id)
ORDER BY rank_value DESC NULLS LAST;

GRANT SELECT ON public.v_owner_contact_worklist TO authenticated;

COMMENT ON VIEW public.v_owner_contact_worklist IS
  'UI Phase 5: value-ranked BD worklist of contactless valued owners — owner '
  'entities with a current portfolio rollup rent > 0 (value-gate) that carry NO '
  'linked person (associated_with/contact_at/works_at) AND no Salesforce Contact. '
  'rank_value = rollup rent, fallback R17 connected-property value. Excludes '
  'operator-as-owner / junk-named / buyer-SPE / buyer-parent (P-BUYER handles '
  'those). Auto-retires structurally: an owner that gains a contact drops out '
  'next read. Engine = CONTACT-SELECTION picker + owner-contact-enrich worker. '
  'SECURITY INVOKER, read-only.';

COMMIT;
