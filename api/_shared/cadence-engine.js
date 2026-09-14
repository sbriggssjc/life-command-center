// ============================================================================
// Cadence Engine — Touchpoint Scheduling & Auto-Select
// Life Command Center
//
// Implements the 7-touch prospecting sequence (6 months) + quarterly
// maintenance cadence from touchpoint_cadence_spec.md.
//
// Key responsibilities:
//   1. getCadenceState()   — fetch or initialize a contact's cadence record
//   2. recommendNextTouch() — compute what template/channel to use next
//   3. advanceCadence()     — move the cadence forward after a touchpoint
//   4. checkCoolDowns()     — enforce buffer rules (flyer, meeting, phone decline)
//   5. getCadenceForDraft() — one-call summary for the draft UI
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';
import { recordTemplateSend } from './templates.js';
import { isJunkEntityName, isImplausiblePersonName } from './entity-link.js';
// Single source of truth for broker-ish roles that are never the owner's own
// reachable contact — imported, never restated (CLAUDE.md: adding a role to one
// list and not the other makes measurement and UI drift apart).
import { isNonReachableRole } from './owner-reachable-via.js';

// ============================================================================
// OPEN-TRACKING FLAG (R24 Unit 3)
// ============================================================================
//
// The mailto/copy send path has NO open signal — nothing ever reports whether
// a sent email was opened. Treating "no open recorded" as "unopened" would let
// consecutive_unopened climb on every send and wrongly trip the >=2 phone-
// recovery deprioritization on contacts who may be perfectly engaged. Until a
// real open-tracking channel (ESP/pixel) exists, the engine must only react to
// REAL unopened signals, never to the ABSENCE of a signal. This flag (default
// false) gates the consecutive_unopened branch; flip CADENCE_OPEN_TRACKING_ACTIVE
// when open tracking lands.
function openTrackingActive(options = {}) {
  if (typeof options.open_tracking === 'boolean') return options.open_tracking;
  return String(process.env.CADENCE_OPEN_TRACKING_ACTIVE || '').toLowerCase() === 'true';
}

// ============================================================================
// R63 — BD-SIGNAL GATE (a cadence tracks a REAL relationship, not capture noise)
// ============================================================================
//
// A prospecting cadence should exist only where there is a real BD target to
// work. The signal predicate below is the single source of truth shared by
// (1) the PRODUCER gate — the CoStar contact-capture path no longer auto-seeds
// a cadence for a bare captured contact — and (2) the inversion in
// sf-activity-ingest, which GROWS a cadence from Scott's real SF/Outlook
// outreach on a real target. The Unit-2 reversible pause sweep mirrors the same
// predicate in SQL, so the gate, the grow path, and the sweep all agree on what
// "real" means. Same value-floor knob shape as R60.

export const CADENCE_SIGNAL_MIN_VALUE_DEFAULT = 500000;

export function cadenceSignalFloor() {
  const v = parseFloat(process.env.CADENCE_SIGNAL_MIN_VALUE);
  return Number.isFinite(v) && v >= 0 ? v : CADENCE_SIGNAL_MIN_VALUE_DEFAULT;
}

/**
 * Pure classifier — does this entity carry a real BD signal?
 * Real = any of: connected/portfolio value at or above the floor, an open BD
 * opportunity, real SF activity, or a buy-side cadence (a P-BUYER relationship
 * is real by construction). Pure + synchronous so the decision logic is
 * unit-testable without the DB.
 *
 * P112: a bare Salesforce IDENTITY is explicitly NOT sufficient — see the
 * BARE-SF-IDENTITY block below. `hasSalesforceIdentity` is still gathered and
 * accepted in `facts` (it is useful corroboration and keeps the fact available
 * to callers/diagnostics) but it no longer decides.
 *
 * @param {object} facts - { hasSalesforceIdentity, hasOpenOpportunity,
 *   hasSalesforceActivity, connectedValue, portfolioValue, phase, floor }
 * @returns {boolean}
 */
export function bdSignalFromFacts(facts = {}) {
  const floor = Number.isFinite(facts.floor) ? facts.floor : CADENCE_SIGNAL_MIN_VALUE_DEFAULT;
  if (facts.phase === 'buy_side') return true;
  if (facts.hasOpenOpportunity) return true;
  if (facts.hasSalesforceActivity) return true;
  if (Number(facts.connectedValue) >= floor) return true;
  if (Number(facts.portfolioValue) >= floor) return true;
  // NOTE (P112): `hasSalesforceIdentity` is deliberately NOT an arm here. See
  // the BARE-SF-IDENTITY block below for the grounded reason.
  return false;
}

// ============================================================================
// P112 / BREAK-2 — a bare Salesforce identity is NOT a BD signal
// ============================================================================
//
// R63 listed `hasSalesforceIdentity` as a sufficient arm. Measured live on
// 2026-08-15 that single arm was carrying the entire noise population:
//
//   prospecting cadences ................................ 1,113
//   ... passing the gate ONLY on a bare SF identity ......   930  (84%)
//       (no open opp, no SF activity, no value >= floor)
//   ... of those, never touched .........................   897
//   prospecting cadences with an OPEN opportunity .......     0
//
// Salesforce is documented as "minimum-necessary and NOT cleaned by LCC" — it
// is a capture surface full of dups and stale rows. "An SF contact record
// exists" therefore says nothing about whether there is a relationship worth
// working; it admitted essentially the whole SF contact book into a prospecting
// cadence that no one would ever work. That is the Consumption-Layer failure
// the doctrine names: a producer emitting one item per captured row.
//
// An SF identity remains useful CORROBORATION (it is why `hasSalesforceActivity`
// can be observed at all), but the signal must come from something that implies
// a real relationship: an open opportunity, real logged SF/Outlook outreach, or
// portfolio/connected value at or above the floor.
//
// Reversal: re-add `if (facts.hasSalesforceIdentity) return true;` above and
// re-run the retire sweep's REVERSE runbook (migration 20260815120000).
// ============================================================================

// ============================================================================
// P112 — REACHABILITY PRECONDITION (the value gate the producer never had)
// ============================================================================
//
// A touchpoint cadence for a party we cannot contact can never advance: it is
// guaranteed to age into "overdue" and pollute every count that reads the
// table. The correct predecessor step for such an owner is "find the
// decision-maker" (the contact-acquisition lane), not "send touch #1 into the
// void".
//
// The predicate MIRRORS `v_lcc_owner_reachability.reachable_hero_effective` —
// the definition CLAUDE.md instructs us to quote, and the one the owner-panel
// hero actually renders. Three routes:
//   1. the org's own email/phone           (entities.email / entities.phone)
//   2. a unified_contacts email on the org
//   3. a linked PERSON carrying email/phone whose role survives the guards
//
// Broker-ish roles are EXCLUDED, not ranked last, exactly as in
// `owner-reachable-via.js::NON_REACHABLE_ROLES` and the SQL
// `via_person_selectable` arm. CLAUDE.md warns that adding a role to one and
// not the other makes measurement and UI drift apart — so this module imports
// the single JS list rather than restating it.
// ============================================================================

