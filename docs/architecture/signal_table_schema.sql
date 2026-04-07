-- =============================================================================
-- LCC Signal Table Schema
-- Owner: Team Briggs / NorthMarq
-- Date: 2026-04-06
-- Purpose: Captures every system event, user decision, and outcome signal
--          that feeds the self-learning loop. This is the foundation for
--          scoring calibration, classification tuning, and recommendation
--          improvement over time.
-- =============================================================================

-- =============================================================================
-- CORE SIGNAL TABLE
-- Every meaningful event in the system writes a row here.
-- =============================================================================

create table signals (
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
create index idx_signals_type       on signals(signal_type);
create index idx_signals_entity     on signals(entity_id, entity_type);
create index idx_signals_user       on signals(user_id, created_at desc);
create index idx_signals_domain     on signals(domain, created_at desc);
create index idx_signals_outcome    on signals(outcome) where outcome is not null;
create index idx_signals_category   on signals(signal_category, created_at desc);
create index idx_signals_pending    on signals(outcome) where outcome = 'pending';


-- =============================================================================
-- PAYLOAD SCHEMAS (documentation — stored as jsonb in signals.payload)
-- =============================================================================

-- signal_type: triage_decision
-- {
--   "inbox_item_id": "uuid",
--   "ai_classification": "strategic | important | urgent | ignore",
--   "ai_confidence": 0.0-1.0,
--   "user_classification": "strategic | important | urgent | ignore",
--   "overridden": true/false,
--   "subject_snippet": "first 60 chars of email subject",
--   "sender_domain": "string"
-- }

-- signal_type: recommendation_acted_on / recommendation_ignored / recommendation_deferred
-- {
--   "recommendation_id": "uuid",
--   "recommendation_type": "touchpoint | om_follow_up | pursuit | research | deal_action",
--   "priority_rank_shown": "integer (position in queue when user acted)",
--   "time_to_action_seconds": "integer",
--   "action_taken": "string (call | email | draft | view | create_pursuit | skip)"
-- }

-- signal_type: template_sent / template_edited
-- {
--   "template_id": "string",
--   "template_version": "integer",
--   "edit_distance_pct": 0.0-1.0,
--   "subject_line_changed": true/false,
--   "packet_type_used": "string",
--   "packet_id": "uuid",
--   "recipient_count": "integer"
-- }

-- signal_type: template_response / contact_response
-- {
--   "template_id": "string (if response to a template)",
--   "response_latency_hours": "float",
--   "response_sentiment": "positive | neutral | negative | unknown",
--   "response_action": "requested_bov | requested_om | requested_call | no_action | unsubscribe",
--   "deal_created": true/false
-- }

-- signal_type: deal_completed
-- {
--   "outcome": "closed_won | closed_lost | withdrawn",
--   "list_price": "number",
--   "sale_price": "number",
--   "days_on_market": "integer",
--   "days_from_first_touch_to_listing": "integer",
--   "days_from_listing_to_close": "integer",
--   "total_touchpoints_to_listing": "integer",
--   "buyer_found_via": "early_look | full_launch | broker_network | repeat_buyer | inbound"
-- }

-- signal_type: pursuit_converted / pursuit_dead
-- {
--   "days_in_pursuit": "integer",
--   "total_touchpoints": "integer",
--   "touchpoints_to_conversion": "integer",
--   "trigger_type": "lease_expiry | ownership_change | patient_growth | inbound | referral",
--   "death_reason": "no_response | sold_to_other_broker | not_selling | price_gap | other"
-- }

-- signal_type: classification_override
-- {
--   "original_classification": "string",
--   "corrected_classification": "string",
--   "entity_type": "string",
--   "classifier_version": "string",
--   "reason": "string (optional)"
-- }

-- signal_type: packet_assembled
-- {
--   "packet_type": "string",
--   "token_count": "integer",
--   "assembly_duration_ms": "integer",
--   "cache_hit": true/false,
--   "sources_queried": ["gov_db | dia_db | lcc_db | salesforce | graph_api"],
--   "fields_missing": ["string (any mandatory fields that were absent)"]
-- }


-- =============================================================================
-- SCORING CALIBRATION TABLE
-- Tracks how well the strategic scoring engine is predicting user behavior.
-- Populated by a nightly job comparing recommendations to actions.
-- =============================================================================

create table scoring_calibration (
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

create index idx_calibration_date on scoring_calibration(calibration_date desc);
create index idx_calibration_user on scoring_calibration(user_id, calibration_date desc);


-- =============================================================================
-- CONTACT ENGAGEMENT MODEL TABLE
-- Per-contact engagement signals aggregated for scoring.
-- Updated after every touchpoint, response, or deal event.
-- =============================================================================

create table contact_engagement (
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

create unique index idx_engagement_contact on contact_engagement(contact_id);
create index idx_engagement_score on contact_engagement(engagement_score desc);
create index idx_engagement_overdue on contact_engagement(next_touch_due)
  where cadence_status in ('due', 'overdue');


-- =============================================================================
-- TEMPLATE PERFORMANCE TABLE
-- Aggregated performance per template version.
-- Updated after every send and outcome resolution.
-- =============================================================================

create table template_performance (
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

create index idx_template_perf_id on template_performance(template_id, template_version);
create index idx_template_perf_flagged on template_performance(flagged_for_review)
  where flagged_for_review = true;


-- =============================================================================
-- PIPELINE VELOCITY TABLE
-- Tracks average time in each pipeline stage by domain and deal type.
-- Seeded with historical data; updated as new deals complete.
-- Used to detect stuck pursuits and deals.
-- =============================================================================

create table pipeline_velocity (
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
-- Example seed:
insert into pipeline_velocity (domain, stage, sample_count, avg_days_in_stage, p75_days_in_stage, p90_days_in_stage, conversion_rate)
values
  ('government', 'discovery',      0,  3,   5,   7,   0.85),
  ('government', 'research',       0,  8,  14,  21,   0.75),
  ('government', 'outreach',       0, 45,  90, 180,   0.35),
  ('government', 'engaged',        0, 30,  60, 120,   0.60),
  ('government', 'proposal',       0, 14,  21,  30,   0.70),
  ('government', 'listed',         0,  3,   5,   7,   0.95),
  ('government', 'marketing',      0, 60,  90, 120,   0.80),
  ('government', 'under_contract', 0, 45,  60,  75,   0.90),
  ('dialysis',   'discovery',      0,  3,   5,   7,   0.85),
  ('dialysis',   'research',       0,  8,  14,  21,   0.75),
  ('dialysis',   'outreach',       0, 38,  75, 150,   0.38),
  ('dialysis',   'engaged',        0, 25,  50, 100,   0.62),
  ('dialysis',   'proposal',       0, 12,  18,  25,   0.72),
  ('dialysis',   'listed',         0,  3,   5,   7,   0.95),
  ('dialysis',   'marketing',      0, 45,  75,  90,   0.82),
  ('dialysis',   'under_contract', 0, 40,  55,  70,   0.91)
on conflict (domain, stage) do nothing;


-- =============================================================================
-- OUTREACH EFFECTIVENESS TABLE
-- Per-contact-type and per-market outreach pattern analysis.
-- Identifies which outreach approaches work best for which segments.
-- =============================================================================

create table outreach_effectiveness (
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

create index idx_effectiveness_segment on outreach_effectiveness(domain, contact_tier, firm_type);


-- =============================================================================
-- NIGHTLY JOBS (documentation — implemented as Supabase Edge Functions or cron)
-- =============================================================================

-- job: refresh_engagement_scores
-- Schedule: nightly 2:00 AM
-- Logic: for each contact with activity in last 90 days, recompute
--        engagement_score, response_rate, days_since_touchpoint,
--        cadence_status, next_touch_due.
--        Write result to contact_engagement table.

-- job: compute_scoring_calibration
-- Schedule: nightly 3:00 AM
-- Logic: compare yesterday's LCC priority recommendations to
--        user actions logged in signals table.
--        Compute rank correlation, precision by tier.
--        Write to scoring_calibration table.

-- job: update_template_performance
-- Schedule: nightly 3:30 AM
-- Logic: for each template_version with sends in last 90 days,
--        aggregate opens, replies, edit_distance, deal_advanced.
--        Flag any template where open_rate < 0.20 and sends > 50.
--        Write to template_performance table.

-- job: update_pipeline_velocity
-- Schedule: weekly Sunday 4:00 AM
-- Logic: for completed deals in last 12 months, compute avg/median/p75/p90
--        days per stage. Update pipeline_velocity table.
--        Only update rows with new sample data to preserve seed values.

-- job: resolve_pending_outcomes
-- Schedule: nightly 4:00 AM
-- Logic: for signals with outcome = 'pending' and created_at > 7 days ago,
--        check if a deal_stage_change or contact_response signal exists
--        for the same entity. If yes, resolve outcome. If no, mark 'neutral'
--        after 30 days.

-- job: assemble_daily_briefing_packets
-- Schedule: daily 6:00 AM
-- Logic: for each active user, assemble Daily Briefing Packet,
--        store in context_packets table, push to LCC homepage queue.
--        Also push briefing card to Microsoft Teams and Outlook digest.

-- job: flag_overdue_om_follow_ups
-- Schedule: every 4 hours during business hours
-- Logic: for each OM download where om_follow_up_completed = false
--        and download_at < now() - interval '48 hours',
--        write a signal (type: om_follow_up_missed),
--        escalate to Daily Briefing urgent queue,
--        create To Do task in Microsoft 365.
