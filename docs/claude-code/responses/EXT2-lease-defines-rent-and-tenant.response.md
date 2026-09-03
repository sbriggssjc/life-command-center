# EXT2 — the LEASE defines base rent, year 1 and the tenant; the extractor quotes the definition, code applies it

**Built 2026-09-03. Values-free.** `api/_shared/bov-extract.js` (prompt + four pure resolvers +
the wiring), `test/ext2-lease-defines-rent-and-tenant.test.mjs` (**32 tests, 28/28 mutations RED**).
No migration, no DB change, no new writer. Decision recorded by Scott 2026-09-03.

## 1. What changed

EXT1 stopped the model computing. EXT1b made the verbatim quote outrank the model's labels. The
floor re-run's residue was **neither**: the model chose a **different LINE** for the same field and
**both lines were verbatim from the same lease**. Scott's answer is that there is no house rule —
**each lease defines these terms itself** — so the extractor now quotes the lease's own definition
and the code applies *that*.

| | before | after |
|---|---|---|
| base rent | one `{amount, basis, as_stated}`; a separately-stated equipment/additional rent was whatever the model happened to quote | `defined_term` + `definition_as_stated` beside the figure; every separately-stated component is its OWN `additional_rent` row, and `year1_total_rent` is a **second field** |
| year 1 | annualized `base_rent`, always | the schedule period in force at **Rent Commencement** (its own quoted date), else the first **Contracted** period, else the base rent — with **`year1_rent_source`** recording which |
| the tenant | `tenant_name`, whatever the model returned | `tenant_legal_entity` / `tenant_dba` / `co_tenants[]`, and a derived **`credit_entity`** with **`credit_entity_basis`** |

Four pure functions, one owner per decision: `normalizeAdditionalRent`, `resolveYear1Rent`,
`resolveYear1TotalRent`, `resolveCreditEntity` (+ `splitDbaFromName`). No second date, basis or
amount parser — the additional-rent rows go through EXT1b's `reconcileBaseRentWithQuote` and
`annualizeRent`, asserted structurally.

## 2. The credit rule, as decided

The tenant is **the legal entity that is counterparty to the Landlord**. That is the credit in the
three-legs-of-the-stool analysis **absent an express guaranty in the lease itself**. A parent named
in the lease is *not* liable for a subsidiary's obligations without express authorization, so:

- `parent_mentioned` is carried for a reader and is **structurally unable** to become
  `credit_entity` (a guard asserts no assignment of it anywhere in the module goes RED on the
  mutation that promotes it);
- **a guarantor NAME with no quoted CLAUSE does not move the credit** — the model naming one is a
  claim, the quoted clause is the evidence, and only the evidence changes `credit_entity_basis`;
- the honest consequence is stated rather than smoothed: the credit may be a subsidiary of unknown
  size, and `credit_entity_basis: 'tenant_is_counterparty'` says exactly that.

## 3. Three things worth carrying

- **⚠️ THE PROMPT'S OWN RULES SATISFY A GREP FOR ITS SCHEMA KEYS, AND THREE ASSERTIONS PASSED THEIR
  OWN MUTATION ON THAT.** `assert.match(p, /"additional_rent"/)` is green when the field is deleted
  from the contract, because the RULES paragraph says *'row of `"additional_rent"` with its own
  quote'* while explaining it. Same for `"rent_commencement"` and `"tenant_legal_entity"`. This is
  the documented *a fix's own prose satisfies the detector* class (A5c / N18 / B1) arriving inside a
  **prompt** rather than a source comment — and comment-stripping cannot help, because the prose is
  the deliverable. The assertions anchor on the **schema line** (`\n\s*"additional_rent": \[`) or on
  `": string"` for a sub-key inside a one-line shape; prose can carry neither. **Found by the
  mutation pass, not by reading the test.**
- **⚠️ TWO MUTATIONS MUTATED INTO NO-OPS AND READ AS SURVIVORS.** Widening the DBA marker set with
  `|,` left the leading `\s+` in place, so it could never match `Acme Health Services, LLC`; and the
  "net the abatement out" mutant added a dead property instead of touching `year1_rent`. Both were
  green results that prove nothing. Replaced with mutants that actually infer a trade name and
  actually reduce the rent — both RED. *A mutation that mutates into a no-op is not a failed control,
  but you have to notice which kind you wrote* (N15c).