/**
 * Pure classifier — can this entity be contacted at all today?
 *
 * @param {object} facts - { orgEmail, orgPhone, unifiedContactEmail,
 *   linkedPersons: [{ email, phone, role }] }
 * @returns {boolean}
 */
export function cadenceReachableFromFacts(facts = {}) {
  const nonEmpty = (v) => !!String(v ?? '').trim();
  if (nonEmpty(facts.orgEmail) || nonEmpty(facts.orgPhone)) return true;
  if (nonEmpty(facts.unifiedContactEmail)) return true;
  const persons = Array.isArray(facts.linkedPersons) ? facts.linkedPersons : [];
  return persons.some((p) => (
    p && (nonEmpty(p.email) || nonEmpty(p.phone)) && !isNonReachableRole(p.role)
  ));
}

/**
 * Gather the reachability facts for an entity and classify. deps.query
 * injectable for tests (defaults to opsQuery).
 *
 * Fails OPEN (treated as reachable) on a gather error — the opposite of
 * `entityHasBdSignal`, and deliberately so. The BD-signal gate fails CLOSED
 * because seeding on a hiccup creates noise; this gate fails OPEN because a
 * transient read error must never silently suppress a cadence for a genuinely
 * reachable owner. A false "unreachable" is the more expensive mistake: it
 * drops real work on the floor, and nothing downstream would show it was lost.
 *
 * @param {string} entityId
 * @param {object} [opts] - { query }
 * @returns {Promise<boolean>}
 */
export async function entityIsCadenceReachable(entityId, opts = {}) {
  if (!entityId) return false;
  const query = opts.query || opsQuery;
  const v = pgFilterVal(entityId);
  try {
    const [org, uc, rel] = await Promise.all([
      query('GET', `entities?id=eq.${v}&select=email,phone&limit=1`),
      query('GET', `unified_contacts?entity_id=eq.${v}&email=not.is.null&select=email&limit=1`),
      query('GET', `entity_relationships?or=(from_entity_id.eq.${v},to_entity_id.eq.${v})`
        + '&select=from_entity_id,to_entity_id,metadata,'
        + 'from_entity:entities!entity_relationships_from_entity_id_fkey(id,entity_type,email,phone),'
        + 'to_entity:entities!entity_relationships_to_entity_id_fkey(id,entity_type,email,phone)'
        + '&limit=200'),
    ]);
    // A non-ok read is an ERROR, not evidence of absence. Treating a failed
    // relationship fetch as "no linked people" would fail CLOSED and silently
    // suppress a reachable owner — the exact failure this gate must not cause.
    if (!org.ok || !uc.ok || !rel.ok) return true;
    const orgRow = (org.data?.[0]) ? org.data[0] : {};
    const ucRow  = (uc.data?.[0]) ? uc.data[0] : {};
    const linkedPersons = [];
    if (Array.isArray(rel.data)) {
      for (const r of rel.data) {
        // The counterparty of the edge is whichever side is NOT this entity.
        const other = String(r.from_entity_id) === String(entityId) ? r.to_entity : r.from_entity;
        if (!other || other.entity_type !== 'person') continue;
        linkedPersons.push({
          email: other.email, phone: other.phone,
          role: (r.metadata && r.metadata.role) || '',
        });
      }
    }
    return cadenceReachableFromFacts({
      orgEmail: orgRow.email, orgPhone: orgRow.phone,
      unifiedContactEmail: ucRow.email, linkedPersons,
    });
  } catch (_e) {
    return true; // fail OPEN — never silently suppress a reachable owner
  }
}

/**
 * The single AUTO-SEED decision: should a prospecting cadence be created for
 * this entity right now? Combines the (tightened) BD-signal value gate with the
 * reachability precondition so both auto-seed producers — the CoStar sidebar
 * capture path and `contact-attach::maybeSeedValuableCadence` — agree.
 *
 * Deliberately NOT applied to:
 *   - `initiate_cadence` (a deliberate operator action; the human overrides)
 *   - the sf-activity GROW path (real outreach already happened, which both
 *     proves reachability and is itself the signal)
 *
 * @returns {Promise<{seed:boolean, reason:string}>}
 *   reason: 'ok' | 'below_value_floor' | 'unreachable_no_contact_method'
 */
export async function cadenceSeedDecision(entityId, opts = {}) {
  if (!entityId) return { seed: false, reason: 'no_entity' };
  const signalCheck = opts.signalCheck || entityHasBdSignal;
  const reachCheck  = opts.reachCheck  || entityIsCadenceReachable;
  if (!(await signalCheck(entityId, opts))) {
    return { seed: false, reason: 'below_value_floor' };
  }
  if (!(await reachCheck(entityId, opts))) {
    // The correct predecessor work item is "find the decision-maker". Owner
    // entities are already carried, value-ranked, by
    // `v_lcc_owner_unreachable_worklist` (prompt 111/114) — so this is a
    // SUPPRESSION, not a dropped item, and needs no duplicate producer here.
    return { seed: false, reason: 'unreachable_no_contact_method' };
  }
  return { seed: true, reason: 'ok' };
}

/**
 * Gather the BD-signal facts for an entity and classify. deps.query injectable
 * for tests (defaults to opsQuery). Fails CLOSED (no signal) on a gather error:
 * a bare captured contact must not be auto-seeded just because the check
 * hiccuped — a genuine target re-earns its cadence from real outreach (the
 * sf-activity grow path) or an explicit operator action (initiate_cadence).
 *
 * @param {string} entityId
 * @param {object} [opts] - { query, floor, phase }
 * @returns {Promise<boolean>}
 */
