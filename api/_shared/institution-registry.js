// api/_shared/institution-registry.js
// ============================================================================
// ORE Tier A — institution-contacts registry: resolve owner SPE → sponsor
// institution → curated contact, and ATTACH it (fanning ONE contact across the
// sponsor's whole SPE portfolio).
// ----------------------------------------------------------------------------
// Grounded live 2026-07-15: the high-value contactless owner ENTITY is an
// asset-named SPE shell, but the property's true_owner_name already carries the
// real SPONSOR institution (Brandywine / Korea Investment / Hana / Hyundai /
// Blackstone / Gardner Tannenbaum …). The missing piece was a CONTACT for the
// institution. A single curated contact resolves every one of that sponsor's
// contactless SPEs — the highest-leverage, most-accurate acquisition lever.
//
// Reuse (never fork): ensureEntityLink (person mint + guards), the contact-attach
// helpers (linkPersonToEntity, stampContactOnActiveCadence → maybeSeedValuableCadence).
// Reversible — every attach is a person entity + an `associated_with` relationship
// (metadata.via='institution_registry:<sponsor_norm>') + the pivot pointer.
// NEVER fabricates a contact — it only attaches what a human curated in
// lcc_institution_contacts. LCC-Opps only.
// ============================================================================

import { pgFilterVal } from './ops-db.js';

export const INSTITUTION_VIA_PREFIX = 'institution_registry';

/**
 * JS mirror of the SQL `lcc_institution_norm` — lowercase, collapse every
 * non-alnum run to a single space, trim. The sponsor-institution match key.
 * Pure.
 */
export function normalizeInstitution(name) {
  if (typeof name !== 'string') return null;
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return n || null;
}

/**
 * Route an owner by archetype (Unit 4). Pure — used by the reconcile router.
 *   institutional + has-contact  → institution_registry (attach the sponsor's contact)
 *   institutional + no-contact    → resolve_parent_then_registry (add the contact)
 *   local                         → fetch_public_records (terminal owner, SOS/deed/address)
 * @param archetype 'institutional' | 'local'
 * @param hasInstitutionContact boolean
 */
export function routeFromArchetype(archetype, hasInstitutionContact) {
  if (archetype === 'institutional') {
    return hasInstitutionContact ? 'institution_registry' : 'resolve_parent_then_registry';
  }
  return 'fetch_public_records';
}

/**
 * Attach ONE registry contact to ONE contactless owner SPE. `row` comes from
 * v_institution_contact_attachable (carries the resolved contact inline, so no
 * per-row RPC). Steps, all reused:
 *   1. ensureEntityLink the person (guards; deduped by canonical_name — so the
 *      SAME sponsor contact minted once fans out across every sibling SPE),
 *      seeded with the curated title/email/phone.
 *   2. linkPersonToEntity (person → owner SPE, associated_with) — makes the owner
 *      connected/reachable. metadata.via = 'institution_registry:<sponsor_norm>'.
 *   3. stampContactOnActiveCadence(onlyContactless, seedIfValuable) — fills a
 *      contactless cadence or seeds a value-gated prospecting cadence so the
 *      freshly-contacted high-value owner becomes workable outreach.
 *   4. ensure the pivot + point active_contact_* at the new contact (the
 *      CONTACT-SELECTION surface).
 *
 * Defense-in-depth: the curated contact name is still run through the person
 * guard (a firm name mistakenly entered is rejected). Returns a granular outcome.
 *
 * deps: { ensureEntityLink, linkPersonToEntity, stampContactOnActiveCadence,
 *         opsQuery, looksLikePersonName }
 */
export async function attachInstitutionContactToOwner(row, deps) {
  const looksPerson = deps.looksLikePersonName;
  const contactName = (row.contact_name || '').trim();
  if (!contactName || (looksPerson && !looksPerson(contactName))) {
    return { entity_id: row.entity_id, outcome: 'guard_rejected', reason: 'contact_not_person' };
  }
  const via = INSTITUTION_VIA_PREFIX + ':' + (row.sponsor_norm || 'unknown');

  const seedFields = { name: contactName, entity_type: 'person', domain: 'lcc' };
  if (row.contact_email) seedFields.email = row.contact_email;
  if (row.contact_phone) seedFields.phone = row.contact_phone;
  if (row.contact_title) seedFields.title = row.contact_title;

  const link = await deps.ensureEntityLink({
    workspaceId: row.workspace_id, sourceType: 'person', domain: 'lcc', seedFields,
  });
  if (!link || !link.ok || !link.entityId) {
    return { entity_id: row.entity_id, outcome: 'guard_rejected',
      reason: (link && (link.skipped || link.error)) || 'no_entity' };
  }
  const contactEntityId = link.entityId;

  const linkRes = await deps.linkPersonToEntity({
    workspaceId: row.workspace_id, entityId: row.entity_id, contactEntityId,
    role: 'institution_decision_maker', via,
  });
  if (linkRes && linkRes.ok === false && !linkRes.existed) {
    return { entity_id: row.entity_id, outcome: 'link_failed', contact_entity_id: contactEntityId,
      reason: linkRes.skipped || linkRes.detail || 'link_failed' };
  }

  // Fill a contactless cadence, or seed one for a value-floor owner (the wire to
  // the value-ranked outreach surface). Never clobbers an existing contact.
  const stamp = await deps.stampContactOnActiveCadence({
    entityId: row.entity_id, contactEntityId, onlyContactless: true, seedIfValuable: true,
  });

  // Ensure + point the CONTACT-SELECTION pivot (best-effort — the link above is
  // the authoritative "connected" signal; a missing pivot never fails the attach).
  try { await deps.opsQuery('POST', 'rpc/lcc_ensure_owner_pivot', { p_entity_id: row.entity_id }); } catch (_e) { /* soft */ }
  await deps.opsQuery('PATCH', 'owner_contact_pivot?entity_id=eq.' + pgFilterVal(row.entity_id),
    { active_contact_entity_id: contactEntityId, active_contact_name: contactName,
      active_source: via, updated_at: new Date().toISOString() });

  return {
    entity_id: row.entity_id, outcome: 'attached',
    contact_entity_id: contactEntityId, contact_name: contactName,
    institution_name: row.institution_name || null, sponsor_norm: row.sponsor_norm || null,
    registry_contact_id: row.registry_contact_id || null,
    cadence_seeded: !!(stamp && stamp.seeded),
  };
}
