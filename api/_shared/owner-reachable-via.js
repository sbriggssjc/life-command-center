// api/_shared/owner-reachable-via.js
// ============================================================================
// Prompt 114 / BREAK-1 Unit 2 — "reach this owner VIA a linked person" resolver
// ----------------------------------------------------------------------------
// PURE, no I/O. The single source of truth for the question the owner panel hero
// could not previously ask: *we hold no contact detail on this owner ORG, but a
// person linked to it carries an email/phone — which one do we surface?*
//
// THE DEFECT THIS CLOSES (grounded live 2026-08-15, v_lcc_owner_reachability):
//   690 property-resolved owner entities. reachable_graph 139, reachable_hero 92.
//   The 47-owner difference is owners the DATA can reach and the UI cannot:
//   `buildContact360` builds `subject.email` from `entities.email` or a
//   `unified_contacts` row whose entity_id IS the owner, and never walks
//   `entity_relationships` to a linked person. So attaching a person + edge —
//   the doctrinally correct write — changed nothing on screen. That is a pure UI
//   defect, and it is what this module + the c360 fold-in fix.
//
// ⚠ THE THING THIS MODULE MUST NOT DO — blur a person into the org.
//   `subject.email` means "this ORG's own contact detail". A linked person's
//   email is a DIFFERENT claim ("reach the org through this human"), and
//   collapsing the two would (a) tell the operator the org has an address it
//   does not, and (b) re-commit the person/org conflation `sf-account-link.js`
//   guards against. So the resolver returns a SEPARATE `reachable_via`
//   descriptor and the panel renders "reach via Eric Dowling (manager)". The
//   hero advances off "Find a contact"; the org record stays honest.
//
// ⚠ WHY THE SELECTION RULE IS EXPLICIT, RANKED AND TESTED — "first row wins" is
//   the exact bug class that produced the gov `ensureTrueOwner` substring defect
//   (government-lease CLAUDE.md §20: an unanchored `ilike.*X*&limit=1` first-row
//   match was the SOLE source of gov true_owner links). An org with several
//   linked people must resolve the same way on every render, on every surface,
//   forever — so the order is declared here, ranked, and covered by a regression
//   test rather than left to whatever the database returned first.
// ============================================================================

import { normalizeEmail, looksLikeContactPhone, isJunkEntityName } from './entity-link.js';
import { isMisparseName } from './tm-misparse.js';

// ---------------------------------------------------------------------------
// Roles that are NEVER the owner's own reachable contact.
//
// A broker represents the counterparty-facing agent, not the party (the deal-
// spine discipline treats a CoStar-sourced broker edge as `third_party` until
// our own systems confirm it). Surfacing a listing broker as "reach the owner
// via ..." would send outreach to the wrong human — the most expensive possible
// failure of this feature — so broker-ish roles are excluded outright rather
// than merely ranked last.
// ---------------------------------------------------------------------------
export const NON_REACHABLE_ROLES = new Set([
  'broker', 'broker_of_record', 'listing_broker', 'purchasing_broker',
  'l_broker', 'p_broker', 'agent', 'tenant', 'operator',
]);

// Role authority ladder. LOWER rank = stronger claim to "this is who you call".
// Anything unlisted lands at UNKNOWN_ROLE_RANK — below every named role but
// still selectable, because a bare `associated_with` edge with a real email is
// materially better than nothing.
export const ROLE_RANK = {
  decision_maker: 10,
  principal: 15,
  managing_member: 20,
  manager: 25,
  member: 30,
  owner: 35,
  trustee: 40,
  officer: 45,
  signatory: 50,
  deed_signatory: 55,
  prospecting_contact: 60,
  seller_contact: 65,
  true_seller_contact: 65,
  true_buyer_contact: 70,
  contact: 75,
  works_at: 80,
  associated_with: 85,
};
export const UNKNOWN_ROLE_RANK = 90;

