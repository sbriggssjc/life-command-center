-- R17 Unit 2: bounded-batch overload of lcc_apply_fuzzy_merges.
-- Adds a p_limit so the auto_mergeable backlog can be drained 50-100 groups/run
-- (artifact-offload bounded-batch lesson). Original 1-arg signature unchanged.
-- Idempotent: merged losers leave v_lcc_merge_candidates, re-run picks up the rest.
--
-- One-time drain (applied live 2026-06-09): 430 groups / 436 losers merged in
-- bounded batches; entities 19,348 -> 18,916; v_lcc_merge_candidates auto_mergeable
-- -> 0; 227 non-auto review groups remain. Caches refreshed afterward
-- (lcc_refresh_buyer_spe_resolved + lcc_refresh_priority_queue_resolved).
-- Steady-state is the Decision Center "merge duplicate entities" lane, NOT a cron.
CREATE OR REPLACE FUNCTION public.lcc_apply_fuzzy_merges(p_dry_run boolean, p_limit integer)
 RETURNS TABLE(norm_name text, winner_name text, loser_count integer, applied boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rec record;
  v_loser uuid;
BEGIN
  FOR v_rec IN
    SELECT * FROM public.v_lcc_merge_candidates
    WHERE auto_mergeable = true
    ORDER BY member_count DESC, best_role_score DESC
    LIMIT GREATEST(COALESCE(p_limit, 0), 0)
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
$function$;
