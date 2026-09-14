-- PR-scanner-3 — county_records_needed, the sixth action on the ownership-history lane.
--
-- The gov-only ownership-history lane split (A1 → A3 → B1) reclassifies its
-- mismatch/all_guarded action to `county_records_needed` when the property
-- carries NO trustworthy public record on file at all (no costar_sidebar
-- parcel/tax capture, no non-model-leg deed) — a signal naming which
-- properties Scott's manual scan (PR-scanner-1/2, netronline -> assessor ->
-- recorder -> SOS) should actually visit, as distinct from "we hold a
-- record and it disagrees" (stays mismatch/all_guarded).
--
-- Re-measured live 2026-09-12 before writing this migration:
--   - 68 human_actionable gov mismatch/all_guarded tasks; 27 of 68 (40%) have
--     no trustworthy record. Matches the PLANNED-BACKLOG PR-scanner-3 figure
--     exactly (re-measured, not assumed stable).
--   - Fleet-wide (all mismatch/all_guarded, not just human_actionable): 254
--     tasks, 126 (49.6%) have no trustworthy record.
--   - The `ai_gpt4o_presumed` label named in the original spec does not
--     exist as a literal in gov.parcel_records/tax_records/deed_records
--     today; the live model-leg tag is `ai_recall_gpt` (11 deed / 23 parcel /
--     14 tax rows). "Trustworthy" = parcel/tax rows tagged `costar_sidebar`
--     (source IS NULL rows are the AI-extraction echo class documented in
--     ORE Phase A1 — never trustworthy) and deed rows whose source is
--     anything OTHER than `ai_recall_gpt` (deed_parser or unstamped legacy
--     rows both carry real OCR/extraction content, per OCR2/PR1).
--
-- This is a RECLASSIFICATION inside the existing split view, mirroring A3's
-- `sponsor_spe` precedent (a fifth action added the same way) — no new
-- lane/table/research_type. `human_actionable` (B1's value floor,
-- lcc_chain_human_value_floor()) is UNCHANGED by this migration: it is
-- computed upstream of the action label and does not read `action` at all,
-- so a task that was `mismatch`+human_actionable and reclassifies to
-- `county_records_needed` stays human_actionable — same floor, same knob,
-- reused rather than repeated (B1's own instruction).
--
-- Cross-database constraint: this view lives on LCC Opps; gov's
-- parcel_records/tax_records/deed_records live on the separate gov Supabase
-- project and cannot be joined in one SQL statement. So the trustworthy-
-- record fact is MIRRORED into a small LCC-Opps-side coverage table
-- (`lcc_gov_property_record_coverage`), synced by a dedicated tick
-- (api/_shared/gov-property-record-coverage.js), and the view LEFT JOINs
-- that mirror — keeping the SQL CASE the single owner of the classification
-- decision (the mirror only ever answers "do we have a record", never
-- "what should the action be"). A property with NO mirror row (not yet
-- synced) is left at its base action — never guessed into
-- `county_records_needed` on an absence of information.

CREATE TABLE IF NOT EXISTS lcc_gov_property_record_coverage (
  property_id           bigint PRIMARY KEY,
  has_trustworthy_record boolean NOT NULL,
  parcel_trust          boolean NOT NULL DEFAULT false,
  tax_trust             boolean NOT NULL DEFAULT false,
  deed_trust            boolean NOT NULL DEFAULT false,
  synced_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE lcc_gov_property_record_coverage IS
  'PR-scanner-3: mirror of "does this gov property carry a trustworthy '
  'parcel/tax/deed record" (costar_sidebar parcel/tax OR any non-ai_recall_gpt '
  'deed), synced from the gov project by gov-property-record-coverage.js. '
  'Read-only input to v_lcc_ownership_history_lane_split''s county_records_needed '
  'reclassification. Absence of a row means "not yet synced", never "no record".';

-- Full re-issue of the view body (the B1 definition, live-fetched 2026-09-12),
-- with the county_records_needed reclassification added as the LAST step
-- before emitting `action`. Every other column and every other action's
-- semantics is byte-identical to the live B1 body.
CREATE OR REPLACE VIEW v_lcc_ownership_history_lane_split AS
WITH open_tasks AS (
  SELECT rt.id,
    rt.workspace_id,
    rt.title,
    rt.status,
    rt.priority,
    rt.domain,
    rt.source_record_id,
    rt.entity_id,
    rt.assigned_to,
    rt.created_at,
    rt.updated_at,
    NULLIF(rt.metadata ->> 'rank_value', '')::numeric AS lane_value
  FROM research_tasks rt
  WHERE rt.research_type = 'establish_ownership_history'
    AND (rt.status = ANY (ARRAY['queued'::research_status, 'in_progress'::research_status]))
), draft AS (
  SELECT r.proposal_id,
    r.proposed_link,
    r.reason,
    r.confidence,
    r.updated_at,
    r.research_task_id,
    r.rn
  FROM (
    SELECT p.proposal_id,
      p.proposed_link,
      p.reason,
      p.confidence,
      p.updated_at,
      (p.proposed_link ->> 'research_task_id')::uuid AS research_task_id,
      row_number() OVER (PARTITION BY ((p.proposed_link ->> 'research_task_id')::uuid) ORDER BY p.proposal_id DESC) AS rn
    FROM lcc_clean_assist_proposals p
    WHERE p.source = 'ownership_chain_draft'
      AND p.status = 'proposed'
      AND (p.proposed_link ->> 'research_task_id') IS NOT NULL
  ) r
  WHERE r.rn = 1
), scored AS (
  SELECT ot.id,
    ot.workspace_id,
    ot.title,
    ot.status,
    ot.priority,
    ot.domain,
    ot.source_record_id,
    ot.entity_id,
    ot.assigned_to,
    ot.created_at,
    ot.updated_at,
    ot.lane_value,
    d.proposal_id,
    d.proposed_link,
    d.reason,
    d.confidence,
    d.updated_at AS drafted_at,
    d.proposed_link ->> 'current_owner_name' AS current_owner_name_x,
    (
      SELECT a.l ->> 'to'
      FROM jsonb_array_elements(d.proposed_link -> 'links') WITH ORDINALITY a(l, o)
      ORDER BY a.o DESC
      LIMIT 1
    ) AS last_grantee_x
  FROM open_tasks ot
  LEFT JOIN draft d ON d.research_task_id = ot.id
), cls AS (
  SELECT s.id,
    s.workspace_id,
    s.title,
    s.status,
    s.priority,
    s.domain,
    s.source_record_id,
    s.entity_id,
    s.assigned_to,
    s.created_at,
    s.updated_at,
    s.lane_value,
    s.proposal_id,
    s.proposed_link,
    s.reason,
    s.confidence,
    s.drafted_at,
    s.current_owner_name_x,
    s.last_grantee_x,
    CASE
      WHEN s.proposal_id IS NOT NULL AND ((s.proposed_link ->> 'draftable')::boolean) IS TRUE AND ((s.proposed_link ->> 'terminates_at_current_owner')::boolean) IS FALSE
        THEN lcc_ownership_mismatch_class(s.current_owner_name_x, s.last_grantee_x)
      ELSE NULL::text
    END AS mclass,
    CASE
      WHEN s.proposal_id IS NOT NULL AND ((s.proposed_link ->> 'draftable')::boolean) IS TRUE AND ((s.proposed_link ->> 'terminates_at_current_owner')::boolean) IS FALSE
        THEN lcc_ownership_sponsor_token(s.current_owner_name_x, s.last_grantee_x)
      ELSE NULL::text
    END AS mtoken
  FROM scored s
), fam AS (
  SELECT c.id,
    c.workspace_id,
    c.title,
    c.status,
    c.priority,
    c.domain,
    c.source_record_id,
    c.entity_id,
    c.assigned_to,
    c.created_at,
    c.updated_at,
    c.lane_value,
    c.proposal_id,
    c.proposed_link,
    c.reason,
    c.confidence,
    c.drafted_at,
    c.current_owner_name_x,
    c.last_grantee_x,
    c.mclass,
    c.mtoken,
    c.mtoken IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM lcc_ownership_sponsor_family f
        WHERE f.sponsor_entity_id = lcc_entity_survivor(c.entity_id) AND f.sponsor_token = c.mtoken
      )
    ) AS sponsor_confirmed
  FROM cls c
), gated AS (
  SELECT t_1.id,
    t_1.workspace_id,
    t_1.title,
    t_1.status,
    t_1.priority,
    t_1.domain,
    t_1.source_record_id,
    t_1.entity_id,
    t_1.assigned_to,
    t_1.created_at,
    t_1.updated_at,
    t_1.lane_value,
    t_1.proposal_id,
    t_1.proposed_link,
    t_1.reason,
    t_1.confidence,
    t_1.drafted_at,
    t_1.current_owner_name_x,
    t_1.last_grantee_x,
    t_1.mclass,
    t_1.mtoken,
    t_1.sponsor_confirmed,
    lcc_chain_human_value_floor() AS human_floor_x,
    CASE
      WHEN t_1.proposal_id IS NULL THEN false
      WHEN ((t_1.proposed_link ->> 'draftable')::boolean) IS NOT TRUE
        THEN (t_1.proposed_link ->> 'insufficient_reason') = 'all_transitions_guarded'
      ELSE ((t_1.proposed_link ->> 'terminates_at_current_owner')::boolean) IS FALSE AND NOT t_1.sponsor_confirmed
    END AS would_be_human_x
  FROM fam t_1
), classified AS (
  -- PR-scanner-3: the base action, computed exactly as the pre-existing view
  -- did (unchanged), plus the domain/source_record_id this reclassification
  -- needs to join the coverage mirror on.
  SELECT g.*,
    CASE
      WHEN g.proposal_id IS NULL THEN NULL::text
      WHEN ((g.proposed_link ->> 'draftable')::boolean) IS NOT TRUE THEN
        CASE g.proposed_link ->> 'insufficient_reason'
          WHEN 'no_transitions_on_file' THEN 'no_records'
          WHEN 'all_transitions_guarded' THEN 'all_guarded'
          ELSE NULL
        END
      WHEN ((g.proposed_link ->> 'terminates_at_current_owner')::boolean) IS TRUE THEN 'agrees'
      WHEN ((g.proposed_link ->> 'terminates_at_current_owner')::boolean) IS FALSE THEN
        CASE WHEN g.sponsor_confirmed THEN 'sponsor_spe' ELSE 'mismatch' END
      ELSE NULL::text
    END AS base_action
  FROM gated g
)
SELECT
  c.id AS research_task_id,
  c.workspace_id,
  c.title,
  c.status::text AS status,
  c.priority,
  c.domain,
  c.source_record_id,
  c.entity_id,
  c.assigned_to,
  c.created_at,
  c.updated_at,
  c.proposal_id IS NOT NULL AS has_draft,
  -- PR-scanner-3: county_records_needed reclassifies mismatch/all_guarded
  -- ONLY when the coverage mirror POSITIVELY says no trustworthy record
  -- exists (cov.has_trustworthy_record IS FALSE, never IS NULL/unsynced —
  -- `IS FALSE` is deliberate over `= false` so a NULL from the LEFT JOIN
  -- never satisfies the predicate). `no_records`/`agrees`/`sponsor_spe` are
  -- untouched: this action is scoped to the two "we hold a disputed or
  -- fully-rejected chain" buckets, never the "nothing was ever recorded"
  -- bucket A4 already retires.
  CASE
    WHEN c.base_action IN ('mismatch', 'all_guarded')
      AND c.domain = 'gov'
      AND cov.has_trustworthy_record IS FALSE
      THEN 'county_records_needed'
    ELSE c.base_action
  END AS action,
  CASE
    WHEN c.proposal_id IS NULL THEN 'awaiting_draft'
    WHEN ((c.proposed_link ->> 'draftable')::boolean) IS NOT TRUE THEN
      CASE
        WHEN (c.proposed_link ->> 'insufficient_reason') = ANY (ARRAY['no_transitions_on_file', 'all_transitions_guarded']) THEN 'classified'
        ELSE 'unrecognised_payload'
      END
    WHEN ((c.proposed_link ->> 'terminates_at_current_owner')::boolean) IS NOT NULL THEN 'classified'
    ELSE 'unrecognised_payload'
  END AS split_state,
  c.would_be_human_x AND c.lane_value IS NOT NULL AND c.lane_value >= c.human_floor_x AS human_actionable,
  (c.proposed_link ->> 'draftable')::boolean AS draftable,
  (c.proposed_link ->> 'terminates_at_current_owner')::boolean AS terminates_at_current_owner,
  c.proposed_link ->> 'insufficient_reason' AS insufficient_reason,
  c.proposed_link ->> 'current_owner_name' AS current_owner_name,
  c.proposed_link ->> 'address' AS address,
  COALESCE(jsonb_array_length(COALESCE(c.proposed_link -> 'links', '[]'::jsonb)), 0) AS link_count,
  jsonb_array_length(COALESCE(c.proposed_link -> 'rejected', '[]'::jsonb)) AS rejected_count,
  ((c.proposed_link -> 'continuity') ->> 'contiguous')::boolean AS contiguous,
  ((c.proposed_link -> 'continuity') ->> 'breaks')::integer AS continuity_breaks,
  c.reason AS draft_reason,
  c.confidence AS draft_confidence,
  c.drafted_at,
  c.proposal_id,
  c.mclass AS mismatch_class,
  c.mtoken AS mismatch_sponsor_token,
  c.lane_value,
  c.human_floor_x AS human_value_floor,
  c.would_be_human_x AND (c.lane_value IS NULL OR c.lane_value < c.human_floor_x) AS below_human_floor,
  CASE
    WHEN c.proposal_id IS NULL THEN 'awaiting_draft'
    WHEN NOT c.would_be_human_x THEN 'not_human'
    WHEN c.lane_value IS NULL OR c.lane_value < c.human_floor_x THEN 'below_value_floor'
    ELSE 'actionable'
  END AS human_gate,
  -- PR-scanner-3: appended, never inserted mid-list (the view append-only
  -- rule) — surfaces whether the reclassification could even be evaluated.
  cov.has_trustworthy_record AS gov_has_trustworthy_record,
  cov.synced_at AS gov_record_coverage_synced_at
FROM classified c
LEFT JOIN lcc_gov_property_record_coverage cov
  ON c.domain = 'gov'
  AND c.source_record_id ~ '^[0-9]+$'
  AND cov.property_id = c.source_record_id::bigint;
