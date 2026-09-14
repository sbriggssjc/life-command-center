// OWN-T0e (2026-09-09) — pure planner for the Decision Center lane
// `sponsor_family_confirm`: one card per (sponsor entity, brand token) over the
// OWN-T0 `unclassified_rival` conflict population; ONE verdict writes, and that
// write is a single INSERT into lcc_ownership_sponsor_family (reversible by
// DELETE). Design: docs/audits/OWN_T0e_SPONSOR_FAMILY_LANE_DESIGN_2026-09-08.md §4.
//
// Nothing in this module reads a database. api/admin.js hands it the cache row
// (re-read at verdict time, never trusted from the request — P188) plus the
// LIVE facts a guard needs (registry membership, tombstone), and it returns the
// decision. That split is what makes every refusal unit-testable.
//
// The five verdicts:
//   confirm_family — INSERT (sponsor_entity_id, sponsor_token). On a tied group
//                    the operator names the sponsor; it must be one of the
//                    group's member_ids.
//   same_party     — the "SPE" is a duplicate ENTITY of the sponsor, not a
//                    family member. No write here: recorded, and the operator is
//                    forwarded to merge_duplicate_entities (lcc_merge_entity is
//                    reversible since P196). Never folded into confirm_family —
//                    a family row over a duplicate papers over the merge.
//   merge_into_sponsor — OWN-T0e-c: this card's OWN sponsor is itself a
//                    recognised duplicate of a DIFFERENT sponsor's card (the
//                    NGP Group -> NGP Capital shape). same_party/merge_now can
//                    only merge a member OF THIS group into this card's
//                    sponsor; this verdict is the missing other direction —
//                    merge THIS card's sponsor into the other, already-canonical
//                    sponsor named on `card.duplicate_of_sponsor_id`. That id is
//                    computed server-side from the cache (annotateSponsorDuplicates)
//                    and is never accepted from the request (P188) — the client
//                    payload carries nothing for this verdict.
//   not_family     — record-only; the subject_ref is excluded from the lane.
//   research       — a research_task, existing machinery.
//
// A generic-word token (`realty`, `federal`, `george`) does NOT refuse — that is
// the human's call — but the decision records token_is_generic_word so a later
// grade can find it (design §4; Scott may tighten this to an explicit ack).

export const SPONSOR_FAMILY_DECISION_TYPE = 'sponsor_family_confirm';
export const SPONSOR_FAMILY_VERDICTS = Object.freeze(['confirm_family', 'same_party', 'merge_into_sponsor', 'not_family', 'research']);
export const SPONSOR_FAMILY_CACHE_TABLE = 'lcc_ownt0e_sponsor_family_proposals_cache';
export const SPONSOR_FAMILY_REGISTRY_TABLE = 'lcc_ownership_sponsor_family';

// Mirrors the registry's own CHECK constraints (chk_ownership_sponsor_token_len /
// _norm): >= 3 chars, lower-case alphanumerics only. Refusing here gives the
// operator a reason instead of a 23514 from PostgREST.
export function sponsorTokenIsValid(tok) {
  return typeof tok === 'string' && tok.length >= 3 && /^[a-z0-9]+$/.test(tok);
}

// subject_ref: `t0e:<sponsor_id>:<token>` for a breadth-decided group,
// `t0e:tied:<group_key_id>:<token>` for a tied one (group_key_id = the lower
// member id — the view's own key). A tied group confirmed later under a chosen
// sponsor keeps its `tied` ref: the ref identifies the QUESTION, not the answer.
export function sponsorFamilySubjectRef(row) {
  if (!row || !row.sponsor_token) return null;
  const tok = String(row.sponsor_token);
  if (row.sponsor_side === 'tied') {
    return row.group_key_id ? 't0e:tied:' + row.group_key_id + ':' + tok : null;
  }
  return row.sponsor_id ? 't0e:' + row.sponsor_id + ':' + tok : null;
}

export function parseSponsorFamilySubjectRef(ref) {
  const s = String(ref || '');
  let m = /^t0e:tied:([0-9a-f-]{36}):([a-z0-9]+)$/.exec(s);
  if (m) return { tied: true, group_key_id: m[1], sponsor_token: m[2] };
  m = /^t0e:([0-9a-f-]{36}):([a-z0-9]+)$/.exec(s);
  if (m) return { tied: false, sponsor_id: m[1], sponsor_token: m[2] };
  return null;
}

