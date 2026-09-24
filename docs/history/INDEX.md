# Historical Documents Index

This directory holds **point-in-time worklogs, audits, prompt briefs, session
records, and fix lists** that were moved out of the repo root during the
2026-07 root cleanup. They are historical artifacts — retained for provenance
and reference, **not** living documentation. Living/reference docs (setup
guides, specs, plans, strategies, blueprints, policies, and the canon such as
`CLAUDE.md`, `AGENTS.md`, `LCC-OS.md`,
`ROLLOUT.md`) stay at the repo root or under `docs/`.

> Note: some archived docs contain in-prose cross-references to files that
> remain at the repo root. ⚠️ **UPDATED 2026-08-28:** `INFRASTRUCTURE.md`, `RUNBOOK.md` and `GAPS_AND_FINDINGS_REGISTER.md` are **no longer at the root** — see the infra/hosting/monitoring cluster entry below. Those
> historical mentions were left as-authored and are not clickable links.

Grouped by topic (document type), each sorted by date.

---

## Status / worklog archives (the "opens with current state" splits)

Living status files are trimmed forward; the tail lands here **verbatim**, never summarised.

| Document | What it holds | Split on |
| --- | --- | --- |
| [STATUS_claude-code_2026-08-03_to_2026-08-12.md](STATUS_claude-code_2026-08-03_to_2026-08-12.md) | The tail of `docs/claude-code/STATUS.md`: comps arc prompts 19–60, Wave 8 hygiene, Wave 9 connectedness, ChatGPT/Copilot surface rollout, the 2026-08-03 security + deploy-pending notes | 2026-08-26 (Prompt 141) |
| [STATUS_claude-code_2026-08-20_to_2026-08-21.md](STATUS_claude-code_2026-08-20_to_2026-08-21.md) | `STATUS.md` entries 2026-08-20 → 08-21 (the W6.5 decomposition, P119–P121 mailbox mirror, P124/P125 draft-assist), verbatim | 2026-09-02 (first cut) |
| [STATUS_claude-code_2026-08-20_to_2026-08-28_cowork-block.md](STATUS_claude-code_2026-08-20_to_2026-08-28_cowork-block.md) | The contiguous `STATUS.md` block at former lines 6605–9212: the 2026-08-26/27 Cowork entries (Tier 0 P186–P198, A1–A5c, C1, B1), two 08-28 Cowork entries, and the P121–P130 draft-assist entries, verbatim. ⚠️ Chosen as a contiguous span — `STATUS.md` is not date-sorted | 2026-09-02 (second cut) |
| [CLAUDE_full_2026-07.md](CLAUDE_full_2026-07.md) | The full per-round worklog R5→R64 split out of `CLAUDE.md` | 2026-07 |
| [AGENTS_full_2026-07.md](AGENTS_full_2026-07.md) | The `AGENTS.md` counterpart | 2026-07 |
| [DOCS_CONSOLIDATION_2026-08-26.md](DOCS_CONSOLIDATION_2026-08-26.md) | What the 2026-08-26 consolidation moved and where, plus the full **preservation manifest** (every contemplated feature carried forward) | 2026-08-26 |

---

## Claude Code prompt briefs

Task/prompt specifications handed to Claude Code across rounds.

