#!/usr/bin/env node
/**
 * Round 68-A — Task 2: synthesize listing history from unlinked sold deals.
 *
 * Scott's design (note D11): "A property sale from 2018 would have been marketed
 * in the time period prior to the sale date and we should know those dates
 * exactly." 1,608 dia sold deals (2013+, price>0, not excluded, property linked)
 * have NO listing record. This script creates a SYNTHETIC, PRICE-LESS listing
 * row for each so the active-universe / turnover / available-market charts stop
 * showing the pre-2016 cliff and the 2025 intake hole.
 *
 * The synthetic listing_date is sale_date - median DOM (imputed, NOT a receipt) —
 * see v_round68a_synth_candidates / v_round68a_dom_rule (the medians are computed
 * in SQL, never hard-coded). Synthetic rows are tagged
 * data_source='synthetic_from_sale' and EXCLUDED from every price/DOM/cap chart
 * by 20260605_cm_round68a_synthetic_listing_views.sql. They carry NO ask price,
 * price-change history, or asking cap.
 *
 * SAFETY:
 *   - Synthetic rows are is_active=false → cannot trip the
 *     available_listings_one_active_per_property partial-unique index.
 *   - They carry NULL initial_price/last_price → the listing cap-rate trigger
 *     (trg_listing_cap_rate_snapshot) no-ops and never writes cap_rate_history.
 *   - Idempotent: v_round68a_synth_candidates excludes any sale that already has
 *     a listing linked via sale_transaction_id, and the synthetic row IS so
 *     linked, so a second --commit run inserts nothing.
 *
 * MODES:
 *   DRY-RUN is the default; writes scripts/round68a_synthesis_plan.json and
 *   makes NO DB writes. --commit performs the bulk insert (live mode only).
 *
 * USAGE:
 *   # dry-run (produces the plan JSON for the verification gate):
 *   DIA_SUPABASE_URL=... DIA_SUPABASE_SERVICE_KEY=... \
 *     node scripts/round68a-synthesize-listings.mjs
 *   # commit, after Scott verifies the plan against the live DB:
 *   DIA_SUPABASE_URL=... DIA_SUPABASE_SERVICE_KEY=... \
 *     node scripts/round68a-synthesize-listings.mjs --commit
 */
import process from 'node:process';
import { writeFileSync } from 'node:fs';

const A = Object.fromEntries(process.argv.slice(2).flatMap(a => {
  if (!a.startsWith('--')) return [];
  const i = a.indexOf('='); return [[a.slice(2, i < 0 ? undefined : i), i < 0 ? true : a.slice(i + 1)]];
}));
const COMMIT = A.commit === true || A.commit === 'true';
const OUT = A.out || 'scripts/round68a_synthesis_plan.json';
const BATCH = Number(A.batch || 200);
const URL = process.env.DIA_SUPABASE_URL;
const KEY = process.env.DIA_SUPABASE_SERVICE_KEY || process.env.DIA_SUPABASE_KEY;
if (!URL || !KEY) {
  console.error('FATAL: set DIA_SUPABASE_URL + DIA_SUPABASE_SERVICE_KEY'); process.exit(1);
}

