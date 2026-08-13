-- W9.6 (Prompt 103, 2026-08-13): Path-B PRECISION pass (gate the flip) +
-- folder_feed_lease field_source_priority hygiene. Two independent parts.
--
-- ── PART A — Path-B precision (THE FLIP GATE) ───────────────────────────────
-- The live dry-run (2026-08-13) showed Path A (property_bridge, 3) clean and
-- flip-ready, but Path B (person_match, 40) carried ~23% noise whose LOUDEST
-- cards were the worst:
--   1. INTERNAL-TEAM correspondents (Scott Briggs 828 rows, Toby Scrivner 128)
--      proposed against "Stan Johnson Co" via a loose relationship tie — a
--      NorthMarq/SJC deal-team member is NEVER an owner-attribution subject.
--   2. BROKERAGE/advisor entities mis-modeled as `true_owner` upstream (Avison
--      Young, Newmark, Kidder Mathews, Transwestern, Coldwell Banker …) — a
--      broker at that firm gets attributed to it.
-- A human-gated lane whose loudest cards are a broker's own 828 emails mis-filed
-- to his old firm trains the operator to ignore the lane — the anti-pattern the
-- doctrine forbids. This pass tightens the Path-B RPC deterministically (NO LLM):
--   (a) TIE-TIGHTENING — the `relationship` tier is restricted to ownership /
--       employment roles (works_at/contact_at edges, or metadata->>'role' in the
--       owner/manager set), pruning prospecting/buyer/seller ties BEFORE the
--       unambiguous-single-owner disambiguation. Grounded: the surviving real
--       owners (Boyd Watterson, Kingsbarn, Realty Income, Easterly) all tie via
--       `works_at`, so this keeps them while dropping the non-ownership noise.
--   (b) INTERNAL-TEAM guard — a correspondent whose email is on an own-firm
--       domain (northmarq.com / stanjohnsonco.com) is dropped (`drop_reason =
--       'internal_team'`).
--   (c) BROKERAGE-TARGET guard — an owner whose name matches a conservative,
--       documented brokerage stoplist/token set is dropped (`drop_reason =
--       'brokerage_target'`). This is a KNOWN upstream owner-graph LABELING issue
--       (these entities should not carry a `true_owner` identity at all) — flagged
--       here for a FUTURE ORE cleanup unit; NOT fixed in this migration.
-- The RPC exposes `rel_role` + `drop_reason` and a `p_include_dropped` param:
--   * default (p_include_dropped=false) returns only the CLEAN rows (drop_reason
--     IS NULL) so a direct RPC call is noise-free; and
--   * the tick calls it with p_include_dropped=true to receive the noise rows too
--     (tagged) so it can surface HONEST per-reason drop counters
--     (internal_team_skipped / brokerage_target_skipped / loose_tie_skipped).
-- The planner (api/_shared/comms-owner-attribution.js) mirrors the internal-team
-- and brokerage predicates (defense-in-depth + unit-tested). Path A is UNCHANGED.
--
-- ── PART B — folder_feed_lease provenance hygiene ───────────────────────────
-- The lease folder-feed wrote 5 dia.leases responsibility fields (guaranty_scope,
-- hvac_/parking_/structure_/roof_responsibility) with source 'folder_feed_lease'
-- but there were no field_source_priority rows for (source, table, field), so
-- v_field_provenance_unranked flagged them (drift 34→39). Register them at the
-- established folder_feed_lease rank (45, enforce_mode 'warn' — the same as every
-- other folder_feed_lease lease field: a filed-lease-PDF extraction, above the
-- CoStar/RCA/CREXi aggregators, below manual/lease_document/om_extraction).
--
-- Additive · idempotent · reversible. On LCC Opps (xengecqvemvfknjvbvrq).
--
-- REVERSAL RUNBOOK
--   -- Part A: restore the prior 2-CTE-tier Path-B body (git 20260829120000) and
--   --   DROP the p_include_dropped signature. No data written by this part.
--   DROP FUNCTION IF EXISTS public.lcc_w9_6_path_b_candidates(int, boolean);
--   -- Part B:
--   DELETE FROM public.field_source_priority
--    WHERE source='folder_feed_lease' AND target_table='dia.leases'
--      AND field_name IN ('guaranty_scope','hvac_responsibility','parking_responsibility',
--                         'structure_responsibility','roof_responsibility');

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PART A — Path-B precision RPC
-- ════════════════════════════════════════════════════════════════════════════

