// ============================================================================
// REVIEW-LANES1 (2026-09-25) — four review queues become Decision Center lanes.
//
// Every recent accuracy round sent ambiguous cases to review instead of guessing. None of those
// queues had a place Scott could act. This module is the PURE half: which writer each verdict
// goes through, and how each verdict is undone. api/_handlers/review-lanes1.js runs the calls.
//
// Lanes, ordered by how much they change what Scott sees:
//   listing_sale_review        dia_/gov_listing_sale_review — an Available listing that may have
//                              sold. confirm_sold closes it; reject keeps it and skips the pair.
//   asset_property_link_review MERGELOG-GAP candidates — an asset whose dia property was deleted
//                              by an unrecorded merge. relink repoints it; no_match leaves it.
//   gov_owner_contact_review   CONTACTS-GOV-WRITER — a gov owner with no hub contact and an
//                              uncertain match. link / create / already_represented / not_same.
//   contact_hub_conflict       two hub contacts for one gov owner after a gov owner merge.
//                              merge (the contact merge path) / repoint_to_survivor / keep_both.
//
// Every verdict writes through one DB function (or the contact merge path), and every verdict
// records the exact call that undoes it (effects.undo), so undo never re-derives anything.
// ============================================================================

export const REVIEW_LANES1_TYPES = Object.freeze([
  'listing_sale_review',
  'asset_property_link_review',
  'gov_owner_contact_review',
  'contact_hub_conflict',
]);

export function isReviewLanes1Type(t) { return REVIEW_LANES1_TYPES.includes(t); }

const DOMS = new Set(['dia', 'gov']);

export const REVIEW_LANES1_VERDICTS = Object.freeze({
  listing_sale_review: ['confirm_sold', 'reject'],
  asset_property_link_review: ['relink', 'no_match'],
  gov_owner_contact_review: ['link', 'create', 'already_represented', 'not_same'],
  contact_hub_conflict: ['merge', 'repoint_to_survivor', 'keep_both'],
});

/** The dedupe/exclusion key for a card. Null when the subject is missing its identifying field. */
export function reviewLanes1SubjectRef(type, s) {
  s = s || {};
  switch (type) {
    case 'listing_sale_review':
      return (DOMS.has(s.domain) && s.review_id != null) ? 'lsr:' + s.domain + ':' + s.review_id : null;
    case 'asset_property_link_review':
      return s.ledger_id != null ? 'aplink:' + s.ledger_id : null;
    case 'gov_owner_contact_review':
      return s.review_id != null ? 'gor:' + s.review_id : null;
    case 'contact_hub_conflict':
      return s.conflict_log_id != null ? 'hubconf:' + s.conflict_log_id : null;
    default:
      return null;
  }
}

/**
 * Plan the writer call for a verdict. Returns { db, fn, args } for a single RPC, or
 * { kind: 'contact_merge', snapshot: {db, fn, args} } for the contact merge path, or { error }.
 * `db` is 'ops' | 'dia' | 'gov'. Nothing here reads or writes.
 */
export function planReviewLanes1Verdict(type, verdict, context, payload, decidedBy) {
  const c = context || {};
  const p = payload || {};
  const allowed = REVIEW_LANES1_VERDICTS[type];
  if (!allowed) return { error: 'unknown_type' };
  if (!allowed.includes(verdict)) return { error: 'unknown_verdict', allowed };
  const by = decidedBy == null ? null : String(decidedBy);

  if (type === 'listing_sale_review') {
    if (!DOMS.has(c.domain) || c.review_id == null) return { error: 'missing_review' };
    return { db: c.domain, fn: c.domain + '_decide_listing_sale_review',
      args: { p_review_id: Number(c.review_id), p_decision: verdict, p_decided_by: by } };
  }
  if (type === 'asset_property_link_review') {
    if (c.ledger_id == null) return { error: 'missing_ledger' };
    let kept = null;
    if (verdict === 'relink') {
      kept = p.kept != null ? String(p.kept) : null;
      const cands = (Array.isArray(c.candidates) ? c.candidates : []).map((x) => String(x.property_id ?? x));
      if (!kept || !cands.includes(kept)) return { error: 'kept_not_a_candidate', candidates: cands };
    }
    return { db: 'ops', fn: 'lcc_decide_asset_property_link',
      args: { p_ledger_id: Number(c.ledger_id), p_decision: verdict, p_kept: kept, p_decided_by: by } };
  }
  if (type === 'gov_owner_contact_review') {
    if (c.review_id == null) return { error: 'missing_review' };
    return { db: 'ops', fn: 'lcc_decide_gov_owner_review',
      args: { p_review_id: Number(c.review_id), p_decision: verdict, p_decided_by: by } };
  }
  // contact_hub_conflict
  if (c.conflict_log_id == null) return { error: 'missing_conflict' };
  if (verdict === 'merge') {
    return { kind: 'contact_merge',
      snapshot: { db: 'ops', fn: 'lcc_snapshot_contact_conflict_merge',
        args: { p_log_id: Number(c.conflict_log_id), p_decided_by: by } } };
  }
  return { db: 'ops', fn: 'lcc_decide_contact_hub_conflict',
    args: { p_log_id: Number(c.conflict_log_id), p_decision: verdict, p_decided_by: by } };
}

/**
 * The call that undoes an APPLIED verdict, given the verdict and what the writer returned.
 * Null when the verdict wrote nothing (keep_both) — undo then only reopens the card.
 */
export function planReviewLanes1Undo(type, verdict, context, result, undoneBy) {
  const c = context || {};
  const r = result || {};
  const by = undoneBy == null ? null : String(undoneBy);
  if (type === 'listing_sale_review') {
    return { db: c.domain, fn: c.domain + '_undo_listing_sale_review',
      args: { p_review_id: Number(c.review_id), p_undone_by: by } };
  }
  if (type === 'asset_property_link_review') {
    return { db: 'ops', fn: 'lcc_undo_asset_property_link',
      args: { p_ledger_id: Number(c.ledger_id), p_undone_by: by } };
  }
  if (type === 'gov_owner_contact_review') {
    return { db: 'ops', fn: 'lcc_undo_gov_owner_review',
      args: { p_review_id: Number(c.review_id), p_undone_by: by } };
  }
  if (type === 'contact_hub_conflict') {
    if (verdict === 'merge') {
      return r.backup_id != null
        ? { db: 'ops', fn: 'lcc_undo_contact_conflict_merge', args: { p_backup_id: Number(r.backup_id) } }
        : null;
    }
    if (verdict === 'repoint_to_survivor') {
      return { db: 'ops', fn: 'lcc_undo_contact_hub_conflict_repoint',
        args: { p_log_id: Number(c.conflict_log_id), p_undone_by: by } };
    }
    return null;
  }
  return null;
}

/** RPC results come back as the jsonb object, or wrapped in a one-row array. */
export function unwrapRpc(data) {
  if (Array.isArray(data)) data = data[0];
  if (data && typeof data === 'object' && !('ok' in data)) {
    const vals = Object.values(data);
    if (vals.length === 1 && vals[0] && typeof vals[0] === 'object') return vals[0];
  }
  return data;
}

/** Lane card order inside the Decision Center: most visible to Scott first. */
export const REVIEW_LANES1_LABELS = Object.freeze({
  listing_sale_review: 'Available listings — sold or still on market?',
  asset_property_link_review: 'Asset → property relinks (merged away)',
  gov_owner_contact_review: 'Gov owner → hub contact',
  contact_hub_conflict: 'Contacts hub — two contacts, one owner',
});
