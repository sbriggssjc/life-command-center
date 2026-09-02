# EXT1b — `as_stated` is the authority; the model's `basis` / `precision` labels are the fallback

> **Small, pure-function, guarded by three named rows.** EXT1 made the extractor QUOTE instead of
> compute, and the floor run proved the quotes are reliably verbatim while the labels beside them
> are not. Finish the job: derive basis and precision from the quote in code.

**Read first:** `docs/claude-code/responses/done/EXT1-floor-measurement.response.md` §2–3 (the three
named rows) · `api/_shared/bov-extract.js` (`annualizeRent`, the date resolvers EXT1 added,
`extractTenantFromLease`) · `test/ext1-lease-rent-basis-quoted-dates.test.mjs`.

## 0. The measured defect

Post-EXT1 floor run, same 10 documents, model twice on identical text:

- **Doc 431, tesseract side:** `base_rent { amount: 8.7965, basis: "per_sf_annual", as_stated:
  "$8,796.50 per month" }` → `rent_basis_unresolved` → `year1_rent: null`. The quote says
  *per month* in plain English; the label says per-sf-annual and the amount was divided by 1,000.
- **Doc 336, tesseract side:** `as_stated: "Lease Years 1-5: $75,000.00 per year ($6,250.00 per
  month) …"`, `amount: null` → `year1_rent: null`. The year-1 figure is the first `$` in the quote.
- **Doc 431, control run:** `lease_commencement_detail { date: null, as_stated: "March 15, 2021",
  precision: "formula" }` — the baseline run labelled the same string `precision: "day"`. A plain
  calendar date, classified non-deterministically. That flip is the entire self-disagreement on
  both date fields (80% / 80%).

`year1_rent` self-rate stayed **89%** (predicted ~100); dates **80% / 80%**. Every disagreeing row
carries a parseable quote.

## 1. Build

### 1a. `basisFromAsStated(as_stated) → 'monthly'|'annual'|'per_sf_annual'|'per_sf_monthly'|null`

Regex over the quote, case-insensitive: `per month|monthly|/mo\b` → monthly; `per year|per annum|
annually|/yr\b` → annual; `(per|/)\s*(sq\.?\s*ft|sf|square foot)` combined with `year|annum` →
per_sf_annual, with `month` → per_sf_monthly. **Precedence: the quote's basis over the model's
`basis`**; the model's value is used only when the quote is silent. Log `basis_source:
'as_stated'|'model'`.

### 1b. `amountFromAsStated(as_stated) → number|null`

The FIRST `$`-figure in the quote (`$75,000.00` in the schedule case; `$8,796.50`). Used when the
model's `amount` is null OR disagrees with the quote by more than rounding (8.7965 vs 8,796.50 is a
1,000× disagreement — take the quote). Record `amount_source`.

### 1c. `precisionFromAsStated(as_stated) → { precision, date }`

If the quote parses as a full calendar date (`March 15, 2021`, `1st day of April, 2000`,
`2021-03-15`, `3/15/2021`) → `precision: 'day'`, `date` = parsed ISO. Month-only (`April 2000`) →
`'month'`, date null. Otherwise leave the model's `precision` and `date`. **Never turn a formula
into a date.** Reuse a single date parser — do not add a second one beside whatever EXT1 used.

### 1d. Wire and guard

- Apply all three inside `extractTenantFromLease` before `annualizeRent` and the date resolvers;
  consumer keys unchanged (the EXT1 guard already pins them).
- Guard fixtures = the three named rows above, verbatim, plus negatives: a genuine per-sf quote
  stays per-sf; a formula stays a formula; a schedule with no `$` returns null. Mutation-verify
  each rule; strip comments AND string literals before any source grep.

## 2. Do not

- No prompt change. No OCR change. No backfill.
- Do not widen the sentinel/normalization lists (OCR1c rule).
- Do not resolve a formula date from `lease_term` here — EXT1 §1b already owns derivation, and it
  requires a day-precision commencement.

## 3. Report back

- The three rows re-scored through the new resolvers (expected: 431 rent → 105,558 on both sides;
  336 → 75,000; 431 dates → day precision on both runs).
- Predicted floor movement per field, labelled as a prediction; Scott's re-run
  (`--run --model real --control self --engines tesseract`) is the measurement.
