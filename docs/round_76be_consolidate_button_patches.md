# Round 76be — Property "Consolidate" button + endpoint

Adds a 🔗 Consolidate button next to the DIA/GOV badge in the property detail
header. Clicking it calls a new `/api/consolidate-property` endpoint that
returns three sections: same-address duplicates (high-confidence merge),
same-chain-in-city candidates (review before merging), and chain summary.
Each row in the duplicates table has a "Merge into <subject>" button that
calls `dia_merge_property()` or `gov_merge_property()`.

## SQL functions (already applied to live DBs)

- `find_property_consolidation_candidates(p_property_id integer)` on dia + gov
- `gov_merge_property(p_keep_id, p_drop_id)` (gov was missing this; dia had `dia_merge_property`)

Saved as migrations:
- `supabase/migrations/dialysis/20260428290000_dia_round_76be_consolidation_function.sql`
- `supabase/migrations/government/20260428290000_gov_round_76be_consolidation_function.sql`

## Vercel route + Express route (committed in this round)

- `vercel.json`: rewrite `/api/consolidate-property` → `/api/admin?_route=consolidate-property`
- `index.html`: new `<div id="consolidateModal">` + inline `<script>` with
  `openConsolidateModal()`, `closeConsolidateModal()`, `consolidateMerge()`

## NOT committed in this round (file truncation issue, see notes)

The bash-side filesystem in this session reported `api/admin.js`, `server.js`,
and `detail.js` as truncated relative to git's HEAD blob. My Edit tool wrote
the changes to those files (visible via grep, e.g.
`grep -c handleConsolidateProperty admin.js` returns 4), but committing them
through git would have registered as 13,428 deletions across thousands of
unrelated lines. Reset to HEAD instead.

The actual JS edits to apply manually in your IDE:

### `api/admin.js` — add to the route switch table (right after `case 'storage-cleanup':`):

```js
case 'consolidate-property': return handleConsolidateProperty(req, res);
```

### `api/admin.js` — add the handler function (anywhere in the file, e.g. right after `handleStorageCleanup`):

```js
async function handleConsolidateProperty(req, res) {
  const domain = (req.query.domain || '').toLowerCase();
  if (!['dia', 'gov'].includes(domain)) {
    return res.status(400).json({ error: 'domain must be dia or gov' });
  }

  if (req.method === 'GET') {
    const propertyId = parseInt(req.query.property_id, 10);
    if (!Number.isFinite(propertyId)) {
      return res.status(400).json({ error: 'property_id required' });
    }
    try {
      const { domainQuery } = await import('./_shared/domain-db.js');
      const dom = domain === 'dia' ? 'dialysis' : 'government';
      const r = await domainQuery(dom, 'POST', 'rpc/find_property_consolidation_candidates', {
        p_property_id: propertyId
      });
      if (!r.ok) return res.status(500).json({ error: 'rpc_failed', detail: r.data });
      return res.status(200).json(r.data);
    } catch (err) {
      return res.status(500).json({ error: 'consolidate_lookup_failed', message: err?.message });
    }
  }

  if (req.method === 'POST') {
    const { keep_id, drop_id } = req.body || {};
    const keepId = parseInt(keep_id, 10);
    const dropId = parseInt(drop_id, 10);
    if (!Number.isFinite(keepId) || !Number.isFinite(dropId) || keepId === dropId) {
      return res.status(400).json({ error: 'keep_id and drop_id required and must differ' });
    }
    try {
      const { domainQuery } = await import('./_shared/domain-db.js');
      const dom = domain === 'dia' ? 'dialysis' : 'government';
      const fnName = domain === 'dia' ? 'dia_merge_property' : 'gov_merge_property';
      const r = await domainQuery(dom, 'POST', `rpc/${fnName}`, {
        p_keep_id: keepId, p_drop_id: dropId
      });
      if (!r.ok) return res.status(500).json({ error: 'merge_failed', detail: r.data });
      return res.status(200).json({ ok: true, keep_id: keepId, drop_id: dropId });
    } catch (err) {
      return res.status(500).json({ error: 'merge_failed', message: err?.message });
    }
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
```

### `server.js` — add right after `app.all('/api/storage-cleanup', ...)`:

```js
app.all('/api/consolidate-property', (req, res) => { req.query._route = 'consolidate-property'; adminHandler(req, res); });
```

### `detail.js` — replace the existing `headerEl.innerHTML` assignment:

In the function that renders the detail panel header (around line 112), the
existing block assigns `headerEl.innerHTML = ...`. Replace the existing
`<span class="detail-badge">` line with:

```html
<button class="detail-action-btn" id="consolidateBtn"
  title="Find duplicate properties + same-tenant clusters"
  onclick="openConsolidateModal('${db}', ${ids.property_id || 'null'})"
  style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;margin-right:8px"
  ${ids.property_id ? '' : 'disabled'}>
  🔗 Consolidate
</button>
<span class="detail-badge" style="background:${db === 'gov' ? 'var(--gov-green)' : 'var(--purple)'};color:#fff">${db === 'gov' ? 'GOV' : 'DIA'}</span>
```

The HTML/CSS modal + JS handlers are already inlined in `index.html` — no
changes needed there beyond what's already committed.
