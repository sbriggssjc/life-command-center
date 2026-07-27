# LCC System Map — the whole picture (surfaces × layers × domains × verticals)
_2026-07-27._ The top-level frame. `UNIFIED-BUILD-PLAN.md` is ONE domain (E) inside this.

## LCC is the center (the brain)
Supabase (**OPS** + **dialysis** + **government** + comps) + **Cortex** (memory) + **canon** (rules). All logic,
memory, and rules live here. Every surface reads this brain; every external system is reached **through** LCC.

## Surfaces (reasoning/authoring plane) — the front doors
Claude Personal · Claude Cowork · ChatGPT · Northmarq Claude · **Copilot (in-tenant)** · LCC in-app.
Canon-bound — same brain/memory/voice. Reasoning surfaces never touch Northmarq systems directly; **Copilot is the
in-tenant execution door** (M365 read/write).

## Touching layers (execution/data plane) — what LCC integrates with
- **Microsoft 365** — Outlook (email: **live pipeline**), SharePoint (files/folders: folder-watch + Work IQ), Teams
  (cards), Office Scripts, To Do. Via Copilot in-tenant + Power Automate + Graph.
- **Salesforce** — contacts / accounts / opportunities(deals) / activities / ownership. **In:** SF sync →
  `bd_opportunities` + `unified_contacts`. **Out:** LCC-brokered write-back → drainer → SF (**live**).
- **Web / enrichment** — ownership data (reconcile), comps sources (CoStar), **buyer-intent (webhits/OM downloads — NOT yet)**.

## The Next-Best-Action layer (ABOVE the domains — the synthesis)
All six domains emit work into ONE `action_items` store, ranked by ONE band-scorer into each user's prioritized
"next best action" stream — which is the backbone of the app's push-forward. Design:
`architecture/next-best-action-and-app-layout.md`. This is the reconcile-consolidate-drive-forward layer.

## Capability domains — the workflow arc, each a flow THROUGH LCC
| | Domain | Status | Shared substrate it uses |
|---|---|---|---|
| **A** | **Research & Ownership Reconciliation** — enrich ownership, reconcile to SF accounts/contacts, keep records clean | ✅ BUILT (14 reconcile tables) | entities, entity_relationships, lcc_owner_reconcile*, unified_contacts |
| **B** | **Comps** — pull / synthesize / export | ✅ LIVE | comps engine, gov/dia DBs, SF comps |
| **C** | **BOV / Valuation** — build BOVs | ✅ LIVE (skills) | bov skills, gov/dia DBs |
| **D** | **Lease Review & Filing** — abstract, save by convention | ✅ LIVE | filing canon, folder-watch, SharePoint |
| **E** | **Deal Intelligence** — dossier, cadence, monitor, call logging, SF write-back | 🟢 DESIGNED (write-back LIVE) — `UNIFIED-BUILD-PLAN.md` | activity_events, bd_opportunities, dossier |
| **F** | **Marketing & Audience Expansion** — listing-BD, OM distribution, audience growth | 🟡 PARTIAL / 🔴 intent | RunListingBdPipeline, marketing_leads |

**The arc is continuous:** A/B/C/D feed a deal into **E** (research → comps → BOV → file → track), and **E→F**
pushes it to market and expands the audience. LCC is the through-line; no step forks its own data store.

## Audience expansion (Domain F) — the two engines, and the real gap
1. **Ownership-of-similar** — likely acquirers who already own comparable assets. USES the CRE graph
   (`entity_relationships` owns/purchases + owner-reconcile). Data largely there; needs a "find likely buyers for
   this listing" query + priority ranking. 🟡
2. **Buyer-intent** — who's signalling interest: **webhits, OM downloads, saved searches** on similar deals. **NOT
   built** — needs an intent-data integration (CREXi / Buildout / LoopNet analytics → `activity_events` as intent
   touchpoints on buyer entities). 🔴 **← the genuine unbuilt frontier you named.**
Both feed the investor-outreach manager (Domain E #9 / F).

## Vertical extensibility (dialysis + gov → net lease + any asset type)
The schema is **already multi-domain**: `entities.domain` spans **cre, dia, gov, lcc**; `bd_opportunities.vertical`
is a field. The **entire spine is vertical-neutral** — dossier, cadence, monitor, write-back, roster,
correspondence, surfaces, and SF integration don't care about asset type. **Vertical-specific logic is isolated to
exactly three plug-in points:** (1) the **comps data source**, (2) the **BOV skill**, (3) the **enrichment source**.
So **adding net lease (or any type) = a new vertical value + its comps source + a BOV skill — zero changes to the
spine or surfaces.** Design rule: build vertical-neutral by default; quarantine asset-type logic to those three points.

## How it all fits — no overlap across domains
The anti-overlap invariant (`UNIFIED-BUILD-PLAN.md`) holds **across all six domains**: every one reads/writes the
same substrates — `entities`, `activity_events`, `bd_opportunities`, `entity_relationships`, `unified_contacts`,
Cortex. No domain forks a parallel store; the dossier and every workflow are projections/flows over the one brain.

## What this surfaces for the backlog
- **Domain F is the next design frontier** after E — especially **buyer-intent ingestion** (webhits/OM downloads),
  which is genuinely unbuilt, and the **ownership-of-similar "likely buyers" query** (data exists, logic doesn't).
- **Vertical-extensibility** is now an explicit design principle (three plug-in points), not an afterthought.
- Domains A–D are LIVE — the plan's job is to **connect** them into E/F, not rebuild them.
