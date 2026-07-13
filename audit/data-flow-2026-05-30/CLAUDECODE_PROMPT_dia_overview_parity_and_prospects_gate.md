# Claude Code (life-command-center) — dia Overview parity + Prospects engagement-gate (follow-ups)

Two small, client-only follow-ups to the Pipeline-home consolidation (PR #1380)
and the app-coherence audit. No new api/*.js, no migration, reuse existing data
sources. LCC-Opps/domain reads only, no writes.

## Unit 1 — gate Pipeline › Prospects to *actively-pursued* entities

The new Pipeline home's **Prospects** sub-view (`renderPipelineProspects` /
`_mktProspectContacts`) currently lists prospect CONTACTS broadly. Ungated, that
balloons into ~the whole prospect-contact table — the unworkable-noise-dump
anti-pattern the Consumption-Layer doctrine forbids. **Gate Prospects to entities
that are actually being pursued:**
- Include a prospect only when it shows real engagement: has an **active cadence**
  (non-paused/unsubscribed) OR **recent outreach activity** (an `activity_events`
  email/call/meeting in the last ~90d) OR is in an explicit **prospecting stage**.
- Keep the **open-opportunity gate** already in place: an entity with an open
  `bd_opportunity`/SF Opportunity belongs in **Deals**, not Prospects (mutually
  exclusive; opening an opportunity moves it Prospects→Deals).
- Value-rank the gated list (reuse the existing rank the card renderer uses) and
  keep the All/Government/Dialysis/All Other filter + pagination.
- If the current source can't express the engagement gate cheaply on the client,
  it's fine to filter in the existing fetch — do NOT add a new api/*.js; reuse the
  endpoint the domain prospects tab already calls.

Result: Prospects is a workable "who I'm actively pursuing" list, not a contact
dump. (Priority stays the system-*ranked universe*; Pipeline›Prospects is the
*engaged* subset.)

## Unit 2 — dia Overview content parity with gov

Structural shell is already parity (Phase 2/3); close the CONTENT gaps so the two
domain Overviews read the same top-to-bottom.

1. **Portfolio at a Glance — add the missing dia tiles.** gov shows 8 tiles; dia
   shows 5. Add to dia (data already in `mv_dia_overview_stats`): **NOI**, **Avg
   NOI / Property**, **Contacts**. dia is NNN so NOI ≈ net rent — label honestly
   ("Net Rent ≈ NOI", matching the existing dia doctrine) rather than implying a
   separate NOI figure. Operators↔Agencies stays the correct domain analog.
2. **Action Items — same KINDS, same order across domains.** Today dia's Action
   Items are all data-quality (NPI signals, lease backfill, property review,
   closures, new clinics) and gov's are all BD/market (leases expiring, active
   listings). Define ONE ordered taxonomy and render both domains against it,
   showing whichever categories have counts:
   - **BD signals first** — leases expiring within 6mo, active listings on market
     (dia clinics have leases + on-market listings too — surface them).
   - **then data-quality** — property/owner review queue, lease backfill,
     inventory changes (gov has owner-research / review items too — surface them).
   So a user meets the same categories in the same place on both pages, not
   data-quality on dia and BD on gov.
3. **Label alignment.** Keep dia's rent as **Projected Annual Rent** (the dia
   projection doctrine) but make the gov/dia headline tiles visually parallel
   (same tile order/labels where the concept is shared; domain-correct where it
   differs — Projected vs Gross is a real difference, just render it consistently).

## Unit 3 — dia Overview load performance (~9.7s)

The dia Overview shows a ~9.7s blocking loading overlay ("Dialysis: 8535 clinics,
7535 changes, 1000 signals (9.7s)") while gov renders cleaner. Investigate the
slow path — likely a heavy live count/aggregate that should come from
`mv_dia_overview_stats` (the MV, already built) instead of a live scan, or an
Action-Items count query that isn't bounded. Move the headline
counts/aggregates onto the MV / a bounded query so the Overview paints fast (match
gov's load feel). If the slow query is a specific Action-Item count, bound or
cache it. Surface, don't hide — if a count is genuinely expensive, load it async
into the tile rather than blocking the whole page.

## Boundaries / verify

- life-command-center, **client-only** (`dialysis.js` / `gov.js` Overview render;
  `app.js`/`ops.js` for the Prospects gate) + the `mv_dia_overview_stats` read;
  **no new api/*.js** (stays 12); no migration; no dia/gov writes.
- **Verify (live):** Pipeline›Prospects shows only engaged entities (count drops
  from the full contact set to the actively-pursued subset; an entity with an open
  opportunity appears under Deals not Prospects); dia Overview shows the NOI /
  Avg NOI / Contacts tiles + the same Action-Item categories/order as gov; dia
  Overview paints without the ~9.7s block.
- `node --check`; suite green.

## Documentation

Update CLAUDE.md: Pipeline›Prospects is gated to actively-pursued (cadence/recent-
activity/stage) entities with no open opportunity (open-opp → Deals); dia Overview
reaches content parity with gov (NOI/Avg-NOI/Contacts tiles, shared Action-Item
taxonomy BD-then-DQ, aligned labels) and loads off the MV without the blocking
overlay.

## Bottom line

Two coherence closers: make Pipeline›Prospects a workable engaged-only list (not a
contact dump), and finish dia↔gov Overview parity (missing tiles, same Action-Item
kinds/order, fast load) so the two dashboards read identically. Small, client-only,
no data changes.
