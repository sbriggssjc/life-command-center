-- R9 Slice 3 classify-worker bug fix (2026-06-09): ledger cursor + verified,
-- outcome-truthful tagging. STOP-SHIP fix found during the live drain.
-- ===========================================================================
-- BUG: the classifier view excluded a candidate on
-- entities.canonical_name = lcc_normalize_entity_name(developer_name), but
-- ensureEntityLink mints/links the entity under a DIFFERENT canonical
-- (JS normalizeCanonicalName). For the ~3/44 names where the two normalizers
-- disagree, the tagged entity never matched the view's join, so the candidate
-- never left the view and the high-rent ones re-looped every tick -- the worker
-- re-PATCHed and counted `tagged` on each re-tag (reported 200, ~44 real). No
-- damage (re-tag is idempotent; collision check = 0 wrong entities), but the
-- cursor was wrong and the count was not outcome-truthful.
--
-- FIX (mirror the chain-connect-log pattern): a ledger keyed on the CANDIDATE
-- NORM (the view's own key, stable regardless of the entity's canonical_name),
-- written ONLY by a verified tag. The view excludes logged norms, so a tagged
-- candidate provably leaves the view. The worker counts `tagged` only when the
-- verified-tag RPC returns true.
--
-- Idempotent / additive. No backfill needed: the ~3 stuck high-rent candidates
-- are the top of the rent-ordered view, so the next worker tick reaches them,
-- the RPC re-affirms developer + logs the norm, and they drop. The crons
-- migration (20260609160000) stays UNAPPLIED until a clean drain is shown.

BEGIN;

-- 1. Ledger = the robust cursor (keyed on the candidate norm).
CREATE TABLE IF NOT EXISTS public.lcc_developer_classification_log (
  source_domain   text        NOT NULL CHECK (source_domain IN ('dia','gov')),
  candidate_norm  text        NOT NULL,
  entity_id       uuid        NOT NULL,
  candidate_name  text,
  signal          text        NOT NULL,
  tagged_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_domain, candidate_norm)
);
CREATE INDEX IF NOT EXISTS idx_lcc_developer_classification_log_entity
  ON public.lcc_developer_classification_log (entity_id);
GRANT SELECT ON public.lcc_developer_classification_log TO authenticated;

-- 2. Verified, atomic tag: set the role + metadata marker AND log the norm in
--    one statement; return true only when the role write actually took.
CREATE OR REPLACE FUNCTION public.lcc_tag_developer(
  p_entity_id uuid, p_signal text, p_norm text, p_candidate_name text, p_source_domain text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  UPDATE public.entities
  SET behavioral_override = 'developer',
      behavioral_override_reason = 'r9_slice3 chain developer (' || p_signal || ')',
      behavioral_override_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb)
                 || jsonb_build_object('developer_classified_by', 'r9_slice3',
                                       'developer_classified_at', now())
  WHERE id = p_entity_id AND merged_into_entity_id IS NULL
  RETURNING COALESCE(behavioral_override, owner_role) INTO v_role;

  IF v_role IS DISTINCT FROM 'developer' THEN
    RETURN false;   -- write did not take (no row / merged) -> not truthful to count
  END IF;

  INSERT INTO public.lcc_developer_classification_log
    (source_domain, candidate_norm, entity_id, candidate_name, signal, tagged_at)
  VALUES (p_source_domain, p_norm, p_entity_id, p_candidate_name, p_signal, now())
  ON CONFLICT (source_domain, candidate_norm) DO UPDATE
    SET entity_id = EXCLUDED.entity_id, candidate_name = EXCLUDED.candidate_name,
        signal = EXCLUDED.signal, tagged_at = now();
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.lcc_tag_developer(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lcc_tag_developer(uuid,text,text,text,text) TO service_role, authenticated;

-- 3. View: add the ledger exclusion (keyed on the candidate norm). Keeps the
--    cur_role / parent / shell / registered-parent exclusions (belt) and adds
--    the ledger (suspenders) so a tagged candidate provably drops regardless of
--    the canonical_name normalizer mismatch.
CREATE OR REPLACE VIEW public.v_lcc_developer_classification_candidates
WITH (security_invoker = true) AS
WITH named AS (
  SELECT pof.source_domain, public.lcc_normalize_entity_name(pof.developer_name) AS norm,
         min(pof.developer_name) AS candidate_name, count(*) AS props,
         COALESCE(sum( (SELECT max(pf.annual_rent) FROM public.lcc_entity_portfolio_facts pf
                        WHERE pf.source_domain = pof.source_domain AND pf.source_property_id = pof.source_property_id AND pf.is_current) ), 0) AS attributed_rent
  FROM public.lcc_property_owner_facts pof
  WHERE pof.developer_name IS NOT NULL AND btrim(pof.developer_name) <> ''
    AND public.lcc_normalize_entity_name(pof.developer_name) IS NOT NULL
  GROUP BY pof.source_domain, public.lcc_normalize_entity_name(pof.developer_name)
),
named_c AS (
  SELECT 'named_developer'::text AS signal, n.source_domain, n.candidate_name, n.norm, n.props, n.attributed_rent,
         e.id AS entity_id, COALESCE(e.behavioral_override, e.owner_role) AS cur_role
  FROM named n
  LEFT JOIN public.entities e ON e.canonical_name = n.norm AND e.merged_into_entity_id IS NULL AND e.entity_type = 'organization'
)
SELECT u.signal, u.source_domain, u.candidate_name, u.norm, u.props, u.attributed_rent, u.entity_id, u.cur_role
FROM named_c u
WHERE COALESCE(u.cur_role, '') NOT IN ('operator', 'developer')
  AND (u.entity_id IS NULL OR u.entity_id NOT IN (SELECT parent_entity_id FROM public.lcc_buyer_parents))
  AND (u.entity_id IS NULL OR u.entity_id NOT IN (SELECT entity_id FROM public.lcc_buyer_spe_resolved))
  AND NOT EXISTS (SELECT 1 FROM public.lcc_match_buyer_parent_by_name(u.candidate_name))
  AND NOT EXISTS (SELECT 1 FROM public.lcc_developer_classification_log lg
                  WHERE lg.source_domain = u.source_domain AND lg.candidate_norm = u.norm);

COMMIT;
