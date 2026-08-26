import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { authorizeExecutionBoundary, computeArtifactReleaseFingerprint } from '../scripts/healthcare-discovery/execution-boundary.mjs';
import { buildOfficialAscCandidatePack, serializeOfficialAscCandidatePackReceipt } from '../scripts/healthcare-discovery/official-asc-candidate-pack.mjs';
import { buildPropertySamplingFrame } from '../scripts/healthcare-discovery/property-review.mjs';
import { computeRunAuthorizationId } from '../scripts/healthcare-discovery/run-authorization.mjs';

const authorizationFixture = new URL('./fixtures/healthcare-discovery/asc-run-authorization-synthetic.json', import.meta.url);

async function setupAuthorization(paths) {
  const packet = JSON.parse(await readFile(authorizationFixture, 'utf8'));
  const sourcePaths = { cms_pos_asc: paths.posPath, cms_ascqr_facility: paths.qualityPath, cms_ffs_enrollment: paths.enrollmentPath, cms_asc_payment: paths.paymentPath };
  for (const artifact of packet.artifacts) {
    const bytes = await readFile(sourcePaths[artifact.source_key]);
    artifact.byte_size = bytes.length;
    artifact.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  packet.source_manifest_release_id = computeArtifactReleaseFingerprint(packet.artifacts);
  packet.packet_id = computeRunAuthorizationId(packet);
  return authorizeExecutionBoundary({
    packet,
    stagingReceipt: { lane: 'asc', status: 'staged_verified_draft_only', artifact_count: 4, release_fingerprint: packet.source_manifest_release_id, controls: { execution_authorized: false } },
    approvals: [
      { role: 'release_owner', approver_id: 'release-owner', approved_at: '2026-08-12T10:00:00Z' },
      { role: 'privacy_reviewer', approver_id: 'privacy-owner', approved_at: '2026-08-12T10:05:00Z' },
    ],
  });
}

async function fixtures() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'official-asc-pack-'));
  const quality = ['Facility Name,Facility ID,NPI,City/Town,State,ZIP Code,Year'];
  const pos = ['prvdr_num,fac_name,prvdr_type_id,st_adr,city_name,zip_cd,state_cd,fed_crtfctn_stus_name'];
  const enrollment = ['NPI,PROVIDER_TYPE_DESC,ORG_NAME'];
  const states = ['NY', 'IL', 'TX', 'CA'];
  for (let index = 0; index < 64; index += 1) {
    const ccn = String(100000 + index); const npi = String(9000000000 + index); const state = states[index % states.length];
    quality.push(`Facility ${index},${ccn},${npi},City ${index},${state},00000,2025`);
    quality.push(`Facility ${index},${ccn},${npi},City ${index},${state},00000,2024`);
    pos.push(`${ccn},Facility ${index},11,${index} Main St,City ${index},00000,${state},${index === 63 ? 'TERMINATED' : 'CERTIFIED'}`);
    if (index < 56) enrollment.push(`${npi},PART B SUPPLIER - AMBULATORY SURGICAL CENTER,${index < 16 ? 'SHARED ASC ORG' : `ORG ${index}`}`);
    enrollment.push(`${npi},PART B SUPPLIER - CLINIC/GROUP PRACTICE,IGNORED ORG`);
  }
  const paths = { qualityPath: path.join(root, 'quality.csv'), posPath: path.join(root, 'pos.csv'), enrollmentPath: path.join(root, 'enrollment.csv'), paymentPath: path.join(root, 'payment.zip') };
  await Promise.all([writeFile(paths.qualityPath, `${quality.join('\n')}\n`), writeFile(paths.posPath, `${pos.join('\n')}\n`), writeFile(paths.enrollmentPath, `${enrollment.join('\n')}\n`), writeFile(paths.paymentPath, 'synthetic payment artifact')]);
  return paths;
}

test('official pack creates a deterministic certified universe and executable 50-row contract', async () => {
  const paths = await fixtures(); const authorization = await setupAuthorization(paths);
  const input = { packet: authorization.packet, authorizationReceipt: authorization.receipt, ...paths };
  const first = await buildOfficialAscCandidatePack(input); const second = await buildOfficialAscCandidatePack(input);
  assert.deepEqual(first, second);
  assert.equal(first.candidates.length, 63);
  assert.equal(first.contract.cells.reduce((sum, cell) => sum + cell.quota, 0), 50);
  assert.equal(buildPropertySamplingFrame(first.candidates, first.contract).sample_size, 50);
  assert.equal(first.receipt.controls.terminated_excluded, true);
  assert.equal(first.receipt.controls.production_write_authorized, false);
  assert.equal(first.crosswalk[0].manual_review.landlord_owner, null);
  assert.ok(first.candidates.some((row) => row.operator_footprint_proxy === 'multi_site_proxy'));
  assert.ok(first.candidates.some((row) => row.corroboration_tier === 'pos_quality_only'));
  assert.doesNotMatch(serializeOfficialAscCandidatePackReceipt(first.receipt), /Facility|Main St|900000/);
});

test('official pack fails closed on conflicting ASCQR identities', async () => {
  const paths = await fixtures();
  await writeFile(paths.qualityPath, 'Facility Name,Facility ID,NPI,City/Town,State,ZIP Code,Year\nA,100000,9000000000,A,NY,1,2025\nB,100000,9000000001,B,NY,1,2025\n');
  const tamperedAuthorization = await setupAuthorization(paths);
  await assert.rejects(buildOfficialAscCandidatePack({ packet: tamperedAuthorization.packet, authorizationReceipt: tamperedAuthorization.receipt, ...paths }), /conflicting NPIs/);
});

test('official pack rejects source drift after authorization', async () => {
  const paths = await fixtures(); const authorization = await setupAuthorization(paths);
  await writeFile(paths.paymentPath, 'changed payment artifact');
  await assert.rejects(buildOfficialAscCandidatePack({ packet: authorization.packet, authorizationReceipt: authorization.receipt, ...paths }), /no longer matches/);
});
