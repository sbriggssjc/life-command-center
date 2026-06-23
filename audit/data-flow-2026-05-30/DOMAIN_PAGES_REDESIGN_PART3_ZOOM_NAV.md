# Domain Pages Redesign — Part 3: Navigation / Zoom Model (2026-06-23)

Companion to `DOMAIN_PAGES_AUDIT_AND_REDESIGN_2026-06-23.md` (Parts 1–2 = horizontal page
structure). Part 3 is the VERTICAL dimension: how the operator zooms IN to an object and back
OUT, and whether that depth-navigation is consistent — the "double-click in / double-click out"
model that should mirror the app's data hierarchy.

## The canonical zoom hierarchy (mirror the data spine)
```
L0 Domain (dia / gov)
 └ L1 Segment / list   (Sales · Leases · Loans · Players · Pipeline · Properties · Search results)
    └ L2 Object        (Property · Owner/Entity · Lead · Listing · Sale · Loan · Broker)
       └ L3 Object detail   (unified tabs: Overview / Rent Roll / Operations / Deal History / Ownership & CRM / Activity)
          └ L4 Sub-record   (a specific lease · sale · contact · document · decision)
             └ L5 Source    (deed PDF · SF record · email · the extraction)
```
Zoom-in = descend a level; zoom-out = ascend to exactly where you were; lateral = jump across
the graph at L2/L3 (property → its owner → the owner's other properties) and back.

## The 6 zoom invariants (the target)
1. **One drill affordance** — any row/card opens the SAME detail component; one object type = one detail grammar.
2. **Reversible to context** — zoom-out returns to the exact prior view (filters, scroll, sub-tab), not a reset.
3. **Breadcrumb trail** — shows the path + depth, and each crumb is a jump target.
4. **Lateral links zoom-consistent + reversible** — graph hops use the same affordance and can be unwound level-by-level.
5. **Deep-linkable / reload-survivable** — each zoom state has a URL; browser Back/Forward work; reload restores the state.
6. **Next-action at every depth** — every object detail shows "what to do next" (the completeness-rail + Next-Step pattern).

## As-built audit (grounded in app.js / detail.js)
**Working (≈half the model already exists):**
- **#1 universal opener** — `openUnifiedDetail(db, ids, fallback, initialTab)` (window-global) is
  called consistently from dia/gov lists, ops queue cards, decision lanes, search. Slide-over
  panel (`#detailPanel` + `#detailOverlay`) with one tab set (Overview · Rent Roll · Operations
  · Deal History · Ownership & CRM · Activity Log). ✓ for properties.
- **#4 lateral links exist** — `openEntityDetail` / `openEntityDetailByName`; property→owner and
  owner→property wired (detail.js).
- **#2 single-level context** — the detail is a modal OVER the page, so a single close reveals
  the underlying list unchanged (filters/scroll preserved). ✓ for one level.
- **#6 next-action** — property detail has the completeness rail + Next-Step banner. ✓ for
  properties.

**Broken (why it doesn't feel like clean zoom):**
1. **No back-stack (the core gap).** The header "← Back" button calls `closeDetail()` — it EXITS,
   it does not ascend one level. A lateral chain (property → owner → other property → comp)
   cannot be unwound step-by-step; Back dumps you fully out. The label reads "Back" but behaves
   as "Close" — actively misleading.
2. **No breadcrumb (#3 ✗).** No path or depth indicator; the user can't see or jump the zoom trail.
3. **No routing / deep-link / reload-survival (#5 ✗).** App-wide: `navTo()` swaps pages in-memory;
   no `hashchange`/`popstate`/`pushState`. The detail panel adds no URL state. ⇒ reload → Today,
   browser Back exits the app, nothing is shareable/bookmarkable. **This is the substrate the
   whole model needs.**
4. **Entity detail ≠ property detail grammar (#1 partial).** Owners open a different-shaped detail
   than properties; the "zoom object" isn't uniform across object types.
5. **Deepest levels aren't a consistent drill (L4/L5).** A lease/sale/contact/deed shows in-tab
   but you don't zoom INTO it (and back) the same way — the drill stops at L3.

## Design — closing the gaps
- **A. Routing foundation (do first; unlocks #2 deep, #5, and reload-survival).** Add hash/URL
  routing: a route encodes `page` (L0/L1) and an optional `detail` (db + object type + id +
  tab) and `lateral stack`. `navTo` and `openUnifiedDetail` push/replace history; `popstate`
  drives both page switch and detail open/close. Reload re-hydrates from the URL. Browser
  Back/Forward become zoom-out/in. (Also retires the class of long-session staleness bugs like
  R61.)
- **B. Back-stack + honest Back.** Maintain a detail nav stack; "← Back" ascends one level
  (lateral or sub-record), and only the "×" fully closes. Disable/clarify "Back" at the root.
- **C. Breadcrumb bar** in the detail header: `Dia ▸ Sales ▸ 1200 Deltona Blvd ▸ Deal History`,
  each crumb a jump (drives the stack + URL).
- **D. One detail grammar.** Converge entity/owner detail onto the same shell + tab pattern as
  property detail (object-type-appropriate tabs), so every L2 object zooms identically.
- **E. Sub-record drill (L4/L5).** Make in-tab rows (a lease, a sale, a contact, a document)
  themselves zoom targets with the same affordance + back-stack, down to the source doc/SF
  record.
- **F. Next-action everywhere (#6).** Extend the completeness-rail + Next-Step pattern to entity
  detail and sub-records, so every zoom-in answers "what do I do here."

## Cross-cutting build considerations (fold in now)
- **Consumption-Layer doctrine on L1 lists** — Sales/Pipeline/Leases lists value-ranked + capped
  + honest counts, so zooming into a list lands on the highest-value rows.
- **Owner/Entity as a first-class L2** — the BD spine is owner-centric (P-BUYER, portfolios);
  owner detail deserves property-detail parity (portfolio → properties → contacts → activity).
- **Mobile / iOS** — drill-in/out must work with touch + the OS back-gesture (your capture
  workflow is iOS); routing (A) makes the back-gesture meaningful.
- **Keyboard zoom** — Enter = zoom-in on focused row, Esc = zoom-out one level (consistent with
  the research cards' existing shortcuts).
- **Northmarq brand** — any new chrome (breadcrumb, headers) per the CLAUDE.md brand rules.
- **Telemetry (optional)** — log zoom paths to validate the IA against real usage.

## Where this slots in the build sequence (updated)
1. **Routing foundation** (A) — substrate for the zoom model + deep-links + reload-survival.
2. **Overview parity** (Part 2 §2C) — unify block order + missing blocks, both domains.
3. **Tab set + naming** (Part 2 §2B) — shared tabs/order; promote Ownership + Activity; Properties on gov; Prospects→Pipeline.
4. **Zoom-model wiring** (B–F) — back-stack + honest Back, breadcrumb, one detail grammar, sub-record drill, next-action everywhere.
5. **Research workbench convergence** (Part 2 §2D).

## Bottom line
The app already has the hard parts of zoom — a single universal detail opener, a consistent
slide-over, lateral owner↔property links, and context-preserving single-level close. What's
missing is the connective tissue that makes it FEEL like zoom: a back-stack (so "Back" ascends
one level, not exits), a breadcrumb (so you see the path), URL routing (so Back/Forward/reload/
deep-links work), a uniform detail grammar across object types, and drill-through to L4/L5
sub-records. Build the routing substrate first, then the zoom wiring rides on it — and the
operator gets a true double-click-in / double-click-out that follows the same data-flow
structure the app lays out.