| Document | Topic | Date |
| --- | --- | --- |
| [claude-code-prompts.md](claude-code-prompts.md) | Initial prompt set | — |
| [claude-code-prompts-data-pipeline.md](claude-code-prompts-data-pipeline.md) | Data pipeline prompts | — |
| [claude-code-prompts-round3.md](claude-code-prompts-round3.md) | Round 3 prompts | — |
| [claude-code-prompts-round4.md](claude-code-prompts-round4.md) | Round 4 prompts | — |
| [claude-code-prompts-round5-data-pipeline.md](claude-code-prompts-round5-data-pipeline.md) | Round 5 data pipeline prompts | — |
| [claude-code-prompts-round6.md](claude-code-prompts-round6.md) | Round 6 prompts | — |
| [Claude_Code_Prompts_Final_Propagation_Fixes.md](Claude_Code_Prompts_Final_Propagation_Fixes.md) | Final propagation fixes | — |
| [Claude_Code_Prompts_Lease_Provenance.md](Claude_Code_Prompts_Lease_Provenance.md) | Lease provenance | — |
| [Claude_Code_Prompts_Remaining_Fixes.md](Claude_Code_Prompts_Remaining_Fixes.md) | Remaining fixes | — |
| [Claude_Code_Prompts_SaleNotes_DocIngestion.md](Claude_Code_Prompts_SaleNotes_DocIngestion.md) | Sale-notes / document ingestion | — |
| [CLAUDE_CODE_PROMPT_cms_match_coverage.md](CLAUDE_CODE_PROMPT_cms_match_coverage.md) | CMS match coverage | — |
| [CLAUDE_CODE_PROMPT_land_yearbuilt_coverage.md](CLAUDE_CODE_PROMPT_land_yearbuilt_coverage.md) | Land / year-built coverage | — |
| [CLAUDE_CODE_PROMPT_lease_ask_extraction.md](CLAUDE_CODE_PROMPT_lease_ask_extraction.md) | Lease ask extraction | — |
| [CLAUDE_CODE_PROMPT_rent_imputation_caps.md](CLAUDE_CODE_PROMPT_rent_imputation_caps.md) | Rent imputation caps | — |
| [CLAUDE_CODE_PROMPT_sales_dedup_conflicts.md](CLAUDE_CODE_PROMPT_sales_dedup_conflicts.md) | Sales dedup conflicts | — |
| [CLAUDE_CODE_PROMPT_round74_salesforce_authoritative_nm.md](CLAUDE_CODE_PROMPT_round74_salesforce_authoritative_nm.md) | Round 74 — Salesforce authoritative NM | — |
| [DATA_QUALITY_PROMPT.md](DATA_QUALITY_PROMPT.md) | Data quality | — |
| [INTEL_TAB_BACKEND_PROMPT.md](INTEL_TAB_BACKEND_PROMPT.md) | Intel tab backend | — |
| [LOCATION_CODE_INTEGRATION_PROMPT.md](LOCATION_CODE_INTEGRATION_PROMPT.md) | Location-code integration | — |
| [MARKETING_REARCHITECTURE_PROMPT.md](MARKETING_REARCHITECTURE_PROMPT.md) | Marketing re-architecture | — |
| [MARKETING_TAB_FIXES_PROMPT.md](MARKETING_TAB_FIXES_PROMPT.md) | Marketing tab fixes | — |
| [RCM_LEAD_PARSING_PROMPT.md](RCM_LEAD_PARSING_PROMPT.md) | RCM lead parsing | — |
| [SUPABASE_OPTIMIZATION_PROMPT.md](SUPABASE_OPTIMIZATION_PROMPT.md) | Supabase optimization | — |
| [UNIFIED_CONTACT_HUB_PROMPT.md](UNIFIED_CONTACT_HUB_PROMPT.md) | Unified contact hub | — |
| [future_enhancement_prompts.md](future_enhancement_prompts.md) | Future enhancement backlog | — |

## Audits & forensics

