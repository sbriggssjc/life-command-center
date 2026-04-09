# Claude Code Prompt: LCC Sidebar Data Pipeline — Backend Integration

> Use this prompt when working on the dialysis or government Supabase backends
> to ensure data captured by the LCC browser extension gets cleaned, routed,
> and propagated to the appropriate domain databases.

## What the LCC Sidebar Captures

The LCC browser extension runs as a Chrome side panel alongside CoStar, LoopNet,
CREXi, county assessor sites, and other CRE data sources. When a user browses a
property record, the extension extracts structured data from the page and saves it
to the LCC Opps Supabase database (`xengecqvemvfknjvbvrq`) as an `entities` record
with rich `metadata` JSONB.

The extension accumulates data as the user browses different tabs on the same
property (Summary, Public Records, Contacts, Deed History popup, etc.), merging
new data into the context without losing prior extractions.

## Exact Metadata Structure Saved by the Extension

When the user clicks "Save Property to LCC", the extension calls:
```
POST /api/entities
{
  entity_type: "asset",
  name: "586 Rice St",
  address: "586 Rice St",
  city: "Saint Paul",
  state: "MN",
  asset_type: "property",  // or property_type extracted from source
  description: "Imported from CoStar",
  metadata: { ... }        // ALL rich CRE data below
}
```

After creation, it also links the external identity:
```
POST /api/entities?action=link
{
  entity_id: "<new-entity-uuid>",
  source_system: "costar",     // or "loopnet", "crexi", "public-records"
  source_type: "property",
  external_id: "31-29-22-23-0096",  // parcel number or page URL
  external_url: "https://product.costar.com/detail/sale-comps/..."
}
```

### metadata JSONB shape:

```jsonc
{
  // ── Source tracking ───────────────────────────────────────────
  "source": "costar",                    // "costar" | "loopnet" | "crexi" | "public-records"
  "source_url": "https://product.costar.com/detail/...",
  "extracted_at": "2026-04-09T13:37:22.146Z",

  // ── Financials ────────────────────────────────────────────────
  "asking_price": "$4,300,000",          // string as displayed on source
  "cap_rate": "6.76%",
  "noi": "$274,000",                     // may be null
  "price_per_sf": "$491.43",             // may be null
  "sale_price": "$3,390,952",            // most recent or "Not Disclosed"
  "sale_date": "Mar 27, 2026",

  // ── Building details ──────────────────────────────────────────
  "building_class": "A",
  "year_built": "2019",
  "square_footage": "8,750 SF",
  "lot_size": "0.54 AC",                 // or "23,653 SF"
  "stories": "1",
  "parking": "2.28/1,000 SF",
  "zoning": "CA",
  "occupancy": "100%",
  "ownership_type": "Company Or Corporation",

  // ── Public records ────────────────────────────────────────────
  "parcel_number": "31-29-22-23-0096",
  "assessed_value": "$3,122,800",
  "land_value": "$283,600",
  "improvement_value": "$2,839,200",

  // ── Contacts array ────────────────────────────────────────────
  // Each contact is a person or entity extracted from the property record.
  // Roles: owner, seller, buyer, listing_broker, buyer_broker, lender
  "contacts": [
    {
      "role": "owner",
      "name": "BENIRV CAPITAL LLC",
      "type": "entity",
      "ownership_type": "Company Or Corporation",
      "address": "6436 Penn Ave S, Minneapolis, MN 55423"
    },
    {
      "role": "seller",
      "name": "Benirv Capital LLC",
      "type": "entity"
    },
    {
      "role": "listing_broker",
      "name": "Peter Bauman",
      "type": "person",
      "title": "Senior Managing Director",
      "email": "pbauman@ipausa.com",
      "phones": ["(602) 687-6685", "(602) 370-6020", "(641) 799-2014"],
      "company": "Institutional Property Advisors"
    },
    {
      "role": "listing_broker",
      "name": "Brett Baker",
      "type": "person",
      "title": "Senior Financial Analyst at IPA",
      "email": "bbaker@ipausa.com",
      "phones": ["(602) 687-6700", "(641) 799-2014"]
    },
    {
      "role": "listing_broker",
      "name": "Institutional Property Advisors",
      "type": "person",
      "website": "http://www.institutionalpropertyadvisors.com/"
    }
    // ... more brokers, buyer brokers, lenders
  ],

  // ── Sales history array ───────────────────────────────────────
  // Each entry is a transaction from CoStar's deed/sale records.
  // Includes buyer/seller names + addresses, lender + loan details.
  "sales_history": [
    {
      "is_current": true,
      "sale_date": "Mar 27, 2026",
      "sale_price": "Not Disclosed",
      "asking_price": "$4,300,000",
      "cap_rate": "6.76%",
      "sale_type": "Investment",
      "sale_condition": "Investment Triple Net",
      "hold_period": "86 Months"
    },
    {
      "sale_date": "2/28/2019",
      "sale_price": "$3,390,952",
      "transaction_type": "Resale",
      "deed_type": "Warranty Deed",
      "sale_type": "Arms Length",
      "document_number": "2019.2634483",
      "buyer": "BENIRV CAPITAL LLC",
      "buyer_address": "319 Barry Av S #205, Wayzata, MN 55391",
      "seller": "MSP 2018 LLC",
      "title_company": "Commercial Partners Title Ll"
    },
    {
      "sale_date": "8/30/2018",
      "transaction_type": "Resale w/Financing",
      "deed_type": "Mortgage",
      "sale_type": "Arms Length",
      "document_number": "2018.2622881",
      "buyer": "MSP 2018 LLC",
      "lender": "Minnesota Bank & Trust",
      "loan_amount": "$2,898,500",
      "loan_type": "Commercial",
      "loan_origination_date": "8/30/2018",
      "title_company": "Commercial Partners Title"
    },
    {
      "sale_date": "7/31/2018",
      "sale_price": "$318,788",
      "transaction_type": "Resale",
      "deed_type": "Warranty Deed",
      "sale_type": "Arms Length",
      "document_number": "2018.4723797",
      "buyer": "TERRAIN HOLDINGS LLC",
      "buyer_address": "1215 Town Centre Dr #130, Saint Paul, MN 55123",
      "seller": "NGUYEN LONG MINH",
      "title_company": "Commercial Partners Title Ll"
    }
  ]
}
```

