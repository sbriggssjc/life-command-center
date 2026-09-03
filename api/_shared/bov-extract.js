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
//                    abstract:{...LeaseAbstract...}, credit:{...}, clause_refs:{...},
//                    base_rent:{amount,basis,as_stated}, rent_basis_unresolved,
//                    lease_commencement_detail, lease_expiration_detail, lease_term }],
//
// EXT1 (2026-09-02): `year1_rent` and both dates are DERIVED IN CODE from what the
// model QUOTES. The model reports the rent with the basis the lease states it on
// and reports a date only when the lease states a full calendar day; annualizing
// and any term arithmetic happen in annualizeRent / deriveExpirationFromTerm. The
// six consumer keys are unchanged — the quoted evidence rides beside them.
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

/**
 * How much document text reaches the model. ⚠️ DOC18 DERIVES THE OCR PAGE WINDOW
 * FROM THIS NUMBER: at ~1,800 chars/page in this corpus it is ~50 pages, which is
 * why the long-document route stops there — every page past it costs money and is
 * discarded here. `test/doc18-three-call-sync-extract.test.mjs` binds the two, so
 * moving this without moving `OCR_WINDOW_TARGET_PAGES` goes RED.
 */
export const LEASE_TEXT_SLICE_CHARS = 90_000;

function leasePrompt(leaseText) {
  return [
    'You are a commercial real estate lease abstractor. Read the LEASE below and',
    'return ONLY a JSON object (no prose, no code fence) with this exact shape.',
    'Use null for anything the lease does not state — NEVER guess a value.',
    'Dollar amounts as plain numbers (no $ or commas). Escalation as a decimal',
    '(0.02 = 2%). For each clause in "clause_refs", give the section label AND a',
    'short verbatim "snippet" (<=8 words) copied from that clause so its page can',
    'be located.',
    '',
    'RENT — REPORT IT AS THE LEASE STATES IT. DO NOT ANNUALIZE AND DO NOT DO ANY',
    'ARITHMETIC: give the figure exactly as written plus the basis it is written',
    'on, and let the caller convert. "$8,464.00 per month" is',
    '{ "amount": 8464, "basis": "monthly", "as_stated": "$8,464.00 per month" }.',
    '"$12.50 per square foot per year" is { "amount": 12.5, "basis":',
    '"per_sf_annual", ... }. If the basis is not stated, leave "basis" null.',
    '',
    'DATES — QUOTE, DO NOT RESOLVE. "date" is filled ONLY when the lease states a',
    'full calendar date. A month-only statement gives "precision":"month" and a',
    'null "date". A date defined by a formula or an event ("the first day of the',
    'month following Delivery", "ten (10) Lease Years from the Commencement Date")',
    'gives "precision":"formula", a null "date", and the formula copied verbatim',
    'into "as_stated". NEVER pick a day, a month, or a year to fill a date the',
    'lease does not state.',
    '',
    'BASE RENT IS WHATEVER THE LEASE DEFINES AS ITS BASE RENT — there is no house',
    'rule. Copy the lease\'s OWN label into "defined_term" ("Base Rent", "Minimum',
    'Rent", "Fixed Rent", "Minimum Annual Rent") and the sentence that defines it,',
    'verbatim, into "definition_as_stated". Any rent the lease states SEPARATELY —',
    'equipment rent, additional rent, CAM, taxes, insurance, percentage rent — is a',
    'row of "additional_rent" with its own quote. DO NOT ADD IT INTO "base_rent",',
    'and DO NOT SUM anything.',
    '',
    'YEAR 1 is the rent schedule period in force at Rent Commencement. Quote',
    '"rent_commencement" as its own date (it is frequently NOT the lease',
    'commencement); quote any free-rent / abated period verbatim into "abatement"',
    'and do NOT net it out of the rent.',
    '',
    'THE TENANT is the legal entity the lease defines as Tenant/Lessee — the party',
    'that signs and is the counterparty to Landlord. Put it in',
    '"tenant_legal_entity" exactly as written, entity suffix included. A trade name',
    'goes in "tenant_dba"; every ADDITIONAL named Tenant/Lessee goes in',
    '"co_tenants". Fill "guarantor" and "guaranty_as_stated" ONLY when the lease',
    'itself contains an express guaranty, and quote that clause. A parent or',
    'affiliate merely NAMED in the lease without guaranteeing it goes in',
    '"parent_mentioned" — it is NOT the tenant and NOT the guarantor.',
    '',
    '{',
    '  "tenant_name": string|null,',
    '  "tenant_legal_entity": string|null,',
    '  "tenant_dba": string|null,',
    '  "co_tenants": [ string ],',
    '  "guarantor": string|null,',
    '  "guaranty_as_stated": string|null,',
    '  "parent_mentioned": string|null,',
    '  "suite": string|null,',
    '  "leased_sf": number|null,',
    '  "lease_type": "NNN"|"NN"|"MG"|"Gross"|null,',
    '  "base_rent": { "amount": number|null, "basis": "monthly"|"annual"|"per_sf_annual"|"per_sf_monthly"|null, "as_stated": string|null, "defined_term": string|null, "definition_as_stated": string|null },',
    '  "additional_rent": [ { "label": string, "amount": number|null, "basis": "monthly"|"annual"|"per_sf_annual"|"per_sf_monthly"|null, "as_stated": string, "kind": "equipment"|"cam"|"tax"|"insurance"|"percentage"|"other"|null } ],',
    '  "abatement": { "as_stated": string|null },',
    '  "escalation_pct": number|null,',
    '  "rent_commencement": { "date": "YYYY-MM-DD"|null, "as_stated": string|null, "precision": "day"|"month"|"year"|"formula"|null },',
    '  "lease_commencement": { "date": "YYYY-MM-DD"|null, "as_stated": string|null, "precision": "day"|"month"|"year"|"formula"|null },',
    '  "lease_expiration": { "date": "YYYY-MM-DD"|null, "as_stated": string|null, "precision": "day"|"month"|"year"|"formula"|null },',
    '  "lease_term": { "as_stated": string|null, "years": number|null, "months": number|null },',
    '  "rent_schedule": [ { "label": string, "start_date": "YYYY-MM-DD"|null, "end_date": "YYYY-MM-DD"|null, "base_rent": { "amount": number|null, "basis": "monthly"|"annual"|"per_sf_annual"|"per_sf_monthly"|null, "as_stated": string|null }, "status": "Contracted"|"Option" } ],',
    '  "abstract": {',
    ABSTRACT_KEYS.map((k) => `    "${k}": string|null`).join(',\n'),
    '  },',
    '  "clause_refs": { "<Clause Label>": { "section": string, "snippet": string } }',
    '}',
    '',
    'LEASE:',
    '"""',
    String(leaseText || '').slice(0, LEASE_TEXT_SLICE_CHARS),
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
    String(ddOmText || '').slice(0, LEASE_TEXT_SLICE_CHARS),
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
    '&select=document_id,document_type,raw_text,pages,ocr_confidence,ocr_tier,char_len,reason' +
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
    // A gpt-4o (tier 'cloud') transcription has no page anchors, and a thin/low-
    // confidence OCR result (Step 2A flags these in `reason`) → citation risk.
    if (row.ocr_tier === 'cloud') citationRisk = true;
    if (row.reason === 'thin_ocr_result' || row.reason === 'no_page_anchors_gpt4o') citationRisk = true;
    // DOC18 — a partial window read the FRONT of a long document. The abstract asks
    // for renewal options, early termination, default cure and holdover, which sit
    // in the back half of a long lease routinely. That is a real, permanent ceiling
    // of this route (§5), so it is flagged rather than allowed to read as complete.
    if (row.reason === 'partial_page_window') citationRisk = true;
    const dt = String(row.document_type || '').toLowerCase();
    if (dt === 'lease') groups.leases.push(row);
    else if (dt === 'dd') groups.dd.push(row);
    else if (dt === 'om') groups.om.push(row);
  }
  return { ...groups, minConfidence, citationRisk, sourceDocIds, _versionForRecord: ver };
}

