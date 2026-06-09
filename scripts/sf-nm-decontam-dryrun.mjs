// scripts/sf-nm-decontam-dryrun.mjs
// ============================================================================
// Round 74c — de-contaminate is_northmarq against the SF *Internal Comp* export.
//
// Repointed from R74's sf-nm-dryrun.mjs (Deal/Opportunity object, CSV-fed) to the
// authoritative SF *Comp* object, now staged per-project in:
//
//     public.sf_internal_comp_export
//
// NM signal on the Comp object is the row's existence: Comp Type = 'Internal' =
// a Northmarq/SJC-brokered sale (Scott-confirmed). The export carries ONLY Internal
// rows, so the closed NM universe is simply status='Sold'. There are no broker /
// Direct-Co-Broke columns on the Comp object, so buy-side cannot be split from
// listing-side here (minor population caveat — note it, don't try to infer it).
//
// This is READ-ONLY. It prints the de-contamination plan JSON (the gate input):
//   per-vertical add / remove / net, the matched SF Id <-> sale_id map, the
//   competitor-broker remove buckets, NM-vs-market cap averages (the #20 line),
//   and the count/$ of Internal comps that match nothing (import candidates).
// No flag flips — those live in the gated scripts/applied/sf-nm-*-r74c-*.sql.
//
// Usage:
//   DIA_SUPABASE_URL=... DIA_SUPABASE_SERVICE_KEY=... \
//   GOV_SUPABASE_URL=... GOV_SUPABASE_SERVICE_KEY=... \
//   node scripts/sf-nm-decontam-dryrun.mjs [dia|gov|both] [--json out.json]
//
// Match rule (the established tolerant gate): state + sold_date +/-120d +
//   sold_price +/-6%; confirm with city OR tenant(agency); best-per-comp, then
//   one comp per sale (1:1). dia resolves state/city/tenant via properties;
//   gov carries them on sales_transactions directly (tenant := agency/agency_full).
// ============================================================================

const VERTICALS = {
  dia: {
    project: 'Dialysis_DB',
    urlEnv: 'DIA_SUPABASE_URL', keyEnv: 'DIA_SUPABASE_SERVICE_KEY',
    // sales joined to properties for the geo/tenant signal
    salesSelect:
      'sale_id,sale_date,sold_price,is_northmarq,is_northmarq_source,listing_broker,procuring_broker,cap_rate,cap_rate_final,properties(state,city,tenant,operator)',
    rowToSale: (r) => ({
      sale_id: r.sale_id, sale_date: r.sale_date, sold_price: num(r.sold_price),
      is_northmarq: r.is_northmarq === true,
      brokers: [r.listing_broker, r.procuring_broker],
      cap: num(r.cap_rate_final) ?? num(r.cap_rate),
      state: up(r.properties?.state), city: low(r.properties?.city),
      tenant: r.properties?.tenant, operator: r.properties?.operator,
    }),
  },
  gov: {
    project: 'government',
    urlEnv: 'GOV_SUPABASE_URL', keyEnv: 'GOV_SUPABASE_SERVICE_KEY',
    salesSelect:
      'sale_id,sale_date,sold_price,is_northmarq,listing_broker,purchasing_broker,sold_cap_rate,state,city,agency,agency_full',
    rowToSale: (r) => ({
      sale_id: r.sale_id, sale_date: r.sale_date, sold_price: num(r.sold_price),
      is_northmarq: r.is_northmarq === true,
      brokers: [r.listing_broker, r.purchasing_broker],
      cap: num(r.sold_cap_rate),
      state: up(r.state), city: low(r.city),
      tenant: r.agency, operator: r.agency_full,
    }),
  },
};

const COMPETITOR_RE = /(marcus|millichap|m&m|cbre|jll|colliers|cushman|newmark|stan johnson|sands inv|encore|matthews|sab capital|capital pacific|b\+e)/i;
const NM_RE = /(northmarq|briggs|sjc|stinson|gartman)/i;

const num = (x) => (x == null || x === '' ? null : +x);
const up = (x) => (x == null ? null : String(x).trim().toUpperCase());
const low = (x) => (x == null ? null : String(x).trim().toLowerCase());
const firstTok = (s) => (s ? String(s).trim().split(/\s+/)[0] : '');
const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

async function pgFetch(base, key, path) {
  // PostgREST with service key; paginate past the 1000-row cap.
  const out = [];
  for (let from = 0; ; from += 1000) {
    const url = `${base}/rest/v1/${path}`;
    const res = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}`, Prefer: 'count=exact' },
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()} (${path})`);
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

function tenantOk(comp, sale) {
  const t = firstTok(comp.tenant);
  if (!t) return false;
  const hay = `${sale.tenant || ''} ${sale.operator || ''}`.toLowerCase();
  return hay.includes(t.toLowerCase());
}

// rank: both-confirm > tenant-only > city-only, then closeness
function rank(c) {
  return [(c.city_ok && c.tenant_ok) ? 0 : 1, c.tenant_ok ? 0 : 1, c.city_ok ? 0 : 1, c.price_diff_pct, c.date_diff];
}
const lessRank = (a, b) => { const ra = rank(a), rb = rank(b); for (let i = 0; i < ra.length; i++) { if (ra[i] !== rb[i]) return ra[i] < rb[i]; } return false; };

function pct(arr) {
  const xs = arr.filter((x) => x != null && x > 0.005 && x < 0.30).sort((a, b) => a - b);
  if (!xs.length) return null;
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  const med = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
  return { n: xs.length, avg_pct: +(avg * 100).toFixed(2), median_pct: +(med * 100).toFixed(2) };
}

