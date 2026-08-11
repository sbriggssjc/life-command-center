import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertRunAuthorizationPacket, buildRunAuthorizationReceipt, computeRunAuthorizationId, serializeRunAuthorizationReceipt } from '../scripts/healthcare-discovery/run-authorization.mjs';

const fixtureUrl = new URL('./fixtures/healthcare-discovery/asc-run-authorization-synthetic.json', import.meta.url);

async function packet() {
  const value = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  value.packet_id = computeRunAuthorizationId(value);
  return value;
}

test('synthetic private-run packet validates but does not authorize execution', async () => {
  const value = await packet();
  assert.equal(assertRunAuthorizationPacket(value), true);
  const receipt = buildRunAuthorizationReceipt(value);
  assert.equal(receipt.execution_authorized, false);
  assert.equal(receipt.controls.privacy_scan_passed, true);
});

test('packet identity changes when an artifact checksum changes', async () => {
  const value = await packet();
  value.artifacts[0].sha256 = `f${value.artifacts[0].sha256.slice(1)}`;
  assert.throws(() => assertRunAuthorizationPacket(value), /packet_id/);
});

test('public storage and incomplete second-review triggers fail closed', async () => {
  const publicPacket = await packet();
  publicPacket.storage.public_access = true;
  publicPacket.packet_id = computeRunAuthorizationId(publicPacket);
  assert.throws(() => assertRunAuthorizationPacket(publicPacket), /Storage must be private/);

  const weakReview = await packet();
  weakReview.second_review.triggers.pop();
  weakReview.packet_id = computeRunAuthorizationId(weakReview);
  assert.throws(() => assertRunAuthorizationPacket(weakReview), /second-review triggers/);
});

test('authorized status requires explicit boundary validation and two approvals', async () => {
  const value = await packet();
  value.status = 'authorized';
  value.packet_id = computeRunAuthorizationId(value);
  assert.throws(() => assertRunAuthorizationPacket(value), /explicit execution-boundary/);
  assert.throws(() => assertRunAuthorizationPacket(value, { allowAuthorized: true }), /authorized approval roles/);
  value.approvals = [
    { role: 'release_owner', approver_id: 'owner-001', approved_at: '2026-08-11T21:00:00Z' },
    { role: 'privacy_reviewer', approver_id: 'privacy-001', approved_at: '2026-08-11T21:05:00Z' },
  ];
  assert.equal(assertRunAuthorizationPacket(value, { allowAuthorized: true }), true);
  assert.equal(buildRunAuthorizationReceipt(value).execution_authorized, true);
});

test('aggregate authorization receipt is deterministic and identifier-free', async () => {
  const value = await packet();
  const first = serializeRunAuthorizationReceipt(buildRunAuthorizationReceipt(value));
  const second = serializeRunAuthorizationReceipt(buildRunAuthorizationReceipt(value));
  assert.equal(first, second);
  assert.doesNotMatch(first, /artifact_url|object_prefix|allowed_roles|cms_pos_asc/);
});
