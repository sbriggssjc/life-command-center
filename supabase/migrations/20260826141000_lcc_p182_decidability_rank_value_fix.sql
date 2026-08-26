-- P182 — v_lcc_owner_contact_decidability is value-ranked in name only (P180 recurrence)
--
-- FINDING. The view sources its value as
--     NULLIF(rt.metadata ->> 'rank_value', '')::numeric
-- and THE SEEDER NEVER WRITES THAT KEY. The metadata keys actually present on all 316
-- owner_contact_manual tasks are: batch, notice_address, ranked_by, prior_priority,
-- property_links, bench, tried, kind, owner_name, google_queries, enrichment_action,
-- inferred_state. Measured 2026-08-26: rank_value is NULL on 316 of 316 rows (genuinely
-- NULL -- zero literal 0s, checked per P180).
--
-- Consequence: the view P131 shipped to surface "the answerable few" cannot order them.
-- The top decidable owner is Trammell Crow Co at $24,146,509 with a named manager on
-- file, and it has no claim on the top slot. This is P180 recurring INSIDE A VIEW BUILT
-- AFTER P180 -- and worse than the original, which was about rendering NULL as "$0";
-- here the ordering itself is inoperative.
--
-- FIX. Read the canonical per-entity source instead of a denormalized metadata copy that
-- nobody writes -- the same principle as the CM rule that a KPI tile must READ the view
-- its data tab renders rather than restate it. Self-heals as rent changes; no redeploy
-- (the view is read per request).
--
-- P180 SEMANTICS PRESERVED, deliberately:
--   * no portfolio row  -> NULL  = "cannot be sized" (render an em-dash, never "$0")
--   * portfolio row, no known rent -> 0 = a GENUINE $0
--   These are different facts and the LEFT JOIN keeps them distinct.
--
-- Grain verified before use: v_entity_portfolio_all is 43,321 rows / 43,321 distinct
-- entity_id -- one row per entity, so the join cannot double-count (Class 6).
-- Type verified: the COALESCE yields numeric, matching the existing column type, so
-- CREATE OR REPLACE VIEW cannot hit 42P16.
--
-- Additive in effect, reversible by re-running the prior body (see runbook).
-- Column list and ORDER unchanged -- only the SOURCE of rank_value changes.

create or replace view v_lcc_owner_contact_decidability as
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
    -- P182: was `t.rank_value` off a metadata key the seeder never writes (NULL on 316/316).
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
            WHEN t.demoted_reason = 'public_entity_not_prospected'::text OR lcc_owner_name_is_public_body(t.owner_name) THEN 'public_body_not_prospected'::text
            WHEN COALESCE(a.bench_size, 0::bigint) = 0 THEN 'no_candidate_on_file'::text
            ELSE 'bench_restates_owner_or_row_labels'::text
        END AS blocked_reason,
        CASE
            WHEN COALESCE(a.usable_candidates, 0::bigint) > 0 THEN 'A named candidate is on file — confirm or reject it on the owner''s Contacts tab.'::text
            WHEN t.demoted_reason = 'public_entity_not_prospected'::text OR lcc_owner_name_is_public_body(t.owner_name) THEN 'Public body — not a prospecting target.'::text
            WHEN COALESCE(a.bench_size, 0::bigint) = 0 THEN 'Nothing on file: no registry manager, no linked person, no correspondence. Needs external acquisition (SOS-direct is blocked upstream), not desk research.'::text
            ELSE 'The only candidates on file restate the owner''s own name or are extraction artifacts. Needs external acquisition, not desk research.'::text
        END AS decidability_note
   FROM task t
     LEFT JOIN agg a ON a.research_task_id = t.research_task_id
     LEFT JOIN v_entity_portfolio_all pa ON pa.entity_id = t.entity_id;

-- ============================== VERIFY ==================================================
--   select owner_name, rank_value from v_lcc_owner_contact_decidability
--    where decidable order by rank_value desc nulls last;
--   -- EXPECT: Trammell Crow Co  24146508.56   (was NULL)
--   select count(*) filter (where rank_value is not null) from v_lcc_owner_contact_decidability;
--   -- EXPECT: > 0  (was 0 of 316)
--
-- ============================== REVERSAL RUNBOOK ========================================
--   Re-run the prior body: identical to the above with the final SELECT reading
--   `t.rank_value` (aliased in the task CTE as rank_value rather than rank_value_meta)
--   and without the `LEFT JOIN v_entity_portfolio_all pa` line.
