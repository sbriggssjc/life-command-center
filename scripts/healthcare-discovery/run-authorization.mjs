import { createHash } from 'node:crypto';

const HEX_64 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const LANES = new Set(['asc', 'idtf_fixed_site']);
const REQUIRED_ARTIFACTS = Object.freeze({
  asc: Object.freeze(['cms_pos_asc', 'cms_ascqr_facility', 'cms_ffs_enrollment', 'cms_asc_payment']),
  idtf_fixed_site: Object.freeze(['cms_ffs_enrollment_idtf', 'cms_nppes_org_location', 'cms_physician_supplier_utilization', 'cms_pfs_reference']),
});
const REQUIRED_REVIEW_FIELDS = Object.freeze([
  'clinical_identity', 'property_form', 'ownership', 'landlord_addressability',
  'economics', 'research_minutes', 'evidence_citations', 'reviewer_confidence',
]);
const REQUIRED_SECOND_REVIEW_TRIGGERS = Object.freeze([
  'clinical_identity_conflict', 'property_form_unknown', 'ownership_conflict',
  'economics_assumption', 'reviewer_confidence_low', 'gate_margin_within_0_05',
]);

export const RUN_AUTHORIZATION_VERSION = 'healthcare_private_run_authorization:1.0';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertHash(value, label) {
  if (!HEX_64.test(value) || /^0{64}$/.test(value)) throw new Error(`${label} must be a non-placeholder SHA-256`);
}

function exactSet(actual, required, label) {
  const values = [...actual].sort();
  const expected = [...required].sort();
  if (JSON.stringify(values) !== JSON.stringify(expected)) throw new Error(`${label} must equal the reviewed set`);
}

function packetIdentity(packet) {
  return {
    packet_version: packet.packet_version,
    lane: packet.lane,
    source_manifest_release_id: packet.source_manifest_release_id,
    artifacts: packet.artifacts.map(({ source_key, release_date, artifact_url, byte_size, sha256, header_sha256 }) => ({ source_key, release_date, artifact_url, byte_size, sha256, header_sha256 })).sort((a, b) => a.source_key.localeCompare(b.source_key)),
    storage: packet.storage,
    reviewer_evidence_dictionary: packet.reviewer_evidence_dictionary,
    second_review: packet.second_review,
    retention: packet.retention,
    privacy_receipt: packet.privacy_receipt,
    lane_stop_conditions: packet.lane_stop_conditions,
  };
}

export function computeRunAuthorizationId(packet) {
  return hash(canonicalJson(packetIdentity(packet)));
}

