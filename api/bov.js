// ============================================================================
// api/bov.js — BOV workbook generation proxy (LCC Deal Agent Copilot bridge)
//
// Bridges the LCC Copilot to the standalone BOV Generator service on Railway.
// The BOV_API_KEY stays entirely server-side; callers never see it. When
// BOV_BRIDGE_TOKEN is set, requests must present it (header X-LCC-Key, query
// ?k=, or body._k) — this gates the endpoint without exposing the API key.
//
// POST /api/bov
//   body: { asset_type, property, tenants, underwriting, client }  (BOV schema)
//   → { status, filename, download_url, expires_in_seconds, file_size_kb,
//       recalc_result }   (base64 payload is stripped)
//
// Env:
//   BOV_SERVICE_URL   default https://pacific-love-production-f6b9.up.railway.app
//   BOV_API_KEY       required — same value set on the BOV Railway service
//   BOV_BRIDGE_TOKEN  optional — shared secret gating this endpoint
// ============================================================================

import { handleCors } from './_shared/auth.js';

const BOV_SERVICE_URL = (process.env.BOV_SERVICE_URL || 'https://pacific-love-production-f6b9.up.railway.app').replace(/\/+$/, '');
const BOV_API_KEY = process.env.BOV_API_KEY || '';
const BOV_BRIDGE_TOKEN = process.env.BOV_BRIDGE_TOKEN || '';

export default async function bovHandler(req, res) {
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
    res.status(500).json({ error: 'BOV service not configured — set BOV_API_KEY on the Copilot service.' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST with a JSON deal payload.' });
    return;
  }

  const payload = req.body || {};
  if (!payload.asset_type || !payload.property || !payload.client) {
    res.status(400).json({ error: 'Payload must include asset_type, property, and client (tenants + underwriting recommended).' });
    return;
  }

  // Drop our own gate field before forwarding to the BOV service.
  const { _k, ...deal } = payload;

  let upstream, text;
  try {
    upstream = await fetch(`${BOV_SERVICE_URL}/generate-bov`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': BOV_API_KEY },
      body: JSON.stringify(deal),
      signal: AbortSignal.timeout(180000),
    });
    text = await upstream.text();
  } catch (e) {
    res.status(502).json({ error: 'Could not reach BOV service: ' + e.message });
    return;
  }

  if (!upstream.ok) {
    res.status(upstream.status).json({ error: 'BOV service error ' + upstream.status, detail: text.slice(0, 800) });
    return;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    res.status(502).json({ error: 'BOV service returned non-JSON.', raw: text.slice(0, 400) });
    return;
  }

  // Return everything EXCEPT the heavy base64 blob — the page uses download_url.
  const { file_base64, ...rest } = data;
  res.status(200).json(rest);
}
