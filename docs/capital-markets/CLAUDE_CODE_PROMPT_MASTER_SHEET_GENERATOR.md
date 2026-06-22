# Claude Code prompt — universal master-sheet generator (build to the standard)

> Implements `UNIVERSAL_MASTER_SHEET_STRUCTURE.md` as a reusable generator so every master sheet is
> produced to the one canonical, formula-driven, Northmarq-branded standard — any asset class, not a
> dia/gov retrofit. Reads the structure spec + field dictionary + deal-type extensions as its config
> (so the self-improvement library IS the generator's configuration). Receipts-first; reuse the
> work-product framework's brand layer.

> **Reference implementation (build to this):** `docs/capital-markets/master_sheet_reference_build.py`
> is the worked, LibreOffice-verified generator for the Valley MOB (multi-tenant) deal — it encodes
> the exact 5-sheet structure, the role-based style system, the full Pro Forma returns ladder, and the
> cross-sheet formula graph. Port its patterns into `master_sheet.py`; don't re-derive them.

## Build
1. **`master_sheet.py` engine** (extend the work-product `work_product_base`): produces the canonical
   workbook — **`Terms` → `Rent` → `Rent Roll` (multi-tenant) → `Pro Forma` → `Amort`** —
   **formula-driven** (land SF =Acres×43560, parking ratio, term remaining =(Exp−NOW)/365, $/RSF,
   Ask/Trade pricing =NOI÷cap, cross-sheet refs to Rent Roll / Pro Forma). NOT hardcoded values.
   - `Terms` = REAL ESTATE / LEASE ABSTRACT (per-tenant columns) / EXECUTIVE SUMMARY + pricing
     (Ask price as a peach input; In-Place & Stabilized caps + trade range derived).
   - `Pro Forma` follows the **canonical ladder** (see UNIVERSAL_MASTER_SHEET_STRUCTURE §Pro Forma
     section order): REVENUE → EXPENSES → NOI → Cash Investment Outcomes (unlevered IRR / equity
     multiple / cap-rate) → Cash Flow After Debt Service → Leveraged Investment Outcomes → Acq /
     Financing / Disposition assumptions at the bottom; Amort feeds debt service via SUMIFS.
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

## Styling (HARD requirement — see UNIVERSAL_MASTER_SHEET_STRUCTURE §Role-based cell-style system)
Style every cell by its **role**, applied uniformly (this is where production quality comes from):
- **Calibri / Calibri Light only** (never Arial).
- **Section headers** = bold navy `#003DA5` text, no fill, ALL-CAPS, navy bottom-border.
- **Column headers** (table heads) + **title bar** = navy `#003DA5` fill, white bold.
- **Total rows** = pale-blue `#E0E8F4` fill, bold navy.
- **Input/assumption cells** = peach `#FFF2CC` fill (cap rates, growth, LTV, rate, exit cap, ask price).
- **Renewal rents** = gold `#FCEFC8`. **No** alarm styling (no red-on-yellow / purple).
- Anchor every section to column B so titles align with their columns.
Provide a **re-brand pass** that restyles an early-AI sheet to this system preserving all data +
formulas (the Valley 2026-06-22 rebuild — `master_sheet_reference_build.py` — is the reference).

## Gate
- Generates a clean canonical master sheet for a single-tenant NNN sample AND a multi-tenant sample
  (rent roll + per-tenant abstract), with the **full Pro Forma returns ladder** (unlevered + levered
  IRR / equity multiple / cap-rate / cash-on-cash) computing. Verify by recalculating in LibreOffice:
  **0 formula errors**, NOI ties Rent Roll↔Pro Forma, and the returns are sane (e.g. Valley: unlev
  IRR 9.5% / 2.0× multiple, lev IRR 13.7% / 2.9×). Role-based styling consistent (peach inputs, navy
  headers/totals, no Arial). Missing data flagged, not blank. File written per the hygiene convention.
- Then: regenerate the Valley MOB sheet and diff it against
  `docs/capital-markets/master_sheet_reference_build.py` output — should match structure, styling, and
  the verified return metrics.

## Boundaries
Reuse the brand layer + `briggs-comps`/`bov-underwriting` where they overlap; don't fork. The spec
docs are the source of truth — the generator reads them, doesn't re-define the standard. ≤12 api/*.js
(this is Python/openpyxl in the Dialysis repo work-product modules, not an api endpoint).