export async function entityHasBdSignal(entityId, opts = {}) {
  if (!entityId) return false;
  const query = opts.query || opsQuery;
  const floor = Number.isFinite(opts.floor) ? opts.floor : cadenceSignalFloor();
  const v = pgFilterVal(entityId);
  const facts = { floor, phase: opts.phase || null };
  try {
    const [sf, opp, act, cv, pf] = await Promise.all([
      query('GET', `external_identities?entity_id=eq.${v}&source_system=eq.salesforce&select=entity_id&limit=1`),
      query('GET', `bd_opportunities?entity_id=eq.${v}&is_open=is.true&select=id&limit=1`),
      query('GET', `activity_events?entity_id=eq.${v}&source_type=eq.salesforce&select=id&limit=1`),
      query('GET', `lcc_entity_connected_value?entity_id=eq.${v}&select=connected_property_value&limit=1`),
      query('GET', `v_entity_portfolio_all?entity_id=eq.${v}&select=current_annual_rent_total&limit=1`),
    ]);
    facts.hasSalesforceIdentity = !!(sf.ok && Array.isArray(sf.data) && sf.data.length);
    facts.hasOpenOpportunity    = !!(opp.ok && Array.isArray(opp.data) && opp.data.length);
    facts.hasSalesforceActivity = !!(act.ok && Array.isArray(act.data) && act.data.length);
    facts.connectedValue = (cv.ok && cv.data?.[0]) ? (Number(cv.data[0].connected_property_value) || 0) : 0;
    facts.portfolioValue = (pf.ok && pf.data?.[0]) ? (Number(pf.data[0].current_annual_rent_total) || 0) : 0;
  } catch (_e) {
    return false; // fail closed — do not seed on a signal-check error
  }
  return bdSignalFromFacts(facts);
}

// ============================================================================
// GROW GATE — capture Scott's REAL pipeline (2026-07-13)
// ============================================================================
//
// R63 gated the PRODUCER (no auto-seed on a bare CoStar capture) and grew a
// cadence from real SF outreach behind `entityHasBdSignal` (the value floor).
// But Scott's real pipeline is mostly Outlook + property-page (email_intake)
// outreach, and a person he emails/calls REPEATEDLY is a real relationship
// regardless of portfolio value. Doctrine: repeated human outreach IS the BD
// signal — the app should track it (reminder / next-touch / measurement), not
// ignore it for failing a portfolio-value gate.
//
// So the GROW gate is deliberately LOOSER than the R63 producer gate. It
// qualifies to grow a cadence when ANY of:
//   - a full R63 BD signal (SF identity / open opp / SF activity / value ≥ floor)
//   - a Salesforce CRM identity (a real, CRM-tracked contact)
//   - >= 2 real outreach events (a genuinely-worked relationship)
// It NEVER grows on a junk / implausible-name entity (garbage is not a
// relationship). The pure classifier is shared with the async gatherer so the
// decision is unit-testable without the DB.

export const CADENCE_GROW_MIN_OUTREACH_EVENTS = 2;

/**
 * Pure grow-gate classifier. `facts` mirrors bdSignalFromFacts plus
 * `outreachEventCount` (real email/call/meeting events on the worked entity)
 * and `nameIsJunk` (structural garbage / implausible person name).
 * @returns {boolean}
 */
export function growGateFromFacts(facts = {}) {
  if (facts.nameIsJunk) return false;                     // never grow on garbage
  if (bdSignalFromFacts(facts)) return true;              // SF id / opp / activity / value
  const min = Number.isFinite(facts.growMinEvents) ? facts.growMinEvents : CADENCE_GROW_MIN_OUTREACH_EVENTS;
  if (Number(facts.outreachEventCount) >= min) return true; // a genuinely-worked relationship
  return false;
}

/**
 * Gather the grow-gate facts for a target entity and classify. The value /
 * identity / opp signals are read on `entityId` (the grow target — the owner
 * for an asset), while the outreach-event count is read on
 * `opts.outreachEntityId` (the entity Scott actually worked — the asset for a
 * property-page touch) so repeated work on a property counts toward growing its
 * OWNER's cadence. deps.query injectable for tests. Fails CLOSED on a gather
 * error (never grow on a hiccup).
 *
 * @param {string} entityId  — the grow TARGET
 * @param {object} [opts] - { query, floor, outreachEntityId }
 * @returns {Promise<boolean>}
 */
export async function entityQualifiesForCadenceGrowth(entityId, opts = {}) {
  if (!entityId) return false;
  const query = opts.query || opsQuery;
  const floor = Number.isFinite(opts.floor) ? opts.floor : cadenceSignalFloor();
  const v = pgFilterVal(entityId);
  const workedV = pgFilterVal(opts.outreachEntityId || entityId);
  const facts = { floor };
  try {
    const [sf, opp, act, cv, pf, evc, ent] = await Promise.all([
      query('GET', `external_identities?entity_id=eq.${v}&source_system=eq.salesforce&select=entity_id&limit=1`),
      query('GET', `bd_opportunities?entity_id=eq.${v}&is_open=is.true&select=id&limit=1`),
      query('GET', `activity_events?entity_id=eq.${v}&source_type=eq.salesforce&select=id&limit=1`),
      query('GET', `lcc_entity_connected_value?entity_id=eq.${v}&select=connected_property_value&limit=1`),
      query('GET', `v_entity_portfolio_all?entity_id=eq.${v}&select=current_annual_rent_total&limit=1`),
      // Real outreach events on the WORKED entity — repeated human outreach.
      // limit=CADENCE_GROW_MIN_OUTREACH_EVENTS: we only need to know if >= min.
      query('GET', `activity_events?entity_id=eq.${workedV}&category=in.(email,call,meeting)&select=id&limit=${CADENCE_GROW_MIN_OUTREACH_EVENTS}`),
      query('GET', `entities?id=eq.${v}&select=name,entity_type&limit=1`),
    ]);
    facts.hasSalesforceIdentity = !!(sf.ok && Array.isArray(sf.data) && sf.data.length);
    facts.hasOpenOpportunity    = !!(opp.ok && Array.isArray(opp.data) && opp.data.length);
    facts.hasSalesforceActivity = !!(act.ok && Array.isArray(act.data) && act.data.length);
    facts.connectedValue = (cv.ok && cv.data?.[0]) ? (Number(cv.data[0].connected_property_value) || 0) : 0;
    facts.portfolioValue = (pf.ok && pf.data?.[0]) ? (Number(pf.data[0].current_annual_rent_total) || 0) : 0;
    facts.outreachEventCount = (evc.ok && Array.isArray(evc.data)) ? evc.data.length : 0;
    const e = (ent.ok && ent.data?.[0]) || null;
    const nm = e?.name || '';
    facts.nameIsJunk = isJunkEntityName(nm) || (e?.entity_type === 'person' && isImplausiblePersonName(nm));
  } catch (_e) {
    return false; // fail closed — do not grow on a gather error
  }
  return growGateFromFacts(facts);
}

/**
 * Resolve the entity a cadence should be GROWN on, from the entity Scott
 * actually worked. A PROPERTY-page (asset) touch grows the OWNER's cadence (the
 * R10 owns-hop) — property activity becomes owner cadence tracking. A PERSON
 * Scott emailed IS the contact — grow on them and stamp themselves as the
 * contact so the cadence is immediately outreach-ready (no re-acquisition). An
 * organization owner grows on itself (a contact is acquired later).
 *
 * @returns {Promise<{growEntityId:string, contactEntityId:string|null, kind:string}|null>}
 */
