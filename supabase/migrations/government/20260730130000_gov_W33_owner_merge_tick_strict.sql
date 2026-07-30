-- ============================================================================
-- 20260730130000_gov_W33_owner_merge_tick_strict.sql
-- W3.3 · Retire the dangerous mergers (Unit 1, gov) — audit LCC_Audit_Rollout_Plan.md
--
-- PROBLEM (audit 3.2.1): owner_merge_tick() (gov migration 20260524110000) hourly
-- auto-merges recorded_owners on `canonical_name` equality. `compute_canonical_name`
-- greedily loop-strips TRAILING legal-ish tokens including CO / COMPANY, so two
-- genuinely different owners collapse to the same canonical and get merged — e.g.
--   "Cowperwood Co."      + "Cowperwood Company"          -> "COWPERWOOD"
--   "Paul Ash Management" + "Paul Ash Management Co."      -> "PAUL ASH MANAGEMENT"
--   "Rooker"              + "Rooker Co."                   -> "ROOKER"
-- Once merged, properties / sales_transactions / SF accounts follow the survivor
-- (apply_owner_merge), and the collapse is effectively irreversible (the merge log
-- records only the (loser, survivor) pair, not which FK rows moved).
--
-- FIX: keep the hourly tick, but before merging a (survivor, loser) pair require
-- NAME-CORE-VARIANT EQUALITY under a STRICTER normalization (gov_owner_strict_core)
-- that strips ONLY pure legal-entity forms (LLC/LP/INC/CORP/LTD/… ) and KEEPS the
-- semantic tokens the old canonical over-stripped (CO / COMPANY / GROUP / PARTNERS /
-- PARTNERSHIP / HOLDINGS). If the two names only agree AFTER stripping such a
-- semantic token (i.e. the strict cores differ — ">1 token stripped"), DO NOT merge:
-- route the pair into the W3.2 owner-reconcile Decision Center lane
-- (entity_match_candidates, which now drains through that lane) for a human verdict.
--
-- DISCIPLINE: additive · conservative/unambiguous (surface ambiguity, never guess) ·
-- reversible (soft merged_into preserved + review ledger) · idempotent · dry-run-able.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Stricter owner-core normalizer (the "ORE lcc_institution_norm-style" check).
--    Mirrors gov_norm_owner_core (strip ALL non-alphanumerics so punctuation /
--    spacing variants — "L.L.C." vs "LLC", "A.J.M.D." vs "AJMD", "B & B" vs "BB" —
--    collapse identically) BUT strips ONLY pure legal-entity FORMS from the tail.
--    It deliberately does NOT strip CO / COMPANY / PARTNERSHIP / GROUP / PARTNERS /
--    HOLDINGS / REALTY / PROPERTIES / TRUST, which compute_canonical_name /
--    gov_norm_owner_core do — those carry meaning and must not force a merge.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gov_owner_strict_core(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]', '', 'g'),
        '^the', ''),
      -- trailing run of PURE legal-entity forms only (note: NO co|company|
      -- partnership|group|partners|holdings|realty|properties|trust here).
      -- Short/compound forms that bleed across a word boundary once spaces are
      -- removed (pllc eats "grou|p llc", plc|pa|pc|lc|na similar) are deliberately
      -- EXCLUDED so "X Group LLC" == "X Group" instead of falsely routing to review:
      '(limitedliabilitylimitedpartnership|limitedliabilitycompany|limitedpartnership|incorporated|corporation|limited|lllp|llp|llc|corp|ltd|inc|dst|lp)+$',
      ''),
    '');
$function$;

COMMENT ON FUNCTION public.gov_owner_strict_core IS
  'W3.3: stricter owner name-core (strips only pure legal-entity forms; keeps CO/COMPANY/GROUP/PARTNERS/HOLDINGS). Two recorded_owners are safe to auto-merge only when their strict cores are equal.';

