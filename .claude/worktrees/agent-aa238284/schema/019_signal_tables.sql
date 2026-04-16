-- ============================================================================
-- 019: Signal Tables — Learning Loop Foundation
-- Life Command Center
-- ============================================================================

-- =============================================================================
-- CORE SIGNAL TABLE
-- Every meaningful event in the system writes a row here.
-- =============================================================================

create table if not exists signals (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz default now(),

  -- Signal classification
  signal_type         text not null,
  -- Enum values:
  --   triage_decision          (user classified an inbox item)
  --   recommendation_acted_on  (user clicked an LCC recommended action)
  --   recommendation_ignored   (user dismissed a recommendation)
  --   recommendation_deferred  (user postponed a recommendation)
  --   template_sent            (outreach draft was sent)
  --   template_edited          (draft was modified before send)
  --   template_response        (sent template received a reply)
  --   deal_stage_change        (deal moved to a new stage)
  --   deal_completed           (deal closed won or lost)
  --   touchpoint_logged        (call or email logged manually)
  --   pursuit_created          (new pursuit initiated)
  --   pursuit_converted        (pursuit became a listing)
  --   pursuit_dead             (pursuit marked dead)
  --   research_completed       (ownership research item resolved)
  --   om_download              (OM downloaded by a contact)
  --   om_follow_up_completed   (downloader was called/emailed within 48h)
  --   om_follow_up_missed      (downloader not contacted within 48h)
  --   classification_override  (user corrected AI classification)
  --   scoring_override         (user reordered priorities from AI suggestion)
  --   contact_response         (contact replied to outreach)
  --   contact_no_response      (outreach sent, no reply within window)
  --   packet_assembled         (context packet built — for performance tracking)
  --   packet_cache_hit         (context packet served from cache)
  --   inbound_bov_request      (seller requested a valuation)
  --   inbound_listing_inquiry  (inbound inquiry on an active listing)

  signal_category     text not null,
  -- Enum values: prospecting | deal_execution | marketing | research |
  --              intelligence | system | communication

  -- Entity linkage
  entity_type         text,
  -- Enum: contact | property | pursuit | deal | listing | research_item | packet
  entity_id           uuid,
  domain              text,
  -- Enum: government | dialysis | both | none

  -- User context
  user_id             uuid references auth.users(id),
  session_id          uuid,

  -- Signal payload (flexible per signal type)
  payload             jsonb not null default '{}',
  -- See payload schemas per signal_type below

  -- Outcome tracking (written back when outcome is known)
  outcome             text,
  -- Enum: positive | neutral | negative | unknown | pending
  outcome_detail      text,
  outcome_at          timestamptz,
  outcome_latency_days float, -- days from signal creation to outcome

  -- Model versioning (for before/after comparison)
  model_version       text,
  scoring_version     text,
  classifier_version  text,

  -- Quality flags
  is_training_sample  boolean default false,
  excluded_from_model boolean default false,
  exclusion_reason    text
);

-- Indexes for common query patterns
create index if not exists idx_signals_type       on signals(signal_type);
create index if not exists idx_signals_entity     on signals(entity_id, entity_type);
create index if not exists idx_signals_user       on signals(user_id, created_at desc);
create index if not exists idx_signals_domain     on signals(domain, created_at desc);
create index if not exists idx_signals_outcome    on signals(outcome) where outcome is not null;
create index if not exists idx_signals_category   on signals(signal_category, created_at desc);
create index if not exists idx_signals_pending    on signals(outcome) where outcome = 'pending';

alter table signals enable row level security;


-- =============================================================================
-- SCORING CALIBRATION TABLE
-- Tracks how well the strategic scoring engine is predicting user behavior.
-- Populated by a nightly job comparing recommendations to actions.
-- =============================================================================

