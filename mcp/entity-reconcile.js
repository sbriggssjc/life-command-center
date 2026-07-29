// ============================================================================
// entity-reconcile.js — A1 entity reconciliation (Spine hygiene). Place in mcp/entity-reconcile.js.
//
//   import { makeEntityReconcileRoute } from './entity-reconcile.js';
//   const rec = makeEntityReconcileRoute({ opsQuery });
//   app.get('/api/pipeline/flagged-deals',     authenticate, rec.list);
//   app.post('/api/pipeline/flagged-deals',    authenticate, rec.list);
//   app.post('/api/pipeline/reconcile-entity', authenticate, rec.reconcile);
//
// Backbone deals in multi-asset cities that the sync couldn't disambiguate become flagged placeholder
// assets (metadata.ambiguous_resolution = candidate list). These endpoints resolve them:
//   * list       -> the flagged, still-open deals + their candidate assets (TB-owned by default), for review.
//   * reconcile  -> merge a placeholder onto a chosen canonical asset, or keep it as a genuinely-new asset.
// The merge itself is one atomic SECURITY DEFINER DB function (reconcile_entity): repoints bd_opportunities,
// moves activity_events (guarding the workspace/source/external unique constraint) + deal_party edges, and
// retires the placeholder to a reversible tombstone (metadata.merged_into). See entity-reconciliation-design.md.
// ============================================================================

export function makeEntityReconcileRoute({ opsQuery }) {
  return {
    // GET/POST /api/pipeline/flagged-deals?all=1  (all=1 -> include non-TB owners)
    list: async (req, res) => {
      try {
        const q = { ...(req.query || {}), ...(req.body || {}) };
        const tbOnly = !(q.all === 1 || q.all === '1' || q.all === true || q.all === 'true');
        const r = await opsQuery('POST', 'rpc/list_flagged_open_deals', { p_tb_only: tbOnly });
        const deals = Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []);
        return res.status(200).json({ ok: true, count: deals.length, tb_only: tbOnly, deals });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    },

    // POST /api/pipeline/reconcile-entity  { placeholder_id, canonical_id }  OR  { placeholder_id, keep_new:true }
    reconcile: async (req, res) => {
      try {
        const q = { ...(req.query || {}), ...(req.body || {}) };
        if (!q.placeholder_id) return res.status(400).json({ ok: false, error: 'placeholder_id required' });
        const keepNew = q.keep_new === true || q.keep_new === 'true' || q.keep_new === 1 || q.keep_new === '1';
        if (!keepNew && !q.canonical_id) {
          return res.status(400).json({ ok: false, error: 'canonical_id required (or keep_new:true)' });
        }
        const r = await opsQuery('POST', 'rpc/reconcile_entity', {
          p_placeholder: q.placeholder_id,
          p_canonical: q.canonical_id || null,
          p_keep_new: keepNew,
        });
        const out = Array.isArray(r.data) ? r.data[0] : r.data;
        const body = (out && typeof out === 'object') ? out : { ok: false, error: 'no_result', detail: r.data };
        return res.status(body.ok ? 200 : 400).json(body);
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    },
  };
}
