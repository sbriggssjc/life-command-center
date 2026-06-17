-- ============================================================================
-- R39 — contact/entity dedup: email as a write-time key + person merge lane
-- (2026-06-16)
--
-- Completes the dedup-at-source sweep after R37 (sales) / R38 (listings). The
-- entity graph has the same re-capture duplication shape, at modest scale:
-- grounded live 2026-06-16, 251 non-generic email groups / 682 active person
-- entities share an email (info@/sales@ shared inboxes excluded). ensureEntityLink
-- resolved by canonical_name / external_identity but NOT by email, so the same
-- person captured under a slightly different name with the same email minted a
-- fresh duplicate (~11/week). Unit 1 (JS) closes that at the write choke point.
--
-- This migration is the DB side: (1) make the EXISTING merge engine person-safe
-- and (2) add the bounded person-email candidates view + apply function. Reuses
-- lcc_merge_entity / v_lcc_merge_candidates patterns — no new merge engine.
--
-- GROUNDING REFUTED the audit's "lcc_merge_entity already snapshots backrefs"
-- premise: the engine only moved lcc_entity_portfolio_facts + external_identities,
-- but ALL 682 duplicate persons carry entity_relationships and 74 are cadence
-- contacts — a naive person merge would ORPHAN those edges and leave cadences
-- pointing at a tombstoned loser. Unit 0 below makes the engine COMPLETE for
-- persons (and strictly more correct for orgs) before any person merge runs.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Unit 0 — make lcc_merge_entity person-complete (additive; org logic + the
-- 2-col return signature are byte-identical, so the org auto-merge cron /
-- exact-merge worker / Decision Center merge lane are unaffected). All new
-- moves are dedup-safe repoints of the remaining entities(id) backrefs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_merge_entity(p_loser uuid, p_winner uuid)
RETURNS TABLE(
  portfolio_edges_moved int,
  external_identities_moved int
) AS $$
DECLARE
  v_edges int := 0;
  v_xids int := 0;
