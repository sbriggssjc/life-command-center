# Claude Code prompt — universal master-sheet generator (build to the standard)

> Implements `UNIVERSAL_MASTER_SHEET_STRUCTURE.md` as a reusable generator so every master sheet is
> produced to the one canonical, formula-driven, Northmarq-branded standard — any asset class, not a
> dia/gov retrofit. Reads the structure spec + field dictionary + deal-type extensions as its config
> (so the self-improvement library IS the generator's configuration). Receipts-first; reuse the
> work-product framework's brand layer.

## Build
1. **`master_sheet.py` engine** (extend the work-product `work_product_base`): produces the canonical
   workbook — `Terms` (REAL ESTATE / LEASE ABSTRACT / EXECUTIVE SUMMARY+pricing) → `Rent` →
   `Pro Forma` → `Amort` — **formula-driven** (land SF =Acres×43560, parking ratio, Initial/Remaining
   term =(Exp−Com or NOW)/365, $/RSF, Ask/Trade pricing =AnnualRent÷Cap, cross-sheet `Rent!` refs).
   NOT hardcoded values.
2. **Config-driven from the spec:** the field dictionary (the "always include" set incl. Ownership
   Interest, Encumbrances, Guaranty Type, Credit, the NNN responsibility breakout) + the deal-type
   extension table (single-tenant = core; multi-tenant adds Rent Roll + Historical Expenses + VACANT
   block; GSA adds GSA Rent + base-year tax; dialysis adds stations/CMS; value-add adds Exec Summary/
   REA/redevelopment sheets). `deal_type` parameter selects extensions; unknown asset classes still
   get the core + flagged gaps.
3. **Data wiring (the #34 pattern):** populate sections from the LCC data layer
   (`assemblePropertyPacket` / domain DBs) where present; **explicitly FLAG missing fields**
   ("needs CoStar / confirm") rather than ship blanks. Per-deal CoStar capture fills the rest.
4. **Conventions baked in:** escalation "monthly step → annual %" format; the date-typo-vs-term
   reconciliation note; building-unit-address range note; Northmarq branding; the file-hygiene
   output (one dated master sheet in the base, prior → `Old/`, date-named, no CORRECTED/PRIOR).
5. **Self-improvement hook:** a comment/registry pointing the engine's field set + extensions at the
   spec docs, so when `PATTERN_LOG` promotes a pattern, the generator picks it up (one place to
   change).

## Gate
- Generates a clean canonical master sheet for a single-tenant NNN sample (formulas calc, pricing
  matrix, branding) AND a multi-tenant sample (rent roll + per-tenant abstract). Missing data fields
  are flagged, not blank. File written per the hygiene convention. Re-running migrates an early-AI
  sheet (Valley-style) into the canonical structure preserving its verified data.
- Then: regenerate the Valley MOB sheet to the canonical structure as the proof (it currently uses
  the divergent early-AI layout) — preserving the corrected data + the resolved flags.

## Boundaries
Reuse the brand layer + `briggs-comps`/`bov-underwriting` where they overlap; don't fork. The spec
docs are the source of truth — the generator reads them, doesn't re-define the standard. ≤12 api/*.js
(this is Python/openpyxl in the Dialysis repo work-product modules, not an api endpoint).
