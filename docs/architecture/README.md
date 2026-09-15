# `docs/architecture/` — topic index

188 design documents live in this directory and it had no entry point, so every session arrived and
guessed. This index groups them by topic. It is **generated from each file's own H1**, never from a
summary of what a file is assumed to contain.

> ⚠️ **A design document is a design document.** Several of these describe intended behaviour that
> was never built, or that has since drifted. This repo's standing rule applies: **check the live
> system before acting on any page here.** Current open work lives in
> [`docs/os/PLANNED-BACKLOG.md`](../os/PLANNED-BACKLOG.md); the running narrative is
> [`docs/claude-code/STATUS.md`](../claude-code/STATUS.md).

Non-markdown assets in this directory (HTML dossier examples, `copilot_action_registry.json`,
`signal_table_schema.sql`, and the `flows/`, `office-scripts/`, `ai-chat-routing/`,
`backfill-artifacts/` subdirectories) are not listed below.

## Start here — orientation (9)

The pages a new session should read before anything else.

| document | what it covers |
|---|---|
| [`DOSSIER-PROGRAM-STATE-OF-PLAY.md`](./DOSSIER-PROGRAM-STATE-OF-PLAY.md) | Dossier Program — State of Play (START HERE) — updated 2026-08-01 |
| [`HOMEPAGE-ATTENTION-SURFACE.md`](./HOMEPAGE-ATTENTION-SURFACE.md) | The homepage attention surface (HP1) — one door into Today and the Inbox |
| [`LCC_DOCUMENTATION_RECONCILIATION_2026-08-11.md`](./LCC_DOCUMENTATION_RECONCILIATION_2026-08-11.md) | LCC Documentation Reconciliation — Architecture, OS, and Power Automate |
| [`MIGRATION-COVERAGE-MAP.md`](./MIGRATION-COVERAGE-MAP.md) | Migration-coverage map — which repo watches which database for unapplied migrations |
| [`connectivity-and-open-threads.md`](./connectivity-and-open-threads.md) | LCC — Connectivity Map + Open Threads |
| [`cross-cutting-design.md`](./cross-cutting-design.md) | Cross-Cutting Layers — design specs (build later, decide now) |
| [`data-availability-map.md`](./data-availability-map.md) | Data-availability map — what powers the intelligence layer (2026-07-31) |
| [`design-considerations.md`](./design-considerations.md) | Design Considerations & Open Layers — pre-build review |
| [`infrastructure-topology.md`](./infrastructure-topology.md) | Infrastructure Topology |

## Ownership, entities and identity (25)

The owner/entity truth chain — the largest active arc in the repo.

