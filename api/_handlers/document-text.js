// ============================================================================
// Document text / deed-parse worker — R58 Units 1 + 2
// Life Command Center · sub-route of intake.js (?_route=document-text-tick)
//
//   GET  /api/document-text-tick   — dry-run (lists the eligible queue, no fetch/OCR)
//   POST /api/document-text-tick   — drain (fetch bytes → text → write raw_text;
//                                     deed docs additionally run processDeedDocument)
//
// THE foundation the audit found missing: 1,975 property_documents are filed but
// only OMs are deeply extracted; deed/lease/other carry empty raw_text because
// nothing ever OCR'd / text-extracted the PDFs we already hold. This worker fills
// `property_documents.raw_text` (Unit 1) reusing the shared text/OCR foundation
// (digital pdf-parse → gpt-4o vision OCR fallback), and for deed docs wires the
// previously-ORPHANED deed parser (Unit 2): grantor/grantee/implied-price →
// deed_records + properties.latest_deed_grantee (feeds R51) + a confirm-gated
// implied-price candidate on a matching sale.
//
// SAFE / GATED: capped batch (?limit, default 15 / hard cap 50), wall-clock
// budgeted. Idempotent — only rows with NULL raw_text are eligible, so a filled
// row drops out. A scanned PDF with no OCR available records ingestion_status=
// 'needs_ocr' (terminal-this-pass, sized for the OCR follow-up), NOT an error.
// A transient byte-fetch failure is left UNmarked so a later tick retries.
//
// VALUE-RANK NOTE: ordered by document_id DESC (newest captures first). The docs
// carry no rent, and a clean cross-domain rent join (gov gross_rent vs dia
// projected lease rent) is heavier than the OCR it would prioritize; recency is
// the pragmatic proxy and the cap+repeat-tick model drains the whole set anyway.
//
// No new api/*.js — handler lives here, routed through intake.js.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { domainQuery } from '../_shared/domain-db.js';
import { extractDocumentText } from '../_shared/document-text.js';
import { processDeedDocument } from './deed-parser.js';

const DOMAINS = { dia: 'dialysis', dialysis: 'dialysis', gov: 'government', government: 'government' };

/** Eligible queue: property_documents with a source and NO raw_text yet. */
export async function fetchEligibleDocs(domain, { limit, doctype }, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  let path =
    'property_documents?raw_text=is.null&source_url=not.is.null' +
    '&select=document_id,property_id,source_url,document_type,file_name,ingestion_status' +
    `&order=document_id.desc&limit=${limit}`;
  if (doctype && doctype !== 'all') path += `&document_type=eq.${encodeURIComponent(doctype)}`;
  const r = await q(domain, 'GET', path);
  if (!r.ok) return { ok: false, status: r.status, detail: r.data };
  return { ok: true, rows: Array.isArray(r.data) ? r.data : [] };
}

/**
 * Process ONE document: fetch bytes → text → write raw_text; if it's a deed, run
 * the deed parser too. Deps injected for testability.
 * Outcomes: text_extracted | deed_parsed | needs_ocr | no_source | error
 */
