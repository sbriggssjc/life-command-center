// PERF-SPQ2 — Home's cold boot lost its own 12s race against v_lcc_seller_prospect_queue.
//
// Measured 2026-09-22 (LCC Opps, idle): one pass of the queue view ~850 ms; the funnel
// summary 6,567 ms because it was 11 UNION ALL branches each re-running the universe
// view. pg_stat_statements over real traffic: summary mean 7,281 ms (max 28,334 ms).
// Home's BD lane fetched the chip RPC AND the funnel on every boot and rendered neither.
//
// This guard pins:
//   1. the summary view scans the universe exactly ONCE;
//   2. its 'queue' bucket carries the same predicate as v_lcc_seller_prospect_queue
//      (it no longer reads that view, so the two could drift silently);
//   3. chips + funnel are opt-in on the route, default OFF, and only the seller-prospect
//      page (the one renderer that draws chips) asks for them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSellerQueueInclude } from '../api/_shared/seller-prospect-queue.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const stripSql = (src) => src.split('\n').map((l) => { const i = l.indexOf('--'); return i === -1 ? l : l.slice(0, i); }).join('\n');

const MIG_RAW = read('supabase/migrations/20261102230000_lcc_perf_spq2_seller_summary_single_pass.sql');
const MIG = stripSql(MIG_RAW);
const QUEUE_MIG = stripSql(read('supabase/migrations/20261016120000_lcc_uxt1a_seller_prospect_queue.sql'));
const ADMIN = read('api/admin.js');
const APP = read('app.js');
const OPS = read('ops.js');

function handlerBody(src) {
  const start = src.indexOf('async function handleSellerProspectQueue(');
  assert.notEqual(start, -1);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(async )?function /);
  return src.slice(start, next === -1 ? src.length : start + 1 + next);
}
const HANDLER = handlerBody(ADMIN);

test('comment stripper removes prose (positive control)', () => {
  assert.ok(MIG_RAW.includes('6,567 ms'));
  assert.ok(!MIG.includes('6,567 ms'));
});

test('the summary scans v_lcc_seller_prospect_universe exactly once and never re-reads the queue view', () => {
  assert.equal((MIG.match(/FROM public\.v_lcc_seller_prospect_universe/g) || []).length, 1);
  assert.ok(!/UNION ALL/.test(MIG), 'no per-bucket UNION ALL re-scan');
  assert.ok(!/FROM public\.v_lcc_seller_prospect_queue\b/.test(MIG));
});

test('every funnel bucket the UX-T1a guard requires is still emitted', () => {
  for (const b of ['universe', 'value_unknown', 'in_band', 'in_band_term_unknown', 'in_band_older_lease',
    'in_band_newer_lease', 'in_band_reason_debt', 'in_band_reason_developer',
    'variant_f_before_reach', 'excluded_touched', 'queue']) {
    assert.ok(MIG.includes(`'${b}'`), b);
  }
});

test("the 'queue' bucket predicate matches v_lcc_seller_prospect_queue's WHERE", () => {
  // Queue view: in_band IS TRUE AND (newer_lease IS TRUE OR reason_to_sell <> 'reason_to_sell_unmeasured')
  //             AND reach_state <> 'touched'
  const queueView = QUEUE_MIG.match(/CREATE OR REPLACE VIEW public\.v_lcc_seller_prospect_queue AS[\s\S]*?;/);
  assert.ok(queueView, 'queue view definition must be findable');
  const norm = (s) => s.replace(/\s+/g, ' ');
  assert.match(norm(queueView[0]), /in_band IS TRUE/);
  assert.match(norm(queueView[0]), /newer_lease IS TRUE OR reason_to_sell <> 'reason_to_sell_unmeasured'/);
  assert.match(norm(queueView[0]), /reach_state <> 'touched'/);
  // And the summary builds 'queue' from exactly those three pieces.
  const m = norm(MIG);
  assert.match(m, /in_band IS TRUE AND \(newer_lease IS TRUE OR reason_to_sell <> 'reason_to_sell_unmeasured'\) AS b_variant_f/);
  assert.match(m, /reach_state <> 'touched' AS b_not_touched/);
  assert.match(m, /FILTER \(WHERE b_variant_f AND b_not_touched\) AS r10/);
  assert.match(m, /\(11, 'queue', r10, o10\)/);
});

test('parseSellerQueueInclude: default OFF, opt-in by token, tolerant of case/space/junk', () => {
  assert.deepEqual(parseSellerQueueInclude(undefined), { chips: false, funnel: false });
  assert.deepEqual(parseSellerQueueInclude(''), { chips: false, funnel: false });
  assert.deepEqual(parseSellerQueueInclude('chips'), { chips: true, funnel: false });
  assert.deepEqual(parseSellerQueueInclude(' Funnel , CHIPS ,bogus'), { chips: true, funnel: true });
});

test('the handler only runs the chip RPC / funnel when included', () => {
  assert.match(HANDLER, /parseSellerQueueInclude\(req\.query\.include\)/);
  assert.match(HANDLER, /include\.chips\s*\?\s*opsQuery\('POST', 'rpc\/lcc_seller_prospect_chip_counts'/);
  assert.match(HANDLER, /include\.funnel\s*\?\s*opsQuery\('GET', 'v_lcc_seller_prospect_queue_summary/);
  // not-requested is null, never an empty list (P180)
  assert.match(HANDLER, /let chips = null;/);
});

test('only the seller-prospect page asks for chips; Home BD lane and Priority tab do not', () => {
  assert.match(APP, /&offset=' \+ _sellerProspectPage\.offset \+ '&include=chips'/);
  assert.match(APP, /opsApi\('\/api\/seller-prospect-queue\?chip=all&limit=5&offset=0'\)/);
  assert.match(OPS, /opsApi\('\/api\/seller-prospect-queue\?chip=all&limit=100'\)/);
  assert.ok(!/include=[^'"]*funnel/.test(APP + OPS), 'no renderer reads the funnel, so none requests it');
});
