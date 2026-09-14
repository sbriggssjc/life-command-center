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
const DEFAULT_APPRAISAL_LIMIT = 25;
const MAX_QUERY_LIMIT = 100;
const MAX_SYNTHESIZE_LIMIT = 50;
// Appraisal mode pulls a NATIONAL candidate universe, so the per-vertical RPC limit must be
// large enough to cover a national dialysis candidate set (not just a state/region slice).
const APPRAISAL_CANDIDATE_LIMIT = 300;
const MAX_APPRAISAL_CANDIDATE_LIMIT = 500;
// Appraisal mode pulls a national on-market universe (can be 150+ listings) but the
// workbook On Market grid is a curated ~20 most-aligned set, ranked the same way as
// Sold — never the whole universe (a 174-row dump overflows the 100-row template and
// reads as noise, not a curated comp set). Prompt 46 item 3.
const APPRAISAL_ON_MARKET_CAP = 20;
const APPRAISAL_ERROR_CAP_LOW = 0.04;
const APPRAISAL_ERROR_CAP_HIGH = 0.12;
// Prompt 52 — appraisal cap policy (per Scott): comps within ~35 bps of the subject
// target cap, and the SET AVERAGE cap held below the subject. The band is the ±35 bps
// window; the average-below-subject discipline is enforced separately (enforceAvgBelowSubject).
const APPRAISAL_DEFAULT_BAND_LOWER_BPS = 35;
const APPRAISAL_DEFAULT_BAND_UPPER_BPS = 35;
// Trailing-recency coverage target: allow reaching back ~24 months, but a credible
// appraisal set needs a handful of very recent sales (trailing ~9 months).
const APPRAISAL_RECENT_MONTHS = 9;
const APPRAISAL_RECENT_MIN = 3;
// Minimum primary comps to retain when trimming the set to hold the average below subject.
const APPRAISAL_AVG_TRIM_MIN_KEEP = 5;
// Prompt 54 — reliability-or-exclude floor on the DISPLAYED comp: a displayed cap (rent÷price)
// below this, or a dialysis RENT/SF outside the plausible band, indicates a rent/SF/price data
// error and is filtered OUT of the workbook (routed to the review lane), never shown to an
// appraiser. The cap CEILING (subject cap + upper band) is enforced separately, on the same
// displayed basis, so the rows that ship match the summary and the sheet.
const APPRAISAL_MIN_RELIABLE_CAP = 0.045;
const DIALYSIS_RENT_PSF_MIN = 12;
const DIALYSIS_RENT_PSF_MAX = 60;
// Prompt 57 — lease-term discipline floor. A comp supporting a long-term subject must
// carry a real lease term of at least this many years remaining AT THE SALE (sold) / as
// of today (on-market). A comp with NO lease expiration, or a remaining term below this
// floor, is a poor comparable for a ~12-yr-term subject and is excluded from the DISPLAYED
// appraisal set (routed to review / kept for context stats, never deleted). Tunable via
// the `min_remaining_term_years` arg. Scott's stated floor is 3 years.
const APPRAISAL_MIN_REMAINING_TERM_YEARS = 3;

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
function propertyId(c) {
  const raw = c?.raw || {};
  const v = c?.property_id ?? c?.asset_id ?? raw.property_id ?? raw.Property_ID__c ?? raw.propertyId;
  return v == null || v === '' ? null : String(v);
}
function normParty(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function saleMonth(c) {
  const d = String(c?.sale_date || c?.sold_date || c?.date || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(d) ? d : String(c?.sale_date || '').slice(0, 4);
}
function roundedPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.round(n / 1000) * 1000);
}
function saleNotes(c) {
  return String([
    c?.sale_condition, c?.sale_conditions, c?.transaction_type, c?.notes,
    c?.raw?.sale_condition, c?.raw?.sale_conditions, c?.raw?.transaction_type,
    c?.raw?.notes, c?.raw?.sale_notes_raw,
  ].filter(Boolean).join(' ')).toLowerCase();
}
function portfolioAllocatedSale(c) {
  return /portfolio|multi[- ]property|multi property|allocated|allocation|partial interest|partial[- ]interest/.test(saleNotes(c));
}
function dedupeKeys(c) {
  const keys = [normKey(c)];
  const pid = propertyId(c);
  if (!pid) return keys;
  const month = saleMonth(c);
  const buyer = normParty(c?.buyer || c?.buyer_name || c?.raw?.buyer || c?.raw?.buyer_name);
  const price = roundedPrice(c?.sale_price ?? c?.sold_price);
  if (month && (buyer || price)) keys.push(`pid-event|${pid}|${month}|${buyer || ''}|${price || ''}`);
  if (month && portfolioAllocatedSale(c)) keys.push(`pid-portfolio|${pid}|${month}`);
  return keys;
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
// ── Enrichment / bare-record detection (Prompt 51/52 runtime guard) ─────────
// A "bare" property record carries NO financial signal at all — no sale price, no
// cap, no rent/NOI, no ask price — so it surfaces as an empty comp or drops fields.
// Until the Prompt-51 consolidation lands, prefer the enriched record for an address
// and drop the bare duplicate from the comp set.
function _num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function isBareRecord(c) {
  if (!c) return true;
  const t = c.raw || {};
  const financial = _num(c.sale_price) ?? _num(c.sold_price) ?? _num(c.cap_rate)
    ?? _num(c.noi) ?? _num(c.annual_rent) ?? _num(c.engine_income)
    ?? _num(c.cur_price) ?? _num(c.current_price) ?? _num(c.ask_price) ?? _num(c.list_price)
    ?? _num(t.sale_price) ?? _num(t.asking_price) ?? _num(t.cap_rate);
  return financial == null;
}
// Count populated, comp-meaningful fields — higher = more complete/enriched. Used as a
// dedup tiebreaker so the enriched record wins when confidence/price-quality tie.
function compCompleteness(c) {
  if (!c) return 0;
  const t = c.template || {};
  const vals = [
    c.sale_price ?? c.sold_price ?? t.sale_price, c.cap_rate ?? t.cap_rate,
    c.noi ?? c.annual_rent ?? c.engine_income ?? t.annual_noi ?? t.annual_rent,
    c.building_sf ?? c.rba ?? c.building_size ?? t.rba_sf, c.year_built ?? t.year_built,
    c.lease_expiration ?? t.lease_expiration, c.bumps ?? t.bumps, c.buyer, c.seller,
    c.chairs ?? t.chairs, c.cur_price ?? c.list_price ?? c.ask_price ?? t.cur_price,
    c.on_market_date ?? t.on_market, c.tenant ?? c.agency,
  ];
  return vals.reduce((n, v) => n + ((v != null && v !== '') ? 1 : 0), 0);
}
// Normalized street+city+state key for same-address grouping (no sale-year — distinct
// sales at one address are separated by dedupeKeys, not collapsed here).
function addressGroupKey(c) {
  const street = normStreet(c.address);
  if (!street) return null;
  return `${street}|${String(c.city || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${String(c.state || '').toLowerCase()}`;
}
// Drop bare duplicate records: when several records share a normalized address and at
// least one is enriched (non-bare), remove the bare ones (Prompt 52 item 2).
export function dropBareAddressDuplicates(rows) {
  const groups = new Map();
  for (const c of rows) {
    const key = addressGroupKey(c);
    if (!key) continue;                                  // no address → can't group; always kept
    (groups.get(key) || groups.set(key, []).get(key)).push(c);
  }
  const drop = new Set();
  for (const grp of groups.values()) {
    if (grp.length < 2) continue;
    if (!grp.some(c => !isBareRecord(c))) continue;      // no enriched sibling → keep as-is
    for (const c of grp) if (isBareRecord(c)) drop.add(c);
  }
  return drop.size ? rows.filter(c => !drop.has(c)) : rows;
}

export function dedupe(rows) {
  const byId = new Map();
  for (const r of rows) if (r.source_sf_id) byId.set(r.source_sf_id, r);
  const seen = new Map(); const out = [];
  for (const r of rows) {
    if (r.source === 'salesforce' && byId.has(r.source_sf_id) && byId.get(r.source_sf_id).source !== 'salesforce') continue;
    const keys = dedupeKeys(r);
    const matchKey = keys.find(k => seen.has(k));
    if (matchKey) {
      const prev = seen.get(matchKey);
      const better = (r.sale_price && !prev.sale_price)
        || (r.confidence > prev.confidence)
        || (r.confidence === prev.confidence && priceQuality(r) > priceQuality(prev))
        // Prompt 52 — on a full tie, prefer the more-complete/enriched record.
        || (r.confidence === prev.confidence && priceQuality(r) === priceQuality(prev)
            && compCompleteness(r) > compCompleteness(prev));
      if (better) {
        out[out.indexOf(prev)] = r;
        for (const k of uniqueList([...keys, ...dedupeKeys(prev)])) seen.set(k, r);
        r._merged_with = (r._merged_with || []).concat(prev.comp_id);
      }
      else { prev._merged_with = (prev._merged_with || []).concat(r.comp_id); }
      continue;
    }
    for (const k of keys) seen.set(k, r);
    out.push(r);
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
  return !!(args?.appraisal_mode && args.subject
    && (args.subject.state || args.subject.metro || args.subject.name || args.subject.address));
}

// Prompt 49 — a subject that has RESOLVED to a concrete domain property is a
// national, similarity-ranked appraisal anchor even if the appraisal-mode phrase
// wasn't present: the recognized property wins over the metro it sits in, so the
// candidate pull must NOT be narrowed to the subject's own state/metro.
function subjectResolvedToProperty(args) {
  const s = args && args.subject;
  return !!(s && (s.property_id != null || s.resolved_from_record === true));
}
function nationalSubjectAnchor(args) {
  return appraisalSubjectAnchor(args) || subjectResolvedToProperty(args);
}

// state -> region reverse lookup (geography scoring: metro > region > national)
const STATE_TO_REGION = (() => {
  const m = {};
  for (const [region, states] of Object.entries(REGION_STATES)) for (const s of states) m[s] = region;
  return m;
})();

// Operator / credit tier for dialysis: national-credit operators vs independents.
const _MAJOR_OPERATORS = ['davita', 'fresenius', 'fmc', 'us renal', 'usrc', 'american renal'];
function operatorTier(name) {
  const n = normText(name);
  if (!n) return null;
  return _MAJOR_OPERATORS.some(o => n.includes(o)) ? 'major' : 'independent';
}
function compTenantText(c) {
  return normText([c.tenant, c.agency, c.operator, c.anchor_tenant,
    c.raw?.tenant, c.raw?.operator].filter(Boolean).join(' '));
}
function subjectTenantName(subject) {
  const t = subject?.tenant || subject?.operator || subject?.fields?.tenant;
  return (t && !/not on file/i.test(String(t))) ? String(t) : null;
}
// Years of lease term remaining at close for a comp (expiration - sale date).
function termRemainingAtClose(c) {
  const exp = Date.parse(c.lease_expiration || c.expiration_date || c.raw?.lease_expiration || '');
  if (!Number.isFinite(exp)) return null;
  const close = Date.parse(c.sale_date || '');
  const base = Number.isFinite(close) ? close : Date.now();
  const yrs = (exp - base) / 3.15576e10;
  return yrs > 0 ? yrs : null;
}
function subjectRemainingTerm(subject) {
  const t = asNum(subject?.remaining_term ?? subject?.term_remaining ?? subject?.firm_term_remaining
    ?? subject?.fields?.remaining_term);
  return (t && t > 0) ? t : null;
}

function scoreComp(c, a) {
  let s = 0;
  const subject = a.subject || {};
  const appraisal = !!a.appraisal_mode;
  const cState = String(c.state || '').toUpperCase();
  const subjectState = String(subject.state || '').toUpperCase();
  const subjectRegion = subject.region || STATE_TO_REGION[subjectState] || null;

  // ── Aligned market: metro > region > national. Geography is a SCORE weight ONLY — in appraisal
  // mode the candidate universe is national, so a national comp still earns a small baseline and
  // an out-of-region same-operator/same-term comp can out-rank a weak in-state one. ──
  // Prompt 44 doctrine: SIMILARITY OVER OPERATOR IDENTITY. A same-size / same-market /
  // same-term / same-cap comp of a DIFFERENT operator is a better comp than a same-operator
  // comp in a different market or ~4 yrs off on term. So market proximity (metro>region),
  // term-at-close, cap alignment and size are the dominant weights; operator is a minor
  // tiebreaker bonus (below). A metro→region drop (12→6 = 6 pts) alone outweighs the whole
  // same-operator bonus (2 pts).
  if (subject.metro && sameMarket(c, subject.metro)) s += appraisal ? 12 : 8;
  else if (a.metros?.some(m => sameMarket(c, m))) s += 6;
  if (subjectState && cState === subjectState) s += appraisal ? 7 : 6;
  else if (subjectRegion && cState && STATE_TO_REGION[cState] === subjectRegion) s += appraisal ? 6 : 3;
  else if (subjectState === 'FL' && SOUTHEAST_STATES.has(cState)) s += 3;
  else if (a.states?.includes(cState)) s += 3;
  else if (appraisal) s += 1; // national baseline so out-of-region comps stay viable

  // ── Operator / credit: an EXPLICITLY-REQUESTED tenant filter still earns weight (the user
  // asked for it); but the SUBJECT's own operator identity is demoted to a minor tiebreaker
  // in appraisal mode so it can't outrank a clearly-more-similar different-operator comp. ──
  const tenantList = a.tenants || a.tenant_list;
  if (Array.isArray(tenantList) && tenantList.length && tenantListMatches(c, tenantList)) s += 4;
  else if (a.tenant && tenantMatches(c, a.tenant)) s += 4;
  const subjectTenant = subjectTenantName(subject);
  if (appraisal && subjectTenant) {
    if (tenantMatches(c, subjectTenant)) s += 2; // same operator = small tiebreaker bonus only
    else {
      const st = operatorTier(subjectTenant), ct = operatorTier(compTenantText(c));
      if (st && ct && st === ct) s += 1; // same credit tier = smaller nudge
    }
  }

  // Credit the normalized `use` too, so an agency's asset-class doubling (VA -> Medical Office)
  // ranks consistently rather than depending on the raw building_type value.
  if (a.property_types?.some(t => ((c.property_type || '') + ' ' + (c.use || '')).toLowerCase().includes(String(t).toLowerCase()))) s += 3;

  // ── Size (RBA) + chairs proximity — weighted UP (prompt 44): size similarity is a core
  // comp driver, not a minor nudge. A perfect size match now earns 5 pts (was 3). ──
  if (subject.building_sf && (c.building_sf || c.rba)) {
    const ratio = Math.min(Number(c.building_sf || c.rba), Number(subject.building_sf))
      / Math.max(Number(c.building_sf || c.rba), Number(subject.building_sf));
    if (Number.isFinite(ratio)) s += ratio * (appraisal ? 5 : 3);
  }
  if (subject.chairs && c.chairs) {
    const ratio = Math.min(Number(c.chairs), Number(subject.chairs)) / Math.max(Number(c.chairs), Number(subject.chairs));
    if (Number.isFinite(ratio)) s += ratio * (appraisal ? 3 : 2);
  }

  // ── Building age proximity ──
  const subjYear = asNum(subject.year_built ?? subject.built);
  const compYear = asNum(c.year_built ?? c.built ?? c.raw?.year_built);
  if (subjYear && compYear) s += Math.max(0, 3 - Math.abs(subjYear - compYear) / 5);

  // ── Lease term remaining at close proximity — weighted UP (prompt 44). In appraisal mode a
  // full match earns 8 pts and each year of gap costs 1.5 pts, so a ~4 yr term gap costs ~6 pts
  // — materially MORE than the 2 pt same-operator bonus, per Scott's doctrine. ──
  const subjTerm = subjectRemainingTerm(subject), compTerm = termRemainingAtClose(c);
  if (subjTerm && compTerm) s += appraisal
    ? Math.max(0, 8 - 1.5 * Math.abs(subjTerm - compTerm))
    : Math.max(0, 4 - Math.abs(subjTerm - compTerm));

  // ── Bump / escalation structure similarity ──
  if (subject.bumps && c.bumps) {
    const sb = normalizeBumps(subject.bumps), cb = normalizeBumps(c.bumps);
    if (sb && cb && normText(sb) === normText(cb)) s += 2;
  }

  // ── Cap support (keep + strengthen): reward proximity; penalize caps materially above subject ──
  // Prompt 52 — rank on the DISPLAYED cap (rent ÷ price), the same value the workbook shows,
  // not the stored cap_rate field (which is mislabeled on some records, e.g. Woodland Hills
  // 6.62% stored vs 6.00% rent÷price). soldCapForStats derives rent÷price, falling back to
  // the stored cap only when no rent+price is available.
  const displayedCap = soldCapForStats(c);
  if (subject.cap_rate && displayedCap) {
    const spreadBps = Math.abs(Number(displayedCap) - Number(subject.cap_rate)) * 10000;
    // Prompt 44: cap alignment weighted UP (10 pts full match in appraisal mode).
    s += appraisal ? Math.max(0, 10 - (spreadBps / 25)) : Math.max(0, 3 - (spreadBps / 75));
    if (appraisal) {
      const overBps = (Number(displayedCap) - Number(subject.cap_rate)) * 10000;
      if (overBps > 200) s -= 4 + (overBps - 200) / 50; // >~200 bps above subject: escalating penalty
    }
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
  if (!subject) return false;
  // Fire when there is an appraisal subject anchor OR the subject has been resolved to a
  // concrete property_id / record (prompt 47) — the subject's own row (incl. its active
  // listing) must NEVER ship as a comp, in any mode.
  const anchored = appraisalSubjectAnchor(args) || subject.property_id != null || subject.resolved_from_record === true;
  if (!anchored) return false;
  if (sameSubjectId(c, subject)) return true;
  if (subject.address && sameAddress(c, subject.address)) {
    const subjectState = String(subject.state || '').toUpperCase();
    return !subjectState || String(c.state || '').toUpperCase() === subjectState;
  }
  return false;
}

// ── Subject hydration from the resolved property record (prompt 47) ──────────
// The request parser only knows what the TEXT said, so subject SF/chairs/term/
// bumps/cap came back "Not on file" and cap fell back to a gazetteer default.
// When the request names/addresses a subject that resolves UNAMBIGUOUSLY to a
// domain property, hydrate the anchor from that record so (a) similarity scoring
// (prompt 41/44) can weight size/chairs/term/cap and (b) the subject can be
// excluded from the comp set by property_id/address. Fill-blanks only, never
// clobber an explicit user value; conservative/unambiguous — resolve only when
// exactly one property matches, else leave "Not on file" (never guess).
const _STREET_KW = 'st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|cir|circle|pkwy|parkway|hwy|highway|pl|place|ter|terrace|trl|trail|way|route|rte|sq|square';
function extractSubjectAddress(text) {
  const s = String(text || '');
  const re = new RegExp(`\\b(\\d{1,6}\\s+[A-Za-z0-9.'-]+(?:\\s+[A-Za-z0-9.'-]+){0,4}?\\s+(?:${_STREET_KW}))\\b\\.?`, 'i');
  const m = s.match(re);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}
function _yearsFromNow(dateStr) {
  const t = Date.parse(dateStr || '');
  if (!Number.isFinite(t)) return null;
  const yrs = (t - Date.now()) / 3.15576e10;
  return yrs > 0 ? +yrs.toFixed(2) : null;
}
// Canonical "X% / N yrs" bumps from a stored pct (0.10 = 10%) + interval months.
function bumpsFromPctInterval(pct, intervalMo) {
  const p = Number(pct);
  if (!Number.isFinite(p) || p <= 0) return null;
  const pctVal = p <= 1 ? p * 100 : p;             // 0.10 -> 10; tolerate an already-% value
  const pctText = String(+pctVal.toFixed(4));
  const mo = Number(intervalMo);
  const yrs = Number.isFinite(mo) && mo > 0 ? Math.round(mo / 12) : null;
  if (!yrs || yrs === 1) return `${pctText}% / yr`;
  return `${pctText}% / ${yrs} yrs`;
}
function _blankSubjectVal(v) {
  return v == null || v === '' || /not on file/i.test(String(v));
}
async function _subjectPropertyLookup(q, address, select) {
  const enc = v => encodeURIComponent(String(v));
  const variants = [...new Set([address, normStreet(address) ? address : null].filter(Boolean))];
  const found = new Map();
  for (const variant of variants) {
    const r = await q('GET', `properties?address=ilike.*${enc(variant)}*&select=${select}&limit=25`)
      .catch(() => ({ data: [] }));
    for (const p of (r && r.data) || []) if (p && p.property_id != null) found.set(String(p.property_id), p);
  }
  return [...found.values()];
}
function applyHydratedSubject(subject, rec) {
  subject._hydrated = true;
  subject.resolved_from_record = true;
  subject.property_id = subject.property_id ?? rec.property_id;
  subject.resolved_property_id = rec.property_id;
  subject.domain = subject.domain || rec.domain;
  if (_blankSubjectVal(subject.address)) subject.address = rec.address;
  if (_blankSubjectVal(subject.city)) subject.city = rec.city;
  if (_blankSubjectVal(subject.state)) subject.state = rec.state;
  const fields = subject.fields = subject.fields || {};
  const setNum = (key, val, fieldKey) => {
    if (val == null || !Number.isFinite(Number(val))) return;
    if (_blankSubjectVal(subject[key])) subject[key] = Number(val);
    if (fieldKey && _blankSubjectVal(fields[fieldKey])) fields[fieldKey] = Number(val);
  };
  setNum('building_sf', rec.building_sf, 'building_sf');
  setNum('chairs', rec.chairs, 'chairs');
  setNum('year_built', rec.year_built, null);
  setNum('remaining_term', rec.remaining_term, 'remaining_term');
  if (rec.lease_expiration && _blankSubjectVal(subject.lease_expiration)) subject.lease_expiration = rec.lease_expiration;
  if (rec.bumps) {
    if (_blankSubjectVal(subject.bumps)) subject.bumps = rec.bumps;
    // Prompt 49 — mirror into the nested fields block the cover/subject summary renders.
    if (_blankSubjectVal(fields.bumps)) fields.bumps = rec.bumps;
  }
  if (rec.tenant) {
    if (_blankSubjectVal(subject.tenant)) subject.tenant = rec.tenant;
    if (_blankSubjectVal(fields.tenant)) fields.tenant = rec.tenant;
  }
  // Cap: the record's actual cap replaces a gazetteer DEFAULT, but never an
  // explicit user-typed cap (_cap_user) nor a real value already present.
  if (rec.cap_rate != null && Number.isFinite(Number(rec.cap_rate))) {
    // A gazetteer default is flagged _cap_default at the SUBJECT level, but the
    // nested fields.cap_rate carries the raw default NUMBER (0.06) with no flag —
    // so _blankSubjectVal(fields.cap_rate) is false and the nested field kept the
    // 6.00% default even after the top-level cap hydrated to 6.75% (prompt 49 bug).
    // Override the nested field whenever we override the top-level one.
    const capOverridable = !subject._cap_user && (subject.cap_rate == null || subject._cap_default);
    if (capOverridable) {
      subject.cap_rate = Number(rec.cap_rate);
      subject._cap_default = false;
    }
    if (!subject._cap_user && (capOverridable || _blankSubjectVal(fields.cap_rate))) {
      fields.cap_rate = Number(rec.cap_rate);
    }
  }
}
export async function hydrateSubjectFromRecord(args, deps) {
  const subject = args && args.subject;
  if (!subject || subject._hydration_attempted) return subject;
  if (!(appraisalSubjectAnchor(args) || subject.address)) return subject;
  subject._hydration_attempted = true;
  const address = subject.address
    || extractSubjectAddress(args.request)
    || extractSubjectAddress(subject.name);
  if (!address) return subject;
  const enc = v => encodeURIComponent(String(v));
  const domains = [
    { dom: 'dia', q: deps && deps.diaQuery,
      select: 'property_id,address,city,state,tenant,operator,chain_canonical,building_size,total_chairs,year_built,lease_commencement,wavg_lease_expiration,lease_bump_pct,lease_bump_interval_mo' },
    { dom: 'gov', q: deps && deps.govQuery,
      select: 'property_id,address,city,state,agency,rba,sf_leased,year_built,lease_commencement,lease_expiration,wavg_lease_expiration' },
  ];
  const hits = [];
  for (const d of domains) {
    if (typeof d.q !== 'function') continue;
    try {
      const found = await _subjectPropertyLookup(d.q, address, d.select);
      for (const p of found) hits.push({ dom: d.dom, q: d.q, p });
    } catch { /* fail-soft: leave subject as-is */ }
  }
  // Unambiguous only: exactly one property across BOTH domains, else never guess.
  const uniq = [];
  const seen = new Set();
  for (const h of hits) { const k = `${h.dom}:${h.p.property_id}`; if (!seen.has(k)) { seen.add(k); uniq.push(h); } }
  if (uniq.length !== 1) return subject;
  const { dom, q, p } = uniq[0];
  const rec = {
    property_id: p.property_id, domain: dom,
    address: p.address || address, city: p.city || null, state: p.state || null,
    year_built: _reviewNum(p.year_built),
  };
  if (dom === 'dia') {
    rec.building_sf = _reviewNum(p.building_size);
    rec.chairs = _reviewNum(p.total_chairs);
    rec.tenant = p.tenant || p.operator || p.chain_canonical || null;
    rec.bumps = bumpsFromPctInterval(p.lease_bump_pct, p.lease_bump_interval_mo);
  } else {
    rec.building_sf = _reviewNum(p.rba) || _reviewNum(p.sf_leased);
    rec.tenant = p.agency || null;
  }
  // Remaining term (yrs) from the property's weighted expiration, else the latest lease row.
  let expiration = p.wavg_lease_expiration || (dom === 'gov' ? p.lease_expiration : null);
  if (!expiration && dom === 'dia') {
    const lr = await q('GET', `leases?property_id=eq.${enc(p.property_id)}&select=lease_expiration&order=lease_expiration.desc&limit=1`)
      .catch(() => ({ data: [] }));
    expiration = (lr && lr.data && lr.data[0] && lr.data[0].lease_expiration) || null;
  }
  if (expiration) { rec.lease_expiration = expiration; rec.remaining_term = _yearsFromNow(expiration); }
  // Cap from the subject's OWN active listing (broker-underwritten ask cap).
  try {
    const listRes = await q('GET', `available_listings?property_id=eq.${enc(p.property_id)}&select=cap_rate,current_cap_rate,initial_cap_rate,status&limit=5`)
      .catch(() => ({ data: [] }));
    const listings = (listRes && Array.isArray(listRes.data)) ? listRes.data : [];
    const active = listings.find(l => /active/i.test(String(l && l.status || ''))) || listings[0];
    if (active) rec.cap_rate = _reviewNum(active.cap_rate) ?? _reviewNum(active.current_cap_rate) ?? _reviewNum(active.initial_cap_rate);
  } catch { /* no listing cap → leave subject cap as-is */ }
  applyHydratedSubject(subject, rec);
  return subject;
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
  if (!nationalSubjectAnchor(args)) return args;
  return { ...args, states: null, metros: null };
}

// Prompt 52 — central operator-filter guard. In a subject-anchored (appraisal /
// similarity) pull the subject's operator anchors SIMILARITY only; it must never hard-
// filter the comp universe. Clear tenant/tenants unless the user EXPLICITLY asked for an
// operator-scoped set (_operator_filter_explicit). Phrasing-independent: covers both the
// appraisal-mode path and a subject resolved to a concrete property (prompt 49).
function operatorScopeArgs(args) {
  if (!nationalSubjectAnchor(args) || args._operator_filter_explicit) return args;
  const hasFilter = !!(args.tenant || (args.tenants && args.tenants.length) || (args.tenant_list && args.tenant_list.length));
  if (!hasFilter) return args;
  return { ...args, tenant: null, tenants: null, tenant_list: null };
}

function queryScopeArgs(args) {
  if (!nationalSubjectAnchor(args)) return args;
  // Appraisal mode is NATIONAL, subject-anchored — the candidate PULL is not bounded by the
  // subject's state/region. Geography is a SCORE weight only (scoreComp), never a hard pull or
  // local filter, so strong out-of-region same-operator / same-term / same-age comps surface and
  // are ranked against in-region ones. `p_states = null` => national.
  return { ...args, states: null, metros: null };
}

function templateRow(c) {
  const salePrice = c.price_withheld ? null : (c.sale_price ?? c.sold_price ?? null);
  const rba = c.building_sf ?? c.rba ?? c.building_size ?? null;
  const pricePerSf = c.price_per_sf ?? (salePrice && rba ? +(salePrice / rba).toFixed(2) : null);
  const annualNoi = c.noi ?? c.engine_income ?? c.annual_rent ?? null;
  const land = c.land ?? c.land_acres ?? c.lot_acres ?? c.raw?.land ?? c.raw?.land_acres ?? null;
  const leaseType = c.lease_type ?? c.expense_type ?? c.expenses ?? c.raw?.lease_type ?? c.raw?.expense_type ?? null;
  const initialPrice = c.initial_price ?? c.init_price ?? c.raw?.initial_price ?? null;
  const lastPrice = c.last_price ?? c.raw?.last_price ?? null;
  const currentPrice = c.cur_price ?? c.current_price ?? c.ask_price ?? c.list_price ?? null;
  const currentCap = c.current_cap_rate ?? c.cur_cap_rate ?? c.ask_cap_rate ?? c.list_cap_rate ?? c.cap_rate ?? c.raw?.current_cap_rate ?? null;
  return {
    property_name: c.property_name || c.raw?.property_name || c.tenant || c.agency || null,
    tenant: c.tenant || c.agency || null,
    address: c.address || null,
    city: c.city || null,
    state: c.state || null,
    rba_sf: rba,
    land,
    year_built: c.year_built ?? c.built ?? c.raw?.year_built ?? null,
    chairs: c.chairs ?? null,
    patients: c.patient_count ?? c.patients ?? null,
    sale_price: salePrice,
    cap_rate: c.cap_rate ?? null,
    price_per_sf: pricePerSf,
    annual_noi: annualNoi,
    annual_rent: c.annual_rent ?? null,
    rent_per_sf: c.rent_per_sf ?? (c.annual_rent && rba ? +(c.annual_rent / rba).toFixed(2) : null),
    lease_expiration: c.lease_expiration ?? c.expiration_date ?? c.raw?.lease_expiration ?? null,
    expenses: leaseType,
    lease_type: leaseType,
    bumps: normalizeBumps(c.bumps ?? c.escalations ?? c.escalation ?? c.raw?.bumps ?? null),
    renewal_options: c.renewal_options ?? c.raw?.renewal_options ?? null,
    initial_price: initialPrice,
    initial_cap_rate: c.initial_cap_rate ?? c.init_cap_rate ?? c.raw?.initial_cap_rate ?? null,
    last_price: lastPrice,
    last_cap_rate: c.last_cap_rate ?? c.raw?.last_cap_rate ?? null,
    cur_price: currentPrice,
    current_cap_rate: currentCap,
    // Prompt 54 — the live rpc_query_comps sold arm joins the real market-entry date and emits it
    // as `list_date` (already gated < sale_date); read it so the Sold tab shows ON MARKET + DOM
    // where a genuine list date exists. Never synthetic — a missing list date stays blank.
    on_market: c.on_market_date ?? c.listing_date ?? c.list_date ?? c.date_listed ?? c.raw?.on_market_date ?? c.raw?.on_market ?? null,
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
    property_id: rest.property_id ?? raw?.property_id ?? raw?.Property_ID__c ?? undefined,
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
    p_limit: clampLimit(args.limit, DEFAULT_QUERY_LIMIT,
      args.appraisal_mode ? MAX_APPRAISAL_CANDIDATE_LIMIT : MAX_QUERY_LIMIT),
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
  { re: /\bthe villages\b/i, name: 'The Villages', state: 'FL', metro: 'Wildwood-The Villages', region: 'Southeast',
    fields: { tenant: 'DaVita / dialysis', credit: 'Not on file', cap_rate: 0.06 } },
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
    const fields = { ...Object.fromEntries(SUBJECT_UNKNOWN_FIELDS.map(f => [f, 'Not on file'])), ...(p.fields || {}) };
    if (p.re.test(raw)) return {
      name: p.name, state: p.state, metro: p.metro, region: p.region,
      kind: /deal|asset|property|under contract|our\b/i.test(raw) ? 'subject_candidate' : 'place',
      // A gazetteer cap is only a placeholder DEFAULT — flag it so record-hydration
      // (prompt 47) can replace it with the subject's actual cap.
      ...(fields.cap_rate && !p.cap_rate ? { cap_rate: fields.cap_rate, _cap_default: true } : {}),
      fields,
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

// Prompt 52 — distinguish an EXPLICIT operator-scoped comp request ("DaVita comps",
// "pull Fresenius sales", "US Renal only") from a request that merely NAMES the
// subject's operator ("appraise our The Villages DaVita deal"). In appraisal /
// similarity mode the subject's operator anchors SIMILARITY only — it must NOT filter
// the comp universe (the best comp may be a different operator of like size/term/cap).
// The hard operator filter is kept ONLY when the user explicitly asks for it.
const _OP_WORDS = 'davita|fresenius|fmc|bma|bio[\\s-]?medical|u\\.?\\s*s\\.?\\s*renal(?:\\s*care)?|usrc|american renal|satellite (?:health(?:care)?|dialysis)|dialysis clinic|dci|dsi\\s*renal|renal ventures|innovative renal';
function operatorScopeRequested(t) {
  const s = String(t || '').toLowerCase();
  // "<operator> comps/sales/deals/portfolio/leases/listings/transactions"
  if (new RegExp(`\\b(?:${_OP_WORDS})\\b[\\s\\w-]{0,12}?\\b(comps?|sales?|deals?|portfolio|leases?|listings?|transactions?)\\b`).test(s)) return true;
  // "comps/sales for <operator>"
  if (new RegExp(`\\b(comps?|sales?|deals?|leases?|listings?|transactions?)\\b[\\s\\w-]{0,12}?\\bfor\\b[\\s\\w-]{0,12}?\\b(?:${_OP_WORDS})\\b`).test(s)) return true;
  // "only/just/exclusively <operator>" or "<operator> only/exclusively"
  if (new RegExp(`\\b(only|just|exclusively)\\b[\\s\\w-]{0,12}?\\b(?:${_OP_WORDS})\\b`).test(s)) return true;
  if (new RegExp(`\\b(?:${_OP_WORDS})\\b[\\s-]*(?:care|medical|health)?\\s+(only|exclusively)\\b`).test(s)) return true;
  return false;
}

function detectAppraisalIntent(t, out) {
  // Prompt 49 — a subject STREET ADDRESS is a subject-anchored (appraisal-style)
  // comp pull: national scope, subject excluded, sold + curated on-market. This
  // makes resolution phrasing-INDEPENDENT — the same subject worded with or without
  // "appraisal"/"comps for" behaves identically once its address is present.
  if (out.subject && out.subject.address) return true;
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
  // Prompt 49 — a subject STREET ADDRESS resolves the subject to its property
  // (in runComps via hydrateSubjectFromRecord) phrasing-independently. Capture it
  // HERE so hydration fires regardless of wording (not only when an "appraisal"/
  // "comps for" phrase happens to be present), and so the pull is treated as a
  // subject-anchored NATIONAL appraisal pull. A recognized subject property must
  // win over the metro it sits in — prefer the street address over the city/metro
  // token. detectAppraisalIntent below reads out.subject.address.
  const subjectAddress = extractSubjectAddress(raw);
  if (subjectAddress) {
    out.subject = { ...(out.subject || {}), address: subjectAddress };
  }
  let capMatch;
  if ((capMatch = t.match(/\b(?:subject|deal|under[- ]contract|contract|appraisal|appraised)?\s*(?:cap(?: rate)?|going[- ]in cap)?\s*(?:is|at|around|~|=)?\s*(\d+(?:\.\d+)?)\s*%/))) {
    const cap = Number(capMatch[1]) / 100;
    if (Number.isFinite(cap) && cap > 0 && cap < 1) {
      // User TYPED a cap — authoritative. Flag it so record-hydration (prompt 47)
      // never overrides an explicit user cap (it only overrides a gazetteer default).
      // Prompt 49 — also stamp the nested fields block so the cover/subject summary
      // renders the user cap, not the gazetteer default it replaced.
      const prevFields = (out.subject && out.subject.fields) || {};
      out.subject = { ...(out.subject || {}), cap_rate: cap, _cap_user: true, _cap_default: false,
        fields: { ...prevFields, cap_rate: cap } };
    }
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
  // Prompt 52 — an operator hard-filter is honored only when the user EXPLICITLY asked
  // for an operator-scoped set; a subject's own operator is a similarity anchor, not a filter.
  out._operator_filter_explicit = operators.length > 0 && operatorScopeRequested(raw);
  if (out.appraisal_mode && out.property_types?.includes('dialysis')) {
    out.include_unreliable_noi = true;
    out.include_on_market = true;
    out.comp_type = out.comp_type || 'both';
    // Clear the operator hard-filter unless it was explicitly requested (keeps
    // "DaVita comps" scoped, but lets "appraise The Villages DaVita" pull all operators).
    if (!out._operator_filter_explicit) { out.tenant = null; out.tenants = null; }
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
const CAP_DISPLAY_DISAGREE_BPS = 0.0025;  // Prompt 52: stored cap_rate vs rent÷price tolerance (25 bps)
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
  // Prompt 52 — the DISPLAYED cap (rent ÷ price = impliedCap) is authoritative for
  // selection/appraisal discipline; when the stored cap_rate field disagrees with it by
  // >25 bps the stored value is mislabeled (Woodland Hills 6.62% stored vs 6.00% displayed)
  // → flag it so nothing keys off the stored cap.
  const storedCap = _reviewNum(c.cap_rate);
  if (impliedCap != null && storedCap != null && Math.abs(storedCap - impliedCap) > CAP_DISPLAY_DISAGREE_BPS)
    flags.push('stored_cap_disagrees_display');
  // Uninterpretable bumps (bare number, no %) → route to the review lane as bad
  // data (the value itself is left untouched by normalizeBumps).
  if (bumpsAreBadData(c.bumps)) flags.push('bad_bumps');

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

// Renewal-options normalizer (prompt 41, hardened prompt 57) — options come through
// as free text in every spelling: "2, 5 yr", "Three, 5-Year Options", "(3) 5-yr",
// "Two (2) Five (5) Year", "Two (2), Five (5) Year", "three five-year options",
// "One, Five-Year Period", or a bare count "3". Parse N renewal options of M years each
// → the single canonical form "(N) M-yr". When the count is known but the term isn't,
// emit "(N)" (never assume 5-yr). Genuine none → "None". Unrecognized shapes pass
// through unchanged + log, so we never fabricate a term.
const _RENEWAL_WORDNUM = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7,
  eight:8, nine:9, ten:10, eleven:11, twelve:12 };
const _RENEWAL_NUMTOK = '\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';
function _renewalWordNum(s) {
  if (s == null) return null;
  const t = String(s).trim().toLowerCase();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return _RENEWAL_WORDNUM[t] || null;
}
// Every "no renewal options" spelling collapses to one display token (parallel to
// bumps `Flat`), so Sold and On Market never diverge (None here, blank there).
function _isNoRenewalOptions(s) {
  return /^(?:none|no\s+(?:renewal\s+)?options?|no|n\/?a|na|0|zero)$/i.test(s);
}
export function normalizeRenewalOptions(value) {
  if (value == null) return value;
  const s0 = String(value).trim();
  if (!s0) return value;
  if (/^\(\d+\)\s*\d+-yr$/.test(s0)) return s0;   // already canonical "(N) M-yr"
  if (/^\(\d+\)$/.test(s0)) return s0;            // already canonical count-only "(N)"
  if (_isNoRenewalOptions(s0)) return 'None';
  // Collapse a redundant "word (digit)" pair to the digit ("Two (2)" → "2",
  // "Five (5)" → "5") so "Two (2) Five (5) Year" reduces to "2 5 Year".
  const s = s0.replace(new RegExp(`\\b(${Object.keys(_RENEWAL_WORDNUM).join('|')})\\s*\\((\\d+)\\)`, 'gi'), '$2');
  // count + term (word or digit for either), term carrying a year marker:
  //   "2, 5 Year" / "three five-year options" / "One, Five-Year Period" / "2 x 5 yr"
  const m = s.match(new RegExp(`\\(?\\s*(${_RENEWAL_NUMTOK})\\s*\\)?\\s*[,x×/\\-\\s]+\\s*(${_RENEWAL_NUMTOK})\\s*-?\\s*(?:yr|year)s?\\b`, 'i'));
  if (m) {
    const n = _renewalWordNum(m[1]), term = _renewalWordNum(m[2]);
    if (n && term) return `(${n}) ${term}-yr`;
  }
  // single option, no explicit count: "5-year option" / "five-year option" → (1) 5-yr
  const m2 = s.match(new RegExp(`^\\s*(?:a\\s+|one\\s+)?(${_RENEWAL_NUMTOK})\\s*-?\\s*(?:yr|year)s?\\b[^,]*\\boption`, 'i'));
  if (m2) { const term = _renewalWordNum(m2[1]); if (term) return `(1) ${term}-yr`; }
  // bare count with no term ("3" / "(3) options" / "three options") → keep the count,
  // mark the term unknown as "(N)" — never assume a 5-yr term.
  const m3 = s.match(new RegExp(`^\\(?\\s*(${_RENEWAL_NUMTOK})\\s*\\)?\\s*(?:options?|periods?|renewals?)?\\s*$`, 'i'));
  if (m3) { const n = _renewalWordNum(m3[1]); if (n) return `(${n})`; }
  console.warn(`[comps:renewal-options] unrecognized shape, passed through: ${JSON.stringify(s0)}`);
  return value;
}
// Workbook-display renewal options (prompt 57): the ONE normalizer both the Sold and
// On Market tabs render through, so they read identically. Runs normalizeRenewalOptions,
// then defaults a genuinely-empty/absent value to the canonical "None" — never blank.
export function renewalOptionsForWorkbook(value) {
  const n = normalizeRenewalOptions(value);
  if (n == null || String(n).trim() === '') return 'None';
  return n;
}

// Bumps / escalation normalizer (prompt 41). Canonical shapes:
//   annual:        "X% / yr"
//   every N years: "X% / N yrs"   (N==1 collapses to "X% / yr")
//   none:          "None"
// An UNINTERPRETABLE source value (a bare number with no % — e.g. `0.1`, `1.75`,
// which could be a decimal rate, a per-year fraction, or noise) is left UNTOUCHED
// and routed to the review lane as bad data (see bumpsAreBadData + the bad_bumps
// review flag). We never guess what a bare number means.
// Canonical no-escalation token (prompt 56): every "no rent increases" spelling —
// None / Fixed / Flat / Level / Static / N/A / No bumps / 0% — collapses to one
// display token so Sold and On Market never diverge (Fixed here, blank there).
const _FLAT = 'Flat';
function _isFlatBumps(s) {
  return /^(?:none|flat|fixed|level|static|no\s*(?:bumps?|escalations?|increases?|steps?)|n\/?a)$/i.test(s);
}
export function normalizeBumps(value) {
  if (value == null) return value;
  const s = String(value).trim();
  if (!s) return value;                                     // empty → left to the workbook layer (→ Flat)
  // Unify every no-escalation spelling to one token (prompt 56).
  if (_isFlatBumps(s)) return _FLAT;
  // already canonical ("X% / yr" / "X% / N yrs" in any spacing)
  if (/^\d+(?:\.\d+)?%\s*\/\s*yr$/i.test(s)) return s.replace(/^(\d+(?:\.\d+)?)%.*$/i, '$1% / yr');
  const canonEvery = s.match(/^(\d+(?:\.\d+)?)%\s*\/\s*(\d+)\s*yrs?$/i);
  if (canonEvery) { const yrs = parseInt(canonEvery[2], 10); return yrs === 1 ? `${canonEvery[1]}% / yr` : `${canonEvery[1]}% / ${yrs} yrs`; }
  // Bare number with no % sign:
  //   • 0<d≤1  → Scott's dialysis 5-yr-step convention ("0.1" → "10% / 5 yrs").
  //   • d>1    → a literal annual percent (prompt 56: "1.75" → "1.75% / yr").
  //   • d==0   → no escalation → Flat.
  //   • d<0    → nonsense → pass through (bad-data lane).
  const bare = s.match(/^-?\d+(?:\.\d+)?$/) ? Number(s) : NaN;
  if (Number.isFinite(bare)) {
    if (bare === 0) return _FLAT;
    if (bare > 0 && bare <= 1) return `${String(+(bare * 100).toFixed(4))}% / 5 yrs`;
    if (bare > 1) return `${String(+bare.toFixed(4))}% / yr`;
    return value;                                           // negative → uninterpretable
  }
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!pct) return value;                                   // no % (e.g. "CPI annually") → pass through unchanged
  const n = Number(pct[1]);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return _FLAT;                                // "0% annually" → no escalation
  const pctText = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
  // Step interval: "every N (years)", "after N years", "N-yr steps", or "/ N yrs".
  const every = s.match(/\bevery\s+(\d+)(?:\s*(?:yr|year)s?)?\b/i)
    || s.match(/\bafter\s+(\d+)\s*(?:yr|year)s?\b/i)
    || s.match(/\b(\d+)\s*(?:yr|year)s?\s*(?:steps?|bumps?|increases?)\b/i)
    || s.match(/\/\s*(\d+)\s*(?:yr|year)s?\b/i);
  if (every) {
    const yrs = parseInt(every[1], 10);
    if (Number.isFinite(yrs) && yrs > 0) return yrs === 1 ? `${pctText}% / yr` : `${pctText}% / ${yrs} yrs`;
  }
  if (/\bannual(?:ly)?\b|\bper\s+year\b|\b\/\s*yr\b|\byearly\b/i.test(s)) return `${pctText}% / yr`;
  return value;
}

// Workbook-display bumps (prompt 56): the ONE normalizer both the Sold and On Market
// tabs render through, so they read identically. Runs normalizeBumps, then defaults a
// genuinely-empty/absent value to the canonical no-escalation token `Flat` — never blank.
export function bumpsForWorkbook(value) {
  const n = normalizeBumps(value);
  if (n == null || String(n).trim() === '') return _FLAT;
  return n;
}

// True when a bumps source value is present but uninterpretable bad data. Prompt 56:
// bare numbers are now all interpretable (0<d≤1 → 5-yr step; d>1 → annual %; 0 → Flat),
// so only a bare NEGATIVE number (nonsense) remains bad data and is routed to review.
export function bumpsAreBadData(value) {
  if (value == null) return false;
  const s = String(value).trim();
  if (!s || _isFlatBumps(s)) return false;
  if (/%/.test(s)) return false;                            // has a percent → interpretable enough
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return false;            // not a bare number
  const n = Number(s);
  return !(Number.isFinite(n) && n >= 0);                    // ≥0 interpretable; negative → bad data
}

// ── Operator standardization (prompt 41) ────────────────────────────────────
// The TENANT column must show the canonical operator BRAND, not the raw clinic
// name. Maps raw operator/clinic text → the canonical brand; returns null when no
// dialysis operator is recognized (so government agencies + genuine property names
// are left untouched). Vocabulary is documented once in docs/os/canon/comps.md.
const OPERATOR_CANON = [
  [/\bu\.?\s*s\.?\s*renal(?:\s*care)?\b|\busrc\b/i, 'US Renal Care'],
  [/\bdavita\b/i, 'DaVita'],
  [/\bfresenius\b|\bfmc\b|\bbma\b|\bbio[\s-]?medical\b/i, 'Fresenius Medical Care'],
  [/\bamerican renal\b/i, 'American Renal'],
  [/\binnovative renal(?:\s*care)?\b|\birc\b/i, 'Innovative Renal Care'],
  [/\bsatellite (?:health(?:care)?|dialysis)\b/i, 'Satellite Healthcare'],
  [/\bdialysis clinic(?:\s*inc)?\b|\bdci\b/i, 'Dialysis Clinic Inc'],
  [/\bdsi\s*renal\b|\bdsi\b/i, 'DSI Renal'],
  [/\brenal ventures\b/i, 'Renal Ventures'],
];
export function standardizeOperator(name) {
  const s = String(name || '');
  if (!s.trim()) return null;
  for (const [re, canon] of OPERATOR_CANON) if (re.test(s)) return canon;
  return null;
}

// ── Expense-structure vocabulary (prompt 41) ────────────────────────────────
// Standardize free-text lease/expense structure to a fixed vocabulary:
//   Absolute NNN · NNN · NN · Gross · Ground Lease · Modified Gross
// Uninterpretable values pass through unchanged. Order matters (most-specific
// first). Documented once in docs/os/canon/comps.md.
export function standardizeExpenseStructure(value) {
  if (value == null) return value;
  const s = String(value).trim();
  if (!s) return value;
  const t = s.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/absolute\s*(?:net|nnn|triple\s*net)|bondable/.test(t)) return 'Absolute NNN';
  if (/ground\s*lease/.test(t)) return 'Ground Lease';
  if (/modified\s*gross|mod\s*gross/.test(t)) return 'Modified Gross';
  if (/modified\s*(?:triple\s*net|nnn)/.test(t)) return 'NNN';         // "Modified Triple Net" → NNN
  if (/triple\s*net|\bnnn\b|\bn{3}\b/.test(t)) return 'NNN';
  if (/double\s*net|\bnn\b/.test(t)) return 'NN';
  if (/full\s*service|\bfsg\b|\bgross\b|\bmg\b(?!.*net)/.test(t)) return 'Gross';
  return value;                                                        // uninterpretable → pass through
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
    subject: args.subject || args.subject_override || parsed.subject,
    appraisal_mode: (args.appraisal_mode != null) ? args.appraisal_mode : parsed.appraisal_mode,
    government_only: (args.government_only != null) ? args.government_only : parsed.government_only,
    include_on_market: (args.include_on_market != null) ? args.include_on_market : parsed.include_on_market,
    include_unreliable_noi: (args.include_unreliable_noi != null) ? args.include_unreliable_noi : parsed.include_unreliable_noi,
    _operator_filter_explicit: (args._operator_filter_explicit != null) ? args._operator_filter_explicit : parsed._operator_filter_explicit,
  };
  // Prompt 47 — hydrate the subject anchor from its resolved property record so
  // scoring can weight size/chairs/term/cap and the subject can be excluded from
  // the set. Idempotent (guarded by subject._hydration_attempted); fail-soft.
  if (args.subject) { try { args.subject = await hydrateSubjectFromRecord(args, deps); } catch { /* leave subject as-is */ } }
  // Prompt 52 — after hydration (subject may now be resolved to a property), drop the
  // operator hard-filter for subject-anchored pulls unless it was explicitly requested.
  args = operatorScopeArgs(args);
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
  if (nationalSubjectAnchor(args) && dedupe(rows).length < params.p_limit && (params.p_states || params.p_metros)) {
    const fallbackParams = argsToParams({ ...queryArgs, states: null, metros: null, limit: params.p_limit });
    const fallback = await fetchBatch(fallbackParams, 'national_fallback');
    fallback.settled.forEach((s, i) => s.status === 'fulfilled'
      ? rows.push(...s.value)
      : warnings.push({ vertical: targets[i], scope: fallback.label, error: String(s.reason?.message || s.reason) }));
  }
  const deduped = dedupe(rows);
  // Prompt 52 — drop bare duplicate records: when several records share a normalized
  // address and one is enriched, the bare (financial-signal-less) sibling is dropped so
  // it never surfaces as an empty comp. Runtime guard until Prompt-51 consolidation lands.
  const merged = dropBareAddressDuplicates(deduped);
  const bareDuplicatesDropped = deduped.length - merged.length;
  // Normalize the `use` tag + apply the multi-tenant display name on every comp,
  // and standardize renewal-options text so every surface emits "(N) M-yr".
  for (const c of merged) {
    c.use = normalizeUse(c);
    // Operator standardization — canonical brand for the TENANT column. Applied
    // to the raw operator/anchor BEFORE displayName so a single-tenant dialysis
    // comp shows the brand (DaVita / Fresenius Medical Care / US Renal Care …)
    // and a multi-tenant comp's anchor uses the brand inside its MOB/MT label.
    // A government agency / genuine property name is left untouched (no match).
    const canonOp = standardizeOperator(compTenantText(c));
    if (canonOp) {
      c.operator = canonOp;
      if (c.anchor_tenant && standardizeOperator(c.anchor_tenant)) c.anchor_tenant = canonOp;
      if (!isMultiTenant(c)) c.tenant = canonOp;
    }
    const dn = displayName(c, { property_types: args.property_types, government_only: params.p_government_only });
    if (dn) { c.tenant = dn; if (c.agency != null) c.agency = dn; }
    // Expense-structure vocabulary → fixed set (both fields templateRow reads).
    const stdExp = standardizeExpenseStructure(c.lease_type ?? c.expense_type ?? c.expenses ?? c.raw?.lease_type ?? c.raw?.expense_type);
    if (stdExp != null) { c.lease_type = stdExp; c.expenses = stdExp; }
    if (c.renewal_options != null) c.renewal_options = normalizeRenewalOptions(c.renewal_options);
    if (c.bumps != null) c.bumps = normalizeBumps(c.bumps);
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
            bare_duplicates_dropped: bareDuplicatesDropped,
            by_source: comps.reduce((m, r) => (m[r.source] = (m[r.source] || 0) + 1, m), {}),
            flagged_for_review: flagged.length,
            review_flags: flagged.map(c => ({
              comp_id: c.comp_id, address: c.address, city: c.city, state: c.state,
              tenant: c.tenant, sale_date: c.sale_date, flags: c.review_flags,
              ...c.review_detail })),
            warnings, interpreted_params: { ...params,
              p_candidate_scope: nationalSubjectAnchor(args) ? 'national_subject_anchored' : 'hard_filters',
              tenants: args.tenants || args.tenant_list || null, appraisal_mode: !!args.appraisal_mode } } };
}

function summarizeComps(scored, eff, meta) {
  const rows = scored || [];
  const soldRows = rows.filter(c => !isOnMarketComp(c) && Number(c.sale_price) > 0);
  const capRows = soldRows.length ? soldRows : rows;
  // Prompt 56 — the cap-rate stat MUST describe the same set the sheet displays, so it is
  // computed from displayedCompCap (rent÷price, the exact value each SOLD row shows), not the
  // stored cap_rate field. Rows that show a blank cap on the sheet carry no displayed cap and
  // are excluded from the range — a reader never sees a range that omits a visible row.
  const capPairs = capRows
    .map(c => ({ cap: displayedCompCap(c), price: Number(c.sale_price ?? c.sold_price) }))
    .filter(p => Number.isFinite(p.cap) && p.cap > 0);
  const caps = capPairs.map(p => p.cap);
  const medianCap = caps.length ? caps.slice().sort((a, b) => a - b)[Math.floor(caps.length / 2)] : null;
  const weighted = capPairs.reduce((acc, p) => {
    if (Number.isFinite(p.price) && p.price > 0) { acc.num += p.cap * p.price; acc.den += p.price; }
    return acc;
  }, { num: 0, den: 0 });
  const fl = rows.filter(c => c.state === 'FL').length;
  const tiers = rows.reduce((m, r) => (m[r.score_tier || 'C'] = (m[r.score_tier || 'C'] || 0) + 1, m), {});
  const capText = caps.length
    ? `${(Math.min(...caps) * 100).toFixed(2)}%-${(Math.max(...caps) * 100).toFixed(2)}% cap range; median ${(medianCap * 100).toFixed(2)}%${weighted.den ? `; weighted average ${(weighted.num / weighted.den * 100).toFixed(2)}%` : ''}`
    : 'cap-rate range not on file';
  const subjectName = eff.subject?.name || 'the subject';
  return `Methodology: ${rows.length} ${eff.property_types?.includes('dialysis') ? 'dialysis ' : ''}comps ranked by subject similarity for ${subjectName}, weighting same metro/state first, then regional/national support, tenant credit, size/chair scale, cap proximity, and recency. Cap-rate statistics use the displayed sold set (n=${caps.length}) — the same cap (rent÷price) each shipped row shows. The set shows ${capText}. ${fl ? `${fl} Florida comps are included; ` : ''}score tiers: A=${tiers.A || 0}, B=${tiers.B || 0}, C=${tiers.C || 0}. Review flags are retained from the cap/rent reconciliation engine; missing subject fields remain "Not on file."`;
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

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ISO (YYYY-MM-DD) date n months before today — the recency-window default.
function monthsAgoISO(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function soldCapForStats(c) {
  const price = asNum(c?.sale_price ?? c?.sold_price);
  const noi = asNum(c?.annual_noi ?? c?.noi ?? c?.engine_income ?? c?.annual_rent);
  if (price && price > 0 && noi && noi > 0) return +(noi / price).toFixed(6);
  const cap = asNum(c?.cap_rate ?? c?.current_cap_rate ?? c?.initial_cap_rate ?? c?.last_cap_rate);
  return cap && cap > 0 ? cap : null;
}

function appraisalCapBand(subject = null, args = {}) {
  const subjectCap = asNum(subject?.cap_rate ?? subject?.fields?.cap_rate);
  if (!subjectCap) return null;
  const lowerBps = asNum(args?.appraisal_cap_band_lower_bps ?? args?.cap_band_lower_bps) ?? APPRAISAL_DEFAULT_BAND_LOWER_BPS;
  const upperBps = asNum(args?.appraisal_cap_band_upper_bps ?? args?.cap_band_upper_bps) ?? APPRAISAL_DEFAULT_BAND_UPPER_BPS;
  return {
    subject_cap: subjectCap,
    min: subjectCap - lowerBps / 10000,
    max: subjectCap + upperBps / 10000,
    lower_bps: lowerBps,
    upper_bps: upperBps,
  };
}

// Prompt 52 — appraisal cap discipline: hold the SET AVERAGE cap below the subject's
// target. Sold comps are trimmed highest-cap-first (the trimmed ones become secondary)
// until the mean of the displayed caps falls below the subject cap, never below a floor
// count. Returns { kept, demoted } — behavior-neutral when no subject cap is known.
function _meanDisplayedCap(rows) {
  const caps = rows.map(soldCapForStats).filter(n => Number.isFinite(n) && n > 0);
  return caps.length ? caps.reduce((a, b) => a + b, 0) / caps.length : null;
}
function enforceAvgBelowSubject(primary, subject = null, minKeep = APPRAISAL_AVG_TRIM_MIN_KEEP) {
  const subjCap = asNum(subject?.cap_rate ?? subject?.fields?.cap_rate);
  if (!subjCap || primary.length <= minKeep) return { kept: primary, demoted: [] };
  const kept = primary.slice();
  const demoted = [];
  while (kept.length > minKeep) {
    const mean = _meanDisplayedCap(kept);
    if (mean == null || mean < subjCap) break;
    let hiIdx = -1, hiCap = -Infinity;
    kept.forEach((c, i) => { const cap = soldCapForStats(c); if (Number.isFinite(cap) && cap > hiCap) { hiCap = cap; hiIdx = i; } });
    if (hiIdx < 0) break;
    demoted.push(kept.splice(hiIdx, 1)[0]);
  }
  return { kept, demoted };
}
// Count sold comps that closed within the trailing N months (recency-coverage signal).
function recentSoldCount(rows, months = APPRAISAL_RECENT_MONTHS) {
  const cutoff = Date.parse(monthsAgoISO(months));
  if (!Number.isFinite(cutoff)) return 0;
  return rows.filter(c => {
    if (isOnMarketComp(c)) return false;
    const d = Date.parse(c.sale_date || (c.template && c.template.sale_date) || '');
    return Number.isFinite(d) && d >= cutoff;
  }).length;
}

// Prompt 54 — the exact cap the WORKBOOK will DISPLAY for a comp, computed from the same
// template fields the sheet writes into the RENT and PRICE cells so a filter on this value is
// a filter on the shipped row (never a JS-vs-sheet divergence). The RENT cell = annual_rent
// (preferred) else annual_noi — mirrors the template alias where BOTH annual_noi and annual_rent
// map to the RENT column with annual_rent last-wins. PRICE = sale_price (sold) / last_price
// (on-market, current ask), matching the sheet's cap formula (rent÷sold_price / rent÷last_price).
function displayedRentValue(t) {
  return asNum(t?.annual_rent) ?? asNum(t?.annual_noi);
}
export function displayedCompCap(c) {
  const t = c?.template || templateRow(c || {});
  const rent = displayedRentValue(t);
  const price = isOnMarketComp(c)
    ? (asNum(t?.last_price) ?? asNum(t?.cur_price))
    : asNum(t?.sale_price);
  if (rent && rent > 0 && price && price > 0) return +(rent / price).toFixed(6);
  return null;
}
function displayedCompRentPsf(c) {
  const t = c?.template || templateRow(c || {});
  const rent = displayedRentValue(t);
  const rba = asNum(t?.rba_sf);
  if (rent && rent > 0 && rba && rba > 0) return +(rent / rba).toFixed(2);
  return null;
}

// Prompt 54 — enforce the cap-discipline band + reliability filter on the DISPLAYED set. The
// rows that ship in the Sold / On-Market tabs must obey, on the displayed (rent÷price) basis:
//   • displayed cap <= subject cap + upper band (35 bps)  — hard ceiling, both arms
//   • displayed cap >= APPRAISAL_MIN_RELIABLE_CAP          — a lower cap is a data error
//   • (dialysis) RENT/SF within [MIN,MAX]                  — outside is a rent/SF/price error
//   • the SOLD set average holds below the subject cap     — trim highest-cap sold first
// Returns { kept, excludedContext, excludedBadData }:
//   • excludedBadData  → reliability failures (implausible cap / RENT-SF)  → routed to review lane
//   • excludedContext  → above the ceiling OR average-trimmed valid comps → not shown (context/stats)
export function applyDisplayedCapDiscipline(comps, { subjectCap = null, upperBps = APPRAISAL_DEFAULT_BAND_UPPER_BPS, isDialysis = false } = {}) {
  const ceiling = (subjectCap != null && Number.isFinite(subjectCap)) ? subjectCap + upperBps / 10000 : null;
  const kept = [], excludedContext = [], excludedBadData = [];
  for (const c of comps || []) {
    const cap = displayedCompCap(c);
    const rentPsf = displayedCompRentPsf(c);
    const badCap  = cap != null && cap < APPRAISAL_MIN_RELIABLE_CAP;
    const badRent = isDialysis && rentPsf != null && (rentPsf < DIALYSIS_RENT_PSF_MIN || rentPsf > DIALYSIS_RENT_PSF_MAX);
    if (badCap || badRent) {
      const reasons = [];
      if (badCap)  reasons.push('displayed_cap_below_reliable_floor');
      if (badRent) reasons.push('displayed_rent_psf_out_of_range');
      excludedBadData.push({ comp: c, reasons, displayed_cap: cap, displayed_rent_psf: rentPsf });
      continue;
    }
    if (ceiling != null && cap != null && cap > ceiling + 1e-9) {
      excludedContext.push({ comp: c, reason: 'above_subject_cap_ceiling', displayed_cap: cap });
      continue;
    }
    kept.push(c);
  }
  // Hold the SOLD-set average below the subject cap on the displayed basis.
  if (ceiling != null) {
    const sold = kept.filter(c => !isOnMarketComp(c));
    const onMkt = kept.filter(c => isOnMarketComp(c));
    const meanCap = rows => {
      const caps = rows.map(displayedCompCap).filter(n => Number.isFinite(n) && n > 0);
      return caps.length ? caps.reduce((a, b) => a + b, 0) / caps.length : null;
    };
    const working = sold.slice();
    while (working.length > APPRAISAL_AVG_TRIM_MIN_KEEP) {
      const m = meanCap(working);
      if (m == null || m < subjectCap) break;
      let hiIdx = -1, hiCap = -Infinity;
      working.forEach((c, i) => { const cp = displayedCompCap(c); if (Number.isFinite(cp) && cp > hiCap) { hiCap = cp; hiIdx = i; } });
      if (hiIdx < 0) break;
      excludedContext.push({ comp: working.splice(hiIdx, 1)[0], reason: 'trimmed_to_hold_avg_below_subject' });
    }
    return { kept: [...working, ...onMkt], excludedContext, excludedBadData };
  }
  return { kept, excludedContext, excludedBadData };
}

// Prompt 57 — remaining lease term (years) for a comp on the discipline basis: at the
// sale for a sold comp, as of today for an on-market comp (termRemainingAtClose already
// bases on the sale date, falling back to now). Falls back to the comp's stored
// remaining_term when no lease expiration is present. Returns null when neither is known
// (a genuinely no-term comp) — we never fabricate a term.
export function compRemainingTermYears(c) {
  const t = termRemainingAtClose(c);
  if (t != null) return t;
  const stored = asNum(c?.remaining_term ?? c?.term_remaining ?? c?.firm_term_remaining
    ?? c?.raw?.remaining_term ?? c?.raw?.term_remaining);
  return (stored != null && stored > 0) ? stored : null;
}
// Prompt 57 — true when an on-market comp carries no usable price (no initial/last/current
// ask), so it yields no cap and is not a usable comp.
export function compHasNoUsablePrice(c) {
  const p = asNum(c?.last_price) ?? asNum(c?.initial_price) ?? asNum(c?.cur_price)
    ?? asNum(c?.ask_price) ?? asNum(c?.list_price) ?? asNum(c?.current_price)
    ?? asNum(c?.asking_price) ?? asNum(c?.sale_price) ?? asNum(c?.sold_price)
    ?? asNum(c?.raw?.last_price) ?? asNum(c?.raw?.asking_price) ?? asNum(c?.raw?.initial_price)
    ?? asNum(c?.raw?.original_price) ?? asNum(c?.raw?.list_price);
  return !(p != null && p > 0);
}
// Prompt 57 — lease-term + price discipline on the DISPLAYED appraisal set. A long-term
// subject appraisal must not show a comp with NO lease term, a remaining term below the
// floor, or (on-market) no price. Returns { kept, excluded } where each excluded row
// carries its reason(s) — 'no_lease_term' / 'short_lease_term' / 'no_price'. The set is
// reduced non-destructively: excluded comps are routed to review / counted for context,
// never deleted and never merely flagged-and-shipped.
export function applyLeaseTermPriceDiscipline(comps, { minTermYears = APPRAISAL_MIN_REMAINING_TERM_YEARS } = {}) {
  const floor = Number.isFinite(minTermYears) ? minTermYears : APPRAISAL_MIN_REMAINING_TERM_YEARS;
  const kept = [], excluded = [];
  for (const c of comps || []) {
    const reasons = [];
    if (isOnMarketComp(c) && compHasNoUsablePrice(c)) reasons.push('no_price');
    const term = compRemainingTermYears(c);
    if (term == null) reasons.push('no_lease_term');
    else if (term < floor) reasons.push('short_lease_term');
    if (reasons.length) excluded.push({ comp: c, reasons, remaining_term: term });
    else kept.push(c);
  }
  return { kept, excluded };
}

function appraisalPrimaryClassification(c, subject = null, args = {}) {
  const price = asNum(c?.sale_price ?? c?.sold_price);
  const cap = soldCapForStats(c);
  if (cap != null && cap < APPRAISAL_ERROR_CAP_LOW) return { bucket: 'error', reason: 'implausibly_low_cap' };
  if (cap != null && cap > APPRAISAL_ERROR_CAP_HIGH) return { bucket: 'error', reason: 'implausibly_high_cap' };
  if (!isOnMarketComp(c) && portfolioAllocatedSale(c)) {
    return { bucket: 'error', reason: 'portfolio_or_allocated_sale' };
  }
  const noi = asNum(c?.annual_noi ?? c?.noi ?? c?.engine_income ?? c?.annual_rent);
  if (!isOnMarketComp(c) && price && noi && price < noi * 10) return { bucket: 'error', reason: 'sale_price_below_10x_noi' };
  const band = appraisalCapBand(subject, args);
  if (band && cap != null && (cap < band.min || cap > band.max)) {
    return { bucket: 'secondary', reason: 'outside_subject_cap_band', band };
  }
  return { bucket: 'primary', reason: null, band };
}

function primarySaleExclusion(c, subject = null, args = {}) {
  if (isOnMarketComp(c)) return null;
  const cls = appraisalPrimaryClassification(c, subject, args);
  return cls.bucket === 'primary' ? null : cls.reason;
}

function mostRelevantPerProperty(rows) {
  const out = [];
  const byProperty = new Map();
  for (const row of rows) {
    const pid = propertyId(row);
    if (!pid) { out.push(row); continue; }
    const prev = byProperty.get(pid);
    if (!prev) {
      byProperty.set(pid, row);
      out.push(row);
      continue;
    }
    const better = String(row.sale_date || '').localeCompare(String(prev.sale_date || '')) > 0
      || (String(row.sale_date || '') === String(prev.sale_date || '') && Number(row._score || 0) > Number(prev._score || 0))
      || (String(row.sale_date || '') === String(prev.sale_date || '') && Number(row._score || 0) === Number(prev._score || 0) && priceQuality(row) > priceQuality(prev));
    if (better) {
      const idx = out.indexOf(prev);
      if (idx >= 0) out[idx] = row;
      byProperty.set(pid, row);
    }
  }
  return out;
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
    subject:           args.subject || args.subject_override || p.subject,
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

  // ── Recency default + widening (prompt 41) ───────────────────────────────
  // Default sold comps to the last 18 months when the user gave NO window
  // ("older is a different capital-markets condition"). If too few qualify,
  // widen in order — add operators, then loosen geography, then extend the
  // window — never silently keeping stale comps to hit the count. Every step
  // is logged to meta.widened; the final window is surfaced in interpreted_query.
  const wantsSales = !eff.comp_type || eff.comp_type === 'sale' || eff.comp_type === 'both';
  const userGaveWindow = !!(eff.date_from || args.date_from || args.date_to);
  const baseArgs = { ...eff, verticals: route.verticals, government_only: route.government_only, limit: candidateLimit };
  let recencyDefaultApplied = null;
  if (wantsSales && !userGaveWindow) {
    recencyDefaultApplied = monthsAgoISO(18);
    baseArgs.date_from = recencyDefaultApplied;
  }
  let pulled = await runComps(baseArgs, deps);
  let finalWindow = baseArgs.date_from || null;
  const widened = [];
  if (recencyDefaultApplied && pulled.comps.length < requestedLimit) {
    const steps = [
      { key: 'operators',   when: () => !!(eff.tenant || (eff.tenants && eff.tenants.length)),                          apply: a => ({ ...a, tenant: null, tenants: null }) },
      { key: 'geography',   when: () => !nationalSubjectAnchor(eff) && !!((eff.states && eff.states.length) || (eff.metros && eff.metros.length)), apply: a => ({ ...a, states: null, metros: null }) },
      { key: 'window_24mo', when: () => true, apply: a => ({ ...a, date_from: monthsAgoISO(24) }) },
      { key: 'window_36mo', when: () => true, apply: a => ({ ...a, date_from: monthsAgoISO(36) }) },
    ];
    let curArgs = baseArgs;
    for (const step of steps) {
      if (pulled.comps.length >= requestedLimit) break;
      if (!step.when()) continue;
      curArgs = step.apply(curArgs);
      const before = pulled.comps.length;
      const re = await runComps(curArgs, deps);
      widened.push({ step: step.key, before, after: re.comps.length, date_from: curArgs.date_from || null });
      pulled = re;
      finalWindow = curArgs.date_from || null;
    }
  }
  const { comps, meta } = pulled;
  if (recencyDefaultApplied) {
    meta.recency_window_default = recencyDefaultApplied;
    meta.widened = widened;
    eff.date_from = finalWindow;                           // surface the actual window used
    if (widened.length) console.warn(`[comps:widen] target ${requestedLimit}, applied ${JSON.stringify(widened)}`);
  }
  const tierRank = { A: 3, B: 2, C: 1 };
  let scored = comps.map(c => ({ ...c, _score: scoreComp(c, eff) }))
    .sort((x, y) => ((tierRank[scoreTier(y._score)] || 0) - (tierRank[scoreTier(x._score)] || 0) || y._score - x._score
      || String(y.sale_date || '').localeCompare(String(x.sale_date || '')) || String(x.comp_id || '').localeCompare(String(y.comp_id || ''))))
    .map(c => ({ ...c, score_tier: scoreTier(c._score),
      template: { ...(c.template || templateRow(c)), score_tier: scoreTier(c._score) } }));
  if (eff.appraisal_mode) {
    const classified = scored.map(c => ({ c, cls: appraisalPrimaryClassification(c, eff.subject, eff) }));
    const primaryAll = mostRelevantPerProperty(classified.filter(x => !isOnMarketComp(x.c) && x.cls.bucket === 'primary').map(x => x.c));
    // Prompt 52 — hold the SET AVERAGE cap below the subject: trim highest-cap primaries
    // (they drop to secondary) until the mean displayed cap is below the subject target.
    const { kept: primary, demoted: avgDemoted } = enforceAvgBelowSubject(primaryAll, eff.subject);
    const secondary = [
      ...classified.filter(x => !isOnMarketComp(x.c) && x.cls.bucket === 'secondary').map(x => x.c),
      ...avgDemoted,
    ].map(c => ({ ...c, score_tier: 'Secondary',
      template: { ...(c.template || templateRow(c)), score_tier: 'Secondary' } }));
    const market = classified.filter(x => isOnMarketComp(x.c) && x.cls.bucket !== 'error').map(x => x.c);
    const errorCount = classified.filter(x => x.cls.bucket === 'error').length;
    const primaryFinal = primary.slice(0, requestedLimit);
    scored = eff.include_on_market ? [...primaryFinal, ...market] : primaryFinal;
    scored._secondary_count = secondary.length;
    scored._appraisal_error_count = errorCount;
    scored._appraisal_cap_band = appraisalCapBand(eff.subject, eff);
    scored._appraisal_avg_demoted = avgDemoted.length;
    scored._appraisal_primary_avg_cap = _meanDisplayedCap(primaryFinal);
    scored._appraisal_recent_sales = recentSoldCount(primaryFinal);
  } else {
    scored = scored.slice(0, requestedLimit);
  }
  const synthMeta = { ...meta, returned: scored.length, candidate_total: comps.length,
    truncated: meta.truncated || comps.length > scored.length };
  const result = { interpreted_query: {
      comp_type: eff.comp_type || 'sale', property_types: eff.property_types || null,
      // Appraisal mode pulls a national candidate universe — surface that the behavior is national,
      // not the subject's state, so the national scoping is visible to every consumer.
      states: nationalSubjectAnchor(eff) ? 'national' : (eff.states || null),
      metros: nationalSubjectAnchor(eff) ? null : (eff.metros || null),
      date_from: eff.date_from || null,
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
      secondary_market_range: scored._secondary_count || 0,
      flagged_for_review: scored.filter(c => c.review_flags && c.review_flags.length).length,
      review_flags: scored.filter(c => c.review_flags && c.review_flags.length).map(c => ({
        comp_id: c.comp_id, address: c.address, city: c.city, state: c.state,
        tenant: c.tenant, sale_date: c.sale_date, flags: c.review_flags, ...c.review_detail })),
      warnings: meta.warnings } };
  if (scored._appraisal_error_count) result.meta = { ...result.meta, appraisal_errors_excluded: scored._appraisal_error_count };
  if (scored._appraisal_cap_band) result.meta = { ...result.meta, appraisal_cap_band: scored._appraisal_cap_band };
  if (eff.appraisal_mode) {
    result.meta = { ...result.meta,
      appraisal_primary_avg_cap: scored._appraisal_primary_avg_cap ?? null,
      appraisal_avg_below_subject_demoted: scored._appraisal_avg_demoted || 0,
      appraisal_recent_sales_9mo: scored._appraisal_recent_sales || 0 };
    // Surface (never silently pad) when the set lacks a handful of very recent sales.
    if ((scored._appraisal_recent_sales || 0) < APPRAISAL_RECENT_MIN) {
      result.meta.warnings = [...(result.meta.warnings || []),
        { scope: 'appraisal_recency', note: `only ${scored._appraisal_recent_sales || 0} sold comp(s) in the trailing ${APPRAISAL_RECENT_MONTHS} months (target ${APPRAISAL_RECENT_MIN}); reaching back up to 24 months` }];
    }
  }
  return result;
}

function appendNotes(...parts) {
  return parts.map(v => String(v || '').trim()).filter(Boolean).join(' | ') || undefined;
}

function workbookRowFromSynthComp(c) {
  const t = c.template || templateRow(c || {});
  const rba = t.rba_sf ?? c.building_sf ?? c.rba ?? c.building_size ?? null;
  const base = {
    address: t.address,
    city: t.city,
    state: t.state,
    rba,
    land: t.land,
    built: t.year_built,
    year_built: t.year_built,
    tenant: t.tenant,
    annual_noi: t.annual_noi,
    annual_rent: t.annual_rent,
    lease_expiration: t.lease_expiration,
    expenses: t.expenses,
    lease_type: t.lease_type,
    bumps: bumpsForWorkbook(t.bumps),
    renewal_options: renewalOptionsForWorkbook(t.renewal_options),
    initial_price: t.initial_price,
    initial_cap_rate: t.initial_cap_rate,
    initial_cap: t.initial_cap_rate,
    last_price: t.last_price,
    last_cap_rate: t.last_cap_rate,
    last_cap: t.last_cap_rate,
    cur_price: t.cur_price,
    current_cap_rate: t.current_cap_rate,
    current_cap: t.current_cap_rate,
    on_market: t.on_market,
    chairs: t.chairs,
    patients: t.patients,
    source: t.source,
    notes: appendNotes(
      c.score_tier ? `Score tier ${c.score_tier}` : null,
      Array.isArray(c.review_flags) && c.review_flags.length ? `Review: ${c.review_flags.join(', ')}` : null,
      c.notes || c.raw?.notes
    ),
  };
  for (const [k, v] of Object.entries(base)) {
    if (v === null || v === undefined || v === '') delete base[k];
  }
  return base;
}

// Prompt 56 — the On Market tab's STATUS column must never render blank. Default an
// Active/blank source status to "Available"; otherwise surface the real listing status
// (Under Contract, Pending, etc.) in a canonical Title-Case form. Sold has no STATUS column.
function normalizeListingStatus(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || /^(?:active|available|for\s*sale|on\s*market|live|new)$/i.test(s)) return 'Available';
  if (/under\s*contract|uc\b/i.test(s)) return 'Under Contract';
  if (/pending|in\s*escrow|escrow/i.test(s)) return 'Pending';
  if (/contingent/i.test(s)) return 'Contingent';
  // Unknown but non-blank → Title-Case it so a genuine status still shows (never blank).
  return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
function listingStatusFromComp(c) {
  const t = c?.template || {};
  return normalizeListingStatus(
    c?.listing_status ?? t.status ?? c?.status ?? c?.transaction_status
    ?? c?.raw?.status ?? c?.raw?.listing_status ?? null);
}

function isOnMarketComp(c) {
  if (c?.on_market === true) return true;
  const type = String(c?.comp_type || c?.status || c?.transaction_status || '').toLowerCase();
  if (/listing|active|on.?market|available/.test(type)) return true;
  const t = c?.template || {};
  return !t.sale_date && !c?.sale_date && !!(c?.ask_price || c?.list_price || c?.current_price || c?.cur_price);
}

// ── Comp DATA-QUALITY gates (Prompt 42, 2026-08-05) ─────────────────────────
// Impossible/blank values were reaching the export: negative or multi-thousand-day
// DOM (bad/after-sale list dates), negative bid-ask (sold recorded above ask). These
// gates run at the single workbook choke point so they cover ALL comp arms uniformly
// (dia-db, gov-db, salesforce). Mirrored SQL-side in the rpc_query_comps sold arm of
// each DB (dia/gov comp_data_quality_gates migrations) as defense-in-depth.
//   * DOM gate  — a sold list (ON MARKET) date is valid ONLY if it is strictly BEFORE
//     the sale date and within a sane window (<= MAX_SOLD_DOM_DAYS). Otherwise the list
//     date is blanked so DOM stays blank — never negative / never multi-thousand-day.
//   * Bid-ask gate — an INITIAL/LAST ask is trusted ONLY when it is >= the sale price
//     (normal down-negotiation). When sold > ask the ask is unreliable => blank it (no
//     negative bid-ask), and the comp is flagged for review.
// Blanks are never fabricated: a missing field stays missing.
const MAX_SOLD_DOM_DAYS = 1500;

function _compDate(v) {
  if (v == null || v === '') return null;
  const d = (v instanceof Date) ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function _compNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function _pushReviewFlag(row, flag) {
  if (!Array.isArray(row.review_flags)) row.review_flags = [];
  if (!row.review_flags.includes(flag)) row.review_flags.push(flag);
  row.notes = appendNotes(row.notes, `Review: ${flag}`);
}

// Gate a SOLD comp's derived DOM + bid-ask inputs in place. Returns the row.
export function applySoldCompGates(row) {
  const sale = _compDate(row.sale_date);
  const listed = _compDate(row.on_market);
  if (listed != null) {
    const days = sale != null ? Math.round((sale.getTime() - listed.getTime()) / 86400000) : null;
    const valid = sale != null && listed < sale && days != null && days <= MAX_SOLD_DOM_DAYS;
    if (!valid) {
      // Blank the list date so the workbook's DOM formula yields blank, never a
      // negative or absurd DOM. Flag only when the date is actually implausible.
      delete row.on_market;
      _pushReviewFlag(row, 'list_date_out_of_range');
    }
  }
  const sold = _compNum(row.sale_price);
  if (sold != null) {
    for (const k of ['initial_price', 'last_price']) {
      const ask = _compNum(row[k]);
      if (ask != null && ask < sold) {
        delete row[k];
        if (k === 'initial_price') delete row.initial_cap, delete row.initial_cap_rate;
        if (k === 'last_price') delete row.last_cap, delete row.last_cap_rate;
        _pushReviewFlag(row, 'ask_below_sale');
      }
    }
  }
  return row;
}

// Populate the PRICE CHG signal for an on-market row: the original ask differs from the
// current ask. initial_price is the ORIGINAL ask, cur/last the CURRENT ask (Prompt 42 item 3).
export function applyOnMarketPriceChange(row) {
  const initial = _compNum(row.initial_price);
  const current = _compNum(row.cur_price ?? row.last_price);
  const changed = initial != null && current != null && Math.abs(initial - current) >= 1;
  row.had_price_change = changed;
  row.price_changes = changed ? 1 : 0;
  if (changed && current > 0) row.pct_of_initial = +(current / initial).toFixed(4);
  return row;
}

function workbookRowsFromSynthResult(result) {
  const sold = [];
  const onMarket = [];
  for (const c of result?.comps || []) {
    const t = c.template || templateRow(c || {});
    const row = workbookRowFromSynthComp(c);
    if (isOnMarketComp(c)) {
      const price = t.cur_price ?? c.ask_price ?? c.list_price ?? c.current_price ?? c.cur_price ?? c.sale_price ?? c.sold_price ?? null;
      const listed = t.on_market || c.on_market_date || c.listing_date || c.date_listed || null;
      if (price != null) row.cur_price = price;
      if (price != null) row.initial_price = t.initial_price ?? c.initial_price ?? c.init_price ?? price;
      row.initial_cap_rate = t.initial_cap_rate ?? row.initial_cap_rate;
      row.initial_cap = row.initial_cap_rate;
      row.current_cap_rate = t.current_cap_rate ?? row.current_cap_rate;
      row.current_cap = row.current_cap_rate;
      row.last_price = t.last_price ?? row.last_price;
      row.last_cap_rate = t.last_cap_rate ?? row.last_cap_rate;
      row.last_cap = row.last_cap_rate;
      if (listed) row.on_market = listed;
      // Prompt 56 — STATUS never blank on the On Market tab (Active/blank → "Available").
      row.status = listingStatusFromComp(c);
      applyOnMarketPriceChange(row);
      onMarket.push(row);
    } else {
      row.sale_price = t.sale_price;
      row.sale_date = t.sale_date;
      row.initial_price = t.initial_price ?? row.initial_price;
      row.initial_cap_rate = t.initial_cap_rate ?? row.initial_cap_rate;
      row.initial_cap = row.initial_cap_rate;
      row.last_price = t.last_price ?? c.last_price ?? c.ask_price ?? c.list_price ?? undefined;
      row.last_cap_rate = t.last_cap_rate ?? row.last_cap_rate;
      row.last_cap = row.last_cap_rate;
      row.current_cap_rate = t.current_cap_rate ?? row.current_cap_rate;
      row.current_cap = row.current_cap_rate;
      row.on_market = t.on_market ?? row.on_market;
      if (t.sale_price == null) delete row.sale_price;
      if (!t.sale_date) delete row.sale_date;
      if (row.last_price == null) delete row.last_price;
      applySoldCompGates(row);
      sold.push(row);
    }
  }
  return { sold, on_market: onMarket };
}

// Prompt 56 — the displayed cap for a TEMPLATE row (rent÷price), the exact value the sheet
// shows: RENT = annual_rent (preferred) else annual_noi; PRICE = sale_price (sold) else the
// current ask. Keeps cap_rate_range on the same basis as the summary and the shipped rows.
function templateDisplayedCap(t) {
  const rent = displayedRentValue(t);
  const price = asNum(t?.sale_price) ?? asNum(t?.last_price) ?? asNum(t?.cur_price);
  if (rent && rent > 0 && price && price > 0) return +(rent / price).toFixed(6);
  return null;
}
function capRateRange(rows) {
  const pairs = rows
    .map(r => ({ cap: templateDisplayedCap(r), price: asNum(r.sale_price) ?? asNum(r.last_price) ?? asNum(r.cur_price) }))
    .filter(p => Number.isFinite(p.cap) && p.cap > 0);
  const caps = pairs.map(p => p.cap);
  if (!caps.length) return null;
  const weighted = pairs.reduce((acc, p) => {
    if (Number.isFinite(p.price) && p.price > 0) { acc.num += p.cap * p.price; acc.den += p.price; }
    return acc;
  }, { num: 0, den: 0 });
  return {
    min: Math.min(...caps),
    max: Math.max(...caps),
    median: caps.slice().sort((a, b) => a - b)[Math.floor(caps.length / 2)],
    weighted_avg: weighted.den ? weighted.num / weighted.den : null,
  };
}

function tierCounts(rows) {
  return rows.reduce((m, r) => {
    const tier = r.score_tier || 'C';
    m[tier] = (m[tier] || 0) + 1;
    return m;
  }, { A: 0, B: 0, C: 0 });
}

export async function runGenerateCompsFromRequest(args, deps, generateWorkbook) {
  const request = String(args?.request || '').trim();
  if (!request) return { error: 'generate_comps request mode requires `request`.' };
  if (typeof generateWorkbook !== 'function') return { error: 'generate_comps request mode is not configured.' };

  const rawSynthType = String(args?.synthesize_comp_type || '').toLowerCase();
  const rawCompType = rawSynthType || (String(args?.comp_type || '').toLowerCase() === 'lease' ? 'lease' : '');
  const synthCompType = rawCompType === 'lease' ? 'lease'
    : rawCompType === 'both' ? 'both'
    : rawCompType === 'sale' || rawCompType === 'sales' ? 'sale'
    : undefined;
  const synthArgs = {
    ...args,
    request,
    comp_type: synthCompType,
    limit: clampLimit(args?.limit, DEFAULT_SYNTHESIZE_LIMIT, MAX_SYNTHESIZE_LIMIT),
  };
  const oneShotParsed = parseRequest(request);
  const oneShotAppraisal = (args?.appraisal_mode != null) ? !!args.appraisal_mode : !!oneShotParsed.appraisal_mode;
  let synthesized;
  if (oneShotAppraisal) {
    const soldLimit = clampLimit(args?.limit, DEFAULT_SYNTHESIZE_LIMIT, MAX_SYNTHESIZE_LIMIT);
    const soldSynth = await runSynthesize({
      ...synthArgs,
      comp_type: 'sale',
      include_on_market: false,
      limit: soldLimit,
    }, deps);
    const marketSynth = await runSynthesize({
      ...synthArgs,
      comp_type: 'both',
      include_on_market: true,
      limit: MAX_SYNTHESIZE_LIMIT,
    }, deps);
    // On-market candidates arrive ranked (same similarity scoring as sold); curate
    // to the most-aligned APPRAISAL_ON_MARKET_CAP so the workbook On Market grid is a
    // template-fitting, readable set rather than the full national universe (Prompt 46).
    const marketAll = (marketSynth.comps || []).filter(isOnMarketComp);
    const marketRows = marketAll.slice(0, APPRAISAL_ON_MARKET_CAP);
    const combined = [...(soldSynth.comps || []), ...marketRows];
    synthesized = {
      ...soldSynth,
      comps: combined,
      template_comps: combined.map(c => c.template || templateRow(c)),
      summary: summarizeComps(combined, { ...(soldSynth.interpreted_query || {}), subject: soldSynth.subject || null }, soldSynth.meta || {}),
      transparency: `${transparencyLine(soldSynth.meta)}; on-market ${marketAll.length} found, curated to ${marketRows.length} most-aligned`,
      meta: {
        ...(soldSynth.meta || {}),
        returned: combined.length,
        sold_returned: soldSynth.comps?.length || 0,
        on_market_returned: marketRows.length,
        on_market_found: marketAll.length,
        on_market_curated_cap: APPRAISAL_ON_MARKET_CAP,
        excluded_subject: (soldSynth.meta?.excluded_subject || 0) + (marketSynth.meta?.excluded_subject || 0),
        independent_caps: true,
        on_market_candidate_total: marketSynth.meta?.candidate_total ?? marketAll.length,
        secondary_market_range: (soldSynth.meta?.secondary_market_range || 0) + (marketSynth.meta?.secondary_market_range || 0),
        warnings: [...(soldSynth.meta?.warnings || []), ...(marketSynth.meta?.warnings || [])],
      },
    };
  } else {
    synthesized = await runSynthesize(synthArgs, deps);
  }

  // Prompt 57 — lease-term + price discipline on the DISPLAYED appraisal set (runs BEFORE the
  // cap-band filter so the cap stats/ceiling are computed on a set that already excludes
  // no-term / short-term / no-price comps). A long-term subject appraisal must not show a comp
  // with no lease expiration, a remaining term at close below the floor, or (on-market) no
  // price. Excluded comps route to the review lane (sold rows land; on-market are counted in
  // meta for audit) and are kept for context stats — never deleted, never flag-and-shipped.
  // Active only in appraisal mode (the curated displayed set); quick pulls are untouched.
  if (oneShotAppraisal) {
    const minTerm = asNum(args?.min_remaining_term_years) ?? APPRAISAL_MIN_REMAINING_TERM_YEARS;
    const td = applyLeaseTermPriceDiscipline(synthesized.comps || [], { minTermYears: minTerm });
    if (td.excluded.length) {
      const kept = td.kept;
      const countReason = r => td.excluded.filter(x => x.reasons.includes(r)).length;
      synthesized = {
        ...synthesized,
        comps: kept,
        template_comps: kept.map(c => c.template || templateRow(c)),
        summary: summarizeComps(kept, { ...(synthesized.interpreted_query || {}), subject: synthesized.subject || null }, synthesized.meta || {}),
        meta: {
          ...(synthesized.meta || {}),
          returned: kept.length,
          displayed_min_remaining_term_years: minTerm,
          displayed_excluded_no_lease_term: countReason('no_lease_term'),
          displayed_excluded_short_lease_term: countReason('short_lease_term'),
          displayed_excluded_no_price: countReason('no_price'),
          displayed_excluded_term_or_price: td.excluded.length,
        },
      };
      // Route excluded comps to the existing domain review lane (never ship them). The
      // review producer keys on a source sale_id, so sold rows land; on-market rows (keyed
      // by listing_id) are captured in the meta counts above for audit.
      const flagged = td.excluded.map(({ comp, reasons, remaining_term }) => ({
        ...comp,
        review_flags: [...new Set([...(comp.review_flags || []), ...reasons.map(r => `excluded_${r}`)])].sort(),
        review_detail: { ...(comp.review_detail || {}), remaining_term_years: remaining_term, term_price_exclusion: true },
      }));
      try { await enqueueReviewQueue(flagged, deps); }
      catch (e) { console.warn(`[comps:prompt57] review enqueue failed: ${String(e && e.message || e)}`); }
    }
  }

  // Prompt 54 — enforce the cap-discipline band + reliability filter on the DISPLAYED set so
  // the rows that SHIP to the workbook obey the ceiling / reliability / average-below rules on
  // the same rent÷price basis the sheet shows. Bad-data rows (implausible cap / RENT-SF) route
  // to the review lane; above-ceiling and average-trim rows are context-only (kept for stats,
  // not shown). The response summary + cap range are recomputed from the kept set so they MATCH
  // the sheet, not a wider pre-filter set. Only active when a subject cap is known.
  {
    const dialysisForDiscipline = (synthesized.interpreted_query?.verticals || []).includes('dialysis')
      || !!synthesized.interpreted_query?.property_types?.includes?.('dialysis');
    const subjCap = asNum(synthesized.subject?.cap_rate ?? synthesized.subject?.fields?.cap_rate);
    const upperBps = asNum(args?.appraisal_cap_band_upper_bps ?? args?.cap_band_upper_bps) ?? APPRAISAL_DEFAULT_BAND_UPPER_BPS;
    const disc = applyDisplayedCapDiscipline(synthesized.comps || [], {
      subjectCap: subjCap, upperBps, isDialysis: dialysisForDiscipline,
    });
    if (disc.excludedBadData.length || disc.excludedContext.length) {
      const kept = disc.kept;
      synthesized = {
        ...synthesized,
        comps: kept,
        template_comps: kept.map(c => c.template || templateRow(c)),
        summary: summarizeComps(kept, { ...(synthesized.interpreted_query || {}), subject: synthesized.subject || null }, synthesized.meta || {}),
        meta: {
          ...(synthesized.meta || {}),
          returned: kept.length,
          displayed_cap_ceiling: subjCap != null ? +(subjCap + upperBps / 10000).toFixed(6) : null,
          displayed_excluded_above_ceiling: disc.excludedContext.filter(x => x.reason === 'above_subject_cap_ceiling').length,
          displayed_excluded_avg_trim: disc.excludedContext.filter(x => x.reason === 'trimmed_to_hold_avg_below_subject').length,
          displayed_excluded_bad_data: disc.excludedBadData.length,
        },
      };
      // Route reliability failures to the existing domain review lane — never ship them.
      if (disc.excludedBadData.length) {
        const flagged = disc.excludedBadData.map(({ comp, reasons, displayed_cap, displayed_rent_psf }) => ({
          ...comp,
          review_flags: [...new Set([...(comp.review_flags || []), ...reasons])].sort(),
          review_detail: { ...(comp.review_detail || {}), displayed_cap, displayed_rent_psf, reliability_exclusion: true },
        }));
        try { await enqueueReviewQueue(flagged, deps); }
        catch (e) { console.warn(`[comps:prompt54] review enqueue failed: ${String(e && e.message || e)}`); }
      }
    }
  }

  const { sold, on_market } = workbookRowsFromSynthResult(synthesized);
  if (!sold.length && !on_market.length) {
    return {
      error: 'No comp rows synthesized for workbook.',
      counts: { sold: 0, on_market: 0, total: 0 },
      subject: synthesized.subject || null,
      transparency: synthesized.transparency,
    };
  }

  const verticals = synthesized.interpreted_query?.verticals || [];
  const isDialysis = verticals.includes('dialysis') || synthesized.interpreted_query?.property_types?.includes('dialysis');
  const payload = {
    comp_type: 'sales',
    vertical: isDialysis ? 'dialysis' : undefined,
    on_market,
    sold,
    name: args?.name || synthesized.subject?.name || request,
    client: args?.client,
  };
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined || v === null || (Array.isArray(v) && !v.length)) delete payload[k];
  }

  const data = await generateWorkbook(payload);
  const rowsForSummary = synthesized.comps || [];
  return {
    status: data.status,
    filename: data.filename,
    download_url: data.download_url,
    counts: {
      sold: sold.length,
      on_market: on_market.length,
      total: sold.length + on_market.length,
    },
    cap_rate_range: capRateRange(synthesized.template_comps || []),
    tiers: tierCounts(rowsForSummary),
    flagged_count: synthesized.meta?.flagged_for_review || 0,
    // Prompt 57 — auditable exclusion counts for the review lane (no-term / short-term / no-price).
    excluded_for_review: {
      no_lease_term: synthesized.meta?.displayed_excluded_no_lease_term || 0,
      short_lease_term: synthesized.meta?.displayed_excluded_short_lease_term || 0,
      no_price: synthesized.meta?.displayed_excluded_no_price || 0,
      total: synthesized.meta?.displayed_excluded_term_or_price || 0,
      min_remaining_term_years: synthesized.meta?.displayed_min_remaining_term_years
        ?? APPRAISAL_MIN_REMAINING_TERM_YEARS,
    },
    subject: synthesized.subject || null,
    summary: synthesized.summary,
    transparency: synthesized.transparency,
    expires_in_seconds: data.expires_in_seconds,
  };
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
