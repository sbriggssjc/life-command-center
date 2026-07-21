// ============================================================================
// comps-tools.js — query_comps + synthesize_comps for the LCC MCP server
// ESM module. Wired in server.js via:
//   import { makeCompsTools } from "./comps-tools.js";
//   const { defs, handlers } = makeCompsTools({ govQuery, diaQuery, textResult, withTiming });
//   Object.assign(TOOL_DEFINITIONS, defs); Object.assign(TOOL_HANDLERS, handlers);
//
// Reads canonical + Salesforce-staged comps via rpc_query_comps on each vertical.
// Read-only. Validated end-to-end against live gov + dia RPCs on 2026-07-21.
// ============================================================================

// Canonical request term -> source values it should loosely match (ILIKE contains).
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
export function dedupe(rows) {
  const byId = new Map();
  for (const r of rows) if (r.source_sf_id) byId.set(r.source_sf_id, r);
  const seen = new Map(); const out = [];
  for (const r of rows) {
    if (r.source === 'salesforce' && byId.has(r.source_sf_id) && byId.get(r.source_sf_id).source !== 'salesforce') continue;
    const k = normKey(r);
    if (seen.has(k)) {
      const prev = seen.get(k);
      const better = (r.sale_price && !prev.sale_price) || (r.confidence > prev.confidence);
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
  return { verticals: a.verticals || ['government', 'dialysis'],
           government_only: (govWords && !isMedical) ? true : !!a.government_only };
}
function scoreComp(c, a) {
  let s = 0;
  if (a.states?.includes(c.state)) s += 3;
  if (a.property_types?.some(t => (c.property_type || '').toLowerCase().includes(String(t).toLowerCase()))) s += 3;
  if (c.sale_date) { const age = (Date.now() - Date.parse(c.sale_date)) / 3.15e10; s += Math.max(0, 3 - age); }
  if (c.sale_price) s += 1;
  if (c.confidence) s += c.confidence;
  return +s.toFixed(2);
}

export function makeCompsTools({ govQuery, diaQuery, textResult, withTiming }) {
  const QUERY = { government: govQuery, dialysis: diaQuery };

  async function runRpc(args) {
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
    return { rows: dedupe(rows), warnings, params };
  }

  async function queryComps(args = {}) {
    return withTiming('query_comps', async () => {
      const { rows, warnings, params } = await runRpc(args);
      const cap = params.p_limit;
      const by_source = rows.reduce((m, r) => (m[r.source] = (m[r.source] || 0) + 1, m), {});
      return textResult({ comps: rows.slice(0, cap),
        meta: { returned: Math.min(rows.length, cap), total_before_cap: rows.length,
                truncated: rows.length > cap, by_source, warnings } });
    });
  }

  async function synthesizeComps(args = {}) {
    return withTiming('synthesize_comps', async () => {
      const route = routeIntent(args);
      const { rows, warnings } = await runRpc({ ...args, verticals: route.verticals,
        government_only: route.government_only, limit: 500 });
      const scored = rows.map(c => ({ ...c, _score: scoreComp(c, args) }))
        .sort((x, y) => y._score - x._score).slice(0, Math.min(args.limit || 100, 300));
      return textResult({ interpreted_query: {
          comp_type: args.comp_type || 'sale', property_types: args.property_types || null,
          states: args.states || null, government_only: route.government_only, verticals: route.verticals },
        comps: scored,
        summary: { returned: scored.length,
          by_source: scored.reduce((m, r) => (m[r.source] = (m[r.source] || 0) + 1, m), {}), warnings },
        note: 'Hand comps to the briggs-comps template writer; do not overwrite formula-protected columns.' });
    });
  }

  const defs = {
    query_comps: {
      name: 'query_comps',
      description: "Pull sales comps on demand across the dialysis DB, government DB, and Salesforce-staged comps, normalized to one shape and de-duplicated. Canonical closed sales are gated to transaction_state='live'; Salesforce comps come from sf_comp_staging. Filters below; property_types accepts plain terms (medical, office, retail, industrial, dialysis, government) which are expanded to source synonyms. Cap rates are returned as decimals; confidential $0 sales are flagged price_withheld.",
      inputSchema: { type: 'object', properties: {
        comp_type: { type: 'string', enum: ['sale', 'lease', 'both'], description: "default 'sale'" },
        verticals: { type: 'array', items: { type: 'string', enum: ['government', 'dialysis'] } },
        property_types: { type: 'array', items: { type: 'string' }, description: 'e.g. ["medical"], ["office"]' },
        states: { type: 'array', items: { type: 'string' }, description: '2-letter, e.g. ["OK","TX"]' },
        metros: { type: 'array', items: { type: 'string' } },
        date_from: { type: 'string', description: 'ISO date' }, date_to: { type: 'string', description: 'ISO date' },
        size_min_sf: { type: 'number' }, size_max_sf: { type: 'number' },
        government_only: { type: 'boolean' },
        include_salesforce: { type: 'boolean', description: 'default true' },
        include_on_market: { type: 'boolean', description: 'default false (closed only)' },
        limit: { type: 'number', description: 'default 200, max 500' },
      } },
    },
    synthesize_comps: {
      name: 'synthesize_comps',
      description: "Assemble one ranked, de-duplicated comp set from every relevant source for a plain-language request. Parse the user's request into the structured fields below (property_types, states, comp_type, date window, size) and pass them; optionally include the original text as `request` so routing can detect government intent (VA/GSA/federal). Returns comps scored by relevance, ready for the briggs-comps template.",
      inputSchema: { type: 'object', properties: {
        request: { type: 'string', description: 'original plain-language request (used for gov-intent routing)' },
        comp_type: { type: 'string', enum: ['sale', 'lease', 'both'] },
        property_types: { type: 'array', items: { type: 'string' } },
        states: { type: 'array', items: { type: 'string' } },
        metros: { type: 'array', items: { type: 'string' } },
        date_from: { type: 'string' }, date_to: { type: 'string' },
        size_min_sf: { type: 'number' }, size_max_sf: { type: 'number' },
        government_only: { type: 'boolean' },
        include_on_market: { type: 'boolean' },
        limit: { type: 'number', description: 'default 100, max 300' },
      } },
    },
  };

  return { defs, handlers: { query_comps: queryComps, synthesize_comps: synthesizeComps } };
}
