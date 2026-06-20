// api/_shared/contact-fields.js
// ============================================================================
// R52 Unit 1 — promote captured contact fields to first-class (+ address)
// ----------------------------------------------------------------------------
// A captured contact's richest fields land on the person entity in a mix of
// places: email/phone are first-class columns, but the firm (`metadata.company`),
// the captured phone list (`metadata.phones`), and any mailing ADDRESS (today
// 0% — sourced from the Salesforce contact pull + county owner records) are NOT
// promoted to the queryable/writable first-class columns. This module promotes
// them, fill-blanks-only, recording per-field provenance so the value can be
// trusted (verified > salesforce > county > capture).
//
// Grounded live 2026-06-20 (LCC Opps): 4,186 persons → 2,045 email / 1,444 phone
// / 0 address; the firm lives in `metadata.company` (791), the phone list in
// `metadata.phones` (791). NOTE: the audit premise "metadata.contacts jsonb" did
// NOT hold on the LCC entity — the captured fields are flat metadata keys
// (company/phones/website), so this reads those, not a `contacts` array.
//
// The core (`planContactFieldPromotion`) is PURE so it unit-tests without IO;
// the DB write wrapper (`promoteContactFields`) injects opsQuery for the PATCH.
// ============================================================================

import { normalizeEmail } from './entity-link.js';

// First-class person columns this module promotes (entities table). `company`
// has NO column — it stays in metadata.company (kept here so a caller can pass a
// company in `incoming` and have it land in the metadata patch).
export const PROMOTABLE_FIRST_CLASS = ['email', 'phone', 'address', 'city', 'state', 'zip'];

// Per-field trust ladder — lower rank = more authoritative. A blank current
// value is always fillable; a present value is only UPGRADED when the incoming
// source outranks the recorded source (so a verified/SF value can correct a
// low-trust capture, but a capture never clobbers a verified value).
const SOURCE_RANK = {
  verified: 1,
  manual: 1,
  salesforce: 2,
  county_records: 3,
  capture: 4,
  sidebar: 4,
  costar: 4,
};
function srcRank(s) {
  const r = SOURCE_RANK[String(s || '').toLowerCase()];
  return Number.isFinite(r) ? r : 4; // unknown source = lowest trust (capture-tier)
}

function cleanStr(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

/**
 * Derive a promotable `incoming` field set from a person entity's EXISTING
 * captured metadata (the backfill direction for already-captured contacts):
 *   metadata.phones[0]  → phone   (when first-class phone is blank)
 *   metadata.company    → company (mirrored to the metadata patch — no column)
 * Email is already first-class; address/city/state/zip have no metadata source
 * today (they come from the SF pull). Returns {} when there's nothing to lift.
 */
export function capturedFieldsFromMetadata(entity) {
  const md = (entity && entity.metadata && typeof entity.metadata === 'object') ? entity.metadata : {};
  const out = {};
  if (Array.isArray(md.phones)) {
    const firstPhone = md.phones.map(cleanStr).find(Boolean);
    if (firstPhone) out.phone = firstPhone;
  }
  const company = cleanStr(md.company);
  if (company) out.company = company;
  return out;
}

/**
 * PURE — plan a fill-blanks(+upgrade) promotion of captured fields onto a person
 * entity. Never clobbers a higher-trust existing value.
 *
 * @param {object} entity   the person entity row (first-class cols + metadata)
 * @param {object} incoming {email,phone,address,city,state,zip,company}
 * @param {string} source   provenance label for `incoming` (verified|salesforce|
 *                          county_records|capture|sidebar|costar)
 * @returns {{changed:boolean, patch:object, fieldSources:object}}
 *          patch carries the first-class column updates AND (when company or any
 *          field-source changed) a fully-merged `metadata` object ready to PATCH.
 */
export function planContactFieldPromotion(entity, incoming = {}, source = 'capture') {
  const ent = entity || {};
  const md = (ent.metadata && typeof ent.metadata === 'object') ? ent.metadata : {};
  const recorded = (md.field_sources && typeof md.field_sources === 'object') ? md.field_sources : {};
  const inRank = srcRank(source);

  const patch = {};
  const fieldSources = {};

  for (const field of PROMOTABLE_FIRST_CLASS) {
    let val = cleanStr(incoming[field]);
    if (!val) continue;
    if (field === 'email') {
      val = normalizeEmail(val);
      if (!val) continue;
    }
    const cur = cleanStr(ent[field]);
    const sameVal = (field === 'email') ? (normalizeEmail(cur) === val) : (cur.toLowerCase() === val.toLowerCase());
    if (cur && sameVal) continue;                       // already correct
    // Fill a blank, or upgrade when the incoming source is more authoritative
    // than the recorded source (a present value with no recorded source is
    // treated as capture-tier, so SF/verified can correct it).
    const allow = !cur || inRank < srcRank(recorded[field]);
    if (!allow) continue;
    patch[field] = val;
    fieldSources[field] = source;
  }

  // company → metadata only (no column). Same rank discipline.
  const companyMetaSources = {};
  const inCompany = cleanStr(incoming.company);
  let companyChanged = false;
  if (inCompany) {
    const curCompany = cleanStr(md.company);
    if (!(curCompany && curCompany.toLowerCase() === inCompany.toLowerCase())) {
      const allow = !curCompany || inRank < srcRank(recorded.company);
      if (allow) { companyChanged = true; companyMetaSources.company = source; }
    }
  }

  const changed = Object.keys(patch).length > 0 || companyChanged;
  if (changed) {
    const newFieldSources = Object.assign({}, recorded, fieldSources, companyMetaSources);
    const newMeta = Object.assign({}, md, { field_sources: newFieldSources });
    if (companyChanged) newMeta.company = inCompany;
    patch.metadata = newMeta;
  }
  return { changed, patch, fieldSources: Object.assign({}, fieldSources, companyMetaSources) };
}

/**
 * Apply planContactFieldPromotion against the DB (fill-blanks PATCH). Injectable
 * deps for tests: { fetchEntity(id)->entity, patchEntity(id,patch)->{ok} }.
 * Returns {ok, changed, fields:[...], detail?}.
 */
export async function promoteContactFields(entityId, { incoming, source = 'capture', entity = null }, deps) {
  if (!entityId) return { ok: false, detail: 'entityId required' };
  const ent = entity || (deps.fetchEntity ? await deps.fetchEntity(entityId) : null);
  if (!ent) return { ok: false, detail: 'entity_not_found' };
  const plan = planContactFieldPromotion(ent, incoming, source);
  if (!plan.changed) return { ok: true, changed: false, fields: [] };
  const upd = await deps.patchEntity(entityId, plan.patch);
  if (!upd || !upd.ok) return { ok: false, changed: false, detail: upd && upd.detail };
  return { ok: true, changed: true, fields: Object.keys(plan.fieldSources) };
}
