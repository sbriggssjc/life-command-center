# Claude Code Prompts — Lease Provenance & Mailto Fix

---

## Prompt A: Mailto Link Extraction in CoStar Content Script

```
In extension/content/costar.js, the contact extraction uses document.body.innerText 
(around lines 657-813, parsePersonBlocks around lines 892-998). This means emails 
hidden behind mailto: icon links on CoStar are never captured — the innerText only 
sees whitespace where the envelope icon is.

The LoopNet content script (extension/content/loopnet.js lines 387-391) already 
handles this correctly:

    const emailEl = item.querySelector('[href^="mailto:"], [class*="email"]');
    const email = emailEl?.textContent?.replace(/\s+/g, '').trim()
               || emailEl?.href?.replace('mailto:', '').replace(/\s+/g, '') || null;

FIX: Refactor the CoStar contact extraction to use DOM traversal for the Contacts 
tab, not just innerText parsing. Specifically:

1. In the contact extraction section, when processing the Contacts tab, use 
   querySelectorAll to find all contact blocks/cards on the page

2. Within each contact block, look for mailto links:
   const mailtoLinks = block.querySelectorAll('a[href^="mailto:"]');
   mailtoLinks.forEach(link => {
     const email = link.href.replace('mailto:', '').trim();
     if (email && isEmail(email)) contactData.email = email;
   });

3. Fall back to the existing innerText parsing only when DOM querying returns 
   no results (e.g., on older CoStar page layouts)

4. Also extract phone numbers from tel: links the same way:
   const telLinks = block.querySelectorAll('a[href^="tel:"]');

5. Make sure to capture the contact ROLE from the section header 
   (True Buyer, Recorded Buyer, True Seller, Recorded Seller, Listing Broker) 
   so the pipeline knows which role to assign in the contacts table.

Test by navigating to any CoStar sale comp with a Contacts tab and verifying 
that emails behind envelope icons are captured in the extraction payload.
```

---

## Prompt B: Lease Data Provenance Migration (Supabase)

```
Run these migrations on the Dialysis_DB Supabase project (zqzrriwuavgrquhisnoa).
This creates the lease data provenance system for tracking field-level source 
quality. Read the full design doc at:
/Lease_Data_Provenance_Schema_Design.md

MIGRATION 1: expense_structure_canonical table

CREATE TABLE expense_structure_canonical (
  raw_value text PRIMARY KEY,
  canonical text NOT NULL,
  responsibility_defaults jsonb NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

Then INSERT the seed data from the design doc (all 19 raw_value → canonical 
mappings with responsibility_defaults JSONB).

Then:
ALTER TABLE leases ADD COLUMN IF NOT EXISTS expense_structure_canonical text;
UPDATE leases l SET expense_structure_canonical = esc.canonical
FROM expense_structure_canonical esc WHERE l.expense_structure = esc.raw_value;

MIGRATION 2: lease_field_provenance table

CREATE TABLE lease_field_provenance (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lease_id integer NOT NULL REFERENCES leases(lease_id) ON DELETE CASCADE,
  field_name text NOT NULL,
  field_value text,
  source_tier smallint NOT NULL CHECK (source_tier BETWEEN 1 AND 7),
  source_label text NOT NULL CHECK (source_label IN (
    'lease_document','lease_amendment','om_lease_abstract',
    'broker_package','costar_verified','loopnet_listing','inferred'
  )),
  source_file text,
  source_detail text,
  captured_at timestamptz NOT NULL DEFAULT NOW(),
  captured_by text NOT NULL DEFAULT 'manual',
  superseded_at timestamptz,
  superseded_by bigint REFERENCES lease_field_provenance(id),
  notes text
);

CREATE UNIQUE INDEX uix_lfp_active 
  ON lease_field_provenance(lease_id, field_name) 
  WHERE superseded_at IS NULL;
CREATE INDEX ix_lfp_lease ON lease_field_provenance(lease_id, field_name, captured_at DESC);
CREATE INDEX ix_lfp_tier ON lease_field_provenance(source_tier, field_name) WHERE superseded_at IS NULL;

MIGRATION 3: Guard and upsert functions

Create both functions from the design doc:
- should_update_lease_field(p_lease_id, p_field_name, p_new_source_tier) → boolean
- upsert_lease_field(p_lease_id, p_field_name, p_field_value, p_source_tier, 
  p_source_label, p_captured_by, p_source_file, p_source_detail, p_notes) → boolean

MIGRATION 4: Reconciliation views

Create all three views from the design doc:
- v_lease_responsibility_gaps
- v_lease_expense_structure_inconsistencies  
- v_lease_provenance_audit

MIGRATION 5: Seed tier-7 defaults

Run the seed script from the design doc that backfills inferred responsibility 
defaults from the expense_structure_canonical mapping. This gives every lease 
with a known expense structure a starting point for roof/hvac/structure/parking 
responsibility, all at tier 7 (inferred) so they get overwritten by any real data.

After running, verify:
- SELECT COUNT(*) FROM lease_field_provenance; -- should be several thousand
- SELECT * FROM v_lease_responsibility_gaps LIMIT 10;
- SELECT * FROM v_lease_expense_structure_inconsistencies WHERE operator = 'DaVita';
```

