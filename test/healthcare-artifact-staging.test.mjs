import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { serializeArtifactStagingReceipt, stageAscArtifacts } from '../scripts/healthcare-discovery/artifact-staging.mjs';

const fixtures = new URL('./fixtures/healthcare-discovery/', import.meta.url);
const sourceKeys = ['cms_pos_asc', 'cms_ascqr_facility', 'cms_ffs_enrollment', 'cms_asc_payment'];

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function setup() {
  const template = JSON.parse(await readFile(new URL('asc-release-packet-template.json', fixtures), 'utf8'));
  const root = await mkdtemp(join(tmpdir(), 'lcc-asc-stage-'));
  const artifacts = [];
  const verifierAttestations = [];
  for (const [index, sourceKey] of sourceKeys.entries()) {
    const bytes = Buffer.from(`header_${index},value\nsynthetic_${index},${index}\n`);
    const localPath = `${sourceKey}.csv`;
    await writeFile(join(root, localPath), bytes);
    const computed = { byte_size: bytes.byteLength, sha256: digest(bytes), header_sha256: digest(Buffer.from(`header_${index},value`)) };
    artifacts.push({ source_key: sourceKey, local_path: localPath, artifact_url: `https://data.cms.gov/synthetic/${sourceKey}.csv`, release_date: '2026-08-01' });
    verifierAttestations.push({ source_key: sourceKey, verifier_id: `reviewer-${index}`, ...computed });
  }
  return { template, root, artifacts, verifierAttestations };
}

test('stages the exact ASC bundle and emits a deterministic aggregate-only receipt', async () => {
  const input = await setup();
  const first = await stageAscArtifacts({ template: input.template, approvedRoot: input.root, artifacts: input.artifacts, verifierAttestations: input.verifierAttestations });
  const second = await stageAscArtifacts({ template: input.template, approvedRoot: input.root, artifacts: input.artifacts, verifierAttestations: input.verifierAttestations });
  assert.deepEqual(first, second);
  assert.equal(first.receipt.artifact_count, 4);
  assert.equal(first.receipt.controls.execution_authorized, false);
  assert.equal(first.receipt.privacy.source_paths_emitted, false);
  assert.doesNotMatch(serializeArtifactStagingReceipt(first.receipt), /lcc-asc-stage|cms_pos_asc\.csv/);
});

test('fails closed on a missing source or path escape', async () => {
  const input = await setup();
  await assert.rejects(stageAscArtifacts({ ...input, approvedRoot: input.root, artifacts: input.artifacts.slice(1), verifierAttestations: input.verifierAttestations }), /exactly four/);
  input.artifacts[0].local_path = '../outside.csv';
  await assert.rejects(stageAscArtifacts({ template: input.template, approvedRoot: input.root, artifacts: input.artifacts, verifierAttestations: input.verifierAttestations }), /escapes/);
});

test('fails closed on duplicate source records and symlink artifacts', async () => {
  const duplicate = await setup();
  duplicate.artifacts.push({ ...duplicate.artifacts[0] });
  await assert.rejects(stageAscArtifacts({ template: duplicate.template, approvedRoot: duplicate.root, artifacts: duplicate.artifacts, verifierAttestations: duplicate.verifierAttestations }), /exactly four/);

  const linked = await setup();
  await symlink(join(linked.root, linked.artifacts[0].local_path), join(linked.root, 'linked.csv'));
  linked.artifacts[0].local_path = 'linked.csv';
  await assert.rejects(stageAscArtifacts({ template: linked.template, approvedRoot: linked.root, artifacts: linked.artifacts, verifierAttestations: linked.verifierAttestations }), /non-symlink/);
});

test('fails closed when the independent digest disagrees', async () => {
  const input = await setup();
  input.verifierAttestations[0].sha256 = 'a'.repeat(64);
  await assert.rejects(stageAscArtifacts({ template: input.template, approvedRoot: input.root, artifacts: input.artifacts, verifierAttestations: input.verifierAttestations }), /verification mismatch/);
});

test('rejects non-CMS artifact origins and IDTF staging', async () => {
  const input = await setup();
  input.artifacts[0].artifact_url = 'https://example.com/file.csv';
  await assert.rejects(stageAscArtifacts({ template: input.template, approvedRoot: input.root, artifacts: input.artifacts, verifierAttestations: input.verifierAttestations }), /official CMS/);

  const idtf = JSON.parse(await readFile(new URL('idtf-release-packet-template.json', fixtures), 'utf8'));
  await assert.rejects(stageAscArtifacts({ template: idtf, approvedRoot: input.root, artifacts: input.artifacts, verifierAttestations: input.verifierAttestations }), /ASC-only/);
});
