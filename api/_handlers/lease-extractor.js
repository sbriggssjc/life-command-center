// ============================================================================
// Stage B Unit 1 — Lease/guarantee extractor (factual + attach-resolver)
// Life Command Center
//
// The lease extractor does DOUBLE DUTY from one file read (Scott, 2026-06-11):
//   1. ATTACH-RESOLVER — the in-file street address resolves the property that
//      path-anchor alone cannot (the DaVita-22-clinics-in-one-metro ambiguity).
//   2. ENRICHER — factual lease fields (tenant, guarantor, rent, SF, structure,
//      term, expiration, escalations) + the TI-amortization schedule + the
//      expense schedule (the gov-engine #64 NOI input).
//
// All FACTUAL — zero advisory risk (price/cap is Unit 2 / BOV). Every record
// write routes through lcc_merge_field (provenance, source='folder_feed_lease');
// the guarantor is also minted as a first-class entity + guaranteed_by edge so
// the cross-deal search resolves ("deals with Total Renal Care as tenant or
// guarantor").
//
// Reuse, not rebuild: the AI call (invokeExtractionAI), the SharePoint byte
// read-back, and the domain matcher are all INJECTED (deps) so the pure prompt /
// normalize / write-plan core is unit-testable and the writer never wires itself
// live until the gated activation.
// ============================================================================

import { createRequire } from 'module';
import { isReportedField } from '../_shared/extraction-field-policy.js';
import { invokeExtractionAI } from '../_shared/ai.js';
import { fetchSharepointBytes } from '../_shared/storage-adapter.js';
import { opsQuery, pgFilterVal, fetchWithTimeout } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';
import { matchAgainstDomain } from './intake-matcher.js';
import { attachEnrichDocument } from './intake-promoter.js';
import { ensureEntityLink } from '../_shared/entity-link.js';
import { authenticate } from '../_shared/auth.js';

const nodeRequire = createRequire(import.meta.url);

// Logical field → domain column. dia.leases already differs from gov.leases, so
// the writer maps once here (mirrors the field_source_priority registration in
// migration 20260719121000).
export const LEASE_FIELD_MAP = {
  government: {
    table: 'leases',
    fields: {
      tenant: 'tenant_agency', guarantor: 'guarantor', annual_rent: 'annual_rent',
      rent_psf: 'rent_psf', lease_structure: 'lease_structure', expense_structure: 'expense_structure',
      firm_term_years: 'firm_term_years', total_term_years: 'total_term_years',
      commencement_date: 'commencement_date', expiration_date: 'expiration_date',
      renewal_options: 'renewal_options',
    },
  },
  dialysis: {
    table: 'leases',
    fields: {
      tenant: 'tenant', guarantor: 'guarantor', annual_rent: 'annual_rent',
      rent_psf: 'rent_per_sf', leased_sf: 'leased_area',
      // dia has no separate lease_structure column — NNN/NN/gross IS expense_structure.
      lease_structure: 'expense_structure', expense_structure: 'expense_structure',
      commencement_date: 'lease_start', expiration_date: 'lease_expiration',
      renewal_options: 'renewal_options',
    },
  },
};

// ── pure coercion helpers ───────────────────────────────────────────────────
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function iso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function str(v) {
  const s = (v === null || v === undefined) ? '' : String(v).trim();
  return s || null;
}

/**
 * The lease-specific AI extraction prompt. Asks for a STRICT JSON object — the
 * property identity (so the attach resolves), the factual lease fields, the TI
 * schedule, and the expense schedule. Price/cap is deliberately NOT requested —
 * leases carry rent, not asking price.
 */
export function buildLeaseExtractionPrompt() {
  return [
    'You are extracting structured data from a commercial real-estate LEASE or',
    'lease abstract / guaranty. Return ONLY a JSON object (no prose) of this shape:',
    '{',
    '  "property_identity": { "address": str|null, "city": str|null, "state": 2-letter|null, "tenant": str|null },',
    '  "factual": {',
    '    "tenant": str|null, "guarantor": str|null, "annual_rent": number|null,',
    '    "rent_psf": number|null, "leased_sf": number|null,',
    '    "lease_structure": "NNN"|"NN"|"gross"|"modified_gross"|"full_service"|null,',
    '    "expense_structure": str|null, "firm_term_years": number|null,',
    '    "total_term_years": number|null, "commencement_date": "YYYY-MM-DD"|null,',
    '    "expiration_date": "YYYY-MM-DD"|null, "renewal_options": str|null',
    '  },',
    '  "ti_schedule": [ { "schedule_year": int|null, "period_start": "YYYY-MM-DD"|null,',
    '    "period_end": "YYYY-MM-DD"|null, "ti_excess_amount": number|null,',
    '    "cumulative_ti": number|null, "burn_off_date": "YYYY-MM-DD"|null } ],',
    '  "expense_schedule": [ { "year": int|null, "category": str|null, "amount": number|null } ]',
    '}',
    'The "guarantor" is the credit parent (e.g. "Total Renal Care, Inc." guarantees a DaVita lease).',
    'Use null for anything not stated. Do NOT invent a sale price or cap rate.',
  ].join('\n');
}

