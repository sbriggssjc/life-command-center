# Where things go — the filing standard for every Cowork and Claude Code session

> **The problem this solves:** on 2026-08-27 a consolidation found **five measured, unfixed
> Capital-Markets chart defects** that had been invisible for 17 days. They were real, sized and
> written up — in a worklog at the **repo root**, which no index covered. The P141 consolidation
> had swept `docs/` and never looked outside it.
>
> **A document nobody can find is a document that does not exist.** This file is the one place
> that says where each kind of artifact belongs. Put it in the right place the first time.

---

## 1. The five files that carry state (everything else is supporting material)

| file | answers | update it when |
|---|---|---|
| **`docs/os/CURRENT-STATE.md`** | *What is LIVE, what is flag-gated OFF and why* | something ships, a flag flips, or a stale claim is overturned |
| **`docs/os/PLANNED-BACKLOG.md`** | *Everything unbuilt-but-intended*, one ranked list, every row citing its source | you find work, finish work, or measurement refutes a row |
| **`docs/claude-code/STATUS.md`** | *The running log, newest first* — what happened and what was learned | every session, at the end |
| **`CLAUDE.md`** | *Durable invariants and footguns* — the rules that outlive any round | a lesson generalises beyond the change that taught it |
| **`docs/os/GITHUB-WORKFLOW.md`** | *How work reaches `main`* | the merge procedure or branch protection changes |

**Read the first three at the start of every session.** `docs/claude-code/NEW-CHAT-KICKOFF.md`
bootstraps a fresh chat and points at them.

## 1a. 📚 Canonical `docs/architecture/` index (Unit 3, DOCMAP1 2026-09-08)

**This is now ONE directory.** `docs/os/architecture/` (29 files) was merged into
`docs/architecture/` in the same change that built this index — there is no longer a second
"architecture" directory to be confused about. Every reference to the old path was fixed in the
same change (`grep -rl docs/os/architecture` returns nothing outside this sentence and the
DOCMAP1 prompt/classification files, which are historical record).

Below is every file classified **CANONICAL** in
[`docs/os/DOCMAP1_CLASSIFICATION.md`](DOCMAP1_CLASSIFICATION.md) (145 of 181), grouped by topic,
one line each. The full table — including the 31 HISTORICAL, 4 STALE (now fixed in place), and
1 DUPLICATE (folded + pointed) files — lives in that classification file, along with the method
and confidence tier for every verdict.

⚠️ **This index is hand-maintained. A new canonical architecture doc must be added here (one
line, right topic group) in the SAME change that creates it** — that is the rule this map exists
to enforce, and it applies to itself.

### Ownership / owner-contact / entity identity

