import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { authorizeExecutionBoundary, computeArtifactReleaseFingerprint } from '../scripts/healthcare-discovery/execution-boundary.mjs';
import { computeRunAuthorizationId } from '../scripts/healthcare-discovery/run-authorization.mjs';
import { executeAuthorizedAscSample, serializeSampleExecutionReceipt } from '../scripts/healthcare-discovery/sample-execution.mjs';

const fixture = new URL('./fixtures/healthcare-discovery/asc-run-authorization-synthetic.json', import.meta.url);
const fingerprint = (value) => createHash('sha256').update(value).digest('hex');

export async function setupSample() {
  const draft = JSON.parse(await readFile(fixture, 'utf8'));
  draft.source_manifest_release_id = computeArtifactReleaseFingerprint(draft.artifacts);
  draft.packet_id = computeRunAuthorizationId(draft);
  const stagingReceipt = { lane: 'asc', status: 'staged_verified_draft_only', artifact_count: 4, release_fingerprint: draft.source_manifest_release_id, controls: { execution_authorized: false } };
  const approvals = [
    { role: 'release_owner', approver_id: 'release-owner', approved_at: '2026-08-12T10:00:00Z' },
    { role: 'privacy_reviewer', approver_id: 'privacy-owner', approved_at: '2026-08-12T10:05:00Z' },
  ];
  const authorized = authorizeExecutionBoundary({ packet: draft, stagingReceipt, approvals });
  const contract = {
    contract_version: 'healthcare_property_review:1.0', lane: 'asc', release_id: draft.source_manifest_release_id,
    sample_size: 50, seed: 'asc-property-review-2026-08-11', cells: [
      { name: 'freestanding', quota: 15, all: [{ field: 'cell', in: ['freestanding'] }] },
      { name: 'mob_campus_unknown', quota: 10, all: [{ field: 'cell', in: ['mob_campus_unknown'] }] },
      { name: 'high_economics_evidence', quota: 10, all: [{ field: 'cell', in: ['high_economics_evidence'] }] },
      { name: 'independent_operator', quota: 5, all: [{ field: 'cell', in: ['independent_operator'] }] },
      { name: 'multi_site_operator', quota: 5, all: [{ field: 'cell', in: ['multi_site_operator'] }] },
      { name: 'lcc_exact_match', quota: 5, all: [{ field: 'cell', in: ['lcc_exact_match'] }] },
    ],
  };
  const candidates = contract.cells.flatMap((cell) => Array.from({ length: cell.quota + 2 }, (_, index) => ({ candidate_fingerprint: fingerprint(`${cell.name}:${index}`), cell: cell.name })));
  return { packet: authorized.packet, authorizationReceipt: authorized.receipt, contract, candidates };
}

test('authorized ASC sample freezes 50 rows and emits an aggregate-only receipt', async () => {
  const input = await setupSample();
  const first = executeAuthorizedAscSample(input);
  const second = executeAuthorizedAscSample({ ...input, candidates: [...input.candidates].reverse() });
  assert.equal(first.frame.sample_size, 50);
  assert.deepEqual(first, second);
  assert.equal(first.receipt.controls.production_write_authorized, false);
  assert.doesNotMatch(serializeSampleExecutionReceipt(first.receipt), new RegExp(first.frame.selected[0].candidate_fingerprint));
});

test('sample execution rejects unbound, unauthorized, and IDTF inputs', async () => {
  const input = await setupSample();
  assert.throws(() => executeAuthorizedAscSample({ ...input, authorizationReceipt: { ...input.authorizationReceipt, packet_id: fingerprint('other') } }), /not bound/);
  assert.throws(() => executeAuthorizedAscSample({ ...input, packet: { ...input.packet, status: 'draft_unapproved', approvals: [] } }), /packet_id|authorized ASC/);
  assert.throws(() => executeAuthorizedAscSample({ ...input, contract: { ...input.contract, lane: 'idtf_fixed_site' } }), /authorized ASC release/);
});

test('sample execution binds the frozen contract to the authorized release', async () => {
  const input = await setupSample();
  assert.throws(() => executeAuthorizedAscSample({ ...input, contract: { ...input.contract, release_id: fingerprint('other-release') } }), /bind to the authorized ASC release/);
});
