-- OWNERGAP2 — the reversible, citation-carrying ledger for owners resolved from
-- FREE public assessor sources. Dialysis_DB (zqzrriwuavgrquhisnoa).
--
-- CONTEXT. OWNERGAP1 measured that 4,014 dia properties (34% of the book) carry
-- an operator-flagged true_owner and NO recorded_owner, and that the owner is
-- genuinely ABSENT from every table this database holds (24,365 of 25,331 tax
-- payloads carry a null/empty mailing_owner AT SOURCE — the county returned
-- nothing, this was never an extraction gap). Its §8/§9 sampling then measured
-- that FREE public sources DO hold it: Philadelphia ~68%, Harris 86%.
-- OWNERGAP2 is the first BUILD in that arc. Everything before it was
-- measurement.
--
-- SCOPE, DELIBERATELY SMALL: two adapters (Philadelphia + Harris), a provenance
-- contract, and a measured result. NO national pipeline, NO scheduler, NO
-- `county_authorities` table, NO new owner table — `recorded_owners` already
-- holds 7,582 rows with `name/normalized_name/source/entity_type/...` and 5,473
-- of 11,826 properties already carry a `recorded_owner_id`. This fills the gap;
-- it does not invent machinery.
--
-- 🚨 THE PROVENANCE CONTRACT IS THE WHOLE POINT, AND IT IS ENFORCED HERE BY
--    CHECK CONSTRAINTS, NOT BY CONVENTION. OWNERGAP1 exists because a gpt-4o
--    call was asked to RECALL a public record and invented
--    `XYZ Dialysis Centers LLC` across 119 counties. Therefore:
--      · every `resolved` row MUST carry a jurisdiction, the SOURCE's own record
--        identifier (OPA account number / HCAD account number) and the QUERY
--        that found it — CHECK-enforced below, so a row that cannot cite its
--        source cannot be inserted at all;
--      · no model may produce an owner name anywhere in this lane;
--      · a miss stays a miss — `recorded_owner_id IS NULL`, recorded WITH ITS
--        CAUSE, never filled from the operator (that is PDR2 undone).
--
-- ⚠️ THIS MIGRATION WRITES NO OWNER AND TOUCHES NO PROPERTY. It creates the
--    ledger, the reporting view and the reversal function. The resolution pass
--    itself is a dry-run-default handler
--    (`GET/POST /api/admin?_route=ownergap2-owner-resolve-tick`).
--
-- ⚠️ NOTHING HERE MODIFIES OR BYPASSES THE OWNERGAP1 QUARANTINE.
--    `dia_is_fabricated_placeholder_owner()` and its four write-time triggers
--    are untouched. See §4 for a live FALSE POSITIVE in that guard which this
--    build found and deliberately did NOT fix by weakening the guard.
--
-- REVERSAL RUNBOOK:
--   select * from dia_ownergap2_unresolve('<batch_tag>');
--   -- Nulls `properties.recorded_owner_id` for every property this batch
--   -- resolved (and ONLY where it still points at the row this batch wrote),
--   -- marks the ledger rows reverted, and reports what it could not reverse
--   -- rather than pretending. `recorded_owners` rows are NOT deleted — they
--   -- are real, source-cited parties and may be referenced elsewhere; they
--   -- remain identifiable by `source LIKE 'ownergap2_public_assessor:%'`.
--   -- To remove the lane entirely:
--   --   drop function dia_ownergap2_unresolve(text);
--   --   drop view v_dia_ownergap2_resolution_summary;
--   --   drop table dia_ownergap2_resolution_log;

