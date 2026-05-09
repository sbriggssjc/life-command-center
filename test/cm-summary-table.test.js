// Tests for cm-summary-table.js (volume + cap summary table builder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVolumeCapSummary, summaryColumnHeaders, joinVolumeCapQuartile, _internal } from '../api/_shared/cm-summary-table.js';

const { quartersBefore, trailingAvg, rowAt } = _internal;

// ----- quartersBefore arithmetic -----

test('quartersBefore: same year', () => {
  assert.equal(quartersBefore('2024-06-30', 1), '2024-03-31');
  assert.equal(quartersBefore('2024-12-31', 2), '2024-06-30');
  assert.equal(quartersBefore('2024-09-30', 0), '2024-09-30');
});

test('quartersBefore: cross year', () => {
  assert.equal(quartersBefore('2024-03-31', 1), '2023-12-31');
  assert.equal(quartersBefore('2024-06-30', 4), '2023-06-30');
  assert.equal(quartersBefore('2024-06-30', 8), '2022-06-30');
  // 60 quarters = 15 years
  assert.equal(quartersBefore('2024-06-30', 60), '2009-06-30');
});

test('quartersBefore: returns null on bad input', () => {
  assert.equal(quartersBefore(null, 1), null);
  assert.equal(quartersBefore('not-a-date', 1), null);
});

// ----- trailingAvg behaves correctly -----

test('trailingAvg: simple 4-quarter average', () => {
  const rows = [
    { period_end: '2023-09-30', x: 1.0 },
    { period_end: '2023-12-31', x: 2.0 },
    { period_end: '2024-03-31', x: 3.0 },
    { period_end: '2024-06-30', x: 4.0 },
  ];
  assert.equal(trailingAvg(rows, '2024-06-30', 4, ['x']), 2.5);
});

test('trailingAvg: skips nulls', () => {
  const rows = [
    { period_end: '2023-09-30', x: null },
    { period_end: '2023-12-31', x: 2.0 },
    { period_end: '2024-03-31', x: 3.0 },
    { period_end: '2024-06-30', x: 4.0 },
  ];
  // 3 valid samples: (2 + 3 + 4) / 3 = 3.0
  assert.equal(trailingAvg(rows, '2024-06-30', 4, ['x']), 3.0);
});

test('trailingAvg: candidate keys (gov uses ttm_weighted_cap_rate, natl_st uses cap_rate)', () => {
  const rows = [
    { period_end: '2024-03-31', cap_rate: 0.06 },
    { period_end: '2024-06-30', cap_rate: 0.07 },
  ];
  assert.equal(trailingAvg(rows, '2024-06-30', 2, ['ttm_weighted_cap_rate', 'cap_rate']), 0.065);
});

test('trailingAvg: returns null when no rows', () => {
  assert.equal(trailingAvg([], '2024-06-30', 4, ['x']), null);
  assert.equal(trailingAvg(null, '2024-06-30', 4, ['x']), null);
});

// ----- buildVolumeCapSummary end-to-end -----

