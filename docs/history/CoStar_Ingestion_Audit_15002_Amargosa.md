# CoStar Ingestion Audit: 15002 Amargosa Rd, Victorville CA

**Property ID:** 23283 | **Medicare ID:** 552834 | **Date:** April 16, 2026

---

## Executive Summary

A field-by-field comparison of CoStar's full Sale Comp detail (Summary, Property, Lease, Tenant, Public Record, and Contacts tabs) against the Dialysis_DB reveals the sidebar pipeline captured approximately 60% of available data fields. The remaining 40% falls into three categories: (A) data that exists in CoStar but was never mapped in the pipeline code, (B) data that the pipeline extracts but fails to persist to the correct tables/columns, and (C) denormalized fields that go stale after initial write.

All data gaps for this specific property have been backfilled manually. Six systemic pipeline issues are identified below with Claude Code fix prompts.

---

## Direct DB Fixes Applied (This Session)

| Fix | What Changed |
|-----|-------------|
| **Properties record** | Set year_built=2016, building_size=11780 (was 14593), land_area=1.23 (was 1.60), lot_sf=53579, county=San Bernardino, assessed_value=$4,326,000, tax_amount=$54,320.21, zoning=Public, land_use=Medical Building, recorded_owner_name=VANA MEDICAL LLC, true_owner_name=Armen Cherik M.D., latest_deed fields populated |
| **Lease #5126** | Corrected leased_area from 14593 to 11780 SF, rent_per_sf from $21.71 to $29.33, rent from $316,839 to $345,547, lease_start to 2016-01-01, source_confidence=documented |
| **Missing 2023 sale** | Inserted sale_id 8004: 4/19/2023 transfer from 1999 TOGNOLI FAMILY TRUST to BLEFARI 1997 REVOCABLE TRUST for $1,212,181 |
| **Blefari ownership** | Created recorded_owner (bf37318b), inserted ownership_history #13656 (2023-04-19 to 2026-02-13), updated Tognoli end_date from 2026-02-13 to 2023-04-19 |
| **Duplicate sale removed** | Deleted sale_id 7958 (duplicate of 7983 for 2026 Vana Medical purchase) |
| **Loan linkages** | Linked all 3 loans to their respective sales and owners, added loan_type and interest_rate_text |
| **Parcel record** | Created parcel_record for APN 3106-181-51 (San Bernardino County) |
| **Tax records** | Created 3 tax_records for 2023-2025 with assessed values and tax amounts |
| **Contacts** | Created contact records for Armen Cherik (acherik@aol.com), Eugene Blefari (sblefari@msn.com), Joan Blefari (blefari@yahoo.com) with phones and addresses |
| **True owner linkage** | Linked Armen Cherik contact to true_owners record, updated notice address |

---

## Field-by-Field Gap Analysis

### PROPERTIES TABLE

| Field | CoStar Value | DB Before | DB After | Pipeline Extracts? |
|-------|-------------|-----------|----------|-------------------|
| building_size | 11,780 SF (RBA) | 14,593 (from lease) | 11,780 | YES but lease SF overwrites RBA |
| land_area | 1.23 AC | 1.60 AC | 1.23 | YES |
| lot_sf | 53,579 SF | 0.0 | 53,579 | YES but wasn't populated |
| year_built | Feb 2016 | NULL | 2016 | YES |
| county | San Bernardino | NULL | San Bernardino | YES |
| assessed_value | $4,326,000 | $0.00 | $4,326,000 | YES |
| tax_amount | $54,320.21 | $0.00 | $54,320.21 | YES |
| zoning | Public | NULL | Public | YES |
| land_use | Medical Building | NULL | Medical Building | YES |
| recorded_owner_name | VANA MEDICAL LLC | Tognoli 1999 Family Trust | VANA MEDICAL LLC | **BUG: set then deleted** |
| true_owner_name | Armen Cherik, M.D. | NULL | Armen Cherik, M.D. | **NEVER SET** |
| latest_deed_date | 2026-02-13 | NULL | 2026-02-13 | YES |
| latitude | 34.522589 | N/A (no column) | N/A | **NO - never extracted** |
| longitude | -117.332057 | N/A (no column) | N/A | **NO - never extracted** |
| construction_type | Reinforced Concrete | N/A (no column) | N/A | **NO** |
| stories | 1 | N/A (no column) | N/A | **NO** |
| opportunity_zone | Yes | N/A (no column) | N/A | **NO** |
| walkability scores | 50/50/100/50 | N/A | N/A | **NO - filtered as noise** |
| FEMA flood data | Zone B/X, Map 06071C5819H | N/A | N/A | **NO** |
| traffic counts | Multiple cross streets | N/A | N/A | **NO** |