/**
 * Normalize a raw AI extraction object into the lease contract. Pure; tolerant
 * of missing branches. Coerces numbers/dates, drops empties.
 */
export function normalizeLeaseExtraction(raw) {
  const r = raw || {};
  const pi = r.property_identity || {};
  const f = r.factual || {};
  const tiIn = Array.isArray(r.ti_schedule) ? r.ti_schedule : [];
  const expIn = Array.isArray(r.expense_schedule) ? r.expense_schedule : [];

  const property_identity = {
    address: str(pi.address),
    city: str(pi.city),
    state: pi.state ? String(pi.state).trim().toUpperCase().slice(0, 2) : null,
    tenant: str(pi.tenant) || str(f.tenant),
  };

  const factual = {};
  const factualSpec = {
    tenant: str, guarantor: str, annual_rent: num, rent_psf: num, leased_sf: num,
    lease_structure: str, expense_structure: str, firm_term_years: num,
    total_term_years: num, commencement_date: iso, expiration_date: iso,
    renewal_options: str,
  };
  for (const [k, coerce] of Object.entries(factualSpec)) {
    const v = coerce(f[k]);
    if (v !== null) factual[k] = v;
  }

  const ti_schedule = tiIn.map(row => ({
    schedule_year: row?.schedule_year != null ? parseInt(row.schedule_year, 10) || null : null,
    period_start: iso(row?.period_start),
    period_end: iso(row?.period_end),
    ti_excess_amount: num(row?.ti_excess_amount),
    cumulative_ti: num(row?.cumulative_ti),
    burn_off_date: iso(row?.burn_off_date),
  })).filter(row => row.ti_excess_amount !== null || row.cumulative_ti !== null || row.burn_off_date !== null);

  const expense_schedule = expIn.map(row => ({
    year: row?.year != null ? parseInt(row.year, 10) || null : null,
    category: str(row?.category),
    amount: num(row?.amount),
  })).filter(row => row.amount !== null);

  return { property_identity, factual, ti_schedule, expense_schedule };
}

/**
 * Map the normalized factual fields to the DOMAIN's lease columns + assemble the
 * TI rows. Defensive: a lease factual field must NEVER be a reported market
 * field (it never is — leases carry rent, not asking price — but the guard makes
 * a future map edit that introduced one fail loudly rather than leak).
 *
 * @returns {{table:string, leaseFields:object, guarantor:?string, tiRows:array, warnings:array}}
 */
export function planLeaseWrites(domain, normalized) {
  const map = LEASE_FIELD_MAP[domain];
  if (!map) throw new Error(`planLeaseWrites: unknown domain ${domain}`);
  const leaseFields = {};
  const warnings = [];
  for (const [logical, value] of Object.entries(normalized.factual || {})) {
    const col = map.fields[logical];
    if (!col) continue;                         // not represented in this domain
    if (isReportedField(col)) {                 // guard: never a reported field
      warnings.push(`refused_reported_target:${logical}->${col}`);
      continue;
    }
    leaseFields[col] = value;                    // last non-null per column wins
  }
  const tiRows = (normalized.ti_schedule || []).map(row => ({
    ...row,
    source: 'folder_feed_lease',
  }));
  return {
    table: map.table,
    leaseFields,
    guarantor: normalized.factual?.guarantor || null,
    tiRows,
    warnings,
  };
}

// Expense-category → property_financials column. Anything unmatched still rolls
// into operating_expenses (and the full schedule is preserved in line_items).
const EXPENSE_CATEGORY_RES = [
  { col: 'taxes', re: /\b(?:re[\s_-]*tax|real\s*estate\s*tax|property\s*tax|tax(?:es)?)\b/i },
  { col: 'insurance', re: /\binsur/i },
  { col: 'cam', re: /\b(?:cam|common\s*area)\b/i },
];

/**
 * Aggregate the lease's expense_schedule ([{year, category, amount}]) into one
 * property_financials row per fiscal_year. BOUNDARY (cap_rate_history doctrine):
 * these rows are lease-abstract pass-through estimates, NOT audited financials —
 * the writer stamps is_actual=false, noi=null, source='folder_feed_lease', so the
 * gov cap-rate provenance ladder (resolveCapRateProvenance Tier 2, which requires
 * is_actual=true AND noi not null) can NEVER consume them. Pure + unit-testable.
 *
 * @returns {Array<{fiscal_year:number, taxes:?number, insurance:?number,
 *   cam:?number, operating_expenses:?number, line_items:object}>}
 */