export async function resolveCadenceGrowTarget(entityId, opts = {}) {
  if (!entityId) return null;
  const query = opts.query || opsQuery;
  const v = pgFilterVal(entityId);
  const ent = await query('GET', `entities?id=eq.${v}&select=id,entity_type&limit=1`);
  const type = (ent.ok && ent.data?.[0]?.entity_type) || null;
  if (type === 'asset') {
    const owner = await query('GET',
      `entity_relationships?to_entity_id=eq.${v}&relationship_type=eq.owns&select=from_entity_id&limit=1`);
    const ownerId = owner.ok && owner.data?.[0]?.from_entity_id;
    if (ownerId) return { growEntityId: ownerId, contactEntityId: null, kind: 'asset_owner' };
    return null; // asset with no owner — nothing meaningful to grow
  }
  if (type === 'person') {
    // The person IS the contact — self-stamp so the grown cadence is reachable.
    return { growEntityId: entityId, contactEntityId: entityId, kind: 'person_self' };
  }
  return { growEntityId: entityId, contactEntityId: null, kind: 'owner' };
}

/**
 * GROW a cadence from a real outreach event (the Phase-1 inversion — capture
 * Scott's real pipeline). Called best-effort by every real-outreach writer (SF
 * ingest, Outlook message link, email_intake correspondence) after a fresh
 * insert. Grows ONLY when NO cadence resolves anywhere in the chain — the SQL
 * advance trigger owns the advance of an EXISTING cadence, so this never
 * double-advances. Reuses the single advance owner (advanceCadence) + the
 * seed helper (getCadenceState). deps injectable for tests.
 *
 * @param {object} args - { entityId, category, domain, floor }
 * @returns {Promise<{grown:boolean, reason?:string, cadence_id?:string, ...}>}
 */
export async function growCadenceFromOutreach(args = {}, deps = {}) {
  const { entityId, category, domain } = args;
  if (!entityId) return { grown: false, reason: 'no_entity' };
  if (category !== 'email' && category !== 'call' && category !== 'meeting') {
    return { grown: false, reason: 'not_outreach' };
  }
  const query        = deps.query || opsQuery;
  const resolveCad   = deps.resolveCadenceForEntity || resolveCadenceForEntity;
  const resolveTgt   = deps.resolveCadenceGrowTarget || resolveCadenceGrowTarget;
  const qualifies    = deps.qualifies || entityQualifiesForCadenceGrowth;
  const seed         = deps.getCadenceState || getCadenceState;
  const advance      = deps.advanceCadence || advanceCadence;

  // The trigger already advanced any EXISTING cadence on the insert (direct /
  // owns-hop / contact-hop). Grow only when none resolves anywhere.
  let existing = null;
  try { existing = await resolveCad(entityId); } catch (_e) { existing = null; }
  if (existing && existing.id) return { grown: false, reason: 'cadence_exists', cadence_id: existing.id };

  const target = await resolveTgt(entityId, { query });
  if (!target || !target.growEntityId) return { grown: false, reason: 'no_grow_target' };

  // Defense against a race / a target reached by a different edge than the
  // original resolution: never grow a duplicate onto a target that already has
  // one. (For a person-self target this repeats the first check cheaply.)
  if (target.growEntityId !== entityId) {
    let tgtExisting = null;
    try { tgtExisting = await resolveCad(target.growEntityId); } catch (_e) { tgtExisting = null; }
    if (tgtExisting && tgtExisting.id) return { grown: false, reason: 'cadence_exists', cadence_id: tgtExisting.id };
  }

  const ok = await qualifies(target.growEntityId, { outreachEntityId: entityId, floor: args.floor });
  if (!ok) return { grown: false, reason: 'not_qualified', target: target.kind };

  const seedRes = await seed(
    { entity_id: target.growEntityId, contact_id: target.contactEntityId || null },
    { domain: domain || null }
  );
  if (!seedRes || !seedRes.ok || !seedRes.cadence || !seedRes.cadence.id) {
    return { grown: false, reason: 'seed_failed' };
  }
  // An existing (e.g. paused) cadence was FOUND, not created — leave it as-is.
  if (!seedRes.is_new) return { grown: false, reason: 'cadence_exists', cadence_id: seedRes.cadence.id };

  const advType = category === 'call' ? 'phone' : category;
  const adv = await advance(seedRes.cadence.id, { type: advType, direction: 'outbound', outcome: 'logged_from_outreach' });
  return {
    grown: !!(adv && adv.ok),
    cadence_id: seedRes.cadence.id,
    grow_entity_id: target.growEntityId,
    contact_entity_id: target.contactEntityId || null,
    target: target.kind,
  };
}

// ============================================================================
// CADENCE SEQUENCE DEFINITION
// ============================================================================

/**
 * The 7-touch prospecting sequence.
 * touch_number: 1-7
 * type: email | phone
 * template: template_id to use (null for phone — use voicemail script)
 * days_after_prev: recommended spacing from previous touch
 */
const PROSPECTING_SEQUENCE = [
  { touch: 1, type: 'email',  template: 'T-001', days_after_prev: 0,  label: 'First Touch (Intro + Report + BOV)' },
  { touch: 2, type: 'phone',  template: null,     days_after_prev: 10, label: 'Phone Follow-Up (confirm email receipt)' },
  { touch: 3, type: 'email',  template: 'T-003', days_after_prev: 15, label: 'Capital Markets Update' },
  { touch: 4, type: 'phone',  template: null,     days_after_prev: 10, label: 'Phone Follow-Up (quarterly report)' },
  { touch: 5, type: 'email',  template: 'T-004', days_after_prev: 12, label: 'Listing Announcement or Comp Share' },
  { touch: 6, type: 'phone',  template: null,     days_after_prev: 10, label: 'Phone Follow-Up (listing/comp)' },
  { touch: 7, type: 'email',  template: 'T-002', days_after_prev: 10, label: 'Direct Ask (schedule meeting)' }
];

/** Priority tier cadence multipliers (Tier A = faster, Tier C = slower) */
const TIER_MULTIPLIERS = {
  A: 0.7,   // 30% faster cadence
  B: 1.0,   // standard
  C: 2.0    // 2x slower (quarterly-only for Tier C)
};

