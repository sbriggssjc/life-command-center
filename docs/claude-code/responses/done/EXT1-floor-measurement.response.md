# EXT1 — the floor re-run (workstation, 2026-09-02 ~19:40 UTC): what moved, what did not, and why

**Reconciled by Cowork from `bakeoff/agreement.md` + `agreement.json` (local). Findings only.**
`--run --model real --control self --engines tesseract`, same 10 arm-A / 5 arm-B / 3 fixtures,
extractor at `985d322` (EXT1 deployed). The prediction on file was `year1_rent` 89% → ~100% and
`lease_expiration` 71% → up. **Neither landed as predicted, and reading the rows says why.**

## 1. The floor, before → after

| field | run 2 (pre-EXT1) | run 3 (post-EXT1) | decided fields |
|---|---:|---:|---|
| `tenant_name` | 100% | 100% | 12 → 12 |
| `lease_commencement` | 90% | 80% | 10 → 5 (both_null 2 → 7) |
| `lease_expiration` | 71% | 80% | 7 → 5 (both_null 5 → 7) |
| `year1_rent` | 89% | **89%** | 9 → 9 |
| `leased_sf` | 100% | 83% | 6 → 6 |
| `lease_type` | 100% | 100% | 12 → 12 |
| **all** | **93%** | **92%** | 56 → 49 (both_null 16 → 23) |

**Tesseract vs DocAI, after:** rent disagreements **2 → 0**, date disagreements **4 → 0**; the
residue is 3 `docai-only` rents (336, 431, fixture) and 2 `docai-only` dates (425). Tesseract
`rate − self` on dates: **0.0 pp** (was −20).

## 2. Read on named rows

- ✅ **Doc 255 is the proof EXT1 works.** `as_stated: "$8,464.00 per month"` → `basis: monthly` →
  **101,568** on the baseline, the control AND the tesseract run (run 2 gave 8,464 / 89,496 / 84,464).
  Both dates are formula-defined in the lease ("Five days after Landlord's Work is Substantially
  Complete"; "midnight on the last day of the 15th Lease Year") and are now an honest null with the
  formula quoted and `lease_term: 15 years` beside it. **The seven new date both-nulls are correct
  nulls, not lost coverage** — 255 and 336 are formula leases the old prompt was guessing on.
- ⚠️ **Doc 431 — the model's LABEL is wrong while its QUOTE is right.** Tesseract-side:
  `as_stated: "$8,796.50 per month"` but `basis: "per_sf_annual"`, `amount: 8.7965` →
  `rent_basis_unresolved` → `year1_rent null` (DocAI-side got 105,558 correctly). **The verbatim
  string carries the basis in plain English; the model mislabelled it.** Same document, control run:
  `"March 15, 2021"` came back `precision: "formula"`, `date: null`, where the baseline run said
  `precision: "day"` — a plain calendar date, labelled non-deterministically. That flip is the whole
  self-disagreement on both date fields.
- ⚠️ **Doc 336 — `as_stated` holds the rent SCHEDULE and `amount` is null.** Tesseract-side
  `as_stated: "Lease Years 1-5: $75,000.00 per year ($6,250.00 per month) …"`, `amount: null` →
  `year1_rent null`; DocAI-side returned `amount: 75000, basis: annual`. The year-1 figure is the
  first line of the quote.
- ✅ **Doc 425 — a REAL tesseract miss, now visible instead of guessed.** Tesseract text rendered
  the dates as `"1st day of A ec | , 2000"` / `"midnight on_MWac ah £344 [31], 2015"`; the model
  correctly returned `precision: formula, date: null`. DocAI-side read both dates. This is the
  OCR-quality signal the bake-off exists for, and before EXT1 it was buried under model noise.
- Doc 431 `tenant_name`: the lease names an individual AND two entities as tenant; DocAI-side
  returned the person, tesseract-side all three. A lease-ambiguity question, not OCR.

## 3. What this decides

- **EXT1 removed the two noise classes it targeted** (arithmetic; date defaults). The date
  `rate − self` for tesseract went from −20 pp to 0.
- **The remaining self-disagreement is the model mislabelling `basis` and `precision` on quotes
  that are unambiguous in English.** The fix is code, not prompt: **parse `as_stated` as the
  authority** — `per month|monthly` → monthly, `per year|per annum|annually` → annual, `/sf|per
  square foot` → per-sf, a full calendar date → `precision: day` with the parsed date; take the first
  `$` figure when `as_stated` is a schedule — and use the model's label only when the quote is
  silent. That is **EXT1b**, and it should take `year1_rent` and both dates to a ~100% floor on
  this sample because every mislabelled row above carries a parseable quote.
- ⚠️ **Coverage note for the BOV consumer:** formula-defined leases now yield `''` for dates where
  they used to yield a guess. `lease_term` + a day-precision commencement lets code derive
  expiration (EXT1 §1b); a formula commencement cannot be derived and should render "Not on file"
  with the formula — which is the truthful answer.

## 4. Next

**EXT1b** (CC): `as_stated` parsers as the single owner of basis/precision; model labels as
fallback; the two named rows (431 rent, 431 dates) and the schedule case (336) as guard fixtures;
re-run `--control self --engines tesseract` and read the same two floor rows.
