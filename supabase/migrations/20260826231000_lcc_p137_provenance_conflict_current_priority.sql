-- ============================================================================
-- P137 — provenance_conflict clean-assist: populate the CURRENT source's rung
--
-- Target: LCC Opps (OPS_SUPABASE_URL, ref xengecqvemvfknjvbvrq)
--
-- P134 gave the clean-assist model a ladder to reason from — on the CONSUMER
-- side only. `clean-assist-context.js::assessProvenanceConflict` computes
-- `ladder_says = laddersSay(c.attempted_priority, c.current_priority)` and reads
-- `c.priority_ladder`, but NOTHING ever produced either field: this view carries
-- `attempted_priority` (the INNER JOIN on the attempted source) and has no
-- current-side rung and no ladder at all. So `c.current_priority` was always
-- undefined, `laddersSay(ap, null)` always returned
-- `unregistered_source_no_ladder_answer`, and the model correctly refused to
-- guess — all 4 provenance_conflict proposals in the 2026-08-26 re-grade punted
-- with "the evidence does not specify which source is more authoritative".
--
-- The join P134's writeup described ("resolves the current source's rung on
-- field_source_priority, 454/454") was never wired into the data path. This is
-- exactly the failure that note warned about: DIFF THE VIEW'S COLUMNS AGAINST
-- THE HANDLER'S SELECT — except here the view was missing the column too.
--
-- Measured live 2026-08-26 over the 454 cross_source conflicts:
--   current_priority resolved     454 / 454   (0 unresolved — every current
--                                              source is registered)
--   ladder-decidable              433         (priorities differ → the ladder
--                                              names a winner)
--   genuine ties                   21         (equal priority → correctly stays
--                                              `uncertain`; the ladder cannot
--                                              decide and must not pretend to)
--
-- Appends TWO columns at the END of the SELECT list (Postgres 42P16: a
-- CREATE OR REPLACE VIEW is append-only for columns — never insert mid-list):
--
--   current_priority  int    — the CURRENT authoritative source's rung on
--                              field_source_priority, joined the SAME way the
--                              view already joins the attempted side
--                              (target_table, field_name, source). That key is
--                              UNIQUE, so the LEFT JOIN cannot fan rows out.
--   priority_ladder   jsonb  — the WHOLE ladder for that (target_table,
--                              field_name) as [{source, priority}] ordered by
--                              priority ASC, so the model narrates the
--                              registered ranking instead of inventing one.
--                              LOWER priority number = HIGHER trust.
--
-- The ladder is pre-aggregated ONCE in a CTE and LEFT JOINed, rather than
-- written as a correlated subquery — a per-row subplan is the `loops=` pathology
-- CLAUDE.md documents, and no index fixes one. It is cheap either way here
-- (520 field groups, avg ladder length 4.06, max 12) but the shape matters.
--
-- NOTE on scope: `field_source_priority` has no `target_database` column, so the
-- ladder is per (target_table, field_name) — identical to how this view already
-- resolves `attempted_priority`. Deliberately consistent; do not invent a
-- database-scoped ladder that the attempted side would not share.
--
-- Every pre-existing column keeps its position, name and type. Additive,
-- idempotent, view-only (no data mutated). Reversible: re-run the prior body
-- from 20260616121000_lcc_tier1_unit2_provenance_autoresolve.sql §1.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_field_provenance_conflict_classified AS
WITH ladder AS (
  SELECT fsp.target_table,
         fsp.field_name,
         jsonb_agg(
           jsonb_build_object('source', fsp.source, 'priority', fsp.priority)
           ORDER BY fsp.priority ASC, fsp.source ASC
         ) AS priority_ladder
  FROM public.field_source_priority fsp
  GROUP BY fsp.target_table, fsp.field_name
)
SELECT fp.id AS provenance_id,
    fp.recorded_at,
    fp.target_database,
    fp.target_table,
    fp.record_pk_value,
    fp.field_name,
    fp.value AS attempted_value,
    fp.source AS attempted_source,
    fp.confidence AS attempted_confidence,
    fp.source_run_id,
    fp.decision,
    fp.decision_reason,
    fsp.priority AS attempted_priority,
    fsp.enforce_mode,
    cur.id AS current_provenance_id,
    cur.source AS current_source,
    cur.value AS current_value,
    cur.recorded_at AS current_recorded_at,
        CASE
            WHEN cur.source IS NULL THEN 'no_current_authority'::text
            WHEN fp.source = cur.source THEN 'same_source'::text
            ELSE 'cross_source'::text
        END AS conflict_class,
    -- P137 (appended) --------------------------------------------------------
    cur_fsp.priority AS current_priority,
    COALESCE(lad.priority_ladder, '[]'::jsonb) AS priority_ladder
   FROM field_provenance fp
     JOIN field_source_priority fsp ON fsp.target_table = fp.target_table AND fsp.field_name = fp.field_name AND fsp.source = fp.source
     LEFT JOIN LATERAL ( SELECT cu.id,
            cu.source,
            cu.value,
            cu.recorded_at
           FROM field_provenance cu
          WHERE cu.target_database = fp.target_database AND cu.target_table = fp.target_table AND cu.record_pk_value = fp.record_pk_value AND cu.field_name = fp.field_name AND cu.decision = 'write'::text
          ORDER BY cu.recorded_at DESC
         LIMIT 1) cur ON true
     LEFT JOIN field_source_priority cur_fsp
       ON cur_fsp.target_table = fp.target_table
      AND cur_fsp.field_name  = fp.field_name
      AND cur_fsp.source      = cur.source
     LEFT JOIN ladder lad
       ON lad.target_table = fp.target_table
      AND lad.field_name  = fp.field_name
  WHERE fp.decision = 'conflict'::text AND (fsp.enforce_mode = ANY (ARRAY['warn'::text, 'strict'::text]));

-- Preserve the security posture set by 20260728120000_rls_security_hardening_ops.
-- CREATE OR REPLACE keeps reloptions, but re-asserting costs nothing and makes
-- the intent explicit rather than inherited.
ALTER VIEW public.v_field_provenance_conflict_classified SET (security_invoker = on);

GRANT SELECT ON public.v_field_provenance_conflict_classified TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_field_provenance_conflict_classified IS
  'Surfaced field-provenance conflicts classified same_source / cross_source / '
  'no_current_authority. P137 appends current_priority (the CURRENT source''s '
  'rung on field_source_priority) and priority_ladder ([{source, priority}] for '
  'the field, priority ASC) so the clean-assist provenance lane can state which '
  'source the registered ladder favours. LOWER priority number = HIGHER trust.';
