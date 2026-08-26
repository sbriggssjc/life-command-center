// api/_shared/tier0-confirm-planner.js
// ============================================================================
// Prompt 188 — the Tier 0 owner-contact CONFIRM LANE's card + verdict model.
// ----------------------------------------------------------------------------
// PURE, no I/O. Turns one row of `v_lcc_tier0_owner_contact_lane_open` into the
// card the Decision Center renders, and decides which verdicts that card may
// legally receive. `api/admin.js` re-runs these guards server-side before it
// writes, so a stale card or a crafted request cannot produce the wrong write.
//
// WHY A CONFIRM LANE AND NOT A PROMOTER — measured, not assumed.
//   P187 read the top 45 pairs by owner rent individually: ~91% correct. Read
//   down into the ~$2M single-property SPE band it falls to ~60-70% ("NGP VI
//   ESSEX VT LLC" -> essexconcrete.org, "Boyd Atlanta Williams" -> williamson.com).
//   One in eleven unattended writes at the TOP of the book would put the wrong
//   firm's employee into `owner_contact_pivot`, and that pollutes the one field
//   the whole outreach chain reads. So: a human clicks, every time.
//
// ⚠️ PRECISION IS A CURVE, AND THE MEASURED PART OF IT IS SHORTER THAN IT LOOKS.
//   "Top 45 pairs by rent" sounds like a deep read. It is not: the 45th pair sits
//   at $16.38M of owner rent, so the ~91% claim reaches only owners at roughly
//   $16M and above -- 10 cards / 7 owners / $521M. Everything from $16M down to
//   $2M is BETWEEN the two read points and has never been graded at all. The
//   bands below say that out loud rather than interpolating a number, because
//   quoting one precision figure without its rent band is what P187 warned about.
// ============================================================================

import {
  isPersonShaped, isGovernmentBodyName, hasOrgMarker,
} from './owner-contact-verdict-planner.js';
import { isJunkEntityName } from './entity-link.js';
import { isMisparseName } from './tm-misparse.js';
import { isNonReachableRole } from './owner-reachable-via.js';

export const TIER0_ATTACH = 'attach';
export const TIER0_REJECT = 'reject';
export const TIER0_RESEARCH = 'research';
export const TIER0_VERDICTS = [TIER0_ATTACH, TIER0_REJECT, TIER0_RESEARCH];

// ---------------------------------------------------------------------------
// RENT BANDS — the measured precision curve, stated with its anchors.
//
// `measured` is the honest field: true only where somebody actually read the
// rows. The mid band deliberately carries no number.
// ---------------------------------------------------------------------------
export const RENT_BAND_HIGH_FLOOR = 16000000;   // the 45th pair by rent sat at $16.38M
export const RENT_BAND_LOW_CEIL = 2000000;      // the "~$2M SPE band" P187 read

export function rentBand(rent) {
  const r = Number(rent) || 0;
  if (r >= RENT_BAND_HIGH_FLOOR) {
    return {
      band: 'measured_high', label: 'Top of book (≥ $16M)', measured: true,
      precision: '~91%',
      note: 'Directly graded: P187 read the top 45 pairs by owner rent, the 45th of which sat at $16.38M.',
    };
  }
  if (r >= RENT_BAND_LOW_CEIL) {
    return {
      band: 'unmeasured_mid', label: 'Mid book ($2M–$16M)', measured: false,
      precision: null,
      note: 'Never graded. This band lies BETWEEN the two rent points anyone has read; do not assume ~91% here.',
    };
  }
  return {
    band: 'measured_low', label: 'SPE band (< $2M)', measured: true,
    precision: '~60–70%',
    note: 'Directly graded: single-property SPE names carry a place or a surname and little else.',
  };
}

