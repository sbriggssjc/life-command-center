# Property Tab — UX & Data Review, Audit, and Rollout Plan (2026-07-31)

**Source:** Scott's walkthrough of the property side-panel in the LCC, reviewing a
recently-closed own-deal: **Fresenius – Woodland Hills, CA** (20931 Burbank Blvd, Ste A,
Woodland Hills, CA 91367). Captured as `LCC_Property_and_Ownership_UX_and_Design_Notes.docx`
(19 screenshots + notes). This file is the durable catalog so other chats can reference it.

The property is displayed today as a right-side panel with tabs: **Overview · Rent Roll ·
Operations · Deal History · Ownership & CRM · Activity Log**. Comp displayed as
"Bio-Medical Applications of Delaware, Inc. dba Fresenius Kidney Care Woodland Hills –
Woodland Hills, CA"; **Owner shown as "Fresenius Medical Care"** (this is wrong — see Finding A).

---

## Part 1 — Catalog of Scott's notes (by tab / theme)

### Cross-cutting: contact/owner linking + a second sidebar
- **No links to contacts/companies anywhere on the property page** — we want that. Every party
  displayed (original developer, broker, buyer, prior owner, lender, loan broker, etc.) should be
  **clickable** and open a **contact/owner page as a second side panel** — to the side of the
  existing property sidebar. Ideally a **poppable / draggable / minimizable / dockable floating
  window**.
- **Separation of concerns:** owner/contact functions (Log Touchpoint, Log Call/Activity, calls,
  prospecting cadence) belong on the **contact sidebar**, not the property page. Property-level
  functions stay on the property page.

### Overview tab
- **Naming:** default the comp to the familiar pipeline name **"Fresenius – Woodland Hills, CA"**
  (matches our naming everywhere) instead of the long legal tenant name — cleaner, less messy.
- **Owner error:** Owner shows **"Fresenius Medical Care"** — inaccurate, pulled from some function
  that needs fixing. This is one of *our own* deals with email + Salesforce records + a full
  ShareFile folder (Team Briggs – Documents/Properties/F/Fresenius). Investigate the source of the
  error and its **broader impact across all ownership records**.
- **Actions section** (Mark as Lead · Add to Pipeline · Log Touchpoint · Create Task): make sure all
  buttons work. Some belong on the contact/owner pane instead — **Log Touchpoint** in particular.
- **Research Quick Links** (CA Sec. of State · Google Maps · SF Contact · CoStar · LoopNet · Owner
  Search · **ChatGPT Brief · Claude Brief**): **remove the on-demand ChatGPT/Claude brief buttons**;
  replace with a link to a **Deal Dossier / Property Dossier** (see the Dossier spec below).

### Rent Roll tab
- Layout looks great, but **two of the same lease are displayed** — dig in: data issue or display
  issue? Fix at the source so there's **one view = the most accurate reconciliation** of everything
  we know/ingested. Because this is a recently-sold own-deal, ingestion/propagation should be
  happening in many places and clearly isn't. **Triage why the DB/LCC functions aren't cleaning and
  reconciling** as designed. We have the **actual leases on file**, so this should be accurate.
- The **rent schedule appears slightly ahead** of where the current lease is. Our files have the most
  accurate versions (amendments) — display should not be just the original lease's data.

### Operations tab
- New clinic — a consolidation of a nearby facility plus an expansion. OK that there's **no Medicare
  data yet** (not in the Medicare dataset). But we have Seller correspondence + file folders + the OM
  describing operations. Would be great to include that summary here; at minimum include it in the
  **Property Dossier** until Medicare data connects to this property.

### Deal History tab
- Data display is good. Want the **parties involved in each transaction shown below the comp/listing
  row**, clickable → open the contact/owner side tab.
- **Cap rate** (6.46% calc) is computed from the LCC rent roll but **doesn't reconcile with the OM or
  the accurate rent-roll dates** — lease commencement was triggered off *substantial completion* and
  doesn't match the original lease; **the amendments and OM reflect the accurate dates**. Fix so we
  show truly accurate cap rates for both listing and sale.
- Show the **original development** of the clinic + its dates as the **beginning of the deal history**,
  and under it show the **developer** (linked to the contact/owner side tab, same as sale/listing
  party rows).
