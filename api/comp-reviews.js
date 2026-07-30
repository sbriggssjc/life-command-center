// ============================================================================
// api/comp-reviews.js — Comp-review DRAIN bridge (W3.4, audit 3.4 item 1)
//
// The Decision-Center comp-review lane (ops.js) and any connector call
//   GET  /api/comp-reviews            -> list open flagged-comp reviews (dia+gov)
//   POST /api/comp-reviews/resolve    -> record a disposition on one review
// This handler authenticates the caller (X-LCC-Key / JWT via the app's auth)
// and forwards to the SHARED comps engine on the MCP server (GOV_API_URL), which
// owns comps-tools.js -> runListCompReviews / runResolveCompReview with the
// service-role govQuery/diaQuery. Same engine as Claude's list_comp_reviews /
// resolve_comp_review MCP tools, so every surface reads/writes the same queues.
//
// Mirrors api/query-comps.js (the comps QUERY bridge).
// ============================================================================

import { handleCors } from './_shared/auth.js';

const MCP_BASE = (process.env.GOV_API_URL || 'https://life-command-center-production.up.railway.app').replace(/\/+$/, '');
const LCC_API_KEY = process.env.LCC_API_KEY || '';

export default async function compReviewsHandler(req, res) {
  if (handleCors(req, res)) return;

  // Gate with the same X-LCC-Key the app/connector sends.
  if (LCC_API_KEY) {
    const provided = req.headers['x-lcc-key']
      || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      || (req.body && req.body._k) || '';
    if (provided !== LCC_API_KEY) {
      res.status(401).json({ error: 'Unauthorized — invalid or missing X-LCC-Key.' });
      return;
    }
  }

  const path = String(req.path || req.url || '');
  const isResolve = path.includes('/resolve');
  const method = isResolve ? 'POST' : 'GET';
  const target = isResolve ? '/api/comp-reviews/resolve' : '/api/comp-reviews';

  // Forward query string on the GET (domain/status/limit); forward JSON body on POST.
  let url = `${MCP_BASE}${target}`;
  const init = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LCC_API_KEY}` },
    signal: AbortSignal.timeout(30000),
  };
  if (isResolve) {
    const { _k, ...body } = req.body || {};
    init.body = JSON.stringify(body);
  } else {
    const qs = new URLSearchParams();
    for (const k of ['domain', 'status', 'limit']) {
      if (req.query && req.query[k] != null && req.query[k] !== '') qs.set(k, String(req.query[k]));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  let upstream, text;
  try {
    upstream = await fetch(url, init);
    text = await upstream.text();
  } catch (e) {
    res.status(502).json({ error: 'Could not reach comps engine: ' + e.message });
    return;
  }
  res.status(upstream.status);
  try { res.json(JSON.parse(text)); }
  catch { res.type('application/json').send(text); }
}
