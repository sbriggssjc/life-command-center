// HP1-badge (2026-09-12) — guard for the honest total_open fix.
//
// HP1-P0 removed `Prefer: count=exact` from the today_sections row-fetch
// calls entirely, so every section's `total_open` fell back to
// `rows.length` — the CAPPED page length, never the true population.
// Significant and Urgent under-reported by 61% and ~88% (docs/HP1-badge).
//
// This guard proves, at the handler level (fetch stubbed, the
// `marketing-reassign` pattern this suite already uses — net-guard would
// block a real host anyway):
//   1. total_open equals the TRUE population (from a separate exact-count
//      probe), never the capped row-fetch length, even when they differ.
//   2. A count probe that fails renders total_open === null ("unknown"),
//      never 0 and never silently falling back to the row count.
//   3. The rendered items and their order are unaffected by any of this.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const ENV_KEYS = [
  'OPS_SUPABASE_URL', 'OPS_SUPABASE_KEY',
  'GOV_SUPABASE_URL', 'GOV_SUPABASE_SERVICE_KEY', 'GOV_SUPABASE_KEY',
  'DIA_SUPABASE_URL', 'DIA_SUPABASE_SERVICE_KEY', 'DIA_SUPABASE_KEY',
];

function fakeResponse(status, body, headers = {}) {
  const text = body === null ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    headers: { get: (k) => headers[k.toLowerCase()] || null },
  };
}

// A count-only probe request is a narrow single-column select with
// `limit=1` and no `order=` — every row-fetch call in the handler carries
// an `order=` clause, so this is a stable structural discriminator that
// does not depend on call ORDER (Promise.allSettled fires all of these
// concurrently, so array position in the stub can't be relied on).
function isCountProbe(url) {
  return /limit=1(&|$)/.test(url) && !url.includes('order=');
}
function isGovConflictCountProbe(url) {
  return url.includes('v_owner_source_conflict') && !url.includes('order=annual_rent');
}

