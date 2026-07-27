# Build Backlog — the one resumable punch list
> **Master sequence & anti-overlap invariant: `UNIFIED-BUILD-PLAN.md`.** This backlog is the checklist; that is the order.
_Last updated: 2026-07-27._ Everything not-yet-fully-built, grouped, with dependencies + where it's designed.
Legend: 🔴 not started · 🟡 partially built · 🟢 designed/specced, ready to build · ⚪ optional/roadmap.
Pick up any item at any time; each points to its design doc.

## A. Deal Monitor + Cadence Engine  (fully DESIGNED, not built)
Design: `architecture/proactive-deal-monitor.md`, `architecture/cadence-engine.md`
- 🟢 **A1. Inbound SF Opportunity sync → `bd_opportunities`** — the dossier-at-BOV trigger + stage feed. Mirror of the outbound SF drainer. *(Phase 1 foundation.)*
- 🟢 **A2. `cadence-scan` endpoint** (engine) — reads `bd_opportunities` + `activity_events`, applies stage cadence, returns ranked due/overdue digest. *(Independently testable before A1.)*
- 🟢 **A3. Weekly pipeline email** — PA recurrence → calls A2 → composes digest grouped by stage → sends.
- 🟢 **A4. Deal correspondence attribution** — mail-intake ingestion is **already LIVE** (5,735 Outlook emails, distilled, contact-resolved). The delta is attributing deal-relevant email to the DEAL: (i) **deal roster** edges in `entity_relationships`, (ii) a **deal-email matcher** (roster + escrow#/address/OM-PSA signals) → deal-attributed `activity_events` rows. Design: `architecture/deal-correspondence-attribution.md`. *(Backbone for dossier self-update.)*
- 🟢 **A5. PSA milestone-timeline population** at LOI-executed / In-Escrow (always carry an explicit Fresenius-style timeline). *(Phase 2.)*
- 🟢 **A6. Account layer** — new-prospect 7-touch (days 0/7/14/28/42/72/102) + tier nurture. **OPEN red-line: tiering computed-vs-manual.** *(Phase 3.)*
- 🟢 **A7. Draft-and-hold** the due touches (DraftOutreachEmail/DraftSellerUpdateEmail → Outlook drafts, never auto-sent). *(Phase 3.)*
- ⚪ **A8. Investor-outreach campaign manager** (ELA broad marketing — buyer list + priority + revisit). *(Phase 4, rides RunListingBdPipeline.)*

## B. SF Write-back + Dossier  (LIVE; extensions pending)
Design: `architecture/SF-WRITEBACK-AND-DOSSIER-BUILD-STATE.md`
- 🟡 **B1. Drainer → `create_task` + `advance_opportunity_stage`** kinds (log_call proven; same 3-step pattern). May need a 2nd SF flow for task-with-due-date / stage moves.
- 🟢 **B2. Connector write-action target description** → "deal or person" (small v4 re-import).
- 🟡 **B3. `updateOpportunity` beyond stage** — close_date/amount/probability/next_step need poller kinds + SF field mapping.
- 🟢 **B4. Idempotency key** on `logActivity` (prevents dup activity_events on connector retry).
- 🟢 **B5. Repeatable contact onboarding** — resolve a deal's roster into LCC + link SF (Frank Meyrath was manual).

## NBA. Next-Best-Action layer + App layout  (the unifying synthesis — sits ABOVE all domains)
Design: `architecture/next-best-action-and-app-layout.md`
- 🟢 **NBA1. All domains emit `action_items`** — one universal action store (exists, barely used); adapters from reconcile/comps/BOV/lease/cadence/marketing. Start with E.
- 🟢 **NBA2. Generalize the ranker** — extend `v_priority_queue` bands to score every action type; expose `next_best_action(user, context)`.
- 🟢 **NBA3. App "Today" home** — ranked next-best-action stream + one-tap execution; drill to dossier/pipeline/listing/worklists; team→user→role lenses.
- 🟢 **NBA4. Domain F feeds** — listing-scoped likely-buyers (F1) + buyer-intent boost (F2) into the stream.
- 🟢 **NBA5. Cross-surface parity** — every surface reads the same queue (`get_queue_summary`/`GetMyExecutionQueue`).

## F. Marketing & Audience Expansion (Domain F — next frontier after E)
Frame: `LCC-SYSTEM-MAP.md`
- 🟡 **F1. Ownership-of-similar "likely buyers" query** — rank likely acquirers for a listing from `entity_relationships` (owns/purchases) + owner-reconcile. Data exists; logic doesn't.
- 🔴 **F2. Buyer-intent ingestion** — webhits / OM downloads / saved searches (CREXi/Buildout/LoopNet) → `activity_events` intent touchpoints on buyer entities. **Genuinely unbuilt.**
- 🟡 **F3. Investor-outreach manager** (= Track1 A8) — consumes F1+F2 to drive prioritized broad-marketing outreach.
- ⚪ **F4. OM distribution + engagement tracking** loop.

## E-DESIGN. Edge layers (designed — `architecture/edge-layers-design.md`)
- 🟢 **E1. Reporting & Analytics** — BI views/snapshots over substrates; RBAC-scoped; app Reports + scheduled emails.
- 🟢 **E2. Onboarding & Backfill** — bulk backfill + repeatable contact/deal onboarding tools (generalize the Frank steps).
- 🟢 **E3. Compliance/Governance/Retention** — PII+RBAC, retention config, audit view, compliance canon module.
- 🟢 **E4. Integration Catalog** — CoStar / CREXi-Buildout-LoopNet (intent) / county recorders / title-escrow, all via LCC broker + fact-fabric.
- 🟢 **E5. System QA & Trust Validation** — fixtures + invariant checks + regression gate (folds into H5).

## FP. Fact Ingestion & Propagation  (foundational data-coherence layer — `architecture/fact-ingestion-and-propagation.md`)
- 🟢 **FP1. Coverage audit** — every learning point writes-through `lcc_merge_field` (+source) and emits propagation; list ad-hoc writers.
- 🟢 **FP2. Canonical lease record + lease-abstraction merge writer** — lease structure becomes first-class + provenanced (your lease example).
- 🟢 **FP3. Closing propagator** — ownership edge + **sale-comp creation** + deal-close + SF + dossier from one closing event.
- 🟡 **FP4. Generalize propagation** on `sync_inflight`/`listing_events` rails with H5 idempotency + dead-letter.

## H. Cross-cutting layers to DESIGN (pre-build review — `architecture/design-considerations.md` · **designs in `architecture/cross-cutting-design.md`**)
- 🟢 **H1. Identity, Users, Roles & Permissions (RBAC)** — biggest gap; design **before** the app "Today" home.
- 🟢 **H2. Feedback / learning loop** — outcomes → tune cadence/scoring/tiering; build NBA ranker as configurable weights from day one.
- 🟢 **H3. Autonomy & Trust ladder** — one policy for autonomous vs propose vs confirm, per action-type.
- 🟢 **H4. Lifecycle off-ramps** — lost / dormant / revived deals + account attrition.
- 🟢 **H5. Pipeline resilience & explainability** — idempotency, dead-letter, reconciliation, self-monitoring, "why".

## R. Redesign candidates (fix before building further on them)
- 🟡 **R1. Dossier `.md` = pure render of the LCC dossier** (one writer; kill drift).
- 🟡 **R2. Collapse two-server topology** (unification Phase 2) — killed a class of deploy bugs this session.
- 🟡 **R3. Commit to the v4 connector repave** — end v3/v4 drift.
- 🟢 **R4. NBA ranker = configurable weights** (ties H2).

## G. Cross-cutting principles (design invariants to hold)
- 🟢 **G1. Vertical-neutral build** — quarantine asset-type logic to 3 plug-in points (comps source, BOV skill, enrichment). Adding net-lease/other = new vertical value + those 3, no spine change. `LCC-SYSTEM-MAP.md`.
- 🟢 **G2. Anti-overlap invariant** — all domains read/write the shared substrates; no sibling stores. `UNIFIED-BUILD-PLAN.md`.

## C. OS rollout  (from BUILD-STATUS.md "what done needs")
- 🔴 **C0. `git push`** — commit this session's changes (mcp/sf-writeback.js, connector v3/v4, all the new docs). ← do first.
- 🟡 **C1. Surface applies** — paste ChatGPT persona; sync Northmarq / Personal / Cowork bundles (parity ✓, paste pending).
- 🟢 **C2. Copilot specialists** — create Document Files + Assembly agents in Studio; publish orchestrator delegation; apply Work IQ least-privilege.
- 🟢 **C3. Office Script** for pro-forma escalation + its Power Automate flow (`architecture/office-scripts/`).
- 🟡 **C4. SharePoint `_WORKFLOW` deployment docs (4)** — correct via Copilot in-tenant now Phase 1 unification is live.
- 🔴 **C5. D-drive triage + personal-project homing** (`ACCESS-TOPOLOGY.md`).
- ⚪ **C6. Unification Phase 2** — collapse to a single service, retire the standby.

## D. Connector reconciliation  (agent currently ~65 actions)
- 🟡 **D1. Repave the Deal Agent to the clean v4 (53 ops)** — remove the compat/duplicate actions; the additive-v3 was the interim. Reference: `LCC-Deal-Agent-Actions-Finalized.html`.

## E. Security & hygiene  (deferred to end by design)
- 🔴 **E1. Rotate Supabase `service_role` key** (appeared in a PA run output) + enable **Secure Inputs** on the drainer's Supabase HTTP steps.
- 🔴 **E2. Rotate `LCC_API_KEY`** — last, since it's threaded through the Power Automate flows.
- 🟢 **E3. RLS hardening** on the 34 exposed tables — run in a Supabase branch first (`architecture/rls-hardening.sql`).

## Suggested pickup order (when we resume the build)
1. **C0 git push** (bank the session).
2. **A2 cadence-scan** (engine, testable now) → **A1 SF Opportunity sync** → **A3 weekly email** = the pipeline monitor Phase 1.
3. **A4 mail-intake** (completes the dossier's self-update loop).
4. Finish the **execution/reasoning rollout** (C1/C2) in parallel — independent of the monitor.
5. **B/D** extensions + **E** security to close out.