async function runVertical(name) {
  const cfg = VERTICALS[name];
  const base = process.env[cfg.urlEnv], key = process.env[cfg.keyEnv];
  if (!base || !key) { console.error(`[skip ${name}] set ${cfg.urlEnv} + ${cfg.keyEnv}`); return null; }

  const comps = (await pgFetch(base, key, `sf_internal_comp_export?status=eq.Sold&select=sf_comp_id,tenant,city,state,sold_price,sold_date,sold_cap_rate`))
    .map((c) => ({ ...c, state: up(c.state), c_city: low(c.city), price: num(c.sold_price), date: c.sold_date, cap: num(c.sold_cap_rate) }));
  const sales = (await pgFetch(base, key, `sales_transactions?select=${cfg.salesSelect}`)).map(cfg.rowToSale);

  // candidate pairs
  const byState = new Map();
  for (const s of sales) { if (!s.state || s.sold_price == null) continue; (byState.get(s.state) || byState.set(s.state, []).get(s.state)).push(s); }
  const cand = [];
  for (const c of comps) {
    if (c.price == null) continue;
    for (const s of (byState.get(c.state) || [])) {
      if (days(s.sale_date, c.date) > 120) continue;
      const pdiff = Math.abs(s.sold_price - c.price) / c.price;
      if (pdiff > 0.06) continue;
      const city_ok = !!(s.city && c.c_city && s.city === c.c_city);
      const ten_ok = tenantOk(c, s);
      if (!city_ok && !ten_ok) continue;
      cand.push({ sf_comp_id: c.sf_comp_id, sale_id: s.sale_id, price_diff_pct: +pdiff.toFixed(4), date_diff: days(s.sale_date, c.date), city_ok, tenant_ok: ten_ok, sale: s });
    }
  }
  // best per comp, then one comp per sale (1:1)
  const bestComp = new Map();
  for (const p of cand) { const cur = bestComp.get(p.sf_comp_id); if (!cur || lessRank(p, cur)) bestComp.set(p.sf_comp_id, p); }
  const bestSale = new Map();
  for (const p of bestComp.values()) { const cur = bestSale.get(p.sale_id); if (!cur || lessRank(p, cur)) bestSale.set(p.sale_id, p); }
  const matched = [...bestSale.values()];
  const matchedSaleIds = new Set(matched.map((m) => m.sale_id));

  const adds = matched.filter((m) => !m.sale.is_northmarq).map((m) => m.sale_id);
  const flagged = sales.filter((s) => s.is_northmarq);
  const unmatchedFlagged = flagged.filter((s) => !matchedSaleIds.has(s.sale_id));
  const brokerStr = (s) => `${s.brokers[0] || ''} ${s.brokers[1] || ''}`;
  const bucket = (s) => COMPETITOR_RE.test(brokerStr(s)) ? 'competitor'
    : NM_RE.test(brokerStr(s)) ? 'nm'
    : (!String(s.brokers[0] || '').trim() && !String(s.brokers[1] || '').trim()) ? 'null' : 'other';
  const removeBuckets = { competitor: [], nm: [], null: [], other: [] };
  for (const s of unmatchedFlagged) removeBuckets[bucket(s)].push(s.sale_id);

  const matchedComps = new Set(bestComp.keys());
  const importCandidates = comps.filter((c) => !matchedComps.has(c.sf_comp_id));

  return {
    vertical: name, project: cfg.project,
    universe: { internal_sold: comps.length, sold_with_price: comps.filter((c) => c.price != null).length },
    matching: { distinct_matched_sales: matched.length, confirmed_comps: matchedComps.size,
      confirmation_mix: { city_and_tenant: matched.filter((m) => m.city_ok && m.tenant_ok).length,
        tenant_only: matched.filter((m) => m.tenant_ok && !m.city_ok).length,
        city_only: matched.filter((m) => m.city_ok && !m.tenant_ok).length } },
    rederive: { current_flagged: flagged.length, new_adds: adds.length,
      flagged_unmatched: unmatchedFlagged.length,
      confident_removes_competitor: removeBuckets.competitor,
      staged_removes_held: { nm_keep: removeBuckets.nm.length, null_hold: removeBuckets.null.length, other_hold: removeBuckets.other.length } },
    topic20: {
      nm_alltime: pct(matched.map((m) => m.sale.cap)),
      market_nonnm_alltime: pct(sales.filter((s) => !matchedSaleIds.has(s.sale_id)).map((s) => s.cap)),
      nm_export_alltime: pct(comps.map((c) => c.cap)),
    },
    import_candidates: { comps: importCandidates.length, priced: importCandidates.filter((c) => c.price != null).length,
      volume_usd_mm_priced: +(importCandidates.reduce((a, c) => a + (c.price || 0), 0) / 1e6).toFixed(1) },
    sf_id_to_sale_id: Object.fromEntries(matched.map((m) => [m.sf_comp_id, m.sale_id])),
    add_sample: adds.slice(0, 30),
    competitor_remove_sample: removeBuckets.competitor.slice(0, 30),
  };
}

const arg = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'both';
const which = arg === 'both' ? ['dia', 'gov'] : [arg];
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

const plan = { round: '74c', generated_at: new Date().toISOString(), source: 'public.sf_internal_comp_export (status=Sold)', verticals: {} };
for (const v of which) { const r = await runVertical(v); if (r) plan.verticals[v] = r; }
console.log(JSON.stringify(plan, null, 2));
if (jsonOut) { const fs = await import('node:fs'); fs.writeFileSync(jsonOut, JSON.stringify(plan, null, 2)); console.error(`[wrote ${jsonOut}]`); }