-- ── 1. The ledger. One row per property per attempt, resolved OR not. ────────
--
-- ⚠️ A REFUSAL IS A ROW. §5.1 asks for "unresolved-by-cause", and a cause that
-- was never written down cannot be counted. Recording only successes would make
-- this lane's own honest counts unmeasurable — and "we wrote 20 owners" without
-- "and refused 3 as multi-parcel and missed 3" is exactly the half-truth this
-- repo's Consumption-Layer doctrine forbids.
create table if not exists dia_ownergap2_resolution_log (
  id                       bigserial primary key,
  batch_tag                text        not null,
  property_id              bigint      not null,
  jurisdiction             text,
  outcome                  text        not null
                             check (outcome in ('resolved', 'unresolved')),
  outcome_reason           text,
  owner_name_seen          text,
  recorded_owner_id        uuid,
  recorded_owner_created   boolean     not null default false,
  citation                 jsonb,
  resolved_at              timestamptz not null default now(),
  reverted_at              timestamptz,

  -- 🚨 THE CONTRACT, AS A CONSTRAINT. A `resolved` row without a jurisdiction,
  -- a source record id and the query that found it is REFUSED BY THE DATABASE.
  -- This is the difference between a documented rule and an enforced one: a
  -- future caller that "just writes the owner" fails loudly at the INSERT
  -- instead of quietly landing an uncitable name in the owner table.
  constraint chk_ownergap2_resolved_must_cite check (
    outcome <> 'resolved' or (
          citation is not null
      and coalesce(citation->>'jurisdiction', '') <> ''
      and jsonb_typeof(citation->'source_record_ids') = 'array'
      and jsonb_array_length(citation->'source_record_ids') > 0
      and coalesce(citation->>'source_query', '') <> ''
      and coalesce(owner_name_seen, '') <> ''
      and recorded_owner_id is not null
    )
  ),
  -- An `unresolved` row must say WHY. A miss with no cause is the same silent
  -- absence the whole arc exists to remove.
  constraint chk_ownergap2_unresolved_must_explain check (
    outcome <> 'unresolved' or coalesce(outcome_reason, '') <> ''
  )
);

comment on table dia_ownergap2_resolution_log is
  'OWNERGAP2: reversible, citation-carrying ledger of every owner-resolution '
  'attempt against a free public assessor source -- RESOLVED and UNRESOLVED '
  'alike. A resolved row cannot be inserted without the jurisdiction, the '
  'source''s own record id and the query that found it (CHECK-enforced): the '
  'provenance contract is a constraint here, not a convention.';

comment on column dia_ownergap2_resolution_log.citation is
  'The source row this owner was COPIED from: {jurisdiction, source_record_ids '
  '(OPA/HCAD account numbers), source_record_kind, source_url, source_query, '
  'source_location, match_arm, normalized_address, fetched_at}. Re-runnable by '
  'a human -- a citation nobody can re-run is not a citation.';

comment on column dia_ownergap2_resolution_log.outcome_reason is
  'Why this property was NOT resolved, by cause: needs_parcel_discriminator | '
  'no_matching_record | no_records_returned | source_response_truncated | '
  'matched_name_is_operator | blocked_by_fabrication_guard | '
  'source_states_no_owner | already_has_recorded_owner | ... Never blank.';

-- Idempotency: one OPEN attempt per (batch, property). A re-run of the same
-- batch touches 0 rows instead of stacking duplicate history.
create unique index if not exists uq_dia_ownergap2_open_attempt
  on dia_ownergap2_resolution_log (batch_tag, property_id)
  where reverted_at is null;

create index if not exists idx_dia_ownergap2_property
  on dia_ownergap2_resolution_log (property_id);
create index if not exists idx_dia_ownergap2_outcome
  on dia_ownergap2_resolution_log (outcome, outcome_reason);

