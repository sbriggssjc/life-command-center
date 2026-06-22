# Work-product self-improvement structure (2026-06-22)

> Scott's directive: a structure that **adds to what we produce on an ongoing basis as new patterns
> emerge while we work.** This is the living loop that keeps the master-sheet / BOV / OM standard
> growing — so every deal we touch makes the next one better and more standardized.

## The three artifacts (the "library")
1. **`UNIVERSAL_MASTER_SHEET_STRUCTURE.md`** — the canonical structure + standard field dictionary
   + deal-type extensions. The authoritative "what every sheet looks like."
2. **`FILE_HYGIENE_CONVENTIONS.md`** — naming/versioning/archival rules.
3. **`PATTERN_LOG.md`** (the running ledger, below) — every new pattern/field/rule/error-class
   discovered on a live deal, dated, with the source property. Append-only.

## The capture protocol (run on EVERY work-product deliverable)
After producing or correcting any master sheet / BOV / OM, do a 60-second **pattern pass** and ask:
1. **New field?** Did the client/marketing want a field not in the dictionary? → add it to the
   dictionary (UNIVERSAL_MASTER_SHEET_STRUCTURE §field dictionary) + log it.
2. **New deal-type extension?** A new asset class or structure (industrial, ground lease, sale-
   leaseback, portfolio)? → add an extension row + log it.
3. **New format/standardization rule?** An ambiguity we resolved a standard way (e.g. the escalation
   month-vs-annual fix)? → add to §Conventions + log it.
4. **New reconciliation/error class?** A recurring data error + how to resolve it (e.g. the lease
   date-typo-vs-term-length rule)? → add to §Conventions + log it.
5. **Branding/layout refinement?** → update the brand layer (cm_brand_tokens) + log it.
If nothing new: note "no new pattern" — the absence is also signal (the standard is stabilizing).

## Promotion rule
- A pattern seen **once** → logged in PATTERN_LOG (candidate).
- A pattern seen **twice across different properties** → promoted into the canonical structure /
  dictionary / conventions (it's now standard), and into the **generator** (so it's automatic).
- Anything **a client/marketing explicitly asks for** → promote immediately (don't wait for a second
  sighting); Sarah's "ownership interest" + "escalation format" are examples.

## Feedback into the generator
When a pattern is promoted, it updates the universal-master-sheet **generator spec** so the next
auto-produced sheet already includes it. The generator reads the dictionary + extensions, so the
library IS the generator's configuration — improving the docs improves the output.

---
# PATTERN_LOG (append-only; newest first)

### 2026-06-22 — Valley MOB — production-quality pass (Northridge style system integrated)
- **Design standard (promoted):** adopted a **role-based cell-style system** from the Northridge -
  Grand Prairie reference — every cell styled by ROLE (section header / sub-section / column header /
  total / label / value / input / note), applied uniformly. Locked palette = "navy + Northridge
  restraint" (Scott): bold-navy section headers (no fill), navy `#003DA5` column-headers + title,
  pale-blue `#E0E8F4` totals, **peach `#FFF2CC` input cells** for editable assumptions, gold renewal
  rents. → new "Role-based cell-style system" section in UNIVERSAL_MASTER_SHEET_STRUCTURE.
- **Pro Forma order (promoted, was incomplete):** the canonical ladder is REVENUE → EXPENSES → NOI →
  **Cash Investment Outcomes** (unlevered returns) → **Cash Flow After Debt Service** → **Leveraged
  Investment Outcomes** → Acquisition/Financing/Disposition **assumptions at the bottom** (peach),
  Amort feeding debt service via SUMIFS. The prior Valley rebuild stopped at NOI+valuation and was
  missing the two returns ladders. → structure spec.
- **Consistency rules (promoted):** ALL-CAPS major sections + bottom-line totals; Title Case
  sub-sections; bold only on headers/totals/key metrics; anchor every section to column B so titles
  align with their columns (fixes the "columns don't align with section titles" defect).
- **Verified:** unlevered IRR 9.48% / 2.03x equity multiple, levered IRR 13.67% / 2.86x (ties the
  prior Valley analysis); 0 formula errors; peach inputs + navy headers consistent; reference
  generator persisted at `docs/capital-markets/master_sheet_reference_build.py`.

