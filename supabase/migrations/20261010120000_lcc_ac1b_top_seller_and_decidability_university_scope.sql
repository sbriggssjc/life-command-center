-- AC1b — close the prospecting-scope drift: universities leak into
-- v_lcc_top_seller_prospects (and its predicate exposed via
-- v_lcc_owner_contact_decidability's blocked_reason/decidability_note) via
-- `lcc_owner_name_is_public_body`, while Tier 0 (P190) and every other current
-- gate already exclude universities through the composed
-- `lcc_owner_name_is_not_prospected(p_name)` = is_public_body(p_name) OR
-- is_university(p_name).
--
-- CLAUDE.md's own recurring lesson (P189/A2/N15c/the whole provenance-ladder
-- arc): "the hazard travels with the TECHNIQUE, not the one call site it was
-- first found on" -- here it is the inverse: a FIX travels, and two call sites
-- were left on the old predicate when `lcc_owner_name_is_not_prospected` was
-- introduced (P190's own migration says so explicitly: "those two are not
-- repointed here -- they still call lcc_owner_name_is_public_body directly").
-- This migration is that repoint, nothing else.
--
-- MEASURED BEFORE (2026-09-10, xengecqvemvfknjvbvrq):
--   v_lcc_top_seller_prospects   total 4,107 rows; university-named rows: 14
--     (Colorado State University, Salisbury University, UC Irvine, Georgetown
--     University, Idaho State University Federal Credit Union, Boise State
--     University, University of Pittsburgh Medical Center, University Medical
--     Associates Of The Medical University Of South Carolina, University of
--     Maine System, University of Kansas Hospital Authority, University Of
--     North Carolina Health Care System, Oklahoma University Of, George
--     Washington University, University Of Memphis)
--   v_lcc_owner_contact_decidability  total 312 rows; university-named rows: 3
--     (George Washington University, George Washington University (The),
--      University Of Illinois Foundation) -- all currently read
--     blocked_reason='no_candidate_on_file' (never public_body_not_prospected),
--     because is_public_body() alone does not recognise them as universities.
--
-- FIX. Swap `lcc_owner_name_is_public_body(...)` for
-- `lcc_owner_name_is_not_prospected(...)` in BOTH views. No column added or
-- removed on either view -- CREATE OR REPLACE VIEW's append-only-for-columns
-- rule does not apply (predicate change only); verified below that both
-- column lists are byte-identical to the versions this replaces
-- (v_lcc_top_seller_prospects from 20260930121300_lcc_p158_named_lead_state.sql,
-- v_lcc_owner_contact_decidability from
-- 20260826141000_lcc_p182_decidability_rank_value_fix.sql).
--
-- Additive/reversible: both bodies below are the prior body with the one
-- token swapped. Reverse by re-running the prior body verbatim (see REVERSAL
-- RUNBOOK at the foot of this file).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_lcc_top_seller_prospects AS
 WITH portfolio AS (
         SELECT f.entity_id,
            sum(f.annual_rent) AS annual_rent,
            count(*) AS asset_count,
            string_agg(DISTINCT f.source_domain, '/'::text ORDER BY f.source_domain) AS domains
           FROM lcc_entity_portfolio_facts f
          WHERE f.is_current
          GROUP BY f.entity_id
        )
 SELECT e.id AS entity_id,
    e.name AS owner_name,
    p.annual_rent,
    p.asset_count,
    p.domains,
    lcc_entity_cadence_reachable(e.id) AS reachable,
    COALESCE(e.email, ( SELECT x.email
           FROM entities x
             JOIN entity_relationships r ON r.to_entity_id = x.id
          WHERE r.from_entity_id = e.id AND x.email IS NOT NULL
         LIMIT 1)) AS contact_route,
    (EXISTS ( SELECT 1 FROM touchpoint_cadence t WHERE t.entity_id = e.id)) AS on_cadence,
    ( SELECT t.sf_contact_id FROM touchpoint_cadence t
       WHERE t.entity_id = e.id AND t.sf_contact_id IS NOT NULL LIMIT 1) AS sf_contact_id,
    ( SELECT count(*) AS count FROM lcc_property_owner o
       WHERE o.owner_entity_id = e.id) AS owned_assets_resolved,
        CASE
            WHEN (EXISTS ( SELECT 1 FROM touchpoint_cadence t WHERE t.entity_id = e.id)) THEN 'pursuing'::text
            WHEN lcc_entity_cadence_reachable(e.id) THEN 'READY — reachable, not pursued'::text
            WHEN EXISTS ( SELECT 1 FROM owner_contact_pivot pv
                           WHERE pv.entity_id = e.id
                             AND pv.active_contact_name IS NOT NULL
                             AND lcc_owner_name_is_credible_person(pv.active_contact_name))
                 THEN 'NAMED LEAD — find their line'::text
            ELSE 'needs a contact first'::text
        END AS pursuit_status,
    -- P158 (appended LAST -- CREATE OR REPLACE VIEW is append-only for columns)
    ( SELECT pv.active_contact_name FROM owner_contact_pivot pv
       WHERE pv.entity_id = e.id
         AND pv.active_contact_name IS NOT NULL
         AND lcc_owner_name_is_credible_person(pv.active_contact_name)
       LIMIT 1) AS named_lead
   FROM portfolio p
     JOIN entities e ON e.id = p.entity_id
  WHERE p.annual_rent > 0::numeric
    AND e.merged_into_entity_id IS NULL
    AND NOT lcc_owner_name_is_brokerage(e.name)
    AND NOT lcc_is_operator_owner_name(e.name)
    -- AC1b: was lcc_owner_name_is_public_body(e.name) -- swapped to the
    -- composed gate so universities are excluded here too (P190 parity).
    AND NOT lcc_owner_name_is_not_prospected(e.name)
    AND COALESCE(e.metadata ->> 'junk_name_flagged'::text, ''::text) <> 'true'::text;

CREATE OR REPLACE VIEW public.v_lcc_owner_contact_decidability AS
 WITH task AS (
         SELECT rt.id AS research_task_id,
            rt.entity_id,
            rt.status,
            rt.created_at,
            COALESCE(rt.metadata ->> 'owner_name'::text, ''::text) AS owner_name,
            NULLIF(rt.metadata ->> 'rank_value'::text, ''::text)::numeric AS rank_value_meta,
            rt.metadata ->> 'enrichment_action'::text AS enrichment_action,
            rt.metadata ->> 'demoted_reason'::text AS demoted_reason
           FROM research_tasks rt
          WHERE rt.research_type = 'owner_contact_manual'::text AND (rt.status = ANY (ARRAY['queued'::research_status, 'in_progress'::research_status]))
        ), cand AS (
         SELECT t_1.research_task_id,
            b.value ->> 'name'::text AS cand_name,
            b.value ->> 'source'::text AS cand_source,
            b.value ->> 'role'::text AS cand_role
           FROM task t_1
             JOIN owner_contact_pivot o ON o.entity_id = t_1.entity_id
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.bench, '[]'::jsonb)) b(value)
        ), scored AS (
         SELECT c.research_task_id,
            c.cand_name,
            c.cand_source,
            c.cand_role,
            lcc_owner_strict_core(c.cand_name) IS DISTINCT FROM lcc_owner_strict_core(t_1.owner_name) AND NOT lcc_p131_candidate_restates_owner(c.cand_name, t_1.owner_name) AND lcc_owner_name_is_credible_person(c.cand_name) AND NOT lcc_owner_name_has_org_marker(c.cand_name) AND NOT lcc_p131_is_document_row_label(c.cand_name) AS usable
           FROM cand c
             JOIN task t_1 ON t_1.research_task_id = c.research_task_id
        ), agg AS (
         SELECT scored.research_task_id,
            count(*) AS bench_size,
            count(*) FILTER (WHERE scored.usable) AS usable_candidates,
            (array_agg(scored.cand_name ORDER BY scored.usable DESC, scored.cand_name))[1] AS best_candidate_name,
            (array_agg(scored.cand_source ORDER BY scored.usable DESC, scored.cand_name))[1] AS best_candidate_source,
            (array_agg(scored.cand_role ORDER BY scored.usable DESC, scored.cand_name))[1] AS best_candidate_role
           FROM scored
          GROUP BY scored.research_task_id
        )
 SELECT t.research_task_id,
    t.entity_id,
    t.owner_name,
    COALESCE(t.rank_value_meta, pa.current_annual_rent_total) AS rank_value,
    t.enrichment_action,
    t.status,
    t.created_at,
    COALESCE(a.bench_size, 0::bigint) AS bench_size,
    COALESCE(a.usable_candidates, 0::bigint) AS usable_candidates,
        CASE
            WHEN COALESCE(a.usable_candidates, 0::bigint) > 0 THEN a.best_candidate_name
            ELSE NULL::text
        END AS best_candidate_name,
        CASE
            WHEN COALESCE(a.usable_candidates, 0::bigint) > 0 THEN a.best_candidate_source
            ELSE NULL::text
        END AS best_candidate_source,
        CASE
            WHEN COALESCE(a.usable_candidates, 0::bigint) > 0 THEN a.best_candidate_role
            ELSE NULL::text
        END AS best_candidate_role,
    COALESCE(a.usable_candidates, 0::bigint) > 0 AS decidable,
        CASE
            WHEN COALESCE(a.usable_candidates, 0::bigint) > 0 THEN NULL::text
            -- AC1b: was lcc_owner_name_is_public_body(t.owner_name) -- swapped
            -- to the composed gate so a university reads
            -- public_body_not_prospected here too (P190 parity).
            WHEN t.demoted_reason = 'public_entity_not_prospected'::text OR lcc_owner_name_is_not_prospected(t.owner_name) THEN 'public_body_not_prospected'::text
            WHEN COALESCE(a.bench_size, 0::bigint) = 0 THEN 'no_candidate_on_file'::text
            ELSE 'bench_restates_owner_or_row_labels'::text
        END AS blocked_reason,
        CASE
            WHEN COALESCE(a.usable_candidates, 0::bigint) > 0 THEN 'A named candidate is on file — confirm or reject it on the owner''s Contacts tab.'::text
            WHEN t.demoted_reason = 'public_entity_not_prospected'::text OR lcc_owner_name_is_not_prospected(t.owner_name) THEN 'Public body — not a prospecting target.'::text
            WHEN COALESCE(a.bench_size, 0::bigint) = 0 THEN 'Nothing on file: no registry manager, no linked person, no correspondence. Needs external acquisition (SOS-direct is blocked upstream), not desk research.'::text
            ELSE 'The only candidates on file restate the owner''s own name or are extraction artifacts. Needs external acquisition, not desk research.'::text
        END AS decidability_note
   FROM task t
     LEFT JOIN agg a ON a.research_task_id = t.research_task_id
     LEFT JOIN v_entity_portfolio_all pa ON pa.entity_id = t.entity_id;

