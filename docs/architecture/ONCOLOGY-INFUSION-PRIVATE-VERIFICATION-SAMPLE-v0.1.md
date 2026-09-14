# Oncology / Infusion Private Verification Sample v0.1

**Status:** Protocol ready; sample not yet drawn
**Date:** 2026-08-11

## 1. Purpose and scope

Validate NPPES seed precision, addressability, service corroboration and operator-role interpretation before
any production ingestion or 200-property cohort construction. The sample is private because it contains
row-level organization and address evidence.

## 2. Frozen sample

Draw 50 candidates from the first complete dry run using a recorded random seed:

| Cell | Count | Selection rule |
|---|---:|---|
| Oncology clinic/center | 15 | Random active Type 2 location candidates |
| Infusion therapy clinic/center | 15 | Random active Type 2 location candidates |
| Radiation oncology clinic/center | 10 | Random active Type 2 location candidates |
| Multi-taxonomy / multi-location | 5 | Highest collision or ambiguity score |
| LCC exact-address matches | 5 | Random unique exact matches, distinct from above |

If a cell has fewer records, keep all available records and reallocate the remainder proportionally across the
other random cells. Freeze candidate IDs, source release, transform version and selection SQL.

## 3. Reviewer worksheet

For each candidate record:

- confirm Type 2 organization, active status and practice—not mailing—location;
- normalize and independently verify street, city, state, ZIP and suite/building;
- identify facility, brand, operator, parent, physician group and health system without conflating roles;
- capture a qualifying official location page and supported modalities;
- check closure/relocation conflicts and radiation-license evidence when applicable;
- adjudicate LCC property resolution as correct, incorrect, ambiguous or no match;
- assign error labels and a concise disposition note.
- classify real-estate form as `stnl_confirmed`, `dominant_user_confirmed`, `dominant_user_probable`,
  `minority_mob`, `health_system_campus`, `operator_owned` or `unknown_form`;
- record building RBA, user occupied SF, denominator type, evidence tier and calculated healthcare-user share;
- resolve record owner, true owner/sponsor, operator affiliation and third-party-landlord addressability;
- inventory available volume, capacity, reimbursement, revenue, profit, rent and coverage evidence without
  fabricating missing values; and
- record research minutes for clinical, property, ownership and economics review separately.

Two reviewers independently inspect the 10 highest-risk records. Disagreements remain `needs_review` until
resolved; they are not averaged away.

## 4. Metrics

Report Wilson 95% confidence intervals alongside point estimates for:

- facility-seed precision;
- correct service/modality classification;
- current-location corroboration rate;
- unique property-resolution precision;
- correct operator/parent role mapping;
- physician-office, hospital-campus, duplicate and stale-address error rates.
- STNL/dominant-user/minority-MOB/campus/operator-owned distribution;
- third-party-landlord addressability among qualifying real estate;
- bounded economics-model coverage and source confidence; and
- median and 90th-percentile research minutes by review family.

## 5. Pass/fail gates

Proceed to a larger non-production discovery run only when:

- seed precision is at least 90%;
- modality classification is at least 90%;
- unique property matches are at least 95% correct;
- zero ambiguous matches were automatically promoted;
- every `service_corroborated` row has a qualifying source and retrieval date;
- no systematic cell falls below 80% precision without a documented rule change and retest.
- property form is classifiable for at least 80% of the sample;
- at least 50% of classifiable facilities are confirmed STNL or confirmed dominant-user assets;
- at least 60% of qualifying assets have a confirmed or probably resolvable third-party landlord path; and
- at least 50% of qualifying assets support a bounded low/base/high facility-economics model.

The last four are business-feasibility gates, not clinical-source-quality gates. Report them separately so a
clinically valid lane can be narrowed, repositioned or rejected without corrupting the discovery assessment.

Failing a gate changes the taxonomy, normalization, corroboration or matching rule first. Do not solve a
quality failure by silently dropping difficult geographies or operators.

## 6. Storage and publication

Store the row-level worksheet, page captures and source exports under a Git-ignored private healthcare
discovery folder. Commit only aggregate metrics, methods, checksums, rule changes and non-identifying examples.
Do not put patient data, clinician personal data beyond source identifiers, raw page bodies or licensed
third-party content in Git.

## 7. Authorization boundary

This protocol authorizes neither source download nor database creation. Scott approves the dry-run source
release, private storage target and executable query package before the sample is drawn.
