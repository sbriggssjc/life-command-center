-- CONTACT-SELECTION Slice 2 (2026-06-20) — LCC Opps. Pivot state + feedback
-- re-ranking. The active contact is a HYPOTHESIS that pivots as research +
-- outbound feedback arrive. Builds on Slice 1's v_owner_active_contact. Also
-- folds in two Slice-1 view refinements (Scott's gate): tightened &-partnership
-- detector + a public-company IR-contact carve-out for enrichment routing.
-- All additive / reversible (pivot_history is the audit trail; never hard-delete
-- a contact). Drop owner_contact_pivot + the three functions -> zero trace.

BEGIN;

-- ---- refinement 1: public-company detector (IR-contact carve-out) -----------
-- Public REITs / insurers have a known IR/asset-management contact path, NOT an
-- SOS filing or a residential reverse-lookup. Conservative: only clear publics.
CREATE OR REPLACE FUNCTION public.lcc_is_public_company_name(p_name text)
RETURNS boolean AS $fn$
BEGIN
  IF p_name IS NULL THEN RETURN false; END IF;
  RETURN p_name ~* '\m(REIT|real estate investment trust)\M'
      OR p_name ~* '\m(income|realty|properties|healthcare|office|residential|industrial|retail|medical)\s+(trust|properties)\M'
      OR p_name ~* '\m(realty income|agree realty|w\.?\s?p\.?\s?carey|spirit realty|national retail|store capital|broadstone|essential properties|community healthcare trust|physicians realty|healthpeak|ventas|welltower|omega healthcare|global net lease|gladstone|getty realty|four corners)\M'
      OR p_name ~* '\m(massmutual|mass mutual|prudential|metlife|met life|nationwide|northwestern mutual|new york life|tiaa|state farm|principal financial|aig|allstate|guardian life|pacific life)\M'
      OR p_name ~* '\m(bancorp|bancshares)\M';
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;
REVOKE ALL ON FUNCTION public.lcc_is_public_company_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lcc_is_public_company_name(text) TO authenticated;

-- ---- re-apply v_owner_active_contact: tightened partnership + public carve ---
CREATE OR REPLACE VIEW public.v_owner_active_contact
WITH (security_invoker = true) AS
WITH cand AS (SELECT * FROM public.v_owner_contact_candidates),
ranked AS (
  SELECT c.*,
    row_number() OVER (PARTITION BY entity_id ORDER BY
       authority_level ASC, is_named_individual DESC, n_props DESC,
       (source='related_person') DESC, candidate_name) AS rn,
    count(*) OVER (PARTITION BY entity_id) AS bench_size,
    count(*) FILTER (WHERE authority_level=2) OVER (PARTITION BY entity_id) AS n_managers
  FROM cand c
),
bench AS (
  SELECT entity_id,
    jsonb_agg(jsonb_build_object('name',candidate_name,'role',contact_role,
      'authority',authority_level,'source',source,'is_named_individual',is_named_individual,
      'n_props',n_props,'contact_entity_id',contact_entity_id)
      ORDER BY authority_level, is_named_individual DESC, n_props DESC, candidate_name) AS bench
  FROM cand GROUP BY entity_id
),
mirror_owner AS (
  SELECT DISTINCT ON (x.source_system, x.external_id)
         e.id AS entity_id, e.name AS owner_name, e.workspace_id, m.has_reg_address
  FROM public.lcc_owner_contact_signals m
  JOIN public.external_identities x ON x.source_type='true_owner'
       AND x.source_system=m.source_domain AND x.external_id=m.source_true_owner_id
  JOIN public.entities e ON e.id=x.entity_id AND e.merged_into_entity_id IS NULL
  WHERE NOT public.lcc_is_operator_owner_name(e.name)
  ORDER BY x.source_system, x.external_id, e.created_at NULLS LAST, e.id
),
universe AS (
  SELECT entity_id FROM ranked WHERE rn=1
  UNION
  SELECT entity_id FROM mirror_owner
)
SELECT
  u.entity_id, COALESCE(r.owner_name, mo.owner_name) AS owner_name,
  COALESCE(r.workspace_id, mo.workspace_id) AS workspace_id,
  r.candidate_name AS active_contact_name, r.contact_role AS active_contact_role,
  r.authority_level AS active_authority_level, r.source AS active_source,
  r.contact_entity_id AS active_contact_entity_id, r.is_named_individual,
  COALESCE(b.bench, '[]'::jsonb) AS bench, COALESCE(r.bench_size, 0) AS bench_size,
  CASE WHEN r.entity_id IS NULL THEN NULL
       WHEN r.authority_level <= 2 AND r.is_named_individual THEN 'high'
       WHEN r.authority_level <= 3 THEN 'medium' ELSE 'low' END AS confidence,
  -- tightened partnership: genuine multi-principal only
  ( COALESCE(r.n_managers, 0) >= 2
    OR COALESCE(r.owner_name, mo.owner_name) ~* '\m(jv|joint venture)\M'
    OR ( COALESCE(r.owner_name, mo.owner_name) ~ '\m\w+ & \w+\M'
         AND NOT COALESCE(r.owner_name, mo.owner_name) ~* '\m(LLC|LP|LLP|LLLP|INC|CORP|COMPANY|CO|TRUST|HOLDINGS|GROUP|MANAGEMENT|PROPERTIES|ASSOCIATES|REALTY|PLLC|LTD|PARTNERS)\M' )
  ) AS partnership,
  CASE WHEN r.entity_id IS NOT NULL THEN NULL
       WHEN public.lcc_is_public_company_name(COALESCE(r.owner_name, mo.owner_name)) THEN 'public_company_ir'
       WHEN COALESCE(r.owner_name, mo.owner_name) ~* '\m(LLC|L\.?L\.?C|LP|LLP|LLLP|INC|CORP|CORPORATION|COMPANY|TRUST|HOLDINGS|PARTNERS|GROUP|MANAGEMENT|PROPERTIES|ASSOCIATES|VENTURES|REALTY|PLLC|LTD)\M'
         THEN 'sos_manager_lookup'
       WHEN mo.has_reg_address THEN 'address_reverse_lookup'
       ELSE 'manual_research' END AS enrichment_action
FROM universe u
LEFT JOIN ranked r ON r.entity_id=u.entity_id AND r.rn=1
LEFT JOIN bench  b ON b.entity_id=u.entity_id
LEFT JOIN mirror_owner mo ON mo.entity_id=u.entity_id;

-- ---- pivot state ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.owner_contact_pivot (
  entity_id                uuid PRIMARY KEY,
  owner_name               text,
  workspace_id             uuid,
  active_contact_name      text,
  active_contact_entity_id uuid,
  active_authority_level   int,
  active_contact_role      text,
  active_source            text,
  confidence               text,
  enrichment_action        text,
  bench                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  consumed                 jsonb NOT NULL DEFAULT '[]'::jsonb,   -- names tried (no_response)
  demoted                  jsonb NOT NULL DEFAULT '[]'::jsonb,   -- names demoted (bounce/wrong)
  recurrence_locked        boolean NOT NULL DEFAULT false,
  status                   text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','locked','exhausted','superseded')),
  pivot_history            jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.owner_contact_pivot
  SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05,
       autovacuum_vacuum_threshold = 200, autovacuum_analyze_threshold = 200);

-- Seed/refresh pivot rows from v_owner_active_contact. Idempotent — INSERTs only
-- missing owners; NEVER clobbers an existing pivot's active pick (preserves
-- manual + feedback pivots). Returns the count seeded.
CREATE OR REPLACE FUNCTION public.lcc_seed_owner_contact_pivots()
RETURNS TABLE(seeded int) AS $fn$
DECLARE v_seeded int;
BEGIN
  INSERT INTO public.owner_contact_pivot (
    entity_id, owner_name, workspace_id, active_contact_name, active_contact_entity_id,
    active_authority_level, active_contact_role, active_source, confidence,
    enrichment_action, bench)
  SELECT a.entity_id, a.owner_name, a.workspace_id, a.active_contact_name,
         a.active_contact_entity_id, a.active_authority_level, a.active_contact_role,
         a.active_source, a.confidence, a.enrichment_action, a.bench
  FROM public.v_owner_active_contact a
  ON CONFLICT (entity_id) DO NOTHING;
  GET DIAGNOSTICS v_seeded = ROW_COUNT;
  seeded := v_seeded; RETURN NEXT;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.lcc_seed_owner_contact_pivots() FROM PUBLIC;