describe('HP1-badge — total_open is the true population, never the capped page length', () => {
  let savedEnv = {};
  let savedFetch;
  let getTodaySections;

  before(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.OPS_SUPABASE_URL = 'http://ops.test.local';
    process.env.OPS_SUPABASE_KEY = 'ops-test-key';
    process.env.GOV_SUPABASE_URL = 'http://gov.test.local';
    process.env.GOV_SUPABASE_SERVICE_KEY = 'gov-test-key';
    process.env.DIA_SUPABASE_URL = 'http://dia.test.local';
    process.env.DIA_SUPABASE_SERVICE_KEY = 'dia-test-key';
    ({ getTodaySections } = await import('../api/operations.js'));
  });

  after(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    if (savedFetch) globalThis.fetch = savedFetch;
  });

  it('every section reports the TRUE count, not rows.length, and rows/order are untouched', async () => {
    savedFetch = globalThis.fetch;
    const sellerRows = [
      { entity_id: 'e1', source_domain: 'gov', property_id: 1, rank_value: 900, reach_state: 'never_touched' },
      { entity_id: 'e2', source_domain: 'gov', property_id: 2, rank_value: 500, reach_state: 'never_touched' },
    ];
    const bdOppRows = [{ id: 'o1', entity_id: 'ent-1', type: 'buyer', stage: 'Prospecting', amount: 900000 }];
    const aiRows = [{ id: 'ai1', entity_id: 'ent-2', action_type: 'reply_overdue', title: 'Reply overdue', due_date: '2020-01-01', status: 'open' }];
    const bwRows = [{ signal_type: 'contact_writeback', entity_id: 'ent-3', what: 'Push contact', rank_value: 999 }];

    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('v_lcc_seller_prospect_queue')) {
        return isCountProbe(url)
          ? fakeResponse(200, [], { 'content-range': '0-0/516' })
          : fakeResponse(200, sellerRows);
      }
      if (url.includes('bd_opportunities')) {
        return isCountProbe(url)
          ? fakeResponse(200, [], { 'content-range': '0-0/46' })
          : fakeResponse(200, bdOppRows);
      }
      if (url.includes('action_items')) {
        return isCountProbe(url)
          ? fakeResponse(200, [], { 'content-range': '0-0/66' })
          : fakeResponse(200, aiRows);
      }
      if (url.includes('v_lcc_bd_worklist')) {
        return isCountProbe(url)
          ? fakeResponse(200, [], { 'content-range': '0-0/1598' })
          : fakeResponse(200, bwRows);
      }
      if (url.includes('v_owner_source_conflict')) {
        return isGovConflictCountProbe(url)
          ? fakeResponse(200, [], { 'content-range': '0-0/33' })
          : fakeResponse(200, []);
      }
      if (url.includes('/entities?')) {
        return fakeResponse(200, [{ id: 'ent-1', name: 'Acme LLC' }, { id: 'ent-2', name: 'Beta Corp' }, { id: 'ent-3', name: 'Gamma Corp' }]);
      }
      throw new Error('unexpected fetch in test: ' + url);
    };

    let statusCode = null;
    let jsonBody = null;
    const res = { status(code) { statusCode = code; return this; }, json(body) { jsonBody = body; return this; } };
    await getTodaySections({ query: {} }, res, { id: 'u1' }, 'ws1');

    assert.equal(statusCode, 200);
    assert.equal(jsonBody.ok, true);

    // Rows fetched are capped at 2/1/1/1 in this fixture — the true counts
    // are much larger. total_open must reflect the TRUE count, never the
    // rows-shown length.
    assert.equal(jsonBody.significant.items.length, 2);
    assert.equal(jsonBody.significant.total_open, 516, 'significant total_open must be the true count, not rows.length (2)');

    assert.equal(jsonBody.important.items.length, 1);
    assert.equal(jsonBody.important.total_open, 46, 'important total_open must be the true count, not rows.length (1)');

    // Urgent's true total is the SUM of its four producers (action_items +
    // contact_writeback + gov conflict + dia conflict): 66 + 1598 + 33 + 33.
    assert.equal(jsonBody.urgent.items.length, 2);
    assert.equal(jsonBody.urgent.total_open, 66 + 1598 + 33 + 33, 'urgent total_open must sum the four TRUE producer counts, not rows.length (2)');

    // Ordering/content of the rendered items is untouched by any of this —
    // overdue action item still outranks the value-only worklist row.
    assert.equal(jsonBody.urgent.items[0].kind, 'deal_correspondence');
    assert.equal(jsonBody.urgent.items[0].overdue, true);
    assert.equal(jsonBody.urgent.items[1].kind, 'contact_writeback');
    assert.equal(jsonBody.significant.items[0].entity_id, 'e1');
    assert.equal(jsonBody.important.items[0].who, 'Acme LLC');
  });

  it('a count probe that fails renders total_open === null, never 0 and never the row count', async () => {
    savedFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('v_lcc_seller_prospect_queue')) {
        if (isCountProbe(url)) throw new Error('count probe aborted');
        return fakeResponse(200, [
          { entity_id: 'e1', source_domain: 'gov', property_id: 1, rank_value: 900, reach_state: 'never_touched' },
        ]);
      }
      if (url.includes('bd_opportunities')) return fakeResponse(200, isCountProbe(url) ? [] : [], isCountProbe(url) ? { 'content-range': '0-0/0' } : {});
      if (url.includes('action_items')) return fakeResponse(200, isCountProbe(url) ? [] : [], isCountProbe(url) ? { 'content-range': '0-0/0' } : {});
      if (url.includes('v_lcc_bd_worklist')) return fakeResponse(200, isCountProbe(url) ? [] : [], isCountProbe(url) ? { 'content-range': '0-0/0' } : {});
      if (url.includes('v_owner_source_conflict')) return fakeResponse(200, [], isGovConflictCountProbe(url) ? { 'content-range': '0-0/0' } : {});
      if (url.includes('/entities?')) return fakeResponse(200, []);
      throw new Error('unexpected fetch in test: ' + url);
    };

    let jsonBody = null;
    const res = { status() { return this; }, json(body) { jsonBody = body; return this; } };
    await getTodaySections({ query: {} }, res, { id: 'u1' }, 'ws1');

    // The row fetch for Significant succeeded (1 row) but its count probe
    // threw — total_open must be null, NOT 1 (rows.length) and NOT 0.
    assert.equal(jsonBody.significant.items.length, 1);
    assert.equal(jsonBody.significant.total_open, null, 'a failed count probe must render unknown, never rows.length or 0');
  });
});
