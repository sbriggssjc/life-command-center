import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { resolvePrivateSourcePath } from './manifest.mjs';

export const LANE_MANIFEST_VERSION = '2.0';
export const LANE_POLICIES = Object.freeze({
  asc: Object.freeze({
    requiredSources: Object.freeze(['cms_pos_asc', 'cms_ascqr_facility', 'cms_ffs_enrollment', 'cms_asc_payment']),
  }),
  idtf_fixed_site: Object.freeze({
    requiredSources: Object.freeze(['cms_ffs_enrollment_idtf', 'cms_nppes_org_location', 'cms_physician_supplier_utilization', 'cms_pfs_reference']),
  }),
});

const OFFICIAL_HOSTS = Object.freeze({
  cms_pos_asc: new Set(['data.cms.gov']),
  cms_ascqr_facility: new Set(['data.cms.gov']),
  cms_ffs_enrollment: new Set(['data.cms.gov']),
  cms_asc_payment: new Set(['cms.gov', 'www.cms.gov']),
  cms_ffs_enrollment_idtf: new Set(['data.cms.gov']),
  cms_nppes_org_location: new Set(['download.cms.gov']),
  cms_physician_supplier_utilization: new Set(['data.cms.gov']),
  cms_pfs_reference: new Set(['cms.gov', 'www.cms.gov']),
});
const TOP_KEYS = new Set(['manifest_version', 'lane', 'release_id', 'created_at', 'adapter_version', 'normalization_version', 'eligibility_rule_version', 'sources', 'expected_outputs', 'limits', 'site_form_rules']);
const SOURCE_KEYS = new Set(['source_key', 'landing_page_url', 'artifact_url', 'publisher', 'release_date', 'retrieved_at', 'object_path', 'byte_size', 'sha256', 'header_sha256', 'required_columns', 'allowed_use']);
const OUTPUT_KEYS = new Set(['name', 'classification']);
const LIMIT_KEYS = new Set(['max_bytes_per_source', 'max_rows', 'max_candidate_fingerprints', 'max_heap_mib', 'max_error_rate']);
const SITE_FORM_KEYS = new Set(['default_status', 'qualifying_status', 'excluded_forms']);
const HEX_64 = /^[a-f0-9]{64}$/;
const VERSION = /^[a-z][a-z0-9_-]*:\d+\.\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const IDTF_EXCLUSIONS = Object.freeze(['mobile_unit', 'portable_xray', 'physician_office', 'hospital_department', 'warehouse', 'equipment_base']);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function computeLaneReleaseId(manifest) {
  const identity = {
    lane: manifest.lane,
    adapter_version: manifest.adapter_version,
    normalization_version: manifest.normalization_version,
    eligibility_rule_version: manifest.eligibility_rule_version,
    sources: [...manifest.sources].map(({ source_key, release_date, sha256 }) => ({ source_key, release_date, sha256 })).sort((a, b) => a.source_key.localeCompare(b.source_key)),
  };
  return createHash('sha256').update(canonicalJson(identity)).digest('hex');
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unknown ${label} key(s): ${unknown.sort().join(', ')}`);
}

function validDate(value, pattern, label) {
  if (!pattern.test(value) || Number.isNaN(Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value))) throw new Error(`${label} is invalid`);
}

function approvedUrl(value, hosts, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a valid URL`); }
  if (url.protocol !== 'https:' || !hosts.has(url.hostname)) throw new Error(`${label} must use an approved official HTTPS origin`);
}