- There was a **loan origination** with this sale — extract it from the deal dossier/emails and show
  the **loan broker and lender**.

### Ownership & CRM tab
- Most of these functions belong on the **contact sidebar**, not the property page. On this tab, show
  **only the current owner** + link to the ownership sidebar.
- Could show a **status bar / ranking**: is our team (or someone in our firm) actively prospecting the
  current owner; how recent/often correspondence + prospecting attempts have been. But anything
  contact/call-related belongs on the contact's sidebar, not the property level. This page could show
  **suggestions** (research the ownership, connect the owner in SF, etc.).
- Show the **original developer at the bottom, linked**, demonstrating we've connected the **ownership
  history from original developer → current owner**. Show a **"last checked / verified on"** for
  ownership.
- **Fresenius shown as true owner = clear error** — track to source; stop polluting the DB with
  inaccurate code-driven data.

### Activity tab (Activity Log)
- Should be **notes about ingestion / propagation / reconciliation history** of data in our DB —
  **not** calls or prospecting (especially with the wrong owner). **All call history belongs on a
  contact page**, not the property.

### Property / Deal Dossier (the big new artifact)
Localized AI model drafts + updates **property dossiers for all properties** in a background function,
with **trigger points/events** that call for an update. Standard format, aim for a **single-page PDF**
that shows the database's **reconciled + cleaned** view of the property:
- High-level summary, then a breakdown of the **three legs of the stool** (property, lease economics,
  credit) — a more detailed comp view including **known guarantor, operational summary**, etc.
- **History back to original build**: developer, expansions/renewals, even an estimated
  operations/financials history.
- **Price + cap rate + lease term at each sale**, parties + brokers, on-market status.
- Brief summary of **our Team's prospecting history** with the account.
- **Existing debt terms** if known (incl. expiration/maturity), **trigger dates** (renewal notice
  dates, etc.), and **previous loans** in the ownership/sales history.
- The dossier research **feeds the property display and vice versa**.

---

## Part 2 — Audit / triage / diagnosis (root causes from the screenshots)

### Finding A — Owner shows the operator/tenant, not the real owner  *(severity: HIGH, systemic)*
**Evidence:** Overview header "Owner: Fresenius Medical Care"; the **Data Resolution Status** panel
reads **"Ownership Not Resolved — No true_owner or recorded_owner linked yet,"** plus **"Property
Missing County Record,"** "LCC Entity Not Registered," and "Salesforce Match Pending — resolve
ownership first." The "Next Step" card says **"Pull the recorded owner — No deed owner on file yet."**

**Diagnosis:** with no resolved `true_owner`/`recorded_owner` and no county deed on file, the Owner
field is **falling back to the tenant/guarantor name** ("Fresenius Medical Care" = the operator, whose
guarantor is Fresenius Medical Care Holdings). Two defects compound:
1. **No deed/county feeder** into the owner-reconciliation engine (`lcc_owner_evidence` /
   `lcc_reconcile_owner` exist — see `owner-reconciliation-engine.md` — but nothing feeds county
   deed / assessor / tax-mailing owner, nor the **buyer from our own closed deal**).
2. **Bad display fallback:** the UI shows the operator as "Owner" instead of rendering
   **"Owner: unresolved"** when no owner evidence is reconciled. That is what "pollutes" the DB view.

**Broader impact:** the home Action Items show **"4,983 ownership changes need research"** — this is
not one property; the operator-as-owner fallback likely mislabels ownership across the portfolio.
For *our own* closed deals we already hold the buyer (in `bd_opportunities`/OM/SF/ShareFile), so the
reconciler should ingest **deal-party evidence** (post-sale buyer = new owner) with high weight.

### Finding B — Duplicate lease in the rent roll  *(severity: HIGH)*
**Evidence:** Rent Roll shows two "Active" tenants for the same premises:
- **"Bio-Medical Applications of Delaware, Inc. dba Fresenius Kidney Care Woodland Hills"** —
  Commencement **Aug 17, 2022**, Expiration Aug 30, 2038, Current Rent (2026) **$876K / $42 SF**,
  Base $944K, guarantor Fresenius Medical Care Holdings, two 5-yr options.
- **"Fresenius Medical Care"** — Commencement **Aug 27, 2028**, Expiration Aug 30, 2038, Annual Rent
  **$944K / $45 SF**. The rent-schedule chart is labeled **"Source: parsed from escalation string —
  estimate."**

