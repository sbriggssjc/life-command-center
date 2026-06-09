// scripts/sf-nm-decontam-dryrun.mjs
// ============================================================================
// Round 74b — live de-contamination dry-run, sourced from sf_deal_staging.
//
// Pulls the deduped CLOSED Salesforce deals straight from a domain project's
// sf_deal_staging (no manual export step), classifies them with the durable
// classifier, fingerprint-matches the NM-listed comps to sales_transactions,
// and emits the add/remove plan — the same doctrine as the data.xlsx Task-3 fix:
//   ADD    = city-confirmed SF NM-listed match that is NOT currently flagged
//   REMOVE = currently-flagged sale with NO NM-listed match AND an explicit
//            national-competitor listing broker (definitively not NM-listed)
//   HOLD   = null/personal-broker removes, SJC/NM-broker removes (keep flagged),
//            non-city-confirmed adds, SF NM-listed deals matching nothing (Task 4)
//
// READ-ONLY. Writes nothing to any DB. Output is the gate JSON for Scott.
//
// Usage (env carries the service creds — same convention as the geocode script):
//   DIA_SUPABASE_URL=… DIA_SUPABASE_SERVICE_KEY=… \
//     node scripts/sf-nm-decontam-dryrun.mjs --domain dia --out /tmp/dia_decontam.json
//   GOV_SUPABASE_URL=… GOV_SUPABASE_SERVICE_KEY=… \
//     node scripts/sf-nm-decontam-dryrun.mjs --domain gov --out /tmp/gov_decontam.json
//
// Once the broadened Get Deals filter + one-time backfill land the COMPLETE
// deduped closed set in sf_deal_staging, this resolves the held buckets against
// authoritative CRM data → dry-run → Scott's gate → commit.  (dia flags stay at
// +96/−34 = 436 until then — no regression.)
// ============================================================================

import {
  classifyDeal, mapStagingRawRow, CLOSED_STAGE_LABELS,
  isCompetitorBroker, isNorthmarqListingBroker,
} from '../api/_shared/sf-nm-classifier.js';

const arg = (k, d = null) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const DOMAIN = (arg('--domain', 'dia') || 'dia').toLowerCase();
const OUT = arg('--out', null);
const PREFIX = DOMAIN === 'gov' ? 'GOV' : 'DIA';
const URL = process.env[`${PREFIX}_SUPABASE_URL`];
const KEY = process.env[`${PREFIX}_SUPABASE_SERVICE_KEY`] || process.env[`${PREFIX}_SUPABASE_SERVICE_ROLE_KEY`];
if (!URL || !KEY) {
  console.error(`Missing ${PREFIX}_SUPABASE_URL / ${PREFIX}_SUPABASE_SERVICE_KEY in env.`);
  process.exit(2);
}

