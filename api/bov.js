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
import { domainQuery } from './_shared/domain-db.js';

const BOV_SERVICE_URL = (process.env.BOV_SERVICE_URL || 'https://pacific-love-production-f6b9.up.railway.app').replace(/\/+$/, '');
const BOV_API_KEY = process.env.BOV_API_KEY || '';
const BOV_BRIDGE_TOKEN = process.env.BOV_BRIDGE_TOKEN || '';

// Resolve a Medicare CCN from the deal payload (caller supplies it for dialysis deals).
function _dealClinicId(deal) {
  const p = deal.property || {};
  const t0 = (Array.isArray(deal.tenants) && deal.tenants[0]) || {};
  return p.medicare_id || p.ccn || p.cms_certification_number
    || t0.medicare_id || t0.ccn || (t0.credit && t0.credit.medicare_id) || null;
}

// Pull the reconciled current-year economics + value crosswalk for a clinic and
// inject formatted strings into tenants[0].credit.recon_* (fill-blanks only).
async function enrichDialysisFacilityCredit(deal) {
  const mid = _dealClinicId(deal);
  if (!mid) return;
  const q = encodeURIComponent(String(mid).trim());
  const econRows = await domainQuery('dialysis', 'GET', `v_clinic_econ_current?medicare_id=eq.${q}&limit=1`);
  const econ = Array.isArray(econRows) ? econRows[0] : (econRows && econRows.data && econRows.data[0]);
  if (!econ) return;
  let xw = null;
  try {
    const xr = await domainQuery('dialysis', 'GET', `v_dia_econ_value_crosswalk?medicare_id=eq.${q}&limit=1`);
    xw = Array.isArray(xr) ? xr[0] : (xr && xr.data && xr.data[0]);
  } catch (_e) { /* crosswalk optional */ }

  const numOr = v => (v == null || v === '' || !isFinite(Number(v))) ? null : Number(v);
  const usd = v => { const n = numOr(v); if (n == null) return null;
    return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US'); };
  const pctDec = v => { const n = numOr(v); return n == null ? null : (n * 100).toFixed(1) + '%'; };
  const rev = numOr(econ.reconciled_revenue), eb = numOr(econ.reconciled_ebitda);

  if (!Array.isArray(deal.tenants)) deal.tenants = [];
  if (!deal.tenants[0]) deal.tenants[0] = {};
  const credit = deal.tenants[0].credit = deal.tenants[0].credit || {};
  const setBlank = (k, v) => { if (v != null && v !== '' && (credit[k] == null || credit[k] === '')) credit[k] = v; };

  setBlank('recon_clinic_revenue', usd(rev));
  setBlank('recon_clinic_op_profit', usd(econ.reconciled_operating_profit));
  setBlank('recon_clinic_ebitda', usd(eb));
  setBlank('recon_clinic_ebitda_margin', (eb != null && rev) ? pctDec(eb / rev) : null);
  setBlank('recon_op_margin', pctDec(econ.operating_margin));
  setBlank('recon_rent_coverage', (xw && numOr(xw.rent_coverage_x) != null) ? numOr(xw.rent_coverage_x).toFixed(1) + 'x' : null);
  setBlank('recon_fiscal_year', econ.fiscal_year != null ? String(econ.fiscal_year) : null);
  setBlank('recon_confidence', econ.confidence_tier ? String(econ.confidence_tier).replace(/^\w/, c => c.toUpperCase()) : null);
  credit._recon_source = 'CMS HCRIS · dialysis_econ_reconciled_v1';
}

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

  // Enrich a dialysis deal with the subject facility's reconciled economics
  // (model dialysis_econ_reconciled_v1) so the BOV credit tab shows facility
  // revenue/EBITDA/margin + rent coverage. Fail-soft, fill-blanks, keyed on a
  // Medicare CCN the caller supplies (property.medicare_id / tenants[].medicare_id).
  try { await enrichDialysisFacilityCredit(deal); } catch (_e) { /* never block the BOV */ }

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
