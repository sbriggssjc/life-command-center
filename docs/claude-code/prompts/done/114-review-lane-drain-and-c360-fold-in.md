# Prompt 114 — Drain the owner-contact review lane + fold linked people into the hero

**This prompt exists because Prompt 111 created it.** 111 shipped the safe slice (+36 owners, batch
`ocp_20260815`) and deliberately routed **101 candidate decision-makers to a review lane with no consumer
surface** — flagging, in its own write-up, that the lane does not satisfy the Consumption-Layer doctrine's
"named consumer" requirement until this unit ships.

**Run this BEFORE 112.** Draining the lane grows the reachable population, which shrinks 112's auto-retire
list. Retiring cadences that are about to become workable would be a self-inflicted wound.

---

## The two coupled defects

### Defect 1 — the review lane is a producer with no consumer
**101 rows** of verbatim-evidenced candidates (Eric Dowling, Delos Yancey, Lee Elman, Daniel Brower, …) sit
in `lcc_clean_assist_proposals`-style storage with no verdict surface. They were routed there **correctly**:
stamping a *person's* email onto an *owner org* record is exactly the conflation
`api/_shared/sf-account-link.js` guards against. But a correct routing decision into a lane nobody works is
still un-consumed work.

### Defect 2 — the hero cannot see a linked person, so attaching one changes nothing
`buildContact360` builds `subject.email` from `entities.email` **or** a `unified_contacts` row whose
`entity_id` **IS** the owner. It never walks `entity_relationships` to a linked person. `_nextActionForContact`
gates on `subject.email` / `entity.phone`.

**Consequence:** attach a person + edge to an owner — the doctrinally correct write — and the owner panel
**still says "Find a contact."** Measured today: `reachable_graph` **139** vs `reachable_hero` **92**, so
**47 owners are already reachable in the data and invisible in the UI.**

> **These two must ship together.** Draining the lane without the fold-in produces correct data and zero
> operator-visible change. The fold-in without the drain fixes 47 owners and leaves 101 candidates stranded.
> Shipping either alone will look like a failure.

---

## Grounded baseline (verify first — `SELECT * FROM public.v_lcc_owner_reachability`)

| Metric | Value |
|---|---|
| owner entities reachable from an asset | 690 |
| `reachable_hero` (what the operator sees) | **92 (13.3%)** |
| `reachable_graph` (what the data supports) | **139 (20.1%)** |
| **hero-vs-graph gap = pure UI defect** | **47 owners** |
| review-lane candidates awaiting a verdict | **101** |
| owners only solvable via the paused SOS path | **~478 (82%)** |

**Honest ceiling: this prompt cannot exceed ~20% reachability.** Even a perfect result — all 47 folded in,
all 101 confirmed — leaves the ~478 SOS-blocked owners untouched. Say that in the write-up; do not let a
good result imply the constraint is solved.

---

## Unit 1 — the person+edge attach model (the verdict action)

Confirming a lane row must produce the **doctrinally correct** shape, not the expedient one:
- mint/resolve a **`person` entity** for the decision-maker (junk-guarded: `isMisparseName`,
  `validateContactIngest`, the TrafficMetrix fan-out cap — a page's single email fanned across many "people"
  is the exact failure mode that produced `tm_misparse`);
- link person → owner org via **`entity_relationships`** with a role, not by stamping the person's email
  onto the org record;
- an SF Account binds as an **org edge on the person**, never as an identity on the person
  (`sf-account-link.js`);
- provenance-tagged, reversible by batch tag, idempotent.

**Reject** is a first-class verdict and must be recorded, not just dropped — a rejected candidate should not
be re-proposed on the next tick.

## Unit 2 — fold linked people into `buildContact360`

Make the hero see what the graph knows. Design questions to answer **before** coding:
- **Which person wins** when an org has several linked people? Needs a deterministic, documented rule
  (primary flag → most recent verified → highest-authority provenance). Never "first row".
- **Keep the distinction visible.** `subject.email` currently means "this org's own contact". A person's
  email is a *different claim*. Prefer an explicit shape — e.g. `subject.reachable_via: {person_id, name,
  role, source}` — so the panel can render *"reach via Eric Dowling (manager)"* rather than silently
  implying the org has that address. **Do not blur a person into an org to make a badge turn green.**
- `_nextActionForContact` then advances from *"Find a contact"* to *"Log a touchpoint"* / *"Connect in SF"*.
- The **compact companion dock** reuses the same resolver — check both surfaces.

## Unit 3 — the consumer surface

Wire the lane into an existing review surface (Decision Center lane / `review-shared.js` map) rather than
building a new one — **review existing machinery first**. Value-rank by owner portfolio value / our open
deals, cap the visible set, and make the badge count **actionable rows only** (honest counts).

## Unit 4 — close the doctrine gap 111 left open

- `v_field_provenance_unranked` returns **35 rows**; doctrine says 0. 111 registered the ladder for
  `entities.email/phone`; the other 35 are other tables and predate it. **Quantify and list them** —
  fixing them is optional here, ignoring them silently is not.
- Confirm the new attach path registers its own `field_source_priority` rows so it does not add a 36th.

---

## Deliverable

1. Units 1–3 shipped together, dry-run default, reversible by batch tag, idempotent.
2. **Before/after from `v_lcc_owner_reachability`** — `reachable_hero` **92 → ?** and the hero-vs-graph gap
   **47 → ?** (target: 0, since that gap is a pure UI defect).
3. Verdict counts: of 101, how many confirmed / rejected / still ambiguous — and what the **residual**
   population looks like.
4. Update `panel-redesign-verification.md` §3.3 and `connectivity-and-open-threads.md` §4b BREAK-1.
5. A regression test for the winner-selection rule in Unit 2 — it is exactly the kind of "first row wins"
   logic that produced the `ensureTrueOwner` substring bug (gov `CLAUDE.md` §20).

## Out of scope
- Re-enabling the SOS-direct / web-search chain (that is the ~478, and it stays measured-but-blocked).
- Cadence enrolment for newly-reachable owners — that is prompt 112 Unit A2, deliberately separate so this
  prompt cannot quietly create 100 new un-worked cadences.