async function rest(path, { range } = {}) {
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  if (range) headers.Range = range;
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`REST ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function fetchAll(path, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const page = await rest(path, { range: `${from}-${from + pageSize - 1}` });
    out.push(...page);
    if (page.length < pageSize) break;
// Round 74c (v2) — de-contaminate is_northmarq, SIDE-RECONCILED.
//
// TWO authoritative SF sources, both staged per-project:
//   1. public.sf_internal_comp_export (status='Sold') — the NM universe. Comp
//      Type=Internal = a Northmarq/SJC sale (Scott-confirmed). The Comp object
//      carries NO broker/Direct-Co-Broke columns, so it cannot tell listing-side
//      from buy-side on its own.
//   2. public.sf_deal_export (loaded from the data.xlsx Deal export) — the SIDE.
//      Direct_Co_Broke: 'Direct (Both)' / 'Co-Broke (Seller)' = NM-listed;
//      'Co-Broke (Buyer)' = buy-side. (sf_deal_staging is the live equivalent but
//      thin; data.xlsx is the fuller export.)
//
// Rule: is_northmarq=true ONLY when a sale matches a Comp AND the Deal side is
// Direct/Seller. Buyer-side -> is_northmarq_buyside. Deal side ABSENT -> HOLD.
//
// Matcher (the tolerant gate, now metro/proximity aware since dia is geocoded):
//   Comp->sale: state + sold_date +/-120d + sold_price +/-6%; confirm city OR
//   tenant OR <=25mi geocoded proximity (city-centroid gazetteer from properties).
//   Deal->sale side: TIGHT +/-1.5% price (identify the specific transaction, not a
//   same-metro neighbor) + the same confirm.
//
// READ-ONLY. Prints the de-contamination plan JSON (the gate input). The flag
// flips live in the gated scripts/applied/sf-nm-*-r74c-*.sql.
//
// Usage:
//   DIA_SUPABASE_URL=... DIA_SUPABASE_SERVICE_KEY=... \
//   GOV_SUPABASE_URL=... GOV_SUPABASE_SERVICE_KEY=... \
//   node scripts/sf-nm-decontam-dryrun.mjs [dia|gov|both] [--json out.json]
//
// gov is report-only (Comp match only): no gov Deal export to supply the side yet.
// ============================================================================

const VERTICALS = {
  dia: {
    project: 'Dialysis_DB', urlEnv: 'DIA_SUPABASE_URL', keyEnv: 'DIA_SUPABASE_SERVICE_KEY', hasDeals: true,
    salesSelect: 'sale_id,sale_date,sold_price,is_northmarq,is_northmarq_source,listing_broker,procuring_broker,cap_rate,cap_rate_final,properties(state,city,tenant,operator,latitude,longitude)',
    rowToSale: (r) => ({
      sale_id: r.sale_id, sale_date: r.sale_date, sold_price: num(r.sold_price),
      is_northmarq: r.is_northmarq === true, brokers: [r.listing_broker, r.procuring_broker],
      cap: num(r.cap_rate_final) ?? num(r.cap_rate),
      state: up(r.properties?.state), city: low(r.properties?.city),
      tenant: r.properties?.tenant, operator: r.properties?.operator,
      lat: num(r.properties?.latitude), lng: num(r.properties?.longitude),
    }),
  },
  gov: {
    project: 'government', urlEnv: 'GOV_SUPABASE_URL', keyEnv: 'GOV_SUPABASE_SERVICE_KEY', hasDeals: false,
    salesSelect: 'sale_id,sale_date,sold_price,is_northmarq,listing_broker,purchasing_broker,sold_cap_rate,state,city,agency,agency_full',
    rowToSale: (r) => ({
      sale_id: r.sale_id, sale_date: r.sale_date, sold_price: num(r.sold_price),
      is_northmarq: r.is_northmarq === true, brokers: [r.listing_broker, r.purchasing_broker],
      cap: num(r.sold_cap_rate), state: up(r.state), city: low(r.city),
      tenant: r.agency, operator: r.agency_full, lat: null, lng: null,
    }),
  },
};

const COMPETITOR_RE = /(marcus|millichap|m&m|cbre|jll|colliers|cushman|newmark|stan johnson|sands inv|encore|matthews|sab capital|capital pacific|b\+e)/i;
const NM_RE = /(northmarq|stan johnson|briggs|sjc|stinson|gartman)/i;
// Guard (Scott's doctrine): a sale whose own listing-broker is an NM token is
// NM-LISTED by rule. The Deal side may PROMOTE or resolve ambiguity, never demote
// such a row to buy-side, and it must never be removed. (Named NM individuals not
// in the token list — e.g. "Will Lightfoot" — still need a manual hold.)
const isNmBroker = (sale) => NM_RE.test(`${sale.brokers[0] || ''} ${sale.brokers[1] || ''}`);
const LISTING_SIDES = new Set(['Direct (Both)', 'Co-Broke (Seller)']);

const num = (x) => (x == null || x === '' ? null : +x);
const up = (x) => (x == null ? null : String(x).trim().toUpperCase());
const low = (x) => (x == null ? null : String(x).trim().toLowerCase());
const firstTok = (s) => (s ? String(s).trim().split(/\s+/)[0] : '');
const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);
function haversineMi(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null)) return Infinity;
  const R = 3959, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

async function pgFetch(base, key, path) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()} (${path})`);
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const dayDiff = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

