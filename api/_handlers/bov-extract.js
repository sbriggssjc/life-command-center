// ============================================================================
// BOV extract — R58 "Unit 4", Step 2B handler
// Life Command Center · sub-route of intake.js (?_route=bov-extract-tick)
//
//   GET  /api/bov-extract?cre_property_id=16   — dry-run (report sidecar coverage)
//   POST /api/bov-extract  { cre_property_id }  — extract lease/dd/om text →
//                                                 lcc_cre_bov_extraction (reviewable)
//
// Unit 4 proper: reads a property's PERSISTED text sidecars (Step 2A) and emits
// the BOV generator's request record. Never fetches/OCRs — if a lease has no
// sidecar yet, it says so and points at Step 2A. The generator's {cre_property_id}
// input path then loads the reviewed record and builds the identical workbook.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { runBovExtract, extractBovRecord, gatherPropertyText } from '../_shared/bov-extract.js';

export async function handleBovExtract(req, res, deps = {}) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const crePropertyId = req.method === 'POST'
    ? (req.body?.cre_property_id ?? req.body?.crePropertyId)
    : (req.query.cre_property_id ?? req.query.crePropertyId);
  if (crePropertyId == null) {
    return res.status(422).json({ error: 'cre_property_id is required' });
  }

  // Dry-run: report what text is available without extracting.
  if (req.method === 'GET') {
    const g = await gatherPropertyText(crePropertyId, deps);
    return res.status(200).json({
      cre_property_id: Number(crePropertyId),
      leases: g.leases.length, dd: g.dd.length, om: g.om.length,
      source_document_ids: g.sourceDocIds,
      citation_risk: g.citationRisk, ocr_confidence: g.minConfidence,
      ready: g.leases.length > 0 || g.dd.length > 0 || g.om.length > 0,
    });
  }

  const out = await runBovExtract(crePropertyId, deps);
  if (!out.ok) return res.status(200).json({ ok: false, cre_property_id: Number(crePropertyId), reason: out.reason, hint: out.hint });
  return res.status(200).json({
    ok: true,
    cre_property_id: Number(crePropertyId),
    record_id: out.record_id,
    tenant_count: out.meta?.tenant_count,
    citation_risk: out.meta?.citation_risk,
    source_document_ids: out.meta?.source_document_ids,
    per_lease: out.meta?.per_lease,
    status: 'extracted',
  });
}

export { runBovExtract, extractBovRecord };
