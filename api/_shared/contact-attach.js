// api/_shared/contact-attach.js
// ============================================================================
// Shared contact-attach machinery (R16)
// ----------------------------------------------------------------------------
// The single source of truth for the two write steps the prospecting-contact
// flow performs once a person is resolved:
//
//   1. linkPersonToEntity        — person → owner/developer entity edge
//                                  (`associated_with`, dupe-guarded). This is
//                                  what makes the entity "connected" (a real
//                                  human contact in the graph).
//   2. stampCadenceContactById   — write contact_id / sf_contact_id (and an
//                                  optional contact_acquisition metadata mark)
//                                  onto a specific cadence row.
//      stampContactOnActiveCadence — resolve the entity's most-overdue active
//                                  cadence, then stamp it (used by the HTTP
//                                  "select prospecting contact" path, which
//                                  doesn't carry a cadence id).
//
// Both the interactive P-CONTACT picker (operations.js
// bridgeSelectProspectingContact) and the R16 auto-acquisition worker
// (_handlers/contact-acquisition.js) call these, so the link + stamp logic is
// never forked.
// ============================================================================

import { opsQuery, pgFilterVal, insertEntityRelationship } from './ops-db.js';
import { entityHasBdSignal, getCadenceState } from './cadence-engine.js';

// Active cadence phases — the ones the priority queue treats as a live next
// action (must match the reachability/cadence bands + the picker query).
export const ACTIVE_CADENCE_PHASES = ['prospecting', 'onboarding', 'steady_state', 'maintenance'];

/**
 * Dupe-guarded person→entity `associated_with` link. entity_relationships has
 * no unique index, so we pre-check. Best-effort — a failed link is non-fatal
 * (the caller's primary effect is the cadence stamp).
 *
 * @returns {Promise<{ok:boolean, linked?:boolean, existed?:boolean, detail?:any}>}
 */
export async function linkPersonToEntity({ workspaceId, entityId, contactEntityId, role = 'prospecting_contact', via = 'priority_queue' }) {
  if (!entityId || !contactEntityId) return { ok: false, detail: 'entityId and contactEntityId required' };
  try {
    const exists = await opsQuery('GET', 'entity_relationships?select=id&relationship_type=eq.associated_with'
      + '&from_entity_id=eq.' + pgFilterVal(entityId) + '&to_entity_id=eq.' + pgFilterVal(contactEntityId) + '&limit=1');
    if (exists.ok && Array.isArray(exists.data) && exists.data[0]) return { ok: true, existed: true };
    const ins = await insertEntityRelationship({
      workspace_id: workspaceId, from_entity_id: entityId, to_entity_id: contactEntityId,
      relationship_type: 'associated_with', metadata: { role, via },
    });
    if (ins.skipped) return { ok: false, skipped: ins.skipped };
    return { ok: !!ins.ok, linked: !!ins.ok, detail: ins.ok ? undefined : ins.data };
  } catch (e) {
    return { ok: false, detail: String(e && e.message || e) };
  }
}

/**
 * PATCH a specific cadence row with the chosen contact + an optional
 * contact_acquisition metadata mark (merged into existing metadata).
 *
 * @param cadenceId      cadence row id
 * @param contactEntityId  person entity id → contact_id (optional)
 * @param sfContactId      Salesforce contact id → sf_contact_id (optional)
 * @param acquisitionMeta  written under metadata.contact_acquisition (optional)
 * @param existingMetadata current cadence.metadata to merge into (optional)
 * @returns {Promise<{ok:boolean, detail?:any}>}
 */
export async function stampCadenceContactById(cadenceId, { contactEntityId, sfContactId, acquisitionMeta, existingMetadata } = {}) {
  if (!cadenceId) return { ok: false, detail: 'cadenceId required' };
  const patch = {};
  if (contactEntityId) patch.contact_id = contactEntityId;
  if (sfContactId) patch.sf_contact_id = sfContactId;
  if (acquisitionMeta) {
    const base = (existingMetadata && typeof existingMetadata === 'object') ? existingMetadata : {};
    patch.metadata = Object.assign({}, base, { contact_acquisition: acquisitionMeta });
  }
  if (!Object.keys(patch).length) return { ok: true, detail: 'noop' };
  const upd = await opsQuery('PATCH', 'touchpoint_cadence?id=eq.' + pgFilterVal(cadenceId), patch);
  return { ok: !!upd.ok, detail: upd.ok ? undefined : upd.data };
}