create table if not exists scoring_calibration (
  id                  uuid primary key default gen_random_uuid(),
  calibration_date    date not null,
  scoring_version     text not null,
  user_id             uuid references auth.users(id),

  -- How often users act on items in the order the system predicted
  rank_correlation    float,  -- Spearman rank correlation, 0-1

  -- Agreement rates by category
  strategic_precision float,  -- % of items scored "strategic" that user treated as strategic
  important_precision float,
  urgent_precision    float,

  -- Override rates (high = model is wrong, needs retraining)
  override_rate_strategic float,
  override_rate_important float,
  override_rate_urgent    float,

  -- Volume
  total_recommendations   integer,
  total_acted_on          integer,
  total_ignored           integer,
  total_deferred          integer,

  notes               text
);

create index if not exists idx_calibration_date on scoring_calibration(calibration_date desc);
create index if not exists idx_calibration_user on scoring_calibration(user_id, calibration_date desc);

alter table scoring_calibration enable row level security;


-- =============================================================================
-- CONTACT ENGAGEMENT MODEL TABLE
-- Per-contact engagement signals aggregated for scoring.
-- Updated after every touchpoint, response, or deal event.
-- =============================================================================

create table if not exists contact_engagement (
  id                      uuid primary key default gen_random_uuid(),
  contact_id              uuid not null,
  updated_at              timestamptz default now(),

  -- Engagement score (0-100, composite)
  engagement_score        float,

  -- Response behavior
  total_outreach_sent     integer default 0,
  total_responses         integer default 0,
  response_rate           float,
  avg_response_latency_hours float,
  preferred_channel       text,  -- phone | email | unknown
  best_response_time      text,  -- morning | afternoon | evening | unknown

  -- Touchpoint history
  total_touchpoints       integer default 0,
  last_touchpoint_at      timestamptz,
  last_touchpoint_type    text,
  last_touchpoint_outcome text,
  days_since_touchpoint   integer,

  -- Deal signals
  deals_transacted        integer default 0,
  total_deal_volume       numeric,
  last_deal_at            timestamptz,
  last_deal_role          text,

  -- Template effectiveness for this contact
  best_performing_template_id   text,
  worst_performing_template_id  text,

  -- Cadence
  cadence_tier            text,  -- top_repeat | active | new_lead | dormant
  cadence_status          text,  -- on_track | due | overdue
  next_touch_due          date,
  touches_in_6mo_window   integer default 0,
  touches_ytd             integer default 0
);

create unique index if not exists idx_engagement_contact on contact_engagement(contact_id);
create index if not exists idx_engagement_score on contact_engagement(engagement_score desc);
create index if not exists idx_engagement_overdue on contact_engagement(next_touch_due)
  where cadence_status in ('due', 'overdue');

alter table contact_engagement enable row level security;


-- =============================================================================
-- TEMPLATE PERFORMANCE TABLE
-- Aggregated performance per template version.
-- Updated after every send and outcome resolution.
-- =============================================================================

create table if not exists template_performance (
  id                      uuid primary key default gen_random_uuid(),
  template_id             text not null,
  template_version        integer not null,
  domain                  text,  -- government | dialysis | both
  updated_at              timestamptz default now(),

  -- Volume
  total_sends             integer default 0,
  total_unique_recipients integer default 0,

  -- Engagement
  open_count              integer default 0,
  open_rate               float,
  reply_count             integer default 0,
  reply_rate              float,
  avg_reply_latency_hours float,

  -- Quality
  avg_edit_distance_pct   float,  -- 0 = always sent as-is, 1 = always rewritten
  subject_changed_pct     float,  -- how often subject line was modified

  -- Outcomes
  deal_advanced_count     integer default 0,
  deal_advanced_rate      float,
  bov_requests_generated  integer default 0,
  om_requests_generated   integer default 0,

  -- Flags
  flagged_for_review      boolean default false,
  flag_reason             text,
  deprecated              boolean default false,
  deprecated_at           timestamptz,
  superseded_by_version   integer,

  unique(template_id, template_version)
);

create index if not exists idx_template_perf_id on template_performance(template_id, template_version);
create index if not exists idx_template_perf_flagged on template_performance(flagged_for_review)
  where flagged_for_review = true;

alter table template_performance enable row level security;


-- =============================================================================
-- PIPELINE VELOCITY TABLE
-- Tracks average time in each pipeline stage by domain and deal type.
-- Seeded with historical data; updated as new deals complete.
-- Used to detect stuck pursuits and deals.
-- =============================================================================