## What the Backend Pipeline Needs to Do

When an entity is created/updated with this metadata, the backend should unpack
and route the data into the correct relational tables. This can happen:
- **Synchronously** on entity creation (in the entities handler), or
- **Asynchronously** via a background job/cron that processes unprocessed metadata, or
- **On-demand** via a copilot action like `process_costar_extraction`

### Step 1: Unpack Contacts → Person/Org Entities + Relationships

For each entry in `metadata.contacts`:

1. **Create or match the contact entity** using `ensureEntityLink()`:
   - `type: "entity"` contacts → `entity_type: "organization"`
   - `type: "person"` contacts → `entity_type: "person"`
   - Match by canonical name (e.g., "BENIRV CAPITAL LLC" → "benirv capital")
   - If person has email, also match by email
   - Set `domain` based on the property's domain classification

2. **Create entity_relationship** linking the contact to the property:
   ```
   from_entity_id: <contact_entity_id>
   to_entity_id: <property_entity_id>
   relationship_type: <mapped from role>
     owner    → 'owns'
     seller   → 'sells'
     buyer    → 'purchases'
     listing_broker → 'brokers'
     buyer_broker   → 'brokers'
     lender   → 'finances'
   metadata: { role, source, extracted_at }
   effective_from: <sale_date if applicable>
   effective_to: <next_sale_date if applicable>
   ```

3. **Store contact details** on the person entity:
   - email, phone, title, company as entity fields
   - Address in entity metadata
   - External identity link to CoStar source

### Step 2: Unpack Sales History → Activity Events

For each entry in `metadata.sales_history`:

1. **Create an activity_event** on the property entity:
   ```
   entity_id: <property_entity_id>
   category: 'system'
   source_type: 'costar_deed_record'
   title: "Sale: $3,390,952 — MSP 2018 LLC → BENIRV CAPITAL LLC"
   occurred_at: <sale_date parsed to timestamp>
   metadata: {
     sale_price, asking_price, cap_rate,
     buyer, buyer_address, seller, seller_address,
     lender, loan_amount, loan_type, loan_origination_date,
     deed_type, transaction_type, sale_type,
     document_number, title_company,
     is_current, source: "costar"
   }
   ```

2. **Create buyer/seller entities** if not already created from contacts:
   - Buyers and sellers in deed records should also become entities
   - Link via entity_relationships with effective dates

3. **Create lender entity** if present:
   - `entity_type: "organization"`, `org_type: "lender"`
   - Link via entity_relationship `relationship_type: "finances"`
   - Store loan_amount, loan_type, origination_date in relationship metadata

