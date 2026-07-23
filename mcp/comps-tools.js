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
  const isMedical = types.some(t => /medic|health|mob|dialysis|clinic/.test(t));
  const government_only = (govWords && !isMedical) ? true : !!a.government_only;
  // Government-only requests must NOT query the dialysis DB, or private DaVita/US Renal
  // comps bleed into a government set. Restrict to the gov vertical in that case.
  const verticals = a.verticals || (government_only ? ['government'] : ['government', 'dialysis']);
  return { verticals, government_only };
}
function scoreComp(c, a) {
  let s = 0;
  if (a.states?.includes(c.state)) s += 3;
  // Credit the normalized `use` too, so an agency's asset-class doubling (VA -> Medical Office)
  // ranks consistently rather than depending on the raw building_type value.
  if (a.property_types?.some(t => ((c.property_type || '') + ' ' + (c.use || '')).toLowerCase().includes(String(t).toLowerCase()))) s += 3;
  if (c.sale_date) { const age = (Date.now() - Date.parse(c.sale_date)) / 3.15e10; s += Math.max(0, 3 - age); }
  if (c.sale_price) s += 1;
  if (c.confidence) s += c.confidence;
  return +s.toFixed(2);
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
    p_limit: Math.min(args.limit || 200, 500),
    p_tenant: args.tenant || null,
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
export function parseRequest(text) {
  const raw = String(text || ''); const t = raw.toLowerCase(); const out = {};
  const states = new Set();
  for (const [name, ab] of Object.entries(US_STATES)) if (new RegExp(`\\b${name}\\b`).test(t)) states.add(ab);
  // Standalone 2-letter codes, but NOT 'VA' — in this domain "VA" means Veterans Affairs, not Virginia.
  for (const a of (raw.match(/\b[A-Z]{2}\b/g) || [])) if (STATE_ABBRS.has(a) && a !== 'VA') states.add(a);
  if (/\bnationwide\b|\bnational\b|across the (?:us|country)|\bu\.?s\.?a?\b/.test(t)) states.clear();
  if (states.size) out.states = [...states];
  const pt = new Set();
  if (/\b(medical|health|healthcare|mob|clinic|hospital)\b/.test(t)) pt.add('medical');
  if (/\b(dialysis|davita|fresenius)\b/.test(t)) pt.add('dialysis');
  if (/\boffice\b/.test(t)) pt.add('office');
  if (/\bretail\b/.test(t)) pt.add('retail');
  if (/\b(industrial|warehouse|flex)\b/.test(t)) pt.add('industrial');
  if (pt.size) out.property_types = [...pt];
  if (/\bva\b|veterans|gsa|federal|government|\bgov\b|\bagency\b|\bssa\b|social security|municipal|\birs\b|\bfbi\b|\bdea\b|uscis|\bhhs\b|\bihs\b/.test(t)) out.government_only = true;
  if (/on.?market|active listing|\bavailable\b|for sale/.test(t)) out.include_on_market = true;
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
  // Operator/tenant scoping — matched period-insensitively against tenant+operator in the RPC.
  const OPS = [
    [/\bu\.?\s*s\.?\s*renal\b|\busrc\b/, 'US Renal'], [/\bdavita\b/, 'DaVita'],
    [/\bfresenius\b|\bfmc\b/, 'Fresenius'], [/\bamerican renal\b/, 'American Renal'],
    [/\bsatellite (?:health|dialysis)\b/, 'Satellite'], [/\binnovative renal\b/, 'Innovative Renal'],
    [/\bdialysis clinic\b|\bdci\b/, 'Dialysis Clinic'], [/\bdsi\b/, 'DSI Renal'],
  ];
  for (const [re, name] of OPS) if (re.test(t)) { out.tenant = name; break; }
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
  // Displayed rent basis = what the template's SOLD CAP divides PRICE into.
  const displayedRent = isGov ? _reviewNum(c.noi) : _reviewNum(c.annual_rent);
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
  return { review_flags: flags,
    review_detail: { implied_cap: impliedCap, reliable_cap: reliableCap, rents, ask, sold } };
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

// ── THE SHARED CORE — every surface calls this ──────────────────────────────
// deps = { govQuery, diaQuery } (the server's PostgREST fetch helpers).
export async function runComps(args, deps) {
  const QUERY = { government: deps.govQuery, dialysis: deps.diaQuery };
  const params = argsToParams(args);
  const targets = args.verticals || ['government', 'dialysis'];
  const settled = await Promise.allSettled(targets.map(async v => {
    const q = QUERY[v]; if (!q) throw new Error(`unknown vertical ${v}`);
    const res = await q('POST', 'rpc/rpc_query_comps', params);
    if (!res.ok) throw new Error(`${v}: HTTP ${res.status}`);
    return Array.isArray(res.data) ? res.data : [];
  }));
  const rows = [], warnings = [];
  settled.forEach((s, i) => s.status === 'fulfilled'
    ? rows.push(...s.value)
    : warnings.push({ vertical: targets[i], error: String(s.reason?.message || s.reason) }));
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
  const flagged = [];
  for (const c of comps) {
    if (c.comp_type !== 'sale' || c.on_market === true || !_reviewNum(c.sale_price)) continue;
    const sig = computeReviewSignals(c);
    if (sig) { c.review_flags = sig.review_flags; c.review_detail = sig.review_detail; flagged.push(c); }
  }
  if (flagged.length) { try { await enqueueReviewQueue(flagged, deps); } catch { /* best-effort */ } }
  return { comps,
    meta: { returned: comps.length, total_before_cap: kept.length,
            truncated: kept.length > cap, excluded_unreliable_noi: before - kept.length,
            by_source: comps.reduce((m, r) => (m[r.source] = (m[r.source] || 0) + 1, m), {}),
            flagged_for_review: flagged.length,
            review_flags: flagged.map(c => ({
              comp_id: c.comp_id, address: c.address, city: c.city, state: c.state,
              tenant: c.tenant, sale_date: c.sale_date, flags: c.review_flags,
              ...c.review_detail })),
            warnings, interpreted_params: params } };
}

export async function runSynthesize(args, deps) {
  // Parse the raw request server-side, then let any explicit args override.
  const p = args.request ? parseRequest(args.request) : {};
  const eff = {
    ...args,
    states:            (args.states && args.states.length) ? args.states : p.states,
    property_types:    (args.property_types && args.property_types.length) ? args.property_types : p.property_types,
    government_only:   (args.government_only != null) ? args.government_only : p.government_only,
    date_from:         args.date_from || p.date_from,
    include_on_market: (args.include_on_market != null) ? args.include_on_market : p.include_on_market,
    include_unreliable_noi: (args.include_unreliable_noi != null) ? args.include_unreliable_noi : p.include_unreliable_noi,
    tenant:            args.tenant || p.tenant,
  };
  const route = routeIntent(eff);
  const { comps, meta } = await runComps({ ...eff, verticals: route.verticals,
    government_only: route.government_only, limit: 500 }, deps);
  const scored = comps.map(c => ({ ...c, _score: scoreComp(c, eff) }))
    .sort((x, y) => y._score - x._score).slice(0, Math.min(eff.limit || 100, 300));
  return { interpreted_query: {
      comp_type: eff.comp_type || 'sale', property_types: eff.property_types || null,
      states: eff.states || null, date_from: eff.date_from || null, tenant: eff.tenant || null,
      government_only: route.government_only, verticals: route.verticals },
    comps: scored,
    meta: { returned: scored.length,
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
        limit: { type: 'number' },
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
        limit: { type: 'number' },
      } },
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
  };
  return { defs, handlers };
}

// ── Surfaces 2 & 3: HTTP routes (Copilot Studio + ChatGPT GPT Actions) ──────
// Returns Express handlers. Mount behind the server's `authenticate` middleware.
export function makeCompsHttpRoutes({ govQuery, diaQuery }) {
  const deps = { govQuery, diaQuery };
  return {
    queryComps: async (req, res) => {
      try {
        const result = await runComps(req.body || {}, deps);
        res.json({ ...result, markdown: formatCompsMarkdown(result) });
      } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
    },
    synthesizeComps: async (req, res) => {
      try {
        const result = await runSynthesize(req.body || {}, deps);
        res.json({ ...result, markdown: formatCompsMarkdown(result) });
      } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
    },
  };
}
