# Oncology / Infusion Pilot Cohort Specification v0.1

**Status:** Discovery source and controls selected; dry run not authorized
**Date:** 2026-08-11
**Parent:** `OUTPATIENT-HEALTHCARE-LANE-PACK-SPEC-v0.1.md`
**Recommended sponsor:** Scott Briggs

## 1. Pilot decision

Use a national discovery universe and select a 200-property working cohort. Preserve radiation oncology as a
separate subtype, and use four market/operator clusters only after the national scoring pass reveals where LCC
has the strongest combination of facility confidence, existing relationships and transaction evidence.

This avoids choosing markets before the data shows where the commercial advantage is. The cohort remains small
enough for review and large enough to test operator hierarchy, multi-site identity and comparable coverage.

## 2. Unit of analysis

One cohort row represents one addressable facility-property pair:

`canonical_property_id + healthcare_facility_id + operator_role`

Do not collapse multiple facilities at one campus or treat an operator's mailing address as a facility. A
hospital campus may enter the discovery universe but is excluded from the working cohort unless the outpatient
facility resolves to a distinct, broker-relevant real-estate record.

## 3. Inclusion rules

A candidate must meet all of the following:

1. United States street address with city, state and ZIP sufficient for canonical-property resolution.
2. Current evidence of medical oncology, infusion therapy or radiation oncology service at the location.
3. Facility is freestanding, office-based, retail-based or a separately addressable outpatient component.
4. Evidence has a source, observed/retrieved date and resolvable pointer.
5. Candidate is not known closed, relocated or superseded as of the cohort freeze date.

Include mixed oncology/infusion sites. Record each supported subtype independently:

- `medical_oncology`
- `infusion_therapy`
- `radiation_oncology`
- `mixed_oncology_infusion`

## 4. Exclusion and review rules

### Exclude from the working cohort

- inpatient-only hospital departments with no distinct addressable outpatient real estate;
- physician-directory or billing addresses without facility evidence;
- duplicate suite/address/operator records already resolved to the same facility-property pair;
- closed or relocated facilities where the evidence is conclusive;
- home-infusion-only operations without a broker-relevant facility.

### Route to human review

- address match is ambiguous or maps to more than one canonical property;
- operator, brand, physician group and health-system roles conflict;
- service evidence supports oncology but not the specific modality;
- campus record may contain a distinct outpatient facility but the suite/building cannot be resolved;
- source dates or operating status conflict.

Review items are capped and value-ranked. The pilot does not emit one task for every candidate.

## 5. Cohort construction

Build three frozen layers:

| Layer | Target size | Purpose |
|---|---:|---|
| Discovery universe | No fixed cap | Collect all bounded candidates from approved sources |
| Eligible scored set | 400–800 | Candidates meeting minimum evidence and addressability gates |
| Working cohort | 200 | Commercial and data-quality pilot |

Within the 200-property working cohort, target:

- 120 medical-oncology/infusion or mixed sites;
- 40 radiation-oncology sites;
- 20 difficult-but-reviewable identity/operator cases;
- 20 reserve sites selected for strong LCC/Salesforce relationship or transaction evidence.

The categories may overlap at the fact level, but each cohort row receives one selection-bucket label so the
total remains 200.

## 6. Scoring model

Score eligible candidates on a 100-point scale.

| Component | Points | Measurement |
|---|---:|---|
| Facility/service evidence | 25 | Current authoritative or corroborated evidence of oncology/infusion modality |
| Canonical property match | 20 | Unique address/geocode/property resolution with no unresolved collision |
| Operator hierarchy | 15 | Operator/brand/parent roles resolved with evidence |
| Existing relationship | 15 | Salesforce/LCC company or contact relationship, activity or owned preference signal |
| Transaction/lease/listing coverage | 15 | Linked comp, sale, lease, listing or deal evidence relevant to brokerage |
| Portfolio learning value | 10 | Adds a new operator, market, operating model or difficult-but-useful test case |

Apply these gates before ranking:

- facility evidence at least 15/25;
- property match at least 10/20;
- unresolved exclusion flag = false.

Do not infer a relationship score from name similarity alone. Use canonical entity links, verified Salesforce IDs
or reviewed external identities.

## 7. Cluster selection

After scoring, group the eligible set by metro and operator/parent. Select up to four clusters using:

1. at least 15 eligible facilities in the cluster;
2. meaningful operator diversity or a strategically important multi-site operator;
3. at least 25% of facilities with existing relationship or transaction evidence;
4. no single operator exceeding 40% of the full working cohort;
5. geographic diversity sufficient to test address and source behavior.

If fewer than four clusters meet these rules, retain a national residual bucket rather than lowering the
evidence threshold.

## 8. Required output fields

Each selected row must carry:

- cohort version, freeze date, selection bucket and total/component scores;
- canonical property ID and match method/status;
- facility ID, name, address, geocode and operating-status evidence;
- service-family, specific-use and modality facts with evidence;
- operator, brand, parent, physician-group and health-system roles where supported;
- Salesforce/LCC entity, property, contact, deal, listing, comp and lease links where present;
- source pointers, observed dates, confidence and verification state;
- inclusion/exclusion/review reasons and reviewer disposition.

## 9. Review sample and acceptance

Before using the cohort commercially, review a stratified 50-property golden sample:

- 25 highest-scoring candidates;
- 10 radiation-oncology candidates;
- 10 identity/operator exceptions;
- 5 randomly selected remaining candidates.

Pass thresholds:

- at least 95% correct unique property resolution;
- at least 90% correct operator/parent mapping;
- at least 90% correct specific-use/modality classification;
- 100% of specialty facts have evidence and observation dates;
- zero unreviewed ambiguous records promoted to Salesforce.

## 10. Named consumers and retirement behavior

The cohort has three consumers: broker review, operator/property dossier generation and governed pursuit
qualification. It must not become an uncapped research queue.

- Cap the active review list at 50 and rank by commercial score and uncertainty.
- Auto-retire candidates proven closed, relocated, duplicated or outside scope; retain the evidence and reason.
- Supersede facts rather than deleting them.
- Re-score only when material evidence, relationship or transaction coverage changes.
- Freeze every commercially used cohort version for reproducibility.

## 11. Next execution step

The read-only existing-source profile is complete and did not produce adequate volume. Complete the NPPES
implementation-readiness gate defined in `ONCOLOGY-INFUSION-NPPES-SOURCE-ADAPTER-SPEC-v0.1.md`, then review the
exact dry-run package before downloading or loading source rows. Apply the staging, corroboration and private
sample controls in the three linked implementation documents. No cohort rows should be written or promoted
until the source adapter and 50-record sample acceptance gates pass.
