// api/_shared/contact-authority.js
// ============================================================================
// Contact authority hierarchy + org-aware role model + buyer/seller mode.
// ----------------------------------------------------------------------------
// The JS mirror of the SQL in
// supabase/migrations/20260730120000_lcc_contact_authority_hierarchy.sql — keep
// the two in sync. The SQL views/pivot are the source of truth for the priority
// queue + CONTACT-SELECTION surface; this module gives the workers + agents the
// SAME reasoning (and makes it unit-testable).
//
// Doctrine (ORE_REALIGNMENT §9): contact selection is authority-weighted (a
// signer / managing member / notice individual OUTRANKS a CoStar "ownership
// contact"), org-structure-aware (individual for a small LLC, role-separated for
// a REIT), with a parallel experience/direction lane, and it must never stall.
// Pure — no I/O. All additive / reversible.
// ============================================================================

/**
 * Unit 1 — canonical contact-authority weight (LOWER = MORE authoritative).
 * Mirrors `lcc_contact_authority_weight(source, role)`.
 *   1  deed / loan SIGNATORY or EXECUTOR (bound the entity)
 *   2  controlling SOS role: managing member / GP / manager / sole member
 *   3  named principal / officer / trustee / notice individual / authorized
 *      signatory / economic (beneficial) owner
 *   4  registered agent
 *   6  captured "ownership contact" (CoStar / generic / prospecting)
 *   8  naming / inference (no authority signal)
 * @param {string} source  the attach `via` (deed_lookup / sos_lookup / address_lookup / …)
 * @param {string} role    the captured contact role (signatory / managing_member / …)
 * @returns {number}
 */
export function contactAuthorityWeight(source, role) {
  const r = String(role || '').toLowerCase();
  const s = String(source || '').toLowerCase();
  // 1 signer / executor
  if (/(signatory|signer|executor)/.test(r) || /(deed|loan)/.test(s)) return 1;
  // 2 controlling SOS role
  // NOTE: keyed on the controlling ROLE, not a bare `sos` via — an SOS lookup
  // can return a managing member (2) OR a registered agent (4); the role decides.
  if (/(managing[_ ]?member|general[_ ]?partner|\bgp\b|sole[_ ]?member|\bmanager\b|\bmgr\b|\bmbr\b|\bambr\b|controlling)/.test(r)
      || /managing[_ ]?member/.test(s)) return 2;
  // 3 named principal / officer / trustee / notice individual / authorized signatory / economic owner
  if (/(principal|president|\bceo\b|officer|\bcfo\b|\bcoo\b|secretary|treasurer|trustee|authorized|notice|economic|beneficial|\bvp\b|\bap\b)/.test(r)
      || /(address)/.test(s)) return 3;
  // 4 registered agent
  if (/(registered[_ ]?agent|reg_agent|\bagent\b)/.test(r)) return 4;
  // 8 naming / inference
  if (/(cross_reference|naming|web_search|inference)/.test(s)) return 8;
  // 6 captured ownership contact
  return 6;
}

/**
 * Human-readable authority tier for a weight — for surfacing WHY a contact is
 * ranked where it is. Pure.
 */
export function authorityTier(weight) {
  switch (Number(weight)) {
    case 1: return 'signatory';
    case 2: return 'controlling';
    case 3: return 'principal';
    case 4: return 'registered_agent';
    case 8: return 'inference';
    default: return 'captured';
  }
}

/** True when `a` is at least as authoritative as `b` (lower weight wins). */
export function outranksOrTies(a, b) {
  return contactAuthorityWeight(a.source, a.role) <= contactAuthorityWeight(b.source, b.role);
}

// ---------------------------------------------------------------------------
// Unit 2 — org-archetype role model.
// ---------------------------------------------------------------------------
const INSTITUTION_RE = /\b(reit|real estate investment trust|capital|advisors|advisers|asset management|investment management|investments?|financial|bancorp|bank|insurance|mutual|securities|equities|pension|endowment|sovereign|trust company)\b/i;

/**
 * `individual_led` — a small LLC / founder-led owner: the managing member /
 *  signer / notice individual IS the target.
 * `role_separated` — a REIT / institution with functional teams: model roles
 *  (seller work → disposition; buyer work → acquisition).
 * @param {{archetype?:string, sponsorName?:string}} o
 * @returns {'individual_led'|'role_separated'}
 */
export function roleModel({ archetype, sponsorName } = {}) {
  if (archetype === 'institutional' && sponsorName && INSTITUTION_RE.test(sponsorName)) {
    return 'role_separated';
  }
  return 'individual_led';
}

/**
 * The functional role to TARGET given the role model + prospect mode.
 * role_separated: seller → disposition, buyer → acquisition.
 * individual_led: the controlling individual either way.
 */
export function targetRole(model, mode) {
  if (model === 'role_separated') return mode === 'buyer' ? 'acquisition' : 'disposition';
  return 'controlling_individual';
}

// ---------------------------------------------------------------------------
// Unit 4 — buyer vs seller prospect mode + resonant touch theme.
// ---------------------------------------------------------------------------
/**
 * @param {{isBuyer?:boolean}} o  isBuyer = a registered repeat-buyer parent / SPE (R5)
 * @returns {'buyer'|'seller'}
 */
export function prospectMode({ isBuyer } = {}) {
  return isBuyer ? 'buyer' : 'seller';
}

/**
 * The resonant touch theme for a mode. buyer → 'value_early_access' (early /
 * off-market product access). seller → 'location_bluesuit' ("you own this, I
 * sell this" — tenant/asset-type + a comparable we closed/listed).
 */
export function touchTheme(mode) {
  return mode === 'buyer' ? 'value_early_access' : 'location_bluesuit';
}

// ---------------------------------------------------------------------------
// Unit 3 — control vs directed intensity (read the pivot; never stall).
// ---------------------------------------------------------------------------
/**
 * Given a pivot row, resolve the intended per-contact outreach intensity. The
 * CONTROL contact stays the control anchor; a handoff LIGHTENS (never drops) it
 * and works the DIRECTED contact fully. Pure — a helper for the draft/cadence
 * surface to read (the pivot is the truth).
 * @returns {{control:{name:?string,intensity:string}, directed:?{name:string,intensity:string}}}
 */
export function contactIntensity(pivot = {}) {
  const control = {
    name: pivot.active_contact_name || null,
    intensity: pivot.control_intensity || 'full',
  };
  const directed = pivot.directed_contact_name
    ? { name: pivot.directed_contact_name, intensity: pivot.directed_intensity || 'full' }
    : null;
  return { control, directed };
}

// ---------------------------------------------------------------------------
// Unit 5 — never-stall: the authority lane always yields a disposition.
// ---------------------------------------------------------------------------
/**
 * Resolve the next best DISPOSITION for an owner from its active-contact/pivot
 * row — NEVER a hard block. Either a reachable control contact, or a routed
 * enrichment action, or (last resort) manual research. The authority lane keeps
 * working without waiting on a manual "who to call" decision.
 * @returns {{disposition:'work_contact'|'enrich'|'manual_research', ...}}
 */
export function contactDisposition(row = {}) {
  if (row.active_contact_entity_id || (row.active_contact_name && row.is_named_individual)) {
    return { disposition: 'work_contact', contact: row.active_contact_name || null,
      authority: row.active_authority_level ?? null };
  }
  const action = row.enrichment_action;
  if (action && action !== 'manual_research') {
    return { disposition: 'enrich', enrichment_action: action };
  }
  return { disposition: 'manual_research', enrichment_action: action || 'manual_research' };
}
