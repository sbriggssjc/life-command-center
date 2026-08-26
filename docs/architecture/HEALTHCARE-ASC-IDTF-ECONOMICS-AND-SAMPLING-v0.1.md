# Healthcare ASC and IDTF Economics and Sampling Plan v0.1

**Status:** Synthetic sampling and aggregate-review contract implemented; no real row-level sample or financial conclusion yet

**Date:** 2026-08-11

## 1. Decision standard

ASC and fixed-site IDTF must each support two independent conclusions:

1. the facility archetype creates brokerage-addressable real estate; and
2. the available evidence supports a bounded, facility-level operating model useful to owners and investors.

A lane may pass one and fail the other. Public-company margins, national market reports, or Medicare payment
rates alone cannot establish site EBITDA or rent coverage.

## 2. ASC facility economics

### Required model

For procedure family `p` and payer class `q`:

`net patient revenue = sum(cases[p,q] * net facility reimbursement[p,q]) + evidenced ancillary revenue`

`contribution profit = net patient revenue - clinical labor - supplies - implants - drugs - variable services`

`site EBITDA = contribution profit - fixed labor - management fees - insurance - equipment - occupancy - other site overhead`

`EBITDAR = site EBITDA + cash rent`

`rent coverage = EBITDAR / cash rent`

`occupancy cost ratio = cash rent / net patient revenue`

Professional surgeon, anesthesia, and physician-group revenue stays outside facility revenue unless the legal
entity, billing arrangement, and related expense are evidenced. Joint-venture distributions are not operating
revenue. Medicare procedure rates are a payer-specific anchor, not a total-revenue rate.

### Evidence and scenarios

| Driver | Low/base/high treatment |
|---|---|
| Cases | Observed facility counts when available; otherwise capacity × operating days × utilization with explicit specialty assumptions |
| Case mix | Procedure-family distribution; suppress blended reimbursement if mix is unresolved |
| Payer mix | Medicare/Medicaid/commercial/self-pay shares with source and period |
| Net reimbursement | Facility component only, by procedure family and payer; show rate-year sensitivity |
| Supplies/implants | Specialty-specific per-case range; separately flag pass-through or carve-out treatment |
| Labor | Clinical/nonclinical staffing and wage range; do not allocate operator-wide labor without a site method |
| Occupancy | Actual lease when available; otherwise marked market-rent scenario, never represented as contract rent |

## 3. Fixed-site IDTF economics

For modality `m`, code/component `c`, and payer `q`:

`technical revenue = sum(scans[m,c,q] * net technical reimbursement[c,q])`

`site EBITDA = technical revenue + evidenced ancillary revenue - technologist labor - contrast/supplies - equipment lease/depreciation - service contracts - occupancy - billing/admin - other site overhead`

Professional interpretation revenue and radiologist expense form a separate reconciled layer. If the source
cannot distinguish technical, professional, and global billing, EBITDA and rent coverage remain suppressed.

Model installed units, available hours, scan duration, scheduled utilization, downtime, modality mix, equipment
age, service contract, lease/debt/depreciation, and replacement capital. Fixed-site proof does not prove
equipment ownership or economic control.

## 4. Estimate ledger and reconciliation

Every estimate stores lane, facility version, period, currency, low/base/high, calculation version, input
components, source pointers, confidence by input family, reviewer status, and conflict state. Independent
credible estimates differing by more than 20% remain a provisional review trigger; the lane calibration may
replace that threshold only through a versioned decision applied to all facilities.

Outputs are suppressed when:

- service volume or site allocation is unbounded;
- facility/professional revenue is conflated;
- the period or rate year cannot be reconciled;
- a denominator mismatch makes margin or coverage misleading;
- rent is unknown and no clearly labeled scenario is appropriate; or
- a source conflict crosses the active review threshold.

## 5. Comparable 50-property sampling frames

Each lane draws 50 unique physical locations from a frozen, validated release using a recorded seed. Replacement
rules are fixed before review; no record is removed because its real estate is inconvenient.

### ASC sample

| Cell | Count | Rule |
|---|---:|---|
| Freestanding or provisionally freestanding ASC | 15 | Random across census regions and operator sizes |
| MOB/campus/unknown form | 10 | Random; tests false-positive real-estate assumptions |
| High procedure/economics evidence | 10 | Stratified by procedure family, not merely total Medicare volume |
| Independent/small operator | 5 | Random organization strata |
| Multi-site/health-system/JV operator | 5 | Random organization strata |
| Existing LCC exact-address or comp match | 5 | Random exact matches, nonoverlapping |

### Fixed-site IDTF sample

| Cell | Count | Rule |
|---|---:|---|
| Fixed-site evidence present | 15 | Random across regions and modality families |
| Fixed/mobile/site-form ambiguous | 10 | Highest ambiguity; measures discovery failure |
| MRI/CT | 8 | Random fixed/provisional-fixed locations |
| PET/nuclear medicine | 5 | Random fixed/provisional-fixed locations |
| Other diagnostic modalities | 7 | Mammography/ultrasound/other governed families |
| Existing LCC exact-address or comp match | 5 | Random exact matches, nonoverlapping |

