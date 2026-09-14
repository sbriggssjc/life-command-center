# C11 — the call sheet names a person without saying why they are the contact

**Read first:** `docs/audits/C10_PROSPECTING_BRIEF_COLUMN_MAPPING_2026-08-31.md` (which found this,
as **C10b**) · `docs/architecture/bd-ranking-and-priority-queue.md` §3 ·
`docs/architecture/account-based-contact-intelligence.md` (the doctrine this must not violate) ·
`docs/architecture/tier0-owner-contact-system.md` (P188's asymmetry, P161's `works_at` finding).

**One JS change in `api/operations.js::handleProspectingBrief`**, plus possibly one appended view
column. No new table, no cron, no classifier.

---

## 1. What C10 left standing

C10 made the sheet legible — real names, real portfolio values. **It did not make the contact
justified.** Measured live 2026-08-31 over the 126 rows:

| | rows |
|---|---:|
| sheet rows / distinct owners | **126 / 126** |
| carrying a contact email | 113 |
| …whose **email domain corroborates the owner** (P197's rule) | **16** |
| …**consumer mailboxes** (gmail etc.) | 14 |
| owners also on the **Tier 0 confirm lane** | **12 of 126** |

⚠️ **16 of 113 is a LOWER BOUND on correctness, NOT "97 are wrong."** P188 established the
asymmetry explicitly: a real employee can use a personal address, and Easterly's own confirmed
contact sits on `@centurytel.net`. **Do not build anything that treats an uncorroborated domain as
a defect.**

⚠️ **And the Tier 0 lane does not cover this population — 12 of 126.** So "route them to Tier 0" is
not the answer either; that lane selects on a different basis.

## 2. The signal we already hold and do not print

**121 of the 126 carry a relationship edge with a role on file:**

| role on the contact↔owner edge | rows |
|---|---:|
| `prospecting_contact` | **58** |
| `institution_decision_maker` | **35** |
| `manager` | **15** |
| ⚠️ **`works_at`** | **12** |
| `decision_maker` | 1 |
| **no edge at all** | **5** |

**The sheet prints none of this.** It gives the operator a name and a dollar figure and no basis for
either. That is the gap — not the corroboration rate.

## 3. What to build

**Print the basis on which each contact is on the sheet.** Nothing more.

- Surface the contact↔owner edge's `metadata->>'role'` (falling back to `relationship_type`).
  ⚠️ **`v_bd_cadence_dashboard` does not expose it.** Prefer appending a column
  (`CREATE OR REPLACE VIEW` is **append-only** — add at the END, or 42P16) over a per-row lookup in
  the handler, which would be an N+1.
- Render it beside the contact — e.g. `Contact: Eric Dowling (institution_decision_maker)`.
- ⚠️ **Mark the two weak states explicitly:**
  - **`works_at` (12)** is the **Salesforce org edge P161 measured and disqualified** as evidence of
    control. It proves association, never authority. Label it so — *"association only"* — do not let
    it read like `decision_maker`.
  - **no edge at all (5)** must say so. **Do not print an empty string**, which reads as "no role"
    when the truth is "no relationship on file" (the P180 NULL-is-not-zero failure).
- Optionally surface the domain corroboration as a **separate, additive** signal
  (`lcc_tier0_company_confirms_domain`). ⚠️ **If you do, it is a PLUS, never a MINUS** — absence is
  not evidence of a wrong person (§1). Label it *"employer corroborated"* on the 16; **print nothing
  on the rest.**

## 4. ⚠️ What NOT to do

- **Do not filter the sheet on corroboration.** It would drop ~97 rows on a lower bound and
  re-create the exact Class 24 mistake C8 just fixed — excluding real owners because a *label*
  is missing rather than a *fact* being false.
- **Do not re-rank on it.** Ranking is `rank_value`; C9a is already an open question about that
  column and this change must not entangle with it.
- **Do not build a corroboration classifier.** P188/P196/P198 measured lexical owner↔person matching
  at ~25% raw and 4-of-6 guarded. The edge role is a **recorded fact**; use it, do not infer.
- **Do not change the pitch.** `account-based-contact-intelligence.md`: acquisitions vs disposition
  are different contacts and tones, and the buy-side relationship funnels *into* disposition.
  **Showing the role does not choose the tone** — that is still **C4a**, Scott's.

## 5. Predicted result — assert against this

| | before | after |
|---|---|---|
| rows served | **126** | **126 — unchanged** |
| rows showing a role basis | **0** | **121** |
| rows saying "no relationship on file" | 0 | **5** |
| rows flagged association-only (`works_at`) | 0 | **12** |
| gate · ordering · limit | — | **unchanged** |

⚠️ **A rendering/enrichment change only. If the row count moves, stop and find the mechanism.**

## 6. Report back

- The top 10 rendered rows, **before and after** — legibility is the deliverable, so show it.
- The role distribution you observed, against §2.
- How you rendered `works_at` and the 5 with no edge.
- Whether you appended a view column or looked up per row, and why.
- ⚠️ **State plainly in your writeup that 16/113 is a lower bound**, so the next reader does not
  turn it into a filter.