// OWN-T0e-c: is THIS row's own sponsor itself listed as an "SPE" (duplicate
// suspect) member of some OTHER card? No new detector — this reads the exact
// signal the design already computes per group: `spe_ids` (the non-sponsor
// side of a group) and `spe_props_max` (>= 2 is the existing
// duplicate_entity_suspect flag, §3a). A row's sponsor_id showing up inside
// ANOTHER group's spe_ids, on a group whose spe_props_max already reads as a
// duplicate suspect, is the same shape as NGP Group riding inside NGP
// Capital's card. Breadth groups only (a tied group has no single sponsor_id
// to test) and the match excludes the row's OWN group.
export function findSponsorDuplicateTarget(sponsorId, rows) {
  if (!sponsorId) return null;
  const sid = String(sponsorId);
  const all = Array.isArray(rows) ? rows : [];
  for (const other of all) {
    if (!other || other.sponsor_side === 'tied') continue;
    if (!other.sponsor_id || String(other.sponsor_id) === sid) continue;
    if (!(Number(other.spe_props_max) >= 2)) continue;
    const speIds = Array.isArray(other.spe_ids) ? other.spe_ids.map(String) : [];
    if (speIds.includes(sid)) {
      return { sponsor_id: String(other.sponsor_id), sponsor_token: other.sponsor_token || null, sponsor_name: other.sponsor_name || null };
    }
  }
  return null;
}

// Annotates the whole cache array with `duplicate_of_sponsor_id/_token/_name`
// per row, computed once over the full population (O(n^2) but n ~= 200 —
// the same population the fetch branch already loads whole). Pure; the fetch
// branch calls this before building cards, and the verdict branch re-derives
// the same fact from a fresh cache read at verdict time (never from a stale
// annotation carried on the request — P188).
export function annotateSponsorDuplicates(rows) {
  const all = Array.isArray(rows) ? rows : [];
  return all.map((r) => {
    if (!r || r.sponsor_side === 'tied' || !r.sponsor_id) return r;
    const dup = findSponsorDuplicateTarget(r.sponsor_id, all);
    if (!dup) return r;
    return Object.assign({}, r, {
      duplicate_of_sponsor_id: dup.sponsor_id,
      duplicate_of_sponsor_token: dup.sponsor_token,
      duplicate_of_sponsor_name: dup.sponsor_name,
    });
  });
}

// The card the operator sees. Every column the design names is carried, and
// the two evidence columns that answer a DIFFERENT question are labelled so.
export function buildSponsorFamilyCard(row) {
  const r = row || {};
  const tied = r.sponsor_side === 'tied';
  const memberIds = Array.isArray(r.member_ids) ? r.member_ids.map(String) : [];
  const spePropsMax = Number(r.spe_props_max);
  return {
    group_key_id: r.group_key_id || null,
    sponsor_id: r.sponsor_id || null,
    sponsor_name: r.sponsor_name || null,
    sponsor_side: tied ? 'tied' : 'breadth',
    tied_pair: r.tied_pair || null,
    sponsor_token: r.sponsor_token || null,
    properties: Number(r.properties) || 0,
    gov_properties: Number(r.gov_properties) || 0,
    dia_properties: Number(r.dia_properties) || 0,
    annual_rent: r.annual_rent != null && Number.isFinite(Number(r.annual_rent)) ? Number(r.annual_rent) : null,
    spe_names: Array.isArray(r.spe_names) ? r.spe_names : [],
    spe_ids: Array.isArray(r.spe_ids) ? r.spe_ids.map(String) : [],
    member_ids: memberIds,
    // aligned with member_ids (both ordered by id in the view)
    member_names: Array.isArray(r.member_names) ? r.member_names : [],
    sponsor_props: Number(r.sponsor_props) || 0,
    spe_props_max: Number.isFinite(spePropsMax) ? spePropsMax : 0,
    // A "SPE" holding >= 2 properties of its own is the duplicate-entity signal
    // the design measured (13 groups); same_party_suspect reads 0 by construction
    // because the A3 gate already excludes strict-core-equal pairs.
    same_party_suspect: r.same_party_suspect === true,
    same_party_pairs: Number(r.same_party_pairs) || 0,
    duplicate_entity_suspect: Number.isFinite(spePropsMax) && spePropsMax >= 2,
    already_confirmed: r.already_confirmed === true,
    // OWN-T0e-c: set only when THIS card's own sponsor is itself recognised as
    // a duplicate-suspect member of a DIFFERENT sponsor's card (annotated
    // server-side by annotateSponsorDuplicates — never client-supplied).
    duplicate_of_sponsor_id: r.duplicate_of_sponsor_id ? String(r.duplicate_of_sponsor_id) : null,
    duplicate_of_sponsor_token: r.duplicate_of_sponsor_token || null,
    duplicate_of_sponsor_name: r.duplicate_of_sponsor_name || null,
    // evidence about a DIFFERENT question (P188): the token is confirmed for
    // CONTACT matching in lcc_owner_sponsor_domain. It settles nothing here.
    also_confirmed_for_contacts: r.also_confirmed_for_contacts === true,
    token_entities_fleetwide: Number(r.token_entities_fleetwide) || 0,
    token_is_generic_word: r.token_is_generic_word === true,
    refreshed_at: r.refreshed_at || null,
    // what one confirm covers: every (property, pair) row in the group reads
    // sponsor_family_confirmed on the next reconciled read. `properties` in the
    // view COUNTS PAIRS (a property with three candidates carries two), so this
    // is an upper bound on distinct properties — measured on NGP Capital at
    // build: 30 pairs → 28 properties flipped (rolled-back positive control).
    flips_unclassified_rival_pairs: Number(r.properties) || 0,
  };
}

