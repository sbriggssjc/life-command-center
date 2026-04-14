-- ============================================================================
-- 036: Capital Markets Reports Registry
-- Life Command Center
-- ============================================================================
-- Tracks the latest version of each domain's quarterly capital markets report.
-- The template enrichment engine reads this table to inject the correct
-- report_url and report_label into outbound email templates (T-001, T-002,
-- T-003, T-013). One active row per domain at any time.
--
-- Future: pg_cron job generates new reports quarterly from domain databases,
-- uploads PDF, and inserts a new row here. Old rows are kept for history.
-- ============================================================================

create table if not exists capital_markets_reports (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz default now(),

  -- Domain this report covers
  domain            text not null,              -- 'government' | 'dialysis'

  -- Report identification
  report_quarter    text not null,              -- e.g. 'Q2 2024', 'Q4 2025'
  report_title      text not null,              -- display title
  report_filename   text,                       -- original filename

  -- Access URLs (at least one should be set)
  public_url        text,                       -- publicly accessible URL (Vercel static, CDN, etc.)
  sharepoint_url    text,                       -- OneDrive/SharePoint sharing link
  vercel_path       text,                       -- relative path in /public/reports/

  -- Report metadata (for auto-generation roadmap)
  page_count        integer,
  data_ending_date  date,                       -- "data ending June 30, 2024"
  key_stats         jsonb,                      -- cached headline stats for template use

  -- Status
  is_active         boolean not null default true,  -- only one active per domain
  published_at      timestamptz,
  published_by      text,                       -- user who published

  -- Source tracking (for auto-generation)
  generation_mode   text default 'manual',      -- 'manual' | 'semi_auto' | 'auto'
  source_query_log  jsonb                       -- queries used to generate (future)
);

-- Only one active report per domain
create unique index if not exists uq_active_report_per_domain
  on capital_markets_reports (domain) where is_active = true;

-- Quick lookups
create index if not exists idx_cmr_domain on capital_markets_reports(domain);
create index if not exists idx_cmr_active on capital_markets_reports(is_active) where is_active = true;

-- RLS
alter table capital_markets_reports enable row level security;

-- ── Seed current reports ──────────────────────────────────────────────────

INSERT INTO capital_markets_reports (
  domain, report_quarter, report_title, report_filename,
  page_count, data_ending_date, is_active, published_at, generation_mode,
  key_stats
) VALUES (
  'government',
  'Q2 2024',
  'State of the Government-Leased Market',
  'State of the Government-Leased Market (2024-Q2).pdf',
  42,
  '2024-06-30',
  true,
  '2024-07-15T00:00:00Z',
  'manual',
  '{"total_transactions_5yr": 804, "total_volume_5yr": "$4.89B", "gov_sales_volume": "$1.51B", "scott_career_deals": 475, "scott_career_volume": "$3.45B", "sections": ["Capital Markets", "Leasing Trends", "About Northmarq"]}'
), (
  'dialysis',
  'Q4 2025',
  'The Dialysis Market Filter',
  'The Dialysis Market Filter (4Q-2025).pdf',
  44,
  '2025-12-31',
  true,
  '2026-01-15T00:00:00Z',
  'manual',
  '{"healthcare_transactions": 810, "healthcare_volume": "$4.37B", "dialysis_sales": 270, "northmarq_cap_rate": "6.70%", "market_cap_rate": "7.33%", "pricing_advantage": "$265,788", "pricing_uplift_pct": "10%", "sections": ["Capital Markets", "Dialysis Market", "About Northmarq"]}'
)
ON CONFLICT DO NOTHING;