### 2026-06-22 — Valley MOB — full canonical rebuild (verified against a live comp)
- **Reference implementation (promoted):** grounded the canonical structure against a live comp —
  `DaVita Anchored - Danville, IL (Master Sheet).xlsx` (multi-tenant MOB, Valley's twin) + its OM
  (`DaVitaMT_Danville_IL_OM_SB.pdf`). Confirmed the **5-sheet order: Terms → Rent → Rent Roll →
  Pro Forma → Amort** (Rent Roll is its own sheet for multi-tenant). Rebuilt Valley to this exactly,
  formula-driven, Northmarq-branded; verified in LibreOffice (0 formula errors; NOI $103,841 ties
  Pro Forma↔Rent Roll; Ask 7.75% → $1.34M; WALT 2.88 yr; amort pays down correctly).
- **Confirmed: the Terms Exec Summary == the OM Executive Summary** (identical field set + hero
  Offering Price / Cap / NOI). So one Terms block feeds both the BOV and the OM. → structure spec.
- **Pricing matrix (promoted):** Terms carries the proposal — **Ask** (one cap) + **Trade range**
  (2 wider caps), every cell `= in-place NOI ÷ cap`, $/SF `= price ÷ RBA`. Mirrors the OM hero band.
- **Pro Forma section ladder (promoted, the canonical order):** Revenue (per tenant) → Vacancy →
  EGI → Expenses (Taxes/Ins/CAM/Lawn/HVAC/R&M) → NOI → Valuation Matrix → Cash Investment Outcomes
  (unlevered: equity, cap rate, equity-multiple, IRR) → Cash Flow After Debt Service → Leveraged
  Outcomes (cash-on-cash, total return, IRR) → Acquisition/Financing/Disposition Assumptions →
  Amort schedule (PMT-driven). → structure spec.
- **Lease Abstract = per-tenant COLUMNS** (one column per tenant on Terms), occupancy/$ figures
  formula-driven off SF + Rent Roll. → structure spec.
- **Build artifact:** `docs/capital-markets/master_sheet_reference_build.py` is the reference generator for this structure —
  hand it to the PR #7313 generator as the worked example.

### 2026-06-22 — Valley MOB — branding refinement (client-flagged)
- **Branding/layout refinement (promoted):** the early-AI Valley sheet was off-brand — **Arial**
  font, generic dark-blue header `1F3864`, **purple** flags header `7B2D8B`, **red-on-yellow** alarm
  cells. Re-branded to the Northmarq tokens: Calibri throughout, NM Navy `#003DA5` headers (white
  bold), clean white/`191919` body, no alarm styling. → added an explicit **Branding spec** section
  to UNIVERSAL_MASTER_SHEET_STRUCTURE; the generator (PR #7313) must emit this palette and offer a
  re-brand path for early-AI sheets. Rule: **never Arial / no `1F3864` / no purple / no red-yellow**
  in a client-facing sheet.

### 2026-06-22 — Valley MOB (Multi/Valley MOB - Roanoke, AL) — first structured pass
- **Field (promoted):** `Ownership Interest` is mandatory + field #1 — confirmed standard across
  every sampled sheet; marketing flagged its absence. → in dictionary.
- **Field (promoted):** `Encumbrances` ("Free & Clear" / describe) — standard in the canonical Terms
  exec summary; was missing on Valley. → in dictionary.
- **Field (candidate):** `Building Unit Addresses` (range when a parcel spans suites, e.g.
  205/207/209) — seen on Valley; watch for a second sighting. → candidate.
- **Format rule (promoted):** escalation = "monthly step → annual increase (≈%)", never
  "+$50/yr ($600/yr)" (month/annual conflation). → §Conventions.
- **Reconciliation rule (promoted):** lease term-paragraph date that contradicts the 60-mo term +
  rent schedule = scrivener typo; term-length + schedule win; flag + estoppel. (Seen twice on Valley
  alone: Slavich 2028→2029, Enhabit Apr20→Apr30.) → §Conventions.
- **Structure finding (promoted):** canonical workbook = `Terms`(REAL ESTATE/LEASE ABSTRACT/EXEC
  SUMMARY+pricing) → `Rent` → `Pro Forma` → `Amort`, **formula-driven**. Early-AI sheets (Property
  Summary/Lease Abstract/Rent Schedule/Expenses/10-Yr) diverge → migrate to canonical. → structure spec.
- **File hygiene (promoted):** one dated master sheet in base, prior versions in `Old/`, no
  CORRECTED/PRIOR in names. → FILE_HYGIENE_CONVENTIONS.
- **Deal-type (logged):** multi-tenant MOB exercises the Rent Roll + per-tenant abstract + modified-
  gross utility-reimbursement patterns the single-tenant template doesn't.
