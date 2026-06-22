# Universal Master-Sheet Structure — the Briggs/Northmarq standard (2026-06-22)

> Derived by sampling the team's actual master sheets across asset types (CVS, Walgreens, Kohl's,
> State Bank, Northridge, Fresenius, Valley) in the PROPERTIES folders. This is the **canonical
> structure every master sheet conforms to** — one layout, one field dictionary, deal-type
> extensions on top. It feeds both the OM and the BOV. The early-AI Valley sheet diverged from this;
> new sheets and the generator follow it.

## The canonical workbook (the "Terms" template)
**Core sheets (every deal):** `Terms` → `Rent` → `Pro Forma` → `Amort` (multi-tenant inserts a
`Rent Roll` sheet between `Rent` and `Pro Forma` → **`Terms` → `Rent` → `Rent Roll` → `Pro Forma` →
`Amort`**). **Verified reference implementation (2026-06-22):** `DaVita Anchored - Danville, IL
(Master Sheet).xlsx` (live comp) and `docs/capital-markets/master_sheet_reference_build.py` (the Valley rebuild). The Terms
Exec Summary section is identical to the OM's Executive Summary (same fields + hero Offering Price /
Cap / NOI), so one block feeds both BOV and OM.
Everything is **formula-driven** (live calcs + cross-sheet references), NOT hardcoded — this is the
single biggest difference from the early Valley sheet.

### Sheet 1 — `Terms` (three stacked sections)
**§ REAL ESTATE**
Ownership Interest · Parcel ID/APN · (Project/Park Name) · Address · City · County · State · Zip ·
Land (Acres) · **Land (SF) =Acres×43560** · Built · (Renovated) · Rentable SF · (Floors ·
Construction · Bldg/Ceiling Height · Frontage · Zoning · Use-specific: Stations/Hours for medical,
etc.) · Parking Spaces · **Parking Ratio =Spaces/(SF/1000)** · Use.

**§ LEASE ABSTRACT**
Tenant · (Store/Unit #) · Guarantor · Guaranty Type (Corporate/Personal/Franchisee) · Credit (S&P /
Moody's) · Occupancy · Use · **Interest =§RE Ownership Interest** · Lease Structure (Absolute NNN /
NNN / NN / Modified Gross / Gross) · **NNN responsibility breakout: Taxes · Insurance · CAM ·
Maintenance & Repair · (Roof · HVAC · Parking · Structure)** each = Tenant/Landlord · Commencement ·
Expiration · **Initial Term =(Exp−Com)/365** · **Term Remaining =(Exp−NOW())/365** · Option
Increases (escalations) · Renewal Options · **Annual Rent =Rent!<cell>** · **$/RSF =AnnualRent/SF** ·
ROFR/ROFO.

**§ EXECUTIVE SUMMARY (with pricing)**
Recap of tenant/credit/interest/encumbrances/term + **Pricing matrix, all = Annual Rent ÷ Cap Rate**:
Ask Price · Ask Cap · Ask PPSF; Trade Price/Cap/PPSF at 2–3 scenarios. (Encumbrances: "Free & Clear"
/ describe.)

### Sheet 2 — `Rent`
Year-by-year rent schedule across the base term + option periods (monthly, annual, $/SF), the source
of `Terms!Annual Rent`. Blue fill = contracted; gold = option/renewal assumption.

### Sheet 3 — `Pro Forma`
Revenue → Vacancy/Credit Loss → EGI → Expenses → NOI → Valuation matrix → (leveraged) Cash-flow /
returns. Single-tenant NNN is light; multi-tenant/value-add is fuller.

### Sheet 4 — `Amort`
Debt amortization schedule (feeds leveraged returns).

