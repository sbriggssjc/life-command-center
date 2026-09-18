// PERF-SPQ1-c — revert the PERF-SPQ1/-b contention regression and replace the 7
// independent chip-count queries with ONE RPC pass over the view.
//
// Measured live (browser probe, Cowork round 35): PERF-SPQ1 (9 concurrent reads of
// v_lcc_seller_prospect_queue) turned the route from a slow-but-working 200 (~14s) into
// a 500/502 abort (26s, "This operation was aborted") -- firing all 9 queries at once
// did not reduce the number of full-view passes Postgres does, it just made them
// contend for the same connection pool, and the items page (the one that matters)
// starved. This guard pins: (1) the handler no longer fires the 7-chip Promise.all,
// (2) it calls the single-pass RPC instead, (3) the RPC's chip vocabulary in SQL
// matches SELLER_QUEUE_CHIPS in JS -- the two are hand-synced, nothing enforces it
// structurally, so a drift here is exactly the kind of thing that goes unnoticed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SELLER_QUEUE_CHIPS } from '../api/_shared/seller-prospect-queue.js';

const ADMIN = readFileSync(new URL('../api/admin.js', import.meta.url), 'utf8');
const MIGRATION = 'supabase/migrations/20261102220000_lcc_perf_spq1_c_chip_counts_rpc.sql';
const MIGRATION_SRC = readFileSync(new URL('../' + MIGRATION, import.meta.url), 'utf8');

function handleSellerProspectQueueBody(src) {
  const start = src.indexOf('async function handleSellerProspectQueue(');
  assert.notEqual(start, -1, 'handleSellerProspectQueue must exist');
  // Bounded to the next top-level `async function` / `function` declaration at column 0,
  // never a fixed character count (the repeated footgun this repo warns about).
  const rest = src.slice(start + 1);
  const nextFn = rest.search(/\n(async )?function /);
  return src.slice(start, nextFn === -1 ? src.length : start + 1 + nextFn);
}
const HANDLER = handleSellerProspectQueueBody(ADMIN);

/** Strip `--` line comments from the migration for the same reason uxt1a-queue does:
 *  the header explains every predicate by naming it, so an unstripped grep can pass
 *  over a body that no longer does what the header claims. */
function sqlWithoutComments(src) {
  return src.split('\n').map((line) => {
    const i = line.indexOf('--');
    return i === -1 ? line : line.slice(0, i);
  }).join('\n');
}
const MIGRATION_SQL = sqlWithoutComments(MIGRATION_SRC);

test('the comment stripper actually removes prose (positive control)', () => {
  // This phrase only appears inside the migration's explanatory `--` comment
  // block, never in the function body it is stripped down to.
  assert.ok(MIGRATION_SRC.includes('starves and aborts'),
    'raw source discusses the live abort in prose');
  assert.ok(!/starves and aborts/.test(MIGRATION_SQL),
    'stripped source must not carry that comment');
});

test('the handler no longer fires the 9-way Promise.all bundling the items query', () => {
  // The regression's shape: a single Promise.all whose entries include the items
  // query itself. Chip counts + the funnel may still run concurrently WITH EACH
  // OTHER (that pair is cheap) -- what must be gone is bundling the heavy items
  // read into that same fan-out.
  const itemsInAPromiseAll = /Promise\.all\(\[[^\]]*buildQueuePath/s.test(HANDLER);
  assert.ok(!itemsInAPromiseAll, 'the items query must not sit inside any Promise.all');
  // The old regression's per-chip fan-out queried opsQuery ONCE PER CHIP; the new
  // code still legitimately maps SELLER_QUEUE_CHIPS to build the response shape, so
  // the shape to forbid is specifically a query call inside that map, not the map
  // itself.
  assert.ok(!/SELLER_QUEUE_CHIPS\.map\(\(c\)\s*=>\s*\n?\s*opsQuery/.test(HANDLER),
    'no per-chip opsQuery call inside the handler -- that is PERF-SPQ1/-b');
});

test('the handler calls the single-pass chip-counts RPC, not buildChipCountPath', () => {
  assert.match(HANDLER, /rpc\/lcc_seller_prospect_chip_counts/);
  assert.ok(!/buildChipCountPath/.test(HANDLER),
    'the 7-query-per-chip path must be gone from the handler');
});

test('the items query carries a longer timeout than the default 8s', () => {
  // buildQueuePath's read is the heaviest on this route -- P123's lesson (a pg_net/
  // fetch timeout that fires before the DB finishes is not evidence of a dead query)
  // applies here at the HTTP layer: give it real headroom instead of aborting early.
  const call = HANDLER.match(/opsQuery\('GET', buildQueuePath\([^)]*\)\s*,\s*undefined,\s*\{([^}]*)\}\)/s);
  assert.ok(call, 'items query call must be findable');
  assert.match(call[1], /timeoutMs:\s*\d{5,}/);
});