// ---------------------------------------------------------------------------
// EXT1 — rent basis and quoted dates are resolved in CODE, never by the model
//
// The OCR1c self-agreement control ran the SAME model on the SAME DocAI text
// twice and it disagreed with ITSELF on 29% of `lease_expiration` decisions and
// 11% of `year1_rent`. On one lease it returned 84,464 on one call and 89,496 on
// the next as the annual rent from a text that states `$8,464.00 per month` — a
// figure matching neither 12x nor anything on the page. The model was doing
// arithmetic and choosing date defaults in its head, differently per call, while
// the prompt's own "NEVER guess" instruction sat two lines above the format rule
// that forced the guess. The fix is to stop asking it to: the model QUOTES
// (amount + basis, date + precision + verbatim text) and the functions below do
// the deterministic part.
// ---------------------------------------------------------------------------

/** Rent bases the model may report. Anything else is treated as unstated. */
const RENT_BASES = new Set(['monthly', 'annual', 'per_sf_annual', 'per_sf_monthly']);

/** Round to cents so 12.5 * 3800 * 12 never renders as ...0000004. */
function toCents(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Normalize the model's `base_rent` object into { amount, basis, as_stated }.
 * A bare number (a model that ignored the schema, or a legacy record) is kept as
 * an amount with a NULL basis — which annualizeRent then refuses to convert,
 * because "assume it is annual" is exactly the guess this unit removes.
 */
export function normalizeBaseRent(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || typeof v === 'string') {
    const amount = numOrNull(v);
    return amount == null ? null : { amount, basis: null, as_stated: String(v) };
  }
  if (typeof v !== 'object') return null;
  const amount = numOrNull(v.amount);
  const rawBasis = typeof v.basis === 'string' ? v.basis.trim().toLowerCase() : null;
  const basis = rawBasis && RENT_BASES.has(rawBasis) ? rawBasis : null;
  const asStated = v.as_stated == null || v.as_stated === '' ? null : String(v.as_stated);
  // EXT2 — the lease's OWN label for this figure, and the sentence defining it.
  // Carried, never interpreted: "Base Rent" and "Minimum Annual Rent" are the same
  // slot in different leases, and which components a lease folds into it is a fact
  // about that lease, not a house rule.
  const definedTerm = v.defined_term == null || v.defined_term === '' ? null : String(v.defined_term);
  const definitionAsStated = v.definition_as_stated == null || v.definition_as_stated === ''
    ? null : String(v.definition_as_stated);
  if (amount == null && !asStated) return null;
  return { amount, basis, as_stated: asStated, defined_term: definedTerm, definition_as_stated: definitionAsStated };
}

/**
 * Annualize a quoted rent. THE ONLY PLACE THIS ARITHMETIC HAPPENS.
 *
 * @returns { year1_rent:number|null, rent_basis_unresolved:boolean }
 *
 * `rent_basis_unresolved` is TRUE whenever a real amount is on the page and we
 * still cannot state an annual figure — an unstated basis, or a per-SF rent with
 * no leased SF to multiply by. It is NOT the same fact as "the lease states no
 * rent" (amount null), which resolves to a plain null and no flag: P180's
 * unknown-is-not-a-value rule, applied to the reason as well as the value.
 */
export function annualizeRent(baseRent, leasedSf) {
  const b = normalizeBaseRent(baseRent);
  if (!b || b.amount == null) return { year1_rent: null, rent_basis_unresolved: false };
  const sf = numOrNull(leasedSf);
  switch (b.basis) {
    case 'annual':
      return { year1_rent: toCents(b.amount), rent_basis_unresolved: false };
    case 'monthly':
      return { year1_rent: toCents(b.amount * 12), rent_basis_unresolved: false };
    case 'per_sf_annual':
      return sf ? { year1_rent: toCents(b.amount * sf), rent_basis_unresolved: false }
                : { year1_rent: null, rent_basis_unresolved: true };
    case 'per_sf_monthly':
      return sf ? { year1_rent: toCents(b.amount * sf * 12), rent_basis_unresolved: false }
                : { year1_rent: null, rent_basis_unresolved: true };
    default:
      // An amount with no stated basis. Reporting it verbatim would assert an
      // annual figure the lease never made; the caller keeps `as_stated`.
      return { year1_rent: null, rent_basis_unresolved: true };
  }
}

