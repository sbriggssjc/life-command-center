// P139 — the provenance_conflict lane's two sub-populations must INTERLEAVE.
//
// P137 wired the field_source_priority ladder into the clean-assist gate (433 of
// 454 cross-source conflicts are ladder-decidable) and the payoff stayed
// invisible, because the lane carried TWO INCOMPARABLE RANK SCALES sharing one
// budget: field_provenance on `_provImportance` (ceiling 1000) and dia
// sales-price xref on `1000 + severity`. Measured live 2026-08-26: the dia view
// hard-codes `1::int AS severity`, so that expression is the CONSTANT 1001 —
// never a value signal, just an offset one point above the other scale's
// ceiling. All 65 xref rows therefore outranked all 454 field_provenance rows,
// permanently, and both bounded windows that read this lane (the human Decision
// Center's `limit=50` fetch, the assist tick's `perType` slice) saw nothing else.
//
// The fix has TWO halves and each fails silently on its own:
//   1. ONE comparable rank scale, so value decides order — but the populations
//      are internally homogeneous, so a re-rank ALONE just inverts which one is
//      invisible (measured: 155 field_provenance rows score above the xref band,
//      so strict rank puts 50 of 50 shown cards on field_provenance).
//   2. An explicit INTERLEAVE KEY, so any bounded prefix carries both.
//
// GUARD DESIGN (per the CLAUDE.md block-slice footgun): these tests exercise the
// exported pure functions directly wherever possible, and the one source check
// anchors on the `subject_ref` prefix literals — stable identity tokens the lane
// cannot change without changing what a decision row IS — never on a line number
// or a sliced region.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  interleaveByKind, provRankBandsAreSeparable,
  _provRankFieldProvenance, _provRankSalesXref, _provMagnitudeTiebreak,
} from '../api/admin.js';

const xref = (price, severity = 1) => ({ detail_2: String(price), detail_3: String(Math.round(price * 0.9)), severity });
const fp = (field_name, { decidable = true, value = null } = {}) => ({
  field_name, attempted_priority: 45, current_priority: decidable ? 20 : 45,
  attempted_value: value, current_value: null,
});
const kinds = (arr) => arr.reduce((a, it) => { a[it.context.kind] = (a[it.context.kind] || 0) + 1; return a; }, {});

// Live shape 2026-08-26: 454 field_provenance cross-source rows / 65 xref rows.
function liveShapeLane() {
  const FIELDS = [['tenant', 54, 54], ['year_built', 41, 33], ['company', 33, 33], ['assessed_value', 32, 32],
    ['contact_name', 28, 28], ['annual_rent', 25, 25], ['leased_area', 24, 24], ['parcel_number', 22, 9],
    ['rent_per_sf', 20, 20], ['role', 18, 18], ['renewal_options', 17, 17], ['guarantor', 15, 15],
    ['expense_structure', 13, 13], ['initial_price', 13, 13], ['last_price', 13, 13],
    ['total_assessed_value', 12, 12], ['land_value', 12, 12], ['improvement_value', 10, 10],
    ['current_cap_rate', 9, 9], ['initial_cap_rate', 9, 9], ['lot_sf', 8, 8], ['lease_start', 7, 7],
    ['listing_broker', 6, 6], ['broker_email', 6, 6], ['lease_expiration', 5, 5],
    ['hvac_responsibility', 1, 1], ['roof_responsibility', 1, 1]];
  const items = [];
  let i = 0;
  for (const [f, n, dec] of FIELDS) {
    for (let k = 0; k < n; k += 1) {
      const row = fp(f, { decidable: k < dec, value: /price|rent|value/.test(f) ? String(500000 + k * 1000) : 'text' });
      items.push({ subject_ref: 'prov:' + (i += 1), rank_value: _provRankFieldProvenance(row),
        context: { kind: 'field_provenance' } });
    }
  }
  for (let k = 0; k < 65; k += 1) {
    const price = Math.round(780915 + (k * (22750000 - 780915)) / 64);
    items.push({ subject_ref: 'prov:dia_xref:' + k, rank_value: _provRankSalesXref(xref(price)),
      context: { kind: 'sales_price_xref' } });
  }
  return items.sort((a, b) => (b.rank_value - a.rank_value) || String(a.subject_ref).localeCompare(String(b.subject_ref)));
}

describe('P139 — one comparable rank scale', () => {
  test('the magnitude tiebreak can never promote a row out of its band', () => {
    assert.equal(provRankBandsAreSeparable(), true);
    // The widest possible tiebreak still loses to the narrowest band gap.
    assert.ok(_provMagnitudeTiebreak(['999999999999']) <= 99);
    assert.equal(_provMagnitudeTiebreak(['not a number']), 0);
    assert.equal(_provMagnitudeTiebreak([null, undefined, '']), 0);
    // A year is a number but must not out-rank its own descriptive band.
    assert.ok(_provRankFieldProvenance(fp('year_built', { value: '1985' }))
      < _provRankFieldProvenance(fp('tenant')));
  });

  test('xref rank ignores severity (constant on the source view) and reads magnitude', () => {
    // The whole defect: `1000 + severity` treated a hard-coded 1 as a value.
    assert.equal(_provRankSalesXref(xref(5000000, 1)), _provRankSalesXref(xref(5000000, 9)));
    // The real signal — a 29x price spread — now separates.
    assert.ok(_provRankSalesXref(xref(22750000)) > _provRankSalesXref(xref(780915)));
  });

  test('a ladder-decidable money conflict outranks an xref row; an undecidable one does not', () => {
    const topXref = _provRankSalesXref(xref(22750000));
    assert.ok(_provRankFieldProvenance(fp('annual_rent', { decidable: true })) > topXref,
      'ladder-decidable money conflict must be able to rank ahead of xref');
    assert.ok(_provRankFieldProvenance(fp('annual_rent', { decidable: false })) < topXref,
      'an undecidable money conflict must NOT outrank a high-value xref row');
    // Neither scale may re-open the 1000+ escape hatch the fix closed.
    for (const r of [_provRankSalesXref(xref(999999999)), _provRankFieldProvenance(fp('sold_price'))]) {
      assert.ok(r > 0 && r <= 1000, 'ranks must stay inside the shared 0-1000 band, got ' + r);
    }
  });
});

