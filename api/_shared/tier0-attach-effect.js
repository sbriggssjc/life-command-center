// api/_shared/tier0-attach-effect.js
// ============================================================================
// P194 — the SINGLE owner of "attach this person as the owner's active contact"
// for the Tier 0 lane.
// ----------------------------------------------------------------------------
// Prompt 192 §1 asked for an auto-attach sweep and was explicit about where it
// must live: "Build it in the EXISTING verdict path, not as a new SQL writer.
// The JS verdict path carries the shape gates and re-reads the card at write
// time. A SQL function would bypass all of it — the 'second write path that
// skips the guards' this repo has been bitten by before."
//
// The same argument applies one level down. Copying the ~90-line attach block
// out of `admin.js::handleDecisionVerdict` into a tick handler would satisfy the
// letter of that instruction ("it's in JS") and break its intent: two writers of
// `owner_contact_pivot.active_contact_entity_id` that drift apart, which is the
// normaliser-drift failure this codebase documents in a dozen places (the
// P119 terminal-error classifier, `lcc_mint_gov_asset_entities`, the JS-copy-of-
// a-SQL-normaliser note). So the effect is extracted ONCE and both callers run
// it: the human verdict in admin.js, and the sweep in
// `_handlers/tier0-auto-attach-tick.js`.
//
// WHAT THIS OWNS, AND WHAT IT DELIBERATELY DOES NOT.
//   Owns:  the fill-blanks re-check, the ledger row (written BEFORE the write,
//          carrying the prior pivot state), the pivot write, the person->owner
//          edge, and the queue refresh.
//   Not:   the shape gate (`validateTier0Verdict` — the caller runs it, because
//          the caller is the one holding the card), and `lcc_decisions`. The
//          human path records a verdict there because a human was asked a
//          question; the sweep does NOT, because nobody was asked. Minting a
//          "decided" decision for a machine write would put a human's name on
//          an unattended one.
//
// ⚠️ THE LEDGER IS WHAT CLOSES THE CARD, NOT THE DECISION ROW. The lane view
// excludes on `lcc_tier0_confirm_log(owner_entity_id, domain)`, so the ledger
// write is load-bearing, not audit. If it fails, the card must stay open.
//
// ⚠️ `active_source` IS PART OF THE LANE'S OWN EXCLUSION LOGIC. The lane hides an
// owner whose pivot contact came from OUTSIDE this lane, and P194 had to widen
// that test from `<> 'tier0_confirm'` to a SET because 'tier0_auto' would
// otherwise read as an outside source and hide the owner's OTHER open cards.
// Measured: 3 of 9 auto owners hold a second card, two of them live `ask`
// questions. **Adding a third source string here means editing that view too.**
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';

/** Human verdict. */
export const TIER0_SOURCE_CONFIRM = 'tier0_confirm';
/** Unattended P194 sweep. Distinguishable from a human verdict forever. */
export const TIER0_SOURCE_AUTO = 'tier0_auto';

/**
 * Every source string this lane may stamp on owner_contact_pivot.active_source.
 * The SQL lane view carries the same set; they must not drift.
 * @see supabase/migrations/20260827090000_lcc_p194_*.sql
 */
export const TIER0_LANE_SOURCES = [TIER0_SOURCE_CONFIRM, TIER0_SOURCE_AUTO];

/**
 * The contact role written alongside the person.
 *
 * Deliberately NOT promoted from a job title: `active_authority_level` means
 * legal or control authority (1 signatory > 2 controlling > 3 economic >
 * 4 agent > 5 captured), and "President" in a CRM title field does not
 * establish it. The role bucket goes in `active_contact_role`, where it belongs.
 */
export function tier0ContactRole(person) {
  const rb = person && person.role_bucket;
  return (rb && rb !== 'no_title') ? rb : 'prospecting_contact';
}