const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True only for a real calendar day (rejects 2026-02-31, 2026-13-01). */
function isRealDate(s) {
  const m = FULL_DATE.exec(String(s || ''));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Normalize a quoted date into { date, as_stated, precision }.
 *
 * Accepts the EXT1 object shape and, for robustness against a model that ignores
 * the schema (and for any record written before this unit), a bare string.
 *
 * ⚠️ A `date` is emitted ONLY when it is a real calendar day AND the model has
 * not itself said the lease is vaguer than that. A `precision` of month / year /
 * formula beside a filled `date` means the model resolved it in its head — the
 * exact 29%-self-disagreement behaviour this unit removes — so the date is
 * dropped and the verbatim text is kept instead.
 */
export function resolveQuotedDate(v) {
  const empty = { date: null, as_stated: null, precision: null };
  if (v == null || v === '') return empty;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return empty;
    // EXT1b: ONE parser for every date string in this module (see parseStatedDate).
    const parsed = parseStatedDate(s);
    if (!parsed) return { date: null, as_stated: s, precision: null };
    return { date: parsed.date, as_stated: s, precision: parsed.precision };
  }
  if (typeof v !== 'object') return empty;
  const rawPrec = typeof v.precision === 'string' ? v.precision.trim().toLowerCase() : null;
  const precision = ['day', 'month', 'year', 'formula'].includes(rawPrec) ? rawPrec : null;
  const asStated = v.as_stated == null || v.as_stated === '' ? null : String(v.as_stated);
  const raw = v.date == null ? '' : String(v.date).trim();
  const vague = precision === 'month' || precision === 'year' || precision === 'formula';
  const date = !vague && isRealDate(raw) ? raw : null;
  return { date, as_stated: asStated || (date || null), precision: precision || (date ? 'day' : null) };
}

/** Normalize the model's `lease_term` into { as_stated, years, months } | null. */
export function normalizeLeaseTerm(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return { as_stated: v, years: null, months: null };
  if (typeof v !== 'object') return null;
  const years = numOrNull(v.years);
  const months = numOrNull(v.months);
  const asStated = v.as_stated == null || v.as_stated === '' ? null : String(v.as_stated);
  if (years == null && months == null && !asStated) return null;
  return { as_stated: asStated, years, months };
}

/** Total whole months in a term, or null when the lease states no term length. */
function termMonths(term) {
  if (!term) return null;
  const y = Number.isFinite(term.years) ? term.years : 0;
  const m = Number.isFinite(term.months) ? term.months : 0;
  const total = Math.round(y * 12 + m);
  return total > 0 ? total : null;
}

/**
 * Derive an expiration from a stated commencement DAY plus a stated term length.
 *
 * The convention is the standard one and it is deterministic: a term of N months
 * commencing on D expires the day BEFORE D+N months (ten years from 2020-01-01
 * expires 2029-12-31, not 2030-01-01), with a month-end commencement clamped to
 * the last day of the target month rather than rolling into the next one.
 *
 * ⚠️ Only ever called when the model resolved NO expiration of its own, and the
 * result is stamped `derived_from_term` so a reader can tell a derivation from a
 * date the lease states. Anything short of a full commencement day plus a whole
 * term returns null — a partial input is a "Not on file", never a default.
 */
export function deriveExpirationFromTerm(commencement, term) {
  if (!commencement || commencement.precision !== 'day' || !isRealDate(commencement.date)) return null;
  const months = termMonths(term);
  if (months == null) return null;
  const [y, mo, d] = commencement.date.split('-').map(Number);
  const targetIdx = (y * 12 + (mo - 1)) + months;
  const ty = Math.floor(targetIdx / 12);
  const tm = targetIdx % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(ty, tm, Math.min(d, lastDay)));
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// EXT1b — `as_stated` is the AUTHORITY; the model's label is the fallback
//
// EXT1 stopped the model doing arithmetic and made it QUOTE. The floor re-run
// (2026-09-02, `--control self --engines tesseract`) proved the quotes are
// reliably verbatim and the LABELS beside them are not:
//
//   doc 431 rent  `as_stated: "$8,796.50 per month"` with `basis:"per_sf_annual"`,
//                 `amount: 8.7965` — the quote says per month in plain English and
//                 the amount was divided by 1,000 ⇒ `rent_basis_unresolved`, null.
//   doc 336 rent  `as_stated: "Lease Years 1-5: $75,000.00 per year ($6,250.00 per
//                 month) ..."` with `amount: null` — the year-1 figure is the first
//                 `$` in the quote.
//   doc 431 dates `as_stated: "March 15, 2021"` came back `precision:"formula"` on
//                 the control run and `precision:"day"` on the baseline. A plain
//                 calendar date, classified non-deterministically — that flip is the
//                 whole self-disagreement on both date fields (80% / 80%).
//
// So the deterministic half moves one step further into code: when the verbatim
// quote states the basis, the amount or the precision, the QUOTE decides and the
// model's label is used only where the quote is silent. Every function below is
// pure and every override records its source, so a reader can always tell which
// half spoke.
// ---------------------------------------------------------------------------

/** Every `$`-figure in a quote, in order, with the index it starts at. */
function dollarFigures(s) {
  const out = [];
  const re = /\$\s*(\d[\d,]*(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(String(s))) !== null) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push({ amount: n, start: m.index, end: re.lastIndex });
  }
  return out;
}

/**
 * The FIRST `$`-figure in the quote, or null.
 *
 * Doc 336's `as_stated` holds the whole rent schedule and the model returned a
 * null amount beside it; the year-1 figure is the first `$` on the line.
 */
