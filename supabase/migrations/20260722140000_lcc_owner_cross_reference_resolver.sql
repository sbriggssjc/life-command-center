-- ============================================================================
-- Owner cross-reference resolver (resolve a contactless owner's decision-maker
-- from a RELATED owner we've ALREADY contacted, in our own entity graph)
-- LCC Opps · additive · reversible (DROP the objects below → zero trace)
-- ----------------------------------------------------------------------------
-- Implements the FRONT of Scott's ownership-resolution chain: County → records →
-- cross-match against our existing contact/company records + naming structure.
-- This is the part the system can do for FREE on data we already hold — the
-- cross-reference / naming-structure / same-asset / SPE-family match against the
-- LCC entity graph. Web search (Brave) stays the LAST step (separately parked).
--
-- Grounded live 2026-06-27 (LCC Opps xengecqvemvfknjvbvrq):
--   * Owner entities carry NO notice/recorded/registered address in LCC (0/3,519
--     worklist owners) — those live only in the domain DBs. So the prompt's
--     "shared address" strategy is reinterpreted as SHARED ASSET (two owners
--     linked to the same property via `owns` edges) — the LCC-grounded form of
--     "same records overlap". Honest: same_asset yields 0 on the worklist today
--     (assets are single-owner) but is the correct mechanism as the graph grows.
--   * Only ~66 owner entities carry any reusable person contact (595 persons,
--     dominated by buyer parents). same_parent (R5/R6) yields ~0 on the worklist
--     by construction (buyer SPEs/parents are EXCLUDED from the worklist) — kept
--     for the broader/pivot population.
--   * naming_core (distinctive shared name-core) yields the real, SAFE matches:
--     Starwood REIT/Property Trust → Starwood Capital Group; Palestra Properties
--     → Palestra Real Estate Partners. A single COMMON token ("thomas",
--     "healthcare", "sage") over-matches WRONG families, so the guard requires a
--     multi-token shared core OR a distinctive single token (len ≥ 8, not in an
--     industry/geo denylist).
--
-- Three strategies, priority order (most → least authoritative), each guarded by
-- the existing SQL person guards (lcc_looks_like_person / lcc_is_rejected_contact_name)
-- and never reusing an operator's contacts. No confident related contact ⇒ no row
-- (the worker falls through to SOS/web/manual — never a guess). The picker prefers
-- the SOURCE owner's own designated active decision-maker (its pivot active
-- contact), then a title-seniority-ranked BD/principal person.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Reusable-contact source view: an OWNER entity that already carries a real,
-- guard-passed PERSON contact we could reuse for a related owner. Title-seniority
-- scored so the picker prefers a decision-maker (BD/acquisitions/C-suite) over a
-- junior analyst. This is the LIVE/refresh source; the resolver reads the cache
-- table below (the guards here are per-row-expensive). ~595 rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_reusable_owner_contacts AS
SELECT
  er.from_entity_id                              AS source_owner_id,
  e2.name                                        AS source_owner_name,
  public.lcc_normalize_entity_name(e2.name)      AS source_core,
  pe.id                                          AS person_id,
  pe.name                                        AS person_name,
  pe.title                                       AS person_title,
  COALESCE(NULLIF(btrim(er.metadata->>'role'), ''), 'principal') AS edge_role,
  er.created_at                                  AS edge_created,
  CASE
    WHEN lower(coalesce(pe.title,'')) ~ '(business development|acquisition|investor relation|capital market)' THEN 100
    WHEN lower(coalesce(pe.title,'')) ~ '(chief|ceo|cfo|coo|president|founder|managing partner|principal|owner)' THEN 90
    WHEN lower(coalesce(pe.title,'')) ~ '(managing director|head of)' THEN 80
    WHEN lower(coalesce(pe.title,'')) ~ 'partner' THEN 70
    WHEN lower(coalesce(pe.title,'')) ~ '(senior vice president|executive vice president|\msvp\M|\mevp\M)' THEN 60
    WHEN lower(coalesce(pe.title,'')) ~ '(vice president|\mvp\M)' THEN 50
    WHEN lower(coalesce(pe.title,'')) ~ 'director' THEN 40
    ELSE 10
  END                                            AS seniority