| document | what it covers |
|---|---|
| [`ADR-004-CANONICAL-PERSON-IDENTITY.md`](./ADR-004-CANONICAL-PERSON-IDENTITY.md) | ADR-004: Canonical Person Identity |
| [`address_normalization_spec.md`](./address_normalization_spec.md) | Address Normalization Spec |
| [`broker-and-firm-identity.md`](./broker-and-firm-identity.md) | Broker & firm identity — how names are stored, and what is NOT a defect |
| [`contact-entity-resolution.md`](./contact-entity-resolution.md) | Contact → Entity resolution — the gap is entity *creation*, not matching (A2) |
| [`deal-address-resolution-design.md`](./deal-address-resolution-design.md) | Deal-Property Address Resolution — extend the Owner Reconcile Engine (ORE) |
| [`dia-ownership-master-bridge-2026-08.md`](./dia-ownership-master-bridge-2026-08.md) | Dialysis Ownership MASTER as an ownership bridge — findings, 2026-08-18 |
| [`entity-identity-and-dedup.md`](./entity-identity-and-dedup.md) | Entity identity & dedup — canonical topic page |
| [`entity-reconciliation-design.md`](./entity-reconciliation-design.md) | Entity Reconciliation — design spec (A1) |
| [`gov-asset-identity-coverage-2026-08.md`](./gov-asset-identity-coverage-2026-08.md) | gov asset-identity coverage — what actually caps the owner subsystem, 2026-08-18 |
| [`gov-property-duplicates.md`](./gov-property-duplicates.md) | gov property-address duplicates — GOVDUP1 (2026-09-05) |
| [`owner-reconciliation-engine.md`](./owner-reconciliation-engine.md) | Owner Reconciliation Engine |
| [`owner-role-classification.md`](./owner-role-classification.md) | Owner-role classification — the canonical design |
| [`ownership-data-provenance.md`](./ownership-data-provenance.md) | Ownership Data Provenance & Responsibility Tracking — Schema Design |
| [`ownership-history-lane.md`](./ownership-history-lane.md) | Ownership-history lane — canonical reference |
| [`ownership-truth-pipeline-state.md`](./ownership-truth-pipeline-state.md) | The ownership → true-owner → CRM truth pipeline — state of play (2026-09-10) |
| [`property-contact-deal-connectivity.md`](./property-contact-deal-connectivity.md) | Property ↔ Contact ↔ Deal connectivity model — 2026-08-01 |
| [`property-identity-and-address-resolution.md`](./property-identity-and-address-resolution.md) | Property Identity and Address Resolution Contract v0.1 |
| [`property-metadata-coverage.md`](./property-metadata-coverage.md) | Property metadata coverage (dia) — the canonical entry point |
| [`property-owner-panel-redesign-2026-08.md`](./property-owner-panel-redesign-2026-08.md) | Property + Owner Panel Redesign — page-by-page target state (2026-08-15) |
| [`property-owner-source-authority-and-doctrine.md`](./property-owner-source-authority-and-doctrine.md) | Property-Owner Source Authority + Salesforce Doctrine (2026-07-31) |
| [`property-owner-subsystem.md`](./property-owner-subsystem.md) | Property-Owner Subsystem — finding, design, status (2026-07-31) |
| [`public-records-source-lane.md`](./public-records-source-lane.md) | Public records as an independent source lane (assessor / parcel / tax / deed) |
| [`sf-note-records-ownership-bridge-2026-08.md`](./sf-note-records-ownership-bridge-2026-08.md) | Salesforce note records as an ownership bridge — findings, 2026-08-17 |
| [`supersession-tie-lane-2026-08.md`](./supersession-tie-lane-2026-08.md) | The supersession tie lane is a role artifact, not an evidence gap — 2026-08-19 |
| [`tier0-owner-contact-system.md`](./tier0-owner-contact-system.md) | Tier 0 owner-contact system — the canonical reference |

## Deal spine, dossiers and the deal surface (20)