export function assertLaneManifestContract(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Lane manifest must be an object');
  exactKeys(manifest, TOP_KEYS, 'manifest');
  const requiredTop = [...TOP_KEYS].filter((key) => key !== 'site_form_rules');
  for (const key of requiredTop) if (!Object.hasOwn(manifest, key)) throw new Error(`Missing manifest key: ${key}`);
  if (manifest.manifest_version !== LANE_MANIFEST_VERSION) throw new Error('Unsupported lane manifest_version');
  const policy = LANE_POLICIES[manifest.lane];
  if (!policy) throw new Error(`Unsupported healthcare lane: ${manifest.lane || '(missing)'}`);
  if (!HEX_64.test(manifest.release_id) || /^0{64}$/.test(manifest.release_id)) throw new Error('release_id must be a non-placeholder SHA-256');
  validDate(manifest.created_at, ISO_UTC, 'created_at');
  for (const field of ['adapter_version', 'normalization_version', 'eligibility_rule_version']) {
    if (!VERSION.test(manifest[field])) throw new Error(`${field} must be pinned`);
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length !== policy.requiredSources.length) throw new Error(`${manifest.lane} requires exactly ${policy.requiredSources.length} sources`);
  const names = new Set();
  for (const source of manifest.sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Each source must be an object');
    exactKeys(source, SOURCE_KEYS, 'source');
    for (const key of SOURCE_KEYS) if (!Object.hasOwn(source, key)) throw new Error(`Missing source key: ${key}`);
    if (!policy.requiredSources.includes(source.source_key)) throw new Error(`Unsupported ${manifest.lane} source: ${source.source_key}`);
    if (names.has(source.source_key)) throw new Error(`Duplicate source key: ${source.source_key}`);
    names.add(source.source_key);
    const hosts = OFFICIAL_HOSTS[source.source_key];
    approvedUrl(source.landing_page_url, hosts, `${source.source_key}.landing_page_url`);
    approvedUrl(source.artifact_url, hosts, `${source.source_key}.artifact_url`);
    if (source.publisher !== 'CMS') throw new Error(`${source.source_key}.publisher must be CMS`);
    validDate(source.release_date, ISO_DATE, `${source.source_key}.release_date`);
    validDate(source.retrieved_at, ISO_UTC, `${source.source_key}.retrieved_at`);
    if (path.isAbsolute(source.object_path) || source.object_path.split(/[\\/]/).includes('..')) throw new Error(`${source.source_key}.object_path must be a safe relative path`);
    if (!Number.isSafeInteger(source.byte_size) || source.byte_size <= 0) throw new Error(`${source.source_key}.byte_size must be positive`);
    for (const field of ['sha256', 'header_sha256']) if (!HEX_64.test(source[field]) || /^0{64}$/.test(source[field])) throw new Error(`${source.source_key}.${field} is invalid or placeholder`);
    if (!Array.isArray(source.required_columns) || !source.required_columns.length || source.required_columns.some((column) => typeof column !== 'string' || !column.trim())) throw new Error(`${source.source_key}.required_columns must be non-empty`);
    if (!['facility_identity', 'corroboration', 'economics_reference', 'economics_observation'].includes(source.allowed_use)) throw new Error(`${source.source_key}.allowed_use is invalid`);
  }
  if (policy.requiredSources.some((name) => !names.has(name))) throw new Error(`${manifest.lane} required source set is incomplete`);
  if (manifest.release_id !== computeLaneReleaseId(manifest)) throw new Error('release_id does not match the deterministic lane/source/version fingerprint');
  if (!Array.isArray(manifest.expected_outputs) || !manifest.expected_outputs.length) throw new Error('expected_outputs are required');
  for (const output of manifest.expected_outputs) {
    exactKeys(output, OUTPUT_KEYS, 'output');
    if (output.classification !== 'aggregate_receipt' || !/^[a-z][a-z0-9_-]+$/.test(output.name)) throw new Error('Only named aggregate receipts are allowed');
  }
  exactKeys(manifest.limits, LIMIT_KEYS, 'limit');
  for (const key of ['max_bytes_per_source', 'max_rows', 'max_candidate_fingerprints', 'max_heap_mib']) if (!Number.isSafeInteger(manifest.limits[key]) || manifest.limits[key] <= 0) throw new Error(`${key} must be a positive integer`);
  if (typeof manifest.limits.max_error_rate !== 'number' || manifest.limits.max_error_rate < 0 || manifest.limits.max_error_rate > 0.05) throw new Error('max_error_rate must be between 0 and 0.05');
  if (manifest.lane === 'idtf_fixed_site') {
    if (!manifest.site_form_rules) throw new Error('IDTF manifests require site_form_rules');
    exactKeys(manifest.site_form_rules, SITE_FORM_KEYS, 'site_form_rules');
    if (manifest.site_form_rules.default_status !== 'fixed_site_unproven' || manifest.site_form_rules.qualifying_status !== 'fixed_site_confirmed') throw new Error('IDTF site-form statuses do not match the reviewed contract');
    const exclusions = [...manifest.site_form_rules.excluded_forms].sort();
    if (JSON.stringify(exclusions) !== JSON.stringify([...IDTF_EXCLUSIONS].sort())) throw new Error('IDTF excluded_forms do not match the reviewed contract');
  } else if (manifest.site_form_rules !== undefined) throw new Error('ASC manifests cannot define IDTF site_form_rules');
  return true;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function sha256Header(filePath) {
  const contents = await readFile(filePath);
  const newline = contents.indexOf(0x0a);
  return createHash('sha256').update(newline === -1 ? contents : contents.subarray(0, newline + 1)).digest('hex');
}

export async function validateLaneManifestFile(manifestPath, options = {}) {
  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  assertLaneManifestContract(manifest);
  const sourceFingerprints = [];
  for (const source of manifest.sources) {
    const filePath = resolvePrivateSourcePath(manifestPath, source.object_path, options);
    const fileStat = await stat(filePath);
    if (fileStat.size !== source.byte_size) throw new Error(`${source.source_key} byte-size mismatch`);
    if (fileStat.size > manifest.limits.max_bytes_per_source) throw new Error(`${source.source_key} exceeds max_bytes_per_source`);
    const sha256 = await sha256File(filePath);
    if (sha256 !== source.sha256) throw new Error(`${source.source_key} checksum mismatch`);
    if (await sha256Header(filePath) !== source.header_sha256) throw new Error(`${source.source_key} header checksum mismatch`);
    const header = (await readFile(filePath, 'utf8')).split(/\r?\n/, 1)[0].split(',').map((value) => value.trim());
    const missing = source.required_columns.filter((column) => !header.includes(column));
    if (missing.length) throw new Error(`${source.source_key} missing required column(s): ${missing.join(', ')}`);
    sourceFingerprints.push({ source_key: source.source_key, sha256, byte_size: fileStat.size });
  }
  return { receipt_version: '1.0', lane: manifest.lane, release_id: manifest.release_id, source_fingerprints: sourceFingerprints, status: 'pass' };
}