| Document | Topic | Date |
| --- | --- | --- |
| [DATA_INTEGRITY_AUDIT_2026-05-20.md](DATA_INTEGRITY_AUDIT_2026-05-20.md) | Data integrity | 2026-05-20 |
| [RECONCILE_FUNCTION_AUDIT_2026-05-21.md](RECONCILE_FUNCTION_AUDIT_2026-05-21.md) | Reconcile function | 2026-05-21 |
| [DATA_AUDIT_SESSION_INDEX_2026-05-21.md](DATA_AUDIT_SESSION_INDEX_2026-05-21.md) | Data-audit session index | 2026-05-21 |
| [OWNERSHIP_AND_SALES_AUDIT_2026-05-23.md](OWNERSHIP_AND_SALES_AUDIT_2026-05-23.md) | Ownership & sales | 2026-05-23 |
| [COMPS_LEASE_CAPRATE_MONITORING_AUDIT_2026-05-29.md](COMPS_LEASE_CAPRATE_MONITORING_AUDIT_2026-05-29.md) | Comps / lease cap-rate monitoring | 2026-05-29 |
| [R4B_DASHBOARD_STATS_FORENSIC_2026-06-04.md](R4B_DASHBOARD_STATS_FORENSIC_2026-06-04.md) | Dashboard stats forensic | 2026-06-04 |
| [CM_EXPORT_CHART_AUDIT_2026-06-22_RESPONSE.md](CM_EXPORT_CHART_AUDIT_2026-06-22_RESPONSE.md) | Capital-markets export chart audit response | 2026-06-22 |
| [APP_AUDIT_REMAINING_ISSUES.md](APP_AUDIT_REMAINING_ISSUES.md) | App audit — remaining issues | — |
| [CoStar_Ingestion_Audit_12316_Molly_Pitcher.md](CoStar_Ingestion_Audit_12316_Molly_Pitcher.md) | CoStar ingestion (12316 Molly Pitcher) | — |
| [CoStar_Ingestion_Audit_15002_Amargosa.md](CoStar_Ingestion_Audit_15002_Amargosa.md) | CoStar ingestion (15002 Amargosa) | — |
| [DEVELOPER_BD_AUDIT_v3.md](DEVELOPER_BD_AUDIT_v3.md) | BD engine developer audit (v3) | — |
| [EDGE_FUNCTION_AUDIT.md](EDGE_FUNCTION_AUDIT.md) | Supabase edge-function inventory | — |
| [VERCEL_FUNCTION_AUDIT.md](VERCEL_FUNCTION_AUDIT.md) | Vercel function inventory | — |
| [GOV_UX_AUDIT_REPORT.md](GOV_UX_AUDIT_REPORT.md) | Government UX | — |
| [SALESFORCE_LCC_DOCUMENT_INGESTION_AUDIT.md](SALESFORCE_LCC_DOCUMENT_INGESTION_AUDIT.md) | Salesforce → LCC document ingestion | — |
| [SALESFORCE_NOTES_INGESTION_AUDIT_PLAN.md](SALESFORCE_NOTES_INGESTION_AUDIT_PLAN.md) | Salesforce notes ingestion (audit + plan) | — |
| [SHAREFILE_SYSTEM_DATA_AUDIT.md](SHAREFILE_SYSTEM_DATA_AUDIT.md) | ShareFile system data | — |

## Worklogs & remediation logs

| Document | Topic | Date |
| --- | --- | --- |
| [DATA_INTEGRITY_REMEDIATION_LOG_2026-05-20.md](DATA_INTEGRITY_REMEDIATION_LOG_2026-05-20.md) | Data-integrity remediation | 2026-05-20 |
| [COPILOT_CAPABILITY_ASSESSMENT_WORKLOG.md](COPILOT_CAPABILITY_ASSESSMENT_WORKLOG.md) | Copilot capability assessment | — |
| [GIT_SYNC_SECRET_FIX_WORKLOG.md](GIT_SYNC_SECRET_FIX_WORKLOG.md) | Git sync secret fix | — |
| [GIT_PULL_RECOVERY_LOG.md](GIT_PULL_RECOVERY_LOG.md) | Git pull recovery | — |
| [LCC_AUDIT_LOOP_CLOSURE_WORKLOG.md](LCC_AUDIT_LOOP_CLOSURE_WORKLOG.md) | Audit loop-closure | — |
| [LCC_LIVE_INGEST_WORKLOG.md](LCC_LIVE_INGEST_WORKLOG.md) | Live ingest | — |
| [LCC_VERCEL_404_AUDIT_WORKLOG.md](LCC_VERCEL_404_AUDIT_WORKLOG.md) | Vercel 404 triage | — |

## Session records

| Document | Topic | Date |
| --- | --- | --- |
| [SESSION_HANDOFF_2026-05-21.md](SESSION_HANDOFF_2026-05-21.md) | Session handoff | 2026-05-21 |
| [SESSION_CHANGELOG_COMPS_AUDIT_2026-05-29.md](SESSION_CHANGELOG_COMPS_AUDIT_2026-05-29.md) | Comps-audit session changelog | 2026-05-29 |
| [SESSION_SUMMARY.md](SESSION_SUMMARY.md) | Session summary | — |

## Fix lists

| Document | Topic | Date |
| --- | --- | --- |
| [LCC_FIX_LIST.md](LCC_FIX_LIST.md) | Fix list | — |
| [LCC_FIX_LIST_ROUND2.md](LCC_FIX_LIST_ROUND2.md) | Fix list — round 2 | — |

