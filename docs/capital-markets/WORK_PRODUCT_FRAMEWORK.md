# Briggs / Northmarq Work-Product Framework (foundational, 2026-06-20)

> Scott's directive: one **unified, standardized work product per request type** — sales-comps
> request, lease-comps request, buyer showings, OM master sheet, BOV — all sharing the **same
> Northmarq branding and a common layout grammar** so they "look substantially similar," with
> per-type adjustments refined later as we work through topics. This sets the foundation:
> a single brand source, a shared layout skeleton every deliverable inherits, the five type
> specs, and the build plan. Grounded in what already exists — this unifies, it doesn't reinvent.

## What already exists (grounded 2026-06-20)
- **Brand source of truth:** `public/reports/cm_brand_tokens.json` (Northmarq Capital Markets,
  reverse-engineered from the canonical gov master workbook). Colors, fonts, type scale, number
  formats, chart layout. **This is the single brand layer for ALL five work products.**
- **Python brand module:** `DialysisProject/src/branding.py` + mirror in GovernmentProject; spec
  `docs/brand/NORTHMARQ_BRAND.md`. Excel/PDF/chart helpers.
- **Sales comps + Lease comps:** `briggs-comps` skill — populated Excel templates with
  formula-protected columns (RENT/SF, CAP RATE, TERM, DOM, PRICE/SF, EFFECTIVE RENT/SF — NEVER
  overwrite).
- **BOV:** `bov-underwriting` skill — 3-sheet workbook (Pro Forma / Lease Abstract / Assumptions
  & Flags), fill conventions (blue=contracted, gold=projection), 3 return metrics.
- **Missing / to build:** Buyer Showings template, OM Master Sheet template, and the SHARED
  layout grammar that makes all five visually consistent.

## 1 — Single brand layer (all five inherit, no exceptions)
From `cm_brand_tokens.json` — never inline hex/fonts; import from `branding.py`:
- **Palette:** nm_navy `#003DA5` (primary: headers, KPI numbers, series 1), nm_sky `#62B5E5`
  (accent/overlay/links), nm_pale `#E0E8F4` (table zebra / fills), nm_blue_mid `#265AB2`
  (secondary), nm_axis `#6A748C` (axis/secondary text), nm_text `#191919` (body), nm_text_muted
  `#666666` (footnotes/source), nm_bg `#FFFFFF`, nm_bg_alt `#E7E6E6` (borders/dividers).
- **Fonts (Excel reality):** Calibri Light (titles, 600) / Calibri (body, 400). (Brand book
  Futura PT is rarely installed → Calibri is the deliverable standard, per cm_brand_tokens.)
- **Type scale:** title 14pt/600, section 10pt/600, body/label 9pt, footnote 8pt/muted.
- **Number formats:** `$#,##0` / `$#,##0,,"M"` / `$#,##0.00` (per-SF) / `0.0%` / `#,##0`;
  numbers ≥1000 use commas (brand rule).
- **Logo:** NM Blue / Black / reversed-on-white only; never recolored/rotated/shadowed.

## 2 — Shared layout grammar (the common skeleton EVERY deliverable shares)
This is what makes all five "look substantially similar." Every work product, regardless of type,
is built from these common elements in this order:
1. **Branded title block** — NM logo (top-left), work-product type label (top-right), in nm_navy.
2. **Subject-property identity header** — property name, address, city/state, asset type, the
   client/prepared-for line, and the prepared-by (Briggs CRE @ Northmarq) + **date**. One
   consistent block across all five.
3. **Body section(s)** — type-specific content (the comps table, the showing schedule, the OM
   data grid, the pro forma), but always rendered with the **shared table style**: nm_navy header
   row (white bold text), nm_pale zebra striping, nm_bg_alt thin borders, the standard number
   formats, frozen header row, autofit.
