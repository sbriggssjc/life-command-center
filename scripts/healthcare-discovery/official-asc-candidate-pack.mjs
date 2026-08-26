import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { parse } from 'csv-parse';

import { assertRunAuthorizationPacket } from './run-authorization.mjs';
import { REVIEW_CONTRACT_VERSION } from './property-review.mjs';

export const OFFICIAL_ASC_CANDIDATE_PACK_VERSION = 'healthcare_official_asc_candidate_pack:1.0';

const ASC_ENROLLMENT_TYPE = 'PART B SUPPLIER - AMBULATORY SURGICAL CENTER';
const REGIONS = Object.freeze({
  CT: 'northeast', ME: 'northeast', MA: 'northeast', NH: 'northeast', RI: 'northeast', VT: 'northeast', NJ: 'northeast', NY: 'northeast', PA: 'northeast',
  IL: 'midwest', IN: 'midwest', MI: 'midwest', OH: 'midwest', WI: 'midwest', IA: 'midwest', KS: 'midwest', MN: 'midwest', MO: 'midwest', NE: 'midwest', ND: 'midwest', SD: 'midwest',
  DE: 'south', FL: 'south', GA: 'south', MD: 'south', NC: 'south', SC: 'south', VA: 'south', DC: 'south', WV: 'south', AL: 'south', KY: 'south', MS: 'south', TN: 'south', AR: 'south', LA: 'south', OK: 'south', TX: 'south',
  AZ: 'west', CO: 'west', ID: 'west', MT: 'west', NV: 'west', NM: 'west', UT: 'west', WY: 'west', AK: 'west', CA: 'west', HI: 'west', OR: 'west', WA: 'west',
});

const clean = (value) => String(value ?? '').normalize('NFKC').trim().toUpperCase();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function eachCsv(filePath, onRow) {
  const rows = createReadStream(filePath).pipe(parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: false }));
  for await (const row of rows) await onRow(row);
}

async function inspectFile(filePath) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return { byte_size: (await stat(filePath)).size, sha256: digest.digest('hex') };
}

async function assertStagedArtifacts(packet, paths) {
  for (const [sourceKey, filePath] of Object.entries(paths)) {
    const expected = packet.artifacts.find((artifact) => artifact.source_key === sourceKey);
    if (!expected) throw new Error(`Authorized packet is missing ${sourceKey}`);
    const actual = await inspectFile(filePath);
    if (actual.byte_size !== expected.byte_size || actual.sha256 !== expected.sha256) throw new Error(`${sourceKey} no longer matches the authorized staged artifact`);
  }
}

function validateAuthorization(packet, authorizationReceipt) {
  assertRunAuthorizationPacket(packet, { allowAuthorized: true });
  if (packet.status !== 'authorized' || packet.lane !== 'asc' || packet.approvals.length !== 2) throw new Error('An authorized ASC packet with two approvals is required');
  if (authorizationReceipt?.status !== 'authorized' || authorizationReceipt.execution_authorized !== true) throw new Error('An aggregate execution-authorization receipt is required');
  if (authorizationReceipt.packet_id !== packet.packet_id || authorizationReceipt.lane !== 'asc' || authorizationReceipt.staged_release_bound !== true) throw new Error('Authorization receipt is not bound to the ASC packet');
}

function allocateHamilton(strata, sampleSize) {
  const total = strata.reduce((sum, row) => sum + row.eligible, 0);
  if (total < sampleSize) throw new Error(`Candidate universe has ${total} eligible facilities for sample size ${sampleSize}`);
  const allocations = strata.map((row) => {
    const ideal = row.eligible * sampleSize / total;
    return { ...row, quota: Math.floor(ideal), remainder: ideal - Math.floor(ideal) };
  });
  let remaining = sampleSize - allocations.reduce((sum, row) => sum + row.quota, 0);
  for (const row of [...allocations].sort((a, b) => b.remainder - a.remainder || a.name.localeCompare(b.name))) {
    if (!remaining) break;
    if (row.quota < row.eligible) { row.quota += 1; remaining -= 1; }
  }
  if (remaining) throw new Error('Unable to allocate the complete sample without replacement');
  return allocations.filter((row) => row.quota > 0).sort((a, b) => a.name.localeCompare(b.name));
}

