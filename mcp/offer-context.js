// ============================================================================
// offer-context.js — the offer-submission skill's two engine calls.
// Place in mcp/offer-context.js (engine deploy context). Mirrors the
// cadence-scan.js / entity-reconcile.js route-factory pattern.
//
//   GET/POST /api/pipeline/offer-context   -> public.lcc_offer_context(text)
//     Assemble deal context for an inbound offer: deal identity, resolved
//     seller (of-record + contact), listing economics (ask/NOI/cap/lease),
//     linked documents, external correspondents, and a gaps[] list.
//
//   POST     /api/pipeline/offer-log        -> public.lcc_log_offer(text, jsonb)
//     Log the offer atomically: activity_event + review To-Do (due on the
//     offer expiration) + an SF create_task enqueue (generic, SF-safe).
//
// Both read `deal` from BOTH req.body AND req.query — the root proxy
// (aiReadHandler) POSTs a JSON body and DROPS the query string.
// ============================================================================

export function makeOfferContextRoute({ opsQuery }) {
  async function get(req, res) {
    const deal =
      (req.body && (req.body.deal || req.body.p_deal)) || req.query.deal || req.query.p_deal;
    if (!deal) return res.status(400).json({ ok: false, error: 'deal_required' });
    const r = await opsQuery('POST', 'rpc/lcc_offer_context', { p_deal: String(deal) });
    if (!r.ok) return res.status(502).json({ ok: false, error: `rpc_failed_${r.status}`, detail: r.data });
    const packet = Array.isArray(r.data) ? r.data[0] : r.data;   // scalar-jsonb RPC → object (or [object])
    return res.status(200).json(packet || { ok: false, error: 'empty' });
  }
  return { get };
}

export function makeOfferLogRoute({ opsQuery }) {
  async function post(req, res) {
    const b = req.body || {};
    const deal = b.deal || b.p_deal || req.query.deal;
    const offer = b.offer || b.p_offer || {};            // the extracted LOI terms (jsonb)
    if (!deal) return res.status(400).json({ ok: false, error: 'deal_required' });
    const r = await opsQuery('POST', 'rpc/lcc_log_offer', { p_deal: String(deal), p_offer: offer });
    if (!r.ok) return res.status(502).json({ ok: false, error: `rpc_failed_${r.status}`, detail: r.data });
    return res.status(200).json(Array.isArray(r.data) ? r.data[0] : r.data);
  }
  return { post };
}
