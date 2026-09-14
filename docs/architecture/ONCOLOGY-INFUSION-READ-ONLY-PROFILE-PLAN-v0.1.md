# Oncology / Infusion Read-Only Profile Plan v0.1

**Status:** Executed; see linked result
**Date:** 2026-08-11
**Cohort contract:** `ONCOLOGY-INFUSION-PILOT-COHORT-SPEC-v0.1.md`

## 1. Objective

Measure how much of the oncology/infusion discovery universe can be found and commercially enriched from
existing LCC and Salesforce evidence before adding a new source adapter or schema.

The first run returns aggregate counts, coverage and collision rates. It does not persist candidates, create
review tasks or update Salesforce.

## 2. Database boundaries

| Project | Read purpose | Prohibited in profile run |
|---|---|---|
| LCC Opps | Salesforce payload ledger, entities, external identities, relationships, unified contacts and activity/relationship signals | inserts, updates, task creation, merges or identity links |
| Dialysis (`dia`) | Existing property, lease, sale, listing and clinic/address evidence that may overlap outpatient healthcare | reclassifying dialysis records or treating `medicare_clinics` as oncology evidence |
| Government (`gov`) | Property/address and transaction overlap only | changing government-domain classifications |

Cross-project matching is performed in the profiling process through exported ID/address keys or existing
approved read surfaces. Do not create a cross-database write path for this profile.

## 3. Candidate signals

### Salesforce payload signals

Search the latest retained payload per Salesforce record across the relevant object families. Use case-folded,
trimmed token matching over classification, name and tenant/operator fields.

| Family | Priority fields |
|---|---|
| Property | `Property_Type__c`, `Property_Sub_Type__c`, `Primary_Use__c`, `Specific_Use__c`, `Tenant_Names__c`, `Name`, address fields |
| Company | `Name`, organization type/subtype, `Property_Types__c`, `Property_Subtypes__c`, `Property_Specific_Uses__c`, `Property_Tenants__c` |
| Contact | healthcare use-type and acquisition preference fields from the schema catalog; relationship/activity linkage only, not facility evidence |
| Comp | property type/subtype/specific use, tenant fields, `Property__c`, transaction and verification fields |
| Listing | property type/subtype/specific use, tenant fields, property lookup, listing status and market date |
| Deal | property type/subtype/specific use, tenant fields, property/company links, stage/status and close/transaction fields |

### Initial discovery vocabulary

Use these tokens as recall-oriented discovery signals, not final classifications:

- oncology, oncologist, cancer center, cancer care;
- infusion, infusion center, infusion therapy, IV therapy;
- hematology oncology, hematology/oncology, hem-onc;
- radiation oncology, radiotherapy, radiation therapy;
- chemotherapy, immunotherapy.

Terms such as `medical`, `clinic`, `therapy`, `treatment center` or `cancer` alone are insufficient for automatic
specific-use classification. They may expand the review set only when paired with another supported signal.

## 4. Latest-record rule

The payload ledger may contain many observations per Salesforce record. Profile only the latest successful
observation per `(object_family, Salesforce record ID)` as of a declared freeze timestamp. Report records that
cannot be assigned an object family or record ID; do not silently count every ledger row as a facility.

## 5. Aggregate outputs

The first run must report:

1. distinct candidate Salesforce records by object family and matched field;
2. distinct normalized addresses and Salesforce property IDs;
3. candidates with direct `Property__c` links versus address-only candidates;
4. candidates with Account/Tenant/operator evidence;
5. candidates with Contact relationship/preference evidence;
6. candidates with Comp, Listing, Deal or Lease evidence;
7. candidates with existing LCC `external_identities` links;
8. unique property resolutions, no-match cases and multi-match collisions;
9. modality token distribution;
10. state and metro distribution;
11. operator/parent concentration where the hierarchy is already resolved;
12. evidence freshness buckets and records with no usable observation date.

No PII or client record values belong in the committed profile report. Retain raw candidate extracts privately.

## 6. Resolution order

Resolve candidate records in this order:

1. existing Salesforce Property ID linked through `external_identities`;
2. existing Salesforce-to-domain property mapping;
3. exact normalized address plus ZIP;
4. exact normalized address plus city/state with geocode corroboration;
5. fuzzy address candidates routed to review only.

Never auto-link on facility/operator name alone. A multi-match at any trusted stage remains unresolved until
reviewed.

## 7. Field-coverage metrics

For each candidate family, measure nonblank coverage for:

- stable Salesforce record ID;
- property lookup and street/city/state/ZIP;
- property type/subtype/specific use;
- tenant/operator name or ID;
- record type and status;
- comp/listing/deal dates and commercial measures;
- source observation timestamp;
- existing entity/property bridge.

These metrics decide whether the next increment should be a source adapter, a resolver improvement or simply a
controlled-vocabulary mapping.

## 8. Safe execution pattern

1. Declare a freeze timestamp and generate a run ID.
2. Execute read-only queries with explicit row caps and pagination; account for the PostgREST 1,000-row cap.
3. Store raw extracts only in the Git-ignored private profile directory.
4. Hash the extract files and record query versions for reproducibility.
5. Produce a sanitized aggregate Markdown report.
6. Review counts and collision rates before generating row-level cohort candidates.
7. If approved, generate a private scored candidate file; still make no production writes.

## 9. Stop/go decisions after the profile

| Result | Decision |
|---|---|
| At least 400 eligible candidates and at least 60% have unique property resolution | Proceed to scoring and 200-property cohort selection |
| Candidate volume is adequate but property resolution is below 60% | Improve address/property resolution before adding sources |
| Fewer than 400 candidates but commercial linkage is strong | Add one bounded authoritative facility source and re-profile |
| Fewer than 200 credible candidates or weak commercial linkage | Narrow the pilot to selected operators/markets or stop |
| Relationship/preference fields materially rank the set | Include relationship score in cohort selection |
| Relationship fields are sparse | Keep them as bonus evidence; do not penalize otherwise strong facilities |

## 10. Verification checklist

- Read-only credentials or transaction mode used.
- Zero rows inserted, updated, deleted or merged.
- Latest-record deduplication verified on a sample.
- Aggregate counts reconcile to distinct record IDs, not ledger events.
- Address normalization version recorded.
- Ambiguous matches remain unresolved.
- Raw values remain private; committed output is aggregate and sanitized.

## 11. Result

The 2026-08-11 aggregate run failed the existing-source sufficiency gate. See
`ONCOLOGY-INFUSION-READ-ONLY-PROFILE-RESULT-2026-08-11.md`. The approved next design increment is a bounded CMS
NPPES Version 2 discovery adapter; no cohort or production records were written.