- [`contact-entity-resolution.md`](../architecture/contact-entity-resolution.md) — Design finding (A2) on contact→entity resolution gap.
- [`contact-owner-sidebar-design.md`](../architecture/contact-owner-sidebar-design.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`data-quality-lease-and-owner.md`](../architecture/data-quality-lease-and-owner.md) — Data-quality reference for lease duplicates + property-owner accuracy.
- [`dia-ownership-master-bridge-2026-08.md`](../architecture/dia-ownership-master-bridge-2026-08.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`entity-identity-and-dedup.md`](../architecture/entity-identity-and-dedup.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`entity-reconciliation-design.md`](../architecture/entity-reconciliation-design.md) — Design spec (A1) for entity reconciliation, sibling to contact-entity-resolution.
- [`gov-asset-identity-coverage-2026-08.md`](../architecture/gov-asset-identity-coverage-2026-08.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`gov-property-duplicates.md`](../architecture/gov-property-duplicates.md) — Tracked in PLANNED-BACKLOG.
- [`owner-reconciliation-engine.md`](../architecture/owner-reconciliation-engine.md) — "Status: LIVE"; already carries the correct NAMING TRAP banner pointing at property-owner-subsystem.
- [`owner-role-classification.md`](../architecture/owner-role-classification.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`ownership-data-provenance.md`](../architecture/ownership-data-provenance.md) — Foundational schema-design reference for ownership field provenance; sibling to CLAUDE.
- [`ownership-history-lane.md`](../architecture/ownership-history-lane.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`property-owner-panel-redesign-2026-08.md`](../architecture/property-owner-panel-redesign-2026-08.md) — Target-state design for the live property/owner panel; sibling to panel-redesign-verification.
- [`property-owner-source-authority-and-doctrine.md`](../architecture/property-owner-source-authority-and-doctrine.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`property-owner-subsystem.md`](../architecture/property-owner-subsystem.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`sf-note-records-ownership-bridge-2026-08.md`](../architecture/sf-note-records-ownership-bridge-2026-08.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`sf-owner-capture.md`](../architecture/sf-owner-capture.md) — "Status: LIVE end-to-end"; already carries the correct NAMING TRAP banner.
- [`supersession-tie-lane-2026-08.md`](../architecture/supersession-tie-lane-2026-08.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`team-visibility-and-owner-scoping.md`](../architecture/team-visibility-and-owner-scoping.md) — Design finding note underlying the live owner-scoping behavior described elsewhere (access-scoping-and-my-work.
- [`tier0-owner-contact-system.md`](../architecture/tier0-owner-contact-system.md) — Cited as the/an authoritative page for its topic by root CLAUDE.

### Provenance / field data quality

- [`comps-data-integrity-and-canonical-record.md`](../architecture/comps-data-integrity-and-canonical-record.md) — Canonical-record initiative design for comps data quality.
- [`data-availability-map.md`](../architecture/data-availability-map.md) — Foundational map of what data powers the intelligence layer; referenced conceptually across the ownership/connectivity docs.
- [`data-coherence-invariants.md`](../architecture/data-coherence-invariants.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`data-integrity-audit-2026-08.md`](../architecture/data-integrity-audit-2026-08.md) — Data-integrity audit still describing live source/coverage/precedence structure (not a single-round worklog).
- [`field-provenance-ladder.md`](../architecture/field-provenance-ladder.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`field_source_priority_ramp_plan.md`](../architecture/field_source_priority_ramp_plan.md) — "Status: most rules in record_only mode" — active ramp plan, sibling to CLAUDE.
- [`lease-data-provenance.md`](../architecture/lease-data-provenance.md) — Foundational schema-design reference for lease field provenance.
- [`provenance_resolution_ui_scope.md`](../architecture/provenance_resolution_ui_scope.md) — "Status: scoped, not built" — accurately labeled unbuilt scope doc, sibling to field-provenance-ladder.

### Dossier program

- [`DOSSIER-PROGRAM-STATE-OF-PLAY.md`](../architecture/DOSSIER-PROGRAM-STATE-OF-PLAY.md) — Explicit "START HERE" for the dossier program; the program-level index doc for the whole dossier cluster.
- [`SF-WRITEBACK-AND-DOSSIER-BUILD-STATE.md`](../architecture/SF-WRITEBACK-AND-DOSSIER-BUILD-STATE.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`documents-and-dossiers-design.md`](../architecture/documents-and-dossiers-design.md) — Design reference for the OM viewer + property/deal dossiers, sibling to DOSSIER-PROGRAM-STATE-OF-PLAY.
- [`dossier-followup-prompts-for-claude-code.md`](../architecture/dossier-followup-prompts-for-claude-code.md) — Follow-up prompt set for the dossier build program.
- [`dossier-generation-and-ollama-wiring.md`](../architecture/dossier-generation-and-ollama-wiring.md) — Architecture for dossier generation's Ollama wiring.
- [`dossier-production-wiring-runbook.md`](../architecture/dossier-production-wiring-runbook.md) — Operator runbook for the live dossier generator.
- [`dossier-standard-and-llm-contract.md`](../architecture/dossier-standard-and-llm-contract.md) — The LLM-replicable dossier standard, referenced by DOSSIER-PROGRAM-STATE-OF-PLAY.
- [`dossier-v2-audit-and-triage.md`](../architecture/dossier-v2-audit-and-triage.md) — v2 data audit/pipeline triage for the dossier program's gold-standard property.
- [`living-deal-dossier-and-systems-connection.md`](../architecture/living-deal-dossier-and-systems-connection.md) — Architecture for the living deal dossier + systems connection.

### Deal spine / correspondence / cadence

- [`BUILD-01B-sf-deal-sync-flow.md`](../architecture/BUILD-01B-sf-deal-sync-flow.md) — Companion PA-flow build spec to BUILD-01.
- [`actor-attribution-phase1.md`](../architecture/actor-attribution-phase1.md) — "Foundation done + code change spec" for a live rollout gap (team-visibility provenance / manager overview); referenced conceptually by team-visibility-and-owner-scoping.
- [`cadence-engine.md`](../architecture/cadence-engine.md) — Design reference for cadence advancement; CLAUDE.
- [`closed-deal-asset-entity-and-deal-spine.md`](../architecture/closed-deal-asset-entity-and-deal-spine.md) — Spec for closed-deal asset entity + deal-spine wiring.
- [`correspondence-ingestion-design.md`](../architecture/correspondence-ingestion-design.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`deal-address-resolution-design.md`](../architecture/deal-address-resolution-design.md) — Design spec extending the Owner Reconcile Engine.
- [`deal-backbone-design-refinements.md`](../architecture/deal-backbone-design-refinements.md) — Refinements to the live deal-backbone design (post-BUILD-01).
- [`deal-correspondence-attribution.md`](../architecture/deal-correspondence-attribution.md) — Design note underlying correspondence-ingestion-design.
- [`deal-party-roster-source.md`](../architecture/deal-party-roster-source.md) — Source re-spec for the deal-party roster, referenced by PLANNED-BACKLOG P12's "Deal_Participants__c dead end" row.
- [`deal-surface-packet-and-layout.md`](../architecture/deal-surface-packet-and-layout.md) — Packet contract + app layout for the live Deal Surface.
- [`matcher-recall-design.md`](../architecture/matcher-recall-design.md) — Recall v2 design for the deal-email matcher (A5).
- [`proactive-deal-monitor.md`](../architecture/proactive-deal-monitor.md) — Architecture/design for the proactive deal monitor.
- [`property-contact-deal-connectivity.md`](../architecture/property-contact-deal-connectivity.md) — Connectivity model underlying contact-owner-sidebar-design.
- [`team-mailbox-intake-design.md`](../architecture/team-mailbox-intake-design.md) — Design spec (B2) for team mailbox intake, referenced by PLANNED-BACKLOG P13 item 2 as a live decision fork.
- [`touchpoint_cadence_spec.md`](../architecture/touchpoint_cadence_spec.md) — Specification referenced conceptually throughout CLAUDE.

### Power Automate / Salesforce / Outlook / Teams integration

- [`BUILD-01-sf-opportunity-sync.md`](../architecture/BUILD-01-sf-opportunity-sync.md) — Build spec for the deal spine's first step (SF Opportunity Sync).
- [`NBT_PHASE2_sf_activity_sync.md`](../architecture/NBT_PHASE2_sf_activity_sync.md) — Phase 2 progress/response-signal spec for SF-Activity sync.
- [`SALESFORCE-METADATA-GAP-MATRIX-2026-08-11.md`](../architecture/SALESFORCE-METADATA-GAP-MATRIX-2026-08-11.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`SALESFORCE-PAYLOAD-FIELD-PROFILE-2026-08-11.md`](../architecture/SALESFORCE-PAYLOAD-FIELD-PROFILE-2026-08-11.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`outlook_intake_team_visibility_workflow.md`](../architecture/outlook_intake_team_visibility_workflow.md) — Current-vs-hardened workflow reference for the live Outlook intake path.
- [`power-automate-flow-audit.md`](../architecture/power-automate-flow-audit.md) — Live flow registry; power-automate-observability-standards.
- [`power-automate-observability-standards.md`](../architecture/power-automate-observability-standards.md) — Live standards doc for PA flow reliability.
- [`power-automate-remediation-plan.md`](../architecture/power-automate-remediation-plan.md) — Live remediation plan sibling to power-automate-flow-audit.
- [`salesforce_nm_authoritative_sync.md`](../architecture/salesforce_nm_authoritative_sync.md) — "Status: Foundation shipped" — describes the live is_northmarq classifier.
- [`sf_connected_app_setup.md`](../architecture/sf_connected_app_setup.md) — Setup reference for the live Salesforce Connected App server-side file fetch.
- [`sf_daily_bulk_backfill_RUNBOOK.md`](../architecture/sf_daily_bulk_backfill_RUNBOOK.md) — Runbook for the live SF daily bulk file backfill (Flow 7).

### Daily briefing

- [`briefing-analyst-take-onprem.md`](../architecture/briefing-analyst-take-onprem.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`daily_briefing_payload_contract.md`](../architecture/daily_briefing_payload_contract.md) — Payload contract likely still in force for the live daily-briefing pipeline (briefing-analyst-take-onprem.
- [`teams_daily_briefing_delivery_workflow.md`](../architecture/teams_daily_briefing_delivery_workflow.md) — Delivery workflow for the live Teams daily-briefing send.

### Copilot

- [`copilot_agent_catalog.md`](../architecture/copilot_agent_catalog.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`copilot_authoritative_architecture_plan.md`](../architecture/copilot_authoritative_architecture_plan.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`copilot_operating_system_blueprint.md`](../architecture/copilot_operating_system_blueprint.md) — Actively referenced as a dependency by 5+ other architecture docs (infrastructure_migration_plan.

### OM intake / documents / OCR

- [`address_normalization_spec.md`](../architecture/address_normalization_spec.md) — Spec referenced by the live `.
- [`document-capture-and-ocr-status.md`](../architecture/document-capture-and-ocr-status.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`document-capture-ocr-and-deeds.md`](../architecture/document-capture-ocr-and-deeds.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`om_intake_pipeline.md`](../architecture/om_intake_pipeline.md) — Cited as the/an authoritative page for its topic by root CLAUDE.

### Property / comps / research workbench

- [`costar-sidebar-capture-pipeline.md`](../architecture/costar-sidebar-capture-pipeline.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`dialysis-economics-and-medicare-data.md`](../architecture/dialysis-economics-and-medicare-data.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`property-identity-and-address-resolution.md`](../architecture/property-identity-and-address-resolution.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`property-metadata-coverage.md`](../architecture/property-metadata-coverage.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`property-tab-ux-review.md`](../architecture/property-tab-ux-review.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`public-records-source-lane.md`](../architecture/public-records-source-lane.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`research-workbench.md`](../architecture/research-workbench.md) — Cited as the/an authoritative page for its topic by root CLAUDE.

### Panel UX / access scoping

- [`access-scoping-and-my-work.md`](../architecture/access-scoping-and-my-work.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`app-ux-review-2026-09-02.md`](../architecture/app-ux-review-2026-09-02.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`intelligence-layer-design.md`](../architecture/intelligence-layer-design.md) — Design reference underlying unified-intelligence-layer.
- [`my-day-surface.md`](../architecture/my-day-surface.md) — "Status: LIVE (2026-07-31)" — current surface reference.
- [`next-best-action-and-app-layout.md`](../architecture/next-best-action-and-app-layout.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`panel-redesign-verification.md`](../architecture/panel-redesign-verification.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`request-understanding-and-consistency-layer.md`](../architecture/request-understanding-and-consistency-layer.md) — Cross-tool design note underlying the live request-understanding behavior.
- [`unified-intelligence-layer.md`](../architecture/unified-intelligence-layer.md) — Design reference for the self-resolving inbox/brain concept underlying next-best-action-and-app-layout.
- [`w6-5-frontend-decomposition-map.md`](../architecture/w6-5-frontend-decomposition-map.md) — Cited as the/an authoritative page for its topic by root CLAUDE.

### Infrastructure / hosting / CI

- [`edge-function-deploy-drift.md`](../architecture/edge-function-deploy-drift.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`infrastructure-topology.md`](../architecture/infrastructure-topology.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`infrastructure_migration_plan.md`](../architecture/infrastructure_migration_plan.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`producer-health-and-ci-enforcement.md`](../architecture/producer-health-and-ci-enforcement.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`supabase-consolidation-phase0-inventory.md`](../architecture/supabase-consolidation-phase0-inventory.md) — "Status: in progress" inventory feeding supabase-consolidation-plan.
- [`supabase-consolidation-plan.md`](../architecture/supabase-consolidation-plan.md) — Cited as the/an authoritative page for its topic by root CLAUDE.

### Calendar

- [`calendar-system-status.md`](../architecture/calendar-system-status.md) — As-built system status for the unified calendar; self-reports its own two remaining gaps rather than hiding them.

### Healthcare vertical expansion (design-only)

- [`ADR-004-CANONICAL-PERSON-IDENTITY.md`](../architecture/ADR-004-CANONICAL-PERSON-IDENTITY.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`HEALTHCARE-ASC-FIRST-STAGING-RUNBOOK-v0.1.md`](../architecture/HEALTHCARE-ASC-FIRST-STAGING-RUNBOOK-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`HEALTHCARE-ASC-IDTF-ECONOMICS-AND-SAMPLING-v0.1.md`](../architecture/HEALTHCARE-ASC-IDTF-ECONOMICS-AND-SAMPLING-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`HEALTHCARE-ASC-IDTF-LCC-INTEGRATION-CONTRACT-v0.1.md`](../architecture/HEALTHCARE-ASC-IDTF-LCC-INTEGRATION-CONTRACT-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`HEALTHCARE-ASC-IDTF-PRIVATE-RUN-AUTHORIZATION-v0.1.md`](../architecture/HEALTHCARE-ASC-IDTF-PRIVATE-RUN-AUTHORIZATION-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`HEALTHCARE-ASC-IDTF-SOURCE-MANIFEST-CONTRACTS-v0.1.md`](../architecture/HEALTHCARE-ASC-IDTF-SOURCE-MANIFEST-CONTRACTS-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`HEALTHCARE-REAL-ESTATE-AND-ECONOMICS-BUSINESS-PLAN-v0.1.md`](../architecture/HEALTHCARE-REAL-ESTATE-AND-ECONOMICS-BUSINESS-PLAN-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`HEALTHCARE-SOURCE-SUFFICIENCY-CARDS-ASC-IMAGING-v0.1.md`](../architecture/HEALTHCARE-SOURCE-SUFFICIENCY-CARDS-ASC-IMAGING-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`HEALTHCARE-SWIM-LANE-EVALUATION-MATRIX-v0.1.md`](../architecture/HEALTHCARE-SWIM-LANE-EVALUATION-MATRIX-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`ONCOLOGY-INFUSION-IMPLEMENTATION-READINESS-PACKAGE-v0.1.md`](../architecture/ONCOLOGY-INFUSION-IMPLEMENTATION-READINESS-PACKAGE-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`ONCOLOGY-INFUSION-NPPES-SOURCE-ADAPTER-SPEC-v0.1.md`](../architecture/ONCOLOGY-INFUSION-NPPES-SOURCE-ADAPTER-SPEC-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`ONCOLOGY-INFUSION-PHASE-A-BUILD-PLAN-v0.1.md`](../architecture/ONCOLOGY-INFUSION-PHASE-A-BUILD-PLAN-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`ONCOLOGY-INFUSION-PILOT-COHORT-SPEC-v0.1.md`](../architecture/ONCOLOGY-INFUSION-PILOT-COHORT-SPEC-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`ONCOLOGY-INFUSION-PRIVATE-VERIFICATION-SAMPLE-v0.1.md`](../architecture/ONCOLOGY-INFUSION-PRIVATE-VERIFICATION-SAMPLE-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`ONCOLOGY-INFUSION-READ-ONLY-PROFILE-PLAN-v0.1.md`](../architecture/ONCOLOGY-INFUSION-READ-ONLY-PROFILE-PLAN-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`ONCOLOGY-INFUSION-READ-ONLY-PROFILE-RESULT-2026-08-11.md`](../architecture/ONCOLOGY-INFUSION-READ-ONLY-PROFILE-RESULT-2026-08-11.md) — Tracked in PLANNED-BACKLOG.
- [`ONCOLOGY-INFUSION-SERVICE-CORROBORATION-ADR-005.md`](../architecture/ONCOLOGY-INFUSION-SERVICE-CORROBORATION-ADR-005.md) — Tracked in PLANNED-BACKLOG.
- [`ONCOLOGY-INFUSION-STAGING-AND-INGESTION-CONTRACT-v0.1.md`](../architecture/ONCOLOGY-INFUSION-STAGING-AND-INGESTION-CONTRACT-v0.1.md) — Tracked in PLANNED-BACKLOG.
- [`OUTPATIENT-HEALTHCARE-LANE-PACK-SPEC-v0.1.md`](../architecture/OUTPATIENT-HEALTHCARE-LANE-PACK-SPEC-v0.1.md) — Tracked in PLANNED-BACKLOG.

### Foundational drafts / OS vision

- [`context_packet_schema.md`](../architecture/context_packet_schema.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`lcc_intelligent_operating_system_v2.md`](../architecture/lcc_intelligent_operating_system_v2.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`lcc_workflow_engine_spec.md`](../architecture/lcc_workflow_engine_spec.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`template_library_spec.md`](../architecture/template_library_spec.md) — Cited as the/an authoritative page for its topic by root CLAUDE.

### Other

- [`INTAKE_TODO_FLOW_AUDIT_2026-07-23.md`](../architecture/INTAKE_TODO_FLOW_AUDIT_2026-07-23.md) — Cited by scott-pa-flows-reference.
- [`LCC_DOCUMENTATION_RECONCILIATION_2026-08-11.md`](../architecture/LCC_DOCUMENTATION_RECONCILIATION_2026-08-11.md) — Reconciliation note for architecture/OS/PA docs — process-level reference, not a single-round worklog.
- [`WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md`](../architecture/WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md) — Wave 7 plan for comms-driven context propagation.
- [`account-based-contact-intelligence.md`](../architecture/account-based-contact-intelligence.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`ai-and-ocr-cost-strategy.md`](../architecture/ai-and-ocr-cost-strategy.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`ai-next-step-engine-PHASE1-BUILT.md`](../architecture/ai-next-step-engine-PHASE1-BUILT.md) — "Status: shipped to DB; JS ready to merge" — delta doc on the scope above; read together.
- [`ai-next-step-engine-scope.md`](../architecture/ai-next-step-engine-scope.md) — "Status: scope (no build yet)" companion to the PHASE1-BUILT delta doc below.
- [`bd-ranking-and-priority-queue.md`](../architecture/bd-ranking-and-priority-queue.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`broker-and-firm-identity.md`](../architecture/broker-and-firm-identity.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`connected-agent-architecture.md`](../architecture/connected-agent-architecture.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`connected-agent-descriptions.md`](../architecture/connected-agent-descriptions.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`connectivity-and-open-threads.md`](../architecture/connectivity-and-open-threads.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`contact-reconciliation-outbound.md`](../architecture/contact-reconciliation-outbound.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`contact-reconciliation.md`](../architecture/contact-reconciliation.md) — "Status: RPC + correspondent_backfill_log applied live" — active identity-spine reference, sibling to CLAUDE.
- [`cross-cutting-design.md`](../architecture/cross-cutting-design.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`data_quality_self_learning_loop.md`](../architecture/data_quality_self_learning_loop.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`design-considerations.md`](../architecture/design-considerations.md) — Pre-build design-review note underlying multiple live subsystems.
- [`edge-layers-design.md`](../architecture/edge-layers-design.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`fact-ingestion-and-propagation.md`](../architecture/fact-ingestion-and-propagation.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`mcp-server-unification.md`](../architecture/mcp-server-unification.md) — Cited as the/an authoritative page for its topic by root CLAUDE.
- [`microsoft-surface-architecture.md`](../architecture/microsoft-surface-architecture.md) — Decision note for the Microsoft-surface split, referenced by the connectivity map cluster.
- [`offer-context-connectivity.md`](../architecture/offer-context-connectivity.md) — Data-capture/connectivity design for offer context.
- [`offer-submission-SETUP-RUNBOOK.md`](../architecture/offer-submission-SETUP-RUNBOOK.md) — Manual/human setup runbook for the live offer-submission flow (sibling delivery-legs/deploy docs already marked historical as build-history-only).
- [`offer-submission-process-design.md`](../architecture/offer-submission-process-design.md) — v2 process design for offer submission, grounded in the live Claude Project.
- [`scott-pa-flows-reference.md`](../architecture/scott-pa-flows-reference.md) — Build-ready operational reference for Scott's live PA flows; correctly self-labels retired sub-items rather than being stale as a whole.
- [`unification-changeset.md`](../architecture/unification-changeset.md) — Cited as the/an authoritative page for its topic by root CLAUDE.

## 2. Where each artifact type is filed

| artifact | location | notes |
|---|---|---|
| Prompt for Claude Code | `docs/claude-code/prompts/` | → `prompts/done/` once its work merges. ⚠️ **`prompts/` is NOT the record of what is outstanding — the AUDIT is.** A5 sat un-filed after completing and was recommended for re-sending on 2026-08-27. **Before proposing that a prompt be sent, grep `docs/audits/` for that round's output.** With two Cowork threads plus Claude Code sharing this repo, an un-filed prompt is a cross-thread duplicate-work hazard |
| Claude Code's response (.docx) | `docs/claude-code/responses/` | → `responses/done/` once reconciled |
| **Audit / measurement writeup** | `docs/audits/<TOPIC>_<YYYY-MM-DD>.md` | the finding and its reproduction queries |
| Architecture / subsystem design | `docs/architecture/<subsystem>.md` | one canonical file per subsystem |
| **⚠️ A file whose NAME misleads** | leave the file, add a **NAMING TRAP banner** at the top | Live examples: `owner-reconciliation-engine.md` and `sf-owner-capture.md` resolve the **point person** (which broker works the deal), **not the property owner**. That confusion is documented as *"the finding that reframed P0.2."* **A misleading title is a defect even when the contents are correct** — and it is cheaper to fix with a banner than a rename, which breaks every inbound link |
| **A topic spanning ~20 files** | one **living document** with a **§0 topic index** | Live example: `connectivity-and-open-threads.md` §0 indexes the whole ownership→contact chain — the three canonical pages and what each owns, the naming traps, the supporting designs, and the dated evidence trail. **Nothing is deleted**: an audit is evidence for a date. **If a canonical page disagrees with an audit, the page wins and the audit gets a supersession banner in the same change** |
| **A decision NOT to build** | a canonical page whose §-headings carry the **refutations**, not just the plan | Live example: `docs/architecture/property-metadata-coverage.md` — the assessor lane, invariant I12, and **three proposed sources measured and refuted with their reach numbers** (Ollama 9 of 662, sidebar-in-flow 6, sidebar-lookup 662 searches over 617 sold). **A refuted option must be as findable as a queued one**, or the next session re-proposes it; the page exists so *"should we point Ollama at this?"* is answered in one read |
| **A subsystem spanning many audits** | one canonical page + a **banner in each audit pointing at it** | Live examples: `docs/architecture/tier0-owner-contact-system.md` covers twelve rounds (P186–P197 + A1–A4); `docs/architecture/bd-ranking-and-priority-queue.md` covers C4–C6 (the ranked call list). The canonical page carries live state, decisions-already-made and traps-paid-for; the audits stay as the EVIDENCE. **A trap list is only a guard if it is on the path someone walks** — so the pointer goes in the audit, not only in the index |
| Runbook / setup / operator procedure | `docs/setup/` | |
| Rules that sync to AI surfaces | `docs/os/canon/blocks/*.md` | **bump `CANON_VERSION`, then run the render script.** Never hand-edit a file whose header says GENERATED |
| Superseded per-round narrative | `docs/history/` (+ `worklogs/` for one-off worklogs) | archive with an INDEX row — **never delete** |
| Capital-markets specifics | `docs/capital-markets/` | |

## 3. ⛔ Do not create these

- **A new `.md` at the repo root.** The root is code and config. It already carries 69 `.md` files
  from before this rule; do not add the seventieth. *(That is exactly how K13–K20 got lost.)*
- **A second document about a subsystem that already has one.** Extend the canonical file and
  leave a pointer. One source per topic.
- **A `✅ done` row left sitting in the backlog.** When a row ships, move the substance to
  `CURRENT-STATE.md` §2 and delete the row — otherwise the backlog rots into a changelog.
- **A "final" summary file per session.** That is what `STATUS.md` is for.

## 4. The lifecycle of a piece of work

```
found  → PLANNED-BACKLOG.md row (with its measurement and source)
       → prompts/<id>.md            (drafted for Claude Code)
       → responses/<id>.docx        (its reply)
reconciled → STATUS.md entry + docs updated + both files moved to done/
shipped    → CURRENT-STATE.md; backlog row deleted
retired    → moved to backlog P12 "excluded" WITH THE REASON — never deleted
learned    → CLAUDE.md, if the lesson outlives the change
```

**Nothing is ever deleted for being finished or wrong.** A contemplated feature is re-ranked or
explicitly retired with a reason. A refuted row is **rewritten with the measurement** — the
correction is usually worth more than the original claim.

## 5. Two audit windows run in parallel — label your work

| | **App audit** (desktop) | **Data-process & automation audit** |
|---|---|---|
| Scope | LCC the application — defects, lanes, surfaces, code | data processes end to end; where AI/automation raises productivity |
| Prompt numbering | **numeric** — 189, 192, 194, 195… | **lettered, matching its backlog rows** — A1, A2, A3… |
| Backlog rows | N3a–N3c, AC1b–AC10, N8/N8a | L1–L10, N4–N7, A1–A7, V6 |

**A *finding* about a data process belongs to the automation window even when its *code fix*
belongs to the app window.** If it is not obvious which window you are in, ask.

## 6. Naming

- Audits: `TOPIC_IN_CAPS_YYYY-MM-DD.md` — the date is load-bearing, because every measurement in
  this repo has a shelf life.
- Prompts: `<id>-<kebab-topic>-<YYYY-MM-DD>.md`.
- Architecture/design: lower-kebab, no date — these are living documents, updated in place.

## 6x. 👤 Operator actions — the one place to see what is blocked on Scott

📍 **[`OPERATOR-ACTIONS.md`](OPERATOR-ACTIONS.md)** collects every `👤` row from
`PLANNED-BACKLOG.md` into one ranked page — security first, then blocked builds, then decisions.
**It is a LENS over the backlog, never a second source of truth**; the backlog row stays
authoritative and wins any disagreement. It exists because 68 operator markers scattered across a
dozen sections is the same *"no single accurate representation"* problem this map addresses for
documents.

## 6y. 🔁 The build-turn protocol — this map's parent rule

📍 **[`BUILD-TURN-PROTOCOL.md`](BUILD-TURN-PROTOCOL.md) is the definition of done for every change**
(Scott, 2026-08-28). This map answers *where does a document go*; that page answers *what must be
true before a turn is finished* — and step ⑤ (**update the canonical docs in the same change**) plus
step ⑦ (**extract open intent before archiving**) are what keep this map from becoming fiction.
**§6z below is step ⑦'s full procedure.**

## 6z. 🗄️ Topic-based cleanup — the standing procedure (proven 2026-08-28)

**Cleanup is BY TOPIC CLUSTER, repo-wide — never by folder.** A folder pass leaves the same topic
contradicting itself from three other directories, which is the confusion this map exists to end.

**The procedure, and it is gated:**

1. **Enumerate the cluster repo-wide** — `docs/`, the repo root, `audit/`, `consolidation/`,
   everywhere. One `grep -rl` on the topic's vocabulary.
2. **READ every file before moving any of it.** Non-negotiable.
3. **Extract UNFILED OPEN INTENT** — anything unbuilt, deferred, "next step", or a design proposed
   and never confirmed shipped. **Grep `PLANNED-BACKLOG.md` for each** and file what is missing
   **before** the move. ⚠️ **On 2026-08-28 this recovered 25 items across two folders — including an
   entire unexecuted Supabase consolidation plan.** A move without this step destroys planned work
   silently, because nothing errors.
4. **Identify STALE CLAIMS** — assertions now false. **Banner them; do not silently delete.**
   The test: *would a future session reading this file first reach a wrong conclusion within one
   paragraph?* If yes, it needs a 🚨 banner, not a footnote.
5. **Check inbound references** — `grep` the filename across `.md`, `.sql`, `.mjs`, `.js`. **A
   path-anchored reference breaks; a bare-name mention does not.** Fix the former in the same change.
6. **Distinguish ARCHIVE from RELOCATE.** Archive = historical/superseded → `docs/history/`.
   Relocate = **still-live reference material in the wrong place** → `docs/architecture/` or
   `docs/audits/`. ⚠️ **Archiving live reference material is the more expensive mistake** — three
   files in the 2026-08-28 pass described machinery that shipping code still calls.
7. **Leave a README banner in the archive** and an `INDEX.md` entry, both naming where the open
   items went.

⚠️ **Watch for LETTER COLLISIONS across campaigns.** The May-2026 remediation's Track A/B/C and the
Aug-2026 lettered prompts both use A/B/C: *"B4"* is a May sales worker **and** the dia-vs-gov
chain-depth question. **Always disambiguate by date.**

## 7. Before you archive anything

The rule that would have prevented the K13–K20 loss:

1. **Enumerate by file type across the whole repo, not by folder.** A consolidation scoped to a
   directory misses whatever sits outside it.
2. **Grep the candidates for open-work markers *before* moving them** — `TODO`, `[ ]`,
   `follow-up`, `next steps`, `remaining`, `deferred`, `not yet`.
3. **Read every file that matches.** Roughly half of matches are already-closed items mentioned in
   passing; the rest are real, and they belong in `PLANNED-BACKLOG.md` **before** the file moves.
4. **Write an INDEX.md** in the archive folder naming what was recovered and where it went.
5. **Repoint any live references** in the same change.
6. **⚠️ Check the source location AGAIN after other branches merge.** A file MOVE is **not
   conflict-safe across parallel branches.** The 2026-08-27 archive recorded 31 worklogs as
   *delete-at-root + create-in-history* rather than as renames, so a branch based on an older
   commit — still carrying the root copies — **re-added all 31 on merge, silently and with no
   conflict.** Git resolved *"you deleted it / they still have it"* by keeping the file, which is
   the safe default for content and the wrong one for a move. For a day, every archived worklog
   existed twice. **Verify byte-identity before removing the resurrected copies** (all 31 were),
   and prefer landing a move when no long-lived parallel branch predates it.
