// ID2b-caps — carries rpc_query_comps' operator_id/operator_canonical (ID2a
// registry, survivor-resolved) through the per-operator TTM cap-rate bands
// in market-brief-psql-tick.js, so the fragmentation Scott flagged in ID1
// ("Fresenius" vs "Fresenius Medical Care", "DaVita" vs "DaVita Dialysis")
// merges into one band per registry operator, instead of one per raw
// comp_tenant() spelling.
//
// Pure / no-DB (mirrors mba2-market-brief-psql-source-fixes.test.mjs's own
// stated convention) — the RPC/DB additivity and the live merge were
// verified separately against zqzrriwuavgrquhisnoa (see
// docs/audits/ID2b_caps_RPC_QUERY_COMPS_OPERATOR_ID_2026-09-12.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planOperatorCapRateBands, __internal } from '../api/_handlers/market-brief-psql-tick.js';
import { MIN_N_CAP_BAND } from '../api/_shared/market-brief-facts.js';

const SRC = readFileSync(
  fileURLToPath(new URL('../api/_handlers/market-brief-psql-tick.js', import.meta.url)), 'utf8');

function stripComments(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
const CODE = stripComments(SRC);

// Build N rows of one operator with distinct sale_price/cap_rate pairs so
// reliableCompCap() has something to read (it prefers rent/price, falls
// back to cap_rate — bare cap_rate is enough here).
function rows(spec) {
  // spec: [{ tenant, operator_id, operator_canonical, cap_rate, sale_date }]
  return spec.map((s, i) => ({
    comp_id: `t${i}`,
    tenant: s.tenant,
    operator_id: s.operator_id ?? null,
    operator_canonical: s.operator_canonical ?? null,
    cap_rate: s.cap_rate,
    sale_date: s.sale_date || '2026-01-01',
  }));
}

const N = MIN_N_CAP_BAND; // clears the small-n floor exactly

function repeat(spec, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ ...spec, cap_rate: spec.cap_rate + i * 0.0001, sale_date: `2026-0${(i % 9) + 1}-01` });
  return out;
}

// ---------------------------------------------------------------------------
// 1. Fragmentation is repaired: two text spellings under one operator_id
//    merge into ONE fact.
// ---------------------------------------------------------------------------