function makeQuarterly(start_year, start_q, count, fieldName, valueFn) {
  const rows = [];
  let totalQ = start_year * 4 + (start_q - 1);
  for (let i = 0; i < count; i++) {
    const y = Math.floor(totalQ / 4);
    const q = (totalQ % 4) + 1;
    const month = q * 3;
    const day = month === 6 || month === 9 ? 30 : 31;
    rows.push({
      period_end: `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,
      subspecialty: 'all',
      [fieldName]: valueFn(i),
    });
    totalQ++;
  }
  return rows;
}

test('buildVolumeCapSummary: 4 rows × 7 columns with correct period anchoring', () => {
  // 64 quarters = 16 years of data, ending at 2024-06-30
  const volumeRows   = makeQuarterly(2008, 3, 64, 'volume_dollars',         (i) => 1e9 + i * 1e8);
  const capRows      = makeQuarterly(2008, 3, 64, 'ttm_weighted_cap_rate',  (i) => 0.06 + i * 0.0002);
  const quartileRows = makeQuarterly(2008, 3, 64, 'top_quartile',           (i) => 0.05 + i * 0.0002);
  // Add bottom_quartile to quartileRows
  for (let i = 0; i < quartileRows.length; i++) {
    quartileRows[i].bottom_quartile = 0.07 + i * 0.0002;
  }

  const summary = buildVolumeCapSummary({
    volumeRows, capRows, quartileRows,
    asOf: '2024-06-30',
  });

  assert.equal(summary.length, 4);
  const [vol, cap, upper, lower] = summary;

  assert.equal(vol.metric, 'Volume');
  assert.equal(cap.metric, 'Average Cap Rate');
  assert.equal(upper.metric, 'Upper Quartile Cap');
  assert.equal(lower.metric, 'Lower Quartile Cap');

  // Each row has 7 numeric fields
  for (const row of summary) {
    for (const k of ['current_q','prior_q','yoy_q','prior_cycle_q','avg_5yr','avg_10yr','avg_15yr']) {
      assert.ok(typeof row[k] === 'number', `${row.metric}.${k} should be a number, got ${row[k]}`);
    }
  }

  // current_q for volume = last row in series
  // 64th value (i=63): 1e9 + 63 * 1e8 = $7.3B
  assert.equal(vol.current_q, 1e9 + 63 * 1e8);
  // prior_q = i=62
  assert.equal(vol.prior_q, 1e9 + 62 * 1e8);
  // yoy_q = i=59 (4 quarters before)
  assert.equal(vol.yoy_q, 1e9 + 59 * 1e8);
  // prior_cycle_q = i=55 (8 quarters before)
  assert.equal(vol.prior_cycle_q, 1e9 + 55 * 1e8);

  // 5-yr trailing avg = avg of i=44..63 (20 values)
  // value(i) = 1e9 + i*1e8; mean i = (44+63)/2 = 53.5
  // mean value = 1e9 + 5.35e9 = 6.35e9
  assert.ok(Math.abs(vol.avg_5yr - 6.35e9) < 1e7, `5yr avg should be ~$6.35B, got ${vol.avg_5yr}`);

  // 15-yr avg uses 60 quarters (i=4..63); mean i = 33.5; mean value = 1e9 + 3.35e9 = 4.35e9
  assert.ok(Math.abs(vol.avg_15yr - 4.35e9) < 1e7, `15yr avg should be ~$4.35B, got ${vol.avg_15yr}`);
});

test('buildVolumeCapSummary: gov field-name divergence (uses ttm_weighted_cap_rate / top_quartile)', () => {
  const volumeRows   = makeQuarterly(2024, 1, 2, 'volume_dollars',         () => 1e9);
  const capRows      = makeQuarterly(2024, 1, 2, 'ttm_weighted_cap_rate',  () => 0.07);
  const quartileRows = makeQuarterly(2024, 1, 2, 'top_quartile',           () => 0.06);
  for (let i = 0; i < quartileRows.length; i++) {
    quartileRows[i].bottom_quartile = 0.08;
  }

  const summary = buildVolumeCapSummary({ volumeRows, capRows, quartileRows, asOf: '2024-06-30' });
  assert.equal(summary[1].current_q, 0.07);  // cap_rate from ttm_weighted_cap_rate
  assert.equal(summary[2].current_q, 0.06);  // upper from top_quartile
  assert.equal(summary[3].current_q, 0.08);  // lower from bottom_quartile
});

test('buildVolumeCapSummary: natl_st field-name divergence (uses cap_rate / top_quartile_cap)', () => {
  const volumeRows   = makeQuarterly(2024, 1, 2, 'volume_dollars',     () => 1e9);
  const capRows      = makeQuarterly(2024, 1, 2, 'cap_rate',           () => 0.07);
  const quartileRows = makeQuarterly(2024, 1, 2, 'top_quartile_cap',   () => 0.06);
  for (let i = 0; i < quartileRows.length; i++) {
    quartileRows[i].bottom_quartile_cap = 0.08;
  }

  const summary = buildVolumeCapSummary({ volumeRows, capRows, quartileRows, asOf: '2024-06-30' });
  assert.equal(summary[1].current_q, 0.07);
  assert.equal(summary[2].current_q, 0.06);
  assert.equal(summary[3].current_q, 0.08);
});

test('buildVolumeCapSummary: missing prior cycle is null (not a crash)', () => {
  // Only 8 quarters of data (2 years) — prior cycle (8Q ago) won't exist
  const volumeRows   = makeQuarterly(2022, 3, 8, 'volume_dollars',  () => 1e9);
  const capRows      = makeQuarterly(2022, 3, 8, 'cap_rate',        () => 0.07);
  const quartileRows = makeQuarterly(2022, 3, 8, 'top_quartile_cap',() => 0.06);

  const summary = buildVolumeCapSummary({ volumeRows, capRows, quartileRows, asOf: '2024-06-30' });
  // current_q exists
  assert.equal(summary[0].current_q, 1e9);
  // yoy_q = 2023-06-30, exists
  assert.equal(summary[0].yoy_q, 1e9);
  // prior_cycle_q = 2022-06-30, doesn't exist (data starts 2022-09-30)
  assert.equal(summary[0].prior_cycle_q, null);
});

test('buildVolumeCapSummary: as_of resolves to last volume row when omitted', () => {
  const volumeRows   = makeQuarterly(2024, 1, 4, 'volume_dollars',  (i) => 1e9 + i * 1e8);
  const capRows      = makeQuarterly(2024, 1, 4, 'cap_rate',        () => 0.07);
  const quartileRows = makeQuarterly(2024, 1, 4, 'top_quartile_cap',() => 0.06);

  const summary = buildVolumeCapSummary({ volumeRows, capRows, quartileRows /* no asOf */ });
  // 4th value = 1e9 + 3 * 1e8 = $1.3B
  assert.equal(summary[0].current_q, 1.3e9);
  assert.equal(summary[0].as_of, '2024-12-31');
});

test('buildVolumeCapSummary: empty series returns empty array', () => {
  assert.deepEqual(buildVolumeCapSummary({ volumeRows: [], capRows: [], quartileRows: [] }), []);
});

test('summaryColumnHeaders: produces YYYY-Qn for each period column', () => {
  const headers = summaryColumnHeaders('2024-06-30');
  assert.equal(headers[0], '2024-Q2');
  assert.equal(headers[1], '2024-Q1');
  assert.equal(headers[2], '2023-Q2');
  assert.equal(headers[3], '2022-Q2');
  assert.equal(headers[4], '5-Yr Avg');
  assert.equal(headers[5], '10-Yr Avg');
  assert.equal(headers[6], '15-Yr Avg');
});

// ----- joinVolumeCapQuartile -----

test('joinVolumeCapQuartile: joins 3 series on period_end (gov field names)', () => {
  const volumeRows = [
    { period_end: '2024-03-31', subspecialty: 'all', volume_dollars: 9.5e9 },
    { period_end: '2024-06-30', subspecialty: 'all', volume_dollars: 9.8e9 },
  ];
  const capRows = [
    { period_end: '2024-03-31', subspecialty: 'all', ttm_weighted_cap_rate: 0.0740 },
    { period_end: '2024-06-30', subspecialty: 'all', ttm_weighted_cap_rate: 0.0747 },
  ];
  const quartileRows = [
    { period_end: '2024-03-31', subspecialty: 'all', top_quartile: 0.066, bottom_quartile: 0.082 },
    { period_end: '2024-06-30', subspecialty: 'all', top_quartile: 0.064, bottom_quartile: 0.080 },
  ];
  const joined = joinVolumeCapQuartile({ volumeRows, capRows, quartileRows });
  assert.equal(joined.length, 2);
  assert.deepEqual(joined[0], {
    period_end: '2024-03-31', subspecialty: 'all',
    volume_dollars: 9.5e9, cap_rate: 0.0740,
    upper_quartile: 0.066, lower_quartile: 0.082,
  });
  assert.deepEqual(joined[1], {
    period_end: '2024-06-30', subspecialty: 'all',
    volume_dollars: 9.8e9, cap_rate: 0.0747,
    upper_quartile: 0.064, lower_quartile: 0.080,
  });
});

test('joinVolumeCapQuartile: handles natl_st field names (cap_rate / top_quartile_cap)', () => {
  const volumeRows = [
    { period_end: '2025-12-31', subspecialty: 'all', volume_dollars: 126.7e9 },
  ];
  const capRows = [
    { period_end: '2025-12-31', subspecialty: 'all', cap_rate: 0.0688 },
  ];
  const quartileRows = [
    { period_end: '2025-12-31', subspecialty: 'all', top_quartile_cap: 0.0616, bottom_quartile_cap: null },
  ];
  const joined = joinVolumeCapQuartile({ volumeRows, capRows, quartileRows });
  assert.equal(joined.length, 1);
  assert.equal(joined[0].cap_rate, 0.0688);
  assert.equal(joined[0].upper_quartile, 0.0616);
  assert.equal(joined[0].lower_quartile, null);
});

test('joinVolumeCapQuartile: drops rows with null volume', () => {
  const volumeRows = [
    { period_end: '2024-03-31', subspecialty: 'all', volume_dollars: null },
    { period_end: '2024-06-30', subspecialty: 'all', volume_dollars: 9.8e9 },
  ];
  const joined = joinVolumeCapQuartile({ volumeRows, capRows: [], quartileRows: [] });
  assert.equal(joined.length, 1);
  assert.equal(joined[0].period_end, '2024-06-30');
});

test('joinVolumeCapQuartile: missing cap/quartile rows leave nulls (not crashes)', () => {
  const volumeRows = [
    { period_end: '2024-06-30', subspecialty: 'all', volume_dollars: 9.8e9 },
  ];
  const joined = joinVolumeCapQuartile({ volumeRows, capRows: [], quartileRows: [] });
  assert.equal(joined.length, 1);
  assert.equal(joined[0].volume_dollars, 9.8e9);
  assert.equal(joined[0].cap_rate, null);
  assert.equal(joined[0].upper_quartile, null);
  assert.equal(joined[0].lower_quartile, null);
});

test('joinVolumeCapQuartile: empty input returns empty array', () => {
  assert.deepEqual(joinVolumeCapQuartile({}), []);
  assert.deepEqual(joinVolumeCapQuartile({ volumeRows: [] }), []);
});