| document | what it covers |
|---|---|
| [`BUILD-01-sf-opportunity-sync.md`](./BUILD-01-sf-opportunity-sync.md) | BUILD 01 — SF Opportunity Sync (the spine's first step) |
| [`BUILD-01B-sf-deal-sync-flow.md`](./BUILD-01B-sf-deal-sync-flow.md) | BUILD 01B — Power Automate flow: "SF Deal → LCC Opportunity Sync" |
| [`SF-WRITEBACK-AND-DOSSIER-BUILD-STATE.md`](./SF-WRITEBACK-AND-DOSSIER-BUILD-STATE.md) | Deal Dossier + Salesforce Write-Back — Build State & Resume Guide |
| [`W7_1_deal_email_match_dryrun_2026-08-06.md`](./W7_1_deal_email_match_dryrun_2026-08-06.md) | W7.1 — Deal-email matcher: full-corpus dry-run report (2026-08-06) |
| [`closed-deal-asset-entity-and-deal-spine.md`](./closed-deal-asset-entity-and-deal-spine.md) | Closed-deal asset entity + deal-spine wiring (spec) — 2026-08-01 |
| [`closed-loop-reconciliation.md`](./closed-loop-reconciliation.md) | BD Copilot — Closed-Loop Reconciliation (analysis + status, 2026-07-31) |
| [`deal-backbone-design-refinements.md`](./deal-backbone-design-refinements.md) | Deal Backbone — Design Refinements (post-BUILD-01, real data) |
| [`deal-correspondence-attribution.md`](./deal-correspondence-attribution.md) | Deal Correspondence Attribution — mail-intake's real delta |
| [`deal-party-roster-source.md`](./deal-party-roster-source.md) | Deal-Party Roster — Source Re-Spec (finding from BUILD 02 Slice B) |
| [`deal-surface-packet-and-layout.md`](./deal-surface-packet-and-layout.md) | Deal Surface — packet contract + app layout — 2026-08-01 |
| [`documents-and-dossiers-design.md`](./documents-and-dossiers-design.md) | Documents (OM viewer) + Property/Deal Dossiers — design (2026-07-31) |
| [`dossier-design-vs-production-23654.md`](./dossier-design-vs-production-23654.md) | Dossier Design vs Production Reconciliation - 5247 Airways Blvd / property 23654 |
| [`dossier-followup-prompts-for-claude-code.md`](./dossier-followup-prompts-for-claude-code.md) | Dossier build — copy/paste prompts for Claude Code |
| [`dossier-generation-and-ollama-wiring.md`](./dossier-generation-and-ollama-wiring.md) | Dossier generation — Ollama wiring, storage & access architecture (2026-08-01) |
| [`dossier-production-wiring-runbook.md`](./dossier-production-wiring-runbook.md) | Dossier Generator — Production Wiring & Operator Runbook (2026-08-01) |
| [`dossier-reconciliation-23654-worklog.md`](./dossier-reconciliation-23654-worklog.md) | Dossier Reconciliation 23654 Worklog |
| [`dossier-standard-and-llm-contract.md`](./dossier-standard-and-llm-contract.md) | Dossier Standard — Property & Deal (grounded, LLM-replicable) — 2026-07-31 |
| [`dossier-v2-audit-and-triage.md`](./dossier-v2-audit-and-triage.md) | Dossier v2 — Data Audit & Pipeline Triage (gold standard: 5247 Airways Blvd, Memphis · property 23654) |
| [`living-deal-dossier-and-systems-connection.md`](./living-deal-dossier-and-systems-connection.md) | Living Deal Dossier + Systems-Connection Architecture — 2026-08-01 |
| [`matcher-recall-design.md`](./matcher-recall-design.md) | Deal-Email Matcher — recall v2 design (A5) |

## Salesforce, Microsoft and Power Automate (22)

| document | what it covers |
|---|---|
| [`NBT_PHASE2_sf_activity_sync.md`](./NBT_PHASE2_sf_activity_sync.md) | NBT Phase 2 — SF-Activity sync (the progress + response signal) |
| [`POWER-AUTOMATE-API-HTML-TRIAGE-CODEX-PROMPT-2026-08-11.md`](./POWER-AUTOMATE-API-HTML-TRIAGE-CODEX-PROMPT-2026-08-11.md) | Codex Prompt: Power Automate API / HTML Response Triage |
| [`SALESFORCE-METADATA-GAP-MATRIX-2026-08-11.md`](./SALESFORCE-METADATA-GAP-MATRIX-2026-08-11.md) | Salesforce Metadata Gap Matrix |
| [`SALESFORCE-PAYLOAD-FIELD-PROFILE-2026-08-11.md`](./SALESFORCE-PAYLOAD-FIELD-PROFILE-2026-08-11.md) | Salesforce Payload Field Profile |
| [`lcc-microsoft-copilot-outlook-audit-2026-05-22.md`](./lcc-microsoft-copilot-outlook-audit-2026-05-22.md) | LCC ↔ Microsoft (Copilot + Outlook) — Audit & Bridge Plan |
| [`lcc-microsoft-salesforce-pipeline-gap-analysis.md`](./lcc-microsoft-salesforce-pipeline-gap-analysis.md) | LCC ↔ Microsoft / Salesforce Pipeline — Gap Analysis |
| [`microsoft-surface-architecture.md`](./microsoft-surface-architecture.md) | Microsoft-surface architecture — decision note (2026-08-03) |
| [`outlook_intake_pa_base64_fix.md`](./outlook_intake_pa_base64_fix.md) | PA Outlook Intake — Base64 Upload Fix |
| [`outlook_intake_team_visibility_workflow.md`](./outlook_intake_team_visibility_workflow.md) | Outlook -> Intake -> Teams (Wave 1) — Current vs Hardened |
| [`power-automate-api-html-triage-2026-08-11.md`](./power-automate-api-html-triage-2026-08-11.md) | Power Automate API / HTML Triage Evidence Report |
| [`power-automate-audit-worklog.md`](./power-automate-audit-worklog.md) | Power Automate Audit Worklog |
| [`power-automate-flow-audit.md`](./power-automate-flow-audit.md) | Power Automate Flow Audit Registry (LCC + Salesforce + Microsoft 365) |
| [`power-automate-observability-standards.md`](./power-automate-observability-standards.md) | Power Automate Observability & Reliability Standards |
| [`power-automate-remediation-plan.md`](./power-automate-remediation-plan.md) | Power Automate Remediation Plan (Microsoft + Salesforce + LCC) |
| [`salesforce_nm_authoritative_sync.md`](./salesforce_nm_authoritative_sync.md) | Salesforce as the authoritative source for `is_northmarq` (Round 74) |
| [`scott-pa-flows-reference.md`](./scott-pa-flows-reference.md) | Scott Briggs — Power Automate Flow Reference & Action List |
| [`sf-owner-capture.md`](./sf-owner-capture.md) | Salesforce owner capture → owner-scoped My Day |
| [`sf_connected_app_setup.md`](./sf_connected_app_setup.md) | Salesforce Connected App Setup — Server-Side File Fetch |
| [`sf_daily_bulk_backfill_RUNBOOK.md`](./sf_daily_bulk_backfill_RUNBOOK.md) | Runbook — SF → LCC: Daily Bulk File Backfill (Flow 7) |
| [`sf_deal_closing_email_ingest_PLAN.md`](./sf_deal_closing_email_ingest_PLAN.md) | Deal Closing Announcement email → recorded sale (PLAN, 2026-06-23) |
| [`sf_file_backfill_flow6_next_steps.md`](./sf_file_backfill_flow6_next_steps.md) | Flow 6 (`SF -> LCC: On-demand File Backfill`) — Next-Session Notes |
| [`teams_daily_briefing_delivery_workflow.md`](./teams_daily_briefing_delivery_workflow.md) | Teams Daily Briefing Delivery (Wave 1) |

## Intake, documents and OCR (8)

| document | what it covers |
|---|---|
| [`INTAKE_TODO_FLOW_AUDIT_2026-07-23.md`](./INTAKE_TODO_FLOW_AUDIT_2026-07-23.md) | Intake → staging → completion → To-Do flow audit (2026-07-23) |
| [`ai-and-ocr-cost-strategy.md`](./ai-and-ocr-cost-strategy.md) | AI & OCR cost strategy — local vs Microsoft vs Google |
| [`correspondence-ingestion-design.md`](./correspondence-ingestion-design.md) | Deal-correspondence ingestion — design (2026-07-31) |
| [`document-capture-and-ocr-status.md`](./document-capture-and-ocr-status.md) | Document capture-at-ingest & OCR — status + the one open loop |
| [`document-capture-ocr-and-deeds.md`](./document-capture-ocr-and-deeds.md) | Document capture, OCR and deeds — THE canonical page |
| [`intake_promote_round_76_recap.md`](./intake_promote_round_76_recap.md) | Round 76 Recap — Intake Promotion Restoration |
| [`om_intake_pipeline.md`](./om_intake_pipeline.md) | OM Intake Pipeline — Canonical Reference |
| [`team-mailbox-intake-design.md`](./team-mailbox-intake-design.md) | Team Mailbox Intake (B2) — design spec |

## Comps, rent and lease data (9)

| document | what it covers |
|---|---|
| [`comps-data-integrity-and-canonical-record.md`](./comps-data-integrity-and-canonical-record.md) | Comps data quality → the canonical-record initiative (2026-08-04) |
| [`comps-pipeline-gap-audit-2026-08.md`](./comps-pipeline-gap-audit-2026-08.md) | Comps Pipeline — Gap Audit (2026-08-05) |
| [`data-quality-lease-and-owner.md`](./data-quality-lease-and-owner.md) | Data Quality — Lease Duplicates + Property-Owner Accuracy (2026-07-31) |
| [`lease-data-provenance.md`](./lease-data-provenance.md) | Lease Data Provenance & Responsibility Tracking — Schema Design |
| [`rent-intelligence-engine-phase1-discovery.md`](./rent-intelligence-engine-phase1-discovery.md) | Rent Intelligence Engine — Phase 1 Discovery Report |
| [`rent-intelligence-engine-phase2-report.md`](./rent-intelligence-engine-phase2-report.md) | Rent Intelligence Engine — Phase 2 Report (Spine + Builder) |
| [`rent-intelligence-engine-phase3-report.md`](./rent-intelligence-engine-phase3-report.md) | Rent Intelligence Engine — Phase 3 Report (Reconciliation loop + intake hooks) |
| [`rent-intelligence-engine-phase4-report.md`](./rent-intelligence-engine-phase4-report.md) | Rent Intelligence Engine — Phase 4 Report (Serving) + Build Close-Out |
| [`rent-intelligence-engine-phase5-report.md`](./rent-intelligence-engine-phase5-report.md) | Rent Intelligence Engine — Phase 5 Report: The Self-Improving Loop |

## Briefs, monitors and producer health (12)

| document | what it covers |
|---|---|
| [`EXEC-BRIEFS-SPEC.md`](./EXEC-BRIEFS-SPEC.md) | Executive Briefs — Market Briefs per swimlane (MB) + CTO/CDO Build Brief (XB) + Operator Funnel (OC) |
| [`activity-coverage-audit.md`](./activity-coverage-audit.md) | Activity-coverage audit — active-deal "going cold" signal (2026-07-31) |
| [`briefing-analyst-take-onprem.md`](./briefing-analyst-take-onprem.md) | P138 / R8 Stage 1 — the daily brief's "Analyst's Take", generated on-box |
| [`cadence-engine.md`](./cadence-engine.md) | Cadence Engine — stage-aware pipeline monitoring |
| [`daily_briefing_home_panel_note.md`](./daily_briefing_home_panel_note.md) | Daily Briefing Home Panel Note |
| [`daily_briefing_integration_plan.md`](./daily_briefing_integration_plan.md) | Daily Briefing Integration Plan |
| [`daily_briefing_payload_contract.md`](./daily_briefing_payload_contract.md) | Daily Briefing Payload Contract (Wave 1 Slice) |
| [`edge-function-deploy-drift.md`](./edge-function-deploy-drift.md) | Edge function deploy drift (DRIFT1) |
| [`market_brief_payload_contract.md`](./market_brief_payload_contract.md) | Market Brief Payload Contract (EB1 foundation slice) |
| [`operator_note_contract.md`](./operator_note_contract.md) | Operator Note Contract (EB1 foundation slice) |
| [`proactive-deal-monitor.md`](./proactive-deal-monitor.md) | Proactive Deal Monitor — architecture & design |
| [`producer-health-and-ci-enforcement.md`](./producer-health-and-ci-enforcement.md) | Producer health & CI enforcement — the canonical entry point |

## Healthcare verticals — ASC, IDTF, oncology, dialysis (19)

| document | what it covers |
|---|---|
| [`HEALTHCARE-ASC-FIRST-STAGING-RUNBOOK-v0.1.md`](./HEALTHCARE-ASC-FIRST-STAGING-RUNBOOK-v0.1.md) | Healthcare ASC-First Private Artifact Staging Runbook v0.1 |
| [`HEALTHCARE-ASC-IDTF-ECONOMICS-AND-SAMPLING-v0.1.md`](./HEALTHCARE-ASC-IDTF-ECONOMICS-AND-SAMPLING-v0.1.md) | Healthcare ASC and IDTF Economics and Sampling Plan v0.1 |
| [`HEALTHCARE-ASC-IDTF-LCC-INTEGRATION-CONTRACT-v0.1.md`](./HEALTHCARE-ASC-IDTF-LCC-INTEGRATION-CONTRACT-v0.1.md) | Healthcare ASC and IDTF LCC Integration Contract v0.1 |
| [`HEALTHCARE-ASC-IDTF-PRIVATE-RUN-AUTHORIZATION-v0.1.md`](./HEALTHCARE-ASC-IDTF-PRIVATE-RUN-AUTHORIZATION-v0.1.md) | Healthcare ASC and Fixed-Site IDTF Private Run Authorization v0.1 |
| [`HEALTHCARE-ASC-IDTF-SOURCE-MANIFEST-CONTRACTS-v0.1.md`](./HEALTHCARE-ASC-IDTF-SOURCE-MANIFEST-CONTRACTS-v0.1.md) | Healthcare ASC and Fixed-Site IDTF Source Manifest Contracts v0.1 |
| [`HEALTHCARE-REAL-ESTATE-AND-ECONOMICS-BUSINESS-PLAN-v0.1.md`](./HEALTHCARE-REAL-ESTATE-AND-ECONOMICS-BUSINESS-PLAN-v0.1.md) | Healthcare Real Estate and Economics Business Plan v0.1 |
| [`HEALTHCARE-SOURCE-SUFFICIENCY-CARDS-ASC-IMAGING-v0.1.md`](./HEALTHCARE-SOURCE-SUFFICIENCY-CARDS-ASC-IMAGING-v0.1.md) | Healthcare Source-Sufficiency Cards: ASC and Diagnostic Imaging v0.1 |
| [`HEALTHCARE-SWIM-LANE-EVALUATION-MATRIX-v0.1.md`](./HEALTHCARE-SWIM-LANE-EVALUATION-MATRIX-v0.1.md) | Healthcare Swim-Lane Evaluation Matrix v0.1 |
| [`ONCOLOGY-INFUSION-IMPLEMENTATION-READINESS-PACKAGE-v0.1.md`](./ONCOLOGY-INFUSION-IMPLEMENTATION-READINESS-PACKAGE-v0.1.md) | Oncology / Infusion Implementation Readiness Package v0.1 |
| [`ONCOLOGY-INFUSION-NPPES-SOURCE-ADAPTER-SPEC-v0.1.md`](./ONCOLOGY-INFUSION-NPPES-SOURCE-ADAPTER-SPEC-v0.1.md) | Oncology / Infusion NPPES Source Adapter Specification v0.1 |
| [`ONCOLOGY-INFUSION-PHASE-A-BUILD-PLAN-v0.1.md`](./ONCOLOGY-INFUSION-PHASE-A-BUILD-PLAN-v0.1.md) | Oncology / Infusion Phase A Build Plan v0.1 |
| [`ONCOLOGY-INFUSION-PILOT-COHORT-SPEC-v0.1.md`](./ONCOLOGY-INFUSION-PILOT-COHORT-SPEC-v0.1.md) | Oncology / Infusion Pilot Cohort Specification v0.1 |
| [`ONCOLOGY-INFUSION-PRIVATE-VERIFICATION-SAMPLE-v0.1.md`](./ONCOLOGY-INFUSION-PRIVATE-VERIFICATION-SAMPLE-v0.1.md) | Oncology / Infusion Private Verification Sample v0.1 |
| [`ONCOLOGY-INFUSION-READ-ONLY-PROFILE-PLAN-v0.1.md`](./ONCOLOGY-INFUSION-READ-ONLY-PROFILE-PLAN-v0.1.md) | Oncology / Infusion Read-Only Profile Plan v0.1 |
| [`ONCOLOGY-INFUSION-READ-ONLY-PROFILE-RESULT-2026-08-11.md`](./ONCOLOGY-INFUSION-READ-ONLY-PROFILE-RESULT-2026-08-11.md) | Oncology / Infusion Read-Only Profile Result |
| [`ONCOLOGY-INFUSION-SERVICE-CORROBORATION-ADR-005.md`](./ONCOLOGY-INFUSION-SERVICE-CORROBORATION-ADR-005.md) | ADR-005: Oncology / Infusion Service Corroboration |
| [`ONCOLOGY-INFUSION-STAGING-AND-INGESTION-CONTRACT-v0.1.md`](./ONCOLOGY-INFUSION-STAGING-AND-INGESTION-CONTRACT-v0.1.md) | Oncology / Infusion Staging and Ingestion Contract v0.1 |
| [`OUTPATIENT-HEALTHCARE-LANE-PACK-SPEC-v0.1.md`](./OUTPATIENT-HEALTHCARE-LANE-PACK-SPEC-v0.1.md) | Outpatient Healthcare Lane Pack Specification v0.1 |
| [`dialysis-economics-and-medicare-data.md`](./dialysis-economics-and-medicare-data.md) | Dialysis economics & Medicare data — what is measured, what is modeled |

## Copilot, agents, MCP and the intelligence layer (29)

| document | what it covers |
|---|---|
| [`WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md`](./WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md) | Wave 7 — Comms-Driven Context Propagation (email/call → dossier/tasks/next-steps, automatically) |
| [`account-based-contact-intelligence.md`](./account-based-contact-intelligence.md) | Account-Based Contact Intelligence — design brief |
| [`actor-attribution-phase1.md`](./actor-attribution-phase1.md) | Actor Attribution (B2 Phase 1) — foundation done + code change spec |
| [`ai-next-step-engine-PHASE1-BUILT.md`](./ai-next-step-engine-PHASE1-BUILT.md) | AI next-step engine — Phase 1 BUILT (delta on ai-next-step-engine-scope.md) |
| [`ai-next-step-engine-scope.md`](./ai-next-step-engine-scope.md) | Content-aware next-step engine — scope + AI hosting options |
| [`connected-agent-architecture.md`](./connected-agent-architecture.md) | Connected-Agent Architecture (LCC + Surfaces + Work IQ) |
| [`connected-agent-descriptions.md`](./connected-agent-descriptions.md) | Connected-Agent Descriptions & Routing Text |
| [`context_broker_api_spec.md`](./context_broker_api_spec.md) | Context Broker API Specification |
| [`context_packet_schema.md`](./context_packet_schema.md) | Context Packet Schema |
| [`copilot_action_registry.md`](./copilot_action_registry.md) | Copilot Action Registry (Wave 1) |
| [`copilot_agent_catalog.md`](./copilot_agent_catalog.md) | Copilot Agent Catalog |
| [`copilot_authoritative_architecture_plan.md`](./copilot_authoritative_architecture_plan.md) | Authoritative Copilot Architecture & Rollout Plan |
| [`copilot_capability_map_lcc.md`](./copilot_capability_map_lcc.md) | Copilot Capability Map - life-command-center (LCC) |
| [`copilot_operating_system_blueprint.md`](./copilot_operating_system_blueprint.md) | Copilot Operating System Blueprint |
| [`copilot_operating_system_blueprint_v1.1.md`](./copilot_operating_system_blueprint_v1.1.md) | Copilot Operating System Blueprint v1.1 — folded into the base document |
| [`copilot_wave1_build_plan.md`](./copilot_wave1_build_plan.md) | Copilot Wave 1 Build Plan |
| [`data_quality_self_learning_loop.md`](./data_quality_self_learning_loop.md) | Data Quality Self-Learning Loop — Architecture & Rollout Plan |
| [`fact-ingestion-and-propagation.md`](./fact-ingestion-and-propagation.md) | Fact Ingestion & Propagation — the brain learns & stays coherent everywhere |
| [`intelligence-layer-design.md`](./intelligence-layer-design.md) | LCC intelligence layer — design (2026-07-31) |
| [`lcc_intelligent_operating_system_v2.md`](./lcc_intelligent_operating_system_v2.md) | LCC Intelligent Operating System — Design Vision v2 |
| [`lcc_workflow_engine_spec.md`](./lcc_workflow_engine_spec.md) | LCC Workflow Engine — Design Specification |
| [`mcp-server-unification.md`](./mcp-server-unification.md) | MCP Server Unification — one URL for every surface |
| [`next-best-action-and-app-layout.md`](./next-best-action-and-app-layout.md) | Next-Best-Action Layer + App Layout — the unifying synthesis |
| [`request-understanding-and-consistency-layer.md`](./request-understanding-and-consistency-layer.md) | Request Understanding & Data-Consistency layer — cross-tool gap (2026-08-03) |
| [`template_library_spec.md`](./template_library_spec.md) | Template Library Specification |
| [`touchpoint_cadence_spec.md`](./touchpoint_cadence_spec.md) | Touchpoint Cadence Specification |
| [`touchpoint_execution_agent_roadmap.md`](./touchpoint_execution_agent_roadmap.md) | Touchpoint Execution Agent — Build Roadmap |
| [`unification-changeset.md`](./unification-changeset.md) | MCP Unification — ready-to-apply changeset + verify-first cutover |
| [`unified-intelligence-layer.md`](./unified-intelligence-layer.md) | The Unified Intelligence Layer (self-resolving to-do / inbox / brain) |

## App surfaces, UX and front-end (17)

| document | what it covers |
|---|---|
| [`BUYER-ENGAGEMENT-MODULE-SPEC-v0.1.md`](./BUYER-ENGAGEMENT-MODULE-SPEC-v0.1.md) | Buyer Engagement Module (Buy-Side Showings) — Spec v0.1 (DRAFT, design-only) |
| [`access-scoping-and-my-work.md`](./access-scoping-and-my-work.md) | Access Scoping — My Work, Team Queue, and Correspondence Privacy (design + status, 2026-07-31) |
| [`app-ux-review-2026-09-02.md`](./app-ux-review-2026-09-02.md) | LCC desktop app — operator review of 2026-09-02, catalogued and queued |
| [`bd-ranking-and-priority-queue.md`](./bd-ranking-and-priority-queue.md) | BD Ranking & the Priority Queue — the canonical page |
| [`calendar-system-status.md`](./calendar-system-status.md) | Unified Calendar — System Status & Architecture (as-built) |
| [`calendar-tz-fix-runbook.md`](./calendar-tz-fix-runbook.md) | Calendar Timezone + Missing-Calendar Fix — Deployment Runbook |
| [`contact-owner-sidebar-design.md`](./contact-owner-sidebar-design.md) | P1 — Contact / Owner Sidebar: design (2026-07-31) |
| [`contact-reconciliation-outbound.md`](./contact-reconciliation-outbound.md) | Outbound contact reconciliation — LCC as the hub of record |
| [`contact-reconciliation.md`](./contact-reconciliation.md) | Contact Reconciliation (WebEx ↔ Outlook ↔ LCC) — the identity spine |
| [`costar-sidebar-capture-pipeline.md`](./costar-sidebar-capture-pipeline.md) | The CoStar sidebar capture pipeline — canonical topic page |
| [`my-day-surface.md`](./my-day-surface.md) | My Day surface (`lcc_my_day`) |
| [`panel-redesign-verification.md`](./panel-redesign-verification.md) | Panel Redesign — claim → evidence matrix (living) |
| [`property-tab-ux-review.md`](./property-tab-ux-review.md) | Property Tab — UX & Data Review, Audit, and Rollout Plan (2026-07-31) |
| [`provenance_resolution_ui_scope.md`](./provenance_resolution_ui_scope.md) | Provenance conflict resolution UI + learning loop — scope |
| [`research-workbench.md`](./research-workbench.md) | Research Workbench (UX-T1b, 2026-09-08) |
| [`team-visibility-and-owner-scoping.md`](./team-visibility-and-owner-scoping.md) | Team Function vs LCC Visibility — the owner-scope + activity-coverage gap |
| [`w6-5-frontend-decomposition-map.md`](./w6-5-frontend-decomposition-map.md) | W6.5 — Front-end decomposition map & staged extraction plan |

## Data-integrity doctrine and provenance (4)

| document | what it covers |
|---|---|
| [`data-coherence-invariants.md`](./data-coherence-invariants.md) | Data coherence invariants — every source must propel the whole system |
| [`data-integrity-audit-2026-08.md`](./data-integrity-audit-2026-08.md) | Data-integrity audit: sources, coverage, precedence, linkage |
| [`field-provenance-ladder.md`](./field-provenance-ladder.md) | Field-level provenance & the source-priority ladder — canonical topic page |
| [`field_source_priority_ramp_plan.md`](./field_source_priority_ramp_plan.md) | Field Source Priority — warn/strict ramp plan |

## Offers (5)

| document | what it covers |
|---|---|
| [`offer-context-connectivity.md`](./offer-context-connectivity.md) | Offer-Context Data-Capture & Connectivity |
| [`offer-submission-DELIVERY-LEGS.md`](./offer-submission-DELIVERY-LEGS.md) | Offer-submission — delivery + logging legs (code changes + PA/SF instructions) |
| [`offer-submission-DEPLOY-1.1-and-2.2.md`](./offer-submission-DEPLOY-1.1-and-2.2.md) | Turnkey deploy — 1.1 (expose `lcc_offer_context` as a tool/route) + 2.2 (folder-feed indexing) |
| [`offer-submission-SETUP-RUNBOOK.md`](./offer-submission-SETUP-RUNBOOK.md) | Offer-Submission — Manual / Human Setup Runbook |
| [`offer-submission-process-design.md`](./offer-submission-process-design.md) | Offer Submission Process (LOI → Seller) — design spec (v2, grounded in the live Claude Project) |

## Infrastructure, hosting and Supabase (7)

| document | what it covers |
|---|---|
| [`edge-layers-design.md`](./edge-layers-design.md) | Edge Layers — completing the design (reporting, onboarding, compliance, integrations, QA) |
| [`hosting-cost-strategy.md`](./hosting-cost-strategy.md) | Long-Term Hosting Strategy |
| [`infrastructure_migration_plan.md`](./infrastructure_migration_plan.md) | LCC Infrastructure Migration Plan |
| [`round_76_deploy_checklist.md`](./round_76_deploy_checklist.md) | Round 76 Final Deploy Checklist (76m → 76p) |
| [`supabase-consolidation-phase0-inventory.md`](./supabase-consolidation-phase0-inventory.md) | Supabase Consolidation — Phase 0 Inventory |
| [`supabase-consolidation-plan.md`](./supabase-consolidation-plan.md) | Supabase Consolidation Plan |
| [`vercel_secret_usage_audit.md`](./vercel_secret_usage_audit.md) | Vercel Secret Usage Audit (LCC) |

## Point-in-time audits and worklogs (2)

Dated snapshots. Useful as evidence, NOT as current state — check the live system before acting on one.

| document | what it covers |
|---|---|
| [`error-triage-2026-08-01.md`](./error-triage-2026-08-01.md) | Error triage — 2026-08-01 (morning error wave) |
| [`intent-resolution-audit-2026-08-03.md`](./intent-resolution-audit-2026-08-03.md) | Intent / Resolution Audit — Phase 1 |