// The verdict gate. `live` carries the facts read from the database AT VERDICT
// TIME: { registry_has: boolean, sponsor_is_tombstone: boolean }. Returns
// { ok, verdict, sponsor_entity_id, sponsor_token, duplicate_entity_id, error }.
export function validateSponsorFamilyVerdict(card, verdict, payload, live) {
  const v = String(verdict || '').trim().toLowerCase();
  const p = (payload && typeof payload === 'object') ? payload : {};
  const lv = live || {};
  if (!card || !card.sponsor_token) return { ok: false, error: 'card has no token' };
  if (!SPONSOR_FAMILY_VERDICTS.includes(v)) return { ok: false, error: 'unknown verdict: ' + v };
  const tok = String(card.sponsor_token);
  const members = new Set((card.member_ids || []).map(String));

  if (v === 'confirm_family') {
    if (!sponsorTokenIsValid(tok)) return { ok: false, error: 'token fails the registry check (>= 3 chars, [a-z0-9])' };
    let sponsor = null;
    if (card.sponsor_side === 'tied') {
      sponsor = p.sponsor_entity_id ? String(p.sponsor_entity_id) : null;
      if (!sponsor) return { ok: false, error: 'tied group: sponsor_entity_id required — name which side is the sponsor' };
      if (!members.has(sponsor)) return { ok: false, error: 'sponsor_entity_id is not a member of this group' };
    } else {
      sponsor = card.sponsor_id ? String(card.sponsor_id) : null;
      if (!sponsor) return { ok: false, error: 'breadth group without a sponsor id' };
      // a client-supplied sponsor on a decided group must AGREE with the card
      if (p.sponsor_entity_id && String(p.sponsor_entity_id) !== sponsor) {
        return { ok: false, error: 'sponsor_entity_id does not match the card\'s sponsor' };
      }
    }
    if (lv.sponsor_is_tombstone === true) return { ok: false, error: 'sponsor entity is merged away — resolve through lcc_entity_survivor first' };
    if (lv.registry_has === true) return { ok: false, error: '(sponsor, token) already confirmed in ' + SPONSOR_FAMILY_REGISTRY_TABLE };
    return { ok: true, verdict: v, sponsor_entity_id: sponsor, sponsor_token: tok };
  }

  if (v === 'same_party') {
    // Two shapes. Without `merge_now` (the OWN-T0e default): record + forward to
    // merge_duplicate_entities, no write; a named duplicate is validated only.
    // With `merge_now: true` (OWN-T0e-b): the pair is merged HERE through
    // lcc_merge_entity (reversible, P196) — because 5 of the 13 duplicate-suspect
    // groups have no card on the merge lane (its canonical key does not group
    // `Gardner Tanenbaum Holdings` with `Gardner-Tanenbaum`). The winner is the
    // sponsor (breadth: the card's; tied: the operator's pick), the loser the
    // operator-named duplicate; both must be members, distinct, live, and of the
    // SAME recorded entity_type (A2a: a name-shape guess would hold six real
    // companies; the recorded type is the fact — and merging a person into an org
    // is the P167 error). Never inferred, never more than one loser per verdict.
    const dup = p.duplicate_entity_id ? String(p.duplicate_entity_id) : null;
    if (dup && !members.has(dup)) return { ok: false, error: 'duplicate_entity_id is not a member of this group' };
    const mergeNow = p.merge_now === true;
    let winner = card.sponsor_id ? String(card.sponsor_id) : null;
    if (mergeNow) {
      if (!dup) return { ok: false, error: 'merge_now requires duplicate_entity_id' };
      if (card.sponsor_side === 'tied') {
        winner = p.sponsor_entity_id ? String(p.sponsor_entity_id) : null;
        if (!winner) return { ok: false, error: 'tied group: sponsor_entity_id required — name the survivor' };
        if (!members.has(winner)) return { ok: false, error: 'sponsor_entity_id is not a member of this group' };
      } else if (p.sponsor_entity_id && String(p.sponsor_entity_id) !== winner) {
        return { ok: false, error: 'sponsor_entity_id does not match the card\'s sponsor' };
      }
      if (!winner) return { ok: false, error: 'no survivor to merge into' };
      if (winner === dup) return { ok: false, error: 'duplicate_entity_id is the sponsor itself' };
      if (lv.sponsor_is_tombstone === true) return { ok: false, error: 'sponsor entity is merged away — resolve through lcc_entity_survivor first' };
      if (lv.duplicate_is_tombstone === true) return { ok: false, error: 'duplicate entity is already merged away' };
      if (lv.sponsor_type && lv.duplicate_type && lv.sponsor_type !== lv.duplicate_type) {
        return { ok: false, error: 'entity_type differs (' + lv.sponsor_type + ' vs ' + lv.duplicate_type + ') — not a duplicate, retype first' };
      }
    }
    return { ok: true, verdict: v, sponsor_entity_id: winner, sponsor_token: tok,
      duplicate_entity_id: dup, merge_now: mergeNow };
  }

  if (v === 'merge_into_sponsor') {
    // OWN-T0e-c: the reverse direction of same_party/merge_now — this card's
    // OWN sponsor (the loser) merges INTO the target sponsor named on the
    // card's duplicate_of_sponsor_id (the winner). Tied groups have no single
    // sponsor_id to be the loser, so they are refused here (the operator names
    // a sponsor via confirm_family/same_party first, which may then surface a
    // NEW card for the resolved sponsor on a later refresh).
    if (card.sponsor_side === 'tied') return { ok: false, error: 'tied group has no single sponsor to merge — name a sponsor first' };
    const loser = card.sponsor_id ? String(card.sponsor_id) : null;
    const winner = card.duplicate_of_sponsor_id ? String(card.duplicate_of_sponsor_id) : null;
    if (!loser) return { ok: false, error: 'card has no sponsor_id' };
    if (!winner) return { ok: false, error: 'this card carries no recognized duplicate-of target — nothing to merge into' };
    if (winner === loser) return { ok: false, error: 'duplicate-of target is the card\'s own sponsor' };
    if (lv.sponsor_is_tombstone === true) return { ok: false, error: 'sponsor entity is already merged away' };
    if (lv.duplicate_is_tombstone === true) return { ok: false, error: 'duplicate-of target is merged away — resolve through lcc_entity_survivor first' };
    if (lv.sponsor_type && lv.duplicate_type && lv.sponsor_type !== lv.duplicate_type) {
      return { ok: false, error: 'entity_type differs (' + lv.sponsor_type + ' vs ' + lv.duplicate_type + ') — not a duplicate, retype first' };
    }
    return { ok: true, verdict: v, sponsor_entity_id: winner, sponsor_token: tok, duplicate_entity_id: loser, merge_now: true };
  }

  return { ok: true, verdict: v, sponsor_entity_id: card.sponsor_id ? String(card.sponsor_id) : null, sponsor_token: tok };
}

// Lane ordering: breadth-decided groups first (a sponsor the data already
// names), then tied; rent desc within each. Pure so the fetch branch and its
// test share one definition.
export function orderSponsorFamilyRows(rows) {
  const side = (r) => (r.sponsor_side === 'tied' ? 1 : 0);
  const rent = (r) => (r.annual_rent != null && Number.isFinite(Number(r.annual_rent)) ? Number(r.annual_rent) : -1);
  return [...(rows || [])].sort((a, b) => side(a) - side(b) || rent(b) - rent(a)
    || String(a.sponsor_name || a.tied_pair || '').localeCompare(String(b.sponsor_name || b.tied_pair || '')));
}
