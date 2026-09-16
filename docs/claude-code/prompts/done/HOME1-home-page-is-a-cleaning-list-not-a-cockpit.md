# HOME1 — the Home page shows cleaning work as priorities, mirrors the Priority tab, and files a dialysis deal under Government

**Filed:** 2026-09-16 (Cowork) from `docs/claude-code/SB notes/LCC app notes - Sept 12.docx` §§1–2
(screenshots in the note). Triage rows **SBN-2, SBN-3, SBN-4**. This is an **exploratory round that
ends in measured recommendations plus one concrete fix** (§C); it does not redesign the Home page.
**Read first:** `CLAUDE.md` → "The operator doctrine for every surface" and "Producer/Consumer";
`app.js` ~7498 (Top data gaps widget), ~7220–7240 (Daily Briefing render), `index.html`
`#nextBestActionWidget`; the daily-briefing producer (`api/` — find it, it is not named in the note);
`docs/os/CURRENT-STATE.md` § "Government agency identity — the registry is WIRED (ID3a)".

## Scott's words (quote, then diagnose — do not soften)

> This is the top data gaps to close. These actions don't feel like they are prioritized to the
> maximum impact. I envision this section to be the highest quality potential leads or comps that
> are missing data that require a human next step like search the SOS or assessor or other public
> records or CoStar, etc. and direct us to exactly what needs to be ingested next with the LCC
> sidebar Chrome connector and from where next. Many of these […] actually feel more like cleaning
> topics that should be automated. Items that are better automated should never be in this top
> priority list and should just be automatically pushed forward by the code processes.

> These top priorities don't really show much of what we need to do and with who. Most of these
> just look like names and names of buyers. […] We should have a research lane, a BD lane and our
> inbox at a maximum. […] Also, the dialysis and government highlights section include email or
> deal tracking activity (another duplicate item for the home page) and aren't intel or highlights
> about the market but about our deal flow. The deals are also miscategorized with a dialysis deal
> under government.

## §A — "Top data gaps to close" is 90% agency drift (SBN-2)

In the screenshot, 9 of the 10 visible rows are `Resolve agency drift: property says "GSA – Nat'l
Science Fdn", lease says "METROPOLITAN S…"` — the ID3a canonicalization class, which the agency
registry already folds (`app.js:1793` is that action's error hook). The one row Scott wants the list
to be made of is #7: *350 Rhode Island St · Research recorded owner · Look up owner → San Francisco
Recorder* — a human step, a named source, a property with a value.

Measure, on both `v_next_best_action` views (dia + gov) and the widget's fan-out:

1. The full open population (105 in the screenshot) **by gap class** (`agency_drift`, `recorded owner
   missing`, `true owner missing`, …) with value totals.
2. For the agency-drift class: how many would the ID3a registry fold **without a human** if the
   fold ran on them? (`v_gov_agency_registry_*` / the ID3a fold function — dry-run it.) Those rows
   are `automate-me`: they leave the widget and go to the fold, and the widget's producer excludes
   the class going forward.
3. For what remains: does every row carry a **named next source** (SOS / assessor / recorder /
   CoStar / SAM) and a **sidebar-capturable target** (the URL the Chrome connector would open)?
   Count rows that do vs. don't. Rows that don't are not "human next steps"; they are unfinished
   producer output.
4. Recommend the widget's admission rule in one sentence, and implement it if it is a predicate
   change on the existing views (flagged, dry-run counts before/after). If it needs a new producer,
   stop at the spec.

## §B — "My priorities" duplicates the Priority tab; Scott wants ≤3 lanes (SBN-3)

The five "My priorities" names on Home are the Priority tab's P1 band verbatim. Measure: where does
the briefing's `my_priorities` come from (producer file:line), and what would the Home page look
like with exactly three lanes — **Research** (human data gaps, from §A), **BD** (next touchpoints
by cadence, from the Priority engine), **Inbox** (new/overdue) — each capped, each ranked by one
stated score. Produce the lane spec (source view, ranking key, cap, what "done" removes a row) as a
table, and a mock of the Home page order as text. **Do not build the lanes in this round** unless
the spec is a pure re-composition of existing views — then build it flag-gated OFF.

## §C — Highlights are deal-tracking, and a dialysis deal is under Government (SBN-4) — FIX

`renderBriefingItems(gov.highlights…)` (`app.js:7233`) renders whatever the producer put in
`domain.government.highlights`. In the screenshot that array holds *"Schedule a call with
counterparty — DaVita Dialysis – The Villages – FL"*. Find the producer; show the lane key it uses
to route an item to `government` vs `dialysis` (deal domain? owner's domain? a string match on the
deal name?); show why a DaVita deal landed in `government`; fix the key; add a test with that deal
as the fixture. Then answer Scott's broader point with a measurement: of the highlight items in the
last 14 briefings, how many are deal-tracker actions (schedule / track / send) vs. market
intelligence (a sale, a listing, a lease event, a CMS change)? Recommend whether the section is
renamed ("Deal actions") or re-sourced from the market-brief producers (`MB` series, live since
2026-09-12) — and which rows would then appear, from a real day's data.

## Prohibitions

- ⛔ No new priority score without naming the one it replaces (`CLAUDE.md` → single-advance-owner).
- ⛔ No Home page rebuild; §A and §C are predicate/key fixes, §B is a spec.
- ⛔ Nothing that reads `latest_deed_*` on gov (GOVDEED5b) as evidence of a deed.

## Reporting

§A class table + fold dry-run + admission rule (implemented or spec'd); §B lane spec table; §C the
lane-key bug, fix, test, and the 14-briefing measurement. If any step was skipped, say so.