BEGIN
  IF p_loser = p_winner THEN
    RAISE EXCEPTION 'lcc_merge_entity: loser and winner must differ';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.entities WHERE id = p_winner) THEN
    RAISE EXCEPTION 'lcc_merge_entity: winner % does not exist', p_winner;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.entities WHERE id = p_loser) THEN
    RAISE EXCEPTION 'lcc_merge_entity: loser % does not exist', p_loser;
  END IF;

  -- Portfolio facts: drop duplicates FIRST (own statement), then move. Two
  -- separate statements = no CTE concurrency hazard (BD gotcha #2).
  DELETE FROM public.lcc_entity_portfolio_facts f
  WHERE f.entity_id = p_loser
    AND EXISTS (
      SELECT 1 FROM public.lcc_entity_portfolio_facts w
      WHERE w.entity_id = p_winner
        AND w.source_domain = f.source_domain
        AND w.source_property_id = f.source_property_id
    );

  UPDATE public.lcc_entity_portfolio_facts
  SET entity_id = p_winner, updated_at = now()
  WHERE entity_id = p_loser;
  GET DIAGNOSTICS v_edges = ROW_COUNT;

  -- External identities: same dedup-then-move pattern.
  DELETE FROM public.external_identities x
  WHERE x.entity_id = p_loser
    AND EXISTS (
      SELECT 1 FROM public.external_identities w
      WHERE w.entity_id = p_winner
        AND w.workspace_id = x.workspace_id
        AND w.source_system = x.source_system
        AND w.source_type = x.source_type
        AND w.external_id = x.external_id
    );

  UPDATE public.external_identities
  SET entity_id = p_winner
  WHERE entity_id = p_loser;
  GET DIAGNOSTICS v_xids = ROW_COUNT;

  -- R39 Unit 0: entity_relationships — dedup-safe repoint of BOTH directions.
  -- No unique constraint exists, so dedup is content-based on
  -- (workspace, from, to, relationship_type). Order matters:
  --   1) drop rows that would become a self-loop (loser<->winner, loser<->loser),
  --   2) drop from=loser rows that duplicate an existing winner edge,
  --   3) drop to=loser   rows that duplicate an existing winner edge,
  --   4) repoint the survivors.
  DELETE FROM public.entity_relationships r
  WHERE (r.from_entity_id = p_loser AND r.to_entity_id = p_winner)
     OR (r.from_entity_id = p_winner AND r.to_entity_id = p_loser)
     OR (r.from_entity_id = p_loser AND r.to_entity_id = p_loser);

  DELETE FROM public.entity_relationships r
  WHERE r.from_entity_id = p_loser
    AND EXISTS (
      SELECT 1 FROM public.entity_relationships w
      WHERE w.from_entity_id = p_winner
        AND w.to_entity_id = r.to_entity_id
        AND w.relationship_type IS NOT DISTINCT FROM r.relationship_type
        AND w.workspace_id IS NOT DISTINCT FROM r.workspace_id);

  DELETE FROM public.entity_relationships r
  WHERE r.to_entity_id = p_loser
    AND EXISTS (
      SELECT 1 FROM public.entity_relationships w
      WHERE w.to_entity_id = p_winner
        AND w.from_entity_id = r.from_entity_id
        AND w.relationship_type IS NOT DISTINCT FROM r.relationship_type
        AND w.workspace_id IS NOT DISTINCT FROM r.workspace_id);

  UPDATE public.entity_relationships SET from_entity_id = p_winner WHERE from_entity_id = p_loser;
  UPDATE public.entity_relationships SET to_entity_id   = p_winner WHERE to_entity_id   = p_loser;

  -- R39 Unit 0: watchers — unique on (workspace, user, entity), so dedup then move.
  DELETE FROM public.watchers w
  WHERE w.entity_id = p_loser
    AND EXISTS (
      SELECT 1 FROM public.watchers x
      WHERE x.entity_id = p_winner
        AND x.workspace_id = w.workspace_id
        AND x.user_id IS NOT DISTINCT FROM w.user_id);
  UPDATE public.watchers SET entity_id = p_winner WHERE entity_id = p_loser;

  -- R39 Unit 0: the remaining entities(id) backrefs carry NO unique on entity_id
  -- (their uniques key on other columns), so a blind repoint is safe.
  -- touchpoint_cadence.contact_id is free text (no FK) but identifies the contact.
  UPDATE public.touchpoint_cadence SET contact_id = p_winner WHERE contact_id = p_loser;
  UPDATE public.activity_events     SET entity_id  = p_winner WHERE entity_id  = p_loser;
  UPDATE public.action_items        SET entity_id  = p_winner WHERE entity_id  = p_loser;
  UPDATE public.inbox_items         SET entity_id  = p_winner WHERE entity_id  = p_loser;
  UPDATE public.research_tasks      SET entity_id  = p_winner WHERE entity_id  = p_loser;
  UPDATE public.entity_aliases      SET entity_id  = p_winner WHERE entity_id  = p_loser;

  UPDATE public.entities
  SET merged_into_entity_id = p_winner,
      updated_at = now()
  WHERE id = p_loser;

  portfolio_edges_moved := v_edges;
  external_identities_moved := v_xids;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_merge_entity(uuid, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Unit 2a — person-name normalizer (IMMUTABLE; lower + de-punctuate + collapse)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_normalize_person_name(p_name text)
RETURNS text AS $$
  SELECT NULLIF(
    trim(regexp_replace(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', ' ', 'g'),
                        '\s+', ' ', 'g')),
    '');
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- Unit 2b — v_lcc_person_email_merge_candidates
--   One row per email shared by >=2 active person entities. Generic/role
--   inboxes (info@/sales@/…) and junk-name-flagged entities are excluded.
--   Winner = richest member (SF-linked > completeness > longest name > id).
--   name_compatible = every loser's normalized name is normalized-equal to the
--   winner OR a substring either direction (>=4 chars) — the high-confidence,
--   auto-mergeable slice. The rest is the ambiguous human-review remainder.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_person_email_merge_candidates
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    e.id,
    e.name,
    lower(trim(e.email)) AS norm_email,
    public.lcc_normalize_person_name(e.name) AS norm_name,
    -- A multi-person composite ("A, B, C" / "A & B" / "A and B") shares one
    -- email (a deal team CC'd on one mailbox) — never auto-merge a clean
    -- singleton into it; route such a group to human review.
    (e.name ~ ',' OR e.name ~* '\s&\s' OR e.name ~* '\sand\s') AS is_multi_name,
    (SELECT count(*) FROM public.external_identities x
       WHERE x.entity_id = e.id AND x.source_system = 'salesforce') AS sf_cnt,
    ((e.first_name IS NOT NULL)::int + (e.last_name IS NOT NULL)::int
      + (e.phone IS NOT NULL)::int + (e.title IS NOT NULL)::int) AS completeness
  FROM public.entities e
  WHERE e.entity_type = 'person'
    AND e.merged_into_entity_id IS NULL
    AND e.email IS NOT NULL
    AND lower(trim(e.email)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    AND coalesce((e.metadata->>'junk_name_flagged')::boolean, false) = false
),
filtered AS (
  SELECT * FROM base
  WHERE split_part(split_part(norm_email, '@', 1), '+', 1) <> ALL (ARRAY[
    'info','sales','leasing','admin','contact','contacts','office','hello',
    'support','team','marketing','hr','jobs','careers','noreply','no-reply',
    'donotreply','accounting','billing','legal','mail','email','general',
    'inquiries','enquiries','help','service','services','webmaster','postmaster'
  ])
),
grp AS (
  SELECT
    norm_email,
    array_agg(id   ORDER BY sf_cnt DESC, completeness DESC, length(coalesce(norm_name,'')) DESC, id) AS ids_wf,
    array_agg(name ORDER BY sf_cnt DESC, completeness DESC, length(coalesce(norm_name,'')) DESC, id) AS names_wf,
    array_agg(coalesce(norm_name,'') ORDER BY sf_cnt DESC, completeness DESC, length(coalesce(norm_name,'')) DESC, id) AS norms_wf,
    count(*) AS member_count,
    sum((sf_cnt > 0)::int) AS sf_linked_member_count,
    bool_or(is_multi_name) AS has_multi_name
  FROM filtered
  GROUP BY norm_email
  HAVING count(*) >= 2
)
SELECT
  norm_email AS email,
  ids_wf[1] AS winner_id,
  names_wf[1] AS winner_name,
  ids_wf[2:] AS loser_ids,
  names_wf[2:] AS loser_names,
  member_count,
  sf_linked_member_count,
  -- Auto-mergeable (high-confidence) iff: no multi-person composite in the group
  -- AND every loser's normalized name is equal to / a >=4-char substring of the
  -- winner's (or vice-versa). Everything else is the ambiguous review remainder.
  (NOT has_multi_name AND (SELECT bool_and(
     norms_wf[1] = ln
     OR (length(ln) >= 4 AND length(norms_wf[1]) >= 4
         AND (position(ln IN norms_wf[1]) > 0 OR position(norms_wf[1] IN ln) > 0))
   ) FROM unnest(norms_wf[2:]) AS ln)) AS name_compatible
FROM grp;

GRANT SELECT ON public.v_lcc_person_email_merge_candidates TO authenticated;

-- ---------------------------------------------------------------------------
-- Unit 2c — lcc_apply_person_email_merges(): auto-work the high-confidence
--   (email-exact + name-compatible) slice via the now-person-complete engine.
--   Conservative: ambiguous (name-incompatible) groups are NEVER touched here —
--   they route to the Decision Center merge lane for human judgment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_apply_person_email_merges(p_dry_run boolean DEFAULT true)
RETURNS TABLE(
  email text,
  winner_name text,
  loser_count int,
  applied boolean
) AS $$
DECLARE
  v_rec record;
  v_loser uuid;
BEGIN
  FOR v_rec IN
    SELECT * FROM public.v_lcc_person_email_merge_candidates
    WHERE name_compatible = true
    ORDER BY member_count DESC, email
  LOOP
    IF p_dry_run THEN
      email := v_rec.email;
      winner_name := v_rec.winner_name;
      loser_count := coalesce(array_length(v_rec.loser_ids, 1), 0);
      applied := false;
      RETURN NEXT;
      CONTINUE;
    END IF;

    FOREACH v_loser IN ARRAY v_rec.loser_ids LOOP
      PERFORM public.lcc_merge_entity(v_loser, v_rec.winner_id);
    END LOOP;

    email := v_rec.email;
    winner_name := v_rec.winner_name;
    loser_count := coalesce(array_length(v_rec.loser_ids, 1), 0);
    applied := true;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_apply_person_email_merges(boolean) FROM PUBLIC;

COMMIT;
