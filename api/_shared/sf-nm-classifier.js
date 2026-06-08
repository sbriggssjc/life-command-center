// api/_shared/sf-nm-classifier.js
// ============================================================================
// Salesforce → Northmarq deal classifier (Round 74, Task 2)
//
// THE DURABLE CONFIG. This module is the single, versioned source of truth for
// three judgments the SF-authoritative `is_northmarq` pipeline needs, applied
// identically by BOTH the one-shot data.xlsx dry-run (scripts/sf-nm-dryrun.mjs)
// and the future live ingest endpoint (PA push → LCC classify → match → flag):
//
//   1. classifyVertical(deal)   — is this a DIALYSIS or GOVERNMENT deal?
//   2. classifyNmListing(deal)  — did Northmarq have the LISTING (is_northmarq)
//                                 vs buy-side only (is_northmarq_buyside)?
//   3. isExcludedFromComps(deal)— is this a real single-asset sale comp, or a
//                                 referral / advisory / fee / portfolio row?
//
// SCOTT'S INTEGRITY CONSTRAINT (Round 74): Salesforce is entered by many people,
// so a SINGLE field is never trusted. "Is Government" is not always checked and
// the "Dialysis" subtype is not always set (especially on multi-tenant deals).
// Every membership test therefore OR's together several independent signals and
// reports WHICH signals fired, so a missed flag on one field doesn't drop a deal
// we want. Multi-tenant deals (tenant strings joined by | / , & +) are split and
// EACH tenant is matched — a building where dialysis is one of several tenants
// still classifies as dia.
//
// AUTHORITATIVE NM RULE (Scott-confirmed): a deal is "Northmarq-listed" iff NM
// held the LISTING — in SF terms DIRECT/CO-BROKE ∈ {'Direct (Both)',
// 'Co-Broke (Seller)'} on a Northmarq broker team. Buy-side-only deals
// (Co-Broke (Buyer)) are NM track record but NOT NM-listed; they are tagged
// is_northmarq_buyside separately so the #20 value-prop cap chart (a listing-
// side comparison) is never polluted by buy-side caps.
//
// Empirical grounding: the dictionaries + thresholds below were validated
// against Scott's 285-row dialysis SF export (data.xlsx, 2026-06). See
// docs/architecture/salesforce_nm_authoritative_sync.md for the dry-run numbers.
// ============================================================================

// ── 1. DIALYSIS operator dictionary ─────────────────────────────────────────
// Canonical operator → match patterns (lowercased substring/regex, tested
// against each split tenant token). DaVita rolls up Total Renal Care + Renal
// Treatment Centers (legacy DaVita subsidiaries that still appear on deeds);
// Fresenius rolls up FMC + Bio-Med. Keep patterns specific enough that a
// non-dialysis tenant ("Bank of America") never trips them.
export const DIALYSIS_OPERATORS = [
  { name: 'DaVita',                patterns: [/\bdavita\b/, /\btotal renal care\b/, /\brenal treatment centers?\b/, /\bdva\b/] },
  { name: 'Fresenius',             patterns: [/\bfresenius\b/, /\bfmc\b/, /\bbio-?med\b/, /\bbiomedical applications\b/, /\bnational nephrology\b/] },
  { name: 'US Renal Care',         patterns: [/\bu\.?s\.? renal\b/, /\busrc\b/, /\bdialysis newco\b/] },
  { name: 'American Renal',        patterns: [/\bamerican renal\b/, /\bara\b/] },
  { name: 'Innovative Renal Care', patterns: [/\binnovative renal\b/, /\birc dialysis\b/] },
  { name: 'Satellite Healthcare',  patterns: [/\bsatellite healthcare\b/, /\bsatellite dialysis\b/, /\bwellbound\b/] },
  { name: 'Dialysis Clinic Inc',   patterns: [/\bdialysis clinic,? inc\b/, /\bdci\b/] },
  { name: 'Liberty Dialysis',      patterns: [/\bliberty dialysis\b/] },
  { name: 'Atlantic Dialysis',     patterns: [/\batlantic dialysis\b/] },
  { name: 'Dialysis Care Center',  patterns: [/\bdialysis care center\b/] },
  { name: 'Dialyze Direct',        patterns: [/\bdialyze direct\b/] },
  { name: 'Northwest Kidney',      patterns: [/\bnorthwest kidney\b/] },
  { name: 'Centers for Dialysis',  patterns: [/\bcenters? for dialysis care\b/] },
  { name: 'Aqua Dialysis',         patterns: [/\baqua dialysis\b/] },
  // Generic clinical kidney-care keywords — last-resort signal, lower weight.
  { name: 'Generic Dialysis',      patterns: [/\bdialysis\b/, /\bnephrology\b/, /\bkidney (care|center|institute|specialists)\b/], generic: true },
];

