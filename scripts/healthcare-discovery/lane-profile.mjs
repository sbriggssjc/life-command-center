import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'csv-parse/sync';

import { validateLaneManifestFile } from './lane-manifest.mjs';
import { resolvePrivateSourcePath } from './manifest.mjs';
import { canonicalJson } from './nppes.mjs';

const RECEIPT_VERSION = 'healthcare_lane_profile:1.0';
const BROKERAGE_GATES = Object.freeze({
  property_form: 'not_evaluated',
  landlord_addressability: 'not_evaluated',
  facility_economics: 'not_evaluated',
  research_cost: 'not_evaluated',
});

function clean(value) {
  return String(value ?? '').normalize('NFKC').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function readSources(manifestPath, manifest, options) {
  const result = new Map();
  let totalRows = 0;
  for (const source of manifest.sources) {
    const sourcePath = resolvePrivateSourcePath(manifestPath, source.object_path, options);
    const rows = parse(await readFile(sourcePath), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: false, trim: true });
    totalRows += rows.length;
    if (totalRows > manifest.limits.max_rows) throw new Error('Lane profile exceeds max_rows');
    result.set(source.source_key, rows);
  }
  return { sources: result, totalRows };
}

function percentage(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function profileAsc(sources) {
  const facilities = sources.get('cms_pos_asc');
  const quality = new Set(sources.get('cms_ascqr_facility').map((row) => clean(row.certification_number)));
  const enrollmentAddresses = new Set(sources.get('cms_ffs_enrollment')
    .filter((row) => clean(row.enrollment_status) === 'APPROVED')
    .map((row) => clean(row.practice_address)));
  const paymentRows = sources.get('cms_asc_payment');
  const statusCounts = {};
  let active = 0;
  let qualityMatched = 0;
  let enrollmentMatched = 0;
  let discoveryEligible = 0;
  for (const row of facilities) {
    const status = clean(row.status).toLowerCase() || 'unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    const isActive = status === 'active';
    const hasQuality = quality.has(clean(row.certification_number));
    const hasEnrollment = enrollmentAddresses.has(clean(row.address));
    active += Number(isActive);
    qualityMatched += Number(hasQuality);
    enrollmentMatched += Number(hasEnrollment);
    discoveryEligible += Number(isActive && (hasQuality || hasEnrollment));
  }
  return {
    candidate_counts: { facility_seed: facilities.length, discovery_eligible: discoveryEligible, discovery_excluded: facilities.length - discoveryEligible },
    classification_counts: { facility_status: statusCounts },
    coverage: {
      active: percentage(active, facilities.length),
      quality_corroborated: percentage(qualityMatched, facilities.length),
      enrollment_address_matched: percentage(enrollmentMatched, facilities.length),
      payment_reference_present: paymentRows.length > 0,
    },
  };
}

function profileIdtf(sources, manifest) {
  const enrollment = sources.get('cms_ffs_enrollment_idtf');
  const nppesByNpiAddress = new Set(sources.get('cms_nppes_org_location').map((row) => `${clean(row.npi)}:${clean(row.practice_address)}`));
  const utilization = sources.get('cms_physician_supplier_utilization');
  const utilizationNpis = new Set(utilization.map((row) => clean(row.npi)));
  const unsuppressedNpis = new Set(utilization.filter((row) => clean(row.suppressed) !== 'TRUE').map((row) => clean(row.npi)));
  const excluded = new Set(manifest.site_form_rules.excluded_forms.map(clean));
  const siteForm = { fixed_site_confirmed: 0, fixed_site_unproven: 0, excluded: 0 };
  const exclusionReasons = {};
  let nppesMatched = 0;
  let utilizationMatched = 0;
  let unsuppressedMatched = 0;
  for (const row of enrollment) {
    const form = clean(row.location_type);
    if (form === 'FIXED') siteForm.fixed_site_confirmed += 1;
    else if (excluded.has(form)) {
      siteForm.excluded += 1;
      const reason = String(row.location_type).trim().toLowerCase();
      exclusionReasons[reason] = (exclusionReasons[reason] || 0) + 1;
    } else siteForm.fixed_site_unproven += 1;
    const npi = clean(row.npi);
    nppesMatched += Number(nppesByNpiAddress.has(`${npi}:${clean(row.practice_address)}`));
    utilizationMatched += Number(utilizationNpis.has(npi));
    unsuppressedMatched += Number(unsuppressedNpis.has(npi));
  }
  return {
    candidate_counts: { supplier_locations: enrollment.length, discovery_eligible: siteForm.fixed_site_confirmed, discovery_unproven: siteForm.fixed_site_unproven, discovery_excluded: siteForm.excluded },
    classification_counts: { site_form: siteForm, exclusion_reason: exclusionReasons },
    coverage: {
      nppes_address_matched: percentage(nppesMatched, enrollment.length),
      utilization_observed: percentage(utilizationMatched, enrollment.length),
      unsuppressed_utilization: percentage(unsuppressedMatched, enrollment.length),
      payment_reference_present: sources.get('cms_pfs_reference').length > 0,
    },
  };
}

export async function profileHealthcareLane(manifestPath, options = {}) {
  const validation = await validateLaneManifestFile(manifestPath, options);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const { sources, totalRows } = await readSources(manifestPath, manifest, options);
  const laneProfile = manifest.lane === 'asc' ? profileAsc(sources) : profileIdtf(sources, manifest);
  const candidateCount = laneProfile.candidate_counts.facility_seed ?? laneProfile.candidate_counts.supplier_locations;
  if (candidateCount > manifest.limits.max_candidate_fingerprints) throw new Error('Lane profile exceeds max_candidate_fingerprints');
  return {
    receipt_version: RECEIPT_VERSION,
    lane: manifest.lane,
    release_id: validation.release_id,
    source_validation: validation.status,
    parsed_rows: totalRows,
    ...laneProfile,
    brokerage_gates: BROKERAGE_GATES,
    decision: 'source_profile_only',
    next_gate: 'authorized_stratified_property_review',
    privacy: { classification: 'aggregate_only', record_level_identifiers_emitted: false },
  };
}

export function serializeLaneProfile(receipt) {
  return canonicalJson(receipt);
}

export async function runLaneProfile(manifestPath, outputPath, options = {}) {
  const receipt = await profileHealthcareLane(manifestPath, options);
  const destination = path.resolve(outputPath);
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, serializeLaneProfile(receipt), { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, destination);
  return receipt;
}
