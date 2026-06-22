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
import { domainQuery, getDomainCredentials } from '../_shared/domain-db.js';
import { extractDocumentText } from '../_shared/document-text.js';
import { downloadFromStorage } from '../_shared/artifact-storage.js';
import { processDeedDocument } from './deed-parser.js';
// R59 — BD-spine propagation deps for the deed parser (Units 1-4). Importing them
// here (not inside deed-parser.js) keeps the parser dependency-light + unit-
// testable; the worker injects the production wiring.
import { opsQuery, insertEntityRelationship } from '../_shared/ops-db.js';
import { ensureEntityLink } from '../_shared/entity-link.js';
import { granteePassesOwnerGuards, resolveDeedRecordedOwner } from './sidebar-pipeline.js';
import { openResearchTask } from '../_shared/research-task.js';

/**
 * UW#6-REV — build a domain-bound Storage getter for a property_documents row.
 * Reads the durable bytes from the domain's `property-documents` bucket with the
 * domain service key (the bytes are co-located with the row). Returns null when
 * the row has no storage_path or the domain isn't configured (URL fallback only).
 */
function buildStorageGet(domain, bucket) {
  const creds = getDomainCredentials(domain);
  if (!creds) return null;
  const b = bucket || 'property-documents';
  return (objectPath) => downloadFromStorage({ baseUrl: creds.url, key: creds.key, bucket: b, objectPath });
}

const DOMAINS = { dia: 'dialysis', dialysis: 'dialysis', gov: 'government', government: 'government' };

/** Eligible queue: property_documents with a source and NO raw_text yet. */
export async function fetchEligibleDocs(domain, { limit, doctype }, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  // Eligible = no text yet AND a byte source exists — either the durable
  // storage_path (UW#6-REV, the win) OR a (possibly-stale-token) source_url.
  let path =
    'property_documents?raw_text=is.null&or=(storage_path.not.is.null,source_url.not.is.null)' +
    '&select=document_id,property_id,source_url,storage_path,storage_bucket,document_type,file_name,ingestion_status' +
    `&order=document_id.desc&limit=${limit}`;
  if (doctype && doctype !== 'all') path += `&document_type=eq.${encodeURIComponent(doctype)}`;
  const r = await q(domain, 'GET', path);
  if (!r.ok) return { ok: false, status: r.status, detail: r.data };
  return { ok: true, rows: Array.isArray(r.data) ? r.data : [] };
}

// R58c — the terminal "no parties" marker. Bumped from the bare 'deed_no_parties'
// so the connective-anchored narrative fix gets ONE retroactive pass over the
// backlog R58b stamped 'deed_no_parties' (e.g. doc 3964): those rows are now
// eligible again, and after R58c they either resolve a grantee (drop out via the
// grantee-not-null filter) or are re-marked at THIS version (excluded going
// forward) — so genuine deed-of-trust docs are never re-hammered.
export const DEED_NO_PARTIES_TERMINAL = 'deed_no_parties_r58c';

/**
 * R58b Unit 3 — re-parse queue: deed docs that ALREADY have raw_text (so no
 * fetch/OCR needed) but whose deed parse never resolved a grantee. Selecting on
 * the stored text makes a parser improvement cheap to apply retroactively — a
 * broad OCR drain is never wasted. Idempotent: a doc either gets a grantee
 * parsed (→ extracted_data.deed_extraction.grantee non-null → drops out) or is
 * marked terminal at the current parser version (genuine deed-of-trust →
 * excluded). The legacy R58b 'deed_no_parties' rows are intentionally INCLUDED
 * (re-tried once under R58c); only the current terminal marker is excluded.
 */