- **The pass is what found every hole. 7 of the first 25 mutants survived**: 6 were real holes in
  4 classes — the schedule-vs-base ORDERING was never exercised (no fixture had both), a DBA arriving
  *inside* the legal-entity string was never exercised, the `kind` vocabulary was never asserted
  closed, and the three prompt-key assertions were satisfied by the prompt's own prose — and 1 was a
  bad mutant. Reading the tests had not surfaced any of them.
- **⚠️ AN EXISTING EXT1b ASSERTION WAS A COUNT AND EXT2 SUPERSEDED IT.**
  `test/ext1b-as-stated-authority.test.mjs` asserted **exactly 2** wirings of
  `reconcileQuotedDateWithQuote(resolveQuotedDate(`; `rent_commencement` is a third quoted date, so
  a correct change turned it red. The substance was never the count — it is that *every* quoted date
  is reconciled — so it now asserts that **per named date**. Left as a count it would have described
  code nobody runs (P197).

## 4. What is NOT done, and the risk that remains

- **The ordering is the decision, and it has a named residual risk.** With both a `base_rent` quote
  and a schedule, **the schedule decides** — that is the fixture, and it is what makes doc 299
  converge. It also means that if a lease's schedule states the **blended** figure (base + equipment)
  in period 1 while `base_rent` quotes the base alone, the blended figure wins. Nothing measured says
  that happens; if the re-run shows doc 255 reading `schedule_*` rather than `base_rent`, that is the
  row to read.
- **No abatement arithmetic.** Free rent is quoted (`abatement.as_stated`) and never netted out.
- **Pass-throughs are excluded from `year1_total_rent`** (CAM / tax / insurance are reimbursements,
  percentage rent is contingent) — they are still reported on the row. That is a judgement, stated
  here so it can be argued with rather than discovered.
- **`year1_total_rent`'s null is always explained** (`no_additional_rent_stated` /
  `year1_rent_unresolved` / `unresolved_component:<label>`), because a bare null wearing three facts
  is the P180 failure.
- **`rent_basis_unresolved` still describes the QUOTED BASE RENT, not `year1_rent`** — a schedule can
  state a year-1 figure over a base-rent quote we could not convert. `year1_rent_source` is what says
  where the number came from. Read that, not the flag.

## 5. Verify (workstation — the sandbox has no lease corpus and no OCR engines)

```
node scripts/ocr-bakeoff.mjs --run --model real --control self --engines tesseract
```

Then read, across the 10 arm-A docs:

- `year1_rent` **decided** counts and agreement (not the rate alone — one document moves a
  10-doc rate by a tenth);
- the NEW `year1_rent_source` distribution and `credit_entity_basis` distribution. **These ride on
  the tenant object inside `bakeoff/agreement.json`** (`documents[].baseline.tenant` /
  `.control.tenant` / `.candidates[].tenant`) — the harness carries the whole tenant through
  untouched, so no bake-off change was needed; `agreement.md` renders only the six graded fields.
  `jq '.documents[] | {id: .document_id, base: .baseline.tenant.year1_rent_source, ctrl: .control.tenant.year1_rent_source, credit: .baseline.tenant.credit_entity_basis}' bakeoff/agreement.json`

**What would count as the fix working:** doc 255's two sides agree on `year1_rent` (both reading the
lease's own "Base Rent") with the equipment figure present in `additional_rent` and the $101,568
total in `year1_total_rent`; doc 299's two sides agree, both naming the **same**
`year1_rent_source`. **The agreement on the SOURCE is the check** — if the lease states no Rent
Commencement, both sides reading `schedule_period_1` is the right answer, not a shortfall.

**Spot-check document for Scott:** doc 255 is
`PROPERTIES\C\Chesterbrook Academy\Champaign, IL\Rec'd\Chesterbrook - Champaign, IL (Lease).pdf`
(25 pp).

⚠️ **A prediction, and what it rests on.** EXT1 predicted ~100% and missed *because it assumed the
labels would be as reliable as the quotes*. This one rests on having read the residue rows: the two
rent disagreements are line-selection and both lines are now separately representable. It can still
move for a reason nobody has read yet — and **the denominator moves too**: a row that was
`both_null` becoming decided changes the base the rate is computed on, so read the counts beside
the rate.