FROM public.entity_relationships er
JOIN public.entities e2
  ON e2.id = er.from_entity_id
 AND e2.merged_into_entity_id IS NULL
 AND NOT public.lcc_is_operator_owner_name(e2.name)   -- never reuse an OPERATOR's contacts (DaVita/Fresenius)
JOIN public.entities pe
  ON pe.id = er.to_entity_id
 AND pe.entity_type = 'person'
 AND pe.merged_into_entity_id IS NULL
 AND pe.name IS NOT NULL
 AND public.lcc_looks_like_person(pe.name)
 AND NOT public.lcc_is_rejected_contact_name(pe.name)
 AND COALESCE((pe.metadata->>'junk_name_flagged')::boolean, false) = false
WHERE er.relationship_type IN ('associated_with', 'contact_at', 'works_at');

COMMENT ON VIEW public.v_lcc_reusable_owner_contacts IS
  'Owner entities carrying a guard-passed reusable person contact, title-seniority scored. Refresh source for lcc_reusable_owner_contacts.';
GRANT SELECT ON public.v_lcc_reusable_owner_contacts TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cache table (R7 caching doctrine — empty cache ⇒ resolver naming/asset return
-- nothing ⇒ cache-or-live safe; a stalled cron only ever costs YIELD, never
-- correctness). `first_token` is the first name-core token, used to prefilter
-- the whole-token-prefix naming match cheaply.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_reusable_owner_contacts (
  source_owner_id   uuid    NOT NULL,
  source_owner_name text,
  source_core       text,
  first_token       text,
  person_id         uuid    NOT NULL,
  person_name       text,
  person_title      text,
  edge_role         text,
  edge_created      timestamptz,
  seniority         int
);
CREATE INDEX IF NOT EXISTS idx_lcc_reusable_first_token ON public.lcc_reusable_owner_contacts (first_token);
CREATE INDEX IF NOT EXISTS idx_lcc_reusable_source ON public.lcc_reusable_owner_contacts (source_owner_id);
ALTER TABLE public.lcc_reusable_owner_contacts
  SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 500);
GRANT SELECT ON public.lcc_reusable_owner_contacts TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lcc_refresh_reusable_owner_contacts()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  TRUNCATE public.lcc_reusable_owner_contacts;
  INSERT INTO public.lcc_reusable_owner_contacts
    (source_owner_id, source_owner_name, source_core, first_token, person_id,
     person_name, person_title, edge_role, edge_created, seniority)
  SELECT source_owner_id, source_owner_name, source_core,
         split_part(source_core, ' ', 1), person_id, person_name, person_title,
         edge_role, edge_created, seniority
  FROM public.v_lcc_reusable_owner_contacts;
  ANALYZE public.lcc_reusable_owner_contacts;
END;
$$;
GRANT EXECUTE ON FUNCTION public.lcc_refresh_reusable_owner_contacts() TO service_role;

