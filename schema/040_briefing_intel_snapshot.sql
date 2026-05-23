-- ============================================================================
-- 040: Briefing Intel Snapshot
-- Life Command Center — daily briefing v2 (executive briefing)
--
-- Purpose:
--   The /api/briefing-email handler must render in <5s for Power Automate.
--   Fetching market data, RSS feeds, prediction markets, and a Claude
--   AI analyst summary inline would blow the 60s Vercel timeout (and
--   re-burn API tokens on every retry). This table caches a single
--   pre-built "intel snapshot" row per day.
--
--   The supabase/functions/briefing-intel-snapshot edge function writes
--   one row each morning (cron: 5:30 AM America/Chicago). The email
--   handler reads the freshest snapshot for the current as_of_date.
--
-- Workspace scope:
--   workspace_id is nullable because the snapshot is identical across
--   workspaces — market data and macro news don't change per broker.
--   A workspace-specific row would let us inject a per-vertical analyst
--   take in a later round; for now we write one global row per day.
--
-- Idempotency:
--   (as_of_date, COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'))
--   is unique so cron retries don't duplicate. ON CONFLICT DO UPDATE in
--   the edge function lets a manual re-run overwrite the row.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists briefing_intel_snapshot (
  id              uuid primary key default gen_random_uuid(),
  as_of_date      date        not null default (now() at time zone 'America/Chicago')::date,
  workspace_id    uuid        references workspaces(id) on delete cascade,
  variant         text        not null default 'daily'
                                check (variant in ('daily', 'friday_deep_dive')),
  generated_at    timestamptz not null default now(),

  -- Key Numbers strip (header band): 6 hand-picked metrics rendered
  -- as cards at the top of the email. Shape:
  --   [{ label, value, delta, delta_dir, sub }]
  key_numbers     jsonb       not null default '[]'::jsonb,

  -- Full market_data payload: indices, yields, REITs, commodities,
  -- tenant stocks (DVA, FMS, etc). Pre-formatted strings so the
  -- renderer doesn't need to know which units apply.
  --   { yields: [...], indices: [...], reits: [...], commodities: [...], tenants: [...] }
  market_data     jsonb       not null default '{}'::jsonb,

  -- Fed implied path + prediction markets, deduped to a small set.
  --   { fed: { effr_baseline, meetings: [...] }, predictions: [...] }
  fed_outlook     jsonb       not null default '{}'::jsonb,

  -- AI-generated "Analyst's Take" narrative. Plain text, 2-3 short
  -- paragraphs. Renderer wraps in styled blocks; do not store HTML.
  analyst_take    text,

  -- Capital markets sub-narrative (spreads, CMBS, REIT moves) — also
  -- plain text, AI-generated.
  capital_markets text,

  -- Sector news grouped by stream. Shape:
  --   { healthcare: [...], government: [...], net_lease: [...], tax_policy: [...] }
  -- Each item: { title, source, url, published_at, summary }
  sector_news     jsonb       not null default '{}'::jsonb,

  -- Curated long-form articles for the "What We're Reading" section.
  --   [{ title, source, url, published_at, why_it_matters }]
  reading_list    jsonb       not null default '[]'::jsonb,

  -- Friday-only weekly change table. Shape:
  --   [{ label, value, change_1d, change_5d, unit }]
  weekly_changes  jsonb       not null default '[]'::jsonb,

  -- Telemetry / provenance
  source_counts   jsonb       not null default '{}'::jsonb,
                              -- e.g. { feeds_fetched: 14, articles_kept: 32 }
  ai_model        text,
  ai_tokens_in    integer,
  ai_tokens_out   integer,
  warnings        jsonb       not null default '[]'::jsonb,

  created_at      timestamptz not null default now()
);

create unique index if not exists ux_briefing_intel_snapshot_date_workspace
  on briefing_intel_snapshot (
    as_of_date,
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists idx_briefing_intel_snapshot_generated_at
  on briefing_intel_snapshot (generated_at desc);

comment on table briefing_intel_snapshot is
  'Daily cached market + news + AI snapshot for the executive briefing email. Written by briefing-intel-snapshot edge function (cron 5:30 AM CT); read by api/_handlers/briefing-email-handler.js.';

comment on column briefing_intel_snapshot.variant is
  'daily for Mon-Thu, friday_deep_dive on Fridays (carries weekly_changes).';

comment on column briefing_intel_snapshot.workspace_id is
  'Null = global row, applies to all workspaces. Per-workspace rows reserved for a future per-vertical analyst-take variant.';
