-- BR4: broker dedupe against the firm-linked population, and the firm strings BR1 queued
--
-- BR1 repaired the `broker_companies` registry (composite-string collapse, alias table,
-- review lane) and fleet-wide backfilled `brokers.broker_company_id` from it, leaving:
--   - 143-146 duplicate-broker-NAME groups (re-measured here on br1_norm_token(broker_name))
--   - 674 open dia_broker_company_composite_review rows, 661 of them brokers.company strings
--     whose firm token had no exact/alias match in the (now repaired) registry
--   - an unmeasured population of `brokers` rows whose "broker_name" is actually a firm or
--     operator name, not a person
--
-- This migration is the BR4 unit: measure the duplicate-name groups BY GROUP before touching
-- anything, merge ONLY the true duplicates (same normalized name AND same non-null
-- broker_company_id AND no conflicting contact fields AND not itself a ';'-composite shape),
-- resolve the queued firm strings that carry independent evidence (>=3 distinct brokers AND
-- >=2 of them sharing one email domain) by minting new broker_companies rows through BR1's own
-- br1_resolve_firm() (never inventing a second minting path), and flag (never merge, never
-- delete) `brokers` rows whose name is firm/operator-shaped.
--
-- Discipline (identical to BR1): fill-blanks only (a merge only ever fills a NULL contact
-- field on the survivor, never overwrites a populated one) - conservative/unambiguous (a
-- conflicting email/phone, a different broker_company_id, or a ';'-composite name routes to
-- review, never merged) - reversible (dia_br4_broker_merge_log snapshots every dropped row +
-- its FK repoints, batch-tagged; REVERSAL RUNBOOK below) - idempotent (a merged/flagged/resolved
-- row does not requalify) - dry-run-default (p_dry_run boolean default true on every driver
-- function) - never fabricates an identity, a firm name, or an FK the source data does not
-- already carry.
--
-- Live results on Dialysis_DB (zqzrriwuavgrquhisnoa), measured 2026-09-17 (see the response doc
-- for the full classification table; this header records the counts, not the row lists):
--   duplicate-name groups (br1_norm_token(broker_name), n>1): 146 total --
--     20 both-blank-company (no company_id anywhere in the group, not a merge target: nothing
--       to compare identity against) -- 3 true-duplicate candidates (same name, same non-null
--       company_id, no blank in the group) -- 120 one-linked-one-blank (same name, exactly one
--       non-null company_id, at least one blank sibling: NOTED, never merged -- filling the
--       blank would be an identity guess this migration refuses to make) -- 3 genuinely
--       different companies (same name, >1 distinct non-null company_id: NEVER merged, e.g.
--       "Colin Cornell" at Colliers vs a bare "Colin Cornell" shell, "Scott Gould" at three
--       different firms, "Valerie Cook" at two).
--   Of the 3 true-duplicate candidates, 1 ("C&W; Patel & Trautvetter" x2) is itself a
--     ';'-composite broker_name -- the same capture-artifact shape BR1 fixed in
--     broker_companies, now found one table over in brokers.broker_name. Routed to review
--     instead of merged (merging two copies of a malformed name does not repair the shape).
--   The other 2 groups ("Colliers International" x2, "Timothy Stephenson, Jr." x2) merge.
--
-- REVERSAL RUNBOOK (per batch_tag):
--   1. Re-insert the dropped brokers row:
--      INSERT INTO brokers (broker_id, broker_name, company, email, phone, created_at,
--        broker_company_id, deal_count, avg_cap_rate, preferred_states, primary_clients,
--        procuring_frequency, listing_frequency, relationship_overlap_score, normalized_name)
--      SELECT (row_snapshot->>'broker_id')::int, row_snapshot->>'broker_name',
--             row_snapshot->>'company', row_snapshot->>'email', row_snapshot->>'phone',
--             (row_snapshot->>'created_at')::timestamp,
--             (row_snapshot->>'broker_company_id')::bigint, (row_snapshot->>'deal_count')::int,
--             (row_snapshot->>'avg_cap_rate')::numeric, NULL, NULL, NULL, NULL, NULL,
--             row_snapshot->>'normalized_name'
--      FROM dia_br4_broker_merge_log WHERE batch_tag = '<tag>' AND action = 'merge_drop'
--      ON CONFLICT (broker_id) DO NOTHING;
--   2. Un-repoint the FKs the `fk_repoints` jsonb column on that same log row names (each key
--      is a `<table>.<column>` that was pointed at the survivor and must be pointed back at the
--      restored broker_id for rows this batch actually touched -- cross-reference
--      dia_br4_broker_merge_log.fk_repoints, which records the pre-repoint row count per FK).
--   3. Restore any fill-blank the survivor received from the loser
--      (dia_br4_broker_merge_log.filled_fields jsonb names the survivor columns this batch set
--      -- clear them back to NULL only if nothing has legitimately populated them since).
--
-- For the firm-string mint batches, use BR1's own reversal runbook (identities before entities)
-- plus: DELETE FROM dia_br4_firm_mint_evidence WHERE batch_tag = '<tag>'; and clear
-- brokers.broker_company_id back to NULL for the rows named in br1_broker_backfill_log WHERE
-- batch_tag = '<tag>' AND action = 'filled_blank'.

