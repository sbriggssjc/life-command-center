-- UX-T1b — research workbench flow dashboard (2026-09-08).
--
-- Read first: docs/architecture/research-workbench.md, docs/architecture/app-ux-review-2026-09-02.md
-- rows UX32/UX35/UX36, docs/audits/A1_OWNERSHIP_LANE_SPLIT_2026-08-27.md,
-- docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md.
--
-- ⚠️ THIS MIGRATION DOES NOT CLASSIFY ANYTHING NEW. It reads three EXISTING
-- classifications verbatim -- `v_lcc_research_lane_summary.answerable` (P179's
-- curated capture-path flag), `v_lcc_ownership_history_lane_split.action` (A1),
-- and `v_lcc_owner_contact_decidability.decidable` (P131) -- and folds them
-- into one flow-dashboard row per WORKBENCH LANE, a curated four-lane subset
-- of the ~18 live research_types. The subset is an editorial call (which
-- lanes are a genuine human queue today), not a new detector; it is made ONCE
-- here, cross-referenced against the identical JS arrays in
-- api/_shared/workbench-lane.js (a mismatch between the two is guarded by
-- test/uxt1b-workbench-lane-parity.test.mjs).
--
-- Live census that grounds this subset (LCC Opps, measured 2026-09-08, see
-- docs/architecture/research-workbench.md for the full table):
--   establish_ownership_history   512 open / 68 human_actionable (A1 split)   -> ownership_history tab
--   owner_contact_manual          312 open /  5 decidable       (P131 gate)  -> owner_contact tab
--   npi_missing_inventory + _new_registration  81 open, ALL already P181-gated -> npi tab
--   confirm_tenant_mismatch, state_lease_distress_review, person_email_merge_review,
--   confirm_deed_transfer_sale, confirm_true_owner, merge_duplicate_entities,
--   systemic_findings_report, news_alert_development_followup  -- 50 open total,
--   one-off DC-verdict spawns sharing one action shape (read + Complete/Dismiss) -> followups tab
--
-- EXCLUDED, named, not guessed:
--   owner_needs_salesforce (1,678 open), true_owner_needs_salesforce (837 open) --
--     C1a-e disposed these `c1c_lane_no_consumer` / retire, but
--     `lcc_c1c_retire_sf_lanes` is DRY-RUN-DEFAULT and was never actually
--     APPLIED against production data (verified live: both still 100%
--     status='queued', zero rows carry outcome.reason='c1c_lane_no_consumer').
--     "Merged is not running" -- the disposition is decided, the sweep has not
--     been run. Filed UX-T1b-g2 in PLANNED-BACKLOG.md; NOT executed here
--     (retiring/gating a lane's data is a producer-side operation, out of this
--     unit's scope per its own §4).
--   property_missing_recorded_owner (1,469 open), property_missing_county_record
--     (111 open), property_missing_true_owner (0 open) -- `answerable=false`,
--     zero REAL completions ever (A5/A5a: all historical "completions" were the
--     auto-close false-throughput defect), no capture path, no C-series
--     disposition. Filed UX-T1b-g1 -- left out rather than guessed.
--   trace_ownership_to_developer (19 open) -- `answerable=false` but DOES carry
--     71 real completions via an automated closer (a cron reconciles chain-
--     complete tasks, CLAUDE.md "close the loop: complete trace_ownership_to_
--     developer tasks now chain_complete"), so the open count may already be
--     un-actionable-by-a-human. Left out rather than guessed; filed UX-T1b-g3.

create or replace view public.v_lcc_research_workbench_flow as
with lane_defs(lane_key, lane_label, research_types) as (
  values
    ('ownership_history', 'Ownership History', array['establish_ownership_history']),
    ('owner_contact',      'Owner Contact',      array['owner_contact_manual']),
    ('npi',                'NPI Intel',          array['npi_missing_inventory','npi_new_registration']),
    ('followups',          'General Follow-ups', array[
        'confirm_tenant_mismatch','state_lease_distress_review','person_email_merge_review',
        'confirm_deed_transfer_sale','confirm_true_owner','merge_duplicate_entities',
        'systemic_findings_report','news_alert_development_followup'
      ])
),
raw as (
  select
    d.lane_key, d.lane_label,
    coalesce(sum(s.open_tasks), 0)      as raw_open_tasks,
    coalesce(sum(s.ever_completed), 0)  as real_completions,
    coalesce(sum(s.ever_skipped), 0)    as ever_skipped,
    bool_or(coalesce(s.answerable, false)) as any_answerable
  from lane_defs d
  left join public.v_lcc_research_lane_summary s
    on s.research_type = any (d.research_types)
  group by d.lane_key, d.lane_label
),
owner_contact_decidable as (
  select count(*) as n
  from public.v_lcc_owner_contact_decidability
  where decidable = true and status <> 'completed'
),
ownership_human as (
  select count(*) as n
  from public.v_lcc_ownership_history_lane_split
  where human_actionable = true and status not in ('completed', 'skipped')
),
oldest as (
  select d.lane_key, min(t.created_at) as oldest_open_created_at
  from lane_defs d
  join public.research_tasks t on t.research_type = any (d.research_types)
  where t.status not in ('completed', 'skipped')
  group by d.lane_key
)
select
  r.lane_key,
  r.lane_label,
  r.raw_open_tasks,
  -- The number that actually needs a human TODAY, not the raw queue size.
  -- ownership_history and owner_contact already have a curated
  -- decidable/actionable signal; npi and followups have none finer than
  -- "open and not yet worked", so human_needed = raw_open for those two --
  -- stated, not padded.
  case r.lane_key
    when 'ownership_history' then (select n from ownership_human)
    when 'owner_contact'     then (select n from owner_contact_decidable)
    else r.raw_open_tasks
  end as human_needed_tasks,
  r.real_completions,
  r.ever_skipped,
  r.any_answerable,
  o.oldest_open_created_at,
  extract(day from now() - o.oldest_open_created_at)::int as oldest_open_age_days
from raw r
left join oldest o using (lane_key)
order by
  case r.lane_key
    when 'ownership_history' then 1 when 'owner_contact' then 2
    when 'npi' then 3 when 'followups' then 4 else 9
  end;

comment on view public.v_lcc_research_workbench_flow is
  'UX-T1b flow dashboard: one row per genuine-human-queue workbench lane '
  '(ownership_history / owner_contact / npi / followups), reading the '
  'EXISTING answerable/decidable/split signals -- never a new classification. '
  'human_needed_tasks is the number a human must actually see; raw_open_tasks '
  'is the pre-split queue size, kept so the workbench can report the drop. '
  'Lanes excluded here (owner_needs_salesforce, true_owner_needs_salesforce, '
  'property_missing_*, trace_ownership_to_developer) are named in this '
  'migration''s header and in docs/architecture/research-workbench.md, not '
  'silently dropped. See test/uxt1b-workbench-lane-parity.test.mjs for the '
  'JS/SQL vocabulary-parity guard.';

grant select on public.v_lcc_research_workbench_flow to authenticated, service_role;
