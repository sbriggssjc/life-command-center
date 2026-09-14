// ============================================================================
// Public-records manual-capture writeback (PR-scanner, 2026-09-10)
// Life Command Center
// ----------------------------------------------------------------------------
// The Chrome extension's sidepanel "Scan This Page" flow
// (extension/content/public-records.js) classifies an open county
// assessor / recorder / Secretary-of-State page and extracts structured
// fields. Until this module the sidepanel discarded everything except a
// name + description string on save (see extension/sidepanel.js loadOrgView
// / saveOrgBtn) — every assessed value, deed party address and SOS officer
// the scanner found was thrown away.
//
// This is a HUMAN-TRIGGERED, one-shot writeback (the operator clicks Save
// after reviewing the editable form) — there is no crawler, no polling, no
// autonomous fetch anywhere in this file.
//
// Source tag discipline (docs/architecture/public-records-source-lane.md §2a,
// §7): this capture is tagged 'assessor_sidebar_manual' / 'recorder_sidebar_
// manual' / 'sos_sidebar_manual' — DISTINCT from both `costar_sidebar` (the
// automated CoStar Public-Record-tab scrape in sidebar-pipeline.js) and the
// gpt-4o recall leg in Dialysis/GovernmentProject `public_record_ingest.py`
// (`acquisition_class='ai_gpt4o_presumed'`). Retiring or re-grading the
// gpt-4o leg is a separate decision (PR11) and is explicitly out of scope
// here — this module never touches that source's rungs or rows.
//
// Doctrine followed throughout (CLAUDE.md "Data-write discipline"):
//   fill-blanks-only · conservative/unambiguous · provenance-tagged ·
//   reversible (no hard-delete; a bad row can be identified by source tag +
//   fetched_at and cleaned up) · idempotent (data_hash / dedup keys) ·
//   never fabricate (a field the scan didn't find stays absent).
// ============================================================================

import { domainQuery } from './domain-db.js';
import { filterByFieldPriority } from './field-priority-guard.js';
import { buildDeedDataHash, validateDeedIngest } from './ingest-contract.js';
import { opsQuery } from './ops-db.js';
import { insertEntityRelationship, resolvePrimaryWorkspaceId } from './ops-db.js';
import { ensureEntityLink } from './entity-link.js';
import { looksLikePersonName, isImplausiblePersonName, isJunkEntityName } from './entity-link.js';
import { classifyReverseAddress } from './address-reverse.js';

export const ASSESSOR_SOURCE = 'assessor_sidebar_manual';
export const RECORDER_SOURCE = 'recorder_sidebar_manual';
export const SOS_SOURCE = 'sos_sidebar_manual';

// ── shared small helpers (self-contained — sidebar-pipeline.js's equivalents
//    are module-private, so these are re-implemented to the same rules rather
//    than imported; see the module header) ──────────────────────────────────

