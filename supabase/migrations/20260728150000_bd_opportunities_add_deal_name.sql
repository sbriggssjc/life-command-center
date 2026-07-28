-- ============================================================================
-- 20260728150000_bd_opportunities_add_deal_name.sql   (OPS project xengecqvemvfknjvbvrq)
-- A4: surface the SF Opportunity Name on the deal backbone. The sync parsed the name to resolve the
-- asset entity, then discarded it (metadata carried owner/source but never the name). Nullable column;
-- opportunity-sync.js now writes row.deal_name = b.name, so the ~30-min full-refresh backfills all rows.
-- Applied live 2026-07-28.
-- ============================================================================
alter table public.bd_opportunities add column if not exists deal_name text;
comment on column public.bd_opportunities.deal_name is 'SF Opportunity Name (e.g. "Tenant - City, State"); written by opportunity-sync.';
