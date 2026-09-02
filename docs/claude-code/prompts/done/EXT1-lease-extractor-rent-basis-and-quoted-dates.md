# EXT1 — the lease extractor invents rent annualization and date defaults; make it return what the lease states

> **Independent of the OCR bake-off, and it improves BOV extract whichever OCR wins.** The OCR1c
> self-agreement control ran the SAME model on the SAME DocAI text twice: it disagreed with itself on
> **29% of `lease_expiration`** and **11% of `year1_rent`** decisions, and on one lease returned
> **84,464 then 89,496** as the annual rent from a text that states **`$8,464.00` per month** — a
> figure that matches neither 12× nor anything on the page. The model is doing arithmetic and
> choosing date defaults in its head, differently per call. **The fix is to stop asking it to.**

**Read first:** `docs/claude-code/responses/done/OCR1-run2-with-self-control.response.md` §1 and §5 ·
`api/_shared/bov-extract.js` (`leasePrompt`, `extractTenantFromLease`, `cleanRentPeriod`, the
consumer key rename `tenant_name→name`, `leased_sf→sf`) · `scripts/ocr-bakeoff.mjs` `--control self`
(the metric) · `test/ocr-bakeoff.test.mjs` (the graded-field list).

## 0. The measured defect, precisely

`leasePrompt` (`bov-extract.js:128`) asks for:

- `"year1_rent": number|null` — **no basis.** The lease states a monthly or annual figure; the
  prompt never says which to return, so the model annualizes on some calls and not others, and when
  it annualizes it does the arithmetic itself (and gets it wrong).
- `"lease_commencement" / "lease_expiration": "YYYY-MM-DD"|null` — **no rule for partial or
  formulaic dates.** A lease that says "commencing on the Rent Commencement Date, being the first
  day of the month following Delivery" or "a term of ten (10) Lease Years" has no literal date, and
  the model picks `-01-01`, `-05-15`, or the 30th vs the 31st — differently per call. **"Use null for
  anything the lease does not state — NEVER guess"** is in the prompt and is being violated by the
  format instruction that follows it.

## 1. Build

### 1a. Rent carries its stated basis; code annualizes

Change the schema the model returns to:

```
"base_rent": { "amount": number|null, "basis": "monthly"|"annual"|"per_sf_annual"|"per_sf_monthly"|null,
               "as_stated": string|null }      // the verbatim figure, e.g. "$8,464.00 per month"
```

Then in `extractTenantFromLease` compute `year1_rent` **in code**: `monthly × 12`;
`per_sf_annual × leased_sf` (only when `leased_sf` is present — else `year1_rent = null` and
`rent_basis_unresolved = true`); `annual` passes through. Persist `base_rent` beside `year1_rent`
so the derivation is auditable. Keep the consumer's `year1_rent` key and type unchanged — the BOV
generator and the bake-off harness both read it. Apply the same to `rent_schedule[].annual_rent`:
request `amount` + `basis`, annualize in code.

### 1b. Dates as quoted, with a resolution flag

```
"lease_commencement": { "date": "YYYY-MM-DD"|null, "as_stated": string|null,
                        "precision": "day"|"month"|"year"|"formula"|null }
```

Same for `lease_expiration`. Rules in the prompt: `date` is filled ONLY when the lease states a
full calendar date; a month-only statement gives `precision:"month"` and `date` = null; a formula
("first day of the month following…", "ten Lease Years from the Commencement Date") gives
`precision:"formula"`, `date` null, and `as_stated` carrying the formula verbatim. **Code may
derive** `lease_expiration` when commencement has `precision:"day"` and the lease states a term
length in whole years/months (`as_stated` on the term) — and stamps `derived_from_term = true`.
Never the model. Keep the consumer keys (`lease_commencement`, `lease_expiration` as `YYYY-MM-DD`
strings or `''`) unchanged; the structured objects ride beside them.

### 1c. The metric is the self-agreement floor, before and after

Run `node scripts/ocr-bakeoff.mjs --control self --engines tesseract` on the synthetic fixture in
the sandbox (stub model — say so) to prove plumbing, and **state the expected effect on the real
floor**: `year1_rent` self-rate should go to ~100% (the arithmetic is now deterministic) and
`lease_expiration` should rise from 71% (formula dates become a stable null + `as_stated` instead
of a wandering default). ⚠️ **The real measurement is Scott's re-run of `--control self` on the
10 arm-A documents** after deploy; do not claim the improvement — predict it, and say the floor
table is the verification.

### 1d. Guards

- Prompt-shape test: the schema names `basis` and `precision`; a mutation that restores
  `"year1_rent": number` goes red.
- Annualization test on named inputs: `{8464, monthly}` → 101,568; `{12.50, per_sf_annual}` with
  `sf 3800` → 47,500; `{12.50, per_sf_annual}` with `sf null` → `year1_rent null` +
  `rent_basis_unresolved`. **A model-side `year1_rent` number is IGNORED if `base_rent` is present**
  (belt and braces against the model still annualizing).
- Date test: `precision:"formula"` → consumer key `''`, `as_stated` preserved; `precision:"day"` +
  term "10 years" → derived expiration with the flag.
- Mutation-verify; strip comments AND string literals before any source grep (this prompt's
  wording will appear in yours — OCR1c documented the string-literal trap).

## 2. Do not

- Do not change the six graded keys the harness reads (`name`, `lease_commencement`,
  `lease_expiration`, `year1_rent`, `sf`, `lease_type`) — add beside them.
- Do not re-run extraction over stored leases (no backfill; `lcc_cre_bov_extraction` rows are
  dated and the next BOV build re-extracts).
- Do not touch OCR, the drain, or `deps.freeOcr`.
- Do not "fix" the model's variance with `temperature=0` — the harness and this repo deliberately
  measure the model as used.

## 3. Report back

- The before/after prompt diff and the consumer-key compatibility statement.
- The named-input annualization/date tests, mutation-verified.
- The predicted floor movement per field, labelled as a prediction.
- The exact re-run command for Scott (`--control self --engines tesseract`) and which two rows of
  the floor table to read.
