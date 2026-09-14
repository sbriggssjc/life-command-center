import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseArtifactStagingArgs, runArtifactStaging } from '../scripts/healthcare-discovery/artifact-staging-cli.mjs';

const fixtures = new URL('./fixtures/healthcare-discovery/', import.meta.url);
const sourceKeys = ['cms_pos_asc', 'cms_ascqr_facility', 'cms_ffs_enrollment', 'cms_asc_payment'];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'lcc-asc-cli-'));
  const artifacts = [];
  const verifierAttestations = [];
  for (const [index, sourceKey] of sourceKeys.entries()) {
    const bytes = Buffer.from(`header_${index},value\nsynthetic_${index},${index}\n`);
    const localPath = `${sourceKey}.csv`;
    await writeFile(join(root, localPath), bytes);
    const computed = { byte_size: bytes.byteLength, sha256: sha256(bytes), header_sha256: sha256(Buffer.from(`header_${index},value`)) };
    artifacts.push({ source_key: sourceKey, local_path: localPath, artifact_url: `https://data.cms.gov/synthetic/${sourceKey}.csv`, release_date: '2026-08-01' });
    verifierAttestations.push({ source_key: sourceKey, verifier_id: `reviewer-${index}`, ...computed });
  }
  const synthetic = JSON.parse(await readFile(new URL('asc-run-authorization-synthetic.json', fixtures), 'utf8'));
  const request = {
    artifacts,
    verifier_attestations: verifierAttestations,
    authorization_envelope: {
      created_at: synthetic.created_at,
      storage: synthetic.storage,
      reviewer_evidence_dictionary: synthetic.reviewer_evidence_dictionary,
      second_review: synthetic.second_review,
      retention: synthetic.retention,
      privacy_receipt: synthetic.privacy_receipt,
      lane_stop_conditions: synthetic.lane_stop_conditions,
    },
  };
  const requestPath = join(root, 'request.json');
  await writeFile(requestPath, JSON.stringify(request));
  return {
    root,
    requestPath,
    templatePath: fileURLToPath(new URL('asc-release-packet-template.json', fixtures)),
    privatePacketOutput: join(root, 'draft-packet.json'),
    receiptOutput: join(root, 'aggregate-receipt.json'),
  };
}

test('CLI argument parser requires the complete exact invocation', () => {
  assert.throws(() => parseArtifactStagingArgs(['--template', 'a']), /All five/);
  assert.throws(() => parseArtifactStagingArgs(['--other', 'a']), /Arguments must/);
  assert.equal(parseArtifactStagingArgs(['--help']).help, true);
});

test('run harness atomically writes a private draft and aggregate-only receipt', async () => {
  const input = await setup();
  const result = await runArtifactStaging({
    template: input.templatePath,
    request: input.requestPath,
    approved_root: input.root,
    private_packet_output: input.privatePacketOutput,
    receipt_output: input.receiptOutput,
  });
  const packet = JSON.parse(await readFile(input.privatePacketOutput, 'utf8'));
  const receiptText = await readFile(input.receiptOutput, 'utf8');
  assert.equal(result.packet.status, 'draft_unapproved');
  assert.equal(packet.approvals.length, 0);
  assert.equal(packet.source_manifest_release_id, result.receipt.release_fingerprint);
  assert.equal(result.receipt.controls.execution_authorized, false);
  assert.doesNotMatch(receiptText, /local_path|approved_root|verifier_id|cms_pos_asc\.csv/);
  await assert.rejects(runArtifactStaging({ template: input.templatePath, request: input.requestPath, approved_root: input.root, private_packet_output: input.privatePacketOutput, receipt_output: join(input.root, 'second-receipt.json') }), /Refusing to overwrite/);
});

test('run harness refuses a private packet output outside the approved root', async () => {
  const input = await setup();
  await assert.rejects(runArtifactStaging({
    template: input.templatePath,
    request: input.requestPath,
    approved_root: input.root,
    private_packet_output: join(tmpdir(), 'outside-private-packet.json'),
    receipt_output: input.receiptOutput,
  }), /inside the approved private root/);
});

test('run harness requires absolute private coordinates and keeps the request inside the root', async () => {
  const input = await setup();
  const values = {
    template: input.templatePath,
    request: input.requestPath,
    approved_root: 'relative-private-root',
    private_packet_output: input.privatePacketOutput,
    receipt_output: input.receiptOutput,
  };
  await assert.rejects(runArtifactStaging(values), /must be absolute/);

  const outsideRequest = join(tmpdir(), `outside-request-${process.pid}.json`);
  await writeFile(outsideRequest, await readFile(input.requestPath));
  await assert.rejects(runArtifactStaging({ ...values, approved_root: input.root, request: outsideRequest }), /Private request must be a file inside/);
});
