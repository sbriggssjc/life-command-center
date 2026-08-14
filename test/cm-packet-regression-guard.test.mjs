import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packetPopulatedIds, packetRegressions } from '../api/capital-markets.js';

const pkt = (charts) => ({ charts });
const chart = (id, n) => ({ chart_template_id: id, rows: Array.from({ length: n }, (_, i) => ({ i })) });

test('packetPopulatedIds counts only charts with >=1 row', () => {
  const ids = packetPopulatedIds(pkt([chart('a', 3), chart('b', 0), chart('c', 1)]));
  assert.deepEqual([...ids].sort(), ['a', 'c']);
});

test('packetPopulatedIds tolerates missing/empty packets', () => {
  assert.equal(packetPopulatedIds(null).size, 0);
  assert.equal(packetPopulatedIds({}).size, 0);
  assert.equal(packetPopulatedIds({ charts: [] }).size, 0);
});

test('no regression when new packet keeps every populated chart', () => {
  const oldP = pkt([chart('a', 3), chart('b', 5)]);
  const newP = pkt([chart('a', 4), chart('b', 2)]); // values changed, still populated
  assert.deepEqual(packetRegressions(newP, oldP), []);
});

test('regression detected when a populated chart goes empty', () => {
  const oldP = pkt([chart('a', 3), chart('b', 5), chart('seller_sentiment', 306)]);
  const newP = pkt([chart('a', 3), chart('b', 5), chart('seller_sentiment', 0)]);
  assert.deepEqual(packetRegressions(newP, oldP), ['seller_sentiment']);
});

test('regression detected when a populated chart is dropped entirely', () => {
  const oldP = pkt([chart('a', 3), chart('sold_cap_by_term_dot_plot', 258)]);
  const newP = pkt([chart('a', 3)]);
  assert.deepEqual(packetRegressions(newP, oldP), ['sold_cap_by_term_dot_plot']);
});

test('chronically-empty charts (empty in both) never count as regressions', () => {
  const oldP = pkt([chart('a', 3), chart('cpi_vs_renewal_cagr', 0)]);
  const newP = pkt([chart('a', 3), chart('cpi_vs_renewal_cagr', 0)]);
  assert.deepEqual(packetRegressions(newP, oldP), []);
});

test('adding a newly-populated chart is an improvement, not a regression', () => {
  const oldP = pkt([chart('a', 3)]);
  const newP = pkt([chart('a', 3), chart('b', 10)]);
  assert.deepEqual(packetRegressions(newP, oldP), []);
});