### Step 3: Write Signals

After processing, write signals for the learning loop:

```javascript
await writeSignal({
  signal_type: 'entity_extracted_from_email',  // reuse existing type or create new
  signal_category: 'intelligence',
  entity_type: 'asset',
  entity_id: propertyEntityId,
  domain: entity.domain,
  user_id: userId,
  payload: {
    source: metadata.source,
    extraction_type: 'costar_sidebar',
    contacts_created: contactCount,
    sales_recorded: salesCount,
    financial_signals: {
      has_pricing: !!metadata.asking_price,
      has_cap_rate: !!metadata.cap_rate,
      has_noi: !!metadata.noi,
      sale_count: metadata.sales_history?.length || 0
    }
  }
});
```

### Step 4: Domain Classification and Cross-Domain Routing

The property entity needs domain classification:

1. **Check if the property matches a government domain**:
   - Is the tenant a government agency? (GSA, VA, SSA, etc.)
   - Is the asset_type "government_leased"?
   - Does the address match a known government property in the gov database?

2. **Check if the property matches dialysis domain**:
   - Is the tenant a dialysis operator? (Fresenius, DaVita, etc.)
   - Does "dialysis" or "medical" appear in property type or tenant name?

3. **Set entity.domain** accordingly:
   - `'government'` → sync to GOV_SUPABASE
   - `'dialysis'` → sync to DIA_SUPABASE
   - `null` → cross-domain or unclassified (general CRE)

4. **Trigger cross-domain sync** if classified:
   - Push entity + contacts to the appropriate domain database
   - Use the existing sync patterns in `/api/sync.js`

## LCC OPS Database Schema Reference

The canonical LCC Opps database has these key tables:

- **entities** — `id, workspace_id, entity_type (person|organization|asset), name, canonical_name, address, city, state, zip, domain, metadata jsonb, ...`
- **external_identities** — `entity_id, source_system, source_type, external_id, external_url` (UNIQUE on workspace+system+type+id)
- **entity_aliases** — `entity_id, alias_name, alias_canonical` (UNIQUE on workspace+alias_canonical)
- **entity_relationships** — `from_entity_id, to_entity_id, relationship_type, metadata jsonb, effective_from, effective_to`
- **inbox_items** — `status (new|triaged|promoted|dismissed|archived), entity_id, source_type, metadata jsonb, domain`
- **action_items** — `entity_id, action_type, status, owner_id, metadata jsonb, domain`
- **activity_events** — `entity_id, category, title, body, metadata jsonb, source_type, occurred_at, domain`
- **signals** — `signal_type, signal_category, entity_type, entity_id, domain, payload jsonb, outcome`

## Key Patterns to Follow

1. **Use `ensureEntityLink()`** for all entity creation — it deduplicates by canonical name and manages external identity links
2. **Canonical name normalization**: lowercase, strip LLC/Inc/Corp/Ltd suffixes, remove special chars, normalize whitespace
3. **Fire-and-forget for extraction**: Use `processMetadata(...).catch(err => console.error(err))` — never block the API response
4. **Domain routing is explicit**: Set `domain` field on entities, don't infer from table location
5. **External identity UNIQUE constraint**: `(workspace_id, source_system, source_type, external_id)` — prevents duplicate links
6. **Metadata is the staging area**: Raw scraped data lands in metadata first, then gets unpacked into relational records by the pipeline
7. **12 serverless function limit**: Never create new .js files in /api/. Add new logic as sub-routes or in /api/_handlers/ and /api/_shared/

## Acceptance Criteria

After this pipeline is built, saving a property from the CoStar sidebar should result in:

- [ ] Asset entity created with all standard fields populated
- [ ] Entity metadata contains full financial, building, and public records data
- [ ] External identity linked to CoStar (parcel number + URL)
- [ ] Owner entity created (organization) with mailing address, linked via `owns` relationship
- [ ] Seller entity created (organization) with linked via `sells` relationship with effective dates
- [ ] Each listing broker created as person entity with email/phone, linked via `brokers` relationship
- [ ] Broker companies created as organization entities
- [ ] Each historical sale recorded as an activity_event with full metadata
- [ ] Each buyer/seller from deed history created as entity with address
- [ ] Each lender from deed history created as organization entity with loan details in relationship metadata
- [ ] Domain classified (government/dialysis/null) based on tenant and property characteristics
- [ ] Signal written for the learning loop
- [ ] If domain-classified, entity synced to appropriate domain database (gov or dialysis)
