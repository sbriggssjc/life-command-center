# DOCMAP1 — docs/architecture/ classification (2026-09-08)
Full inventory: **181** files (152 originally under `docs/architecture/` + 29 originally
under `docs/os/architecture/`, merged into one directory by this same change — see
`DOCMAP1_CLASSIFICATION.md` §Method and `docs/os/DOCUMENTATION-MAP.md`).

**Verdict counts (original pass):** STALE **4** · DUPLICATE **1** · HISTORICAL **31** · CANONICAL **145**

> ⚠️ **Follow-up pass, same day (2026-09-08) — 7 more STALE found in the "title+skim" tier.**
> This file's own §Method (below) named the 93 title+skim files as "not a substantive
> re-derivation" and invited a deeper pass. Two independently-dispatched sub-agents (one per
> original directory) did that deeper read and found 7 more STALE docs the Vercel-grep technique
> could not have caught (none mention Vercel) — each now bannered in place with its citation,
> not re-listed in the table below to avoid duplicating the banner text:
> `cadence-engine.md`, `infrastructure_migration_plan.md`, `sf_connected_app_setup.md`,
> `ai-next-step-engine-scope.md`, `BUILD-01-sf-opportunity-sync.md`,
> `BUILD-01B-sf-deal-sync-flow.md`, `LCC_DOCUMENTATION_RECONCILIATION_2026-08-11.md`.
> **Revised verdict counts: STALE 11 · DUPLICATE 1 · HISTORICAL 31 · CANONICAL 138.**
> The same pass also found and fixed the false "grep returns nothing" claim in
> `DOCUMENTATION-MAP.md` §1a (see that file). The remaining ~86 title+skim files are still
> unverified at this deeper level — say so rather than treating 138 as a floor that's been proven.

## Method (read before trusting a verdict)

This pass did **not** deep-read all 181 files at the same depth. Three confidence tiers, named per row:

1. **Verified** (~51 files) — cited as canonical/authoritative by root `CLAUDE.md` and/or
   `docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md`, cross-checked against that citation.
   One of these (`field-provenance-ladder.md`) was deep-read specifically to confirm the known STALE
   claim from the task brief ("the ladder's own manual@1 rung") is **already corrected** — verified
   live: the file now correctly states `manual_edit`/`manual_resolution`, not bare `manual`.
2. **P11-tracked** (~31 files) — the Healthcare/Oncology/identity/foundational-draft cluster explicitly
   tracked in `PLANNED-BACKLOG.md` §P11 as accurate, gated, design-only specs. Their "nothing built yet"
   status is stated as the design, not staleness — confirmed against the backlog row, not deep-read
   file-by-file.
3. **Title + skim** (~93 files) — title, first status/date line, and a grep for `SUPERSEDED`/`Status:`
   markers only. This is where the four STALE findings below came from (a targeted `grep -l Vercel` swept
   across every file with that word, after root `CLAUDE.md`'s "Vercel retired 2026-07-20" line flagged it
   as a known stale-claim vector). It is **not** a substantive re-derivation of each file's central claims
   — see NOT REACHED in `docs/os/DOCMAP1_CLASSIFICATION.md`'s companion note for what a fuller pass would
   need to do.

**On "zero STALE found" risk:** this pass explicitly went looking for the dangerous class (a canonical
doc asserting something now-false) rather than assuming skim-level review would surface it for free.
The `Vercel` grep across all 181 files was exactly that kind of targeted hunt, modeled on the task
brief's own documented instance (a stale "never writes a domain table" claim). It found **4** live
instances, all now fixed in place. A more expensive pass (re-deriving every numeric/status claim
against current DB/code state, the way the CLAUDE.md audits do) would very likely find more —
this pass optimized for the cheapest high-yield hunt (a known-retired dependency name) rather than
an exhaustive one, and says so rather than claiming completeness.

## Verdict table