-- ============================== VERIFY ==================================================
--   -- expect 0 university-named rows in v_lcc_top_seller_prospects (was 14):
--   select count(*) from v_lcc_top_seller_prospects where owner_name ~* '\muniversity\M';
--   -- expect the 3 university rows on decidability now read public_body_not_prospected:
--   select owner_name, blocked_reason from v_lcc_owner_contact_decidability
--    where owner_name ~* '\muniversity\M';
--   -- column lists unchanged (both views still return the same columns as before):
--   select string_agg(column_name, ',' order by ordinal_position)
--     from information_schema.columns where table_name='v_lcc_top_seller_prospects';
--   select string_agg(column_name, ',' order by ordinal_position)
--     from information_schema.columns where table_name='v_lcc_owner_contact_decidability';
--
-- ============================== REVERSAL RUNBOOK ========================================
--   Re-run the two CREATE OR REPLACE VIEW bodies from, respectively,
--   supabase/migrations/20260930121300_lcc_p158_named_lead_state.sql (for
--   v_lcc_top_seller_prospects) and
--   supabase/migrations/20260826141000_lcc_p182_decidability_rank_value_fix.sql
--   (for v_lcc_owner_contact_decidability) -- each is the identical body with
--   `lcc_owner_name_is_not_prospected` swapped back to
--   `lcc_owner_name_is_public_body`.
