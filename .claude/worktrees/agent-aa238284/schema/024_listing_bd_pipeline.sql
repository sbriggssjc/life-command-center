-- ============================================================================
-- 024: Listing-as-BD Pipeline Tracking
-- Life Command Center — Wave 2: Signal-driven outreach
--
-- Tracks each listing-BD pipeline execution so we can measure:
--   - How many contacts were matched per listing
--   - Conversion rate from queued → sent → replied → deal_advanced
--   - Which match reason (T-011 same asset vs T-012 geographic) performs better
--   - Which domains/states produce the best response rates
--
-- The inbox_items table already holds the individual draft candidates
-- (source_type='listing_bd_trigger'). This table tracks the pipeline run
-- itself for aggregate analytics.
-- ============================================================================

-- Pipeline run tracking
CREATE TABLE IF NOT EXISTS listing_bd_runs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  listing_entity_id UUID REFERENCES entities(id),

  -- Listing context (denormalized for analytics without joins)
  listing_name    TEXT,
  listing_state   TEXT,
  listing_city    TEXT,
  listing_domain  TEXT,               -- 'government', 'dialysis'
  asset_type      TEXT,               -- 'Dialysis', 'GSA', 'MOB', etc.

  -- SF deal context
  sf_deal_id      TEXT,               -- Salesforce deal ID
  deal_status     TEXT DEFAULT 'ELA Executed',

  -- Pipeline results
  t011_matched    INTEGER DEFAULT 0,  -- Same asset type/state contacts found
  t011_queued     INTEGER DEFAULT 0,  -- T-011 inbox items created
  t012_matched    INTEGER DEFAULT 0,  -- Geographic proximity contacts found
  t012_queued     INTEGER DEFAULT 0,  -- T-012 inbox items created
  total_queued    INTEGER DEFAULT 0,  -- Total inbox items created

  -- Outcome tracking (updated as drafts progress)
  total_sent      INTEGER DEFAULT 0,  -- Drafts actually sent by broker
  total_opened    INTEGER DEFAULT 0,  -- Emails opened (from template_sends)
  total_replied   INTEGER DEFAULT 0,  -- Emails replied to
  total_advanced  INTEGER DEFAULT 0,  -- Led to deal advancement

  -- Trigger source
  trigger_source  TEXT DEFAULT 'manual', -- 'manual', 'listing_webhook', 'scheduled'
  triggered_by    UUID,                  -- User who triggered or system user

  -- Timestamps
  created_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ,        -- When all drafts have been dispositioned

  -- Metadata
  metadata        JSONB DEFAULT '{}'::jsonb
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_listing_bd_runs_workspace
  ON listing_bd_runs(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_listing_bd_runs_entity
  ON listing_bd_runs(listing_entity_id)
  WHERE listing_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_listing_bd_runs_domain
  ON listing_bd_runs(listing_domain, listing_state);

-- Index on inbox_items for listing-BD items (query performance)
CREATE INDEX IF NOT EXISTS idx_inbox_items_listing_bd
  ON inbox_items(workspace_id, source_type, status)
  WHERE source_type = 'listing_bd_trigger';

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE listing_bd_runs IS
  'Tracks each execution of the listing-as-BD pipeline for aggregate analytics. Individual draft candidates live in inbox_items with source_type=listing_bd_trigger.';

COMMENT ON COLUMN listing_bd_runs.trigger_source IS
  'How the pipeline was triggered: manual (API call), listing_webhook (SF deal event via Power Automate), or scheduled (future cron-based trigger).';

COMMENT ON COLUMN listing_bd_runs.t011_matched IS
  'T-011: Number of contacts found who own the same asset type in the same state as the listing.';

COMMENT ON COLUMN listing_bd_runs.t012_matched IS
  'T-012: Number of contacts found whose location is geographically near the listing (same state), excluding T-011 matches.';