// ---------------------------------------------------------------------------
// WEAK ASSOCIATION (P161, 2026-08-21).
//
// These roles prove a person is CONNECTED to the org. They never prove the
// person CONTROLS the decision. `works_at` is the Salesforce-account org edge —
// 8,506 of them — i.e. the same bare-SF signal class P112 disqualified as a BD
// signal for cadences. Measured live: 158 owners were being called "reachable"
// on nothing but one of these edges, 48 of them carrying $153.8M of annual rent.
//
// Distinct from NON_REACHABLE_ROLES above. A broker is excluded OUTRIGHT — it is
// the wrong human, at any deal size. A weak association is the RIGHT
// organisation and an unproven human, so it is VALUE-GATED instead: acceptable
// for a small LLC/SPE (where the SF contact is plausibly the principal), not for
// a $24M owner (where they are an employee).
//
// ⚠️ THE GATE ITSELF IS NOT EVALUATED HERE, DELIBERATELY. Re-implementing the
// rent rule in JS would be exactly the normaliser drift this codebase keeps
// getting bitten by (lcc_normalize_entity_name, _opsSparkline, gov_owner_strict_core).
// The single definition lives in SQL — `v_lcc_weak_reach_worklist`, built on
// `lcc_is_weak_association_role` + `lcc_weak_role_value_floor` — and the caller
// passes the DB's verdict in as `opts.weakAssociationGated`. One rule, one place.
// ---------------------------------------------------------------------------
export const WEAK_ASSOCIATION_ROLES = new Set(['works_at', 'associated_with', 'contact']);

/** True for a role that proves association but not control over the decision. */
export function isWeakAssociationRole(role) {
  const r = String(role || '').trim().toLowerCase();
  // An ABSENT role is weak, never strong — unknown is not a promotion.
  if (!r) return true;
  return WEAK_ASSOCIATION_ROLES.has(r);
}

export function roleRank(role) {
  const r = String(role || '').trim().toLowerCase();
  if (!r) return UNKNOWN_ROLE_RANK;
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, r) ? ROLE_RANK[r] : UNKNOWN_ROLE_RANK;
}

/** True for a role that must never be offered as the owner's reachable contact. */
export function isNonReachableRole(role) {
  return NON_REACHABLE_ROLES.has(String(role || '').trim().toLowerCase());
}

/**
 * Normalize one linked-person candidate into the resolver's shape. Returns null
 * when the candidate carries nothing usable — the shape guards run BEFORE any
 * ranking so a junk row can never win by virtue of a strong role.
 *
 * @param p {{ person_id, name, email, phone, role, is_primary, verified_at,
 *            updated_at, source, relationship_id }}
 * @returns {{person_id,name,email,phone,role,is_primary,verified_at,source,
 *            relationship_id,_rank}|null}
 */
export function normalizeReachableCandidate(p) {
  if (!p || !p.person_id) return null;
  const name = String(p.name || '').trim();
  if (!name) return null;
  // Junk / TrafficMetrix-class misparse names never become a reachable contact.
  // A phantom "Collection Street" carrying the page's one real email is exactly
  // the fan-out artifact Prompt 89 chased out of the graph; surfacing it as the
  // owner's decision-maker would re-introduce it through the front door.
  if (isMisparseName(name) || isJunkEntityName(name)) return null;

  const role = String(p.role || '').trim().toLowerCase();
  if (isNonReachableRole(role)) return null;

  const email = normalizeEmail(p.email) || '';
  const phoneRaw = String(p.phone || '').trim();
  const phone = looksLikeContactPhone(phoneRaw) ? phoneRaw : '';
  if (!email && !phone) return null;

  return {
    person_id: String(p.person_id),
    name,
    email: email || null,
    phone: phone || null,
    role: role || null,
    is_primary: p.is_primary === true,
    verified_at: p.verified_at || p.updated_at || null,
    source: p.source || null,
    relationship_id: p.relationship_id || null,
  };
}

