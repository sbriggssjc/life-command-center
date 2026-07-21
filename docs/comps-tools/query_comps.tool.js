// =====================================================================
// query_comps + synthesize_comps  —  LCC MCP server tools
// Drop into life-command-center/mcp/ and register in server.js (see bottom).
// Read-only. Calls rpc_query_comps on each vertical's Supabase via PostgREST /rpc.
//
// Requires env (already used by the other MCP tools):
//   GOV_SUPABASE_URL / GOV_SUPABASE_KEY
//   DIA_SUPABASE_URL / DIA_SUPABASE_KEY
// Optional: SF_INSTANCE_URL (to build record deep links, e.g. https://northmarq.lightning.force.com)
// =====================================================================

const VERTICALS = {
  government: { url: process.env.GOV_SUPABASE_URL, key: process.env.GOV_SUPABASE_KEY },
  dialysis:   { url: process.env.DIA_SUPABASE_URL, key: process.env.DIA_SUPABASE_KEY },
};

// --- Property-type synonym expansion -------------------------------------------------
// Canonical request term -> the source values it should loosely match (ILIKE contains).
// Solves the live vocab split: SF says "Healthcare", gov properties say "Medical Office",
// dia says "Office"/"Healthcare". Callers pass a plain term; we expand it.
const TYPE_SYNONYMS = {
  medical:    ['Health', 'Medical', 'MOB', 'Clinic', 'Dialysis', 'Behavioral'],
  healthcare: ['Health', 'Medical', 'MOB', 'Clinic', 'Dialysis', 'Behavioral'],
  office:     ['Office'],
  retail:     ['Retail', 'Store', 'Bank'],
  industrial: ['Industrial', 'Warehouse', 'Flex'],
  dialysis:   ['Dialysis', 'DaVita', 'Fresenius'],
  government: ['Gov', 'GSA', 'Federal', 'VA', 'Agency'],
};
function expandTypes(types) {
  if (!types || !types.length) return null;
  const out = new Set();
  for (const t of types) {
    const key = String(t).toLowerCase().trim();
    (TYPE_SYNONYMS[key] || [t]).forEach(v => out.add(v));
  }
  return [...out];
}