// ── 2. GOVERNMENT agency dictionary ─────────────────────────────────────────
// Federal / state / municipal tenant-or-agency patterns. Federal abbreviations
// are word-anchored so "VA" doesn't match a Virginia address fragment.
export const GOV_AGENCY_PATTERNS = [
  // Federal agencies
  /\bgsa\b/, /\bgeneral services administration\b/,
  /\bssa\b/, /\bsocial security\b/,
  /\bdhs\b/, /\bhomeland security\b/,
  /\bfbi\b/, /\bfederal bureau of investigation\b/,
  /\bdea\b/, /\birs\b/, /\binternal revenue\b/,
  /\busps\b/, /\bpostal service\b/, /\bpost office\b/,
  /\bva\b(?!\s*\d)/, /\bveterans\b/, /\bdepartment of veterans\b/,
  /\bice\b/, /\bcbp\b/, /\bcustoms and border\b/, /\bborder patrol\b/,
  /\batf\b/, /\bbureau of prisons\b/, /\bfederal courthouse\b/, /\bu\.?s\.? courts?\b/,
  /\bdepartment of (defense|justice|labor|agriculture|energy|interior|education|state|transportation|health)\b/,
  /\busda\b/, /\bnasa\b/, /\bnih\b/, /\bcdc\b/, /\bnoaa\b/, /\bfaa\b/, /\btsa\b/,
  /\bu\.?s\.? (government|federal|army|navy|air force|marshals?|attorney)\b/,
  /\bgeneral services\b/, /\bfederal (building|office|center)\b/,
  // State / local
  /\bstate of [a-z]/, /\bcounty of [a-z]/, /\bcity of [a-z]/,
  /\b(department|dept) of motor vehicles\b/, /\bdmv\b/,
  /\bsuperior court\b/, /\bcircuit court\b/, /\bmunicipal\b/,
];

// Government lease-number formats (GSA + legacy SJC gov IDs). When a deal
// carries a lease_number in one of these shapes it is government regardless of
// what the tenant string says.
export const GOV_LEASE_NUMBER_PATTERNS = [
  /^gs-?\d/i,        // GSA: GS-03B-..., GS-11P-...
  /^lvt\d/i, /^lfl\d/i, /^lok\d/i, /^lne\d/i,  // legacy regional gov lease IDs
  /^[A-Z]{2}\d{4,}/, // two-letter region + serial
];

// ── 3. Direct/Co-Broke → NM-listing role ────────────────────────────────────
// The canonical SF "Direct / Co-Broke" picklist values and the listing role
// each implies. 'Direct (Both)' = NM listed AND repped the buyer; for the
// is_northmarq (NM-LISTED) flag both Direct(Both) and Co-Broke(Seller) are TRUE.
export const NM_LISTING_DIRECT_VALUES = new Set(['direct (both)', 'co-broke (seller)']);
export const NM_BUYSIDE_DIRECT_VALUES = new Set(['co-broke (buyer)']);

// External (non-Northmarq) broker-team markers. The SF closed-won universe the
// PA flow exports is already NM-involved deals, so a present broker_team is a NM
// team by default; this blocklist is the escape hatch for any team string that
// is explicitly a co-broke external house. Extend as real values surface.
export const EXTERNAL_TEAM_PATTERNS = [/\bexternal\b/, /\bco-?broke only\b/, /\bn\/?a\b/i];

// Keywords that mark a row as NOT a single-asset sale comp (Task 4 exclusion).
export const NON_COMP_KEYWORDS = [
  /\breferral\b/, /\badvisory\b/, /\bconsult(ing|ation)?\b/, /\bfee only\b/,
  /\bbov\b/, /\bopinion of value\b/, /\bportfolio\b/, /\bmulti-?property\b/,
  /\bplaceholder\b/, /\btest deal\b/,
];

