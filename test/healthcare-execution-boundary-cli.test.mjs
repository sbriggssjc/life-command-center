import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { computeArtifactReleaseFingerprint } from '../scripts/healthcare-discovery/execution-boundary.mjs';
import { parseExecutionBoundaryArgs, runExecutionBoundary } from '../scripts/healthcare-discovery/execution-boundary-cli.mjs';
import { computeRunAuthorizationId } from '../scripts/healthcare-discovery/run-authorization.mjs';

const fixture = new URL('./fixtures/healthcare-discovery/asc-run-authorization-synthetic.json', import.meta.url);

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'lcc-execution-boundary-'));
  const packet = JSON.parse(await readFile(fixture, 'utf8'));
  packet.source_manifest_release_id = computeArtifactReleaseFingerprint(packet.artifacts);
  packet.packet_id = computeRunAuthorizationId(packet);
  const receipt = { lane: 'asc', status: 'staged_verified_draft_only', artifact_count: 4, release_fingerprint: packet.source_manifest_release_id, controls: { execution_authorized: false } };
  const approvals = [
    { role: 'release_owner', approver_id: 'release-reviewer', approved_at: '2026-08-12T10:00:00Z' },
    { role: 'privacy_reviewer', approver_id: 'privacy-reviewer', approved_at: '2026-08-12T10:05:00Z' },
  ];
  const paths = { draft: join(root, 'draft.json'), receipt: join(root, 'staging-receipt.json'), approvals: join(root, 'approvals.json'), authorized: join(root, 'authorized.json'), aggregate: join(root, 'authorization-receipt.json') };
  await Promise.all([writeFile(paths.draft, JSON.stringify(packet)), writeFile(paths.receipt, JSON.stringify(receipt)), writeFile(paths.approvals, JSON.stringify(approvals))]);
  return { root, paths };
}

test('CLI parser requires the exact six-path invocation', () => {
  assert.throws(() => parseExecutionBoundaryArgs(['--approved-root', 'x']), /All six/);
  assert.equal(parseExecutionBoundaryArgs(['--help']).help, true);
});

test('CLI writes the authorized packet privately and a privacy-safe receipt', async () => {
  const { root, paths } = await setup();
  const result = await runExecutionBoundary({ approved_root: root, draft_packet: paths.draft, staging_receipt: paths.receipt, approvals: paths.approvals, authorized_packet_output: paths.authorized, receipt_output: paths.aggregate });
  assert.equal(result.packet.status, 'authorized');
  assert.equal(JSON.parse(await readFile(paths.authorized, 'utf8')).approvals.length, 2);
  assert.doesNotMatch(await readFile(paths.aggregate, 'utf8'), /release-reviewer|privacy-reviewer/);
  await assert.rejects(runExecutionBoundary({ approved_root: root, draft_packet: paths.draft, staging_receipt: paths.receipt, approvals: paths.approvals, authorized_packet_output: paths.authorized, receipt_output: join(root, 'new-receipt.json') }), /Refusing to overwrite/);
});

test('CLI keeps private approval inputs and authorized output inside the root', async () => {
  const { root, paths } = await setup();
  const outsideApprovals = join(tmpdir(), `outside-approvals-${process.pid}.json`);
  await writeFile(outsideApprovals, await readFile(paths.approvals));
  await assert.rejects(runExecutionBoundary({ approved_root: root, draft_packet: paths.draft, staging_receipt: paths.receipt, approvals: outsideApprovals, authorized_packet_output: paths.authorized, receipt_output: paths.aggregate }), /Approvals file/);
  await assert.rejects(runExecutionBoundary({ approved_root: root, draft_packet: paths.draft, staging_receipt: paths.receipt, approvals: paths.approvals, authorized_packet_output: join(tmpdir(), 'outside-authorized.json'), receipt_output: paths.aggregate }), /Authorized packet output/);
});
