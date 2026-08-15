// api/_shared/owner-contact-verdict-planner.js
// ============================================================================
// Prompt 114 / BREAK-1 Unit 1 — the owner-contact review lane's VERDICT model
// ----------------------------------------------------------------------------
// PURE, no I/O. Decides which verdicts a lane row may legally receive, so the
// confirm path can never write the WRONG SHAPE for the candidate in front of it.
//
// ⚠ GROUNDING CORRECTION — the lane is NOT 101 decision-makers.
//   Prompt 114's brief describes the 101 pending rows as "verbatim-evidenced
//   candidate decision-makers (Eric Dowling, Delos Yancey, Lee Elman, Daniel
//   Brower, …)". Live inspection of every row (2026-08-15) says otherwise:
//
//     ~23 of 101 rows carry a PERSON-shaped name. The other ~78 are ORGANIZATION
//     names, and they split into three very different classes:
//
//     (a) TRANSACTION COUNTERPARTIES — the dominant class. The domain `contacts`
//         row is the BUYER or SELLER of a sale on the owner's property, captured
//         by the CoStar sidebar. "NGP Capital" ← "CoreCivic, Inc.", "Realty
//         Income Corporation" ← "American Realty Capital LLC", "Boyd Watterson"
//         ← "CIM Group, LP". These are a DIFFERENT company that transacted with
//         our owner. They are REJECTS. Attaching CoreCivic's switchboard as NGP
//         Capital's contact would be a straightforward data corruption, and it is
//         what a naive "confirm = attach the candidate" lane would have done to
//         the majority of this backlog.
//     (b) SAME-PARTY NAME VARIANTS the strict-core matcher could not see through,
//         because the difference is an ABBREVIATION or an ACRONYM rather than a
//         legal form: "Easterly Gov Properties (REIT)" ↔ "Easterly Government
//         Properties, Inc."; "Four Springs Cap Trust" ↔ "Four Springs Capital
//         Trust"; "Sovereign Investment Co" ↔ "Sovereign Investment Company";
//         "UIRC" ↔ "UIRC, Urban Investment Research Corporation". Prompt 111 was
//         RIGHT to refuse these automatically (`strictOwnerCore` deliberately
//         does not expand abbreviations — that is how you get "Agree Realty" ↔
//         "Agree Holdings"). But a human can see them instantly, and the correct
//         write for them is the ORG fill, not a person edge.
//     (c) A federal/agency counterparty ("US Government" ← "U.S. Department of
//         Veterans Affairs") — never a contact under any verdict.
//
// SO: a single "confirm" button would be wrong for ~78% of this lane. The lane
// needs SHAPE-AWARE verdicts, and the server must REFUSE a verdict that does not
// match the candidate's shape — an operator misclick must not be able to mint
// "Easterly Government Properties, Inc." as a PERSON entity, nor stamp a real
// human's personal email onto an owner ORG record.
//
//   attach_person — the candidate is a HUMAN. Mint/resolve a `person` entity,
//                   carry its email/phone onto THAT person, and link it to the
//                   owner org through `entity_relationships` with a role. The
//                   person is RELATED to the org, never stamped AS it
//                   (`sf-account-link.js` C1/C2). Requires person shape.
//   same_party    — the candidate is an ORG name variant of the owner itself.
//                   Fill-blanks `entities.email`/`phone` on the OWNER — exactly
//                   the `fill_org` write Prompt 111's planner refused to make
//                   automatically, now human-asserted. Requires ORG shape.
//   reject        — a first-class, RECORDED outcome (the counterparties above).
//                   A rejected row is never re-proposed: the seeder is idempotent
//                   on `subject_ref`, so `status='rejected'` is terminal.
//
// Nothing here writes; `admin.js` performs the write and re-runs these guards
// server-side before it does.
// ============================================================================

import { looksLikePersonName, isJunkEntityName, normalizeEmail, looksLikeContactPhone } from './entity-link.js';
import { isMisparseName } from './tm-misparse.js';
import { isFederalOwnerAntiPattern } from './ingest-contract.js';
import { normalizeOwnerName } from './dup-pair-planner.js';
import { sameParty, strictOwnerCore, strictCoreIsSubstantial } from './owner-contact-propagate-planner.js';

