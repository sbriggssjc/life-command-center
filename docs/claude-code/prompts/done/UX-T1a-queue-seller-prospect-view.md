# UX-T1a-queue — `v_lcc_seller_prospect_queue`: the doctrine's queue as ONE view, gates as named columns

> **Read first:** `docs/audits/UX_T1a_SELLER_QUEUE_MEASUREMENT_2026-09.md` (the funnel + §8's
> recommended Part B + §9's verification SQL) · `docs/claude-code/responses/done/UX-T1a-gates.response.md`
> (the honest gates, the loan arm's attribution-before-value rule, the re-derived dia counts) ·
> `docs/os/canon/blocks/operator-doctrine.md` (1.8.0, "The queue, quantified") ·
> `docs/architecture/bd-ranking-and-priority-queue.md` (top banner) · `CLAUDE.md` → the UX-T1a and
> UX-T1a-gates sections (the traps already paid for — re-read the "say which grain" and circular-
> validation bullets before quoting any number).

Both coverage gates are honest as of UX-T1a-gates (dia lease dates mirrored, 1,747 properties;
`loan_maturity` owner-attributed, 172 rows / 109 owners). This round builds the deliverable. **View +
handler + guard only — no cadence change, no Today re-cut (UX-T1a-today is separate), no new lexical
rules (UX-T1a-regex is refused until graded).**

## 1. The view — `v_lcc_seller_prospect_queue` (LCC Opps)

One row per **(owner entity, property)** current holding, gates as NAMED COLUMNS so an operator (and
a guard) can read WHY a row is in or out:

- `in_band` — individual property value $2.5M–$25M · `value` · **`value_basis`** (the audit's
  domain-aware ladder: gov `noi/cap` · dia `annual_rent/cap` · gov-no-NOI `rent × 0.703/cap` ·
  `value_unknown`). **`value_unknown` is a state, never $0 and never false** (P180). ⚠️ Never
  `sale_price` on gov (portfolio trades — p50 ratio 0.164 at 5+ properties/price).
- `newer_lease` + **`newer_lease_basis`** — §0b.1, relative to the swimlane: dia ≥12 yrs remaining
  (new-build 15-yr standard) OR within first 3 years of initial term (basis names which arm);
  gov = FIRM term via the mirrored gov columns. `term_unknown` first-class (dia still has 1,252;
  gov's absent-register tail). Use the gates-round's superseded-aware selection — expect dia ≈ 56
  in-band newer-lease rows; if it differs, say why.
- `reason_to_sell` — **recorded signals only**: `debt` (a `lcc_loan_maturity` row ≤24 mo on the
  asset — months-to-maturity + `is_distressed` carried) · `value_creation_developer` (the
  `developer` role from `v_lcc_entity_roles` — ⚠️ multi-label, aggregate to the owner before joining
  or rows fan out) · else **`reason_to_sell_unmeasured`** (an explicit state; death/divorce stay
  unreachable, never a regex).
- `reach_state` — §0b.4 via the audit's strict definition: person-link touches + human categories
  only (`never_touched` / `in_pipeline_untouched` / `touched`), and **`no_linked_person`** as its
  own state (847 of 6,480 owners have a linked person — the binding constraint; do not let it read
  as `never_touched`).
- `rank_value` — client value first, then lease recency (years into initial term ASC). NULL when
  value is unknown, never 0. `human_surface`-style exclusions inherited: tombstones, brokerage /
  placeholder / public-body / not-prospected guards (positive-control each on the admitted set AND
  fleet-wide, per the gates round).

**Population = variant F:** in band AND (newer_lease OR reason_to_sell) AND not `touched` —
expected ≈ 592 rows / 495 owners from the audit, but **re-derive and report the delta with a
reason** (the gates round moved dia's term coverage, so it should GROW; say by how much and which
gate). Emit the excluded populations as counts in a companion `v_lcc_seller_prospect_queue_summary`
(in-band-but-older-lease, term_unknown, value_unknown, touched) so the funnel stays visible —
honest counts, each equal to rows a filter would show.

Profile with the handler's real ORDER BY (`rank_value desc nulls last` + limit) — quote buffers,
not wall-clock; `not materialized` only where a measured point query needs it (C13b §7.7).

## 2. The surface

Serve it via a sub-route on an existing handler (`?_route=` per the rules; mount in `server.js`),
value-ranked, capped with a real pager (the A1 lesson: return the `pagination` block or the page
lies), each row carrying its gate columns so the card can say *why this owner, why now* — the C11
rule: the basis is on the card. Chips filter server-side and their counts gate on the same
predicate as the list (P139). **Do not wire it into Today** — that is UX-T1a-today's job; this
round's surface is the queue page itself (replace or sit beside the hidden-band queue; state
which and why).

## 3. Guard — `test/uxt1a-queue.test.mjs`

Behavioural over the view where possible (the gates round's lesson — three shape-greps survived
their mutations): named-row fixtures for each gate state incl. `value_unknown`/`term_unknown`/
`no_linked_person`; a mutation that folds `value_unknown` into false or 0 goes RED; the
variant-F predicate asserted as (newer OR reason) not AND; the summary counts equal the view's
group-bys; comments stripped; mutation-verify and report the RED count.

## 4. Verify (state delta, named rows)

Row/owner counts vs the audit's 592/495 with the delta explained; top-25 named rows with their
gate columns (expect Part A's strict-23 to be a subset — name any that dropped and why); the
funnel summary; positive controls (a touched owner absent, a sub-$2.5M asset absent, the 42%-FP
trust/estate names absent since no regex exists). Record
`responses/UX-T1a-queue.response.md`; update `bd-ranking-and-priority-queue.md` and the backlog
rows in the same change (BUILD-TURN-PROTOCOL).
