# Claude Code Prompts — Sale Notes Extraction & Document Ingestion

---

## Context

Two critical data capture gaps in the CoStar sidebar pipeline:

1. **Sale Notes are completely dropped.** The CoStar content script (`extension/content/costar.js` line ~1015) has a `STOP_PATTERN` that halts extraction at "Sale Notes" and "Documents" headings. The raw narrative text — which contains NOI, cap rate verification, construction details, days on market, asking price, and verification method — is never captured.

2. **CoStar-linked documents (deeds, OMs) are invisible.** The Documents section is also a STOP_PATTERN. CoStar sale comps link to deeds, OMs, and brochures that open in new browser tabs. These contain tier-1 and tier-3 provenance data (lease responsibility breakdown, transfer tax price validation, guarantor info, full entity names, trust dates, escalation schedules). None of it is captured.

The DB already has:
- `property_documents` table (empty, has document_id, property_id, file_name, raw_text, document_type)
- `source_files` table (empty, has file_id, file_name, file_type, ingestion_status, ocr_status, related_property_id)
- `sales_transactions.notes` field (currently reconstructed from structured fields, not from raw CoStar notes)

---

## Prompt 1: Capture and Parse CoStar Sale Notes

```
In extension/content/costar.js, the STOP_PATTERN at line ~1015 includes 
"sale_notes" and "documents", which causes the content script to stop 
extracting when it hits these sections. This means the rich narrative text 
in CoStar's "Sale Notes" section is completely lost.

PHASE A — Capture raw sale notes text:

1. In the STOP_PATTERN regex (~line 1015), REMOVE "sale\s+notes" from the 
   pattern. Keep "documents" and "my\s+notes" as stop patterns for the 
   CONTACT extraction, but sale notes should be captured separately.

2. Add a new extraction section that runs AFTER the contact extraction. 
   Look for the "Sale Notes" heading and capture all text between it and 
   the next section heading (Documents, My Notes, Sources & Research, etc.):

   // Find "Sale Notes" section
   const saleNotesIdx = lines.findIndex(l => /^sale\s+notes$/i.test(l.trim()));
   if (saleNotesIdx > -1) {
     const noteLines = [];
     for (let i = saleNotesIdx + 1; i < lines.length; i++) {
       if (/^(documents|my\s+notes|sources|income\s+&\s+expenses|buyer\s+broker|listing\s+broker)/i.test(lines[i].trim())) break;
       if (lines[i].trim()) noteLines.push(lines[i].trim());
     }
     metadata.sale_notes_raw = noteLines.join(' ');
   }

3. Send sale_notes_raw through to the pipeline as part of the extraction 
   payload.

PHASE B — Structured extraction from sale notes text:

In sidebar-pipeline.js, add a `parseSaleNotes(notesText)` function that 
extracts structured values using regex. The function should return an object:

   function parseSaleNotes(text) {
     if (!text) return {};
     const extracted = {};
     
     // NOI
     const noiMatch = text.match(/(?:net\s+operating\s+income|noi)\s+of\s+\$?([\d,]+)/i);
     if (noiMatch) extracted.noi = parseFloat(noiMatch[1].replace(/,/g, ''));
     
     // Cap rate from notes (cross-reference)
     const capMatch = text.match(/(\d+\.?\d*)\s*%\s*cap\s*rate/i) || 
                      text.match(/cap\s*rate.*?(\d+\.?\d*)\s*%/i);
     if (capMatch) extracted.stated_cap_rate = parseFloat(capMatch[1]);
     
     // Lease term remaining
     const termMatch = text.match(/(\d+)\s*(?:remaining\s+)?years?\s+remaining/i) ||
                       text.match(/(\d+)\s+years?\s+remain/i);
     if (termMatch) extracted.years_remaining = parseInt(termMatch[1]);
     
     // Building SF (cross-reference)
     const sfMatch = text.match(/([\d,]+)\s*[-–]?\s*square[-\s]?foot/i);
     if (sfMatch) extracted.building_sf = parseInt(sfMatch[1].replace(/,/g, ''));
     
     // Acreage
     const acreMatch = text.match(/([\d.]+)\s*acres?/i);
     if (acreMatch) extracted.acreage = parseFloat(acreMatch[1]);
     
     // Days on market
     const domMatch = text.match(/(?:market\s+for|on\s+the\s+market)\s+(\d+)\s+days/i);
     if (domMatch) extracted.days_on_market = parseInt(domMatch[1]);
     
     // Asking price
     const askMatch = text.match(/asking\s+price\s+of\s+\$?([\d,]+)/i) ||
                      text.match(/initial\s+asking.*?\$?([\d,]+(?:\.\d+)?)/i);
     if (askMatch) extracted.asking_price = parseFloat(askMatch[1].replace(/,/g, ''));
     
     // Construction type
     const constMatch = text.match(/(?:features?\s+)?(?:reinforced\s+)?(\w+\s+(?:concrete|construction|frame|masonry))/i);
     if (constMatch) extracted.construction_type = constMatch[1].trim();
     
     // Verification method
     const verifyMatch = text.match(/verified\s+(?:through|via|by)\s+(.+?)(?:\.|$)/i);
     if (verifyMatch) extracted.verification_method = verifyMatch[1].trim();
     
     // Lease type
     const leaseMatch = text.match(/(\d+)[-\s]year\s+(triple\s+net|nnn|nn|gross|absolute)/i);
     if (leaseMatch) {
       extracted.lease_term_years = parseInt(leaseMatch[1]);
       extracted.lease_type = leaseMatch[2];
     }
     
     return extracted;
   }

PHASE C — Cross-reference and validate:

After parsing sale notes, compare extracted values against the structured 
fields already captured:

1. If sale_notes says NOI=$383,381 and cap_rate=7.15%, calculate:
   $383,381 / 0.0715 = $5,362,000 → matches sale_price ✓
   
2. If building_sf from notes differs from RBA, flag for review

3. Store the raw notes in sales_transactions.notes (append after the 
   existing structured notes with a separator)

4. Store parsed values in a new `sale_notes_extracted` JSONB column on 
   sales_transactions (add the column if it doesn't exist):
   
   ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS 
     sale_notes_extracted jsonb;
   ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS 
     sale_notes_raw text;
```