**Diagnosis:** the **same lease ingested twice** from two sources — (1) the **actual lease** (2022
commencement, real in-place rent) and (2) an **OM/escalation estimate** (2028 substantial-completion
commencement, estimated $944K). They didn't dedupe because the **tenant name normalized differently**
(full legal name vs "Fresenius Medical Care") and the source/keys differ. The **"slightly ahead" rent
schedule** is the estimate branch (2028 start, one escalation ahead of the real 2022-based schedule).
**Fix at source:** dedupe/reconcile leases per property+premises, **prefer the actual-lease source over
the escalation estimate**, normalize tenant identity, and drive the rent schedule from the actual lease
**+ amendments** (not the OM escalation string).

### Finding C — Cap rate computed off the wrong dates  *(severity: MEDIUM, depends on B)*
**Evidence:** Deal History "Sale recorded Jul 23, 2026 at $15.7M / **6.46% Cap (calc)**." Scott: the
cap doesn't reconcile with the OM because the rent roll's commencement is the substantial-completion
date, not the lease/amendment/OM dates.
**Diagnosis:** cap = NOI ÷ price, and NOI is drawn from the **estimate-branch rent roll** (Finding B).
Once B is reconciled to the actual in-place rent at the sale date, the listing/sale cap will match the
OM. **C is downstream of B.**

### Finding D — Comp naming uses the legal tenant name  *(severity: LOW, cosmetic)*
Display name should default to the pipeline convention **"Fresenius – Woodland Hills, CA."** Likely the
display derives the title from the lease/tenant legal name rather than the pipeline/deal name. Add a
`display_name` resolution that prefers the pipeline name.

### Finding E — No party→contact linking; single-panel UX  *(severity: HIGH, foundational UX)*
No party on the property page is clickable, and there is only one side panel. This blocks the entire
contact/owner-sidebar theme and the "click any party" requirement across Overview, Deal History, and
Ownership. Needs a **second, independent, poppable panel** + a **party-link component** wired to the
entity/relationship graph (`entity_relationships`, `unified_contacts`).

### Finding F — Property/CRM concerns mixed into the property page  *(severity: MEDIUM)*
**Evidence:** Ownership & CRM tab renders a full **"Log Call / Activity — Logging for: Fresenius
Medical Care"** form (Activity Type, Outcome, Log Activity/Call/Quick Email, Draft Email, Research
Notes) *at the property level*, and against the **wrong owner**. Activity Log shows listing/sale
lifecycle events but is intended to be **ingestion/reconciliation history**. These are
separation-of-concerns violations: contact/call actions → contact sidebar; property Activity tab →
data-lineage log.

### Finding G — Deal History missing parties, developer origin, and loan origination  *(severity: MEDIUM)*
Deal History shows only the sale + listing (broker "Northmarq & CBRE") with **no party rows**, **no
original-development event**, and **no loan origination** (loan broker/lender). All three are additive
once E (party links) exists and the dossier/email extraction feeds them.

### Finding H — Operations summary absent (Medicare gap)  *(severity: LOW, known)*
No Medicare data (property not yet in dataset). Acceptable; source an operations summary from Seller
correspondence + files + OM for the dossier now, backfill Medicare when the property links.

---

## Part 3 — Design elements planned

1. **Second contact/owner side panel** — independent of the property panel; poppable, draggable,
   minimizable, dockable (floating window). Hosts all contact/owner functions (Log Touchpoint, Log
   Call/Activity, cadence, prospecting history). Opened by clicking any party anywhere.
2. **Party-link component** — a reusable "clickable party chip" rendered wherever a
   developer/broker/buyer/owner/lender/loan-broker appears (Overview, Deal History rows, Ownership).
   Resolves to an entity/contact and opens the side panel.
3. **Owner truth pipeline** — deed/county/assessor/tax-mailing feeder **+** own-deal buyer feeder into
   the existing owner-reconciliation engine; UI shows **"unresolved"** rather than the operator when no
   owner evidence exists; ownership chain (developer → … → current owner) with "last verified on."
4. **Lease reconciliation** — one canonical lease per premises, actual-lease-preferred over estimate,
   tenant-identity normalization; rent schedule from actual lease + amendments; cap recomputed from
   reconciled in-place rent.