-- Ensure a single pivot row exists for an entity (seed-on-demand from the view).
CREATE OR REPLACE FUNCTION public.lcc_ensure_owner_pivot(p_entity_id uuid)
RETURNS public.owner_contact_pivot AS $fn$
DECLARE v_row public.owner_contact_pivot;
BEGIN
  SELECT * INTO v_row FROM public.owner_contact_pivot WHERE entity_id = p_entity_id;
  IF FOUND THEN RETURN v_row; END IF;
  INSERT INTO public.owner_contact_pivot (
    entity_id, owner_name, workspace_id, active_contact_name, active_contact_entity_id,
    active_authority_level, active_contact_role, active_source, confidence,
    enrichment_action, bench)
  SELECT a.entity_id, a.owner_name, a.workspace_id, a.active_contact_name,
         a.active_contact_entity_id, a.active_authority_level, a.active_contact_role,
         a.active_source, a.confidence, a.enrichment_action, a.bench
  FROM public.v_owner_active_contact a WHERE a.entity_id = p_entity_id
  ON CONFLICT (entity_id) DO NOTHING;
  SELECT * INTO v_row FROM public.owner_contact_pivot WHERE entity_id = p_entity_id;
  RETURN v_row;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.lcc_ensure_owner_pivot(uuid) FROM PUBLIC;