export const VERDICT_ATTACH_PERSON = 'attach_person';
export const VERDICT_SAME_PARTY = 'same_party';
export const VERDICT_REJECT = 'reject';

// Candidate shapes. `blocked` still accepts `reject` — a row we refuse to act on
// is closed by a human, not silently dropped (Consumption-Layer: reversible,
// never hard-deleted).
export const SHAPE_PERSON = 'person';
export const SHAPE_ORG = 'org';
export const SHAPE_BLOCKED = 'blocked';

// A contact row filling one of these roles is the COUNTERPARTY to a transaction
// on the owner's property, not the owner's own contact. Carried through to the
// card so the operator sees WHY the lane is pre-leaning reject.
export const COUNTERPARTY_CONTACT_TYPES = new Set([
  'buyer', 'seller', 'buyer_seller', 'true_buyer_contact', 'true_seller_contact',
]);

// Broker-ish roles never supply the owner's contact under ANY verdict (same rule
// as the propagation planner — reused, not forked).
export const BROKER_CONTACT_TYPES = new Set([
  'broker', 'listing_broker', 'purchasing_broker', 'l_broker', 'p_broker', 'agent', 'broker_of_record',
]);

/**
 * Map the domain `contacts.contact_type` onto the relationship role we stamp on
 * the person→owner edge. Deliberately conservative: an unknown/absent type
 * becomes the neutral `prospecting_contact` rather than inventing authority the
 * source never claimed (never fabricate).
 */
export function relationshipRoleForContactType(contactType) {
  const t = String(contactType || '').trim().toLowerCase();
  if (!t) return 'prospecting_contact';
  if (t === 'landlord' || t === 'owner') return 'principal';
  if (t === 'manager' || t === 'property_manager') return 'manager';
  if (t === 'managing_member') return 'managing_member';
  if (t === 'signatory' || t === 'deed_signatory') return 'signatory';
  if (COUNTERPARTY_CONTACT_TYPES.has(t)) return 'prospecting_contact';
  return 'prospecting_contact';
}

// ---------------------------------------------------------------------------
// PERSON-vs-ORG discrimination.
//
// `looksLikePersonName` answers "could a human be called this?" — it checks
// token count and character shape. That is the right question at a contact-mint
// boundary but NOT here, because it accepts multi-word organization names that
// happen to carry no legal suffix. Live proof from this very lane:
// "U.S. Department of Veterans Affairs" is five letter-only tokens and passes
// `looksLikePersonName` cleanly. Minting THAT as a `person` entity is precisely
// the corruption this module exists to prevent.
//
// So person shape = looksLikePersonName AND no organization marker. The marker
// list is intentionally narrow and org-STRUCTURAL (a legal form, a corporate
// body word, or a business-function word), never a surname that merely reads
// corporate — "Mark Cali", "John Bruzzone", "Delos Yancey" must all survive.
// ---------------------------------------------------------------------------
const ORG_MARKER_RE = new RegExp(
  '\\b(?:'
  + 'llc|l\\.l\\.c|llp|lp|inc|incorporated|corp|corporation|co|company|companies'
  + '|ltd|limited|plc|pllc|trust|reit|dst|lllp|fund|funds|holdings?|group'
  + '|partners?|partnership|associates?|ventures?|capital|properties|property'
  + '|realty|management|mgmt|investments?|investors?|enterprises?|development'
  + '|developers?|bank|bancorp|insurance|department|agency|administration'
  + '|authority|bureau|commission|district|university|college|hospital|church'
  + '|foundation|institute|association|services|solutions|systems|industries'
  + '|equity|advisors?|acquisitions?|portfolio|estates?|land|leasing|finance'
  // `lease`/`leases` earn their place from live data: "Global Net Lease" is
  // three letter-only tokens and sailed through `looksLikePersonName` in the
  // first full-lane run, i.e. a REIT was one confirm away from being minted as
  // a human being.
  + '|lease|leases'
  + ')\\b', 'i');

/**
 * True when the name carries a structural organization marker. Exported so the
 * lane card, the tests, and the server-side verdict gate all read one rule.
 */
export function hasOrgMarker(name) {
  return ORG_MARKER_RE.test(String(name || ''));
}

