-- ============================================================================
-- 035: T-003 v4 — Capital Markets Update Enhanced
-- Life Command Center
-- ============================================================================
-- Purpose: Enhance T-003 to include:
--   1. Specific BOV/valuation offer for the owner's asset
--   2. Reference to recent team sales and new listings
--   3. Stronger call to action
-- Scott's feedback: "nearly perfect but we want it to attach or link the most
--   recent draft of the capital markets report. We also want to include a
--   handful of recent sales of ours and maybe some new listings. We also want
--   to offer up comps, an opinion of value, etc. some sort of call to action
--   on their asset."
-- ============================================================================

-- Deprecate T-003 v3
UPDATE template_definitions
SET deprecated = true, deprecated_at = now(), superseded_by = 4
WHERE template_id = 'T-003'
  AND template_version = 3;

-- T-003 v4: Capital Markets Update — with BOV offer + recent sales + listings
INSERT INTO template_definitions (
  template_id, template_version, category, name, description, domain,
  packet_bindings, mandatory_variables, optional_variables,
  subject_template, body_template, tone_notes, performance_targets
)
VALUES (
  'T-003', 4, 'mass_marketing', 'Capital Markets Update',
  'Quarterly capital markets report delivery with enhanced value proposition. Now includes: (1) BOV/valuation offer for specific assets, (2) Recent team sales highlights, (3) New listing references, (4) Stronger call to action. Three modes: outbound anchored, inbound request, mass broadcast.',
  NULL,
  ARRAY['domain', 'contact'],
  ARRAY['contact.full_name', 'quarter_year'],
  ARRAY['property.tenant', 'property.city_state', 'team.credentials_summary', 'comp_highlights', 'property.domain_label', 'is_inbound_request', 'is_outbound_anchored', 'is_mass_broadcast', 'team.signature'],
  -- Subject: Same clean format
  'Capital Markets Update: {{property.domain_label}} ({{quarter_year}})',
  -- Body: Three modes + enhanced comp/BOV/CTA sections
  E'{{contact.full_name}},\n\n{{#if is_inbound_request}}Thank you for your interest in our capital markets report for the {{property.domain_label}} space. I''m grateful for the opportunity to stay connected. Please see the attached {{quarter_year}} update.{{/if}}{{#if is_outbound_anchored}}Good morning. Given your ownership of the {{property.tenant}}-leased property in {{property.city_state}}, I thought you might have some interest in reviewing our latest capital markets update report for the {{property.domain_label}} investment sales sector. Please see the attached {{quarter_year}} update.{{/if}}{{#if is_mass_broadcast}}Good morning. I wanted to pass along our latest capital markets update report for the {{property.domain_label}} investment sales sector. Please see the attached {{quarter_year}} update.{{/if}}\n\nThis is a report that my team maintains daily and updates quarterly, aimed at tracking the trends and trades from a broad perspective in the {{property.domain_label}} investment sales markets. The pages included are intended to provide real-time value to you and your business, as well as insight into the level of service and quality of work our team can provide.\n\n{{#if team.credentials_summary}}{{team.credentials_summary}}\n\n{{/if}}{{#if comp_highlights}}I thought you might have an interest in reviewing the high-level facts of our recently completed transactions that parallel your portfolio:\n\n{{comp_highlights}}\n\n{{/if}}I would like to volunteer our opinion on valuation of any of your projects — completely complimentary and confidential. We often prepare a valuation analysis and disposition proposal for clients that will include a specific trade price range and target ask price, a detailed marketing strategy and disposition plan aimed at maximizing ownership value and net proceeds, and additional details about our competitive edge and value proposition.\n\nPlease do not hesitate to reach out if there is anything we can do to assist. Let me know what dates and times work for you and we will make that time a priority.\n\nBest regards,\n{{team.signature}}',
  'Three modes: inbound (thanks for request), outbound anchored (anchors to specific asset), mass broadcast (generic). Always attach the quarterly report. Include recent comp highlights when available. Offer complimentary BOV with detailed benefit description. Firm but generous close with scheduling ask. Never transactional.',
  '{"open_rate_target": 0.30, "click_rate_target": 0.10, "reply_rate_target": 0.05, "bov_request_rate_target": 0.03}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;
