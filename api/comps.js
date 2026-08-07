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

import { handleCors, authenticate } from './_shared/auth.js';
import { domainQuery } from './_shared/domain-db.js';
import { runGenerateCompsFromRequest } from '../mcp/comps-tools.js';

const BOV_SERVICE_URL = (process.env.BOV_SERVICE_URL || 'https://pacific-love-production-f6b9.up.railway.app').replace(/\/+$/, '');
const BOV_API_KEY = process.env.BOV_API_KEY || '';

// Prompt 69 — the shared one-shot renderer (mcp/comps-tools.js::runGenerateCompsFromRequest)
// expects PostgREST fetch helpers with the signature (method, path, body, prefer) → { ok, data }.
// api/_shared/domain-db.js::domainQuery has a (domain, method, path, body, extraHeaders) shape,
// so wrap it. This is the SAME engine the MCP `generate_comps` one-shot uses — tranquil-delight
// and the standalone MCP therefore synthesize a byte-identical workbook (canon: ONE renderer).
const diaQuery = (method, path, body, prefer) =>
  domainQuery('dialysis', method, path, body, prefer ? { Prefer: prefer } : {});
const govQuery = (method, path, body, prefer) =>
  domainQuery('government', method, path, body, prefer ? { Prefer: prefer } : {});

// The outbound BOV build — posts the template rows the shared renderer produced to the BOV
// service exactly as row-mode does below (X-API-Key: BOV_API_KEY, base64 blob stripped). This
// is the `generateWorkbook` callback runGenerateCompsFromRequest calls after synthesize.
async function postCompsToBov(compsPayload) {
  const resp = await fetch(`${BOV_SERVICE_URL}/generate-comps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': BOV_API_KEY },
    body: JSON.stringify(compsPayload),
    signal: AbortSignal.timeout(180000),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error('Comps service returned HTTP ' + resp.status + ': ' + text.slice(0, 500));
  }
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('Comps service returned non-JSON: ' + text.slice(0, 300)); }
  const { file_base64, ...rest } = data;
  return rest;
}

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

  if (!BOV_API_KEY) {
    res.status(500).json({ error: 'Comps service not configured — set BOV_API_KEY on the Copilot service.' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST with a JSON comps payload.' });
    return;
  }

  const payload = req.body || {};
  const hasRows = (Array.isArray(payload.on_market) && payload.on_market.length) ||
                  (Array.isArray(payload.sold) && payload.sold.length) ||
                  (Array.isArray(payload.comps) && payload.comps.length);

  // Prompt 69 — ONE-SHOT `request` mode (Copilot GenerateComps / plain-language appraisal
  // requests). When the caller passes a natural-language `request` and no explicit rows, run
  // the SAME synthesize-then-build path the MCP `generate_comps` one-shot uses, then build the
  // workbook through the existing BOV path below. Dialysis + appraisal mode are detected from
  // the request text by the engine (no `vertical`/`appraisal_mode` needed from the caller);
  // appraisal defaults (include_on_market / include_unreliable_noi, cap discipline on the
  // displayed rows) live inside runGenerateCompsFromRequest. Only the compact result (download
  // link + counts, no raw rows) is returned, per canon.
  const request = String(payload.request || req.body?.request || '').trim();
  if (request && !hasRows) {
    let result;
    try {
      result = await runGenerateCompsFromRequest(payload, { govQuery, diaQuery }, postCompsToBov);
    } catch (e) {
      res.status(502).json({ error: 'Could not build comps workbook: ' + (e?.message || String(e)) });
      return;
    }
    res.status(result && result.error ? 400 : 200).json(result);
    return;
  }

  // Row-mode (structured comp_type + rows) — unchanged. ChatGPT / existing callers pass
  // explicit rows and build directly, with no synthesize.
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