async function rest(method, path, body, extraHeaders = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json', ...extraHeaders,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

// Page through a GET that may exceed PostgREST's max-rows.
async function getAll(pathBase) {
  const rows = []; const page = 1000;
  for (let off = 0; ; off += page) {
    const sep = pathBase.includes('?') ? '&' : '?';
    const chunk = await rest('GET', `${pathBase}${sep}limit=${page}&offset=${off}`);
    rows.push(...chunk);
    if (chunk.length < page) break;
  }
  return rows;
}

const yearOf = d => Number(String(d).slice(0, 4));

async function main() {
  // 1. Computed DOM rule (per-year medians + which years use them).
  const domRule = await rest('GET', 'v_round68a_dom_rule?select=*&order=yr');

  // 2. Synthesis candidates (one row per synthesizable unlinked sale).
  const cands = await getAll('v_round68a_synth_candidates?select=*');

  // 3. Current listing_date distribution (for the 2025 recovery table).
  const curListings = await getAll('available_listings?select=listing_date&listing_date=not.is.null');
  const curByYear = {};
  for (const r of curListings) { const y = yearOf(r.listing_date); curByYear[y] = (curByYear[y] || 0) + 1; }

  // 4. Per-year synthetic counts + recovery table.
  const synthByYear = {};
  for (const c of cands) { const y = yearOf(c.synth_listing_date); synthByYear[y] = (synthByYear[y] || 0) + 1; }
  const years = [...new Set([...Object.keys(curByYear), ...Object.keys(synthByYear)].map(Number))]
    .filter(y => y >= 2012 && y <= 2026).sort();
  const recovery = years.map(y => ({
    year: y,
    current_listings: curByYear[y] || 0,
    synthetic_add: synthByYear[y] || 0,
    combined: (curByYear[y] || 0) + (synthByYear[y] || 0),
  }));

  // 5. Derivation class split + 20-row sample (most-recent sales).
  const classSplit = cands.reduce((m, c) => { m[c.dom_class] = (m[c.dom_class] || 0) + 1; return m; }, {});
  const sample = [...cands]
    .sort((a, b) => String(b.sale_date).localeCompare(String(a.sale_date)))
    .slice(0, 20)
    .map(c => ({
      sale_id: c.sale_id, property_id: c.property_id, sale_date: c.sale_date,
      sold_price: c.sold_price, sale_year: c.sale_year,
      dom_used: c.dom_used, dom_class: c.dom_class, synth_listing_date: c.synth_listing_date,
    }));

  const plan = {
    round: '68-A', task: 'Task 2 — synthesize listing history from unlinked sold deals',
    generated_at: new Date().toISOString(),
    mode: COMMIT ? 'commit' : 'dry_run',
    totals: {
      synthesizable_candidates: cands.length,
      derivation_classes: classSplit,
    },
    // Funnel from the full unlinked universe down to the synthesizable set.
    // Reproduce with sql/round68a — see docs/round68a/R68A_SYNTHESIS_PLAN.md §Gap.
    gap_funnel_reference: {
      u0_all_unlinked: 3058, u1_has_sale_date: 3058, u2_2013plus: 2678,
      u3_sold_price_gt_0: 2308, u4_not_excluded_from_metrics: 1608,
      u5_has_property: 1608,
      filtered_out: {
        pre_2013_sales: 380, sold_price_null_or_zero: 370,
        exclude_from_market_metrics: 700,
      },
      note: 'Live candidate count should equal u5 (drift = source data changed since the plan was authored).',
    },
    dom_rule: domRule,
    per_year_synthetic: years.map(y => ({ year: y, n: synthByYear[y] || 0 })),
    recovery_table: recovery,
    sample_20: sample,
  };
  writeFileSync(OUT, JSON.stringify(plan, null, 2));
  console.log(`[round68a] candidates=${cands.length}  plan -> ${OUT}`);
  console.log(`[round68a] derivation classes:`, classSplit);
  const r2025 = recovery.find(r => r.year === 2025);
  if (r2025) console.log(`[round68a] 2025 recovery: current ${r2025.current_listings} + synth ${r2025.synthetic_add} = ${r2025.combined}`);

  if (!COMMIT) {
    console.log('[round68a] DRY RUN — no writes. Re-run with --commit after verifying the plan.');
    return;
  }

  // 6. Bulk insert synthetic rows in batches. Price-less by construction.
  // R70 D10 follow-up: defensively clamp the imputed window so a re-run can
  // never reproduce the over-cap rows (8 rows carried 1,263-2,559d windows vs
  // the cohort's ~175d median — the median-DOM subtraction mis-fired). The
  // window (sale_date - listing_date) is bounded to the documented 1095d cap.
  const SYNTH_WINDOW_CAP_DAYS = 1095;
  const clampSynthListingDate = (saleDate, synthDate) => {
    const sale = new Date(saleDate);
    const earliest = new Date(sale.getTime() - SYNTH_WINDOW_CAP_DAYS * 86400 * 1000);
    const synth = new Date(synthDate);
    return (synth < earliest ? earliest : synth).toISOString().split('T')[0];
  };
  let inserted = 0;
  for (let i = 0; i < cands.length; i += BATCH) {
    const slice = cands.slice(i, i + BATCH).map(c => ({
      property_id: c.property_id,
      listing_date: clampSynthListingDate(c.sale_date, c.synth_listing_date),
      off_market_date: c.sale_date,
      sold_date: c.sale_date,
      sold_price: c.sold_price,
      status: 'sold',
      is_active: false,
      sale_transaction_id: c.sale_id,
      data_source: 'synthetic_from_sale',
      listing_date_source: 'synth_sale_minus_median_dom',
      // All price/cap fields left unset -> NULL (the whole point).
      notes: `Round 68-A synthetic listing from sale ${c.sale_id} `
        + `(listing_date = sale_date - ${c.dom_used}d ${c.dom_class} DOM)`,
    }));
    await rest('POST', 'available_listings', slice, { Prefer: 'return=minimal' });
    inserted += slice.length;
    process.stdout.write(`\r[round68a] inserted ${inserted}/${cands.length}`);
  }
  console.log(`\n[round68a] COMMIT complete — ${inserted} synthetic rows inserted.`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