export function planExpenseFinancials(normalized) {
  const rows = Array.isArray(normalized?.expense_schedule) ? normalized.expense_schedule : [];
  const byYear = new Map();
  for (const r of rows) {
    const y = r?.year != null ? parseInt(r.year, 10) : null;
    const amt = num(r?.amount);
    if (!Number.isFinite(y) || y < 1990 || y > new Date().getFullYear() + 2) continue;
    if (amt == null) continue;
    if (!byYear.has(y)) byYear.set(y, { fiscal_year: y, taxes: null, insurance: null, cam: null, operating_expenses: 0, line_items: [] });
    const bucket = byYear.get(y);
    const cat = (r.category || '').toString();
    const hit = EXPENSE_CATEGORY_RES.find(({ re }) => re.test(cat));
    if (hit) bucket[hit.col] = (bucket[hit.col] || 0) + amt;
    bucket.operating_expenses += amt;
    bucket.line_items.push({ category: r.category || null, amount: amt });
  }
  return [...byYear.values()].map(b => ({ ...b, line_items: { source: 'folder_feed_lease', entries: b.line_items } }));
}

/**
 * Resolve the property the lease belongs to FROM THE FILE — the in-file street
 * address through the injected domain matcher. This is the attach-resolver that
 * path-anchor alone can't do. Returns the same status vocabulary as
 * matchByPathAnchor so the caller's routing (attach / disambiguation / terminal)
 * is shared.
 *
 * @param {object} normalized
 * @param {object} deps  { matchAgainstDomain, domainsFor }
 */
export async function resolveAttachFromExtraction(normalized, deps) {
  const pi = normalized.property_identity || {};
  if (!pi.address || !pi.state) {
    return { status: 'unmatched', reason: 'no_in_file_address', property_id: null, domain: null, candidates: [] };
  }
  const domains = (deps.domainsFor ? deps.domainsFor(pi) : ['government', 'dialysis']);
  const cands = [];
  for (const domain of domains) {
    const m = await deps.matchAgainstDomain(domain, pi.address, pi.state, pi.city, pi.tenant);
    if (m && m.property_id != null) cands.push({ domain, ...m });
  }
  if (cands.length === 1) {
    const c = cands[0];
    return { status: 'matched', reason: `in_file_address_${c.reason || 'match'}`, confidence: Math.max(0.85, c.confidence || 0.85), property_id: c.property_id, domain: c.domain, candidates: cands };
  }
  if (cands.length > 1) {
    return { status: 'review_required', reason: 'in_file_address_ambiguous', property_id: null, domain: null, candidates: cands };
  }
  return { status: 'unmatched', reason: 'no_domain_property', property_id: null, domain: null, candidates: [] };
}

/**
 * Apply the lease enrichment to a resolved property. Deps-injected so it is
 * testable and never wires itself live.
 *
 * The lease row is resolved/created FIRST — the lease doc IS the lease, so a
 * property with no existing lease row gets one created from the extracted facts
 * (respecting one-active-lease-per-property: dedupe against any existing active
 * lease; create only when genuinely absent). Only once the lease is
 * created/linked do the TI rows, the guarantor entity, and the guaranteed_by
 * edge land. If the lease can't be created/linked we return early WITHOUT
 * minting the guarantor — never an orphan guarantor entity (the lease-less-30430
 * gap). Effect order is provenance-first per field on the existing-lease patch
 * path; on the create path the fields land at insert and provenance is recorded
 * for observability.
 *
 * @param {object} a  { domain, propertyId, leaseId?, normalized }
 * @param {object} deps {
 *   ensureLeaseRow({domain, propertyId, leaseId, fields}), // resolve-or-create → {ok, lease_id, created, reason?}
 *   mergeField({domain,table,recordPk,field,value}),  // → lcc_merge_field
 *   patchLease({domain, leaseId, propertyId, fields}), // domain leases UPDATE
 *   insertTiRows({domain, propertyId, leaseId, rows}),
 *   insertPropertyFinancials({domain, propertyId, leaseId, rows}), // expense_schedule → property_financials (boundary: is_actual=false)
 *   ensureGuarantorEntity({domain, propertyId, leaseId, name}), // entity + guaranteed_by edge
 *   attachDoc({domain, propertyId, fileName, sourceUrl}),
 * }
 * @returns {Promise<{ok, fields_filled, ti_rows, guarantor_entity_id, document_id, lease_id, lease_created, warnings}>}
 */
