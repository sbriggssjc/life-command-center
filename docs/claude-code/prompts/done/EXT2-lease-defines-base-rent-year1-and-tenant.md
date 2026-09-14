# EXT2 — the LEASE defines base rent, year 1 and the tenant; the extractor quotes the definition, code applies it

> **Decision recorded (Scott, 2026-09-03), then a small pure-function change + guard.** EXT1/EXT1b
> made the extractor quote instead of compute or label. The measured residue (EXT1b floor run,
> `responses/done/EXT1b-floor-measurement.response.md` §2) is the model choosing a different LINE
> for the same field — and Scott's answer is that there is no global rule: **each lease defines
> these terms itself.** So the extractor's job is to quote the lease's OWN definition beside the
> figure, and the resolver applies the lease's definition rather than a house one.

**Read first:** `api/_shared/bov-extract.js` (`leasePrompt`, `extractTenantFromLease`,
`normalizeBaseRent`, `reconcileBaseRentWithQuote`, `cleanRentPeriod`, `resolveQuotedDate`) ·
`test/ext1b-as-stated-authority.test.mjs` · `responses/done/EXT1b-floor-measurement.response.md`.

## 0. The three definitions, as decided

| question | Scott's answer | what the extractor must therefore carry |
|---|---|---|
| Does year-1 base rent exclude separately-stated equipment / additional rent? (doc 255: $7,445 base + $1,019 equipment = $8,464 total) | **It depends on what the lease calls for — it is defined in each lease.** | The lease's **defined term** for the figure (`"Base Rent"`, `"Minimum Rent"`, `"Fixed Rent"`, `"Monthly Rent"`…) and the definition sentence verbatim; every separately-stated rent component (equipment, additional rent, CAM/tax/insurance if stated as rent) as its OWN row, never summed into base. |
| Is year 1 = period 1 of the rent schedule? | **Defined in the lease; usually yes. Rent Commencement is defined in the lease.** | `rent_commencement` as its own quoted date (distinct from `lease_commencement`); year 1 = the schedule period that contains Rent Commencement, else period 1, else the single `base_rent`. Abatement / free rent is quoted beside it, not netted. |
| Is "the tenant" the registered entity with DBA / co-tenants beside? | **The tenant is the legal entity that is counterparty to the Landlord and guarantees the lease obligations. That is the CREDIT in the three-legs-of-the-stool analysis, absent a separate guaranty document. A parent of a subsidiary on the lease is NOT liable without express authorization — the credit is the subsidiary, sometimes of unknown size.** | `tenant_legal_entity` (the signatory), `tenant_dba` beside it, `co_tenants[]` (every named counterparty), `guarantor` ONLY where the lease itself contains an express guaranty (with the clause quoted), `parent_mentioned` when a parent/affiliate is named in the lease WITHOUT a guaranty, and a derived `credit_entity` = guarantor-if-express else tenant_legal_entity, with `credit_entity_basis`. |

⚠️ **None of this is an instruction to the model to DECIDE.** It quotes the definition; the code
picks. Where a lease states no definition, the fields are null and the resolver falls back to what
EXT1b already does — nothing is invented.

## 1. Build

### 1a. Prompt — quote the definition, not just the number (`leasePrompt`)

Extend the JSON contract (null everywhere the lease is silent):

```
"base_rent": { "amount", "basis", "as_stated",
               "defined_term": string|null,            // the lease's label, verbatim: "Base Rent", "Minimum Annual Rent"
               "definition_as_stated": string|null },  // the sentence that defines it, verbatim
"additional_rent": [ { "label": string, "amount": number|null, "basis": ..., "as_stated": string, "kind": "equipment"|"cam"|"tax"|"insurance"|"percentage"|"other"|null } ],
"rent_commencement": { "date", "as_stated", "precision" },   // same shape as lease_commencement; quote the defined term if any
"abatement": { "as_stated": string|null },                    // free rent / abated period, verbatim; never netted
"tenant_legal_entity": string|null,   // the party defined as "Tenant"/"Lessee", exactly as written incl. entity suffix
"tenant_dba": string|null,
"co_tenants": [ string ],             // every additional party named as Tenant/Lessee
"guarantor": string|null,             // ONLY if the lease itself contains a guaranty; else null
"guaranty_as_stated": string|null,    // the guaranty clause, verbatim
"parent_mentioned": string|null       // a parent/affiliate NAMED in the lease that is NOT a guarantor
```

