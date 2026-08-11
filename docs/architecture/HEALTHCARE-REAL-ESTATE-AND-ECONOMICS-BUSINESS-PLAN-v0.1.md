# Healthcare Real Estate and Economics Business Plan v0.1

**Status:** Design proposal; no production ingestion, database migration, underwriting assertion or Salesforce write authorized

**Date:** 2026-08-11
**Parents:** `OUTPATIENT-HEALTHCARE-LANE-PACK-SPEC-v0.1.md`, `ONCOLOGY-INFUSION-PHASE-A-BUILD-PLAN-v0.1.md`

## 1. Business objective

Build a healthcare net-lease intelligence lane that finds not merely healthcare locations, but properties where
Northmarq can create an actionable relationship with an owner, landlord, operator or capital partner. The lane
should prioritize:

1. single-tenant healthcare buildings;
2. buildings where an in-scope healthcare user controls at least 50% of rentable area or building economics;
3. third-party-owned assets whose landlord behaves like a plausible brokerage or advisory client; and
4. facilities whose operating economics can be modeled transparently enough to improve valuation, lease,
   credit and sale advice.

The 50% threshold is an initial commercial rule, not a claim that every building above it is net lease or that
every building below it is irrelevant. The system must preserve the measured denominator and evidence rather
than convert incomplete observations into false precision.

## 2. Three independent qualification axes

Every discovered location receives three separate statuses. Do not collapse them into one opaque score before
the underlying statuses are reviewable.

| Axis | Question | Minimum core-lane gate |
|---|---|---|
| Clinical validity | Is a current in-scope service operating at this address? | Corroborated under ADR-005 |
| Real-estate suitability | Does the user control a saleable building or a dominant share of one? | Single tenant, or healthcare user share >= 50% with a reliable denominator |
| Client addressability | Is there a third-party owner/landlord or operator relationship Northmarq can serve? | Resolved non-operator owner or a documented operator-owned advisory opportunity |

Candidates that pass clinical validity but fail or lack real-estate evidence remain in discovery. They must not
inflate the commercial cohort.

## 3. Real-estate suitability taxonomy

### 3.1 Required classifications

| Class | Definition | Core lane treatment |
|---|---|---|
| `stnl_confirmed` | One operating user occupies the full building or parcel improvement | Highest priority |
| `dominant_user_confirmed` | In-scope user occupies >= 50% of building RBA or another approved economic denominator | Core lane |
| `dominant_user_probable` | Strong evidence of dominance, but exact numerator or denominator is missing | Manual review; not auto-promoted |
| `minority_mob` | In-scope user occupies < 50% of a multi-tenant medical office building | Adjacency lane, not core net lease |
| `health_system_campus` | Address is embedded in a hospital or integrated campus without separable real estate | Operator/portfolio intelligence only |
| `operator_owned` | Operator or health system owns the real estate | Advisory/watch lane; not a landlord prospect |
| `unknown_form` | Building and occupancy evidence are insufficient | Discovery only |

### 3.2 Approved denominator hierarchy

Use the first reliable denominator available and retain its provenance:

1. building rentable building area and tenant leased square feet;
2. building occupied square feet and user occupied square feet;
3. independently documented suite count only when suites are reasonably comparable;
4. rent or NOI share only when a rent roll or equivalent source supports it.

Parcel area, employee count, NPI count, appointment volume and number of website practitioners are not valid
occupancy denominators. A single address or suite number does not prove single tenancy.

### 3.3 Metrics

```text
user_area_share = verified_user_sf / verified_building_rba
user_rent_share = verified_user_annual_base_rent / verified_building_annual_base_rent
user_noi_share  = verified_user_noi_contribution / verified_building_noi
```

The classification uses area share by default. Rent or NOI share may support the dominant-user test only when
area is unavailable and the financial denominator is complete. Record which test qualified the candidate.

### 3.4 Evidence ladder

| Tier | Evidence examples | Permitted conclusion |
|---|---|---|
| 1 | Executed lease, rent roll, OM, appraisal, owner statement | Confirmed occupancy and economics |
| 2 | Assessor/building record plus official location floor/suite information | Confirmed building denominator; probable user share |
| 3 | Current listing, broker package, reputable property database | Probable classification with source date |
| 4 | Aerial/street imagery, map POIs, directory pages | Research cue only |

