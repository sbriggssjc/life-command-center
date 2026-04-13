-- ============================================================================
-- Migration 030: Template Body Updates — Phase 3: Enhanced Northmarq Voice
-- Life Command Center — Scott Briggs / Team Briggs
--
-- Purpose: Refine T-001, T-002, T-003, T-013 bodies based on Scott's
-- actual Outlook templates (.oft files) and touchpoint cadence spec.
--
-- Key Enhancements:
-- - More generous comp highlights inclusion (3–4 recent sales)
-- - Explicit team credentials with domain-specific summary variable
-- - Stronger BOV offer language with detailed benefit description
-- - Adjusted subject lines for clarity and consistency
-- - Tone refinement: warm, generous, value-first, never pushy
-- - All templates now reference Northmarq (not Stan Johnson Company)
-- - Domain-specific credentials blocks for government vs. dialysis
-- - Complimentary offer language standardized
--
-- New Variables Introduced:
-- - {{team.credentials_summary}}: Dynamic domain-specific track record
-- - {{comp_highlights}}: Multi-row format with transaction details
-- - {{quarter_year}}: Formatted quarter-year label (e.g., "Q1 2026")
-- - {{suggested_outreach.suggested_angle}}: Context-specific hook
-- - {{team.signature}}: Includes contact info + optional team details
--
-- Version History:
-- - v1 (023): First pass with Scott's voice patterns
-- - v2 (023): Refinement with track record variables
-- - v3 (027): Enhanced comp highlights, team credentials, domain customization
--
-- ============================================================================

-- Mark v2 templates as superseded (T-001, T-002, T-003 go v2→v3)
UPDATE template_definitions
SET deprecated = true, deprecated_at = now(), superseded_by = 3
WHERE template_id IN ('T-001', 'T-002', 'T-003')
  AND template_version = 2;

-- T-013 goes v1→v2 (it was only at v1 previously)
UPDATE template_definitions
SET deprecated = true, deprecated_at = now(), superseded_by = 2
WHERE template_id = 'T-013'
  AND template_version = 1;