---

## Prompt 2: Capture Document URLs from CoStar Documents Section

```
In extension/content/costar.js, the "Documents" section is treated as a 
STOP_PATTERN, meaning document links are never captured. CoStar sale comps 
often have linked documents (deeds, OMs, brochures) that open in new tabs.

FIX: After the sale notes extraction (from Prompt 1), add a Documents 
section extractor:

1. Find the "Documents" heading in the page text/DOM
2. Extract all links in that section. CoStar typically shows documents as 
   clickable icons with labels like "Deed", "Brochure", "Historical Sale 
   Brochure/OM":

   // DOM-based extraction for document links
   const docSection = document.querySelector('[class*="document"], 
     [data-testid*="document"]');
   // Or find by heading text and get next sibling container
   
   const docLinks = [];
   if (docSection) {
     docSection.querySelectorAll('a[href]').forEach(a => {
       const label = a.textContent?.trim() || a.getAttribute('title') || '';
       const href = a.href;
       if (href && !href.startsWith('javascript:')) {
         docLinks.push({
           label: label,
           url: href,
           type: inferDocType(label) // 'deed', 'om', 'brochure', 'other'
         });
       }
     });
   }
   metadata.document_links = docLinks;

3. The `inferDocType` function:
   function inferDocType(label) {
     const lower = label.toLowerCase();
     if (lower.includes('deed')) return 'deed';
     if (lower.includes('om') || lower.includes('offering') || 
         lower.includes('brochure') || lower.includes('memorandum')) return 'om';
     if (lower.includes('lease')) return 'lease';
     if (lower.includes('survey') || lower.includes('plat')) return 'survey';
     return 'other';
   }

4. In sidebar-pipeline.js, when document_links are present, insert them 
   into the property_documents table:

   for (const doc of metadata.document_links || []) {
     await supabase.from('property_documents').upsert({
       property_id: propertyId,
       file_name: doc.label || doc.url.split('/').pop(),
       document_type: doc.type,
       raw_text: null,  // populated later during extraction
       source_url: doc.url  // ADD THIS COLUMN
     }, { onConflict: 'property_id,file_name' });
   }

   Migration needed:
   ALTER TABLE property_documents ADD COLUMN IF NOT EXISTS source_url text;
   ALTER TABLE property_documents ADD COLUMN IF NOT EXISTS sale_id bigint 
     REFERENCES sales_transactions(sale_id);
   ALTER TABLE property_documents ADD COLUMN IF NOT EXISTS ingestion_status text 
     DEFAULT 'url_captured';
   ALTER TABLE property_documents ADD COLUMN IF NOT EXISTS extracted_data jsonb;
   CREATE UNIQUE INDEX IF NOT EXISTS uix_prop_doc ON property_documents(property_id, file_name);
```

