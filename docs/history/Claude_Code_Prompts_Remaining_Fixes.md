# Remaining Pipeline Fix Prompts — April 16, 2026

These address the three root causes preventing sale notes, document links, and re-ingestion pipeline runs from working despite the extraction and pipeline code being deployed.

---

## Prompt 1: Add `sale_notes_raw` and `document_links` to `buildMetadata()` in sidepanel.js

### Problem
`extension/content/costar.js` correctly extracts `sale_notes_raw` (lines 99-108) and `document_links` (line 111, via `extractDocumentLinks()`), and sends them in the `CONTEXT_DETECTED` message (line 131-147 via `...accumulated`). The background.js merge preserves them in `pageContext`.

But `extension/sidepanel.js` function `buildMetadata()` (lines 918-999) has an explicit field whitelist. It maps every field from `ctx` to the metadata object individually — and **`sale_notes_raw` and `document_links` are not in that whitelist**. They are silently dropped when the Save/Update button builds the metadata payload.

This is why `sale_notes_raw` is NULL and `document_links` is NULL in the LCC entity metadata despite the extraction code working correctly.

### Fix
In `extension/sidepanel.js`, function `buildMetadata()` (starts at line 918), add these two fields to the metadata object being constructed. Insert them after the `sales_history` line (currently line 992):

```javascript
    sales_history: ctx.sales_history || [],
    // Sale notes & document links from CoStar comp detail pages
    sale_notes_raw: ctx.sale_notes_raw || null,
    document_links: ctx.document_links || [],
  };
```

That's it — two lines. The null-stripping loop at lines 994-997 will clean up `sale_notes_raw` if it's null, and `document_links` if it's an empty array won't be stripped (arrays are truthy), which is fine since the pipeline checks `Array.isArray(docs) && docs.length > 0`.

### Verification
After deploying, reload the Chrome extension, navigate to a CoStar sale comp detail page that has a "Sale Notes" section, and check:
1. Open Chrome DevTools console on the CoStar page, look for `data.sale_notes_raw` in the CONTEXT_DETECTED message
2. Click Save/Update in the LCC sidebar
3. Query the entity in LCC Opps: `SELECT metadata->>'sale_notes_raw', metadata->'document_links' FROM entities WHERE id = '<entity_id>'`
4. Both should now be populated

---

## Prompt 2: Fix pipeline re-run gate — clear `_pipeline_processed_at` on Update and bypass on manual Re-run

### Problem
Two separate paths are blocked by the `hasSidebarData()` check in `api/_handlers/sidebar-pipeline.js` (line 4092):

```javascript
if (metadata._pipeline_processed_at && metadata._pipeline_status !== 'failed') return false;
```

