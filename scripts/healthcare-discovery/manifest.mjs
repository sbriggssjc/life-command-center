import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_VERSION = '1.1';
export const APPROVED_SEED_CODES = Object.freeze([
  '261QX0200X',
  '261QI0500X',
  '261QX0203X',
]);

export const MANIFEST_TOP_LEVEL_KEYS = Object.freeze([
  'manifest_version',
  'freeze_date',
  'transform_version',
  'sources',
  'parameters',
]);

const SOURCE_KEYS = new Set([
  'name', 'release_date', 'url', 'object_path', 'sha256', 'byte_size', 'header_sha256', 'approved_seed_codes',
]);
const PARAMETER_KEYS = new Set([
  'entity_type_code', 'country_code', 'include_deactivated', 'candidate_minimum', 'sample_size', 'random_seed',
]);
const OFFICIAL_SOURCE_HOSTS = Object.freeze({
  nppes_v2_monthly: new Set(['download.cms.gov']),
  nppes_secondary_locations: new Set(['download.cms.gov']),
  nucc_taxonomy: new Set(['taxonomy.nucc.org', 'www.nucc.org']),
});
const HEX_64 = /^[a-f0-9]{64}$/;
const CLEAN_TRANSFORM = /^git:[a-f0-9]{40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertExactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unknown ${label} key(s): ${unknown.sort().join(', ')}`);
}

function assertIsoDate(value, label) {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${label} must be a valid ISO date`);
  }
}

export function assertManifestContract(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Manifest must be an object');
  const unknown = Object.keys(value).filter((key) => !MANIFEST_TOP_LEVEL_KEYS.includes(key));
  if (unknown.length) throw new Error(`Unknown manifest key(s): ${unknown.sort().join(', ')}`);
  for (const key of MANIFEST_TOP_LEVEL_KEYS) {
    if (!Object.hasOwn(value, key)) throw new Error(`Missing manifest key: ${key}`);
  }
  if (value.manifest_version !== MANIFEST_VERSION) throw new Error('Unsupported manifest_version');
  if (!Array.isArray(value.sources) || value.sources.length !== 3) throw new Error('Manifest requires three sources');
  assertIsoDate(value.freeze_date, 'freeze_date');
  if (!CLEAN_TRANSFORM.test(value.transform_version) || /^git:0{40}$/.test(value.transform_version)) {
    throw new Error('transform_version must be a non-placeholder git SHA');
  }

  const names = new Set();
  for (const source of value.sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Each source must be an object');
    assertExactKeys(source, SOURCE_KEYS, 'source');
    if (!OFFICIAL_SOURCE_HOSTS[source.name]) throw new Error(`Unsupported source name: ${source.name || '(missing)'}`);
    if (names.has(source.name)) throw new Error(`Duplicate source name: ${source.name}`);
    names.add(source.name);
    assertIsoDate(source.release_date, `${source.name}.release_date`);
    let url;
    try { url = new URL(source.url); } catch { throw new Error(`${source.name}.url must be a valid URL`); }
    if (url.protocol !== 'https:' || !OFFICIAL_SOURCE_HOSTS[source.name].has(url.hostname)) {
      throw new Error(`${source.name}.url must use an approved official HTTPS origin`);
    }
    if (typeof source.object_path !== 'string' || !source.object_path) throw new Error(`${source.name}.object_path is required`);
    if (!HEX_64.test(source.sha256) || /^0{64}$/.test(source.sha256)) throw new Error(`${source.name}.sha256 is invalid or placeholder`);
    if (!Number.isSafeInteger(source.byte_size) || source.byte_size <= 0) throw new Error(`${source.name}.byte_size must be positive`);
    if (source.header_sha256 !== undefined && (!HEX_64.test(source.header_sha256) || /^0{64}$/.test(source.header_sha256))) {
      throw new Error(`${source.name}.header_sha256 is invalid or placeholder`);
    }
  }
  if (names.size !== 3 || !names.has('nppes_v2_monthly') || !names.has('nppes_secondary_locations') || !names.has('nucc_taxonomy')) {
    throw new Error('Manifest must contain primary NPPES, secondary-location NPPES, and NUCC sources');
  }

  assertExactKeys(value.parameters, PARAMETER_KEYS, 'parameter');
  if (value.parameters.entity_type_code !== 2 || value.parameters.country_code !== 'US') throw new Error('Unsupported entity/country parameters');
  if (value.parameters.include_deactivated !== false) throw new Error('Deactivated organizations cannot be included');
  if (!Number.isInteger(value.parameters.candidate_minimum) || value.parameters.candidate_minimum < 400) throw new Error('candidate_minimum must be at least 400');
  if (value.parameters.sample_size !== 50) throw new Error('sample_size must equal 50');
  if (!Number.isSafeInteger(value.parameters.random_seed) || value.parameters.random_seed < 0) throw new Error('random_seed must be a non-negative integer');

  const taxonomy = value.sources.find((source) => source.name === 'nucc_taxonomy');
  if (JSON.stringify(taxonomy.approved_seed_codes) !== JSON.stringify(APPROVED_SEED_CODES)) {
    throw new Error('approved_seed_codes do not match the reviewed contract');
  }
  return true;
}

