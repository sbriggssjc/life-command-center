# Universal Master-Sheet Structure — the Briggs/Northmarq standard (2026-06-22)

> Derived by sampling the team's actual master sheets across asset types (CVS, Walgreens, Kohl's,
> State Bank, Northridge, Fresenius, Valley) in the PROPERTIES folders. This is the **canonical
> structure every master sheet conforms to** — one layout, one field dictionary, deal-type
> extensions on top. It feeds both the OM and the BOV. The early-AI Valley sheet diverged from this;
> new sheets and the generator follow it.

## The canonical workbook (the "Terms" template)
**Core sheets (every deal):** `Terms` → `Rent` → `Pro Forma` → `Amort`.
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