/**
 * When an acquisition path links a contact to an owner that has NO active
 * cadence, seed ONE prospecting cadence — but ONLY when the owner clears the
 * R63 BD-value floor. This is the wire between contact-acquisition (which
 * supplies the contact) and the outreach work-surface (which consumes a
 * value-ranked cadence): a $1M+ contactless owner gains a contact and would
 * otherwise sit connected-but-cadence-less, absent from the focus session.
 * Seeding it makes it workable outreach.
 *
 * Boundaries (Producer/Consumer doctrine):
 *   - VALUE-GATE (reuse, not invent): `entityHasBdSignal` — the SAME R63
 *     predicate (Salesforce identity / open opp / SF activity / connected or
 *     portfolio value ≥ floor). A newly-contacted high-value owner passes by
 *     construction (it has value). Below the floor → NO seed (no low-value
 *     cadence spam — preserves R63).
 *   - IDEMPOTENT: seeds via `getCadenceState`, whose GET-first + race-retry
 *     means an existing cadence (even a paused / converted one) is FOUND, not
 *     duplicated. Only a freshly-CREATED row (`is_new`) counts as a seed; an
 *     existing non-active cadence is left untouched (keep prior no-action
 *     behaviour — never silently reactivate a paused row).
 *   - SINGLE ADVANCE OWNER: seeding only CREATES the cadence (phase
 *     `prospecting`, contact set, `next_touch_due=now` so it surfaces); every
 *     advance still goes through `advanceCadence` exclusively.
 *
 * deps injectable for tests: { signalCheck, seedCadence } default to the live
 * `entityHasBdSignal` / `getCadenceState`.
 *
 * @returns {Promise<{ok:boolean, seeded?:boolean, cadenceId?:string,
 *   cadenceOppId?:string|null, cadenceNextDue?:string|null, reason?:string}>}
 */
export async function maybeSeedValuableCadence({ entityId, contactEntityId, sfContactId, floor, deps = {} }) {
  if (!entityId) return { ok: false, reason: 'no_entity' };
  const signalCheck = deps.signalCheck || entityHasBdSignal;
  const seedCadence = deps.seedCadence || getCadenceState;
  let hasSignal = false;
  try {
    hasSignal = await signalCheck(entityId, { floor });
  } catch (_e) {
    return { ok: false, reason: 'signal_check_failed' };
  }
  if (!hasSignal) return { ok: false, reason: 'below_value_floor' };
  const seed = await seedCadence(
    { entity_id: entityId, contact_id: contactEntityId || null, sf_contact_id: sfContactId || null },
    {}
  );
  if (!seed || !seed.ok || !seed.cadence) return { ok: false, reason: 'seed_failed', detail: seed && seed.error };
  // An existing (e.g. paused) cadence was found, not created — leave it as-is.
  if (!seed.is_new) return { ok: false, reason: 'no_active_cadence' };
  return {
    ok: true, seeded: true,
    cadenceId: seed.cadence.id,
    cadenceOppId: seed.cadence.bd_opportunity_id || null,
    cadenceNextDue: seed.cadence.next_touch_due || null,
  };
}

/**
 * Resolve the entity's most-overdue active cadence and stamp the contact onto
 * it. Used by the HTTP P-CONTACT picker (which doesn't carry a cadence id).
 *
 * When no active cadence exists and `seedIfValuable` is set (the default — all
 * acquisition paths inherit it), a prospecting cadence is seeded for a
 * value-floor owner (see `maybeSeedValuableCadence`) so the freshly-contacted
 * high-value owner becomes workable outreach instead of stranding
 * connected-but-cadence-less. Below the floor it returns `no_active_cadence`
 * exactly as before (the person→entity link already happened upstream).
 *
 * @returns {Promise<{ok:boolean, seeded?:boolean, cadenceId?:string,
 *                     cadenceOppId?:string|null, cadenceNextDue?:string|null,
 *                     reason?:string, detail?:any}>}
 */
export async function stampContactOnActiveCadence({ entityId, contactEntityId, sfContactId, onlyContactless = false, seedIfValuable = true, floor, deps = {} }) {
  if (!contactEntityId && !sfContactId) return { ok: true, reason: 'no_contact_to_stamp' };
  // R28: onlyContactless restricts the target to a cadence that has no contact
  // yet, so qualifying a captured contact onto an owner never clobbers an
  // existing prospecting contact (it only FILLS a contactless cadence).
  const contactlessFilter = onlyContactless ? '&contact_id=is.null&sf_contact_id=is.null' : '';
  const cadGet = await opsQuery('GET', 'touchpoint_cadence?entity_id=eq.' + pgFilterVal(entityId)
    + '&phase=in.(' + ACTIVE_CADENCE_PHASES.join(',') + ')'
    + contactlessFilter
    + '&order=next_touch_due.asc.nullslast&select=id,bd_opportunity_id,next_touch_due,metadata&limit=1');
  const cadRow = (cadGet.ok && Array.isArray(cadGet.data)) ? cadGet.data[0] : null;
  if (!cadRow) {
    // No active cadence — seed one when the owner is BD-valuable (the wire from
    // contact-acquisition → the value-ranked outreach surface).
    if (seedIfValuable && entityId) {
      const seeded = await maybeSeedValuableCadence({ entityId, contactEntityId, sfContactId, floor, deps });
      if (seeded.ok) return seeded;
    }
    return { ok: false, reason: 'no_active_cadence' };
  }
  const upd = await stampCadenceContactById(cadRow.id, { contactEntityId, sfContactId, existingMetadata: cadRow.metadata });
  if (!upd.ok) return { ok: false, reason: 'cadence_attach_failed', detail: upd.detail };
  return { ok: true, cadenceId: cadRow.id, cadenceOppId: cadRow.bd_opportunity_id || null, cadenceNextDue: cadRow.next_touch_due || null };
}
