// R55 Unit 2 — assembleBdWorklist: normalize + merge + dedup + value-rank the
// five BD signal sources into one worklist. Pure function, no DB.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';

const { assembleBdWorklist } = await import('../api/operations.js');

describe('assembleBdWorklist', () => {
  it('merges all five sources and ranks value-first', () => {
    const wl = assembleBdWorklist({
      lcc: [
        { signal_type: 'contact_writeback', source_domain: 'gov', property_id: null, entity_id: 'e1', what: 'Push contact to Salesforce', who: 'Jane Doe', rank_value: 5000, detail: { email: 'j@x.com' } },
        { signal_type: 'ownership_chain', source_domain: 'gov', property_id: '900', entity_id: 'e2', what: 'Resolve ownership chain to developer', who: 'Acme LLC', rank_value: 30000, detail: { gap: 'developer_unidentified' } },
      ],
      loan_maturity: {
        gov: [{ property_id: '100', owner_name: 'Owner A', annual_rent: 50000, maturity_band: '<=6mo', is_distressed: false }],
        dia: [{ property_id: '200', owner_name: 'Owner B', annual_rent: 80000, maturity_band: 'matured', is_distressed: true, distress_reason: 'dscr_below_1' }],
      },
      suspected_sale: { gov: [{ property_id: '300', suspected_grantor: 'X', suspected_grantee: 'Y', annual_rent: 90000, signal_source: 'gsa_lessor_change' }] },
      owner_conflict: {
        gov: [{ property_id: '400', recorded_owner_name: 'Broker Co', latest_deed_grantee: 'Real Owner', conflict_kind: 'broker_as_owner', annual_rent: 70000 }],
        dia: [{ property_id: '500', recorded_owner_name: 'A', latest_deed_grantee: 'B', conflict_kind: 'stale_seller', annual_rent: null }],
      },
    });
    // value-first ordering: 90000 suspected, 80000 distressed loan, 70000 conflict, 50000 loan, 30000 chain, 5000 contact, 0 dia conflict (null rent)
    assert.deepEqual(wl.map((r) => r.rank_value), [90000, 80000, 70000, 50000, 30000, 5000, 0]);
    assert.equal(wl[0].signal_type, 'suspected_sale');
    assert.equal(wl[1].signal_type, 'loan_maturity');
    assert.equal(wl[1].is_distressed, true);
    // all six signal types represented; six distinct signal kinds across 7 rows
    assert.equal(wl.length, 7);
    // deep links wired
    assert.equal(wl[0].deep_link.lane, 'suspected_sale');
    assert.equal(wl.find((r) => r.signal_type === 'contact_writeback').deep_link.surface, 'entity');
  });

  it('dedups one row per (signal, domain, property) keeping the higher value', () => {
    const wl = assembleBdWorklist({
      loan_maturity: {
        gov: [
          { property_id: '100', owner_name: 'A', annual_rent: 10000, maturity_band: '<=6mo' },
          { property_id: '100', owner_name: 'A', annual_rent: 99000, maturity_band: '<=6mo' },
        ],
      },
    });
    assert.equal(wl.length, 1);
    assert.equal(wl[0].rank_value, 99000);
  });

  it('keeps the SAME property under DIFFERENT signal types (distinct actions)', () => {
    const wl = assembleBdWorklist({
      loan_maturity: { gov: [{ property_id: '100', owner_name: 'A', annual_rent: 10000, maturity_band: '<=6mo' }] },
      owner_conflict: { gov: [{ property_id: '100', recorded_owner_name: 'A', latest_deed_grantee: 'B', conflict_kind: 'broker_as_owner', annual_rent: 20000 }] },
    });
    assert.equal(wl.length, 2);
    assert.deepEqual(new Set(wl.map((r) => r.signal_type)), new Set(['loan_maturity', 'owner_source_conflict']));
  });

  it('empty sources → empty worklist (no throw)', () => {
    assert.deepEqual(assembleBdWorklist({}), []);
    assert.deepEqual(assembleBdWorklist(), []);
  });

  it('distressed loan sorts ahead of a same-value non-distressed signal', () => {
    const wl = assembleBdWorklist({
      loan_maturity: { gov: [{ property_id: '1', owner_name: 'A', annual_rent: 50000, maturity_band: 'matured', is_distressed: true }] },
      owner_conflict: { gov: [{ property_id: '2', recorded_owner_name: 'A', latest_deed_grantee: 'B', conflict_kind: 'broker_as_owner', annual_rent: 50000 }] },
    });
    assert.equal(wl[0].signal_type, 'loan_maturity');
    assert.equal(wl[0].is_distressed, true);
  });
});