test('two comp_tenant() text spellings sharing an operator_id merge into one band', () => {
  const r = [
    ...repeat({ tenant: 'Fresenius', operator_id: 5, operator_canonical: 'Fresenius Medical Care', cap_rate: 0.07 }, N),
    ...repeat({ tenant: 'Fresenius Medical Care', operator_id: 5, operator_canonical: 'Fresenius Medical Care', cap_rate: 0.071 }, N),
  ];
  const { facts, retire } = planOperatorCapRateBands({ rows: r, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  assert.equal(facts.length, 1, 'exactly one band for the shared operator_id');
  assert.equal(facts[0].fact_key, 'cap_rate_ttm_band:5');
  assert.equal(facts[0]._n, N * 2, 'both text spellings contribute to the SAME n');
  assert.match(facts[0].claim_text, /Fresenius Medical Care/);

  // Both raw spellings are named as stale aliases to retire, since both
  // differ from the id-keyed factKey.
  const retireKeys = retire.map((x) => x.fact_key).sort();
  assert.deepEqual(retireKeys, ['cap_rate_ttm_band:fresenius', 'cap_rate_ttm_band:fresenius_medical_care']);
  for (const x of retire) assert.equal(x.reason, 'superseded_by_operator_id:5');
});

test('DaVita / DaVita Dialysis merge under one operator_id the same way', () => {
  const r = [
    ...repeat({ tenant: 'DaVita', operator_id: 4, operator_canonical: 'DaVita', cap_rate: 0.06 }, N),
    ...repeat({ tenant: 'DaVita Dialysis', operator_id: 4, operator_canonical: 'DaVita', cap_rate: 0.062 }, N),
    ...repeat({ tenant: 'DaVita Kidney Care', operator_id: 4, operator_canonical: 'DaVita', cap_rate: 0.063 }, N),
  ];
  const { facts, retire } = planOperatorCapRateBands({ rows: r, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].fact_key, 'cap_rate_ttm_band:4');
  assert.equal(facts[0]._n, N * 3);
  const retireKeys = retire.map((x) => x.fact_key).sort();
  assert.deepEqual(retireKeys, [
    'cap_rate_ttm_band:davita',
    'cap_rate_ttm_band:davita_dialysis',
    'cap_rate_ttm_band:davita_kidney_care',
  ]);
});

// ---------------------------------------------------------------------------
// 2. NULL operator_id falls back to the pre-ID2b text grouping — never
//    dropped, never silently merged into an unrelated bucket.
// ---------------------------------------------------------------------------

test('a comp whose property never resolved an operator_id groups on its raw tenant text, unchanged', () => {
  const r = repeat({ tenant: 'Independent Op', operator_id: null, operator_canonical: null, cap_rate: 0.08 }, N);
  const { facts, retire } = planOperatorCapRateBands({ rows: r, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].fact_key, 'cap_rate_ttm_band:independent_op');
  assert.equal(retire.length, 0, 'nothing is retired when no operator_id resolved this run');
});

test('mixed: a resolved operator and an unresolved operator never bleed into each other', () => {
  const r = [
    ...repeat({ tenant: 'Fresenius', operator_id: 5, operator_canonical: 'Fresenius Medical Care', cap_rate: 0.07 }, N),
    ...repeat({ tenant: 'Fresenius', operator_id: null, operator_canonical: null, cap_rate: 0.09 }, N), // same TEXT, unresolved property
  ];
  const { facts } = planOperatorCapRateBands({ rows: r, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  const keys = facts.map((f) => f.fact_key).sort();
  assert.deepEqual(keys, ['cap_rate_ttm_band:5', 'cap_rate_ttm_band:fresenius']);
  const idBand = facts.find((f) => f.fact_key === 'cap_rate_ttm_band:5');
  const textBand = facts.find((f) => f.fact_key === 'cap_rate_ttm_band:fresenius');
  assert.equal(idBand._n, N);
  assert.equal(textBand._n, N);
});

test('a raw-text alias is never retired if OTHER, unresolved rows still need that exact key as a live band this run', () => {
  const r = [
    // Resolved rows carrying the raw text "Fresenius Medical Care" -- this
    // makes cap_rate_ttm_band:fresenius_medical_care an ALIAS candidate.
    ...repeat({ tenant: 'Fresenius Medical Care', operator_id: 5, operator_canonical: 'Fresenius Medical Care', cap_rate: 0.07 }, N),
    // Unrelated, UNRESOLVED rows that happen to carry the exact same raw
    // text and therefore still need cap_rate_ttm_band:fresenius_medical_care
    // as their own live band this run.
    ...repeat({ tenant: 'Fresenius Medical Care', operator_id: null, operator_canonical: null, cap_rate: 0.09 }, N),
  ];
  const { facts, retire } = planOperatorCapRateBands({ rows: r, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  const keys = facts.map((f) => f.fact_key).sort();
  assert.deepEqual(keys, ['cap_rate_ttm_band:5', 'cap_rate_ttm_band:fresenius_medical_care']);
  assert.equal(retire.length, 0, 'the alias key is genuinely live this run (from the unresolved rows) -- must not be retired');
});

// ---------------------------------------------------------------------------
// 3. A stale key is never retired if it equals the id-keyed factKey itself
//    (e.g. an operator whose canonical name happens to normKey to its own id
//    — cannot occur in practice since ids are numeric and normKey output is
//    never purely numeric-looking from a real name, but the guard is a
//    structural no-op safety check, tested directly).
// ---------------------------------------------------------------------------

test('retire never names the id-keyed factKey as its own stale alias', () => {
  const r = repeat({ tenant: '5', operator_id: 5, operator_canonical: '5', cap_rate: 0.07 }, N);
  const { facts, retire } = planOperatorCapRateBands({ rows: r, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].fact_key, 'cap_rate_ttm_band:5');
  assert.equal(retire.length, 0);
});

// ---------------------------------------------------------------------------
// 4. Small-n suppression still applies per operator group (unchanged rule,
//    now applied post-merge rather than pre-merge — a merge can turn two
//    below-floor fragments into one emittable band).
// ---------------------------------------------------------------------------

test('small-n suppression applies to the MERGED group, so two below-floor fragments can together clear the floor', () => {
  const half = Math.ceil(MIN_N_CAP_BAND / 2);
  const r = [
    ...repeat({ tenant: 'Fresenius', operator_id: 5, operator_canonical: 'Fresenius Medical Care', cap_rate: 0.07 }, half),
    ...repeat({ tenant: 'Fresenius Medical Care', operator_id: 5, operator_canonical: 'Fresenius Medical Care', cap_rate: 0.071 }, half),
  ];
  const { facts } = planOperatorCapRateBands({ rows: r, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  assert.equal(facts.length, 1, `merged n=${half * 2} clears MIN_N_CAP_BAND=${MIN_N_CAP_BAND}`);
});

test('a lone fragment below the floor emits nothing, exactly as before ID2b-caps', () => {
  const r = repeat({ tenant: 'Rare Operator', operator_id: 99, operator_canonical: 'Rare Operator', cap_rate: 0.07 }, MIN_N_CAP_BAND - 1);
  const { facts } = planOperatorCapRateBands({ rows: r, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  assert.equal(facts.length, 0);
});

// ---------------------------------------------------------------------------
// 5. Superseding is wired through the write path, not left as a dead return
//    value — retireStaleFact() exists and is exported for the handler's
//    post-write-loop pass, and the handler reads `retire` off the lane
//    builder's return before calling it.
// ---------------------------------------------------------------------------

test('retireStaleFact is exported for the handler to call', () => {
  assert.equal(typeof __internal.retireStaleFact, 'function');
});

test('the dialysis lane builder returns a `retire` array alongside facts/gaps', () => {
  assert.match(CODE, /return \{ facts, gaps, retire \};/);
});

test('the handler destructures `retire` off the lane builder result and processes it after the write loop', () => {
  const anchor = CODE.indexOf('LANE_BUILDERS[lane]({ asOfIso, sinceIso, lane })');
  const destructureLine = CODE.slice(Math.max(0, anchor - 80), anchor);
  assert.match(destructureLine, /retire\s*=\s*\[\]/);
  const afterLaneBuilder = CODE.slice(anchor);
  assert.match(afterLaneBuilder, /for \(const r of retire\)/);
  assert.match(afterLaneBuilder, /retireStaleFact\(/);
});

// ---------------------------------------------------------------------------
// 6. Additive-only contract on the RPC's output — a regression here would
//    mean rpc_query_comps stopped returning the fields this whole unit reads.
// ---------------------------------------------------------------------------

test('planOperatorCapRateBands reads operator_id/operator_canonical off the row, never a re-derived name', () => {
  assert.match(CODE, /r\.operator_id/);
  assert.match(CODE, /r\.operator_canonical/);
});
