import { createHash } from 'node:crypto';

import { assertRunAuthorizationPacket } from './run-authorization.mjs';
import { buildPropertySamplingFrame, REVIEW_CONTRACT_VERSION } from './property-review.mjs';

export const SAMPLE_EXECUTION_VERSION = 'healthcare_sample_execution:1.0';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function executeAuthorizedAscSample({ packet, authorizationReceipt, contract, candidates }) {
  assertRunAuthorizationPacket(packet, { allowAuthorized: true });
  if (packet.status !== 'authorized' || packet.lane !== 'asc' || packet.approvals.length !== 2) throw new Error('An authorized ASC packet with two approvals is required');
  if (!authorizationReceipt || authorizationReceipt.status !== 'authorized' || authorizationReceipt.execution_authorized !== true) throw new Error('An aggregate execution-authorization receipt is required');
  if (authorizationReceipt.packet_id !== packet.packet_id || authorizationReceipt.lane !== packet.lane || authorizationReceipt.staged_release_bound !== true) throw new Error('Authorization receipt is not bound to the authorized ASC packet');
  if (contract?.contract_version !== REVIEW_CONTRACT_VERSION || contract.lane !== 'asc' || contract.release_id !== packet.source_manifest_release_id) throw new Error('Sampling contract must bind to the authorized ASC release');
  const frame = buildPropertySamplingFrame(candidates, contract);
  const receipt = {
    receipt_version: SAMPLE_EXECUTION_VERSION,
    lane: 'asc',
    packet_id: packet.packet_id,
    release_id: frame.release_id,
    sample_size: frame.sample_size,
    seed_fingerprint: frame.seed_fingerprint,
    cell_counts: frame.cell_counts,
    selection_fingerprint: frame.selection_fingerprint,
    candidate_pool_fingerprint: sha256(canonicalJson(candidates.map(({ candidate_fingerprint }) => candidate_fingerprint).sort())),
    controls: { execution_authorized: true, private_frame_written: true, database_write_authorized: false, production_write_authorized: false },
    privacy: { classification: 'aggregate_only', record_level_identifiers_emitted: false },
  };
  return { frame, receipt };
}

export function serializeSampleExecutionReceipt(receipt) {
  return `${canonicalJson(receipt)}\n`;
}