async function main() {
  // 1) Staged closed deals → dedup to latest per sf_deal_id → classify.
  const staged = await fetchAll('sf_deal_staging?select=sf_deal_id,sf_last_modified,raw_row');
  const byId = new Map();
  for (const r of staged) {
    const stage = r.raw_row?.StageName;
    if (!CLOSED_STAGE_LABELS.includes(stage)) continue;
    const prev = byId.get(r.sf_deal_id);
    if (!prev || String(r.sf_last_modified) > String(prev.sf_last_modified)) byId.set(r.sf_deal_id, r);
  }
  const verdicts = [...byId.values()].map((r) => {
    const v = classifyDeal(mapStagingRawRow(r.raw_row, r.sf_deal_id));
    v._city = (r.raw_row?.City_sjc__c || '').trim();
    return v;
  });
  const nmComps = verdicts.filter(
    (v) => v.vertical === DOMAIN && v.is_northmarq && v.is_comp
      && v.state && v.close_date && num(v.sale_price) > 0,
  );

  // 2) Candidate sales (priced + dated) with property city/state.
  const sales = await fetchAll(
    'sales_transactions?select=sale_id,property_id,sold_price,sale_date,is_northmarq,is_northmarq_source,listing_broker,properties(state,city)'
    + '&sold_price=gt.0&sale_date=not.is.null',
  );
  const salesByState = new Map();
  for (const s of sales) {
    const st = (s.properties?.state || '').toUpperCase();
    if (!st) continue;
    if (!salesByState.has(st)) salesByState.set(st, []);
    salesByState.get(st).push(s);
  }

  // 3) Match NM-listed comps → sales (state + date±120d + price±6%, city confirm).
  const matchedSaleIds = new Set();
  const bestPerSale = new Map(); // sale_id -> {sale, comp, cityMatch, dd}
  let noMatch = 0;
  for (const c of nmComps) {
    const cands = salesByState.get(String(c.state).toUpperCase()) || [];
    const price = num(c.sale_price);
    let hit = false;
    for (const s of cands) {
      if (dayDiff(s.sale_date, c.close_date) > 120) continue;
      if (s.sold_price < price * 0.94 || s.sold_price > price * 1.06) continue;
      hit = true;
      matchedSaleIds.add(s.sale_id);
      const cityMatch = (s.properties?.city || '').trim().toLowerCase() === String(c._city).toLowerCase();
      const dd = dayDiff(s.sale_date, c.close_date);
      const prev = bestPerSale.get(s.sale_id);
      if (!prev || (cityMatch && !prev.cityMatch) || (cityMatch === prev.cityMatch && dd < prev.dd))
        bestPerSale.set(s.sale_id, { sale: s, comp: c, cityMatch, dd });
    }
    if (!hit) noMatch++;
  }

  // 4) Adds / removes / holds.
  const adds = [...bestPerSale.values()].filter((m) => m.sale.is_northmarq !== true);
  const addCity = adds.filter((m) => m.cityMatch);
  const addHold = adds.filter((m) => !m.cityMatch);

  const flagged = sales.filter((s) => s.is_northmarq === true);
  const flaggedUnmatched = flagged.filter((s) => !matchedSaleIds.has(s.sale_id));
  const removeCompetitor = flaggedUnmatched.filter((s) => isCompetitorBroker(s.listing_broker));
  const holdNmBroker = flaggedUnmatched.filter((s) => isNorthmarqListingBroker(s.listing_broker));
  const holdNullBroker = flaggedUnmatched.filter(
    (s) => !isCompetitorBroker(s.listing_broker) && !isNorthmarqListingBroker(s.listing_broker),
  );

  const slimAdd = (m) => ({
    sale_id: m.sale.sale_id, db_city: m.sale.properties?.city, sold_price: m.sale.sold_price,
    sale_date: m.sale.sale_date, deal_name: m.comp.deal_name, sf_id: m.comp.sf_id,
    listing_broker: m.sale.listing_broker, is_northmarq_source: m.sale.is_northmarq_source,
  });
  const slimRem = (s) => ({
    sale_id: s.sale_id, state: s.properties?.state, city: s.properties?.city,
    sold_price: s.sold_price, sale_date: s.sale_date, listing_broker: s.listing_broker,
    is_northmarq_source: s.is_northmarq_source,
  });

  const plan = {
    domain: DOMAIN, generated_at: new Date().toISOString(), source: 'sf_deal_staging (deduped)',
    staged_closed_deals: byId.size,
    nm_listed_comps_priced: nmComps.length,
    sales_universe_priced_dated: sales.length,
    current_is_northmarq_true: flagged.length,
    plan: {
      ADD_city_confirmed: addCity.length,
      REMOVE_explicit_competitor: removeCompetitor.length,
      net: addCity.length - removeCompetitor.length,
      new_total: flagged.length + addCity.length - removeCompetitor.length,
    },
    hold: {
      ADD_not_city_confirmed: addHold.length,
      REMOVE_nm_broker_keep_flagged: holdNmBroker.length,
      REMOVE_null_or_personal_broker: holdNullBroker.length,
      sf_nm_listed_no_db_match_task4: noMatch,
    },
    add_sample: addCity.sort((a, b) => b.sale.sold_price - a.sale.sold_price).slice(0, 30).map(slimAdd),
    remove_sample: removeCompetitor.sort((a, b) => b.sold_price - a.sold_price).slice(0, 30).map(slimRem),
  };

  console.log(JSON.stringify(plan.plan && { ...plan, add_sample: `[${plan.add_sample.length}]`, remove_sample: `[${plan.remove_sample.length}]` }, null, 2));
  if (OUT) { (await import('node:fs')).writeFileSync(OUT, JSON.stringify(plan, null, 2)); console.error(`\n[wrote ${OUT}]`); }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
const cityKey = (st, ct) => `${up(st)}|${low(ct)}`;
function centroidOf(gaz, st, ct) { const g = gaz.get(cityKey(st, ct)); return g ? { lat: g.lat / g.n, lng: g.lng / g.n } : null; }
function tenantOk(tenantStr, sale) {
  const t = firstTok(tenantStr); if (!t) return false;
  return `${sale.tenant || ''} ${sale.operator || ''}`.toLowerCase().includes(t.toLowerCase());
}
function pct(arr) {
  const xs = arr.filter((x) => x != null && x > 0.005 && x < 0.30).sort((a, b) => a - b);
  if (!xs.length) return null;
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  const med = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
  return { n: xs.length, avg_pct: +(avg * 100).toFixed(2), median_pct: +(med * 100).toFixed(2) };
}
const rk = (c) => [(c.city_ok && c.tenant_ok) ? 0 : 1, c.tenant_ok ? 0 : 1, c.city_ok ? 0 : 1, c.prox_ok ? 0 : 1, c.price_diff_pct, c.date_diff];
const lessRk = (a, b) => { const ra = rk(a), rb = rk(b); for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i]; return false; };

