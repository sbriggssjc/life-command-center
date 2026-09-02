# EXT1b — `as_stated` is the authority; the model's `basis` / `precision` labels are the fallback

**Shipped 2026-09-02.** One JS file (`api/_shared/bov-extract.js`), no migration, no prompt change,
no OCR change, no backfill. Guard `test/ext1b-as-stated-authority.test.mjs` — 23 tests, **16/16
mutations verified RED**. Full suite **5,178 tests / 0 fail**; `test/ext1-lease-rent-basis-quoted-dates.test.mjs`
21/21 unchanged.

## 1. The three named rows, re-scored through the new resolvers

| row | before (tesseract side) | after |
|---|---|---|
| **431 rent** `basis:"per_sf_annual"`, `amount: 8.7965`, `as_stated:"$8,796.50 per month"` | `rent_basis_unresolved`, `year1_rent: null` | **`year1_rent: 105558`**, `basis: monthly` (`basis_source: as_stated`), `amount: 8796.5` (`amount_source: as_stated`) |
| **336 rent** `amount: null`, `as_stated:"Lease Years 1-5: $75,000.00 per year ($6,250.00 per month) …"` | `year1_rent: null` | **`year1_rent: 75000`**, `basis: annual` from the quote |
| **431 dates** `precision:"formula"`, `date: null`, `as_stated:"March 15, 2021"` | `lease_commencement: ''` on the control run, `2021-03-15` on the baseline | **`2021-03-15`, `precision: day`, `precision_source: as_stated` on BOTH runs** |
| **255 rent** (the EXT1 proof — must not move) | `101568` | **`101568`, unchanged**; `amount_source: model`, because the model agrees with its own quote |

Every override records its source, so a reader can always tell which half spoke.

## 2. What was built

Three pure functions plus two reconcilers, all exported:

- **`basisFromAsStated(as_stated, amountIndex = 0)`** → `monthly|annual|per_sf_annual|per_sf_monthly|null`.
- **`amountFromAsStated(as_stated)`** → the first `$`-figure, or null.
- **`precisionFromAsStated(as_stated)`** → `{precision, date}` or null, over **`parseStatedDate`, the
  module's single date parser** — `resolveQuotedDate`'s bare-string branch now routes through it too,
  replacing its own inline ISO handling. One parser, not two.
- `reconcileBaseRentWithQuote` / `reconcileQuotedDateWithQuote` apply them in
  `extractTenantFromLease` (before `annualizeRent` and the date resolvers) and in `cleanRentPeriod`,
  so a schedule stated monthly stops being mislabelled row by row as well.

## 3. Four decisions worth reading, three of them measured against the obvious alternative

- **⚠️ THE BASIS BELONGS TO ONE FIGURE, SO THE WINDOW STOPS AT THE NEXT `$`.** Doc 336's quote states
  both a period *and* a parenthetical monthly restatement of the same rent. Classified over the whole
  string it is ambiguous and abstains — which loses the row. The window runs from the start of the
  quote to the **next** `$`-figure after the one being classified, so 336 reads *"per year"* and never
  sees the parenthetical. Where a window genuinely carries both markers (*"annual base rent of
  $105,558.00, payable in monthly installments of $8,796.50"*) it returns null and the model's label
  stands — **silence hands the decision back rather than flipping a coin.**
- **⚠️ THE AMOUNT RULE IS PRESENCE-IN-THE-QUOTE, NOT A TOLERANCE — and that is the whole point.**
  8.7965 and 8,796.50 are the SAME figure scaled by 1,000; **no threshold distinguishes that from a
  different figure on the page.** So: if the model's amount appears as a `$`-figure in its own quote it
  keeps it (and the basis is read around *that* figure); otherwise the quote's first figure wins.
  Measured on the adversarial case *"a security deposit of $10,000 and base rent of $8,796.50 per
  month"* — a bare first-figure rule takes the deposit; this rule takes the rent.
- **⚠️ A FORMULA IS NEVER TURNED INTO A DATE, INCLUDING ONE THAT CONTAINS A DATE.** `parseStatedDate`
  must **consume the whole quote** after stripping a small closed set of structural wrappers (a
  `Label:` prefix, `on the`, `midnight on`, trailing punctuation). *"the earlier of March 1, 2021 or
  thirty days after Delivery"* contains a calendar date and IS a formula; a `.search()` would resolve
  it and re-commit the exact defect EXT1 removed. Verified null, along with *"Five days after
  Landlord's Work is Substantially Complete"* and *"midnight on the last day of the 15th Lease Year"*.
- **The quote decides in BOTH directions.** A day quoted under a `formula` label becomes a day; a
  **month-only quote under a `day` label drops the day the model invented**. That second direction is
  the same doctrine and is easy to omit — it is mutation-guarded.

Deliberately unchanged, per the brief: a per-SF quote with no period stated (*"$12.50 per rentable
square foot"*) returns **null**, never a guessed annual — market convention is not something that
lease said; the sentinel/normalization lists are untouched; and nothing here derives a formula date
from `lease_term` (EXT1 §1b already owns that, and requires a day-precision commencement).

## 4. Predicted floor movement — a PREDICTION, not a measurement

Scott's re-run (`--run --model real --control self --engines tesseract`, same 10 arm-A / 5 arm-B / 3
fixtures) is the measurement. Reading the rows behind the EXT1 floor table:

| field | run 3 (post-EXT1) | predicted | basis for the prediction |
|---|---:|---:|---|
| `year1_rent` | 89% | **~100%** | the only two disagreeing rows are 431 and 336, and both now resolve deterministically from their quotes |
| `lease_commencement` | 80% | **~100%** | the entire self-disagreement is 431's `formula`/`day` flip on `"March 15, 2021"` |
| `lease_expiration` | 80% | **~100%** | same row, same flip |
| `tenant_name` / `leased_sf` / `lease_type` | 100 / 83 / 100 | **unchanged** | EXT1b touches neither the prompt nor those fields |

⚠️ **Two caveats on that prediction, stated because EXT1's was wrong in exactly this way.** (a) It
assumes the residue is only the rows already read; a field can disagree for a reason nobody has read
yet — the last prediction failed because it assumed the model's LABELS were as reliable as its QUOTES.
(b) `decided fields` should RISE on the date fields (431's two dates stop being both-null), so the
denominator moves and the rate is not directly comparable to run 3's without reading the counts.

Also expect **3 `docai-only` rents and 2 `docai-only` dates to close** on the tesseract side, since
those were the same mislabelling; and doc 425's dates must stay honest nulls — that is a genuine OCR
miss and turning it into a date would be a regression, not an improvement.

## 5. Guard

`test/ext1b-as-stated-authority.test.mjs`. The three named rows are fixtures; the negatives (per-SF
with no period, ambiguous window, formula-containing-a-date, no-`$` quote, impossible calendar day,
security-deposit-first) carry as much weight. Structural assertions pin that **both** dates are
reconciled (one wired and one not is the silent half-fix) and that **exactly one** `parseStatedDate`
exists.

⚠️ **It strips comments and deliberately does NOT blank string literals.** The module's own EXT1b
header quotes `"$8,796.50 per month"`, `per_sf_annual` and `March 15, 2021` at length while
explaining the fix, so a raw-source grep finds the defect present in the sentence describing its
removal (A5c / N18 / B1) — comments must go. But the source assertions here are identifier shapes
carrying no literals, so blanking literals would be inert, and a pattern that *does* contain a
literal can never match literal-blanked source and passes its own mutation (B6d-pri-reason). Choose
the stripper to fit what is being matched.
