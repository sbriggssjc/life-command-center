// test/deal-propagation-briefing-delta.test.mjs
// W7.2c — the briefing "what changed on your deals" delta: deterministic
// aggregation from the propagation ledger + summary/dossier writes, and the
// rendered line shape. Mocked at the fetch level (opsQuery).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.supabase.co';
process.env.OPS_SUPABASE_KEY = 'test-key';
process.env.LCC_BASE_URL = 'https://lcc.test';

const D1 = 'c3bc3125-c9b9-4c7b-801d-b1d4bf715f59';
const D2 = 'd4cd4236-dac0-5d8c-912e-c2e5cf826a6a';

function installFetch(routes) {
  global.fetch = async (url) => {
    const u = String(url);
    for (const [needle, arr] of routes) {
      if (u.includes(needle)) {
        return { ok: true, status: 200, text: async () => JSON.stringify(arr),
          headers: { get: () => null } };
      }
    }
    return { ok: true, status: 200, text: async () => '[]', headers: { get: () => null } };
  };
}

test('delta aggregates ledger actions per deal + folds summary/dossier writes', async () => {
  installFetch([
    ['lcc_deal_comm_propagated', [
      { entity_id: D1, actions: { milestones: [{ key: 'loi', outcome: 'inserted' }], todo: 'generated' } },
      { entity_id: D1, actions: { milestones: [{ key: 'loi', outcome: 'rolled_up' }] } },
      { entity_id: D2, actions: {} },
    ]],
    ['entities?id=in', [{ id: D1, name: 'Banning Medical' }, { id: D2, name: 'Coos Bay ASC' }]],
    ['lcc_deal_correspondence_summary', [{ entity_id: D1 }]],   // summary refreshed on D1 only
    ['lcc_dossiers', [{ entity_id: D2, metadata: { generated_via: 'w7.2_tick' } }]], // dossier regen on D2
  ]);
  const { fetchDealPropagationDelta } = await import('../api/_shared/briefing-data.js');
  const out = await fetchDealPropagationDelta(24);

  assert.equal(out.count, 2);
  const d1 = out.items.find((i) => i.entity_id === D1);
  assert.equal(d1.deal_name, 'Banning Medical');
  assert.equal(d1.new_comms, 2);
  assert.equal(d1.summary_refreshed, true);
  assert.equal(d1.todos_generated, 1);
  const loi = d1.milestones.find((m) => m.key === 'loi');
  assert.equal(loi.written, 1);
  assert.equal(loi.rolled_up, 1);
  assert.equal(d1.dossier_regenerated, false);

  const d2 = out.items.find((i) => i.entity_id === D2);
  assert.equal(d2.dossier_regenerated, true);
  assert.equal(d2.summary_refreshed, false);
});

test('empty ledger → count 0 (caller omits the section)', async () => {
  installFetch([['lcc_deal_comm_propagated', []]]);
  const { fetchDealPropagationDelta } = await import('../api/_shared/briefing-data.js');
  const out = await fetchDealPropagationDelta(24);
  assert.equal(out.count, 0);
  assert.deepEqual(out.items, []);
});