4. **Footer band** — source attribution (nm_text_muted, 8pt: "Source: CoStar / RCA / public
   records, [date]"), confidentiality/disclaimer line, page number. Consistent across all five.
5. **Color conventions** (where applicable): blue = contracted/actual, gold = projection/option,
   blue text = input assumptions (carried from the BOV standard, applied framework-wide).

A single **`work_product_base`** styling module (extending `branding.py`) implements 1–5 so every
type calls the same header/footer/table builders — guaranteeing visual consistency and making a
later brand tweak a one-place change.

## 3 — The work-product type specs (shared grammar + type body)
**Revision (Scott, 2026-06-20):** the **OM and BOV master sheets are the SAME** — one Master
Sheet feeds both. The BOV underwriting workbook and the OM marketing piece are *downstream
outputs* that READ the master sheet (refined as later topics). And a fifth category — **Deal
Documents** (Word, chat-draftable) — is added (§3a).

### Excel work products
| Type | Format | Status | Body (type-specific) |
|---|---|---|---|
| **Sales-comps request** | Excel | exists (briggs-comps) | On-Market + Sold sheets; formula cols protected; sorted by sale date desc |
| **Lease-comps request** | Excel | exists (briggs-comps) | Single comps sheet; formula cols protected; sorted by execution date desc |
| **Buyer showings** | Excel | **NEW** | Showing schedule: property, address, time/date, contact, status, broker notes; grouped by buyer/tour |
| **Master sheet (feeds OM + BOV)** | Excel | consolidate | The single property data grid: identity, tenant/lease summary, rent roll, financials, sale/loan history, demographics, contacts — the one source BOTH the OM and the BOV pull from. (The `bov-underwriting` 3-sheet workbook + the OM marketing piece become downstream outputs of this.) |

### 3a — Deal Documents (Word, Northmarq letterhead, chat-draftable) — the 5th category
Grounded in Scott's uploaded templates (2026-06-20). All share a common **Northmarq letter
grammar**: letterhead/header → date → addressee block → `RE:` subject line → body → Scott Briggs
/ Northmarq signature block → consistent typography. Chat drafts them from a shared **deal-data
merge schema** (see below). One template carries legacy **Stan Johnson Company** branding —
standardizing means moving everything to **Northmarq**.
| Doc | Structure | Notes |
|---|---|---|
| **Buyer LOI** | salient-terms letter (Property/Purchaser/Seller/Price/DD/EMD/Closing/PSA/Title/Materials/Brokerage/1031/Expiration/non-binding) + signature tables | currently SJC-branded → rebrand to Northmarq |
| **Seller Response Form** | same salient-terms structure, seller's counter perspective | ~shared template with LOI (one "deal-terms letter", two perspectives) |
| **NDA** | confidentiality agreement (numbered clauses, Provider/Broker/Recipient, signature block) | Provider via Broker (Northmarq) |
| **Valuation Analysis Memo** | letter to prospective seller: conclusions → valuation methods → buyer-type → 4-phase marketing strategy + exhibit tables | the "chat-drafted" analysis memo |

**Shared deal-data merge schema** (the fields chat fills from the property/deal record, so all
four draft consistently): `property_tenant`, `address`, `city`, `state`, `zip`, `purchaser`,
`seller_of_record`, `purchase_price`, `cap_rate`, `dd_days`, `emd_amount`, `closing_days`,
`broker` (Scott Briggs / Northmarq), `recipient_name`/`title`/`company`/`email`/`phone`, `date`,
`expiration_days`. One schema → all four documents draft from the same deal context.

All types (Excel + Word): same brand layer (§1); the Excel set shares the layout grammar (§2),
the Word set shares the letter grammar (§3a); same output/naming conventions (§4). Bodies refined
later ("adjustments as we work through topics"); this fixes the shared skeletons so they start
consistent.

## 4 — Output, naming, delivery conventions (unified)
- Naming: `[PropertyAddress]_[Type]_[YYYYMM].xlsx` — Type ∈ {SalesComps, LeaseComps,
  BuyerShowings, OMMaster, BOV} (+ `_[ClientLastName]` for BOV). Aligns the existing skill
  conventions under one pattern.
- Delivery: the property's folder (`PROPERTIES/<bucket>/<tenant>/<City, ST>/Output/` or the
  Briggs `Projects/[PropertyName]/Output/`), consistent across types.
- Every deliverable carries the date + source attribution + prepared-by in the standard footer.

## 5 — Build plan (gated slices; refine bodies later)
**Excel track**
1. **`work_product_base` (Excel) shared module** (extend `branding.py`): title-block / identity
   header / footer / standard-table builders from `cm_brand_tokens.json`. The single styling
   primitive every Excel type calls. Gate: branded title-block + identity header + standard table
   + footer on a sample.
2. **Align the existing comps** (sales, lease) to `work_product_base` chrome — WITHOUT touching
   the formula-protected columns. Gate: visual match, formulas untouched.
3. **Build Buyer Showings + the Master Sheet** on `work_product_base`. Gate: shared grammar + type
   body; sample reviewed. (BOV workbook + OM marketing become downstream readers of the master
   sheet — a later topic.)

**Word track**
4. **`northmarq_letter` (docx) base** — the shared letterhead → addressee → RE → body → Scott
   Briggs/Northmarq signature grammar + the deal-data merge schema (§3a), brand-consistent with
   the Excel set. Gate: a branded letter shell renders from the merge schema.
5. **Build the four deal docs** on it: the deal-terms letter (LOI + Seller Response as two
   perspectives of one template), NDA, Valuation Memo — **rebranding the SJC LOI to Northmarq**.
   Chat drafts each from the merge schema. Gate: each drafts a clean Northmarq-branded doc from
   sample deal data; no residual Stan Johnson Company branding.

**Later (per-topic)**
6. Refine each body, add PDF/marketing variants, and wire all of it to the data layer (Part 2) so
   the master sheet + comps + docs auto-populate from the property/sale/lease/contact records.

## Guardrails
- Single brand source (`cm_brand_tokens.json` via `branding.py`) — never inline hex/fonts; numbers
  ≥1000 commas; logo rules. Reuse `briggs-comps` + `bov-underwriting` structures — do NOT break
  the comp formula-protected columns or the BOV return logic. Shared module = one place to change
  branding/layout for all five. Gated/reviewable per slice; substantially-similar-now,
  per-type-refinement-later.

---
## NEXT (Part 2, after the framework): underwriting data-quality ingestion audit
Per Scott: audit whether we ingest/digest **as much property + sale + lease information as is
practical** from **free/public sources, email, and research tools (CoStar, RCA, etc.)** — so the
work products above (esp. OM master + BOV + comps) are fed by the richest possible data. Scope:
inventory current ingestion channels (folder-feed, OM intake, CoStar sidebar, CMS, county/deed,
SF), measure field-level coverage on properties/sales/leases, and find the highest-leverage gaps
that are freely/publicly/grabbably fillable. (Separate prompt once the framework slice-1 is set.)
