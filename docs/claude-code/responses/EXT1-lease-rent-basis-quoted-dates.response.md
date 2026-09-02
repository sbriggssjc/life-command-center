# EXT1 — the lease extractor quotes; the code annualizes and resolves dates (2026-09-02)

**Shipped.** `api/_shared/bov-extract.js` (prompt + three pure resolvers + the wiring),
`scripts/ocr-bakeoff.mjs` (the offline stub now speaks the new shape), guard
`test/ext1-lease-rent-basis-quoted-dates.test.mjs` — **21 tests, 20/20 mutations RED**.
Full suite **5,101 pass / 0 fail / 6 skipped**. No migration, no backfill, no OCR change.

## 1. The prompt diff

| was | is |
|---|---|
| `"year1_rent": number\|null` | `"base_rent": { "amount", "basis": "monthly"\|"annual"\|"per_sf_annual"\|"per_sf_monthly"\|null, "as_stated" }` |
| `"lease_commencement": "YYYY-MM-DD"\|null` | `{ "date": "YYYY-MM-DD"\|null, "as_stated", "precision": "day"\|"month"\|"year"\|"formula"\|null }` |
| `"lease_expiration": "YYYY-MM-DD"\|null` | same object shape |
| — | `"lease_term": { "as_stated", "years", "months" }` (the only input a derivation may use) |
| `rent_schedule[].annual_rent: number` | `rent_schedule[].base_rent: { amount, basis, as_stated }` |

Two new instruction blocks carry the reason, in the model's own terms:
**"RENT — REPORT IT AS THE LEASE STATES IT. DO NOT ANNUALIZE AND DO NOT DO ANY ARITHMETIC"**
(with `$8,464.00 per month` — the lease from the self-control run — as the worked example), and
**"DATES — QUOTE, DO NOT RESOLVE"**, naming the two real cases that produced the wandering
defaults: a month-only statement, and a date defined by an event or a formula.

⚠️ **The old `'Dates as YYYY-MM-DD.'` line is gone, not softened.** It sat two lines below
`'Use null for anything the lease does not state — NEVER guess a value.'` and is the format rule
that forced the guess. Leaving it in place while adding `precision` would have kept both
instructions live and let the model pick.

## 2. Consumer-key compatibility — unchanged, and pinned

`extractTenantFromLease` still emits **`name`, `lease_commencement`, `lease_expiration`,
`year1_rent`, `sf`, `lease_type`** with the same names and the same types (string / string /
string / number|null / number|null / string). Verified three ways: the new guard asserts each key
and its `typeof`; `test/ocr-bakeoff.test.mjs`'s existing `assertGradedFieldsReadable` round-trip
still passes; and `bov-generator/main.py`'s `TenantInput` is `extra="allow"`, so the evidence keys
ride through to the Lease Abstract tab rather than being rejected.

