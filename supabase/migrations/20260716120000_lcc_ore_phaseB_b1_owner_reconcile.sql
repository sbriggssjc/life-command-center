-- ORE Phase B — B1: assemble + reconcile the authoritative record per owner
-- (2026-07-15, LCC Opps `xengecqvemvfknjvbvrq`).
--
-- Phase A feeds the authoritative NAME + address layer into the DBs (deeds →
-- grantor/grantee + notice addresses; SOS-direct → managing member/agent +
-- principal/mailing; GSA lessor; CoStar owner phone/email). Phase B is the
-- RECONCILE step Scott does manually: for each owner, COMPARE the authoritative
-- record against what the system already holds (Salesforce presence, a resolved
-- control contact) and resolve each owner to ONE traceable source-of-truth state.
--
-- B1 = assembly + comparison. It does NOT re-implement contact acquisition — it
-- CLASSIFIES each owner's reconcile state and ROUTES it to the existing engine
-- (owner-contact-enrich for a resolvable/enrichable owner; contact-acquisition
-- for SF pull; the B2 SF-push for a net-new-to-SF owner). Reuses the Phase-5
-- worklist value-gate + guards, the CONTACT-SELECTION pivot, the R6 owner-facts /
-- Slice-1 signals mirror, and the SF-link bridge (external_identities). Conflicts
-- between an authoritative source and a curated field are NOT re-litigated here —
-- they already ride the field_provenance ladder + the Decision-Center
-- resolve_ownership / owner_source_conflict lanes.
--
-- Two artifacts, both additive + reversible (drop them → zero trace):
--   1. v_lcc_owner_reconcile_candidates — one row per VALUED owner entity with the
--      assembled reconcile signals (SF presence, contact presence, pivot control
--      contact, authoritative-address availability). The compare inputs.
--   2. lcc_owner_reconcile — the traceable per-owner OUTPUT record the worker
--      upserts: reconcile_state + control contact + SF id + a `sources` jsonb trace.
--
-- SECURITY INVOKER view / additive table. No cron here (worker-driven; the cron
-- is scheduled only AFTER the first gated drain, per the artifact-offload lesson).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The reconcile-candidate assembly view (the compare inputs)
-- ---------------------------------------------------------------------------
-- One row per VALUED owner entity (rollup rent > 0), value-ranked, carrying the
-- signals the worker compares. Unlike v_owner_contact_worklist (contactless
-- ONLY), this INCLUDES owners that already have a contact / SF Account — B1 must
-- see them to CONFIRM the connected ones and to detect the net-new-to-SF ones.
CREATE OR REPLACE VIEW public.v_lcc_owner_reconcile_candidates
WITH (security_invoker = true) AS
WITH valued AS (
  SELECT pa.entity_id, e.name AS owner_name, e.workspace_id,
         pa.current_annual_rent_total AS rollup,
         pa.current_property_count, pa.primary_domain, pa.is_cross_vertical,
         -- The owner ENTITY's own CoStar-captured contact fields (Phase A Units
         -- B+D land these directly on the org entity). One authoritative-contact
         -- source that DOES live in LCC (the domain notice/mailing addresses stay
         -- PII-side in the domain DBs; has_reg_address below is the routing hint).
         NULLIF(TRIM(COALESCE(e.email, '')), '')   AS entity_email,
         NULLIF(TRIM(COALESCE(e.phone, '')), '')   AS entity_phone,
         NULLIF(TRIM(COALESCE(e.address, '')), '') AS entity_address,
         e.city AS entity_city, e.state AS entity_state
  FROM public.v_entity_portfolio_all pa
  JOIN public.entities e ON e.id = pa.entity_id
  WHERE pa.current_annual_rent_total > 0
    AND e.merged_into_entity_id IS NULL
    AND NOT public.lcc_is_operator_owner_name(e.name)
    AND COALESCE((e.metadata->>'junk_name_flagged')::boolean, false) = false
),
linked_person AS (
  -- A real human contact in the graph: an edge to a person entity.
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
sf_acct AS (
  -- The owner's Salesforce Account link (CONNECTIVITY #3 bridge). An entity may
  -- carry >1 (a collision the SF-link reconcile surfaces) — take the min for a
  -- deterministic id + a count so the worker can note multiplicity.
  SELECT entity_id, MIN(external_id) AS sf_account_id, COUNT(*) AS n_sf_accounts
  FROM public.external_identities
  WHERE source_system = 'salesforce' AND source_type = 'Account'
  GROUP BY entity_id
)
SELECT
  v.entity_id,
  v.owner_name,
  v.workspace_id,
  COALESCE(NULLIF(v.rollup, 0), cv.connected_property_value) AS rank_value,
  v.current_property_count AS property_count,
  v.primary_domain,
  v.is_cross_vertical,
  -- SF presence
  sa.sf_account_id,
  COALESCE(sa.n_sf_accounts, 0) AS n_sf_accounts,
  -- contact presence: a linked person OR the pivot's resolved+attached contact
  (lp.entity_id IS NOT NULL OR p.active_contact_entity_id IS NOT NULL) AS has_person_contact,
  -- the CONTACT-SELECTION pivot (the resolved control-contact hypothesis)
  p.active_contact_entity_id,
  p.active_contact_name,
  p.active_contact_role,
  p.active_authority_level,
  p.active_source          AS pivot_source,
  p.confidence             AS pivot_confidence,
  -- enrichment routing hint (sos_manager_lookup / address_reverse_lookup /
  -- public_company_ir / manual_research) from the pivot, else the bench view.
  COALESCE(p.enrichment_action, ac.enrichment_action) AS enrichment_action,
  COALESCE(p.bench, ac.bench)      AS bench,
  -- authoritative-address availability
  (v.entity_email IS NOT NULL)     AS entity_has_email,
  (v.entity_phone IS NOT NULL)     AS entity_has_phone,
  (v.entity_address IS NOT NULL)   AS entity_has_address,
  v.entity_address, v.entity_city, v.entity_state,
  -- the domain-side registered/notice address exists (Slice-1 signals mirror,
  -- via the true_owner bridge) — a routing hint; the string stays PII-side.
  COALESCE((
    SELECT bool_or(s.has_reg_address)
    FROM public.external_identities xi
    JOIN public.lcc_owner_contact_signals s
      ON s.source_domain = xi.source_system
     AND s.source_true_owner_id = xi.external_id
    WHERE xi.entity_id = v.entity_id
      AND xi.source_system IN ('dia','gov')
      AND xi.source_type = 'true_owner'
  ), false) AS has_reg_address
FROM valued v
LEFT JOIN public.lcc_entity_connected_value cv ON cv.entity_id = v.entity_id
LEFT JOIN public.owner_contact_pivot p ON p.entity_id = v.entity_id
LEFT JOIN public.v_owner_active_contact ac ON ac.entity_id = v.entity_id
LEFT JOIN linked_person lp ON lp.entity_id = v.entity_id
LEFT JOIN sf_acct sa ON sa.entity_id = v.entity_id
-- buyer SPEs / parents run the P-BUYER buy-side flow, not this prospecting
-- reconcile (matches v_owner_contact_worklist semantics — P-BUYER is their surface).
WHERE NOT EXISTS (SELECT 1 FROM public.lcc_buyer_spe_resolved bs WHERE bs.entity_id = v.entity_id)
  AND NOT EXISTS (SELECT 1 FROM public.lcc_buyer_parents bp WHERE bp.parent_entity_id = v.entity_id)
ORDER BY rank_value DESC NULLS LAST;

GRANT SELECT ON public.v_lcc_owner_reconcile_candidates TO authenticated, service_role;

COMMENT ON VIEW public.v_lcc_owner_reconcile_candidates IS
  'ORE Phase B B1: one row per VALUED owner entity (rollup rent > 0), value-ranked, '
  'with the reconcile compare-signals (SF Account presence, human-contact presence, '
  'CONTACT-SELECTION pivot control contact, entity-carried CoStar contact fields, '
  'domain has_reg_address hint, buyer-SPE flag). Includes owners that already have '
  'a contact/SF (unlike v_owner_contact_worklist) so the worker can CONFIRM the '
  'connected and detect the net-new-to-SF. SECURITY INVOKER, read-only.';

-- ---------------------------------------------------------------------------
-- 2. The traceable per-owner reconcile OUTPUT record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_owner_reconcile (
  entity_id                 uuid PRIMARY KEY REFERENCES public.entities(id) ON DELETE CASCADE,
  reconcile_state           text NOT NULL,   -- see the classifier below
  authoritative_name        text,
  control_contact_entity_id uuid,
  control_contact_name      text,
  control_contact_source    text,            -- pivot | related_person | null
  sf_account_id             text,            -- mapped SF Account (null = absent → net-new)
  has_person_contact        boolean NOT NULL DEFAULT false,
  rank_value                numeric,
  sources                   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- the source trace
  routed_to                 text,            -- the engine this owner is handed off to
  workspace_id              uuid,
  reconciled_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lcc_owner_reconcile_state
  ON public.lcc_owner_reconcile (reconcile_state);
CREATE INDEX IF NOT EXISTS idx_lcc_owner_reconcile_rank
  ON public.lcc_owner_reconcile (rank_value DESC NULLS LAST);

GRANT SELECT ON public.lcc_owner_reconcile TO authenticated, service_role;

COMMENT ON TABLE public.lcc_owner_reconcile IS
  'ORE Phase B B1: the traceable per-owner reconcile OUTPUT the owner-reconcile '
  'worker upserts. reconcile_state classifies the SF-presence-vs-contact comparison '
  '(confirmed_connected / contact_ready_no_sf [net-new to SF, B2] / sf_no_contact / '
  'resolvable_contact / needs_enrichment / unresolvable); `sources` is the ids-only '
  'audit trace of every signal that fired. Reversible: DROP TABLE → zero trace.';

COMMIT;