## Deal-type extensions (added ON the canonical core, never a separate template)
| Deal type | Add |
|---|---|
| **Single-tenant NNN** (CVS/Walgreens/Kohl's/Walmart/State Bank/Fresenius/DaVita) | nothing — the core IS this |
| **Multi-tenant** (Valley/Northridge) | `Rent Roll` sheet (per-tenant) · `Historical/OPEX Expenses` sheet · VACANT SPACE block on Terms · per-tenant lease-abstract columns |
| **Government / GSA** | `GSA Rent` sheet · agency/lease-number fields · base-year tax stop |
| **Dialysis** | Stations · operating hours · CMS/patient context (the dia exhibit set) |
| **Value-add / redevelopment** (Kohl's) | `Executive Summary` sheet · `REA & Zoning` · `OPEX History` · `Budget` · redevelopment/ground-lease/excess-land schedules · `Debt and Exit Plan` |

## The standard field dictionary (the "always include" set)
Every master sheet, regardless of asset type, carries these — the early Valley sheet was missing the
**bolded** ones, which is why marketing flagged it:
Ownership Interest · **Encumbrances** · Parcel/APN · full Address · County · Land (Acres + SF) · Year
Built (+Renovated) · Rentable SF · Zoning · Parking (spaces + ratio) · Use · Tenant · **Guarantor +
Guaranty Type** · **Credit rating (S&P/Moody's)** · Lease Structure · **NNN responsibility breakout
(Taxes/Ins/CAM/R&M)** · Commencement · Expiration · Initial Term · Term Remaining · Escalations
(standardized: monthly step → annual % ) · Renewal Options · ROFR/ROFO · Annual Rent · $/RSF · Pricing
(Ask/Trade × cap).

## Role-based cell-style system (the design standard — from the Northridge reference, 2026-06-22)
Quality comes from styling every cell by its ROLE, applied uniformly — not ad-hoc color/bold. The
locked standard (Scott, "navy + Northridge restraint"):

| Role | Style |
|---|---|
| **Title bar** (rows 1–2) | NM Navy `#003DA5` fill, white Calibri Light 15 / Calibri 10 |
| **Section header** (REAL ESTATE, LEASE ABSTRACT, EXECUTIVE SUMMARY, REVENUE:, EXPENSES:, NET OPERATING INCOME:) | **Bold navy text, NO fill**, ALL-CAPS, navy bottom-border across the content width |
| **Sub-section** (Cash Investment Outcomes, Leveraged Investment Outcomes, Acquisition/Financing/Disposition Assumptions, Cash Flow After Debt Service) | Bold navy text, Title Case, no fill |
| **Column header** (table head rows: Rent Roll, Rent, Pro Forma year row, Amort, the Lease-Abstract tenant row) | **Navy `#003DA5` fill, white bold, centered**, thin border |
| **Total / subtotal row** (Scheduled Base Rent, Gross Revenue, Total Operating Expenses, NET OPERATING INCOME, TOTAL, Total Debt Service) | **Pale-blue `#E0E8F4` fill, bold navy text** |
| **Field label** | Calibri 9–10, muted `#666666`, left |
| **Value** | Calibri 9–10, `#191919`; right (numbers) / left (text) |
| **Input / assumption cell** (editable: cap rates, growth %, LTV, interest, exit cap, ask price) | **Peach `#FFF2CC` fill** — signals "editable input" |
| **Renewal-period rent** | Gold `#FCEFC8` fill |
| **Note / footnote** | Calibri 8, italic, muted |

Consistency rules: ALL-CAPS for major sections + bottom-line totals; Title Case for sub-sections;
bold ONLY on section headers, totals, and key metrics (NOI, IRR, equity multiple, pricing). Anchor
every section to the same left column (labels in B, values in C+) so titles align with their columns.
Reference implementation: `docs/capital-markets/master_sheet_reference_build.py`; live comp: Northridge - Grand Prairie, TX.

## Pro Forma section order (canonical, from Northridge — top to bottom)
**REVENUE:** (per-tenant rows → Scheduled Base Rent → Vacancy & Credit Loss → Gross Revenue) →
**EXPENSES:** (line items → Total Operating Expenses → Capital Reserves) → **NET OPERATING INCOME:**
→ RENTAL INCREASES: → **Cash Investment Outcomes** (Equity, Disposition, Net Cash Flows, Cap Rate,
Cumulative Return, Average Cap Rate, Equity Realization Multiple, IRR — unleveraged) → **Cash Flow
After Debt Service** (Principal, Interest, Total Debt Service, CFADS, Cumulative Equity Build-Up,
Leverage) → **Leveraged Investment Outcomes** (Equity, Disposition, Net Cash Flow, Cash-on-Cash,
Cumulative Return, Avg CoC, Equity Multiple, IRR) → **Acquisition / Financing / Disposition
Assumptions** (at the bottom, peach inputs) → Amort schedule feeds debt service via SUMIFS.

## Branding spec — exact tokens (apply on every sheet; the generator must enforce)
The early-AI Valley sheet was off-brand (Arial; a generic dark blue `1F3864`; a **purple** flags
header `7B2D8B`; **red-on-yellow** alarm cells). The Northmarq standard, from
`public/reports/cm_brand_tokens.json`:
- **Font:** Calibri everywhere (Calibri Light/600 acceptable for titles). **Never Arial** in a
  client-facing sheet.
- **Section/title headers:** fill **NM Navy `#003DA5`**, white **bold** Calibri. (Replace any
  `1F3864`/`001159`/`7B2D8B`/other dark or accent header fill with `003DA5`.)
- **Body:** `#191919` Calibri on white; optional zebra = NM Pale `#E0E8F4`. Light accents
  (sky `#62B5E5`) for contracted-rent emphasis only.
- **No alarm styling.** Internal QA/verification cells use clean Calibri on white — never
  red-on-yellow or purple. (Status is conveyed by the ✓/OPEN text, not by garish fills.)
- **Re-brand path:** to migrate an early-AI sheet, remap fonts→Calibri and the fill/color palette to
  the tokens above (a pure restyle that preserves all data + formulas). Applied to Valley 2026-06-22.

## Conventions (apply on every sheet)
- **Formula-driven** (land SF, parking ratio, term remaining, pricing, cross-sheet rent) — not
  hardcoded.
- **Escalation format:** "monthly step → annual increase (≈%)", never the "+$50/yr ($600/yr)"
  month/annual conflation (Valley fix).
- **Date-reconciliation rule:** when a lease's term paragraph contradicts its 60-month term + rent
  schedule, the term-length + schedule win; flag the typo + recommend an estoppel (Valley fix).
- **Building unit addresses:** when a parcel spans multiple suite addresses (e.g., 205/207/209),
  state the range as a property note.
- **Northmarq branding** + the file-hygiene naming (see FILE_HYGIENE_CONVENTIONS.md): one dated
  master sheet in the base, prior versions in `Old/`.
