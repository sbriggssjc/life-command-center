// MB-b §0.1 guard — "no two live band facts share an operator_id." Per-
// operator cap-rate bands must group on the canonical `operator_id` the
// comps engine resolves (ID2a/ID2b), never a name-based normalization map
// added locally in this producer — and where two distinct comps-engine rows
// somehow carry the SAME operator_id under two different raw tenant labels,
// they must collapse into exactly ONE fact_key, never two.
//
// Pure / no-DB: planOperatorCapRateBands takes rpc_query_comps-shaped rows
// (already fixture-testable per market-brief-psql-tick.js's own header
// comment) and returns the facts it WOULD write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planOperatorCapRateBands } from '../api/_handlers/market-brief-psql-tick.js';

function row({ operator_id = null, operator_canonical = null, tenant, cap_rate = 0.07, sale_date = '2026-08-01' }) {
  return { operator_id, operator_canonical, tenant, cap_rate, sale_date };
}

test('planOperatorCapRateBands never emits two live band facts sharing one operator_id', () => {
  const rows = [
    ...Array.from({ length: 6 }, () => row({ operator_id: 'op-1', operator_canonical: 'DaVita', tenant: 'DaVita Inc.' })),
    ...Array.from({ length: 5 }, () => row({ operator_id: 'op-1', operator_canonical: 'DaVita', tenant: 'DaVita Dialysis' })), // SAME id, different raw tenant text
    ...Array.from({ length: 5 }, () => row({ operator_id: 'op-2', operator_canonical: 'Fresenius Medical Care', tenant: 'Fresenius' })),
  ];
  const { facts } = planOperatorCapRateBands({ rows, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });

  const idKeyedFactKeys = facts.map((f) => f.fact_key).filter((k) => /^cap_rate_ttm_band:op-/.test(k));
  const seen = new Set();
  for (const k of idKeyedFactKeys) {
    assert.ok(!seen.has(k), `fact_key ${k} was emitted more than once — two live band facts would share an operator_id`);
    seen.add(k);
  }
  // Same operator_id under two raw tenant labels must merge into ONE band, not two.
  assert.equal(facts.filter((f) => f.fact_key === 'cap_rate_ttm_band:op-1').length, 1);
  const davitaBand = facts.find((f) => f.fact_key === 'cap_rate_ttm_band:op-1');
  assert.equal(davitaBand._n, 11); // 6 + 5 rows collapsed under the one canonical id
});

test('planOperatorCapRateBands falls back to raw-text grouping for a comp with no resolved operator_id, never dropping it', () => {
  const rows = Array.from({ length: 5 }, () => row({ operator_id: null, operator_canonical: null, tenant: 'Unresolved Operator LLC' }));
  const { facts } = planOperatorCapRateBands({ rows, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  const textKeyed = facts.find((f) => f.fact_key === 'cap_rate_ttm_band:unresolved_operator_llc');
  assert.ok(textKeyed, 'a comp with no operator_id must still form its own text-keyed band');
});

test('planOperatorCapRateBands refuses to emit two DIFFERENT resolved operator_id groups under one identical canonical label', () => {
  const rows = [
    ...Array.from({ length: 7 }, () => row({ operator_id: 'op-a', operator_canonical: 'Ambiguous Co', tenant: 'Ambiguous Co' })),
    ...Array.from({ length: 5 }, () => row({ operator_id: 'op-b', operator_canonical: 'Ambiguous Co', tenant: 'Ambiguous Co' })), // registry defect: two ids, one label
  ];
  const { facts } = planOperatorCapRateBands({ rows, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  const ambiguousFacts = facts.filter((f) => /ambiguous_co/.test(f.fact_key) || f.claim_text.includes('Ambiguous Co'));
  assert.equal(ambiguousFacts.length, 1, 'only the larger-n group may be emitted; the loser must be refused, not co-published under the same label');
});
