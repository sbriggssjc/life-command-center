// ============================================================================
// comps-tools.js — shared comps engine for the LCC platform
// ONE core (runComps) consumed by THREE thin surfaces:
//   • Claude   -> MCP tool `query_comps`            (makeCompsTools -> handlers)
//   • Copilot  -> POST /api/query-comps             (makeCompsHttpRoutes)
//   • ChatGPT  -> POST /api/query-comps (GPT Action, same endpoint)
// Because all surfaces call runComps(), their data + output cannot diverge.
//
// Wired in server.js:
//   import { makeCompsTools, makeCompsHttpRoutes } from "./comps-tools.js";
//   const { defs, handlers } = makeCompsTools({ govQuery, diaQuery, textResult, withTiming });
//   Object.assign(TOOL_DEFINITIONS, defs); Object.assign(TOOL_HANDLERS, handlers);
//   const compsRoutes = makeCompsHttpRoutes({ govQuery, diaQuery });
//   app.post("/api/query-comps", authenticate, compsRoutes.queryComps);
//   app.post("/api/synthesize-comps", authenticate, compsRoutes.synthesizeComps);
//
// Read-only. Validated end-to-end against live gov + dia RPCs (2026-07-21).
// ============================================================================

import { enforceHttpResponseSize } from "./http-response-bound.js";

const DEFAULT_QUERY_LIMIT = 40;
const DEFAULT_SYNTHESIZE_LIMIT = 25;
const DEFAULT_APPRAISAL_LIMIT = 30;
const MAX_QUERY_LIMIT = 100;
const MAX_SYNTHESIZE_LIMIT = 50;
const APPRAISAL_CANDIDATE_LIMIT = 100;

// ── Property-type synonyms (plain term -> source values, loose ILIKE match) ──
const TYPE_SYNONYMS = {
  medical: ['Health', 'Medical', 'MOB', 'Clinic', 'Dialysis', 'Behavioral'],
  healthcare: ['Health', 'Medical', 'MOB', 'Clinic', 'Dialysis', 'Behavioral'],
  office: ['Office'],
  retail: ['Retail', 'Store', 'Bank'],
  industrial: ['Industrial', 'Warehouse', 'Flex'],
  dialysis: ['Dialysis', 'DaVita', 'Fresenius'],
  government: ['Gov', 'GSA', 'Federal', 'VA', 'Agency'],
};
export function expandTypes(types) {
  if (!types || !types.length) return null;
  const out = new Set();
  for (const t of types) (TYPE_SYNONYMS[String(t).toLowerCase().trim()] || [t]).forEach(v => out.add(v));
  return [...out];
}

// ── Address normalization + cross-source dedup ──────────────────────────────
const STREET_SUFFIX = { st: 'street', str: 'street', ave: 'avenue', av: 'avenue', rd: 'road',
  blvd: 'boulevard', dr: 'drive', ln: 'lane', ct: 'court', cir: 'circle', pkwy: 'parkway',
  hwy: 'highway', pl: 'place', ter: 'terrace', sq: 'square', trl: 'trail', rte: 'route',
  n: 'north', s: 'south', e: 'east', w: 'west' };