-- ---------------------------------------------------------------------------
-- The resolver: for a contactless owner, return the SINGLE best reusable person
-- from a RELATED owner (same_asset → same_parent → naming_core), or no row.
-- Reads the cache table (fast); guards were applied at refresh time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_resolve_owner_cross_reference(p_entity_id uuid)
RETURNS TABLE (
  person_entity_id  uuid, person_name text, person_role text, person_title text,
  strategy text, source_entity_id uuid, source_owner_name text, confidence text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name  text;
  v_core  text;
  v_token text;
  v_generic text[] := ARRAY[
    'healthcare','national','american','united','global','pacific','western','eastern',
    'northern','southern','atlantic','premier','prime','summit','capital','equity','realty',
    'property','properties','holdings','partners','associates','management','investments',
    'development','enterprises','group','trust','ventures','advisors','financial','commercial',
    'residential','industrial','retail','medical','senior','first','general','standard',
    'consolidated','integrated','metropolitan','metro','central','liberty','heritage','legacy',
    'community','sterling','pinnacle','horizon','gateway','cornerstone','keystone','landmark',
    'investment','realestate','real','estate','income'];
BEGIN
  SELECT e.name, public.lcc_normalize_entity_name(e.name) INTO v_name, v_core
  FROM public.entities e WHERE e.id = p_entity_id AND e.merged_into_entity_id IS NULL;
  IF v_name IS NULL THEN RETURN; END IF;
  v_token := split_part(coalesce(v_core,''), ' ', 1);

  -- Already connected (has its own reusable person) → no cross-ref needed.
  IF EXISTS (SELECT 1 FROM public.lcc_reusable_owner_contacts r WHERE r.source_owner_id = p_entity_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  same_asset AS (   -- Strategy A: a co-owner of a shared property (LCC "shared records").
    SELECT DISTINCT o2.from_entity_id AS source_id, 1 AS prio, 'same_asset'::text AS strat
    FROM public.entity_relationships o1
    JOIN public.entity_relationships o2
      ON o2.to_entity_id = o1.to_entity_id AND o2.from_entity_id <> o1.from_entity_id
    WHERE o1.relationship_type = 'owns' AND o2.relationship_type = 'owns'
      AND o1.from_entity_id = p_entity_id
  ),
  same_parent AS (  -- Strategy B: the R5/R6 resolved parent (SPE/buyer family).
    SELECT bp.parent_entity_id AS source_id, 2 AS prio, 'same_parent'::text AS strat
    FROM public.lcc_resolve_buyer_parent(p_entity_id) bp
    WHERE bp.parent_entity_id IS NOT NULL AND bp.parent_entity_id <> p_entity_id
  ),
  naming AS (       -- Strategy C: a DISTINCTIVE shared name-core (whole-token overlap).
    SELECT r.source_owner_id AS source_id, 3 AS prio, 'naming_core'::text AS strat
    FROM (SELECT DISTINCT source_owner_id, source_core FROM public.lcc_reusable_owner_contacts
          WHERE first_token = v_token) r,
    LATERAL (
      SELECT CASE
               WHEN r.source_core = v_core THEN v_core
               WHEN r.source_core LIKE v_core || ' %' THEN v_core
               WHEN v_core LIKE r.source_core || ' %' THEN r.source_core
               ELSE NULL END AS shared
    ) sc
    WHERE r.source_owner_id <> p_entity_id
      AND length(coalesce(v_core,'')) >= 4
      AND sc.shared IS NOT NULL
      AND ( array_length(regexp_split_to_array(sc.shared, ' '), 1) >= 2
            OR (array_length(regexp_split_to_array(sc.shared, ' '), 1) = 1
                AND length(sc.shared) >= 8 AND NOT (sc.shared = ANY (v_generic))) )
  ),
  candidates AS (
    SELECT source_id, prio, strat FROM same_asset
    UNION ALL SELECT source_id, prio, strat FROM same_parent
    UNION ALL SELECT source_id, prio, strat FROM naming
  ),
  best_source AS (  -- one strategy per source, highest priority wins
    SELECT DISTINCT ON (source_id) source_id, prio, strat
    FROM candidates WHERE source_id <> p_entity_id ORDER BY source_id, prio
  ),
  ranked AS (
    SELECT r.person_id, r.person_name, r.edge_role, r.person_title, bs.strat,
           r.source_owner_id, r.source_owner_name, bs.prio, r.seniority, r.edge_created,
           (sp.active_contact_entity_id = r.person_id) AS is_source_active
    FROM best_source bs
    JOIN public.lcc_reusable_owner_contacts r ON r.source_owner_id = bs.source_id
    LEFT JOIN public.owner_contact_pivot sp ON sp.entity_id = bs.source_id
  )
  SELECT ranked.person_id, ranked.person_name, ranked.edge_role, ranked.person_title,
         ranked.strat, ranked.source_owner_id, ranked.source_owner_name,
         CASE WHEN ranked.prio = 1 THEN 'high' ELSE 'medium' END
  FROM ranked
  ORDER BY ranked.prio ASC,
           (ranked.is_source_active IS TRUE) DESC,   -- reuse the source's OWN designated decision-maker
           ranked.seniority DESC,
           ranked.edge_created ASC NULLS LAST,
           ranked.person_name ASC
  LIMIT 1;
END;
$$;
COMMENT ON FUNCTION public.lcc_resolve_owner_cross_reference(uuid) IS
  'Resolve a contactless owner''s decision-maker by reusing a guard-passed person from a related owner (same_asset -> same_parent -> naming_core). Returns 0 or 1 row.';
GRANT EXECUTE ON FUNCTION public.lcc_resolve_owner_cross_reference(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Dry-run / sizing: run the resolver over the value-ranked top-N contactless
-- worklist WITHOUT writing. The LATERAL is bounded to the value-ranked head
-- (p_limit) so a sizing call stays cheap. Reuses the per-owner resolver (no drift).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_cross_reference_worklist_preview(
  p_min_value numeric DEFAULT 1000000, p_limit int DEFAULT 500)
RETURNS TABLE (
  entity_id uuid, owner_name text, rank_value numeric, strategy text,
  source_entity_id uuid, source_owner_name text, person_name text, person_role text, confidence text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.entity_id, w.owner_name, w.rank_value, x.strategy, x.source_entity_id,
         x.source_owner_name, x.person_name, x.person_role, x.confidence
  FROM (
    SELECT entity_id, owner_name, rank_value
    FROM public.v_owner_contact_worklist
    WHERE rank_value >= COALESCE(p_min_value, 0)
    ORDER BY rank_value DESC NULLS LAST
    LIMIT GREATEST(COALESCE(p_limit, 500), 1)
  ) w
  CROSS JOIN LATERAL public.lcc_resolve_owner_cross_reference(w.entity_id) x
  ORDER BY w.rank_value DESC NULLS LAST;
$$;
COMMENT ON FUNCTION public.lcc_cross_reference_worklist_preview(numeric, int) IS
  'Read-only sizing of the cross-reference yield over the value-ranked contactless worklist (no writes).';
GRANT EXECUTE ON FUNCTION public.lcc_cross_reference_worklist_preview(numeric, int) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Unit 2 — extend pivot-ensure to cover NON-bridged-signal high-value worklist
-- owners. Grounded: the naming-resolvable owners (Starwood ×2, Palestra) are
-- bridged but carry NO captured manager/agent signal, so they are NOT in
-- v_owner_active_contact and the prior ensure was a no-op → the enrichment worker
-- (and its cross-ref step) could never reach them. Now: if not in
-- v_owner_active_contact BUT a valued contactless worklist owner, seed a minimal
-- pivot (manual_research) so the worker reaches it. Bounded to worklist owners;
-- additive (only creates MORE pivots); reversible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_ensure_owner_pivot(p_entity_id uuid)
RETURNS public.owner_contact_pivot LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_row public.owner_contact_pivot;
BEGIN
  SELECT * INTO v_row FROM public.owner_contact_pivot WHERE entity_id = p_entity_id;
  IF FOUND THEN RETURN v_row; END IF;

  INSERT INTO public.owner_contact_pivot (
    entity_id, owner_name, workspace_id, active_contact_name, active_contact_entity_id,
    active_authority_level, active_contact_role, active_source, confidence, enrichment_action, bench)
  SELECT a.entity_id, a.owner_name, a.workspace_id, a.active_contact_name, a.active_contact_entity_id,
         a.active_authority_level, a.active_contact_role, a.active_source, a.confidence, a.enrichment_action, a.bench
  FROM public.v_owner_active_contact a WHERE a.entity_id = p_entity_id
  ON CONFLICT (entity_id) DO NOTHING;
  SELECT * INTO v_row FROM public.owner_contact_pivot WHERE entity_id = p_entity_id;
  IF FOUND THEN RETURN v_row; END IF;

  -- Fallback (Unit 2): a valued contactless worklist owner with no captured signals.
  INSERT INTO public.owner_contact_pivot (entity_id, owner_name, workspace_id, enrichment_action, active_source)
  SELECT e.id, e.name, e.workspace_id, 'manual_research', 'worklist_fallback'
  FROM public.entities e
  WHERE e.id = p_entity_id
    AND EXISTS (SELECT 1 FROM public.v_owner_contact_worklist w WHERE w.entity_id = p_entity_id)
  ON CONFLICT (entity_id) DO NOTHING;
  SELECT * INTO v_row FROM public.owner_contact_pivot WHERE entity_id = p_entity_id;
  RETURN v_row;
END;
$function$;

-- Hourly refresh (slow-moving — the contact graph changes on attach; a band-moving
-- attach matters within a tick, not a minute). Idempotent re-register.
SELECT cron.unschedule('lcc-reusable-owner-contacts-refresh')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-reusable-owner-contacts-refresh');
SELECT cron.schedule('lcc-reusable-owner-contacts-refresh', '23 * * * *',
  $$SELECT public.lcc_refresh_reusable_owner_contacts();$$);

-- Initial populate.
SELECT public.lcc_refresh_reusable_owner_contacts();
