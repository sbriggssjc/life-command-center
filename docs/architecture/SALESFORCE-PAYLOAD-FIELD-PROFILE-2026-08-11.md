# Salesforce Payload Field Profile

**Profile date:** 2026-08-11
**Source:** LCC Opps `public.sf_sync_log.payload` plus repository flow/runbook contracts
**Method:** Read-only key/type profiling; no client, contact, property, or transaction values retained
**Status:** Observed production payload contract; not a substitute for Salesforce describe metadata

## What this profile proves

The production ledger contains current Salesforce payloads for five commercial-real-estate object families. The
payload keys below are actual field/API names observed in production JSON. JSON types are transport observations,
not authoritative Salesforce data types. Requiredness, writability, lookup targets, picklists, record types, field
labels, validation rules, and object API names still require Salesforce metadata/describe evidence.

| LCC classification | Ledger rows | Distinct sampled keys | Custom-field keys | Latest ledger activity |
|---|---:|---:|---:|---|
| Companies | 148,004 | 199 | 154 | 2026-08-11 |
| Properties | 59,141 | 121 | 106 | 2026-08-11 |
| Comps | 57,952 | 152 | 138 | 2026-08-11 |
| Listings | 17,747 | 235 | 222 | 2026-08-11 |
| Deals | 6,423 | 242 | 211 | 2026-08-11 |

Counts are point-in-time production observations. Key counts come from a database sample and should be treated as
a lower bound if a rare field did not occur in the sample.

## Core production field families

### Companies

Observed identity and hierarchy fields include `Id`, `sf_id`, `Name`, `Name_sjc__c`, `CompanyName_sjc__c`,
`ParentId`, `sfdc_Company_ParentCompanyName__c`, `OwnerId`, `RecordTypeId`, `sfdc_Company_RecordTypeName__c`,
`Type`, `Org_Type_sjc__c`, `Org_Sub_Type_sjc__c`, `Entity_Type_sjc__c`, `Industry`, `Company_Address__c`,
`ShippingStreet`, `ShippingCity`, `ShippingState`, `ShippingCountry`, `Company_Phone__c`, and
`Company_URL_sjc__c`.

Observed brokerage/relationship fields include `CM_Relationship__c`, `D_E_Relationship__c`,
`MF_Relationship__c`, `Relationships_Status__c`, `Is_Buyer_sjc__c`, `Is_Seller_sjc__c`,
`Property_Type_Focus__c`, `Property_Types__c`, `Property_Subtypes__c`, `Property_Specific_Uses__c`,
`Property_Tenants__c`, and geographic preference/portfolio rollups.

### Properties

Observed identity/location fields include `Id`, `Legacy_SJC_Id__c`, `Legacy_CPX_Id__c`, `Name`, `Address__c`,
`Street__c`, `City__c`, `State_Province__c`, `Zip_Code__c`, `County__c`, `Country__c`, `Property_Location__c`,
`CBSA_Code__c`, `CBSA_Title__c`, and `Metro_Name__c`.

Observed classification and physical fields include `Property_Type__c`, `Property_Sub_Type__c`,
`Property_Type_Sub_Type__c`, `Primary_Use__c`, `Specific_Use__c`, `Tenancy__c`, `Tenant_Names__c`,
`Total_Building_SF2__c`, `Total_Rentable_Sq_Ft__c`, `Rentable_Square_Footage__c`, `Land_Size_Acres__c`,
`Year_Built__c`, `Year_Refurbished__c`, `Construction_Status__c`, and `Drive_thru__c`.

Observed lease/transaction summary fields include `Active_Leases__c`, `Annual_Rent__c`, `NOI__c`,
`Lease_Term_Remaining__c`, `Last_Cap_Rate__c`, `Last_Comp__c`, `Last_Comp_Type__c`, `Last_Sold_Date__c`,
`Last_Sold_Price__c`, and `Price_SF__c`. These appear to be CRM summaries or rollups and should not displace the
specialty databases as the authoritative lease or transaction fact store.

### Comps

Observed core fields include `Id`, `Name`, `Property__c`, `Deal__c`, `Address__c`, `City__c`, state/ZIP fields,
`Building_SF__c`, `Sale_Date__c`, `Comp_Price__c`, `Price_per_SF__c`, `Comp_Cap_Rate__c`, `Cap_Rate__c`,
`Cap_Rate_Formula__c`, `Comp_LTR__c`, `Annual_Rent__c`, `NOI__c`, `Comp_Type__c`, `Comp_Source__c`,
buyer/seller company/contact fields, tenant fields, and property-use fields.

### Listings

Observed core fields include `Id`, `Name`, `Property_sjc__c`, `Property_ID__c`, `Property_Name__c`,
`Property_Address__c`, `Street_Address_sjc__c`, city/state/ZIP fields, `Property_Type_sjc__c`,
`Property_Subtype__c`, `Property_Use_Search_sjc__c`, asking-price/cap-rate fields, `RCM_NOI__c`,
`RCM_Lease_Type__c`, `RCM_Tenancy_Type__c`, `RCM_First_Broadcast_Date__c`, `On_Market_Date__c`,
seller-company fields, and website/search presentation fields.

### Deals

The production sample contains the broadest contract here: 242 observed keys, including identity, property,
company, deal-team, stage/status, dates, pricing, cap-rate, property-type/subtype, tenant, buyer, seller,
commission, and relationship fields. Repository code separately confirms active use of `Deal_Type__c`,
`City_sjc__c`, `State_sjc__c`, `Tenant_Names_sjc__c`, `Property_Type__c`, `Property_Type_Subtype__c`,
`Seller_Company_sjc__c`, `Buyer_Company_sjc__c`, `Deal_Price__c`, `Closing_Cap_Rate_sjc__c`, and
`Direct_Co_Broke_sjc__c`.

## Design implications

1. The production payload ledger is sufficient to build the read-side field dictionary for the five mirrored
   object families without a temporary Power Automate exploration flow.
2. LCC classifications such as `Companies` and `Deals` are not proven Salesforce object API names. Record IDs,
   URLs, flow queries, or Salesforce describe metadata must establish the underlying object names.
3. Salesforce already carries useful facility classification fields (`Property_Type__c`, subtype, primary use,
   specific use), but the outpatient-healthcare model should use an LCC multi-valued taxonomy rather than depend
   on one CRM picklist.
4. CRM summary fields for rent, NOI, cap rate, lease term, and last sale are useful projections. Specialty
   databases remain authoritative for underwritten and sourced lease/transaction facts.
5. The next lane can reuse the existing Property/Company/Deal/Listing/Comp graph. It needs additive
   healthcare-facility classification and specialty facts, not a new CRM object universe.

## Remaining Salesforce evidence request

One Salesforce metadata/describe export is still required to close the write-side contract. It should provide:

- actual object API name and label for each of the five LCC classifications;
- field label, API name, Salesforce data type, length/precision, requiredness and writability;
- lookup/master-detail targets and relationship names;
- record types, picklist values, dependent-picklist rules and validation rules;
- create/update permissions available to the Power Automate Salesforce connection.

No Power Automate flow should be created merely to rediscover the payload keys listed here.
