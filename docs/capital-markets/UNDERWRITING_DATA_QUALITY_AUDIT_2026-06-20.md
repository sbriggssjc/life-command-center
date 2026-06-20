# Underwriting data-quality ingestion audit (2026-06-20)

> Scott's directive (Part 2): are we ingesting/digesting **as much property + sale + lease
> information as is practical** from **free / public / email / research (CoStar, RCA) sources**, so
> the work products (comps, OM master sheet, BOV) are fed by the richest possible record? This
> audit grounds field-level coverage on the core underwriting tables across both DBs, maps each
> gap to the channel that could fill it freely, and ranks the highest-leverage fixes.

## Method
Field-level non-null coverage (live, 2026-06-20) on the underwriting-critical columns of
`properties` / `leases` (active only) / `sales_transactions` on dia (`zqzrriwuavgrquhisnoa`) and
gov (`scknotsqkcheojiaewwh`, status≠archived). Coverage is the receipt; the gap-to-channel mapping
is the analysis.

## Coverage receipts

### dia — properties (n=12,280)
| field | cov | field | cov | field | cov |
|---|---|---|---|---|---|
| building_size | **72%** | year_built | **28%** | year_renovated | **3%** |
| land_area | **27%** | occupancy | 58% | property_type | 46% |
| lat/lng | 86% | parcel_number | **8%** | zoning | **2%** |
| assessed_value | 75% | tax_amount | 75% | latest_sale_price | 18% |
| anchor_rent | **9%** | lease_commencement | **6%** | lease_bump_pct | **6%** |
| true_owner_id | 84% | recorded_owner_name | **44%** | cmbs_debt | 0% |

### dia — active leases (n=6,591; only ~54% of properties have one)
| field | cov | field | cov | field | cov |
|---|---|---|---|---|---|
| lease_start | 98% | lease_expiration | **61%** | annual_rent | **59%** |
| rent_per_sf | 52% | leased_area | 91% | expense_structure | 61% |
| escalation_% | **2%** | renewal_options | **15%** | guarantor | **5%** |

### dia — sales_transactions (n=4,724; 2,435 distinct properties)
sale_date 100% · sold_price 91% · **cap_rate_final 58%** · buyer 68% · seller 78% ·
rent_at_sale 52% · firm_term 68%

### gov — properties (n=12,553 active)
| field | cov | field | cov | field | cov |
|---|---|---|---|---|---|
| rba | 74% | sf_leased | 84% | land_acres | **13%** |
| year_built | **30%** | year_renovated | **2%** | gross_rent | 87% |
| noi | 87% | expenses | **1%** | lease_expiration | 86% |
| firm_term | 81% | rent_escalations | **35%** | renewal_options | 53% |
| true_owner_id | 71% | **assessed_value** | **1%** | latest_sale_price | 48% |
| lat/lng | 97% | federal_employee_count | **12%** | flood_zone | 47% |
| **base_year_taxes** | **0%** | | | | |

### gov — active leases (n=11,377) — the GSA feed is strong
annual_rent 97% · rent_psf 94% · commencement 98% · expiration 100% · firm_term 96% ·
expense_structure **39%** · renewal_options **5%** · guarantor 0% (federal credit — N/A)

### gov — sales_transactions (n=14,773; 5,215 distinct properties)
sale_date 100% · **sold_price 42%** · **cap 36%** · noi 8% · buyer 79% · seller 67% ·
days_on_market 6% · loan/lender ~0–6%

## What this says
- **The lease ECONOMICS layer is strong where it comes from a public feed (gov GSA leases:
  rent/term/dates 94–100%) and weak where it must come from the lease DOCUMENT** (dia active-lease
  escalation 2% / guarantor 5% / expiration 61%; gov escalations 35% / renewal 5%). Escalations,
  guarantor, renewal terms, and expense structure are NOT public — they live in the lease PDFs we
  already hold in SharePoint. The folder-feed lease extractor (Stage B, built but gated) is the
  lever, not a new source.
- **The PHYSICAL / COUNTY layer is the biggest freely-fillable gap, especially on gov.** gov
  `assessed_value` is **1%** vs dia 75%, gov `land_acres` 13% vs the county assessor that should
  supply it, `base_year_taxes` **0%** (a gov gross-lease underwriting essential — the tax base-year
  stop). year_built (28/30%), year_renovated (2–3%), parcel_number (dia 8%) are all county-assessor
  / CoStar fields. **The county-assessor channel that populates dia tax/assessed appears not to run
  on gov, and even on dia it grabs tax/assessed but drops land/year/parcel/zoning** (dia assessed
  75% but parcel 8% — same record, partial digest).
- **The SALE PRICE/CAP layer is thin on gov** (price 42%, cap 36%) — consistent with R53: most gov
  "sales" are event-derived (lessor/deed changes) without a price. Cap rate is **derivable** wherever
  noi+price (gov) or rent_at_sale+price (dia) both exist but cap is null — a free internal fill.
- **gov demand-signal intel is underfilled**: federal_employee_count 12%, OPM headcount — public
  (OPM/FRPP) and gov-specific (the bov-government skill already references these).

