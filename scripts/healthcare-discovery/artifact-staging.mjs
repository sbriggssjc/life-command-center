import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { assertReleasePacketTemplate } from './release-packet-preflight.mjs';

const ASC_SOURCE_KEYS = Object.freeze([
  'cms_pos_asc',
  'cms_ascqr_facility',
  'cms_ffs_enrollment',
  'cms_asc_payment',
]);
const HEX_64 = /^[a-f0-9]{64}$/;

export const ARTIFACT_STAGING_VERSION = 'healthcare_artifact_staging:1.0';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertExactKeys(actual) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...ASC_SOURCE_KEYS].sort())) {
    throw new Error('ASC staging requires the exact reviewed four-source bundle');
  }
}

function safeArtifactPath(root, localPath) {
  if (typeof localPath !== 'string' || !localPath || isAbsolute(localPath)) throw new Error('Artifact paths must be non-empty relative paths');
  const resolved = resolve(root, localPath);
  const rel = relative(root, resolved);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Artifact path escapes or aliases the approved staging root');
  return resolved;
}

function firstHeader(bytes) {
  const firstLine = bytes.toString('utf8').split(/\r?\n/, 1)[0];
  if (!firstLine.trim()) throw new Error('Artifact header must be a non-empty first line');
  return sha256(Buffer.from(firstLine, 'utf8'));
}

function assertVerifier(attestation, sourceKey, computed) {
  if (!attestation || attestation.source_key !== sourceKey) throw new Error(`Missing independent verifier attestation for ${sourceKey}`);
  if (typeof attestation.verifier_id !== 'string' || attestation.verifier_id.length < 3) throw new Error(`${sourceKey} requires an independent verifier ID`);
  if (!HEX_64.test(attestation.sha256) || !HEX_64.test(attestation.header_sha256)) throw new Error(`${sourceKey} verifier hashes must be SHA-256 values`);
  if (attestation.byte_size !== computed.byte_size || attestation.sha256 !== computed.sha256 || attestation.header_sha256 !== computed.header_sha256) {
    throw new Error(`${sourceKey} independent verification mismatch`);
  }
}

export async function stageAscArtifacts({ template, approvedRoot, artifacts, verifierAttestations }) {
  assertReleasePacketTemplate(template);
  if (template.lane !== 'asc') throw new Error('The first staging checkpoint is ASC-only');
  if (!isAbsolute(approvedRoot)) throw new Error('approvedRoot must be an absolute private staging path');
  if (!Array.isArray(artifacts) || !Array.isArray(verifierAttestations)) throw new Error('Artifacts and verifier attestations are required');
  if (artifacts.length !== ASC_SOURCE_KEYS.length || verifierAttestations.length !== ASC_SOURCE_KEYS.length) throw new Error('ASC staging requires exactly four artifact and verifier records');
  assertExactKeys(new Set(artifacts.map((artifact) => artifact.source_key)));
  assertExactKeys(new Set(verifierAttestations.map((artifact) => artifact.source_key)));

  const frozen = [];
  for (const artifact of artifacts) {
    if (!/^https:\/\/(?:www\.|data\.|download\.)?cms\.gov\//.test(artifact.artifact_url)) throw new Error(`${artifact.source_key}.artifact_url must be an official CMS HTTPS artifact`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(artifact.release_date)) throw new Error(`${artifact.source_key}.release_date is invalid`);
    const localPath = safeArtifactPath(resolve(approvedRoot), artifact.local_path);
    const fileStat = await lstat(localPath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile() || fileStat.size <= 0) throw new Error(`${artifact.source_key} must resolve to a non-empty, non-symlink regular file`);
    const bytes = await readFile(localPath);
    const computed = { byte_size: bytes.byteLength, sha256: sha256(bytes), header_sha256: firstHeader(bytes) };
    assertVerifier(verifierAttestations.find((item) => item.source_key === artifact.source_key), artifact.source_key, computed);
    frozen.push({
      source_key: artifact.source_key,
      release_date: artifact.release_date,
      artifact_url: artifact.artifact_url,
      ...computed,
    });
  }

  frozen.sort((a, b) => a.source_key.localeCompare(b.source_key));
  const releaseFingerprint = sha256(canonicalJson(frozen.map(({ source_key, release_date, byte_size, sha256: digest, header_sha256 }) => ({ source_key, release_date, byte_size, sha256: digest, header_sha256 }))));
  return {
    release: { lane: 'asc', artifacts: frozen, release_fingerprint: releaseFingerprint },
    receipt: {
      receipt_version: ARTIFACT_STAGING_VERSION,
      lane: 'asc',
      status: 'staged_verified_draft_only',
      artifact_count: frozen.length,
      release_fingerprint: releaseFingerprint,
      controls: {
        independent_hash_verification: true,
        private_root_required: true,
        sample_draw_authorized: false,
        production_write_authorized: false,
        execution_authorized: false,
      },
      privacy: { classification: 'aggregate_only', source_paths_emitted: false, record_level_identifiers_emitted: false },
    },
  };
}

export function serializeArtifactStagingReceipt(receipt) {
  return `${canonicalJson(receipt)}\n`;
}
