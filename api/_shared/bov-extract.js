// ============================================================================
// BOV / Lease structured extractor — R58 "Unit 4", Step 2B
// Life Command Center · LCC Opps (xengecqvemvfknjvbvrq)
//
// Turns a property's PERSISTED text (the Unit-1 sidecars written by Step 2A) into
// the BOV generator's request shape — the missing consumer the document-text.js
// header always named ("a future rent-roll / dd / bov extractor — Unit 4"). It
// never fetches bytes or OCRs: it reads `lcc_cre_property_document_text`, so the
// extraction is deterministic over already-persisted text and every access point
// that later "BOVs this property" gets the SAME record.
//
// Output contract = bov-generator/main.py's builders (fill_assumptions(req)):
//   {
//     asset_type: 'NNN' | 'MOB',
//     property:   { address, city_state, building_sf, close_date, name },
//     tenants:    [{ name, guarantor, sf, lease_type, year1_rent, escalation_pct,
//                    lease_commencement, lease_expiration, rent_schedule[],
//                    abstract:{...LeaseAbstract...}, credit:{...}, clause_refs:{...} }],
//     real_estate:       { year_built, parcel_apn, land_acres, zoning, flood_zone, ... },
//     underwriting_hints:{ purchase_price, going_in_cap, in_place_noi, ... }
//   }
//
// Each lease → ONE tenant via a single self-contained AI extraction (the
// invokeExtractionAI fallback-chain, same engine the OM extractor uses). The
// clause_refs PAGE numbers come from the sidecar `pages[]` (DocAI layout tier) —
// the model supplies the SECTION, we resolve the page by locating the clause text
// in the page array. DD/OM text is merged into real_estate + underwriting_hints.
//
// PROVENANCE (spec 2B): executed lease > OM > CoStar > estimate. When two sources
// disagree on a factual field, the lease wins; the loser is dropped, not blended.
// Advisory/valuation figures are routed through extraction-field-policy so an
// asking/recommended number can never land in a reported field.
//
// Deps injected (opsQuery, invokeExtractionAI) → unit-testable with a stub AI and
// no DB. Never throws; a lease that fails extraction is skipped (logged), not fatal.
// ============================================================================

import { opsQuery } from './ops-db.js';
import { invokeExtractionAI } from './ai.js';
import { guardValuationWrite } from './extraction-field-policy.js';

export const BOV_EXTRACT_VERSION = process.env.BOV_EXTRACT_VERSION || 'unit4_v1';

// The lease-abstract fields the generator's Lease Abstract tab renders. The model
// is asked to fill these keys; anything it can't source stays null (never guessed).
const ABSTRACT_KEYS = [
  'landlord_of_record', 'tenant_of_record', 'guarantor', 'permitted_use',
  'lease_structure', 'taxes_responsibility', 'insurance_responsibility',
  'cam_responsibility', 'roof_structure_responsibility', 'landlord_obligations',
  'commencement_date', 'expiration_date', 'base_rent_year1', 'rent_escalations',
  'renewal_options', 'option_term_length', 'renewal_rent_method',
  'renewal_notice', 'early_termination', 'default_cure', 'holdover',
  'key_lease_risks', 'default_source',
];

/**
 * Strip a ```json code fence / prose wrapper and parse the first JSON object in a
 * model response. Returns null on no-parse (caller treats as a skipped lease).
 */
export function parseModelJson(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text.trim();
  // Drop a leading ```json / ``` fence and trailing ```.
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // If there's leading prose, grab from the first { to the last }.
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  const slice = s.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

/**
 * Given the sidecar `pages` array ([{page,text}]) and a snippet the model cites
 * for a clause, find the 1-based page whose text contains the snippet. Returns
 * null when pages are absent (single-page / digital) or no match — the abstract
 * keeps the section without a spurious page number.
 */
export function pageForSnippet(pages, snippet) {
  if (!Array.isArray(pages) || !pages.length || !snippet) return null;
  const needle = String(snippet).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40);
  if (needle.length < 6) return null;
  for (const p of pages) {
    const hay = String(p.text || '').toLowerCase().replace(/\s+/g, ' ');
    if (hay.includes(needle)) return String(p.page);
  }
  return null;
}