export function amountFromAsStated(asStated) {
  const figs = dollarFigures(asStated);
  return figs.length ? figs[0].amount : null;
}

const PER_SF_RE = /(?:per|\/)\s*(?:[a-z.]+\s+)?(?:sq\.?\s*ft\.?|square\s+f(?:oo|ee)t|s\.?\s*f\.?)(?=\b|\s|\/|$)/i;
const MONTHLY_RE = /(?:per|\/|each)\s*(?:calendar\s+)?month\b|\bmonthly\b|\/\s*mo\b|per\s+mo\b/i;
const ANNUAL_RE = /(?:per|\/)\s*(?:calendar\s+|lease\s+)?year\b|per\s+annum\b|\bannually\b|\bannual\b|\/\s*yr\b|per\s+yr\b/i;

/**
 * Derive the rent basis from the verbatim quote — the fix for doc 431.
 *
 * ⚠️ THE WINDOW IS THE POINT. The basis belongs to ONE figure, and a quote often
 * restates the same rent on a second basis ("$75,000.00 per year ($6,250.00 per
 * month)"). So the text considered runs from the start of the quote up to the
 * NEXT `$`-figure after the one being classified: doc 336 reads "per year" and
 * never sees the parenthetical, and doc 431 reads "per month". Where that window
 * carries BOTH a monthly and an annual marker the quote is genuinely ambiguous
 * and this returns null — the model's label is the fallback, never a coin flip.
 *
 * @param {string|null} asStated  the verbatim rent text
 * @param {number} amountIndex    which `$`-figure the basis is being read for
 * @returns {'monthly'|'annual'|'per_sf_annual'|'per_sf_monthly'|null}
 */
export function basisFromAsStated(asStated, amountIndex = 0) {
  const s = asStated == null ? '' : String(asStated);
  if (!s.trim()) return null;
  const figs = dollarFigures(s);
  const next = figs[amountIndex + 1];
  const window = next ? s.slice(0, next.start) : s;

  const monthly = MONTHLY_RE.test(window);
  const annual = ANNUAL_RE.test(window);
  if (monthly && annual) return null; // two periods in one window ⇒ the quote is silent

  if (PER_SF_RE.test(window)) {
    if (annual) return 'per_sf_annual';
    if (monthly) return 'per_sf_monthly';
    return null; // "$12.50 per rentable square foot" states no period — do not guess one
  }
  if (monthly) return 'monthly';
  if (annual) return 'annual';
  return null;
}

const MONTH_NUM = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const LEAD_WORDS = /^(?:at|on|the|of|as\s+of|effective|dated|commencing|beginning|starting|from|through|until|to)\b[\s,]*/;

