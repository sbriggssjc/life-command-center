import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';

import { profileHealthcareLane, runLaneProfile, serializeLaneProfile } from '../scripts/healthcare-discovery/lane-profile.mjs';

const fixtureRoot = path.resolve('test/fixtures/healthcare-discovery');

test('ASC lane profile reports aggregate operational corroboration without brokerage inference', async () => {
  const receipt = await profileHealthcareLane(path.join(fixtureRoot, 'asc-manifest.valid.json'), { fixtureRoot });
  assert.deepEqual(receipt.candidate_counts, { facility_seed: 3, discovery_eligible: 1, discovery_excluded: 2 });
  assert.deepEqual(receipt.classification_counts.facility_status, { active: 2, inactive: 1 });
  assert.equal(receipt.coverage.quality_corroborated, 0.6667);
  assert.equal(receipt.coverage.enrollment_address_matched, 0.3333);
  assert.equal(receipt.brokerage_gates.property_form, 'not_evaluated');
  assert.equal(receipt.decision, 'source_profile_only');
});

test('IDTF lane profile excludes reviewed forms and keeps unknown sites unproven', async () => {
  const receipt = await profileHealthcareLane(path.join(fixtureRoot, 'idtf-manifest.valid.json'), { fixtureRoot });
  assert.deepEqual(receipt.candidate_counts, { supplier_locations: 4, discovery_eligible: 1, discovery_unproven: 1, discovery_excluded: 2 });
  assert.deepEqual(receipt.classification_counts.site_form, { fixed_site_confirmed: 1, fixed_site_unproven: 1, excluded: 2 });
  assert.deepEqual(receipt.classification_counts.exclusion_reason, { mobile_unit: 1, physician_office: 1 });
  assert.equal(receipt.coverage.nppes_address_matched, 0.5);
  assert.equal(receipt.coverage.utilization_observed, 0.5);
  assert.equal(receipt.coverage.unsuppressed_utilization, 0.25);
});

test('lane receipts are deterministic and contain no synthetic record-level identifiers', async () => {
  const manifestPath = path.join(fixtureRoot, 'idtf-manifest.valid.json');
  const first = serializeLaneProfile(await profileHealthcareLane(manifestPath, { fixtureRoot }));
  const second = serializeLaneProfile(await profileHealthcareLane(manifestPath, { fixtureRoot }));
  assert.equal(first, second);
  assert.doesNotMatch(first, /Synthetic|9000000|ENR000|Test Road|ASC000/i);
  assert.match(first, /"record_level_identifiers_emitted":\s*false/);
});

test('lane profiler enforces the manifest row ceiling', async () => {
  const manifestPath = path.join(fixtureRoot, 'asc-manifest.valid.json');
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8'));
  manifest.limits.max_rows = 2;
  const temporary = path.join(fixtureRoot, 'asc-manifest.row-limit.tmp.json');
  const { writeFile, unlink } = await import('node:fs/promises');
  await writeFile(temporary, JSON.stringify(manifest));
  await assert.rejects(profileHealthcareLane(temporary, { fixtureRoot }), /max_rows/);
  await unlink(temporary);
});

test('lane profiler enforces the candidate-state ceiling', async () => {
  const manifestPath = path.join(fixtureRoot, 'asc-manifest.valid.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.limits.max_candidate_fingerprints = 2;
  const temporary = path.join(fixtureRoot, 'asc-manifest.candidate-limit.tmp.json');
  const { writeFile, unlink } = await import('node:fs/promises');
  await writeFile(temporary, JSON.stringify(manifest));
  await assert.rejects(profileHealthcareLane(temporary, { fixtureRoot }), /max_candidate_fingerprints/);
  await unlink(temporary);
});

test('lane profile command writes the canonical receipt atomically', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'healthcare-lane-profile-'));
  const output = path.join(temporaryRoot, 'receipt.json');
  try {
    const receipt = await runLaneProfile(path.join(fixtureRoot, 'asc-manifest.valid.json'), output, { fixtureRoot });
    assert.equal(await readFile(output, 'utf8'), serializeLaneProfile(receipt));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
