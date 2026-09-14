import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { normalizeAddress } from '../scripts/healthcare-discovery/normalize.mjs';
import { canonicalJson, profileNppesFile } from '../scripts/healthcare-discovery/nppes.mjs';
import { runProfile } from '../scripts/healthcare-discovery/profile.mjs';

const fixtureRoot = path.resolve('test/fixtures/healthcare-discovery');

test('address normalization is versioned and deterministic', () => {
  assert.deepEqual(normalizeAddress({
    line1: '100 Synthetic Clinic Road.', city: 'Testville', state: 'ok', postalCode: '74101-1234', country: 'us',
  }), {
    line1: '100 SYNTHETIC CLINIC RD', line2: '', city: 'TESTVILLE', state: 'OK', postal_code: '74101', country: 'US', complete: true,
  });
});

test('streaming NPPES profile emits aggregate-only deterministic results', async () => {
  const receipt = await profileNppesFile(path.join(fixtureRoot, 'nppes-v2-synthetic.csv'), {
    freezeDate: '2000-01-31', manifestSha256: 'a'.repeat(64), taxonomyFingerprint: 'b'.repeat(64),
    transformVersion: `git:${'1'.repeat(40)}`,
  });
  assert.deepEqual(receipt.counts, {
    source_rows: 8, parsed_rows: 3, eligible_organizations: 3, candidate_locations: 3,
    excluded: 5, malformed: 0, primary_source_rows: 8, secondary_source_rows: 0,
  });
  assert.deepEqual(receipt.breakdowns.modality, { oncology: 2, infusion_therapy: 1, radiation_oncology: 1 });
  assert.equal(receipt.breakdowns.collision_class.multi_npi_same_candidate, 1);
  assert.equal(receipt.breakdowns.exclusion_reason.not_organization, 1);
  const serialized = canonicalJson(receipt);
  assert.doesNotMatch(serialized, /9000000001|SYNTHETIC CLINIC|TESTVILLE/i);
});

test('profile command validates inputs and writes canonical receipt atomically', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'healthcare-profile-'));
  const output = path.join(temp, 'receipt.json');
  const receipt = await runProfile(path.join(fixtureRoot, 'manifest.valid.json'), output, { fixtureRoot });
  assert.equal(await readFile(output, 'utf8'), canonicalJson(receipt));
  assert.equal(receipt.counts.secondary_source_rows, 3);
  assert.equal(receipt.breakdowns.location_role.secondary, 2);
  assert.equal(receipt.counts.candidate_locations, 6);
  assert.doesNotMatch(await readFile(output, 'utf8'), /9000000001|Synthetic Clinic|Testville/i);
});

test('missing required NPPES headers fail closed', async () => {
  await assert.rejects(
    profileNppesFile(path.join(fixtureRoot, 'nucc-synthetic.csv'), {
      freezeDate: '2000-01-31', manifestSha256: 'a'.repeat(64), taxonomyFingerprint: 'b'.repeat(64),
      transformVersion: `git:${'1'.repeat(40)}`,
    }),
    /missing required column/,
  );
});