/**
 * Build clause_refs { "<Clause Label>": { page, section } } from the model's
 * per-clause output, resolving page numbers from the sidecar pages when the model
 * gave a locating snippet. The generator writes page→col, section→col.
 */
export function buildClauseRefs(modelClauses, pages) {
  const out = {};
  if (!modelClauses || typeof modelClauses !== 'object') return out;
  for (const [label, ref] of Object.entries(modelClauses)) {
    if (!ref || typeof ref !== 'object') continue;
    const entry = {};
    const section = ref.section || ref.sec || null;
    let page = ref.page != null ? String(ref.page) : null;
    if (!page && ref.snippet) page = pageForSnippet(pages, ref.snippet);
    if (page) entry.page = page;
    if (section) entry.section = String(section);
    if (Object.keys(entry).length) out[label] = entry;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extraction prompts (self-contained — no Copilot system prompt biasing the JSON)
// ---------------------------------------------------------------------------

function leasePrompt(leaseText) {
  return [
    'You are a commercial real estate lease abstractor. Read the LEASE below and',
    'return ONLY a JSON object (no prose, no code fence) with this exact shape.',
    'Use null for anything the lease does not state — NEVER guess a value.',
    'Dates as YYYY-MM-DD. Rents and dollar amounts as plain numbers (no $ or commas).',
    'Escalation as a decimal (0.02 = 2%). For each clause in "clause_refs", give the',
    'section label AND a short verbatim "snippet" (<=8 words) copied from that clause',
    'so its page can be located.',
    '',
    '{',
    '  "tenant_name": string|null,',
    '  "guarantor": string|null,',
    '  "suite": string|null,',
    '  "leased_sf": number|null,',
    '  "lease_type": "NNN"|"NN"|"MG"|"Gross"|null,',
    '  "year1_rent": number|null,',
    '  "escalation_pct": number|null,',
    '  "lease_commencement": "YYYY-MM-DD"|null,',
    '  "lease_expiration": "YYYY-MM-DD"|null,',
    '  "rent_schedule": [ { "label": string, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "annual_rent": number, "status": "Contracted"|"Option" } ],',
    '  "abstract": {',
    ABSTRACT_KEYS.map((k) => `    "${k}": string|null`).join(',\n'),
    '  },',
    '  "clause_refs": { "<Clause Label>": { "section": string, "snippet": string } }',
    '}',
    '',
    'LEASE:',
    '"""',
    String(leaseText || '').slice(0, 90_000),
    '"""',
  ].join('\n');
}

function realEstatePrompt(ddOmText) {
  return [
    'You are a CRE analyst. From the DUE-DILIGENCE / OFFERING-MEMORANDUM text below,',
    'return ONLY a JSON object (no prose, no code fence). Use null for anything not',
    'stated — never guess. Numbers plain (no $, no commas). This feeds a BOV Real',
    'Estate tab and underwriting; only extract what the documents actually say.',
    '',
    '{',
    '  "real_estate": {',
    '    "year_built": number|null, "year_renovated": number|null,',
    '    "construction_type": string|null, "building_sf": number|null,',
    '    "land_acres": number|null, "parcel_apn": string|null, "zoning": string|null,',
    '    "flood_zone": string|null, "ownership_interest": string|null,',
    '    "msa_submarket": string|null, "population_1_3_5": string|null,',
    '    "median_hh_income": string|null, "traffic_counts": string|null,',
    '    "market_rent_context": string|null, "default_source": string|null',
    '  },',
    '  "underwriting_hints": {',
    '    "in_place_noi": number|null, "purchase_price": number|null,',
    '    "going_in_cap": number|null, "asking_price": number|null, "asking_cap": number|null',
    '  }',
    '}',
    '',
    'DOCUMENTS:',
    '"""',
    String(ddOmText || '').slice(0, 90_000),
    '"""',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Sidecar gather
// ---------------------------------------------------------------------------

/**
 * Load all text sidecars for a property, grouped by doc type. Reads the newest
 * extraction per document (the sidecar is upserted per version). Returns
 * { leases:[], dd:[], om:[], minConfidence, citationRisk, sourceDocIds:[] }.
 */
export async function gatherPropertyText(crePropertyId, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const ver = deps.version || BOV_EXTRACT_VERSION; // extractor version (record), not sidecar version
  const sideVer = deps.sidecarVersion || 'unit1_v1';
  const r = await q('GET',
    `lcc_cre_property_document_text?cre_property_id=eq.${encodeURIComponent(crePropertyId)}` +
    `&extractor_version=eq.${encodeURIComponent(sideVer)}` +
    '&needs_ocr=is.false&raw_text=not.is.null' +
    '&select=document_id,document_type,raw_text,pages,ocr_confidence,ocr_tier,char_len' +
    '&order=document_id.desc',
    null, { countMode: 'none' });
  const rows = r.ok && Array.isArray(r.data) ? r.data : [];
  const groups = { leases: [], dd: [], om: [] };
  const sourceDocIds = [];
  let minConfidence = null;
  let citationRisk = false;
  for (const row of rows) {
    sourceDocIds.push(row.document_id);
    if (typeof row.ocr_confidence === 'number') {
      minConfidence = minConfidence == null ? row.ocr_confidence : Math.min(minConfidence, row.ocr_confidence);
      if (row.ocr_confidence < 70) citationRisk = true;
    }
    // A gpt-4o (tier 'cloud') transcription has no page anchors → citation risk on any lease.
    if (row.ocr_tier === 'cloud') citationRisk = true;
    const dt = String(row.document_type || '').toLowerCase();
    if (dt === 'lease') groups.leases.push(row);
    else if (dt === 'dd') groups.dd.push(row);
    else if (dt === 'om') groups.om.push(row);
  }
  return { ...groups, minConfidence, citationRisk, sourceDocIds, _versionForRecord: ver };
}

// ---------------------------------------------------------------------------
// Per-lease → tenant
// ---------------------------------------------------------------------------

/**
 * Run one lease sidecar through the AI → a TenantInput (+ abstract, rent_schedule,
 * clause_refs). Returns null when the lease can't be parsed (skipped, not fatal).
 */
export async function extractTenantFromLease(leaseRow, deps = {}) {
  const invoke = deps.invokeExtractionAI || invokeExtractionAI;
  let resp;
  try {
    resp = await invoke({ prompt: leasePrompt(leaseRow.raw_text) });
  } catch (err) {
    return { ok: false, reason: `ai_threw:${err?.message || err}`, document_id: leaseRow.document_id };
  }
  if (!resp || !resp.ok) return { ok: false, reason: 'ai_non_ok', status: resp?.status, document_id: leaseRow.document_id };
  const parsed = parseModelJson(resp.data?.response || resp.data?.content || '');
  if (!parsed) return { ok: false, reason: 'no_json', document_id: leaseRow.document_id };

  const clauseRefs = buildClauseRefs(parsed.clause_refs, leaseRow.pages);
  const abstract = {};
  if (parsed.abstract && typeof parsed.abstract === 'object') {
    for (const k of ABSTRACT_KEYS) {
      if (parsed.abstract[k] != null && parsed.abstract[k] !== '') abstract[k] = parsed.abstract[k];
    }
  }
  const tenant = {
    name: parsed.tenant_name || '',
    guarantor: parsed.guarantor || '',
    suite: parsed.suite || '',
    sf: numOrNull(parsed.leased_sf),
    lease_type: parsed.lease_type || 'NNN',
    year1_rent: numOrNull(parsed.year1_rent),
    escalation_pct: numOrNull(parsed.escalation_pct),
    lease_commencement: parsed.lease_commencement || '',
    lease_expiration: parsed.lease_expiration || '',
    rent_schedule: Array.isArray(parsed.rent_schedule) ? parsed.rent_schedule.map(cleanRentPeriod).filter(Boolean) : null,
    abstract: Object.keys(abstract).length ? abstract : null,
    clause_refs: Object.keys(clauseRefs).length ? clauseRefs : null,
  };
  return { ok: true, tenant, document_id: leaseRow.document_id, model: resp.data?.model || null };
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function cleanRentPeriod(p) {
  if (!p || typeof p !== 'object') return null;
  const annual = numOrNull(p.annual_rent);
  if (annual == null && !p.start_date && !p.label) return null;
  return {
    label: p.label || '',
    start_date: p.start_date || '',
    end_date: p.end_date || '',
    annual_rent: annual,
    status: p.status === 'Option' ? 'Option' : 'Contracted',
  };
}

// ---------------------------------------------------------------------------
// DD / OM → real_estate + underwriting_hints
// ---------------------------------------------------------------------------

export async function extractRealEstate(ddOmText, deps = {}) {
  if (!ddOmText || !ddOmText.trim()) return { real_estate: {}, underwriting_hints: {} };
  const invoke = deps.invokeExtractionAI || invokeExtractionAI;
  let resp;
  try {
    resp = await invoke({ prompt: realEstatePrompt(ddOmText) });
  } catch {
    return { real_estate: {}, underwriting_hints: {} };
  }
  if (!resp || !resp.ok) return { real_estate: {}, underwriting_hints: {} };
  const parsed = parseModelJson(resp.data?.response || resp.data?.content || '');
  if (!parsed) return { real_estate: {}, underwriting_hints: {} };

  const re = {};
  if (parsed.real_estate && typeof parsed.real_estate === 'object') {
    for (const [k, v] of Object.entries(parsed.real_estate)) {
      if (v != null && v !== '') re[k] = v;
    }
  }
  // Underwriting hints — route asking/valuation figures through the advisory guard
  // so an asking number can never be presented as a reported market field.
  const uh = {};
  const raw = parsed.underwriting_hints || {};
  for (const [k, v] of Object.entries(raw)) {
    if (v == null || v === '') continue;
    // asking_price/asking_cap are advisory-adjacent; keep them as *hints* only
    // (the generator uses cap as a manual driver), never as reported fields.
    const targetField = k === 'asking_price' ? 'asking_price' : k === 'asking_cap' ? 'asking_cap' : null;
    if (targetField) {
      const g = guardValuationWrite({ valueType: 'ask', targetField, listingConfirmed: false });
      // Not promotable pre-listing → keep only as an internal hint key, not reported.
      uh[`hint_${k}`] = v;
      if (g.ok) uh[k] = v;
    } else {
      uh[k] = v;
    }
  }
  return { real_estate: re, underwriting_hints: uh };
}

// ---------------------------------------------------------------------------
// Orchestrator + persist
// ---------------------------------------------------------------------------

/**
 * THE Unit-4 entry point. Build the BOV request record for a property from its
 * persisted text sidecars. Does NOT fetch/OCR — enqueue Step 2A first for any
 * lease/dd whose sidecar is missing.
 *
 * @returns { ok, record, meta } | { ok:false, reason }
 *   record = { asset_type, property, tenants[], real_estate, underwriting_hints }
 */
export async function extractBovRecord(crePropertyId, deps = {}) {
  if (crePropertyId == null) return { ok: false, reason: 'no_property_id' };
  const gathered = deps.gathered || (await gatherPropertyText(crePropertyId, deps));
  if (!gathered.leases.length && !gathered.dd.length && !gathered.om.length) {
    return { ok: false, reason: 'no_text_sidecars', hint: 'enqueue Step 2A (cre.doc.text) for this property first' };
  }

  // Property row (address/city/state/tenant_brand) for the property block.
  const propRow = deps.propertyRow || (await fetchProperty(crePropertyId, deps));

  const tenants = [];
  const perLease = [];
  for (const lease of gathered.leases) {
    const t = await extractTenantFromLease(lease, deps);
    perLease.push({ document_id: lease.document_id, ok: t.ok, reason: t.reason || null });
    if (t.ok && t.tenant) tenants.push(t.tenant);
  }

  // DD + OM text merged (dd first so lease/dd precedence is honored downstream).
  const ddText = gathered.dd.map((r) => r.raw_text).join('\n\n');
  const omText = gathered.om.map((r) => r.raw_text).join('\n\n');
  const { real_estate, underwriting_hints } = await extractRealEstate([ddText, omText].filter(Boolean).join('\n\n'), deps);

  const assetType = deriveAssetType(tenants, propRow);
  const record = {
    asset_type: assetType,
    property: buildPropertyBlock(propRow, tenants, real_estate),
    tenants,
    real_estate,
    underwriting_hints,
  };

  const meta = {
    tenant_count: tenants.length,
    source_document_ids: gathered.sourceDocIds,
    citation_risk: gathered.citationRisk,
    ocr_confidence: gathered.minConfidence,
    per_lease: perLease,
    extractor_version: gathered._versionForRecord || BOV_EXTRACT_VERSION,
  };
  return { ok: true, record, meta };
}

async function fetchProperty(crePropertyId, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const r = await q('GET',
    `lcc_cre_properties?id=eq.${encodeURIComponent(crePropertyId)}` +
    '&select=id,address,city,state,tenant_brand,asset_class&limit=1',
    null, { countMode: 'none' });
  if (r.ok && Array.isArray(r.data) && r.data.length) return r.data[0];
  return null;
}

function deriveAssetType(tenants, propRow) {
  if (tenants.length > 1) return 'MOB';
  const ac = String(propRow?.asset_class || '').toLowerCase();
  if (ac.includes('mob') || ac.includes('medical') || ac.includes('multi')) return 'MOB';
  return 'NNN';
}

function buildPropertyBlock(propRow, tenants, realEstate) {
  const address = propRow?.address || '';
  const cityState = [propRow?.city, propRow?.state].filter(Boolean).join(', ');
  const buildingSf = numOrNull(realEstate?.building_sf) ||
    (tenants.length === 1 ? numOrNull(tenants[0]?.sf) : null);
  const name = propRow?.tenant_brand || (tenants[0]?.name) || '';
  return { address, city_state: cityState, building_sf: buildingSf, close_date: '', name };
}

/**
 * Persist the Unit-4 record to the reviewable store (lcc_cre_bov_extraction),
 * upserting on (cre_property_id, extractor_version). status='extracted' — a human
 * reviews it in the live-ingest UI before the generator will prefer it.
 */
export async function persistBovRecord(crePropertyId, record, meta, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const row = {
    cre_property_id: Number(crePropertyId),
    record,
    status: 'extracted',
    source_document_ids: meta.source_document_ids || [],
    citation_risk: !!meta.citation_risk,
    ocr_confidence: meta.ocr_confidence ?? null,
    tenant_count: meta.tenant_count ?? (record.tenants?.length || 0),
    extractor_version: meta.extractor_version || BOV_EXTRACT_VERSION,
    extracted_at: new Date().toISOString(),
  };
  const r = await q('POST',
    'lcc_cre_bov_extraction?on_conflict=cre_property_id,extractor_version',
    row,
    { Prefer: 'return=representation,resolution=merge-duplicates' });
  if (r.ok) {
    const ins = Array.isArray(r.data) ? r.data[0] : r.data;
    return { ok: true, id: ins?.id ?? null };
  }
  return { ok: false, status: r.status, detail: r.data };
}

/**
 * Extract + persist in one call (the worker/handler entry). Never throws.
 */
export async function runBovExtract(crePropertyId, deps = {}) {
  const ex = await extractBovRecord(crePropertyId, deps).catch((e) => ({ ok: false, reason: e?.message || String(e) }));
  if (!ex.ok) return ex;
  const saved = await persistBovRecord(crePropertyId, ex.record, ex.meta, deps);
  return { ok: saved.ok, record_id: saved.id ?? null, meta: ex.meta, reason: saved.ok ? null : (saved.detail || 'persist_failed'), record: ex.record };
}

export const __private = { fetchProperty, deriveAssetType, buildPropertyBlock, numOrNull, cleanRentPeriod };
