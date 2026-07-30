// ============================================================================
// api/metadata-backfill.js — Property metadata-backfill worklist bridge (W3.4)
//
// GET /api/metadata-backfill?domain=&limit=  → the prioritized property
// metadata-backfill worklist (v_property_metadata_backfill_queue, with a
// suggested CoStar URL per property) across gov + dia. Authenticates the caller
// (X-LCC-Key / JWT) and forwards to the shared engine on the MCP server
// (GOV_API_URL), which reads the view with service-role govQuery/diaQuery — no
// data-query edge allowlist dependency. Mirrors api/query-comps.js.
// ============================================================================

import { handleCors } from './_shared/auth.js';

const MCP_BASE = (process.env.GOV_API_URL || 'https://life-command-center-production.up.railway.app').replace(/\/+$/, '');
const LCC_API_KEY = process.env.LCC_API_KEY || '';

export default async function metadataBackfillHandler(req, res) {
  if (handleCors(req, res)) return;

  if (LCC_API_KEY) {
    const provided = req.headers['x-lcc-key']
      || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      || (req.body && req.body._k) || '';
    if (provided !== LCC_API_KEY) {
      res.status(401).json({ error: 'Unauthorized — invalid or missing X-LCC-Key.' });
      return;
    }
  }

  const qs = new URLSearchParams();
  for (const k of ['domain', 'limit']) {
    if (req.query && req.query[k] != null && req.query[k] !== '') qs.set(k, String(req.query[k]));
  }
  const s = qs.toString();
  const url = `${MCP_BASE}/api/metadata-backfill${s ? `?${s}` : ''}`;

  let upstream, text;
  try {
    upstream = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LCC_API_KEY}` },
      signal: AbortSignal.timeout(30000),
    });
    text = await upstream.text();
  } catch (e) {
    res.status(502).json({ error: 'Could not reach metadata-backfill engine: ' + e.message });
    return;
  }
  res.status(upstream.status);
  try { res.json(JSON.parse(text)); }
  catch { res.type('application/json').send(text); }
}