// ---------------------------------------------------------------------------
// NAMES THAT ARE NOT PEOPLE — a NARROW stoplist, scoped to this gate only.
//
// Every entry was measured on this bench (2026-08-26). The shared guards catch
// most of the noise -- `Equity Funds` and `Managing Partner` trip hasOrgMarker,
// `Public` fails looksLikePersonName -- but four survived all of them:
//
//   "Tenants In Common"      a legal ownership FORM captured as a person entity
//   "Inco Commercial"        a firm ("Inco Commercial Real Estate"); `Inco` is
//                            not `\binc\b`, so no org marker fires
//   "Stephen Block Deceased" a real person, and never a prospect
//   "Authorized Signer"      a role label (P186 recorded it in the bench)
//
// ⚠️ It stays narrow ON PURPOSE. The repo's recurring lesson (P158a's `&`, P124's
// consumer-domain rule, P131's OM-source exclusion) is that the OBVIOUS widening
// is the destructive one: a rule broad enough to catch `Inco Commercial` by
// "sounds corporate" would also delete real surnames. This list is checked
// against the full 400-name bench in the test, and it must be extended by
// MEASUREMENT, never by imagination.
//
// It is NOT exported into the shared name guards. Those serve callers that would
// be harmed by a false positive; here a false positive costs one rejectable card.
// ---------------------------------------------------------------------------
const ROLE_OR_FORM_LABELS = [
  'tenants in common', 'tenant in common', 'joint tenants',
  'authorized signer', 'authorized agent', 'managing partner', 'managing member',
  'registered agent', 'general partner', 'trustee', 'successor trustee',
  'inco commercial',
];
const DECEASED_RE = /\b(deceased|dec'?d|estate of|the estate)\b/i;

/** True when the "person" is really a role label, a legal ownership form, or a decedent. */
export function isRoleOrFormLabelName(name) {
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!n) return true;
  if (ROLE_OR_FORM_LABELS.includes(n)) return true;
  return DECEASED_RE.test(n);
}

// ---------------------------------------------------------------------------
// PERSON ELIGIBILITY.
//
// The SQL lane view already applies the two HOUSE guards
// (`lcc_is_rejected_contact_name`, `lcc_looks_like_person`) and the broker
// role_bucket, and carries its verdict as `eligible`/`block_reason`. This adds
// the JS-side name-shape gate on top and re-checks the broker rule, so a card
// rendered before a change and confirmed after it still cannot write the wrong
// thing. Both layers are cheap; the write path runs this one again.
//
// A blocked person is RETURNED, flagged -- not dropped. "1 broker excluded" on
// the card is the honest count; a silently shorter list is not.
// ---------------------------------------------------------------------------
export function classifyTier0Person(person) {
  const p = person || {};
  const name = String(p.person_name || '').trim();
  const email = String(p.email || '').trim();
  const roleBucket = String(p.role_bucket || '').trim().toLowerCase();

  const block = (reason) => ({ eligible: false, block_reason: reason });

  if (!name) return block('unnamed');
  if (!email) return block('no_email');
  // A broker is the agent, never the principal -- excluded outright at any deal
  // size (owner-reachable-via's NON_REACHABLE_ROLES rule, reused).
  if (roleBucket === 'broker' || isNonReachableRole(roleBucket)) return block('broker_role');
  if (p.eligible === false && p.block_reason) return block(String(p.block_reason));
  if (isJunkEntityName(name) || isMisparseName(name)) return block('junk_or_misparse_name');
  if (isRoleOrFormLabelName(name)) return block('role_or_legal_form_label');
  if (isGovernmentBodyName(name)) return block('government_body');
  if (!isPersonShaped(name)) {
    return block(hasOrgMarker(name) ? 'organization_name' : 'not_person_shaped');
  }
  return { eligible: true, block_reason: null };
}

// ---------------------------------------------------------------------------
// EVIDENCE, AND WHAT EACH KIND ACTUALLY PROVES.
//
// This is P186 §5's structural finding, encoded so the card cannot blur it:
//   PERSON evidence answers "is this person real and known to us?"
//   LINK   evidence answers "does this person work for THIS owner?"
// Only the second corroborates the decision being made. Gary George at
// georgesinc.com -- a poultry company -- carries Salesforce campaign membership,
// a Salesforce contact record AND a company name that matches his own domain,
// and works for George Washington University in no sense whatsoever.
// ---------------------------------------------------------------------------
export const PERSON_EVIDENCE_KEYS = [
  'sf_campaign', 'sf_contact', 'outlook', 'correspondence', 'company_confirms_employer',
];
export const LINK_EVIDENCE_KEYS = ['company_matches_owner'];

