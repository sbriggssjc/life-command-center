import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyPhaseAAcceptance } from '../scripts/healthcare-discovery/acceptance.mjs';
import { profileNppesFile } from '../scripts/healthcare-discovery/nppes.mjs';

const fixtureRoot = path.resolve('test/fixtures/healthcare-discovery');
const options = {
  freezeDate: '2000-01-31', manifestSha256: 'a'.repeat(64), taxonomyFingerprint: 'b'.repeat(64),
  transformVersion: `git:${'1'.repeat(40)}`,
  secondaryPath: path.join(fixtureRoot, 'nppes-secondary-synthetic.csv'),
};

test('A4 produces a passing deterministic aggregate-only acceptance receipt', async () => {
  const first = await profileNppesFile(path.join(fixtureRoot, 'nppes-v2-synthetic.csv'), options);
  const second = await profileNppesFile(path.join(fixtureRoot, 'nppes-v2-synthetic.csv'), options);
  const expected = JSON.parse(await readFile(path.join(fixtureRoot, 'phase-a-acceptance.expected.json'), 'utf8'));
  assert.deepEqual(verifyPhaseAAcceptance(first, second), expected);
});

test('A4 streams generated secondary volume within the resource envelope', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'healthcare-volume-'));
  const generated = path.join(temp, 'secondary.csv');
  const header = await readFile(path.join(fixtureRoot, 'nppes-secondary-synthetic.csv'), 'utf8').then((value) => value.split('\n')[0]);
  const rows = Array.from({ length: 20_000 }, (_, index) => `9000000001,${200 + index} Generated Road,,Testville,OK,74102,US`);
  await writeFile(generated, `${header}\n${rows.join('\n')}\n`);
  const before = process.memoryUsage().heapUsed;
  const receipt = await profileNppesFile(path.join(fixtureRoot, 'nppes-v2-synthetic.csv'), { ...options, secondaryPath: generated });
  const heapDelta = Math.max(0, process.memoryUsage().heapUsed - before);
  assert.equal(receipt.counts.secondary_source_rows, 20_000);
  assert.ok(heapDelta < 128 * 1024 * 1024, `heap delta ${heapDelta} exceeded 128 MiB`);
});

test('A4 fails closed when the candidate-state ceiling is exceeded', async () => {
  await assert.rejects(profileNppesFile(path.join(fixtureRoot, 'nppes-v2-synthetic.csv'), {
    ...options, maxCandidateFingerprints: 1,
  }), /safety ceiling exceeded/);
});

test('A4 privacy scan rejects record-level identifiers', () => {
  const unsafe = { counts: { secondary_source_rows: 1, candidate_locations: 1 }, leaked: 'NPI 9000000001 at Synthetic Clinic' };
  assert.equal(verifyPhaseAAcceptance(unsafe, unsafe).status, 'fail');
});