5. **Property Dossier** — a standard single-page PDF (three legs of the stool + history + debt + trigger
   dates + prospecting history), generated/updated by the localized AI model on trigger events; a
   **Property/Deal Dossier link replaces the ChatGPT/Claude Brief** quick-links. Dossier ↔ property
   display feed each other.
6. **Tab role clarification** — Overview (property + resolved owner summary + working actions), Deal
   History (parties + developer-origin + loan origination), Ownership & CRM (current owner + prospecting
   status/ranking + developer chain + suggestions only), Activity Log (data ingestion/reconciliation
   lineage only), naming default to pipeline name.

---

## Part 4 — Rollout plan (phased)

**Phase 0 — Data truth (unblocks the "polluted DB" complaints; connects to owner-reconciliation engine)**
- P0.1 Diagnose the exact owner-display fallback; render **"Owner: unresolved"** when no reconciled
  owner evidence (stop showing the operator). *(display + query)*
- P0.2 Own-deal buyer → owner feeder: for closed `bd_opportunities`, record the buyer as owner evidence
  (high weight) and reconcile. *(engine feeder)*
- P0.3 County/deed/assessor/tax-mailing owner feeder (external — connector-dependent; design now, wire
  when the data source is available). *(engine feeder)*
- P0.4 Lease reconciliation at source: dedupe per premises, actual-lease-preferred, normalize tenant
  identity; rent schedule from actual lease + amendments. *(ingestion + DB)*
- P0.5 Recompute cap from reconciled in-place rent (validates against OM). *(follows P0.4)*
- P0.6 Audit the owner-as-operator fallback across the portfolio (quantify the 4,983). *(audit)*

**Phase 1 — Contact/owner sidebar + party linking (foundational UX)**
- P1.1 Second independent side panel (poppable/draggable/minimizable/dockable).
- P1.2 Reusable party-link chip resolving party → entity/contact → opens panel.
- P1.3 Move contact/call functions (Log Touchpoint, Log Call/Activity, cadence) off the property page
  onto the contact sidebar.

**Phase 2 — Property Dossier**
- P2.1 Finalize the dossier format (separate chat) + schema (three legs, history, debt, triggers,
  prospecting history).
- P2.2 Localized-AI background generation + trigger-event updates (ties to the GaryBuilt/Ollama seam).
- P2.3 Single-page PDF renderer; replace ChatGPT/Claude Brief quick-links with the dossier link.

**Phase 3 — Tab-by-tab refinements**
- P3.1 Overview: pipeline-name default; confirm/repair Actions buttons.
- P3.2 Deal History: party rows (clickable), original-development origin event + linked developer, loan
  origination (loan broker + lender) from email/dossier extraction.
- P3.3 Ownership & CRM: current owner only + link; prospecting status/ranking + recency/frequency;
  developer→current-owner chain + "last verified on"; suggestions (research owner, connect SF).
- P3.4 Activity Log: repurpose to data ingestion/propagation/reconciliation lineage only.
- P3.5 Operations: source operations summary from Seller correspondence + files + OM (dossier now;
  Medicare later).

**Dependencies:** C←B (P0.5←P0.4); most of Phase 3 party displays ←E (P1.2); Dossier (Phase 2) consumes
the reconciled data from Phase 0 and the operations summary (P3.5). Phase 0 is the highest-leverage
start because it fixes the "database is polluted / not reconciling" complaints that recur across every
tab, and it reuses the owner-reconciliation engine already built.

---

## Part 5 — Connections to existing architecture
- **Owner reconciliation engine** (`owner-reconciliation-engine.md`, `lcc_owner_evidence`,
  `lcc_reconcile_owner`, `lcc_reconcile_all_owners`): Findings A/P0.2/P0.3 are new **feeders** into it,
  not a new engine.
- **Correspondence ingestion** (`correspondence-ingestion-design.md`): the loan-origination /
  operations-summary extraction (P3.2, P3.5) rides the same deal-thread ingestion we're standing up.
- **Localized AI / GaryBuilt** (`garybuilt-local-model.md`): the Property Dossier generator (P2.2) is a
  primary consumer of the local model seam.
- **My Day**: the Ownership tab's "are we actively prospecting this owner + recency" (P3.3) reuses the
  touchpoint-cadence / correspondence signals already feeding My Day.