## DOCMAP3 (2026-09-24) — loose `docs/` root files, duplicate folders and root specs filed by topic

Every move used `git mv` (history kept), and inbound path references were rewritten in the same change.
Nothing was deleted. Each move was decided from a full read of the file by one of four read-only agents.
Open intent they found was filed in `PLANNED-BACKLOG.md` (`CONTACTS-GOV-WRITER`, `CONSOLIDATE-REVERSIBLE`,
`BRIDGES-DORMANT`, `SJC-BROKER-SYNC`, `DOCMAP3-shareinbox`, `DOCMAP3-sftask`, `DOCMAP3-govlinkpick`, `DOCMAP3-residue`).
Shipped backlog rows archived the same day: [`PLANNED-BACKLOG_shipped_2026-09-24.md`](PLANNED-BACKLOG_shipped_2026-09-24.md).

| old path | new path | reason |
| --- | --- | --- |
| `docs/AUTH_ENFORCEMENT_ROLLOUT.md` | `docs/setup/AUTH_ENFORCEMENT_ROLLOUT.md` | live runbook or procedure; stale-claim banner added |
| `docs/BD_ENGINE_POST_WORK_AUDIT_2026-05-22.md` | `docs/history/worklogs/BD_ENGINE_POST_WORK_AUDIT_2026-05-22.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/BRIEFING_EMAIL_ALERT_AUDIT_2026-06-05.md` | `docs/audits/BRIEFING_EMAIL_ALERT_AUDIT_2026-06-05.md` | dated measurement (evidence); stale-claim banner added |
| `docs/BRIEFING_EMAIL_FLOW_v2.md` | `docs/architecture/flows/BRIEFING_EMAIL_FLOW_v2.md` | live reference for a subsystem; stale-claim banner added |
| `docs/CM_CLOSEOUT_PUNCH_LIST_2026-08-09.md` | `docs/capital-markets/CM_CLOSEOUT_PUNCH_LIST_2026-08-09.md` | capital-markets specifics; stale-claim banner added |
| `docs/CONTACTS_SPLIT_BRAIN_CUTOVER_RUNBOOK.md` | `docs/history/CONTACTS_SPLIT_BRAIN_CUTOVER_RUNBOOK.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/CONTACTS_SPLIT_BRAIN_DELTA_2026-07-21.md` | `docs/audits/CONTACTS_SPLIT_BRAIN_DELTA_2026-07-21.md` | dated measurement (evidence); stale-claim banner added |
| `docs/CONTACT_ENRICH_ADAPTERS.md` | `docs/setup/CONTACT_ENRICH_ADAPTERS.md` | live runbook or procedure; stale-claim banner added |
| `docs/DRAFT_AND_LOG_ACTION_ENGINE.md` | `docs/architecture/DRAFT_AND_LOG_ACTION_ENGINE.md` | live reference for a subsystem; stale-claim banner added |
| `docs/EMAIL_AUTO_ARCHIVE.md` | `docs/architecture/EMAIL_AUTO_ARCHIVE.md` | live reference for a subsystem; stale-claim banner added |
| `docs/INFRA_ALERT_CLASSIFICATION.md` | `docs/architecture/INFRA_ALERT_CLASSIFICATION.md` | live reference for a subsystem; stale-claim banner added |
| `docs/INTEGRATION_BRIDGES.md` | `docs/architecture/INTEGRATION_BRIDGES.md` | live reference for a subsystem; stale-claim banner added |
| `docs/KNOWN_ISSUES.md` | `docs/history/KNOWN_ISSUES.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/LCC_Copilot_Bidirectional_Plan_2026-04-21.md` | `docs/history/LCC_Copilot_Bidirectional_Plan_2026-04-21.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/LCC_OM_Ingestion_Surfaces_2026-04-21.md` | `docs/history/LCC_OM_Ingestion_Surfaces_2026-04-21.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/MOBILE_SHARE_INGESTION.md` | `docs/setup/MOBILE_SHARE_INGESTION.md` | live runbook or procedure |
| `docs/Northmarq_Brand_Rollout_Plan.md` | `docs/history/Northmarq_Brand_Rollout_Plan.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/PENDING_UPDATES_UX_FRICTION_LOG.md` | `docs/audits/PENDING_UPDATES_UX_FRICTION_LOG_2026-05-06.md` | dated measurement (evidence); stale-claim banner added |
| `docs/PHASE1_5_USER_MAPPINGS_AND_WRITEBACK.md` | `docs/history/PHASE1_5_USER_MAPPINGS_AND_WRITEBACK.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/PHASE1_SALESFORCE_BRIDGES.md` | `docs/history/PHASE1_SALESFORCE_BRIDGES.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/PHASE2_5_SHAREPOINT_EXTRACT.md` | `docs/history/PHASE2_5_SHAREPOINT_EXTRACT.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/PHASE2_SHAREPOINT_BRIDGES.md` | `docs/history/PHASE2_SHAREPOINT_BRIDGES.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/PHASE3_5_TIMELINE_INTEGRATION.md` | `docs/architecture/PHASE3_5_TIMELINE_INTEGRATION.md` | live reference for a subsystem; stale-claim banner added |
| `docs/PHASE3_OUTLOOK_CALENDAR_BRIDGES.md` | `docs/architecture/PHASE3_OUTLOOK_CALENDAR_BRIDGES.md` | live reference for a subsystem; stale-claim banner added |
| `docs/PHASE4_CADENCE_ENGINE.md` | `docs/history/PHASE4_CADENCE_ENGINE.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/PR1_APPLY_GUIDE.md` | `docs/history/worklogs/PR1_APPLY_GUIDE.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/PR1_pending_updates_ux.patch` | `docs/history/worklogs/PR1_pending_updates_ux.patch` | superseded, finished or never-activated |
| `docs/PR2_INTAKE.md` | `docs/history/worklogs/PR2_INTAKE.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/R42_caprate_recompute_signoff_2026-06-18.md` | `docs/audits/R42_caprate_recompute_signoff_2026-06-18.md` | dated measurement (evidence); stale-claim banner added |
| `docs/RAILWAY_DEPLOYMENT.md` | `docs/history/RAILWAY_DEPLOYMENT.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/RUNBOOK_sf_opportunity_inbound_flow.md` | `docs/history/RUNBOOK_sf_opportunity_inbound_flow.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/RUNBOOK_sf_task_compliance_ops.md` | `docs/setup/RUNBOOK_sf_task_compliance_ops.md` | live runbook or procedure |
| `docs/SF_ACTIVITY_ARCHIVED_HISTORY.md` | `docs/audits/SF_ACTIVITY_ARCHIVED_HISTORY.md` | dated measurement (evidence) |
| `docs/STATE_GOV_LEASE_GAP_MEMO_2026-06-23.md` | `docs/audits/STATE_GOV_LEASE_GAP_MEMO_2026-06-23.md` | dated measurement (evidence); stale-claim banner added |
| `docs/STATE_LEASE_MULTI_STATE_ROLLOUT_PLAN.md` | `docs/architecture/STATE_LEASE_MULTI_STATE_ROLLOUT_PLAN.md` | live reference for a subsystem; stale-claim banner added |
| `docs/T4C_RECOVERY_on_market_backfill.md` | `docs/audits/T4C_RECOVERY_on_market_backfill_2026-06-24.md` | dated measurement (evidence); stale-claim banner added |
| `docs/UW4_LEASE_OCR.md` | `docs/history/UW4_LEASE_OCR.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/UW6_REV_document_byte_capture.md` | `docs/history/UW6_REV_document_byte_capture.md` | superseded, finished or never-activated |
| `docs/architecture-lease-ownership-sf.md` | `docs/history/architecture-lease-ownership-sf.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/availability_checker_acceptance.md` | `docs/setup/availability_checker_acceptance.md` | live runbook or procedure; stale-claim banner added |
| `docs/cm-pdf-vs-export-chart-deltas.md` | `docs/capital-markets/cm-pdf-vs-export-chart-deltas.md` | capital-markets specifics; stale-claim banner added |
| `docs/financial_model_methodology.md` | `docs/history/financial_model_methodology.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/ios-shortcut-send-to-lcc.md` | `docs/setup/ios-shortcut-send-to-lcc.md` | live runbook or procedure; stale-claim banner added |
| `docs/marketing_leads_activity_taxonomy.md` | `docs/architecture/marketing_leads_activity_taxonomy.md` | live reference for a subsystem |
| `docs/round_76be_consolidate_button_patches.md` | `docs/history/worklogs/round_76be_consolidate_button_patches.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/round_76bi_outlook_sync_fix.md` | `docs/history/worklogs/round_76bi_outlook_sync_fix.md` | superseded, finished or never-activated |
| `docs/round_76bj_ui_fixes.md` | `docs/history/worklogs/round_76bj_ui_fixes.md` | superseded, finished or never-activated |
| `docs/round_76bk_om_promoter_field_gaps.md` | `docs/history/worklogs/round_76bk_om_promoter_field_gaps.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/round_76ej_gov_property_extension.md` | `docs/history/worklogs/round_76ej_gov_property_extension.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/round_76et_perf_dq_verification_sweep.md` | `docs/history/worklogs/round_76et_perf_dq_verification_sweep.md` | superseded, finished or never-activated |
| `docs/runbooks/sjc_broker_contact_sync.md` | `docs/setup/sjc_broker_contact_sync.md` | live runbook or procedure; stale-claim banner added |
| `SPEC_BOV_Lease_Extractor_Unit4.md` | `docs/history/SPEC_BOV_Lease_Extractor_Unit4.md` | superseded, finished or never-activated; stale-claim banner added |
| `SPEC_BOV_Lease_Extractor_Unit4_BUILD.md` | `docs/history/SPEC_BOV_Lease_Extractor_Unit4_BUILD.md` | superseded, finished or never-activated; stale-claim banner added |
| `SPEC_forsale_om_and_webpage_ingest.md` | `docs/history/SPEC_forsale_om_and_webpage_ingest.md` | superseded, finished or never-activated; stale-claim banner added |
| `SPEC_sos_direct_scraper.md` | `docs/history/SPEC_sos_direct_scraper.md` | superseded, finished or never-activated; stale-claim banner added |
| `docs/round68a/R68A_FINAL_REPORT.md` | `docs/history/round68a/R68A_FINAL_REPORT.md` | superseded, finished or never-activated |
| `docs/round68a/R68A_RE_DATE_PLAN.md` | `docs/history/round68a/R68A_RE_DATE_PLAN.md` | superseded, finished or never-activated |
| `docs/round68a/R68A_SYNTHESIS_PLAN.md` | `docs/history/round68a/R68A_SYNTHESIS_PLAN.md` | superseded, finished or never-activated |
| `docs/round68a/R68A_TASK3_COVERAGE.md` | `docs/history/round68a/R68A_TASK3_COVERAGE.md` | superseded, finished or never-activated |
| `docs/round68a/R68A_VIEW_MATRIX.md` | `docs/history/round68a/R68A_VIEW_MATRIX.md` | superseded, finished or never-activated |
| `docs/round68a/README.md` | `docs/history/round68a/README.md` | superseded, finished or never-activated |
| `docs/round68a/round68a_synthesis_plan.json` | `docs/history/round68a/round68a_synthesis_plan.json` | superseded, finished or never-activated |
| `docs/cm/dia-master-template-chart-inventory.txt` | `docs/capital-markets/dia-master-template-chart-inventory.txt` | folder collapse: one capital-markets home |
| `docs/cm/editable-charts-plan.md` | `docs/capital-markets/editable-charts-plan.md` | folder collapse: one capital-markets home |
| `docs/cm/native-chart-migration-summary.md` | `docs/capital-markets/native-chart-migration-summary.md` | folder collapse: one capital-markets home |
| `docs/claude/README.md` | `docs/history/claude-surface-instructions-legacy/README.md` | legacy surface instructions superseded by the canon (`docs/os/surfaces/`); NOT-AUTHORITATIVE banner added |
| `docs/claude/northmarq-claude-instructions.md` | `docs/history/claude-surface-instructions-legacy/northmarq-claude-instructions.md` | legacy surface instructions superseded by the canon (`docs/os/surfaces/`); NOT-AUTHORITATIVE banner added |
| `docs/claude/personal-claude-instructions.md` | `docs/history/claude-surface-instructions-legacy/personal-claude-instructions.md` | legacy surface instructions superseded by the canon (`docs/os/surfaces/`); NOT-AUTHORITATIVE banner added |
