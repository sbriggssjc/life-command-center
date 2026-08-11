import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';

import { APPROVED_SEED_CODES } from './manifest.mjs';
import {
  NORMALIZATION_VERSION,
  addressFingerprint,
  candidateFingerprint,
  fingerprint,
  normalizeAddress,
  rowFingerprint,
} from './normalize.mjs';

export const NPPES_COLUMNS = Object.freeze({
  npi: 'NPI',
  entityType: 'Entity Type Code',
  line1: 'Provider Business Practice Location Address First Line',
  line2: 'Provider Business Practice Location Address Second Line',
  city: 'Provider Business Practice Location Address City Name',
  state: 'Provider Business Practice Location Address State Name',
  postalCode: 'Provider Business Practice Location Address Postal Code',
  country: 'Provider Business Practice Location Address Country Code (If outside U.S.)',
  deactivationDate: 'NPI Deactivation Date',
  reactivationDate: 'NPI Reactivation Date',
});

const REQUIRED_COLUMNS = Object.freeze([
  NPPES_COLUMNS.npi,
  NPPES_COLUMNS.entityType,
  NPPES_COLUMNS.line1,
  NPPES_COLUMNS.city,
  NPPES_COLUMNS.state,
  NPPES_COLUMNS.postalCode,
  NPPES_COLUMNS.deactivationDate,
  NPPES_COLUMNS.reactivationDate,
]);
const OPTIONAL_KNOWN_COLUMNS = new Set([NPPES_COLUMNS.line2, NPPES_COLUMNS.country]);
const TAXONOMY_COLUMN = /^Healthcare Provider Taxonomy Code_\d+$/;
const MAX_CANDIDATE_FINGERPRINTS = 2_000_000;
const MODALITY = Object.freeze({
  '261QX0200X': 'oncology',
  '261QI0500X': 'infusion_therapy',
  '261QX0203X': 'radiation_oncology',
});

function increment(bucket, key, amount = 1) {
  bucket[key] = (bucket[key] || 0) + amount;
}

