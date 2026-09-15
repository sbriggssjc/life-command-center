-- OWN-T0g: lcc_finalize_entity_portfolios's supersession rule
-- (Scott, decision #3 of six, 2026-09-15). See docs/architecture/
-- ownership-truth-pipeline-state.md and PLANNED-BACKLOG.md's
-- OWN-T0b/c/d/f/g row (g) for full narrative.
--
-- Decision (verbatim): "If there was a deed or a transfer of ownership in
-- some clear capacity, then the prior ownership has ended. Accuracy first."
--
-- Background (docs/audits/OWN_T0_PROPERTY_OWNERSHIP_RECONCILED_2026-09-02.md,
-- STATUS.md 2026-09-14 OWN-T0g sizing): lcc_finalize_entity_portfolios's gov
-- branch computes its supersession window ONLY across the rows present in the
-- current inflight sync payload (a single net.http response). A property
-- whose ownership history is split across two sync calls -- e.g. paginated
-- portfolio-sync requests -- never gets compared across that split, so an
-- old current fact and a new current fact for the SAME property can both sit
-- at ownership_end_date = null forever. dia has no supersession logic at
-- all -- its ownership_end_date is taken verbatim from whatever the domain
-- producer sends.
--
-- Classified ownership_source producers by data, not assumption (live query
-- against lcc_entity_portfolio_facts, 2026-09-15): county_deed,
-- gov_ownership_chain, sales_transaction, sales_transactions_seller_exit are
-- genuine recorded transfer instruments (a deed, a county ownership-chain
-- link, or a sales transaction/seller-exit record). gsa_lease_diff,
-- gsa_lease_lessor, lcc_property_owner, county_records, costar/costar_sidebar,
-- and null are NOT transfer evidence -- they are lease-record restatements,
-- internal snapshots, or market data, none of which prove an ownership
-- change actually happened.
--
-- Sized the live blast radius against v_lcc_property_multi_current's 735
-- multi_current_distinct_parties population before writing anything (per the
-- OWN-T0g sizing note's own recommendation): 72 properties have a
-- transfer-evidenced current fact competing with a stale current fact for a
-- different party. Of those, 57 are safe to auto-resolve under Scott's rule
-- (the stale fact's own last-known start date is on or before the transfer's
-- date, or unknown) -- 15 are a genuine, unresolved conflict (the "stale"
-- fact is itself dated LATER than the transfer, i.e. something claims to be
-- even more current than the recorded deed) and are deliberately left alone
-- for v_lcc_portfolio_ownership_conflict / human review, never guessed. The
-- remaining 663 of the 735 carry no transfer evidence on either side at all
-- and are out of scope for this rule (a different gap, not this one).
--
-- lcc_own_t0g_supersede_by_transfer_evidence(p_dry_run, p_batch_tag) is one
-- function, callable two ways:
--  1. Directly, for the one-time backfill of today's residue (and for a
--     periodic manual re-run if the residue ever grows outside the ingest
--     path, e.g. from a merge).
--  2. Called automatically at the end of lcc_finalize_entity_portfolios (see
--     the companion migration 20261102190000), so every future sync
--     self-heals the exact cross-batch gap the audit found -- comparing the
--     newly-finalized transfer-evidenced facts against ALL of
--     lcc_entity_portfolio_facts, not just this payload. The full-table scan
--     is cheap (~14k rows live 2026-09-15), so running it unconditionally on
--     every finalize call is the simplest and most robust option: it also
--     self-heals stale residue left by merges or a bulk backfill, not only
--     fresh syncs.
--
-- Applied and run live on xengecqvemvfknjvbvrq via mcp__Supabase__apply_migration
-- / execute_sql. Dry run matched live exactly: 65 facts / 61 properties
-- would_supersede -> 65 superseded, batch tag 'own_t0g_2026-09-15'. Re-running
-- the dry run afterward found 0 remaining (idempotent). Fully logged to
-- lcc_own_t0g_supersession_log, reversible via
-- lcc_own_t0g_revert_supersession('own_t0g_2026-09-15').

create table if not exists public.lcc_own_t0g_supersession_log (
  id bigserial primary key,
  source_domain text not null,
  source_property_id text not null,
  loser_entity_id uuid not null,
  loser_ownership_source text,
  loser_old_end_date date,
  loser_new_end_date date not null,
  winner_entity_id uuid not null,
  winner_ownership_source text,
  winner_transfer_start date not null,
  batch_tag text not null,
  created_at timestamptz not null default now(),
  reverted_at timestamptz
);

create or replace function public.lcc_own_t0g_supersede_by_transfer_evidence(
  p_dry_run boolean default true,
  p_batch_tag text default null
)
returns table(
  out_source_domain text,
  out_source_property_id text,
  out_loser_entity_id uuid,
  out_loser_source text,
  out_winner_entity_id uuid,
  out_winner_source text,
  out_winner_transfer_start date,
  out_action text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_batch text := coalesce(p_batch_tag, 'own_t0g_' || to_char(now(), 'YYYY-MM-DD'));
begin
  drop table if exists _t0g;
  create temp table _t0g on commit drop as
  with transfer_kinds as (
    select unnest(array['county_deed','gov_ownership_chain','sales_transaction','sales_transactions_seller_exit']) as k
  ),
  cur as (
    select f.entity_id, f.source_domain, f.source_property_id,
      f.ownership_start_date, f.ownership_end_date, f.ownership_source,
      public.lcc_entity_survivor(f.entity_id) as survivor,
      (split_part(coalesce(f.ownership_source,'(null)'), ':', 1)
        in (select k from transfer_kinds)) as is_transfer
    from public.lcc_entity_portfolio_facts f
    where f.is_current
  ),
  per_party as (
    select source_domain, source_property_id, survivor,
      bool_or(is_transfer) as has_transfer,
      max(ownership_start_date) filter (where is_transfer) as transfer_start,
      max(ownership_start_date) as any_start
    from cur
    group by 1,2,3
  ),
  prop_winner as (
    select source_domain, source_property_id, winner_survivor, winner_transfer_start
    from (
      select source_domain, source_property_id, survivor as winner_survivor,
        transfer_start as winner_transfer_start,
        row_number() over (
          partition by source_domain, source_property_id
          order by transfer_start desc nulls last, survivor
        ) as rn
      from per_party
      where has_transfer and transfer_start is not null
    ) ranked
    where rn = 1
  ),
  losers as (
    select pp.source_domain, pp.source_property_id, pp.survivor as loser_survivor,
      pw.winner_survivor, pw.winner_transfer_start
    from per_party pp
    join prop_winner pw
      on pw.source_domain = pp.source_domain and pw.source_property_id = pp.source_property_id
    where pp.survivor <> pw.winner_survivor
      and (pp.any_start is null or pp.any_start <= pw.winner_transfer_start)
  )
  select
    c.entity_id as loser_entity_id, c.source_domain, c.source_property_id,
    c.ownership_source as loser_source, c.ownership_end_date as loser_old_end,
    wf.entity_id as winner_entity_id, wf.ownership_source as winner_source,
    l.winner_transfer_start
  from cur c
  join losers l
    on l.source_domain = c.source_domain and l.source_property_id = c.source_property_id
    and c.survivor = l.loser_survivor
  join cur wf
    on wf.source_domain = c.source_domain and wf.source_property_id = c.source_property_id
    and wf.survivor = l.winner_survivor
    and wf.is_transfer
    and wf.ownership_start_date = l.winner_transfer_start;

  if p_dry_run then
    return query
      select t.source_domain, t.source_property_id, t.loser_entity_id, t.loser_source,
             t.winner_entity_id, t.winner_source, t.winner_transfer_start,
             'DRY-RUN would_supersede'
      from _t0g t;
    return;
  end if;

  insert into public.lcc_own_t0g_supersession_log(
    source_domain, source_property_id, loser_entity_id, loser_ownership_source,
    loser_old_end_date, loser_new_end_date, winner_entity_id, winner_ownership_source,
    winner_transfer_start, batch_tag
  )
  select t.source_domain, t.source_property_id, t.loser_entity_id, t.loser_source,
         t.loser_old_end, t.winner_transfer_start, t.winner_entity_id, t.winner_source,
         t.winner_transfer_start, v_batch
  from _t0g t;

  update public.lcc_entity_portfolio_facts f
  set ownership_end_date = t.winner_transfer_start, updated_at = now()
  from _t0g t
  where f.entity_id = t.loser_entity_id
    and f.source_domain = t.source_domain
    and f.source_property_id = t.source_property_id;

  return query
    select t.source_domain, t.source_property_id, t.loser_entity_id, t.loser_source,
           t.winner_entity_id, t.winner_source, t.winner_transfer_start,
           'SUPERSEDED (batch ' || v_batch || ')'
    from _t0g t;
end;
$function$;

comment on function public.lcc_own_t0g_supersede_by_transfer_evidence(boolean, text) is
  'OWN-T0g, Scott 2026-09-15: for every property with a transfer-evidenced current '
  'fact (ownership_source prefix in county_deed/gov_ownership_chain/sales_transaction/'
  'sales_transactions_seller_exit) competing against another current fact for a '
  'different party, end-dates the other party''s fact at the transfer''s start date -- '
  'UNLESS that other fact''s own most-recent start date is LATER than the transfer '
  '(a genuine unresolved conflict, left for v_lcc_portfolio_ownership_conflict / '
  'human review). Scans the full table every call, not just a payload -- this is what '
  'closes the cross-sync-batch gap lcc_finalize_entity_portfolios had. Reversible via '
  'lcc_own_t0g_revert_supersession(batch_tag).';

create or replace function public.lcc_own_t0g_revert_supersession(p_batch_tag text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  update public.lcc_entity_portfolio_facts f
  set ownership_end_date = l.loser_old_end_date, updated_at = now()
  from public.lcc_own_t0g_supersession_log l
  where l.batch_tag = p_batch_tag and l.reverted_at is null
    and f.entity_id = l.loser_entity_id
    and f.source_domain = l.source_domain
    and f.source_property_id = l.source_property_id;
  get diagnostics v_n = row_count;

  update public.lcc_own_t0g_supersession_log
  set reverted_at = now()
  where batch_tag = p_batch_tag and reverted_at is null;

  return v_n;
end;
$function$;

REVOKE ALL ON FUNCTION public.lcc_own_t0g_supersede_by_transfer_evidence(boolean, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_own_t0g_supersede_by_transfer_evidence(boolean, text) TO service_role;

REVOKE ALL ON FUNCTION public.lcc_own_t0g_revert_supersession(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_own_t0g_revert_supersession(text) TO service_role;

DO $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.lcc_own_t0g_supersede_by_transfer_evidence(boolean, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_own_t0g_supersede_by_transfer_evidence: service_role EXECUTE grant did not take';
  END IF;
  IF has_function_privilege('anon', 'public.lcc_own_t0g_supersede_by_transfer_evidence(boolean, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_own_t0g_supersede_by_transfer_evidence: anon must NOT be able to execute this';
  END IF;
  IF has_function_privilege('authenticated', 'public.lcc_own_t0g_supersede_by_transfer_evidence(boolean, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_own_t0g_supersede_by_transfer_evidence: authenticated must NOT be able to execute this';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.lcc_own_t0g_revert_supersession(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_own_t0g_revert_supersession: service_role EXECUTE grant did not take';
  END IF;
  IF has_function_privilege('anon', 'public.lcc_own_t0g_revert_supersession(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_own_t0g_revert_supersession: anon must NOT be able to execute this';
  END IF;
  IF has_function_privilege('authenticated', 'public.lcc_own_t0g_revert_supersession(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_own_t0g_revert_supersession: authenticated must NOT be able to execute this';
  END IF;
END $$;
