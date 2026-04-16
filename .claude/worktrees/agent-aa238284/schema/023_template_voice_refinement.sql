-- ============================================================================
-- Migration 023: Template Voice Refinement + New BD Templates
-- Life Command Center — Wave 2: Scott's Actual Voice
--
-- Based on analysis of Scott's actual Outlook templates (.oft files):
-- - Capital Markets Update Government-Leased (2022-Q3)
-- - Capital Markets Update Net Lease Medical/Dialysis (2022-Q1)
-- - Congrats on the New GSA Lease
-- - The Dialysis Market Filter (3Q22)
-- - The Government-Leased Capital Markets Report (3Q-2022)
--
-- Key voice patterns incorporated:
-- - "Good morning/afternoon" openers
-- - "Given your ownership of the [tenant]-leased property in [city]..."
-- - Quarterly report as primary value delivery
-- - Track record proof paragraph with specific numbers
-- - Complimentary BOV offer as standard close
-- - Recent sales table as embedded social proof
-- - Warm, professional, never pushy
--
-- New templates added:
-- - T-011: Listing BD — Same Asset Type / Same State
-- - T-012: Listing BD — Owner Located Near Listing
-- - T-013: GSA Lease Award Congratulations (trigger-based)
-- - T-014: Report Request Fulfillment (inbound)
-- ============================================================================

-- Deprecate v1 of templates being rewritten in Scott's voice
UPDATE template_definitions SET deprecated = true, deprecated_at = now(), superseded_by = 2
WHERE template_id IN ('T-001', 'T-002', 'T-003', 'T-008') AND template_version = 1;

