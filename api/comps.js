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
//   ONE-SHOT: { request:"…natural language…", include_on_market?, include_unreliable_noi?,
//              limit?, name?, client? }
//     → proxied to the engine's own one-shot (${MCP_BASE}/api/comps); returns the engine's
//       compact JSON verbatim ({ status, filename, download_url, counts, cap_rate_range, … }).
//   ROW-MODE: { comp_type:"sales", on_market:[...], sold:[...], name, client }   or
//             { comp_type:"lease", comps:[...], name, client }
//     → proxied to the BOV builder (BOV_SERVICE_URL); returns { status, filename, download_url,
//       comp_type, rows_by_sheet, … }   (base64 payload is stripped)
//
// Env:
//   GOV_API_URL       the MCP/engine base (default life-command-center-production…) — the engine
//                     owns comps-tools.js + the domain DBs; tranquil-delight is a PROXY with no DB.
//   LCC_API_KEY       validates the incoming caller AND is sent as the bearer to the engine
//                     (same base/key as api/query-comps.js).
//   BOV_SERVICE_URL   default https://pacific-love-production-f6b9.up.railway.app (row-mode only)
//   BOV_API_KEY       row-mode only — same value set on the BOV Railway service
// ============================================================================

import { handleCors, authenticate } from './_shared/auth.js';

const BOV_SERVICE_URL = (process.env.BOV_SERVICE_URL || 'https://pacific-love-production-f6b9.up.railway.app').replace(/\/+$/, '');
const BOV_API_KEY = process.env.BOV_API_KEY || '';

// Prompt 70 — the one-shot renderer + the domain DBs live on the ENGINE service, not on
// tranquil-delight (a proxy with no DB env). Mirror api/query-comps.js exactly: same MCP_BASE
// (GOV_API_URL) and the same LCC_API_KEY bearer sent to the engine. tranquil-delight forwards
// the natural-language one-shot to the engine's working `/api/comps`, so all surfaces synthesize
// a byte-identical workbook from the ONE renderer.
const MCP_BASE = (process.env.GOV_API_URL || 'https://life-command-center-production.up.railway.app').replace(/\/+$/, '');
const LCC_API_KEY = process.env.LCC_API_KEY || '';

export default async function compsHandler(req, res) {
  if (handleCors(req, res)) return;

  // Prompt 68 — inbound CALLER auth now rides the shared authenticate() (same as
  // operationsHandler / the other connector tools). Copilot-namespaced calls carry
  // _copilot_path → M365 passthrough; ChatGPT/MCP flat-route calls send a real
  // LCC_API_KEY → validated; anonymous flat-route calls still 401 in production.
  // The bearer parse in authenticate() tolerates a doubled "Bearer " prefix.
  // BOV_API_KEY stays entirely server-side — it is the OUTBOUND key to the BOV
  // service below and is never checked against the inbound caller.
  const user = await authenticate(req, res);
  if (!user) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST with a JSON comps payload.' });
    return;
  }

  const payload = req.body || {};
  const hasRows = (Array.isArray(payload.on_market) && payload.on_market.length) ||
                  (Array.isArray(payload.sold) && payload.sold.length) ||
                  (Array.isArray(payload.comps) && payload.comps.length);

  // Prompt 70 — ONE-SHOT `request` mode (Copilot GenerateComps / plain-language appraisal
  // requests) is a PROXY to the engine's own one-shot, exactly like api/query-comps.js. The
  // engine owns comps-tools.js + the domain DBs; tranquil-delight has no DB env, so it must NOT
  // hit the DB directly (the prompt-69 direct-DB call 502'd here for missing DIA/GOV_SUPABASE_*).
  // Forward the caller's `request` (+ optional one-shot fields) to ${MCP_BASE}/api/comps and
  // return the engine's compact JSON verbatim ({ download_url, counts, cap_rate_range, … }).
  const request = String(payload.request || req.body?.request || '').trim();
  if (request && !hasRows) {
    // Drop our own inbound-gate fields before forwarding to the engine.
    const { _k, api_key, lcc_api_key, ...body } = payload;
    let upstream, text;
    try {
      upstream = await fetch(`${MCP_BASE}/api/comps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LCC_API_KEY}` },
        body: JSON.stringify(body),
        // Generous timeout — the engine synthesizes + builds the workbook.
        signal: AbortSignal.timeout(180000),
      });
      text = await upstream.text();
    } catch (e) {
      res.status(502).json({ error: 'Could not reach comps engine: ' + e.message });
      return;
    }
    if (!upstream.ok) {
      res.status(502).json({ error: 'Comps engine error ' + upstream.status, detail: text.slice(0, 800) });
      return;
    }
    let data;
    try { data = JSON.parse(text); }
    catch { res.status(502).json({ error: 'Comps engine returned non-JSON.', raw: text.slice(0, 400) }); return; }
    // The engine already returns the compact result (download link + counts, no raw rows).
    res.status(data && data.error ? 400 : 200).json(data);
    return;
  }

  // Row-mode (structured comp_type + rows) — unchanged. ChatGPT / existing callers pass
  // explicit rows and build directly through the BOV service, with no synthesize.
  if (!BOV_API_KEY) {
    res.status(500).json({ error: 'Comps service not configured — set BOV_API_KEY on the Copilot service.' });
    return;
  }

  const compType = String(payload.comp_type || '').toLowerCase();
  if (compType !== 'sales' && compType !== 'lease') {
    res.status(400).json({ error: 'Payload must include comp_type: "sales" or "lease" (or a one-shot `request`).' });
    return;
  }
  if (!hasRows) {
    res.status(400).json({ error: 'No comp rows supplied (sales: on_market/sold; lease: comps).' });
    return;
  }

  // Drop our own gate field before forwarding to the comps service.
  const { _k, api_key, lcc_api_key, ...comps } = payload;

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
