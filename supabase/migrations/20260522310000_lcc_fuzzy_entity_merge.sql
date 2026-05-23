-- Topic 14 (audit §11.31): fuzzy entity resolution via normalized-name match.
--
-- §11.24's cross-domain merge only caught entities with strict
-- canonical_name equality. 371 additional groups (757 entities) appear
-- in the entities table as variants of the same underlying legal
-- entity — distinguished only by capitalization, punctuation, or
-- corporate suffix (LLC vs Inc, missing comma, plural form, trailing
-- "Corp" vs "Corporation"). This topic adds the normalized-name
-- resolver, runs the high-confidence auto-merges, and exposes a
-- candidates view for the long tail that needs human review.
--
-- Conservative philosophy: this round merges only when the normalized
-- names match exactly. Trigram-similarity fuzzy matching (which would
-- catch "Truist Bank" ↔ "Truist Financial Corporation") is NOT done —
-- those names share a corporate parent but are distinct legal entities,
-- and the false-positive cost of merging them is higher than the
-- noise-reduction value.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. lcc_normalize_entity_name(text) — IMMUTABLE so it can index
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_normalize_entity_name(p_name text)
RETURNS text AS $$
DECLARE
  v_name text;
BEGIN
  IF p_name IS NULL THEN
    RETURN NULL;
  END IF;
  -- Lowercase
  v_name := LOWER(p_name);
  -- Strip corporate suffixes/qualifiers (whole-word match)
  v_name := regexp_replace(
    v_name,
    '\m(llc|l\.l\.c\.|inc|inc\.|corp|corp\.|corporation|company|co|co\.|lp|l\.p\.|llp|trust|holdings|properties|partners|capital|group|the|n\.a\.|na)\M',
    ' ',
    'gi'
  );
  -- Collapse all non-alphanumeric to single space
  v_name := regexp_replace(v_name, '[^a-z0-9]+', ' ', 'g');
  v_name := regexp_replace(v_name, '\s+', ' ', 'g');
  v_name := TRIM(v_name);
  IF LENGTH(v_name) < 4 THEN
    RETURN NULL;  -- too short to merge on safely
  END IF;
  RETURN v_name;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- 2. v_lcc_merge_candidates — diagnostic view, also drives the auto-merge
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_merge_candidates
WITH (security_invoker = true) AS
WITH normalized AS (
  SELECT
    e.id,
    e.name,
    e.canonical_name,
    e.owner_role,
    e.owner_role_confidence,
    e.domain,
    public.lcc_normalize_entity_name(e.name) AS norm_name,
    (SELECT COUNT(*) FROM public.lcc_entity_portfolio_facts f WHERE f.entity_id = e.id) AS portfolio_size
  FROM public.entities e
  WHERE e.entity_type = 'organization'
    AND e.merged_into_entity_id IS NULL
    AND e.name IS NOT NULL
),
qualifying AS (
  SELECT * FROM normalized WHERE norm_name IS NOT NULL
),
groups AS (
  SELECT norm_name,
    array_agg(id ORDER BY
      (CASE owner_role
        WHEN 'developer' THEN 1
        WHEN 'operator' THEN 2
        WHEN 'user_owner' THEN 3
        WHEN 'buyer' THEN 4
        ELSE 5
      END),
      portfolio_size DESC,
      LENGTH(name) DESC,
      id
    ) AS member_ids_winner_first,
    array_agg(name ORDER BY
      (CASE owner_role
        WHEN 'developer' THEN 1
        WHEN 'operator' THEN 2
        WHEN 'user_owner' THEN 3
        WHEN 'buyer' THEN 4
        ELSE 5
      END),
      portfolio_size DESC,
      LENGTH(name) DESC,
      id
    ) AS member_names_winner_first,
    array_agg(DISTINCT domain) FILTER (WHERE domain IS NOT NULL) AS domains,
    COUNT(*) AS member_count,
    MAX(CASE owner_role
      WHEN 'developer' THEN 4 WHEN 'operator' THEN 3
      WHEN 'user_owner' THEN 2 WHEN 'buyer' THEN 1
      ELSE 0 END) AS best_role_score
  FROM qualifying
  GROUP BY norm_name
  HAVING COUNT(*) >= 2
)
SELECT
  norm_name,
  member_ids_winner_first[1] AS winner_id,
  member_names_winner_first[1] AS winner_name,
  member_ids_winner_first[2:] AS loser_ids,
  member_names_winner_first[2:] AS loser_names,
  member_count,
  domains,
  best_role_score,
  -- Auto-mergeable if at least one member has a classified role
  (best_role_score >= 1) AS auto_mergeable
FROM groups;

GRANT SELECT ON public.v_lcc_merge_candidates TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. lcc_apply_fuzzy_merges() — runs lcc_merge_entity() on each loser
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_apply_fuzzy_merges(p_dry_run boolean DEFAULT false)
RETURNS TABLE(
  norm_name text,
  winner_name text,
  loser_count int,
  applied boolean
) AS $$
DECLARE
  v_rec record;
  v_loser uuid;
BEGIN
  FOR v_rec IN
    SELECT * FROM public.v_lcc_merge_candidates
    WHERE auto_mergeable = true
    ORDER BY member_count DESC, best_role_score DESC
  LOOP
    IF p_dry_run THEN
      norm_name := v_rec.norm_name;
      winner_name := v_rec.winner_name;
      loser_count := array_length(v_rec.loser_ids, 1);
      applied := false;
      RETURN NEXT;
      CONTINUE;
    END IF;

    FOREACH v_loser IN ARRAY v_rec.loser_ids LOOP
      PERFORM public.lcc_merge_entity(v_loser, v_rec.winner_id);
    END LOOP;

    norm_name := v_rec.norm_name;
    winner_name := v_rec.winner_name;
    loser_count := array_length(v_rec.loser_ids, 1);
    applied := true;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_apply_fuzzy_merges(boolean) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. One-shot apply: run the auto-merges as part of this migration
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.lcc_apply_fuzzy_merges(false);
  RAISE NOTICE 'Fuzzy merge applied: % auto-mergeable groups processed', v_count;
END;
$$;

COMMIT;
