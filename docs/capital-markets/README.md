# `docs/capital-markets/` — topic index

⚠️ **This directory's name is misleading, and that is the most useful thing to know about it.**
Of its 156 markdown files, **115 are archived Claude Code prompts** (`CLAUDE_CODE_PROMPT_*`) spanning the
whole application, not capital-markets work. Only **41** are capital-markets or adjacent material, and
only a handful of those are the quarterly book itself. A session looking for capital-markets docs should
read the first two sections and ignore the rest; a session looking for prompt history should know it lives
here rather than in `docs/claude-code/prompts/done/`, where it belongs.
Reorganising it is filed as **DOCS-CM-MISFILED** in [`docs/os/PLANNED-BACKLOG.md`](../os/PLANNED-BACKLOG.md)
— deliberately not done here, because these files carry inbound links from `STATUS.md`,
`docs/architecture/` and several processed prompts, and a mass move without rewriting those leaves a worse
state than the one it fixes.

> Titles are read from each file's own H1, never summarised. Dated audits and worklogs are **evidence, not
> current state** — the backlog is the open-work list.

Non-markdown files here (5 `.json`, 1 `.py`, and `sf-exports/`) are not listed.

## Quarterly book — copy and client correspondence (4)

The actual capital-markets work product: State of the Market book copy and the email threads around it.

| document | what it covers |
|---|---|
| [`Dialysis Book - Page 14-15 Updated Copy (2026-08-18).md`](./Dialysis Book - Page 14-15 Updated Copy (2026-08-18).md) | Dialysis Market Filter 2Q-2026 — Page 14 & 15 replacement copy |
| [`Email - Dialysis Book 2Q26 Draft Comments (2026-08-12).md`](./Email - Dialysis Book 2Q26 Draft Comments (2026-08-12).md) | (no H1) |
| [`Email - Dialysis Book Final Edits (2026-08-18).md`](./Email - Dialysis Book Final Edits (2026-08-18).md) | (no H1) |
| [`Email - Dialysis Book Reply to Final Questions (2026-08-19).md`](./Email - Dialysis Book Reply to Final Questions (2026-08-19).md) | (no H1) |

## Runbooks, standards and conventions (9)

Repeatable process. These are the pages most likely to still be current.

| document | what it covers |
|---|---|
| [`CIS_CLOSED_IS_INGESTION_RUNBOOK.md`](./CIS_CLOSED_IS_INGESTION_RUNBOOK.md) | Recurring Salesforce Closed-IS (CIS) ingestion → `dia_nm_cis_closings` |
| [`CM_PACKET_REFRESH_RUNBOOK.md`](./CM_PACKET_REFRESH_RUNBOOK.md) | CM frozen-packet refresh — how it runs, how to verify it (P122, 2026-08-21) |
| [`CONTACT_SELECTION_STANDARD.md`](./CONTACT_SELECTION_STANDARD.md) | Contact-Selection Standard — which human to prospect for an owner-company (2026-06-20, rev. 2) |
| [`FILE_HYGIENE_CONVENTIONS.md`](./FILE_HYGIENE_CONVENTIONS.md) | Work-product file hygiene — STANDING CONVENTION (apply to every request) |
| [`PA_FLOW_SF_RECORD_LOOKUP_BUILD.md`](./PA_FLOW_SF_RECORD_LOOKUP_BUILD.md) | Build the "SF → LCC: Record Lookup by ID" Power Automate flow (step by step) |
| [`TIER3_LANE_MAP.md`](./TIER3_LANE_MAP.md) | Tier 3 — Decision Center lane rationalization map (Phase 1) |
| [`UNIVERSAL_MASTER_SHEET_STRUCTURE.md`](./UNIVERSAL_MASTER_SHEET_STRUCTURE.md) | Universal Master-Sheet Structure — the Briggs/Northmarq standard (2026-06-22) |
| [`WORK_PRODUCT_FRAMEWORK.md`](./WORK_PRODUCT_FRAMEWORK.md) | Briggs / Northmarq Work-Product Framework (foundational, 2026-06-20) |
| [`WORK_PRODUCT_SELF_IMPROVEMENT.md`](./WORK_PRODUCT_SELF_IMPROVEMENT.md) | Work-product self-improvement structure (2026-06-22) |

