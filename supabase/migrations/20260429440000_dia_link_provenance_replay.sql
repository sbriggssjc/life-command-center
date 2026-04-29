-- FU6 — dia auto-linker provenance replay (2026-04-29)
--
-- Closes the loop on the 13 priority rules I registered in PR #484
-- covering dia.properties.medicare_id / dia.medicare_clinics.property_id.
-- The auto-linker functions write to dia.research_queue_outcomes with
-- source_name + selected_property_id then call apply_property_link_outcome
-- which updates the dialysis DB directly. LCC Opps' field_provenance never
-- saw any of this — the rules stayed scaffolding-without-signal forever.
--
-- This migration:
-- 1. Adds a singleton watermark table to track which research_queue_outcomes
--    rows have been replayed.
-- 2. Schedules a 5-minute cron that POSTs to the new admin endpoint
--    /api/admin?_route=dia-link-provenance-replay (handler in admin.js,
--    appended this PR). The endpoint pulls outcomes since watermark, fires
--    lcc_merge_field for each (1 medicare_id write + 1 property_id write
--    per outcome), and advances the watermark.
--
-- See docs/architecture/field_source_priority_ramp_plan.md for the
-- broader integration design — this implements Option B (LCC-side periodic
-- ingest) from that doc.

create table if not exists public.dia_link_provenance_watermark (
  singleton          boolean primary key default true,
  last_outcome_id    bigint not null default 0,
  last_run_at        timestamptz not null default now(),
  constraint dia_link_provenance_watermark_singleton_chk
    check (singleton)
);
insert into public.dia_link_provenance_watermark (singleton, last_outcome_id)
values (true, 0)
on conflict (singleton) do nothing;

comment on table public.dia_link_provenance_watermark is
  'Singleton watermark for dia auto-linker provenance replay. Tracks the highest research_queue_outcomes.id that has been dispatched as lcc_merge_field calls. Updated by /api/admin?_route=dia-link-provenance-replay after each successful run.';

-- Schedule the cron. Uses lcc_cron_post() helper to POST with the right
-- API key from Vault, same pattern as the npi-lookup / merge-log-reconcile
-- crons (CLAUDE.md "pg_cron on LCC Opps").
select cron.schedule(
  'dia-link-provenance-replay',
  '*/5 * * * *',  -- every 5 minutes
  $$select public.lcc_cron_post('admin?_route=dia-link-provenance-replay&limit=200')$$
);
