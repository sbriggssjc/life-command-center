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