The evidence rides **beside** the six, never instead of them:
`base_rent{amount,basis,as_stated}` · `rent_basis_unresolved` ·
`lease_commencement_detail` / `lease_expiration_detail` `{date,as_stated,precision[,derived_from_term]}` ·
`lease_term`. `rent_schedule[]` keeps `annual_rent` (the generator's `RentPeriodInput` reads it) and
gains its own `base_rent` + `rent_basis_unresolved`.

**Backward compatible in both directions.** A model that ignores the schema and returns a bare
`year1_rent` number or a bare `"2020-01-01"` string still lands correctly — the quote is preferred
when present, the legacy value is used when it is the only thing on offer. That is what keeps every
pre-EXT1 `lcc_cre_bov_extraction` row readable without a backfill.

## 3. Named-input tests, mutation-verified

**Annualization** (`annualizeRent`, the only place this arithmetic happens):

| quote | leased SF | `year1_rent` | `rent_basis_unresolved` |
|---|---:|---:|---|
| `{8464, monthly}` — the self-control lease | — | **101,568** | false |
| `{12.50, per_sf_annual}` | 3,800 | **47,500** | false |
| `{1.25, per_sf_monthly}` | 3,800 | 57,000 | false |
| `{132430, annual}` | — | 132,430 | false |
| `{12.50, per_sf_annual}` | **null** | **null** | **true** |
| `{90000, basis: null}` | 3,800 | **null** | **true** |
| `{amount: null, monthly, as_stated:"TBD"}` | 3,800 | null | **false** |

Two judgement calls worth stating rather than burying:

- **An amount with no stated basis resolves to null, not to itself.** Passing 90,000 through as an
  annual figure is the same guess as annualizing, in the other direction; the verbatim `as_stated`
  is kept so a reader can settle it. This is the one place EXT1 can *lower* coverage, and it lowers
  it only where the previous number was unearned.
- **"the lease states no rent" and "we cannot convert the rent it states" are different facts.**
  A null amount returns `rent_basis_unresolved: false` — P180's unknown-is-not-a-value rule applied
  to the reason as well as the value. Mutating that to `true` goes red.

**Belt and braces:** a model returning `base_rent {8464, monthly}` **and** `year1_rent: 89496`
(exactly what it did, live) resolves to **101,568**. The model's own arithmetic can never be
preferred to ours.

**Dates:**

| input | `lease_expiration` | detail |
|---|---|---|
| `{date:null, precision:"formula", as_stated:"the first day of the month following Delivery"}` | `''` | formula + verbatim text preserved |
| `{date:"2030-05-15", precision:"formula"}` — the model resolving it in its head | `''` | **the date is DROPPED**; `as_stated` kept |
| commencement `2020-06-01` day + term `10 years`, expiration formula | **`2030-05-31`** | `derived_from_term: true` |
| commencement `2020-06-01`, expiration **stated** `2031-05-31`, term 10 yr | `2031-05-31` | **never overwritten** |
| `"2026-02-31"` | `''` | not a real calendar day |

The derivation convention is stated in code and pinned: a term of N months from D expires the day
**before** D+N months (ten years from 2020-06-01 ends 2030-05-31), with a month-end commencement
**clamped** to the last day of the target month rather than rolling forward (`2020-01-31` + 1 month
→ `2020-02-28`). It refuses every partial input — no stated day, no stated term, a month-precision
commencement — rather than defaulting, and it is stamped so a reader can tell a derivation from a
date the lease states.

**Mutation pass: 20/20 RED**, covering the prompt (restore `year1_rent`; drop `precision`), every
annualization branch, the ignore-the-model rule on both the tenant and each schedule row, the
vague-precision drop, the calendar-day check, all four derivation guards, the `derived_from_term`
stamp, and a renamed graded key.

⚠️ **Two assertions survived their first mutation and both were the test's fault, not the code's.**
(1) The cents-rounding check used `12.51 × 3810`, which is **exact in IEEE-754** — so it passed with
the rounding removed. It now also asserts `8464.33 × 12 = 101571.96` (unrounded: `101571.95999999999`).
(2) The schedule test supplied no conflicting `annual_rent`, so "prefer the model number" changed
nothing. **The mutation pass found both; reading the tests did not.**

⚠️ **One guard is a source check and it needed literal-blanking, comments-first.** `.map(cleanRentPeriod)`
bare passes the array **index** into the leased-SF slot — period 0 becomes unconvertible and period 1
a 1-SF building, silently — so the guard pins `cleanRentPeriod(p, sf)`. The module's comments quote
`year1_rent` and `84,464` while explaining the fix, and the **prompt itself is a wall of string
literals naming `base_rent`, `basis` and `precision`, so a code-shape grep matches the prompt text**.
Comments are stripped first, then literals blanked (OCR1c's order: blanking first lets an apostrophe
in prose open a string that swallows real code).

## 4. Predicted floor movement — a PREDICTION, not a measurement

**Nothing here has been measured against the real model.** The sandbox has no OCR engine on PATH
(`--self-test` reports surya / paddleocr / ocrmypdf / tesseract all absent) and no model, so
`--control self` cannot run. What was proven here is plumbing: the harness's offline stub now emits
the **quoted** shape, and a guard drives it through the real `extractTenantFromLease` end to end
(412,500 annual, both dates at day precision, all six graded keys readable). Had the stub kept the
pre-EXT1 shape, `--self-test` would have exercised the legacy fallback on every run and left the
production path untested by the one command that needs no model.

| field | measured floor (2026-09-02) | predicted | why |
|---|---:|---:|---|
| `year1_rent` | 89% | **~100%** | the arithmetic left the model; identical text ⇒ identical quote ⇒ identical product |
| `lease_expiration` | 71% | **rises** — bounded by how consistently the model *classifies* precision | a formula now resolves to a stable `null` + verbatim text instead of a wandering `-01-01` / `-05-15` |
| `lease_commencement` | 90% | rises, same mechanism | |
| `tenant_name` / `leased_sf` / `lease_type` | 100% | unchanged — untouched | |

⚠️ **A rising `lease_expiration` self-rate is NOT the same as more expirations found.** Some
disagreements become a stable *both-null*, which the harness excludes from the rate by design — so
read the `self_both_null` column beside the rate, or a field that got more honest will read as a
field that got better. The residual self-disagreement is now the model classifying `precision`
inconsistently, which is a much narrower question than picking a day.

## 5. Scott's re-run — the verification

On the workstation, against the same 10 arm-A documents:

```
node scripts/ocr-bakeoff.mjs --run --control self --engines tesseract
```

**Read exactly two rows of the floor table in §1 of the report: `year1_rent` and
`lease_expiration`.** `year1_rent` at ~100% is the deliverable. For `lease_expiration`, read the
rate **and** `self_both_null` together, per the caveat above. The other four fields are the control:
they were 100/100/90/100 and EXT1 does not touch them, so any movement there is sample noise or a
harness problem, not this change.

The GaryBuilt run (surya + paddle + tesseract) still decides OCR1b and is unaffected by this — EXT1
lowers the model noise floor every engine is read against, which makes that run *more* legible, not
less.

## 6. Not done, deliberately

- **No backfill.** `lcc_cre_bov_extraction` rows are dated and the next BOV build re-extracts.
- **No `temperature=0`.** The harness and this repo measure the model as it is actually used.
- **OCR, the drain and `deps.freeOcr` untouched.**
- **The six graded keys were not renamed or extended** — the bake-off scores `both_null` forever on
  a key the consumer stops emitting, and that bug has already been live in this harness once.
