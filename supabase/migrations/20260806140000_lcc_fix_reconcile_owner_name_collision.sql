-- ============================================================================
-- lcc_fix_reconcile_owner_name_collision — ALREADY APPLIED LIVE (2026-08-06).
-- Mirror-only into supabase/migrations/ for repo-history parity (same posture as
-- 20260820140000_lcc_prune_skip_resolution_referenced_provenance — do NOT re-apply;
-- CREATE OR REPLACE makes a re-run a harmless no-op regardless).
-- ----------------------------------------------------------------------------
-- Root cause: lcc_reconcile_owner RETURNS TABLE(... candidate_name text, ...) —
-- OUT param names collide with column names referenced in the body (name_core,
-- name_match, etc.). Without `#variable_conflict use_column` PL/pgSQL resolves the
-- ambiguous identifiers to the OUT params, so `lcc_reconcile_name_match(t.name_core,
-- c.name_core)` and the scoring CTEs mis-bind — the RPC errored / returned wrong
-- rows, blocking owner-reconcile-engine. The fix pins `#variable_conflict use_column`
-- so every bare column identifier binds to the COLUMN, not the OUT param.
-- (This is the same class flagged in CLAUDE.md: "PL/pgSQL #variable_conflict
-- use_column is required in any function whose RETURNS TABLE OUT params share names
-- with column names.")
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lcc_reconcile_owner(p_entity_id uuid)
 RETURNS TABLE(candidate_entity_id uuid, candidate_name text, agreeing_signals jsonb, weighted_score numeric, threshold numeric, high_authority_conflict boolean, verdict text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  t record;
  v_thr numeric := public.lcc_reconcile_match_threshold();
  v_token text;
BEGIN
  SELECT * INTO t FROM public.lcc_owner_evidence(p_entity_id);
  IF t.entity_id IS NULL OR NOT t.is_usable THEN RETURN; END IF;
  v_token := split_part(coalesce(t.name_core, ''), ' ', 1);
  RETURN QUERY
  WITH cand AS (
    SELECT DISTINCT c.entity_id
    FROM public.lcc_owner_evidence_cache c
    WHERE c.entity_id <> p_entity_id
      AND (
        (t.phone_key   IS NOT NULL AND c.phone_key = t.phone_key)
     OR (t.email_key   IS NOT NULL AND c.email_key = t.email_key)
     OR (t.sf_account  IS NOT NULL AND c.sf_account = t.sf_account)
     OR (t.addr_key    IS NOT NULL AND c.addr_key = t.addr_key)
     OR (c.first_token = v_token AND public.lcc_reconcile_name_match(t.name_core, c.name_core))
      )
  ),
  scored AS (
    SELECT
      c.entity_id AS cid, c.name AS cname,
      ( SELECT jsonb_agg(s) FROM (
          SELECT jsonb_build_object('signal','shared_salesforce_account','weight',public.lcc_signal_weight('shared_salesforce_account'),'value',t.sf_account) AS s
            WHERE t.sf_account IS NOT NULL AND c.sf_account = t.sf_account
          UNION ALL SELECT jsonb_build_object('signal','shared_email','weight',public.lcc_signal_weight('shared_email'),'value',t.email_key)
            WHERE t.email_key IS NOT NULL AND c.email_key = t.email_key
          UNION ALL SELECT jsonb_build_object('signal','shared_mailing_address','weight',public.lcc_signal_weight('shared_mailing_address'),'value',t.addr_key)
            WHERE t.addr_key IS NOT NULL AND c.addr_key = t.addr_key
          UNION ALL SELECT jsonb_build_object('signal','shared_phone','weight',public.lcc_signal_weight('shared_phone'),'value',t.phone_key)
            WHERE t.phone_key IS NOT NULL AND c.phone_key = t.phone_key
          UNION ALL SELECT jsonb_build_object('signal','shared_name_core','weight',public.lcc_signal_weight('shared_name_core'),'value',t.name_core)
            WHERE public.lcc_reconcile_name_match(t.name_core, c.name_core)
          UNION ALL SELECT jsonb_build_object('signal','shared_true_owner_sponsor','weight',public.lcc_signal_weight('shared_true_owner_sponsor'),'value',t.sponsor_norm)
            WHERE t.sponsor_norm IS NOT NULL AND c.sponsor_norm = t.sponsor_norm
          UNION ALL SELECT jsonb_build_object('signal','shared_name_city','weight',public.lcc_signal_weight('shared_name_city'),'value',t.city_key||'/'||t.state_key)
            WHERE c.first_token = v_token AND t.city_key IS NOT NULL AND c.city_key = t.city_key
              AND t.state_key IS NOT NULL AND c.state_key = t.state_key
        ) sig ) AS sigs,
      public.lcc_reconcile_name_match(t.name_core, c.name_core) AS name_match,
      (t.sf_account IS NOT NULL AND c.sf_account IS NOT NULL AND c.sf_account <> t.sf_account) AS conflict
    FROM public.lcc_owner_evidence_cache c
    JOIN cand ON cand.entity_id = c.entity_id
  ),
  agg AS (
    SELECT cid, cname, coalesce(sigs, '[]'::jsonb) AS sigs, name_match, conflict,
           coalesce((SELECT sum((x->>'weight')::numeric) FROM jsonb_array_elements(coalesce(sigs,'[]'::jsonb)) x), 0) AS score
    FROM scored
  )
  SELECT
    agg.cid, agg.cname, agg.sigs, agg.score, v_thr, agg.conflict,
    CASE
      WHEN agg.conflict THEN 'distinct'
      WHEN agg.score >= v_thr AND agg.name_match THEN 'same_party'
      WHEN agg.score >= v_thr THEN 'review'
      WHEN agg.score > 0 THEN 'review'
      ELSE 'distinct'
    END
  FROM agg
  ORDER BY agg.score DESC, agg.cname ASC;
END;
$function$;
