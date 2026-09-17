-- RECON1 — DaVita Banning (6050-6090 W Ramsey St) one-clinic reconciliation +
-- the general-purpose fixes it exposed. Dialysis_DB (zqzrriwuavgrquhisnoa).
--
-- ✅ APPLIED LIVE 2026-09-17 via Supabase MCP (three incremental corrections
-- were needed after the first apply attempt — see history below — the final
-- function body below is what actually ran and is what this file records).
-- Batch tag used for the live apply: 'recon1_banning_apply1'.
--
-- CONTEXT. Three `properties` rows existed for one clinic because
-- address-range form ("6050-6090 W Ramsey St") never matched either
-- single-number intake ("6050 W Ramsey St" from an OM email intake, "6090 W
-- Ramsey St" from a CoStar capture). Traced live 2026-09-17 (Supabase MCP,
-- project zqzrriwuavgrquhisnoa) before this migration ran:
--   property_id 29894  "6050-6090 W Ramsey St"  survivor  (2 sales, 4 leases,
--                        2 ownership rows, 3 listings, completeness 83)
--   property_id 35786  "6050 W Ramsey St"        shell     (OM intake email
--                        "PURCHASE LOI - 6050 W Ramsey St., Banning (DaVita)",
--                        1 active listing, completeness 27)
--   property_id 51228  "6090 W Ramsey St"        shell     (CoStar capture,
--                        1 active listing, true_owner_id set no recorded
--                        owner, completeness 22)
--
-- Consequences fixed here, all on 29894 after the merge:
--   (a) listing 9499 (2024-12-05) read status='sold'/off_market_date set with
--       NO sold_date and NO sale_transaction_id — it was RELISTED, not sold.
--   (b) the 2026-09-14 sale (id 15042, $4,180,180) closed listing 14798 but
--       the two shell listings 12350/15146 stayed active on the shell rows
--       (why "Available" still showed the clinic after close). Once merged
--       onto the survivor, dia_merge_property's own existing collision/fold
--       machinery (merge_function_version dia_merge1_fold_on_collision_2026
--       _09_05, live in this DB) closed BOTH automatically as
--       status='sold'/off_market_date=2026-09-14/sale_transaction_id=15042 —
--       this migration's explicit close_listing loop is therefore a SAFETY
--       NET for a case the merge path does not already cover, not the
--       primary mechanism; on this clinic it fired zero extra rows.
--   (c) lease 23211 (DaVita Kidney Care, 2013-07-14→2018-07-13) read
--       is_active=true 8 years past its own expiration.
--   (d) sale 15042 carried listing_broker='Scott Briggs' (text) and
--       is_northmarq=true but NO listing_broker_id, so team attribution was
--       blank on Recent Closed Sales.
--   (e) sale 15042 carried buyer_name/seller_name = NULL with no explicit
--       "not on file" marker or task to pull the deed.
--   (f) recorded_owners 'DaVita HealthCare Partners' (807949a9-...) already
--       shares normalized_name ('davita healthcare prtnrs') with the deed
--       grantee text "Davita Healthcare Prtnrs" — there is no second owner
--       row to fold. Any stale pending_updates conflict comparing the two is
--       cleared as a name-variant, never a guessed rename.
--   (g) property 29894's ownership_history carried an orphan row (id 1275,
--       sale_id=4980, no dates/owner ids) alongside a correct seller-exit row
--       (id 21222) — the 2022 buyer was never recorded, and the 2026-09-14
--       sale recorded no transition at all (follows from (e): no buyer name
--       to record). NOT auto-fixed here — see Part 3 rule R3 in
--       docs/architecture/reconcile-property-spec.md; a real ownership
--       transition needs a real party, and none exists until the deed is
--       pulled (the same "not on file" task covers it).
--
-- Attaching the OM's lease-abstract artifact as a new superseding lease
-- (task-spec Part 2 item 4) was DELIBERATELY NOT DONE here: extracting lease
-- terms from that artifact requires the existing AI extraction path
-- (intake-extractor.js / lease-extractor.js) — a model call — which is out
-- of scope for a deterministic SQL migration and would violate "never
-- fabricate a lease term." Left for the existing OM extraction pipeline /
-- a human to action.
--
-- DOCTRINE FOLLOWED (CLAUDE.md, this repo + Dialysis repo):
--   · merge ONLY through `dia_merge_property_reversible` — never a raw DELETE.
--   · fill-blanks only; never clobber a curated value.
--   · never guess a buyer/seller/owner — "not on file" is the honest value,
--     recorded explicitly with a task to pull the deed, not a blank.
--   · idempotent (every write is a guarded fill/repair, checked before it
--     runs), dry-run-default, reversible, provenance-tagged (dia_recon1_run_log).
--   · R2-R6 (see docs/architecture/reconcile-property-spec.md) are fully
--     deterministic SQL — no model call anywhere in this migration.
--   · vocab constraints on `available_listings.status` / `.off_market_reason`
--     are respected (superseded/sold, withdrawn/withdrawn) — there is no
--     'superseded_by_sale' value in this DB's CHECK vocabulary.
--
-- REVERSAL RUNBOOK:
--   -- undo the property merges (backup_id captured in dia_recon1_run_log):
--   select dia_unmerge_property(backup_id) from dia_recon1_run_log
--     where batch_tag = '<batch_tag>' and step = 'merge' and backup_id is not null;
--   -- everything else in this migration is UPDATE-only against known prior
--   -- values, each captured verbatim in dia_recon1_run_log.prior_value before
--   -- the write, so a manual UPDATE from that column reverses it, e.g.:
--   --   update leases set is_active = (r.prior_value->>'is_active')::boolean
--   --     from dia_recon1_run_log r
--   --    where r.batch_tag='<batch_tag>' and r.step='fix_expired_lease'
--   --      and leases.lease_id = (r.target_id)::bigint;
--   -- to remove the lane entirely once done:
--   --   drop function dia_recon1_reconcile_banning_clinic(boolean, text);
--   --   drop function dia_recon1_lease_active_past_expiration_guard();
--   --   drop trigger trg_dia_recon1_lease_active_guard on leases;
--   --   drop table dia_recon1_run_log;

