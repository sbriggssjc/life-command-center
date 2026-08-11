# Healthcare Swim-Lane Evaluation Matrix v0.1

**Status:** Design and evidence-collection contract; no production ingestion or promotion authorized

**Date:** 2026-08-11
**Parent:** `HEALTHCARE-REAL-ESTATE-AND-ECONOMICS-BUSINESS-PLAN-v0.1.md`

## 1. Decision this matrix supports

LCC should expand only into healthcare lanes that create a repeatable brokerage or advisory market. Facility
count alone is insufficient. Each lane must demonstrate that a meaningful share of verified locations are
saleable single-tenant or dominant-user real estate, that the owner or landlord is addressable, and that the
facility economics can support differentiated advice.

Use the same evidence contract for every specialty. Do not change thresholds after seeing a lane's results
without documenting a new version and rerunning all comparison lanes.

## 2. Hard gates before weighted scoring

| Gate | Initial threshold | Failure treatment |
|---|---:|---|
| Clinical precision | At least 90% of sampled candidates are current in-scope facilities | Repair discovery source or stop lane |
| Property classification | At least 80% of sample classifiable | Improve property evidence before scoring |
| Brokerage-suitable form | At least 50% of classifiable sample is STNL or confirmed dominant user | Narrow archetype or move lane to adjacency |
| Client addressability | At least 60% of qualifying real estate has a confirmed/probable third-party landlord or operator advisory path | Do not create owner prospect queue |
| Economics coverage | At least 50% of qualifying facilities supports a bounded low/base/high model | Limit product to property/lease intelligence |
| Research scalability | Median human research time within the approved operating budget | Automate evidence or stop scaling |

A lane cannot compensate for a failed hard gate with a high weighted score. Unknown evidence remains unknown;
it is not scored as favorable.

## 3. Weighted comparison score

Score each dimension from 0 to 5 using the rubric below, then multiply by its weight. Report both the total and
the underlying observed rates.

| Dimension | Weight | 0 | 3 | 5 |
|---|---:|---|---|---|
| STNL/dominant-user prevalence | 20 | Below 20% | 40–59% | At least 80% |
| Third-party landlord prevalence | 15 | Below 20% | 40–59% | At least 80% |
| Facility/operator identity quality | 10 | Mostly unresolved | 70–84% resolved | At least 95% resolved |
| Ownership/contact addressability | 10 | Mostly unresolved | Repeatable manual path | High-confidence scalable path |
| Revenue/profit modelability | 15 | No bounded site model | Model for 40–59% | Model for at least 80% |
| Capital intensity/location stickiness | 10 | Commodity space | Moderate improvements | Specialized/high replacement cost |
| Transaction/lease inventory | 10 | Sparse/nonobservable | Regional repeatability | National repeatable inventory |
| Research cost per qualified asset | 5 | Unbounded | Acceptable with review | Mostly automated and low-cost |
| LCC integration fit | 5 | New isolated model | Reuses some core entities | Reuses property, owner, dossier, comps and BD spine |

`weighted_score = sum(dimension_score / 5 * dimension_weight)`

The score ranks lanes only after all applicable hard gates pass. Preserve a confidence level and sample size
beside every score.

## 4. First comparison cohort

| Lane | Initial facility archetypes | Likely strength to test | Primary failure risk |
|---|---|---|---|
| Oncology/infusion | Freestanding cancer centers, infusion centers, radiation oncology | Specialized improvements, sticky referral/service footprint | Minority suites within health-system MOBs |
| Ambulatory surgery | Freestanding ASCs and specialty surgical hospitals | Purpose-built space, certificates/licensure, operator economics | Physician/operator ownership obscures landlord opportunity |
| Diagnostic imaging | Freestanding MRI/CT/PET centers | Equipment intensity and location stickiness | Hospital outpatient departments/campus locations |
| Urgent care | Freestanding and retail-pad clinics | Large national location universe and transaction inventory | Small leased suites and weak site-level economics |
| Behavioral health | Inpatient, residential and outpatient facilities | Longer stays and specialized licensure in selected archetypes | Broad modality mix makes one model misleading |
| Specialty hospitals | Rehabilitation, LTACH and surgical hospitals | STNL form, large rent base and strong property identity | Smaller universe and system/operator ownership |

The comparison unit is the facility archetype, not merely the specialty label. For example, inpatient
behavioral hospitals and outpatient therapy suites must be scored separately.

## 5. Dialysis-grade economics comparison

For every lane, define the smallest defensible site model before scoring economics coverage:

| Model family | Required inputs | Core outputs |
|---|---|---|
| Capacity/throughput | Licensed/installed capacity, operating days/hours, utilization | Annual visits/procedures/treatments |
| Reimbursement | Service mix, payer/site-of-care factors, gross-to-net assumptions | Low/base/high net revenue |
| Facility expense | Labor, supplies/drugs, equipment, corporate allocation policy | Contribution profit and site EBITDA range |
| Occupancy | Rent, RBA, escalations, landlord obligations and TI | Rent/SF, occupancy cost and EBITDAR/rent coverage |
| Reconciliation | Independent estimates, periods, provenance and confidence | Canonical estimate or suppression/conflict status |

No lane receives a favorable economics score because public company revenue exists. Evidence must be
allocable to the site or support a transparent facility model. Conflicting credible estimates differing by
more than 20% enter review until specialty-specific calibration replaces that provisional threshold.

## 6. Integration with existing LCC structure

Reuse the existing spine rather than creating a parallel healthcare CRM:

| Healthcare concept | Existing LCC destination after promotion approval |
|---|---|
| Facility/property | Domain asset identity plus `lcc_property_attributes` |
| Operator, guarantor, owner, sponsor | `entities`, `external_identities`, `entity_relationships` |
| Owner/landlord facts | `lcc_property_owner_facts` and owner-resolution workflow |
| Lease/sale/listing facts | Domain lease, sales and listing surfaces plus unified portfolio views |
| Economics/provenance | Private healthcare facts first; curated promoted facts with field provenance |
| Brokerage opportunity | `bd_opportunities`, priority queue and cadence only after value gate |
| Human uncertainty | Decision/review lane with explicit reason and auto-retire predicate |

Discovery remains private and versioned. Promotion must be fill-blanks-only, provenance-tagged, reversible,
idempotent and separately authorized. No raw discovery row should automatically create a Salesforce lead,
cadence or operator-facing task.

## 7. Evidence sequence

1. Complete synthetic Phase A adapter validation.
2. Define facility archetypes and authoritative seed/corroboration sources per lane.
3. Run a source-sufficiency profile before provider-level review.
4. Draw an unbiased, stratified 50-record sample for each viable archetype.
5. Record clinical, property, ownership, economics and research-time observations under one protocol.
6. Apply hard gates, then calculate weighted scores with confidence and missingness.
7. Select one primary lane and at most one adjacency lane for the first production-bound design.
8. Build the specialty financial model only for the winning archetype.
9. Design promotion, dossier, comps and BD consumers as separate governed checkpoints.

## 8. Immediate recommendation

Finish A1/A2, then build A3 for oncology/infusion because its source contract is already bounded. In parallel
at the design level, prepare source-sufficiency cards for ambulatory surgery and diagnostic imaging; both are
strong candidates for the next comparison because facility identity, specialized improvements and site-level
operating metrics may align better with net-lease brokerage than generic outpatient office use.
