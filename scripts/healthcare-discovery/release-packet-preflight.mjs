import { createHash } from 'node:crypto';

import { assertRunAuthorizationPacket, computeRunAuthorizationId } from './run-authorization.mjs';

const HEX_64 = /^[a-f0-9]{64}$/;
const LANES = Object.freeze({
  asc: ['cms_pos_asc', 'cms_ascqr_facility', 'cms_ffs_enrollment', 'cms_asc_payment'],
  idtf_fixed_site: ['cms_ffs_enrollment_idtf', 'cms_nppes_org_location', 'cms_physician_supplier_utilization', 'cms_pfs_reference'],
});

export const RELEASE_PACKET_TEMPLATE_VERSION = 'healthcare_release_packet_template:1.0';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function templateIdentity(template) {
  return {
    template_version: template.template_version,
    lane: template.lane,
    source_candidates: template.source_candidates.map(({ source_key, catalog_url, exact_release_required }) => ({ source_key, catalog_url, exact_release_required })).sort((a, b) => a.source_key.localeCompare(b.source_key)),
    controls: template.controls,
  };
}

export function computeReleasePacketTemplateId(template) {
  return hash(canonicalJson(templateIdentity(template)));
}

export function assertReleasePacketTemplate(template) {
  if (!template || typeof template !== 'object' || Array.isArray(template)) throw new Error('Release packet template must be an object');
  if (template.template_version !== RELEASE_PACKET_TEMPLATE_VERSION) throw new Error('Unsupported release packet template version');
  if (!Object.hasOwn(LANES, template.lane)) throw new Error('Unsupported release packet template lane');
  if (!HEX_64.test(template.template_id) || template.template_id !== computeReleasePacketTemplateId(template)) throw new Error('template_id does not match the deterministic template identity');
  if (template.status !== 'template_incomplete') throw new Error('Release packet templates must remain template_incomplete');
  if (!Array.isArray(template.source_candidates) || template.source_candidates.length !== 4) throw new Error('Exactly four source candidates are required');

  const keys = [];
  for (const source of template.source_candidates) {
    keys.push(source.source_key);
    if (!/^https:\/\/(?:www\.|data\.)?cms\.gov\//.test(source.catalog_url)) throw new Error(`${source.source_key}.catalog_url must be an official CMS planning reference`);
    if (source.exact_release_required !== true) throw new Error(`${source.source_key} must require an exact release`);
    for (const field of ['artifact_url', 'release_date', 'byte_size', 'sha256', 'header_sha256']) {
      if (source[field] !== null) throw new Error(`${source.source_key}.${field} must remain null in the repository template`);
    }
  }
  if (JSON.stringify(keys.sort()) !== JSON.stringify([...LANES[template.lane]].sort())) throw new Error('Source candidate keys do not match the lane contract');

  const controls = template.controls;
  if (!controls || controls.download_authorized !== false || controls.sample_draw_authorized !== false || controls.production_write_authorized !== false) throw new Error('Template controls must prohibit download, sample draw, and production writes');
  if (controls.required_independent_hash_verifiers !== 2 || controls.required_execution_approvals !== 2) throw new Error('Template must require two hash verifiers and two execution approvals');
  return true;
}

export function buildReleasePreflightReceipt(template) {
  assertReleasePacketTemplate(template);
  return {
    receipt_version: RELEASE_PACKET_TEMPLATE_VERSION,
    template_id: template.template_id,
    lane: template.lane,
    status: 'template_incomplete',
    source_candidate_count: template.source_candidates.length,
    exact_release_fields_complete: 0,
    blockers: ['exact_artifact_identity_missing', 'independent_hash_verification_missing', 'private_storage_coordinates_missing', 'execution_approvals_missing'],
    execution_authorized: false,
  };
}

export function materializeDraftAuthorizationPacket(template, release) {
  assertReleasePacketTemplate(template);
  if (!release || typeof release !== 'object') throw new Error('Release metadata is required');
  const packet = {
    ...release,
    lane: template.lane,
    status: 'draft_unapproved',
    artifacts: template.source_candidates.map(({ source_key }) => {
      const artifact = release.artifacts?.find((candidate) => candidate.source_key === source_key);
      if (!artifact) throw new Error(`Missing exact release metadata for ${source_key}`);
      return artifact;
    }),
    approvals: [],
  };
  packet.packet_id = computeRunAuthorizationId(packet);
  assertRunAuthorizationPacket(packet);
  return packet;
}