-- ── 1. The run ledger. One row per write this reconciliation performs. ──────
create table if not exists dia_recon1_run_log (
  id           bigserial primary key,
  batch_tag    text        not null,
  step         text        not null,
  target_table text,
  target_id   text,
  action       text        not null,
  prior_value  jsonb,
  new_value    jsonb,
  backup_id    bigint,
  note         text,
  dry_run      boolean     not null default true,
  created_at   timestamptz not null default now()
);

comment on table dia_recon1_run_log is
  'RECON1: one row per write performed while reconciling the DaVita Banning '
  'clinic (properties 29894/35786/51228) and any later invocation against the '
  'same rule set. Every UPDATE captures prior_value so it can be reversed by '
  'hand; every merge captures backup_id for dia_unmerge_property().';

-- ── 2. General fix: a lease cannot be BOTH active AND past its own expiration.
--    (This is Part-3 rule R5's deterministic half, shipped now because the
--    Banning clinic's lease 23211 is a live instance and a bare UPDATE would
--    regress the moment the same writer runs again.) ────────────────────────
create or replace function dia_recon1_lease_active_past_expiration_guard()
returns trigger
language plpgsql
as $$
begin
  if new.is_active = true
     and new.lease_expiration is not null
     and new.lease_expiration < current_date
     and new.status is distinct from 'holdover'
  then
    new.is_active := false;
  end if;
  return new;
end;
$$;

comment on function dia_recon1_lease_active_past_expiration_guard() is
  'RECON1/R5: is_active can never be TRUE past lease_expiration unless the '
  'row is explicitly flagged status=holdover (a real month-to-month tenancy '
  'after firm term, not a data error). Fill-forward guard, never destructive '
  '- it only flips is_active, it never touches rent/term/tenant.';

