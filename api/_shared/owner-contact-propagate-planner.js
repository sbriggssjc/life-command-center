// api/_shared/owner-contact-propagate-planner.js
// ============================================================================
// BREAK-1 / Prompt 111 — owner-contact PROPAGATION planner (PURE, no I/O)
// ----------------------------------------------------------------------------
// The decision layer for "we already hold a reachable contact for this owner in
// a domain DB, but the LCC owner entity still reads as unreachable".
//
// Grounded finding this exists to exploit (2026-08-15, live):
//   586 of 690 property-resolved owner entities have NO contact method, and
//   585 of those have no person known at all. But dia/gov `contacts` carries
//   OWNER-BOUND rows (bound by recorded_owner_id / true_owner_id) whose `name`
//   is, in the dominant case, the OWNER'S OWN NAME with a switchboard phone or
//   email — e.g. contact "Easterly Government Properties, Inc." on true_owner
//   "Easterly Government Properties". That is the org's own contact detail
//   sitting one join away from the entity that renders "Find a contact".
//
// The classification is deliberately narrow. Only a NAME-MATCHED owner-bound
// contact auto-fills; everything else is routed to a review lane with its
// reason, never guessed:
//
//   fill_org  — the contact's name resolves to the SAME party as the owner
//               entity (semantic-core equality, or high similarity on a
//               pairable core). Its email/phone IS this party's, so it
//               fill-blanks `entities.email` / `entities.phone`.
//   review    — a real contact we cannot safely attribute: a DIFFERENT named
//               party (a manager, a signatory, an SF contact under the account),
//               a misparse-suspect name, or a fanned-out email. Recoverable by
//               a human; never silently dropped.
//   skip      — nothing to do (no detail, broker role, owner already reachable).
//
// ⚠ Why a name MISMATCH is never auto-attached: writing a named person's
//   personal email onto the owner ORG record is exactly the conflation error
//   `sf-account-link.js` C1/C2 guards against (a person is RELATED to the org,
//   never stamped AS it). Those candidates need the person+edge model, so they
//   go to review here rather than being written the wrong shape.
//
// Guards reused, never forked: `isMisparseName` (TrafficMetrix table-as-contact
// misparse), `isEmailFanoutSuspect` (one email stamped across many parties),
// `normalizeEmail` / `looksLikeContactPhone` (shape), `ownerCore` /
// `nameSimilarity` / `coreIsPairable` (the resolver's own name comparison).
// ============================================================================

import { isMisparseName, isEmailFanoutSuspect } from './tm-misparse.js';
import { normalizeEmail, looksLikeContactPhone } from './entity-link.js';
import { normalizeOwnerName, trigramSimilarity, levenshteinRatio } from './dup-pair-planner.js';

// ---------------------------------------------------------------------------
// IDENTITY core (NOT dup-pair-planner's `ownerCore`).
//
// `ownerCore` additionally strips a generic-CRE STOPLIST (realty, capital,
// income, group, holdings, properties, partners …) because those tokens are
// noise when SCORING a fuzzy pair. They are emphatically NOT noise when asking
// "is this the same party": under `ownerCore`, "Realty Income Corporation"
// collapses to the EMPTY string — so it fails to match ITSELF, and "Agree
// Realty Corp" collapses to the single token "agree", which would happily
// core-match an unrelated "Agree Holdings".
//
// The live dry-run caught exactly that: Realty Income Corporation vs Realty
// Income Corporation was classified `name_mismatch`. So this module uses the
// STRICT core already established as gov doctrine for owner identity
// (government-lease CLAUDE.md §20, `gov_owner_strict_core`): strip ONLY pure
// legal-entity forms, KEEP every semantic token including CO/COMPANY/GROUP/
// PARTNERS/HOLDINGS. Deliberately excludes the bleed-prone short forms
// (pllc/plc/pa/pc/lc/na) for the same reason gov's does.
// ---------------------------------------------------------------------------
export const LEGAL_ENTITY_FORMS = new Set([
  'llc', 'llp', 'lp', 'inc', 'incorporated', 'corp', 'corporation',
  'ltd', 'limited', 'trust', 'reit', 'dst', 'lllp',
]);

/** Semantic identity core: legal forms removed, meaning preserved. */
export function strictOwnerCore(name) {
  const toks = normalizeOwnerName(name).split(' ').filter(Boolean)
    .filter((t) => t.length > 1 && !LEGAL_ENTITY_FORMS.has(t));
  return [...new Set(toks)].sort().join(' ');
}