Prompt rules to add, in the same register as EXT1's: *"BASE RENT is whatever the lease DEFINES as
its base/minimum/fixed rent — copy the lease's own label into `defined_term`. Any rent stated
separately (equipment rent, additional rent, CAM, taxes) goes in `additional_rent`, never added
into `base_rent`. Do NOT sum. TENANT is the party the lease defines as Tenant/Lessee; a DBA goes
in `tenant_dba`; a parent company mentioned but not signing a guaranty goes in `parent_mentioned`
and is NOT the tenant and NOT the guarantor."* Keep `tenant_name` in the contract for one release
as an alias of `tenant_legal_entity` (a test pins that they agree when both present).

### 1b. Resolver — `resolveYear1Rent(parsed)` in code, single owner

- `year1_rent` = annualized `base_rent` (EXT1b path) **unless** a `rent_schedule` exists, in which
  case the period whose `[start_date, end_date]` contains `rent_commencement.date`, else
  `rent_schedule[0]`. Record `year1_rent_source: 'schedule_at_rent_commencement' |
  'schedule_period_1' | 'base_rent'`.
- `year1_total_rent` = `year1_rent` + annualized `additional_rent[]` where `kind ∈ {equipment,
  other}` **only when each component has a numeric amount** — reported as a SEPARATE field for the
  BOV, never written into `year1_rent`. If any component is non-numeric, `year1_total_rent` is
  null and `year1_total_rent_note` says which.
- `credit_entity` = `guarantor` if `guaranty_as_stated` is non-null, else `tenant_legal_entity`;
  `credit_entity_basis: 'express_guaranty' | 'tenant_is_counterparty'`. `parent_mentioned` is
  carried through untouched and NEVER promoted to either field.
- Abatement never changes `year1_rent`; it rides `abatement.as_stated` to the abstract.

### 1c. Guard — `test/ext2-lease-defines-rent-and-tenant.test.mjs`

Named rows from the floor run, as fixtures (text only, values-free in `responses/`):
- **255-shape:** base $7,445/mo with `defined_term: "Base Rent"` + equipment $1,019/mo →
  `year1_rent = 89,340`, `year1_total_rent = 101,568`, sources recorded. A mutation that sums into
  base must go RED.
- **299-shape:** two schedule periods + `rent_commencement` inside period 1 → period 1 chosen;
  with `rent_commencement` null → period 1 by fallback and `year1_rent_source: 'schedule_period_1'`.
- **431-shape:** an individual + two entities as co-tenants → `tenant_legal_entity` = the first
  defined Tenant, `co_tenants` = the rest, `credit_entity_basis: 'tenant_is_counterparty'`.
- **425-shape:** DBA → `tenant_dba`, never in `tenant_legal_entity`.
- **Parent-not-guarantor:** `parent_mentioned` set, `guarantor` null → `credit_entity` = tenant;
  a mutation promoting the parent goes RED.
- Comments AND string literals stripped before any source assertion (OCR1c order: comments first).
- Mutation-verify every assertion; report the RED count.

## 2. Verify

Re-run the floor (Scott, on the workstation): `node scripts/ocr-bakeoff.mjs --run --model real
--control self --engines tesseract`. Read `year1_rent` decided counts and the NEW
`year1_rent_source` / `credit_entity_basis` distributions across the 10 docs. Expect doc 255's two
sides to agree on `year1_rent` (both now read the lease's "Base Rent" label) and to carry the
equipment component in `additional_rent`. Doc 299's residue should collapse to
`schedule_at_rent_commencement` on both sides if the lease states rent commencement; if it does
not, both sides read `schedule_period_1` — **that agreement is the check.** Spot-check for Scott:
doc 255 is `PROPERTIES\C\Chesterbrook Academy\Champaign, IL\Rec'd\Chesterbrook - Champaign, IL
(Lease).pdf` (25 pp).

## 3. Discipline

Pure functions, one owner per decision (`resolveYear1Rent`, `resolveCreditEntity`), no second
date/basis parser (reuse `parseStatedDate` / `basisFromAsStated` / `amountFromAsStated`), nothing
fabricated, no DB change. Record: `responses/EXT2-lease-defines-rent-and-tenant.response.md`
(values-free), and one line in `docs/architecture/ai-and-ocr-cost-strategy.md`'s EXT status.
