import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { buildPropertyReviewReceipt, buildPropertySamplingFrame, serializePropertyReviewReceipt } from '../scripts/healthcare-discovery/property-review.mjs';

const fingerprint = (value) => createHash('sha256').update(value).digest('hex');
const contract = {
  contract_version: 'healthcare_property_review:1.0',
  lane: 'asc',
  release_id: fingerprint('synthetic-asc-release'),
  sample_size: 50,
  seed: 'asc-property-review-2026-08-11',
  cells: [
    { name: 'freestanding', quota: 15, all: [{ field: 'property_hint', in: ['freestanding'] }] },
    { name: 'mob_campus_unknown', quota: 10, all: [{ field: 'property_hint', in: ['mob', 'campus', 'unknown'] }] },
    { name: 'high_economics_evidence', quota: 10, all: [{ field: 'economics_evidence', in: ['high'] }] },
    { name: 'independent_operator', quota: 5, all: [{ field: 'operator_size', in: ['independent'] }] },
    { name: 'multi_site_operator', quota: 5, all: [{ field: 'operator_size', in: ['multi_site'] }] },
    { name: 'lcc_exact_match', quota: 5, all: [{ field: 'lcc_match', in: ['exact'] }] },
  ],
};

function candidates() {
  const rows = [];
  for (const [cell, count] of [['freestanding', 18], ['mob_campus_unknown', 13], ['high_economics_evidence', 13], ['independent_operator', 8], ['multi_site_operator', 8], ['lcc_exact_match', 8]]) {
    for (let index = 0; index < count; index += 1) rows.push({
      candidate_fingerprint: fingerprint(`${cell}:${index}`),
      property_hint: cell === 'freestanding' ? 'freestanding' : cell === 'mob_campus_unknown' ? 'mob' : 'other',
      economics_evidence: cell === 'high_economics_evidence' ? 'high' : 'standard',
      operator_size: cell === 'independent_operator' ? 'independent' : cell === 'multi_site_operator' ? 'multi_site' : 'other',
      lcc_match: cell === 'lcc_exact_match' ? 'exact' : 'none',
    });
  }
  return rows;
}

test('sampling frame selects 50 nonoverlapping candidates deterministically by ordered strata', () => {
  const first = buildPropertySamplingFrame(candidates(), contract);
  const second = buildPropertySamplingFrame([...candidates()].reverse(), contract);
  assert.equal(first.sample_size, 50);
  assert.equal(new Set(first.selected.map((row) => row.candidate_fingerprint)).size, 50);
  assert.deepEqual(first, second);
  assert.deepEqual(first.cell_counts, { freestanding: 15, mob_campus_unknown: 10, high_economics_evidence: 10, independent_operator: 5, multi_site_operator: 5, lcc_exact_match: 5 });
});

test('sampling frame fails closed when a cell cannot meet its frozen quota', () => {
  assert.throws(() => buildPropertySamplingFrame(candidates().filter((row) => row.property_hint !== 'freestanding'), contract), /freestanding has 0 eligible/);
});

test('aggregate review receipt calculates all brokerage gates and research cost', () => {
  const frame = buildPropertySamplingFrame(candidates(), contract);
  const reviews = frame.selected.map((selected, index) => ({
    candidate_fingerprint: selected.candidate_fingerprint,
    clinical_verified: index < 46,
    property_form: index < 24 ? 'stnl' : index < 44 ? 'minority_mob' : 'unknown',
    landlord_addressable: index < 16,
    economics_bounded: index < 13,
    clinical_minutes: 5,
    property_minutes: 10 + index,
    ownership_minutes: 5,
    economics_minutes: 10,
    contact_minutes: 5,
  }));
  const receipt = buildPropertyReviewReceipt(frame, reviews);
  assert.deepEqual(receipt.metrics, { clinical_precision: 0.92, property_classification: 0.88, qualifying_property_share: 0.5455, addressable_path_share: 0.6667, bounded_economics_share: 0.5417 });
  assert.equal(receipt.gate_result, 'pass');
  assert.deepEqual(receipt.research_minutes, { median: 59, p90: 79 });
  const serialized = serializePropertyReviewReceipt(receipt);
  assert.doesNotMatch(serialized, new RegExp(frame.selected[0].candidate_fingerprint));
  assert.match(serialized, /"record_level_identifiers_emitted":false/);
});

test('review receipt rejects duplicates and incomplete frames', () => {
  const frame = buildPropertySamplingFrame(candidates(), contract);
  const reviews = frame.selected.map((selected) => ({ candidate_fingerprint: selected.candidate_fingerprint, clinical_verified: true, property_form: 'stnl', landlord_addressable: true, economics_bounded: true, clinical_minutes: 1, property_minutes: 1, ownership_minutes: 1, economics_minutes: 1, contact_minutes: 1 }));
  reviews[49] = reviews[0];
  assert.throws(() => buildPropertyReviewReceipt(frame, reviews), /exactly once/);
});
