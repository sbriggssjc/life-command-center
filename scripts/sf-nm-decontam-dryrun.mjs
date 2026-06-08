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