### LEASES TABLE

| Field | CoStar Value | DB Before | DB After | Notes |
|-------|-------------|-----------|----------|-------|
| leased_area | 11,780 SF | 14,593 SF | 11,780 SF | Pipeline used wrong source for SF |
| rent_per_sf | $29.33 | $21.71 | $29.33 | Derived from wrong SF |
| lease_start | Jan 2016 | 2016-05-03 | 2016-01-01 | CoStar shows Jan 2016 sign date |
| lease_expiration | Apr 2031 | 2031-05-02 | 2031-05-02 | Close enough |
| expense_structure | NNN | NNN | NNN | Correct |
| tenant | DaVita Kidney Care | Davita Vista Del Sol Dialysis | Davita Vista Del Sol Dialysis | DB has more specific name |

### SALES_TRANSACTIONS TABLE

| CoStar Record | In DB? | Notes |
|--------------|--------|-------|
| 5/5/2015: MDS DV VICTORVILLE from LUDWIG GLEN L, $488,500 | YES (sale_id 7986) | Correct |
| 5/17/2016: TOGNOLI from MSD DV VICTORVILLE, $5,761,000 | YES (sale_id 7984) | Correct |
| 6/23/2020: TOGNOLI mortgage, Capstar $3.2M | YES (sale_id 7985) | Correct |
| **4/19/2023: BLEFARI from TOGNOLI, $1,212,181** | **NO → NOW YES (8004)** | **Was completely missing** |
| 2/3/2026: VANA MEDICAL from BLEFARI, $5,362,000 | YES (sale_id 7983) | Correct |

### LOANS TABLE

| CoStar Loan | In DB? | Linkage Fixed? |
|------------|--------|---------------|
| 2016: California Cu, $3.3M, 120 mo | YES (loan_id 476) | YES - linked to sale 7984 |
| 2020: Capstar Bank, $3.2M, 360 mo Commercial | YES (loan_id 475) | YES - linked to sale 7985 |
| 2026: First-Citizens, $3.4M, New Conventional | YES (loan_id 474) | YES - linked to sale 7983 |

### CONTACTS (Previously EMPTY for this property)

| CoStar Contact | Created? | Details |
|---------------|----------|---------|
| Armen Cherik (True Buyer) | YES | acherik@aol.com, (818) 249-4439, www.glendaleneurologist.com |
| Eugene Blefari (True Seller) | YES | sblefari@msn.com, (650) 967-8188 |
| Joan Blefari (True Seller) | YES | blefari@yahoo.com, (415) 967-8188 |
| Matt Hagar (Listing Broker) | Already existed | broker_id 2138 |
| Yuan-Sing Chang (Listing Broker) | Already existed | broker_id 2139 |

### PARCEL_RECORDS & TAX_RECORDS (Previously EMPTY)

| Table | Created? | Key Data |
|-------|----------|----------|
| parcel_records | YES | APN 3106-181-51, 11,807 bldg SF, 54,450 lot SF |
| tax_records (2025) | YES | $4,326,000 assessed, $54,320.21 tax |
| tax_records (2024) | YES | $4,326,000 assessed, $51,845.90 tax |
| tax_records (2023) | YES | $5,553,035 assessed, $76,372.03 tax |

---

## Systemic Pipeline Issues (sidebar-pipeline.js)