// --- PostgREST RPC helper (same fetch pattern as the existing tools) -----------------
async function pgrestRpc(vertical, fnName, params) {
  const cfg = VERTICALS[vertical];
  if (!cfg?.url) throw new Error(`no config for vertical ${vertical}`);
  const res = await fetch(`${cfg.url}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`${vertical} ${fnName} ${res.status}: ${await res.text()}`);
  return res.json(); // array of canonical comp objects (jsonb rows)
}

// --- Cross-source dedup --------------------------------------------------------------
// Canonical vs SF normalize addresses differently, so recompute a consistent key here:
//   street token + city + state + sale-year. Prefer deterministic source_sf_id links first.
// Street-suffix synonyms so "4179 Baker St" and "4179 Baker Street" collapse to one key.
const STREET_SUFFIX = { st: 'street', str: 'street', ave: 'avenue', av: 'avenue', rd: 'road',
  blvd: 'boulevard', dr: 'drive', ln: 'lane', ct: 'court', cir: 'circle', pkwy: 'parkway',
  hwy: 'highway', pl: 'place', ter: 'terrace', sq: 'square', trl: 'trail', rte: 'route',
  n: 'north', s: 'south', e: 'east', w: 'west' };
function normStreet(a) {
  return String(a || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map(w => STREET_SUFFIX[w] || w).join('');
}
function normKey(c) {
  const street = normStreet(c.address);
  const city = String(c.city || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const yr = String(c.sale_date || '').slice(0, 4);
  return `${street}|${city}|${(c.state || '').toLowerCase()}|${yr}`;
}
function dedupe(rows) {
  const byId = new Map();       // source_sf_id -> canonical row (deterministic link)
  for (const r of rows) if (r.source_sf_id) byId.set(r.source_sf_id, r);
  const seen = new Map();
  const out = [];
  for (const r of rows) {
    // deterministic: an SF comp whose id is already present on a canonical row is a dup
    if (r.source === 'salesforce' && byId.has(r.source_sf_id) &&
        byId.get(r.source_sf_id).source !== 'salesforce') continue;
    const k = normKey(r);
    if (seen.has(k)) {
      // keep the higher-confidence / priced record; annotate the merge
      const prev = seen.get(k);
      const better = (r.sale_price && !prev.sale_price) || (r.confidence > prev.confidence);
      if (better) { out[out.indexOf(prev)] = r; seen.set(k, r); r._merged_with = (r._merged_with||[]).concat(prev.comp_id); }
      else { prev._merged_with = (prev._merged_with||[]).concat(r.comp_id); }
      continue;
    }
    seen.set(k, r); out.push(r);
  }
  return out;
}

// --- TOOL 1: query_comps -------------------------------------------------------------
async function queryComps(args = {}) {
  const params = {
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
  };
  const targets = args.verticals || ['government', 'dialysis'];
  const settled = await Promise.allSettled(targets.map(v => pgrestRpc(v, 'rpc_query_comps', params)));
  const rows = [], warnings = [];
  settled.forEach((s, i) => s.status === 'fulfilled'
    ? rows.push(...(Array.isArray(s.value) ? s.value : []))
    : warnings.push({ vertical: targets[i], error: String(s.reason?.message || s.reason) }));

  const merged = dedupe(rows);
  const by_source = merged.reduce((m, r) => (m[r.source] = (m[r.source] || 0) + 1, m), {});
  const truncated = merged.length > params.p_limit;
  return {
    comps: merged.slice(0, params.p_limit),
    meta: { returned: Math.min(merged.length, params.p_limit), total_before_cap: merged.length,
            truncated, by_source, warnings, interpreted_params: params },
  };
}

// --- TOOL 2: synthesize_comps (orchestrator) ----------------------------------------
// Routing table: which verticals + gov flag to use for an intent.
function routeIntent(parsed) {
  const types = (parsed.property_types || []).map(t => t.toLowerCase());
  const govWords = /va\b|gsa|federal|government|agency|state|municipal/i.test(parsed.request || '');
  const isMedical = types.some(t => /medic|health|mob|dialysis|clinic/.test(t));
  let verticals = ['government', 'dialysis'];
  if (types.includes('office') || types.includes('retail') || types.includes('industrial'))
    verticals = ['government', 'dialysis']; // dia contributes its office-rent rows; gov its stock
  return { verticals, government_only: govWords && !isMedical ? true : parsed.government_only || false };
}
// Transparent relevance score (higher = better fit to the request).
function scoreComp(c, parsed) {
  let s = 0;
  if (parsed.states?.includes(c.state)) s += 3;
  if (parsed.property_types?.some(t => (c.property_type || '').toLowerCase().includes(t.toLowerCase()))) s += 3;
  if (c.sale_date) { const age = (Date.now() - Date.parse(c.sale_date)) / 3.15e10; s += Math.max(0, 3 - age); }
  if (c.sale_price) s += 1;
  if (c.confidence) s += c.confidence;
  return +s.toFixed(2);
}
// parsed = { request, comp_type, property_types, states, metros, date_from, date_to,
//            size_min_sf, size_max_sf, government_only }  <-- produced by the LLM parse step
async function synthesizeComps(parsed, { export: exportFmt = 'none', limit = 100 } = {}) {
  const route = routeIntent(parsed);
  const res = await queryComps({ ...parsed, verticals: route.verticals,
                                 government_only: route.government_only, limit: 500 });
  const scored = res.comps.map(c => ({ ...c, _score: scoreComp(c, parsed) }))
                          .sort((a, b) => b._score - a._score).slice(0, limit);
  return {
    interpreted_query: parsed,
    routing: route,
    comps: scored,
    summary: { by_source: res.meta.by_source, returned: scored.length, warnings: res.meta.warnings },
    // export hook: hand `scored` to the briggs-comps template writer.
    // NEVER overwrite its formula-protected columns (RENT/SF, CAP RATE, TERM, DOM, PRICE/SF, EFFECTIVE RENT/SF).
    export: exportFmt,
  };
}

// --- MCP tool registration (adapt to server.js's registration style) ----------------
const QUERY_COMPS_TOOL = {
  name: 'query_comps',
  description: 'Pull sales or lease comps on demand across the dialysis DB, government DB, and ' +
    'Salesforce-staged comps, normalized to one shape and de-duplicated. Filters: comp_type, ' +
    'property_types (medical/office/retail/industrial/dialysis/government), states, metros, ' +
    'date window, size, government_only, include_on_market.',
  inputSchema: {
    type: 'object',
    properties: {
      comp_type: { type: 'string', enum: ['sale', 'lease', 'both'], default: 'sale' },
      verticals: { type: 'array', items: { type: 'string', enum: ['government', 'dialysis'] } },
      property_types: { type: 'array', items: { type: 'string' } },
      states: { type: 'array', items: { type: 'string' } },
      metros: { type: 'array', items: { type: 'string' } },
      date_from: { type: 'string' }, date_to: { type: 'string' },
      size_min_sf: { type: 'number' }, size_max_sf: { type: 'number' },
      government_only: { type: 'boolean' },
      include_salesforce: { type: 'boolean', default: true },
      include_on_market: { type: 'boolean', default: false },
      limit: { type: 'number', default: 200 },
    },
  },
};
const SYNTHESIZE_COMPS_TOOL = {
  name: 'synthesize_comps',
  description: 'Turn a plain-language comp request into one ranked, de-duplicated, template-ready ' +
    'comp set assembled from every relevant source (dialysis + government + Salesforce).',
  inputSchema: {
    type: 'object',
    required: ['request'],
    properties: {
      request: { type: 'string', description: 'plain-language comp request' },
      // The server should LLM-parse `request` into the queryComps args before calling synthesizeComps.
      export: { type: 'string', enum: ['sales_template', 'lease_template', 'none'], default: 'none' },
      limit: { type: 'number', default: 100 },
    },
  },
};

module.exports = { queryComps, synthesizeComps, QUERY_COMPS_TOOL, SYNTHESIZE_COMPS_TOOL, expandTypes, dedupe };

// ---- Registration example (match the pattern already in server.js) ----
//   const { queryComps, synthesizeComps, QUERY_COMPS_TOOL, SYNTHESIZE_COMPS_TOOL } = require('./query_comps.tool');
//   tools.push(QUERY_COMPS_TOOL, SYNTHESIZE_COMPS_TOOL);
//   case 'query_comps':      return jsonResult(await queryComps(args));
//   case 'synthesize_comps': return jsonResult(await synthesizeComps(await llmParse(args.request), args));