function isoDateValue(value) {
  const clean = String(value || '').trim();
  if (!clean) return null;
  const parsed = Date.parse(`${clean}T00:00:00Z`);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function activeAtFreeze(row, freezeDate) {
  const deactivated = isoDateValue(row[NPPES_COLUMNS.deactivationDate]);
  const reactivated = isoDateValue(row[NPPES_COLUMNS.reactivationDate]);
  if (Number.isNaN(deactivated) || Number.isNaN(reactivated)) return { active: false, reason: 'invalid_status_date' };
  const freeze = Date.parse(`${freezeDate}T23:59:59Z`);
  if (deactivated === null || deactivated > freeze) return { active: true };
  if (reactivated !== null && reactivated <= freeze && reactivated >= deactivated) return { active: true };
  return { active: false, reason: 'inactive_at_freeze' };
}

function canonicalObject(value) {
  if (Array.isArray(value)) return value.map(canonicalObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalObject(value[key])]));
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalObject(value), null, 2)}\n`;
}

function validateHeaders(headers) {
  const missing = REQUIRED_COLUMNS.filter((name) => !headers.includes(name));
  const taxonomyColumns = headers.filter((name) => TAXONOMY_COLUMN.test(name));
  if (!taxonomyColumns.length) missing.push('Healthcare Provider Taxonomy Code_<n>');
  if (missing.length) throw new Error(`NPPES source is missing required column(s): ${missing.join(', ')}`);
  const known = new Set([...REQUIRED_COLUMNS, ...OPTIONAL_KNOWN_COLUMNS, ...taxonomyColumns]);
  return {
    taxonomyColumns,
    unknownColumns: headers.filter((name) => !known.has(name)).sort(),
    schemaFingerprint: createHash('sha256').update(headers.join('\u001f')).digest('hex'),
  };
}

export async function profileNppesFile(filePath, options) {
  const { freezeDate, manifestSha256, taxonomyFingerprint, transformVersion } = options;
  const counts = {
    source_rows: 0,
    parsed_rows: 0,
    eligible_organizations: 0,
    candidate_locations: 0,
    excluded: 0,
    malformed: 0,
  };
  const breakdowns = {
    modality: {}, state: {}, location_role: {}, exclusion_reason: {}, collision_class: {},
  };
  const organizations = new Set();
  const candidates = new Map();
  const observations = new Set();
  let headerInfo;

  const parser = createReadStream(filePath).pipe(parse({
    bom: true,
    columns(headers) {
      headerInfo = validateHeaders(headers);
      return headers;
    },
    relax_column_count: false,
    skip_empty_lines: true,
    trim: true,
  }));

  try {
    for await (const row of parser) {
      counts.source_rows += 1;
      const taxonomyCodes = headerInfo.taxonomyColumns.map((column) => row[column]).filter(Boolean);
      const approvedCodes = [...new Set(taxonomyCodes.filter((code) => APPROVED_SEED_CODES.includes(code)))];
      let exclusionReason = null;
      if (row[NPPES_COLUMNS.entityType] !== '2') exclusionReason = 'not_organization';
      const status = activeAtFreeze(row, freezeDate);
      if (!exclusionReason && !status.active) exclusionReason = status.reason;
      const country = String(row[NPPES_COLUMNS.country] || 'US').trim().toUpperCase() || 'US';
      if (!exclusionReason && country !== 'US') exclusionReason = 'non_us_location';
      if (!exclusionReason && !approvedCodes.length) exclusionReason = 'no_approved_taxonomy';

      const address = normalizeAddress({
        line1: row[NPPES_COLUMNS.line1], line2: row[NPPES_COLUMNS.line2],
        city: row[NPPES_COLUMNS.city], state: row[NPPES_COLUMNS.state],
        postalCode: row[NPPES_COLUMNS.postalCode], country,
      });
      if (!exclusionReason && !address.complete) exclusionReason = 'incomplete_address';
      if (exclusionReason) {
        counts.excluded += 1;
        increment(breakdowns.exclusion_reason, exclusionReason);
        continue;
      }

      counts.parsed_rows += 1;
      const addressHash = addressFingerprint(address);
      const observationHash = rowFingerprint({
        npi: row[NPPES_COLUMNS.npi], addressHash, taxonomyCodes: approvedCodes, locationRole: 'primary',
      });
      if (observations.has(observationHash)) {
        increment(breakdowns.collision_class, 'duplicate_observation');
        continue;
      }
      observations.add(observationHash);
      const organizationHash = fingerprint('organization', [row[NPPES_COLUMNS.npi]]);
      organizations.add(organizationHash);
      increment(breakdowns.state, address.state);
      increment(breakdowns.location_role, 'primary');

      for (const code of approvedCodes) {
        const modality = MODALITY[code];
        increment(breakdowns.modality, modality);
        const candidateHash = candidateFingerprint({ addressHash, modality });
        const prior = candidates.get(candidateHash);
        if (prior && prior !== organizationHash) increment(breakdowns.collision_class, 'multi_npi_same_candidate');
        candidates.set(candidateHash, prior || organizationHash);
        if (candidates.size > MAX_CANDIDATE_FINGERPRINTS) throw new Error('Candidate fingerprint safety ceiling exceeded');
      }
    }
  } catch (error) {
    if (error.code === 'CSV_RECORD_INCONSISTENT_COLUMNS') throw new Error('Malformed NPPES CSV row: inconsistent column count');
    throw error;
  }

  counts.eligible_organizations = organizations.size;
  counts.candidate_locations = candidates.size;
  counts.malformed = 0;
  return {
    receipt_version: '1.0',
    command: 'profile',
    transform_version: transformVersion,
    normalization_version: NORMALIZATION_VERSION,
    manifest_sha256: manifestSha256,
    schema_fingerprint: headerInfo.schemaFingerprint,
    taxonomy_fingerprint: taxonomyFingerprint,
    counts,
    breakdowns,
    warnings: headerInfo.unknownColumns.length ? [{ class: 'additive_schema_drift', columns: headerInfo.unknownColumns }] : [],
  };
}
