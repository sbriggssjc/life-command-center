# Oncology / Infusion Read-Only Profile Result

**Status:** Completed; existing-source sufficiency gate failed
**Run date:** 2026-08-11
**Plan:** `ONCOLOGY-INFUSION-READ-ONLY-PROFILE-PLAN-v0.1.md`
**Write activity:** None

## 1. Decision

Existing LCC, Salesforce, Dialysis_DB and government evidence is not sufficient to construct the proposed
oncology/infusion pilot. Add one bounded national facility source before scoring or selecting the 200-property
cohort.

The result is a source-coverage failure, not a resolver failure. The current surfaces contain too few explicit
facility candidates to justify address-resolution or relationship-scoring work.

## 2. Execution boundary

The profile used aggregate `SELECT` queries only. It returned counts by source surface and Salesforce object
family. It did not return or persist names, addresses, contacts, payloads or candidate rows. No database objects
or records were created, modified, linked, merged or deleted.

Discovery vocabulary was the bounded expression for oncology, hematology, infusion, chemotherapy, named cancer
facilities and radiation oncology defined in the profile plan. Matches are recall-oriented and have not been
validated as true facilities.

## 3. Aggregate results

### Latest Salesforce payloads in LCC Opps

| Object family | Latest distinct records | Broad hits | Oncology hits | Infusion hits |
|---|---:|---:|---:|---:|
| Properties | 384 | 1 | 0 | 1 |
| Companies | 201 | 0 | 0 | 0 |
| Comps | 310 | 0 | 0 | 0 |
| Listings | 31 | 0 | 0 | 0 |
| Deals | 54 | 0 | 0 | 0 |
| Other/null family | 1,962 | 0 | 0 | 0 |

The ledger was deduplicated to the latest payload per `(sf_object_type, sf_object_id)` before matching.

### Domain surfaces

| Project/surface | Rows scanned | Broad hits |
|---|---:|---:|
| Dialysis_DB `properties` | 12,371 | 3 |
| Dialysis_DB `medicare_clinics` | 8,535 | 0 |
| Dialysis_DB `sf_property_staging` | 412 | 1 |
| government `properties` | 20,470 | 0 |
| government `sf_property_staging` | 258 | 0 |

The maximum pre-deduplication discovery volume is five broad hits. That is far below the 400-candidate minimum
in the cohort contract, and some or all hits may be false positives or duplicate Salesforce/domain observations.

## 4. Stop/go evaluation

| Gate | Required | Observed | Result |
|---|---:|---:|---|
| Eligible discovery candidates | At least 400 | At most 5 unreviewed broad hits | Fail |
| Working cohort | 200 | Not constructible | Stop |
| Property-resolution profiling | Useful after adequate volume | Premature | Defer |
| Relationship/transaction scoring | Useful after adequate volume | Premature | Defer |

Do not lower the evidence threshold or treat the dialysis clinic table as oncology evidence to manufacture
volume. Add an authoritative facility seed and then rerun property resolution and commercial enrichment.

## 5. Recommended source increment

Use the CMS NPPES Version 2 monthly dissemination as the national base, supplemented by weekly increments and
the practice-location reference file. Resolve relevant non-individual facility taxonomy codes from the current
NUCC taxonomy release at ingestion time rather than freezing remembered codes in application logic.

NPPES is a discovery source, not final proof of operating status, licensure, services rendered or real-estate
addressability. Taxonomy codes are provider-selected. Every promoted specialty fact therefore requires a source
date, taxonomy release, NPI status, address role and a verification state.

Implementation contract: `ONCOLOGY-INFUSION-NPPES-SOURCE-ADAPTER-SPEC-v0.1.md`.

## 6. Separate security observation

The schema inventory reported 15 existing public-schema tables in the government project with RLS disabled.
This profile did not access those tables except through schema metadata and did not alter them. Handle that
finding in a separate security workstream; enabling RLS without approved policies can break existing consumers.