/** Cool-down buffer durations in milliseconds */
const COOLDOWNS = {
  flyer_buffer_ms:         3 * 24 * 60 * 60 * 1000,   // 3 days after marketing flyer
  meeting_buffer_ms:       2 * 24 * 60 * 60 * 1000,   // 48 hours after meeting
  phone_decline_buffer_ms: 30 * 24 * 60 * 60 * 1000,  // 30 days after phone decline
  quarterly_interval_ms:   90 * 24 * 60 * 60 * 1000    // ~90 days for quarterly
};

// ============================================================================
// FETCH / INITIALIZE CADENCE STATE
// ============================================================================

/**
 * Retrieve or initialize a cadence record for a contact+property pair.
 *
 * @param {object} ids - At least one of: { entity_id, sf_contact_id, contact_id }
 * @param {object} [propertyInfo] - { property_id, property_address, domain }
 * @returns {object} The cadence record (existing or newly created)
 */
// ============================================================================
// P112 UNIT D — stamp the REP (point person) upstream, at create + advance
// ============================================================================
//
// Only 7 of 1,905 rows carried an `owner_user_id`, so the owner panel's ROE
// line ("Kelly owns this relationship") rendered blank almost everywhere. A
// BACKFILL is the documented dead end (property-tab-ux-review: 0 rows carry a
// bd_opportunity_id, and re-verified live 0 prospecting cadences have an open
// opportunity) — so the fix is upstream: stamp at cadence CREATE and fill at
// ADVANCE, from the POINT-PERSON source of truth.
//
// ⚠️ FOOTGUN — the two columns FK to DIFFERENT user tables:
//     lcc_entity_owner_override.owner_user_id -> lcc_users(lcc_user_id)
//     touchpoint_cadence.owner_user_id        -> users(id)
// and ALL 131 override ids are absent from public.users, so stamping the
// override id directly FK-violates on every row. The bridge is EMAIL, resolved
// once in SQL by `v_lcc_entity_point_person` / `lcc_cadence_point_person()`.
// Always go through the RPC — never re-derive the mapping in JS.
//
// CLAUDE.md: the POINT PERSON (`lcc_entity_owner_override.owner_user_id`) is
// the lcc_user who works the deal. It is NOT the property owner — that lives in
// `lcc_property_owner`. Never feed owner entities through this resolver.
//
// Best-effort: a resolve failure NEVER blocks the cadence write.
// ============================================================================

/**
 * Resolve the point person for an entity as a `public.users.id`, or null.
 * @param {string} entityId
 * @param {object} [opts] - { query }
 * @returns {Promise<string|null>}
 */
export async function resolveCadencePointPerson(entityId, opts = {}) {
  if (!entityId) return null;
  const query = opts.query || opsQuery;
  try {
    const r = await query('POST', 'rpc/lcc_cadence_point_person', { p_entity_id: entityId });
    if (!r || !r.ok) return null;
    // PostgREST returns a scalar for a scalar-returning function.
    const v = Array.isArray(r.data) ? r.data[0] : r.data;
    if (v == null) return null;
    if (typeof v === 'string') return v || null;
    if (typeof v === 'object') return v.lcc_cadence_point_person || null;
    return null;
  } catch (_e) {
    return null;
  }
}

export async function getCadenceState(ids, propertyInfo = {}) {
  // Build filter to find existing record
  const filters = [];
  if (ids.entity_id) filters.push(`entity_id=eq.${pgFilterVal(ids.entity_id)}`);
  if (ids.sf_contact_id) filters.push(`sf_contact_id=eq.${pgFilterVal(ids.sf_contact_id)}`);
  if (propertyInfo.property_id) filters.push(`property_id=eq.${pgFilterVal(propertyInfo.property_id)}`);

  if (filters.length === 0) {
    return { ok: false, error: 'At least one contact identifier required' };
  }

  // Try to fetch existing record
  const path = `touchpoint_cadence?${filters.join('&')}&limit=1`;
  const result = await opsQuery('GET', path);

  if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
    return { ok: true, cadence: result.data[0], is_new: false };
  }

  // No existing record — initialize a new one
  const newRecord = {
    entity_id: ids.entity_id || null,
    contact_id: ids.contact_id || null,
    sf_contact_id: ids.sf_contact_id || null,
    property_id: propertyInfo.property_id || null,
    property_address: propertyInfo.property_address || null,
    domain: propertyInfo.domain || null,
    priority_tier: 'B',
    phase: 'prospecting',
    current_touch: 0,
    next_touch_type: 'email',
    next_touch_template: 'T-001',
    next_touch_due: new Date().toISOString()
  };

  // P112 Unit D — stamp the rep at CREATE so the ROE line is populated from the
  // start. Best-effort: never block the cadence write on the lookup.
  if (ids.entity_id) {
    const repId = await resolveCadencePointPerson(ids.entity_id);
    if (repId) {
      newRecord.owner_user_id = repId;
      newRecord.metadata = { ...(newRecord.metadata || {}), rep_source: 'entity_owner_override' };
    }
  }

  const insertResult = await opsQuery('POST', 'touchpoint_cadence', newRecord);

  if (insertResult.ok && Array.isArray(insertResult.data) && insertResult.data.length > 0) {
    return { ok: true, cadence: insertResult.data[0], is_new: true };
  }

  // Insert might fail on unique constraint if race condition — try fetch again
  const retryResult = await opsQuery('GET', path);
  if (retryResult.ok && Array.isArray(retryResult.data) && retryResult.data.length > 0) {
    return { ok: true, cadence: retryResult.data[0], is_new: false };
  }

  return { ok: false, error: 'Failed to initialize cadence record', detail: insertResult.data };
}

// ============================================================================
// RECOMMEND NEXT TOUCH
// ============================================================================

/**
 * Given a cadence record, compute the recommended next action.
 *
 * @param {object} cadence - A touchpoint_cadence row
 * @param {object} [options] - { now, escalationFlags }
 * @returns {object} Recommendation: { touch_number, type, template, label, due_at, is_overdue, cool_down_active, cool_down_reason }
 */
