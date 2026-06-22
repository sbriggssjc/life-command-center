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
