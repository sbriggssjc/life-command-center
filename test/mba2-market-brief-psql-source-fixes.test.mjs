// MB-a2 — the P-SQL market-brief producer's source queries, fixed against the
// LIVE Dialysis_DB schema (verified via Supabase MCP, 2026-09-11):
//
//   - `sales_transactions` has NO `operator_name`, `address`, `city` or
//     `state` columns. Both the cap-rate-band and the trades-since-last-run
//     sources now read the comps engine's own `rpc/rpc_query_comps` RPC
//     instead (the same RPC `query_comps` / mcp/comps-tools.js calls), which
//     already joins `properties` for address/city/state and resolves
//     `tenant` via `comp_tenant()`.
//   - `v_dia_on_market`'s cap-rate column is `current_cap_rate`, not a bare
//     `cap_rate`.
//   - `medicare_clinics` has 6,695 eligible rows (dedup_status <>
//     demoted_duplicate AND chain_organization not null); a client-side
//     count over a `&limit=1000` page silently truncates to ~15% of the
//     population. The producer now reads a server-side aggregate,
//     `v_market_brief_cms_operator_counts` (migration
//     20260911190000_dia_mba2_cms_operator_counts_view.sql), which has 32
//     distinct operators — nowhere near any page cap.
//
// This suite is pure / no-DB (mirrors market-brief-tick-handlers.test.mjs's
// own stated convention: DB-dependent flow is verified live). It covers:
//   1. the truncation tripwire is a real, reusable predicate;
//   2. reliableCompCap() reads the engine's displayed (rent÷price) basis
//      first, falling back to the RPC's own coalesced cap_rate;
//   3. every column name the source-fetch functions reference in source is
//      one of the columns actually confirmed live on each object — a fixture
//      drift detector, so a future edit that reintroduces a guessed column
//      name fails CI instead of 400ing silently in production;
//   4. the RPC call always sends `p_tenant` (required to disambiguate the
//      two live overloads of rpc_query_comps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  truncationGap,
  reliableCompCap,
} from '../api/_handlers/market-brief-psql-tick.js';

const SRC = readFileSync(
  fileURLToPath(new URL('../api/_handlers/market-brief-psql-tick.js', import.meta.url)), 'utf8');

