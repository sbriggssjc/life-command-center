# Healthcare ASC and Fixed-Site IDTF Source Manifest Contracts v0.1

**Status:** Design contract; no download, ingestion, or production access authorized

**Date:** 2026-08-11

**Parent:** `HEALTHCARE-SOURCE-SUFFICIENCY-CARDS-ASC-IMAGING-v0.1.md`

## 1. Decision

Use separate, versioned source bundles for ambulatory surgery centers (ASCs) and fixed-site independent
diagnostic testing facilities (IDTFs). The bundles may share validation code, but they cannot share an
assumption that a CMS organization or enrollment row represents brokerage-addressable real estate.

- The ASC seed is a CMS-certified facility at a reported practice address.
- The IDTF seed is a Medicare-enrolled supplier location that must be affirmatively classified as fixed-site.
- Neither seed proves single tenancy, tenant share, lease status, fee ownership, or current operation.
- Every release is immutable and fail-closed. A changed source file produces a new release, never an overwrite.

## 2. Common manifest envelope

Each lane manifest extends the accepted Phase A manifest with:

| Field | Contract |
|---|---|
| `manifest_version` | Exact supported schema version; unknown versions fail. |
| `lane` | `asc` or `idtf_fixed_site`; no free-text aliases. |
| `release_id` | Deterministic fingerprint of lane, source releases, adapter version, and rule-set version. |
| `created_at` | UTC generation time; excluded from deterministic analytical fingerprints. |
| `adapter_version` | Pinned parser/normalizer version. |
| `normalization_version` | Pinned address and organization normalization rules. |
| `eligibility_rule_version` | Pinned lane inclusion/exclusion rules. |
| `sources[]` | One record per official source artifact. |
| `expected_outputs[]` | Aggregate receipts only; row-level output paths must be private and Git-ignored. |
| `limits` | Byte, row, collision-state, memory, and error-rate ceilings. |

Every `sources[]` record requires `source_key`, official HTTPS landing-page URL, official artifact URL or API
identifier when known, publisher, release/as-of date, retrieval timestamp, local relative path, byte size,
SHA-256, header fingerprint, required-column contract, and allowed-use classification. Redirects away from an
approved CMS host fail validation. Placeholder hashes, absolute paths, path traversal, duplicate keys, and
unreviewed parameters remain prohibited.

## 3. ASC source bundle

| Source key | Required | Role | Minimum contract |
|---|---:|---|---|
| `cms_pos_asc` | Yes | National certified-facility seed | Certification number, facility name, address, state, provider/facility type, certification/status dates where published |
| `cms_ascqr_facility` | Yes | Current reporting/quality corroboration | Facility identifier, reporting period, measure/status fields; absence cannot alone mean closed |
| `cms_ffs_enrollment` | Yes | Organization, enrollment and disclosed ownership signals | Enrollment ID, NPI where published, legal/business names, specialty/enrollment type, practice location, reassignment/ownership fields available in the release |
| `cms_asc_payment` | Yes for economics | Covered procedure and Medicare facility-rate reference | Calendar year, HCPCS, payment indicator/group, national or locality-adjustable payment inputs |
| `cms_utilization` | Optional until claims authorization | Procedure-volume/payment evidence | Provider/facility key, service year, HCPCS, service count, allowed/payment amounts, suppression fields |
| `state_asc_license` | Jurisdictional | Current license corroboration | State, license identifier, status, effective/expiration dates, address |

ASC candidate identity is anchored on the certification number plus normalized practice address. NPI,
enrollment ID, legal organization, brand, and operator are evidence edges, not interchangeable keys. A changed
operator at the same building creates a new effective-dated operating observation while retaining the property
candidate fingerprint.

### ASC fail-closed rules

- Exclude hospital departments that are not separately identifiable as an ASC facility.
- Do not treat quality-reporting presence as ownership, tenancy, or lease evidence.
- Do not gross up Medicare volume to total cases until specialty and payer assumptions have been reviewed.
- Do not combine physician, anesthesia, or professional fees with ASC facility revenue.
- Preserve suppressed utilization as suppressed; never impute a record-level count from suppression alone.

## 4. Fixed-site IDTF source bundle