// ── field normalization ─────────────────────────────────────────────────────
// Map both the human data.xlsx headers AND the canonical PA-contract keys onto
// one snake_case shape. Header matching is case-insensitive and prefix-based so
// truncated Excel headers ("DIRECT / CO-BROKE", "LEASE TERM REMAINI…") resolve.
const FIELD_ALIASES = {
  sf_id:               ['sf id', 'sf_id', 'id', 'opportunity id', 'record id'],
  deal_name:           ['deal name', 'deal_name', 'name'],
  city:                ['city'],
  state:               ['state'],
  cbsa:                ['cbsa title', 'cbsa', 'metro'],
  tenant:              ['tenant'],
  building_sf:         ['building sf', 'building_sf', 'building size'],
  broker_team:         ['broker team', 'broker_team', 'team', 'lead broker', 'lead_broker'],
  ela:                 ['ela'],
  direct_co_broke:     ['direct / co-broke', 'direct/co-broke', 'direct_co_broke', 'direct co broke'],
  referral:            ['referral'],
  co_broke_internal:   ['co-broke internal', 'co_broke_internal'],
  sale_price:          ['sale price', 'sales price', 'sale_price', 'sold price'],
  deal_commission:     ['deal commission', 'deal_commission', 'commission'],
  cap_rate:            ['cap rate', 'cap_rate', 'sold cap'],
  property_type:       ['property type', 'property_type'],
  property_use:        ['property use', 'property_use'],
  specific_use:        ['specific use', 'specific_use', 'subtype', 'property subtype', 'property_subtype'],
  land_ownership:      ['land ownership', 'land_ownership', 'interest'],
  land_acres:          ['land acres', 'land_acres'],
  list_date:           ['list date', 'list_date', 'on market'],
  asking_list_price:   ['asking list price', 'asking_list_price'],
  marketing_cap_rate:  ['marketing cap rate', 'marketing_cap_rate'],
  lease_term_remaining:['lease term remaining', 'lease_term_remaining', 'ltr'],
  lease_term_years:    ['lease term years', 'lease_term_years', 'term'],
  time_on_market_days: ['time on market days', 'time_on_market_days', 'dom', 'days on market'],
  sale_conditions:     ['sale conditions', 'sale_conditions'],
  seller_company:      ['seller company', 'seller_company', 'seller'],
  seller_org_type:     ['seller org type', 'seller_org_type'],
  buyer_company:       ['buyer company', 'buyer_company', 'buyer'],
  buyer_contact_name:  ['buyer contact name', 'buyer_contact_name'],
  buyer_state:         ['buyer state', 'buyer_state', 'bstate'],
  buyer_org_type:      ['buyer org type', 'buyer_org_type', 'type2'],
  close_date:          ['close date', 'close_date', 'sale date', 'date'],
  // Optional signal columns a richer PA export can include:
  is_government:       ['is government', 'is_government'],
  lease_number:        ['lease number', 'lease_number', 'lease no', 'lease no.'],
  dia_property_id:     ['dia property id', 'dia_property_id'],
  gov_property_id:     ['gov property id', 'gov_property_id'],
};

function buildHeaderIndex(headers) {
  // headers: array of raw header strings. Returns {canonicalKey: columnIndex}.
  const idx = {};
  const lowered = headers.map((h) => String(h || '').trim().toLowerCase());
  for (const [canon, aliases] of Object.entries(FIELD_ALIASES)) {
    for (let i = 0; i < lowered.length; i++) {
      const h = lowered[i];
      if (aliases.some((a) => h === a || h.startsWith(a))) { idx[canon] = i; break; }
    }
  }
  return idx;
}

/**
 * Normalize a raw deal record (object keyed by header string, OR a {headers,row}
 * pair) to the canonical snake_case shape. Accepts:
 *   - an object: { 'DEAL NAME': ..., 'TENANT': ... }
 *   - a row+headers: normalizeDealRow(rowArray, headerArray)
 */