export const EVIDENCE_LABELS = {
  sf_campaign: 'In a Salesforce campaign',
  sf_contact: 'Has a Salesforce contact record',
  outlook: 'In the Outlook address book',
  correspondence: 'Real correspondence on file',
  company_confirms_employer: 'Company name matches this email domain',
  company_matches_owner: 'Company name matches THIS OWNER',
};

export function evidenceSummary(person) {
  const ev = (person && person.evidence) || {};
  const person_evidence = PERSON_EVIDENCE_KEYS.filter((k) => !!ev[k]);
  const link_evidence = LINK_EVIDENCE_KEYS.filter((k) => !!ev[k]);
  return {
    person_evidence,
    link_evidence,
    // The one sentence that must survive every UI change.
    attests: link_evidence.length ? 'link_and_person'
      : (person_evidence.length ? 'person_only' : 'none'),
    caveat: link_evidence.length
      ? null
      : 'This evidence shows the person is real and known to us. It does NOT show they work for this owner.',
  };
}

// ---------------------------------------------------------------------------
// DUPLICATE PERSON ENTITIES — collapsed by email, on an EXPLICIT RANKED RULE.
//
// Andrew Pulliam exists TWICE in `entities` at apulliam@easterlyreit.com (P186
// confirmed it; two duplicate Easterly owner entities × two duplicate Pulliams
// produced four rows for one human). Showing the same person twice on a card
// asks the operator to break a tie they have no information to break.
//
// ⚠️ "First row wins" is banned here. It is the exact defect that produced the
// gov `ensureTrueOwner` substring bug (gov CLAUDE.md §20) and the reason
// owner-reachable-via declares its selection order. So the rule is written down,
// ordered, and regression-tested; and the entities NOT chosen ride along on the
// card as `duplicate_person_ids` so the duplicate is visible rather than
// silently resolved.
// ---------------------------------------------------------------------------
function dupRank(p) {
  const ev = (p && p.evidence) || {};
  return [
    ev.company_matches_owner ? 0 : 1,                    // 1. link evidence first
    (p.title || p.company) ? 0 : 1,                      // 2. the richer contact record
    -PERSON_EVIDENCE_KEYS.filter((k) => !!ev[k]).length, // 3. more person evidence
    p.already_linked ? 0 : 1,                            // 4. already modelled in the graph
    p.from_outlook_sync ? 0 : 1,                         // 5. in the address book
    String(p.person_id || ''),                           // 6. stable final tiebreak
  ];
}

function cmpRank(a, b) {
  const ra = dupRank(a); const rb = dupRank(b);
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] < rb[i]) return -1;
    if (ra[i] > rb[i]) return 1;
  }
  return 0;
}