If a cell lacks records, retain all and reallocate proportionally across random cells. High-risk cells are not
reallocated away. Multi-cell eligibility is resolved by the stated order, and selected candidates are frozen
before research.

## 6. Common reviewer scorecard

For every location, reviewers capture:

- current service and address corroboration;
- facility/operator/parent/JV role accuracy;
- STNL, dominant-user, minority-MOB, campus, operator-owned, or unknown property form;
- user SF, building RBA, tenant-share denominator and evidence tier;
- fee owner, true owner/sponsor, landlord, lease/advisory path and owner contactability;
- capacity, volume, service mix, payer, reimbursement, expense, rent and coverage evidence;
- sales/listing/lease/comp visibility and likely fee opportunity;
- clinical, property, ownership, economics, and contact research minutes; and
- conflict, missingness, confidence, disposition, and auto-retire reason.

Ten highest-risk records receive independent second review.

## 7. Comparative gates and decision outputs

Apply the existing hard gates without lane-specific relaxation: at least 90% clinical precision, 80% property
classification, 50% STNL/dominant-user among classifiable facilities, 60% addressable landlord/operator path
among qualifying assets, and 50% bounded economics coverage. Report Wilson intervals, missingness, median and
90th-percentile research time, and weighted swim-lane score.

The final decision is one of:

- `advance_primary_lane` — passes all gates and has the strongest risk-adjusted brokerage score;
- `advance_narrow_archetype` — only a defined facility/property subtype passes;
- `advisory_only` — useful economics/operator intelligence but insufficient saleable real estate;
- `enrichment_only` — useful classification for existing assets but no new prospect universe; or
- `stop` — unreliable identity, poor addressability, or uneconomic research burden.

No lane advances from this plan without an observed sample.

## 8. Implemented sampling and review contract

`scripts/healthcare-discovery/property-review.mjs` now enforces the reviewed boundary with synthetic inputs:

- exactly 50 unique candidate fingerprints from one frozen lane release;
- a stable, non-secret seed and deterministic ordering within ordered, nonoverlapping cells;
- quotas totaling exactly 50, with fail-closed behavior when a frozen cell is underfilled;
- exact-once review coverage of every selected fingerprint;
- separate denominators for clinical precision, property classification, qualifying property share,
  landlord addressability, and bounded economics coverage;
- 95% Wilson intervals plus median and 90th-percentile total research minutes; and
- aggregate-only serialization that removes the selected fingerprint roster.

The implemented contract deliberately does not infer brokerage suitability from CMS evidence. Property form,
ownership, landlord/client addressability, economics coverage, and research time become measurable only from
the governed property review. The raw sampling frame and row-level scorecards remain private review artifacts;
only the aggregate receipt is eligible for architectural review or later governed promotion.

Current acceptance is synthetic only. A real 50-property run still requires separate authorization for the
frozen private release, source acquisition, reviewer access, and any database persistence.

### Official ASC candidate-pack checkpoint

`healthcare:asc:candidate-pack` converts an authorized official ASC release into three private artifacts: a
CMS-derived candidate pool, an identifier crosswalk/manual-review worksheet, and a release-bound sampling
contract. The eligible universe is limited to unique ASCQR facility identities corroborated by a currently
`CERTIFIED` POS record; terminated POS facilities are excluded. Sampling strata use only source-grounded
facts: Census region, presence of an exact ASC enrollment record, and a conservative single-site/multi-site
proxy based on normalized CMS enrollment organization names. Hamilton largest-remainder allocation assigns
exactly 50 slots proportionally across observed strata, and the existing deterministic sampler selects within
those frozen cells without replacement.

This checkpoint deliberately leaves property form, landlord/owner identity, ownership evidence, economics,
LCC connection and Salesforce connection blank. A human may research those fields with approved CoStar, RCA,
Salesforce and public-record workflows after the frame is frozen. The command performs no connector access,
database write, CRM promotion, outreach or IDTF activation. Its public receipt is aggregate-only; candidates,
CMS identifiers, organization names and manual research remain inside the approved private root.

## 9. Authorized sample-execution boundary

`scripts/healthcare-discovery/sample-execution.mjs` and its CLI close the gap between the authorized private
release and the deterministic sampling contract. The boundary requires an authorized ASC packet with two
distinct approvals, its matching aggregate execution receipt, a sampling contract bound to the exact artifact
release, and a candidate pool inside the approved private root. It writes the row-level frame only inside that
root and emits an aggregate receipt containing packet/release bindings, cell counts, seed fingerprint,
candidate-pool fingerprint and selection fingerprint.

The boundary fails closed on an unapproved or IDTF packet, receipt mismatch, release drift, path escape,
insufficient cell quota, duplicate candidates or existing output. It does not download data, classify property
form, populate scorecards, select replacements, write a database or authorize production promotion. The official
candidate-pack command additionally requires the authorized packet and matching authorization receipt, and its
outputs do not broaden that approval.
