-- ============================================================================
-- P133 — schedule the P131 ownership-chain drafter nightly.
--
-- WHAT. pg_cron job `lcc-ownership-chain-draft` at 06:45 UTC, POSTing
-- /api/ownership-chain-draft-tick through lcc_cron_post (Vault key → pg_net →
-- Railway), the same path every other scheduled sweep uses.
--
-- WHY A SCHEDULE. P131 drafted the standing 545-row backlog by hand (six POSTs
-- to `already_drafted:545, fresh:0`). The lane is a RECURRING producer — rows
-- mint as gov transitions land and as asset entities mint — so a hand-drained
-- queue silently refills. Same shape as P176's junk_entity_name lane, and the
-- same fix: pair the one-shot repair with a sweep.
--
-- THE SLOT. 06:45 UTC. Deliberately picked from the free minutes: 05:45 carries
-- property-twin-assist + owner-contact-review-autoretire, 06:20/06:25/06:30/
-- 06:35/06:40 each already carry 2–4 jobs (the P112 cadence chain, the mailbox
-- mirror pair, generate-research-tasks), and 06:50 is lcc-owner-deed-autofix.
-- 06:45 held nothing. It also lands AFTER `generate-research-tasks` (06:35),
-- which is what mints new `establish_ownership_history` rows — so a row minted
-- tonight is drafted tonight rather than waiting a further day.
--
-- WHY apply=true / limit=100. POST is the apply mode; the handler caps its own
-- batch at 100 rows and holds a 45 s internal budget inside lcc_cron_post's 60 s
-- pg_net window. The write is idempotent on the store's UNIQUE (decision_type,
-- subject_ref, proposal_kind, source) and the tick skips already-drafted
-- subject_refs, so a nightly run on a quiet night writes ZERO rows and costs one
-- scan. `trigger_source` rides in the body so the run log can tell a cron run
-- from a hand-run one.
--
-- NOT GATED ON THE FLAG, ON PURPOSE. With OWNERSHIP_CHAIN_DRAFT off the handler
-- already no-ops (`skipped: feature_flag_off`) and, from P133, still records a
-- run-log row saying so. A cron that fires and is skipped is visible; a cron
-- that was never scheduled because a flag was off at migration time is the
-- dormant-capability failure the registry exists to prevent.
--
-- DEPLOY. DB-only — the handler is already deployed on Railway and the flag is
-- already ON, so this is live on the next 06:45 without a redeploy. Apply the
-- run-log migration (20260826230000) FIRST: the tick's run-log write is
-- fail-soft, but a scheduled run with nowhere to log is exactly the blind spot
-- this pair of migrations exists to close.
--
-- REVERSAL RUNBOOK
--   SELECT cron.unschedule('lcc-ownership-chain-draft');
--   delete from lcc_clean_assist_proposals where source='ownership_chain_draft';
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_cron_post') THEN
    BEGIN PERFORM cron.unschedule('lcc-ownership-chain-draft'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('lcc-ownership-chain-draft', '45 6 * * *',
      $cron$SELECT public.lcc_cron_post('/api/ownership-chain-draft-tick', '{"apply":true,"limit":100,"trigger_source":"cron"}'::jsonb, 'railway');$cron$);
  END IF;
END;
$$;

-- Registry honesty (audit §4.4.3): the flag is ON, and the surface must say the
-- capability now runs on a schedule rather than by hand. `state`/`off_since` are
-- operator-curated and are deliberately NOT touched here.
UPDATE public.feature_flags_registry
   SET notes = notes || ' P133: scheduled nightly as pg_cron job `lcc-ownership-chain-draft` '
             || '(06:45 UTC, POST /api/ownership-chain-draft-tick apply=true limit=100 via lcc_cron_post). '
             || 'The lane is a recurring producer, so the P131 hand-drain is paired with a sweep. Each run '
             || 'opens and closes a public.lcc_ownership_chain_draft_run_log row; read '
             || 'v_lcc_ownership_chain_draft_run_health and judge it by written_draftable (the state delta), '
             || 'never already_drafted. The cron is NOT gated on this flag — with the flag off the tick '
             || 'no-ops and the run log records the skip.'
 WHERE flag = 'OWNERSHIP_CHAIN_DRAFT'
   AND notes NOT LIKE '%lcc-ownership-chain-draft%';
