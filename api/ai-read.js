// ============================================================================
// api/ai-read.js — AI read-surface bridge (ChatGPT / Copilot → shared MCP engine)
//
// The twin of api/query-comps.js. ChatGPT Actions + the Copilot connector call
// the LCC read operations (search-entities, property-context, contact-context,
// queue-summary, pipeline-health, recall-memory, and the BOUNDED daily-briefing).
// Those ops are owned by the shared MCP engine (GOV_API_URL) — the same engine
// Claude reaches via /mcp — so every surface returns identical, bounded JSON.
// This handler authenticates the connector's X-LCC-Key and forwards to the engine.
//
// This unifies the read surface onto THIS host (tranquil-delight) so ChatGPT and
// Copilot use ONE base URL. Single engine, no drift. See
// docs/os/architecture/unification-changeset.md (Phase 1).
//
// Route → engine target is set by the caller via req.query._mcpTarget (mirrors
// server.js's existing alias style). Defaults to req.path when unset.
//
// Env:
//   GOV_API_URL   the MCP engine base (already set on this host; query-comps uses it)
//   LCC_API_KEY   validates the incoming X-LCC-Key AND is the bearer to the engine
// ============================================================================

import { handleCors } from './_shared/auth.js';

const MCP_BASE = (process.env.GOV_API_URL || 'https://life-command-center-production.up.railway.app').replace(/\/+$/, '');
const LCC_API_KEY = process.env.LCC_API_KEY || '';

export default async function aiReadHandler(req, res) {
  if (handleCors(req, res)) return;

  // Gate with the same X-LCC-Key the connector already sends.
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
    res.status(405).json({ error: 'Use POST with a JSON body.' });
    return;
  }

  // The engine endpoint to forward to (set by the route alias; e.g. the bounded
  // /api/ai/daily-briefing forwards to the engine's /api/daily-briefing).
  const target = req.query._mcpTarget || req.path;
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
    res.status(502).json({ error: 'Could not reach LCC read engine: ' + e.message });
    return;
  }

  res.status(upstream.status);
  try { res.json(JSON.parse(text)); }
  catch { res.type('application/json').send(text); }
}
