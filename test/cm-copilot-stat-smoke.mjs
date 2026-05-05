// Smoke test for the copilot_stat handler. Mirrors the HTTP path but fetches
// directly from PostgREST (skips Vercel auth) — validates that the recipes
// produce sensible sentences against actual production data.
//
// Run: node --env-file=.env.local test/cm-copilot-stat-smoke.mjs
import { composeStat } from '../api/_shared/cm-stat-recipes.js';

const OPS_URL = process.env.OPS_SUPABASE_URL;
const OPS_KEY = process.env.OPS_SUPABASE_KEY;
const GOV_URL = process.env.GOV_SUPABASE_URL;
const GOV_KEY = process.env.GOV_SUPABASE_KEY;
const DIA_URL = process.env.DIA_SUPABASE_URL;
const DIA_KEY = process.env.DIA_SUPABASE_KEY;

async function pgrest(url, key, path) {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

const VERTICAL_DB = {
  gov:         { url: GOV_URL, key: GOV_KEY },
  dialysis:    { url: DIA_URL, key: DIA_KEY },
  national_st: { url: OPS_URL, key: OPS_KEY },
};

const PROBES = [
  { vertical: 'gov',         template: 'volume_ttm_by_quarter',     view: 'cm_gov_volume_ttm_q' },
  { vertical: 'gov',         template: 'cap_rate_ttm_by_quarter',   view: 'cm_gov_cap_ttm_q' },
  { vertical: 'gov',         template: 'transaction_count_ttm',     view: 'cm_gov_count_ttm_q' },
  { vertical: 'gov',         template: 'avg_deal_size',             view: 'cm_gov_avg_deal_q' },

  { vertical: 'national_st', template: 'volume_ttm_by_quarter',     view: 'cm_natl_st_volume_ttm_q' },
  { vertical: 'national_st', template: 'cap_rate_ttm_by_quarter',   view: 'cm_natl_st_cap_ttm_q' },
  { vertical: 'national_st', template: 'transaction_count_ttm',     view: 'cm_natl_st_count_ttm_q' },
  { vertical: 'national_st', template: 'avg_deal_size',             view: 'cm_natl_st_avg_deal_q' },
  { vertical: 'national_st', template: 'cap_rate_top_bottom_quartile', view: 'cm_natl_st_cap_quartile_q' },
  { vertical: 'national_st', template: 'fed_funds_vs_treasury',     view: 'cm_natl_st_macro_rates_q' },
  { vertical: 'national_st', template: 'net_lease_spread',          view: 'cm_natl_st_net_lease_spread_q' },
  { vertical: 'national_st', template: 'volume_ttm_by_quarter',     view: 'cm_natl_st_volume_ttm_q', subspecialty: 'office' },
];

const failures = [];

for (const probe of PROBES) {
  const sub = probe.subspecialty || 'all';
  const db = VERTICAL_DB[probe.vertical];
  if (!db?.url || !db?.key) {
    console.log(`SKIP ${probe.vertical}/${probe.template}: missing creds for ${probe.vertical}`);
    continue;
  }
  try {
    const path = `${probe.view}?select=*&subspecialty=eq.${encodeURIComponent(sub)}&order=period_end.asc`;
    const rows = await pgrest(db.url, db.key, path);
    const stat = composeStat({
      chart_template_id: probe.template,
      vertical: probe.vertical,
      subspecialty: sub,
      rows,
    });
    if (!stat.ok) {
      console.log(`FAIL ${probe.vertical}/${probe.template} (${sub}) — ${stat.error}`);
      failures.push(probe);
    } else {
      console.log(`  ${stat.stat_text}`);
    }
  } catch (e) {
    console.log(`ERR  ${probe.vertical}/${probe.template} (${sub}) — ${e.message}`);
    failures.push(probe);
  }
}

console.log(`\n${PROBES.length - failures.length}/${PROBES.length} probes succeeded`);
if (failures.length) process.exit(1);
