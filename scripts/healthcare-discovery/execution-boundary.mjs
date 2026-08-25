import { createHash } from 'node:crypto';

import { assertRunAuthorizationPacket, buildRunAuthorizationReceipt, computeRunAuthorizationId } from './run-authorization.mjs';

export const EXECUTION_BOUNDARY_VERSION = 'healthcare_execution_boundary:1.0';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function computeArtifactReleaseFingerprint(artifacts) {
  const identity = artifacts.map(({ source_key, release_date, byte_size, sha256: digest, header_sha256 }) => ({ source_key, release_date, byte_size, sha256: digest, header_sha256 })).sort((a, b) => a.source_key.localeCompare(b.source_key));
  return sha256(canonicalJson(identity));
}

export function authorizeExecutionBoundary({ packet, stagingReceipt, approvals }) {
  assertRunAuthorizationPacket(packet);
  if (packet.status !== 'draft_unapproved' || packet.approvals.length !== 0) throw new Error('Execution authorization requires an unapproved draft packet');
  if (!stagingReceipt || stagingReceipt.status !== 'staged_verified_draft_only' || stagingReceipt.controls?.execution_authorized !== false) throw new Error('A verified non-authorizing staging receipt is required');
  if (stagingReceipt.lane !== packet.lane || stagingReceipt.artifact_count !== packet.artifacts.length) throw new Error('Staging receipt does not match the authorization packet lane and artifact count');
  const releaseFingerprint = computeArtifactReleaseFingerprint(packet.artifacts);
  if (packet.source_manifest_release_id !== releaseFingerprint || stagingReceipt.release_fingerprint !== releaseFingerprint) throw new Error('Artifact release binding does not match the staged receipt and packet');
  if (!Array.isArray(approvals) || approvals.length !== 2) throw new Error('Exactly two execution approvals are required');
  if (new Set(approvals.map(({ role }) => role)).size !== 2 || new Set(approvals.map(({ approver_id }) => approver_id)).size !== 2) throw new Error('Execution approvals require distinct roles and approver identities');
  for (const approval of approvals) {
    if (Date.parse(approval.approved_at) < Date.parse(packet.created_at)) throw new Error('Approval timestamps cannot precede packet creation');
  }
  const authorized = { ...packet, status: 'authorized', approvals: approvals.map((approval) => ({ ...approval })) };
  authorized.packet_id = computeRunAuthorizationId(authorized);
  assertRunAuthorizationPacket(authorized, { allowAuthorized: true });
  const receipt = buildRunAuthorizationReceipt(authorized);
  return {
    packet: authorized,
    receipt: {
      ...receipt,
      execution_boundary_version: EXECUTION_BOUNDARY_VERSION,
      staged_release_bound: true,
      distinct_approver_identities: true,
    },
  };
}

export function serializeExecutionBoundaryReceipt(receipt) {
  return `${canonicalJson(receipt)}\n`;
}
