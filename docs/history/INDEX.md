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