-- ============================================================================
-- 1. Backup / provenance tables
-- ============================================================================

create table if not exists dia_br4_broker_merge_log (
  log_id bigserial primary key,
  batch_tag text not null,
  survivor_broker_id integer not null,
  dropped_broker_id integer not null,
  action text not null check (action in ('merge_drop','merge_fk_repoint','merge_fill_blank')),
  row_snapshot jsonb,
  fk_repoints jsonb,
  filled_fields jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_br4_merge_log_batch on dia_br4_broker_merge_log(batch_tag);
create index if not exists idx_br4_merge_log_dropped on dia_br4_broker_merge_log(dropped_broker_id);

create table if not exists dia_br4_firm_mint_evidence (
  evidence_id bigserial primary key,
  batch_tag text not null,
  broker_company_id bigint not null references broker_companies(broker_company_id),
  norm_firm text not null,
  n_brokers_in_group int not null,
  dominant_email_domain text,
  n_brokers_on_domain int,
  broker_ids int[] not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_br4_firm_evidence_batch on dia_br4_firm_mint_evidence(batch_tag);

alter table dia_br4_broker_merge_log enable row level security;
alter table dia_br4_firm_mint_evidence enable row level security;

drop policy if exists br4_service_role_only on dia_br4_broker_merge_log;
create policy br4_service_role_only on dia_br4_broker_merge_log
  for all to service_role using (true) with check (true);

drop policy if exists br4_service_role_only on dia_br4_firm_mint_evidence;
create policy br4_service_role_only on dia_br4_firm_mint_evidence
  for all to service_role using (true) with check (true);

revoke all on dia_br4_broker_merge_log from public, anon, authenticated;
revoke all on dia_br4_firm_mint_evidence from public, anon, authenticated;

-- ============================================================================
-- 2. Classification view -- read this BEFORE calling any driver function. It
--    is the "measure first, by group" table the BR4 prompt requires, kept
--    live (not a one-shot snapshot) so it stays honest as the population
--    changes.
-- ============================================================================

create or replace view v_br4_broker_dup_group_classification as
with grp as (
  select
    br1_norm_token(broker_name) as norm_name,
    array_agg(distinct broker_company_id) filter (where broker_company_id is not null) as non_null_company_ids,
    count(*) filter (where broker_company_id is null) as n_blank,
    count(*) filter (where broker_company_id is not null) as n_linked,
    count(*) as n_total,
    array_agg(distinct broker_id order by broker_id) as broker_ids,
    bool_or(broker_name ~ ';') as any_composite_shape,
    count(distinct email) filter (where email is not null) as n_distinct_emails,
    count(distinct phone) filter (where phone is not null) as n_distinct_phones
  from brokers
  where broker_name is not null and btrim(broker_name) <> ''
  group by br1_norm_token(broker_name)
  having count(*) > 1
)
select
  norm_name,
  n_total,
  broker_ids,
  non_null_company_ids,
  n_blank,
  n_linked,
  any_composite_shape,
  n_distinct_emails,
  n_distinct_phones,
  case
    when non_null_company_ids is null then 'both_or_all_blank_company'
    when array_length(non_null_company_ids, 1) > 1 then 'different_companies_never_merge'
    when n_blank > 0 then 'one_linked_one_blank_noted_only'
    when any_composite_shape then 'true_duplicate_but_composite_shape_review'
    when n_distinct_emails > 1 or n_distinct_phones > 1 then 'true_duplicate_contact_conflict_review'
    else 'true_duplicate_candidate'
  end as classification
from grp
order by classification, norm_name;

comment on view v_br4_broker_dup_group_classification is
  'BR4: every brokers.broker_name duplicate-name group (br1_norm_token), classified before any write. Read this first. Only classification=''true_duplicate_candidate'' rows are eligible for br4_merge_broker_duplicates().';

revoke all on v_br4_broker_dup_group_classification from public, anon, authenticated;

-- ============================================================================
-- 3. Evidence score for survivor selection: more FK-linked rows across every
--    enumerated referencing table/column beats more populated contact
--    fields beats more recent created_at. Enumerated from pg_constraint at
--    migration-authoring time (13 FK constraints, 11 distinct referencing
--    tables) -- the ID2a lesson: list every FK before writing a merge.
-- ============================================================================

create or replace function br4_broker_evidence_score(p_broker_id integer)
returns table(link_count int, contact_field_count int, created_at timestamp)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    (
      (select count(*) from sales_transactions st where st.listing_broker_id = p_broker_id or st.procuring_broker_id = p_broker_id)
      + (select count(*) from sale_brokers sb where sb.broker_id = p_broker_id)
      + (select count(*) from available_listings al where al.broker_id = p_broker_id)
      + (select count(*) from available_portfolios ap where ap.listing_broker_id = p_broker_id or ap.procuring_broker_id = p_broker_id)
      + (select count(*) from sales_portfolios sp where sp.listing_broker_id = p_broker_id or sp.procuring_broker_id = p_broker_id)
      + (select count(*) from loans ln where ln.broker_id = p_broker_id)
      + (select count(*) from contacts c where c.known_broker = p_broker_id)
      + (select count(*) from broker_company_history bch where bch.broker_id = p_broker_id)
      + (select count(*) from broker_market_coverage bmc where bmc.broker_id = p_broker_id)
      + (select count(*) from broker_market_summary bms where bms.broker_id = p_broker_id)
    )::int as link_count,
    (
      (select (email is not null)::int + (phone is not null)::int from brokers where broker_id = p_broker_id)
    )::int as contact_field_count,
    (select created_at from brokers where broker_id = p_broker_id) as created_at
$$;

revoke all on function br4_broker_evidence_score(integer) from public, anon, authenticated;

-- ============================================================================
-- 4. Merge driver: true duplicates only. Reads v_br4_broker_dup_group_classification,
--    acts only on classification='true_duplicate_candidate' groups, picks the
--    survivor by evidence score, repoints every enumerated FK, fills blanks
--    on the survivor from the loser, snapshots + deletes the loser. A group
--    with 3+ rows merges pairwise (all into one survivor) in one pass.
-- ============================================================================

create or replace function br4_merge_broker_duplicates(p_dry_run boolean default true, p_batch_tag text default null)
returns table(
  groups_seen int,
  groups_merged int,
  brokers_dropped int,
  fk_rows_repointed int
)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_batch text := coalesce(p_batch_tag, 'br4_' || to_char(now(), 'YYYYMMDD_HH24MISS'));
  v_grp record;
  v_survivor_id int;
  v_loser_id int;
  v_best_link_count int;
  v_best_contact_count int;
  v_best_created_at timestamp;
  v_have_best boolean := false;
  v_candidate int;
  v_cand_score record;
  v_groups_seen int := 0;
  v_groups_merged int := 0;
  v_dropped int := 0;
  v_fk_total int := 0;
  v_fk_count int;
  v_snapshot jsonb;
  v_fk_map jsonb;
  v_filled jsonb;
  v_loser_row record;
  v_survivor_row record;
begin
  for v_grp in
    select norm_name, broker_ids
    from v_br4_broker_dup_group_classification
    where classification = 'true_duplicate_candidate'
    order by norm_name
  loop
    v_groups_seen := v_groups_seen + 1;

    -- pick the survivor: highest link_count, then highest contact_field_count,
    -- then most recent created_at, then lowest broker_id (deterministic).
    -- (scalars, not a record var -- a PL/pgSQL `record` cannot have its
    -- fields referenced before its first assignment, even inside an
    -- untaken OR branch; the P195 "unassigned record" footgun one layer
    -- over on a different type of record.)
    v_survivor_id := null;
    v_have_best := false;
    foreach v_candidate in array v_grp.broker_ids loop
      select * into v_cand_score from br4_broker_evidence_score(v_candidate);
      if not v_have_best
        or v_cand_score.link_count > v_best_link_count
        or (v_cand_score.link_count = v_best_link_count and v_cand_score.contact_field_count > v_best_contact_count)
        or (v_cand_score.link_count = v_best_link_count and v_cand_score.contact_field_count = v_best_contact_count
            and v_cand_score.created_at > v_best_created_at)
      then
        v_best_link_count := v_cand_score.link_count;
        v_best_contact_count := v_cand_score.contact_field_count;
        v_best_created_at := v_cand_score.created_at;
        v_have_best := true;
        v_survivor_id := v_candidate;
      end if;
    end loop;

    if not p_dry_run then
      foreach v_loser_id in array v_grp.broker_ids loop
        continue when v_loser_id = v_survivor_id;

        select * into v_loser_row from brokers where broker_id = v_loser_id;
        select * into v_survivor_row from brokers where broker_id = v_survivor_id;
        v_snapshot := to_jsonb(v_loser_row);
        v_fk_map := '{}'::jsonb;

        -- fk repoints, one table at a time, unique-constraint-aware
        select count(*) into v_fk_count from sales_transactions where listing_broker_id = v_loser_id;
        update sales_transactions set listing_broker_id = v_survivor_id where listing_broker_id = v_loser_id;
        v_fk_map := v_fk_map || jsonb_build_object('sales_transactions.listing_broker_id', v_fk_count);
        v_fk_total := v_fk_total + v_fk_count;

        select count(*) into v_fk_count from sales_transactions where procuring_broker_id = v_loser_id;
        update sales_transactions set procuring_broker_id = v_survivor_id where procuring_broker_id = v_loser_id;
        v_fk_map := v_fk_map || jsonb_build_object('sales_transactions.procuring_broker_id', v_fk_count);
        v_fk_total := v_fk_total + v_fk_count;

        select count(*) into v_fk_count from contacts where known_broker = v_loser_id;
        update contacts set known_broker = v_survivor_id where known_broker = v_loser_id;
        v_fk_map := v_fk_map || jsonb_build_object('contacts.known_broker', v_fk_count);
        v_fk_total := v_fk_total + v_fk_count;

        select count(*) into v_fk_count from broker_company_history where broker_id = v_loser_id;
        update broker_company_history set broker_id = v_survivor_id where broker_id = v_loser_id;
        v_fk_map := v_fk_map || jsonb_build_object('broker_company_history.broker_id', v_fk_count);
        v_fk_total := v_fk_total + v_fk_count;

        select count(*) into v_fk_count from broker_market_coverage where broker_id = v_loser_id;
        update broker_market_coverage set broker_id = v_survivor_id where broker_id = v_loser_id;
        v_fk_map := v_fk_map || jsonb_build_object('broker_market_coverage.broker_id', v_fk_count);
        v_fk_total := v_fk_total + v_fk_count;

        select count(*) into v_fk_count from available_listings where broker_id = v_loser_id;
        update available_listings set broker_id = v_survivor_id where broker_id = v_loser_id;
        v_fk_map := v_fk_map || jsonb_build_object('available_listings.broker_id', v_fk_count);
        v_fk_total := v_fk_total + v_fk_count;

        select count(*) into v_fk_count from available_portfolios where listing_broker_id = v_loser_id;
        update available_portfolios set listing_broker_id = v_survivor_id where listing_broker_id = v_loser_id;
        v_fk_map := v_fk_map || jsonb_build_object('available_portfolios.listing_broker_id', v_fk_count);
        v_fk_total := v_fk_total + v_fk_count;

        select count(*) into v_fk_count from available_portfolios where procuring_broker_id = v_loser_id;
        update available_portfolios set procuring_broker_id = v_survivor_id where procuring_broker_id = v_loser_id;
        v_fk_map := v_fk_map || jsonb_build_object('available_portfolios.procuring_broker_id', v_fk_count);
        v_fk_total := v_fk_total + v_fk_count;

        select count(*) into v_fk_count from broker_market_summary where broker_id = v_loser_id;
        update broker_market_summary set broker_id = v_survivor_id where broker_id = v_loser_id;
        v_fk_map := v_fk_map || jsonb_build_object('broker_market_summary.broker_id', v_fk_count);
        v_fk_total := v_fk_total + v_fk_count;

        select count(*) into v_fk_count from sales_portfolios where listing_broker_id = v_loser_id;
        update sales_portfolios set listing_broker_id = v_survivor_id where listing_broker_id = v_loser_id;
        v_fk_map := v_fk_map || jsonb_build_object('sales_portfolios.listing_broker_id', v_fk_count);
        v_fk_total := v_fk_total + v_fk_count;

        select count(*) into v_fk_count from sales_portfolios where procuring_broker_id = v_loser_id;
        update sales_portfolios set procuring_broker_id = v_survivor_id where procuring_broker_id = v_loser_id;
        v_fk_map := v_fk_map || jsonb_build_object('sales_portfolios.procuring_broker_id', v_fk_count);
        v_fk_total := v_fk_total + v_fk_count;

        select count(*) into v_fk_count from loans where broker_id = v_loser_id;
        update loans set broker_id = v_survivor_id where broker_id = v_loser_id;
        v_fk_map := v_fk_map || jsonb_build_object('loans.broker_id', v_fk_count);
        v_fk_total := v_fk_total + v_fk_count;

        -- sale_brokers carries UNIQUE(sale_id, broker_id, role) -- a straight
        -- repoint can collide with a row the survivor already holds. Drop the
        -- loser's row ONLY where the survivor already has the identical
        -- (sale_id, role) pair (a true duplicate join row, non-substantive);
        -- repoint everything else.
        select count(*) into v_fk_count from sale_brokers where broker_id = v_loser_id;
        delete from sale_brokers sb
          where sb.broker_id = v_loser_id
            and exists (
              select 1 from sale_brokers sb2
              where sb2.broker_id = v_survivor_id
                and sb2.sale_id = sb.sale_id
                and sb2.role is not distinct from sb.role
            );
        update sale_brokers set broker_id = v_survivor_id where broker_id = v_loser_id;
        v_fk_map := v_fk_map || jsonb_build_object('sale_brokers.broker_id', v_fk_count);
        v_fk_total := v_fk_total + v_fk_count;

        -- fill-blanks on the survivor from the loser (never overwrite a populated field)
        v_filled := '{}'::jsonb;
        if v_survivor_row.company is null and v_loser_row.company is not null then
          update brokers set company = v_loser_row.company where broker_id = v_survivor_id;
          v_filled := v_filled || jsonb_build_object('company', v_loser_row.company);
        end if;
        if v_survivor_row.email is null and v_loser_row.email is not null then
          update brokers set email = v_loser_row.email where broker_id = v_survivor_id;
          v_filled := v_filled || jsonb_build_object('email', v_loser_row.email);
        end if;
        if v_survivor_row.phone is null and v_loser_row.phone is not null then
          update brokers set phone = v_loser_row.phone where broker_id = v_survivor_id;
          v_filled := v_filled || jsonb_build_object('phone', v_loser_row.phone);
        end if;

        insert into dia_br4_broker_merge_log
          (batch_tag, survivor_broker_id, dropped_broker_id, action, row_snapshot, fk_repoints, filled_fields, note)
        values (v_batch, v_survivor_id, v_loser_id, 'merge_drop', v_snapshot, v_fk_map, v_filled,
          format('true duplicate: br1_norm_token(broker_name)=%L, both rows carried broker_company_id=%s',
            br1_norm_token(v_loser_row.broker_name), v_loser_row.broker_company_id));

        delete from brokers where broker_id = v_loser_id;
        v_dropped := v_dropped + 1;
      end loop;

      v_groups_merged := v_groups_merged + 1;
    else
      v_groups_merged := v_groups_merged + 1;
    end if;
  end loop;

  return query select v_groups_seen, v_groups_merged, v_dropped, v_fk_total;
end;
$$;

revoke all on function br4_merge_broker_duplicates(boolean, text) from public, anon, authenticated;

-- ============================================================================
-- 5. Composite-shaped or contact-conflicting true-duplicate groups are routed
--    to the EXISTING BR1 review lane, never merged, never silently dropped.
-- ============================================================================

create or replace function br4_route_unmergeable_duplicates_to_review(p_dry_run boolean default true, p_batch_tag text default null)
returns table(routed int)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_batch text := coalesce(p_batch_tag, 'br4_' || to_char(now(), 'YYYYMMDD_HH24MISS'));
  v_row record;
  v_broker_id int;
  v_ct int := 0;
begin
  for v_row in
    select norm_name, broker_ids, classification
    from v_br4_broker_dup_group_classification
    where classification in ('true_duplicate_but_composite_shape_review', 'true_duplicate_contact_conflict_review')
  loop
    foreach v_broker_id in array v_row.broker_ids loop
      v_ct := v_ct + 1;
      if not p_dry_run then
        insert into dia_broker_company_composite_review (source_table, source_id, raw_text, reason, batch_tag)
        select 'brokers', v_broker_id, b.broker_name,
          format('BR4: duplicate broker_name group %L shares broker_company_id but %s -- never auto-merged',
            v_row.norm_name,
            case v_row.classification
              when 'true_duplicate_but_composite_shape_review' then 'the name itself is a '';''-composite capture artifact'
              else 'the group''s contact fields (email/phone) disagree'
            end),
          v_batch
        from brokers b where b.broker_id = v_broker_id
        on conflict (source_table, source_id) where status = 'open' do nothing;
      end if;
    end loop;
  end loop;
  return query select v_ct;
end;
$$;

revoke all on function br4_route_unmergeable_duplicates_to_review(boolean, text) from public, anon, authenticated;

-- ============================================================================
-- 6. Firm-string resolver: the 661 (or however many are currently open)
--    brokers.company firm tokens with no exact/alias registry match. Mints a
--    new firm ONLY where the group carries independent evidence: >=3
--    distinct brokers under one normalized firm token AND >=2 of them share
--    one email domain. Reuses BR1's own br1_resolve_firm() as the SOLE
--    minting path (never a second minter). Junk-shaped tokens (an address
--    fragment, an over-long run-on concatenation, a token starting with a
--    digit) are excluded from minting even if they clear the count
--    thresholds -- they stay queued.
-- ============================================================================

create or replace function br4_resolve_unmatched_firm_strings(
  p_dry_run boolean default true,
  p_batch_tag text default null,
  p_min_brokers int default 3,
  p_min_domain_brokers int default 2
)
returns table(
  groups_seen int,
  groups_minted int,
  groups_junk_shaped_skipped int,
  groups_weak_evidence_skipped int,
  brokers_filled int
)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_batch text := coalesce(p_batch_tag, 'br4_firm_' || to_char(now(), 'YYYYMMDD_HH24MISS'));
  v_grp record;
  v_representative text;
  v_resolved record;
  v_broker_id int;
  v_existing bigint;
  v_seen int := 0;
  v_minted int := 0;
  v_junk int := 0;
  v_weak int := 0;
  v_filled int := 0;
begin
  for v_grp in
    with base as (
      select
        br1_norm_token(split_part(r.raw_text, ';', 1)) as norm_firm,
        r.review_id,
        r.source_id as broker_id,
        lower(split_part(b.email, '@', 2)) as domain
      from dia_broker_company_composite_review r
      join brokers b on b.broker_id = r.source_id
      where r.source_table = 'brokers' and r.status = 'open'
        and r.reason like 'no exact or alias match%'
        and b.email ~ '@' and b.email not like '%;%' and b.email not like '% / %'
    ),
    domain_counts as (
      select norm_firm, domain, count(distinct broker_id) as n_on_domain
      from base group by norm_firm, domain
    ),
    best_domain as (
      select distinct on (norm_firm) norm_firm, domain, n_on_domain
      from domain_counts
      order by norm_firm, n_on_domain desc, domain
    ),
    totals as (
      select
        br1_norm_token(split_part(r.raw_text, ';', 1)) as norm_firm,
        array_agg(distinct r.source_id) as broker_ids,
        count(distinct r.source_id) as n_brokers
      from dia_broker_company_composite_review r
      where r.source_table = 'brokers' and r.status = 'open'
        and r.reason like 'no exact or alias match%'
      group by 1
    )
    select t.norm_firm, t.broker_ids, t.n_brokers, bd.domain, bd.n_on_domain
    from totals t
    left join best_domain bd using (norm_firm)
    where t.n_brokers >= p_min_brokers
    order by t.n_brokers desc, t.norm_firm
  loop
    v_seen := v_seen + 1;

    -- junk-shape guard: an address fragment ("Whittier, CA 90602"), a token
    -- starting with a digit, or an over-long run-on concatenation never mints
    -- even if it clears the count thresholds.
    if v_grp.norm_firm ~* ',\s*[a-z]{2}\s+\d{5}' or v_grp.norm_firm ~ '^\d'
      or length(v_grp.norm_firm) > 60 or v_grp.norm_firm ~* '^listed by '
    then
      v_junk := v_junk + 1;
      continue;
    end if;

    if v_grp.n_on_domain is null or v_grp.n_on_domain < p_min_domain_brokers then
      v_weak := v_weak + 1;
      continue;
    end if;

    -- representative raw text: the most common raw firm-token spelling in
    -- the group (never fabricated -- verbatim from the source data), ties
    -- broken alphabetically for determinism.
    select btrim(split_part(raw_text, ';', 1)) into v_representative
    from dia_broker_company_composite_review
    where source_table = 'brokers' and status = 'open' and reason like 'no exact or alias match%'
      and br1_norm_token(split_part(raw_text, ';', 1)) = v_grp.norm_firm
    group by 1
    order by count(*) desc, 1
    limit 1;

    if p_dry_run then
      v_minted := v_minted + 1;
      continue;
    end if;

    select * into v_resolved from br1_resolve_firm(v_representative, v_batch, false);

    insert into dia_br4_firm_mint_evidence
      (batch_tag, broker_company_id, norm_firm, n_brokers_in_group, dominant_email_domain, n_brokers_on_domain, broker_ids)
    values (v_batch, v_resolved.company_id, v_grp.norm_firm, v_grp.n_brokers, v_grp.domain, v_grp.n_on_domain, v_grp.broker_ids);

    foreach v_broker_id in array v_grp.broker_ids loop
      select broker_company_id into v_existing from brokers where broker_id = v_broker_id;
      if v_existing is null then
        update brokers set broker_company_id = v_resolved.company_id where broker_id = v_broker_id;
        insert into br1_broker_backfill_log (batch_tag, broker_id, action, new_broker_company_id, note)
        values (v_batch, v_broker_id, 'filled_blank', v_resolved.company_id,
          format('BR4 mint: firm %L minted from %s distinct brokers sharing email domain %L (%s of %s)',
            v_representative, v_grp.n_brokers, v_grp.domain, v_grp.n_on_domain, v_grp.n_brokers));
        v_filled := v_filled + 1;
      end if;
    end loop;

    update dia_broker_company_composite_review
      set status = 'approved', resolved_at = now(),
        resolved_note = format('BR4: minted broker_company_id=%s from %s brokers sharing domain %L (evidence: %s of %s on that domain)',
          v_resolved.company_id, v_grp.n_brokers, v_grp.domain, v_grp.n_on_domain, v_grp.n_brokers)
      where source_table = 'brokers' and status = 'open'
        and source_id = any(v_grp.broker_ids)
        and reason like 'no exact or alias match%';

    v_minted := v_minted + 1;
  end loop;

  return query select v_seen, v_minted, v_junk, v_weak, v_filled;
end;
$$;

revoke all on function br4_resolve_unmatched_firm_strings(boolean, text, int, int) from public, anon, authenticated;

-- ============================================================================
-- 7. Non-broker rows: brokers.broker_name that is firm/operator-shaped, not a
--    person. NEVER merged, NEVER deleted -- flagged into the existing review
--    lane with a reason, so a human disposes of them (likely: split the
--    firm-shaped ones into broker_companies via the same classifier BR1
--    already built, and reassign the operator-shaped ones off the brokers
--    table entirely -- both out of scope here).
-- ============================================================================

create or replace function br4_flag_nonperson_broker_rows(p_dry_run boolean default true, p_batch_tag text default null)
returns table(flagged int, already_open int)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_batch text := coalesce(p_batch_tag, 'br4_nonperson_' || to_char(now(), 'YYYYMMDD_HH24MISS'));
  v_flagged int := 0;
  v_already int := 0;
  v_row record;
begin
  for v_row in
    select b.broker_id, b.broker_name,
      case
        when b.broker_name ~* '\y(llc|l\.l\.c\.?|inc\.?|incorporated|corp\.?|corporation|trust|lp\.?|l\.p\.?|ltd\.?|partners|group|holdings|company|co\.)\y'
          then 'org_marker'
        when b.broker_name ~* '\y(davita|fresenius|us\s*renal|american\s*renal|dialysis\s*clinic|satellite\s*healthcare|innovative\s*renal|northwest\s*kidney)\y'
          then 'known_dialysis_operator_name'
        when exists (select 1 from operators o where lower(btrim(o.name)) = lower(btrim(b.broker_name)))
          then 'matches_operators_registry'
        else null
      end as match_reason
    from brokers b
    where b.broker_name is not null
  loop
    continue when v_row.match_reason is null;
    if not p_dry_run then
      insert into dia_broker_company_composite_review (source_table, source_id, raw_text, reason, batch_tag)
      values ('brokers', v_row.broker_id, v_row.broker_name,
        format('BR4: name is firm/operator-shaped (%s), not a person -- never merged, never deleted, needs manual disposition', v_row.match_reason),
        v_batch)
      on conflict (source_table, source_id) where status = 'open' do nothing;
      -- distinguish a genuine new flag from a no-op against an already-open row
      if found then
        v_flagged := v_flagged + 1;
      else
        v_already := v_already + 1;
      end if;
    else
      v_flagged := v_flagged + 1;
    end if;
  end loop;
  return query select v_flagged, v_already;
end;
$$;

revoke all on function br4_flag_nonperson_broker_rows(boolean, text) from public, anon, authenticated;