**Path A — Update button:** When a user clicks "Update" in the sidebar for an already-ingested property:
- `sidepanel.js` line 808 builds metadata: `{ ...(lccEntity.metadata || {}), ...buildMetadata(ctx, domain) }`
- The old `_pipeline_processed_at` survives the spread merge (buildMetadata doesn't include it)
- `entities-handler.js` line 630 checks `hasSidebarData(metadata)` → returns false → pipeline skipped
- Result: new CoStar data is saved to entity metadata but never propagated to Dialysis_DB

**Path B — Manual "Re-run Pipeline" button:** When a user clicks "Re-run Pipeline":
- `sidepanel.js` line 522 calls `process_sidebar_extraction`
- `entities-handler.js` line 272 calls `processSidebarExtraction()`
- `sidebar-pipeline.js` line 4018 checks `hasSidebarData(metadata)` → returns false → returns `{ skipped: true }`
- Result: the button appears to succeed (200 status) but nothing happens

### Fix — Two changes needed:

**Fix A — Clear pipeline flag on Update (sidepanel.js line ~808):**

In `extension/sidepanel.js`, in the Update button click handler (around line 808), after building the merged metadata, delete the pipeline-processed flags so the pipeline will re-run:

```javascript
      const metadata = { ...(lccEntity.metadata || {}), ...buildMetadata(ctx, domain) };
      // Clear pipeline gate so re-ingestion triggers a fresh pipeline run
      delete metadata._pipeline_processed_at;
      delete metadata._pipeline_status;
      delete metadata._pipeline_summary;
      delete metadata._pipeline_last_error;
```

**Fix B — Bypass hasSidebarData on manual re-run (sidebar-pipeline.js):**

The `process_sidebar_extraction` action in `entities-handler.js` (line 266) is explicitly triggered by the user clicking "Re-run Pipeline". It should ALWAYS run, not be gated by `hasSidebarData()`. 

Option 1 (preferred): Add a `force` parameter. In `entities-handler.js`, around line 266:

```javascript
    if (req.query.action === 'process_sidebar_extraction') {
      const { entity_id, force } = req.body || {};
      if (!entity_id) {
        return res.status(400).json({ error: 'entity_id is required' });
      }
      try {
        const result = await processSidebarExtraction(entity_id, workspaceId, user.id, { force: !!force });
```

Then in `sidebar-pipeline.js`, update `processSidebarExtraction` to accept options:

```javascript
export async function processSidebarExtraction(entityId, workspaceId, userId, opts = {}) {
  // ... fetch entity (unchanged) ...

  const entity = entityResult.data[0];
  const metadata = entity.metadata || {};

  // Only skip if not forced AND already processed
  if (!opts.force && !hasSidebarData(metadata)) {
    return { ok: true, skipped: true, reason: 'No actionable sidebar data in metadata' };
  }
```

And in `sidepanel.js`, update the Re-run Pipeline button click handler (line 522) to pass force:

```javascript
      const result = await apiCall('/api/entities?action=process_sidebar_extraction', {
        entity_id: lccEntity.id,
        force: true,
      });
```

### Verification
1. Navigate to a previously ingested property in CoStar
2. Click "Update" in the LCC sidebar
3. Check Dialysis_DB: the `updated_at` on the properties row should reflect the new timestamp
4. Check entity metadata: `_pipeline_processed_at` should be the current timestamp (not the old one)
5. Click "Re-run Pipeline" — should complete and update domain DB again

---

## Prompt 3: Fix `_version` tracking — add to buildMetadata

### Problem
`costar.js` line 136 sends `_version: 17` in the CONTEXT_DETECTED payload. But `buildMetadata()` doesn't include `_version`, so the entity metadata shows `_version: null`. This makes it impossible to tell which extension version produced the data, which is critical for debugging extraction issues.

### Fix
In `extension/sidepanel.js`, function `buildMetadata()`, add near the top of the metadata object (after `source_url`):

```javascript
    source_url: ctx.page_url || null,
    _version: ctx._version || null,
    costar_comp_id: ctx.costar_comp_id || null,
```

### Verification
After deploying and reloading the extension, ingest any property. Check `metadata->>'_version'` on the entity — should be `17`.

---

## Summary

| # | File | Line(s) | Issue | Impact |
|---|------|---------|-------|--------|
| 1 | sidepanel.js | ~992 | `sale_notes_raw` + `document_links` missing from `buildMetadata()` | Sale notes never reach pipeline; document URLs never saved |
| 2A | sidepanel.js | ~808 | `_pipeline_processed_at` not cleared on Update | Re-ingestion never triggers pipeline |
| 2B | entities-handler.js + sidebar-pipeline.js | ~266, ~4006 | Manual "Re-run Pipeline" blocked by `hasSidebarData()` | Re-run button silently does nothing |
| 3 | sidepanel.js | ~926 | `_version` missing from `buildMetadata()` | Can't track which extension version produced data |

All three are in the extension/sidepanel layer (metadata assembly) or the pipeline entry gate — the actual extraction code in costar.js and the propagation code in sidebar-pipeline.js are correct and complete.