export function assertRunAuthorizationPacket(packet, { allowAuthorized = false } = {}) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw new Error('Authorization packet must be an object');
  if (packet.packet_version !== RUN_AUTHORIZATION_VERSION) throw new Error('Unsupported authorization packet version');
  if (!LANES.has(packet.lane)) throw new Error('Unsupported authorization lane');
  if (!['draft_unapproved', 'authorized'].includes(packet.status)) throw new Error('Invalid authorization status');
  if (packet.status === 'authorized' && !allowAuthorized) throw new Error('Authorized packets require an explicit execution-boundary validation');
  assertHash(packet.source_manifest_release_id, 'source_manifest_release_id');
  assertHash(packet.packet_id, 'packet_id');
  if (packet.packet_id !== computeRunAuthorizationId(packet)) throw new Error('packet_id does not match the deterministic packet identity');
  if (!ISO_UTC.test(packet.created_at) || Number.isNaN(Date.parse(packet.created_at))) throw new Error('created_at must be a valid UTC timestamp');

  if (!Array.isArray(packet.artifacts) || packet.artifacts.length !== 4) throw new Error('Exactly four frozen lane artifacts are required');
  const sourceKeys = new Set();
  for (const artifact of packet.artifacts) {
    if (sourceKeys.has(artifact.source_key)) throw new Error('Artifact source keys must be unique');
    sourceKeys.add(artifact.source_key);
    if (!/^https:\/\/(?:www\.|data\.|download\.)?cms\.gov\//.test(artifact.artifact_url)) throw new Error(`${artifact.source_key}.artifact_url must be an official CMS HTTPS artifact`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(artifact.release_date)) throw new Error(`${artifact.source_key}.release_date is invalid`);
    if (!Number.isSafeInteger(artifact.byte_size) || artifact.byte_size <= 0) throw new Error(`${artifact.source_key}.byte_size must be positive`);
    assertHash(artifact.sha256, `${artifact.source_key}.sha256`);
    assertHash(artifact.header_sha256, `${artifact.source_key}.header_sha256`);
  }
  exactSet(sourceKeys, REQUIRED_ARTIFACTS[packet.lane], 'artifact source keys');

  const storage = packet.storage;
  if (!storage || storage.classification !== 'private' || storage.public_access !== false || storage.signed_url_ttl_minutes > 15) throw new Error('Storage must be private with public access disabled and signed URLs capped at 15 minutes');
  if (!/^[a-z0-9][a-z0-9_-]+$/.test(storage.bucket) || !storage.object_prefix.startsWith('healthcare-discovery/')) throw new Error('Storage bucket and healthcare-discovery object prefix are required');
  exactSet(storage.allowed_roles, ['run_operator', 'primary_reviewer', 'second_reviewer', 'privacy_reviewer'], 'storage.allowed_roles');

  exactSet(packet.reviewer_evidence_dictionary.required_fields, REQUIRED_REVIEW_FIELDS, 'reviewer evidence required_fields');
  if (packet.reviewer_evidence_dictionary.version !== 'healthcare_reviewer_evidence:1.0') throw new Error('Reviewer evidence dictionary version is not pinned');
  exactSet(packet.second_review.triggers, REQUIRED_SECOND_REVIEW_TRIGGERS, 'second-review triggers');
  if (packet.second_review.same_person_allowed !== false || packet.second_review.required_for_triggered_rows !== true) throw new Error('Triggered rows require an independent second reviewer');

  const retention = packet.retention;
  if (retention.raw_source_days > 90 || retention.row_level_review_days > 180 || retention.aggregate_receipt_days < 2555) throw new Error('Retention exceeds the reviewed raw/row limits or under-retains aggregate receipts');
  if (retention.disposition !== 'cryptographic_delete_and_tombstone') throw new Error('Retention disposition must be cryptographic_delete_and_tombstone');

  if (!Array.isArray(packet.lane_stop_conditions) || packet.lane_stop_conditions.length < 5 || packet.lane_stop_conditions.some((condition) => typeof condition !== 'string' || condition.length < 12)) throw new Error('At least five explicit lane stop conditions are required');
  const privacy = packet.privacy_receipt;
  if (!privacy || privacy.classification !== 'aggregate_only' || privacy.record_level_identifiers_emitted !== false || privacy.scan_status !== 'pass') throw new Error('Privacy receipt must pass and remain aggregate-only');
  assertHash(privacy.receipt_sha256, 'privacy_receipt.receipt_sha256');
  if (!Array.isArray(packet.approvals)) throw new Error('approvals must be an array');
  const approvalRoles = new Set();
  for (const approval of packet.approvals) {
    if (!approval || !['release_owner', 'privacy_reviewer'].includes(approval.role) || typeof approval.approver_id !== 'string' || approval.approver_id.length < 3 || !ISO_UTC.test(approval.approved_at)) throw new Error('Approval records require a reviewed role, approver ID, and UTC timestamp');
    if (approvalRoles.has(approval.role)) throw new Error('Approval roles must be unique');
    approvalRoles.add(approval.role);
  }
  if (packet.approvals.length > 1 && new Set(packet.approvals.map((approval) => approval.approver_id)).size !== packet.approvals.length) throw new Error('Approval records require distinct approver identities');
  if (packet.status === 'authorized') exactSet(approvalRoles, ['release_owner', 'privacy_reviewer'], 'authorized approval roles');
  return true;
}

export function buildRunAuthorizationReceipt(packet) {
  assertRunAuthorizationPacket(packet, { allowAuthorized: true });
  return {
    receipt_version: RUN_AUTHORIZATION_VERSION,
    packet_id: packet.packet_id,
    lane: packet.lane,
    status: packet.status,
    artifact_count: packet.artifacts.length,
    release_fingerprint: hash(canonicalJson(packet.artifacts.map(({ source_key, sha256 }) => ({ source_key, sha256 })).sort((a, b) => a.source_key.localeCompare(b.source_key)))),
    controls: {
      private_storage: true,
      independent_second_review: true,
      retention_bounded: true,
      privacy_scan_passed: true,
      stop_conditions_frozen: true,
    },
    execution_authorized: packet.status === 'authorized' && packet.approvals.length >= 2,
    privacy: { classification: 'aggregate_only', record_level_identifiers_emitted: false },
  };
}

export function serializeRunAuthorizationReceipt(receipt) {
  return `${canonicalJson(receipt)}\n`;
}
