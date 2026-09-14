import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertReleasePacketTemplate, buildReleasePreflightReceipt, computeReleasePacketTemplateId, materializeDraftAuthorizationPacket } from '../scripts/healthcare-discovery/release-packet-preflight.mjs';
import { computeRunAuthorizationId } from '../scripts/healthcare-discovery/run-authorization.mjs';

const fixtures = new URL('./fixtures/healthcare-discovery/', import.meta.url);

async function load(name) {
  return JSON.parse(await readFile(new URL(name, fixtures), 'utf8'));
}

for (const name of ['asc-release-packet-template.json', 'idtf-release-packet-template.json']) {
  test(`${name} is a valid non-executable template`, async () => {
    const value = await load(name);
    assert.equal(assertReleasePacketTemplate(value), true);
    const receipt = buildReleasePreflightReceipt(value);
    assert.equal(receipt.source_candidate_count, 4);
    assert.equal(receipt.execution_authorized, false);
    assert.deepEqual(receipt.blockers, ['exact_artifact_identity_missing', 'independent_hash_verification_missing', 'private_storage_coordinates_missing', 'execution_approvals_missing']);
  });
}

test('template rejects embedded release data and weakened execution controls', async () => {
  const withRelease = await load('asc-release-packet-template.json');
  withRelease.source_candidates[0].sha256 = 'a'.repeat(64);
  withRelease.template_id = computeReleasePacketTemplateId(withRelease);
  assert.throws(() => assertReleasePacketTemplate(withRelease), /must remain null/);

  const weakened = await load('asc-release-packet-template.json');
  weakened.controls.download_authorized = true;
  weakened.template_id = computeReleasePacketTemplateId(weakened);
  assert.throws(() => assertReleasePacketTemplate(weakened), /must prohibit/);
});

test('materialization requires every exact source and always creates an unapproved draft', async () => {
  const template = await load('asc-release-packet-template.json');
  const synthetic = await load('asc-run-authorization-synthetic.json');
  synthetic.packet_id = computeRunAuthorizationId(synthetic);
  const draft = materializeDraftAuthorizationPacket(template, synthetic);
  assert.equal(draft.status, 'draft_unapproved');
  assert.deepEqual(draft.approvals, []);

  synthetic.artifacts.pop();
  assert.throws(() => materializeDraftAuthorizationPacket(template, synthetic), /Missing exact release metadata/);
});