-- Deterministic brokerage/advisor-name guard (mirrors the JS
-- comms-owner-attribution.js::isBrokerageOwnerName). A conservative, documented
-- stoplist of the majors + a few brokerage TOKEN tells. KNOWN upstream owner-graph
-- LABELING issue (these entities should not carry a true_owner identity) — flagged
-- for a future ORE cleanup, NOT fixed here. Deliberately does NOT stoplist
-- realty/commercial/capital/partners alone (real owners use them). Defined BEFORE
-- the RPC so the SQL-language body validates.
CREATE OR REPLACE FUNCTION public.lcc_is_brokerage_owner_name(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_name IS NULL OR btrim(p_name) = '' THEN false
    WHEN p_name LIKE '%®%' THEN true  -- registered-mark firm name (e.g. "Coldwell Banker Commercial®")
    ELSE lower(p_name) ~ '(cbre|jll|cushman|wakefield|avison young|colliers|newmark|knight frank|nmrk|kidder mathews|transwestern|coldwell banker|stan johnson|marcus (&|and) millichap|savills|lee (&|and) associates|sperry|svn|keller williams|real estate investment services|realty advisors|brokerage)'
  END;
$$;
COMMENT ON FUNCTION public.lcc_is_brokerage_owner_name(text) IS
  'W9.6 Prompt-103: deterministic brokerage/advisor owner-name guard (mirrors JS isBrokerageOwnerName). Conservative majors stoplist + token tells; used by lcc_w9_6_path_b_candidates to drop brokerage-as-owner targets (a KNOWN upstream owner-graph labeling issue, flagged for a future ORE cleanup).';

-- The return shape gains rel_role + drop_reason, so DROP first (CREATE OR REPLACE
-- cannot change the OUT columns of a set-returning function).
DROP FUNCTION IF EXISTS public.lcc_w9_6_path_b_candidates(int);
DROP FUNCTION IF EXISTS public.lcc_w9_6_path_b_candidates(int, boolean);

CREATE OR REPLACE FUNCTION public.lcc_w9_6_path_b_candidates(
  p_limit int DEFAULT 200,
  p_include_dropped boolean DEFAULT false
)
RETURNS TABLE (
  corr_entity_id uuid, corr_entity_name text, owner_entity_id uuid,
  owner_true_owner_id text, owner_domain text, owner_name text,
  tie_kind text, correspondent_name text, correspondent_email text,
  corr_row_count bigint, sample_activity_id uuid, rank_value numeric,
  rel_role text, drop_reason text
) LANGUAGE sql STABLE AS $$
WITH corr AS (
  SELECT entity_id, count(*) AS n, min(id::text) AS sample
  FROM public.activity_events
  WHERE (source_type ILIKE 'outlook%' OR source_type = 'email_intake') AND entity_id IS NOT NULL
  GROUP BY entity_id
),
person_corr AS (
  SELECT c.entity_id AS person_entity, c.n, c.sample
  FROM corr c
  WHERE NOT EXISTS (SELECT 1 FROM public.external_identities e
                     WHERE e.entity_id = c.entity_id AND e.source_type IN ('asset', 'true_owner'))
),
-- Ownership / employment role vocabulary (grounded in the live
-- entity_relationships.metadata->>'role' set): the roles that legitimately tie a
-- PERSON to the OWNING entity. Deliberately EXCLUDES prospecting_contact /
-- true_buyer_contact / true_seller_contact / contact (deal-party roles, not
-- ownership). Case-insensitive compare.
owner_roles AS (
  SELECT unnest(ARRAY[
    'works_at','manager','mgr','ambr','institution_decision_maker','economic_owner_contact','jv'
  ]) AS r
),
pivot_tie AS (
  SELECT pc.person_entity, pc.n, pc.sample, ocp.entity_id AS owner_entity,
         'active_contact'::text AS tie_kind, NULL::text AS rel_role
  FROM person_corr pc
  JOIN public.owner_contact_pivot ocp ON ocp.active_contact_entity_id = pc.person_entity
  WHERE EXISTS (SELECT 1 FROM public.external_identities oe
                 WHERE oe.entity_id = ocp.entity_id AND oe.source_type = 'true_owner' AND oe.source_system IN ('dia', 'gov'))
),
-- All person↔owner relationship edges (both directions), carrying the role.
rel_all AS (
  SELECT pc.person_entity, pc.n, pc.sample, r.from_entity_id AS owner_entity,
         lower(r.metadata->>'role') AS rel_role, r.relationship_type
  FROM person_corr pc
  JOIN public.entity_relationships r ON r.to_entity_id = pc.person_entity
   AND r.relationship_type IN ('associated_with', 'contact_at', 'works_at')
  WHERE EXISTS (SELECT 1 FROM public.external_identities oe
                 WHERE oe.entity_id = r.from_entity_id AND oe.source_type = 'true_owner' AND oe.source_system IN ('dia', 'gov'))
  UNION ALL
  SELECT pc.person_entity, pc.n, pc.sample, r.to_entity_id,
         lower(r.metadata->>'role'), r.relationship_type
  FROM person_corr pc
  JOIN public.entity_relationships r ON r.from_entity_id = pc.person_entity
   AND r.relationship_type IN ('associated_with', 'contact_at', 'works_at')
  WHERE EXISTS (SELECT 1 FROM public.external_identities oe
                 WHERE oe.entity_id = r.to_entity_id AND oe.source_type = 'true_owner' AND oe.source_system IN ('dia', 'gov'))
),
-- (a) TIE-TIGHTENING: keep only ownership/employment ties.
rel_tight AS (
  SELECT person_entity, n, sample, owner_entity, 'relationship'::text AS tie_kind, rel_role
  FROM rel_all
  WHERE relationship_type IN ('works_at', 'contact_at')
     OR rel_role IN (SELECT r FROM owner_roles)
),
all_ties AS (
  SELECT * FROM pivot_tie
  UNION ALL
  SELECT * FROM rel_tight
),
owner_counts AS (
  SELECT person_entity, count(DISTINCT owner_entity) AS owner_ct FROM all_ties GROUP BY person_entity
),
ranked_ties AS (
  SELECT person_entity, n, sample, owner_entity, tie_kind, rel_role,
    row_number() OVER (PARTITION BY person_entity ORDER BY (tie_kind = 'active_contact') DESC, owner_entity) AS rn
  FROM all_ties
),
chosen AS (
  SELECT rt.person_entity, rt.n, rt.sample, rt.owner_entity, rt.tie_kind, rt.rel_role
  FROM ranked_ties rt JOIN owner_counts oc ON oc.person_entity = rt.person_entity
  WHERE rt.rn = 1 AND oc.owner_ct = 1
),
-- Loose-role relationship ties PRUNED by tie-tightening (edge-level): a person↔
-- owner relationship edge whose role is NOT ownership/employment (prospecting /
-- buyer / seller / contact). Surfaced as a loose_tie diagnostic so the tick counts
-- how many loose ties were dropped; NEVER proposed. A person kept via a separate
-- ownership tie can still show a loose_tie row here for their pruned deal-party tie.
loose_persons AS (
  SELECT DISTINCT ra.person_entity, ra.n, ra.sample, ra.owner_entity, ra.rel_role
  FROM rel_all ra
  WHERE NOT (ra.relationship_type IN ('works_at', 'contact_at')
             OR ra.rel_role IN (SELECT r FROM owner_roles))
),
-- The good/internal/brokerage rows (chosen, disambiguated), drop_reason computed.
chosen_rows AS (
  SELECT
    ch.person_entity AS corr_entity_id,
    pe.name AS corr_entity_name,
    ch.owner_entity AS owner_entity_id,
    oe.external_id AS owner_true_owner_id,
    oe.source_system AS owner_domain,
    oo.name AS owner_name,
    ch.tie_kind,
    pe.name AS correspondent_name,
    pe.email AS correspondent_email,
    ch.n AS corr_row_count,
    ch.sample::uuid AS sample_activity_id,
    (SELECT count(*) FROM public.entity_relationships r2
       WHERE r2.from_entity_id = ch.owner_entity AND r2.relationship_type = 'owns' AND r2.effective_to IS NULL)::numeric AS rank_value,
    ch.rel_role,
    CASE
      WHEN pe.email IS NOT NULL AND lower(pe.email) ~ '@(northmarq|stanjohnsonco)\.com$' THEN 'internal_team'
      WHEN public.lcc_is_brokerage_owner_name(oo.name) THEN 'brokerage_target'
      ELSE NULL
    END::text AS drop_reason
  FROM chosen ch
  JOIN public.entities pe ON pe.id = ch.person_entity
  JOIN public.entities oo ON oo.id = ch.owner_entity
  JOIN LATERAL (
    SELECT external_id, source_system FROM public.external_identities
    WHERE entity_id = ch.owner_entity AND source_type = 'true_owner' AND source_system IN ('dia', 'gov')
    ORDER BY last_synced_at DESC NULLS LAST LIMIT 1
  ) oe ON true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.activity_events a2
    WHERE a2.entity_id = ch.person_entity
      AND jsonb_typeof(a2.metadata->'linked_entity_ids') = 'array'
      AND a2.metadata->'linked_entity_ids' ? ch.owner_entity::text
  )
),
loose_rows AS (
  SELECT
    lp.person_entity AS corr_entity_id,
    pe.name AS corr_entity_name,
    lp.owner_entity AS owner_entity_id,
    oe.external_id AS owner_true_owner_id,
    oe.source_system AS owner_domain,
    oo.name AS owner_name,
    'relationship'::text AS tie_kind,
    pe.name AS correspondent_name,
    pe.email AS correspondent_email,
    lp.n AS corr_row_count,
    lp.sample::uuid AS sample_activity_id,
    NULL::numeric AS rank_value,
    lp.rel_role,
    'loose_tie'::text AS drop_reason
  FROM loose_persons lp
  JOIN public.entities pe ON pe.id = lp.person_entity
  JOIN public.entities oo ON oo.id = lp.owner_entity
  JOIN LATERAL (
    SELECT external_id, source_system FROM public.external_identities
    WHERE entity_id = lp.owner_entity AND source_type = 'true_owner' AND source_system IN ('dia', 'gov')
    ORDER BY last_synced_at DESC NULLS LAST LIMIT 1
  ) oe ON true
),
unioned AS (
  SELECT * FROM chosen_rows
  UNION ALL
  SELECT * FROM loose_rows
)
SELECT corr_entity_id, corr_entity_name, owner_entity_id, owner_true_owner_id, owner_domain,
       owner_name, tie_kind, correspondent_name, correspondent_email, corr_row_count,
       sample_activity_id, rank_value, rel_role, drop_reason
