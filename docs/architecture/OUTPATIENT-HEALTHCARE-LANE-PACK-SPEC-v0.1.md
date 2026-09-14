# Outpatient Healthcare Lane Pack Specification v0.1

**Status:** Architecture draft
**Date:** 2026-08-11
**Initial commercial pilot:** Oncology / infusion
**Parallel adjacency test:** Plasma donation

## 1. Purpose

Add outpatient-healthcare intelligence to the existing LCC federation without creating a fourth Supabase project,
duplicating identity/document/workflow infrastructure, or making Power Automate a domain-write layer.

The lane pack extends existing LCC Property, Company, Deal, Listing, Comp, document, identity, relationship,
provenance and workflow contracts. Specialty facts are additive and source-attributed.

## 2. Lane-pack components

| Component | Shared LCC capability reused | Healthcare addition |
|---|---|---|
| Identity | `entities`, external identities, relationships, property mappings | provider, operator, brand, parent, health-system and management-company roles |
| Property | existing canonical property and Salesforce Property mirror | multi-valued facility-use classifications and healthcare physical attributes |
| CRM | Companies, Properties, Deals, Listings, Comps and activities | specialty tags, pursuit views and lane routing; no new object universe initially |
| Documents | shared discovery, version, checksum, extraction and provenance | healthcare source/document types and specialty extraction schema |
| Workflow | activities, dossiers, tasks, governed actions and Salesforce queue | lane-specific qualification, review and underwriting stages |
| Domain facts | specialty-owned facts projected into LCC | healthcare facility, operator, license/provider and modality facts |

## 3. Multi-dimensional facility taxonomy

A property may have several classifications at the same time. Store classifications as effective-dated,
source-attributed facts rather than a single mutually exclusive `property_type` value.

### Required dimensions

1. **Care setting:** outpatient, ambulatory, office-based, retail-based, hospital-affiliated, freestanding.
2. **Primary service family:** primary care, urgent care, surgery/procedural, imaging, oncology/infusion,
   dialysis, plasma collection, federal/community clinic, other outpatient.
3. **Specific use:** multispecialty clinic, urgent care, ASC, endoscopy, MRI/CT, radiation oncology,
   medical oncology, infusion therapy, FQHC, VA CBOC, plasma donation and future controlled terms.
4. **Treatment modality:** consultation, infusion, injection, imaging, radiation, surgery, endoscopy,
   lab/collection and other governed values.
5. **Operating model:** single-tenant, multi-tenant, hospital outpatient department, physician group,
   joint venture, management-services organization, franchise/licensed brand where applicable.
6. **Regulatory/accreditation:** license type, certification, accreditation, provider identifier and status.
7. **Physical intensity:** standard medical office, specialized plumbing, high electrical load, shielding,
   gases, clean/sterile procedure, generator/redundancy, chair/bay/room capacity and equipment intensity.

### Classification fact contract

Each classification requires:

- canonical property ID;
- taxonomy dimension and controlled value;
- primary/secondary indicator where applicable;
- source and evidence pointer;
- observed/effective dates;
- confidence and verification state;
- supersession/tombstone behavior;
- lane-pack version that produced the classification.

## 4. Shared versus specialty facts

### Shared canonical facts

- property identity, address, geocode and aliases;
- organization/person identities and relationships;
- Salesforce IDs and CRM-owned process fields;
- document identity, version, checksum, source and permissions;
- ownership, lease, transaction and listing projections with source authority preserved;
- workflow, review, provenance, synchronization and governed-action state.

### Outpatient-healthcare specialty facts

- facility-use classifications and modality;
- operator, brand, parent, provider group and health-system roles;
- license/certification/accreditation/provider identifiers;
- chair, bay, procedure-room or equipment capacity where available;
- service-line and specialized-buildout attributes;
- reimbursement/referral dependency indicators where legally and practically supportable;
- healthcare-specific source coverage, freshness and confidence.

## 5. Salesforce contract

The production payload already exposes reusable fields such as `Property_Type__c`, property subtype/use fields,
tenant names, company hierarchy/type, deal type/stage/pricing, listing facts and comp facts. Use these as CRM
projections and routing inputs.

