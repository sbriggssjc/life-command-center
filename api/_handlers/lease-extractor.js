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

import { isReportedField } from '../_shared/extraction-field-policy.js';

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
 * testable and never wires itself live. Effect order is provenance-first per
 * field; the guarantor entity + guaranteed_by edge are minted before the
 * leases.guarantor column write so the search index and the record agree.
 *
 * @param {object} a  { domain, propertyId, leaseId?, normalized }
 * @param {object} deps {
 *   mergeField({domain,table,recordPk,field,value}),  // → lcc_merge_field
 *   patchLease({domain, leaseId, propertyId, fields}), // domain leases UPDATE
 *   insertTiRows({domain, propertyId, leaseId, rows}),
 *   ensureGuarantorEntity({domain, propertyId, name}), // entity + guaranteed_by edge
 *   attachDoc({domain, propertyId, fileName, sourceUrl}),
 * }
 * @returns {Promise<{ok, fields_filled, ti_rows, guarantor_entity_id, document_id, warnings}>}
 */
export async function applyLeaseEnrichment({ domain, propertyId, leaseId = null, normalized, doc = null }, deps) {
  const plan = planLeaseWrites(domain, normalized);
  const out = { ok: true, fields_filled: 0, ti_rows: 0, guarantor_entity_id: null, document_id: null, warnings: plan.warnings };

  // 1) Guarantor entity + guaranteed_by edge FIRST (search index), then the column.
  if (plan.guarantor && deps.ensureGuarantorEntity) {
    const g = await deps.ensureGuarantorEntity({ domain, propertyId, name: plan.guarantor }).catch(() => null);
    out.guarantor_entity_id = g?.entity_id || null;
  }

  // 2) Factual lease fields — provenance-first per field, then the UPDATE.
  const fieldsToWrite = {};
  for (const [col, value] of Object.entries(plan.leaseFields)) {
    const decision = deps.mergeField
      ? await deps.mergeField({ domain, table: plan.table, recordPk: leaseId ?? propertyId, field: col, value }).catch(() => ({ decision: 'write' }))
      : { decision: 'write' };
    if (!decision || decision.decision === 'write' || decision.decision === 'record_only' || decision.decision === undefined) {
      fieldsToWrite[col] = value;
    }
  }
  if (Object.keys(fieldsToWrite).length && deps.patchLease) {
    const r = await deps.patchLease({ domain, leaseId, propertyId, fields: fieldsToWrite }).catch(() => ({ ok: false }));
    if (r?.ok) out.fields_filled = Object.keys(fieldsToWrite).length;
  }

  // 3) TI amortization rows.
  if (plan.tiRows.length && deps.insertTiRows) {
    const r = await deps.insertTiRows({ domain, propertyId, leaseId, rows: plan.tiRows }).catch(() => ({ ok: false, count: 0 }));
    out.ti_rows = r?.count || 0;
  }

  // 4) Attach the lease doc to the property.
  if (doc && deps.attachDoc) {
    const r = await deps.attachDoc({ domain, propertyId, fileName: doc.fileName, sourceUrl: doc.sourceUrl }).catch(() => null);
    out.document_id = r?.document_id || null;
  }

  return out;
}