describe('P139 — the explicit interleave key', () => {
  test('strict rank alone hides one sub-population from the 50-card window', () => {
    // Documents WHY the interleave exists: this is the state a re-rank leaves.
    const ranked = liveShapeLane();
    const strict = kinds(ranked.slice(0, 50));
    assert.equal(strict.sales_price_xref, undefined,
      'live shape check: strict rank order really does drop xref off the visible page');
  });

  test('proportional mode puts both sub-populations in the visible window', () => {
    const lane = interleaveByKind(liveShapeLane(), 'proportional');
    const shown = kinds(lane.slice(0, 50));
    assert.ok(shown.field_provenance > 0 && shown.sales_price_xref > 0,
      'both sub-populations must appear in the 50 cards the lane renders');
    // Share tracks population size (454:65), so neither monopolises and neither
    // is over-promoted past its real weight in the backlog.
    assert.ok(shown.sales_price_xref >= 3 && shown.sales_price_xref <= 12,
      'xref share should track its ~12.5% of the lane, got ' + shown.sales_price_xref);
    // Value still leads: the highest-ranked row overall is still card #1.
    assert.equal(lane[0].rank_value, Math.max(...lane.map((x) => x.rank_value)));
  });

  test('equal mode gives the assist tick both kinds in a 3-item window', () => {
    // Proportional would round xref to ZERO here — ~39 runs to the first card.
    const take = interleaveByKind(liveShapeLane(), 'equal').slice(0, 3);
    const got = kinds(take);
    assert.ok(got.field_provenance > 0, 'tick must reach field_provenance ladder cards on run 1');
    assert.ok(got.sales_price_xref > 0, 'tick must not starve xref');
  });

  test('a single-kind lane is returned unchanged, and nothing is lost or duplicated', () => {
    const solo = [3, 2, 1].map((n) => ({ subject_ref: 's' + n, rank_value: n, context: { kind: 'ore' } }));
    for (const mode of ['proportional', 'equal']) {
      assert.deepEqual(interleaveByKind(solo, mode).map((x) => x.subject_ref), ['s3', 's2', 's1']);
    }
    const lane = liveShapeLane();
    for (const mode of ['proportional', 'equal']) {
      const out = interleaveByKind(lane, mode);
      assert.equal(out.length, lane.length, mode + ' must not drop items');
      assert.equal(new Set(out.map((x) => x.subject_ref)).size, lane.length, mode + ' must not duplicate items');
    }
    // Rank order is preserved WITHIN each sub-population in both modes.
    for (const mode of ['proportional', 'equal']) {
      const only = interleaveByKind(lane, mode).filter((x) => x.context.kind === 'sales_price_xref');
      const sorted = only.slice().sort((a, b) => b.rank_value - a.rank_value);
      assert.deepEqual(only.map((x) => x.subject_ref), sorted.map((x) => x.subject_ref));
    }
    assert.deepEqual(interleaveByKind([], 'proportional'), []);
  });
});

describe('P139 — the lane arms stay on the shared scale', () => {
  // Anchored on the subject_ref prefix literals, not a line or a source slice:
  // a provenance item IS `prov:<id>` / `prov:dia_xref:<id>`, so this cannot go
  // stale by code moving, and it goes red the moment an arm reintroduces its own
  // ad-hoc rank expression.
  test('both arms rank via the shared _provRank* helpers', () => {
    const src = readFileSync(new URL('../api/admin.js', import.meta.url), 'utf8');
    for (const [prefix, helper] of [["'prov:' + row.provenance_id", '_provRankFieldProvenance'],
      ["'prov:dia_xref:' + row.record_id", '_provRankSalesXref']]) {
      const at = src.indexOf(prefix);
      assert.ok(at > 0, 'lane arm anchor not found: ' + prefix);
      // The rank_value for this item is the next one after the subject_ref.
      const rankAt = src.indexOf('rank_value:', at);
      const line = src.slice(rankAt, src.indexOf('\n', rankAt));
      assert.match(line, new RegExp(helper),
        'arm ' + prefix + ' must rank via ' + helper + ', got: ' + line.trim());
      assert.doesNotMatch(line, /\d{3,}\s*\+/,
        'arm ' + prefix + ' must not carry its own numeric rank offset: ' + line.trim());
    }
  });

  test('the human lane emits sub-population counts so the smaller one is one click away', () => {
    const src = readFileSync(new URL('../api/admin.js', import.meta.url), 'utf8');
    const at = src.indexOf("'prov:dia_xref:' + row.record_id");
    const tail = src.slice(at, at + 4000);
    assert.match(tail, /out\.parts\s*=\s*\{[\s\S]*field_provenance[\s\S]*sales_price_xref/,
      'provenance lane must return parts for the seeder chips');
    const ui = readFileSync(new URL('../dc-lanes.js', import.meta.url), 'utf8');
    assert.match(ui, /type === 'provenance_conflict'[\s\S]{0,400}?sales_price_xref/,
      'dc-lanes must render the provenance sub-population chips');
  });
});