export async function applyLeaseEnrichment({ domain, propertyId, leaseId = null, normalized, doc = null }, deps) {
  const plan = planLeaseWrites(domain, normalized);
  const out = {
    ok: true, fields_filled: 0, ti_rows: 0, financial_rows: 0, guarantor_entity_id: null, guaranteed_by_edge: null,
    document_id: null, lease_id: leaseId, lease_created: false, warnings: plan.warnings,
  };

  // 1) Resolve OR create the lease row first. Never proceed to guarantor/TI/edge
  //    if the lease can't be created/linked — that's what orphaned the guarantor
  //    on the lease-less property. Gated on the dep so callers that pass a known
  //    leaseId (or the legacy tests) keep the prior patch-only behavior.
  let resolvedLeaseId = leaseId;
  if (deps.ensureLeaseRow) {
    const lr = await deps.ensureLeaseRow({ domain, propertyId, leaseId, fields: plan.leaseFields })
      .catch((e) => ({ ok: false, reason: e?.message || 'threw' }));
    if (!lr?.ok) {
      out.ok = false;
      out.warnings = [...out.warnings, `lease_unresolved:${lr?.reason || 'unknown'}`];
      return out;                               // no guarantor mint → no orphan
    }
    resolvedLeaseId = lr.lease_id;
    out.lease_id = resolvedLeaseId;
    out.lease_created = !!lr.created;
  }

  // 2) Factual lease fields.
  if (out.lease_created) {
    // The create already wrote the factual fields; record provenance per field
    // for observability (a brand-new row has nothing to conflict with).
    const cols = Object.keys(plan.leaseFields);
    out.fields_filled = cols.length;
    if (deps.mergeField) {
      for (const col of cols) {
        await deps.mergeField({ domain, table: plan.table, recordPk: resolvedLeaseId, field: col, value: plan.leaseFields[col] }).catch(() => {});
      }
    }
  } else {
    // Existing lease — provenance-first per field, then the UPDATE (fill-blanks).
    const fieldsToWrite = {};
    for (const [col, value] of Object.entries(plan.leaseFields)) {
      const decision = deps.mergeField
        ? await deps.mergeField({ domain, table: plan.table, recordPk: resolvedLeaseId ?? propertyId, field: col, value }).catch(() => ({ decision: 'write' }))
        : { decision: 'write' };
      if (!decision || decision.decision === 'write' || decision.decision === 'record_only' || decision.decision === undefined) {
        fieldsToWrite[col] = value;
      }
    }
    if (Object.keys(fieldsToWrite).length && deps.patchLease) {
      const r = await deps.patchLease({ domain, leaseId: resolvedLeaseId, propertyId, fields: fieldsToWrite }).catch(() => ({ ok: false }));
      if (r?.ok) out.fields_filled = Object.keys(fieldsToWrite).length;
    }
  }

  // 3) TI amortization rows — now lease-linked.
  if (plan.tiRows.length && deps.insertTiRows) {
    const r = await deps.insertTiRows({ domain, propertyId, leaseId: resolvedLeaseId, rows: plan.tiRows }).catch(() => ({ ok: false, count: 0 }));
    out.ti_rows = r?.count || 0;
  }

  // 3b) Expense schedule → property_financials (#64 NOI input). BOUNDARY: the dep
  //     stamps is_actual=false, noi=null, source='folder_feed_lease' so these rows
  //     are structurally excluded from the reported cap-rate cohort. Never blocks.
  if (deps.insertPropertyFinancials) {
    const finRows = planExpenseFinancials(normalized);
    if (finRows.length) {
      const r = await deps.insertPropertyFinancials({ domain, propertyId, leaseId: resolvedLeaseId, rows: finRows })
        .catch(() => ({ ok: false, count: 0 }));
      out.financial_rows = r?.count || 0;
    }
  }

  // 4) Guarantor entity + guaranteed_by edge — ONLY now that the lease exists.
  if (plan.guarantor && deps.ensureGuarantorEntity) {
    const g = await deps.ensureGuarantorEntity({ domain, propertyId, leaseId: resolvedLeaseId, name: plan.guarantor })
      .catch((e) => ({ entity_id: null, edge_ok: false, warning: `guarantor_threw:${e?.message || 'err'}` }));
    out.guarantor_entity_id = g?.entity_id || null;
    // The graph edge is the deliverable (brain-hub entity completeness), not the
    // bare guarantor entity — surface its outcome instead of silently dropping it.
    out.guaranteed_by_edge = g?.edge_ok ?? null;
    if (g?.warning) out.warnings = [...out.warnings, g.warning];
  }

  // 5) Attach the lease doc to the property.
  if (doc && deps.attachDoc) {
    const r = await deps.attachDoc({ domain, propertyId, fileName: doc.fileName, sourceUrl: doc.sourceUrl }).catch(() => null);
    out.document_id = r?.document_id || null;
  }

  return out;
}

// ============================================================================
// LIVE ORCHESTRATION (gated dry-run / real) + endpoint
// ============================================================================