// A GOVERNMENT BODY is never a private owner's reachable contact — it is the
// tenant or the transacting agency. Blocked outright (reject only), so no
// verdict can attach "U.S. Department of Veterans Affairs" to an owner.
//
// ⚠ This does NOT duplicate `isFederalOwnerAntiPattern`. That guard was checked
// live against this lane's own rows and returns FALSE for both "U.S. Department
// of Veterans Affairs" and "General Services Administration" — it targets a
// different pattern (a federal TENANT captured as the property's owner). This
// is the narrow complement the lane needs, kept next to the shape rules that use
// it rather than widening a guard other callers depend on.
const GOV_BODY_RE = new RegExp(
  '(?:^|\\b)(?:u\\.?s\\.?|united\\s+states|federal|state\\s+of|county\\s+of|city\\s+of|commonwealth)\\b'
  + '|\\b(?:department|administration|bureau|commission|authority|agency)\\s+of\\b'
  + '|\\bdepartment\\s+of\\b|\\bgeneral\\s+services\\s+administration\\b'
  + '|\\b(?:gsa|usps|va|dhs|ssa|fbi|irs)\\b\\s*(?:office|regional|district)?$', 'i');

/** True for a government body / agency name. Reject-only in this lane. */
export function isGovernmentBodyName(name) {
  const t = String(name || '').trim();
  if (!t) return false;
  return GOV_BODY_RE.test(t) || isFederalOwnerAntiPattern(t);
}

/** Person shape for THIS lane: human-shaped AND carrying no org marker. */
export function isPersonShaped(name) {
  return looksLikePersonName(name) && !hasOrgMarker(name);
}

/**
 * Does this candidate's name plausibly denote the SAME party as the owner once a
 * human allows for abbreviation/acronym drift? This does NOT decide anything —
 * `same_party` is always a human verdict — it only supplies the card with an
 * honest hint so the operator can triage class (b) quickly and is not nudged
 * toward confirming a counterparty.
 *
 * Three cheap, conservative signals. Note they are computed on the STRICT
 * identity cores (never `dup-pair-planner.ownerCore`, which strips a generic-CRE
 * stoplist and would score "Agree Realty" ↔ "Agree Holdings" at 1.0) — EXCEPT
 * the acronym arm, which needs the ORIGINAL token ORDER:
 *
 *   abbrev        — every token of the shorter core is matched in the longer
 *                   one, all but at most ONE of them EXACTLY, with the single
 *                   remaining token a genuine truncation ("cap" of "capital",
 *                   "co" of "company", "gov" of "government"). Requiring the
 *                   rest to match exactly is what keeps this tight: "agree
 *                   realty" vs "agree holdings" has an exact "agree" but
 *                   "realty" truncates nothing in "holdings", so it does not
 *                   fire.
 *   shared_acronym— the shorter side is a single distinctive token that appears
 *                   VERBATIM in the longer side ("UIRC" ↔ "UIRC, Urban
 *                   Investment Research Corporation"). The strongest of the
 *                   three: the acronym is literally written in both names.
 *   acronym       — the shorter side is one compact token that the longer
 *                   side's INITIALS spell, read in the name's original order
 *                   (`strictOwnerCore` sorts its tokens, so initials must be
 *                   taken from the normalized name, not the core — computing
 *                   them off the sorted core is why the first pass silently
 *                   missed every acronym).
 *
 * @returns {{likely:boolean, how:'exact'|'abbrev'|'shared_acronym'|'acronym'|null}}
 */