---

## Prompt 3: LCC Sidebar "Ingest Document" Button

```
This is the user-facing feature that ties it all together. When the LCC 
sidebar shows a property that has document_links (from Prompt 2), or when 
the user is viewing a PDF in a CoStar-opened tab:

APPROACH A — Sidebar document list with "Ingest" buttons:

In extension/sidepanel.js (or equivalent sidebar renderer), when displaying 
a property's details, add a "Documents" section:

1. Query property_documents for this property_id
2. For each document, show:
   - Document name and type icon (deed, OM, etc.)
   - Status badge: "URL Captured" / "Ingested" / "Extracted"
   - An "Ingest" button that triggers extraction

3. When "Ingest" is clicked:
   a. Open the source_url in a background tab or fetch via the extension's 
      background script (extensions can fetch cross-origin)
   b. If it's a PDF, extract text using pdf.js or send to the backend
   c. Send the extracted text + metadata to the pipeline for processing
   d. Update property_documents.ingestion_status = 'extracted'

APPROACH B — Auto-detect CoStar PDFs in new tabs:

In the extension's background script, listen for new tab creation:

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Check if this tab was opened from a CoStar page
    if (tab.openerTabId && isCoStarPdfUrl(tab.url)) {
      // Inject a content script that shows an "Ingest to LCC" banner
      chrome.scripting.executeScript({
        target: { tabId },
        func: showIngestBanner,
        args: [tab.url, propertyContext]
      });
    }
  }
});

For now, Approach A is more practical and doesn't require background 
script changes. Approach B can be added later.
```

---

## Prompt 4: Deed Parser

```
Create a deed-specific extraction function in sidebar-pipeline.js (or a 
new file /api/_handlers/deed-parser.js) that extracts structured data from 
deed text.

Deeds follow a predictable format. Key fields to extract:

function parseDeedText(text) {
  const data = {};
  
  // Document number (DOC# 2026-0042560)
  const docMatch = text.match(/DOC#?\s*([\d\-\.]+)/i);
  if (docMatch) data.document_number = docMatch[1];
  
  // Recording date
  const recMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (recMatch) data.recording_date = recMatch[1];
  
  // Transfer tax → back-calculate sale price
  // CA: $1.10 per $1,000 of value; varies by city
  const taxMatch = text.match(/documentary\s+transfer\s+tax\s+is\s+\$?([\d,]+\.?\d*)/i);
  if (taxMatch) {
    data.transfer_tax = parseFloat(taxMatch[1].replace(/,/g, ''));
    // Standard CA rate: $1.10 per $1,000
    data.implied_sale_price = Math.round(data.transfer_tax / 1.10 * 1000);
    // City of Victorville doesn't have additional transfer tax
  }
  
  // Grantor(s) — seller entities
  const grantorMatch = text.match(/GRANT\(S\)\s+to\s+/i);
  // Parse everything between "hereby GRANT(S) to" and "the following"
  const granteeMatch = text.match(/GRANT\(S\)\s+to\s+(.+?)(?:,\s*a\s+|the\s+following)/is);
  if (granteeMatch) data.grantee = granteeMatch[1].trim();
  
  // Grantor from "receipt of which is hereby acknowledged"
  const acknowledgedMatch = text.match(/acknowledged,\s+(.+?)(?:\s+hereby\s+GRANT)/is);
  if (acknowledgedMatch) data.grantor = acknowledgedMatch[1].trim();
  
  // APN/Parcel ID
  const apnMatch = text.match(/APN\/Parcel\s+ID\(s?\):\s*([\d\-]+)/i);
  if (apnMatch) data.apn = apnMatch[1];
  
  // Escrow number
  const escrowMatch = text.match(/Escrow\s+No\.?:?\s*([\w\-]+)/i);
  if (escrowMatch) data.escrow_number = escrowMatch[1];
  
  // Title company
  const titleMatch = text.match(/(?:RECORDING\s+REQUESTED\s+BY|Title\s+Company):?\s*\n?\s*(.+?)(?:\n|$)/i);
  if (titleMatch) data.title_company = titleMatch[1].trim();
  
  // Trust dates (important for entity verification)
  const trustDates = [...text.matchAll(/trust\s+dated\s+(\w+\s+\d+,?\s+\d{4})/gi)];
  if (trustDates.length) data.trust_dates = trustDates.map(m => m[1]);
  
  // Entity type of grantee
  if (text.match(/limited\s+liability\s+company/i)) data.grantee_entity_type = 'LLC';
  if (text.match(/corporation/i)) data.grantee_entity_type = 'Corporation';
  if (text.match(/trust/i) && !data.grantee_entity_type) data.grantee_entity_type = 'Trust';
  
  return data;
}

CROSS-REFERENCING: After parsing a deed, validate against existing DB data:
1. implied_sale_price from transfer tax should match sales_transactions.sold_price
2. grantee should match recorded_owner name
3. APN should match parcel_records
4. Document number should match sales_transactions.notes doc reference

Store the parsed deed data in property_documents.extracted_data as JSONB.
Use it to upgrade sales_transaction confidence to "deed_verified".
```