function parseLeaseJson(text) {
  if (!text) return null;
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const m = String(body).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Decode lease doc bytes to text for the prompt. PDF → pdf-parse; text/* →
// decode; other binaries (docx/xlsx) → best-effort utf-8 (the AI tolerates
// partial). Returns '' when nothing usable.
async function leaseTextFromBytes(buffer, mediaType) {
  const isPdf = /pdf/i.test(mediaType || '') || (buffer && buffer[0] === 0x25 && buffer[1] === 0x50);
  if (isPdf) {
    try {
      const pdfParse = nodeRequire('pdf-parse');
      const parsed = await pdfParse(buffer);
      return (parsed?.text || '').trim().slice(0, 120000);
    } catch (err) { console.warn('[lease-extractor] pdf-parse failed:', err?.message); return ''; }
  }
  try { return Buffer.from(buffer).toString('utf8').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ').trim().slice(0, 120000); }
  catch { return ''; }
}

/**
 * One file read → normalized lease extraction. `raw` may be supplied to bypass
 * the AI (tests / a pre-extracted preview); otherwise bytes are fetched from the
 * SharePoint ref and run through the lease prompt.
 */
export async function runLeaseExtraction({ storageRef, mediaType = 'application/pdf', raw = null, fetchImpl } = {}) {
  if (raw) return { normalized: normalizeLeaseExtraction(raw), source: 'raw' };
  if (!storageRef) throw new Error('runLeaseExtraction: storage_ref required (or raw)');
  const sp = await fetchSharepointBytes({ storageRef, fetchImpl: fetchImpl || ((u, o) => fetchWithTimeout(u, o, 30000)) });
  if (!sp.ok) throw new Error(`SharePoint fetch failed: ${sp.status || ''} ${sp.detail || ''}`);
  const text = await leaseTextFromBytes(sp.buffer, sp.contentType || mediaType);
  if (!text) throw new Error('no_extractable_text');
  const prompt = `${buildLeaseExtractionPrompt()}\n\n--- LEASE DOCUMENT TEXT ---\n${text}`;
  const result = await invokeExtractionAI({ prompt });
  if (!result.ok) throw new Error(`AI provider error ${result.status}`);
  const aiText = result.data?.response || result.data?.content || result.data?.choices?.[0]?.message?.content || (typeof result.data === 'string' ? result.data : '') || '';
  const parsed = parseLeaseJson(aiText);
  if (!parsed) throw new Error('no_json_in_ai_response');
  return { normalized: normalizeLeaseExtraction(parsed), source: 'ai' };
}

const DOMAIN_DB = (d) => (d === 'dialysis' ? 'dia_db' : 'gov_db');
const DOMAIN_SCHEMA = (d) => (d === 'dialysis' ? 'dia' : 'gov');
const DOMAIN_SHORT = (d) => (d === 'dialysis' ? 'dia' : 'gov');

// The "currently active lease" PostgREST filter per domain. dia carries
// is_active + status; gov has neither — active == not superseded. Both dedupe to
// at most one row so the create path never duplicates an active lease.
function activeLeaseQuery(domain, propertyId) {
  if (domain === 'dialysis') {
    return `leases?property_id=eq.${propertyId}&is_active=eq.true&superseded_at=is.null` +
           `&select=lease_id&order=lease_start.desc.nullslast,lease_id.desc&limit=1`;
  }
  return `leases?property_id=eq.${propertyId}&superseded_at=is.null` +
         `&select=lease_id&order=commencement_date.desc.nullslast&limit=1`;
}

/** Real writer deps (lease resolve-or-create; provenance-first; guarantor entity + guaranteed_by edge). */
export function buildRealLeaseDeps({ workspaceId, actorId }) {
  return {
    // Read-only: the active lease_id for a property, or null. Used by the gated
    // dry-run to report whether the real write would CREATE a lease.
    findActiveLeaseId: async ({ domain, propertyId }) => {
      const g = await domainQuery(domain, 'GET', activeLeaseQuery(domain, propertyId)).catch(() => ({ ok: false }));
      return (g.ok && g.data?.[0]?.lease_id) || null;
    },
    // Resolve the active lease, or CREATE one from the extracted facts when the
    // property genuinely has none. The lease doc IS the lease. Dedupes against
    // any existing active lease (one-active-lease-per-property doctrine) so it
    // never writes a duplicate. Returns {ok, lease_id, created, reason?}.
    ensureLeaseRow: async ({ domain, propertyId, leaseId, fields }) => {
      if (leaseId) return { ok: true, lease_id: leaseId, created: false };
      const g = await domainQuery(domain, 'GET', activeLeaseQuery(domain, propertyId)).catch(() => ({ ok: false }));
      const existing = g.ok && g.data?.[0]?.lease_id;
      if (existing) return { ok: true, lease_id: existing, created: false };
      // No active lease — create it. Require at least one factual field so we
      // never mint an empty placeholder lease (and therefore never a guarantor
      // with nothing to attach to).
      if (!fields || Object.keys(fields).length === 0) return { ok: false, reason: 'no_factual_fields' };
      const row = { property_id: Number(propertyId), ...fields, data_source: 'folder_feed_lease' };
      if (domain === 'dialysis') { row.status = 'active'; row.is_active = true; }  // gov: active == not superseded
      const ins = await domainQuery(domain, 'POST', 'leases', row, { Prefer: 'return=representation' }).catch(() => ({ ok: false }));
      if (!ins.ok) return { ok: false, reason: `create_failed:${ins.status || ''}` };
      const created = Array.isArray(ins.data) ? ins.data[0] : ins.data;
      const newId = created?.lease_id ?? null;
      if (newId == null) return { ok: false, reason: 'create_no_id' };
      return { ok: true, lease_id: newId, created: true };
    },
    matchAgainstDomain,
    domainsFor: (pi) => {
      const t = `${pi.tenant || ''}`;
      return /dialysis|davita|fresenius|renal|nephrology|kidney/i.test(t) ? ['dialysis', 'government'] : ['government', 'dialysis'];
    },
    mergeField: async ({ domain, table, recordPk, field, value }) => {
      const r = await opsQuery('POST', 'rpc/lcc_merge_field', {
        p_workspace_id: workspaceId || null,
        p_target_database: DOMAIN_DB(domain),
        p_target_table: `${DOMAIN_SCHEMA(domain)}.${table}`,
        p_record_pk: String(recordPk),
        p_field_name: field,
        // p_value is jsonb — pass the raw value (the registry compares jsonb).
        p_value: value == null ? null : value,
        p_source: 'folder_feed_lease',
        // p_source_run_id has NO default — omitting it makes PostgREST fail to
        // resolve the function, which silently nulls the decision. Pass it.
        p_source_run_id: null,
        p_confidence: 0.85,
        p_recorded_by: actorId || null,
      }).catch(() => null);
      const d = Array.isArray(r?.data) ? r.data[0] : r?.data;
      return { decision: d?.decision || 'write' };
    },
    patchLease: async ({ domain, leaseId, propertyId, fields }) => {
      // The lease_id is normally resolved by ensureLeaseRow; fall back to the
      // active-lease lookup for direct callers.
      let lid = leaseId;
      if (!lid) {
        const g = await domainQuery(domain, 'GET', activeLeaseQuery(domain, propertyId));
        lid = g.ok && g.data?.[0]?.lease_id;
      }
      if (!lid) return { ok: false, reason: 'no_lease_row' };
      const r = await domainQuery(domain, 'PATCH', `leases?lease_id=eq.${pgFilterVal(lid)}`, fields);
      return { ok: !!r.ok, lease_id: lid };
    },
    insertTiRows: async ({ domain, propertyId, leaseId, rows }) => {
      const payload = rows.map(row => ({ ...row, property_id: Number(propertyId), lease_id: leaseId || null }));
      const r = await domainQuery(domain, 'POST', 'lease_ti_amortization?on_conflict=lease_id,property_id,schedule_year', payload,
        { Prefer: 'resolution=merge-duplicates,return=minimal' });
      return { ok: !!r.ok, count: r.ok ? payload.length : 0 };
    },
    // Expense schedule → property_financials. BOUNDARY (cap_rate_history doctrine):
    // every row is stamped is_actual=false + noi=null + source='folder_feed_lease'
    // so the gov cap-rate provenance ladder (resolveCapRateProvenance Tier 2:
    // is_actual=true AND noi not null) structurally cannot consume it. Dedups on
    // (property_id, fiscal_year, source). Records folder_feed_lease provenance per
    // expense column (field_source_priority registered by the sibling migration).
    insertPropertyFinancials: async ({ domain, propertyId, rows }) => {
      if (domain !== 'government' && domain !== 'dialysis') return { ok: false, count: 0 };
      const pkCol = domain === 'government' ? 'financial_id' : 'id';
      let count = 0, skipped = 0;
      for (const r of rows) {
        const payload = {
          property_id: Number(propertyId),
          fiscal_year: r.fiscal_year,
          source: 'folder_feed_lease',
          is_actual: false,            // BOUNDARY: never an audited actual
          noi: null,                   // BOUNDARY: a lease expense schedule carries no NOI
          taxes: r.taxes ?? null,
          insurance: r.insurance ?? null,
          cam: r.cam ?? null,
          operating_expenses: r.operating_expenses ?? null,
          line_items: r.line_items || null,
        };
        // Find OUR existing folder_feed_lease row for this (property, year). gov's
        // unique key is (property_id, fiscal_year) — source-agnostic — so a year
        // occupied by a curated/costar/legacy row must NOT be clobbered; dia's key
        // is (property_id, fiscal_year, source), so our row coexists. Either way we
        // only ever touch a row whose source IS folder_feed_lease.
        const look = await domainQuery(domain, 'GET',
          `property_financials?property_id=eq.${Number(propertyId)}&fiscal_year=eq.${r.fiscal_year}` +
          `&select=${pkCol},source&order=${pkCol}.asc`).catch(() => ({ ok: false }));
        const existingRows = (look.ok && Array.isArray(look.data)) ? look.data : [];
        const ours = existingRows.find(x => x.source === 'folder_feed_lease');
        let recId = null;
        if (ours) {
          const patch = { ...payload }; delete patch.is_actual;  // immutable post-insert
          const r2 = await domainQuery(domain, 'PATCH', `property_financials?${pkCol}=eq.${pgFilterVal(ours[pkCol])}`, patch).catch(() => ({ ok: false }));
          if (!r2.ok) continue;
          recId = ours[pkCol];
        } else if (domain === 'government' && existingRows.length > 0) {
          // gov year already held by another source — boundary: do not clobber.
          skipped++; continue;
        } else {
          const ins = await domainQuery(domain, 'POST', 'property_financials', payload, { Prefer: 'return=representation' }).catch(() => ({ ok: false }));
          if (!ins.ok) { skipped++; continue; }
          const row = Array.isArray(ins.data) ? ins.data[0] : ins.data;
          recId = row?.[pkCol] ?? null;
        }
        count++;
        if (recId) {
          for (const col of ['taxes', 'insurance', 'cam', 'operating_expenses']) {
            if (payload[col] == null) continue;
            await opsQuery('POST', 'rpc/lcc_merge_field', {
              p_workspace_id: workspaceId || null,
              p_target_database: DOMAIN_DB(domain),
              p_target_table: `${DOMAIN_SCHEMA(domain)}.property_financials`,
              p_record_pk: String(recId),
              p_field_name: col,
              p_value: payload[col],
              p_source: 'folder_feed_lease',
              p_source_run_id: null,
              p_confidence: 0.7,
              p_recorded_by: actorId || null,
            }).catch(() => {});
          }
        }
      }
      return { ok: count > 0, count, skipped };
    },
    ensureGuarantorEntity: async ({ domain, propertyId, name }) => {
      // Mint the guarantor org entity (idempotent on the normalized name), then a
      // guaranteed_by edge guarantor → the property's asset entity (cross-deal
      // search; brain-hub entity completeness). Both endpoints are resolved/created
      // BEFORE the edge write; a failure to write the edge is SURFACED as a warning
      // (never swallowed), so the gate sees an incomplete graph rather than a silent
      // no-op. (Stage B Unit 1 re-gate, 2026-06-13.)
      const guar = await ensureEntityLink({
        workspaceId, userId: actorId, sourceSystem: 'folder_feed_lease', sourceType: 'guarantor',
        externalId: name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), domain: 'lcc',
        seedFields: { display_name: name, entity_type: 'organization' }, metadata: { role: 'guarantor' },
      }).catch(() => null);
      const guarId = guar?.entity?.id || guar?.entityId || null;
      if (!guarId) return { entity_id: null, asset_entity_id: null, edge_ok: false, warning: 'guarantor_entity_unresolved' };

      // Resolve-or-create the asset entity FIRST so the edge always has a target.
      const asset = await ensureEntityLink({
        workspaceId, userId: actorId, sourceSystem: DOMAIN_SHORT(domain), sourceType: 'asset',
        externalId: String(propertyId), domain: DOMAIN_SHORT(domain),
      }).catch(() => null);
      const assetId = asset?.entity?.id || asset?.entityId || null;
      if (!assetId) {
        console.warn(`[lease-extractor] guaranteed_by edge skipped — asset entity unresolved for ${DOMAIN_SHORT(domain)} property ${propertyId}`);
        return { entity_id: guarId, asset_entity_id: null, edge_ok: false, warning: 'asset_entity_unresolved' };
      }

      // Idempotent: entity_relationships has no unique index, so pre-check the
      // edge before inserting (mirrors operations.js / entity-link.js).
      const dupe = await opsQuery('GET', `entity_relationships?from_entity_id=eq.${pgFilterVal(guarId)}&to_entity_id=eq.${pgFilterVal(assetId)}&relationship_type=eq.guaranteed_by&select=id&limit=1`).catch(() => null);
      if (dupe?.ok && dupe.data?.length) return { entity_id: guarId, asset_entity_id: assetId, edge_ok: true };

      // workspace_id is NOT NULL on entity_relationships (FK → workspaces); every
      // other writer passes it. Omitting it was the silent INSERT failure that left
      // the guarantor with zero relationships.
      const edge = await opsQuery('POST', 'entity_relationships', {
        workspace_id: workspaceId,
        from_entity_id: guarId,
        to_entity_id: assetId,
        relationship_type: 'guaranteed_by',
        metadata: { role: 'guarantor', source: 'folder_feed_lease' },
      }, { Prefer: 'return=minimal' }).catch((e) => ({ ok: false, status: e?.message || 'threw' }));
      if (!edge?.ok) {
        console.warn(`[lease-extractor] guaranteed_by edge write failed (${edge?.status ?? '?'}) guarantor=${guarId} asset=${assetId}`);
        return { entity_id: guarId, asset_entity_id: assetId, edge_ok: false, warning: `guaranteed_by_edge_write_failed:${edge?.status ?? '?'}` };
      }
      return { entity_id: guarId, asset_entity_id: assetId, edge_ok: true };
    },
    attachDoc: async ({ domain, propertyId, fileName, sourceUrl }) => {
      const r = await attachEnrichDocument(domain, propertyId, { fileName, docType: 'lease', sourceUrl }).catch(() => null);
      return { document_id: r?.document_id || null };
    },
  };
}

