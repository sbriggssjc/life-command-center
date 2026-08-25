import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { authorizeExecutionBoundary, computeArtifactReleaseFingerprint } from '../scripts/healthcare-discovery/execution-boundary.mjs';
import { computeRunAuthorizationId } from '../scripts/healthcare-discovery/run-authorization.mjs';
import { parseSampleExecutionArgs, runSampleExecution } from '../scripts/healthcare-discovery/sample-execution-cli.mjs';

const fixture = new URL('./fixtures/healthcare-discovery/asc-run-authorization-synthetic.json', import.meta.url);
const fingerprint = (value) => createHash('sha256').update(value).digest('hex');

async function setupSample() {
  const draft = JSON.parse(await readFile(fixture, 'utf8'));
  draft.source_manifest_release_id = computeArtifactReleaseFingerprint(draft.artifacts);
  draft.packet_id = computeRunAuthorizationId(draft);
  const stagingReceipt = { lane: 'asc', status: 'staged_verified_draft_only', artifact_count: 4, release_fingerprint: draft.source_manifest_release_id, controls: { execution_authorized: false } };
  const approvals = [{ role: 'release_owner', approver_id: 'release-owner', approved_at: '2026-08-12T10:00:00Z' }, { role: 'privacy_reviewer', approver_id: 'privacy-owner', approved_at: '2026-08-12T10:05:00Z' }];
  const authorized = authorizeExecutionBoundary({ packet: draft, stagingReceipt, approvals });
  const cells = [['freestanding', 15], ['mob_campus_unknown', 10], ['high_economics_evidence', 10], ['independent_operator', 5], ['multi_site_operator', 5], ['lcc_exact_match', 5]];
  const contract = { contract_version: 'healthcare_property_review:1.0', lane: 'asc', release_id: draft.source_manifest_release_id, sample_size: 50, seed: 'asc-property-review-2026-08-11', cells: cells.map(([name, quota]) => ({ name, quota, all: [{ field: 'cell', in: [name] }] })) };
  const candidates = cells.flatMap(([name, quota]) => Array.from({ length: quota + 2 }, (_, index) => ({ candidate_fingerprint: fingerprint(`${name}:${index}`), cell: name })));
  return { packet: authorized.packet, authorizationReceipt: authorized.receipt, contract, candidates };
}

async function setupFiles() {
  const root = await mkdtemp(join(tmpdir(), 'lcc-asc-sample-'));
  const input = await setupSample();
  const paths = {
    packet: join(root, 'authorized.json'), authorization: join(root, 'authorization-receipt.json'), contract: join(root, 'contract.json'), candidates: join(root, 'candidates.json'), frame: join(root, 'frame.json'), receipt: join(root, 'sample-receipt.json'),
  };
  await Promise.all([
    writeFile(paths.packet, JSON.stringify(input.packet)), writeFile(paths.authorization, JSON.stringify(input.authorizationReceipt)), writeFile(paths.contract, JSON.stringify(input.contract)), writeFile(paths.candidates, JSON.stringify(input.candidates)),
  ]);
  return { root, paths };
}

test('sample CLI requires all seven paths', () => {
  assert.throws(() => parseSampleExecutionArgs(['--approved-root', 'x']), /All seven/);
  assert.equal(parseSampleExecutionArgs(['--help']).help, true);
});

test('sample CLI writes the row-level frame privately and an aggregate receipt', async () => {
  const { root, paths } = await setupFiles();
  const result = await runSampleExecution({ approved_root: root, authorized_packet: paths.packet, authorization_receipt: paths.authorization, sampling_contract: paths.contract, candidates: paths.candidates, private_frame_output: paths.frame, receipt_output: paths.receipt });
  assert.equal(result.frame.sample_size, 50);
  assert.equal(JSON.parse(await readFile(paths.frame, 'utf8')).selected.length, 50);
  assert.doesNotMatch(await readFile(paths.receipt, 'utf8'), /candidate_fingerprint/);
  await assert.rejects(runSampleExecution({ approved_root: root, authorized_packet: paths.packet, authorization_receipt: paths.authorization, sampling_contract: paths.contract, candidates: paths.candidates, private_frame_output: paths.frame, receipt_output: join(root, 'other-receipt.json') }), /Refusing to overwrite/);
});

test('sample CLI rejects private inputs or frame outputs outside the approved root', async () => {
  const { root, paths } = await setupFiles();
  const outsideContract = join(tmpdir(), `outside-contract-${process.pid}.json`);
  await writeFile(outsideContract, await readFile(paths.contract));
  await assert.rejects(runSampleExecution({ approved_root: root, authorized_packet: paths.packet, authorization_receipt: paths.authorization, sampling_contract: paths.contract, candidates: paths.candidates, private_frame_output: join(tmpdir(), 'outside-frame.json'), receipt_output: paths.receipt }), /Private frame output/);
  await assert.rejects(runSampleExecution({ approved_root: root, authorized_packet: paths.packet, authorization_receipt: paths.authorization, sampling_contract: outsideContract, candidates: paths.candidates, private_frame_output: paths.frame, receipt_output: paths.receipt }), /Sampling contract/);
});
