import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseArgs, run } from '../scripts/healthcare-discovery/cli.mjs';
import { APPROVED_SEED_CODES, assertManifestContract } from '../scripts/healthcare-discovery/manifest.mjs';

const fixtureUrl = new URL('./fixtures/healthcare-discovery/manifest.valid.json', import.meta.url);

test('all six commands expose network-free help', async () => {
  for (const command of ['manifest', 'validate', 'profile', 'load', 'sample', 'verify']) {
    const output = [];
    assert.equal(await run([command, '--help'], { log: (x) => output.push(x), error: (x) => output.push(x) }), 0);
    assert.match(output.join('\n'), new RegExp(`healthcare:nppes:${command}`));
  }
});

test('argument parser rejects unknown, duplicate and missing values', () => {
  assert.throws(() => parseArgs('validate', ['--other', 'x']), /Unknown argument/);
  assert.throws(() => parseArgs('validate', ['--manifest', 'a', '--manifest', 'b']), /Duplicate argument/);
  assert.throws(() => parseArgs('profile', ['--manifest', 'a']), /--output/);
});

test('load is fail-closed to dry-run mode', () => {
  assert.throws(() => parseArgs('load', ['--manifest', 'a', '--mode', 'production']), /only --mode dry-run/);
  assert.deepEqual(parseArgs('load', ['--manifest', 'a', '--mode', 'dry-run']).values, {
    manifest: 'a',
    mode: 'dry-run',
  });
});

test('synthetic manifest freezes the approved seed-code contract', async () => {
  const manifest = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  assert.equal(assertManifestContract(manifest), true);
  assert.deepEqual(manifest.sources[1].approved_seed_codes, APPROVED_SEED_CODES);
});

test('manifest contract rejects unknown top-level keys', async () => {
  const manifest = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  manifest.unreviewed = true;
  assert.throws(() => assertManifestContract(manifest), /Unknown manifest key/);
});