export function normalizeDealRow(raw, headers = null) {
  let getter;
  if (Array.isArray(raw)) {
    const idx = buildHeaderIndex(headers || []);
    getter = (canon) => (canon in idx ? raw[idx[canon]] : undefined);
  } else {
    const idx = buildHeaderIndex(Object.keys(raw || {}));
    const keys = Object.keys(raw || {});
    getter = (canon) => (canon in idx ? raw[keys[idx[canon]]] : raw[canon]);
  }
  const out = {};
  for (const canon of Object.keys(FIELD_ALIASES)) {
    let v = getter(canon);
    if (v === undefined || v === null) { out[canon] = null; continue; }
    out[canon] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function splitTenants(tenant) {
  if (!tenant) return [];
  return String(tenant)
    .split(/[|/,&+]| - |\bplus\b/i)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function truthyFlag(v) {
  if (v === true) return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === 'y' || s === 'yes' || s === '1' || s === 'x';
}

// ── classifyVertical ─────────────────────────────────────────────────────────
/**
 * Multi-strategy dia/gov membership. OR's several independent signals per
 * vertical and reports which fired. A deal can match both verticals (a
 * federally-leased building that also houses a dialysis clinic) — Scott's rule
 * is INCLUSIVE for dia: if any tenant is a dialysis operator, the deal is dia.
 *
 * @returns {{vertical:'dia'|'gov'|null, dia:boolean, gov:boolean,
 *            signals:string[], operators:string[], generic_only:boolean}}
 */
export function classifyVertical(deal) {
  const d = deal.deal_name === undefined ? normalizeDealRow(deal) : deal;
  const signals = [];
  const operators = [];
  let generic_only = true;

  const tenants = splitTenants(d.tenant);
  const dealNameLc = String(d.deal_name || '').toLowerCase();
  const useLc = `${d.property_use || ''} ${d.specific_use || ''} ${d.property_type || ''}`.toLowerCase();

  // ── dia signals ──
  for (const op of DIALYSIS_OPERATORS) {
    const hit = tenants.some((t) => op.patterns.some((p) => p.test(t)));
    if (hit) {
      operators.push(op.name);
      if (!op.generic) generic_only = false;
      signals.push(`tenant_operator:${op.name}`);
    }
  }
  if (/\bdialysis\b/.test(useLc) || /\brenal\b/.test(useLc)) { signals.push('property_use:dialysis'); generic_only = false; }
  if (DIALYSIS_OPERATORS.some((op) => !op.generic && op.patterns.some((p) => p.test(dealNameLc)))) {
    signals.push('deal_name:operator'); generic_only = false;
  } else if (/\bdialysis\b/.test(dealNameLc)) {
    signals.push('deal_name:dialysis');
  }
  if (d.dia_property_id) { signals.push('linked:dia_property_id'); generic_only = false; }
  const dia = operators.length > 0
    || signals.some((s) => s.startsWith('property_use:') || s === 'deal_name:operator' || s === 'linked:dia_property_id')
    || signals.includes('deal_name:dialysis');

  // ── gov signals ──
  const govHay = `${d.tenant || ''} ${d.deal_name || ''} ${d.seller_company || ''}`.toLowerCase();
  let gov = false;
  if (truthyFlag(d.is_government)) { signals.push('flag:is_government'); gov = true; }
  if (GOV_AGENCY_PATTERNS.some((p) => p.test(govHay))) { signals.push('tenant_agency'); gov = true; }
  if (d.lease_number && GOV_LEASE_NUMBER_PATTERNS.some((p) => p.test(String(d.lease_number).trim()))) {
    signals.push('lease_number:gov'); gov = true;
  }
  if (d.gov_property_id) { signals.push('linked:gov_property_id'); gov = true; }
  if (/\bgsa\b|\bfederal\b|\bgovernment\b/.test(useLc)) { signals.push('property_use:gov'); gov = true; }

  // ── resolve ──
  // Inclusive-dia rule: a real dialysis-operator tenant wins even when a gov
  // signal also fires (multi-tenant fed+clinic building). A generic-only dia
  // hit ("…dialysis…" keyword with no named operator) defers to a strong gov
  // signal (named agency / lease-number / flag).
  let vertical = null;
  const strongGov = gov && (signals.includes('flag:is_government') || signals.includes('tenant_agency')
    || signals.includes('lease_number:gov') || signals.includes('linked:gov_property_id'));
  if (dia && (!generic_only || !strongGov)) vertical = 'dia';
  else if (gov) vertical = 'gov';
  else if (dia) vertical = 'dia';

  return { vertical, dia, gov, signals, operators, generic_only };
}

// ── classifyNmListing ────────────────────────────────────────────────────────
/**
 * NM-listing role from Direct/Co-Broke + broker team. The PA flow exports only
 * NM-involved closed-won deals, so a present, non-external broker_team is a
 * Northmarq team. is_northmarq (NM-LISTED) is the value-prop chart flag;
 * is_northmarq_buyside is the buy-side-only track-record flag.
 *
 * @returns {{is_northmarq:boolean, is_northmarq_buyside:boolean,
 *            listing_role:'listing'|'buyside'|'unknown', nm_team:boolean,
 *            reason:string}}
 */
export function classifyNmListing(deal) {
  const d = deal.direct_co_broke === undefined && deal.deal_name === undefined
    ? normalizeDealRow(deal) : deal;
  const dc = String(d.direct_co_broke || '').trim().toLowerCase();
  const team = String(d.broker_team || '').trim();
  // The PA flow exports ONLY NM-involved closed-won deals, and Direct/Co-Broke
  // already encodes WHICH SIDE NM was on (Seller=listing, Buyer=buy-side). So a
  // present team is NM by default and a MISSING team is just absent data — it
  // must NOT demote a listing-side deal (Scott's "don't lose a deal to one
  // empty field"). nm_team is FALSE only on a positively-external marker.
  const externalTeam = !!team && EXTERNAL_TEAM_PATTERNS.some((p) => p.test(team.toLowerCase()));
  const nm_team = !externalTeam;
  const nm_team_source = team ? (externalTeam ? 'external' : 'named') : 'assumed_from_universe';

  if (NM_LISTING_DIRECT_VALUES.has(dc)) {
    if (nm_team) return { is_northmarq: true, is_northmarq_buyside: false, listing_role: 'listing', nm_team, nm_team_source, reason: `nm_listed:${dc}` };
    return { is_northmarq: false, is_northmarq_buyside: false, listing_role: 'listing', nm_team, nm_team_source, reason: 'listing_role_but_external_team' };
  }
  if (NM_BUYSIDE_DIRECT_VALUES.has(dc)) {
    return { is_northmarq: false, is_northmarq_buyside: nm_team, listing_role: 'buyside', nm_team, nm_team_source, reason: nm_team ? 'nm_buyside' : 'buyside_external_team' };
  }
  return { is_northmarq: false, is_northmarq_buyside: false, listing_role: 'unknown', nm_team, nm_team_source, reason: dc ? `unmapped_direct:${dc}` : 'no_direct_co_broke' };
}

// ── isExcludedFromComps ──────────────────────────────────────────────────────
/**
 * Identify rows that are NOT single-asset sale comps — referral/advisory/fee
 * engagements, portfolio/multi-property rows, and rows with no closed sale
 * price. Used by Task 4 (missing-deal import) to drop non-comps before staging.
 *
 * @returns {{excluded:boolean, reasons:string[]}}
 */
export function isExcludedFromComps(deal) {
  const d = deal.sale_price === undefined && deal.deal_name === undefined ? normalizeDealRow(deal) : deal;
  const reasons = [];
  const price = num(d.sale_price);
  if (price === null || price <= 0) reasons.push('no_sale_price');
  const hay = `${d.deal_name || ''} ${d.sale_conditions || ''}`.toLowerCase();
  for (const re of NON_COMP_KEYWORDS) if (re.test(hay)) reasons.push(`keyword:${re.source}`);
  return { excluded: reasons.length > 0, reasons };
}

// ── classifyDeal (one call) ──────────────────────────────────────────────────
/**
 * Run all three classifiers over a raw or normalized deal and return the merged
 * verdict the ingest endpoint + dry-run both record.
 */
export function classifyDeal(raw) {
  const deal = raw.deal_name === undefined ? normalizeDealRow(raw) : raw;
  const vertical = classifyVertical(deal);
  const nm = classifyNmListing(deal);
  const comp = isExcludedFromComps(deal);
  return {
    sf_id: deal.sf_id || null,
    deal_name: deal.deal_name || null,
    state: deal.state || null,
    close_date: deal.close_date || null,
    sale_price: num(deal.sale_price),
    cap_rate: num(deal.cap_rate),
    vertical: vertical.vertical,
    vertical_signals: vertical.signals,
    operators: vertical.operators,
    is_northmarq: nm.is_northmarq,
    is_northmarq_buyside: nm.is_northmarq_buyside,
    listing_role: nm.listing_role,
    nm_reason: nm.reason,
    is_comp: !comp.excluded,
    exclude_reasons: comp.reasons,
    is_northmarq_source: 'salesforce',
  };
}