-- The single feedback re-ranker. kinds:
--   referral    {to_name, [to_entity_id]} -> pivot active to the named person
--   no_response                            -> move DOWN the bench (next untried)
--   bounce|wrong_person                    -> demote current + pivot to next
--   two_way|positive                       -> LOCK current (engaged; human takes over)
--   recurrence                             -> set recurrence_locked on current
-- Every change appends pivot_history {at,kind,reason,source,from,to}. Reversible.
CREATE OR REPLACE FUNCTION public.lcc_apply_contact_feedback(
  p_entity_id uuid, p_kind text, p_detail jsonb DEFAULT '{}'::jsonb,
  p_source text DEFAULT 'manual')
RETURNS jsonb AS $fn$
DECLARE
  v_row     public.owner_contact_pivot;
  v_cur     text;
  v_new     text;
  v_new_eid uuid;
  v_reason  text;
  v_status  text;
  v_reclock boolean;
  v_consumed jsonb;
  v_demoted  jsonb;
  v_bench    jsonb;
  v_cand     jsonb;
  v_meta     jsonb;
BEGIN
  v_row := public.lcc_ensure_owner_pivot(p_entity_id);
  IF v_row.entity_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_owner_pivot');
  END IF;
  v_cur := v_row.active_contact_name;
  v_status := v_row.status;
  v_reclock := v_row.recurrence_locked;
  v_consumed := v_row.consumed;
  v_demoted := v_row.demoted;
  v_bench := v_row.bench;
  v_new := v_cur; v_new_eid := v_row.active_contact_entity_id;

  IF p_kind = 'referral' THEN
    v_new := btrim(p_detail->>'to_name');
    IF v_new IS NULL OR v_new = '' THEN RETURN jsonb_build_object('ok',false,'reason','referral_needs_to_name'); END IF;
    v_new_eid := NULLIF(p_detail->>'to_entity_id','')::uuid;
    -- add to bench front if not present
    IF NOT (v_bench @> jsonb_build_array(jsonb_build_object('name', v_new))) AND
       NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_bench) e WHERE lower(e->>'name')=lower(v_new)) THEN
      v_bench := jsonb_build_array(jsonb_build_object(
        'name', v_new, 'role', 'referred', 'authority', 1, 'source', 'referral',
        'is_named_individual', public.lcc_looks_like_person(v_new), 'n_props', 1,
        'contact_entity_id', v_new_eid)) || v_bench;
    END IF;
    v_reason := 'referral_to_' || v_new; v_status := 'active';

  ELSIF p_kind IN ('two_way','positive') THEN
    v_status := 'locked'; v_reason := 'engaged_two_way';

  ELSIF p_kind = 'recurrence' THEN
    v_reclock := true; v_reason := 'cross_property_recurrence';

  ELSIF p_kind IN ('no_response','bounce','wrong_person') THEN
    IF v_status = 'locked' THEN
      RETURN jsonb_build_object('ok', true, 'noop', true, 'reason', 'locked_engaged', 'active', v_cur);
    END IF;
    IF p_kind = 'no_response' THEN
      v_consumed := v_consumed || to_jsonb(coalesce(v_cur,''));
      v_reason := 'no_response_advance';
    ELSE
      v_demoted := v_demoted || to_jsonb(coalesce(v_cur,''));
      v_reason := 'bounce_demote';
    END IF;
    -- next bench candidate not consumed and not demoted (and not current)
    SELECT e INTO v_cand
    FROM jsonb_array_elements(v_bench) WITH ORDINALITY t(e, ord)
    WHERE lower(e->>'name') <> lower(coalesce(v_cur,''))
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_consumed) c WHERE lower(c)=lower(e->>'name'))
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_demoted) d WHERE lower(d)=lower(e->>'name'))
    ORDER BY ord LIMIT 1;
    IF v_cand IS NULL THEN
      v_new := NULL; v_new_eid := NULL; v_status := 'exhausted';
    ELSE
      v_new := v_cand->>'name'; v_new_eid := NULLIF(v_cand->>'contact_entity_id','')::uuid;
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_kind', 'kind', p_kind);
  END IF;

  v_meta := jsonb_build_object('at', now(), 'kind', p_kind, 'reason', v_reason,
              'source', p_source, 'from', v_cur, 'to', v_new);

  UPDATE public.owner_contact_pivot SET
    active_contact_name = v_new,
    active_contact_entity_id = v_new_eid,
    status = v_status,
    recurrence_locked = v_reclock,
    consumed = v_consumed,
    demoted = v_demoted,
    bench = v_bench,
    enrichment_action = CASE WHEN v_new IS NULL THEN enrichment_action ELSE NULL END,
    pivot_history = pivot_history || v_meta,
    updated_at = now()
  WHERE entity_id = p_entity_id;

  RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'reason', v_reason,
           'active', v_new, 'status', v_status, 'recurrence_locked', v_reclock);
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.lcc_apply_contact_feedback(uuid,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lcc_apply_contact_feedback(uuid,text,jsonb,text) TO authenticated;

-- Passive research re-rank: lock owners whose ACTIVE contact recurs across >=2
-- of the owner's properties (n_props>=2 in the bench top) — a cross-property
-- signer/manager is a strong control signal. Idempotent.
CREATE OR REPLACE FUNCTION public.lcc_detect_contact_recurrence()
RETURNS TABLE(locked int) AS $fn$
DECLARE v_locked int;
BEGIN
  WITH upd AS (
    UPDATE public.owner_contact_pivot p SET recurrence_locked = true, updated_at = now(),
      pivot_history = pivot_history || jsonb_build_object('at',now(),'kind','recurrence',
        'reason','cross_property_recurrence_auto','source','recurrence_cron','from',p.active_contact_name,'to',p.active_contact_name)
    WHERE p.recurrence_locked = false
      AND p.active_contact_name IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(p.bench) e
        WHERE lower(e->>'name') = lower(p.active_contact_name)
          AND COALESCE((e->>'n_props')::int,1) >= 2)
    RETURNING 1)
  SELECT count(*) INTO v_locked FROM upd;
  locked := v_locked; RETURN NEXT;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.lcc_detect_contact_recurrence() FROM PUBLIC;

-- Daily refresh: seed new pivots + run recurrence detection.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-owner-contact-pivot-refresh') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='lcc-owner-contact-pivot-refresh');
    PERFORM cron.schedule('lcc-owner-contact-pivot-refresh', '20 5 * * *',
      $job$SELECT public.lcc_seed_owner_contact_pivots(); SELECT public.lcc_detect_contact_recurrence();$job$);
  END IF;
END $cron$;

COMMIT;