export async function buildOfficialAscCandidatePack({ packet, authorizationReceipt, posPath, qualityPath, enrollmentPath, paymentPath, sampleSize = 50 }) {
  validateAuthorization(packet, authorizationReceipt);
  if (sampleSize !== 50) throw new Error('The authorized ASC sample size must equal 50');
  await assertStagedArtifacts(packet, { cms_pos_asc: posPath, cms_ascqr_facility: qualityPath, cms_ffs_enrollment: enrollmentPath, cms_asc_payment: paymentPath });
  const releaseId = packet.source_manifest_release_id;
  const quality = new Map();
  await eachCsv(qualityPath, (row) => {
    const ccn = clean(row['Facility ID']);
    const npi = clean(row.NPI);
    if (!ccn || !npi) throw new Error('ASCQR rows require Facility ID and NPI');
    const candidate = { ccn, npi, facility_name: String(row['Facility Name'] ?? '').trim(), city: String(row['City/Town'] ?? '').trim(), state: clean(row.State), zip: String(row['ZIP Code'] ?? '').trim(), year: Number(row.Year) || 0 };
    const existing = quality.get(ccn);
    if (existing && existing.npi !== npi) throw new Error(`ASCQR Facility ID ${ccn} maps to conflicting NPIs`);
    if (!existing || candidate.year > existing.year || (candidate.year === existing.year && canonicalJson(candidate) < canonicalJson(existing))) quality.set(ccn, candidate);
  });

  const enrollmentByNpi = new Map();
  const relevantNpis = new Set([...quality.values()].map((row) => row.npi));
  await eachCsv(enrollmentPath, (row) => {
    const npi = clean(row.NPI);
    if (!relevantNpis.has(npi) || clean(row.PROVIDER_TYPE_DESC) !== ASC_ENROLLMENT_TYPE) return;
    const org = clean(row.ORG_NAME);
    if (!enrollmentByNpi.has(npi)) enrollmentByNpi.set(npi, new Set());
    if (org) enrollmentByNpi.get(npi).add(org);
  });

  const certified = new Map();
  await eachCsv(posPath, (row) => {
    const ccn = clean(row.prvdr_num);
    const q = quality.get(ccn);
    if (!q || clean(row.fed_crtfctn_stus_name) !== 'CERTIFIED') return;
    if (clean(row.prvdr_type_id) !== '11') throw new Error(`POS facility ${ccn} has unexpected provider type`);
    const state = clean(row.state_cd || q.state);
    const region = REGIONS[state];
    if (!region) return;
    const value = { ...q, facility_name: String(row.fac_name || q.facility_name).trim(), address: String(row.st_adr ?? '').trim(), city: String(row.city_name || q.city).trim(), state, zip: String(row.zip_cd || q.zip).trim(), region };
    const existing = certified.get(ccn);
    if (existing && canonicalJson(existing) !== canonicalJson(value)) throw new Error(`Certified POS facility ${ccn} is duplicated inconsistently`);
    certified.set(ccn, value);
  });

  const orgFacilities = new Map();
  for (const facility of certified.values()) {
    for (const org of enrollmentByNpi.get(facility.npi) ?? []) {
      if (!orgFacilities.has(org)) orgFacilities.set(org, new Set());
      orgFacilities.get(org).add(facility.ccn);
    }
  }

  const candidates = [];
  const crosswalk = [];
  for (const facility of certified.values()) {
    const orgs = [...(enrollmentByNpi.get(facility.npi) ?? [])].sort();
    const corroborationTier = orgs.length ? 'pos_quality_enrollment' : 'pos_quality_only';
    const footprint = !orgs.length ? 'unknown' : orgs.some((org) => orgFacilities.get(org).size > 1) ? 'multi_site_proxy' : 'single_site_proxy';
    const candidateFingerprint = sha256(`${releaseId}:asc:${facility.ccn}`);
    candidates.push({ candidate_fingerprint: candidateFingerprint, region: facility.region, corroboration_tier: corroborationTier, operator_footprint_proxy: footprint });
    crosswalk.push({
      candidate_fingerprint: candidateFingerprint,
      cms_identity: { ccn: facility.ccn, npi: facility.npi, facility_name: facility.facility_name, address: facility.address, city: facility.city, state: facility.state, zip: facility.zip },
      cms_evidence: { pos_certification_status: 'CERTIFIED', ascqr_year: facility.year, enrollment_corroborated: orgs.length > 0, enrollment_org_names: orgs, operator_footprint_proxy: footprint },
      manual_review: { property_form: null, landlord_owner: null, ownership_evidence: null, landlord_addressable: null, economics_bounded: null, lcc_connection: null, salesforce_connection: null, public_record_sources: [], costar_reviewed: false, rca_reviewed: false, notes: null },
    });
  }
  candidates.sort((a, b) => a.candidate_fingerprint.localeCompare(b.candidate_fingerprint));
  crosswalk.sort((a, b) => a.candidate_fingerprint.localeCompare(b.candidate_fingerprint));
  const counts = new Map();
  for (const candidate of candidates) {
    const name = `${candidate.region}__${candidate.corroboration_tier}__${candidate.operator_footprint_proxy}`;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const allocated = allocateHamilton([...counts].map(([name, eligible]) => ({ name, eligible })), sampleSize);
  const cells = allocated.map(({ name, quota }) => {
    const [region, corroborationTier, footprint] = name.split('__');
    return { name, quota, all: [{ field: 'region', in: [region] }, { field: 'corroboration_tier', in: [corroborationTier] }, { field: 'operator_footprint_proxy', in: [footprint] }] };
  });
  const contract = { contract_version: REVIEW_CONTRACT_VERSION, lane: 'asc', release_id: releaseId, sample_size: 50, seed: `official-asc:${releaseId}:national-property-review-v1`, allocation_method: 'hamilton_proportional_without_replacement', cells };
  const receipt = {
    receipt_version: OFFICIAL_ASC_CANDIDATE_PACK_VERSION, lane: 'asc', packet_id: packet.packet_id, release_id: releaseId,
    eligible_candidate_count: candidates.length,
    stratum_counts: Object.fromEntries([...counts].sort()),
    cell_quotas: Object.fromEntries(cells.map((cell) => [cell.name, cell.quota])),
    candidate_pool_fingerprint: sha256(canonicalJson(candidates.map((row) => row.candidate_fingerprint))),
    controls: { certified_pos_only: true, terminated_excluded: true, sample_size: 50, candidate_files_private: true, manual_property_research_required: true, database_write_authorized: false, production_write_authorized: false, outreach_authorized: false, idtf_activated: false },
    privacy: { classification: 'aggregate_only', record_level_identifiers_emitted: false },
  };
  return { candidates, crosswalk, contract, receipt };
}

export function serializeOfficialAscCandidatePackReceipt(receipt) {
  return `${canonicalJson(receipt)}\n`;
}