export async function processOneDoc(domain, row, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  const extract = deps.extractDocumentText || extractDocumentText;
  const runDeed = deps.processDeedDocument || processDeedDocument;

  if (!row.source_url) return { document_id: row.document_id, outcome: 'no_source' };

  const ext = await extract(
    { sourceUrl: row.source_url, mediaType: null, allowOcr: deps.allowOcr !== false },
    deps
  );
  if (!ext.ok) {
    // Transient byte-fetch failure → leave the row untouched so a later tick retries.
    return { document_id: row.document_id, outcome: 'error', reason: ext.reason || 'fetch_failed', detail: ext.detail || null };
  }
  if (ext.needs_ocr || !ext.text) {
    await q(domain, 'PATCH', `property_documents?document_id=eq.${row.document_id}`,
      { ingestion_status: 'needs_ocr' }, { Prefer: 'return=minimal' }).catch(() => {});
    return { document_id: row.document_id, outcome: 'needs_ocr', reason: ext.reason || null, text_len: 0 };
  }

  // Persist the raw text (the foundation every parser reads).
  await q(domain, 'PATCH', `property_documents?document_id=eq.${row.document_id}`,
    { raw_text: ext.text, ingestion_status: 'text_extracted' }, { Prefer: 'return=minimal' }).catch(() => {});

  const isDeed = String(row.document_type || '').toLowerCase().includes('deed');
  if (isDeed && row.property_id != null) {
    // Pass the property's real state/city so the transfer-tax→price calc isn't
    // mis-applied (parseDeedText only computes an implied price for CA; a
    // non-CA property correctly yields no bogus implied price).
    let opts = {};
    const pr = await q(domain, 'GET', `properties?property_id=eq.${row.property_id}&select=city,state&limit=1`).catch(() => null);
    if (pr?.ok && pr.data?.[0]) opts = { city: pr.data[0].city || undefined, state: pr.data[0].state || undefined };
    const deedRes = await runDeed(domain, row.property_id, row.document_id, ext.text, opts, deps).catch((e) => ({ error: e?.message || String(e) }));
    return {
      document_id: row.document_id, outcome: 'deed_parsed', method: ext.method, text_len: ext.text_len,
      grantor: deedRes?.parsed?.grantor || null,
      grantee: deedRes?.parsed?.grantee || null,
      implied_price: deedRes?.parsed?.implied_sale_price || null,
      deed_record_id: deedRes?.deedRecordId || null,
      r51_fed: !!deedRes?.r51Fed,
      sale_verified: (deedRes?.upgradedTransactions || 0) > 0,
      implied_price_filled: !!deedRes?.impliedPriceFilled,
    };
  }

  return { document_id: row.document_id, outcome: 'text_extracted', method: ext.method, text_len: ext.text_len };
}

const PROD_DEPS = { domainQuery, extractDocumentText, processDeedDocument };

export async function handleDocumentTextTick(req, res, deps = PROD_DEPS) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '15', 10)));
  const doctype = (req.query.doctype || 'deed').toLowerCase();          // default the headline lane
  const domainParam = (req.query.domain || 'both').toLowerCase();
  const domains = domainParam === 'both' ? ['dialysis', 'government'] : [DOMAINS[domainParam]].filter(Boolean);
  const tickBudgetMs = Math.max(5000, parseInt(process.env.DOC_TEXT_TICK_BUDGET_MS || '22000', 10));

  const result = {
    mode: dryRun ? 'dry_run' : 'drain',
    doctype, limit,
    by_domain: {},
    scanned: 0, text_extracted: 0, deed_parsed: 0, needs_ocr: 0, no_source: 0, error: 0,
    deed_records_created: 0, r51_fed: 0, sales_verified: 0, implied_prices_filled: 0,
    items: [],
  };

  const deadline = Date.now() + tickBudgetMs;
  for (const domain of domains) {
    const short = domain === 'dialysis' ? 'dia' : 'gov';
    const eligible = await fetchEligibleDocs(domain, { limit, doctype }, deps);
    if (!eligible.ok) { result.by_domain[short] = { error: 'list_failed', detail: eligible.detail }; continue; }
    result.by_domain[short] = { eligible: eligible.rows.length };

    if (dryRun) {
      for (const row of eligible.rows.slice(0, 20)) {
        result.items.push({ domain: short, document_id: row.document_id, document_type: row.document_type, file_name: row.file_name });
      }
      continue;
    }

    for (const row of eligible.rows) {
      if (Date.now() > deadline) break;
      const r = await processOneDoc(domain, row, deps);
      r.domain = short;
      result.scanned++;
      if (Object.prototype.hasOwnProperty.call(result, r.outcome)) result[r.outcome]++;
      if (r.deed_record_id) result.deed_records_created++;
      if (r.r51_fed) result.r51_fed++;
      if (r.sale_verified) result.sales_verified++;
      if (r.implied_price_filled) result.implied_prices_filled++;
      result.items.push(r);
    }
  }

  return res.status(200).json(result);
}