export function recommendNextTouch(cadence, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();

  // Check for opt-out / paused
  if (cadence.unsubscribe_status !== 'active') {
    return { touch_number: null, type: null, template: null, label: 'Contact is opted out or paused', blocked: true, reason: cadence.unsubscribe_status };
  }

  // Check phase
  if (cadence.phase === 'dormant') {
    return { touch_number: null, type: null, template: null, label: 'Contact is dormant — annual check-in only', blocked: true, reason: 'dormant' };
  }

  if (cadence.phase === 'converted') {
    return { touch_number: null, type: null, template: null, label: 'Contact converted — active engagement', blocked: true, reason: 'converted' };
  }

  // ── Escalation overrides ──────────────────────────────────────────────

  // New lease award → T-013 immediately
  if (cadence.new_award_flag) {
    const coolDown = checkCoolDowns(cadence, 'email', now);
    return {
      touch_number: cadence.current_touch,
      type: 'email',
      template: 'T-013',
      label: 'GSA Lease Award Congratulations (escalation)',
      due_at: coolDown.blocked ? coolDown.available_at : now.toISOString(),
      is_overdue: false,
      cool_down_active: coolDown.blocked,
      cool_down_reason: coolDown.reason || null,
      is_escalation: true
    };
  }

  // Lease expiration approaching → accelerate with T-002
  if (cadence.lease_expiry_flag && cadence.phase === 'maintenance') {
    const coolDown = checkCoolDowns(cadence, 'email', now);
    return {
      touch_number: cadence.current_touch,
      type: 'email',
      template: 'T-002',
      label: 'Lease Expiration Follow-Up (escalation)',
      due_at: coolDown.blocked ? coolDown.available_at : now.toISOString(),
      is_overdue: false,
      cool_down_active: coolDown.blocked,
      cool_down_reason: coolDown.reason || null,
      is_escalation: true
    };
  }

  // ── Consecutive unopened → switch to phone ────────────────────────────

  if (openTrackingActive(options) && cadence.consecutive_unopened >= 2 && cadence.phase === 'prospecting') {
    const coolDown = checkCoolDowns(cadence, 'phone', now);
    return {
      touch_number: cadence.current_touch + 1,
      type: 'phone',
      template: null,
      label: 'Phone recovery (2+ consecutive unopened emails)',
      due_at: coolDown.blocked ? coolDown.available_at : now.toISOString(),
      is_overdue: false,
      cool_down_active: coolDown.blocked,
      cool_down_reason: coolDown.reason || null,
      is_recovery: true
    };
  }

  // ── Standard prospecting sequence ─────────────────────────────────────

  if (cadence.phase === 'prospecting') {
    const nextTouchNum = cadence.current_touch + 1;

    // If we're past touch 7, move to maintenance
    if (nextTouchNum > 7) {
      return recommendQuarterlyTouch(cadence, now);
    }

    const step = PROSPECTING_SEQUENCE.find(s => s.touch === nextTouchNum);
    if (!step) {
      return recommendQuarterlyTouch(cadence, now);
    }

    // Compute due date
    const tierMult = TIER_MULTIPLIERS[cadence.priority_tier] || 1;
    const spacingMs = step.days_after_prev * 24 * 60 * 60 * 1000 * tierMult;
    const lastTouch = cadence.last_touch_at ? new Date(cadence.last_touch_at) : now;
    const dueAt = new Date(lastTouch.getTime() + spacingMs);
    const isOverdue = now > dueAt;

    // Check cool-downs for the recommended channel
    const coolDown = checkCoolDowns(cadence, step.type, now);

    // For Touch 7 (final), set is_final_touch flag for T-002 template
    const extraFlags = {};
    if (nextTouchNum === 7) {
      extraFlags.is_final_touch = true;
    }

    return {
      touch_number: nextTouchNum,
      type: step.type,
      template: step.template,
      label: step.label,
      due_at: dueAt.toISOString(),
      is_overdue: isOverdue,
      overdue_days: isOverdue ? Math.floor((now - dueAt) / (24 * 60 * 60 * 1000)) : 0,
      cool_down_active: coolDown.blocked,
      cool_down_reason: coolDown.reason || null,
      phase: 'prospecting',
      ...extraFlags
    };
  }

  // ── Quarterly maintenance ─────────────────────────────────────────────

  return recommendQuarterlyTouch(cadence, now);
}

/**
 * Build a quarterly maintenance touch recommendation.
 */
function recommendQuarterlyTouch(cadence, now) {
  const lastTouch = cadence.last_touch_at ? new Date(cadence.last_touch_at) : null;
  const quarterlyMs = COOLDOWNS.quarterly_interval_ms;
  const dueAt = lastTouch ? new Date(lastTouch.getTime() + quarterlyMs) : now;
  const isOverdue = now > dueAt;

  const coolDown = checkCoolDowns(cadence, 'email', now);

  // Seasonal variation
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  let label = `Quarterly Capital Markets Update (Q${quarter})`;
  if (quarter === 4) label = `Year-End Portfolio Review (Q4)`;
  if (quarter === 1) label = `New Year Disposition/Refinance Planning (Q1)`;

  return {
    touch_number: cadence.current_touch,
    type: 'email',
    template: 'T-003',
    label,
    due_at: dueAt.toISOString(),
    is_overdue: isOverdue,
    overdue_days: isOverdue ? Math.floor((now - dueAt) / (24 * 60 * 60 * 1000)) : 0,
    cool_down_active: coolDown.blocked,
    cool_down_reason: coolDown.reason || null,
    phase: 'maintenance'
  };
}

// ============================================================================
// COOL-DOWN CHECKS
// ============================================================================

/**
 * Check if any cool-down rules block a touchpoint of the given type.
 *
 * @param {object} cadence - The cadence record
 * @param {string} touchType - 'email' or 'phone'
 * @param {Date} now
 * @returns {{ blocked: boolean, reason?: string, available_at?: string }}
 */
export function checkCoolDowns(cadence, touchType, now) {
  now = now || new Date();

  // Flyer buffer: no personal email within 3 days of marketing flyer
  if (touchType === 'email' && cadence.last_flyer_at) {
    const flyerTime = new Date(cadence.last_flyer_at).getTime();
    const bufferEnd = flyerTime + COOLDOWNS.flyer_buffer_ms;
    if (now.getTime() < bufferEnd) {
      return { blocked: true, reason: 'Marketing flyer sent recently — 3-day buffer', available_at: new Date(bufferEnd).toISOString() };
    }
  }

  // Meeting buffer: no follow-up within 48 hours of meeting
  if (cadence.last_meeting_at) {
    const meetingTime = new Date(cadence.last_meeting_at).getTime();
    const bufferEnd = meetingTime + COOLDOWNS.meeting_buffer_ms;
    if (now.getTime() < bufferEnd) {
      return { blocked: true, reason: 'Recent meeting — 48-hour buffer', available_at: new Date(bufferEnd).toISOString() };
    }
  }

  // Phone decline: no calls for 30 days
  if (touchType === 'phone' && cadence.phone_declined_at) {
    const declineTime = new Date(cadence.phone_declined_at).getTime();
    const bufferEnd = declineTime + COOLDOWNS.phone_decline_buffer_ms;
    if (now.getTime() < bufferEnd) {
      return { blocked: true, reason: 'Phone declined — 30-day buffer', available_at: new Date(bufferEnd).toISOString() };
    }
  }

  return { blocked: false };
}

// ============================================================================
// ADVANCE CADENCE (after a touchpoint is executed)
// ============================================================================

