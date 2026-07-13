# Claude Code (life-command-center) — consolidate the pursue/prospect/deal/lead surfaces into ONE Pipeline home

## Why (live app-coherence walk 2026-07-13)

The app's data + value-ranking backbone is healthy, but the "who am I pursuing /
what's my work" concept is fragmented across **~7 surfaces with 6 labels**:
- bottom-nav **Pipeline** — actually a personal task list ("My Work / Team
  Queue"), NOT a deal pipeline (misnomer)
- top-segment **Prospects** (domain pages)
- domain sub-tab **Deals**
- gov **Leads** tab (`renderGovPipeline`) / dia **Prospects** tab
  (`renderDomainProspects`)
- Today **My Work** card + **Work Your Outreach**
- the **Priority Queue**

Plus: the "Symmetry Property Dev" task shows on BOTH Today's My Work card and the
Pipeline list (same item, two places), and its owner link is **dead** (styled as
a link, navigates nowhere).

Scott's decision (2026-07-13): **structural consolidation — one Pipeline home**.

## Target information architecture (the clean split — avoid re-creating overlap)

Two distinct top-level cockpits, each with ONE clear job:

- **Priority** (bottom nav) — **UNCHANGED.** The system-ranked BD target list
  (`v_priority_queue`): "who to pursue, highest-value first." The funnel top.
  Keep its "▶ DO THIS FIRST" hero — and **reserve that hero for Priority only.**
- **Pipeline** (bottom nav) — restructured from today's My-Work-only view into
  **the operator's active pipeline**: ONE home with three sub-views (a segmented
  toggle, like the existing My Work / Team Queue toggle):
  - **My Work** — tasks/to-dos assigned to the operator (today's Pipeline content).
  - **Prospects** — entities being actively pursued (in a cadence / engaged /
    worked) — the prospect-triage surface, cross-domain.
  - **Deals** — opportunities in flight (`bd_opportunities` / scored leads),
    cross-domain.
- **Domain pages (dia/gov)** — the **Prospects / Leads / Deals** tabs become
  **domain-filtered views of the SAME shared sub-view components** (pass
  `domain=dia|gov`), NOT separate implementations. One Prospects surface, one
  Deals surface — rendered filtered on the domain page, unfiltered on the
  Pipeline home.
- **Today** — the **My Work** card links INTO Pipeline › My Work (same source, no
  re-render/duplicate). **Work Your Outreach** stays as-is — it's the distinct
  cadence working surface (the focus session), not a pursue-list; leave it.

Net: "who to pursue" lives in Priority (ranked) + Pipeline›Prospects (engaged);
"my tasks" in Pipeline›My Work; "deals" in Pipeline›Deals. The domain tabs are
filtered lenses on those, not new surfaces. Six labels → one home + the ranked
cockpit.

## Phase 0 — ground the current implementations (do this first)

Before moving anything, map the real render functions + data sources (I'm
inferring some):
- bottom-nav Pipeline / "My Work / Team Queue" → its render fn + source
  (`action_items` / `inbox_items` assigned to the operator?).
- `renderDomainProspects` (dia/gov "Prospects" tab) → source.
- `renderGovPipeline` (gov "Leads" tab) → source (scored leads =
  `bd_opportunities`?).
- domain "Deals" sub-tab group → what it contains.
- Today "My Work" card + "Work Your Outreach" → sources.
Confirm the canonical source for each of the three target sub-views (My Work =
tasks; Prospects = pursued entities; Deals = opportunities) so the consolidation
reuses ONE source per concept, not several.

## Phase 1 — build the Pipeline home shell (3 sub-views)

Restructure the Pipeline page into one home with a **My Work · Prospects · Deals**
segmented toggle (reuse the existing My Work/Team Queue toggle pattern). Each
sub-view renders its canonical source, value-ranked where applicable, and accepts
an optional `domain` filter (default: all). My Work keeps the Team Queue toggle.

## Phase 2 — repoint the domain tabs to the shared components

The dia/gov **Prospects / Leads / Deals** tabs call the SAME sub-view render
functions with `domain=<dia|gov>` instead of their own implementations. Delete
(or thin to a pass-through) the now-duplicate `renderDomainProspects` /
`renderGovPipeline` bodies so there's one implementation per concept. Preserve the
existing tab ids / hash routing (the Phase-1 router) so deep links still work.

## Phase 3 — dedupe, fix the dead link, reserve the hero, rename

- **Today "My Work" card** → links into Pipeline › My Work (one source; no
  duplicate render of the same task).
- **Fix the dead owner link** (Pipeline My Work "Symmetry Property Dev") → route
  to the 4B entity detail (`openEntityDetail`) — the same target Priority / DC use.
- **Reserve "▶ DO THIS FIRST"** for the Priority Queue hero; Pipeline sub-views +
  DC lanes use a plainer header.
- **Rename** the bottom-nav label appropriately — since Pipeline is now the real
  pursue/deal home, the label "Pipeline" fits; ensure the top-segment "Prospects"
  and domain "Leads"/"Deals" labels are consistent with the sub-view names (one
  vocabulary: Prospects, Deals, My Work — retire "Leads" as a separate word, or
  make it an explicit alias).

## Boundaries / verify

- life-command-center, **client-only** (`app.js` routing + the page/sub-view
  render fns + `ops.js`/`detail.js` as needed); **no new api/*.js** (stays 12);
  reuse existing data sources (no new endpoints unless a sub-view genuinely lacks
  one — confirm in Phase 0); no dia/gov writes. Preserve hash routing + the 4A/4B
  zoom model.
- **Verify (live):** the bottom-nav Pipeline shows My Work · Prospects · Deals;
  the dia/gov Prospects/Deals/Leads tabs render the SAME components filtered by
  domain (spot-check a record appears in both the domain-filtered and the
  unfiltered Pipeline view); the Today My Work card and Pipeline My Work show the
  same item once (no duplicate); the previously-dead owner link opens the entity
  detail; "DO THIS FIRST" appears only on Priority.
- `node --check`; suite green; add/adjust a routing test if the tab-id map changes.

## Companion quick wins (can ride this round or a separate one)

From the coherence audit, independent of the IA restructure:
- **dia Overview content parity:** add the missing Portfolio tiles (NOI / Avg NOI
  / Contacts) to match gov; make "Action Items" surface the same KINDS in both
  domains (BD signals + data-quality, same order); align labels (Gross vs
  Projected). Investigate the dia Overview ~9.7s load (slow blocking query).

## Documentation

Update CLAUDE.md: the pursue/prospect/deal surfaces are consolidated into one
**Pipeline** home (My Work · Prospects · Deals); the dia/gov domain
Prospects/Leads/Deals tabs are domain-filtered views of the shared sub-views (one
implementation each); Priority stays the system-ranked cockpit and owns the "DO
THIS FIRST" hero; Today's My Work card links into Pipeline; one vocabulary
(Prospects/Deals/My Work). Presentation-layer coherence, no data changes.

## Bottom line

Six labels and ~7 surfaces for one idea. Collapse them into one Pipeline home with
My Work · Prospects · Deals, make the domain tabs filtered lenses on those same
components, keep Priority as the ranked cockpit, and fix the dead link + duplicate
item + overloaded hero. The app stops offering "various places to do essentially
the same thing" — one home to work your pipeline, one cockpit to see what's
highest-value.