-- ── 2. Honest counts, by cause. ─────────────────────────────────────────────
--
-- ⚠️ READ `resolved` BESIDE `unresolved_by_cause`, NEVER `attempted`.
-- `attempted` is a rows-scanned tally and reads exactly like throughput while
-- nothing moves (P159a). The number that matters is how many of the 4,014
-- owner-unknown properties now have an owner; the number that keeps it honest
-- is the per-cause breakdown of the ones that do not.
create or replace view v_dia_ownergap2_resolution_summary as
select
  batch_tag,
  jurisdiction,
  count(*)                                                     as attempted,
  count(*) filter (where outcome = 'resolved'
                     and reverted_at is null)                  as resolved,
  count(*) filter (where outcome = 'unresolved')               as unresolved,
  count(*) filter (where outcome_reason = 'needs_parcel_discriminator')
                                                               as multi_parcel_refused,
  count(*) filter (where outcome_reason = 'matched_name_is_operator')
                                                               as operator_refused,
  count(*) filter (where outcome_reason = 'blocked_by_fabrication_guard')
                                                               as fabrication_guard_refused,
  count(*) filter (where outcome_reason in ('no_matching_record', 'no_records_returned'))
                                                               as no_record_at_source,
  count(*) filter (where outcome_reason = 'source_response_truncated')
                                                               as source_truncated,
  count(*) filter (where reverted_at is not null)              as reverted,
  -- A resolved row that cites nothing is structurally impossible (the CHECK
  -- above) -- this column is the POSITIVE CONTROL that says so out loud, and it
  -- must always read 0. A detector that can never fire is worth stating.
  count(*) filter (where outcome = 'resolved' and citation is null)
                                                               as resolved_without_citation,
  min(resolved_at)                                             as first_attempt_at,
  max(resolved_at)                                             as last_attempt_at
from dia_ownergap2_resolution_log
group by batch_tag, jurisdiction;

comment on view v_dia_ownergap2_resolution_summary is
  'OWNERGAP2 honest counts. Read `resolved` beside the per-cause unresolved '
  'columns, never `attempted` (a rows-scanned tally reads exactly like '
  'throughput while nothing moves). `resolved_without_citation` is a positive '
  'control and must always be 0.';

