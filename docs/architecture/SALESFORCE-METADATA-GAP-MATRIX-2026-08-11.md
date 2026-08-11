# Salesforce Metadata Gap Matrix

**Status:** Design input
**Date:** 2026-08-11
**Scope:** Outpatient-healthcare lane and shared Salesforce contracts

## 1. Conclusion

The July 21 Object Manager export and the August 11 production-payload profile already establish the core
Salesforce read contract. A new full schema workbook is not required before cohort discovery.

The retained catalog establishes 17 detailed objects, 2,818 fields and the core relationship graph. The five
mirrored commercial families resolve to `Account`, `Property__c`, `Comp__c`, `Listing__c` and `Opportunity`.
It also covers `Contact`, `Task`/`Event`, `Lease__c`, `Tenant__c`, ownership and the listing/comp child objects.

The remaining request should be a narrow write-governance supplement, not another broad Object Manager export.

## 2. Evidence coverage

| Metadata element | Existing evidence | Status | Needed action |
|---|---|---|---|
| Object label and API name | `03_salesforce_schema_catalog.json` | Covered for 17 detailed objects | None for pilot discovery |
| Field label and API name | Catalog plus production payload profile | Covered | Reconcile only fields selected for a write contract |
| Field data type/size | Catalog | Covered | Verify only proposed writable fields |
| Lookup/master-detail target | Catalog relationships | Covered | Validate relationship names if SOQL child traversal is used |
| Observed production use | `sf_sync_log.payload` profile | Covered for five mirrored families | Refresh profile only after material payload change |
| Picklist values | Not present in workbook | Open | Export active/inactive values and dependencies for the priority fields below |
| Record types | IDs/names observed in payloads, definitions absent | Open | Export record-type definitions and object assignments |
| Validation rules | Not present | Open | Export active rules for objects receiving writes |
| Create/update flags | Not present | Open | Obtain describe output for proposed write fields |
| Connection-user permissions | Not present | Open | Capture object/field permissions for the Power Automate connection user |
| Formula/calculated status | Partly represented by field type | Mostly covered | Confirm only where a proposed projection might mistakenly target a formula |

## 3. Priority metadata supplement

### Tier 1 — required before the pilot writes anything to Salesforce

| Object | Fields/rules | Why |
|---|---|---|
| `Property__c` | `Property_Type__c`, `Property_Sub_Type__c`, `Primary_Use__c`, `Specific_Use__c`; their controlling/dependent values; record types; active validation rules | Existing CRM classification is hierarchical and dependent. The healthcare taxonomy must project into it without inventing invalid combinations. |
| `Account` | `Property_Type__c`, `Property_Type_Focus__c`, organization type/subtype fields; record types; active validation rules | Operator and buyer/seller routing may use these fields, but LCC must not overwrite broader relationship preferences. |
| `Contact` | `BP_Healthcare_Property_Use_Type_sjc__c`, healthcare price/cap-rate preference fields; record types and FLS | Salesforce already contains healthcare buyer-preference fields that can support commercial prioritization. |
| `Opportunity` | stage/status/deal-type fields, property lookup, record types and active validation rules | Needed only if the pilot creates or updates a governed pursuit. |
| Power Automate connection user | object CRUD and field-level read/create/update permissions for the four objects above | Field metadata alone does not prove the deployed connection can perform the intended operation. |

### Tier 2 — required before comp/listing projections are written

- `Comp__c`: `Property_Type__c`, `Primary_Use__c`, `Specific_Use__c`, `Comp_Type__c`,
  `Validation_Status__c`, `Status__c`, `Rent_Type__c` and `Escalation_Type_New__c` values and dependencies.
- `Listing__c` and `Listing_Property__c`: relevant status, property-type/subtype/specific-use values, record types
  and validation rules.
- `Lease__c` and `Tenant__c`: only the fields selected for a future governed projection.

Tier 2 is not a blocker for discovery, identity resolution, classification or cohort scoring.

## 4. Healthcare-relevant fields already proven

The schema catalog already confirms:

- `Property__c` has dependent picklists for Property Type, Property Subtype/Primary Use and Specific Use.
- `Comp__c` carries the same three-level classification pattern plus tenant and transaction facts.
- `Listing_Property__c` carries property type, subtype and specific-use picklists.
- `Contact` contains healthcare-specific acquisition preferences:
  `BP_Healthcare_Property_Use_Type_sjc__c`, healthcare price minimum/maximum and healthcare cap-rate
  minimum/maximum.
- `Account` contains property-type focus and property-specific-use summaries.
- `Opportunity` and `Listing__c` expose formula projections of property type/subtype/specific use.

These fields are useful discovery and ranking signals. They are not the canonical multi-dimensional healthcare
taxonomy.

## 5. Minimal self-service collection

Collect one compact package from Salesforce rather than repeating the full workbook:

1. Export the active and inactive values for the Tier 1 picklists, including controlling/dependent mappings.
2. Export record types for `Property__c`, `Account`, `Contact` and `Opportunity`.
3. Export active validation rules for those four objects.
4. Run describe metadata for only the proposed projection fields and retain `createable`, `updateable`,
   `nillable`, calculated/formula and relationship attributes.
5. Capture the Power Automate connection user's object and field permissions for the same fields.

Save raw output under `private/salesforce/metadata/production/<capture-date>/`. Commit only a sanitized field
contract derived from it.

## 6. Decision

Proceed now with read-only oncology/infusion cohort discovery. Block Salesforce writes until Tier 1 is complete
and the CRM owner approves the minimal projection contract.
