# Claude Code (life-command-center) — Pipeline home: source Prospects from real pursued data + gate Deals to active

## Why (live verification of PR #1380, 2026-07-13)

The Pipeline-home consolidation is live and the STRUCTURE is correct — the
My Work · Prospects · Deals toggle works, "DO THIS FIRST" is off My Work, Deals is
rich/functional, Today→Pipeline dedupes. But the live walk found two data-sourcing
defects on the new sub-views:

1. **Prospects is an empty/dead tab — 0 records** (subtitle: "0 actively pursued ·
   0 pursued total · 0 deals · 0 records"), even ungated ("Show all"), even after
   the marketing data loaded (Deals shows 11,831 on the same page). Root cause: the
   Prospects sub-view is sourced from the **SF marketing contact set**
   (`_mktProspectContacts`), which is opportunity-heavy — so the (correct)
   mutual-exclusion split (open opportunity → Deals) routes essentially everything
   to Deals and leaves Prospects with nothing. The **real prospects being pursued
   live in the LCC cadence / engaged-entity data**, NOT the SF marketing contacts
   (Claude Code flagged this: "the LCC cadence table isn't in this SF-sourced
   client dataset").
2. **Deals is ungated — "9,247 deals · 11,831 records"** including many **4-year-
   stale** opportunities (due 2021, "Stale — 4y overdue" badges). 9,247 is not a
   real active-deal count — same honest-count / Consumption-Layer issue we fixed
   everywhere else.

## Unit 1 — source Pipeline › Prospects from the actual pursued population

Re-source the Prospects sub-view so it shows **entities being actively pursued**,
from the data where that actually lives — the **LCC cadence / engaged-entity**
layer, not the SF marketing contacts:
- **Prospects = entities in an active cadence (non-paused/unsubscribed) that do
  NOT have an open opportunity** (open-opp → Deals, mutually exclusive — keep that
  gate). This is the outreach-focus-session population (the ~292 contacted
  cadences), i.e. the people Scott is genuinely working.
- Reuse the existing cadence/pursued source the outreach work-surface already
  reads (the `cadence_dashboard` action / `v_bd_cadence_dashboard` or the same
  data the focus session uses) — do NOT add a new api/*.js. Value-rank it
  (`rank_value`) and keep the All/Government/Dialysis/All Other filter + the
  Engaged(90d)/Show-all toggle.
- If a cross-domain cadence read isn't already available to this page, wire it
  from the existing endpoint the Cadence Dashboard / focus session uses.
- **Net:** Prospects becomes the live "who I'm actively pursuing" list (should
  show the real engaged set, not 0), Deals stays "opportunities in flight," and
  the two remain mutually exclusive on the open-opportunity gate. If, after
  re-sourcing, an entity has BOTH a cadence and an open opportunity, it shows
  under Deals only.

## Unit 2 — gate Pipeline › Deals to ACTIVE opportunities (honest count)

Deals currently lists all 9,247 SF opportunities incl. 4-year-stale ones. Apply
the Consumption-Layer gate:
- **Default to active/current opportunities** — e.g. exclude long-stale ones
  (due date or last activity older than a cutoff — tune, but a 4-year-overdue 2021
  opportunity is not an active deal), value/recency-rank, and show an honest count
  ("N active deals") with a **"Show all"** escape to reveal the full/stale set.
- Keep the rich card (contact, email, phone, WebEx, Log) + the domain filter.
- Honest count: the badge/subtitle reflects the ACTIVE deal count, not the raw
  9,247. (If SF genuinely has 9,247 open opportunities, most 4y-stale, the default
  view should still be the workable/current subset with the rest behind Show all.)

## Boundaries / verify

- life-command-center, **client-only** (`app.js` `renderPipelineProspects` /
  `renderPipelineDeals` + their sources); **no new api/*.js** (stays 12); reuse
  existing endpoints (the cadence/dashboard source for Prospects, the SF-opps
  source for Deals); no dia/gov writes.
- **Verify (live):** Prospects shows the real engaged/pursued set (non-zero;
  matches the outreach focus population) with the Engaged/Show-all toggle; an
  entity with an open opportunity appears under Deals not Prospects; Deals defaults
  to the active subset with an honest count + Show-all for the stale tail.
- `node --check`; suite green.

## Documentation

Update CLAUDE.md: Pipeline › Prospects is sourced from the LCC cadence/engaged-
entity data (the pursued population), not the SF marketing contacts — mutually
exclusive with Deals on the open-opportunity gate; Pipeline › Deals defaults to
active opportunities with an honest count + Show-all for the stale tail
(Consumption-Layer).

## Bottom line

The Pipeline home's shape is right, but Prospects reads the wrong source (SF
marketing contacts → all routed to Deals → empty tab) and Deals is ungated (9,247
incl. 4y-stale). Source Prospects from the real pursued/cadence population so it's
a live "who I'm working" list, and gate Deals to active opportunities with an
honest count — then all three sub-views show real, workable, non-overlapping work.
