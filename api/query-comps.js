// ============================================================================
// api/query-comps.js — Comps QUERY bridge (LCC Deal Agent / Copilot → engine)
//
// The LCC Intelligence connector (host = this app) calls POST /api/query-comps
// and /api/synthesize-comps. This handler authenticates the connector's
// X-LCC-Key and forwards the request to the SHARED comps engine that already
// runs on the MCP server (GOV_API_URL), which owns comps-tools.js -> runComps.
// Claude's `query_comps` MCP tool hits the same engine, so all surfaces return
// identical, de-duplicated, cap-normalized comps + the same `markdown` table.
//
// This is the query twin of api/comps.js (which is the WORKBOOK generator proxy).
//
// Env:
//   GOV_API_URL   the MCP server base (default life-command-center-production…)
//   LCC_API_KEY   validates the incoming X-LCC-Key AND is sent as the bearer to
//                 the MCP server (same key across the LCC services).
// ============================================================================

import { handleCors } from './_shared/auth.js';

const MCP_BASE = (process.env.GOV_API_URL || 'https://life-command-center-production.up.railway.app').replace(/\/+$/, '');
const LCC_API_KEY = process.env.LCC_API_KEY || '';

export default async function queryCompsHandler(req, res) {
  if (handleCors(req, res)) return;

  // Gate with the same X-LCC-Key the connector already sends (matches securityDefinitions).
  if (LCC_API_KEY) {
    const provided = req.headers['x-lcc-key']
      || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      || (req.body && req.body._k) || '';
    if (provided !== LCC_API_KEY) {
      res.status(401).json({ error: 'Unauthorized — invalid or missing X-LCC-Key.' });
      return;
    }
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST with a JSON comp query.' });
    return;
  }

  // Route to the matching engine endpoint (query vs synthesize).
  const target = String(req.path || '').includes('synthesize')
    ? '/api/synthesize-comps'
    : '/api/query-comps';

  const { _k, ...body } = req.body || {};

  let upstream, text;
  try {
    upstream = await fetch(`${MCP_BASE}${target}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LCC_API_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    text = await upstream.text();
  } catch (e) {
    res.status(502).json({ error: 'Could not reach comps engine: ' + e.message });
    return;
  }

  res.status(upstream.status);
  try { res.json(JSON.parse(text)); }
  catch { res.type('application/json').send(text); }
}