-- ---------------------------------------------------------------------------
-- 2. Review ledger for collapses the tick REFUSES to auto-merge (reversible audit
--    trail of the "routed to human review instead of merged" decision).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gov_owner_merge_review_log (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  survivor_id       uuid NOT NULL,
  loser_id          uuid NOT NULL,
  survivor_name     text,
  loser_name        text,
  canonical_name    text,
  survivor_strict   text,
  loser_strict      text,
  similarity        numeric,
  run_id            text,
  match_candidate_id uuid,        -- FK-ish pointer into entity_match_candidates
  routed_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.gov_owner_merge_review_log IS
  'W3.3: every (survivor,loser) canonical-collapse that owner_merge_tick declined to auto-merge (strict cores differ) and routed to entity_match_candidates for human verdict.';

CREATE INDEX IF NOT EXISTS ix_gov_owner_merge_review_pair
  ON public.gov_owner_merge_review_log (loser_id, survivor_id);

-- ---------------------------------------------------------------------------
-- 3. Hardened owner_merge_tick(): strict-core gate + review routing.
--    Same candidate pool (canonical_name groups with >1 unmerged member) but each
--    (survivor, loser) pair is now gated. Returns an extra routed_to_review count.
--    NOTE: the OUT columns change (added routed_to_review), so the old 0-arg
--    function must be DROPped first (CREATE OR REPLACE cannot change OUT params).
--    The new all-defaulted signature stays callable as owner_merge_tick() — the
--    existing cron `SELECT public.owner_merge_tick();` resolves to it unchanged.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.owner_merge_tick();

CREATE OR REPLACE FUNCTION public.owner_merge_tick(p_dry_run boolean DEFAULT false)
RETURNS TABLE (
  losers_merged     BIGINT,
  routed_to_review  BIGINT,
  clusters_seen     BIGINT,
  run_at            TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_merged   BIGINT := 0;
  v_routed   BIGINT := 0;
  v_clusters BIGINT := 0;
  v_run_id   text := 'owner_merge_tick';
  r          record;
  v_s_core   text;
  v_l_core   text;
  v_sim      numeric;
  v_cand_id  uuid;
BEGIN
  FOR r IN
    WITH props_per_owner AS (
      SELECT recorded_owner_id, COUNT(*) AS props
      FROM public.properties WHERE recorded_owner_id IS NOT NULL
      GROUP BY recorded_owner_id
    ),
    ranked AS (
      SELECT ro.canonical_name, ro.recorded_owner_id, ro.name, COALESCE(pp.props,0) AS props,
             ROW_NUMBER() OVER (PARTITION BY ro.canonical_name
                                ORDER BY COALESCE(pp.props,0) DESC, ro.recorded_owner_id::text) AS rn,
             FIRST_VALUE(ro.recorded_owner_id) OVER (PARTITION BY ro.canonical_name
                                ORDER BY COALESCE(pp.props,0) DESC, ro.recorded_owner_id::text) AS survivor_id,
             FIRST_VALUE(ro.name) OVER (PARTITION BY ro.canonical_name
                                ORDER BY COALESCE(pp.props,0) DESC, ro.recorded_owner_id::text) AS survivor_name
      FROM public.recorded_owners ro
      LEFT JOIN props_per_owner pp ON pp.recorded_owner_id = ro.recorded_owner_id
      WHERE ro.canonical_name IS NOT NULL
        AND ro.merged_into_recorded_owner_id IS NULL
        AND ro.canonical_name IN (
          SELECT canonical_name FROM public.recorded_owners
          WHERE canonical_name IS NOT NULL AND merged_into_recorded_owner_id IS NULL
          GROUP BY 1 HAVING COUNT(*) > 1
        )
    )
    SELECT canonical_name, recorded_owner_id AS loser_id, name AS loser_name,
           survivor_id, survivor_name
    FROM ranked WHERE rn > 1
  LOOP
    v_clusters := v_clusters + 1;            -- counting (survivor,loser) decisions
    v_s_core := public.gov_owner_strict_core(r.survivor_name);
    v_l_core := public.gov_owner_strict_core(r.loser_name);

    IF v_s_core IS NOT NULL AND v_l_core IS NOT NULL
       AND length(v_s_core) >= 2 AND v_s_core = v_l_core THEN
      -- SAFE: names differ only by pure legal form -> genuine variant, auto-merge.
      IF NOT p_dry_run THEN
        PERFORM public.apply_owner_merge(r.survivor_id, r.loser_id, r.canonical_name, v_run_id);
      END IF;
      v_merged := v_merged + 1;
    ELSE
      -- UNSAFE: canonical collapsed a semantic token (strict cores differ) ->
      -- route to the W3.2 owner-reconcile lane instead of merging.
      v_sim := ROUND(public.similarity(coalesce(v_s_core,''), coalesce(v_l_core,''))::numeric, 4);
      IF NOT p_dry_run THEN
        -- idempotent: only file once per unresolved (loser,survivor) pair
        IF NOT EXISTS (
          SELECT 1 FROM public.entity_match_candidates
          WHERE source_table='recorded_owners' AND source_id=r.loser_id
            AND target_table='recorded_owners' AND target_id=r.survivor_id
            AND match_method='owner_merge_tick_strict_review'
            AND status IN ('pending_review','pending')
        ) THEN
          INSERT INTO public.entity_match_candidates
            (source_table, source_id, source_name, target_table, target_id, target_name,
             match_method, similarity, status)
          VALUES
            ('recorded_owners', r.loser_id, r.loser_name,
             'recorded_owners', r.survivor_id, r.survivor_name,
             'owner_merge_tick_strict_review', COALESCE(v_sim, 0), 'pending_review')
          RETURNING id INTO v_cand_id;

          INSERT INTO public.gov_owner_merge_review_log
            (survivor_id, loser_id, survivor_name, loser_name, canonical_name,
             survivor_strict, loser_strict, similarity, run_id, match_candidate_id)
          VALUES
            (r.survivor_id, r.loser_id, r.survivor_name, r.loser_name, r.canonical_name,
             v_s_core, v_l_core, v_sim, v_run_id, v_cand_id);
        END IF;
      END IF;
      v_routed := v_routed + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_merged, v_routed, v_clusters, now();
END;
$$;

COMMENT ON FUNCTION public.owner_merge_tick IS
  'W3.3 hardened B2 propagation worker. Auto-merges a canonical_name collapse ONLY when the two names share gov_owner_strict_core (differ by pure legal form); otherwise routes the pair to entity_match_candidates (W3.2 owner-reconcile lane). p_dry_run=true reports counts without writing. Idempotent.';

-- Cron `lcc-gov-owner-merge-tick` (0 * * * *) already scheduled by the original
-- migration and calls SELECT public.owner_merge_tick(); the new default arg keeps
-- that call valid (p_dry_run defaults false). No reschedule needed.

-- ---------------------------------------------------------------------------
-- 4. UNMERGE WORKLIST — audit of the last 90 days of dq5_owner_merge_log RECORDED-
--    OWNER merges (owner_merge_tick / A1 run) that FAIL the new strict gate:
--    candidate FALSE MERGES for human review, with evidence + a reversible primitive.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gov_owner_merge_unmerge_worklist (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loser_id              uuid NOT NULL,
  loser_name            text,
  survivor_id           uuid NOT NULL,
  survivor_name         text,
  canonical_name        text,
  loser_strict          text,
  survivor_strict       text,
  first_merged_at       timestamptz,
  loser_currently_merged boolean,
  classification        text,        -- 'semantic_token_collapse'
  evidence              jsonb,
  reactivate_sql        text,        -- reversible primitive (soft un-merge of loser)
  reviewed              boolean NOT NULL DEFAULT false,
  review_verdict        text,        -- 'keep_merged' | 'unmerge' | NULL
  reviewed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loser_id, survivor_id)
);
COMMENT ON TABLE public.gov_owner_merge_unmerge_worklist IS
  'W3.3 audit: recorded_owner merges in the last 90d whose two names DIFFER under gov_owner_strict_core (would NOT auto-merge now). Human-review unmerge candidates. apply_owner_merge is lossy (FK rows not individually logged) so unmerge is human-judged; the loser row is preserved (merged_into set) and can be soft-reactivated via reactivate_sql.';

-- (re)populate idempotently
INSERT INTO public.gov_owner_merge_unmerge_worklist
  (loser_id, loser_name, survivor_id, survivor_name, canonical_name,
   loser_strict, survivor_strict, first_merged_at, loser_currently_merged,
   classification, evidence, reactivate_sql)
SELECT
  s.loser_id, s.loser_name, s.survivor_id, s.survivor_name, s.canonical_name,
  s.loser_strict, s.survivor_strict, s.first_merged_at,
  (lo.merged_into_recorded_owner_id = s.survivor_id) AS loser_currently_merged,
  'semantic_token_collapse',
  jsonb_build_object(
    'reason', 'canonical_name equal but strict cores differ (a CO/COMPANY/PARTNERSHIP/'
              || 'GROUP/PARTNERS/HOLDINGS-class token had to be stripped to force the merge)',
    'loser_props',   (SELECT count(*) FROM public.properties p WHERE p.recorded_owner_id = s.loser_id),
    'survivor_props',(SELECT count(*) FROM public.properties p WHERE p.recorded_owner_id = s.survivor_id)
  ),
  format('UPDATE public.recorded_owners SET merged_into_recorded_owner_id=NULL, updated_at=now() '
         || 'WHERE recorded_owner_id=%L; -- then re-attribute moved properties/sales by human judgment',
         s.loser_id)
FROM (
  SELECT DISTINCT ON (l.old_owner_id, l.new_owner_id)
         l.old_owner_id AS loser_id, lo.name AS loser_name,
         l.new_owner_id AS survivor_id, su.name AS survivor_name,
         lo.canonical_name AS canonical_name,
         public.gov_owner_strict_core(lo.name) AS loser_strict,
         public.gov_owner_strict_core(su.name) AS survivor_strict,
         min(l.merged_at) OVER (PARTITION BY l.old_owner_id, l.new_owner_id) AS first_merged_at
  FROM public.dq5_owner_merge_log l
  JOIN public.recorded_owners lo ON lo.recorded_owner_id = l.old_owner_id
  JOIN public.recorded_owners su ON su.recorded_owner_id = l.new_owner_id
  WHERE l.merged_at >= now() - interval '90 days'
    AND l.old_owner_id IS NOT NULL AND l.new_owner_id IS NOT NULL
) s
JOIN public.recorded_owners lo ON lo.recorded_owner_id = s.loser_id
WHERE COALESCE(s.loser_strict,'') <> COALESCE(s.survivor_strict,'')
ON CONFLICT (loser_id, survivor_id) DO UPDATE
  SET loser_strict = EXCLUDED.loser_strict,
      survivor_strict = EXCLUDED.survivor_strict,
      loser_currently_merged = EXCLUDED.loser_currently_merged,
      evidence = EXCLUDED.evidence;