export function parseCurrency(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const s = String(val).replace(/[$,\s]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function parseIntSafe(val) {
  if (val == null || val === '') return null;
  const n = parseInt(String(val).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// Lot size may arrive as "3.2 acres" or a bare square footage. Same intent
// as PR2's I12 lesson (a key whose contents mix units does not carry a
// unit) — record what we can, never guess which unit an unlabeled number is.
export function parseLotSf(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const acreMatch = s.match(/([\d.]+)\s*ac(?:res?)?\b/i);
  if (acreMatch) {
    const acres = parseFloat(acreMatch[1]);
    return Number.isFinite(acres) ? Math.round(acres * 43560) : null;
  }
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function stripNulls(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

export function blankFieldsOnly(existingRow, offered) {
  const out = {};
  if (!offered || !existingRow) return offered || {};
  for (const [k, v] of Object.entries(offered)) {
    if (v == null || v === '') continue;
    if (existingRow[k] == null || existingRow[k] === '') out[k] = v;
  }
  return out;
}

async function linkPublicRecord(domain, propertyId, recordType, recordId, q) {
  const dq = q || domainQuery;
  if (!propertyId || !recordId) return { ok: false, reason: 'missing_ids' };
  try {
    const existing = await dq(domain, 'GET',
      `property_public_records?property_id=eq.${propertyId}` +
      `&record_type=eq.${encodeURIComponent(recordType)}` +
      `&record_id=eq.${encodeURIComponent(recordId)}&select=id&limit=1`);
    if (existing.ok && existing.data?.length) return { ok: true, already: true };
    const r = await dq(domain, 'POST', 'property_public_records', {
      property_id: propertyId, record_type: recordType, record_id: recordId,
    });
    return { ok: !!r.ok, status: r.status };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

// ============================================================================
// UNIT 1a — assessor scan → parcel_records + tax_records
// ============================================================================

/**
 * @param {string} domain - 'government' | 'dialysis'
 * @param {string|number} propertyId - the resolved domain property (required
 *   — an assessor capture with no resolved property has nowhere to file, so
 *   the caller must resolve/match a property before calling this)
 * @param {object} capture - the raw scanAssessor() payload (see
 *   extension/content/public-records.js) as edited by the operator
 * @param {object} [opts] - { sourceUrl, entityState }
 * @returns {Promise<{ok:boolean, parcel:object|null, tax:object|null, errors:string[]}>}
 */
export async function applyAssessorCapture(domain, propertyId, capture, opts = {}, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  const filterFP = deps.filterByFieldPriority || filterByFieldPriority;
  const errors = [];
  const out = { ok: false, parcel: null, tax: null, errors };
  if (!propertyId) { errors.push('missing_property_id'); return out; }
  const apn = capture && capture.parcel_number ? String(capture.parcel_number).trim() : null;
  if (!apn) { errors.push('missing_parcel_number'); return out; }

  const state = opts.entityState || capture.state || null;
  const county = capture.county || null;
  const landVal = parseCurrency(capture.land_value);
  const impVal = parseCurrency(capture.improvement_value);
  const assessed = parseCurrency(capture.assessed_value) || (landVal && impVal ? landVal + impVal : null);
  const taxAmount = parseCurrency(capture.tax_amount);
  const yearBuilt = parseIntSafe(capture.year_built);
  const buildingSf = parseIntSafe(capture.square_footage);
  const lotSf = parseLotSf(capture.lot_size);
  const zoning = capture.zoning ? String(capture.zoning).slice(0, 100) : null;
  const landUse = capture.property_type ? String(capture.property_type).slice(0, 200) : null;
  // ⚠️ owner_name is the county's ASSERTION of who owns the parcel — never
  // fill it from the property record we already hold (the gov ORE Phase A1
  // "echo" defect this repo has already paid for). It rides straight through
  // from the scan, unmodified, or not at all.
  const ownerName = capture.owner_name ? String(capture.owner_name).slice(0, 300) : null;
  const mailingAddress = capture.mailing_address ? String(capture.mailing_address).slice(0, 500) : null;
  const taxYear = new Date().getFullYear();
  const fetchedAt = new Date().toISOString();
  const sourceUrl = opts.sourceUrl || null;

  // ── parcel_records ─────────────────────────────────────────────────────
  if (domain === 'dialysis') {
    const lookup = await q('dialysis', 'GET',
      `parcel_records?apn=eq.${encodeURIComponent(apn)}` +
      `&select=id,building_sf,lot_sf,year_built,zoning,land_use,owner_name,assessed_value&limit=1`);
    if (!lookup.ok) { errors.push(`parcel_lookup_failed:${lookup.status}`); }
    else if (!lookup.data?.length) {
      const dataHash = Buffer.from(`parcel|${apn}|${state || ''}|manual`).toString('base64');
      const row = stripNulls({
        apn, county, state,
        assessed_value: assessed,
        building_sf: buildingSf, lot_sf: lotSf, year_built: yearBuilt,
        zoning, land_use: landUse, owner_name: ownerName,
        raw_payload: { source: ASSESSOR_SOURCE, property_id: propertyId, source_url: sourceUrl, mailing_address: mailingAddress },
        fetched_at: fetchedAt, data_hash: dataHash,
      });
      row.data_hash = dataHash;
      const r = await q('dialysis', 'POST', 'parcel_records', row);
      if (r.ok) {
        const created = Array.isArray(r.data) ? r.data[0] : r.data;
        out.parcel = { id: created?.id, op: 'insert' };
        if (created?.id) await linkPublicRecord('dialysis', propertyId, 'parcel', created.id, q);
      } else errors.push(`parcel_insert_failed:${r.status}`);
    } else {
      const existingId = lookup.data[0].id;
      const blanks = blankFieldsOnly(lookup.data[0], {
        building_sf: buildingSf, lot_sf: lotSf, year_built: yearBuilt,
        zoning, land_use: landUse, owner_name: ownerName, assessed_value: assessed,
      });
      const filtered = await filterFP({
        targetDb: 'dia_db', targetTable: 'dia.parcel_records', recordPk: existingId,
        source: ASSESSOR_SOURCE, confidence: 0.75, fields: stripNulls(blanks),
      }).catch(() => stripNulls(blanks));
      if (filtered && Object.keys(filtered).length) {
        const r = await q('dialysis', 'PATCH', `parcel_records?id=eq.${existingId}`, filtered);
        if (!r.ok) errors.push(`parcel_patch_failed:${r.status}`);
      }
      out.parcel = { id: existingId, op: 'patch' };
      await linkPublicRecord('dialysis', propertyId, 'parcel', existingId, q);
    }
  } else if (domain === 'government') {
    const lookup = await q('government', 'GET',
      `parcel_records?apn=eq.${encodeURIComponent(apn)}` +
      `&select=parcel_id,building_sf,year_built,zoning,property_class,owner_name,total_assessed_value&limit=1`);
    if (!lookup.ok) { errors.push(`parcel_lookup_failed:${lookup.status}`); }
    else if (!lookup.data?.length) {
      const dataHash = Buffer.from(`parcel|${apn}|${state || ''}|manual`).toString('base64');
      const row = stripNulls({
        apn, county: county || 'Unknown', state_code: state || 'XX',
        land_value: landVal, improvement_value: impVal, total_assessed_value: assessed,
        assessment_year: taxYear, situs_address: capture.address || null,
        building_sf: buildingSf, land_area_sf: lotSf, year_built: yearBuilt,
        zoning, property_class: landUse, owner_name: ownerName,
        raw_payload: { source: ASSESSOR_SOURCE, property_id: propertyId, source_url: sourceUrl, mailing_address: mailingAddress },
        fetched_at: fetchedAt, data_hash: dataHash,
      });
      const r = await q('government', 'POST', 'parcel_records', row);
      if (r.ok) {
        const created = Array.isArray(r.data) ? r.data[0] : r.data;
        out.parcel = { id: created?.parcel_id, op: 'insert' };
        if (created?.parcel_id) await linkPublicRecord('government', propertyId, 'parcel', created.parcel_id, q);
      } else errors.push(`parcel_insert_failed:${r.status}`);
    } else {
      const existingId = lookup.data[0].parcel_id;
      const blanks = blankFieldsOnly(lookup.data[0], {
        building_sf: buildingSf, year_built: yearBuilt, zoning,
        property_class: landUse, owner_name: ownerName, total_assessed_value: assessed,
      });
      const filtered = await filterFP({
        targetDb: 'gov_db', targetTable: 'gov.parcel_records', recordPk: existingId,
        source: ASSESSOR_SOURCE, confidence: 0.75, fields: stripNulls(blanks),
      }).catch(() => stripNulls(blanks));
      if (filtered && Object.keys(filtered).length) {
        const r = await q('government', 'PATCH', `parcel_records?parcel_id=eq.${existingId}`, filtered);
        if (!r.ok) errors.push(`parcel_patch_failed:${r.status}`);
      }
      out.parcel = { id: existingId, op: 'patch' };
      await linkPublicRecord('government', propertyId, 'parcel', existingId, q);
    }
  } else {
    errors.push('unknown_domain');
    return out;
  }

  // ── tax_records — fill-blanks, only ever the CURRENT-year tax_amount, per
  //    PR2's rule that stamping one figure across a multi-year assessment
  //    row manufactures history ─────────────────────────────────────────────
  if (assessed || taxAmount) {
    if (domain === 'dialysis') {
      const taxHash = Buffer.from(`tax|${apn}|${taxYear}|manual`).toString('base64');
      const taxLookup = await q('dialysis', 'GET',
        `tax_records?apn=eq.${encodeURIComponent(apn)}&tax_year=eq.${taxYear}&select=id,tax_amount,assessed_value&limit=1`);
      if (taxLookup.ok && !taxLookup.data?.length) {
        const row = stripNulls({
          apn, county, state, tax_year: taxYear, assessed_value: assessed,
          tax_amount: taxAmount,
          raw_payload: { source: ASSESSOR_SOURCE, land_value: landVal, improvement_value: impVal },
          fetched_at: fetchedAt, data_hash: taxHash,
        });
        row.data_hash = taxHash;
        const r = await q('dialysis', 'POST', 'tax_records', row);
        if (r.ok) {
          const created = Array.isArray(r.data) ? r.data[0] : r.data;
          out.tax = { id: created?.id, op: 'insert' };
          if (created?.id) await linkPublicRecord('dialysis', propertyId, 'tax', created.id, q);
        } else errors.push(`tax_insert_failed:${r.status}`);
      } else if (taxLookup.ok) {
        const existingId = taxLookup.data[0].id;
        const blanks = blankFieldsOnly(taxLookup.data[0], { tax_amount: taxAmount, assessed_value: assessed });
        if (Object.keys(blanks).length) {
          const r = await q('dialysis', 'PATCH', `tax_records?id=eq.${existingId}`, blanks);
          if (!r.ok) errors.push(`tax_patch_failed:${r.status}`);
        }
        out.tax = { id: existingId, op: 'patch' };
      }
    } else if (domain === 'government') {
      const taxHash = Buffer.from(`tax|${apn}|${taxYear}|manual`).toString('base64');
      const taxLookup = await q('government', 'GET',
        `tax_records?apn=eq.${encodeURIComponent(apn)}&tax_year=eq.${taxYear}&select=id,tax_amount,assessed_value&limit=1`);
      if (taxLookup.ok && !taxLookup.data?.length) {
        const row = stripNulls({
          apn, county: county || 'Unknown', state_code: state || 'XX', tax_year: taxYear,
          assessed_value: assessed, tax_amount: taxAmount,
          raw_payload: { source: ASSESSOR_SOURCE },
          fetched_at: fetchedAt, data_hash: taxHash,
        });
        const r = await q('government', 'POST', 'tax_records', row);
        if (r.ok) {
          const created = Array.isArray(r.data) ? r.data[0] : r.data;
          out.tax = { id: created?.id, op: 'insert' };
          if (created?.id) await linkPublicRecord('government', propertyId, 'tax', created.id, q);
        } else errors.push(`tax_insert_failed:${r.status}`);
      } else if (taxLookup.ok) {
        const existingId = taxLookup.data[0]?.id;
        if (existingId) {
          const blanks = blankFieldsOnly(taxLookup.data[0], { tax_amount: taxAmount, assessed_value: assessed });
          if (Object.keys(blanks).length) {
            const r = await q('government', 'PATCH', `tax_records?id=eq.${existingId}`, blanks);
            if (!r.ok) errors.push(`tax_patch_failed:${r.status}`);
          }
          out.tax = { id: existingId, op: 'patch' };
        }
      }
    }
  }

  out.ok = errors.length === 0 && (out.parcel != null || out.tax != null);
  return out;
}

// ============================================================================
// UNIT 1b — recorder scan → deed_records
// (extends the existing dedup/DTO/hash pattern from
//  api/_handlers/deed-parser.js::processDeedDocument rather than forking a
//  second insert shape — reuses buildDeedDataHash + validateDeedIngest.)
// ============================================================================

/**
 * @param {string} domain - 'government' | 'dialysis'
 * @param {string|number} propertyId
 * @param {object} capture - scanRecorder() payload as edited by the operator
 * @param {object} [opts] - { sourceUrl, entityState }
 */
export async function applyRecorderCapture(domain, propertyId, capture, opts = {}, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  const errors = [];
  const out = { ok: false, deed: null, errors };
  if (!propertyId) { errors.push('missing_property_id'); return out; }

  const docNumber = capture.book_page ? String(capture.book_page).trim() : null;
  if (!docNumber && !capture.grantor && !capture.grantee) {
    errors.push('no_meaningful_fields');
    return out;
  }

  const state = opts.entityState || capture.state || null;
  const county = capture.county || null;
  // recording_date best-effort parse (the scan sends free text; the deed
  // parser's own parseRecordingDate is not exported, so a conservative
  // Date() parse is used here — a value that doesn't parse is left absent
  // rather than guessed).
  let recordingDate = null;
  if (capture.sale_date) {
    const d = new Date(capture.sale_date);
    if (!isNaN(d.getTime())) recordingDate = d.toISOString().slice(0, 10);
  }
  const consideration = parseCurrency(capture.sale_price);
  const stateCol = domain === 'government' ? 'state_code' : 'state';

  const dataHash = docNumber
    ? buildDeedDataHash(docNumber, state || '', recordingDate || '')
    : Buffer.from(`deed|${capture.grantor || ''}|${capture.grantee || ''}|${recordingDate || ''}|manual`).toString('base64');

  const dto = stripNulls({
    domain: domain === 'government' ? 'government' : 'dialysis',
    property_id: domain === 'government' ? undefined : propertyId,
    document_number: docNumber,
    [stateCol]: state,
    county,
    recording_date: recordingDate,
    deed_type: capture.document_type || null,
    grantor: capture.grantor || null,
    grantee: capture.grantee || null,
    consideration,
    data_hash: dataHash,
    data_source: RECORDER_SOURCE,
    raw_payload: { source: RECORDER_SOURCE, capture, source_url: opts.sourceUrl || null },
  });

  const { ok: dtoOk, errors: dtoErrors } = validateDeedIngest(dto);
  const hardErrors = (dtoErrors || []).filter((e) =>
    e.includes('data_hash must be >=') || e.includes('require property_id'));
  if (!dtoOk && hardErrors.length) {
    errors.push(...hardErrors);
    return out;
  }

  const deedPk = domain === 'government' ? 'deed_id' : 'id';
  const existing = await q(domain, 'GET',
    `deed_records?data_hash=eq.${encodeURIComponent(dataHash)}&select=${deedPk}&limit=1`);
  if (!existing.ok) { errors.push(`deed_lookup_failed:${existing.status}`); return out; }
  if (existing.data?.length) {
    out.deed = { id: existing.data[0][deedPk], op: 'already_present' };
    out.ok = true;
    return out;
  }

  const row = {};
  if (domain !== 'government') row.property_id = propertyId;
  row.document_number = dto.document_number;
  row.deed_type = dto.deed_type;
  row.grantor = dto.grantor;
  row.grantee = dto.grantee;
  row.recording_date = dto.recording_date;
  row.consideration = dto.consideration;
  row.county = dto.county;
  row[stateCol] = state || null;
  // ORE Phase 1 Unit C parity: keep the (edited-by-operator) party addresses
  // if the scanner's recorder page happened to carry them under a label the
  // operator filled in — scanRecorder() today doesn't extract them, so these
  // are almost always absent; left wired for when a page does show them.
  row.grantor_address = capture.grantor_address || null;
  row.grantee_address = capture.grantee_address || null;
  row.data_hash = dataHash;
  row.raw_payload = dto.raw_payload;
  const cleaned = stripNulls(row);
  cleaned.data_hash = dataHash;

  const r = await q(domain, 'POST', 'deed_records', cleaned, { 'Prefer': 'return=representation' });
  if (r.ok && r.data?.[0]) {
    const created = r.data[0];
    out.deed = { id: created[deedPk], op: 'insert' };
    if (created[deedPk]) await linkPublicRecord(domain, propertyId, 'deed', created[deedPk], q);
    out.ok = true;
  } else {
    errors.push(`deed_insert_failed:${r.status}`);
  }
  return out;
}

// ============================================================================
// UNIT 1c — SOS scan (incl. CA bizfile) → llc_member / llc_manager
// entity_relationships edges in LCC Opps
// ============================================================================

// "John Smith, Manager; Jane Doe, Member" -> [{name, role}]
// Mirrors api/admin.js::parseSosOfficer's shape but returns EVERY party
// (parseSosOfficer takes only the first) since an SOS filing can list
// several officers/members and the task asks for edges per officer.
export function parseSosOfficers(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const parts = raw.split(/[;\n]|(?:,\s*(?:and|&)\s*)/i).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    const m = part.match(/^(.+?)\s*[,\-–—]\s*([A-Za-z][A-Za-z /]+)$/);
    if (m) {
      const role = m[2].trim();
      if (/manager|member|president|ceo|director|officer|principal|partner|owner|registered agent|secretary|treasurer/i.test(role)) {
        out.push({ name: m[1].trim().slice(0, 200), role: role.slice(0, 100) });
        continue;
      }
    }
    out.push({ name: part.slice(0, 200), role: null });
  }
  return out;
}

export function edgeTypeForRole(role) {
  if (role && /manager|president|ceo|director|officer/i.test(role)) return 'llc_manager';
  return 'llc_member'; // member / owner / partner / unspecified
}

// A short, deterministic external_id for a person minted purely from an SOS
// capture (no other identity system knows this party yet) — keeps repeated
// captures of the same officer idempotent instead of minting a duplicate
// person entity every time the operator re-scans the page.
export function sosPersonExternalId(orgName, personName) {
  const key = `${orgName || ''}|${personName || ''}`.toLowerCase().trim();
  return 'sos:' + Buffer.from(key).toString('base64').replace(/=+$/, '');
}

/**
 * @param {object} capture - scanSOS() / bizfile mapBizfileFields() payload:
 *   { name, filing_number, formation_date, status, entity_type_detail,
 *     state_of_formation, registered_agent, agent_address, principal_address,
 *     officers }
 * @param {object} [opts] - { workspaceId, ownerEntityId, sourceUrl }
 * @returns {Promise<{ok:boolean, orgEntityId:string|null, edges:object[], errors:string[]}>}
 */
export async function applySosEntityCapture(capture, opts = {}, deps = {}) {
  const eel = deps.ensureEntityLink || ensureEntityLink;
  const ier = deps.insertEntityRelationship || insertEntityRelationship;
  const rpw = deps.resolvePrimaryWorkspaceId || resolvePrimaryWorkspaceId;
  const cra = deps.classifyReverseAddress || classifyReverseAddress;
  const patchAddr = deps.patchEntityAddress || domainAgnosticPatchEntityAddress;
  const errors = [];
  const out = { ok: false, orgEntityId: null, edges: [], errors };
  const orgName = capture && capture.name ? String(capture.name).trim() : null;
  if (!orgName) { errors.push('missing_org_name'); return out; }
  if (isJunkEntityName(orgName)) { errors.push('org_name_junk'); return out; }

  const workspaceId = opts.workspaceId || await rpw();
  if (!workspaceId) { errors.push('no_workspace'); return out; }

  // ── the LLC/org entity itself — resolve by an existing owner link if the
  // caller has one, else resolve-or-mint by name via the SAME choke point
  // every other writer in this repo uses (ensureEntityLink). ────────────────
  let orgEntityId = opts.ownerEntityId || null;
  if (!orgEntityId) {
    const link = await eel({
      workspaceId,
      sourceSystem: 'sos_sidebar_manual',
      sourceType: 'organization',
      externalId: sosPersonExternalId('org', orgName),
      seedFields: {
        entity_type: 'organization',
        name: orgName,
        domain: 'lcc',
        org_type: capture.entity_type_detail || null,
        state: capture.state_of_formation || null,
      },
      metadata: {
        sos_filing_number: capture.filing_number || null,
        sos_status: capture.status || null,
        sos_formation_date: capture.formation_date || null,
        sos_source: SOS_SOURCE,
        sos_source_url: opts.sourceUrl || null,
      },
    }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    if (!link.ok || !link.entityId) {
      errors.push('org_entity_resolve_failed:' + (link.error || 'unknown'));
      return out;
    }
    orgEntityId = link.entityId;
  }
  out.orgEntityId = orgEntityId;

  // ── registered agent as its own edge (never as a residence — an agent's
  // office is not where the LLC's real people live; see the address gate
  // below, which applies identically to the agent). ─────────────────────────
  const parties = [];
  if (capture.registered_agent) {
    parties.push({ name: capture.registered_agent, role: 'Registered Agent', address: capture.agent_address || null });
  }
  for (const officer of parseSosOfficers(capture.officers)) {
    parties.push({ ...officer, address: capture.principal_address || null });
  }

  for (const party of parties) {
    const personName = party.name ? String(party.name).trim() : '';
    if (!personName) continue;
    if (!looksLikePersonName(personName) || isImplausiblePersonName(personName)) {
      out.edges.push({ name: personName, skipped: 'not_person_shaped' });
      continue;
    }

    const link = await eel({
      workspaceId,
      sourceSystem: 'sos_sidebar_manual',
      sourceType: 'person',
      externalId: sosPersonExternalId(orgName, personName),
      seedFields: { entity_type: 'person', name: personName, domain: 'lcc' },
      metadata: { sos_role: party.role || null, sos_org: orgName, sos_source_url: opts.sourceUrl || null },
    }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    if (!link.ok || !link.entityId) {
      out.edges.push({ name: personName, skipped: 'person_entity_failed:' + (link.error || 'unknown') });
      continue;
    }
    const personEntityId = link.entityId;

    // ⚠️ Residential-vs-agent-service classification (address-reverse.js —
    // NOT re-derived here). A registered-agent SERVICE address (CSC, CT
    // Corporation, Cogency, a law firm, a PO box, "c/o", "Suite …") must
    // NEVER be recorded as a person's residence — it is the agent's office.
    // The edge (llc_member / llc_manager) is written regardless; only the
    // ADDRESS attribution to that specific person is gated.
    let addressAttributed = false;
    if (party.address) {
      const cls = cra(party.address, personName);
      if (cls.eligible) {
        await patchAddr(personEntityId, party.address, workspaceId).catch(() => {});
        addressAttributed = true;
      }
    }

    const edgeType = edgeTypeForRole(party.role);
    const edgeRes = await ier({
      workspace_id: workspaceId,
      from_entity_id: personEntityId,
      to_entity_id: orgEntityId,
      relationship_type: edgeType,
      metadata: {
        role: party.role || null,
        source: SOS_SOURCE,
        source_url: opts.sourceUrl || null,
        address_attributed: addressAttributed,
      },
    });
    out.edges.push({
      name: personName, entityId: personEntityId, edgeType,
      ok: !!edgeRes.ok, skipped: edgeRes.skipped || null,
      address_attributed: addressAttributed,
    });
  }

  out.ok = true; // org resolved is success even if every party was skipped
  return out;
}

// Fill-blanks-only write of a person entity's address, guarded to run ONLY
// after classifyReverseAddress has already said the address is eligible
// (never called for an agent-service address — see applySosEntityCapture).
async function domainAgnosticPatchEntityAddress(entityId, address, workspaceId) {
  const existing = await opsQuery('GET', `entities?id=eq.${entityId}&select=address&limit=1`);
  if (existing.ok && existing.data?.[0] && existing.data[0].address) return { ok: true, already: true };
  return opsQuery('PATCH', `entities?id=eq.${entityId}&workspace_id=eq.${workspaceId}`, {
    address: String(address).slice(0, 500),
  });
}