export function collapseDuplicatePeople(people) {
  const byEmail = new Map();
  for (const p of (Array.isArray(people) ? people : [])) {
    const key = String(p.email || '').trim().toLowerCase() || ('id:' + p.person_id);
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(p);
  }
  const out = [];
  for (const group of byEmail.values()) {
    const sorted = group.slice().sort(cmpRank);
    const winner = sorted[0];
    const alternates = sorted.slice(1).map((x) => x.person_id).filter(Boolean);
    out.push(alternates.length ? { ...winner, duplicate_person_ids: alternates } : winner);
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE CARD.
//
// One (owner, domain). People are classified, deduped, and ordered so the most
// decidable candidate leads: link evidence, then an acquisitions/principal title
// (the doctrine's actual pursuit target -- we prospect a buyer by SHOWING THEM
// DEALS, so the buy-side pitch belongs with acquisitions), then person evidence.
// ---------------------------------------------------------------------------
const ROLE_PRIORITY = { acquisitions: 0, principal: 1, disposition: 2, other_titled: 3, no_title: 4, transaction_support: 5 };

export function buildTier0Card(row) {
  const r = row || {};
  const raw = Array.isArray(r.people) ? r.people : [];
  const classified = raw.map((p) => {
    const cls = classifyTier0Person(p);
    return { ...p, ...cls, ...evidenceSummary(p) };
  });
  const eligible = collapseDuplicatePeople(classified.filter((p) => p.eligible))
    .sort((a, b) => (
      (b.link_evidence.length - a.link_evidence.length)
      || ((ROLE_PRIORITY[a.role_bucket] ?? 9) - (ROLE_PRIORITY[b.role_bucket] ?? 9))
      || (b.person_evidence.length - a.person_evidence.length)
      || String(a.person_name || '').localeCompare(String(b.person_name || ''))
    ));
  const excluded = classified.filter((p) => !p.eligible)
    .map((p) => ({ person_id: p.person_id, person_name: p.person_name, email: p.email, block_reason: p.block_reason }));

  const band = rentBand(r.owner_rent);
  return {
    owner_entity_id: r.owner_id,
    owner_name: r.owner_name,
    owner_rent: Number(r.owner_rent) || 0,
    owner_workspace_id: r.owner_workspace_id || null,
    domain: r.domain,
    // WHY this domain was proposed for this owner. The single most useful fact
    // on the card: "matched on the token 'george'" is what makes George
    // Washington University -> georgesinc.com an obvious reject.
    match_arms: r.match_arms || null,
    match_keys: Array.isArray(r.match_keys) ? r.match_keys : [],
    rent_band: band.band,
    rent_band_label: band.label,
    precision_note: band.measured
      ? (band.precision + ' — ' + band.note)
      : band.note,
    owner_domain_cards: Number(r.owner_domain_cards) || 1,
    n_candidates: Number(r.n_candidates) || raw.length,
    n_eligible: eligible.length,
    n_excluded: excluded.length,
    n_link_evidence: eligible.filter((p) => p.link_evidence.length).length,
    n_person_evidence: eligible.filter((p) => p.person_evidence.length).length,
    // The honest headline. A card with zero LINK evidence is decided on the
    // lexical match alone, and the operator must be told so.
    evidence_headline: eligible.some((p) => p.link_evidence.length)
      ? 'A candidate’s stated employer matches this owner.'
      : 'No candidate’s employer is on file as this owner — the match is the email domain alone.',
    people: eligible,
    excluded_people: excluded,
    rank_value: Number(r.rank_value ?? r.owner_rent) || 0,
  };
}

/** Stable subject_ref for the lane. Domain-scoped: rejecting rmrgroupinc.com must not close rmrgroup.com. */
export function tier0SubjectRef(ownerId, domain) {
  if (!ownerId || !domain) return null;
  return 't0:' + ownerId + ':' + String(domain).trim().toLowerCase();
}

/**
 * Server-side verdict gate. Called by admin.js BEFORE any write.
 *
 * attach   — requires a person_entity_id that is ON this card and still passes
 *            the shape gate. A card is a proposal, never an authorisation to
 *            write an arbitrary id.
 * reject   — always allowed; terminal (the seeder is a view + lcc_decisions
 *            exclusion, so a rejected (owner, domain) is never re-proposed).
 * research — always allowed.
 *
 * @returns {{ok:true, verdict:string, person:object|null}
 *          |{ok:false, error:string, person:null}}
 */
export function validateTier0Verdict(card, verdict, payload) {
  const v = String(verdict || '').trim().toLowerCase();
  const canon = (v === 'confirm' || v === 'accept' || v === 'approve' || v === 'apply') ? TIER0_ATTACH
    : (v === 'dismiss' || v === 'no' || v === 'not_a_match' || v === 'keep') ? TIER0_REJECT
      : v;
  if (!TIER0_VERDICTS.includes(canon)) {
    return { ok: false, error: 'unknown_verdict:' + (v || '(empty)'), person: null };
  }
  if (canon !== TIER0_ATTACH) return { ok: true, verdict: canon, person: null };

  const wanted = String((payload && payload.person_entity_id) || '').trim();
  if (!wanted) return { ok: false, error: 'attach_requires_person_entity_id', person: null };
  const people = (card && Array.isArray(card.people)) ? card.people : [];
  const person = people.find((p) => String(p.person_id) === wanted);
  if (!person) return { ok: false, error: 'person_not_on_card', person: null };
  // Re-run the shape gate at write time. The card may have been rendered before
  // a rename; the write must not inherit its assumptions.
  const cls = classifyTier0Person(person);
  if (!cls.eligible) {
    return { ok: false, error: 'person_not_eligible:' + cls.block_reason, person: null };
  }
  return { ok: true, verdict: TIER0_ATTACH, person };
}

export default buildTier0Card;