/**
 * Orchestrate one lease doc: extract → resolve (or use the given property) →
 * dry-run preview OR real apply. Gated: dryRun returns the full write PLAN +
 * boundary check and writes NOTHING.
 */
export async function extractLeaseDoc({ storageRef, fileName, mediaType, raw, domain, propertyId, dryRun = true }, deps) {
  const { normalized } = await runLeaseExtraction({ storageRef, mediaType, raw, fetchImpl: deps?.fetchImpl });

  // Resolve the property from the in-file address unless the caller pinned one.
  let resolved = null;
  if (domain && propertyId != null) {
    resolved = { status: 'matched', domain, property_id: propertyId, reason: 'caller_pinned' };
  } else {
    resolved = await resolveAttachFromExtraction(normalized, deps);
  }

  if (resolved.status !== 'matched') {
    return { ok: false, dry_run: dryRun, resolved, normalized, reason: resolved.status };
  }

  const plan = planLeaseWrites(resolved.domain, normalized);
  // Boundary check: NOTHING the lease writer touches may be a reported field.
  const reported_targets = Object.keys(plan.leaseFields).filter(isReportedField);

  if (dryRun) {
    // Read-only peek: does the property already have an active lease? Lets the
    // gate see whether the real write would CREATE one (the lease-less path) or
    // fill blanks on the existing row. Never writes.
    let existing_lease_id = null;
    if (deps?.findActiveLeaseId) {
      existing_lease_id = await deps.findActiveLeaseId({ domain: resolved.domain, propertyId: resolved.property_id }).catch(() => null);
    }
    const has_factual = Object.keys(plan.leaseFields).length > 0;
    return {
      ok: true, dry_run: true, resolved,
      preview: {
        property: { domain: resolved.domain, property_id: resolved.property_id },
        lease_fields: plan.leaseFields, guarantor: plan.guarantor,
        ti_rows: plan.tiRows.length, expense_rows: normalized.expense_schedule.length,
        existing_lease_id,
        // The real write creates a lease only when there's no active one AND we
        // have factual fields to seed it (else it fills blanks on the existing).
        will_create_lease: existing_lease_id == null && has_factual,
      },
      boundary_ok: reported_targets.length === 0,
      reported_targets,            // must be [] — proves no reported-cohort reach
      warnings: plan.warnings,
    };
  }

  const applied = await applyLeaseEnrichment({
    domain: resolved.domain, propertyId: resolved.property_id, normalized,
    doc: fileName ? { fileName, sourceUrl: storageRef } : null,
  }, deps);
  return { ok: applied.ok, dry_run: false, resolved, applied, boundary_ok: reported_targets.length === 0 };
}

/**
 * POST /api/intake?_route=lease-extract — the gated dry-run / real tool.
 * Body: { storage_ref, file_name?, media_type?, domain?, property_id?, dry_run?, raw? }
 * dry_run defaults TRUE (a call without dry_run:false writes nothing).
 */
export async function handleLeaseExtract(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;
  const b = req.body || {};
  const dryRun = b.dry_run !== false;     // default safe
  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships?.[0]?.workspace_id || process.env.LCC_DEFAULT_WORKSPACE_ID || null;
  const deps = buildRealLeaseDeps({ workspaceId, actorId: user.id });
  try {
    const out = await extractLeaseDoc({
      storageRef: b.storage_ref, fileName: b.file_name, mediaType: b.media_type,
      raw: b.raw || null, domain: b.domain || null, propertyId: b.property_id ?? null,
      dryRun,
    }, deps);
    return res.status(out.ok ? 200 : 422).json(out);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'lease_extract_error' });
  }
}
