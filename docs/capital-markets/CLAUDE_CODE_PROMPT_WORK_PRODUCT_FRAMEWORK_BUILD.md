# Claude Code prompt — Work-Product Framework build (Excel + Word tracks, gated slices)

> Implements `WORK_PRODUCT_FRAMEWORK.md` — one unified, Northmarq-branded design system across all
> Briggs/Northmarq work products so they "look substantially similar," refined per-type later.
> Read the framework doc first. Receipts-first; gated slices; reuse existing assets — do NOT
> reinvent or break the comp formula-protected columns / BOV return logic.

## Foundations (grounded 2026-06-20 — build ON these)
- **Single brand source:** `public/reports/cm_brand_tokens.json` (palette nm_navy `#003DA5` /
  nm_sky `#62B5E5` / nm_pale `#E0E8F4` / nm_axis `#6A748C` / nm_text `#191919` / nm_text_muted
  `#666666` / nm_bg_alt `#E7E6E6`; fonts Calibri Light 600 / Calibri 400; the type scale + number
  formats). Import via `src/branding.py` — NEVER inline hex/fonts; numbers ≥1000 use commas.
- **Existing:** `briggs-comps` (sales/lease Excel templates, formula-protected cols), the
  `bov-underwriting` workbook, `src/branding.py`.
- **New uploaded Word templates** (in the session uploads) ground the doc layer: Buyer LOI (legacy
  Stan Johnson Co branding → rebrand Northmarq), Seller Response Form, NDA, Valuation Analysis Memo.

## EXCEL TRACK
### Slice E1 — `work_product_base` shared module (GATE FIRST)
Extend `branding.py` with the shared Excel chrome from `cm_brand_tokens.json`, the single
primitive every Excel type calls:
- `title_block(ws, work_product_type)` — NM logo area + type label, nm_navy.
- `identity_header(ws, subject)` — property name/address/city-state/asset-type/prepared-for/
  prepared-by (Briggs CRE @ Northmarq) + date — one consistent block.
- `standard_table(ws, …)` — nm_navy header row (white bold), nm_pale zebra, nm_bg_alt thin
  borders, the standard number formats, frozen header, autofit.
- `footer_band(ws, source, date)` — source attribution + disclaimer + page (nm_text_muted 8pt).
- Color conventions: blue=contracted/actual, gold=projection/option, blue-text=input assumption.
- **Gate:** a sample workbook with all four elements renders brand-correct; no inlined hex/fonts.

### Slice E2 — align the comps to the chrome
Route the `briggs-comps` Sales + Lease templates' title/identity/footer/table chrome through
`work_product_base`. **Do NOT touch the formula-protected columns** (RENT/SF, CAP RATE, TERM, DOM,
PRICE/SF, EFFECTIVE RENT/SF) or the population logic. Gate: visual match to the grammar; formulas
intact; a sample comp run unchanged in its data, restyled in its chrome.

### Slice E3 — Buyer Showings + Master Sheet (new, on `work_product_base`)
- **Buyer Showings**: schedule sheet — property/address/time/date/contact/status/broker-notes,
  grouped by buyer or tour.
- **Master Sheet**: the single property data grid feeding BOTH OM and BOV — identity, tenant/lease
  summary, rent roll, financials, sale/loan history, demographics, contacts. (The BOV workbook +
  OM marketing become downstream readers — later topic.)
- Gate: both render the shared grammar + their body on sample data.

## WORD TRACK
### Slice W1 — `northmarq_letter` base + deal-data merge schema
A shared docx base: Northmarq letterhead → date → addressee block → `RE:` subject → body →
Scott Briggs / Northmarq signature block — brand-consistent with the Excel set (same palette/
fonts). Define the **merge schema** (`property_tenant, address, city, state, zip, purchaser,
seller_of_record, purchase_price, cap_rate, dd_days, emd_amount, closing_days, broker,
recipient_*`, `date`, `expiration_days`) so any doc drafts from one deal context. Gate: a branded
letter shell renders from sample merge data; no Stan Johnson Company branding anywhere.

### Slice W2 — the four deal docs on the base
- **Deal-terms letter** = LOI + Seller Response Form as two perspectives of one salient-terms
  template (Property/Purchaser/Seller/Price/DD/EMD/Closing/PSA/Title/Materials/Brokerage/1031/
  Expiration/non-binding + signature tables).
- **NDA** (Provider via Broker = Northmarq; numbered clauses; signature block).
- **Valuation Analysis Memo** (conclusions → methods → buyer-type → 4-phase marketing + exhibits).
- All draft from the W1 merge schema; **rebrand the SJC LOI to Northmarq**. These are meant to be
  **chat-drafted on demand**, so keep the templates parameter-driven (chat fills the schema → doc).
- Gate: each drafts a clean Northmarq-branded doc from sample deal data; 0 residual SJC branding.

## My gate (per slice)
- E1: shared chrome renders brand-correct, single brand source, no inlined styles.
- E2: comps restyled, formula-protected columns + data untouched.
- E3: showings + master sheet render the grammar + body.
- W1: branded letter shell from the merge schema, 0 SJC.
- W2: each of the four drafts clean from sample data, 0 SJC, consistent with the Excel brand.

## Guardrails
- Single brand source (`cm_brand_tokens.json` via `branding.py`); shared base modules = one place
  to change branding for all types; numbers ≥1000 commas; logo rules. Reuse `briggs-comps` +
  `bov-underwriting` — never break the comp formula-protected columns or the BOV return logic.
  Gated/reviewable per slice; substantially-similar-now, per-type-refinement-later. The Word docs
  stay parameter-driven for chat drafting. Wiring to the live data layer is Part 2.
