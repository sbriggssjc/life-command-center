import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { authorizeExecutionBoundary, computeArtifactReleaseFingerprint, serializeExecutionBoundaryReceipt } from '../scripts/healthcare-discovery/execution-boundary.mjs';
import { computeRunAuthorizationId } from '../scripts/healthcare-discovery/run-authorization.mjs';

const fixture = new URL('./fixtures/healthcare-discovery/asc-run-authorization-synthetic.json', import.meta.url);

async function setup() {
  const packet = JSON.parse(await readFile(fixture, 'utf8'));
  packet.source_manifest_release_id = computeArtifactReleaseFingerprint(packet.artifacts);
  packet.packet_id = computeRunAuthorizationId(packet);
  const stagingReceipt = {
    lane: 'asc',
    status: 'staged_verified_draft_only',
    artifact_count: 4,
    release_fingerprint: packet.source_manifest_release_id,
    controls: { execution_authorized: false },
  };
  const approvals = [
    { role: 'release_owner', approver_id: 'release-reviewer', approved_at: '2026-08-12T10:00:00Z' },
    { role: 'privacy_reviewer', approver_id: 'privacy-reviewer', approved_at: '2026-08-12T10:05:00Z' },
  ];
  return { packet, stagingReceipt, approvals };
}

test('authorizes only a staged, release-bound packet with distinct approvals', async () => {
  const input = await setup();
  const result = authorizeExecutionBoundary(input);
  assert.equal(result.packet.status, 'authorized');
  assert.equal(result.receipt.execution_authorized, true);
  assert.equal(result.receipt.staged_release_bound, true);
  assert.equal(result.receipt.distinct_approver_identities, true);
  assert.doesNotMatch(serializeExecutionBoundaryReceipt(result.receipt), /release-reviewer|privacy-reviewer|artifact_url|header_sha256/);
});

test('fails closed when staged release identity does not bind to the packet', async () => {
  const input = await setup();
  input.stagingReceipt.release_fingerprint = 'a'.repeat(64);
  assert.throws(() => authorizeExecutionBoundary(input), /release binding/);
});

test('fails closed on reused identity, repeated role, or premature approval', async () => {
  const reused = await setup();
  reused.approvals[1].approver_id = reused.approvals[0].approver_id;
  assert.throws(() => authorizeExecutionBoundary(reused), /distinct roles and approver identities/);

  const repeated = await setup();
  repeated.approvals[1].role = repeated.approvals[0].role;
  assert.throws(() => authorizeExecutionBoundary(repeated), /distinct roles and approver identities/);

  const premature = await setup();
  premature.approvals[0].approved_at = '2026-08-10T10:00:00Z';
  assert.throws(() => authorizeExecutionBoundary(premature), /cannot precede/);
});

test('packet identity binds header digests and privacy receipt', async () => {
  const first = await setup();
  const firstId = first.packet.packet_id;
  first.packet.artifacts[0].header_sha256 = 'b'.repeat(64);
  assert.notEqual(computeRunAuthorizationId(first.packet), firstId);

  const second = await setup();
  const secondId = second.packet.packet_id;
  second.packet.privacy_receipt.receipt_sha256 = 'c'.repeat(64);
  assert.notEqual(computeRunAuthorizationId(second.packet), secondId);
});
