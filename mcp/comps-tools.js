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
  if (/multi/i.test(String(raw.Tenancy__c || ''))) return true;
  if (Number(raw.Tenants__c) > 1) return true;
  const leased = Number(c.gov_sf_leased), rba = Number(c.rba || c.building_sf);
  if (leased && rba && leased < rba * 0.9) return true;
  return false;
}
// Multi-tenant naming: "[property abbrev] ([anchor/largest tenant])" — e.g. MOB (VA), MT (SSA),
// Park Place MOB (Concentra). Single-tenant comps keep the tenant/agency name unchanged.
function displayName(c) {
  const anchor = c.agency || c.tenant || '';
  if (!isMultiTenant(c)) return anchor || null;
  const named = String((c.raw || {}).property_name || '').trim();
  const abbr = named || _USE_ABBR[normalizeUse(c)] || 'MT';
  return anchor ? `${abbr} (${anchor})` : abbr;
}
// Reliability of a comp's NOI/cap for DEFAULT inclusion. Reliable = a human-sourced NOI/cap
// OR a NOI rolled from a prior actual NOI with captured escalations. NOT reliable = a pure
// market-benchmark modeled NOI, an implausible cap, or a comp with no NOI and no cap.
function noiIsReliable(c) {
  const q = String((c.raw || {}).cap_rate_quality || '').toLowerCase();
  if (/implausible/.test(q)) return false;
  const modeled = (c.noi_is_modeled === true || String(c.noi_is_modeled) === 'true');
  if (modeled) return /rolled|escalat|prior/i.test(String(c.noi_modeled_source || ''));
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
  if (/without noi|no noi|missing noi|estimated noi|modeled noi|include estimate|regardless of noi|all comps/.test(t)) out.include_unreliable_noi = true;
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
  // Normalize the `use` tag + apply the multi-tenant display name on every comp.
  for (const c of merged) {
    c.use = normalizeUse(c);
    const dn = displayName(c);
    if (dn) { c.tenant = dn; if (c.agency != null) c.agency = dn; }
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
  return { comps,
    meta: { returned: comps.length, total_before_cap: kept.length,
            truncated: kept.length > cap, excluded_unreliable_noi: before - kept.length,
            by_source: comps.reduce((m, r) => (m[r.source] = (m[r.source] || 0) + 1, m), {}),
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
      by_source: scored.reduce((m, r) => (m[r.source] = (m[r.source] || 0) + 1, m), {}), warnings: meta.warnings } };
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
  return `${head}\n${body}\n\n_${rows.length} comps (${bySrc})._`;
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
