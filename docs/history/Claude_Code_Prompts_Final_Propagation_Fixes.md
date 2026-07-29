# Final Propagation Fix Prompts — April 16, 2026

The three `buildMetadata()` / pipeline-gate fixes from the previous round ARE deployed and working — entity metadata now has `sale_notes_raw`, `document_links`, and `_version`, and the pipeline re-runs on Update. But two propagation-layer issues prevent the data from reaching the Dialysis_DB tables.

---

## Prompt 1: Sales dedup skips PATCH — sale_notes_raw never reaches sales_transactions

### Problem
In `api/_handlers/sidebar-pipeline.js`, the `upsertDomainSales()` function has a dedup guard (lines ~2189-2210) that prevents duplicate economic transactions. When an existing sale matches the incoming sale within 30 days and 2% of price, it executes `continue` (line 2209), skipping that sale entirely — including the PATCH at line 2236 that would write `sale_notes_raw` and `sale_notes_extracted`.

For the Amargosa Rd property, the 2026 sale already exists with `sale_date=2026-02-03` and `sold_price=5362000`. The incoming data has the same values, so `daysDiff=0` and `priceDelta=0` → the dedup fires and skips the row. The `sale_notes_raw` from entity metadata never reaches `sales_transactions`.

This affects ALL re-ingested properties — any property that was previously ingested will have its sales skipped by the dedup guard, so no new fields (sale_notes, updated brokers, etc.) will ever propagate on re-ingestion.

### Fix
In `api/_handlers/sidebar-pipeline.js`, in the dedup block around lines 2189-2210, instead of `continue` (skip entirely), PATCH the existing row with enrichment-only fields before continuing. Replace:

```javascript
          if (daysDiff <= 30 && priceDelta <= 0.02) {
            console.log(
              `[sales-dedup] skipping duplicate property=${propertyId} ` +
              `existing_date=${existingDatePart} existing_price=${existingPrice} ` +
              `incoming_date=${datePart} incoming_price=${soldPrice} ` +
              `days_diff=${daysDiff.toFixed(1)} price_delta=${(priceDelta * 100).toFixed(2)}%`
            );
            continue;
          }
```

With:

```javascript
          if (daysDiff <= 30 && priceDelta <= 0.02) {
            // Dedup match — same economic transaction. Don't create a duplicate,
            // but DO patch enrichment fields (sale notes, brokers, etc.) that may
            // have been added since the original ingestion.
            const enrichPatch = {};
            if (saleNotesRaw && !existing.sale_notes_raw) {
              enrichPatch.sale_notes_raw = saleNotesRaw;
              enrichPatch.sale_notes_extracted = Object.keys(saleNotesExtracted).length > 0
                ? saleNotesExtracted : null;
            }
            if (saleData.listing_broker && !existing.listing_broker) {
              enrichPatch.listing_broker = saleData.listing_broker;
            }
            if (saleData.procuring_broker && !existing.procuring_broker) {
              enrichPatch.procuring_broker = saleData.procuring_broker;
            }
            if (saleData.buyer_name && !existing.buyer_name) {
              enrichPatch.buyer_name = saleData.buyer_name;
            }
            if (saleData.seller_name && !existing.seller_name) {
              enrichPatch.seller_name = saleData.seller_name;
            }
            // Also enrich notes if sale notes are new
            if (saleNotesRaw && existing.notes && !existing.notes.includes('Sale Notes')) {
              enrichPatch.notes = existing.notes + '; --- Sale Notes ---\n' + saleNotesRaw;
            }
            if (Object.keys(enrichPatch).length > 0) {
              console.log(`[sales-dedup] enriching existing sale_id=${existing.sale_id} with ${Object.keys(enrichPatch).join(', ')}`);
              await domainPatch(domain,
                `sales_transactions?sale_id=eq.${existing.sale_id}`, enrichPatch, 'sales-dedup-enrich');
            } else {
              console.log(`[sales-dedup] skipping duplicate property=${propertyId} (no new enrichment data)`);
            }
            continue;
          }
```