| Source key | Required | Role | Minimum contract |
|---|---:|---|---|
| `cms_ffs_enrollment_idtf` | Yes | Supplier/practice-location seed | Enrollment ID, NPI, specialty, organization, practice address, enrollment/revalidation fields, location/enrollment type fields present in release |
| `cms_nppes_org_location` | Yes | Organization and additional-location reconciliation | Type 2 NPI, enumeration status, primary and secondary practice locations, taxonomy; self-reported only |
| `cms_physician_supplier_utilization` | Yes for economics | Modality/code volume and Medicare technical economics | NPI/provider key, place/service year, HCPCS, service count, submitted/allowed/payment fields, suppression flags |
| `cms_pfs_reference` | Yes for economics | Technical/professional component rules and rates | Calendar year, HCPCS, modifier/component indicators, locality-adjustable payment inputs |
| `state_equipment_or_radiation_registry` | Jurisdictional | Fixed equipment, modality, and operating corroboration | Facility/address, modality/equipment, registration/license status and dates |
| `accreditation_or_operator_page` | Required before qualification | Current fixed-site service corroboration | Address-matched facility and modalities; capture retrieval date and evidence class |

The manifest must carry an explicit `site_form_evidence` rule set. A candidate remains
`fixed_site_unproven` unless the enrollment artifact or corroborating official source distinguishes the fixed
practice location from a mobile unit, portable supplier, physician office, hospital department, warehouse, or
equipment base. NPI taxonomy alone cannot satisfy this rule.

### IDTF fail-closed rules

- Exclude or separately label mobile units, portable X-ray, hospital/physician-office imaging, and equipment
  service/warehouse addresses.
- One enrollment or NPI with multiple addresses creates separate location observations, not one property.
- Separate technical-component economics from professional interpretation revenue and expense.
- A code/modality match does not prove the equipment is owned, leased, or permanently installed at the site.
- PET, MRI, CT, nuclear medicine, mammography, ultrasound, and other modalities remain distinct economics
  families until reconciliation supports aggregation.

## 5. Aggregate source-sufficiency receipt

Before row-level review, each lane emits only:

- source/release fingerprints and validation outcomes;
- total parsed, included, excluded, suppressed, malformed, and collision counts;
- counts by state, facility/supplier status, location role, and exclusion reason;
- address completeness and cross-source match-rate bands;
- ASC certification/ASCQR/enrollment coverage or IDTF fixed/mobile/unknown-site-form coverage;
- utilization and payment evidence coverage bands;
- candidate-state ceiling and peak-memory result; and
- privacy-scan result.

The receipt must not contain names, NPIs, certification numbers, enrollment IDs, addresses, ZIP codes smaller
than an approved aggregate cell, URLs with record identifiers, or raw source rows.

## 6. Authorization gates

This contract authorizes command and test design only. Separate approval is required for each of: downloading
official artifacts, storing a row-level private release, processing claims/utilization data, creating private
database tables, drawing the 50-property samples, and promoting any fact into LCC or Salesforce.

## 7. Official source anchors reviewed

- [CMS ASC facility and quality topic](https://data.cms.gov/provider-data/topics/hospitals/ambulatory-surgical-centers)
- [CMS Provider of Services/iQIES file](https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/provider-of-services-file-internet-quality-improvement-and-evaluation-system)
- [CMS Medicare FFS Public Provider Enrollment data dictionary](https://data.cms.gov/resources/medicare-fee-for-service-public-provider-enrollment-data-dictionary)
- [CMS ASC payment files](https://www.cms.gov/medicare/payment/prospective-payment-systems/ambulatory-surgical-center-asc)
- [CMS Physician and Other Practitioners methodology](https://data.cms.gov/resources/medicare-physician-other-practitioners-methodology-2022)
- [CMS IDTF enrollment guidance](https://www.cms.gov/Medicare/Provider-Enrollment-and-Certification/MedicareProviderSupEnroll/Downloads/National_Provider_Enrollment_Conference_Enrollment_of_Independent_Diagnostic_Testing_Facilities.pdf)
- [Supabase Data API security guidance](https://supabase.com/docs/guides/api/securing-your-api)
