// Live smoke test for buildVolumeCapSummary against gov + national_st rows.
import { buildVolumeCapSummary } from '../api/_shared/cm-summary-table.js';

const URL = process.env.OPS_SUPABASE_URL;
const KEY = process.env.OPS_SUPABASE_KEY;
const GOV_URL = process.env.GOV_SUPABASE_URL;
const GOV_KEY = process.env.GOV_SUPABASE_KEY;

async function pgrest(url, key, path) {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

const targets = [
  {
    name: 'national_st (all products)',
    url: URL, key: KEY,
    volume:    'cm_natl_st_volume_ttm_q?select=*&subspecialty=eq.all&order=period_end.asc',
    cap:       'cm_natl_st_cap_ttm_q?select=*&subspecialty=eq.all&order=period_end.asc',
    quartile:  'cm_natl_st_cap_quartile_q?select=*&subspecialty=eq.all&order=period_end.asc',
  },
  {
    name: 'national_st (office)',
    url: URL, key: KEY,
    volume:    'cm_natl_st_volume_ttm_q?select=*&subspecialty=eq.office&order=period_end.asc',
    cap:       'cm_natl_st_cap_ttm_q?select=*&subspecialty=eq.office&order=period_end.asc',
    quartile:  'cm_natl_st_cap_quartile_q?select=*&subspecialty=eq.office&order=period_end.asc',
  },
  {
    name: 'gov',
    url: GOV_URL, key: GOV_KEY,
    volume:    'cm_gov_volume_ttm_q?select=*&subspecialty=eq.all&order=period_end.asc',
    cap:       'cm_gov_cap_ttm_q?select=*&subspecialty=eq.all&order=period_end.asc',
    quartile:  'cm_gov_cap_quartile_q?select=*&subspecialty=eq.all&order=period_end.asc',
  },
];

function fmtCurrency(n) {
  if (n == null) return 'n/a';
  const abs = Math.abs(n);
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  return '$' + Math.round(n);
}
function fmtPct(n) {
  if (n == null) return 'n/a';
  return (n * 100).toFixed(2) + '%';
}

for (const t of targets) {
  console.log(`\n=== ${t.name} ===`);
  const [vol, cap, quart] = await Promise.all([
    pgrest(t.url, t.key, t.volume),
    pgrest(t.url, t.key, t.cap),
    pgrest(t.url, t.key, t.quartile),
  ]);
  console.log(`  rows fetched: vol=${vol.length} cap=${cap.length} quartile=${quart.length}`);
  const summary = buildVolumeCapSummary({
    volumeRows: vol,
    capRows: cap,
    quartileRows: quart,
  });
  if (summary.length === 0) {
    console.log('  no summary produced');
    continue;
  }
  const asOf = summary[0].as_of;
  console.log(`  as_of: ${asOf} (${summary[0].period_label})`);
  console.log('  ' + ['Metric', 'Current', 'Prior Q', 'YoY Q', 'Cycle', '5-Yr', '10-Yr', '15-Yr'].map(s => s.padStart(10)).join(' '));
  for (const r of summary) {
    const fmt = r.format === 'currency_dollars' ? fmtCurrency : fmtPct;
    console.log(
      '  ' +
      [r.metric, fmt(r.current_q), fmt(r.prior_q), fmt(r.yoy_q), fmt(r.prior_cycle_q),
       fmt(r.avg_5yr), fmt(r.avg_10yr), fmt(r.avg_15yr)
      ].map(s => String(s).padStart(10)).join(' ')
    );
  }
}
