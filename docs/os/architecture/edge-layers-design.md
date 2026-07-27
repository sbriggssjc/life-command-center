# Edge Layers — completing the design (reporting, onboarding, compliance, integrations, QA)
_2026-07-27._ The remaining lenses/edges. All are views or flows over the SAME substrates — none forks a store.

## E1 · Reporting & Analytics (BI lens on the substrates)
**What:** business intelligence distinct from the operator's daily queue — conversion, velocity, win/loss, production, team perf.
**Design:** read-only analytical **views + periodic snapshots** over existing substrates (no new store):
- **Pipeline funnel** — `bd_opportunities` by stage + stage-transition conversion (+ `pipeline_velocity`).
- **Production** — BOVs/OMs/comps delivered (`action_items` completed by type; `lcc_cre_bov_extraction`).
- **Activity** — calls/emails/touches per broker/period (`activity_events`).
- **Win/loss + cycle time** — `bd_opportunities` outcomes × days-in-stage; **forecast** = `expected_close_date` × stage-probability.
- **Cadence adherence** — due vs completed touches.
**Surfacing:** an app "Reports" section + scheduled report emails (the weekly pipeline email is one report); on-demand via
surfaces (`get_pipeline_health`). **RBAC-scoped** (broker=own, lead=team, admin=all). Snapshots reuse `briefing_intel_snapshot`.

## E2 · Onboarding & Backfill (get existing data in, repeatably)
**What:** bring existing deals/contacts/rosters/history in cleanly; make contact/deal onboarding repeatable (Frank was manual).
**Design (all idempotent via the fact-fabric merge + external ids):**
- **Bulk backfill** — SF (opps/contacts/accounts → `bd_opportunities`/`unified_contacts`/`entities` via SF sync + merge);
  folders (folder-watch + doc extraction → dossiers); `.md` rosters → `entity_relationships` `deal_party` edges.
- **Repeatable contact onboarding** — a "resolve & link contact" tool that generalizes the Frank steps: name/email →
  find in SF → create `entities` person + `unified_contacts` link + roster edge. (One tool, not manual SQL.)
- **Repeatable deal onboarding** — SF Opportunity / new listing → ensure deal entity + dossier + roster + (PSA) timeline.
**Plug-in:** uses SF sync + merge primitive + resolution; a one-time backfill run + always-on onboarding tools.

## E3 · Compliance, Data Governance & Retention (framework now, enforce as needed)
**What:** regulated-brokerage governance — PII, retention, audit, Northmarq compliance (ICBA/co-op/licensing).
**Design (framework):**
- **PII + access** — classify sensitive fields; access via RBAC + `visibility_scope`; **distill-before-egress (built)**
  keeps raw content in-tenant.
- **Retention** — per-class windows (emails/activity/docs) + archival; a retention config.
- **Audit trail** — every write/action already logs (`activity_events` + `processing_log` + Cortex) → an **audit view**
  ("who did what, when, why") — ties to H5 explainability.
- **Compliance rules as canon** — ICBA/co-op/licensing already partly in canon; formalize a `compliance` canon module.
- **Comms compliance** — opt-out / CAN-SPAM handling on marketing sends.
**Timing:** stand up the framework; enforce progressively.

## E4 · Integration Catalog (external connectors — the standard, then the builds)
**What:** enumerate the external systems; every one via the **LCC-broker + fact-fabric** pattern (never reasoning-plane direct).
**Catalog (each = in/out connector that merges facts with a source, then propagates):**
- **CoStar** — in: comps → comps DB + property-fact merge.
- **CREXi / Buildout / LoopNet** — out: OM/listing distribution; **in: webhits / OM-downloads → buyer-intent (Domain F2).**
- **County recorders** — in: deeds/sales → ownership facts + **sale comps** (fact-fabric closing propagator).
- **Title / escrow** — in: escrow status/milestones → contractual milestones (Domain E).
- **M365 / Salesforce** — built.
**Standard:** `connector-and-data-access` pattern + merge-with-source + autonomy/governance. Each is a **backlog build**;
the catalog sets priority + the required shape so none is bespoke.

## E5 · System QA & Trust Validation (folds into H5)
**What:** verify prioritization is right, cadence fires, propagation works, invariants hold.
**Design:**
- **Fixtures** — seeded test deals/contacts (Fresenius/Frank are the first) → assert dossier/cadence/queue outputs.
- **Invariant checks** — automated: no ad-hoc canonical writes (all via merge), no dup rows (external-id dedupe), every
  ranked action has a `reason`, one-writer dossier holds.
- **Pipeline health + explainability** — H5 monitors + "why" spot-checks.
- **Regression gate** — run fixtures before a build lands.
**Plug-in:** a test harness + the H5 observability; operational discipline, not a new store.

## Net
Design is complete: **fact-fabric + substrates → six domains → NBA synthesis → app → surfaces → cross-cutting (RBAC,
learning, autonomy, off-ramps, resilience) → edges (reporting, onboarding, compliance, integrations, QA).** Every layer
reads/writes the shared substrates through the merge primitive; nothing overlaps. Ready to build.