/** Enough distinctive material to let core equality drive an automatic write. */
export function strictCoreIsSubstantial(core) {
  const toks = String(core || '').split(' ').filter(Boolean);
  if (!toks.length) return false;
  return toks.join('').length >= 5 && toks.some((t) => t.length >= 3);
}

// A contact filling a BROKER role represents the party's counterparty-facing
// agent, not the party. The deal-spine discipline (CLAUDE.md) treats a
// CoStar-sourced broker edge as `third_party` until our own systems confirm it,
// so a broker row is never a source of the owner's contact detail.
export const BROKER_CONTACT_TYPES = new Set([
  'broker', 'listing_broker', 'purchasing_broker', 'l_broker', 'p_broker', 'agent',
]);

// Similarity floor for treating two names as the SAME party when their semantic
// cores are not byte-equal ("Blackstone Inc." vs "Blackstone Group"). Set high:
// this decides an automatic write, and the fallback (review) is cheap.
export const NAME_MATCH_MIN_SIMILARITY = 0.92;

/**
 * Do these two names denote the same party, conservatively? Three arms, in
 * descending certainty; first match wins:
 *
 *   name_exact  — the punctuation/case-normalized names are identical. Always a
 *                 match; no core reduction can veto a literal string equality.
 *   core_exact  — identical STRICT identity cores (legal forms stripped, meaning
 *                 kept) that carry enough distinctive material. Catches
 *                 "Blackstone" ↔ "Blackstone Inc." without letting a one-token
 *                 remnant collapse two unrelated parties.
 *   similarity  — near-identical STRICT cores (spelling drift only). Scored on
 *                 the strict cores, NOT via dup-pair-planner's `nameSimilarity`:
 *                 that scores the stoplist core, so "Agree Realty Corp" and
 *                 "Agree Holdings LLC" both reduce to "agree" and score 1.0 —
 *                 a false positive the live dry-run surfaced.
 *
 * @returns {{match:boolean, how:'name_exact'|'core_exact'|'similarity'|null, score:number}}
 */
export function sameParty(aName, bName) {
  const na = normalizeOwnerName(aName);
  const nb = normalizeOwnerName(bName);
  if (!na || !nb) return { match: false, how: null, score: 0 };
  if (na === nb) return { match: true, how: 'name_exact', score: 1 };

  const ca = strictOwnerCore(aName);
  const cb = strictOwnerCore(bName);
  if (!strictCoreIsSubstantial(ca) || !strictCoreIsSubstantial(cb)) {
    return { match: false, how: null, score: 0 };
  }
  if (ca === cb) return { match: true, how: 'core_exact', score: 1 };

  const score = Math.max(trigramSimilarity(ca, cb), levenshteinRatio(ca, cb));
  if (score >= NAME_MATCH_MIN_SIMILARITY) return { match: true, how: 'similarity', score };
  return { match: false, how: null, score };
}

/**
 * Classify one (owner entity, domain contact) pair. PURE.
 *
 * @param owner    {{ id, name, email, phone }}  the LCC owner entity as it stands
 * @param contact  {{ id, name, email, phone, contact_type, data_source, domain,
 *                    owner_bound_by }}          the domain `contacts` row
 * @param opts     {{ fanout?:number }}          how many DISTINCT owners share
 *                                               this contact's email/phone
 * @returns {{action:'fill_org'|'review'|'skip', reason:string, fields?:{email?:string,phone?:string},
 *            evidence?:object, match?:object}}
 */