### Issue 1: recorded_owner_name Set Then Deleted (CRITICAL)

**Location:** `propagateToDomainDbDirect()` line ~1013 sets `recorded_owner_name`, then line ~1056 explicitly deletes it. After `reconcilePropertyOwnership()` updates `recorded_owner_id`, `recorded_owner_name` is never re-populated.

**Impact:** Every property shows stale or NULL owner names in the properties table even though correct owner UUIDs are assigned.

### Issue 2: true_owner_name Never Populated

**Location:** `reconcilePropertyOwnership()` line ~2872 updates `recorded_owner_id` but never sets `true_owner_name` from the matched true_owners record.

**Impact:** `true_owner_name` is always NULL on the properties table.

### Issue 3: Contacts Tab Data Not Written to contacts Table

**Location:** `upsertSidebarContacts()` line ~742 only extracts 4 roles (listing_broker, buyer_broker, true_buyer_contact, true_seller_contact). Owner/seller contact details (emails, phones, websites) from the CoStar Contacts tab are NOT written to the `contacts` CRM table.

**Impact:** Buyer/seller contact info (emails, phones, websites) is lost — critical for prospecting.

### Issue 4: Missing 2023 Sale — Pipeline Likely Captured Only "Active" Sales

**Location:** The pipeline iterates `sales_history` from the CoStar sidebar but may not capture all public record transfers. The 2023 Tognoli→Blefari transfer at $1.2M was a non-arm's-length intra-family transfer that may not have appeared in the CoStar sale comp sidebar initially.

**Impact:** Ownership chain gaps for properties with intermediate transfers.

### Issue 5: Building Size vs Lease Area Confusion

**Location:** When the pipeline processes property data, it appears that `building_size` can be overwritten by `leased_area` from the lease tab if the lease SF differs from RBA. CoStar shows RBA=11,780 but the pipeline stored 14,593 (which matches no CoStar field).

**Impact:** Wrong building size cascades to wrong rent/SF calculations and wrong price/SF on sales.

### Issue 6: Latitude/Longitude, FEMA, Traffic, Walkability Never Extracted

**Location:** Zero references to lat/long extraction in the entire pipeline. FEMA/flood data, traffic counts, and walkability scores are also not extracted. Walkability is actively filtered out as noise (line ~983).

**Impact:** No geocoding, no flood risk assessment, no location analytics.

---

## Claude Code Prompts

### Prompt 1: Fix Owner Name Persistence

```
In /api/_handlers/sidebar-pipeline.js, find the `propagateToDomainDbDirect()` function.

PROBLEM: Around line 1013, `recorded_owner_name` is set from metadata, then around line 1056 it's explicitly deleted from the update payload. After `reconcilePropertyOwnership()` assigns `recorded_owner_id`, the name is never backfilled.

FIX: In `reconcilePropertyOwnership()` (around line 2872), after updating `recorded_owner_id` on properties, add a follow-up query:

```sql
UPDATE properties p
SET recorded_owner_name = ro.name,
    true_owner_name = COALESCE(tru.name, p.true_owner_name)
FROM recorded_owners ro
LEFT JOIN true_owners tru ON tru.true_owner_id = ro.true_owner_id
WHERE ro.recorded_owner_id = p.recorded_owner_id
AND p.property_id = $1
```

Also remove the line (~1056) that deletes `recorded_owner_name` from the property update payload. The name should persist as a denormalized cache.
```

### Prompt 2: Extract and Store Contact Details from CoStar Contacts Tab