No candidate becomes `stnl_confirmed` or `dominant_user_confirmed` from Tier 4 evidence alone.

## 4. Owner and landlord client model

Resolve four parties separately: operating entity, lease guarantor, record owner and true owner/sponsor. Reuse
the LCC owner-resolution subsystem; do not treat a property LLC, operator affiliate or listing broker as the
ultimate client without evidence.

### 4.1 Addressability states

- `third_party_landlord_confirmed`: record/true owner is unaffiliated with the operator.
- `third_party_landlord_probable`: ownership appears unaffiliated but affiliate resolution is incomplete.
- `operator_affiliate_owner`: title owner resolves to the operator/health system or controlled affiliate.
- `developer_or_master_landlord`: a developer, ground lessor or master landlord controls the relationship.
- `ownership_unresolved`: title or true-owner chain is not reliable enough to target.

### 4.2 Client-opportunity score (100 points)

| Component | Points | Examples |
|---|---:|---|
| Real-estate form | 30 | STNL 30; confirmed dominant user 25; probable dominant user 15 |
| Third-party landlord clarity | 20 | Resolved owner/sponsor and non-affiliation |
| Transaction/advisory trigger | 20 | Lease expiry, debt maturity, development completion, portfolio event, ownership duration |
| Contactability | 10 | Verified owner decision-maker or existing relationship |
| Economic insight quality | 15 | Reconciled facility economics with medium/high confidence |
| Data freshness | 5 | Critical evidence current within its source-specific freshness window |

Keep component scores visible. A candidate cannot enter the core 200 merely because a high score compensates
for failed clinical validity or an unaddressable real-estate form.

## 5. Dialysis-grade facility economics

The dialysis implementation establishes the minimum analytical depth to carry forward:

- treatments/patient volume and stations or capacity;
- payer mix and trade-area context;
- estimated annual revenue, profit, EBITDA/operating profit and margin;
- confidence and estimate source;
- source-breakdown and trend context; and
- property/lease economics connected to the operating model.

Relevant repository precedents include `v_clinic_financial_overview`, `clinic_financial_estimates`, the dossier
standard and the payer-mix/operations loaders. The healthcare lane should reuse their provenance discipline,
not blindly reuse dialysis assumptions.

### 5.1 Healthcare economics fact families

| Family | Examples | Treatment |
|---|---|---|
| Observed operations | visits, infusions, treatments, chairs/bays, machines, hours, clinicians | Store observation, period and source |
| Reimbursement drivers | service mix, payer mix, site-of-care, drug vs administration revenue | Specialty-specific; no dialysis proxy |
| Facility revenue | observed or modeled net patient/service revenue | Preserve gross-to-net assumptions |
| Facility contribution | contribution profit before shared corporate overhead | Distinguish from EBITDA |
| Facility EBITDA | site EBITDA after allocated operating expenses | Preserve allocation method |
| Occupancy economics | rent, rent/SF, occupancy cost, landlord obligations, TI/amortization | Lease/property sourced |
| Coverage metrics | EBITDAR/rent, EBITDA/rent, occupancy-cost ratio | Only when numerator definitions align |
| Capital intensity | equipment, shielding, backup power, clean-room or infusion build-out | Supports renewal/stickiness analysis |

### 5.2 Required calculation contract

Every estimate must retain:

- `metric_name`, `metric_value`, `currency`, `period_start`, `period_end` and `months_covered`;
- observed, derived or modeled status;
- source artifact and field-level provenance;
- methodology/model version;
- low/base/high range where assumptions are material;
- confidence score and reason codes;
- facility, operator and property linkage confidence; and
- supersession/reconciliation state.

Do not publish a single-point EBITDA when volume, reimbursement or expense assumptions lack an approved range.

### 5.3 Reconciliation before display

The dialysis dossier audit documented a property with materially conflicting revenue paths, including an
implausible denormalized value. Healthcare must therefore apply these controls before any economics appear in
a dossier, comp or owner pitch:

1. choose a canonical estimate by source priority, period comparability and confidence—not merely latest row;
2. compare independent estimates and flag material divergence;
3. enforce specialty-specific physical and financial plausibility bounds;
4. suppress unreconciled figures rather than averaging conflicts;
5. show the range, confidence and principal assumptions beside every modeled result; and
6. prohibit property-level denormalized values from overriding a reconciled facility-economics record.