export function orgVariantHint(ownerName, contactName) {
  const exact = sameParty(ownerName, contactName);
  if (exact.match) return { likely: true, how: 'exact', ambiguous: false };

  const a = strictOwnerCore(ownerName);
  const b = strictOwnerCore(contactName);
  const ta = a.split(' ').filter(Boolean);
  const tb = b.split(' ').filter(Boolean);
  const [shortT, longT] = ta.length <= tb.length ? [ta, tb] : [tb, ta];

  // -- shared_acronym: one side is a single token written VERBATIM in the other.
  //    Checked BEFORE the substantiality gate on purpose. That gate (≥5 core
  //    characters) exists to stop a thin remnant from driving an AUTOMATIC write;
  //    it is the wrong test here, where the token is literally present in both
  //    names and a human makes the call. Without this ordering the real live
  //    pair "UIRC" ↔ "UIRC, Urban Investment Research Corporation" scores
  //    nothing, because the 4-character core "uirc" fails substantiality.
  if (shortT.length === 1 && shortT[0].length >= 3 && longT.includes(shortT[0])) {
    return { likely: true, how: 'shared_acronym', ambiguous: false };
  }

  // Every remaining arm infers sameness rather than reading it off both names,
  // so it keeps the substantiality gate.
  if (!strictCoreIsSubstantial(a) || !strictCoreIsSubstantial(b)) {
    return { likely: false, how: null, ambiguous: false };
  }

  // -- abbrev: full token coverage, at most ONE token differing by truncation,
  //    AND THE SAME NUMBER OF TOKENS ON BOTH SIDES.
  //
  //    ⚠ The equal-token-count requirement is not tidiness — it is the guard
  //    that stops a genuine false positive the first full-lane run produced:
  //    "Government Properties Trust" vs "Easterly Government Properties, Inc."
  //    Both of the shorter name's tokens appear exactly in the longer one, so
  //    pure coverage called it an abbreviation. It is not: the longer name adds
  //    the distinctive brand token "easterly", and these are two DIFFERENT
  //    REITs. Leaning `same_party` there would have invited an operator to stamp
  //    Easterly's switchboard onto an unrelated owner.
  //
  //    A genuine abbreviation preserves token count ("four springs cap trust" ↔
  //    "four springs capital trust"; "easterly gov properties" ↔ "easterly
  //    government properties"). A shorter name that is a strict SUBSET of a
  //    longer one is a different, more specific company — or an annotation like
  //    "(Public)" — and either way it is a judgement call, so it falls through
  //    to `subset` below and leans NOTHING rather than guessing.
  if (shortT.length >= 2 && shortT.length === longT.length) {
    let exactHits = 0;
    let truncations = 0;
    let covered = true;
    for (const s of shortT) {
      if (longT.includes(s)) { exactHits++; continue; }
      // A truncation must be a real prefix of a strictly longer token. Two
      // characters is enough ("co" → "company") only because every OTHER token
      // has to match exactly, which the exactHits floor below enforces.
      const trunc = longT.some((l) => l.length > s.length && l.startsWith(s));
      if (trunc && s.length >= 2) { truncations++; continue; }
      covered = false;
      break;
    }
    if (covered && truncations <= 1 && exactHits >= 1 && exactHits >= shortT.length - 1) {
      return { likely: true, how: 'abbrev', ambiguous: false };
    }
  }

  // -- acronym: initials of the longer name, in its ORIGINAL order.
  const orderedTokens = (name) => normalizeOwnerName(name).split(' ').filter((t) => t.length > 1);
  const shortIsOwner = ta.length <= tb.length;
  const shortTok = shortT.length === 1 ? shortT[0] : null;
  const longOrdered = orderedTokens(shortIsOwner ? contactName : ownerName);
  if (shortTok && shortTok.length >= 2 && shortTok.length <= 6 && longOrdered.length >= shortTok.length) {
    const initials = longOrdered.slice(0, shortTok.length).map((t) => t[0]).join('');
    if (initials === shortTok) return { likely: true, how: 'acronym', ambiguous: false };
  }

  // -- subset: every token of the shorter name appears in the longer one, but
  //    the longer one contributes extra material. Could be an annotation
  //    ("Broadstone Net Lease Inc (Public)" ↔ "Broadstone Net Lease, Inc") or a
  //    genuinely different, more specific company ("Government Properties Trust"
  //    ↔ "Easterly Government Properties"). We cannot tell those apart from the
  //    strings alone, so we say so: no lean either way, decided by a human.
  if (shortT.length >= 1 && shortT.every((s) => longT.includes(s))) {
    return { likely: false, how: 'subset', ambiguous: true };
  }

  return { likely: false, how: null, ambiguous: false };
}

/**
 * Classify one pending lane row and declare which verdicts it may receive.
 *
 * @param row {{ owner_name, contact_name, contact_email, contact_phone,
 *               contact_type, data_source, source_domain, reason }}
 * @returns {{shape, allowed:string[], role:string|null, has_email:boolean,
 *            has_phone:boolean, counterparty:boolean, variant_hint:object,
 *            lean:'reject'|'attach_person'|'same_party'|null, note:string}}
 */