/**
 * Advance the cadence state after a touchpoint has been executed.
 * Called by record_send and manual touchpoint logging.
 *
 * @param {string} cadenceId - UUID of the touchpoint_cadence row
 * @param {object} touchData - { type, template_id, outcome, opened }
 * @returns {object} Updated cadence record
 */
export async function advanceCadence(cadenceId, touchData) {
  // Fetch current state
  const result = await opsQuery('GET', `touchpoint_cadence?id=eq.${pgFilterVal(cadenceId)}&limit=1`);
  if (!result.ok || !result.data?.[0]) {
    return { ok: false, error: 'Cadence record not found' };
  }

  const cadence = result.data[0];
  const now = new Date();

  // ── Inbound reply (R24 Unit 2) ────────────────────────────────────────────
  // A reply is a high-signal INBOUND touch, NOT an outbound send. It bumps
  // emails_replied, resets the unopened streak (engagement acknowledged), and
  // moves the cadence into the engine's 'converted' (active-engagement) state
  // so the cold prospecting sequence PAUSES and the human takes over (the
  // pause/escalate branch). It must NEVER increment emails_sent / current_touch
  // or write a template_sends row (that would double-count a send that never
  // happened). Routed here whenever the caller flags a reply/inbound touch.
  const isReply = touchData.outcome === 'replied'
    || touchData.type === 'reply'
    || touchData.direction === 'inbound';
  if (isReply) {
    const replyUpdate = {
      last_touch_at: now.toISOString(),
      last_touch_type: 'reply',
      emails_replied: (cadence.emails_replied || 0) + 1,
      consecutive_unopened: 0
    };
    if (cadence.phase !== 'converted') replyUpdate.phase = 'converted';
    const replyPatch = await opsQuery(
      'PATCH',
      `touchpoint_cadence?id=eq.${pgFilterVal(cadenceId)}`,
      replyUpdate
    );
    if (!replyPatch.ok) {
      return { ok: false, error: 'Failed to update cadence', detail: replyPatch.data };
    }
    const merged = { ...cadence, ...replyUpdate };
    return {
      ok: true,
      cadence: replyPatch.data?.[0] || merged,
      recommendation: recommendNextTouch(merged),
      reply_captured: true
    };
  }

  // Build update payload
  const update = {
    last_touch_at: now.toISOString(),
    last_touch_type: touchData.type || 'email',
    last_touch_template: touchData.template_id || null
  };

  // P112 Unit D — FILL-BLANKS the rep at advance time. A cadence created before
  // the create-time stamp existed (or before the entity had a point person)
  // picks one up the first time it is actually worked. Never overwrites an
  // assigned rep, and never blocks the advance.
  if (!cadence.owner_user_id && cadence.entity_id) {
    const repId = await resolveCadencePointPerson(cadence.entity_id);
    if (repId) {
      update.owner_user_id = repId;
      update.metadata = { ...(cadence.metadata || {}), rep_source: 'entity_owner_override' };
    }
  }

  // Advance touch counter for prospecting phase
  if (cadence.phase === 'prospecting') {
    const nextTouch = cadence.current_touch + 1;
    update.current_touch = nextTouch;

    // If we just completed touch 7, transition to maintenance
    if (nextTouch >= 7) {
      update.phase = 'maintenance';
    }
  }

  // Update engagement counters
  if (touchData.type === 'email') {
    update.emails_sent = (cadence.emails_sent || 0) + 1;
    // R24 Unit 3 — open-tracking-aware. Only move the open counters when this
    // send's channel actually reports opens (an explicit `opened` boolean, or
    // touchData.open_tracking === true). The mailto/copy path carries no open
    // signal, so its absence must NOT be read as "unopened" — leaving
    // consecutive_unopened untouched keeps engaged contacts from being wrongly
    // deprioritized at the >=2 phone-recovery threshold.
    const hasOpenSignal = (typeof touchData.opened === 'boolean') || touchData.open_tracking === true;
    if (hasOpenSignal) {
      if (touchData.opened) {
        update.emails_opened = (cadence.emails_opened || 0) + 1;
        update.consecutive_unopened = 0;
      } else {
        update.consecutive_unopened = (cadence.consecutive_unopened || 0) + 1;
      }
    }
  } else if (touchData.type === 'phone') {
    update.calls_made = (cadence.calls_made || 0) + 1;
    if (touchData.outcome === 'connected') {
      update.calls_connected = (cadence.calls_connected || 0) + 1;
    }
    if (touchData.outcome === 'declined') {
      update.phone_declined_at = now.toISOString();
    }
  } else if (touchData.type === 'meeting') {
    update.meetings_scheduled = (cadence.meetings_scheduled || 0) + 1;
    update.last_meeting_at = now.toISOString();
  }

  // Clear escalation flags if addressed
  if (touchData.template_id === 'T-013' && cadence.new_award_flag) {
    update.new_award_flag = false;
  }

  // Compute next recommended touch
  const updatedCadence = { ...cadence, ...update };
  const nextRec = recommendNextTouch(updatedCadence);
  // R10 Unit 1 — ALWAYS reschedule after a touch. The previous guard keyed on
  // `nextRec.template`, but phone/vm touches legitimately carry a null template
  // (PROSPECTING_SEQUENCE touches 2/4/6 are phone). That left next_touch_due
  // frozen at the prior value, so the row stayed overdue and the card never
  // left the band — the #2 break in the 2026-06-07 cadence audit. Reschedule on
  // any non-blocked recommendation; a null template is valid (phone/vm).
  if (!nextRec.blocked && nextRec.due_at) {
    update.next_touch_template = nextRec.template || null;
    update.next_touch_type = nextRec.type || null;
    update.next_touch_due = nextRec.due_at;
  }

  // Persist
  const patchResult = await opsQuery(
    'PATCH',
    `touchpoint_cadence?id=eq.${pgFilterVal(cadenceId)}`,
    update
  );

  if (!patchResult.ok) {
    return { ok: false, error: 'Failed to update cadence', detail: patchResult.data };
  }

  // R24 Unit 1 — co-locate the template_sends write with the emails_sent bump
  // so the two can NEVER diverge: every email advance that increments
  // emails_sent here also records a template_sends row, feeding the
  // high_performing_templates signal view + the weekly health-rollup. Skipped
  // when (a) the caller already recorded a rich send row (record_send passes
  // skip_template_send=true to avoid a duplicate), or (b) no template is
  // resolvable. Fire-and-forget — a failed record must never block the advance.
  if (touchData.type === 'email' && !touchData.skip_template_send) {
    const tid = touchData.template_id || cadence.last_touch_template || cadence.next_touch_template;
    if (tid) {
      try {
        await recordTemplateSend({
          template_id: tid,
          template_version: touchData.template_version || 1,
          user_id: touchData.user_id || null,
          entity_id: cadence.entity_id || null,
          contact_id: cadence.contact_id || null,
          entity_type: 'contact',
          domain: cadence.domain || null
        });
      } catch (e) {
        console.warn('[advanceCadence] template_sends co-location failed (non-blocking):', e?.message || e);
      }
    }
  }

  return {
    ok: true,
    cadence: patchResult.data?.[0] || { ...cadence, ...update },
    recommendation: nextRec
  };
}