export async function fetchReparseDocs(domain, { limit }, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  const path =
    'property_documents?raw_text=not.is.null' +
    '&document_type=ilike.*deed*' +
    '&extracted_data->deed_extraction->>grantee=is.null' +
    `&or=(ingestion_status.is.null,ingestion_status.neq.${DEED_NO_PARTIES_TERMINAL})` +
    '&select=document_id,property_id,raw_text,document_type,file_name,ingestion_status' +
    `&order=document_id.desc&limit=${limit}`;
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

  if (!row.source_url && !row.storage_path) return { document_id: row.document_id, outcome: 'no_source' };

  // Storage-first: the durable bytes (UW#6-REV) are read from the domain bucket
  // with the domain key; source_url is the live-token fallback. deps.storageGet
  // override wins (tests); else bind one to this row's domain + bucket.
  const storageGet = row.storage_path
    ? (deps.storageGet || buildStorageGet(domain, row.storage_bucket))
    : null;

  const ext = await extract(
    {
      sourceUrl: row.source_url || null,
      storagePath: row.storage_path || null,
      mediaType: null,
      allowOcr: deps.allowOcr !== false,
      // UW#6 — route the deed/document OCR through the UW#4/#4b free-first tiered
      // flow (Surya/Paddle → cheap cloud → gpt-4o LAST RESORT) so scanned deeds
      // don't burn the most-expensive engine. Opt-out via deps.ocrTiered=false.
      ocrTiered: deps.ocrTiered !== false,
    },
    { ...deps, storageGet }
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
      ocr_tier: ext.ocr_tier || null, ocr_engine: ext.ocr_engine || null, ocr_pages: ext.ocr_pages ?? null,
      grantor: deedRes?.parsed?.grantor || null,
      grantee: deedRes?.parsed?.grantee || null,
      implied_price: deedRes?.parsed?.implied_sale_price || null,
      deed_record_id: deedRes?.deedRecordId || null,
      r51_fed: !!deedRes?.r51Fed,
      sale_verified: (deedRes?.upgradedTransactions || 0) > 0,
      implied_price_filled: !!deedRes?.impliedPriceFilled,
      // R59 propagation effects
      sale_parties_filled: !!(deedRes?.saleBuyerFilled || deedRes?.saleSellerFilled),
      ownership_event: !!deedRes?.ownershipEventAppended,
      suspected_sale: !!deedRes?.suspectedSaleSurfaced,
      grantee_entity_id: deedRes?.granteeEntityId || null,
      owns_edge: !!deedRes?.ownsEdgeCreated,
      trace_task: !!deedRes?.traceGranteeTaskSurfaced,
    };
  }

  return { document_id: row.document_id, outcome: 'text_extracted', method: ext.method, text_len: ext.text_len, ocr_tier: ext.ocr_tier || null, ocr_engine: ext.ocr_engine || null, ocr_pages: ext.ocr_pages ?? null };
}

/**
 * R58b Unit 3 — re-parse ONE deed over its STORED raw_text (no fetch, no OCR).
 * Runs only the deed parser. When no party is parsed (deed of trust, etc.) the
 * row is marked terminal (DEED_NO_PARTIES_TERMINAL) so it drops out of the
 * re-parse queue and is not re-hammered.
 * Outcomes: deed_parsed | no_parties | no_text
 */
export async function processOneReparse(domain, row, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  const runDeed = deps.processDeedDocument || processDeedDocument;

  if (!row.raw_text) return { document_id: row.document_id, outcome: 'no_text' };

  let opts = {};
  if (row.property_id != null) {
    const pr = await q(domain, 'GET', `properties?property_id=eq.${row.property_id}&select=city,state&limit=1`).catch(() => null);
    if (pr?.ok && pr.data?.[0]) opts = { city: pr.data[0].city || undefined, state: pr.data[0].state || undefined };
  }
  const deedRes = await runDeed(domain, row.property_id, row.document_id, row.raw_text, opts, deps).catch((e) => ({ error: e?.message || String(e) }));
  const grantor = deedRes?.parsed?.grantor || null;
  const grantee = deedRes?.parsed?.grantee || null;

  if (!grantor && !grantee) {
    // Genuinely no parties (e.g. a deed of trust) — mark terminal so the
    // re-parse queue drains and never re-hammers the same unparseable doc.
    await q(domain, 'PATCH', `property_documents?document_id=eq.${row.document_id}`,
      { ingestion_status: DEED_NO_PARTIES_TERMINAL }, { Prefer: 'return=minimal' }).catch(() => {});
    return { document_id: row.document_id, outcome: 'no_parties' };
  }

  return {
    document_id: row.document_id, outcome: 'deed_parsed',
    grantor, grantee,
    implied_price: deedRes?.parsed?.implied_sale_price || null,
    price_source: deedRes?.parsed?.price_source || null,
    deed_record_id: deedRes?.deedRecordId || null,
    r51_fed: !!deedRes?.r51Fed,
    sale_verified: (deedRes?.upgradedTransactions || 0) > 0,
    implied_price_filled: !!deedRes?.impliedPriceFilled,
    // R59 propagation effects (also run on retroactive re-parse)
    sale_parties_filled: !!(deedRes?.saleBuyerFilled || deedRes?.saleSellerFilled),
    ownership_event: !!deedRes?.ownershipEventAppended,
    suspected_sale: !!deedRes?.suspectedSaleSurfaced,
    grantee_entity_id: deedRes?.granteeEntityId || null,
    owns_edge: !!deedRes?.ownsEdgeCreated,
    trace_task: !!deedRes?.traceGranteeTaskSurfaced,
  };
}

