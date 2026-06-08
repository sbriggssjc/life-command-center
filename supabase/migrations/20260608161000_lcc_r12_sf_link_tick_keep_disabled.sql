-- ============================================================================
-- R12 Unit 3 — determination: KEEP the lcc-sf-link-tick cron DISABLED (LCC Opps)
--
-- DETERMINATION (grounded live 2026-06-08): keep disabled, do NOT drop.
--
-- What the tick does: drains the per-domain `sf_link_research_queue` (A7
-- backfill — 30,711 rows still `queued`: gov 27,605 / dia 3,106, zero ever
-- drained), calls findSalesforceAccountByName (the SSO-bound Power Automate
-- lookup flow) per owner, and on a >=0.90 fuzzy-name match STAMPS sf_account_id
-- onto the DOMAIN `true_owners` / `recorded_owners` rows.
--
-- Is it redundant with the inline ensureEntityLink path? NO. ensureEntityLink
-- writes the LCC entity graph (`external_identities`, source_system='salesforce')
-- — a DIFFERENT target. The domain `true_owners.sf_account_id` column the tick
-- feeds is consumed independently by: LCC `intake-promoter.js` (links a promoted
-- OM's contact/lead to the owner's SF account), LCC `sidebar-pipeline.js`
-- (CoStar capture → sf_company_id), and the gov `ingest_sf_export.py`
-- reconciliation (matches inbound SF-export rows to true_owners BY sf_account_id
-- exact). So the column is real and consumed — dropping the queue + route would
-- lose a working enrichment lane and 30k rows of research intent.
--
-- So why keep it OFF? The cron has NEVER run (last_run NULL) and its disabled
-- state is deliberate, not an accident:
--   1. The authoritative populator of sf_account_id is the SF-export EXACT-id
--      reconciliation (ingest_sf_export.py), not fuzzy name-matching. Of 14,142
--      gov true_owners, 439 carry sf_account_id — all from the exact-id /
--      external_identities prefill paths, none from this tick.
--   2. Draining 30,711 rows at 25/tick hourly = ~51 days of continuous load on
--      the SSO-bound PA lookup flow, which is itself the rate-limited bottleneck
--      shared with the higher-value Decision Center SF-mapping typeahead.
--   3. Fuzzy name-matching at scale risks low-confidence mislinks onto curated
--      owner rows that the exact-id path would get right.
-- Net: the marginal value (fuzzy-filling the long tail the exact-id path misses)
-- does not justify weeks of PA-flow contention right now.
--
-- RE-ENABLE LATER only if BOTH hold: (a) Scott confirms the PA lookup flow can
-- sustain the throughput, and (b) fuzzy-name linking is judged to add value over
-- the SF-export exact-id path. If re-enabled, do it with a small per-tick limit
-- and watch the `needs_review` / mislink rate before widening.
--
-- This migration only RE-ASSERTS the disabled state (idempotent no-op on the
-- live row, which is already active=false) so the determination lives in the
-- migration history, not just chat. The job + queue + route are LEFT INTACT for
-- a future flip. Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

do $$
declare
  v_jobid bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into v_jobid from cron.job where jobname = 'lcc-sf-link-tick';
    if v_jobid is not null then
      perform cron.alter_job(v_jobid, active := false);
    end if;
  end if;
end $$;