FROM unioned
WHERE p_include_dropped OR drop_reason IS NULL
ORDER BY (drop_reason IS NULL) DESC, (tie_kind = 'active_contact') DESC, rank_value DESC NULLS LAST, corr_row_count DESC
LIMIT GREATEST(1, p_limit);
$$;
GRANT EXECUTE ON FUNCTION public.lcc_w9_6_path_b_candidates(int, boolean) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.lcc_w9_6_path_b_candidates(int, boolean) IS
  'W9.6 Path B (person_match), Prompt-103 precision: correspondence-attributed PERSON tied to a single true_owner via owner_contact_pivot active contact or an UNAMBIGUOUS person↔owner relationship edge, with the relationship tier TIGHTENED to ownership/employment roles. Rows are tagged drop_reason (internal_team | brokerage_target | loose_tie); default returns only clean (drop_reason IS NULL) rows, p_include_dropped=true returns the tagged noise too so the tick can surface honest per-reason drop counts. Carries the correspondent name/email for the planner''s verbatim + shared-token false-bridge guard.';

-- ════════════════════════════════════════════════════════════════════════════
-- PART B — folder_feed_lease field_source_priority hygiene
-- ════════════════════════════════════════════════════════════════════════════
-- Register folder_feed_lease on the 5 dia.leases responsibility fields the lease
-- folder-feed writes, at the established folder_feed_lease rank (45 / warn), so
-- v_field_provenance_unranked no longer flags them (drift returns toward baseline).
INSERT INTO public.field_source_priority (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
SELECT v.target_table, v.field_name, v.source, v.priority, v.min_confidence, v.enforce_mode, v.notes
FROM (VALUES
  ('dia.leases', 'guaranty_scope',          'folder_feed_lease', 45, 0.00, 'warn',
   'W9.6 P103: filed-lease-PDF extraction of the guaranty scope. Below manual/lease_document/om_extraction, above the aggregators.'),
  ('dia.leases', 'hvac_responsibility',      'folder_feed_lease', 45, 0.00, 'warn',
   'W9.6 P103: filed-lease-PDF extraction of the HVAC responsibility. Below manual/lease_document/om_extraction, above the aggregators.'),
  ('dia.leases', 'parking_responsibility',   'folder_feed_lease', 45, 0.00, 'warn',
   'W9.6 P103: filed-lease-PDF extraction of the parking responsibility. Below manual/lease_document/om_extraction, above the aggregators.'),
  ('dia.leases', 'structure_responsibility', 'folder_feed_lease', 45, 0.00, 'warn',
   'W9.6 P103: filed-lease-PDF extraction of the structure responsibility. Below manual/lease_document/om_extraction, above the aggregators.'),
  ('dia.leases', 'roof_responsibility',      'folder_feed_lease', 45, 0.00, 'warn',
   'W9.6 P103: filed-lease-PDF extraction of the roof responsibility. Below manual/lease_document/om_extraction, above the aggregators.')
) AS v(target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.field_source_priority f
  WHERE f.target_table = v.target_table AND f.field_name = v.field_name AND f.source = v.source
);

COMMIT;