---

## Prompt C: Sidebar Pipeline Integration with Provenance Guard

```
In /api/_handlers/sidebar-pipeline.js, the lease upsert logic needs to be 
updated to use the new lease_field_provenance system.

CURRENT BEHAVIOR: The pipeline directly updates leases table columns 
(rent, rent_per_sf, leased_area, expense_structure, etc.) with no source 
quality check. A CoStar scrape can overwrite data that came from an actual 
lease document.

NEW BEHAVIOR: For underwriting-critical fields, call the Supabase 
upsert_lease_field() function instead of direct column updates.

1. Find where leases are upserted in propagateToDomainDbDirect() (step 5c, 
   around the lease upsert section).

2. After the main lease INSERT/UPDATE, add calls for tracked fields:

   const trackedFields = [
     'expense_structure', 'rent', 'rent_per_sf', 'leased_area',
     'roof_responsibility', 'hvac_responsibility', 
     'structure_responsibility', 'parking_responsibility'
   ];
   
   for (const field of trackedFields) {
     if (leaseData[field] != null) {
       await supabaseClient.rpc('upsert_lease_field', {
         p_lease_id: leaseId,
         p_field_name: field,
         p_field_value: String(leaseData[field]),
         p_source_tier: 5,  // costar_verified
         p_source_label: 'costar_verified',
         p_captured_by: 'sidebar_pipeline',
         p_source_file: null,
         p_source_detail: null,
         p_notes: 'Auto-captured from CoStar sidebar ingestion'
       });
     }
   }

3. The upsert_lease_field function handles:
   - Checking if a higher-quality source already exists (skips if so)
   - Superseding older provenance records
   - Syncing the denormalized column on leases

4. Also update the expense_structure_canonical column during lease upsert:
   
   UPDATE leases l SET expense_structure_canonical = esc.canonical
   FROM expense_structure_canonical esc 
   WHERE esc.raw_value = l.expense_structure AND l.lease_id = $1;

This ensures CoStar data fills gaps but never overwrites lease-document-quality 
data that Scott has manually verified or that came through the intake pipeline.
```

---

## Prompt D: Intake Pipeline Integration (for future OM/Lease uploads)

```
When the intake pipeline processes uploaded documents (OMs, lease abstracts, 
lease PDFs), it should write lease responsibility data through the provenance 
system.

In the intake handler (likely /api/_handlers/ or the intake.js route):

1. When an OM is processed and lease terms are extracted, call 
   upsert_lease_field() with source_tier=3 (om_lease_abstract)

2. When an actual lease document is processed, call with source_tier=1 
   (lease_document) and include the source_file (filename) and 
   source_detail (section reference if extractable)

3. For the BOV skill, when Scott manually enters or confirms lease 
   responsibility data during underwriting, call with source_tier=1 
   and captured_by='bov_skill'

4. The key responsibility fields to extract from lease documents:
   - roof: look for "roof" near "tenant"/"landlord"/"repair"/"replace"/"maintain"
   - hvac: look for "HVAC"/"heating"/"cooling"/"air conditioning" 
   - structure: look for "structural"/"foundation"/"walls"/"load-bearing"
   - parking: look for "parking"/"lot"/"striping"/"seal coat"

This doesn't need to be built immediately — it's the receiving end for when 
lease documents flow through intake. The schema and functions are ready.
```