This preserves the dedup behavior (no duplicate rows created) while allowing new enrichment data to flow to existing records.

### Verification
After deploying, re-run the pipeline for entity `b91f6d6d-7b28-4a4f-a35f-9c19008521bc` (15002 Amargosa Rd). Then check:
```sql
SELECT sale_id, sale_notes_raw IS NOT NULL as has_notes, sale_notes_extracted->>'noi' as noi
FROM sales_transactions WHERE property_id = 23283 AND sale_id = 7983;
```
Should show `has_notes=true` and `noi=383381`.

---

## Prompt 2: property_documents PostgREST upsert failing silently

### Problem
In `api/_handlers/sidebar-pipeline.js`, the `upsertDocumentLinks()` function (lines 820-845) POSTs to `property_documents?on_conflict=property_id,file_name` with `Prefer: return=representation,resolution=merge-duplicates`. Despite entity metadata having 2 document links (Deed and OM), the `property_documents` table remained empty after the pipeline ran.

The pipeline summary shows no `document_links` key in `domain_records`, suggesting either:
1. The function returned 0 (PostgREST POST silently failed)
2. The serverless function is running a cached version without the document_links step

The `property_documents.document_id` column is `bigint NOT NULL` with a sequence (`property_documents_document_id_seq`) but `column_default` shows NULL in `information_schema`. This may cause PostgREST to fail because it doesn't know about the sequence default.

### Fix
Two changes:

**Fix A — Add explicit default to document_id column:**

Run this migration to ensure PostgREST sees the default:

```sql
ALTER TABLE property_documents 
  ALTER COLUMN document_id SET DEFAULT nextval('property_documents_document_id_seq');
```

**Fix B — Add error logging and fallback in upsertDocumentLinks:**

In `api/_handlers/sidebar-pipeline.js`, update `upsertDocumentLinks()` to log more detail on failure and retry without on_conflict if the upsert fails:

```javascript
async function upsertDocumentLinks(domain, propertyId, metadata) {
  const docs = metadata.document_links;
  if (!Array.isArray(docs) || docs.length === 0) return 0;

  let count = 0;
  for (const doc of docs) {
    if (!doc.url) continue;
    const fileName = doc.label || doc.url.split('/').pop() || 'unknown';
    const row = {
      property_id: propertyId,
      file_name:   fileName,
      document_type: doc.type || 'other',
      source_url:  doc.url,
      ingestion_status: 'url_captured',
    };

    // Try upsert first
    let r = await domainQuery(
      domain, 'POST',
      'property_documents?on_conflict=property_id,file_name',
      row,
      { 'Prefer': 'return=representation,resolution=merge-duplicates' }
    );

    // If upsert fails, try plain insert (may be first time)
    if (!r.ok) {
      console.warn(`[doc-links] upsert failed for ${fileName} (${r.status}), trying plain insert`);
      r = await domainQuery(domain, 'POST', 'property_documents', row);
    }

    if (r.ok) count++;
    else console.error(`[doc-links] insert also failed for ${fileName}:`, r.status, JSON.stringify(r.data));
  }
  return count;
}
```

### Verification
After deploying both fixes, re-run the pipeline. Then check:
```sql
SELECT document_id, file_name, document_type, source_url IS NOT NULL as has_url
FROM property_documents WHERE property_id = 23283;
```
Should show 2 rows (Deed + OM).

---

## Summary

| # | File | Issue | Root Cause |
|---|------|-------|------------|
| 1 | sidebar-pipeline.js ~2202 | `sale_notes_raw` never reaches `sales_transactions` | Dedup guard `continue` skips existing sales entirely, including PATCH with new data |
| 2 | sidebar-pipeline.js ~835 + DB | `document_links` not written to `property_documents` | PostgREST upsert likely failing on `document_id` default; needs column default + error fallback |

**Note:** I've manually backfilled the Amargosa Rd data in the DB so the BOV/audit data is correct right now. These prompts fix the systemic issues for all future ingestions.