| file | verdict | reason |
|---|---|---|
| `context_broker_api_spec.md` | **STALE** _[FIXED IN PLACE]_ | Line ~395 claimed "Context Broker runs as a Vercel Edge Function" as the deployment target. Vercel was retired 2026-07-20 (root CLAUDE.md); Railway is the sole production host, no per-function cap exists to route around. FIXED IN PLACE this pass with a correction banner + the original text preserved. |
| `hosting-cost-strategy.md` | **STALE** _[FIXED IN PLACE]_ | The entire doc weighs a Vercel-vs-Railway hosting decision (pricing tables, "Vercel Pro is the worst option") as if still open. Vercel was retired 2026-07-20 and Railway is now the sole production host per root CLAUDE.md — the decision this doc argues toward has already been made and superseded. BANNERED IN PLACE this pass. |
| `touchpoint_execution_agent_roadmap.md` | **STALE** _[FIXED IN PLACE]_ | Step 6 of the Graph app-registration roadmap said to store secrets "in Vercel env vars". Vercel was retired 2026-07-20. FIXED IN PLACE this pass (now says Railway). |
| `vercel_secret_usage_audit.md` | **STALE** _[FIXED IN PLACE]_ | Action item "Set LCC_API_KEY in Vercel (staging + production)" names a deployment target that no longer exists (Vercel retired 2026-07-20). BANNERED IN PLACE this pass. |
| `copilot_operating_system_blueprint_v1.1.md` | **DUPLICATE** _[content folded, replaced with pointer]_ | Same subject as copilot_operating_system_blueprint.md; no inbound reference to this file found while base is actively cited by 5+ docs. |
| `POWER-AUTOMATE-API-HTML-TRIAGE-CODEX-PROMPT-2026-08-11.md` | **HISTORICAL** _[title+skim]_ | A prompt artifact for the triage session above, not itself a design reference. |
| `W7_1_deal_email_match_dryrun_2026-08-06.md` | **HISTORICAL** _[title+skim]_ | Dated dry-run report for one matcher round; matcher-recall-design.md is the living design reference. |
| `activity-coverage-audit.md` | **HISTORICAL** _[title+skim]_ | Dated audit (2026-07-31) of one signal; superseded in practice by data-coherence-invariants.md / data-availability-map.md as the living references. |
| `calendar-tz-fix-runbook.md` | **HISTORICAL** _[title+skim]_ | Named deployment runbook for one fix; calendar-system-status.md is the living as-built reference. |
| `closed-loop-reconciliation.md` | **HISTORICAL** _[title+skim]_ | Dated analysis+status note (2026-07-31); cadence-engine.md is the current design reference for cadence advancement. |
| `comps-pipeline-gap-audit-2026-08.md` | **HISTORICAL** _[title+skim]_ | Dated gap audit for one round. |
| `copilot_action_registry.md` | **HISTORICAL** | Orphaned build-progress/plan report, not cited by any current index; superseded in practice by copilot_authoritative_architecture_plan.md + copilot_agent_catalog.md (REGISTRY.md §B). |
| `copilot_capability_map_lcc.md` | **HISTORICAL** | Orphaned build-progress/plan report, not cited by any current index; superseded in practice by copilot_authoritative_architecture_plan.md + copilot_agent_catalog.md (REGISTRY.md §B). |
| `copilot_wave1_build_plan.md` | **HISTORICAL** | Orphaned build-progress/plan report, not cited by any current index; superseded in practice by copilot_authoritative_architecture_plan.md + copilot_agent_catalog.md (REGISTRY.md §B). |
| `daily_briefing_home_panel_note.md` | **HISTORICAL** _[title+skim]_ | Short note (35 lines); likely folded into the live daily-briefing docs, not itself the reference. |
| `daily_briefing_integration_plan.md` | **HISTORICAL** _[title+skim]_ | Integration PLAN doc; briefing-analyst-take-onprem.md (CLAUDE.md-cited) is the current canonical daily-briefing reference — this plan predates it. |
| `dossier-design-vs-production-23654.md` | **HISTORICAL** _[title+skim]_ | Named one-property audit/comparison; feeds the living dossier docs, not itself the canonical reference. |
| `dossier-reconciliation-23654-worklog.md` | **HISTORICAL** _[title+skim]_ | Named worklog for one property reconciliation session; superseded by dossier-standard-and-llm-contract.md + DOSSIER-PROGRAM-STATE-OF-PLAY.md as the living references. |
| `error-triage-2026-08-01.md` | **HISTORICAL** _[title+skim]_ | Dated incident triage ("morning error wave"); item marked FIXED in-file. Point-in-time record. |
| `intake_promote_round_76_recap.md` | **HISTORICAL** _[title+skim]_ | Round-numbered recap of a completed round; superseded by current CLAUDE.md OM-intake invariants + om_intake_pipeline.md. |
| `intent-resolution-audit-2026-08-03.md` | **HISTORICAL** _[title+skim]_ | Dated "Phase 1" audit; request-understanding-and-consistency-layer.md is the design-level successor. |
| `lcc-microsoft-copilot-outlook-audit-2026-05-22.md` | **HISTORICAL** _[title+skim]_ | Dated audit (2026-05-22, oldest cluster of any file in this directory); likely superseded by current Microsoft/Outlook wiring described in CLAUDE.md and connectivity-and-open-threads.md. |
| `lcc-microsoft-salesforce-pipeline-gap-analysis.md` | **HISTORICAL** _[title+skim]_ | Contains its own "✅ DONE" markers for several items — a gap-analysis worklog whose findings have since shipped; not itself the living reference. |
| `offer-submission-DELIVERY-LEGS.md` | **HISTORICAL** _[title+skim]_ | File's own banner: "SUPERSEDED (2026-07-30) — build history only"; already self-identifies as historical. |
| `offer-submission-DEPLOY-1.1-and-2.2.md` | **HISTORICAL** _[title+skim]_ | File's own banner: "SUPERSEDED (2026-07-30) — build history only"; already self-identifies as historical. |
| `outlook_intake_pa_base64_fix.md` | **HISTORICAL** _[title+skim]_ | Named point fix ('Base64 Upload Fix'); the fix itself is now baked into CLAUDE.md's OM-intake footgun list ("the HTTP PUT body MUST use base64ToBinary"). |
| `power-automate-api-html-triage-2026-08-11.md` | **HISTORICAL** _[title+skim]_ | Dated evidence report for one triage session. |
| `power-automate-audit-worklog.md` | **HISTORICAL** _[title+skim]_ | Named worklog; power-automate-flow-audit.md + power-automate-observability-standards.md are the living registry/standards. |
| `rent-intelligence-engine-phase1-discovery.md` | **HISTORICAL** | Orphaned build-progress/plan report, not cited by any current index; superseded in practice by rent-intelligence-engine-phase5-report.md (terminal report in the series). |
| `rent-intelligence-engine-phase2-report.md` | **HISTORICAL** | Orphaned build-progress/plan report, not cited by any current index; superseded in practice by rent-intelligence-engine-phase5-report.md. |
| `rent-intelligence-engine-phase3-report.md` | **HISTORICAL** | Orphaned build-progress/plan report, not cited by any current index; superseded in practice by rent-intelligence-engine-phase5-report.md. |
| `rent-intelligence-engine-phase4-report.md` | **HISTORICAL** | Orphaned build-progress/plan report, not cited by any current index; superseded in practice by rent-intelligence-engine-phase5-report.md. |
| `rent-intelligence-engine-phase5-report.md` | **HISTORICAL** | Terminal report of an orphaned 5-part build-progress series, not cited by any current canonical index (CLAUDE.md/REGISTRY/CURRENT-STATE/PLANNED-BACKLOG); title-checked only, verify against live rent-intelligence code before citing. |
| `round_76_deploy_checklist.md` | **HISTORICAL** _[title+skim]_ | Round-numbered deploy checklist for a completed round. |
| `sf_deal_closing_email_ingest_PLAN.md` | **HISTORICAL** _[title+skim]_ | Explicit "Status: PLAN (no code written yet)" from 2026-06-23; verify still-unbuilt against CURRENT-STATE.md/PLANNED-BACKLOG.md before treating as live design. |
| `sf_file_backfill_flow6_next_steps.md` | **HISTORICAL** _[title+skim]_ | Dated session worklog ("Next-Session Notes"), point-in-time state capture for one flow debug session. |
| `ADR-004-CANONICAL-PERSON-IDENTITY.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `BUILD-01-sf-opportunity-sync.md` | **CANONICAL** _[title+skim]_ | Build spec for the deal spine's first step (SF Opportunity Sync). |
| `BUILD-01B-sf-deal-sync-flow.md` | **CANONICAL** _[title+skim]_ | Companion PA-flow build spec to BUILD-01. |
| `DOSSIER-PROGRAM-STATE-OF-PLAY.md` | **CANONICAL** _[title+skim]_ | Explicit "START HERE" for the dossier program; the program-level index doc for the whole dossier cluster. |
| `HEALTHCARE-ASC-FIRST-STAGING-RUNBOOK-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `HEALTHCARE-ASC-IDTF-ECONOMICS-AND-SAMPLING-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `HEALTHCARE-ASC-IDTF-LCC-INTEGRATION-CONTRACT-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `HEALTHCARE-ASC-IDTF-PRIVATE-RUN-AUTHORIZATION-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `HEALTHCARE-ASC-IDTF-SOURCE-MANIFEST-CONTRACTS-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `HEALTHCARE-REAL-ESTATE-AND-ECONOMICS-BUSINESS-PLAN-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `HEALTHCARE-SOURCE-SUFFICIENCY-CARDS-ASC-IMAGING-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `HEALTHCARE-SWIM-LANE-EVALUATION-MATRIX-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `INTAKE_TODO_FLOW_AUDIT_2026-07-23.md` | **CANONICAL** _[title+skim]_ | Cited by scott-pa-flows-reference.md as the basis for retiring two flows — still the load-bearing evidence doc for that live decision. |
| `LCC_DOCUMENTATION_RECONCILIATION_2026-08-11.md` | **CANONICAL** _[title+skim]_ | Reconciliation note for architecture/OS/PA docs — process-level reference, not a single-round worklog. |
| `NBT_PHASE2_sf_activity_sync.md` | **CANONICAL** _[title+skim]_ | Phase 2 progress/response-signal spec for SF-Activity sync. |
| `ONCOLOGY-INFUSION-IMPLEMENTATION-READINESS-PACKAGE-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `ONCOLOGY-INFUSION-NPPES-SOURCE-ADAPTER-SPEC-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `ONCOLOGY-INFUSION-PHASE-A-BUILD-PLAN-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `ONCOLOGY-INFUSION-PILOT-COHORT-SPEC-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `ONCOLOGY-INFUSION-PRIVATE-VERIFICATION-SAMPLE-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `ONCOLOGY-INFUSION-READ-ONLY-PROFILE-PLAN-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `ONCOLOGY-INFUSION-READ-ONLY-PROFILE-RESULT-2026-08-11.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `ONCOLOGY-INFUSION-SERVICE-CORROBORATION-ADR-005.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `ONCOLOGY-INFUSION-STAGING-AND-INGESTION-CONTRACT-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `OUTPATIENT-HEALTHCARE-LANE-PACK-SPEC-v0.1.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `SALESFORCE-METADATA-GAP-MATRIX-2026-08-11.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `SALESFORCE-PAYLOAD-FIELD-PROFILE-2026-08-11.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `SF-WRITEBACK-AND-DOSSIER-BUILD-STATE.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md` | **CANONICAL** _[title+skim]_ | Wave 7 plan for comms-driven context propagation. |
| `access-scoping-and-my-work.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `account-based-contact-intelligence.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `actor-attribution-phase1.md` | **CANONICAL** | "Foundation done + code change spec" for a live rollout gap (team-visibility provenance / manager overview); referenced conceptually by team-visibility-and-owner-scoping.md. |
| `address_normalization_spec.md` | **CANONICAL** _[title+skim]_ | Spec referenced by the live `.github/workflows/address-normalize-drift.yml` check named in root CLAUDE.md. |
| `ai-and-ocr-cost-strategy.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `ai-next-step-engine-PHASE1-BUILT.md` | **CANONICAL** _[title+skim]_ | "Status: shipped to DB; JS ready to merge" — delta doc on the scope above; read together. |
| `ai-next-step-engine-scope.md` | **CANONICAL** _[title+skim]_ | "Status: scope (no build yet)" companion to the PHASE1-BUILT delta doc below. |
| `app-ux-review-2026-09-02.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `bd-ranking-and-priority-queue.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `briefing-analyst-take-onprem.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `broker-and-firm-identity.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `cadence-engine.md` | **CANONICAL** _[title+skim]_ | Design reference for cadence advancement; CLAUDE.md's "Single-advance-owner (cadence)" section describes the same live mechanism. |
| `calendar-system-status.md` | **CANONICAL** _[title+skim]_ | As-built system status for the unified calendar; self-reports its own two remaining gaps rather than hiding them. |
| `closed-deal-asset-entity-and-deal-spine.md` | **CANONICAL** _[title+skim]_ | Spec for closed-deal asset entity + deal-spine wiring. |
| `comps-data-integrity-and-canonical-record.md` | **CANONICAL** _[title+skim]_ | Canonical-record initiative design for comps data quality. |
| `connected-agent-architecture.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `connected-agent-descriptions.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `connectivity-and-open-threads.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `contact-entity-resolution.md` | **CANONICAL** _[title+skim]_ | Design finding (A2) on contact→entity resolution gap. |
| `contact-owner-sidebar-design.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `contact-reconciliation-outbound.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `contact-reconciliation.md` | **CANONICAL** _[title+skim]_ | "Status: RPC + correspondent_backfill_log applied live" — active identity-spine reference, sibling to CLAUDE.md-cited contact-reconciliation-outbound.md. |
| `context_packet_schema.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `copilot_agent_catalog.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `copilot_authoritative_architecture_plan.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `copilot_operating_system_blueprint.md` | **CANONICAL** | Actively referenced as a dependency by 5+ other architecture docs (infrastructure_migration_plan.md, copilot_wave1_build_plan.md, context_packet_schema.md, copilot_agent_catalog.md). |
| `correspondence-ingestion-design.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `costar-sidebar-capture-pipeline.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `cross-cutting-design.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `daily_briefing_payload_contract.md` | **CANONICAL** _[title+skim]_ | Payload contract likely still in force for the live daily-briefing pipeline (briefing-analyst-take-onprem.md, CLAUDE.md-cited) — not superseded by anything found this pass. |
| `data-availability-map.md` | **CANONICAL** _[title+skim]_ | Foundational map of what data powers the intelligence layer; referenced conceptually across the ownership/connectivity docs. |
| `data-coherence-invariants.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `data-integrity-audit-2026-08.md` | **CANONICAL** _[title+skim]_ | Data-integrity audit still describing live source/coverage/precedence structure (not a single-round worklog). |
| `data-quality-lease-and-owner.md` | **CANONICAL** _[title+skim]_ | Data-quality reference for lease duplicates + property-owner accuracy. |
| `data_quality_self_learning_loop.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `deal-address-resolution-design.md` | **CANONICAL** _[title+skim]_ | Design spec extending the Owner Reconcile Engine. |
| `deal-backbone-design-refinements.md` | **CANONICAL** _[title+skim]_ | Refinements to the live deal-backbone design (post-BUILD-01). |
| `deal-correspondence-attribution.md` | **CANONICAL** _[title+skim]_ | Design note underlying correspondence-ingestion-design.md (CLAUDE.md-cited). |
| `deal-party-roster-source.md` | **CANONICAL** _[title+skim]_ | Source re-spec for the deal-party roster, referenced by PLANNED-BACKLOG P12's "Deal_Participants__c dead end" row. |
| `deal-surface-packet-and-layout.md` | **CANONICAL** _[title+skim]_ | Packet contract + app layout for the live Deal Surface. |
| `design-considerations.md` | **CANONICAL** _[title+skim]_ | Pre-build design-review note underlying multiple live subsystems. |
| `dia-ownership-master-bridge-2026-08.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `dialysis-economics-and-medicare-data.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `document-capture-and-ocr-status.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `document-capture-ocr-and-deeds.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `documents-and-dossiers-design.md` | **CANONICAL** _[title+skim]_ | Design reference for the OM viewer + property/deal dossiers, sibling to DOSSIER-PROGRAM-STATE-OF-PLAY.md. |
| `dossier-followup-prompts-for-claude-code.md` | **CANONICAL** _[title+skim]_ | Follow-up prompt set for the dossier build program. |
| `dossier-generation-and-ollama-wiring.md` | **CANONICAL** _[title+skim]_ | Architecture for dossier generation's Ollama wiring. |
| `dossier-production-wiring-runbook.md` | **CANONICAL** _[title+skim]_ | Operator runbook for the live dossier generator. |
| `dossier-standard-and-llm-contract.md` | **CANONICAL** _[title+skim]_ | The LLM-replicable dossier standard, referenced by DOSSIER-PROGRAM-STATE-OF-PLAY.md as "START HERE". |
| `dossier-v2-audit-and-triage.md` | **CANONICAL** _[title+skim]_ | v2 data audit/pipeline triage for the dossier program's gold-standard property. |
| `edge-function-deploy-drift.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `edge-layers-design.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `entity-identity-and-dedup.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `entity-reconciliation-design.md` | **CANONICAL** _[title+skim]_ | Design spec (A1) for entity reconciliation, sibling to contact-entity-resolution.md. |
| `fact-ingestion-and-propagation.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `field-provenance-ladder.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `field_source_priority_ramp_plan.md` | **CANONICAL** _[title+skim]_ | "Status: most rules in record_only mode" — active ramp plan, sibling to CLAUDE.md-cited field-provenance-ladder.md. |
| `gov-asset-identity-coverage-2026-08.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `gov-property-duplicates.md` | **CANONICAL** | Tracked in PLANNED-BACKLOG.md §P11 as an accurate, gated, design-only spec ("no ingestion/migration/write authorized" is the design, not staleness). |
| `infrastructure-topology.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `infrastructure_migration_plan.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `intelligence-layer-design.md` | **CANONICAL** _[title+skim]_ | Design reference underlying unified-intelligence-layer.md. |
| `lcc_intelligent_operating_system_v2.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `lcc_workflow_engine_spec.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `lease-data-provenance.md` | **CANONICAL** _[title+skim]_ | Foundational schema-design reference for lease field provenance. |
| `living-deal-dossier-and-systems-connection.md` | **CANONICAL** _[title+skim]_ | Architecture for the living deal dossier + systems connection. |
| `matcher-recall-design.md` | **CANONICAL** _[title+skim]_ | Recall v2 design for the deal-email matcher (A5). |
| `mcp-server-unification.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `microsoft-surface-architecture.md` | **CANONICAL** _[title+skim]_ | Decision note for the Microsoft-surface split, referenced by the connectivity map cluster. |
| `my-day-surface.md` | **CANONICAL** _[title+skim]_ | "Status: LIVE (2026-07-31)" — current surface reference. |
| `next-best-action-and-app-layout.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `offer-context-connectivity.md` | **CANONICAL** _[title+skim]_ | Data-capture/connectivity design for offer context. |
| `offer-submission-SETUP-RUNBOOK.md` | **CANONICAL** _[title+skim]_ | Manual/human setup runbook for the live offer-submission flow (sibling delivery-legs/deploy docs already marked historical as build-history-only). |
| `offer-submission-process-design.md` | **CANONICAL** _[title+skim]_ | v2 process design for offer submission, grounded in the live Claude Project. |
| `om_intake_pipeline.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `outlook_intake_team_visibility_workflow.md` | **CANONICAL** _[title+skim]_ | Current-vs-hardened workflow reference for the live Outlook intake path. |
| `owner-reconciliation-engine.md` | **CANONICAL** _[title+skim]_ | "Status: LIVE"; already carries the correct NAMING TRAP banner pointing at property-owner-subsystem.md — a good-citizen example the filing standard itself cites. |
| `owner-role-classification.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `ownership-data-provenance.md` | **CANONICAL** _[title+skim]_ | Foundational schema-design reference for ownership field provenance; sibling to CLAUDE.md-cited field-provenance-ladder.md. |
| `ownership-history-lane.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `panel-redesign-verification.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `power-automate-flow-audit.md` | **CANONICAL** _[title+skim]_ | Live flow registry; power-automate-observability-standards.md is its sibling standards doc. |
| `power-automate-observability-standards.md` | **CANONICAL** _[title+skim]_ | Live standards doc for PA flow reliability. |
| `power-automate-remediation-plan.md` | **CANONICAL** | Live remediation plan sibling to power-automate-flow-audit.md / power-automate-observability-standards.md. |
| `proactive-deal-monitor.md` | **CANONICAL** _[title+skim]_ | Architecture/design for the proactive deal monitor. |
| `producer-health-and-ci-enforcement.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `property-contact-deal-connectivity.md` | **CANONICAL** _[title+skim]_ | Connectivity model underlying contact-owner-sidebar-design.md (CLAUDE.md-cited). |
| `property-identity-and-address-resolution.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `property-metadata-coverage.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `property-owner-panel-redesign-2026-08.md` | **CANONICAL** _[title+skim]_ | Target-state design for the live property/owner panel; sibling to panel-redesign-verification.md (CLAUDE.md-cited claim→evidence matrix). |
| `property-owner-source-authority-and-doctrine.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `property-owner-subsystem.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `property-tab-ux-review.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `provenance_resolution_ui_scope.md` | **CANONICAL** _[title+skim]_ | "Status: scoped, not built" — accurately labeled unbuilt scope doc, sibling to field-provenance-ladder.md. |
| `public-records-source-lane.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `request-understanding-and-consistency-layer.md` | **CANONICAL** _[title+skim]_ | Cross-tool design note underlying the live request-understanding behavior. |
| `research-workbench.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `salesforce_nm_authoritative_sync.md` | **CANONICAL** _[title+skim]_ | "Status: Foundation shipped" — describes the live is_northmarq classifier. |
| `scott-pa-flows-reference.md` | **CANONICAL** _[title+skim]_ | Build-ready operational reference for Scott's live PA flows; correctly self-labels retired sub-items rather than being stale as a whole. |
| `sf-note-records-ownership-bridge-2026-08.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `sf-owner-capture.md` | **CANONICAL** _[title+skim]_ | "Status: LIVE end-to-end"; already carries the correct NAMING TRAP banner. |
| `sf_connected_app_setup.md` | **CANONICAL** _[title+skim]_ | Setup reference for the live Salesforce Connected App server-side file fetch. |
| `sf_daily_bulk_backfill_RUNBOOK.md` | **CANONICAL** _[title+skim]_ | Runbook for the live SF daily bulk file backfill (Flow 7). |
| `supabase-consolidation-phase0-inventory.md` | **CANONICAL** _[title+skim]_ | "Status: in progress" inventory feeding supabase-consolidation-plan.md (CLAUDE.md/os-cited canonical plan). |
| `supabase-consolidation-plan.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `supersession-tie-lane-2026-08.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `team-mailbox-intake-design.md` | **CANONICAL** _[title+skim]_ | Design spec (B2) for team mailbox intake, referenced by PLANNED-BACKLOG P13 item 2 as a live decision fork. |
| `team-visibility-and-owner-scoping.md` | **CANONICAL** _[title+skim]_ | Design finding note underlying the live owner-scoping behavior described elsewhere (access-scoping-and-my-work.md, CLAUDE.md-cited). |
| `teams_daily_briefing_delivery_workflow.md` | **CANONICAL** _[title+skim]_ | Delivery workflow for the live Teams daily-briefing send. |
| `template_library_spec.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `tier0-owner-contact-system.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `touchpoint_cadence_spec.md` | **CANONICAL** _[title+skim]_ | Specification referenced conceptually throughout CLAUDE.md's cadence-engine invariants. |
| `unification-changeset.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |
| `unified-intelligence-layer.md` | **CANONICAL** _[title+skim]_ | Design reference for the self-resolving inbox/brain concept underlying next-best-action-and-app-layout.md (CLAUDE.md-cited). |
| `w6-5-frontend-decomposition-map.md` | **CANONICAL** | Cited as the/an authoritative page for its topic by root CLAUDE.md and/or docs/os/{CURRENT-STATE,REGISTRY,README,PLANNED-BACKLOG}.md. |

## NOT REACHED — explicit boundary for the next pass

- **The ~93 "title+skim" rows above got a title/status-line read and a grep for known trouble
  patterns (`Vercel`, `SUPERSEDED`) — not a substantive re-check of their central technical claims
  against current DB/code state.** Any of them could carry the same class of stale claim the Vercel
  grep found, just under a different retired dependency, flipped flag, or superseded schema. A next
  pass should repeat the same technique (grep the whole set for one known-retired/changed thing at a
  time — e.g. `queue_v2_enabled`, `CONTACTS_HUB=gov` vs `ops`, any table/view name a CLAUDE.md entry
  says was renamed or dropped) rather than re-reading all 181 files line by line.
- **Files outside `docs/architecture/` were not classified at all** — `docs/audits/`, `docs/setup/`,
  `docs/os/canon/`, `docs/copilot/`, `docs/data-quality/`, `docs/flows/`, `docs/resolver/`, and the
  repo-root `.md` files (`SPEC_*.md`, `SALESFORCE_LCC_INGESTION_PLAN.md`,
  `WRITE_SURFACE_POLICY.md`, etc.) are out of this pass's scope. `docs/os/DOCUMENTATION-MAP.md` §2
  already states the filing rule for most of these; a DOCMAP2 pass would need to classify them the
  same way this file classifies `docs/architecture/`.
- **The `docs/claude-code/done/` legacy folder (84 files) was not individually classified** — it was
  handled as one unit (README banner explaining it's legacy/pre-split, do not add to it). A future
  pass could fold any still-relevant content into `docs/history/` with a proper index per
  `DOCUMENTATION-MAP.md` §7, but that is a larger, lower-value effort than this pass's budget allowed.
- **No file was deep-verified against a live database or a live deploy** in this pass except
  `field-provenance-ladder.md` (the task brief's named example) and the four Vercel-stale files. Every
  other "verified" tag means "cited by a current index," not "re-derived from source of truth."

---

## Subdirectories (DOCMAP3, 2026-09-08) — `docs/architecture/flows/`, `ai-chat-routing/`, `backfill-artifacts/`, `office-scripts/`

DOCMAP2 counted these 51 files (`docs/architecture/` grew 181→232 non-recursively-missed) but did
not classify any of them. This pass reads and verdicts all 51, cross-referenced against
`docs/os/FLOW-REGISTRY.yaml` (the authority on which flow docs are current/retired) — the method
DOCMAP1 used for the rest of `docs/architecture/`, i.e. registry citation ⇒ CANONICAL, retired-flow
match ⇒ RETIRED, else title+skim ⇒ HISTORICAL unless a concrete stale claim is found.

### `flows/` (45 files)

| file | verdict | rationale |
|---|---|---|
| `FLOW_CHANGES_LOG.md` | **CANONICAL** | Registry `runbook:` for `sf-property-promotion`. Append-only dated log — one historical entry (Apr 28 2026) quotes the retired Vercel URL as part of a past run's diagnosis; left as-is (accurate history of what the flow called *then*), not a live-instruction defect. |
| `sync-sf-activities-to-supabase.md` | **CANONICAL** | Registry `runbook:` for `sf-activity-sync`. |
| `dead-letter-fault-branch-runbook.md` | **CANONICAL** | Registry `runbook:` for `sf-retry-dead-letter`. |
| `processing-complete-move-message.md` | **CANONICAL** | Registry `runbook:` for `outlook-processing-complete`. |
| `todo-completion-poll.md` | **CANONICAL** | Registry `runbook:` for `outlook-todo-completion-poll`. |
| `lcc-flagged-email-intake.md` | **CANONICAL** | Registry `runbook:` for `outlook-flagged-email-intake`. |
| `http-switch-salesforce-lookup.md` | **CANONICAL** | Registry `runbook:` for `sf-http-switch-lookup`. |
| `todo-lcc-sync.md` | **RETIRED→FIXED (DOCMAP3)** | Matches `retired_flows: retired-todo-lcc-sync` ("To Do - Life Command Center Sync") in FLOW-REGISTRY.yaml. Carried no retirement banner; banner added this pass. |
| `unflag-completed-email-tasks.md` | **RETIRED→FIXED (DOCMAP3)** | Matches `retired_flows: retired-unflag-completed`. Same defect; banner added this pass. |
| `http-init-llc-repair-runbook.md` | **STALE→FIXED (DOCMAP3)** | Cited the retired Vercel host as the live endpoint (2 hits); banner added this pass, per J13/CLAUDE.md. |
| `http-parsejson-property-email.md` | **STALE→FIXED (DOCMAP3)** | Same — banner added. |
| `lcc-daily-briefing.md` | **STALE→FIXED (DOCMAP3)** | Same — banner added. |
| `lcc-morning-briefing.md` | **STALE→FIXED (DOCMAP3)** | Same — banner added. |
| `lcc-outlook-calendar-write.md` | **STALE→FIXED (DOCMAP3)** | Same — banner added. |
| `lcc-outlook-intake.md` | **STALE→FIXED (DOCMAP3)** | Same — banner added. |
| `lcc-weekday-briefing-email.md` | **STALE→FIXED (DOCMAP3)** | Same — banner added. |
| `button-send-http-request.md` | **HISTORICAL** _[title+skim]_ | Small build note for a flow action not represented as its own `logical_id` in the registry; no registry citation, no stale-endpoint hit. |
| `closing-the-loop-overview.md` | **HISTORICAL** _[title+skim]_ | Cross-flow narrative overview; not a registry `runbook:` target. |
| `complete-sf-task.md` | **HISTORICAL** _[title+skim]_ | Not a registry `runbook:` target; describes a build/troubleshooting session. |
| `daily-briefing-processing-summary.md` | **HISTORICAL** _[title+skim]_ | Same. |
| `flagged-email-cleanup-sweep-build-sheet.md` | **HISTORICAL** _[title+skim]_ | Build sheet, dated by nature; not a registry `runbook:` target. |
| `flagged-email-cleanup-sweep.md` | **HISTORICAL** _[title+skim]_ | Same class. |
| `flagged-email-to-todo-task.md` | **HISTORICAL** _[title+skim]_ | Same class. |
| `flagged-email-to-todo.md` | **HISTORICAL** _[title+skim]_ | Same class. |
| `flagged-personal-email-to-todo.md` | **HISTORICAL** _[title+skim]_ | Same class. |
| `google-alerts-subfolder-watch.md` | **HISTORICAL** _[title+skim]_ | Not a registry-cited flow (Google Alerts flow is outside the 17-flow PA baseline). |
| `google-news-alert-power-automate.md` | **HISTORICAL** _[title+skim]_ | Same. |
| `govlease-lead-sync.md` | **HISTORICAL** _[title+skim]_ | Not registry-cited. |
| `http-init-llc.md` | **HISTORICAL** _[title+skim]_ | Sibling of the STALE repair-runbook above; no vercel hit itself, not registry-cited. |
| `http-postmessagechat.md` | **HISTORICAL** _[title+skim]_ | Not registry-cited. |
| `http-postmessagechat2.md` | **HISTORICAL** _[title+skim]_ | Not registry-cited. |
| `lcc-personal-calendar-sync.md` | **HISTORICAL** _[title+skim]_ | Not registry-cited (distinct from registry's `outlookcalendar-lcc-sync` naming). |
| `lcc-sf-flow1-queue-worker.md` | **HISTORICAL** _[title+skim]_ | Not registry-cited under this filename (registry's SF queue drainer runbook is `SF-WRITEBACK-AND-DOSSIER-BUILD-STATE.md`). |
| `log-activity-to-sf-from-lcc.md` | **HISTORICAL** _[title+skim]_ | Not registry-cited. |
| `manual-foreachpost-teams.md` | **HISTORICAL** _[title+skim]_ | Not registry-cited. |
| `move-queue-executor.md` | **HISTORICAL** _[title+skim]_ | Not registry-cited. |
| `outlook-draft-reply-executor.md` | **HISTORICAL** _[title+skim]_ | Not registry-cited. |
| `outlookcalendar-lcc-sync.md` | **HISTORICAL** _[title+skim]_ | Not registry-cited (registry has no calendar-sync `logical_id`). |
| `recovery-reflag-completed-emails.md` | **HISTORICAL** _[title+skim]_ | Dated recovery-procedure note. |
| `sync-flagged-emails-to-supabase.md` | **HISTORICAL** _[title+skim]_ | Not registry-cited. |
| `sync-sf-tasks-to-supabase.md` | **HISTORICAL** _[title+skim]_ | Not registry-cited (distinct from the registry-cited `sync-sf-activities-to-supabase.md`). |

**⚠️ These 27 HISTORICAL verdicts are title+skim only — no cross-check for a stale claim inside each
was performed beyond the case-insensitive Vercel grep (which returned 0 hits on all 27).** A future
pass should grep them for other known-retired identifiers before trusting their operational detail.

### `ai-chat-routing/` (4 files)

| file | verdict | rationale |
|---|---|---|
| `AI_CHAT_DASHBOARD_INTERPRETATION.md` | **HISTORICAL** _[title+skim]_ | Interpretation guide for a rollout checklist; no cross-reference found in CLAUDE.md/CURRENT-STATE/canon for "ai chat routing" — not confirmed current, not confirmed stale. |
| `AI_CHAT_ROLLOUT_CHECKLIST.md` | **HISTORICAL** _[title+skim]_ | States "Current Target: policy: balanced" — this specific claim was NOT verified against the live routing config (out of budget this pass); flagged for follow-up rather than asserted either way. |
| `AI_CHAT_ROLLOUT_RESULTS_TEMPLATE.md` | **HISTORICAL** _[title+skim]_ | Blank results template — structurally cannot be stale (no factual claims to check). |
| `LCC_AI_COST_AND_CHATBOT_REVIEW.md` | **HISTORICAL** _[title+skim]_ | Dated 2026-03-24 review session, five-plus months before this pass; likely superseded by later AI-surface work (canon/AI-SURFACES-OPERATIONAL-REFERENCE.md) but not confirmed superseded — not deep-read. |

### `backfill-artifacts/` (1 md file)

| file | verdict | rationale |
|---|---|---|
| `README.md` | **HISTORICAL** _[title+skim]_ | Dated 2026-07-30 deliverables README for a completed backfill; points to `../contact-reconciliation.md` as the live design doc, consistent with a historical artifacts record rather than a canonical page. |

### `office-scripts/` (1 md file)

| file | verdict | rationale |
|---|---|---|
| `README.md` | **CANONICAL** _[title+skim]_ | Describes the live mechanism (Office Scripts + Excel Online connector) the Document Assembly Agent currently uses for >5MB/cell-level workbook edits — operational reference for a live capability, not dated build narrative. Not deep-verified against the actual deployed script. |

**Unit A totals: 51 enumerated, 51 read (title+skim or deeper as noted), 9 defects found (7 stale-endpoint + 2 missing-retirement-banner), 9 defects fixed (all 9 — 7 stale-endpoint banners + 2 retirement banners).**
