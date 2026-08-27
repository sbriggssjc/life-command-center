-- =====================================================================
-- N15e — recompute the 537 canonical_name rows N15c held back.
-- =====================================================================
-- Scott approved this. The held rows are `canonical_name` left stale after
-- `name` was later repaired, so the stored value is not a function of the
-- current name at all ("Scott W. Beynon" keyed
-- "buyer contactsscott w beynon 801 568 1031 p"). The trigger is
-- `UPDATE OF name`, so an unrelated write never recomputes them -- they are
-- N15c's entire residual and only a deliberate pass clears them.
--
-- ⚠️ ONE BACKFILL FUNCTION, NOT TWO. The gate is WIDENED with a new
-- p_include_held parameter rather than copied into a sibling function. A
-- second copy of a normalisation/backfill rule is the drift this whole arc
-- (N15b -> N15c -> N15e) exists to end. Adding a parameter would create an
-- OVERLOAD -- and with defaults on both, every 1-3 arg call becomes
-- "function is not unique" -- so the old signature is DROPPED first.
--
-- ⚠️ WHAT IS NOT DESTROYED: 73 of the 537 stale keys hold more alphanumeric
-- content than the recomputed key (57 hold >10 chars more); 463 hold LESS.
-- Every old value is written to lcc_n15c_canonical_backfill_log BEFORE the
-- UPDATE, so the captured string moves from a key column to a ledger, which
-- is where provenance belongs. A dedup key is not an archive.
--
-- REVERSAL:
--   UPDATE entities e SET canonical_name = b.old_canonical_name
--     FROM lcc_n15c_canonical_backfill_log b
--    WHERE b.entity_id = e.id AND b.batch_tag = 'n15e_go';
-- =====================================================================

DROP FUNCTION IF EXISTS public.lcc_n15c_backfill_canonical_names(boolean, text, integer);

CREATE FUNCTION public.lcc_n15c_backfill_canonical_names(
  p_dry_run      boolean DEFAULT true,
  p_batch_tag    text    DEFAULT NULL,
  p_limit        integer DEFAULT NULL,
  p_include_held boolean DEFAULT false
)
RETURNS TABLE (
  rows_rewritten        bigint,
  rows_held_stale       bigint,
  rows_already_correct  bigint,
  batch_tag             text
)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tag  text := coalesce(p_batch_tag, 'n15c_' || to_char(now(),'YYYYMMDDHH24MISS'));
  v_done bigint := 0;
BEGIN
  CREATE TEMP TABLE _n15c_plan ON COMMIT DROP AS
  SELECT e.id, e.name, e.canonical_name AS old_canon,
         public.lcc_entity_canonical_key(e.name) AS new_canon
    FROM public.entities e
   WHERE e.merged_into_entity_id IS NULL
     AND e.canonical_name IS DISTINCT FROM public.lcc_entity_canonical_key(e.name)
     -- N15e: p_include_held admits the stale-name-repair class. Default false
     -- keeps N15c's behaviour byte-for-byte for every existing caller.
     AND (p_include_held
          OR public.lcc_n15c_canonical_is_attributable(e.name, e.canonical_name))
   ORDER BY e.id
   LIMIT p_limit;

  IF NOT p_dry_run THEN
    -- Ledger FIRST, so a row can never be rewritten without a way back.
    INSERT INTO public.lcc_n15c_canonical_backfill_log
      (entity_id, entity_name, old_canonical_name, new_canonical_name, batch_tag)
    SELECT p.id, p.name, p.old_canon, p.new_canon, v_tag FROM _n15c_plan p;

    UPDATE public.entities e
       SET canonical_name = p.new_canon
      FROM _n15c_plan p
     WHERE e.id = p.id;
    GET DIAGNOSTICS v_done = ROW_COUNT;
  ELSE
    SELECT count(*) INTO v_done FROM _n15c_plan;
  END IF;

  RETURN QUERY
  SELECT v_done,
         (SELECT count(*) FROM public.entities e
           WHERE e.merged_into_entity_id IS NULL
             AND e.canonical_name IS DISTINCT FROM public.lcc_entity_canonical_key(e.name)
             AND NOT public.lcc_n15c_canonical_is_attributable(e.name, e.canonical_name)),
         (SELECT count(*) FROM public.entities e
           WHERE e.merged_into_entity_id IS NULL
             AND e.canonical_name = public.lcc_entity_canonical_key(e.name)),
         v_tag;
END;
$function$;

COMMENT ON FUNCTION public.lcc_n15c_backfill_canonical_names(boolean, text, integer, boolean) IS
  'N15c/N15e. The SINGLE canonical_name backfill. p_include_held => true admits the held_stale_name_repair class (N15e, batch n15e_go). Dry-run default; reversible by batch_tag against lcc_n15c_canonical_backfill_log.';

-- ---------------------------------------------------------------------
-- The collision surface. Recomputing the held rows makes 39 of them share a
-- key with a live entity -- byte-identical names the stale key was hiding.
-- That is the BENEFIT, and it is a duplicate-CANDIDATE surface, never a merge.
-- ---------------------------------------------------------------------
-- ⚠️ It deliberately carries NO auto_mergeable column. lcc_apply_fuzzy_merges
-- loops on that flag (P198), and several of these pairs are person/organization
-- rows sharing one name -- the person/org conflation sf-account-link.js exists
-- to prevent. A shared key is correct; reading it as identity is not.
-- ⚠️ `American Realty Capital` <-> `American Realty Capital Trust` is Scott's
-- adopted trust rule WORKING (a trust and its parent are one true owner,
-- N15b decision 1), not a defect. Do not "fix" it.
CREATE OR REPLACE VIEW public.v_lcc_n15e_canonical_collision_candidates AS
  SELECT a.id                    AS entity_id,
         a.name,
         a.entity_type,
         a.canonical_name        AS shared_key,
         l.old_canonical_name    AS pre_n15e_canonical_name,
         b.id                    AS other_entity_id,
         b.name                  AS other_name,
         b.entity_type           AS other_entity_type,
         (a.name = b.name)                                   AS byte_identical_name,
         (a.entity_type::text <> b.entity_type::text)        AS cross_entity_type
    FROM public.lcc_n15c_canonical_backfill_log l
    JOIN public.entities a
      ON a.id = l.entity_id AND a.merged_into_entity_id IS NULL
    JOIN public.entities b
      ON b.workspace_id = a.workspace_id
     AND b.canonical_name = a.canonical_name
     AND b.id <> a.id
     AND b.merged_into_entity_id IS NULL
   WHERE l.batch_tag = 'n15e_go';

COMMENT ON VIEW public.v_lcc_n15e_canonical_collision_candidates IS
  'N15e duplicate-CANDIDATE surface: held rows whose recomputed canonical_name now collides with a live entity. Human-confirmed merges only, through lcc_merge_entity (reversible, P196). Read cross_entity_type: a person and an organization sharing a name are NOT a merge.';

GRANT SELECT ON public.v_lcc_n15e_canonical_collision_candidates TO authenticated, service_role;