## Audits and diagnoses (dated) (20)

Point-in-time evidence. NOT current state — re-measure before acting on any of these.

| document | what it covers |
|---|---|
| [`CM_EXPORT_CHART_AUDIT_2026-06-22.md`](./CM_EXPORT_CHART_AUDIT_2026-06-22.md) | Capital Markets Export — Chart Comment Audit (2026-06-22) |
| [`CM_EXPORT_OPEN_TOPICS_CATALOG.md`](./CM_EXPORT_OPEN_TOPICS_CATALOG.md) | Capital Markets Export — Open Topics Catalog (working tracker) |
| [`COMPS_QUALITY_AUDIT_2026-06-22.md`](./COMPS_QUALITY_AUDIT_2026-06-22.md) | Comps quality audit — sales + lease (2026-06-22) |
| [`CONNECTIVITY_GAP_AUDIT_2026-06-17.md`](./CONNECTIVITY_GAP_AUDIT_2026-06-17.md) | Connectivity-gap audit — where the data graph isn't fully connected (2026-06-17) |
| [`DEEP_DIVE_AUDIT_data_quality_review_and_connectivity.md`](./DEEP_DIVE_AUDIT_data_quality_review_and_connectivity.md) | Deep-dive audit — Data Quality review surfaces, auto-resolution, and cross-DB connectivity |
| [`GOV_CREDIT_TIER_PROPAGATION_AUDIT_2026-08-11.md`](./GOV_CREDIT_TIER_PROPAGATION_AUDIT_2026-08-11.md) | Government Credit-Tier Propagation Audit — 2026-08-11 |
| [`OM_BOV_ASSEMBLY_READINESS_AUDIT_2026-06-21.md`](./OM_BOV_ASSEMBLY_READINESS_AUDIT_2026-06-21.md) | OM/BOV master-sheet assembly-readiness audit (2026-06-21) |
| [`ROUND66_AUDIT_2026-06-01.md`](./ROUND66_AUDIT_2026-06-01.md) | Round-66 Comment Audit vs Live Export (2026-06-01) |
| [`ROUND66_DATA_AUDIT_2026-06-01.md`](./ROUND66_DATA_AUDIT_2026-06-01.md) | Capital Markets — Data-Only Chart Audit (2026-06-01) |
| [`ROUND66_EXPORT_FEEDBACK_WORKLOG.md`](./ROUND66_EXPORT_FEEDBACK_WORKLOG.md) | Capital Markets — Round 66 Export Feedback Worklog |
| [`ROUND66_POST_EXPORT_DATA_WORKPLAN.md`](./ROUND66_POST_EXPORT_DATA_WORKPLAN.md) | Round 66 — Post-Export Data Workplan (dia + gov) |
| [`ROUND68_BATCH3_DIA_DIAGNOSIS_2026-06-05.md`](./ROUND68_BATCH3_DIA_DIAGNOSIS_2026-06-05.md) | Round 68 batch 3 — dia sold-side history depth (R68-B) + YOY/index (R68-D) |
| [`ROUND69_TASK6_THREE_REVIEWS_2026-06-06.md`](./ROUND69_TASK6_THREE_REVIEWS_2026-06-06.md) | Round 69 — Task 6: final three per-chart reviews (gov) |
| [`ROUND70_B5_TAIL_RECEIPTS_2026-06-07.md`](./ROUND70_B5_TAIL_RECEIPTS_2026-06-07.md) | Round 70 — B5 tail + terminated heuristic — receipts & verdicts (2026-06-07) |
| [`ROUND74C_SF_COMP_DECONTAM_2026-06-09.md`](./ROUND74C_SF_COMP_DECONTAM_2026-06-09.md) | Round 74c — de-contaminate `is_northmarq` against the SF Internal Comp export |
| [`ROUND74D_SF_COMP_DECONTAM_2026-06-10.md`](./ROUND74D_SF_COMP_DECONTAM_2026-06-10.md) | Round 74d — finish the dia `is_northmarq` de-contamination (all-comps re-check + held removes) |
| [`SALESFORCE_PIPELINE_AUDIT_2026-06-22.md`](./SALESFORCE_PIPELINE_AUDIT_2026-06-22.md) | Salesforce / pipeline data-quality audit (2026-06-22) |
| [`SESSION_STATUS_2026-06-22.md`](./SESSION_STATUS_2026-06-22.md) | Capital Markets session status — consolidated (2026-06-22) |
| [`UNDERWRITING_DATA_QUALITY_AUDIT_2026-06-20.md`](./UNDERWRITING_DATA_QUALITY_AUDIT_2026-06-20.md) | Underwriting data-quality ingestion audit (2026-06-20) |
| [`UX_CONSOLIDATION_AUDIT.md`](./UX_CONSOLIDATION_AUDIT.md) | Life Command Center — Data Quality / Review / Merge Surfaces: UX Consolidation Audit |