export function resolvePrivateSourcePath(manifestPath, objectPath, options = {}) {
  const manifestFilePath = manifestPath instanceof URL ? fileURLToPath(manifestPath) : manifestPath;
  const manifestDir = path.dirname(path.resolve(manifestFilePath));
  const resolved = path.resolve(manifestDir, objectPath);
  const privateRoot = path.resolve(options.privateRoot || manifestDir);
  const fixtureRoot = options.fixtureRoot ? path.resolve(options.fixtureRoot) : null;
  const inside = (candidate, root) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
  if (!inside(resolved, privateRoot) && !(fixtureRoot && inside(resolved, fixtureRoot))) {
    throw new Error('Source path is outside the approved private or synthetic-fixture root');
  }
  return resolved;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function sha256Header(filePath) {
  const contents = await readFile(filePath);
  const newline = contents.indexOf(0x0a);
  const header = newline === -1 ? contents : contents.subarray(0, newline + 1);
  return createHash('sha256').update(header).digest('hex');
}

function isSyntheticFixture(filePath, fixtureRoot) {
  if (!fixtureRoot) return false;
  const relative = path.relative(path.resolve(fixtureRoot), path.resolve(filePath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function canonicalizeSyntheticFixtureBytes(contents) {
  return Buffer.from(contents.toString('utf8').replace(/\r+\n/g, '\n'), 'utf8');
}

async function inspectSourceFile(filePath, options) {
  if (!isSyntheticFixture(filePath, options.fixtureRoot)) {
    const fileStat = await stat(filePath);
    return { byteSize: fileStat.size, sha256: await sha256File(filePath), headerSha256: await sha256Header(filePath) };
  }
  const contents = canonicalizeSyntheticFixtureBytes(await readFile(filePath));
  const newline = contents.indexOf(0x0a);
  const header = newline === -1 ? contents : contents.subarray(0, newline + 1);
  return {
    byteSize: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'),
    headerSha256: createHash('sha256').update(header).digest('hex'),
  };
}

export async function validateManifestFile(manifestPath, options = {}) {
  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  assertManifestContract(manifest);
  const sources = [];
  for (const source of manifest.sources) {
    const filePath = resolvePrivateSourcePath(manifestPath, source.object_path, options);
    const inspected = await inspectSourceFile(filePath, options);
    if (inspected.byteSize !== source.byte_size) throw new Error(`${source.name} byte-size mismatch`);
    const sha256 = inspected.sha256;
    if (sha256 !== source.sha256) throw new Error(`${source.name} checksum mismatch`);
    if (source.header_sha256) {
      const headerSha256 = inspected.headerSha256;
      if (headerSha256 !== source.header_sha256) throw new Error(`${source.name} header checksum mismatch`);
    }
    sources.push({ name: source.name, sha256, byte_size: inspected.byteSize });
  }
  return {
    receipt_version: '1.0',
    command: 'validate',
    manifest_sha256: createHash('sha256').update(raw).digest('hex'),
    source_fingerprints: sources,
    status: 'pass',
    transform_version: manifest.transform_version,
  };
}