-- ── 3. Reversal. ────────────────────────────────────────────────────────────
--
-- ⚠️ IT REVERSES ONLY WHAT IT STILL OWNS, AND REPORTS THE REST. A property
-- whose `recorded_owner_id` has since been changed by another writer is NOT
-- silently nulled -- that would destroy somebody else's correction under the
-- banner of undoing ours. Those are counted as `skipped_changed_since` so a
-- partial reversal can never read like a clean one (P196: "count what came
-- back, because a partial restore otherwise reads exactly like a clean one").
create or replace function dia_ownergap2_unresolve(p_batch_tag text)
returns table (
  properties_unresolved  integer,
  skipped_changed_since  integer,
  ledger_rows_reverted   integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target     integer := 0;
  v_unresolved integer := 0;
  v_skipped    integer := 0;
  v_reverted   integer := 0;
begin
  -- How many resolved rows this batch still owns on paper.
  select count(*) into v_target
  from dia_ownergap2_resolution_log l
  where l.batch_tag = p_batch_tag
    and l.outcome = 'resolved'
    and l.reverted_at is null;

  -- Null ONLY where the property still points at the row this batch wrote.
  -- A property another writer has since re-pointed is left ALONE.
  update properties p
     set recorded_owner_id = null
   where p.property_id in (
     select l.property_id
     from dia_ownergap2_resolution_log l
     where l.batch_tag = p_batch_tag
       and l.outcome = 'resolved'
       and l.reverted_at is null
       and l.recorded_owner_id = p.recorded_owner_id
   );
  get diagnostics v_unresolved = row_count;

  -- ⚠️ Count what came back. A partial reversal otherwise reads exactly like a
  -- clean one (P196) -- the residue is REPORTED, never folded into success.
  v_skipped := v_target - v_unresolved;

  update dia_ownergap2_resolution_log
     set reverted_at = now()
   where batch_tag = p_batch_tag
     and outcome = 'resolved'
     and reverted_at is null;
  get diagnostics v_reverted = row_count;

  return query select v_unresolved, v_skipped, v_reverted;
end;
$$;

-- 🔐 SECURITY DEFINER PRIVILEGES (CLAUDE.md, the canonical statement).
-- A newly created function is anon-executable through TWO independent grants —
-- Postgres's implicit PUBLIC grant and Supabase's explicit anon/authenticated
-- grants — and removing either alone is a no-op. This function NULLS an owner
-- link on the properties table, so it is service_role only. Revoked from all
-- three and then ASSERTED with has_function_privilege(), because a privilege
-- read off the REVOKE you just wrote is not evidence.
revoke all on function dia_ownergap2_unresolve(text) from public, anon, authenticated;
grant execute on function dia_ownergap2_unresolve(text) to service_role;

do $$
begin
  if has_function_privilege('anon', 'dia_ownergap2_unresolve(text)', 'execute')
     or has_function_privilege('authenticated', 'dia_ownergap2_unresolve(text)', 'execute') then
    raise exception 'OWNERGAP2: dia_ownergap2_unresolve is still reachable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'dia_ownergap2_unresolve(text)', 'execute') then
    raise exception 'OWNERGAP2: dia_ownergap2_unresolve is not reachable by service_role';
  end if;
end $$;

comment on function dia_ownergap2_unresolve(text) is
  'OWNERGAP2 reversal. Nulls properties.recorded_owner_id for every property a '
  'batch resolved, ONLY where it still points at the row that batch wrote; '
  'anything changed since is reported as skipped_changed_since rather than '
  'clobbered. Does NOT delete recorded_owners rows -- those are real, '
  'source-cited parties. service_role only.';

-- ── 4. ⚠️ A LIVE FALSE POSITIVE IN THE OWNERGAP1 GUARD, FOUND BY THIS BUILD
--        AND DELIBERATELY NOT "FIXED". ────────────────────────────────────────
--
-- `dia_is_fabricated_placeholder_owner()` matches `^(XYZ|ABC)\s`, written
-- against the gpt-4o template placeholders (`ABC Properties LLC`). Measured
-- live 2026-09-16 while READING the Philadelphia misses rather than counting
-- them: the City of Philadelphia's own OPA file lists **`ABC INC`** as the
-- owner of record at `4100 CITY AVE`, and
--     select dia_is_fabricated_placeholder_owner('ABC INC');  -- true
--
-- So a genuine, source-cited, correctly-matched owner name CAN be one the
-- write-time trigger nulls. Weakening the pattern is NOT the answer — that is
-- how a detector starts returning comfortable zeros (P182), and the guard is
-- protecting 471 real fabricated rows. Instead the OWNERGAP2 writer
-- PRE-CHECKS and REFUSES with `outcome_reason = 'blocked_by_fabrication_guard'`,
-- keeping the real name and its citation in the ledger so a human adjudicates
-- one row instead of the system silently losing it. This view surfaces the
-- population so the refusal is visible rather than buried in a reason string.
create or replace view v_dia_ownergap2_fabrication_guard_collisions as
select
  l.property_id,
  l.jurisdiction,
  l.owner_name_seen,
  l.citation->>'source_record_ids'  as source_record_ids,
  l.citation->>'source_url'         as source_url,
  l.citation->>'source_query'       as source_query,
  l.resolved_at
from dia_ownergap2_resolution_log l
where l.outcome_reason = 'blocked_by_fabrication_guard'
  and l.reverted_at is null;

comment on view v_dia_ownergap2_fabrication_guard_collisions is
  'OWNERGAP2: properties whose REAL, source-cited owner name would be '
  'quarantined by the OWNERGAP1 fabrication guard (measured live: the City of '
  'Philadelphia lists "ABC INC" as an owner of record, which matches the '
  'guard''s ^(XYZ|ABC)\s pattern). Refused rather than written, and surfaced '
  'here rather than silently lost. Do NOT resolve this by weakening the guard.';

-- ── 5. Grants. The ledger + views are read through the service_role PostgREST
--      path the handler uses (domainQuery). No anon exposure is added. ───────
grant select, insert, update on dia_ownergap2_resolution_log to service_role;
grant usage, select on sequence dia_ownergap2_resolution_log_id_seq to service_role;
grant select on v_dia_ownergap2_resolution_summary to service_role;
grant select on v_dia_ownergap2_fabrication_guard_collisions to service_role;

-- PostgREST caches the schema; a newly created table 400s PGRST204 on write
-- until it reloads (CLAUDE.md footgun, cost the prompt-78 fix a day).
notify pgrst, 'reload schema';
