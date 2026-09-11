-- ============================================================================
-- OWN-T0j — cache + reporting view for the gov OWN-T0a sponsor-classification
-- split. LCC Opps side only — gov's properties/ownership_history/true_owners
-- are untouched (this migration writes nothing into gov's schema; gov is a
-- SEPARATE Supabase project and cannot be reached from this migration).
--
-- WHAT. OWN-T0a measures ~48% disagreement between gov's latest recorded
-- ownership-transition grantee and gov.properties.true_owner_id. Most of that
-- is NOT a data defect — it is the sponsor<->SPE shape OWN-T0 already found
-- and declined to force into agreement (a deed/lease grantee names the SPE
-- holding title; true_owner correctly rolls up to the sponsor; BOTH are true).
-- Proof: Boyd Watterson / UIRC / NGP / Highwoods are ALL already-confirmed
-- sponsor families in LCC Opps' lcc_ownership_sponsor_family (OWN-T0e) and
-- STILL read as "disagreeing" in the raw gov-side comparison, because
-- confirming a family in LCC Opps never touches gov's tables.
--
-- This migration does NOT make the two gov columns agree (refused per OWN-T0
-- section 4 / RO2 — tried and refuted on this exact shape) and does NOT build
-- a second sponsor-confirm mechanism (OWN-T0e's `sponsor_family_confirm`
-- Decision Center lane already owns that write). It is a pure REPORTING
-- surface: a Node tick (api/_handlers/ownt0j-sponsor-classify-tick.js) reads
-- gov's disagreement population and LCC Opps' confirmed sponsor tokens (two
-- separate Supabase projects — no cross-DB SQL join is possible), classifies
-- each disagreeing property `sponsor_family_confirmed` or
-- `unclassified_rival`, and fills the cache table below.
--
-- CADENCE. OWN-T0e's own proposals cache refreshes on `27 */4 * * *`. This
-- job is scheduled at `39 */4 * * *` — same 4-hourly cadence (the underlying
-- gov comparison and the LCC confirm registry both move slowly; nothing here
-- needs finer granularity), offset by 12 minutes purely to avoid two
-- cross-source ~5,000-row jobs landing on the Railway/gov PostgREST pool in
-- the same minute (no other reason to differ).
--
-- REVERSAL RUNBOOK
--   SELECT cron.unschedule('lcc-ownt0j-sponsor-classify-refresh');
--   DROP VIEW IF EXISTS public.v_lcc_ownt0j_sponsor_disagreement_report;
--   DROP TABLE IF EXISTS public.lcc_ownt0j_sponsor_disagreement_cache;
-- ============================================================================

create table if not exists public.lcc_ownt0j_sponsor_disagreement_cache (
  group_key_id                text        not null,   -- '<gov property_id>:<gov true_owner_id>'
  property_id                 bigint      not null,
  true_owner_id               uuid,
  true_owner_name             text,
  transition_grantee_cleaned  text,
  data_source                 text,
  change_type                 text,
  classification               text        not null,
  sponsor_match_token          text,
  refreshed_at                 timestamptz not null default now(),
  primary key (group_key_id)
);

alter table public.lcc_ownt0j_sponsor_disagreement_cache
  add constraint chk_ownt0j_classification
    check (classification in ('sponsor_family_confirmed', 'unclassified_rival'))
  ;

comment on table public.lcc_ownt0j_sponsor_disagreement_cache is
  'OWN-T0j: snapshot of the gov OWN-T0a disagreement population (latest ownership-transition '
  'grantee vs properties.true_owner_id, name-keyed, ported byte-for-byte from '
  'gov.v_ownership_transitions_portfolio''s own key expression), split by whether a CONFIRMED '
  'sponsor/SPE family (LCC Opps lcc_ownership_sponsor_family, OWN-T0e) already explains it. '
  'Refreshed by the Node tick api/_handlers/ownt0j-sponsor-classify-tick.js (POST) on cron '
  'lcc-ownt0j-sponsor-classify-refresh (39 */4 * * *) because gov and LCC Opps are separate '
  'Supabase projects and no SQL can join them. Reporting only — nothing here writes to gov or to '
  'lcc_ownership_sponsor_family. A genuinely unclassified pair belongs on OWN-T0e''s existing '
  '`sponsor_family_confirm` Decision Center lane, not a new confirm surface here. Design: '
  'docs/architecture/ownership-history-lane.md § OWN-T0 -> OWN-T0j; backlog row OWN-T0j.';

-- Supabase default privileges grant SELECT to anon/authenticated on every new
-- table (the B6d/OCR2 lesson, mirrored from OWN-T0e's own cache hardening).
revoke all on table public.lcc_ownt0j_sponsor_disagreement_cache from public, anon, authenticated;
grant select, insert, delete on table public.lcc_ownt0j_sponsor_disagreement_cache to service_role;

-- ---------------------------------------------------------------------------
-- Reporting view: the two-bucket split a human runs to see counts + the
-- property list behind each. Plain view, SECURITY INVOKER (default) — reads
-- only the cache table above, which service_role already owns; no elevated
-- privilege is needed here, so no SECURITY DEFINER function is created by
-- this migration (the repo's definer-privilege-stanza requirement therefore
-- does not apply; there is no function to carry a revoke+assert stanza for).
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_ownt0j_sponsor_disagreement_report as
select
  classification,
  count(*)                                   as properties,
  count(distinct sponsor_match_token)         as distinct_sponsor_tokens_matched,
  max(refreshed_at)                           as refreshed_at
from public.lcc_ownt0j_sponsor_disagreement_cache
group by classification;

comment on view public.v_lcc_ownt0j_sponsor_disagreement_report is
  'OWN-T0j: the honest two-bucket split (sponsor_family_confirmed vs unclassified_rival) over the '
  'gov OWN-T0a disagreement population. Read '
  'lcc_ownt0j_sponsor_disagreement_cache directly for the per-property list behind either bucket '
  '(filter classification=''unclassified_rival'' for the residual worth routing to the OWN-T0e '
  '`sponsor_family_confirm` lane). This view reports COUNTS ONLY, never the smaller bucket in place '
  'of the total — quote both.';

grant select on public.v_lcc_ownt0j_sponsor_disagreement_report to service_role;

-- ---------------------------------------------------------------------------
-- Schedule the refresh. Mirrors the P133 / OWN-T0e cron pattern exactly:
-- lcc_cron_post -> Vault key -> pg_net -> Railway POST, ungated on any
-- feature flag (a scheduled tick that fires and no-ops is visible; one never
-- scheduled because a flag was off at migration time is the dormant-
-- capability failure the feature_flags_registry exists to prevent — and this
-- tick has no flag to begin with, it is read-then-classify, never a
-- write-to-curated-data path that would need one).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_cron_post') THEN
    BEGIN PERFORM cron.unschedule('lcc-ownt0j-sponsor-classify-refresh'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('lcc-ownt0j-sponsor-classify-refresh', '39 */4 * * *',
      $cron$SELECT public.lcc_cron_post('/api/ownt0j-sponsor-classify-tick', '{}'::jsonb, 'railway');$cron$);
  END IF;
END;
$$;