async function runVertical(name) {
  const cfg = VERTICALS[name];
  const base = process.env[cfg.urlEnv], key = process.env[cfg.keyEnv];
  if (!base || !key) { console.error(`[skip ${name}] set ${cfg.urlEnv} + ${cfg.keyEnv}`); return null; }

  const sales = (await pgFetch(base, key, `sales_transactions?select=${cfg.salesSelect}`)).map(cfg.rowToSale);
  const comps = (await pgFetch(base, key, `sf_internal_comp_export?status=eq.Sold&select=sf_comp_id,tenant,city,state,sold_price,sold_date,sold_cap_rate`))
    .map((c) => ({ sf_comp_id: c.sf_comp_id, tenant: c.tenant, c_city: low(c.city), c_state: up(c.state), price: num(c.sold_price), date: c.sold_date, cap: num(c.sold_cap_rate) }));

  // city-centroid gazetteer (from this DB's geocoded properties, via the sales embed)
  const gaz = new Map();
  for (const s of sales) { if (s.lat != null && s.city && s.state) { const k = cityKey(s.state, s.city); const g = gaz.get(k) || gaz.set(k, { lat: 0, lng: 0, n: 0 }).get(k); g.lat += s.lat; g.lng += s.lng; g.n++; } }

  // Comp -> sale (proximity-aware), best per comp, then 1:1 per sale
  const byState = new Map();
  for (const s of sales) { if (s.state && s.sold_price != null) (byState.get(s.state) || byState.set(s.state, []).get(s.state)).push(s); }
  const cand = [];
  for (const c of comps) {
    if (c.price == null) continue;
    const cc = centroidOf(gaz, c.c_state, c.c_city);
    for (const s of (byState.get(c.c_state) || [])) {
      if (days(s.sale_date, c.date) > 120) continue;
      const pdiff = Math.abs(s.sold_price - c.price) / c.price; if (pdiff > 0.06) continue;
      const city_ok = !!(s.city && s.city === c.c_city);
      const tenant_ok = tenantOk(c.tenant, s);
      const prox_ok = !!(cc && s.lat != null && haversineMi(cc.lat, cc.lng, s.lat, s.lng) <= 25);
      if (!city_ok && !tenant_ok && !prox_ok) continue;
      cand.push({ sf_comp_id: c.sf_comp_id, sale_id: s.sale_id, sale: s, price_diff_pct: +pdiff.toFixed(4), date_diff: days(s.sale_date, c.date), city_ok, tenant_ok, prox_ok });
    }
  }
  const bestComp = new Map();
  for (const p of cand) { const cur = bestComp.get(p.sf_comp_id); if (!cur || lessRk(p, cur)) bestComp.set(p.sf_comp_id, p); }
  const bestSale = new Map();
  for (const p of bestComp.values()) { const cur = bestSale.get(p.sale_id); if (!cur || lessRk(p, cur)) bestSale.set(p.sale_id, p); }
  const matched = [...bestSale.values()];

  // Deal -> sale side (TIGHT +/-1.5% price), aggregate listing-over-buyer per sale
  let deals = [], dealsLoaded = false;
  if (cfg.hasDeals) {
    try {
      deals = (await pgFetch(base, key, `sf_deal_export?select=side,sale_price,city,state,tenant&sale_price=not.is.null&side=not.is.null`))
        .map((d) => ({ side: d.side, price: num(d.sale_price), d_city: low(d.city), d_state: up(d.state), tenant: d.tenant }))
        .filter((d) => d.price > 0);
      dealsLoaded = true;
    } catch (e) {
      console.error(`[${name}] sf_deal_export not available (${e.message.slice(0, 60)}) — load the data.xlsx Deal export first to get the side. Reporting Comp-only.`);
    }
  }
  const dealSide = new Map();
  for (const m of matched) {
    const s = m.sale; let hasListing = false, hasBuyer = false;
    for (const d of deals) {
      if (d.d_state !== s.state) continue;
      if (Math.abs(d.price - s.sold_price) > 0.015 * s.sold_price) continue;
      const cc = centroidOf(gaz, d.d_state, d.d_city);
      const ok = (s.city && s.city === d.d_city) || tenantOk(d.tenant, s) || (cc && s.lat != null && haversineMi(cc.lat, cc.lng, s.lat, s.lng) <= 25);
      if (!ok) continue;
      if (LISTING_SIDES.has(d.side)) hasListing = true; else if (d.side === 'Co-Broke (Buyer)') hasBuyer = true;
    }
    // GUARD: never let a "buyer" Deal tag demote a sale whose own listing-broker is NM.
    if (hasBuyer && !hasListing && isNmBroker(m.sale)) { dealSide.set(m.sale_id, 'listing'); continue; }
    dealSide.set(m.sale_id, hasListing ? 'listing' : hasBuyer ? 'buyer' : 'none');
  }

  const side = (m) => (cfg.hasDeals && dealsLoaded ? dealSide.get(m.sale_id) : 'comp_only');
  const listing = matched.filter((m) => side(m) === 'listing');
  const buyer = matched.filter((m) => side(m) === 'buyer');
  const heldNoSide = matched.filter((m) => side(m) === 'none');

  const matchedIds = new Set(matched.map((m) => m.sale_id));
  const flaggedUnmatched = sales.filter((s) => s.is_northmarq && !matchedIds.has(s.sale_id));
  const brokerStr = (s) => `${s.brokers[0] || ''} ${s.brokers[1] || ''}`;
  const removeBuckets = { competitor: [], nm: [], null: [], other: [] };
  // NM-token guard takes precedence: an NM listing broker is KEEP even on a
  // competitor co-broke string ("M&M; Glass"-style) — never a competitor remove.
  for (const s of flaggedUnmatched) removeBuckets[isNmBroker(s) ? 'nm' : COMPETITOR_RE.test(brokerStr(s)) ? 'competitor' : (!String(s.brokers[0] || '').trim() && !String(s.brokers[1] || '').trim()) ? 'null' : 'other'].push(s.sale_id);

  const out = {
    vertical: name, project: cfg.project, side_reconciled: cfg.hasDeals,
    universe: { internal_sold: comps.length, with_price: comps.filter((c) => c.price != null).length },
    matched_sales: matched.length, proximity_only: matched.filter((m) => m.prox_ok && !m.city_ok && !m.tenant_ok).length,
    flagged_unmatched: flaggedUnmatched.length, confident_competitor_removes: removeBuckets.competitor,
    staged_removes_held: { nm_keep: removeBuckets.nm.length, null_hold: removeBuckets.null.length, other_hold: removeBuckets.other.length },
  };
  if (cfg.hasDeals && dealsLoaded) {
    out.side = {
      listing: { total: listing.length, adds: listing.filter((m) => !m.sale.is_northmarq).map((m) => m.sale_id) },
      buyer: { total: buyer.length, flip_off: buyer.filter((m) => m.sale.is_northmarq).map((m) => m.sale_id), new_buyside: buyer.filter((m) => !m.sale.is_northmarq).map((m) => m.sale_id) },
      held_no_deal_side: heldNoSide.map((m) => m.sale_id),
    };
    out.topic20 = { nm_listing: pct(listing.map((m) => m.sale.cap)), nm_buyer: pct(buyer.map((m) => m.sale.cap)), market_nonnm: pct(sales.filter((s) => !matchedIds.has(s.sale_id)).map((s) => s.cap)) };
  } else {
    out.note = cfg.hasDeals
      ? 'Comp-only: sf_deal_export not loaded — side unknown, all matches HELD. Load the data.xlsx Deal export to reconcile.'
      : 'gov report-only: no Deal export to supply the side. Comp match only.';
    out.would_be_adds = matched.filter((m) => !m.sale.is_northmarq).length;
    out.topic20 = { nm_matched: pct(matched.map((m) => m.sale.cap)), market_nonnm: pct(sales.filter((s) => !matchedIds.has(s.sale_id)).map((s) => s.cap)) };
  }
  return out;
}

const arg = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'both';
const which = arg === 'both' ? ['dia', 'gov'] : [arg];
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const plan = { round: '74c', version: 2, generated_at: new Date().toISOString(), verticals: {} };
for (const v of which) { const r = await runVertical(v); if (r) plan.verticals[v] = r; }
console.log(JSON.stringify(plan, null, 2));
if (jsonOut) { const fs = await import('node:fs'); fs.writeFileSync(jsonOut, JSON.stringify(plan, null, 2)); console.error(`[wrote ${jsonOut}]`); }
