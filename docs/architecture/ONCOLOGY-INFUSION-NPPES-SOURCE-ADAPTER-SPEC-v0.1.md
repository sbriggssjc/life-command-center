# Oncology / Infusion NPPES Source Adapter Specification v0.1

**Status:** Adapter and control contracts defined; no ingestion authorized
**Date:** 2026-08-11
**Trigger:** Existing-source sufficiency gate failed
**Profile result:** `ONCOLOGY-INFUSION-READ-ONLY-PROFILE-RESULT-2026-08-11.md`

## 1. Purpose

Seed a bounded national discovery universe of addressable oncology, infusion and radiation-oncology facilities
from authoritative public identifiers, then enrich those candidates against LCC without treating NPPES as
conclusive evidence of services, licensure, operating status or real-estate suitability.

## 2. Source contract

| Element | Contract |
|---|---|
| Base | CMS NPPES monthly downloadable file, Version 2 |
| Delta | CMS NPPES weekly incremental files |
| Locations | Primary practice address plus the NPPES practice-location reference file |
| Vocabulary | Current NUCC Health Care Provider Taxonomy release |
| Provider scope | Organization/Type 2 NPIs for facility seeding |
| Status | Exclude deactivated NPIs from active discovery; preserve deactivation evidence |
| Refresh | Monthly full replacement, weekly deltas between replacements |

Version 2 is required because CMS retired Version 1 support on 2026-03-03 and expanded relevant field lengths.
The adapter records the exact CMS file date, checksum and NUCC taxonomy version for every run.

## 3. Taxonomy selection

Resolve the current NUCC codes programmatically from the versioned taxonomy artifact for these non-individual
concepts:

- Clinic/Center — Oncology;
- Clinic/Center — Infusion Therapy;
- Clinic/Center — Oncology, Radiation.

Keep adjacent organization taxonomies in a review-only tier when they can represent an operator rather than a
broker-relevant facility, including home infusion, multi-specialty clinic, medical specialty clinic, pharmacy
and hospital classifications. Individual physician, nurse, pharmacist and technologist taxonomies do not seed
facility rows by themselves.

Never infer a facility solely because an individual oncology provider uses an address. Individual NPIs may
corroborate a Type 2 facility after address resolution, but they are not the discovery unit.

## 4. Discovery row and identity

One raw observation represents:

`source_release + organization_npi + location_role + normalized_location + taxonomy_code`

One provisional facility candidate groups compatible observations by organization NPI and normalized practice
location. Preserve multiple locations and multiple taxonomy codes. Do not collapse headquarters, mailing and
practice locations.

Required raw fields:

- organization NPI and enumeration type;
- legal business name and authorized other names;
- taxonomy code, primary flag and taxonomy release;
- primary practice and other practice-location addresses;
- enumeration, last-update, certification and deactivation/reactivation dates when supplied;
- source file, release date, row fingerprint and ingest timestamp.

## 5. Candidate gates

A candidate enters the eligible discovery set only when:

1. the NPI is active as of the cohort freeze date;
2. the provider is an organization/Type 2 NPI;
3. at least one approved facility taxonomy is present;
4. a United States practice location is complete enough to normalize;
5. the location is not merely a mailing or correspondence address;
6. it is not an exact duplicate within the frozen source release.

Route, do not exclude, campus addresses, multi-suite collisions, adjacent taxonomies and conflicting names.

## 6. LCC resolution and enrichment

Process candidates in three non-destructive phases:

1. Normalize and deduplicate NPPES observations privately.
2. Resolve against existing LCC/Salesforce property records using stable IDs where available, then exact
   normalized address plus ZIP, followed by reviewed geocode/address candidates.
3. Add relationship, owner/operator, lease, comp, listing and deal evidence only after facility identity and
   property resolution are independently scored.

NPPES organization name is an observed provider identity, not automatically the tenant, operator, brand,
guarantor or parent. Store those roles separately with evidence.

## 7. Verification ladder

| State | Minimum evidence | Permitted use |
|---|---|---|
| `seeded` | Active Type 2 NPI + approved facility taxonomy + practice address | Private discovery only |
| `address_resolved` | Unique canonical property match | Scoring candidate |
| `service_corroborated` | Current independent facility/operator source confirms service/location | Eligible cohort |
| `commercially_verified` | Reviewed facility, operator role and broker-relevant property | Commercial pilot |

NPPES alone cannot move a candidate beyond `address_resolved`.

## 8. Run outputs and controls

The first adapter run remains non-production and produces:

- aggregate counts by taxonomy concept, state and address role;
- distinct active Type 2 NPIs, practice locations and provisional facilities;
- duplicate, missing-address and deactivation counts;
- exact-address resolution, no-match and collision rates against LCC;
- a private capped sample for verification;
- a sanitized committed report with query/code version and source checksums.

Raw CMS extracts and row-level candidate files stay in Git-ignored private storage. No Salesforce writes, LCC
facility inserts or review-task creation occur until the aggregate result and sample are approved.

## 9. Acceptance gate

Proceed to the 200-property cohort only if the bounded NPPES run yields:

- at least 400 plausible active organization-location candidates after exclusions;
- at least 60% uniquely resolvable or reviewably addressable properties;
- no evidence that individual/provider-office inflation dominates the sample;
- at least 90% correct specialty relevance in a stratified verification sample;
- reproducible source and taxonomy versioning.

If volume is excessive, rank by facility-specific taxonomy, freestanding addressability and LCC commercial
linkage; do not silently narrow to arbitrary states or operators.

## 10. Authoritative references

- CMS NPPES downloadable files: `https://download.cms.gov/nppes/NPI_Files.html`
- CMS NPPES data-dissemination guidance: `https://www.cms.gov/medicare/regulations-guidance/administrative-simplification/data-dissemination`
- NUCC Health Care Provider Taxonomy: `https://nucc.org/index.php/code-sets-mainmenu-41/provider-taxonomy-mainmenu-40`
- Current NUCC taxonomy lookup: `https://taxonomy.nucc.org/`

## 11. Linked implementation controls

- `ONCOLOGY-INFUSION-STAGING-AND-INGESTION-CONTRACT-v0.1.md`
- `ONCOLOGY-INFUSION-SERVICE-CORROBORATION-ADR-005.md`
- `ONCOLOGY-INFUSION-PRIVATE-VERIFICATION-SAMPLE-v0.1.md`

The next gate is an implementation-readiness review of the exact taxonomy codes, source checksums, private
storage path, proposed DDL/privileges and dry-run executable package. No production schema or data load is
authorized by these documents.