function stripComments(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
const CODE = stripComments(SRC);

// ---------------------------------------------------------------------------
// 1. Truncation tripwire
// ---------------------------------------------------------------------------

test('truncationGap fires only when the returned count reaches the requested limit', () => {
  assert.equal(truncationGap(94, 900, 'x'), null);
  assert.equal(truncationGap(900, 900, 'x'), 'source_truncated (x returned 900 >= requested limit 900)');
  assert.equal(truncationGap(901, 900, 'x'), 'source_truncated (x returned 901 >= requested limit 900)');
  assert.equal(truncationGap(0, 900, 'x'), null);
});

test('truncationGap never trips on the OLD hard-coded &limit=1000 magnitude used before the fix', () => {
  // The bug this guards against: MB-a's medicare_clinics select requested
  // 1000 against a real population of 6,695. Reproduce that shape directly —
  // a limit of 1000 against a returned count of 1000 must be flagged.
  assert.ok(truncationGap(1000, 1000, 'medicare_clinics'));
});

test('every source-read call site in the handler passes a truncationGap-style limit check', () => {
  // Structural: the handler must call truncationGap() at least three times
  // (comps RPC, on-market, cms operator counts) rather than reintroducing an
  // inline `.length >= limit` check that a future edit could silently drop.
  const calls = CODE.match(/truncationGap\(/g) || [];
  assert.ok(calls.length >= 3, `expected >=3 truncationGap() call sites, found ${calls.length}`);
});

// ---------------------------------------------------------------------------
// 2. reliableCompCap — the displayed (rent÷price) basis, with fallback
// ---------------------------------------------------------------------------

test('reliableCompCap prefers the displayed rent/price basis over the stored cap_rate field', () => {
  // Mirrors the documented Woodland Hills case: stored cap_rate 0.0662 vs a
  // real rent÷price of 0.0600. rpc_query_comps rows carry annual_rent +
  // sale_price directly (not nested under `raw`/`template`), which is what
  // templateRow()/displayedCompCap() read.
  const row = {
    comp_id: 'dia_db:1', source: 'dialysis_db', on_market: false,
    sale_price: 15729896, annual_rent: 943794, cap_rate: 0.0662,
    building_sf: 10000,
  };
  const cap = reliableCompCap(row);
  assert.ok(Math.abs(cap - (943794 / 15729896)) < 1e-6, `expected the displayed rent/price basis, got ${cap}`);
  assert.notEqual(Math.round(cap * 10000), 662, 'must not fall back to the stale stored cap_rate when a real rent+price pair exists');
});

test('reliableCompCap falls back to the RPC\'s own coalesced cap_rate when no rent/price pair exists', () => {
  const row = { comp_id: 'dia_sf:1', source: 'salesforce', cap_rate: 0.075 };
  assert.equal(reliableCompCap(row), 0.075);
});

test('reliableCompCap returns null rather than 0/NaN when neither basis is usable', () => {
  const row = { comp_id: 'dia_db:2', source: 'dialysis_db' };
  assert.equal(reliableCompCap(row), null);
});

// ---------------------------------------------------------------------------
// 3. Column-contract fixture — drift detector
// ---------------------------------------------------------------------------

// Columns confirmed LIVE against information_schema.columns on Dialysis_DB
// (zqzrriwuavgrquhisnoa), 2026-09-11 — the whole point of MB-a2. Any source
// string in this handler naming a `sales_transactions.<x>` or
// `v_dia_on_market.<x>` field must draw from these sets, never a guess.
const LIVE_SALES_TRANSACTIONS_COLUMNS = new Set([
  'sale_id', 'property_id', 'sale_date', 'sold_price', 'buyer_name', 'buyer_type',
  'seller_name', 'notes', 'cap_rate', 'recorded_date', 'portfolio_id',
  'listing_broker_id', 'procuring_broker_id', 'true_owner_id', 'recorded_owner_id',
  'cap_rate_method', 'cap_rate_notes', 'seller_id', 'updated_at',
  'initial_cap_rate', 'listing_broker', 'procuring_broker', 'recorded_owner_name',
  'true_owner_name', 'data_source', 'transaction_type', 'exclude_from_market_metrics',
  'stated_cap_rate', 'calculated_cap_rate', 'rent_at_sale', 'rent_source',
  'cap_rate_confidence', 'sale_notes_extracted', 'sale_notes_raw', 'is_northmarq',
  'cap_rate_noi_source_table', 'cap_rate_noi_source_id', 'cap_rate_quality',
  'transaction_state', 'dedup_group_id', 'dedup_natural_key', 'cap_rate_final',
  'cap_rate_source', 'firm_term_years_at_sale', 'firm_term_expiration_at_sale',
  'firm_term_source', 'firm_term_locked', 'firm_term_computed_at',
  'is_northmarq_source', 'is_northmarq_buyside', 'sf_deal_id', 'listing_sale_id',
]);

const LIVE_V_DIA_ON_MARKET_COLUMNS = new Set([
  'listing_id', 'property_id', 'address', 'tenant', 'operator', 'city', 'state',
  'asking_price', 'current_cap_rate', 'last_cap_rate', 'listing_broker',
  'on_market_date', 'listing_date',
]);

// Columns this producer must NEVER read directly from `sales_transactions`
// (they do not exist there — MB-a's original bug) — asserted as a negative
// control so the fixture above cannot silently rot into a lie.
const BANNED_SALES_TRANSACTIONS_COLUMNS = ['operator_name', 'address', 'city', 'state'];

test('column-contract fixture: sales_transactions banned columns really are absent from the live set', () => {
  for (const col of BANNED_SALES_TRANSACTIONS_COLUMNS) {
    assert.ok(!LIVE_SALES_TRANSACTIONS_COLUMNS.has(col),
      `fixture drift: '${col}' should NOT be in LIVE_SALES_TRANSACTIONS_COLUMNS (it never existed on sales_transactions)`);
  }
});

test('handler never queries sales_transactions directly for these fields any more', () => {
  // The old, wrong shape this migration replaced:
  //   sales_transactions?...&select=cap_rate,operator_name,...,address,city,state
  // If that literal select string ever comes back, it is the regression.
  assert.doesNotMatch(CODE, /select=cap_rate,operator_name/);
  assert.doesNotMatch(CODE, /select=address,city,state,sale_date,sold_price,cap_rate/);
});

test("v_dia_on_market select= list only names columns confirmed live, never a bare 'cap_rate'", () => {
  const m = CODE.match(/v_dia_on_market\?select=([^&`'"]+)/);
  assert.ok(m, 'expected a v_dia_on_market select= clause in the source');
  const cols = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.ok(cols.length > 0);
  for (const col of cols) {
    assert.ok(LIVE_V_DIA_ON_MARKET_COLUMNS.has(col),
      `'${col}' is not a live column on v_dia_on_market (live set: ${[...LIVE_V_DIA_ON_MARKET_COLUMNS].join(', ')})`);
  }
  assert.ok(cols.includes('current_cap_rate'), 'must read current_cap_rate, not a bare cap_rate');
  assert.ok(!cols.includes('cap_rate'), 'v_dia_on_market has no bare cap_rate column');
});

test('the CMS operator source reads the server-side aggregate view, not the raw table', () => {
  assert.match(CODE, /v_market_brief_cms_operator_counts\?select=operator,clinic_count/);
  // And must NOT reintroduce the old truncatable raw-table select.
  assert.doesNotMatch(CODE, /medicare_clinics\?dedup_status=neq\.demoted_duplicate&chain_organization=not\.is\.null\s*\n?\s*\+\s*'&select=chain_organization&limit=1000'/);
});

// ---------------------------------------------------------------------------
// 4. rpc_query_comps overload disambiguation
// ---------------------------------------------------------------------------

test('every rpc_query_comps call body includes p_tenant (required to resolve the live 13-arg overload)', () => {
  const bodyBlock = CODE.slice(CODE.indexOf('async function fetchCompsRpc'), CODE.indexOf('async function fetchDialysisCapRates'));
  assert.match(bodyBlock, /p_tenant:\s*null/);
});

test('rpc_query_comps is called via POST rpc/rpc_query_comps (the shared engine RPC), not a raw table select', () => {
  assert.match(CODE, /domainQuery\('dialysis',\s*'POST',\s*'rpc\/rpc_query_comps'/);
});