## Recovery, attribution and provenance worklogs (dated) (8)

Also point-in-time.

| document | what it covers |
|---|---|
| [`GOV_NM_COMP_PROMOTION_2026-06-23.md`](./GOV_NM_COMP_PROMOTION_2026-06-23.md) | GOV Northmarq comp → sales `is_northmarq` promotion (ongoing) — 2026-06-23 |
| [`NM_CLOSED_IS_DEAL_ATTRIBUTION_2026-06-23.md`](./NM_CLOSED_IS_DEAL_ATTRIBUTION_2026-06-23.md) | NM attribution from Salesforce "Closed IS" deals — dia + gov (2026-06-23) |
| [`R2D_COMP_RECOVERY_375_HANDOFF.md`](./R2D_COMP_RECOVERY_375_HANDOFF.md) | R2-D Comp__c recovery — 375 pending comps + price-history floor (2026-06-30) |
| [`R2D_OM_DATE_RECOVERY_YIELD.md`](./R2D_OM_DATE_RECOVERY_YIELD.md) | R2-D — recover real on-market dates for the `date_uncertain` dia listings |
| [`R74e_TASK6C_listing_date_analysis.md`](./R74e_TASK6C_listing_date_analysis.md) | R74e Task 6c — dia listing_date backfill + stop the over-stamp writer |
| [`T4c_ITEM3_ONMARKET_REPOINT_RECEIPTS.md`](./T4c_ITEM3_ONMARKET_REPOINT_RECEIPTS.md) | T4c Item 3 — on_market_date timing repoint: isolation-check receipts (2026-06-24) |
| [`T4c_ON_MARKET_DATE_PROVENANCE.md`](./T4c_ON_MARKET_DATE_PROVENANCE.md) | T4c — on-market-date PROVENANCE model + mass-forward guard (2026-06-24) |
| [`T9_CAP_DATA_INTEGRITY_2026-06-25.md`](./T9_CAP_DATA_INTEGRITY_2026-06-25.md) | T9 — cap-rate data anomalies (investigate → fix; data before axis) |

## Archived Claude Code prompts (115)

Grouped by the series token in the filename. These are **historical prompts, already run** — they
record what was asked for, not what shipped. For what shipped, read the backlog row of the same name.

