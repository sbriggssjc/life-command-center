-- ============================================================================
-- Migration 022: Template Definitions Registry
-- Life Command Center — Wave 1: Template Library Foundation
--
-- Stores versioned email template definitions with packet bindings,
-- variable declarations, and performance targets. Seeds with initial
-- templates from template_library_spec.md.
-- ============================================================================

CREATE TABLE IF NOT EXISTS template_definitions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id     text NOT NULL,                        -- e.g., 'T-001'
  template_version integer NOT NULL DEFAULT 1,
  category        text NOT NULL,                        -- 'seller_bd', 'buyer_bd', 'listing_marketing', etc.
  name            text NOT NULL,                        -- human-readable name
  description     text,
  domain          text,                                 -- 'government', 'dialysis', or NULL for universal
  packet_bindings text[] NOT NULL DEFAULT '{}',         -- which packet types are required
  mandatory_variables text[] NOT NULL DEFAULT '{}',     -- dot-path variable names that MUST be resolved
  optional_variables  text[] NOT NULL DEFAULT '{}',     -- dot-path variable names that MAY be resolved
  subject_template text NOT NULL,                       -- Handlebars-style subject line
  body_template    text NOT NULL,                       -- Handlebars-style body
  tone_notes       text,                                -- guidance for AI refinement
  performance_targets jsonb DEFAULT '{}',               -- { open_rate_target, response_rate_target, etc. }
  deprecated       boolean NOT NULL DEFAULT false,
  deprecated_at    timestamptz,
  superseded_by    integer,                             -- template_version that replaces this one
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE(template_id, template_version)
);

-- Index for fast lookup by template_id (most common query)
CREATE INDEX IF NOT EXISTS idx_template_definitions_template_id
  ON template_definitions(template_id);

-- Index for active (non-deprecated) templates
CREATE INDEX IF NOT EXISTS idx_template_definitions_active
  ON template_definitions(deprecated) WHERE deprecated = false;

ALTER TABLE template_definitions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Seed: T-001 First Touch
-- ============================================================================
INSERT INTO template_definitions (template_id, template_version, category, name, description, domain, packet_bindings, mandatory_variables, optional_variables, subject_template, body_template, tone_notes, performance_targets)
VALUES (
  'T-001', 1, 'seller_bd', 'First Touch',
  'Initial outreach to a net new owner/developer identified through research. No prior relationship.',
  NULL,
  ARRAY['contact', 'property'],
  ARRAY['contact.full_name', 'contact.firm', 'property.city_state', 'property.domain', 'suggested_outreach.suggested_angle'],
  ARRAY['property.name', 'property.tenant', 'property.lease_expiration', 'contact.geography'],
  '{{property.city_state}} {{property.domain}} Market — {{contact.firm}}',
  E'{{contact.full_name}},\n\n{{suggested_outreach.suggested_angle}}\n\nWe specialize exclusively in {{property.domain}} net lease investment sales and have significant recent activity in this sector. Our market activity gives us direct insight into the buyer demand and pricing dynamics currently driving this space.\n\n{{#if property.name}}Given the lease profile on {{property.name}}, we''d welcome the opportunity to share a current market perspective.\n\n{{/if}}I''d appreciate a few minutes at your convenience.\n\nBest regards,\nScott Briggs',
  'Professional but direct. Avoid jargon. Reference specific market activity to establish credibility.',
  '{"open_rate_target": 0.35, "response_rate_target": 0.05}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;

-- ============================================================================
-- Seed: T-002 Cadence Follow-Up
-- ============================================================================
INSERT INTO template_definitions (template_id, template_version, category, name, description, domain, packet_bindings, mandatory_variables, optional_variables, subject_template, body_template, tone_notes, performance_targets)
VALUES (
  'T-002', 1, 'seller_bd', 'Cadence Follow-Up',
  'Maintain presence with a known but not-yet-engaged owner. Low friction, high value delivery.',
  NULL,
  ARRAY['contact', 'property'],
  ARRAY['contact.full_name', 'touch_number', 'value_delivery'],
  ARRAY['relationship.last_touchpoint.outcome', 'inventory_matches', 'comp_highlights'],
  '{{property.city_state}} {{property.domain}} Update',
  E'{{contact.full_name}},\n\n{{value_delivery}}\n\n{{#if comp_highlights}}We recently closed a comparable transaction that may be relevant context for your portfolio.\n\n{{/if}}Happy to share a more detailed picture at your convenience.\n\nBest regards,\nScott Briggs',
  'Low pressure. Deliver value first — market data, comp info, or relevant listing.',
  '{"open_rate_target": 0.40, "response_rate_target": 0.08}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;

-- ============================================================================
-- Seed: T-004 Listing Announcement
-- ============================================================================
INSERT INTO template_definitions (template_id, template_version, category, name, description, domain, packet_bindings, mandatory_variables, optional_variables, subject_template, body_template, tone_notes, performance_targets)
VALUES (
  'T-004', 1, 'buyer_bd', 'Listing Announcement',
  'Announce a new exclusive listing to qualified buyer contacts.',
  NULL,
  ARRAY['listing_marketing', 'contact'],
  ARRAY['listing.name', 'listing.domain', 'listing.list_price', 'listing.cap_rate', 'listing.property_summary', 'listing.tenant', 'listing.remaining_lease_term'],
  ARRAY['contact.asset_preferences.geographies', 'deal_history.last_deal'],
  'New Exclusive: {{listing.tenant}} | {{listing.city_state}} | {{listing.cap_rate}}% Cap Rate',
  E'{{contact.full_name}},\n\n{{#if contact.asset_preferences}}Given your activity in {{contact.asset_preferences.geographies}}, {{/if}}we are pleased to offer on an exclusive basis:\n\n{{listing.property_summary}}\n\nAsking Price: {{listing.list_price}}\nCap Rate: {{listing.cap_rate}}%\nLease Term Remaining: {{listing.remaining_lease_term}}\n\nOM and financial details available upon request.\n\nBest regards,\nScott Briggs',
  'Professional. Highlight key deal metrics upfront. Lead with buyer relevance if preferences are known.',
  '{"open_rate_target": 0.50, "om_request_rate_target": 0.15}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;

-- ============================================================================
-- Seed: T-006 OM Download Follow-Up
-- ============================================================================
INSERT INTO template_definitions (template_id, template_version, category, name, description, domain, packet_bindings, mandatory_variables, optional_variables, subject_template, body_template, tone_notes, performance_targets)
VALUES (
  'T-006', 1, 'buyer_bd', 'OM Download Follow-Up',
  'Follow up with buyers who downloaded the OM to gauge interest and move toward offers.',
  NULL,
  ARRAY['listing_marketing', 'contact'],
  ARRAY['contact.full_name', 'listing.name', 'listing.cap_rate', 'listing.list_price'],
  ARRAY['om_download_date'],
  'RE: {{listing.name}} — Questions?',
  E'{{contact.full_name}},\n\nI wanted to follow up — I saw you had a chance to review the materials on {{listing.name}}. Happy to walk you through the deal, share any additional detail, or discuss the market if helpful.\n\nBest regards,\nScott Briggs',
  'Warm but brief. They already engaged — keep it easy to respond.',
  '{"response_rate_target": 0.20, "offer_rate_target": 0.05}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;
