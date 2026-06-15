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
import { matchAgainstDomain, matchByPathAnchor, emitMatchDisambiguation } from './intake-matcher.js';
import { attachEnrichDocument } from './intake-promoter.js';
import { ensureEntityLink } from '../_shared/entity-link.js';
import { isMultiTenantDealFolderPath } from '../_shared/folder-feed-classify.js';
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

// True when two field values are the SAME for fill-blanks purposes. Numeric
// compare ONLY when both sides are pure numbers (so 193330.00 vs 193329.48 is a
// DISAGREEMENT, not a rounding match); date strings ('2021-06-01') and text
// compare case-insensitively as strings (never numerically — '2021-06-01' must
// not collapse to 2021). Used by the existing-lease writer to decide
// fill-blank vs conflict; NEVER used to justify an overwrite.
const PURE_NUMBER_RE = /^[\s$,%]*\d[\d.,$%\s]*$/;
export function leaseValuesEqual(a, b) {
  if (a == null || b == null) return a == b;     // both null → equal; one null → not
  const sa = String(a).trim(), sb = String(b).trim();
  if (sa.toLowerCase() === sb.toLowerCase()) return true;
  if (PURE_NUMBER_RE.test(sa) && PURE_NUMBER_RE.test(sb)) {
    const na = num(sa), nb = num(sb);
    if (na !== null && nb !== null) return na === nb;
  }
  return false;
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
 * Cross-attribution contamination guard (defense in depth, multi-tenant deal
 * folders). A multi-tenant deal package (e.g. "DaVita Anchored - Springfield,
 * IL" holding a Hertz car-rental lease) bleeds the anchor's credit family onto
 * a co-tenant: the extractor read the Hertz lease but stamped "Total Renal Care"
 * (DaVita's operating entity) as the guarantor. A guarantor whose credit family
 * CONTRADICTS the tenant's own family is a contamination signal, not a fact —
 * withhold it (never write the column, never mint the guaranteed_by edge) and
 * route the disagreement to the Decision Center.
 *
 * Pure + deterministic so it is unit-testable. Operator-family identity comes
 * from the SAME canonicalization the writer uses (`lcc_operator_affiliate_patterns`
 * → a parent entity id, passed in as tenantParent/guarantorParent) PLUS a
 * dialysis-operator credit-entity cue set as a no-DB fallback. Conservative — it
 * only flags when the guarantor clearly belongs to an operator family the tenant
 * does NOT share, so a normal dialysis lease (operating sub + its credit parent,
 * both → the same family) is never touched.
 *
 * @param {{tenant:?string, guarantor:?string, tenantParent:?string, guarantorParent:?string}} a
 * @returns {boolean}
 */
// Dialysis operator/credit-entity cue — BROADER than folder-feed's vertical
// DIA_CUES (which deliberately omits bare "renal"). It must catch the DaVita
// credit entities a guarantor field carries: "Total Renal Care, Inc." and
// "Renal Treatment Centers …" (DaVita), "Fresenius Medical Care" (FMC/FKC), etc.
const DIA_OPERATOR_CUE = /\b(dialysis|davita|dva|fresenius|fmcna?|fkc|total\s+renal|renal\s+(?:care|treatment)|american\s+renal|us\s+renal|satellite\s+health|nephrolog|kidney)\b/i;
export function guarantorContradictsTenant({ tenant, guarantor, tenantParent = null, guarantorParent = null } = {}) {
  const g = String(guarantor || '').trim();
  if (!g) return false;                                   // nothing to contradict
  // Same resolved operator parent → the operating sub + its credit parent.
  if (tenantParent && guarantorParent && tenantParent === guarantorParent) return false;
  // Both resolve to a parent but DIFFERENT families → cross-attribution.
  if (tenantParent && guarantorParent && tenantParent !== guarantorParent) return true;
  // The guarantor belongs to a known operator family (a resolved parent OR a
  // dialysis-operator credit-entity cue) while the tenant does NOT share it.
  const guarIsOperator = !!guarantorParent || DIA_OPERATOR_CUE.test(g);
  if (!guarIsOperator) return false;
  const t = String(tenant || '').trim();
  // Tenant shares the family iff it resolves to the SAME parent (handled above)
  // OR it carries the same dialysis-operator cue the guarantor does. A tenant
  // with no operator signal at all (e.g. "THE HERTZ CORPORATION") does NOT.
  const tenantSharesFamily = DIA_OPERATOR_CUE.test(g) && DIA_OPERATOR_CUE.test(t);
  return !tenantSharesFamily;
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
 *   mergeField({domain,table,recordPk,field,value}),  // → lcc_merge_field (records provenance)
 *   getLeaseRow({domain, leaseId, propertyId, cols}),  // → live column values (true fill-blanks)
 *   recordConflict({domain,table,recordPk,field,currentValue,attemptedValue}), // → Decision Center
 *   patchLease({domain, leaseId, propertyId, fields}), // domain leases UPDATE (blanks only)
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
    ok: true, fields_filled: 0, conflicts: 0, ti_rows: 0, financial_rows: 0, guarantor_entity_id: null, guaranteed_by_edge: null,
    document_id: null, lease_id: leaseId, lease_created: false, guarantor_withheld: false, warnings: plan.warnings,
  };

  // 0) Cross-attribution contamination guard. A guarantor whose credit family
  //    contradicts the tenant's own family (the multi-tenant deal-folder bleed —
  //    a Hertz lease "guaranteed by" Total Renal Care) is contamination, not a
  //    fact: drop it from the write plan (so neither the create-insert nor the
  //    fill-blanks patch writes the guarantor column, and the guaranteed_by edge
  //    is never minted) and route the disagreement to the Decision Center once
  //    the lease id is known. Operator-family identity reuses the writer's
  //    lcc_operator_affiliate_patterns canonicalization via the optional
  //    resolveOperatorParent dep; DIA_CUES is the no-DB fallback.
  let contaminatedGuarantor = null;
  const guarCol = LEASE_FIELD_MAP[domain]?.fields?.guarantor || 'guarantor';
  if (plan.guarantor) {
    const tenantName = normalized.factual?.tenant || normalized.property_identity?.tenant || null;
    let tenantParent = null, guarantorParent = null;
    if (deps.resolveOperatorParent) {
      tenantParent = await deps.resolveOperatorParent(tenantName).catch(() => null);
      guarantorParent = await deps.resolveOperatorParent(plan.guarantor).catch(() => null);
    }
    if (guarantorContradictsTenant({ tenant: tenantName, guarantor: plan.guarantor, tenantParent, guarantorParent })) {
      contaminatedGuarantor = plan.guarantor;
      out.guarantor_withheld = true;
      out.warnings = [...out.warnings, `guarantor_contradicts_tenant:${contaminatedGuarantor}`];
      plan.guarantor = null;                      // never mint the entity / edge
      delete plan.leaseFields[guarCol];           // never write the guarantor column
    }
  }

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

  // 0b) Route a withheld (contaminated) guarantor to the Decision Center now that
  //     the lease id is known — record-only, the curated guarantor is never
  //     overwritten and the contaminated value is never written.
  if (contaminatedGuarantor && deps.recordConflict) {
    await deps.recordConflict({
      domain, table: plan.table, recordPk: resolvedLeaseId, field: guarCol,
      currentValue: null, attemptedValue: contaminatedGuarantor,
      reason: 'guarantor_contradicts_tenant',
    }).catch(() => {});
    out.conflicts += 1;
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
    // Existing lease — TRUE fill-blanks against the LIVE column value (NOT the
    // lcc_merge_field priority decision, which keys on provenance history and so
    // returns 'write' for un-provenanced curated data → the clobber on lease 14365).
    // Only a column that is currently NULL/empty is written. A populated column
    // that DISAGREES with the doc is NEVER overwritten — it is routed to the
    // Decision Center as a provenance conflict. (Stage B widen blocker fix.)
    const cols = Object.keys(plan.leaseFields);
    const existing = deps.getLeaseRow
      ? await deps.getLeaseRow({ domain, leaseId: resolvedLeaseId, propertyId, cols }).catch(() => ({}))
      : {};
    const fieldsToWrite = {};
    for (const [col, value] of Object.entries(plan.leaseFields)) {
      const cur = existing ? existing[col] : undefined;
      const isBlank = cur === null || cur === undefined || cur === '';
      if (isBlank) {
        fieldsToWrite[col] = value;
        if (deps.mergeField) {
          await deps.mergeField({ domain, table: plan.table, recordPk: resolvedLeaseId, field: col, value }).catch(() => {});
        }
      } else if (!leaseValuesEqual(cur, value)) {
        // Populated + disagreement → route to the Decision Center, never overwrite.
        out.conflicts += 1;
        if (deps.recordConflict) {
          await deps.recordConflict({ domain, table: plan.table, recordPk: resolvedLeaseId, field: col, currentValue: cur, attemptedValue: value }).catch(() => {});
        }
      } // else equal → no-op
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
  // Fix #2: a scanned / image-only PDF (executed copies have no text layer) has no
  // extractable text. Return a graceful needs_ocr outcome instead of throwing (which
  // 500'd the endpoint) — most executed leases will hit this until OCR lands.
  if (!text) return { normalized: null, needs_ocr: true, source: 'needs_ocr' };
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
  // Resolve a guarantor/operator NAME to its canonical parent operator entity via
  // lcc_operator_affiliate_patterns (relationship='operator'). e.g.
  // "Renal Treatment Centers – Mid-Atlantic, Inc." / "Total Renal Care, Inc." →
  // the canonical "Davita" entity. Most-specific (longest) pattern wins. Returns
  // the parent entity id, or null when no operator pattern matches.
  const resolveOperatorParent = async (name) => {
    const nm = String(name || '').trim().toLowerCase();
    if (!nm) return null;
    const r = await opsQuery('GET',
      'lcc_operator_affiliate_patterns?relationship=eq.operator&parent_entity_id=not.is.null' +
      '&select=pattern_name,pattern_type,parent_entity_id').catch(() => ({ ok: false }));
    if (!(r.ok && Array.isArray(r.data))) return null;
    const matches = r.data.filter((p) => {
      const pat = String(p.pattern_name || '').toLowerCase().replace(/%/g, '').trim();
      if (!pat) return false;
      if (p.pattern_type === 'exact') return nm === pat;
      if (p.pattern_type === 'contains') return nm.includes(pat);
      return nm.startsWith(pat);   // 'prefix' (and default)
    }).sort((a, b) => String(b.pattern_name || '').length - String(a.pattern_name || '').length);
    return matches[0]?.parent_entity_id || null;
  };

  return {
    // Exposed so the cross-attribution guard (applyLeaseEnrichment step 0) uses
    // the SAME operator canonicalization the guarantor writer uses — a guarantor
    // and tenant resolving to different operator families is the contamination
    // signal. Returns the canonical parent entity id, or null.
    resolveOperatorParent,
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
    // Read the LIVE lease row's current values for the columns the writer intends
    // to fill — the true-fill-blanks check keys on the actual column, not on
    // provenance history (the lease-14365 clobber root cause).
    getLeaseRow: async ({ domain, leaseId, propertyId, cols }) => {
      let lid = leaseId;
      if (!lid) {
        const g = await domainQuery(domain, 'GET', activeLeaseQuery(domain, propertyId)).catch(() => ({ ok: false }));
        lid = g.ok && g.data?.[0]?.lease_id;
      }
      if (!lid) return {};
      const sel = (Array.isArray(cols) && cols.length) ? cols.join(',') : '*';
      const r = await domainQuery(domain, 'GET', `leases?lease_id=eq.${pgFilterVal(lid)}&select=${sel}&limit=1`).catch(() => ({ ok: false }));
      return (r.ok && r.data?.[0]) ? r.data[0] : {};
    },
    // Route a populated-field disagreement to the Decision Center provenance_conflict
    // lane — a field_provenance row with decision='conflict'. The folder_feed_lease
    // leases rules are enforce_mode='warn' (migration 20260719123000), so
    // v_field_provenance_actionable surfaces it. RECORD-ONLY: the curated value is
    // never overwritten; this only logs the disagreement for human review.
    recordConflict: async ({ domain, table, recordPk, field, currentValue, attemptedValue }) => {
      const r = await opsQuery('POST', 'field_provenance', {
        workspace_id: workspaceId || null,
        target_database: DOMAIN_DB(domain),
        target_table: `${DOMAIN_SCHEMA(domain)}.${table}`,
        record_pk_value: String(recordPk),
        field_name: field,
        value: attemptedValue == null ? null : attemptedValue,
        source: 'folder_feed_lease',
        source_run_id: null,
        confidence: 0.85,
        recorded_by: actorId || null,
        decision: 'conflict',
        decision_reason: `lease doc disagrees with curated ${field}: current=${JSON.stringify(currentValue ?? null)}, attempted=${JSON.stringify(attemptedValue ?? null)} — fill-blanks writer did NOT overwrite`,
      }, { Prefer: 'return=minimal' }).catch(() => ({ ok: false }));
      return { ok: !!r.ok };
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
      // Resolve the guarantor to the CANONICAL operator entity, then a guaranteed_by
      // edge guarantor → the property's asset entity (cross-deal search; brain-hub
      // completeness). Both endpoints are resolved/created BEFORE the edge write; a
      // failed edge is SURFACED as a warning (never swallowed). (Stage B widen.)
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      // Fix #3: resolve a known operator alias (Total Renal Care / Renal Treatment
      // Centers / DVA → Davita) to the registered parent entity instead of minting a
      // per-lease duplicate. On a hit, link the folder_feed_lease guarantor identity
      // ONTO that canonical entity. On a miss, mint a clean org entity by its REAL
      // name (seedFields.name — not display_name, which previously fell through to a
      // "guarantor <slug>" junk name) deduped by canonical_name across domains.
      let guar = null;
      const parentId = await resolveOperatorParent(name).catch(() => null);
      if (parentId) {
        guar = await ensureEntityLink({
          workspaceId, userId: actorId, entityId: parentId,
          sourceSystem: 'folder_feed_lease', sourceType: 'guarantor', externalId: slug,
          metadata: { role: 'guarantor', resolved_via: 'operator_affiliate' },
        }).catch(() => null);
      } else {
        guar = await ensureEntityLink({
          workspaceId, userId: actorId, sourceSystem: 'folder_feed_lease', sourceType: 'guarantor',
          externalId: slug,
          seedFields: { name, entity_type: 'organization' }, metadata: { role: 'guarantor' },
        }).catch(() => null);
      }
      const guarId = guar?.entity?.id || guar?.entityId || parentId || null;
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
  const ext = await runLeaseExtraction({ storageRef, mediaType, raw, fetchImpl: deps?.fetchImpl });
  // Fix #2: a scanned / image-only PDF → graceful needs_ocr (ok:true, no 500).
  if (ext.needs_ocr) {
    return { ok: true, dry_run: dryRun, status: 'needs_ocr', needs_ocr: true, resolved: null, reason: 'needs_ocr' };
  }
  const { normalized } = ext;

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
 * Folder-feed channel entry: extract a lease doc → resolve the property (in-file
 * address FIRST, then the path anchor) → enrich it (real) or preview (dry). This
 * REPLACES the Stage-A light-attach for in-domain (`vertical` dia/gov) lease docs.
 *
 * Returns the SAME result shape as `attachRecognizedDoc` so the folder-feed
 * worker's status mapping is shared: `{attached}` → 'attached',
 * `{emitted_disambiguation}` → 'staged', `{no_domain}` →
 * 'unresolved_no_domain_property'. Out-of-universe never guesses — it routes to
 * the match_disambiguation lane (≥2 in-domain near-misses) or records unresolved.
 *
 * @param {object} a { storageRef, fileName, subjectHint, pathRef?, mediaType?, dryRun?, workspaceId, actorId }
 * @param {object} [injected] { deps?, matchByPathAnchor?, emitMatchDisambiguation? } — tests inject; prod wires live
 */
export async function attachLeaseDoc(a, injected = {}) {
  const { storageRef, fileName, subjectHint, mediaType, workspaceId, actorId, dryRun = false } = a;
  const pathRef = a.pathRef || storageRef || fileName || null;

  // ── Multi-tenant / portfolio deal-folder gate — THE SHARED CHOKE POINT ──────
  // A lease (or any single-asset doc) living under a /Multi/ or /Portfolio(s)/
  // path SEGMENT is part of a multi-tenant / portfolio deal package, NOT a
  // single-asset/single-tenant lease (the Hertz-in-"DaVita Anchored -
  // Springfield, IL" contamination, 2026-06-15). Per dia/gov single-asset
  // doctrine the extractor must NEVER create/fill a domain lease from it — so
  // the gate lives HERE, in the one place every caller funnels through
  // (crawl auto-route, the corpus backfill, and any future caller). It is the
  // GUARANTEE: refuse BEFORE any byte fetch / classify / extract / resolve, and
  // return a terminal, non-enriching result the callers already understand.
  // The folder-feed crawl path keeps its own pre-check (it parks at the crawl
  // layer before this is even called — harmless redundancy that avoids a wasted
  // call), but the extractor itself now refuses so no path can sneak past.
  if (isMultiTenantDealFolderPath(pathRef)) {
    return { ok: true, attached: false, multitenant_deferred: true, skip_reason: 'multitenant_deal_folder', match_status: 'multitenant_deferred' };
  }

  const deps = injected.deps || buildRealLeaseDeps({ workspaceId, actorId });
  const matchPath = injected.matchByPathAnchor || matchByPathAnchor;
  const emitDisambig = injected.emitMatchDisambiguation || emitMatchDisambiguation;

  let normalized;
  try {
    const ext = await runLeaseExtraction({ storageRef, mediaType, raw: a.raw || null, fetchImpl: deps.fetchImpl });
    // Fix #2: scanned / image-only PDF → graceful needs_ocr (folder-feed records
    // it skipped/needs_ocr, never an error/500).
    if (ext.needs_ocr) {
      return { ok: true, attached: false, needs_ocr: true, reason: 'needs_ocr', match_status: 'needs_ocr' };
    }
    ({ normalized } = ext);
  } catch (e) {
    return { ok: false, attached: false, reason: `extract_failed:${e?.message || 'err'}`, match_status: null };
  }

  // Resolve: the in-file street address first (the attach-resolver), then fall
  // back to the path anchor (tenant/City, ST) when the cover page omitted it.
  let resolved = await resolveAttachFromExtraction(normalized, deps);
  if (resolved.status !== 'matched') {
    const m = await matchPath(subjectHint).catch(() => null);
    if (m && m.status === 'matched' && m.property_id != null && (m.domain === 'government' || m.domain === 'dialysis')) {
      resolved = { status: 'matched', domain: m.domain, property_id: m.property_id, reason: `path_anchor_${m.reason || 'match'}` };
    } else if (m && m.status === 'review_required') {
      resolved = { status: 'review_required', candidates: Array.isArray(m.candidates) ? m.candidates : [], reason: 'path_anchor_ambiguous' };
    }
  }

  if (resolved.status === 'matched') {
    const plan = planLeaseWrites(resolved.domain, normalized);
    const reported_targets = Object.keys(plan.leaseFields).filter(isReportedField);
    if (dryRun) {
      return {
        ok: true, attached: false, dry_run: true, domain: resolved.domain, property_id: resolved.property_id,
        preview: {
          lease_fields: plan.leaseFields, guarantor: plan.guarantor, ti_rows: plan.tiRows.length,
          expense_rows: normalized.expense_schedule.length, financial_years: planExpenseFinancials(normalized).length,
        },
        boundary_ok: reported_targets.length === 0, reported_targets, match_status: 'matched',
      };
    }
    const applied = await applyLeaseEnrichment({
      domain: resolved.domain, propertyId: resolved.property_id, normalized,
      doc: fileName ? { fileName, sourceUrl: storageRef } : null,
    }, deps);
    return {
      ok: !!applied.ok, attached: !!applied.ok, lease: true,
      domain: resolved.domain, property_id: resolved.property_id, applied,
      boundary_ok: reported_targets.length === 0, match_status: 'matched',
    };
  }

  if (resolved.status === 'review_required') {
    let emitted = false;
    try {
      await emitDisambig(null, subjectHint?.tenant_brand || null, subjectHint?.tenant_brand || null,
        Array.isArray(resolved.candidates) ? resolved.candidates : [],
        { subjectRef: 'folder_feed_lease:' + pathRef, workspaceId,
          context: { source_path: pathRef, subject_hint: subjectHint || null, doc_type: 'lease' } });
      emitted = true;
    } catch (err) { console.warn('[attachLeaseDoc] disambiguation emit failed (non-fatal):', err?.message); }
    return { ok: false, attached: false, emitted_disambiguation: emitted, reason: 'ambiguous', match_status: 'review_required' };
  }

  // Unmatched — a genuine in-domain miss: captured + tenant-searchable, never a guess.
  return { ok: false, attached: false, no_domain: true, reason: resolved.reason || 'no_domain_property', match_status: resolved.status || null };
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
