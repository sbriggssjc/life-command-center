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
-- - Simplified conditional logic: no nested if/else (only nested within safe blocks)
-- - Upgraded template renderer supports nested conditionals (templates.js, template-service/index.ts)
--
-- New Variables Introduced:
-- - {{team.credentials_summary}}: Dynamic domain-specific track record
-- - {{comp_highlights}}: Multi-row format with transaction details
-- - {{quarter_year}}: Formatted quarter-year label (e.g., "Q1 2026")
-- - {{suggested_outreach.suggested_angle}}: Context-specific hook
-- - {{team.signature}}: Includes contact info + optional team details
-- - {{property.domain_label}}: Display label for property domain ("Government-Leased", "Dialysis-Leased", etc.)
-- - {{is_standard_touch}}: Boolean; true when not final touch (touches 2–6)
-- - {{is_outbound_anchored}}: Boolean; true when outreach is anchored to owner's known asset
-- - {{is_mass_broadcast}}: Boolean; true when sent to broad contact list (no personal anchors)
-- - {{is_inbound_request}}: Boolean; true when fulfilling request vs. proactive outreach
-- - {{is_final_touch}}: Boolean; true for Touch 7 (direct meeting ask)
--
-- Version History:
-- - v1 (023): First pass with Scott's voice patterns
-- - v2 (023): Refinement with track record variables
-- - v3 (030): Enhanced comp highlights, team credentials, domain customization,
--   simplified conditionals, domain_label, is_standard_touch, is_outbound_anchored
--
-- Context Enrichment (operations.js / enrichDraftContext):
-- The enrichDraftContext function auto-populates context variables:
-- - team.credentials_summary: Domain-specific Northmarq track record
-- - team.signature: Scott's full signature block
-- - comp_highlights: Formatted 3–4 recent comparable transactions (domain-filtered, most recent first)
-- - quarter_year: e.g., "Q1 2026" (computed from current date or preference)
-- - property.domain_label: Display label from domains lookup ("Government-Leased", "Dialysis-Leased", etc.)
-- - is_standard_touch: Set to true when is_final_touch is absent (touches 2–6)
-- - is_outbound_anchored: Set to true when property.tenant is present (anchored to owner's asset)
-- - is_inbound_request: Set to true when source signal indicates fulfillment (form submission, etc.)
-- - is_mass_broadcast: Set to true when contact list is broad/unanchored
--
-- Template Renderer Capabilities (templates.js + template-service/index.ts):
-- The upgraded recursive template renderer handles:
-- - Flat conditionals: {{#if condition}}...{{/if}}
-- - Nested conditionals (safe): {{#if outer}}...{{#if inner}}...{{/if}}...{{/if}}
--   (nesting is safe when inner is entirely within outer's scope)
-- - Loop-free evaluation (handlebars-style syntax without loops)
-- - No undefined variable errors; missing variables render empty strings
--
-- ============================================================================

-- Mark v2 templates as superseded (T-001, T-002, T-003 go v2→v3)
UPDATE template_definitions
SET deprecated = true, deprecated_at = now(), superseded_by = 3
WHERE template_id IN (''T-001'', ''T-002'', ''T-003'')
  AND template_version = 2;

-- Mark T-013 v1 as superseded (v1→v2)
UPDATE template_definitions
SET deprecated = true, deprecated_at = now(), superseded_by = 2
WHERE template_id = ''T-013''
  AND template_version = 1;

-- ============================================================================
-- T-001 v3: First Touch — Enhanced Northmarq Voice
-- ============================================================================
-- Subject: Cleaner, more direct positioning using domain_label
-- Body: Restructured for stronger comp highlights, more generous BOV offer
--   Uses {{property.domain_label}} instead of nested domain conditionals
-- Variables: Added property.domain_label in optional_variables
-- ============================================================================
INSERT INTO template_definitions (
  template_id, template_version, category, name, description, domain,
  packet_bindings, mandatory_variables, optional_variables,
  subject_template, body_template, tone_notes, performance_targets
)
VALUES (
  ''T-001'', 3, ''seller_bd'', ''First Touch'',
  ''Initial outreach to net new owner identified through research. Anchored to specific property. Value-first: capital markets report + generous comp highlights + complimentary BOV offer.'',
  NULL,
  ARRAY[''contact'', ''property''],
  ARRAY[''contact.full_name'', ''property.tenant'', ''property.city_state'', ''property.domain''],
  ARRAY[''contact.firm'', ''property.name'', ''property.lease_expiration'', ''team.credentials_summary'', ''comp_highlights'', ''property.domain_label'', ''team.signature''],
  -- Subject: Direct, property-anchored, domain-aware using domain_label
  ''{{property.city_state}} {{property.domain_label}} — Northmarq'',
  -- Body: Warm opening → context hook → value delivery → credentials → BOV offer → comps → signature
  E''{{contact.full_name}},\n\nGood morning. Given your ownership of the {{property.tenant}}-leased property in {{property.city_state}}, I thought you might have some interest in reviewing our latest capital markets update report for the {{property.domain_label}} investment sales sector.\n\nI run a team of professionals at Northmarq that focuses on the sale of {{property.domain_label}} assets nationwide. Our market activity and deal flow give us direct insight into the buyer demand and pricing dynamics currently driving this space.\n\nPlease see attached our quarterly capital markets update. This is a report that my team maintains daily and updates quarterly, aimed at tracking the trends and trades from a broad perspective in the {{property.domain_label}} investment sales sector. The pages included are intended to provide real-time value to you and your investment portfolio, as well as insight into the level of service and quality of work our team can provide.\n\n{{#if team.credentials_summary}}{{team.credentials_summary}}\n\n{{/if}}I would like to volunteer our opinion on valuation of any of your projects — completely complimentary and confidential. We often prepare a valuation analysis and disposition proposal for clients that will include a specific trade price range and target ask price, a detailed marketing strategy and disposition plan aimed at maximizing ownership value and net proceeds, and additional details about our competitive edge and value proposition.\n\n{{#if comp_highlights}}Also, I thought you might have an interest in reviewing the high-level facts of our recently completed transactions that parallel your portfolio:\n\n{{comp_highlights}}\n\n{{/if}}Please do not hesitate to reach out if there is anything we can do to assist. Let me know what dates and times work for you and we will make that time a priority.\n\nBest regards,\n{{team.signature}}'',
  ''Professional, generous, value-first. Open with "Good morning." Anchor to their specific asset. Attach quarterly report. Always offer complimentary BOV with full benefit description. Include 3–4 recent comparable sales when available. Never pushy. Position Northmarq as specialization leader.'',
  ''{\"open_rate_target\": 0.35, \"click_rate_target\": 0.12, \"response_rate_target\": 0.05, \"bov_request_rate_target\": 0.03}''
)
ON CONFLICT (template_id, template_version) DO NOTHING;


-- ============================================================================
-- T-002 v3: Cadence Follow-Up — Enhanced Northmarq Voice
-- ============================================================================
-- Purpose: Touches 2–6 periodic updates (standard), Touch 7 direct ask (final)
-- Tone: Lighter than T-001, more conversational, soft close (standard) / firm close (final)
-- Variables: is_final_touch controls rendering; is_standard_touch auto-set when is_final_touch absent
--   Uses two separate non-nested blocks for clarity (no "else" in handlebars)
-- Conditionals: {{#if is_final_touch}}...{{/if}}{{#if is_standard_touch}}...{{/if}}
--   Nested comp_highlights inside is_standard_touch is safe (renderer handles nesting)
-- ============================================================================
INSERT INTO template_definitions (
  template_id, template_version, category, name, description, domain,
  packet_bindings, mandatory_variables, optional_variables,
  subject_template, body_template, tone_notes, performance_targets
)
VALUES (
  ''T-002'', 3, ''seller_bd'', ''Cadence Follow-Up'',
  ''Periodic touchpoint delivering quarterly report or market intelligence. Adapted for touches 2–6 (light) vs. touch 7 (explicit ask). Always anchored to their specific ownership. Soft close on touches 2–6, stronger ask on touch 7.'',
  NULL,
  ARRAY[''contact'', ''property''],
  ARRAY[''contact.full_name'', ''property.tenant'', ''property.city_state'', ''property.domain''],
  ARRAY[''is_final_touch'', ''is_standard_touch'', ''value_delivery'', ''team.credentials_summary'', ''comp_highlights'', ''property.domain_label'', ''team.signature''],
  -- Subject: Friendly update tone
  ''{{property.domain_label}} Market Update — {{property.city_state}}'',
  -- Body: Two separate non-nested blocks for is_final_touch and is_standard_touch
  --   Nested comp_highlights inside is_standard_touch is safe due to upgraded renderer
  E''{{contact.full_name}},\n\n{{#if is_final_touch}}Over the past several months, I\'ve shared quarterly market reports, recent comparable sales, and market insights specific to your {{property.domain_label}} portfolio in {{property.city_state}}.\n\nI\'m confident there\'s genuine value in a conversation about your {{property.tenant}}-leased assets and how we might assist with a disposition, refinance, portfolio review, or strategic planning.\n\n{{#if comp_highlights}}For reference, here are our most recent comparable transactions:\n\n{{comp_highlights}}\n\n{{/if}}Would you have 30 minutes in the next two weeks? I\'m flexible with scheduling.{{/if}}{{#if is_standard_touch}}Good morning. Given your ownership of the {{property.tenant}}-leased property in {{property.city_state}}, I wanted to pass along our latest capital markets update for the {{property.domain_label}} investment sales sector.\n\nPlease see attached our quarterly update. This is a report that my team maintains daily and updates quarterly, aimed at tracking the trends and trades in this space.\n\n{{#if value_delivery}}{{value_delivery}}\n\n{{/if}}{{#if comp_highlights}}I thought you might have an interest in reviewing the high-level facts of our recently completed transactions that parallel your portfolio:\n\n{{comp_highlights}}\n\n{{/if}}Please do not hesitate to reach out if there is anything we can do to assist. I would also like to volunteer our opinion on valuation of any of your projects — completely complimentary and confidential.{{/if}}\n\nLet me know what dates and times work for you and we will make that time a priority.\n\nBest regards,\n{{team.signature}}'',
  ''Value-delivery focused. Attach quarterly report. Reference their specific asset. Keep warm and professional. Standard (touches 2–6): soft close with nested comp_highlights. Final (touch 7): explicit 30-minute ask. Never pushy, but touch 7 is firmer. Nested comp_highlights within is_standard_touch handled safely by upgraded renderer.'',
  ''{\"open_rate_target\": 0.40, \"click_rate_target\": 0.10, \"response_rate_target\": 0.08, \"meeting_conversion_target\": 0.05}''
)
ON CONFLICT (template_id, template_version) DO NOTHING;


-- ============================================================================
-- T-003 v3: Capital Markets Update — Enhanced Northmarq Voice
-- ============================================================================
-- Purpose: Standalone quarterly report delivery (independent of sequence)
-- Modes: Outbound anchored (is_outbound_anchored), inbound (is_inbound_request), or mass (is_mass_broadcast)
-- Conditionals: Three separate {{#if}} blocks (mutually exclusive logic via context enrichment)
-- Variables: All use {{property.domain_label}} instead of inline domain conditionals
-- ============================================================================
INSERT INTO template_definitions (
  template_id, template_version, category, name, description, domain,
  packet_bindings, mandatory_variables, optional_variables,
  subject_template, body_template, tone_notes, performance_targets
)
VALUES (
  ''T-003'', 3, ''mass_marketing'', ''Capital Markets Update'',
  ''Quarterly capital markets report delivery. Flexible use cases: (1) Proactive outreach to known owners (is_outbound_anchored), (2) Inbound fulfillment (is_inbound_request), (3) Mass quarterly broadcast (is_mass_broadcast). Adapts opening and close based on context. Always uses {{property.domain_label}}.'',
  NULL,
  ARRAY[''domain'', ''contact''],
  ARRAY[''contact.full_name'', ''quarter_year''],
  ARRAY[''property.tenant'', ''property.city_state'', ''team.credentials_summary'', ''comp_highlights'', ''property.domain_label'', ''is_inbound_request'', ''is_outbound_anchored'', ''is_mass_broadcast'', ''team.signature''],
  -- Subject: Simple, quarter-focused
  ''Capital Markets Update: {{property.domain_label}} ({{quarter_year}})'',
  -- Body: Three separate non-nested blocks for inbound, outbound anchored, and mass broadcast
  E''{{contact.full_name}},\n\n{{#if is_inbound_request}}Thank you for your interest in our capital markets report for the {{property.domain_label}} space. I\'m grateful for the opportunity to stay connected. Please see the attached {{quarter_year}} update.{{/if}}{{#if is_outbound_anchored}}Good morning. Given your ownership of the {{property.tenant}}-leased property in {{property.city_state}}, I thought you might have some interest in reviewing our latest capital markets update report for the {{property.domain_label}} investment sales sector. Please see the attached {{quarter_year}} update.{{/if}}{{#if is_mass_broadcast}}Good morning. I wanted to pass along our latest capital markets update report for the {{property.domain_label}} investment sales sector. Please see the attached {{quarter_year}} update.{{/if}}\n\nThis is a report that my team maintains daily and updates quarterly, aimed at tracking the trends and trades from a broad perspective in the {{property.domain_label}} investment sales markets. The pages included are intended to provide real-time value to you and your business, as well as insight into the level of service and quality of work our team can provide.\n\n{{#if team.credentials_summary}}{{team.credentials_summary}}\n\n{{/if}}{{#if comp_highlights}}I thought you might have an interest in reviewing the high-level facts of our recently completed transactions that parallel your portfolio:\n\n{{comp_highlights}}\n\n{{/if}}Please do not hesitate to reach out if there is anything we can do to assist. We look forward to the opportunity to leverage our firm\'s collective specialization, knowledge, track record, and expertise to your benefit.\n\nBest regards,\n{{team.signature}}'',
  ''Three modes: inbound (thanks them for request), outbound anchored (anchors to their specific asset), mass broadcast (generic to broad list). All use {{property.domain_label}}. Always attach the report. Tone: professional, generous, never transactional. Context enrichment sets exactly one of is_inbound_request, is_outbound_anchored, or is_mass_broadcast to true.'',
  ''{\"open_rate_target\": 0.25, \"click_rate_target\": 0.08, \"reply_rate_target\": 0.02, \"roi_lookback_months\": 12}''
)
ON CONFLICT (template_id, template_version) DO NOTHING;


-- ============================================================================
-- T-013 v2: GSA Lease Award Congratulations — No Changes Needed
-- ============================================================================
-- Note: T-013 v2 already uses simple conditional structure (flat {{#if}})
--   and is designed for government domain only. No updates required.
-- ============================================================================
INSERT INTO template_definitions (
  template_id, template_version, category, name, description, domain,
  packet_bindings, mandatory_variables, optional_variables,
  subject_template, body_template, tone_notes, performance_targets
)
VALUES (
  ''T-013'', 2, ''seller_bd'', ''GSA Lease Award Congratulations'',
  ''Trigger-based outreach when a new GSA lease is awarded. HIGH-INTENT: Congratulates owner on value creation, delivers market report, offers complimentary BOV, includes recent comps. More direct ask for call given strong signal. Domain: government-leased only.'',
  ''government'',
  ARRAY[''contact'', ''property''],
  ARRAY[''contact.full_name'', ''property.city_state'', ''property.tenant''],
  ARRAY[''property.name'', ''property.lease_expiration'', ''property.building_sf'', ''team.credentials_summary'', ''comp_highlights'', ''team.signature''],
  -- Subject: Warm, direct
  ''Congrats on Your New GSA Lease Award'',
  -- Body: Warm opening → congrats → firm intro → report → credentials → BOV offer → comps → ask
  E''{{contact.full_name}},\n\nGood afternoon. I\'m reaching out regarding your GSA-leased project in {{property.city_state}}. Congratulations on the new lease award — you\'ve created significant value with this transaction, and it positions your asset for strong investor demand.\n\nAs a brief introduction, I run a team of investment sales brokers at Northmarq that specializes in government-leased assets nationwide. We maintain one of the industry\'s leading government-leased practice groups, and our market activity and deal flow give us real-time insight into buyer demand, pricing dynamics, and disposition strategies that maximize value for ownership.\n\nI\'ve attached our latest capital markets update for the government-leased space. This is a report that my team maintains daily and updates quarterly, aimed at tracking the trends and trades from a broad perspective in the government-leased investment sales sector. The pages included are intended to provide real-time value to you and your business, as well as demonstrate the level of service and quality of work our team delivers.\n\n{{#if team.credentials_summary}}{{team.credentials_summary}}\n\n{{/if}}I would like to volunteer our opinion on valuation of your new asset (completely complimentary and confidential). We often prepare a comprehensive valuation analysis and disposition proposal that includes a specific trade price range and target ask price, a detailed marketing strategy and disposition plan aimed at maximizing ownership value and net proceeds, and additional details about our competitive edge and firm value proposition. Given the strength of your new lease, this might be timely.\n\n{{#if comp_highlights}}For reference, here are some of our recently sold government-leased properties — these should help frame market conditions and buyer demand for your asset type:\n\n{{comp_highlights}}\n\n{{/if}}I\'d welcome the opportunity to connect for a 20-minute call this week or next to discuss your plans for the asset and how we might assist. Let me know what dates and times work for you and we will make that time a priority.\n\nBest regards,\n{{team.signature}}'',
  ''Warm and congratulatory, but more direct than standard BD sequence. HIGH-INTENT trigger warrants firmer ask. Always attach quarterly government report. Always include comps. Detailed BOV benefit description. Never pushy, but expects positive response.'',
  ''{\"open_rate_target\": 0.50, \"response_rate_target\": 0.15, \"call_conversion_target\": 0.08, \"listing_conversion_target\": 0.10}''
)
ON CONFLICT (template_id, template_version) DO NOTHING;


-- ============================================================================
-- Helper: Document new/refined variables for engineering context
-- ============================================================================
-- The following variables should be computed/bound by the context packet system:
--
-- CONTEXT ENRICHMENT (operations.js / enrichDraftContext):
-- ============================================================================
--
-- {{team.credentials_summary}}
--   Description: Dynamic domain-specific track record summary
--   Type: Conditional block (government vs. dialysis)
--   Example (Government):
--     "Northmarq operates one of the industry''s leading government-leased
--      practice groups with 247 transactions totaling $4.8B in cumulative value."
--   Example (Dialysis):
--     "Northmarq operates one of the industry''s leading dialysis-leased
--      practice groups with 156 transactions for $2.3B in cumulative value."
--   Source: Aggregated metrics from domain-specific transaction database
--   Auto-Population: enrichDraftContext sets this based on property.domain
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
--   Auto-Population: enrichDraftContext queries comp database, formats output
--
-- {{quarter_year}}
--   Description: Formatted quarter-year label
--   Type: String (e.g., "Q1 2026", "Q2 2026")
--   Binding: Computed from current date or contact''s reporting preference
--   Auto-Population: enrichDraftContext computes from current date
--
-- {{team.signature}}
--   Description: Scott''s full signature block with contact info
--   Type: Multi-line text
--   Example:
--     "Scott Briggs
--      Director of Investment Sales | Northmarq
--      [phone] | [email]
--      Specializing in Government-Leased & Dialysis-Leased Assets"
--   Auto-Population: enrichDraftContext reads from team profile
--
-- {{property.domain_label}}
--   Description: Display label for property domain
--   Type: String ("Government-Leased", "Dialysis-Leased", "Net Lease", etc.)
--   Binding: Lookup from domains table (domains.display_label)
--   Auto-Population: enrichDraftContext joins property.domain → domains.display_label
--   Usage: Replaces inline conditionals like {{#if property.domain}}{{property.domain}}-leased{{else}}net lease{{/if}}
--   Examples:
--     - property.domain = "government" → "Government-Leased"
--     - property.domain = "dialysis" → "Dialysis-Leased"
--     - property.domain = NULL → "Net Lease"
--
-- {{is_standard_touch}}
--   Description: Boolean flag for standard cadence touches (2–6)
--   Type: Boolean (true/false)
--   Binding: Set by enrichDraftContext when is_final_touch is absent
--   Rules: When true, T-002 renders standard update with soft close
--   Auto-Population: enrichDraftContext sets to true if is_final_touch is false/null
--
-- {{is_final_touch}}
--   Description: Boolean flag for Touch 7 (the direct ask)
--   Type: Boolean (true/false)
--   Binding: Set by cadence scheduler when touch_number >= 7
--   Rules: When true, T-002 skips quarterly report framing and opens with
--     relationship recap + 30-minute meeting ask
--   Auto-Population: Cadence scheduler (not enrichDraftContext)
--
-- {{is_inbound_request}}
--   Description: Boolean flag indicating email fulfills a request vs. proactive outreach
--   Type: Boolean (true/false)
--   Binding: Set based on source signal (form submission, call result, etc.)
--   Usage: T-003 {{#if is_inbound_request}} opens with "Thank you for interest..."
--   Auto-Population: enrichDraftContext checks source signal (e.g., form submission)
--
-- {{is_outbound_anchored}}
--   Description: Boolean flag for outreach anchored to owner''s known asset
--   Type: Boolean (true/false)
--   Binding: Set by enrichDraftContext when property.tenant is present
--   Usage: T-003 {{#if is_outbound_anchored}} opens with property-specific hook
--   Auto-Population: enrichDraftContext sets to true if property.tenant exists
--
-- {{is_mass_broadcast}}
--   Description: Boolean flag for broad contact list (no personal anchors)
--   Type: Boolean (true/false)
--   Binding: Set manually when sending to unanchored contact list
--   Usage: T-003 {{#if is_mass_broadcast}} opens with generic greeting
--   Auto-Population: Caller must set explicitly (not auto-set by enrichDraftContext)
--
-- {{suggested_outreach.suggested_angle}}
--   Description: Contextual hook for opening, derived from property/contact research
--   Type: String (1–2 sentences)
--   Example: "I noticed your recent GSA lease award for your Texas portfolio"
--   Source: Intelligence synthesis from available research signals
--
-- {{value_delivery}}
--   Description: Custom value proposition paragraph for T-002 standard touch
--   Type: String (multi-line text, markdown-friendly)
--   Binding: Optional; if absent, T-002 skips this section
--   Source: Enrichment context or manually provided
--
-- {{touch_number}}
--   Description: Position in cadence sequence (1–7, then quarterly)
--   Type: Integer (1–7 or null)
--   Binding: Computed by cadence scheduler
--   Note: Deprecated in favor of is_final_touch + is_standard_touch
--
-- {{contact.full_name}}, {{property.tenant}}, {{property.city_state}}, {{property.domain}}
--   Description: Required base fields from contact and property tables
--   Type: String
--   Binding: Extracted from contact/property objects in context
--
-- ============================================================================
-- TEMPLATE RENDERER CAPABILITIES (templates.js + template-service/index.ts)
-- ============================================================================
-- The upgraded recursive template renderer handles:
--
-- 1. FLAT CONDITIONALS:
--    {{#if condition}}...{{/if}}
--    - Single-level conditional block
--    - Renders inner content if condition is truthy
--
-- 2. NESTED CONDITIONALS (Safe Pattern):
--    {{#if outer}}...{{#if inner}}...{{/if}}...{{/if}}
--    - Inner conditional entirely within outer block scope
--    - Outer check ensures context exists before inner evaluation
--    - Safe because inner is only evaluated if outer is true
--    - Example: {{#if is_standard_touch}}...{{#if comp_highlights}}...{{/if}}...{{/if}}
--
-- 3. VARIABLE INTERPOLATION:
--    {{variable.path}}
--    - Simple path traversal (dot notation)
--    - No filters, no loops, no complex expressions
--    - Missing variables render as empty strings (no undefined errors)
--
-- 4. WHITESPACE & ESCAPING:
--    - Preserves newlines and formatting
--    - PostgreSQL string escaping: use '' for single quote, E''...'' for \n
--    - Template syntax: {{#if}}, {{/if}} (mustache-style)
--
-- 5. NO SUPPORT FOR:
--    - Comparison operators in conditions (use computed boolean flags instead)
--    - Loops ({{#each}}, {{#for}})
--    - Helpers or custom filters
--    - Nested else branches (use separate {{#if}} blocks)
--
-- 6. RENDERING WORKFLOW:
--    - Parser reads template, identifies {{...}} blocks
--    - Evaluator traverses context for each variable/conditional
--    - Renderer builds output string with safe escaping
--    - Returns final email body with variables substituted
--
-- ============================================================================
-- End Migration 030
-- ============================================================================