-- T-001 v2: First Touch — Scott's actual voice
INSERT INTO template_definitions (template_id, template_version, category, name, description, domain, packet_bindings, mandatory_variables, optional_variables, subject_template, body_template, tone_notes, performance_targets)
VALUES (
  'T-001', 2, 'seller_bd', 'First Touch',
  'Initial outreach to a net new owner identified through research. Anchored to a specific property they own. Value-first: delivers capital markets report + complimentary BOV offer.',
  NULL,
  ARRAY['contact', 'property'],
  ARRAY['contact.full_name', 'property.tenant', 'property.city_state', 'property.domain'],
  ARRAY['contact.firm', 'property.name', 'property.lease_expiration', 'team.track_record_summary', 'team.recent_sales_table', 'team.transaction_count', 'team.transaction_volume'],
  '{{property.city_state}} {{property.domain}} — {{property.tenant}}',
  E'{{contact.full_name}},\n\nGood morning. Given your ownership of the {{property.tenant}}-leased property in {{property.city_state}}, I thought you might have some interest in reviewing our latest capital markets update report for the {{#if property.domain}}{{property.domain}}-leased{{else}}net lease{{/if}} investment sales sector. Please see the attached quarterly update. This is a report that my team maintains daily and updates quarterly which aims to track the trends and trades, from a broad perspective, for all investment property sales in this space. The pages included are an attempt to provide real-time value to you and your investment portfolio as well as provide insight into the level of service and quality of work our team can provide for our clients.\n\n{{#if team.track_record_summary}}{{team.track_record_summary}}{{else}}Our team operates one of the industry''s leading practice groups in this sector with a deep track record of specialization, knowledge, and expertise that we leverage for our clients'' benefit.{{/if}} Please do not hesitate to reach out if there is anything we can do to assist.\n\nI would like to volunteer our opinion on valuation of any of your projects (completely complimentary and confidential). We often prepare a valuation analysis and disposition proposal on specific assets for our clients that will include a specific trade price range and target ask price, a detailed marketing strategy and disposition plan aimed at maximizing ownership value and net proceeds, and additional details about our competitive edge and value proposition. If any of the above is of interest let me know and we can schedule a call to discuss further.\n\n{{#if team.recent_sales_table}}Also, I thought you might have an interest in reviewing the high-level facts of our recently sold properties given the similarities between these and the projects in your portfolio:\n\n{{team.recent_sales_table}}\n\n{{/if}}Best regards,\nScott Briggs',
  'Professional, generous, value-first. Open with "Good morning/afternoon." Lead with their specific asset. Attach the quarterly report. Always offer complimentary BOV. Include recent sales table when available. Never pushy.',
  '{"open_rate_target": 0.35, "response_rate_target": 0.05}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;

-- T-002 v2: Cadence Follow-Up — Scott's actual voice
INSERT INTO template_definitions (template_id, template_version, category, name, description, domain, packet_bindings, mandatory_variables, optional_variables, subject_template, body_template, tone_notes, performance_targets)
VALUES (
  'T-002', 2, 'seller_bd', 'Cadence Follow-Up',
  'Periodic touchpoint delivering quarterly report or market intelligence. Always anchored to their specific ownership.',
  NULL,
  ARRAY['contact', 'property'],
  ARRAY['contact.full_name', 'property.tenant', 'property.city_state', 'property.domain', 'touch_number', 'value_delivery'],
  ARRAY['relationship.last_touchpoint.outcome', 'team.track_record_summary', 'team.recent_sales_table', 'comp_highlights'],
  '{{property.domain}} Capital Markets Update — {{property.city_state}}',
  E'{{contact.full_name}},\n\nGood morning. Given your ownership of the {{property.tenant}}-leased property in {{property.city_state}}, I wanted to pass along our latest capital markets update for the {{property.domain}}-leased investment sales sector. Please see the attached quarterly update. This is a report that my team maintains daily and updates quarterly which aims to track the trends and trades in this space.\n\n{{#if value_delivery}}{{value_delivery}}\n\n{{/if}}{{#if comp_highlights}}Also, I thought you might have an interest in reviewing the high-level facts of our recently completed transactions given the similarities to your portfolio:\n\n{{comp_highlights}}\n\n{{/if}}Please do not hesitate to reach out if there is anything we can do to assist. I would also like to volunteer our opinion on valuation of any of your projects — completely complimentary and confidential.\n\nBest regards,\nScott Briggs',
  'Value-delivery focused. Attach quarterly report. Reference their specific asset. Keep it warm but professional. Soft close with BOV offer.',
  '{"open_rate_target": 0.40, "response_rate_target": 0.08}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;

-- T-003 v2: Capital Markets Update — Scott's actual voice
INSERT INTO template_definitions (template_id, template_version, category, name, description, domain, packet_bindings, mandatory_variables, optional_variables, subject_template, body_template, tone_notes, performance_targets)
VALUES (
  'T-003', 2, 'mass_marketing', 'Capital Markets Update',
  'Quarterly capital markets report delivery. Two modes: proactive outreach to known owners, inbound fulfillment for those who requested it.',
  NULL,
  ARRAY['domain_aggregate', 'contact'],
  ARRAY['contact.full_name', 'domain', 'quarter_year'],
  ARRAY['property.tenant', 'property.city_state', 'team.track_record_summary', 'team.recent_sales_table', 'is_inbound_request'],
  'Capital Markets Update: {{domain}} ({{quarter_year}})',
  E'{{contact.full_name}},\n\n{{#if is_inbound_request}}Thank you for your interest in our capital markets report for the {{domain}}-leased space. Please see the attached {{quarter_year}} update.{{else}}Good morning. {{#if property.tenant}}Given your ownership of the {{property.tenant}}-leased property in {{property.city_state}}, I thought you might have some interest in reviewing our latest capital markets update report for the {{domain}}-leased investment sales sector.{{else}}I wanted to pass along our latest capital markets update report for the {{domain}}-leased investment sales sector.{{/if}} Please see the attached {{quarter_year}} update.{{/if}} This is a report that my team maintains daily and updates quarterly which aims to track the trends and trades, from a broad perspective, in the {{domain}}-leased investment sales markets. The pages included herein are an attempt to provide real-time value to you and your business as well as provide insight into the level of service and quality of work our team is capable of providing to our clients.\n\n{{#if team.track_record_summary}}{{team.track_record_summary}}{{/if}} Please do not hesitate to reach out if there is anything we can do to assist. We look forward to the opportunity to leverage our firm''s collective specialization, knowledge, track record and expertise to your benefit.\n\nBest regards,\nScott Briggs',
  'Two modes: outbound (anchor to their asset) vs inbound fulfillment (thank them for interest). Always attach the report.',
  '{"open_rate_target": 0.25, "click_rate_target": 0.08, "reply_rate_target": 0.02}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;

-- T-008 v2: BOV Delivery Cover — Scott's actual voice
INSERT INTO template_definitions (template_id, template_version, category, name, description, domain, packet_bindings, mandatory_variables, optional_variables, subject_template, body_template, tone_notes, performance_targets)
VALUES (
  'T-008', 2, 'seller_bd', 'BOV Delivery Cover',
  'Cover email delivering a BOV/valuation analysis. Consultative tone, data-backed.',
  NULL,
  ARRAY['pursuit', 'comp_analysis'],
  ARRAY['contact.full_name', 'property.name', 'property.city_state', 'pricing_recommendation.suggested_list_price', 'pricing_recommendation.suggested_cap_rate', 'pricing_recommendation.rationale'],
  ARRAY['property.tenant', 'comp_highlights', 'team.track_record_summary'],
  '{{property.name}} — Broker Opinion of Value',
  E'{{contact.full_name}},\n\nGood afternoon. As discussed, please find attached our Broker Opinion of Value for the {{property.tenant}}-leased property in {{property.city_state}}. This valuation analysis includes a specific trade price range and target ask price, a detailed marketing strategy and disposition plan aimed at maximizing ownership value and net proceeds, and additional details about our competitive edge and firm''s value proposition.\n\nBased on our analysis of recent comparable transactions and current market conditions, we believe the property supports a value in the range of {{pricing_recommendation.suggested_list_price}} at approximately a {{pricing_recommendation.suggested_cap_rate}}% cap rate. {{pricing_recommendation.rationale}}\n\n{{#if comp_highlights}}The following recent transactions serve as the primary basis for our analysis:\n\n{{comp_highlights}}\n\n{{/if}}I would welcome the opportunity to walk through our analysis in detail and discuss next steps at your convenience. Let me know what dates and times work for you and we will make that time a priority.\n\nBest regards,\nScott Briggs',
  'Consultative, authoritative, data-backed. Reference "as discussed" if prior contact. Include specific pricing with rationale. Close with call request.',
  '{"response_rate_target": 0.35, "listing_conversion_target": 0.12}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;

-- T-011: Listing BD — Same Asset Type / Same State
INSERT INTO template_definitions (template_id, template_version, category, name, description, domain, packet_bindings, mandatory_variables, optional_variables, subject_template, body_template, tone_notes, performance_targets)
VALUES (
  'T-011', 1, 'buyer_bd', 'Listing BD — Same Asset Type / Same State',
  'Outreach to owners of the same asset type in the same state as an active listing. Uses the listing as credibility tool while pivoting to their portfolio.',
  NULL,
  ARRAY['listing_marketing', 'contact', 'property'],
  ARRAY['contact.full_name', 'property.tenant', 'property.city_state', 'property.domain', 'listing.tenant', 'listing.city_state', 'listing.cap_rate', 'listing.list_price'],
  ARRAY['listing.property_summary', 'listing.remaining_lease_term', 'team.track_record_summary', 'team.recent_sales_table'],
  '{{listing.city_state}} {{listing.tenant}} — New Listing',
  E'{{contact.full_name}},\n\nGood morning. Given your ownership of the {{property.tenant}}-leased property in {{property.city_state}}, I wanted to make sure you had a chance to see our latest exclusive listing in the {{property.domain}}-leased space:\n\n{{listing.tenant}} | {{listing.city_state}}\nAsking Price: {{listing.list_price}} | Cap Rate: {{listing.cap_rate}}%{{#if listing.remaining_lease_term}}\nLease Term Remaining: {{listing.remaining_lease_term}}{{/if}}\n\n{{#if listing.property_summary}}{{listing.property_summary}}\n\n{{/if}}OM and financial details available upon request.\n\nSeparately, given the similarities between this asset and the projects in your portfolio, I would also like to volunteer our opinion on valuation of any of your properties — completely complimentary and confidential. We often prepare a valuation analysis and disposition proposal that will include a specific trade price range and target ask price, a detailed marketing strategy, and additional details about our competitive edge.\n\n{{#if team.track_record_summary}}{{team.track_record_summary}}\n\n{{/if}}Please do not hesitate to reach out if there is anything we can do to assist.\n\nBest regards,\nScott Briggs',
  'Two-purpose: distribute listing to potential buyer + pivot to their own portfolio as BD play. Lead with listing, close with BOV offer.',
  '{"open_rate_target": 0.40, "om_request_rate_target": 0.10, "bov_request_rate_target": 0.03}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;

-- T-012: Listing BD — Owner Located Near Listing
INSERT INTO template_definitions (template_id, template_version, category, name, description, domain, packet_bindings, mandatory_variables, optional_variables, subject_template, body_template, tone_notes, performance_targets)
VALUES (
  'T-012', 1, 'buyer_bd', 'Listing BD — Owner Located Near Listing',
  'Outreach to a known owner geographically near an active listing, regardless of where their assets are. Lighter touch.',
  NULL,
  ARRAY['listing_marketing', 'contact'],
  ARRAY['contact.full_name', 'contact.firm', 'listing.tenant', 'listing.city_state', 'listing.domain', 'listing.cap_rate', 'listing.list_price'],
  ARRAY['listing.property_summary', 'listing.remaining_lease_term', 'contact.geography', 'team.track_record_summary'],
  '{{listing.city_state}} {{listing.domain}} — Exclusive Listing',
  E'{{contact.full_name}},\n\nGood morning. I wanted to reach out given your presence in the {{listing.city_state}} market. We have recently brought an exclusive listing to market that may be of interest:\n\n{{listing.tenant}} | {{listing.city_state}}\nAsking Price: {{listing.list_price}} | Cap Rate: {{listing.cap_rate}}%{{#if listing.remaining_lease_term}}\nLease Term Remaining: {{listing.remaining_lease_term}}{{/if}}\n\n{{#if listing.property_summary}}{{listing.property_summary}}\n\n{{/if}}OM and financial details are available upon request. If you have any interest in learning more about this opportunity or the {{listing.domain}}-leased investment sales space more broadly, please do not hesitate to reach out.\n\n{{#if team.track_record_summary}}{{team.track_record_summary}}\n\n{{/if}}Best regards,\nScott Briggs',
  'Lighter touch. Geographic proximity is the connection, not asset similarity. Buyer-focused.',
  '{"open_rate_target": 0.30, "om_request_rate_target": 0.08}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;

-- T-013: GSA Lease Award Congratulations
INSERT INTO template_definitions (template_id, template_version, category, name, description, domain, packet_bindings, mandatory_variables, optional_variables, subject_template, body_template, tone_notes, performance_targets)
VALUES (
  'T-013', 1, 'seller_bd', 'GSA Lease Award Congratulations',
  'Trigger-based outreach when a new GSA lease is awarded. Congratulates the owner on value creation and pivots to BOV.',
  'government',
  ARRAY['contact', 'property'],
  ARRAY['contact.full_name', 'property.city_state', 'property.tenant'],
  ARRAY['property.name', 'property.lease_expiration', 'property.building_sf', 'team.track_record_summary', 'team.recent_sales_table'],
  'Congrats on the New GSA Lease',
  E'{{contact.full_name}},\n\nGood afternoon. I am reaching out on your GSA-leased project in {{property.city_state}}. Congratulations on the new lease award. As a brief introduction, I am a commercial real estate investment sales broker and I run a team of professionals that focus on the sale of office, medical, and government-leased assets nationwide. You have created a lot of value with this new lease. Do you have time to connect for a call this week or next to discuss your plans for the asset?\n\nI also wanted to pass along our latest capital markets update report for the government-leased space. Please see the attached quarterly update. This is a report that my team maintains daily and updates quarterly which aims to track the trends and trades, from a broad perspective, in the government-leased investment sales markets. The pages included herein are an attempt to provide real-time value to you and your business as well as provide insight into the level of service and quality of work our team can provide to our clients.\n\n{{#if team.track_record_summary}}{{team.track_record_summary}}{{/if}} Please do not hesitate to reach out if there is anything we can do to assist. We look forward to the opportunity to leverage our firm''s collective specialization, knowledge, track record and expertise to your benefit.\n\nI would like to volunteer our opinion on valuation of any of your projects (completely complimentary and confidential). We often prepare a valuation analysis and disposition proposal on specific assets for our clients that will include a specific trade price range and target ask price, a detailed marketing strategy and disposition plan aimed at maximizing ownership value and net proceeds, and additional details about our competitive edge and value proposition. If you can set aside some time over the coming weeks, I would love to connect on a call to discuss the above further. Let me know what dates and times work for you and we will make that time a priority.\n\n{{#if team.recent_sales_table}}Also, I thought you might have an interest in reviewing the high-level facts of our recently sold government-leased properties given the similarities between these and the projects in your portfolio:\n\n{{team.recent_sales_table}}\n\n{{/if}}Best regards,\nScott Briggs',
  'Warm, congratulatory, direct. HIGH-INTENT trigger. More direct ask for a call. Always attach quarterly report.',
  '{"open_rate_target": 0.50, "response_rate_target": 0.15, "call_conversion_target": 0.08}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;

-- T-014: Report Request Fulfillment (Inbound)
INSERT INTO template_definitions (template_id, template_version, category, name, description, domain, packet_bindings, mandatory_variables, optional_variables, subject_template, body_template, tone_notes, performance_targets)
VALUES (
  'T-014', 1, 'seller_bd', 'Report Request Fulfillment',
  'Response to inbound interest — someone requested our quarterly capital markets report. Shorter, warmer version.',
  NULL,
  ARRAY['contact', 'domain_aggregate'],
  ARRAY['contact.full_name', 'domain', 'quarter_year'],
  ARRAY['team.track_record_summary'],
  'The {{domain}} Capital Markets Report ({{quarter_year}})',
  E'{{contact.full_name}},\n\nThank you for your interest in our capital markets report for the {{domain}}-leased space. Please see the attached {{quarter_year}} update. This is a report that my team maintains daily and updates quarterly which aims to track the trends and trades, from a broad perspective, in the {{domain}}-leased investment sales markets. The pages included herein are an attempt to provide real-time value to you and your business as well as provide insight into the level of service and quality of work our team is capable of providing to our clients.\n\n{{#if team.track_record_summary}}{{team.track_record_summary}}{{/if}} Please do not hesitate to reach out if there is anything we can do to assist. We look forward to the opportunity to leverage our firm''s collective specialization, knowledge, track record and expertise to your benefit.\n\nBest regards,\nScott Briggs',
  'Brief, appreciative, professional. They came to us — no need for the hard sell.',
  '{"open_rate_target": 0.70, "reply_rate_target": 0.05}'
)
ON CONFLICT (template_id, template_version) DO NOTHING;
