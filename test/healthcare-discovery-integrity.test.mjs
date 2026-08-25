import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateManifestFile } from '../scripts/healthcare-discovery/manifest.mjs';
import { validateNuccTaxonomyFile } from '../scripts/healthcare-discovery/nucc-taxonomy.mjs';

const fixtureRoot = new URL('./fixtures/healthcare-discovery/', import.meta.url);
const fixtureRootPath = fileURLToPath(fixtureRoot);
const manifestUrl = new URL('manifest.valid.json', fixtureRoot);

test('A1 validates the frozen synthetic source bundle', async () => {
  const receipt = await validateManifestFile(manifestUrl, { fixtureRoot: fixtureRootPath });
  assert.equal(receipt.status, 'pass');
  assert.deepEqual(receipt.source_fingerprints.map((source) => source.name), ['nppes_v2_monthly', 'nppes_secondary_locations', 'nucc_taxonomy']);
  assert.doesNotMatch(JSON.stringify(receipt), /NPI|street|object_path/i);
});

test('A1 canonicalizes CRLF only inside an explicit synthetic fixture root', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'healthcare-crlf-fixture-'));
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  await writeFile(path.join(tempRoot, 'manifest.json'), JSON.stringify(manifest));
  for (const source of manifest.sources) {
    const original = await readFile(new URL(source.object_path, fixtureRoot), 'utf8');
    await writeFile(path.join(tempRoot, source.object_path), original.replace(/\n/g, '\r\n'));
  }
  const receipt = await validateManifestFile(path.join(tempRoot, 'manifest.json'), { fixtureRoot: tempRoot });
  assert.equal(receipt.status, 'pass');
});

test('A1 rejects a source path outside the approved root', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'healthcare-manifest-'));
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestUrl, 'utf8'));
  manifest.sources[0].object_path = '../../outside.csv';
  const candidate = path.join(tempRoot, 'manifest.json');
  await writeFile(candidate, JSON.stringify(manifest));
  await assert.rejects(validateManifestFile(candidate), /outside the approved/);
});

test('A2 resolves exactly the three approved facility concepts', async () => {
  const assertions = await validateNuccTaxonomyFile(new URL('nucc-synthetic.csv', fixtureRoot));
  assert.equal(assertions.length, 3);
  assert.deepEqual(assertions.map((row) => row.status), ['pass', 'pass', 'pass']);
});

test('A2 fails closed on material concept drift', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'healthcare-taxonomy-'));
  const candidate = path.join(tempRoot, 'nucc.csv');
  await writeFile(candidate, 'Code,Grouping,Classification,Specialization,Definition\n261QX0200X,Wrong,Clinic/Center,Oncology,Synthetic\n');
  await assert.rejects(validateNuccTaxonomyFile(candidate), /drift|Missing approved/);
});