-- ============================================================================
-- T-001 v3: First Touch — Enhanced Northmarq Voice
-- ============================================================================
-- Subject: Cleaner, more direct positioning
-- Body: Restructured for stronger comp highlights, more generous BOV offer
-- Variables: Added {{team.credentials_summary}}, refined comp_highlights
-- ============================================================================
INSERT INTO template_definitions (
  template_id, template_version, category, name, description, domain,
  packet_bindings, mandatory_variables, optional_variables,
  subject_template, body_template, tone_notes, performance_targets
)
VALUES (
  'T-001', 3, 'seller_bd', 'First Touch',
  'Initial outreach to net new owner identified through research. Anchored to specific property. Value-first: capital markets report + generous comp highlights + complimentary BOV offer.',
  NULL,
  ARRAY['contact', 'property'],
  ARRAY['contact.full_name', 'property.tenant', 'property.city_state', 'property.domain'],
  ARRAY['contact.firm', 'property.name', 'property.lease_expiration', 'team.credentials_summary', 'comp_highlights', 'team.signature'],
  -- Subject: Direct, property-anchored, domain-aware
  '{{property.city_state}} {{#if property.domain}}{{property.domain}}{{else}}Net Lease{{/if}} — Northmarq',
  -- Body: Warm opening → context hook → value delivery → credentials → BOV offer → comps → signature
  E'{{contact.full_name}},\n\nGood morning. Given your ownership of the {{property.tenant}}-leased property in {{property.city_state}}, I thought you might have some interest in reviewing our latest capital markets update report for the {{#if property.domain}}{{property.domain}}-leased{{else}}net lease{{/if}} investment sales sector.\n\nI run a team of professionals at Northmarq that focuses on the sale of {{#if property.domain}}{{property.domain}}-leased{{else}}net lease{{/if}} assets nationwide. Our market activity and deal flow give us direct insight into the buyer demand and pricing dynamics currently driving this space.\n\nPlease see attached our quarterly capital markets update. This is a report that my team maintains daily and updates quarterly, aimed at tracking the trends and trades from a broad perspective in the {{#if property.domain}}{{property.domain}}-leased{{else}}net lease{{/if}} investment sales sector. The pages included are intended to provide real-time value to you and your investment portfolio, as well as insight into the level of service and quality of work our team can provide.\n\n{{#if team.credentials_summary}}{{team.credentials_summary}}\n\n{{/if}}I would like to volunteer our opinion on valuation of any of your projects — completely complimentary and confidential. We often prepare a valuation analysis and disposition proposal for clients that will include a specific trade price range and target ask price, a detailed marketing strategy and disposition plan aimed at maximizing ownership value and net proceeds, and additional details about our competitive edge and value proposition.\n\n{{#if comp_highlights}}Also, I thought you might have an interest in reviewing the high-level facts of our recently completed transactions that parallel your portfolio:\n\n{{comp_highlights}}\n\n{{/if}}Please do not hesitate to reach out if there is anything we can do to assist. Let me know what dates and times work for you and we will make that time a priority.\n\nBest regards,\n{{team.signature}}',
  'Professional, generous, value-first. Open with "Good morning." Anchor to their specific asset. Attach quarterly report. Always offer complimentary BOV with full benefit description. Include 3–4 recent comparable sales when available. Never pushy. Position Northmarq as specialization leader.',
  '{"open_rate_target": 0.35, "click_rate_target": 0.12, "response_rate_target": 0.05, "bov_request_rate_target": 0.03}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;

-- ============================================================================
-- T-002 v3: Cadence Follow-Up — Enhanced Northmarq Voice
-- ============================================================================
-- Purpose: Touches 2–6 periodic updates, Touch 7 direct ask
-- Tone: Lighter than T-001, more conversational, soft close
-- Variables: Support touch_number for adaptive messaging
-- ============================================================================
INSERT INTO template_definitions (
  template_id, template_version, category, name, description, domain,
  packet_bindings, mandatory_variables, optional_variables,
  subject_template, body_template, tone_notes, performance_targets
)
VALUES (
  'T-002', 3, 'seller_bd', 'Cadence Follow-Up',
  'Periodic touchpoint delivering quarterly report or market intelligence. Adapted for touches 2–6 (light) vs. touch 7 (explicit ask). Always anchored to their specific ownership. Soft close on touches 2–6, stronger ask on touch 7.',
  NULL,
  ARRAY['contact', 'property'],
  ARRAY['contact.full_name', 'property.tenant', 'property.city_state', 'property.domain'],
  ARRAY['touch_number', 'is_final_touch', 'value_delivery', 'team.credentials_summary', 'comp_highlights', 'team.signature'],
  -- Subject: Friendly update tone
  '{{#if property.domain}}{{property.domain}}{{else}}Net Lease{{/if}} Market Update — {{property.city_state}}',
  -- Body: Adaptive by touch number
  E'{{contact.full_name}},\n\n{{#if is_final_touch}}Over the past several months, I\'ve shared quarterly market reports, recent comparable sales, and market insights specific to your {{#if property.domain}}{{property.domain}}-leased{{else}}net lease{{/if}} portfolio in {{property.city_state}}.\n\nI\'m confident there\'s genuine value in a conversation about your {{property.tenant}}-leased assets and how we might assist with a disposition, refinance, portfolio review, or strategic planning.\n\n{{#if comp_highlights}}For reference, here are our most recent comparable transactions:\n\n{{comp_highlights}}\n\n{{/if}}Would you have 30 minutes in the next two weeks? I\'m flexible with scheduling.{{else}}Good morning. Given your ownership of the {{property.tenant}}-leased property in {{property.city_state}}, I wanted to pass along our latest capital markets update for the {{#if property.domain}}{{property.domain}}-leased{{else}}net lease{{/if}} investment sales sector.\n\nPlease see attached our quarterly update. This is a report that my team maintains daily and updates quarterly, aimed at tracking the trends and trades in this space.\n\n{{#if value_delivery}}{{value_delivery}}\n\n{{/if}}{{#if comp_highlights}}I thought you might have an interest in reviewing the high-level facts of our recently completed transactions that parallel your portfolio:\n\n{{comp_highlights}}\n\n{{/if}}Please do not hesitate to reach out if there is anything we can do to assist. I would also like to volunteer our opinion on valuation of any of your projects — completely complimentary and confidential.{{/if}}\n\nLet me know what dates and times work for you and we will make that time a priority.\n\nBest regards,\n{{team.signature}}',
  'Value-delivery focused. Attach quarterly report. Reference their specific asset. Keep warm and professional. Soft close (touches 2–6): "Happy to discuss further." Direct close (touch 7): Explicit 30-minute ask. Never pushy, but touch 7 is firmer.',
  '{"open_rate_target": 0.40, "click_rate_target": 0.10, "response_rate_target": 0.08, "meeting_conversion_target": 0.05}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;

-- ============================================================================
-- T-003 v3: Capital Markets Update — Enhanced Northmarq Voice
-- ============================================================================
-- Purpose: Standalone quarterly report delivery (independent of sequence)
-- Modes: Outbound to owner (anchored), inbound fulfillment, or mass quarterly
-- Variables: Support all three modes with conditional logic
-- ============================================================================
INSERT INTO template_definitions (
  template_id, template_version, category, name, description, domain,
  packet_bindings, mandatory_variables, optional_variables,
  subject_template, body_template, tone_notes, performance_targets
)
VALUES (
  'T-003', 3, 'mass_marketing', 'Capital Markets Update',
  'Quarterly capital markets report delivery. Flexible use cases: (1) Proactive outreach to known owners (anchored to their asset), (2) Inbound fulfillment (someone requested it), (3) Mass quarterly broadcast. Adapts opening and close based on context.',
  NULL,
  ARRAY['domain', 'contact'],
  ARRAY['contact.full_name', 'quarter_year'],
  ARRAY['property.tenant', 'property.city_state', 'team.credentials_summary', 'comp_highlights', 'is_inbound_request', 'team.signature'],
  -- Subject: Simple, quarter-focused
  'Capital Markets Update: {{#if property.domain}}{{property.domain}}{{/if}} ({{quarter_year}})',
  -- Body: Flexible opening (inbound vs. outbound), consistent closing
  E'{{contact.full_name}},\n\n{{#if is_inbound_request}}Thank you for your interest in our capital markets report for the {{#if property.domain}}{{property.domain}}-leased{{else}}net lease{{/if}} space. I\'m grateful for the opportunity to stay connected. Please see the attached {{quarter_year}} update.{{else}}Good morning. {{#if property.tenant}}Given your ownership of the {{property.tenant}}-leased property in {{property.city_state}}, I thought you might have some interest in reviewing our latest capital markets update report for the {{#if property.domain}}{{property.domain}}-leased{{else}}net lease{{/if}} investment sales sector.{{else}}I wanted to pass along our latest capital markets update report for the {{#if property.domain}}{{property.domain}}-leased{{else}}net lease{{/if}} investment sales sector.{{/if}} Please see the attached {{quarter_year}} update.{{/if}}\n\nThis is a report that my team maintains daily and updates quarterly, aimed at tracking the trends and trades from a broad perspective in the {{#if property.domain}}{{property.domain}}-leased{{else}}net lease{{/if}} investment sales markets. The pages included are intended to provide real-time value to you and your business, as well as insight into the level of service and quality of work our team can provide.\n\n{{#if team.credentials_summary}}{{team.credentials_summary}}\n\n{{/if}}{{#if comp_highlights}}I thought you might have an interest in reviewing the high-level facts of our recently completed transactions that parallel your portfolio:\n\n{{comp_highlights}}\n\n{{/if}}Please do not hesitate to reach out if there is anything we can do to assist. We look forward to the opportunity to leverage our firm\'s collective specialization, knowledge, track record, and expertise to your benefit.\n\nBest regards,\n{{team.signature}}',
  'Two modes: outbound (anchors to their specific asset if known), inbound (thanks them for interest). Mass quarterly can omit personal anchors. Always attach the report. Tone: professional, generous, never transactional.',
  '{"open_rate_target": 0.25, "click_rate_target": 0.08, "reply_rate_target": 0.02, "roi_lookback_months": 12}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;

-- ============================================================================
-- T-013 v2 → v3: GSA Lease Award Congratulations — Enhanced Version
-- ============================================================================
-- Note: T-013 v2 was strong. v3 enhances with:
-- - Better structured credentials block
-- - Stronger comp highlights formatting
-- - More explicit description of BOV benefits
-- - Refined tone: congratulatory but direct, fitting for HIGH-INTENT trigger
-- ============================================================================
INSERT INTO template_definitions (
  template_id, template_version, category, name, description, domain,
  packet_bindings, mandatory_variables, optional_variables,
  subject_template, body_template, tone_notes, performance_targets
)
VALUES (
  'T-013', 2, 'seller_bd', 'GSA Lease Award Congratulations',
  'Trigger-based outreach when a new GSA lease is awarded. HIGH-INTENT: Congratulates owner on value creation, delivers market report, offers complimentary BOV, includes recent comps. More direct ask for call given strong signal. Domain: government-leased only.',
  'government',
  ARRAY['contact', 'property'],
  ARRAY['contact.full_name', 'property.city_state', 'property.tenant'],
  ARRAY['property.name', 'property.lease_expiration', 'property.building_sf', 'team.credentials_summary', 'comp_highlights', 'team.signature'],
  -- Subject: Warm, direct
  'Congrats on Your New GSA Lease Award',
  -- Body: Warm opening → congrats → firm intro → report → credentials → BOV offer → comps → ask
  E'{{contact.full_name}},\n\nGood afternoon. I\'m reaching out regarding your GSA-leased project in {{property.city_state}}. Congratulations on the new lease award — you\'ve created significant value with this transaction, and it positions your asset for strong investor demand.\n\nAs a brief introduction, I run a team of investment sales brokers at Northmarq that specializes in government-leased assets nationwide. We maintain one of the industry\'s leading government-leased practice groups, and our market activity and deal flow give us real-time insight into buyer demand, pricing dynamics, and disposition strategies that maximize value for ownership.\n\nI\'ve attached our latest capital markets update for the government-leased space. This is a report that my team maintains daily and updates quarterly, aimed at tracking the trends and trades from a broad perspective in the government-leased investment sales sector. The pages included are intended to provide real-time value to you and your business, as well as demonstrate the level of service and quality of work our team delivers.\n\n{{#if team.credentials_summary}}{{team.credentials_summary}}\n\n{{/if}}I would like to volunteer our opinion on valuation of your new asset (completely complimentary and confidential). We often prepare a comprehensive valuation analysis and disposition proposal that includes a specific trade price range and target ask price, a detailed marketing strategy and disposition plan aimed at maximizing ownership value and net proceeds, and additional details about our competitive edge and firm value proposition. Given the strength of your new lease, this might be timely.\n\n{{#if comp_highlights}}For reference, here are some of our recently sold government-leased properties — these should help frame market conditions and buyer demand for your asset type:\n\n{{comp_highlights}}\n\n{{/if}}I\'d welcome the opportunity to connect for a 20-minute call this week or next to discuss your plans for the asset and how we might assist. Let me know what dates and times work for you and we will make that time a priority.\n\nBest regards,\n{{team.signature}}',
  'Warm and congratulatory, but more direct than standard BD sequence. HIGH-INTENT trigger warrants firmer ask. Always attach quarterly government report. Always include comps. Detailed BOV benefit description. Never pushy, but expects positive response.',
  '{"open_rate_target": 0.50, "response_rate_target": 0.15, "call_conversion_target": 0.08, "listing_conversion_target": 0.10}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;

-- ============================================================================
-- Helper: Document new/refined variables for engineering context
-- ============================================================================
-- The following variables should be computed/bound by the context packet system:
--
-- {{team.credentials_summary}}
--   Description: Dynamic domain-specific track record summary
--   Type: Conditional block (government vs. dialysis)
--   Example (Government):
--     "Northmarq operates one of the industry's leading government-leased
--      practice groups with 247 transactions totaling $4.8B in cumulative value."
--   Example (Dialysis):
--     "Northmarq operates one of the industry's leading dialysis-leased
--      practice groups with 156 transactions for $2.3B in cumulative value."
--   Source: Aggregated metrics from domain-specific transaction database
--
-- {{comp_highlights}}
--   Description: Formatted table of 3–4 recent comparable transactions
--   Type: Multi-row text block (markdown table or plain text)
--   Example:
--     "Property | Tenant | Location | Price | Cap Rate | Closed
--      Office Complex | GSA | Austin, TX | $4.2M | 4.8% | Q4 2025
--      Medical Facility | DaVita | Denver, CO | $3.1M | 5.1% | Q3 2025"
--   Source: Recent closings filtered by domain and property type
--   Rules: Order by most recent first; include only last 6–12 months
--
-- {{quarter_year}}
--   Description: Formatted quarter-year label
--   Type: String (e.g., "Q1 2026", "Q2 2026")
--   Binding: Computed from current date or contact's reporting preference
--
-- {{team.signature}}
--   Description: Scott's full signature block with contact info
--   Type: Multi-line text
--   Example:
--     "Scott Briggs
--      Director of Investment Sales | Northmarq
--      [phone] | [email]
--      Specializing in Government-Leased & Dialysis-Leased Assets"
--
-- {{is_inbound_request}}
--   Description: Boolean flag indicating email is fulfilling a request vs. outbound
--   Type: Boolean (true/false)
--   Binding: Set based on source signal (form submission, call result, etc.)
--
-- {{touch_number}}
--   Description: Position in cadence sequence (1–7, then quarterly)
--   Type: Integer
--   Binding: Computed by cadence scheduler based on contact lifecycle
--
-- {{is_final_touch}}
--   Description: Boolean flag for Touch 7 (the direct ask). Controls whether
--     T-002 renders the "explicit meeting request" body vs. standard update.
--   Type: Boolean (true/false)
--   Binding: Set by cadence scheduler when touch_number >= 7
--   Rules: When true, T-002 skips the quarterly report framing and instead
--     opens with a relationship recap + 30-minute meeting ask
--
-- {{suggested_outreach.suggested_angle}}
--   Description: Contextual hook for opening, derived from property/contact research
--   Type: String (1–2 sentences)
--   Example: "I noticed your recent GSA lease award for your Texas portfolio"
--   Source: Intelligence synthesis from available research signals
--
-- {{property.domain_label}}
--   Description: Display label for property domain
--   Type: String ("Government-Leased", "Dialysis-Leased", "Net Lease", etc.)
--   Binding: Lookup from domains table
--
-- ============================================================================
-- End Migration 030
-- ============================================================================
