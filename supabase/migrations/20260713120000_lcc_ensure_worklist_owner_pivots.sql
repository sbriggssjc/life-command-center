-- Phase 2 (2026-07-13) — LCC Opps. Wire the high-value "Owners Missing a
-- Contact" worklist to the acquisition workers by proactively ensuring a pivot
-- + a resolved enrichment_action for EVERY worklist owner.
--
-- The owner-contact-enrich worker only processes owner_contact_pivot rows, and
-- the R16 SF-acquisition worker only processes contactless CADENCES — so a
-- valued contactless worklist owner that is NOT bridged with domain signals
-- (not in v_owner_active_contact) had no pivot, no enrichment_action, and no
-- worker could reach it. Grounded live 2026-07-13: of ~3,503 worklist owners,
-- 3,408 have no pivot. lcc_seed_owner_contact_pivots (from v_owner_active_contact)
-- covers the bridged slice; this sweep covers the rest with a manual_research
-- fallback pivot (the same fallback lcc_ensure_owner_pivot mints per-entity in
-- Phase 5b — here made set-based so all worklist owners get one).
--
-- Additive / reversible (DELETE the worklist_sweep-sourced pivots → prior state)
-- / idempotent (NOT EXISTS guard; ON CONFLICT DO NOTHING). LCC-Opps only. Drop
-- the function → zero trace.

BEGIN;

-- Set-based ensure of a fallback pivot for every worklist owner lacking one.
-- Value-ranked (rank_value DESC) + bounded by p_limit so a single tick can be
-- capped; the cron re-runs to drain the tail. The bridged slice is already
-- covered by lcc_seed_owner_contact_pivots, so this only mints for owners the
-- seed can't reach — carrying the worklist's enrichment hint when present, else
-- 'manual_research'.
CREATE OR REPLACE FUNCTION public.lcc_ensure_worklist_owner_pivots(p_limit int DEFAULT 5000)
RETURNS TABLE(seeded int) AS $fn$
DECLARE v_seeded int;
BEGIN
  WITH cand AS (
    SELECT w.entity_id, w.owner_name, w.workspace_id, w.enrichment_action
    FROM public.v_owner_contact_worklist w
    WHERE NOT EXISTS (SELECT 1 FROM public.owner_contact_pivot p WHERE p.entity_id = w.entity_id)
    ORDER BY w.rank_value DESC NULLS LAST
    LIMIT GREATEST(p_limit, 0)
  ),
  ins AS (
    INSERT INTO public.owner_contact_pivot
      (entity_id, owner_name, workspace_id, enrichment_action, active_source)
    SELECT c.entity_id, c.owner_name, c.workspace_id,
           COALESCE(c.enrichment_action, 'manual_research'), 'worklist_sweep'
    FROM cand c
    ON CONFLICT (entity_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_seeded FROM ins;
  seeded := v_seeded; RETURN NEXT;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.lcc_ensure_worklist_owner_pivots(int) FROM PUBLIC;

-- Fold the sweep into the EXISTING daily pivot-refresh cron (after the bridged
-- seed + recurrence detect), so every worklist owner gains a pivot without a new
-- cron (idempotent re-register).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule('lcc-owner-contact-pivot-refresh')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='lcc-owner-contact-pivot-refresh');
    PERFORM cron.schedule('lcc-owner-contact-pivot-refresh', '20 5 * * *',
      $job$SELECT public.lcc_seed_owner_contact_pivots();
           SELECT public.lcc_ensure_worklist_owner_pivots();
           SELECT public.lcc_detect_contact_recurrence();$job$);
  END IF;
END $cron$;

COMMENT ON FUNCTION public.lcc_ensure_worklist_owner_pivots(int) IS
  'Phase 2 (2026-07-13): set-based ensure of a fallback owner_contact_pivot '
  '(active_source=worklist_sweep) for every v_owner_contact_worklist owner '
  'lacking one, so the owner-contact-enrich worker can reach every high-value '
  'contactless owner. Bridged owners are covered by lcc_seed_owner_contact_pivots; '
  'this mints manual_research (or the worklist enrichment hint) for the rest. '
  'Idempotent; reversible (DELETE WHERE active_source=''worklist_sweep'').';

COMMIT;