create table if not exists pipeline_velocity (
  id                  uuid primary key default gen_random_uuid(),
  domain              text not null,  -- government | dialysis
  stage               text not null,
  -- Enum: discovery | research | outreach | engaged | proposal |
  --       listed | marketing | under_contract | closed

  -- Velocity stats
  sample_count        integer default 0,
  avg_days_in_stage   float,
  median_days_in_stage float,
  p75_days_in_stage   float,  -- 75th percentile — used as "slow" threshold
  p90_days_in_stage   float,  -- 90th percentile — used as "stuck" threshold

  -- Conversion rates
  conversion_rate     float,  -- % that advance to next stage (vs. die)
  death_rate          float,  -- % that are marked dead from this stage

  -- Seasonality (optional — populated after 12+ months of data)
  q1_avg_days         float,
  q2_avg_days         float,
  q3_avg_days         float,
  q4_avg_days         float,

  last_updated        timestamptz default now(),

  unique(domain, stage)
);

-- Seed data: manually enter historical averages on system launch.
insert into pipeline_velocity (domain, stage, sample_count, avg_days_in_stage, median_days_in_stage, p75_days_in_stage, p90_days_in_stage, conversion_rate)
values
  ('government', 'discovery',      0,  3,   3,   5,   7,   0.85),
  ('government', 'research',       0,  8,   8,  14,  21,   0.75),
  ('government', 'outreach',       0, 45,  45,  90, 180,   0.35),
  ('government', 'engaged',        0, 30,  30,  60, 120,   0.60),
  ('government', 'proposal',       0, 14,  14,  21,  30,   0.70),
  ('government', 'listed',         0,  3,   3,   5,   7,   0.95),
  ('government', 'marketing',      0, 60,  60,  90, 120,   0.80),
  ('government', 'under_contract', 0, 45,  45,  60,  75,   0.90),
  ('dialysis',   'discovery',      0,  3,   3,   5,   7,   0.85),
  ('dialysis',   'research',       0,  8,   8,  14,  21,   0.75),
  ('dialysis',   'outreach',       0, 38,  38,  75, 150,   0.38),
  ('dialysis',   'engaged',        0, 25,  25,  50, 100,   0.62),
  ('dialysis',   'proposal',       0, 12,  12,  18,  25,   0.72),
  ('dialysis',   'listed',         0,  3,   3,   5,   7,   0.95),
  ('dialysis',   'marketing',      0, 45,  45,  75,  90,   0.82),
  ('dialysis',   'under_contract', 0, 40,  40,  55,  70,   0.91)
on conflict (domain, stage) do nothing;

create index if not exists idx_pipeline_velocity_domain_stage on pipeline_velocity(domain, stage);

alter table pipeline_velocity enable row level security;


-- =============================================================================
-- OUTREACH EFFECTIVENESS TABLE
-- Per-contact-type and per-market outreach pattern analysis.
-- Identifies which outreach approaches work best for which segments.
-- =============================================================================

create table if not exists outreach_effectiveness (
  id                  uuid primary key default gen_random_uuid(),
  updated_at          timestamptz default now(),

  -- Segment dimensions
  domain              text,   -- government | dialysis
  contact_tier        text,   -- top_repeat | active | new_lead | dormant
  firm_type           text,   -- owner | buyer | broker | lender | tenant_rep
  geography_region    text,   -- optional grouping

  -- Channel performance
  email_reply_rate    float,
  call_connect_rate   float,
  call_callback_rate  float,
  best_channel        text,   -- email | phone | both

  -- Timing patterns
  best_day_of_week    text,   -- Monday-Friday
  best_time_of_day    text,   -- morning | midday | afternoon
  avg_touches_to_response float,

  -- Content patterns
  best_template_category text,
  market_data_lifts_response boolean,
  listing_mention_lifts_response boolean,

  sample_count        integer default 0
);

create index if not exists idx_effectiveness_segment on outreach_effectiveness(domain, contact_tier, firm_type);

alter table outreach_effectiveness enable row level security;