drop trigger if exists trg_dia_recon1_lease_active_guard on leases;
create trigger trg_dia_recon1_lease_active_guard
  before insert or update of is_active, lease_expiration, status on leases
  for each row
  execute function dia_recon1_lease_active_past_expiration_guard();

-- ── 3. The one-clinic reconciliation. Dry-run default. ──────────────────────
create or replace function dia_recon1_reconcile_banning_clinic(
  p_dry_run  boolean default true,
  p_batch_tag text   default null
)
returns table (
  step        text,
  action      text,
  target_table text,
  target_id   text,
  detail      text
)
language plpgsql
as $$
declare
  v_batch          text := coalesce(p_batch_tag, 'recon1_banning_' || to_char(now(), 'YYYYMMDD_HH24MISS'));
  v_survivor        integer := 29894;
  v_shell_om        integer := 35786;
  v_shell_costar    integer := 51228;
  v_sale_2026       bigint := 15042;
  v_broker_id       bigint := 1373; -- Scott Briggs, verified live: brokers.broker_id=1373
  v_backup_om       bigint;
  v_backup_costar   bigint;
  v_row             record;
  v_prior           jsonb;
  v_rowcount        int;
begin
  -- Guard: refuse if the survivor is not found / already merged away since
  -- this was written — never blind-apply against drifted ids.
  if not exists (select 1 from properties where property_id = v_survivor and merged_into_property_id is null) then
    return query select 'preflight', 'abort', 'properties', v_survivor::text,
      'survivor property not found or already merged away — nothing applied';
    return;
  end if;

  -- 3.1 Merge the two address-shell duplicates into the survivor, via the
  --     existing ledgered/reversible merge path only. Idempotent: the merge
  --     is only attempted while the shell row still exists and is unmerged.
  if exists (select 1 from properties where property_id = v_shell_om and merged_into_property_id is null) then
    return query select 'merge', case when p_dry_run then 'dry_run' else 'apply' end,
      'properties', v_shell_om::text, 'fold 6050 W Ramsey St (OM intake shell) into 29894';
    if not p_dry_run then
      select dia_merge_property_reversible(v_survivor, v_shell_om, v_batch) into v_backup_om;
      insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, backup_id, dry_run)
        values (v_batch, 'merge', 'properties', v_shell_om::text, 'dia_merge_property_reversible', v_backup_om, false);
    end if;
  end if;

  if exists (select 1 from properties where property_id = v_shell_costar and merged_into_property_id is null) then
    return query select 'merge', case when p_dry_run then 'dry_run' else 'apply' end,
      'properties', v_shell_costar::text, 'fold 6090 W Ramsey St (CoStar shell) into 29894';
    if not p_dry_run then
      select dia_merge_property_reversible(v_survivor, v_shell_costar, v_batch) into v_backup_costar;
      insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, backup_id, dry_run)
        values (v_batch, 'merge', 'properties', v_shell_costar::text, 'dia_merge_property_reversible', v_backup_costar, false);
    end if;
  end if;

  -- 3.2 SAFETY NET: close any listing on the survivor that is STILL active
  --     and is not the listing that recorded the sale itself. In practice
  --     (verified live 2026-09-17) dia_merge_property's own collision/fold
  --     handling already closes a repointed shell listing that collides with
  --     an existing sold/superseded one on the survivor — this loop exists
  --     for the case where no such collision fires (e.g. the survivor had no
  --     competing listing row to fold against). Valid vocab only:
  --     status='superseded', off_market_reason='sold' (no 'superseded_by_sale'
  --     value exists in this DB's CHECK constraint).
  for v_row in
    select listing_id, status, off_market_date, off_market_reason
    from available_listings
    where property_id = v_survivor
      and is_active = true
      and listing_id <> 14798
  loop
    v_prior := to_jsonb(v_row);
    return query select 'close_listing', case when p_dry_run then 'dry_run' else 'apply' end,
      'available_listings', v_row.listing_id::text,
      'set status=superseded, off_market_reason=sold, sale_transaction_id=' || v_sale_2026 || ', off_market_date=2026-09-14';
    if not p_dry_run then
      update available_listings
         set is_active = false,
             status = 'superseded',
             off_market_reason = 'sold',
             off_market_date = date '2026-09-14',
             sale_transaction_id = v_sale_2026
       where listing_id = v_row.listing_id;
      insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, prior_value, dry_run)
        values (v_batch, 'close_listing', 'available_listings', v_row.listing_id::text, 'superseded/sold', v_prior, false);
    end if;
  end loop;

  -- 3.3 Correct the 2024-12-05 listing (id 9499): it reads status='sold' with
  --     NO sold_date and NO sale_transaction_id. It was relisted (a new
  --     listing row, 14798, later captured the real sale), so the correct
  --     terminal status is withdrawn/withdrawn, not sold.
  select to_jsonb(al) into v_prior from available_listings al where listing_id = 9499;
  if v_prior is not null and (v_prior->>'status') = 'sold' and (v_prior->>'sale_transaction_id') is null then
    return query select 'fix_false_sold', case when p_dry_run then 'dry_run' else 'apply' end,
      'available_listings', '9499', 'status sold -> withdrawn, off_market_reason -> withdrawn (no sold_date/sale_transaction_id, was relisted)';
    if not p_dry_run then
      update available_listings
         set status = 'withdrawn',
             off_market_reason = 'withdrawn'
       where listing_id = 9499;
      insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, prior_value, dry_run)
        values (v_batch, 'fix_false_sold', 'available_listings', '9499', 'status->withdrawn', v_prior, false);
    end if;
  end if;

  -- 3.4 Deactivate the expired-but-active lease (23211). The trigger added in
  --     section 2 keeps this from recurring; this is the one-time fix for
  --     the row that already existed.
  select to_jsonb(l) into v_prior from leases l where lease_id = 23211;
  if v_prior is not null and (v_prior->>'is_active')::boolean = true then
    return query select 'fix_expired_lease', case when p_dry_run then 'dry_run' else 'apply' end,
      'leases', '23211', 'is_active true -> false (expired 2018-07-13)';
    if not p_dry_run then
      update leases set is_active = false where lease_id = 23211;
      insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, prior_value, dry_run)
        values (v_batch, 'fix_expired_lease', 'leases', '23211', 'is_active->false', v_prior, false);
    end if;
  end if;

  -- 3.5 Set the 2026-09-14 sale's broker attribution from the closing
  --     listing's listing_broker_id (already Scott Briggs / broker_id 1373,
  --     verified live: brokers.broker_id=1373 -> company 'scott briggs',
  --     broker_company_id 126). Fill-blanks only.
  select to_jsonb(st) into v_prior from sales_transactions st where sale_id = v_sale_2026;
  if v_prior is not null and (v_prior->>'listing_broker_id') is null then
    return query select 'set_attribution', case when p_dry_run then 'dry_run' else 'apply' end,
      'sales_transactions', v_sale_2026::text, 'listing_broker_id -> ' || v_broker_id || ' (Scott Briggs, from closing listing 14798)';
    if not p_dry_run then
      update sales_transactions
         set listing_broker_id = v_broker_id
       where sale_id = v_sale_2026;
      insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, prior_value, dry_run)
        values (v_batch, 'set_attribution', 'sales_transactions', v_sale_2026::text, 'listing_broker_id set', v_prior, false);
    end if;
  end if;

  -- 3.6 Record buyer/seller on the 2026-09-14 sale as an EXPLICIT "not on
  --     file" (never a guess), and open a pending_updates task to pull the
  --     deed. Fill-blanks: only when both are still NULL.
  select to_jsonb(st) into v_prior from sales_transactions st where sale_id = v_sale_2026;
  if v_prior is not null
     and (v_prior->>'buyer_name') is null
     and (v_prior->>'seller_name') is null then
    return query select 'record_not_on_file', case when p_dry_run then 'dry_run' else 'apply' end,
      'sales_transactions', v_sale_2026::text, 'buyer_name/seller_name -> "Not on file (pending deed)" + pending_updates task';
    if not p_dry_run then
      update sales_transactions
         set buyer_name = 'Not on file (pending deed)',
             seller_name = 'Not on file (pending deed)'
       where sale_id = v_sale_2026;
      insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, prior_value, dry_run)
        values (v_batch, 'record_not_on_file', 'sales_transactions', v_sale_2026::text, 'buyer/seller stamped not-on-file', v_prior, false);
      begin
        insert into pending_updates (table_name, field_name, action, reason, entity, payload, file_name, status)
        values (
          'sales_transactions', 'buyer_name/seller_name', 'research_needed',
          'Sale 15042 (2026-09-14, $4,180,180, DaVita Banning) has no recorded '
          'buyer/seller — pull the recorded deed to fill in.',
          'sale:' || v_sale_2026,
          jsonb_build_object('sale_id', v_sale_2026, 'property_id', v_survivor, 'sale_date', '2026-09-14'),
          'recon1_banning_deed_pull',
          'pending'
        );
      exception when others then
        -- pending_updates NOT NULL/shape drift must never abort the sale
        -- update above — the honest marker on the row is the load-bearing
        -- part; the task is best-effort.
        insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, note, dry_run)
          values (v_batch, 'record_not_on_file', 'pending_updates', v_sale_2026::text, 'task_insert_failed', sqlerrm, false);
      end;
    end if;
  end if;

  -- 3.7 Owner spelling-variant fold: recorded_owners 807949a9 ('DaVita
  --     HealthCare Partners') and the deed grantee text "Davita Healthcare
  --     Prtnrs" already share normalized_name = 'davita healthcare prtnrs' —
  --     there is no second owner row to merge. What may be stale is any
  --     pending/flagged CONFLICT comparing the deed's raw grantee text
  --     against the owner's display name. Clear it via a resolution note,
  --     never a guessed rename, and never touch a value a human curated.
  if not p_dry_run then
    update pending_updates
       set status = 'resolved',
           payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
             'recon1_resolution', 'name variant of same normalized owner (davita healthcare prtnrs); not a conflict'
           )
     where status = 'pending'
       and table_name in ('recorded_owners', 'properties')
       and (reason ilike '%deed_newer_stale%' or reason ilike '%owner conflict%' or reason ilike '%davita healthcare%')
       and (entity ilike '%29894%' or entity ilike '%807949a9%' or payload::text ilike '%prtnrs%');
    get diagnostics v_rowcount = row_count;
    if v_rowcount > 0 then
      insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, dry_run)
        values (v_batch, 'clear_owner_conflict', 'pending_updates', 'davita_variant', 'resolved ' || v_rowcount || ' as name-variant, not a conflict', false);
    end if;
  else
    return query select 'clear_owner_conflict', 'dry_run', 'pending_updates', 'davita_variant',
      'would resolve any pending deed_newer_stale/owner-conflict rows referencing the davita healthcare prtnrs variant';
  end if;

  return query select 'summary', case when p_dry_run then 'dry_run_complete' else 'applied' end,
    'batch', v_batch, 'see dia_recon1_run_log where batch_tag = ''' || v_batch || '''';
end;
$$;

comment on function dia_recon1_reconcile_banning_clinic(boolean, text) is
  'RECON1: dry-run-default, idempotent reconciliation of the DaVita Banning '
  'clinic (properties 29894/35786/51228). Call with p_dry_run=>false to '
  'apply. Every write is logged to dia_recon1_run_log with its prior value '
  'for manual reversal; property merges go through dia_merge_property_reversible '
  '(reverse via dia_unmerge_property(backup_id)). Already applied live '
  '2026-09-17, batch_tag=recon1_banning_apply1 — safe to re-run (idempotent, '
  'all steps guard on the prior state before writing).';