## CORRECTION 2 (grounded 2026-06-20, after the real-write gate — the decisive one)
**The county valuation channel is hollow in BOTH DBs, and my non-null coverage overstated it.**
The original table used `COUNT(col)` (non-null); the county-capture path writes **zero-sentinels** on
failure, so non-null ≫ real. Re-checked with `>0`: dia `assessed_value` is **1.9% real** (not 75%);
dia `tax_records.assessed_value` 1.0% real of 24,994; gov `parcel_records.total_assessed_value`
**2.3% real** of 10,821 (8,919 zero, 1,650 null). The raw_payload itself carries 0/null for the
valuation + physical fields (owner_name + property_class DO come through — that's why the owner side
works), so there is **no cheap re-parse**. And there's no county concentration to attack (top-12
counties = 12.5% of linked props; LA, the largest, 1.4%). **Verified NOT contaminated** (real ==
non-null): building_size 72%, land_area 27%, occupancy 58%, year_built 28%, annual_rent 59%,
rent_per_sf 52%, leased_area 91%, gov rba/sf/gross_rent/noi — the operational/lease/size layer is
real. So: only the county assessed/tax fields were inflated; the rest of this audit stands.
**Implication:** free, at-scale, reliable assessed value across 1,278 county assessors effectively
does not exist. Assessed value becomes a per-deal CoStar grab when an analyst works a specific
property — NOT a bulk free backfill. The digest (Part A) was correct to run but its ceiling is the
~252 real values; the broad county valuation scrape (Part B) is dropped.

## CORRECTION 1 (superseded by Correction 2 above — kept for the record)
The county channel is **NOT off on gov** — it runs and the raw data is ingested. gov holds
property_public_records 27,402, parcel_records 10,819 (total_assessed_value populated on **85%**),
deed_records 5,660, tax_records 2,964; **7,267 properties are linked to a parcel**. Yet
gov.properties.assessed_value is 1%. So the #1 gap is **DIGEST (propagation), not INGEST**:
**6,364 gov properties are immediately backfillable** with assessed value from their already-linked
parcel record (parcel has it, property is NULL) — 1% → ~52% with zero new scraping. The physical
attrs (land_area_acres / year_built / zoning / building_sf) are **0% even in parcel_records** — the
assessor scraper captures assessed value but drops them: a narrower *capture* gap. dia digests tax/
assessed fine (75%) but its parcel_records is thin (1,555) — dia's physical-attr gap is genuine ingest.

## Ranked remediations — REVISED after Correction 2
0. ~~County assessed/tax bulk lever~~ — **DROPPED.** Hollow source (~2% real both DBs), no cheap
   re-parse, no concentration, secondary field for income-approach gov underwriting. Keep the digest
   already run (captured the ~252 real values + owner capture, which works); abandon the broad
   county valuation scrape. Assessed value = per-deal CoStar grab, not a bulk backfill.
1. **(was #2) Activate the lease-document extractor (UW#2)** — now the #1 lever. The doc-only fields
   (dia escalation 2%, guarantor 5%, renewal 15%, expiration 61%; gov escalations 35%, renewal 5%)
   live in lease PDFs we already hold; the Stage B extractor is built + blessed. Reliable, we own the
   source. Highest real free lift.
2. **Cap-rate derivation (UW#3)** — free/internal: backfill cap where price+rent(dia)/price+noi(gov)
   exist but cap is null (size the lever first; gov noi is only 8% so the gov ceiling is modest).
3. **Physical attrs via CoStar/RCA sidebar** — year_built (28/30%), land, building_size — from the
   channel we already operate, captured on the deals analysts actually work. NOT county scraping.
4. **OPM/FRPP federal-workforce intel for gov** — federal_employee_count 12%, public, gov-specific.

### (original ranking, superseded)
1. **County DIGEST + capture** — (A, free/immediate) propagate parcel_records.total_assessed_value
   → gov.properties.assessed_value (6,364 backfillable) + tax_records → tax fields, through the
   lcc_merge_field / field_source_priority gate (county_records outranks aggregators), fill-blanks,
   reversible; mirror on dia where linked county rows aren't digested. (B, scraper) extend the
   assessor capture to grab land_area_acres / year_built / zoning / building_sf from the SAME
   assessor record (0% today). Biggest single free lift; feeds BOV land/tax + comps physicals.
2. **Activate the lease-document extractor (Stage B)** — drain the SharePoint lease PDFs through
   the gated extractor to fill escalation %, guarantor, renewal terms, expiration, expense
   structure (dia esp.). These are the NNN-underwriting fields that are absent precisely because
   they're document-only. ~46% of dia properties have no active lease at all → the doc feed is also
   the coverage fix.
3. **Derive cap rate where the inputs exist** — backfill `cap_rate_final` from noi÷price (gov) /
   rent_at_sale÷price (dia) on the 36–58% of sales missing cap but holding the inputs; free, internal,
   immediately improves comp value (and the new LEASE TYPE comp column).
4. **Physical attrs from CoStar/RCA capture** — building_size/year_built/year_renovated/land via the
   sidebar where the assessor can't resolve; these ride the channel we already operate.
5. **gov sale price/cap via R53 + CoStar/RCA** — keep promoting suspected sales to priced comps as
   operator/CoStar prices land; the R53 lane is the surface.
6. **OPM/FRPP federal-workforce intel for gov** — fill federal_employee_count / headcount / hiring
   signal from the public OPM/FRPP data (gov demand narrative + agency-credit context).

## Next
Confirm the county-assessor channel's per-domain wiring (ground before building #1), then spin the
top remediations into gated CC build prompts in leverage order. The lease-extractor activation (#2)
is already built and paused — it likely just needs the blessing + a capped drain.