function normStreet(a) {
  return String(a || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map(w => STREET_SUFFIX[w] || w).join('');
}
function normKey(c) {
  const yr = String(c.sale_date || '').slice(0, 4);
  return `${normStreet(c.address)}|${String(c.city || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${(c.state || '').toLowerCase()}|${yr}`;
}
// Trustworthiness of a comp's sold_price, from the same cap-rate provenance the
// sales-lane dedup ranks on (implausible LAST; master_curated / validated best).
// Used ONLY as a tiebreaker when confidence ties — e.g. dia_db comps all carry a
// hardcoded confidence 0.85, so without this the surviving price was first-seen
// (arbitrary). Defensive: absent provenance -> neutral, so cross-source behavior
// is unchanged when the signal isn't present. Mirrored in docs/comps-tools/query_comps.tool.js.
const _GOOD_CAP_QUALITY = new Set(['validated', 'cmbs_audited', 'om_actual', 'om_confirmed', 'deed_verified', 'confirmed', 'lease_confirmed']);
function priceQuality(c) {
  const raw = c && c.raw;
  const q = String((raw && raw.cap_rate_quality) || '').toLowerCase();
  const src = String((raw && raw.cap_rate_source) || '').toLowerCase();
  if (/implausible/.test(q)) return 0;
  if (src === 'master_curated' || _GOOD_CAP_QUALITY.has(q)) return 3;
  if (q) return 2;
  return 1;
}
export function dedupe(rows) {
  const byId = new Map();
  for (const r of rows) if (r.source_sf_id) byId.set(r.source_sf_id, r);
  const seen = new Map(); const out = [];
  for (const r of rows) {
    if (r.source === 'salesforce' && byId.has(r.source_sf_id) && byId.get(r.source_sf_id).source !== 'salesforce') continue;
    const k = normKey(r);
    if (seen.has(k)) {
      const prev = seen.get(k);
      const better = (r.sale_price && !prev.sale_price)
        || (r.confidence > prev.confidence)
        || (r.confidence === prev.confidence && priceQuality(r) > priceQuality(prev));
      if (better) { out[out.indexOf(prev)] = r; seen.set(k, r); r._merged_with = (r._merged_with || []).concat(prev.comp_id); }
      else { prev._merged_with = (prev._merged_with || []).concat(r.comp_id); }
      continue;
    }
    seen.set(k, r); out.push(r);
  }
  return out;
}

function routeIntent(a) {
  const types = (a.property_types || []).map(t => String(t).toLowerCase());
  const govWords = /\bva\b|gsa|federal|government|agency|municipal/i.test(a.request || '');
  const isDialysis = types.some(t => /dialysis/.test(t)) || !!a.tenant || !!(a.tenants && a.tenants.length);
  const government_only = govWords ? true : !!a.government_only;
  // Government-only requests must NOT query the dialysis DB, or private DaVita/US Renal
  // comps bleed into a government set. Restrict to the gov vertical in that case.
  const verticals = a.verticals || (government_only ? ['government'] : (isDialysis ? ['dialysis'] : ['government', 'dialysis']));
  return { verticals, government_only };
}
const SOUTHEAST_STATES = new Set(['FL', 'GA', 'AL', 'SC', 'NC', 'TN', 'MS']);
const REGION_STATES = {
  Southeast: ['FL', 'GA', 'AL', 'SC', 'NC', 'TN', 'MS'],
  South: ['TX', 'OK', 'AR', 'LA'],
  West: ['CA', 'OR', 'WA', 'NV', 'AZ', 'UT', 'CO', 'ID'],
  Midwest: ['IL', 'IN', 'IA', 'KS', 'MI', 'MN', 'MO', 'NE', 'ND', 'OH', 'SD', 'WI'],
  Northeast: ['CT', 'DE', 'DC', 'MA', 'MD', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT', 'VA', 'WV'],
};

function uniqueList(vals) {
  return [...new Set((vals || []).filter(Boolean))];
}

function appraisalSubjectAnchor(args) {
  return !!(args?.appraisal_mode && args.subject && (args.subject.state || args.subject.metro || args.subject.name));
}

function appraisalCandidateStates(subject) {
  const states = [];
  if (subject?.state) states.push(String(subject.state).toUpperCase());
  const regional = REGION_STATES[subject?.region] || [];
  states.push(...regional);
  return uniqueList(states);
}

function scoreComp(c, a) {
  let s = 0;
  const subject = a.subject || {};
  const cState = String(c.state || '').toUpperCase();
  const subjectState = String(subject.state || '').toUpperCase();
  if (subject.metro && sameMarket(c, subject.metro)) s += 8;
  else if (a.metros?.some(m => sameMarket(c, m))) s += 6;
  if (subjectState && cState === subjectState) s += 6;
  else if (subjectState === 'FL' && SOUTHEAST_STATES.has(cState)) s += 3;
  else if (a.states?.includes(cState)) s += 3;
  const tenantList = a.tenants || a.tenant_list;
  if (Array.isArray(tenantList) && tenantList.length && tenantListMatches(c, tenantList)) s += 4;
  else if (a.tenant && tenantMatches(c, a.tenant)) s += 4;
  // Credit the normalized `use` too, so an agency's asset-class doubling (VA -> Medical Office)
  // ranks consistently rather than depending on the raw building_type value.
  if (a.property_types?.some(t => ((c.property_type || '') + ' ' + (c.use || '')).toLowerCase().includes(String(t).toLowerCase()))) s += 3;
  if (subject.building_sf && (c.building_sf || c.rba)) {
    const ratio = Math.min(Number(c.building_sf || c.rba), Number(subject.building_sf))
      / Math.max(Number(c.building_sf || c.rba), Number(subject.building_sf));
    if (Number.isFinite(ratio)) s += ratio * 3;
  }
  if (subject.chairs && c.chairs) {
    const ratio = Math.min(Number(c.chairs), Number(subject.chairs)) / Math.max(Number(c.chairs), Number(subject.chairs));
    if (Number.isFinite(ratio)) s += ratio * 2;
  }
  if (subject.cap_rate && c.cap_rate) {
    const spreadBps = Math.abs(Number(c.cap_rate) - Number(subject.cap_rate)) * 10000;
    s += Math.max(0, 3 - (spreadBps / 75));
  }
  if (c.sale_date) { const age = (Date.now() - Date.parse(c.sale_date)) / 3.15e10; s += Math.max(0, 2 - age / 2); }
  if (c.sale_price) s += 1;
  if (c.confidence) s += c.confidence;
  return +s.toFixed(2);
}

function scoreTier(score) {
  if (score >= 14) return 'A';
  if (score >= 9) return 'B';
  return 'C';
}

// ── Use normalization + multi-tenant labeling + NOI reliability (synthesis rules) ──
// Agencies whose facilities double as MEDICAL OFFICE comps (VA CBOCs, IHS/HHS clinics).
const _MEDICAL_AGENCIES = new Set(['VA', 'US DEPARTMENT OF VETERANS AFFAIRS', 'DEPARTMENT OF VETERANS AFFAIRS', 'IHS', 'HHS', 'FDA']);
// Canonical asset-class ("use") so an agency's doubling is consistent + drives ranking.
function normalizeUse(c) {
  const raw = String(c.use || c.property_type || '').trim();
  const ag = String(c.agency || c.tenant || '').toUpperCase();
  if (/medical|clinic|health|mob|hospital|dialysis|behavioral/i.test(raw)) return 'Medical Office';
  if (_MEDICAL_AGENCIES.has(ag)) return 'Medical Office';
  if (/office/i.test(raw)) return 'Office';
  return raw || null;
}
// Asset-type abbreviation for a multi-tenant display name.
const _USE_ABBR = { 'Medical Office': 'MOB', 'Office': 'Office', 'Retail': 'Retail',
  'Industrial': 'Industrial', 'Flex': 'Flex', 'Warehouse': 'Warehouse' };
function isMultiTenant(c) {
  const raw = c.raw || {};
  if (Number(c.tenant_count) > 1) return true;            // authoritative: RPC per-tenant count
  if (/multi/i.test(String(raw.Tenancy__c || ''))) return true;
  if (Number(raw.Tenants__c) > 1) return true;
  const leased = Number(c.gov_sf_leased), rba = Number(c.rba || c.building_sf);
  if (leased && rba && leased < rba * 0.9) return true;
  return false;
}
// Asset class the REQUEST is focused on (from property_types) -> building abbreviation.
function requestedAssetAbbr(reqTypes) {
  const t = (reqTypes || []).map(x => String(x).toLowerCase());
  if (t.some(x => /medic|health|dialysis|clinic|mob/.test(x))) return 'MOB';
  if (t.some(x => /retail/.test(x))) return 'Retail';
  if (t.some(x => /industrial|warehouse|flex/.test(x))) return 'Industrial';
  if (t.some(x => /office/.test(x))) return 'Office';
  return null;
}
// Multi-tenant naming, REQUEST-AWARE (Scott's house style): a medical/dialysis request leads with
// the asset type — MOB (VA); a government request leads with MT — MT (SSA), adding the use when one
// is specified — MT Office (SSA); a comp whose use differs from the request shows MT + the actual use
// — MT Retail (DaVita). Anchor = RPC largest-by-SF tenant (anchor_tenant) else recorded agency.
// A real property name wins (Park Place MOB (Concentra)). Single-tenant names are unchanged.
function displayName(c, ctx) {
  ctx = ctx || {};
  if (!isMultiTenant(c)) return (c.agency || c.tenant) || null;
  const anchor = c.anchor_tenant || c.agency || c.tenant || '';
  const named = String((c.raw || {}).property_name || '').trim();
  if (named) return anchor ? `${named} (${anchor})` : named;
  const reqAbbr = requestedAssetAbbr(ctx.property_types);
  const useAbbr = _USE_ABBR[normalizeUse(c)] || null;
  let prefix;
  if (reqAbbr === 'MOB') prefix = 'MOB';                                   // medical/dialysis request
  else if (ctx.government_only) prefix = reqAbbr ? `MT ${reqAbbr}` : 'MT';  // MT (SSA) / MT Office (SSA)
  else if (reqAbbr) prefix = (useAbbr === reqAbbr) ? reqAbbr : `MT ${useAbbr || reqAbbr}`;
  else prefix = useAbbr || 'MT';
  return anchor ? `${prefix} (${anchor})` : prefix;
}
// Reliability of a comp's NOI/cap for DEFAULT inclusion. Reliable = a human-sourced NOI/cap
// OR a NOI rolled from a prior actual NOI with captured escalations. NOT reliable = a pure
// market-benchmark modeled NOI, an implausible cap, or a comp with no NOI and no cap.
function noiIsReliable(c) {
  const q = String((c.raw || {}).cap_rate_quality || '').toLowerCase();
  if (/implausible/.test(q)) return false;
  // Rolled-forward-from-actual-rent (with captured escalations) is reliable on EITHER DB.
  if (/rolled|escalat|prior/i.test(q) || /rolled|escalat|prior/i.test(String(c.noi_modeled_source || ''))) return true;
  // Pure estimates are NOT reliable — same policy both verticals: gov benchmark-modeled NOI, or
  // dialysis imputed rent (its cap derives from an estimated rent).
  const noiModeled = (c.noi_is_modeled === true || String(c.noi_is_modeled) === 'true');
  const rentImputed = (c.rent_is_imputed === true || String(c.rent_is_imputed) === 'true'
                       || String(c.rent_source || '').toLowerCase() === 'imputed');
  if (noiModeled || rentImputed) return false;
  return (c.cap_rate != null) || (c.noi != null);
}

function clampLimit(v, def, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(max, n));
}

function normText(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tenantMatches(c, tenant) {
  const needle = normText(tenant);
  if (!needle) return true;
  const hay = normText([
    c.tenant, c.agency, c.operator, c.anchor_tenant,
    c.raw?.tenant, c.raw?.agency, c.raw?.operator, c.raw?.Tenant__c, c.raw?.Primary_Tenant__c,
  ].filter(Boolean).join(' '));
  return !!hay && (hay.includes(needle) || needle.includes(hay));
}

function tenantListMatches(c, tenants) {
  if (!Array.isArray(tenants) || !tenants.length) return true;
  return tenants.some(t => tenantMatches(c, t));
}

function sameMarket(c, market) {
  const m = normText(market);
  if (!m) return true;
  const city = normText(c.city);
  const metro = normText(c.metro || c.market || c.submarket || c.raw?.metro || c.raw?.market || c.raw?.submarket);
  return city === m || metro === m || (!!city && (city.includes(m) || m.includes(city)))
    || (!!metro && (metro.includes(m) || m.includes(metro)));
}

function sameAddress(c, address) {
  const a = normStreet(address);
  if (!a) return false;
  const row = normStreet(c.address || c.raw?.address || c.raw?.Property_Address__c || c.raw?.Street_Address__c);
  return !!row && (row === a || row.includes(a) || a.includes(row));
}

function sameSubjectId(c, subject) {
  const ids = uniqueList([
    subject?.property_id, subject?.asset_id, subject?.source_id, subject?.comp_id,
    subject?.raw?.property_id, subject?.raw?.asset_id, subject?.raw?.source_id,
  ].map(v => v == null ? null : String(v)));
  if (!ids.length) return false;
  const rowIds = uniqueList([
    c.property_id, c.asset_id, c.source_id, c.source_sf_id, c.comp_id,
    c.raw?.property_id, c.raw?.Property_ID__c, c.raw?.Id, c.raw?.source_id,
  ].map(v => v == null ? null : String(v)));
  return rowIds.some(id => ids.includes(id));
}

function isSubjectComp(c, args) {
  const subject = args?.subject;
  if (!appraisalSubjectAnchor(args) || !subject) return false;
  if (sameSubjectId(c, subject)) return true;
  if (subject.address && sameAddress(c, subject.address)) {
    const subjectState = String(subject.state || '').toUpperCase();
    return !subjectState || String(c.state || '').toUpperCase() === subjectState;
  }
  return false;
}

function applyLocalScope(rows, args) {
  let out = rows;
  if (Array.isArray(args.tenants) && args.tenants.length) out = out.filter(c => tenantListMatches(c, args.tenants));
  else if (Array.isArray(args.tenant_list) && args.tenant_list.length) out = out.filter(c => tenantListMatches(c, args.tenant_list));
  else if (args.tenant) out = out.filter(c => tenantMatches(c, args.tenant));
  if (Array.isArray(args.states) && args.states.length) {
    const states = new Set(args.states.map(s => String(s).toUpperCase()));
    out = out.filter(c => !c.state || states.has(String(c.state).toUpperCase()));
  }
  if (Array.isArray(args.metros) && args.metros.length) {
    out = out.filter(c => args.metros.some(m => sameMarket(c, m)));
  }
  return out;
}

function localScopeArgs(args) {
  if (!appraisalSubjectAnchor(args)) return args;
  return { ...args, states: null, metros: null };
}

function queryScopeArgs(args) {
  if (!appraisalSubjectAnchor(args)) return args;
  const states = appraisalCandidateStates(args.subject);
  return { ...args, states: states.length ? states : null, metros: null };
}

function templateRow(c) {
  const salePrice = c.price_withheld ? null : (c.sale_price ?? c.sold_price ?? null);
  const rba = c.building_sf ?? c.rba ?? c.building_size ?? null;
  const pricePerSf = c.price_per_sf ?? (salePrice && rba ? +(salePrice / rba).toFixed(2) : null);
  const annualNoi = c.noi ?? c.engine_income ?? c.annual_rent ?? null;
  return {
    property_name: c.property_name || c.raw?.property_name || c.tenant || c.agency || null,
    tenant: c.tenant || c.agency || null,
    address: c.address || null,
    city: c.city || null,
    state: c.state || null,
    rba_sf: rba,
    chairs: c.chairs ?? null,
    patients: c.patient_count ?? c.patients ?? null,
    sale_price: salePrice,
    cap_rate: c.cap_rate ?? null,
    price_per_sf: pricePerSf,
    annual_noi: annualNoi,
    annual_rent: c.annual_rent ?? null,
    rent_per_sf: c.rent_per_sf ?? (c.annual_rent && rba ? +(c.annual_rent / rba).toFixed(2) : null),
    sale_date: c.sale_date || null,
    buyer: c.buyer || c.raw?.buyer || null,
    seller: c.seller || c.raw?.seller || null,
    source: c.source || null,
    comp_id: c.comp_id || null,
    review_flags: c.review_flags || undefined,
    score_tier: c.score_tier || undefined,
  };
}

function compactComp(c) {
  const {
    raw, _merged_with, review_detail,
    ...rest
  } = c || {};
  return {
    ...rest,
    template: templateRow(c || {}),
    review_detail,
  };
}

function argsToParams(args) {
  return {
    p_comp_type: args.comp_type || 'sale',
    p_property_types: expandTypes(args.property_types),
    p_states: args.states || null,
    p_metros: args.metros || null,
    p_date_from: args.date_from || null,
    p_date_to: args.date_to || null,
    p_sf_min: args.size_min_sf ?? null,
    p_sf_max: args.size_max_sf ?? null,
    p_government_only: !!args.government_only,
    p_include_sf: args.include_salesforce !== false,
    p_include_onmkt: !!args.include_on_market,
    p_limit: clampLimit(args.limit, DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT),
    p_tenant: (Array.isArray(args.tenants) && args.tenants.length > 1) ? null
      : (Array.isArray(args.tenant_list) && args.tenant_list.length > 1) ? null
      : (Array.isArray(args.tenants) && args.tenants.length === 1) ? args.tenants[0]
      : (Array.isArray(args.tenant_list) && args.tenant_list.length === 1) ? args.tenant_list[0]
      : (args.tenant || null),
  };
}

// ── Server-side request parser — so agents only pass raw text ───────────────
// Every surface parses differently; doing it here guarantees identical results.
const US_STATES = { alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA',
  colorado:'CO', connecticut:'CT', delaware:'DE', florida:'FL', georgia:'GA', hawaii:'HI',
  idaho:'ID', illinois:'IL', indiana:'IN', iowa:'IA', kansas:'KS', kentucky:'KY', louisiana:'LA',
  maine:'ME', maryland:'MD', massachusetts:'MA', michigan:'MI', minnesota:'MN', mississippi:'MS',
  missouri:'MO', montana:'MT', nebraska:'NE', nevada:'NV', 'new hampshire':'NH', 'new jersey':'NJ',
  'new mexico':'NM', 'new york':'NY', 'north carolina':'NC', 'north dakota':'ND', ohio:'OH',
  oklahoma:'OK', oregon:'OR', pennsylvania:'PA', 'rhode island':'RI', 'south carolina':'SC',
  'south dakota':'SD', tennessee:'TN', texas:'TX', utah:'UT', vermont:'VT', virginia:'VA',
  washington:'WA', 'west virginia':'WV', wisconsin:'WI', wyoming:'WY', 'district of columbia':'DC' };
const STATE_ABBRS = new Set(Object.values(US_STATES));
const PLACE_GAZETTEER = [
  { re: /\bthe villages\b/i, name: 'The Villages', state: 'FL', metro: 'Wildwood-The Villages', region: 'Southeast' },
  { re: /\bwildwood\b/i, name: 'Wildwood', state: 'FL', metro: 'Wildwood-The Villages', region: 'Southeast' },
  { re: /\bwoodland hills\b/i, name: 'Woodland Hills', state: 'CA', metro: 'Los Angeles', region: 'West' },
  { re: /\borlando\b/i, name: 'Orlando', state: 'FL', metro: 'Orlando', region: 'Southeast' },
  { re: /\btampa\b/i, name: 'Tampa', state: 'FL', metro: 'Tampa-St. Petersburg', region: 'Southeast' },
  { re: /\bmiami\b/i, name: 'Miami', state: 'FL', metro: 'Miami-Fort Lauderdale', region: 'Southeast' },
  { re: /\bdallas\b/i, name: 'Dallas', state: 'TX', metro: 'Dallas-Fort Worth', region: 'South' },
  { re: /\bfort worth\b/i, name: 'Fort Worth', state: 'TX', metro: 'Dallas-Fort Worth', region: 'South' },
  { re: /\bhouston\b/i, name: 'Houston', state: 'TX', metro: 'Houston', region: 'South' },
  { re: /\baustin\b/i, name: 'Austin', state: 'TX', metro: 'Austin', region: 'South' },
  { re: /\bsan antonio\b/i, name: 'San Antonio', state: 'TX', metro: 'San Antonio', region: 'South' },
];
const SUBJECT_UNKNOWN_FIELDS = ['tenant', 'credit', 'remaining_term', 'building_sf', 'chairs', 'cap_rate', 'lease_structure'];
const OPERATOR_PATTERNS = [
  [/\bu\.?\s*s\.?\s*renal\b|\busrc\b/g, 'US Renal'], [/\bdavita\b/g, 'DaVita'],
  [/\bfresenius\b|\bfmc\b/g, 'Fresenius'], [/\bamerican renal\b/g, 'American Renal'],
  [/\bsatellite (?:health|dialysis)\b/g, 'Satellite'], [/\binnovative renal\b/g, 'Innovative Renal'],
  [/\bdialysis clinic\b|\bdci\b/g, 'Dialysis Clinic'], [/\bdsi\b/g, 'DSI Renal'],
  [/\brenal ventures\b/g, 'Renal Ventures'],
];

function resolvePlace(raw, t) {
  for (const p of PLACE_GAZETTEER) {
    if (p.re.test(raw)) return {
      name: p.name, state: p.state, metro: p.metro, region: p.region,
      kind: /deal|asset|property|under contract|our\b/i.test(raw) ? 'subject_candidate' : 'place',
      fields: Object.fromEntries(SUBJECT_UNKNOWN_FIELDS.map(f => [f, 'Not on file'])),
    };
  }
  const cityState = raw.match(/\b([A-Z][A-Za-z.' -]{2,60}?),\s*([A-Z]{2}|[A-Za-z ]{4,30})\b/);
  if (cityState) {
    const state = STATE_ABBRS.has(cityState[2].toUpperCase())
      ? cityState[2].toUpperCase()
      : US_STATES[cityState[2].toLowerCase()];
    if (state) return {
      name: cityState[1].trim(), state, metro: cityState[1].trim(), kind: 'place',
      fields: Object.fromEntries(SUBJECT_UNKNOWN_FIELDS.map(f => [f, 'Not on file'])),
    };
  }
  return null;
}

function parseOperators(t) {
  if (/\ball operators\b|\bany operator\b|\ball tenants\b|\bany tenant\b|\bnames none\b/.test(t)) return [];
  const found = [];
  for (const [re, name] of OPERATOR_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(t) && !found.includes(name)) found.push(name);
  }
  return found;
}

function detectAppraisalIntent(t, out) {
  if (/\bappraiser\b|\bappraisal\b|\bvaluation\b|\bvaluing\b|\bunder contract\b|\bom\b|\bbov\b|\bcomp package\b|\bpackage\b/.test(t)) return true;
  if (out.subject?.name) {
    const name = String(out.subject.name).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\bin\\s+(?:the\\s+)?${name}\\b`).test(t)) return false;
  }
  return !!(out.property_types?.includes('dialysis') && out.subject?.state && !out.tenant && !out.date_from);
}

export function parseRequest(text) {
  const raw = String(text || ''); const t = raw.toLowerCase(); const out = {};
  const states = new Set();
  for (const [name, ab] of Object.entries(US_STATES)) if (new RegExp(`\\b${name}\\b`).test(t)) states.add(ab);
  // Standalone 2-letter codes, but NOT 'VA' — in this domain "VA" means Veterans Affairs, not Virginia.
  for (const a of (raw.match(/\b[A-Z]{2}\b/g) || [])) if (STATE_ABBRS.has(a) && a !== 'VA') states.add(a);
  if (/\bnationwide\b|\bnational\b|across the (?:us|country)|\bu\.?s\.?a\b/.test(t)) states.clear();
  if (states.size) out.states = [...states];
  const subject = resolvePlace(raw, t);
  if (subject) {
    out.subject = subject;
    states.add(subject.state);
    out.states = [...states];
    out.metros = [subject.metro || subject.name];
  }
  const statePattern = [...states].join('|');
  let loc;
  if (statePattern && (loc = raw.match(new RegExp(`\\b([A-Z][A-Za-z.' -]{2,60}?),\\s*(${statePattern})\\b`)))) {
    const city = loc[1].trim();
    if (!out.metros && !US_STATES[city.toLowerCase()] && !/davita|fresenius|renal|dialysis|medical/i.test(city)) out.metros = [city];
  }
  const pt = new Set();
  if (/\b(medical|health|healthcare|mob|clinic|hospital)\b/.test(t)) pt.add('medical');
  if (/\b(dialysis|davita|fresenius|renal|fmc|dci|usrc)\b/.test(t)) pt.add('dialysis');
  if (/\boffice\b/.test(t)) pt.add('office');
  if (/\bretail\b/.test(t)) pt.add('retail');
  if (/\b(industrial|warehouse|flex)\b/.test(t)) pt.add('industrial');
  if (pt.size) out.property_types = [...pt];
  if (/\bva\b|veterans|gsa|federal|government|\bgov\b|\bagency\b|\bssa\b|social security|municipal|\birs\b|\bfbi\b|\bdea\b|uscis|\bhhs\b|\bihs\b/.test(t)) out.government_only = true;
  if (/on.?market|active listing|\bavailable\b|for sale|\blistings?\b/.test(t)) out.include_on_market = true;
  if (/\bboth\b|sold (?:and|&) (?:active|listing)|sales? (?:and|&) listings?|on.?market (?:and|&) sold/.test(t)) {
    out.comp_type = 'both';
    out.include_on_market = true;
  } else if (/on.?market|active listing|\bavailable\b|for sale|\blistings?\b/.test(t) && !/\bsales?\b|\bsold\b/.test(t)) {
    out.comp_type = 'lease';
  } else if (/\bsales?\b|\bsold\b|\bclosed\b/.test(t)) {
    out.comp_type = 'sale';
  }
  // Opt-in to include comps whose NOI/cap isn't reliable (default excludes them).
  if (/without noi|no noi|missing noi|estimated noi|modeled noi|imputed rent|estimated rent|include estimate|regardless of noi|all comps/.test(t)) out.include_unreliable_noi = true;
  const WN = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };
  const numOf = s => (/^\d+$/.test(s) ? parseInt(s, 10) : (WN[s] || null));
  let months = null, m;
  if ((m = t.match(/(?:last|past|trailing)\s+([a-z]+|\d+)\s+month/))) months = numOf(m[1]);
  else if ((m = t.match(/(?:last|past|trailing)\s+([a-z]+|\d+)\s+year/))) { const n = numOf(m[1]); months = n ? n * 12 : null; }
  else if (/last\s+year|past\s+year|trailing\s+(?:12|twelve)|\bttm\b|last\s+12\s+months|\bt-?12\b/.test(t)) months = 12;
  else if (/last\s+quarter|past\s+quarter/.test(t)) months = 3;
  if (months) { const d = new Date(Date.now()); d.setMonth(d.getMonth() - months); out.date_from = d.toISOString().slice(0, 10); }
  if ((m = t.match(/since\s+(\d{4})/))) out.date_from = `${m[1]}-01-01`;
  const operators = parseOperators(t);
  if (operators.length === 1) out.tenant = operators[0];
  if (operators.length > 1) out.tenants = operators;
  if (operators.length || /\bdialysis\b|\brenal\b|\bfmc\b|\busrc\b/.test(t)) {
    pt.add('dialysis');
    out.property_types = [...pt];
  }
  out.appraisal_mode = detectAppraisalIntent(t, out);
  if (out.appraisal_mode && out.property_types?.includes('dialysis')) {
    out.include_unreliable_noi = true;
    out.include_on_market = true;
    out.comp_type = out.comp_type || 'both';
    if (!operators.length) out.tenant = null;
  }
  return out;
}

// ── Comps cap/rent reconciliation + outlier flagging (Team Briggs policy) ───
// A sold comp whose DISPLAYED rent doesn't reconcile to its reliable cap is an
// OUTLIER — e.g. Pearland (dia 7980): template SOLD CAP = RENT/PRICE = 4.40%,
// but the reliable cap_rate_final = 7.00% and rent_at_sale disagrees with the
// in-place rent. We DETECT + surface such divergence at comps-generation time
// and route it to the domain review queue for SOURCE correction — never silently
// ship it, and never silently "fix" it by swapping the displayed rent basis.
// This layer is NON-DESTRUCTIVE: it annotates the comp (review_flags /
// review_detail) and enqueues it; the comp's values are unchanged and it is
// still returned/exported.
//
// Thresholds are constants so Scott can tune them in one place.
const CAP_MISMATCH_BPS    = 0.0075;  // |implied_cap - reliable_cap| tolerance (75 bps)
const RENT_DISAGREE_RATIO = 1.10;    // rent sources disagree beyond 10% (max/min)
const PRICE_OVER_ASK_RATIO  = 1.10;  // sold > 110% of last/initial ask
const PRICE_UNDER_ASK_RATIO = 0.85;  // sold < 85% of last/initial ask

// A usable positive number, else null (0 / blank / non-numeric are "absent").
function _reviewNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return (Number.isFinite(n) && n > 0) ? n : null;
}

// Per-SOLD-comp reconciliation signal. Returns { review_flags, review_detail }
// when at least one flag trips, else null. Uses the SAME rent basis the template
// shows today (dialysis: RENT = annual_rent; government: NOI) — it does NOT change
// the displayed basis, only checks whether it reconciles to the reliable cap.
export function computeReviewSignals(c) {
  if (!c) return null;
  const raw = c.raw || {};
  const isGov = c.is_government === true || String(c.vertical || '').toLowerCase() === 'government';
  const sold = _reviewNum(c.sale_price);
  // W3.6b — the number PRICE is divided into. Prefer the CAP ENGINE's income
  // (gov_compute_cap_rate NOI / dia_compute_cap_rate net rent) — the same
  // reconciled, active-lease-anchored figure the cap engine already uses — over
  // the stale properties value (gov: properties.noi, mostly estimated_comp_ratio
  // @2026-03-31; dia: annual_rent). runComps attaches c.engine_income (+ source /
  // confidence) for sold comps via the batch RPCs; when the engine has nothing
  // (c.engine_income absent) we fall back to the displayed basis, so behavior is
  // unchanged wherever the engine can't reconcile. This is the systemic W3.6b fix:
  // 54/61 gov cap_mismatch rows were the stale-properties.noi pattern the engine
  // already agreed with.
  const engineIncome = _reviewNum(c.engine_income);
  const fallbackRent = isGov ? _reviewNum(c.noi) : _reviewNum(c.annual_rent);
  const usedEngine = engineIncome != null;
  const displayedRent = usedEngine ? engineIncome : fallbackRent;
  // Reliable cap-of-record: dia = cap_rate_final; gov = sold_cap_rate (fall back to
  // the RPC's top-level derived cap when the source cap column is absent).
  const reliableCap = isGov
    ? (_reviewNum(raw.sold_cap_rate) ?? _reviewNum(c.cap_rate))
    : (_reviewNum(raw.cap_rate_final) ?? _reviewNum(c.cap_rate));
  const impliedCap = (displayedRent && sold) ? +(displayedRent / sold).toFixed(6) : null;

  // Available rent sources for the disagreement check.
  const rents = {};
  const ar  = _reviewNum(c.annual_rent);                          if (ar)  rents.annual_rent = ar;
  const anc = _reviewNum(c.anchor_rent) ?? _reviewNum(raw.anchor_rent); if (anc) rents.anchor_rent = anc;
  const ras = _reviewNum(raw.rent_at_sale);                       if (ras) rents.rent_at_sale = ras;

  const ask = _reviewNum(c.last_price) ?? _reviewNum(c.initial_price);

  const flags = [];
  if (impliedCap != null && reliableCap != null && Math.abs(impliedCap - reliableCap) > CAP_MISMATCH_BPS)
    flags.push('cap_mismatch');
  const rentVals = Object.values(rents);
  if (rentVals.length >= 2) {
    const mx = Math.max(...rentVals), mn = Math.min(...rentVals);
    if (mn > 0 && mx / mn > RENT_DISAGREE_RATIO) flags.push('rent_disagreement');
  }
  if (sold && ask && (sold > PRICE_OVER_ASK_RATIO * ask || sold < PRICE_UNDER_ASK_RATIO * ask))
    flags.push('price_over_ask');
  if (reliableCap == null) flags.push('no_reliable_cap');

  if (!flags.length) return null;
  // W3.6 — record the INPUTS behind each cap so the reviewer can see WHICH number
  // is stale. implied_basis = the rent/NOI that divides PRICE (gov: NOI; dia:
  // annual_rent) + its source + as-of date; reliable_basis = the cap-of-record's
  // provenance. The value is reconstructable from implied_cap×price on old rows,
  // but the source/as_of only live here.
  const impliedBasis = (displayedRent != null) ? {
    value: displayedRent,
    kind: isGov ? 'NOI' : 'RENT',
    // W3.6b — label WHICH source fed the number so the reviewer sees whether the
    // implied cap came from the reconciled engine (with its income source +
    // confidence) or the stale properties fallback.
    source: usedEngine
      ? `engine:${c.engine_income_source || (isGov ? 'gov_compute_cap_rate' : 'dia_compute_cap_rate')}`
        + (c.engine_income_confidence ? ` (${c.engine_income_confidence})` : '')
      : (isGov
          ? (c.noi_is_modeled ? ('modeled: ' + (c.noi_modeled_source || 'benchmark'))
              : (c.noi_source || raw.noi_source || c.provenance_tag || c.data_source || 'property NOI'))
          : (raw.cap_rate_final != null ? 'cap_rate_final' : (c.data_source || 'reported rent'))),
    // Engine income is valued as of the sale date; the fallback carries its own as-of.
    as_of: usedEngine
      ? (c.sale_date || null)
      : (c.noi_as_of_date || raw.noi_as_of_date || c.as_of_date || raw.as_of_date || null),
    engine_used: usedEngine,
  } : null;
  const reliableBasis = (reliableCap != null) ? {
    value: reliableCap,
    source: isGov ? 'ingested sale cap (sold_cap_rate)' : 'cap_rate_final',
  } : null;
  return { review_flags: flags,
    review_detail: { implied_cap: impliedCap, reliable_cap: reliableCap, rents, ask, sold,
      implied_basis: impliedBasis, reliable_basis: reliableBasis } };
}

// Renewal-options normalizer — options come through as free text ("2, 5 yr",
// "Three, 5-Year Options", "2, 5yr", "Two, 5-Year Options"). Parse count + term
// length → canonical "(N) M-yr". Unrecognized shapes pass through unchanged + log.
const _RENEWAL_WORDNUM = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7,
  eight:8, nine:9, ten:10, eleven:11, twelve:12 };
function _renewalWordNum(s) {
  if (s == null) return null;
  const t = String(s).trim().toLowerCase();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return _RENEWAL_WORDNUM[t] || null;
}
export function normalizeRenewalOptions(value) {
  if (value == null) return value;
  const s = String(value).trim();
  if (!s) return value;
  if (/^\(\d+\)\s*\d+-yr$/.test(s)) return s;   // already canonical
  // count + term: "Three, 5-Year Options" / "2, 5yr" / "(2) 5 year" / "2 x 5 yr" / "two 5-year options"
  const m = s.match(/\(?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*\)?\s*[,x×\-\s]+\s*(\d+)\s*-?\s*(?:yr|year)s?\b/i);
  if (m) {
    const n = _renewalWordNum(m[1]), term = parseInt(m[2], 10);
    if (n && term) return `(${n}) ${term}-yr`;
  }
  // single option, no explicit count: "5-year option" → (1) 5-yr
  const m2 = s.match(/^\s*(?:a\s+|one\s+)?(\d+)\s*-?\s*(?:yr|year)s?\b[^,]*\boption/i);
  if (m2) { const term = parseInt(m2[1], 10); if (term) return `(1) ${term}-yr`; }
  console.warn(`[comps:renewal-options] unrecognized shape, passed through: ${JSON.stringify(s)}`);
  return value;
}

// ── W3.6b — attach the cap ENGINE's income to sold comps ────────────────────
// The review producer used to divide PRICE into the stale properties value
// (gov: properties.noi @ estimated_comp_ratio; dia: annual_rent), flagging
// cap_mismatch even when the authoritative cap engine already reconciled the
// deal to its reliable cap. This enriches each sold comp with the ENGINE income
// — gov_compute_cap_rate's NOI / dia_compute_cap_rate's net rent, the SAME source
// the engine reconciles against (active-lease NOI where available, with its
// provenance) — so computeReviewSignals derives implied_cap from it and only
// GENUINE conflicts flag. One batched RPC per domain; best-effort — any failure
// leaves the comp on its fallback basis (unchanged behavior). Sets
// c.engine_income / c.engine_income_source / c.engine_income_confidence /
// c.engine_cap on each matched sold comp.
export async function attachEngineIncome(comps, deps) {
  if (!Array.isArray(comps) || !comps.length || !deps) return { gov: 0, dia: 0, errors: [] };
  const govItems = [], diaItems = [];
  const govBySale = new Map(), diaBySale = new Map();
  for (const c of comps) {
    if (!c || c.comp_type !== 'sale' || c.on_market === true) continue;
    const raw = c.raw || {};
    const price = _reviewNum(c.sale_price);
    const pid = raw.property_id != null ? Number(raw.property_id) : NaN;
    const saleId = raw.sale_id != null ? String(raw.sale_id) : null;
    if (!price || !Number.isFinite(pid) || !saleId) continue;
    const item = { sale_id: saleId, property_id: pid, price, as_of: c.sale_date || null };
    const isGov = c.is_government === true || String(c.vertical || '').toLowerCase() === 'government';
    if (isGov) { govItems.push(item); govBySale.set(saleId, c); }
    else       { diaItems.push(item); diaBySale.set(saleId, c); }
  }
  const jobs = [], errors = [];
  if (govItems.length && typeof deps.govQuery === 'function')
    jobs.push(_applyEngineBatch(deps.govQuery, 'rpc/gov_engine_noi_batch', govItems, govBySale)
      .catch(e => errors.push({ domain: 'government', error: String(e && e.message || e) })));
  if (diaItems.length && typeof deps.diaQuery === 'function')
    jobs.push(_applyEngineBatch(deps.diaQuery, 'rpc/dia_engine_rent_batch', diaItems, diaBySale)
      .catch(e => errors.push({ domain: 'dialysis', error: String(e && e.message || e) })));
  await Promise.all(jobs);
  if (errors.length) console.warn(`[comps:engine-income] enrich errors: ${JSON.stringify(errors)}`);
  return { gov: govItems.length, dia: diaItems.length, errors };
}

// One batched engine-income RPC call → map the results back onto the comps by
// sale_id. The RPC returns a uniform shape { sale_id, engine_income, engine_cap,
// income_source, income_confidence } (gov: engine_income = NOI; dia: net rent).
async function _applyEngineBatch(q, path, items, bySale) {
  const res = await q('POST', path, { p_items: items }, 'return=representation');
  if (!res || !res.ok || !Array.isArray(res.data)) return;
  for (const row of res.data) {
    const c = bySale.get(String(row.sale_id));
    if (!c) continue;
    const inc = Number(row.engine_income);
    if (Number.isFinite(inc) && inc > 0) {
      c.engine_income = inc;
      c.engine_income_source = row.income_source || null;
      c.engine_income_confidence = row.income_confidence || null;
      c.engine_cap = (row.engine_cap != null && Number.isFinite(Number(row.engine_cap)))
        ? Number(row.engine_cap) : null;
    }
  }
}

// Enqueue flagged sold comps into the per-domain review queue (dia_comp_review_queue
// / gov_comp_review_queue). Best-effort: a write failure NEVER breaks comp
// generation. Upsert on (sale_id, flags_hash) so re-pulls don't duplicate.
export async function enqueueReviewQueue(flagged, deps) {
  if (!flagged || !flagged.length) return { enqueued: 0, errors: [] };
  const byDomain = { dialysis: [], government: [] };
  for (const c of flagged) {
    const raw = c.raw || {};
    const saleId = raw.sale_id;
    if (saleId == null) continue;                       // no source row → nothing to correct
    const isGov = c.is_government === true || String(c.vertical || '').toLowerCase() === 'government';
    const flags = (c.review_flags || []).slice().sort();
    const detail = c.review_detail || {};
    const row = {
      sale_id: String(saleId),
      property_id: raw.property_id != null ? String(raw.property_id) : null,
      comp_id: c.comp_id || null,
      flags,
      flags_hash: flags.join(','),
      detail,
      implied_cap: detail.implied_cap ?? null,
      reliable_cap: detail.reliable_cap ?? null,
      address: c.address || null,
      city: c.city || null,
      state: c.state || null,
      tenant: c.tenant || null,
      sale_date: c.sale_date || null,
      sale_price: _reviewNum(c.sale_price),
      // NOTE: `status` is intentionally NOT sent — on first insert it defaults to
      // 'open'; on an upsert (re-pull) it is preserved, so a human's resolved/
      // dismissed disposition survives. The refreshed numbers (detail/caps) do update.
    };
    (isGov ? byDomain.government : byDomain.dialysis).push(row);
  }
  const errors = []; let enqueued = 0;
  const targets = [
    { rows: byDomain.dialysis, q: deps.diaQuery, table: 'dia_comp_review_queue', dom: 'dialysis' },
    { rows: byDomain.government, q: deps.govQuery, table: 'gov_comp_review_queue', dom: 'government' },
  ];
  for (const t of targets) {
    if (!t.rows.length || typeof t.q !== 'function') continue;
    try {
      const res = await t.q('POST', `${t.table}?on_conflict=sale_id,flags_hash`, t.rows,
        'resolution=merge-duplicates,return=minimal');
      if (res && res.ok) enqueued += t.rows.length;
      else errors.push({ domain: t.dom, status: res && res.status, detail: res && res.data });
    } catch (e) {
      errors.push({ domain: t.dom, error: String(e && e.message || e) });
    }
  }
  if (errors.length) console.warn(`[comps:review-queue] enqueue errors: ${JSON.stringify(errors)}`);
  return { enqueued, errors };
}

// ── Comp-review DRAIN — list + resolve the flagged-comp review queues ────────
// enqueueReviewQueue() (above) is the PRODUCER: it writes flagged sold comps to
// dia_comp_review_queue / gov_comp_review_queue with status='open' on first
// insert (preserved on re-pull). Until W3.4 there was no CONSUMER — the queues
// were orphaned (86 dia + 96 gov open, never worked). These two cores are the
// drain: a human (Claude MCP / Copilot HTTP / the Decision-Center lane) LISTS
// the open reviews and RESOLVES each one, writing the disposition to the
// existing status/resolved_at/resolution_note columns. The comps engine already
// preserves human status on re-pull, so a resolved row won't re-open.
const _COMP_REVIEW_TABLES = {
  dialysis:   { q: 'diaQuery', table: 'dia_comp_review_queue' },
  government: { q: 'govQuery', table: 'gov_comp_review_queue' },
};
function _compReviewDomain(d) {
  const s = String(d || '').toLowerCase();
  if (s === 'dia' || s === 'dialysis') return 'dialysis';
  if (s === 'gov' || s === 'government') return 'government';
  return null;
}
const _COMP_REVIEW_SELECT =
  'id,sale_id,property_id,comp_id,flags,detail,implied_cap,reliable_cap,address,city,state,tenant,sale_date,sale_price,status,first_flagged_at,last_flagged_at,resolved_at,resolution_note';

// List open (or any-status) comp reviews across both domain queues, newest-flagged
// first. Returns a unified, domain-tagged list + per-domain counts.
export async function runListCompReviews(args, deps) {
  const status = args.status || 'open';                     // 'open' | 'resolved' | 'dismissed' | 'all'
  const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 500);
  const only = _compReviewDomain(args.domain);              // null → both
  const targets = Object.entries(_COMP_REVIEW_TABLES)
    .filter(([dom]) => !only || dom === only)
    .map(([dom, cfg]) => ({ dom, ...cfg }));
  const items = []; const counts = {}; const errors = [];
  for (const t of targets) {
    const q = deps[t.q];
    if (typeof q !== 'function') { errors.push({ domain: t.dom, error: `${t.q} not configured` }); continue; }
    let path = `${t.table}?select=${_COMP_REVIEW_SELECT}&order=first_flagged_at.desc&limit=${limit}`;
    if (status !== 'all') path += `&status=eq.${encodeURIComponent(status)}`;
    try {
      const res = await q('GET', path, undefined, 'count=exact');
      const rows = Array.isArray(res && res.data) ? res.data : [];
      counts[t.dom] = (res && typeof res.count === 'number') ? res.count : rows.length;
      for (const r of rows) items.push({ domain: t.dom === 'government' ? 'gov' : 'dia', ...r });
    } catch (e) { errors.push({ domain: t.dom, error: String(e && e.message || e) }); }
  }
  // Interleave newest-first across domains, then cap.
  items.sort((a, b) => String(b.first_flagged_at || '').localeCompare(String(a.first_flagged_at || '')));
  return { items: items.slice(0, limit), counts, total: items.length, errors };
}

// Resolve one comp review: set status ('resolved' fixed at source, or 'dismissed'
// = not a real problem) + resolved_at + resolution_note. Fill-only on the
// disposition columns; never touches the flagged comp's values.
export async function runResolveCompReview(args, deps) {
  const dom = _compReviewDomain(args.domain);
  if (!dom) return { ok: false, error: `unknown domain ${JSON.stringify(args.domain)} (use dia|gov)` };
  const id = args.id != null ? String(args.id) : null;
  if (!id) return { ok: false, error: 'id required' };
  const disposition = String(args.disposition || 'resolved').toLowerCase();
  if (!['resolved', 'dismissed', 'open'].includes(disposition))
    return { ok: false, error: `disposition must be resolved|dismissed|open, got ${disposition}` };
  const cfg = _COMP_REVIEW_TABLES[dom];
  const q = deps[cfg.q];
  if (typeof q !== 'function') return { ok: false, error: `${cfg.q} not configured` };
  const patch = {
    status: disposition,
    resolved_at: disposition === 'open' ? null : new Date().toISOString(),
    resolution_note: args.note != null ? String(args.note).slice(0, 2000) : null,
  };
  try {
    const res = await q('PATCH', `${cfg.table}?id=eq.${encodeURIComponent(id)}`, patch,
      'return=representation');
    const ok = !!(res && res.ok);
    const row = ok && Array.isArray(res.data) && res.data[0] ? res.data[0] : null;
    if (!ok) return { ok: false, error: `PATCH failed (HTTP ${res && res.status})`, detail: res && res.data };
    if (!row) return { ok: false, error: `no comp review with id ${id} in ${cfg.table}` };
    return { ok: true, domain: args.domain, id, status: row.status, resolved_at: row.resolved_at };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

// Compact markdown for the MCP surface (Claude).
export function formatCompReviewsMarkdown(result) {
  const rows = result.items || [];
  const cnt = Object.entries(result.counts || {}).map(([k, v]) => `${v} ${k === 'government' ? 'gov' : 'dia'}`).join(', ');
  if (!rows.length) return `No open comp reviews. (${cnt || '0'})`;
  const head = '| Domain | id | Address | City | ST | Tenant | Flags | Implied cap | Reliable cap | Flagged |\n|---|---|---|---|---|---|---|---|---|---|';
  const pct = v => (v == null ? '—' : (Number(v) * 100).toFixed(2) + '%');
  const body = rows.map(r => `| ${r.domain} | ${r.id} | ${r.address || '—'} | ${r.city || '—'} | ${r.state || '—'} | ${r.tenant || '—'} | ${(r.flags || []).join(', ')} | ${pct(r.implied_cap)} | ${pct(r.reliable_cap)} | ${String(r.first_flagged_at || '').slice(0, 10)} |`).join('\n');
  return `${head}\n${body}\n\n_${rows.length} open comp reviews (${cnt}). Resolve with resolve_comp_review {domain,id,disposition:'resolved'|'dismissed',note}._`;
}

// ── THE SHARED CORE — every surface calls this ──────────────────────────────
// deps = { govQuery, diaQuery } (the server's PostgREST fetch helpers).
export async function runComps(args, deps) {
  const parsed = args.request ? parseRequest(args.request) : {};
  args = {
    ...args,
    comp_type: args.comp_type || parsed.comp_type,
    states: (args.states && args.states.length) ? args.states : parsed.states,
    metros: (args.metros && args.metros.length) ? args.metros : parsed.metros,
    property_types: (args.property_types && args.property_types.length) ? args.property_types : parsed.property_types,
    tenant: (args.tenant !== undefined) ? args.tenant : parsed.tenant,
    tenants: (args.tenants && args.tenants.length) ? args.tenants : parsed.tenants,
    subject: args.subject || parsed.subject,
    appraisal_mode: (args.appraisal_mode != null) ? args.appraisal_mode : parsed.appraisal_mode,
    government_only: (args.government_only != null) ? args.government_only : parsed.government_only,
    include_on_market: (args.include_on_market != null) ? args.include_on_market : parsed.include_on_market,
    include_unreliable_noi: (args.include_unreliable_noi != null) ? args.include_unreliable_noi : parsed.include_unreliable_noi,
  };
  const QUERY = { government: deps.govQuery, dialysis: deps.diaQuery };
  const queryArgs = queryScopeArgs(args);
  const params = argsToParams(queryArgs);
  const targets = args.verticals || ['government', 'dialysis'];
  const fetchBatch = async (batchParams, label) => {
    const settled = await Promise.allSettled(targets.map(async v => {
      const q = QUERY[v]; if (!q) throw new Error(`unknown vertical ${v}`);
      const res = await q('POST', 'rpc/rpc_query_comps', batchParams);
      if (!res.ok) throw new Error(`${v}: HTTP ${res.status}`);
      return Array.isArray(res.data) ? res.data : [];
    }));
    return { label, settled };
  };
  const batches = [await fetchBatch(params, 'primary')];
  const rows = [], warnings = [];
  for (const batch of batches) {
    batch.settled.forEach((s, i) => s.status === 'fulfilled'
      ? rows.push(...s.value)
      : warnings.push({ vertical: targets[i], scope: batch.label, error: String(s.reason?.message || s.reason) }));
  }
  if (appraisalSubjectAnchor(args) && dedupe(rows).length < params.p_limit && (params.p_states || params.p_metros)) {
    const fallbackParams = argsToParams({ ...queryArgs, states: null, metros: null, limit: params.p_limit });
    const fallback = await fetchBatch(fallbackParams, 'national_fallback');
    fallback.settled.forEach((s, i) => s.status === 'fulfilled'
      ? rows.push(...s.value)
      : warnings.push({ vertical: targets[i], scope: fallback.label, error: String(s.reason?.message || s.reason) }));
  }
  const merged = dedupe(rows);
  // Normalize the `use` tag + apply the multi-tenant display name on every comp,
  // and standardize renewal-options text so every surface emits "(N) M-yr".
  for (const c of merged) {
    c.use = normalizeUse(c);
    const dn = displayName(c, { property_types: args.property_types, government_only: params.p_government_only });
    if (dn) { c.tenant = dn; if (c.agency != null) c.agency = dn; }
    if (c.renewal_options != null) c.renewal_options = normalizeRenewalOptions(c.renewal_options);
  }
  // Government post-filter: when government_only, drop any non-government comp that slipped
  // through from a co-queried vertical (belt-and-suspenders to the vertical restriction).
  let kept = params.p_government_only ? merged.filter(c => c.is_government !== false) : merged;
  const subjectExcluded = kept.filter(c => isSubjectComp(c, args)).length;
  if (subjectExcluded) kept = kept.filter(c => !isSubjectComp(c, args));
  kept = applyLocalScope(kept, localScopeArgs(args));
  // Reliability gate (Team Briggs policy): by default include only comps whose NOI/cap is
  // reliable; exclude pure benchmark-modeled NOI, implausible caps, and no-NOI/no-cap comps.
  const before = kept.length;
  if (!args.include_unreliable_noi) kept = kept.filter(noiIsReliable);
  const cap = params.p_limit;
  const comps = kept.slice(0, cap);
  // Reconciliation: flag SOLD comps whose displayed rent doesn't reconcile to
  // their reliable cap (or whose rent sources / sale-vs-ask diverge). Attach the
  // signal to the comp (non-destructive) and route the flagged set to the domain
  // review queue for source correction. Best-effort — never breaks generation.
  // W3.6b — enrich sold comps with the cap ENGINE's income (NOI / net rent) so
  // computeReviewSignals divides PRICE into the reconciled active-lease figure,
  // not a stale properties value. Best-effort — a failure leaves the fallback.
  try { await attachEngineIncome(comps, deps); } catch { /* falls back to properties basis */ }
  const flagged = [];
  for (const c of comps) {
    if (c.comp_type !== 'sale' || c.on_market === true || !_reviewNum(c.sale_price)) continue;
    const sig = computeReviewSignals(c);
    if (sig) { c.review_flags = sig.review_flags; c.review_detail = sig.review_detail; flagged.push(c); }
  }
  if (flagged.length) { try { await enqueueReviewQueue(flagged, deps); } catch { /* best-effort */ } }
  const outComps = comps.map(compactComp);
  return { comps: outComps,
    template_comps: outComps.map(c => c.template),
    meta: { returned: comps.length, total_before_cap: kept.length,
            truncated: kept.length > cap, excluded_unreliable_noi: before - kept.length,
            excluded_subject: subjectExcluded,
            by_source: comps.reduce((m, r) => (m[r.source] = (m[r.source] || 0) + 1, m), {}),
            flagged_for_review: flagged.length,
            review_flags: flagged.map(c => ({
              comp_id: c.comp_id, address: c.address, city: c.city, state: c.state,
              tenant: c.tenant, sale_date: c.sale_date, flags: c.review_flags,
              ...c.review_detail })),
            warnings, interpreted_params: { ...params,
              p_candidate_scope: appraisalSubjectAnchor(args) ? 'subject_state_region_then_national_fallback' : 'hard_filters',
              tenants: args.tenants || args.tenant_list || null, appraisal_mode: !!args.appraisal_mode } } };
}

function summarizeComps(scored, eff, meta) {
  const rows = scored || [];
  const caps = rows.map(c => Number(c.cap_rate)).filter(n => Number.isFinite(n) && n > 0);
  const medianCap = caps.length ? caps.slice().sort((a, b) => a - b)[Math.floor(caps.length / 2)] : null;
  const weighted = rows.reduce((acc, c) => {
    const cap = Number(c.cap_rate), price = Number(c.sale_price);
    if (Number.isFinite(cap) && Number.isFinite(price) && price > 0) {
      acc.num += cap * price; acc.den += price;
    }
    return acc;
  }, { num: 0, den: 0 });
  const fl = rows.filter(c => c.state === 'FL').length;
  const tiers = rows.reduce((m, r) => (m[r.score_tier || 'C'] = (m[r.score_tier || 'C'] || 0) + 1, m), {});
  const capText = caps.length
    ? `${(Math.min(...caps) * 100).toFixed(2)}%-${(Math.max(...caps) * 100).toFixed(2)}% cap range; median ${(medianCap * 100).toFixed(2)}%${weighted.den ? `; weighted average ${(weighted.num / weighted.den * 100).toFixed(2)}%` : ''}`
    : 'cap-rate range not on file';
  const subjectName = eff.subject?.name || 'the subject';
  return `Methodology: ${rows.length} ${eff.property_types?.includes('dialysis') ? 'dialysis ' : ''}comps ranked by subject similarity for ${subjectName}, weighting same metro/state first, then regional/national support, tenant credit, size/chair scale, cap proximity, and recency. The set shows ${capText}. ${fl ? `${fl} Florida comps are included; ` : ''}score tiers: A=${tiers.A || 0}, B=${tiers.B || 0}, C=${tiers.C || 0}. Review flags are retained from the cap/rent reconciliation engine; missing subject fields remain "Not on file."`;
}

function transparencyLine(meta) {
  const returned = meta?.returned ?? 0;
  const total = meta?.candidate_total ?? meta?.total_before_cap ?? returned;
  const excluded = meta?.excluded_unreliable_noi || 0;
  const parts = [`returned ${returned} of ${total}`];
  if (excluded) parts.push(`${excluded} excluded as estimated-NOI (say "include estimated NOI" to include)`);
  if (meta?.truncated) parts.push('truncated after similarity ranking');
  return parts.join('; ');
}

export async function runSynthesize(args, deps) {
  // Parse the raw request server-side, then let any explicit args override.
  const p = args.request ? parseRequest(args.request) : {};
  const eff = {
    ...args,
    comp_type:         args.comp_type || p.comp_type,
    states:            (args.states && args.states.length) ? args.states : p.states,
    metros:            (args.metros && args.metros.length) ? args.metros : p.metros,
    property_types:    (args.property_types && args.property_types.length) ? args.property_types : p.property_types,
    government_only:   (args.government_only != null) ? args.government_only : p.government_only,
    date_from:         args.date_from || p.date_from,
    include_on_market: (args.include_on_market != null) ? args.include_on_market : p.include_on_market,
    include_unreliable_noi: (args.include_unreliable_noi != null) ? args.include_unreliable_noi : p.include_unreliable_noi,
    tenant:            (args.tenant !== undefined) ? args.tenant : p.tenant,
    tenants:           (args.tenants && args.tenants.length) ? args.tenants : p.tenants,
    subject:           args.subject || p.subject,
    appraisal_mode:    (args.appraisal_mode != null) ? args.appraisal_mode : p.appraisal_mode,
  };
  const route = routeIntent(eff);
  if (eff.appraisal_mode) {
    eff.include_unreliable_noi = eff.include_unreliable_noi !== false;
    eff.include_on_market = eff.include_on_market !== false;
    eff.comp_type = eff.comp_type || 'both';
    if (!eff.tenants?.length && !eff.tenant) eff.tenant = null;
  }
  const requestedLimit = clampLimit(eff.limit, eff.appraisal_mode ? DEFAULT_APPRAISAL_LIMIT : DEFAULT_SYNTHESIZE_LIMIT, MAX_SYNTHESIZE_LIMIT);
  const candidateLimit = eff.appraisal_mode ? APPRAISAL_CANDIDATE_LIMIT : requestedLimit;
  const { comps, meta, template_comps } = await runComps({ ...eff, verticals: route.verticals,
    government_only: route.government_only, limit: candidateLimit }, deps);
  const tierRank = { A: 3, B: 2, C: 1 };
  const scored = comps.map(c => ({ ...c, _score: scoreComp(c, eff) }))
    .sort((x, y) => ((tierRank[scoreTier(y._score)] || 0) - (tierRank[scoreTier(x._score)] || 0) || y._score - x._score
      || String(x.sale_date || '').localeCompare(String(y.sale_date || '')) || String(x.comp_id || '').localeCompare(String(y.comp_id || ''))))
    .map(c => ({ ...c, score_tier: scoreTier(c._score),
      template: { ...(c.template || templateRow(c)), score_tier: scoreTier(c._score) } }))
    .slice(0, requestedLimit);
  const synthMeta = { ...meta, returned: scored.length, candidate_total: comps.length,
    truncated: meta.truncated || comps.length > scored.length };
  return { interpreted_query: {
      comp_type: eff.comp_type || 'sale', property_types: eff.property_types || null,
      states: eff.states || null, metros: eff.metros || null, date_from: eff.date_from || null,
      tenant: eff.tenant || null, tenants: eff.tenants || null, appraisal_mode: !!eff.appraisal_mode,
      include_unreliable_noi: !!eff.include_unreliable_noi, include_on_market: !!eff.include_on_market,
      government_only: route.government_only, verticals: route.verticals },
    subject: eff.subject || null,
    summary: summarizeComps(scored, eff, synthMeta),
    transparency: transparencyLine(synthMeta),
    comps: scored,
    template_comps: scored.map(c => c.template || templateRow(c)),
    meta: { ...synthMeta,
      by_source: scored.reduce((m, r) => (m[r.source] = (m[r.source] || 0) + 1, m), {}),
      flagged_for_review: scored.filter(c => c.review_flags && c.review_flags.length).length,
      review_flags: scored.filter(c => c.review_flags && c.review_flags.length).map(c => ({
        comp_id: c.comp_id, address: c.address, city: c.city, state: c.state,
        tenant: c.tenant, sale_date: c.sale_date, flags: c.review_flags, ...c.review_detail })),
      warnings: meta.warnings } };
}

// ── Shared renderer — the ONE table format every surface shows ──────────────
export function formatCompsMarkdown(result) {
  const rows = result.comps || [];
  if (!rows.length) return `No comps matched. ${result.meta?.warnings?.length ? '(warnings: ' + JSON.stringify(result.meta.warnings) + ')' : ''}`.trim();
  const pct = v => (v == null ? '—' : (v * 100).toFixed(2) + '%');
  const usd = v => (v == null ? '—' : '$' + Number(v).toLocaleString());
  // Chairs/Patients shown right after SF (RBA) — populated for dialysis comps, '—' elsewhere.
  const anyDialysis = rows.some(c => c.vertical === 'dialysis' || c.chairs != null || c.patient_count != null);
  const nn = v => (v == null ? '—' : Number(v).toLocaleString());
  const head = anyDialysis
    ? '| Source | Tenant | Address | City | ST | SF | Chairs | Patients | Price | Cap | $/SF | Sale date |\n|---|---|---|---|---|---|---|---|---|---|---|---|'
    : '| Source | Tenant | Address | City | ST | SF | Price | Cap | $/SF | Sale date |\n|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map(c => {
    const base = `| ${c.source} | ${c.tenant || '—'} | ${c.address || '—'} | ${c.city || '—'} | ${c.state || '—'} | ${c.building_sf ? Number(c.building_sf).toLocaleString() : '—'} |`;
    const dial = anyDialysis ? ` ${nn(c.chairs)} | ${nn(c.patient_count)} |` : '';
    return `${base}${dial} ${c.price_withheld ? 'withheld' : usd(c.sale_price)} | ${pct(c.cap_rate)} | ${usd(c.price_per_sf)} | ${c.sale_date || '—'} |`;
  }).join('\n');
  const bySrc = Object.entries(result.meta?.by_source || {}).map(([k, v]) => `${v} ${k}`).join(', ');
  const flaggedN = result.meta?.flagged_for_review || 0;
  const flaggedLine = flaggedN ? `\n\n⚠ ${flaggedN} comp${flaggedN === 1 ? '' : 's'} flagged for review (cap/rent reconciliation) — see meta.review_flags.` : '';
  return `${head}\n${body}\n\n_${rows.length} comps (${bySrc})._${flaggedLine}`;
}

// ── Surface 1: MCP tools (Claude) ───────────────────────────────────────────
export function makeCompsTools({ govQuery, diaQuery, textResult, withTiming }) {
  const deps = { govQuery, diaQuery };
  const defs = {
    query_comps: {
      name: 'query_comps',
      description: "Pull sales comps on demand across the dialysis DB, government DB, and Salesforce-staged comps, normalized to one shape and de-duplicated. Canonical closed sales are gated to transaction_state='live'; Salesforce comps come from sf_comp_staging. property_types accepts plain terms (medical, office, retail, industrial, dialysis, government) expanded to source synonyms. Cap rates returned as decimals; confidential $0 sales flagged price_withheld. By default only comps with a reliable NOI/cap are returned (human-sourced, or a NOI rolled from a prior NOI with captured escalations); pass include_unreliable_noi:true to also include modeled-NOI / no-NOI comps.",
      inputSchema: { type: 'object', properties: {
        request: { type: 'string', description: 'Optional natural-language request parsed server-side before explicit fields are applied.' },
        comp_type: { type: 'string', enum: ['sale', 'lease', 'both'] },
        verticals: { type: 'array', items: { type: 'string', enum: ['government', 'dialysis'] } },
        property_types: { type: 'array', items: { type: 'string' } },
        states: { type: 'array', items: { type: 'string' } },
        metros: { type: 'array', items: { type: 'string' } },
        date_from: { type: 'string' }, date_to: { type: 'string' },
        size_min_sf: { type: 'number' }, size_max_sf: { type: 'number' },
        government_only: { type: 'boolean' },
        include_salesforce: { type: 'boolean' },
        include_on_market: { type: 'boolean' },
        include_unreliable_noi: { type: 'boolean' },
        tenant: { type: 'string', description: 'Single operator/tenant scope, e.g. DaVita, Fresenius, US Renal.' },
        tenants: { type: 'array', items: { type: 'string' }, description: 'Multiple operators/tenants; avoids one comma-separated tenant blob.' },
        limit: { type: 'number', description: 'Default 40, max 100.' },
      } },
    },
    synthesize_comps: {
      name: 'synthesize_comps',
      description: "Assemble one ranked, de-duplicated comp set from every relevant source for a plain-language request. Parse the request into the structured fields (property_types, states, comp_type, date window, size) and pass them; optionally include the original text as `request` for government-intent routing. Returns comps scored by relevance, ready for the briggs-comps template. By default excludes comps whose NOI/cap isn't reliable; the user can say 'including estimated NOI' (or pass include_unreliable_noi:true) to include them. Multi-tenant comps are named as abbrev + anchor tenant, e.g. 'MOB (VA)'.",
      inputSchema: { type: 'object', properties: {
        request: { type: 'string' },
        comp_type: { type: 'string', enum: ['sale', 'lease', 'both'] },
        property_types: { type: 'array', items: { type: 'string' } },
        states: { type: 'array', items: { type: 'string' } },
        metros: { type: 'array', items: { type: 'string' } },
        date_from: { type: 'string' }, date_to: { type: 'string' },
        size_min_sf: { type: 'number' }, size_max_sf: { type: 'number' },
        government_only: { type: 'boolean' }, include_on_market: { type: 'boolean' }, include_unreliable_noi: { type: 'boolean' },
        tenant: { type: 'string', description: 'Single operator/tenant scope, e.g. DaVita, Fresenius, US Renal.' },
        tenants: { type: 'array', items: { type: 'string' }, description: 'Multiple operators/tenants; avoids one comma-separated tenant blob.' },
        limit: { type: 'number', description: 'Default 25, max 50.' },
      } },
    },
    list_comp_reviews: {
      name: 'list_comp_reviews',
      description: "List flagged sold comps awaiting human review in the dialysis + government comp-review queues (dia_comp_review_queue / gov_comp_review_queue). These are comps whose displayed rent doesn't reconcile to their reliable cap (cap_mismatch / rent_disagreement / price_over_ask / no_reliable_cap) — routed here for SOURCE correction, never silently shipped. Defaults to open items across both domains, newest-flagged first. Resolve each with resolve_comp_review.",
      inputSchema: { type: 'object', properties: {
        domain: { type: 'string', enum: ['dia', 'gov', 'dialysis', 'government'], description: 'limit to one domain; omit for both' },
        status: { type: 'string', enum: ['open', 'resolved', 'dismissed', 'all'], description: "default 'open'" },
        limit: { type: 'number' },
      } },
    },
    resolve_comp_review: {
      name: 'resolve_comp_review',
      description: "Record a disposition on one flagged comp review. disposition='resolved' (the source cap/rent was corrected) or 'dismissed' (reviewed — not a real problem); 'open' re-opens. Writes status + resolved_at + resolution_note to the queue row; the comps engine preserves this on re-pull so it won't re-open. Get {domain,id} from list_comp_reviews.",
      inputSchema: { type: 'object', properties: {
        domain: { type: 'string', enum: ['dia', 'gov', 'dialysis', 'government'] },
        id: { type: ['number', 'string'], description: 'the comp-review row id' },
        disposition: { type: 'string', enum: ['resolved', 'dismissed', 'open'] },
        note: { type: 'string', description: 'optional resolution note' },
      }, required: ['domain', 'id'] },
    },
  };
  const handlers = {
    query_comps: (args) => withTiming('query_comps', async () => {
      const result = await runComps(args || {}, deps);
      return textResult({ ...result, markdown: formatCompsMarkdown(result) });
    }),
    synthesize_comps: (args) => withTiming('synthesize_comps', async () => {
      const result = await runSynthesize(args || {}, deps);
      return textResult({ ...result, markdown: formatCompsMarkdown(result) });
    }),
    list_comp_reviews: (args) => withTiming('list_comp_reviews', async () => {
      const result = await runListCompReviews(args || {}, deps);
      return textResult({ ...result, markdown: formatCompReviewsMarkdown(result) });
    }),
    resolve_comp_review: (args) => withTiming('resolve_comp_review', async () => {
      const result = await runResolveCompReview(args || {}, deps);
      return textResult(result);
    }),
  };
  return { defs, handlers };
}

// ── Surfaces 2 & 3: HTTP routes (Copilot Studio + ChatGPT GPT Actions) ──────
// Returns Express handlers. Mount behind the server's `authenticate` middleware.
// The comps response is limit-bounded (query ≤500 / synthesize ≤300 rows) and
// value-ranked, so it is usually well under the ChatGPT Action / Copilot cap —
// but a wide result with full `raw` provenance on every row can exceed it, so
// the HTTP responses pass through enforceHttpResponseSize as a final safety net
// (byte-identical under the ceiling; over it, the array tail is trimmed and the
// response is stamped `truncated`). The MCP tools (makeCompsTools above) are NOT
// bounded — Claude keeps full fidelity.
export function makeCompsHttpRoutes({ govQuery, diaQuery }) {
  const deps = { govQuery, diaQuery };
  return {
    queryComps: async (req, res) => {
      try {
        const result = await runComps(req.body || {}, deps);
        res.json(enforceHttpResponseSize({ ...result, markdown: formatCompsMarkdown(result) }));
      } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
    },
    synthesizeComps: async (req, res) => {
      try {
        const result = await runSynthesize(req.body || {}, deps);
        res.json(enforceHttpResponseSize({ ...result, markdown: formatCompsMarkdown(result) }));
      } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
    },
    // GET /api/comp-reviews?domain=&status=&limit= — list the flagged-comp drain.
    listCompReviews: async (req, res) => {
      try {
        const args = { ...(req.query || {}), ...(req.body || {}) };
        const result = await runListCompReviews(args, deps);
        res.json(enforceHttpResponseSize(result));
      } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
    },
    // POST /api/comp-reviews/resolve {domain,id,disposition,note} — record disposition.
    resolveCompReview: async (req, res) => {
      try {
        const result = await runResolveCompReview(req.body || {}, deps);
        res.status(result.ok ? 200 : 400).json(result);
      } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
    },
  };
}