Initial divergence gate: manual review when two credible annual revenue or EBITDA estimates differ by more
than 20% or when margin/coverage falls outside specialty-specific bounds. Calibrate this threshold from the
private sample before production use.

## 6. Competitive products enabled

The economics layer should directly support brokerage and advisory work:

- owner dossiers explaining tenant health, facility productivity, rent burden and renewal stickiness;
- lease-renewal and rent-reset advice grounded in site economics rather than tenant credit alone;
- sale positioning that distinguishes durable site performance from system-level credit;
- buyer underwriting ranges with transparent evidence and uncertainty;
- portfolio surveillance for volume, margin, reimbursement, ownership and lease-event changes;
- development/site-selection analysis comparing unmet demand, capacity and site-of-care economics; and
- operator/landlord relationship maps that turn discovery into an addressable business-development plan.

These are advisory indicators, not audited financial statements or investment guarantees. Outputs must carry
source dates, confidence, methodology version and an internal-use/verification notice until approved for a
specific external product.

## 7. Pilot analysis and decision gates

### 7.1 Add to the 50-record private verification sample

For every sampled facility, collect:

- building form and parcel/building match;
- building RBA and source;
- user occupied SF or approved proxy and source;
- calculated share and denominator type;
- STNL/dominant/minority/campus/unknown classification;
- record owner, true owner/sponsor and operator-affiliation result;
- landlord addressability state;
- available operational/economic facts and their source classes; and
- research time required per record.

### 7.2 Pilot gates

The oncology/infusion lane should not advance to a 200-property commercial cohort unless the private sample
demonstrates:

1. clinical corroboration precision >= 90%;
2. real-estate form can be classified for >= 80% of sampled candidates;
3. at least 50% of classifiable candidates are STNL or dominant-user assets;
4. at least 60% of qualifying assets have a resolved or probably resolvable third-party landlord/client path;
5. economics-source coverage is sufficient to create at least a bounded low/base/high model for >= 50% of
   qualifying assets; and
6. median manual research time is operationally acceptable for scaling.

These are initial go/no-go thresholds. Report the actual distribution; do not tune the sample to force a pass.

If the majority of valid facilities are minority suites in multi-tenant MOBs, do not force oncology/infusion
into the dialysis STNL playbook. Either narrow the operator/modality cohort, reposition the lane toward dominant
users and portfolio landlords, or select a healthcare specialty with stronger real-estate addressability.

## 8. Data model boundary

Design the following private, versioned concepts for later Phase B review:

- `facility_real_estate_observations`
- `facility_occupancy_estimates`
- `facility_owner_affiliations`
- `facility_operating_metrics`
- `facility_economic_estimates`
- `facility_economic_assumptions`
- `facility_economic_reconciliations`
- `healthcare_commercial_scores`

They belong in the private `healthcare_discovery` boundary until promotion is approved. Views must not expose
provider-level or owner-level data through the Supabase Data API by default. No DDL is authorized by this plan.

## 9. Recommended build sequence

1. Complete Phase A0 safety rails with synthetic data.
2. Add the real-estate/economics fields to the private 50-record review protocol before selecting the sample.
3. Build a source-availability matrix by modality for occupancy, ownership, operations and economics.
4. Run the private NPPES profile and draw the stratified sample without optimizing for property form.
5. Measure actual STNL/dominant-user prevalence and landlord addressability.
6. Select the first economic model only after the sample identifies the most common facility archetype and
   available operating facts.
7. Recreate the dialysis reconciliation/provenance controls for that archetype.
8. Approve the 200-property commercial cohort only after the clinical, property, owner and economics gates pass.
9. Design LCC dossiers, owner worklists and Salesforce promotion as separately governed products.

## 10. Immediate recommendation

Proceed with Phase A0 and amend the 50-record protocol now. Do not assume oncology/infusion is predominantly
single tenant. Make the observed property-form distribution and third-party-landlord rate the first business
feasibility result, and make economics-source coverage the second. Those results should determine whether this
specialty deserves the full build or whether another outpatient modality offers a better brokerage market.