export function classifyOwnerContact(owner, contact, opts = {}) {
  const ownerName = String((owner && owner.name) || '').trim();
  const cName = String((contact && contact.name) || '').trim();
  const ctype = String((contact && contact.contact_type) || '').trim().toLowerCase();

  if (!owner || !owner.id) return { action: 'skip', reason: 'no_owner' };
  if (!ownerName) return { action: 'skip', reason: 'owner_unnamed' };
  if (!cName) return { action: 'skip', reason: 'contact_unnamed' };

  // A broker row never supplies the owner's contact detail.
  if (BROKER_CONTACT_TYPES.has(ctype)) return { action: 'skip', reason: 'broker_role' };

  // Shape-validate BEFORE anything else decides — a row whose "email" is junk
  // and whose "phone" is a label carries nothing, whatever its name says.
  const email = normalizeEmail(contact && contact.email);
  const phoneRaw = String((contact && contact.phone) || '').trim();
  const phone = looksLikeContactPhone(phoneRaw) ? phoneRaw : '';
  if (!email && !phone) return { action: 'skip', reason: 'no_contact_detail' };

  // Fill-blanks only: never overwrite curated contact detail already on the
  // owner. If both slots are full there is nothing this worker may do.
  const ownerEmail = String((owner && owner.email) || '').trim();
  const ownerPhone = String((owner && owner.phone) || '').trim();
  const fields = {};
  if (email && !ownerEmail) fields.email = email;
  if (phone && !ownerPhone) fields.phone = phone;
  if (!Object.keys(fields).length) return { action: 'skip', reason: 'nothing_to_fill' };

  // TrafficMetrix-class misparse (street names / table headers minted as
  // contacts). Recoverable → review, never a silent drop.
  if (isMisparseName(cName)) {
    return { action: 'review', reason: 'misparse_name', evidence: { contact_name: cName.slice(0, 200) } };
  }

  // One email/phone stamped across many distinct owners is a fan-out artifact,
  // not a per-owner switchboard.
  if (isEmailFanoutSuspect(opts.fanout)) {
    return {
      action: 'review', reason: 'contact_fanout',
      evidence: { contact_name: cName.slice(0, 200), fanout: Number(opts.fanout) || 0 },
    };
  }

  const match = sameParty(ownerName, cName);
  if (!match.match) {
    // A real, differently-named party (manager / signatory / SF contact). It is
    // very likely the decision-maker we are looking for — but attaching it as
    // the ORG's own detail would conflate a person with the entity, so a human
    // decides. Sized and surfaced, not guessed.
    return {
      action: 'review', reason: 'name_mismatch',
      evidence: { owner_name: ownerName.slice(0, 200), contact_name: cName.slice(0, 200), score: Number(match.score.toFixed(3)) },
    };
  }

  return {
    action: 'fill_org', reason: 'owner_self_contact', fields,
    match: { how: match.how, score: Number(match.score.toFixed(3)) },
    evidence: { owner_name: ownerName.slice(0, 200), contact_name: cName.slice(0, 200) },
  };
}

/**
 * Choose ONE winning contact per owner from that owner's candidate rows, and
 * collect every non-winning decision so nothing is silently discarded.
 *
 * Ranking is deterministic (no LLM, no randomness): a candidate that fills BOTH
 * blanks beats one that fills a single slot; email outranks phone (an email is
 * the outreach channel the cadence actually uses); ties break on the stronger
 * name match, then on the contact id so the same input always yields the same
 * winner.
 *
 * @param owner       the LCC owner entity
 * @param candidates  domain contact rows for this owner
 * @param opts        {{ fanoutByKey?: Map<string,number> }}
 * @returns {{winner:object|null, reviews:Array, skipped:Array}}
 */
export function planOwnerPropagation(owner, candidates, opts = {}) {
  const fanoutByKey = opts.fanoutByKey instanceof Map ? opts.fanoutByKey : new Map();
  const decided = [];
  const reviews = [];
  const skipped = [];

  for (const c of (Array.isArray(candidates) ? candidates : [])) {
    const key = contactFanoutKey(c);
    const d = classifyOwnerContact(owner, c, { fanout: key ? fanoutByKey.get(key) : 0 });
    const row = { contact: c, decision: d };
    if (d.action === 'fill_org') decided.push(row);
    else if (d.action === 'review') reviews.push(row);
    else skipped.push(row);
  }

  decided.sort((a, b) => {
    const rank = (r) => {
      const f = r.decision.fields || {};
      return (f.email ? 2 : 0) + (f.phone ? 1 : 0);
    };
    const dr = rank(b) - rank(a);
    if (dr) return dr;
    const ds = (b.decision.match?.score || 0) - (a.decision.match?.score || 0);
    if (ds) return ds;
    return String(a.contact?.id || '').localeCompare(String(b.contact?.id || ''));
  });

  const winner = decided[0] || null;
  // Runners-up are not failures — they are the same party's other rows. Record
  // them as skipped-with-reason so the dry-run total always reconciles.
  for (const r of decided.slice(1)) {
    skipped.push({ contact: r.contact, decision: { action: 'skip', reason: 'superseded_by_better_candidate' } });
  }
  return { winner, reviews, skipped };
}

/** Stable fan-out key for a contact's reachable detail (email preferred). */
export function contactFanoutKey(contact) {
  const e = normalizeEmail(contact && contact.email);
  if (e) return 'email:' + e;
  const p = String((contact && contact.phone) || '').replace(/\D/g, '');
  return p ? 'phone:' + p : '';
}