const DATE_PATTERNS = [
  { re: /^(\d{4})-(\d{2})-(\d{2})$/, take: (m) => ({ y: +m[1], mo: +m[2], d: +m[3] }) },
  { re: /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/, take: (m) => ({ y: +m[3], mo: +m[1], d: +m[2] }) },
  { re: new RegExp(`^${MONTH_WORD}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})$`), take: (m) => ({ y: +m[3], mo: MONTH_NUM[m[1]], d: +m[2] }) },
  { re: new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:day\\s+of\\s+)?${MONTH_WORD}\\.?,?\\s+(\\d{4})$`), take: (m) => ({ y: +m[3], mo: MONTH_NUM[m[2]], d: +m[1] }) },
  { re: new RegExp(`^${MONTH_WORD}\\.?,?\\s+(\\d{4})$`), take: (m) => ({ y: +m[2], mo: MONTH_NUM[m[1]], d: null }) },
  { re: /^(\d{4})-(\d{2})$/, take: (m) => ({ y: +m[1], mo: +m[2], d: null }) },
  { re: /^(\d{4})$/, take: (m) => ({ y: +m[1], mo: null, d: null }) },
];

/**
 * THE SINGLE DATE PARSER. Everything that reads a date string goes through here.
 *
 * ⚠️ IT MUST CONSUME THE WHOLE QUOTE, NOT FIND A DATE INSIDE ONE. "the earlier of
 * March 1, 2021 or thirty days after Delivery" CONTAINS a calendar date and IS a
 * formula; a `.search()` for a date would resolve it into a day and re-commit the
 * exact defect EXT1 removed. Only a small, closed set of structural wrappers is
 * stripped first (a `Label:` prefix, "on the", "midnight on", trailing
 * punctuation); anything left over means the quote is not simply a date, and this
 * returns null so the model's own precision stands.
 *
 * @returns {{date: string|null, precision: 'day'|'month'|'year'}|null}
 */
function parseStatedDate(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  s = s.replace(/^[^:]{0,40}:\s*/, '');          // a "Commencement Date:" style label
  s = s.replace(/^(?:at\s+)?midnight\s+/, '');
  for (let i = 0; i < 4; i += 1) s = s.replace(LEAD_WORDS, '');
  s = s.replace(/[.,;]+$/, '').trim();
  if (!s) return null;

  for (const p of DATE_PATTERNS) {
    const m = p.re.exec(s);
    if (!m) continue;
    const { y, mo, d } = p.take(m);
    if (!Number.isFinite(y)) return null;
    if (d != null && Number.isFinite(mo)) {
      const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return isRealDate(iso) ? { date: iso, precision: 'day' } : null;
    }
    if (mo != null && Number.isFinite(mo)) return mo >= 1 && mo <= 12 ? { date: null, precision: 'month' } : null;
    return { date: null, precision: 'year' };
  }
  return null;
}

/**
 * Derive precision (and the date itself) from the verbatim quote — the fix for
 * doc 431's dates, where "March 15, 2021" came back `precision:"formula"`.
 *
 * Returns null when the quote is not simply a date, which is what keeps a formula
 * a formula: "Five days after Landlord's Work is Substantially Complete" and
 * "midnight on the last day of the 15th Lease Year" both fall through to null and
 * the model's `formula` stands.
 *
 * @returns {{precision:'day'|'month'|'year', date:string|null}|null}
 */
export function precisionFromAsStated(asStated) {
  const parsed = parseStatedDate(asStated);
  return parsed ? { precision: parsed.precision, date: parsed.date } : null;
}

/**
 * Reconcile a normalized `base_rent` against its own quote.
 *
 * ⚠️ THE MODEL'S NUMBER MUST APPEAR IN THE MODEL'S OWN QUOTE. That is the whole
 * amount rule, and it is what separates doc 431 (`amount: 8.7965` against
 * "$8,796.50 per month" — not present, so the quote wins) from a quote that
 * legitimately carries several figures ("a security deposit of $10,000 and base
 * rent of $8,796.50 per month" — the model picked the second one, so the model
 * keeps it AND the basis is read around that figure, not the deposit). A tolerance
 * would not do this job: 8.7965 and 8,796.50 are the SAME figure scaled by 1,000,
 * and no threshold distinguishes that from a different figure on the page.
 *
 * Fill-blanks in spirit: the model's label is only ever replaced where the quote
 * states the fact itself, and `basis_source` / `amount_source` say which spoke.
 */
export function reconcileBaseRentWithQuote(baseRent) {
  if (!baseRent) return baseRent;
  const asStated = baseRent.as_stated;
  const out = { ...baseRent, basis_source: 'model', amount_source: 'model' };
  if (!asStated) {
    out.basis_source = baseRent.basis == null ? null : 'model';
    out.amount_source = baseRent.amount == null ? null : 'model';
    return out;
  }

  const figs = dollarFigures(asStated);
  let idx = 0;
  if (figs.length) {
    const matched = baseRent.amount == null
      ? -1
      : figs.findIndex((f) => Math.abs(f.amount - baseRent.amount) < 0.01);
    if (matched >= 0) {
      idx = matched;
    } else {
      out.amount = figs[0].amount;
      out.amount_source = 'as_stated';
      idx = 0;
    }
  } else if (baseRent.amount == null) {
    out.amount_source = null;
  }

  const quoted = basisFromAsStated(asStated, idx);
  if (quoted) {
    out.basis = quoted;
    out.basis_source = 'as_stated';
  } else if (baseRent.basis == null) {
    out.basis_source = null;
  }
  return out;
}

/**
 * Reconcile a resolved date detail against its own quote — doc 431's dates.
 *
 * The quote decides in BOTH directions: a calendar day quoted under a `formula`
 * label becomes a day, and a month-only quote under a `day` label drops the day
 * the model invented. Where the quote is not simply a date, nothing changes.
 */
export function reconcileQuotedDateWithQuote(detail) {
  if (!detail || !detail.as_stated) return detail;
  const quoted = precisionFromAsStated(detail.as_stated);
  if (!quoted) return detail;
  if (quoted.precision === detail.precision && (quoted.date || null) === (detail.date || null)) {
    return { ...detail, precision_source: 'as_stated' };
  }
  return { ...detail, date: quoted.date, precision: quoted.precision, precision_source: 'as_stated' };
}

// ---------------------------------------------------------------------------
// EXT2 — the LEASE defines base rent, year 1 and the tenant; code applies it
//
// EXT1 stopped the model computing; EXT1b made the verbatim quote outrank the
// model's label. The floor re-run's residue was neither: it was the model
// choosing a DIFFERENT LINE for the same field, and both lines were verbatim.
//
//   doc 255  one side quoted "$8,464.00 per month" (the TOTAL), the other
//            "$7,445 per month plus $1,019 per month for equipment" (base plus a
//            separately-stated equipment rent). Both are on the page.
//   doc 299  "$7,725.33" vs "$7,373.17 per month" — two periods of one schedule,
//            each quoted as year 1.
//   doc 425/431  a DBA vs the registered entity; an individual plus two entities
//            all named as Tenant.
//
// Scott's decision (2026-09-03) is that there is NO house rule to apply: **each
// lease defines these terms itself.** So the extractor quotes the lease's own
// definition (the `defined_term` / `definition_as_stated` beside the rent, the
// separately-stated components as their own rows, Rent Commencement as its own
// date, every named Tenant party) and the functions below apply THAT definition:
//
//   * base rent is whatever the lease calls base rent — separately-stated
//     equipment / additional rent is never summed into it, and rides as its own
//     `year1_total_rent` so a BOV can show both figures rather than one blended
//     one nobody can trace;
//   * year 1 is the schedule period in force at Rent Commencement (else the first
//     CONTRACTED period, else the single quoted base rent) — and
//     `year1_rent_source` says which. ⚠️ THE SCHEDULE OUTRANKS A `base_rent`
//     QUOTE, deliberately: the schedule is the lease's own statement of what is
//     payable when, and a lone "base rent" figure may be any period of it (doc
//     299 quoted period 2). The residual risk that carries is a lease whose
//     schedule states the BLENDED figure while `base_rent` quotes the base alone
//     — read `year1_rent_source` on such a row rather than assuming;
//   * the tenant is the legal entity that is counterparty to the Landlord. That
//     is the CREDIT absent an express guaranty: a parent NAMED in the lease is
//     not liable, so it is carried as `parent_mentioned` and can never become
//     `credit_entity`.
//
// Every function here is pure and records which half spoke, exactly as EXT1b's do.
// ---------------------------------------------------------------------------

/** Additional-rent kinds the model may report. Anything else is treated as unstated. */
const ADDITIONAL_RENT_KINDS = new Set(['equipment', 'cam', 'tax', 'insurance', 'percentage', 'other']);

/**
 * Kinds that belong in the year-1 TOTAL rent. Pass-throughs a landlord bills and
 * collects (CAM / tax / insurance) and percentage rent are NOT added: the first
 * are reimbursements, not rent to the fee owner, and percentage rent is
 * contingent. Equipment and a lease's own catch-all "additional rent" ARE.
 */
const TOTAL_RENT_KINDS = new Set(['equipment', 'other']);

/**
 * Normalize the model's `additional_rent` rows. Each is reconciled against its own
 * quote by the SAME EXT1b path as base rent — the mislabelling defect appears row
 * by row here too — and annualized by the SAME annualizer. Rows carrying neither a
 * figure nor a quote are dropped; a row that cannot be annualized is KEPT with a
 * null `annual_rent`, because "the lease states an equipment rent we cannot
 * convert" is a fact a reader needs, not a row to disappear.
 */
export function normalizeAdditionalRent(list, leasedSf) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const baseRent = reconcileBaseRentWithQuote(normalizeBaseRent(row));
    if (!baseRent) continue;
    const rawKind = typeof row.kind === 'string' ? row.kind.trim().toLowerCase() : null;
    const kind = rawKind && ADDITIONAL_RENT_KINDS.has(rawKind) ? rawKind : null;
    const { year1_rent: annual, rent_basis_unresolved } = annualizeRent(baseRent, leasedSf);
    out.push({
      label: row.label == null || row.label === '' ? '' : String(row.label),
      kind,
      amount: baseRent.amount,
      basis: baseRent.basis,
      as_stated: baseRent.as_stated,
      annual_rent: annual,
      rent_basis_unresolved,
      basis_source: baseRent.basis_source ?? null,
      amount_source: baseRent.amount_source ?? null,
    });
  }
  return out;
}

/** ISO-string date containment; an open end (no end_date) is treated as open-ended. */
function periodContains(period, iso) {
  if (!iso) return false;
  const start = period.start_date || '';
  const end = period.end_date || '';
  if (!start) return false;
  if (iso < start) return false;
  return !end || iso <= end;
}

/**
 * Which figure is YEAR-1 RENT, and where it came from.
 *
 * The order is the lease's own: the schedule period in force at Rent Commencement,
 * else the first CONTRACTED period, else the single quoted base rent, else a
 * pre-EXT1 record's bare number. An OPTION period is never year 1 — it is rent for
 * a term nobody has exercised.
 *
 * ⚠️ A chosen period with no usable figure falls through to the base rent rather
 * than nulling the field: a schedule row the annualizer could not convert is a
 * reason to prefer the other quote, not a reason to report no rent at all. The
 * source key says which happened every time.
 *
 * @returns {{year1_rent:number|null, year1_rent_source:string|null}}
 */
export function resolveYear1Rent({ baseRent, rentSchedule, rentCommencement, leasedSf, modelYear1 } = {}) {
  const fromBase = baseRent
    ? annualizeRent(baseRent, leasedSf).year1_rent
    : null;
  const fallback = () => {
    if (fromBase != null) return { year1_rent: fromBase, year1_rent_source: 'base_rent' };
    if (baseRent) return { year1_rent: null, year1_rent_source: null };
    const legacy = numOrNull(modelYear1);
    return legacy == null
      ? { year1_rent: null, year1_rent_source: null }
      : { year1_rent: legacy, year1_rent_source: 'model_year1_rent' };
  };

  const periods = Array.isArray(rentSchedule)
    ? rentSchedule.filter((p) => p && p.status !== 'Option')
    : [];
  if (!periods.length) return fallback();

  const commencedOn = rentCommencement && rentCommencement.date ? rentCommencement.date : null;
  const atCommencement = commencedOn ? periods.find((p) => periodContains(p, commencedOn)) : null;
  if (atCommencement && atCommencement.annual_rent != null) {
    return { year1_rent: atCommencement.annual_rent, year1_rent_source: 'schedule_at_rent_commencement' };
  }
  const first = periods[0];
  if (first && first.annual_rent != null) {
    return { year1_rent: first.annual_rent, year1_rent_source: 'schedule_period_1' };
  }
  return fallback();
}

/**
 * Year-1 rent PLUS the separately-stated components — a SECOND field, never
 * written into `year1_rent`.
 *
 * ⚠️ The null is always explained. `no_additional_rent_stated` (the lease states
 * one rent) and `unresolved_component:<label>` (it states two and we cannot
 * convert one) are different facts, and a bare null wearing both would be exactly
 * the P180 unknown-is-not-a-value failure this repo keeps paying for.
 *
 * @returns {{year1_total_rent:number|null, year1_total_rent_note:string|null}}
 */
export function resolveYear1TotalRent(year1Rent, additionalRent) {
  const components = (Array.isArray(additionalRent) ? additionalRent : [])
    .filter((c) => c && TOTAL_RENT_KINDS.has(c.kind));
  if (!components.length) {
    return { year1_total_rent: null, year1_total_rent_note: 'no_additional_rent_stated' };
  }
  if (year1Rent == null) {
    return { year1_total_rent: null, year1_total_rent_note: 'year1_rent_unresolved' };
  }
  const unresolved = components.filter((c) => c.annual_rent == null);
  if (unresolved.length) {
    const labels = unresolved.map((c) => c.label || c.kind || 'component').join('|');
    return { year1_total_rent: null, year1_total_rent_note: `unresolved_component:${labels}` };
  }
  const total = components.reduce((sum, c) => sum + c.annual_rent, year1Rent);
  return { year1_total_rent: toCents(total), year1_total_rent_note: null };
}

/**
 * Split a trade name off a legal entity when the NAME ITSELF states the marker.
 * "Acme Health Services, LLC d/b/a Riverside Dialysis" is one string carrying two
 * facts, and which one is "the tenant" is the whole doc-425 disagreement. The
 * marker set is small and closed — nothing is inferred from the shape of a name.
 */
export function splitDbaFromName(name) {
  const s = name == null ? '' : String(name).trim();
  if (!s) return { legal: null, dba: null };
  const m = /\s+(?:d\/b\/a|d\.b\.a\.?|dba|doing\s+business\s+as)\s+/i.exec(s);
  if (!m) return { legal: s, dba: null };
  const legal = s.slice(0, m.index).replace(/[\s,]+$/, '').trim();
  const dba = s.slice(m.index + m[0].length).trim();
  if (!legal) return { legal: s, dba: null };
  return { legal, dba: dba || null };
}

/**
 * Free rent / abated period, VERBATIM. It is never netted out of the rent — an
 * abatement is a fact about the first months of a term, not a smaller rent, and
 * blending it is the doc-255 defect in a different costume. A model that returns
 * a bare string instead of the object shape is accepted (the same robustness
 * `normalizeBaseRent` has), because losing the quote is the only real failure.
 */
export function normalizeAbatement(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    const s = v.trim();
    return s ? { as_stated: s } : null;
  }
  if (typeof v !== 'object') return null;
  const stated = v.as_stated == null || v.as_stated === '' ? null : String(v.as_stated).trim();
  return stated ? { as_stated: stated } : null;
}

function cleanString(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/**
 * WHO IS THE TENANT, AND WHOSE CREDIT IS IT.
 *
 * Scott's underwriting rule, applied verbatim: the tenant is the legal entity that
 * is counterparty to the Landlord, and THAT is the credit in the three-legs
 * analysis unless the lease itself contains an express guaranty. A parent named in
 * the lease is not liable for a subsidiary's obligations without express
 * authorization, so `parent_mentioned` is carried for a reader and is structurally
 * unable to become `credit_entity` — the credit may well be a subsidiary of
 * unknown size, and saying so is the honest answer.
 *
 * ⚠️ A guarantor NAME with no guaranty CLAUSE does not move the credit. The model
 * naming one is a claim; the quoted clause is the evidence, and only the evidence
 * changes the basis.
 */
export function resolveCreditEntity(parsed = {}) {
  const declared = cleanString(parsed.tenant_legal_entity) || cleanString(parsed.tenant_name);
  const split = splitDbaFromName(declared);
  const tenantLegalEntity = split.legal;
  const tenantDba = cleanString(parsed.tenant_dba) || split.dba;

  const seen = new Set([String(tenantLegalEntity || '').toLowerCase()]);
  const coTenants = [];
  const declaredCoTenants = Array.isArray(parsed.co_tenants)
    ? parsed.co_tenants
    : (typeof parsed.co_tenants === 'string' ? [parsed.co_tenants] : []);
  for (const c of declaredCoTenants) {
    const name = cleanString(c);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    coTenants.push(name);
  }

  const guarantor = cleanString(parsed.guarantor);
  const guarantyAsStated = cleanString(parsed.guaranty_as_stated);
  const express = !!(guarantor && guarantyAsStated);

  return {
    tenant_legal_entity: tenantLegalEntity,
    tenant_dba: tenantDba,
    co_tenants: coTenants,
    guarantor,
    guaranty_as_stated: guarantyAsStated,
    parent_mentioned: cleanString(parsed.parent_mentioned),
    credit_entity: express ? guarantor : tenantLegalEntity,
    credit_entity_basis: express ? 'express_guaranty' : (tenantLegalEntity ? 'tenant_is_counterparty' : null),
  };
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
  const sf = numOrNull(parsed.leased_sf);

  // EXT1 — rent. The model quotes; we annualize. A `year1_rent` NUMBER from the
  // model is IGNORED whenever a quoted `base_rent` is present: the model returned
  // 84,464 and 89,496 on two runs over one `$8,464.00 per month` lease, so its
  // own arithmetic can never be preferred to ours. With no quoted basis at all
  // (a legacy record, or a model that ignored the schema) its number is the only
  // thing on offer and rides through unchanged.
  // EXT1b — the verbatim quote is the authority over the model's own labels.
  const baseRent = reconcileBaseRentWithQuote(normalizeBaseRent(parsed.base_rent));
  const { rent_basis_unresolved } = annualizeRent(baseRent, sf);

  // EXT1 — dates. Quoted, never defaulted; an expiration is derived only from a
  // stated commencement DAY plus a stated term, and says so when it is.
  const commencement = reconcileQuotedDateWithQuote(resolveQuotedDate(parsed.lease_commencement));
  const expiration = reconcileQuotedDateWithQuote(resolveQuotedDate(parsed.lease_expiration));
  const leaseTerm = normalizeLeaseTerm(parsed.lease_term);
  if (!expiration.date) {
    const derived = deriveExpirationFromTerm(commencement, leaseTerm);
    if (derived) {
      expiration.date = derived;
      expiration.precision = 'day';
      expiration.derived_from_term = true;
    }
  }

  // EXT2 — Rent Commencement is its own quoted date (routinely NOT the lease
  // commencement), and it is what selects the year-1 period of the schedule.
  const rentCommencement = reconcileQuotedDateWithQuote(resolveQuotedDate(parsed.rent_commencement));
  const rentSchedule = Array.isArray(parsed.rent_schedule)
    ? parsed.rent_schedule.map((p) => cleanRentPeriod(p, sf)).filter(Boolean)
    : null;
  const additionalRent = normalizeAdditionalRent(parsed.additional_rent, sf);
  const { year1_rent: year1Rent, year1_rent_source: year1RentSource } = resolveYear1Rent({
    baseRent, rentSchedule, rentCommencement, leasedSf: sf, modelYear1: parsed.year1_rent,
  });
  const { year1_total_rent: year1TotalRent, year1_total_rent_note: year1TotalRentNote } =
    resolveYear1TotalRent(year1Rent, additionalRent);
  const credit = resolveCreditEntity(parsed);

  const tenant = {
    name: credit.tenant_legal_entity || '',
    guarantor: credit.guarantor || '',
    suite: parsed.suite || '',
    sf,
    lease_type: parsed.lease_type || 'NNN',
    year1_rent: year1Rent,
    escalation_pct: numOrNull(parsed.escalation_pct),
    lease_commencement: commencement.date || '',
    lease_expiration: expiration.date || '',
    rent_schedule: rentSchedule,
    abstract: Object.keys(abstract).length ? abstract : null,
    clause_refs: Object.keys(clauseRefs).length ? clauseRefs : null,
    // Derivation evidence, beside the six consumer keys — never instead of them.
    base_rent: baseRent,
    // ⚠️ This flag is about the QUOTED BASE RENT, not about `year1_rent`: a
    // schedule can state a year-1 figure over a base-rent quote we could not
    // convert. `year1_rent_source` is what says where the number came from.
    rent_basis_unresolved: baseRent ? rent_basis_unresolved : false,
    year1_rent_source: year1RentSource,
    // EXT2 — the separately-stated components, and the TOTAL as its own field.
    // Never folded into `year1_rent`: doc 255 states $7,445 base plus $1,019
    // equipment, and blending them is what made two verbatim quotes disagree.
    additional_rent: additionalRent.length ? additionalRent : null,
    year1_total_rent: year1TotalRent,
    year1_total_rent_note: year1TotalRentNote,
    abatement: normalizeAbatement(parsed.abatement),
    rent_commencement_detail: rentCommencement,
    lease_commencement_detail: commencement,
    lease_expiration_detail: expiration,
    lease_term: leaseTerm,
    // EXT2 — who the tenant is and whose credit it is. `parent_mentioned` is
    // carried for a reader and can never become `credit_entity`.
    tenant_legal_entity: credit.tenant_legal_entity,
    tenant_dba: credit.tenant_dba,
    co_tenants: credit.co_tenants.length ? credit.co_tenants : null,
    guaranty_as_stated: credit.guaranty_as_stated,
    parent_mentioned: credit.parent_mentioned,
    credit_entity: credit.credit_entity,
    credit_entity_basis: credit.credit_entity_basis,
  };
  return { ok: true, tenant, document_id: leaseRow.document_id, model: resp.data?.model || null };
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * One rent-schedule period. `annual_rent` keeps its name and its type — the BOV
 * generator's RentPeriodInput reads it — but it is now DERIVED from the quoted
 * `base_rent` by the same annualizer as the year-1 figure, so a schedule stated
 * monthly stops being annualized in the model's head one row at a time. A model
 * `annual_rent` number is used only when nothing was quoted.
 */
function cleanRentPeriod(p, leasedSf) {
  if (!p || typeof p !== 'object') return null;
  const baseRent = reconcileBaseRentWithQuote(normalizeBaseRent(p.base_rent));
  const { year1_rent: annualized, rent_basis_unresolved } = annualizeRent(baseRent, leasedSf);
  const annual = baseRent ? annualized : numOrNull(p.annual_rent);
  const start = resolveQuotedDate(p.start_date);
  const end = resolveQuotedDate(p.end_date);
  if (annual == null && !baseRent && !start.date && !p.label) return null;
  return {
    label: p.label || '',
    start_date: start.date || '',
    end_date: end.date || '',
    annual_rent: annual,
    status: p.status === 'Option' ? 'Option' : 'Contracted',
    base_rent: baseRent,
    rent_basis_unresolved: baseRent ? rent_basis_unresolved : false,
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

// ---------------------------------------------------------------------------
// Coverage-gated sweep — only extract properties whose lease/dd/om are FULLY
// text-covered (the v_lcc_cre_bov_ready view), so a half-OCR'd property never
// yields a partial record. Records land status='extracted' (review-gated).
// ---------------------------------------------------------------------------

/**
 * Ready properties not yet extracted at this version. Reads the readiness view,
 * excludes any property that already has a record at BOV_EXTRACT_VERSION (unless
 * deps.refresh), returns up to `limit` property ids. Two cheap reads diffed in JS
 * (mirrors fetchEligibleCreDocs) — no cross-table filter dependency.
 */
export async function fetchReadyProperties({ limit = 5, refresh = false } = {}, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const ver = deps.version || BOV_EXTRACT_VERSION;
  const cap = Math.min(50, Math.max(1, limit));

  const ready = await q('GET',
    `v_lcc_cre_bov_ready?select=cre_property_id,lease_docs,covered_docs&limit=${cap * 4}`,
    null, { countMode: 'none' });
  if (!ready.ok || !Array.isArray(ready.data)) return { ok: false, status: ready.status, detail: ready.data };
  if (!ready.data.length) return { ok: true, rows: [] };

  if (refresh) return { ok: true, rows: ready.data.slice(0, cap) };

  const ids = ready.data.map((r) => r.cre_property_id);
  const existing = await q('GET',
    `lcc_cre_bov_extraction?select=cre_property_id&extractor_version=eq.${encodeURIComponent(ver)}` +
    `&cre_property_id=in.(${ids.join(',')})`,
    null, { countMode: 'none' });
  const done = new Set(existing.ok && Array.isArray(existing.data) ? existing.data.map((r) => r.cre_property_id) : []);
  const rows = ready.data.filter((r) => !done.has(r.cre_property_id)).slice(0, cap);
  return { ok: true, rows };
}

/**
 * Sweep: extract every ready-and-not-yet-done property, bounded by `limit` and an
 * optional wall-clock budget (deps.deadlineMs). Each is review-gated (status=
 * 'extracted'). Never throws; a per-property failure is captured, not fatal.
 */
export async function runBovExtractSweep({ limit = 5, refresh = false } = {}, deps = {}) {
  const ready = await fetchReadyProperties({ limit, refresh }, deps);
  if (!ready.ok) return { ok: false, reason: 'ready_query_failed', detail: ready.detail, results: [] };
  const results = [];
  for (const row of ready.rows) {
    if (deps.deadlineMs && Date.now() > deps.deadlineMs) break;
    const r = await runBovExtract(row.cre_property_id, deps).catch((e) => ({ ok: false, reason: e?.message || String(e) }));
    results.push({
      cre_property_id: row.cre_property_id,
      ok: r.ok, record_id: r.record_id ?? null,
      tenant_count: r.meta?.tenant_count ?? null,
      citation_risk: r.meta?.citation_risk ?? null,
      reason: r.ok ? null : r.reason,
    });
  }
  return { ok: true, swept: results.length, extracted: results.filter((x) => x.ok).length, results };
}

export const __private = { fetchProperty, deriveAssetType, buildPropertyBlock, numOrNull, cleanRentPeriod, leasePrompt };