/** `t0cl_` for a human click, `t0auto_` for the sweep — greppable in the ledger. */
export function tier0BatchTag(source, nowIso) {
  const day = String(nowIso || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
  return (source === TIER0_SOURCE_AUTO ? 't0auto_' : 't0cl_') + day;
}

/**
 * Apply a Tier 0 attach.
 *
 * The caller MUST have already run `validateTier0Verdict(card, 'attach', ...)`
 * and pass the person it returned. This function re-checks nothing about the
 * person's NAME — that is the gate's job and duplicating it here would be a
 * second opinion that can disagree.
 *
 * @param {object}  a
 * @param {object}  a.card        the card from buildTier0Card (already gated)
 * @param {object}  a.person      the person the gate returned
 * @param {string}  a.ownerId
 * @param {string}  a.domain
 * @param {string}  a.subjectRef  t0:<ownerId>:<domain>
 * @param {string}  a.source      TIER0_SOURCE_CONFIRM | TIER0_SOURCE_AUTO
 * @param {string=} a.actor       user id for a human verdict; null for the sweep
 * @param {string=} a.rentBandName
 * @param {string=} a.workspaceIdFallback
 * @param {string=} a.batchTag    override (the sweep pins one tag per run)
 * @returns {Promise<{ok:boolean, action:string, ...}>}
 *   action: 'attached' | 'no_longer_actionable' | 'ledger_failed' | 'pivot_write_failed'
 */
export async function applyTier0Attach({
  card, person, ownerId, domain, subjectRef, source,
  actor = null, rentBandName = null, workspaceIdFallback = null, batchTag = null,
}) {
  const nowIso = new Date().toISOString();
  const tag = batchTag || tier0BatchTag(source, nowIso);

  const pivotR = await opsQuery('GET', 'owner_contact_pivot?select=entity_id,owner_name,workspace_id,'
    + 'active_contact_entity_id,active_contact_name,active_contact_role,active_authority_level,'
    + 'active_source,confidence&entity_id=eq.' + pgFilterVal(ownerId) + '&limit=1');
  const pivot = (pivotR.ok && Array.isArray(pivotR.data)) ? pivotR.data[0] : null;

  // FILL-BLANKS, re-checked HERE rather than on the card: the owner may have
  // gained a contact from another source since the card was rendered, and this
  // lane must never clobber it. For the sweep this is also the only defence
  // against a stale scan — the population is read once and written N times.
  if (pivot && pivot.active_contact_entity_id) {
    return {
      ok: true, action: 'no_longer_actionable',
      existing_contact_entity_id: pivot.active_contact_entity_id,
      existing_source: pivot.active_source || null,
    };
  }

  const workspaceId = (pivot && pivot.workspace_id) || card.owner_workspace_id || workspaceIdFallback || null;
  const contactRole = tier0ContactRole(person);

  // The ledger is written BEFORE the pivot write and carries the prior state, so
  // one verdict or a whole batch reverses exactly. It is also what removes the
  // card from the lane, so a failure here must abort rather than leave an
  // invisible write.
  const led = await opsQuery('POST',
    'lcc_tier0_confirm_log?on_conflict=subject_ref,verdict,batch_tag', {
      batch_tag: tag, subject_ref: subjectRef, verdict: 'attach',
      owner_entity_id: ownerId, owner_name: card.owner_name, domain,
      owner_rent: card.owner_rent, rent_band: rentBandName,
      match_arms: card.match_arms, match_keys: card.match_keys,
      actor,
      person_entity_id: person.person_id, person_name: person.person_name,
      person_email: person.email,
      link_evidence: person.link_evidence || [], person_evidence: person.person_evidence || [],
      prior_active_contact_entity_id: pivot ? pivot.active_contact_entity_id : null,
      prior_active_contact_name: pivot ? pivot.active_contact_name : null,
      prior_active_contact_role: pivot ? pivot.active_contact_role : null,
      prior_active_authority_level: pivot ? pivot.active_authority_level : null,
      prior_active_source: pivot ? pivot.active_source : null,
      prior_confidence: pivot ? pivot.confidence : null,
      pivot_row_created: !pivot,
      relationship_role: contactRole,
    }, { headers: { Prefer: 'resolution=merge-duplicates,return=representation' } });
  const logId = (led.ok && Array.isArray(led.data) && led.data[0]) ? led.data[0].log_id : null;
  if (!led.ok) {
    return { ok: false, action: 'ledger_failed', detail: led.data };
  }

  const pivotFields = {
    active_contact_entity_id: person.person_id,
    active_contact_name: person.person_name,
    active_contact_role: contactRole,
    active_authority_level: 5,
    active_source: source,
    // A human confirmed the LINK (or an exact domain match established it); the
    // person's authority INSIDE the firm is still unknown. 'medium' is the
    // honest rung, not 'high'.
    confidence: 'medium',
    enrichment_action: null,
    updated_at: nowIso,
  };
  const wr = pivot
    ? await opsQuery('PATCH', 'owner_contact_pivot?entity_id=eq.' + pgFilterVal(ownerId), pivotFields)
    : await opsQuery('POST', 'owner_contact_pivot',
      { entity_id: ownerId, owner_name: card.owner_name, workspace_id: workspaceId, ...pivotFields });
  if (!wr.ok) {
    if (logId != null) {
      await opsQuery('PATCH', 'lcc_tier0_confirm_log?log_id=eq.' + logId,
        { reverted_at: nowIso }).catch(() => {});
    }
    return { ok: false, action: 'pivot_write_failed', detail: wr.data, log_id: logId };
  }

  // The edge is what makes the owner reachable in the GRAPH (what
  // owner-reachable-via reads). Best-effort: the pivot write is the primary
  // effect, and a duplicate edge is a no-op inside the helper.
  const { linkPersonToEntity } = await import('./contact-attach.js');
  const link = await linkPersonToEntity({
    workspaceId, entityId: ownerId, contactEntityId: person.person_id,
    role: contactRole, via: source === TIER0_SOURCE_AUTO ? 'tier0_auto_p194' : 'tier0_confirm_p188',
  });
  let relationshipId = null;
  try {
    const relR = await opsQuery('GET', 'entity_relationships?select=id&relationship_type=eq.associated_with'
      + '&from_entity_id=eq.' + pgFilterVal(ownerId)
      + '&to_entity_id=eq.' + pgFilterVal(person.person_id)
      + '&order=created_at.desc&limit=1');
    relationshipId = (relR.ok && Array.isArray(relR.data) && relR.data[0]) ? relR.data[0].id : null;
  } catch (_e) { /* soft — the ledger still names the pair */ }
  if (logId != null) {
    await opsQuery('PATCH', 'lcc_tier0_confirm_log?log_id=eq.' + logId,
      { relationship_id: relationshipId, relationship_created: !!(link && link.linked) }).catch(() => {});
  }

  return {
    ok: true, action: 'attached',
    log_id: logId, batch_tag: tag,
    pivot_row_created: !pivot,
    workspace_id: workspaceId,
    contact_role: contactRole,
    relationship_id: relationshipId,
    relationship: (link && link.existed) ? 'existed' : ((link && link.linked) ? 'created' : 'failed'),
  };
}

export default applyTier0Attach;