---

## Prompt 5: OM Parser (Lease Summary Extraction)

```
Create an OM-specific extraction function. OMs are the most valuable 
document type because they contain the lease summary with responsibility 
breakdown — which is tier-3 provenance data for the lease_field_provenance 
system.

The OM Lease Summary page for dialysis properties typically has a table:
  TENANT: DaVita Dialysis
  LEASE TYPE: Triple Net (NNN)
  LEASE TERM: 15 years
  LEASE COMMENCEMENT: 5/1/16
  LEASE EXPIRATION: 4/31/2031
  RENT INCREASES: 10% every 5 Years and FMV in Options
  ANNUAL BASE RENT: $383,381
  RENT PER SF: $29.33
  PROPERTY TAXES: Tenant's Responsibility
  INSURANCE: Tenant's Responsibility
  UTILITIES: Tenant's Responsibility
  ROOF & STRUCTURE: Landlord's Responsibility
  HVAC: Landlord's Responsibility
  RENEWAL OPTIONS: Two 5-year Options
  CORPORATE GUARANTY: DaVita Healthcare Partners, Inc.

And a "LANDLORD OBLIGATIONS" paragraph with detailed maintenance terms.

function parseOmLeaseAbstract(text) {
  const data = {};
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  
  // Key-value extraction from lease summary table
  const kvPatterns = {
    tenant: /^TENANT:?\s*(.+)/i,
    lease_type: /^LEASE\s+TYPE:?\s*(.+)/i,
    corporate_guaranty: /^CORPORATE\s+GUARANTY?:?\s*(.+)/i,
    lease_term: /^LEASE\s+TERM:?\s*(.+)/i,
    lease_commencement: /^LEASE\s+COMMENCEMENT:?\s*(.+)/i,
    lease_expiration: /^LEASE\s+EXPIRATION:?\s*(.+)/i,
    remaining_term: /^REMAINING\s+LEASE\s+TERM:?\s*(.+)/i,
    renewal_options: /^RENEWAL\s+OPTIONS?:?\s*(.+)/i,
    rent_increases: /^RENT\s+INCREASES?:?\s*(.+)/i,
    annual_base_rent: /^ANNUAL\s+BASE\s+RENT:?\s*(.+)/i,
    rent_per_sf: /^RENT\s+PER\s+SF:?\s*(.+)/i,
    permitted_use: /^PERMITTED\s+USE:?\s*(.+)/i,
  };
  
  // Responsibility extraction
  const responsibilityPatterns = {
    property_taxes: /^PROPERTY\s+TAXES:?\s*(.+)/i,
    insurance: /^INSURANCE:?\s*(.+)/i,
    utilities: /^UTILITIES:?\s*(.+)/i,
    roof_structure: /^ROOF\s*(?:&|AND)?\s*STRUCTURE:?\s*(.+)/i,
    roof: /^ROOF:?\s*(.+)/i,
    hvac: /^HVAC:?\s*(.+)/i,
    parking: /^PARKING:?\s*(.+)/i,
    cam: /^CAM:?\s*(.+)/i,
    structure: /^STRUCTURE:?\s*(.+)/i,
  };
  
  for (const line of lines) {
    for (const [key, pattern] of Object.entries(kvPatterns)) {
      const match = line.match(pattern);
      if (match) data[key] = match[1].trim();
    }
    for (const [key, pattern] of Object.entries(responsibilityPatterns)) {
      const match = line.match(pattern);
      if (match) {
        const value = match[1].trim().toLowerCase();
        data[key] = value.includes('tenant') ? 'tenant' : 
                    value.includes('landlord') ? 'landlord' : 
                    value.includes('shared') ? 'shared' : match[1].trim();
      }
    }
  }
  
  // Handle combined "Roof & Structure" field
  if (data.roof_structure && !data.roof) {
    data.roof = data.roof_structure;
    data.structure = data.roof_structure;
  }
  
  // Extract financial metrics from executive summary
  const priceMatch = text.match(/PRICE:?\s*\$?([\d,]+)/i);
  if (priceMatch) data.asking_price = parseFloat(priceMatch[1].replace(/,/g, ''));
  
  const capMatch = text.match(/CAP\s+RATE:?\s*([\d.]+)%/i);
  if (capMatch) data.listed_cap_rate = parseFloat(capMatch[1]);
  
  const noiMatch = text.match(/NOI:?\s*\$?([\d,]+)/i);
  if (noiMatch) data.noi = parseFloat(noiMatch[1].replace(/,/g, ''));
  
  // Landlord obligations paragraph (rich detail)
  const landlordIdx = text.search(/LANDLORD\s+OBLIGATIONS/i);
  if (landlordIdx > -1) {
    const oblText = text.substring(landlordIdx, landlordIdx + 2000);
    data.landlord_obligations_raw = oblText.split('\n').slice(1).join(' ').trim();
  }
  
  return data;
}

PROVENANCE INTEGRATION: After parsing an OM, push responsibility data 
through the lease_field_provenance system at tier 3 (om_lease_abstract):

  const omData = parseOmLeaseAbstract(omText);
  const responsibilityFields = {
    'roof_responsibility': omData.roof,
    'hvac_responsibility': omData.hvac,
    'structure_responsibility': omData.structure,
    'parking_responsibility': omData.parking || 'tenant', // NNN default
  };
  
  for (const [field, value] of Object.entries(responsibilityFields)) {
    if (value) {
      await supabase.rpc('upsert_lease_field', {
        p_lease_id: leaseId,
        p_field_name: field,
        p_field_value: value,
        p_source_tier: 3,  // om_lease_abstract
        p_source_label: 'om_lease_abstract',
        p_captured_by: 'om_parser',
        p_source_file: omFilename,
        p_source_detail: 'Lease Summary table',
        p_notes: omData.landlord_obligations_raw?.substring(0, 500)
      });
    }
  }
```

---

## Recommended Implementation Order

1. **Prompt 1** (Sale Notes) — Highest ROI, easiest to implement, no new UI needed
2. **Prompt 2** (Document URLs) — Quick add-on to Prompt 1, captures links for future use
3. **Prompt 4** (Deed Parser) — Standalone utility, validates sale data
4. **Prompt 5** (OM Parser) — Most valuable for underwriting, feeds provenance system
5. **Prompt 3** (Sidebar Ingest Button) — UX layer that ties documents to the pipeline

For the immediate workflow (before these are built), the most practical path 
for ingesting deeds and OMs is through Cowork: upload the PDF and ask Claude 
to extract and push to the DB. This is what we just did with the Amargosa Rd 
OM and deed — tier-3 responsibility data is now in the DB.