Do not make one Salesforce picklist the healthcare taxonomy authority. LCC retains the multi-dimensional
classification facts; Salesforce receives only the minimal broker-usable specialty label(s), qualification status
and governed pursuit fields approved by the CRM owner.

No new Salesforce custom object is required for the pilot unless the metadata review proves the existing graph
cannot support broker workflow or reporting.

## 6. Pilot cohort

### Oncology / infusion commercial pilot

- 150–300 properties.
- Two to four markets, or a bounded set of operators/clients with commercial relevance.
- Include freestanding and medical-office oncology/infusion locations.
- Separate medical oncology/infusion, radiation oncology and mixed locations in the taxonomy.
- Exclude hospital-campus records that cannot be resolved to an addressable leased facility for the initial proof.

### Plasma adjacency test

- Build a bounded facility/operator universe.
- Test property identity, operator hierarchy, public-source refresh and healthcare classification contracts.
- Do not require the full underwriting/commercial workflow unless pipeline evidence supports promotion to a lane.

## 7. Pilot workflow

1. Ingest/refresh bounded facility sources through shared intake contracts.
2. Resolve property and operator identities against LCC, Salesforce and specialty mappings.
3. Apply multi-dimensional classifications with evidence and confidence.
4. Link ownership, leases, sales, listings, documents, contacts and activities already present in the federation.
5. Route ambiguous identity/classification cases to review.
6. Produce broker-facing property/operator profiles, pursuit lists and comparable evidence.
7. Queue only governed CRM changes; Power Automate transports approved writes.
8. Measure quality, time saved, commercial use and incremental operating cost.

## 8. Acceptance gates

| Gate | Pilot threshold |
|---|---|
| Property identity | At least 95% unique canonical-property resolution in reviewed cohort |
| Operator hierarchy | At least 90% correct operator/parent mapping in reviewed golden sample |
| Evidence | Every specialty fact has source, observed date and confidence/verification state |
| Workflow | Review exceptions are visible, assignable and replay-safe |
| CRM | No ungoverned direct canonical writes from Power Automate |
| Commercial | At least one live assignment or documented qualified opportunity, or a clear stop decision |
| Cost | No new recurring subscription during the pilot; measured incremental compute/model cost |
| Architecture | No new database and no duplicated identity/document/activity stack |

## 9. Decisions still required before build

1. Name the business sponsor and select the oncology/infusion cohort.
2. Approve the first controlled taxonomy values and ownership of taxonomy changes.
3. Resolve the canonical LCC person/contact ID transition.
4. Complete the Tier 1 Salesforce metadata supplement defined in
   `SALESFORCE-METADATA-GAP-MATRIX-2026-08-11.md`; the retained schema catalog already covers object names,
   field names/types and the core relationship graph.
5. Classify the three potential duplicate/legacy Power Automate flows by GUID before cleanup.
6. Complete the Power Automate security-remediation gate for embedded credentials and permissive request triggers.
7. Decide the LCC-owned endpoint location for shared Salesforce file/object routing now hosted through specialty infrastructure.

## 10. Definition of done for lane-pack v1

The lane is operational only when its taxonomy, source adapters, contracts, review workflow, projections, tests,
runbooks, authority assignments, security controls and cost measurements are all versioned in the LCC repository.
Source code alone is not a completed lane pack.

## 11. Linked next-stage specifications

- `SALESFORCE-METADATA-GAP-MATRIX-2026-08-11.md` narrows the remaining Salesforce request to picklists,
  record types, validation rules, writability and connection-user permissions.
- `ONCOLOGY-INFUSION-PILOT-COHORT-SPEC-v0.1.md` defines the recommended 200-property cohort, scoring,
  exception handling, review sample and read-only profiling step.
- `ONCOLOGY-INFUSION-READ-ONLY-PROFILE-RESULT-2026-08-11.md` records the failed existing-source sufficiency gate.
- `ONCOLOGY-INFUSION-NPPES-SOURCE-ADAPTER-SPEC-v0.1.md` defines the bounded national facility seed required
  before cohort selection.