test('a failed chip-counts RPC reports every chip as n: null, never 0 or a thrown error', () => {
  assert.match(HANDLER, /chipCountsR\.ok\s*&&\s*chipCountByKey\.has/);
  assert.match(HANDLER, /:\s*null/);
});

test('SQL migration defines the RPC with STABLE + SECURITY INVOKER and grants EXECUTE', () => {
  assert.match(MIGRATION_SQL, /CREATE OR REPLACE FUNCTION public\.lcc_seller_prospect_chip_counts/);
  assert.match(MIGRATION_SQL, /STABLE/);
  assert.match(MIGRATION_SQL, /SECURITY INVOKER/);
  assert.match(MIGRATION_SQL, /GRANT EXECUTE ON FUNCTION public\.lcc_seller_prospect_chip_counts\(text\)\s+TO authenticated, service_role/);
});

test('the RPC computes every chip from ONE CTE scan of the view (count(*) FILTER, not N queries)', () => {
  const fromCount = MIGRATION_SQL.match(/FROM public\.v_lcc_seller_prospect_queue/g) || [];
  assert.equal(fromCount.length, 1, 'the view must be scanned exactly once inside the function');
  const filterCount = MIGRATION_SQL.match(/count\(\*\)\s*FILTER\s*\(WHERE/g) || [];
  assert.equal(filterCount.length, SELLER_QUEUE_CHIPS.length - 1,
    'one FILTER per non-"all" chip (the "all" chip is the unfiltered count)');
});

test('every SELLER_QUEUE_CHIPS key has a matching row in the SQL chip-counts function', () => {
  for (const chip of SELLER_QUEUE_CHIPS) {
    assert.match(MIGRATION_SQL, new RegExp("SELECT\\s+'" + chip.key + "'"),
      `chip "${chip.key}" from the JS vocabulary must appear as a SQL row`);
  }
});

test('the SQL predicate for each chip matches the JS predicate on the same view', () => {
  // Hand-mapped so a change to either side without the other is caught. Deliberately
  // not derived from a shared table -- there is no third place these could drift to,
  // per the migration's own header, so this test IS that third place.
  const jsToSql = {
    all: null,
    newer_lease: 'newer_lease IS TRUE',
    debt: 'reason_debt',
    developer: 'reason_value_creation_developer',
    no_linked_person: "reach_state = 'no_linked_person'",
    never_touched: "reach_state = 'never_touched'",
    in_pipeline_untouched: "reach_state = 'in_pipeline_untouched'",
  };
  for (const chip of SELLER_QUEUE_CHIPS) {
    const expected = jsToSql[chip.key];
    assert.ok(expected !== undefined, `unmapped chip "${chip.key}" -- update this test`);
    if (expected) {
      assert.ok(MIGRATION_SQL.includes(expected),
        `SQL must filter chip "${chip.key}" on: ${expected}`);
    }
  }
});

test('optional domain filter matches normalizeDomain -- gov/dia only, no filter on null', () => {
  assert.match(MIGRATION_SQL, /p_domain IS NULL OR source_domain = p_domain/);
});
