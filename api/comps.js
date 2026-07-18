// ============================================================================
// api/comps.js — Comps workbook generation proxy (LCC Deal Agent Copilot bridge)
//
// Comps twin of api/bov.js. Bridges the LCC Copilot / web page to the standalone
// BOV Generator service on Railway, which also hosts /generate-comps. The
// BOV_API_KEY stays entirely server-side; callers never see it. When
// BOV_BRIDGE_TOKEN is set, requests must present it (header X-LCC-Key, query
// ?k=, or body._k) — this gates the endpoint without exposing the API key.
//
// POST /api/comps
//   body: { comp_type:"sales", on_market:[...], sold:[...], name, client }   or
//         { comp_type:"lease", comps:[...], name, client }
//   → { status, filename, download_url, comp_type, rows_by_sheet,
//       skipped_formula_keys, unknown_keys }   (base64 payload is stripped)
//
// Env (shared with api/bov.js — same generator service):
//   BOV_SERVICE_URL   default https://pacific-love-production-f6b9.up.railway.app
//   BOV_API_KEY       required — same value set on the BOV Railway service
//   BOV_BRIDGE_TOKEN  optional — shared secret gating this endpoint
// ============================================================================

import { handleCors } from './_shared/auth.js';

const BOV_SERVICE_URL = (process.env.BOV_SERVICE_URL || 'https://pacific-love-production-f6b9.up.railway.app').replace(/\/+$/, '');
const BOV_API_KEY = process.env.BOV_API_KEY || '';
const BOV_BRIDGE_TOKEN = process.env.BOV_BRIDGE_TOKEN || '';

export default async function compsHandler(req, res) {
  if (handleCors(req, res)) return;

  // Optional shared-secret gate (only enforced when configured).
  if (BOV_BRIDGE_TOKEN) {
    const provided = req.headers['x-lcc-key'] || req.query.k || (req.body && req.body._k) || '';
    if (provided !== BOV_BRIDGE_TOKEN) {
      res.status(401).json({ error: 'Unauthorized — invalid or missing bridge token.' });
      return;
    }
  }

  if (!BOV_API_KEY) {
    res.status(500).json({ error: 'Comps service not configured — set BOV_API_KEY on the Copilot service.' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST with a JSON comps payload.' });
    return;
  }

  const payload = req.body || {};
  const compType = String(payload.comp_type || '').toLowerCase();
  if (compType !== 'sales' && compType !== 'lease') {
    res.status(400).json({ error: 'Payload must include comp_type: "sales" or "lease".' });
    return;
  }
  const hasRows = (Array.isArray(payload.on_market) && payload.on_market.length) ||
                  (Array.isArray(payload.sold) && payload.sold.length) ||
                  (Array.isArray(payload.comps) && payload.comps.length);
  if (!hasRows) {
    res.status(400).json({ error: 'No comp rows supplied (sales: on_market/sold; lease: comps).' });
    return;
  }

  // Drop our own gate field before forwarding to the comps service.
  const { _k, ...comps } = payload;

  let upstream, text;
  try {
    upstream = await fetch(`${BOV_SERVICE_URL}/generate-comps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': BOV_API_KEY },
      body: JSON.stringify(comps),
      signal: AbortSignal.timeout(180000),
    });
    text = await upstream.text();
  } catch (e) {
    res.status(502).json({ error: 'Could not reach comps service: ' + e.message });
    return;
  }

  if (!upstream.ok) {
    res.status(upstream.status).json({ error: 'Comps service error ' + upstream.status, detail: text.slice(0, 800) });
    return;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    res.status(502).json({ error: 'Comps service returned non-JSON.', raw: text.slice(0, 400) });
    return;
  }

  // Return everything EXCEPT the heavy base64 blob — the page uses download_url.
  const { file_base64, ...rest } = data;
  res.status(200).json(rest);
}