// ============================================================================
// RESOLVE CADENCE FOR AN ENTITY (R24 Unit 2 — reply capture)
// ============================================================================

/**
 * Find the active cadence to advance for an entity, mirroring the SQL trigger's
 * resolution order: (1) a cadence ON the entity directly, then (2) the
 * asset→owner hop — when the entity is the ASSET (to_entity) of an `owns`
 * edge, the OWNER (from_entity) holds the cadence. Restricted to `owns` (true
 * ownership), not brokerage/sale-side edges. Returns the cadence row or null.
 *
 * Used by the reply-capture producer so an inbound reply logged against a
 * property (asset) entity advances the OWNER's cadence — the same hop the
 * organic-touch trigger performs.
 *
 * @param {string} entityId
 * @param {object} [opts] - { phases }
 * @returns {Promise<object|null>}
 */
export async function resolveCadenceForEntity(entityId, opts = {}) {
  if (!entityId) return null;
  const phases = (opts.phases || ['prospecting', 'onboarding', 'steady_state', 'maintenance']).join(',');
  const select = 'select=id,entity_id,bd_opportunity_id,phase,domain';

  // 1. Direct cadence on the entity (most-overdue first).
  const direct = await opsQuery('GET',
    `touchpoint_cadence?entity_id=eq.${pgFilterVal(entityId)}&phase=in.(${phases})`
    + `&order=next_touch_due.asc.nullslast&${select}&limit=1`);
  if (direct.ok && Array.isArray(direct.data) && direct.data[0]) return direct.data[0];

  // 2. Asset→owner hop — entity is the asset; the owner holds the cadence.
  const edges = await opsQuery('GET',
    `entity_relationships?to_entity_id=eq.${pgFilterVal(entityId)}&relationship_type=eq.owns&select=from_entity_id&limit=10`);
  if (edges.ok && Array.isArray(edges.data)) {
    for (const edge of edges.data) {
      if (!edge?.from_entity_id) continue;
      const owner = await opsQuery('GET',
        `touchpoint_cadence?entity_id=eq.${pgFilterVal(edge.from_entity_id)}&phase=in.(${phases})`
        + `&order=next_touch_due.asc.nullslast&${select}&limit=1`);
      if (owner.ok && Array.isArray(owner.data) && owner.data[0]) return owner.data[0];
    }
  }

  // 3. OUTREACH #1 (RC3) contact tier — the entity IS the cadence's contact
  //    person (touchpoint_cadence.contact_id), not its owner entity_id. Mirrors
  //    the SQL trigger's contact tier so an SF touch / inbound reply logged
  //    against the human advances the owner's cadence.
  const asContact = await opsQuery('GET',
    `touchpoint_cadence?contact_id=eq.${pgFilterVal(entityId)}&phase=in.(${phases})`
    + `&order=next_touch_due.asc.nullslast&${select}&limit=1`);
  if (asContact.ok && Array.isArray(asContact.data) && asContact.data[0]) return asContact.data[0];

  return null;
}

// ============================================================================
// HIGH-LEVEL: GET CADENCE STATE FOR DRAFT UI
// ============================================================================

/**
 * One-call convenience for the Draft Email button:
 * Returns current cadence state + next recommendation + context flags.
 *
 * @param {object} ids - { entity_id, sf_contact_id, contact_id }
 * @param {object} propertyInfo - { property_id, property_address, domain }
 * @returns {object} { cadence, recommendation, context_flags }
 */
export async function getCadenceForDraft(ids, propertyInfo = {}) {
  const stateResult = await getCadenceState(ids, propertyInfo);
  if (!stateResult.ok) {
    return stateResult;
  }

  const cadence = stateResult.cadence;
  const recommendation = recommendNextTouch(cadence);

  // Build context flags that the template renderer needs
  const contextFlags = {};

  // Touch 7 = final touch (T-002 needs is_final_touch)
  if (recommendation.touch_number === 7 || recommendation.is_final_touch) {
    contextFlags.is_final_touch = 'true';
  } else if (recommendation.phase === 'prospecting' && recommendation.touch_number >= 2) {
    contextFlags.is_standard_touch = 'true';
  }

  // T-003 mode flags
  if (recommendation.template === 'T-003') {
    if (propertyInfo.domain && (recommendation.touch_number <= 7)) {
      contextFlags.is_outbound_anchored = 'true';
    } else {
      contextFlags.is_mass_broadcast = 'true';
    }
  }

  return {
    ok: true,
    cadence,
    recommendation,
    context_flags: contextFlags,
    is_new: stateResult.is_new,
    summary: buildCadenceSummary(cadence, recommendation)
  };
}

/**
 * Build a human-readable summary for the UI.
 */
function buildCadenceSummary(cadence, recommendation) {
  const parts = [];

  // Phase + touch position
  if (cadence.phase === 'prospecting') {
    parts.push(`Touch ${cadence.current_touch}/7 completed`);
  } else if (cadence.phase === 'maintenance') {
    parts.push('Quarterly maintenance cadence');
  } else {
    parts.push(`Status: ${cadence.phase}`);
  }

  // Tier
  parts.push(`Tier ${cadence.priority_tier}`);

  // Engagement stats
  const stats = [];
  if (cadence.emails_sent > 0) stats.push(`${cadence.emails_sent} emails`);
  if (cadence.calls_made > 0) stats.push(`${cadence.calls_made} calls`);
  if (cadence.meetings_scheduled > 0) stats.push(`${cadence.meetings_scheduled} meetings`);
  if (stats.length > 0) parts.push(stats.join(', '));

  // Next action
  if (recommendation && !recommendation.blocked) {
    const overdue = recommendation.is_overdue ? ' (OVERDUE)' : '';
    parts.push(`Next: ${recommendation.label}${overdue}`);
  } else if (recommendation?.blocked) {
    parts.push(`Blocked: ${recommendation.reason}`);
  }

  return parts.join(' · ');
}

// ============================================================================
// EXPORTS
// ============================================================================

export { PROSPECTING_SEQUENCE, TIER_MULTIPLIERS, COOLDOWNS };