/** Descending-comparable timestamp; an unparseable/absent stamp sorts last. */
function timeKey(v) {
  if (!v) return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

/**
 * THE RULE. Pick the single person through whom this owner is reachable.
 *
 * Deterministic, total, and documented — evaluated in this order, first
 * difference wins:
 *
 *   1. EXPLICIT PRIMARY. An operator/curated `is_primary` flag beats every
 *      inference. If a human already said "this is the contact", we obey.
 *   2. ROLE AUTHORITY (`ROLE_RANK`, lower = stronger). A managing member
 *      outranks a bare `associated_with` edge. Broker-ish roles were already
 *      removed by `normalizeReachableCandidate` — they are not ranked last, they
 *      are not candidates.
 *   3. CHANNEL. A person with an email beats a phone-only person: email is the
 *      channel the cadence/draft path actually uses.
 *   4. MOST RECENT VERIFIED. Newer `verified_at`/`updated_at` wins — a contact
 *      re-confirmed last month beats one last touched in 2019.
 *   5. STABLE TIEBREAK. `person_id` ascending. NEVER "whatever the query
 *      returned first" — that non-determinism is the defect class this module
 *      exists to avoid.
 *
 * @param candidates array of raw linked-person records
 * @returns {{winner:object|null, considered:number, rejected:number, others:Array}}
 */
export function pickReachableVia(candidates) {
  const raw = Array.isArray(candidates) ? candidates : [];
  const pool = [];
  for (const c of raw) {
    const n = normalizeReachableCandidate(c);
    if (n) pool.push(n);
  }

  pool.sort((a, b) => {
    // 1. explicit primary
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    // 2. role authority (lower rank = stronger)
    const dr = roleRank(a.role) - roleRank(b.role);
    if (dr) return dr;
    // 3. email beats phone-only
    const ch = (b.email ? 1 : 0) - (a.email ? 1 : 0);
    if (ch) return ch;
    // 4. most recent verified
    const dt = timeKey(b.verified_at) - timeKey(a.verified_at);
    if (dt) return dt;
    // 5. stable id tiebreak
    return a.person_id.localeCompare(b.person_id);
  });

  return {
    winner: pool[0] || null,
    considered: pool.length,
    rejected: raw.length - pool.length,
    others: pool.slice(1),
  };
}

/**
 * The panel-facing descriptor. Deliberately NOT merged into `subject.email` —
 * see the header note. `via_count` lets the UI say "…and 2 others" without a
 * second query, and keeps the count honest.
 */
export function buildReachableVia(candidates, opts = {}) {
  const { winner, considered, others } = pickReachableVia(candidates);
  if (!winner) return null;

  // P161 — the weak-association value gate. `opts.weakAssociationGated` is the
  // DB's verdict (membership in v_lcc_weak_reach_worklist), never a rule
  // re-derived here. It only bites when the winner is ALSO weak: an owner with a
  // manager or institution_decision_maker edge is never in that worklist, so the
  // two conditions agree by construction and the redundancy is a cheap guard
  // against a caller passing the flag for the wrong entity.
  //
  // Returns a GATED descriptor rather than null on purpose. null means "we found
  // nobody", which is a different fact and would send the panel's next-action to
  // a generic "Find a contact". This says: we found someone, they are not
  // established as the decision-maker, and here is who we withheld — so the
  // operator can judge, and the contact-acquisition engine has a target.
  if (opts.weakAssociationGated === true && isWeakAssociationRole(winner.role)) {
    return {
      gated: true,
      gate_reason: opts.gateReason || 'weak_association_unqualified',
      withheld_name: winner.name,
      withheld_role: winner.role || 'associated_with',
      via_count: considered,
      // No person_id / email / phone. A gated route must not be dialable by
      // accident — that is the whole point of the gate.
      person_id: null, name: null, role: null, email: null, phone: null,
      source: winner.source || null, is_primary: false, other_people: [],
    };
  }

  return {
    person_id: winner.person_id,
    name: winner.name,
    role: winner.role,
    email: winner.email,
    phone: winner.phone,
    source: winner.source,
    is_primary: winner.is_primary,
    via_count: considered,
    other_people: others.slice(0, 5).map((o) => ({ person_id: o.person_id, name: o.name, role: o.role })),
  };
}

export default buildReachableVia;