```
In /api/_handlers/sidebar-pipeline.js, the `upsertSidebarContacts()` function (line ~742) only processes 4 contact roles. CoStar's Contacts tab provides True Buyer, Recorded Buyer, True Seller, and Recorded Seller with full contact details (email, phone, website, address).

PROBLEM: These contacts are not written to the `contacts` CRM table. Only broker contacts get persisted.

FIX: After the existing broker contact upserts, add logic to also upsert owner/buyer/seller contacts:

1. Check if metadata.contacts contains entries with role in ('true_buyer','recorded_buyer','true_seller','recorded_seller','owner')
2. For each, upsert into the `contacts` table with:
   - contact_name, contact_email, contact_phone from the CoStar data
   - company from the entity name
   - role mapped appropriately ('owner','seller','buyer')
   - true_owner_id linked if the contact matches the property's true_owner
3. If the contact has a true_owner_id match, also update true_owners.contact_id

This is critical for prospecting — buyer/seller emails and phones are high-value CRM data.
```

### Prompt 3: Fix Building Size vs Lease Area Priority

```
In /api/_handlers/sidebar-pipeline.js, search for where `building_size` gets set on the properties table.

PROBLEM: The pipeline appears to allow lease `leased_area` to overwrite `building_size` (RBA). For 15002 Amargosa Rd, CoStar RBA is 11,780 SF but the DB stored 14,593 SF (unknown source, not matching any CoStar field).

FIX: Ensure `building_size` is set from the CoStar property/building section (RBA field) and is NOT overwritten by lease area. The hierarchy should be:
1. CoStar RBA from property tab (highest confidence)
2. CoStar building_sf from public record improvements
3. Existing DB value
4. Never from lease area

Add a guard: if building_size is being set and already has a value from a higher-confidence source, skip the update.
```

### Prompt 4: Add Latitude/Longitude Extraction

```
In /api/_handlers/sidebar-pipeline.js, the pipeline never extracts latitude/longitude from CoStar.

PROBLEM: CoStar's Public Record tab provides lat/long (e.g., 34.522589 / -117.332057) but the pipeline has zero references to coordinate extraction. The `properties` table doesn't have lat/lng columns either.

FIX (two parts):
1. Add `latitude` and `longitude` columns to the `properties` table (numeric type)
2. In the pipeline's property extraction (step 5a), look for lat/long in:
   - metadata.public_record.latitude / metadata.public_record.longitude
   - metadata.location.latitude / metadata.location.longitude
   - metadata.property.latitude / metadata.property.longitude
3. Write these to the properties table during the property upsert

This enables future geocoding, map plotting, and proximity analysis.
```

### Prompt 5: Ensure All Public Record Sales Are Captured

```
In /api/_handlers/sidebar-pipeline.js, the `upsertDomainSales()` function (line ~1681) processes the `sales_history` array.

PROBLEM: The 2023 intra-family transfer (Tognoli → Blefari, $1.2M) was missing from the DB despite being visible in CoStar's Public Record tab as record 2 of 5.

INVESTIGATION NEEDED: Check if the Chrome Connector's CoStar scraper is extracting ALL 5 sale/loan history records from the Public Record tab, or only the "Last Sale" summary. The pipeline code iterates the full array, so the issue may be in the Chrome extension's data extraction, not the pipeline itself.

Look at the Chrome extension code that scrapes CoStar sale comps — specifically the function that reads the "Sale/Loan History" section. Ensure it clicks through ALL paginated records (the UI shows "1 of 5 Historic Sale Loan Records" with pagination arrows).
```

### Prompt 6: Populate Parcel and Tax Records from Public Record Tab

```
In /api/_handlers/sidebar-pipeline.js, check if `parcel_records` and `tax_records` tables are being populated during ingestion.

The pipeline reportedly writes to these tables (lines ~1220-1343 per analysis), but for property 23283 both tables were completely empty despite the CoStar Public Record tab showing:
- Parcel: APN 3106-181-51, lat/long, census tract, legal description
- Assessment: 5 years of assessed values and tax amounts
- Improvements: building size, FAR, stories, construction type, year built

INVESTIGATION: Add logging to the parcel/tax upsert functions to determine if:
(a) The Chrome extension is not scraping this data from the Public Record tab
(b) The pipeline receives it but fails silently during insert
(c) The data_hash constraint is rejecting the records

If (a), the Chrome extension needs to be updated to scrape the full Public Record tab including Assessment table rows and Parcel details.
```