export function classifyLaneRow(row) {
  const ownerName = String((row && row.owner_name) || '').trim();
  const cName = String((row && row.contact_name) || '').trim();
  const ctype = String((row && row.contact_type) || '').trim().toLowerCase();
  const email = normalizeEmail(row && row.contact_email) || '';
  const phoneRaw = String((row && row.contact_phone) || '').trim();
  const phone = looksLikeContactPhone(phoneRaw) ? phoneRaw : '';
  const base = {
    shape: SHAPE_BLOCKED, allowed: [VERDICT_REJECT], role: null,
    has_email: !!email, has_phone: !!phone,
    counterparty: COUNTERPARTY_CONTACT_TYPES.has(ctype),
    variant_hint: { likely: false, how: null, ambiguous: false }, lean: 'reject', note: '',
  };

  if (!cName) return { ...base, note: 'contact_unnamed' };
  // A row that carries no usable channel cannot make anyone reachable; closing
  // it is the only honest action.
  if (!email && !phone) return { ...base, note: 'no_contact_detail' };
  if (BROKER_CONTACT_TYPES.has(ctype)) return { ...base, note: 'broker_role' };
  if (isMisparseName(cName) || isJunkEntityName(cName)) return { ...base, note: 'junk_or_misparse_name' };
  // Federal agencies / government bodies are never a private owner's contact.
  if (isGovernmentBodyName(cName)) return { ...base, note: 'government_body' };

  if (isPersonShaped(cName)) {
    return {
      ...base, shape: SHAPE_PERSON,
      allowed: [VERDICT_ATTACH_PERSON, VERDICT_REJECT],
      role: relationshipRoleForContactType(ctype),
      // A person captured as the buyer/seller of a transaction MAY be our owner's
      // principal (they signed for the LLC) or the counterparty's. The lane shows
      // the tension; it does not resolve it.
      lean: base.counterparty ? null : VERDICT_ATTACH_PERSON,
      note: base.counterparty ? 'person_named_on_a_transaction_role' : 'person_shaped',
    };
  }

  const hint = orgVariantHint(ownerName, cName);
  return {
    ...base, shape: SHAPE_ORG,
    allowed: [VERDICT_SAME_PARTY, VERDICT_REJECT],
    variant_hint: hint,
    // Three states, deliberately. Only an abbreviation/acronym-consistent org
    // name leans same_party. A `subset` name (extra distinctive material on one
    // side) leans NOTHING — it is a real judgement call and a wrong nudge here
    // writes the wrong company's switchboard onto an owner. Everything else —
    // the transaction-counterparty class that dominates this lane — leans reject.
    lean: hint.likely ? VERDICT_SAME_PARTY : (hint.ambiguous ? null : VERDICT_REJECT),
    note: hint.likely ? ('org_name_variant_' + hint.how)
      : (hint.ambiguous ? 'org_name_subset_undecidable' : 'different_organization'),
  };
}

/**
 * Server-side gate. Returns the normalized verdict or an error reason; `admin.js`
 * calls this BEFORE any write so a stale card, a crafted request, or a misclick
 * cannot produce the wrong shape.
 *
 * @returns {{ok:true, verdict:string, classification:object} | {ok:false, error:string, classification:object}}
 */
export function validateVerdict(row, verdict) {
  const v = String(verdict || '').trim().toLowerCase();
  const classification = classifyLaneRow(row);
  const canon = v === 'confirm' || v === 'accept' || v === 'approve' || v === 'apply'
    // A bare "confirm" is only meaningful when exactly one non-reject verdict is
    // legal for this row; otherwise the caller must name the action explicitly.
    ? (classification.allowed.filter((a) => a !== VERDICT_REJECT)[0] || null)
    : (v === 'dismiss' || v === 'no' || v === 'not' || v === 'keep' ? VERDICT_REJECT : v);

  if (!canon) return { ok: false, error: 'ambiguous_verdict', classification };
  if (!classification.allowed.includes(canon)) {
    return { ok: false, error: 'verdict_not_allowed_for_shape:' + classification.shape + ':' + canon, classification };
  }
  return { ok: true, verdict: canon, classification };
}

export default classifyLaneRow;
