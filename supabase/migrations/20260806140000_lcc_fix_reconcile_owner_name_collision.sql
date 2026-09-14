-- Alert-triage follow-up (2026-08-06, alert 982 root cause):
-- 20260818160000_lcc_owner_reconciliation_core (applied 2026-07-31) created
-- lcc_reconcile_owner(uuid, numeric, boolean) — an SF-signal owner-evidence scorer —
-- colliding with the ORE's existing lcc_reconcile_owner(uuid) pair-generator
-- (20260716140000). PostgREST cannot dispatch the ambiguous rpc/lcc_reconcile_owner
-- (42725 "function is not unique"), so the ORE engine tick failed 25/25 on EVERY run
-- since Jul 31. Fix: rename the newer evidence scorer to lcc_reconcile_owner_evidence
-- and repoint its single SQL caller (lcc_reconcile_all_owners). No JS callers.
-- APPLIED LIVE 2026-08-06 — mirror only. NOTE: the ALTER ... RENAME is NOT
-- idempotent; guard it so a fresh-schema build works but a re-run no-ops.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='lcc_reconcile_owner'
               AND p.oid::regprocedure::text = 'lcc_reconcile_owner(uuid,numeric,boolean)') THEN
    ALTER FUNCTION public.lcc_reconcile_owner(uuid, numeric, boolean)
      RENAME TO lcc_reconcile_owner_evidence;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.lcc_reconcile_all_owners(p_min_confidence numeric DEFAULT 0.55, p_write boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_e uuid; v_r jsonb; v_seen int := 0; v_wrote int := 0; v_lowconf int := 0;
begin
  for v_e in select distinct entity_id from public.lcc_owner_evidence loop
    v_r := public.lcc_reconcile_owner_evidence(v_e, p_min_confidence, p_write);
    v_seen := v_seen + 1;
    if (v_r->>'wrote')::boolean then v_wrote := v_wrote + 1;
    elsif (v_r->>'owner') is not null and (v_r->>'confidence')::numeric < p_min_confidence then v_lowconf := v_lowconf + 1;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'entities_scored',v_seen,'overrides_written',v_wrote,'low_confidence',v_lowconf);
end $function$;
