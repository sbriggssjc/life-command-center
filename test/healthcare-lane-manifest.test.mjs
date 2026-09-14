import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertLaneManifestContract, validateLaneManifestFile } from '../scripts/healthcare-discovery/lane-manifest.mjs';

const fixtureRoot = path.resolve('test/fixtures/healthcare-discovery');
const load = async (name) => JSON.parse(await readFile(path.join(fixtureRoot, name), 'utf8'));

test('ASC synthetic manifest validates with the exact reviewed source bundle', async () => {
  const receipt = await validateLaneManifestFile(path.join(fixtureRoot, 'asc-manifest.valid.json'), { fixtureRoot });
  assert.equal(receipt.status, 'pass');
  assert.equal(receipt.lane, 'asc');
  assert.deepEqual(receipt.source_fingerprints.map(({ source_key }) => source_key), ['cms_pos_asc', 'cms_ascqr_facility', 'cms_ffs_enrollment', 'cms_asc_payment']);
  assert.doesNotMatch(JSON.stringify(receipt), /facility_name|organization_name|practice_address|npi/i);
});

test('fixed-site IDTF synthetic manifest validates with the exact reviewed source bundle', async () => {
  const receipt = await validateLaneManifestFile(path.join(fixtureRoot, 'idtf-manifest.valid.json'), { fixtureRoot });
  assert.equal(receipt.status, 'pass');
  assert.equal(receipt.lane, 'idtf_fixed_site');
  assert.equal(receipt.source_fingerprints.length, 4);
});

test('lane validation canonicalizes CRLF only inside an explicit synthetic fixture root', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'healthcare-lane-crlf-'));
  const manifest = await load('asc-manifest.valid.json');
  await writeFile(path.join(tempRoot, 'manifest.json'), JSON.stringify(manifest));
  for (const source of manifest.sources) {
    const original = await readFile(path.join(fixtureRoot, source.object_path), 'utf8');
    await writeFile(path.join(tempRoot, source.object_path), original.replace(/\n/g, '\r\n'));
  }
  const receipt = await validateLaneManifestFile(path.join(tempRoot, 'manifest.json'), { fixtureRoot: tempRoot });
  assert.equal(receipt.status, 'pass');
});

test('IDTF manifests fail closed without the fixed/mobile evidence rules', async () => {
  const manifest = await load('idtf-manifest.valid.json');
  delete manifest.site_form_rules;
  assert.throws(() => assertLaneManifestContract(manifest), /require site_form_rules/);
});

test('IDTF manifests cannot silently drop a reviewed excluded site form', async () => {
  const manifest = await load('idtf-manifest.valid.json');
  manifest.site_form_rules.excluded_forms = manifest.site_form_rules.excluded_forms.filter((value) => value !== 'mobile_unit');
  assert.throws(() => assertLaneManifestContract(manifest), /excluded_forms/);
});

test('lane manifests reject unofficial origins and unsafe source paths', async () => {
  const manifest = await load('asc-manifest.valid.json');
  manifest.sources[0].artifact_url = 'https://example.com/asc.csv';
  assert.throws(() => assertLaneManifestContract(manifest), /approved official HTTPS origin/);
  manifest.sources[0].artifact_url = 'https://data.cms.gov/synthetic/asc-pos.csv';
  manifest.sources[0].object_path = '../private/asc.csv';
  assert.throws(() => assertLaneManifestContract(manifest), /safe relative path/);
});

test('lane manifests allow aggregate receipts only', async () => {
  const manifest = await load('asc-manifest.valid.json');
  manifest.expected_outputs[0].classification = 'row_level_export';
  assert.throws(() => assertLaneManifestContract(manifest), /aggregate receipts/);
});

test('lane release identity changes when a pinned source fingerprint changes', async () => {
  const manifest = await load('asc-manifest.valid.json');
  manifest.sources[0].release_date = '2000-01-02';
  assert.throws(() => assertLaneManifestContract(manifest), /release_id does not match/);
});

test('lane source checksums and required headers fail closed', async () => {
  const manifest = await load('asc-manifest.valid.json');
  manifest.sources[0].required_columns.push('not_a_real_column');
  assert.equal(assertLaneManifestContract(manifest), true);
  const temporary = path.join(fixtureRoot, 'asc-manifest.invalid-header.tmp.json');
  const { writeFile, unlink } = await import('node:fs/promises');
  await writeFile(temporary, JSON.stringify(manifest));
  await assert.rejects(validateLaneManifestFile(temporary, { fixtureRoot }), /missing required column/);
  await unlink(temporary);
});
