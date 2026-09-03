# UX-T1a-today — recut Today into Significant / Important / Urgent, surface the seller queue

> **Read first:** `docs/os/canon/blocks/operator-doctrine.md` (1.8.0, "Today is the day's tasks
> only…") · `docs/architecture/bd-ranking-and-priority-queue.md` (top banner — UX-T1a-gates/-queue
> state) · `docs/claude-code/responses/done/UX-T1a-queue.response.md` (`v_lcc_seller_prospect_queue`
> + `GET /api/seller-prospect-queue`, 520 rows / 453 owners, chips + real pagination, no front-end
> yet) · `docs/claude-code/responses/done/UX-T1a-gates.response.md` (`v_lcc_bd_worklist`'s
> `loan_maturity` arm, owner-attributed) · `CLAUDE.md` → the Producer/Consumer doctrine ("honest
> counts — every badge is actionable work, not raw output") and the P159a/P180 sections (never a
> re-discovery tally, never fold "unknown" into 0/false).

The canon text, verbatim: **"Today is the day's tasks only, ranked by client value, in three
sections — Significant (BD that pays in five years: new-client research, first outreach,
follow-ups), Important (pays within a year: BOVs, ELAs, touches that generate BOVs or working
buyers, marketing live listings), Urgent (pays within ~90 days: pipeline management, deal
correspondence). All three must be done; the surface exists to keep Urgent from crowding out
Significant."**

Today currently renders **three unrelated cards** with no section structure at all
(`app.js` `renderOutreachOnramp` / NBA data-completeness panel / `renderTodayBdActions`, shells in
`index.html` ~lines 120–170): "Work Your Outreach" (cadence dashboard), "Next Best Action"
(highest-value records missing ownership/agency — a data-completeness lane, not a BD action), and
"Top BD Actions" (`v_lcc_bd_worklist`: `loan_maturity` / `suspected_sale` / `owner_source_conflict`
/ `contact_writeback` / `ownership_chain`). None of these is labelled Significant/Important/Urgent,
none states a due-today boundary, and the NBA panel is data hygiene wearing a BD card — exactly the
Consumption-Layer failure this repo's doctrine exists to catch (a badge that is actionable work vs
one that is raw output).

## 1. Measure before mapping — do not guess the bucket

**Do not hand-assign the existing cards to sections by feel.** For each of Significant / Important
/ Urgent, enumerate every candidate producer that could seed it and report what each one actually
holds, RECORDED-fact only (no lexical/regex classification — the UX-T1a-regex refusal applies
here too):

- **Significant** (new-client research, first outreach, follow-ups — pays in 5 yrs): the
  never-touched / in-pipeline-untouched rows of `v_lcc_seller_prospect_queue`
  (`reach_state`, shipped in UX-T1a-queue) are the canonical "first outreach on a not-yet-reached
  owner" population — this is where the queue surfaces. Also check `touchpoint_cadence` rows at
  `current_touch <= 1` (a genuine first touch, not the unreadable `current_touch` UX-T1a-touchcount
  already flags — if that blocks a clean read, say so and use `never_touched` from the seller queue
  instead of guessing at cadence position).
- **Important** (BOVs, ELAs, touches that generate a BOV or a working buyer, marketing live
  listings): grep for what actually produces a BOV/ELA record (the `bov-underwriting`/`bov-government`
  skills write workbooks — is there a DB row for "a BOV was generated" or "one is due"? if not, say
  so, don't fabricate one), `bd_opportunities` rows with an open stage, and whatever
  `deal-comms-propagate-tick.js` / `briefing-data.js` already compute for pipeline/working-buyer
  signals — read those two files first, they're the closest existing producers.
- **Urgent** (pipeline management, deal correspondence — pays in ~90 days): `v_lcc_bd_worklist`'s
  `owner_source_conflict` / `contact_writeback` (pipeline hygiene that blocks a deal moving) and
  whatever `deal-comms-propagate-tick.js` emits for deal correspondence needing a response. Loan
  maturity (≤24 mo) does NOT belong here by the canon's own ~90-day window — check whether the data
  can express "maturing within 90 days" as a sub-slice, else it's Important/Significant depending on
  how far out, and say which.

**Where no producer exists for a named example** (e.g. nothing currently marks "marketing a live
listing" as a discrete task) — that's a **named gap**, not something to invent a heuristic for.
Render the section honestly with what's real, and file the gap as a backlog row rather than padding
a section with a fabricated signal.

## 2. Build the recut — one view or handler per section, honest counts

Each section's rendered count must equal the rows it shows (no re-discovery tally, no "raw output"
badge — the Producer/Consumer doctrine). Each row states its basis in one line (the C11 rule — an
operator seeing "Significant: Acme Properties" needs to know *why now*, e.g. "never reached, $4.2M,
newer lease"). Cap each section (top 5–8, matching the existing card pattern) with a "See all →"
link to the relevant full page: Significant → the seller-prospect-queue page (build one if
UX-T1a-queue's surface has no route yet — check; `GET /api/seller-prospect-queue` exists with no
front-end per its own response's closing note), Important/Urgent → Priority Queue / Pipeline as
appropriate.

Reuse existing sources where the measurement in §1 finds a real one — do not rebuild
`v_lcc_bd_worklist` or `v_lcc_seller_prospect_queue`, wire to them. Where a new SQL view is
genuinely needed to bucket a mixed source into a section (e.g. splitting `v_lcc_bd_worklist` by
section), keep it additive and view-only.

## 3. Wire `v_lcc_seller_prospect_queue` into Significant

This is the queue's first real consumer surface (its own response noted "no front-end yet"). Top N
by `rank_value`, each row showing `value`, `newer_lease`/`reason_to_sell` basis, and
`no_linked_person`/`never_touched` state per the queue's own gate columns — never collapse
`value_unknown`/`term_unknown` into 0/false on this card either.

## 4. Guard

Behavioural tests over the section-classification logic (named-row fixtures per section, a mutation
that miscounts a section's badge goes RED); if a new view is added, mirror the existing pattern
(mutation-verified, comments stripped, report the RED count).

## 5. Verify + record

Per-section row/count with the state delta from today's three unstructured cards; name every
producer checked in §1 and what it held (including the ones that turned out empty — that's a
finding, not a failure); the seller-queue card's top rows. Record
`responses/UX-T1a-today.response.md`; update `bd-ranking-and-priority-queue.md`,
`PLANNED-BACKLOG.md` row **UX-T1a-today**, and `CURRENT-STATE.md` in the same change
(BUILD-TURN-PROTOCOL).
