-- RECON1-b (Cowork round 30, 2026-09-17). Dialysis_DB (zqzrriwuavgrquhisnoa).
-- APPLIED LIVE 2026-09-17 via Supabase MCP, this text verbatim.
--
-- R3 amendment — never store a "not on file" sentinel string in a party-name
-- column. RECON1's own migration violated the rule it was writing: it
-- stamped sales_transactions.buyer_name/seller_name =
-- 'Not on file (pending deed)' for sale 15042 (DaVita Banning). That is not
-- the honest value — it is text inside a column every downstream reader
-- (rent roll, comps export, client exhibit) expects to be a real name.
--
-- Fix: buyer_name/seller_name stay NULL; two new boolean columns
-- (buyer_name_pending_deed / seller_name_pending_deed) carry the "we don't
-- know yet" fact explicitly, alongside the pending_updates task link
-- (entity='sale:<sale_id>'). A CHECK constraint refuses the sentinel
-- pattern fleet-wide going forward.
--
-- Applying the CHECK found a SECOND pre-existing violation not related to
-- RECON1: sale 5974, buyer_name='TBD (buyer unknown)' — same class, fixed
-- the same way.
--
-- REVERSAL RUNBOOK:
--   alter table sales_transactions drop constraint
--     chk_sales_transactions_no_sentinel_party_names;
--   update sales_transactions set buyer_name='Not on file (pending deed)',
--     seller_name='Not on file (pending deed)' where sale_id=15042;
--   update sales_transactions set buyer_name='TBD (buyer unknown)'
--     where sale_id=5974;
--   alter table sales_transactions drop column buyer_name_pending_deed,
--     drop column seller_name_pending_deed;

alter table sales_transactions add column if not exists buyer_name_pending_deed boolean not null default false;
alter table sales_transactions add column if not exists seller_name_pending_deed boolean not null default false;

comment on column sales_transactions.buyer_name_pending_deed is
  'RECON1-b/R3: true when buyer_name is unknown pending a deed pull. '
  'buyer_name stays NULL — never a sentinel string. See pending_updates '
  'entity=''sale:<sale_id>'' for the research task.';
comment on column sales_transactions.seller_name_pending_deed is
  'RECON1-b/R3: true when seller_name is unknown pending a deed pull. '
  'seller_name stays NULL — never a sentinel string.';

update sales_transactions
   set buyer_name = null, buyer_name_pending_deed = true
 where sale_id = 15042 and buyer_name ~* '(not on file|pending deed)';
update sales_transactions
   set seller_name = null, seller_name_pending_deed = true
 where sale_id = 15042 and seller_name ~* '(not on file|pending deed)';

update sales_transactions
   set buyer_name = null, buyer_name_pending_deed = true
 where sale_id = 5974 and buyer_name ~* '(unknown|\btbd\b)';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'sales_transactions'::regclass
      and conname = 'chk_sales_transactions_no_sentinel_party_names'
  ) then
    alter table sales_transactions add constraint chk_sales_transactions_no_sentinel_party_names
      check (
        (buyer_name is null or buyer_name !~* '(not on file|pending deed|\bunknown\b|\btbd\b)')
        and (seller_name is null or seller_name !~* '(not on file|pending deed|\bunknown\b|\btbd\b)')
      );
  end if;
end $$;