| series | n | prompts |
|---|---|---|
| **AGENCY** | 1 | [`agency_tier_infra`](./CLAUDE_CODE_PROMPT_agency_tier_infra.md) |
| **BID** | 1 | [`bid_ask_spread_data`](./CLAUDE_CODE_PROMPT_bid_ask_spread_data.md) |
| **CAP** | 1 | [`cap_rate_of_record`](./CLAUDE_CODE_PROMPT_cap_rate_of_record.md) |
| **CM** | 2 | [`CM_CHART_FIXES`](./CLAUDE_CODE_PROMPT_CM_CHART_FIXES.md) · [`CM_FINAL_CLOSEOUT`](./CLAUDE_CODE_PROMPT_CM_FINAL_CLOSEOUT.md) |
| **CONNECTIVITY** | 7 | [`CONNECTIVITY1_classify_owners_to_bridge`](./CLAUDE_CODE_PROMPT_CONNECTIVITY1_classify_owners_to_bridge.md) · [`CONNECTIVITY1b_harden_before_scale`](./CLAUDE_CODE_PROMPT_CONNECTIVITY1b_harden_before_scale.md) · [`CONNECTIVITY2_resolve_recorded_to_true_owner`](./CLAUDE_CODE_PROMPT_CONNECTIVITY2_resolve_recorded_to_true_owner.md) · [`CONNECTIVITY3_salesforce_reconciliation`](./CLAUDE_CODE_PROMPT_CONNECTIVITY3_salesforce_reconciliation.md) · [`CONNECTIVITY4_resolve_gov_owners`](./CLAUDE_CODE_PROMPT_CONNECTIVITY4_resolve_gov_owners.md) · [`CONNECTIVITY5_6_canonical_col_and_cleanup`](./CLAUDE_CODE_PROMPT_CONNECTIVITY5_6_canonical_col_and_cleanup.md) · [`CONNECTIVITY7_self_healing_resolution_sweep`](./CLAUDE_CODE_PROMPT_CONNECTIVITY7_self_healing_resolution_sweep.md) |
| **CONTACT** | 2 | [`CONTACT_ENRICHMENT_ADAPTERS`](./CLAUDE_CODE_PROMPT_CONTACT_ENRICHMENT_ADAPTERS.md) · [`CONTACT_SELECTION_BUILD`](./CLAUDE_CODE_PROMPT_CONTACT_SELECTION_BUILD.md) |
| **DIA** | 5 | [`dia_cap_by_term_deck_repro`](./CLAUDE_CODE_PROMPT_dia_cap_by_term_deck_repro.md) · [`dia_cap_by_term_propagate`](./CLAUDE_CODE_PROMPT_dia_cap_by_term_propagate.md) · [`dia_data_integrity_MASTER`](./CLAUDE_CODE_PROMPT_dia_data_integrity_MASTER.md) · [`dia_listing_date_2025_backfill`](./CLAUDE_CODE_PROMPT_dia_listing_date_2025_backfill.md) · [`dia_master_parity_round`](./CLAUDE_CODE_PROMPT_dia_master_parity_round.md) |
| **FOLDER** | 1 | [`folder_feed_enrichment_brain_hub`](./CLAUDE_CODE_PROMPT_folder_feed_enrichment_brain_hub.md) |
| **FOLLOWUP** | 2 | [`FOLLOWUP_junk_entity_lane_rescope`](./CLAUDE_CODE_PROMPT_FOLLOWUP_junk_entity_lane_rescope.md) · [`FOLLOWUP_junk_lane_dealstring_correction`](./CLAUDE_CODE_PROMPT_FOLLOWUP_junk_lane_dealstring_correction.md) |
| **GOV** | 6 | [`GOV_BROKEN_QUERIES`](./CLAUDE_CODE_PROMPT_GOV_BROKEN_QUERIES.md) · [`GOV_POST_DEPLOY_HOTFIX`](./CLAUDE_CODE_PROMPT_GOV_POST_DEPLOY_HOTFIX.md) · [`gov_credit_tier_ingestion_propagation`](./CLAUDE_CODE_PROMPT_gov_credit_tier_ingestion_propagation.md) · [`gov_listing_history_capture`](./CLAUDE_CODE_PROMPT_gov_listing_history_capture.md) · [`gov_renewal_cagr_per_lease`](./CLAUDE_CODE_PROMPT_gov_renewal_cagr_per_lease.md) · [`gov_valuation_engine_design`](./CLAUDE_CODE_PROMPT_gov_valuation_engine_design.md) |
| **LEASE** | 7 | [`LEASE_COMPS_CANONICAL_MERGE`](./CLAUDE_CODE_PROMPT_LEASE_COMPS_CANONICAL_MERGE.md) · [`lease_backfill_resume_drain`](./CLAUDE_CODE_PROMPT_lease_backfill_resume_drain.md) · [`lease_backfill_serverside_drain`](./CLAUDE_CODE_PROMPT_lease_backfill_serverside_drain.md) · [`lease_create_400_diagnose_and_reclassify`](./CLAUDE_CODE_PROMPT_lease_create_400_diagnose_and_reclassify.md) · [`lease_dateless_reason_and_match_basis`](./CLAUDE_CODE_PROMPT_lease_dateless_reason_and_match_basis.md) · [`lease_location_guard_and_draft_policy`](./CLAUDE_CODE_PROMPT_lease_location_guard_and_draft_policy.md) · [`lease_term_capture`](./CLAUDE_CODE_PROMPT_lease_term_capture.md) |
| **LISTING** | 1 | [`listing_lifecycle_integrity_exploration`](./CLAUDE_CODE_PROMPT_listing_lifecycle_integrity_exploration.md) |
| **MASTER** | 1 | [`MASTER_SHEET_GENERATOR`](./CLAUDE_CODE_PROMPT_MASTER_SHEET_GENERATOR.md) |
| **MISINGESTION** | 1 | [`misingestion_sweep`](./CLAUDE_CODE_PROMPT_misingestion_sweep.md) |
| **MULTITENANT** | 2 | [`multitenant_contamination_guard_and_cleanup`](./CLAUDE_CODE_PROMPT_multitenant_contamination_guard_and_cleanup.md) · [`multitenant_guard_chokepoint_followup`](./CLAUDE_CODE_PROMPT_multitenant_guard_chokepoint_followup.md) |
| **NBT** | 2 | [`NBT1_next_best_touchpoint_engine`](./CLAUDE_CODE_PROMPT_NBT1_next_best_touchpoint_engine.md) · [`NBT2_sf_activity_ingest_tasks_events`](./CLAUDE_CODE_PROMPT_NBT2_sf_activity_ingest_tasks_events.md) |
| **NM** | 4 | [`NM_ATTRIBUTION_DIALYSIS`](./CLAUDE_CODE_PROMPT_NM_ATTRIBUTION_DIALYSIS.md) · [`NM_ATTRIBUTION_LIVE_FEED`](./CLAUDE_CODE_PROMPT_NM_ATTRIBUTION_LIVE_FEED.md) · [`NM_ATTRIBUTION_PROPAGATION`](./CLAUDE_CODE_PROMPT_NM_ATTRIBUTION_PROPAGATION.md) · [`NM_CONSUME_CLOSED_IS_DEALS`](./CLAUDE_CODE_PROMPT_NM_CONSUME_CLOSED_IS_DEALS.md) |
| **OPERATOR** | 2 | [`operator_gate_cms_resolution_fix`](./CLAUDE_CODE_PROMPT_operator_gate_cms_resolution_fix.md) · [`operator_normalization`](./CLAUDE_CODE_PROMPT_operator_normalization.md) |
| **OPS** | 1 | [`OPS_dia_gov_disk_health_monitor`](./CLAUDE_CODE_PROMPT_OPS_dia_gov_disk_health_monitor.md) |
| **OUTREACH** | 1 | [`OUTREACH1_close_sf_activity_to_cadence_advance`](./CLAUDE_CODE_PROMPT_OUTREACH1_close_sf_activity_to_cadence_advance.md) |
| **PROPERTY** | 1 | [`property_merge_sale_fk_and_function_hardening`](./CLAUDE_CODE_PROMPT_property_merge_sale_fk_and_function_hardening.md) |
| **R** | 4 | [`R2A_desmooth_axis_round2`](./CLAUDE_CODE_PROMPT_R2A_desmooth_axis_round2.md) · [`R2B_datastart_redesign`](./CLAUDE_CODE_PROMPT_R2B_datastart_redesign.md) · [`R2C_data_integrity`](./CLAUDE_CODE_PROMPT_R2C_data_integrity.md) · [`R2D_om_date_recovery`](./CLAUDE_CODE_PROMPT_R2D_om_date_recovery.md) |
| **RENT** | 1 | [`rent_at_sale`](./CLAUDE_CODE_PROMPT_rent_at_sale.md) |
| **ROUND** | 20 | [`round68_batch1_volume_and_formatting`](./CLAUDE_CODE_PROMPT_round68_batch1_volume_and_formatting.md) · [`round68_batch2_dia_listing_depth`](./CLAUDE_CODE_PROMPT_round68_batch2_dia_listing_depth.md) · [`round68_batch3_dia_sold_history`](./CLAUDE_CODE_PROMPT_round68_batch3_dia_sold_history.md) · [`round68_batch4_gov_data`](./CLAUDE_CODE_PROMPT_round68_batch4_gov_data.md) · [`round69_june5_notes`](./CLAUDE_CODE_PROMPT_round69_june5_notes.md) · [`round69_task6_reviews`](./CLAUDE_CODE_PROMPT_round69_task6_reviews.md) · [`round70_b5_tail`](./CLAUDE_CODE_PROMPT_round70_b5_tail.md) · [`round70_june6_notes`](./CLAUDE_CODE_PROMPT_round70_june6_notes.md) · [`round71_gov_master_7d_import`](./CLAUDE_CODE_PROMPT_round71_gov_master_7d_import.md) · [`round72_cagr_perf`](./CLAUDE_CODE_PROMPT_round72_cagr_perf.md) · [`round73_june8_notes`](./CLAUDE_CODE_PROMPT_round73_june8_notes.md) · [`round73_remainder_layers_CD`](./CLAUDE_CODE_PROMPT_round73_remainder_layers_CD.md) · [`round74_salesforce_authoritative_nm`](./CLAUDE_CODE_PROMPT_round74_salesforce_authoritative_nm.md) · [`round74b_classify_staged_sf`](./CLAUDE_CODE_PROMPT_round74b_classify_staged_sf.md) · [`round74c_internal_comp_decontamination`](./CLAUDE_CODE_PROMPT_round74c_internal_comp_decontamination.md) · [`round74d_dia_held_removes_allcomps`](./CLAUDE_CODE_PROMPT_round74d_dia_held_removes_allcomps.md) · [`round74e_task4_import_task6c_listingdate`](./CLAUDE_CODE_PROMPT_round74e_task4_import_task6c_listingdate.md) · [`round75_gov_valindex_renewalrate_perf`](./CLAUDE_CODE_PROMPT_round75_gov_valindex_renewalrate_perf.md) · [`round76_EFG_design_gov20_outlier`](./CLAUDE_CODE_PROMPT_round76_EFG_design_gov20_outlier.md) · [`round76_june10_export_review`](./CLAUDE_CODE_PROMPT_round76_june10_export_review.md) |
| **T** | 21 | [`T1_chart_history_truncation`](./CLAUDE_CODE_PROMPT_T1_chart_history_truncation.md) · [`T2_axis_fit`](./CLAUDE_CODE_PROMPT_T2_axis_fit.md) · [`T3_cap_by_term_formula_audit`](./CLAUDE_CODE_PROMPT_T3_cap_by_term_formula_audit.md) · [`T3b_asking_cap_by_term_desmooth`](./CLAUDE_CODE_PROMPT_T3b_asking_cap_by_term_desmooth.md) · [`T4_available_counts`](./CLAUDE_CODE_PROMPT_T4_available_counts.md) · [`T4b_om_intake_listing_dates`](./CLAUDE_CODE_PROMPT_T4b_om_intake_listing_dates.md) · [`T4c_item3_timing_repoint`](./CLAUDE_CODE_PROMPT_T4c_item3_timing_repoint.md) · [`T4c_onmarket_date_provenance`](./CLAUDE_CODE_PROMPT_T4c_onmarket_date_provenance.md) · [`T4c_sf_comp_pull_backfill`](./CLAUDE_CODE_PROMPT_T4c_sf_comp_pull_backfill.md) · [`T4c_sf_record_lookup`](./CLAUDE_CODE_PROMPT_T4c_sf_record_lookup.md) · [`T7_returns_index_desmooth_extend`](./CLAUDE_CODE_PROMPT_T7_returns_index_desmooth_extend.md) · [`T8U3_T10bc_final`](./CLAUDE_CODE_PROMPT_T8U3_T10bc_final.md) · [`T8_active_lease_inventory_from_snapshots`](./CLAUDE_CODE_PROMPT_T8_active_lease_inventory_from_snapshots.md) · [`T9_cap_data_anomalies`](./CLAUDE_CODE_PROMPT_T9_cap_data_anomalies.md) · [`T9b_dia_listing_lifecycle_cleanup`](./CLAUDE_CODE_PROMPT_T9b_dia_listing_lifecycle_cleanup.md) · [`T9c_phantom_freshness_stale_sf_comps`](./CLAUDE_CODE_PROMPT_T9c_phantom_freshness_stale_sf_comps.md) · [`T9d2_provenance_first_currency`](./CLAUDE_CODE_PROMPT_T9d2_provenance_first_currency.md) · [`T9d3_fix_om_dates`](./CLAUDE_CODE_PROMPT_T9d3_fix_om_dates.md) · [`T9d_REVERT`](./CLAUDE_CODE_PROMPT_T9d_REVERT.md) · [`T9d_dia_listing_currency_rearchitecture`](./CLAUDE_CODE_PROMPT_T9d_dia_listing_currency_rearchitecture.md) · [`T9e_property_sale_events_orphans`](./CLAUDE_CODE_PROMPT_T9e_property_sale_events_orphans.md) |
| **TIER** | 5 | [`TIER0_gov_junk_shell_quarantine`](./CLAUDE_CODE_PROMPT_TIER0_gov_junk_shell_quarantine.md) · [`TIER1_detector_split_provenance_autoresolve`](./CLAUDE_CODE_PROMPT_TIER1_detector_split_provenance_autoresolve.md) · [`TIER2_gated_automerge_and_detector_rescope`](./CLAUDE_CODE_PROMPT_TIER2_gated_automerge_and_detector_rescope.md) · [`TIER3_decision_center_consolidation`](./CLAUDE_CODE_PROMPT_TIER3_decision_center_consolidation.md) · [`TIER4_connectivity`](./CLAUDE_CODE_PROMPT_TIER4_connectivity.md) |
| **UW** | 12 | [`UW1_county_digest_and_capture`](./CLAUDE_CODE_PROMPT_UW1_county_digest_and_capture.md) · [`UW2_activate_lease_extractor`](./CLAUDE_CODE_PROMPT_UW2_activate_lease_extractor.md) · [`UW2b_lease_extractor_fixes`](./CLAUDE_CODE_PROMPT_UW2b_lease_extractor_fixes.md) · [`UW4_lease_ocr_pass`](./CLAUDE_CODE_PROMPT_UW4_lease_ocr_pass.md) · [`UW4b_ocr_cost_optimization`](./CLAUDE_CODE_PROMPT_UW4b_ocr_cost_optimization.md) · [`UW4c_integrate_google_document_ai`](./CLAUDE_CODE_PROMPT_UW4c_integrate_google_document_ai.md) · [`UW5_federal_demand_signal_digest`](./CLAUDE_CODE_PROMPT_UW5_federal_demand_signal_digest.md) · [`UW6_document_deep_parse_drain`](./CLAUDE_CODE_PROMPT_UW6_document_deep_parse_drain.md) · [`UW6_fix_capture_reliability_and_ocr`](./CLAUDE_CODE_PROMPT_UW6_fix_capture_reliability_and_ocr.md) · [`UW6c_complete_doctype_backfill`](./CLAUDE_CODE_PROMPT_UW6c_complete_doctype_backfill.md) · [`UW7_developer_resolution`](./CLAUDE_CODE_PROMPT_UW7_developer_resolution.md) · [`UW7b_endpoint_auth_and_developer_guard`](./CLAUDE_CODE_PROMPT_UW7b_endpoint_auth_and_developer_guard.md) |
| **WORK** | 1 | [`WORK_PRODUCT_FRAMEWORK_BUILD`](./CLAUDE_CODE_PROMPT_WORK_PRODUCT_FRAMEWORK_BUILD.md) |

