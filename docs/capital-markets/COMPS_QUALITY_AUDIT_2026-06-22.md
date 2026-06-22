# Comps quality audit — sales + lease (2026-06-22)

> Audit #35. Are the sales/lease comps accurate, deduped, and cap-rate-sound enough to stand in a
> client deliverable? Grounded live on both DBs. Headline: **accuracy is good; the constraint is
> coverage, not correctness.**

## Sales comps

### Dedup integrity — CLEAN (both DBs)
Duplicate-leak test (same property + sale_date + price, NOT excluded-from-market) =
**0 dup groups on gov AND dia.** No double-counting in the live comp set. The dedup + exclusion
machinery (R37) is working: gov excludes 10,198/14,819 (69%) and dia 1,680/4,724 (36%) as
portfolio components / dups / no-price events, leaving a clean market set.

### Cap-rate soundness — GOOD, with a unit note
- **Stored as a FRACTION on both DBs** (gov avg 0.0853, dia avg 0.069) — consistent, so a combined
  export won't mix units. **Deliverable note:** the comp/BOV templates must render cap ×100 (0.085 →
  8.5%); confirm the briggs-comps + BOV templates do.
- **dia caps are tight + clean:** range 4.0%–11.9%, no out-of-band — excellent.
- **gov caps:** 92% in a plausible 3–15% band; **8% (430) out-of-band** (<3% or >30%) — the only real
  accuracy flag, already surfaced by R7's `v_implausible_sale_values` / Decision Center lane.

### Coverage — the real constraint
| | gov (14,819) | dia (4,724) |
|---|---|---|
| real price | 42% | **91%** |
| real cap | 36% | 58% |
| comp-ready (price+date+cap+RBA) | **3,037 (20%)** | **2,739 (58%)** |
- **dia sales comps are healthy** — 91% priced, clean caps, 58% deliverable-ready.
- **gov sales comps are price-thin** (42%) — the R53 event-sale story (deeds/lessor changes without a
  recorded price). The priced/capped ones are sound; there are just fewer of them. Lever = R53
  suspected-sale promotion + the deed deep-parse (UW#6) + CoStar per-deal.

## Lease comps
- **Template:** the canonical 26-col dialysis lease-comps template (the merge round) is the single
  standard, aligned to the deployed export, formula-protected columns intact.
- **Underlying data (from UW#2):** gov lease economics are excellent (GSA feed: rent/term/dates
  94–100%); dia active-lease economics are sparse (rent+expiration 32%, escalation ~1%) — the lease
  comp deliverable for dia is a per-deal assembly (capture the lease at deal time), consistent with
  the OM/BOV readiness audit (#34).

## Verdict
The comps are **accurate and safe for a client deliverable** where the data exists: dedup is clean
(0 leaks), cap rates are sound (dia tight; gov 92% in-band), exclusion logic correctly removes
portfolio/dup/no-price rows. The limitation is **coverage** — gov sale price/cap (R53 + UW#6) and
dia lease economics (UW#2/per-deal) — not correctness. Two concrete follow-ups:
1. **Confirm the comp/BOV templates render cap as a percent** (×100 on the stored fraction) — a
   one-time template check to avoid a "0.085%" mis-render.
2. **The 430 gov out-of-band caps** are the only accuracy cleanup — already in the R7 implausible-
   value lane for review.