const PROD_DEPS = {
  domainQuery, extractDocumentText, processDeedDocument,
  // R59 deed → BD-spine propagation (Units 1-4). Each is consumed by
  // processDeedDocument's Step 6 only when present, so unit tests that inject
  // just { domainQuery } keep the exact pre-R59 deed behavior.
  granteePassesOwnerGuards,
  resolveRecordedOwner: (domain, name) => resolveDeedRecordedOwner(domain, name, { domainQuery }),
  ensureEntityLink,
  insertEntityRelationship,
  opsQuery,
  openResearchTask,
  resolveBuyerParent: (entityId) => opsQuery('POST', 'rpc/lcc_resolve_buyer_parent', { p_entity_id: entityId }),
};

export async function handleDocumentTextTick(req, res, deps = PROD_DEPS) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  // R58b Unit 3 — re-parse mode runs the deed parser over docs that ALREADY have
  // raw_text (no fetch/OCR), retroactively applying parser improvements.
  const reparse = (req.query.mode || '').toLowerCase() === 'reparse' || String(req.query.reparse) === '1';
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '15', 10)));
  const doctype = (req.query.doctype || 'deed').toLowerCase();          // default the headline lane
  const domainParam = (req.query.domain || 'both').toLowerCase();
  const domains = domainParam === 'both' ? ['dialysis', 'government'] : [DOMAINS[domainParam]].filter(Boolean);
  const tickBudgetMs = Math.max(5000, parseInt(process.env.DOC_TEXT_TICK_BUDGET_MS || '22000', 10));

  const result = {
    mode: (reparse ? 'reparse' : 'drain') + (dryRun ? '_dry_run' : ''),
    doctype, limit, reparse,
    by_domain: {},
    scanned: 0, text_extracted: 0, deed_parsed: 0, needs_ocr: 0, no_source: 0, error: 0,
    no_parties: 0, no_text: 0,
    deed_records_created: 0, r51_fed: 0, sales_verified: 0, implied_prices_filled: 0,
    // R59 — BD-spine propagation effects (deed Units 1-4).
    sale_parties_filled: 0, ownership_events: 0, suspected_sales: 0, grantee_entities: 0,
    owns_edges: 0, trace_tasks: 0,
    // UW#4c — per-page OCR cost telemetry (Document AI bills per page).
    ocr_pages_total: 0, ocr_by_engine: {},
    items: [],
  };

  const deadline = Date.now() + tickBudgetMs;
  for (const domain of domains) {
    const short = domain === 'dialysis' ? 'dia' : 'gov';
    const eligible = reparse
      ? await fetchReparseDocs(domain, { limit }, deps)
      : await fetchEligibleDocs(domain, { limit, doctype }, deps);
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
      const r = reparse ? await processOneReparse(domain, row, deps) : await processOneDoc(domain, row, deps);
      r.domain = short;
      result.scanned++;
      if (Object.prototype.hasOwnProperty.call(result, r.outcome)) result[r.outcome]++;
      if (r.deed_record_id) result.deed_records_created++;
      if (r.r51_fed) result.r51_fed++;
      if (r.sale_verified) result.sales_verified++;
      if (r.implied_price_filled) result.implied_prices_filled++;
      // R59 propagation effects
      if (r.sale_parties_filled) result.sale_parties_filled++;
      if (r.ownership_event) result.ownership_events++;
      if (r.suspected_sale) result.suspected_sales++;
      if (r.grantee_entity_id) result.grantee_entities++;
      if (r.owns_edge) result.owns_edges++;
      if (r.trace_task) result.trace_tasks++;
      // UW#4c — accumulate per-page OCR cost (a cloud OCR that ran still cost pages).
      if (Number.isFinite(r.ocr_pages) && r.ocr_pages > 0) {
        result.ocr_pages_total += r.ocr_pages;
        const eng = r.ocr_engine || r.ocr_tier || 'unknown';
        result.ocr_by_engine[eng] = (result.ocr_by_engine[eng] || 0) + r.ocr_pages;
      }
      result.items.push(r);
    }
  }

  // Cost line (Document AI bills per page) — observable in the Railway logs.
  if (result.ocr_pages_total > 0) {
    console.log(`[document-text] OCR cost: ${result.ocr_pages_total} pages ${JSON.stringify(result.ocr_by_engine)}`);
  }

  return res.status(200).json(result);
}
