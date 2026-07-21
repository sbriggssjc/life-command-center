// api/_shared/contacts-company-link.js
// ============================================================================
// Phase 1b — connect owners to people via company resolution.
// ----------------------------------------------------------------------------
// Phase 1a exact-key backfilled `unified_contacts.entity_id` (person entities,
// all 1:1) but set NO edges. This module drains the resolved candidate surface
// `v_lcc_contact_company_link_candidates`:
//   * exact_unique   → auto-apply a person→owner-org edge (Unit 1). Reuses the
//                      SAME `linkPersonToEntity` the contact picker / acquisition
//                      worker use (dupe-guarded, `associated_with`, metadata.via
//                      batch tag). Guarded: skip junk owner names / implausible
//                      person names / tombstoned (the view already excludes
//                      tombstoned + junk-flagged, this is defense-in-depth).
//   * exact_ambiguous / fuzzy → surfaced to the Decision-Center
//                      `contact_company_link` federated lane (Unit 2), never a
//                      guess.
//
// The matcher lives in SQL (the view, reusing lcc_normalize_entity_name); this
// module does NOT fork a matcher. Reversible: every edge carries
// metadata.via='contacts_phase1b:<batch_tag>'.
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';
import { linkPersonToEntity } from './contact-attach.js';
import { isJunkEntityName, isImplausiblePersonName, looksLikePersonName } from './entity-link.js';

export const DEFAULT_BATCH_TAG = 'phase1b_20260721';
export const LINK_ROLE = 'works_at';

// Columns the worker reads off the candidate view.
export const CANDIDATE_COLS = 'unified_id,person_entity_id,person_name,company_name,'
  + 'match_class,n_candidate_orgs,owner_org_id,owner_org_name,workspace_id,rank_value';

/**
 * Pure per-row decision for an exact_unique candidate: apply a person→owner-org
 * edge unless a guard rejects it. No I/O. deps injectable for tests.
 *
 * @returns {{action:'apply'|'skip', reason?:string, edge?:object}}
 */
export function planCompanyLink(row, opts = {}) {
  const batchTag = opts.batchTag || DEFAULT_BATCH_TAG;
  const isImplausible = opts.isImplausible || isImplausiblePersonName;
  const isPerson = opts.looksLikePerson || looksLikePersonName;
  if (!row || !row.owner_org_id || !row.person_entity_id) {
    return { action: 'skip', reason: 'incomplete_row' };
  }
  // Person side: the named implausible-person guard, PLUS the positive "is this a
  // reachable human" shape guard (looksLikePersonName). The round connects owners
  // to PEOPLE — linking a non-human (a city / a sentence mis-typed as a person)
  // would make the owner LOOK reachable and hide its real acquisition need. Both
  // are existing entity-link.js guards (no new logic).
  if (isImplausible(row.person_name)) return { action: 'skip', reason: 'implausible_person' };
  if (!isPerson(row.person_name)) return { action: 'skip', reason: 'not_a_person_name' };
  // Owner org name: use the org-safe junk guard (does NOT reject firm suffixes).
  if (isJunkEntityName(row.owner_org_name)) return { action: 'skip', reason: 'junk_owner_name' };
  return {
    action: 'apply',
    edge: {
      workspaceId: row.workspace_id,
      entityId: row.owner_org_id,          // the owner org "has" the contact
      contactEntityId: row.person_entity_id, // the person
      role: LINK_ROLE,
      via: 'contacts_phase1b:' + batchTag,
    },
  };
}

/** Count exact_ambiguous + fuzzy rows (the Unit-2 review universe). */
export async function countReviewLane(q = opsQuery) {
  const one = async (cls) => {
    const r = await q('GET', 'v_lcc_contact_company_link_candidates?select=unified_id'
      + '&match_class=eq.' + cls + '&limit=1', undefined, { countMode: 'exact' });
    return (r.ok && typeof r.count === 'number') ? r.count : null;
  };
  const [ambiguous, fuzzy] = await Promise.all([one('exact_ambiguous'), one('fuzzy')]);
  return { ambiguous, fuzzy };
}

/**
 * Fetch a page of exact_unique candidates (value-ranked). PostgREST caps at
 * 1000/page, so callers page. `limit` bounds the total processed per invocation.
 */
export async function fetchExactUnique(limit, q = opsQuery) {
  const page = Math.min(1000, limit);
  const r = await q('GET', 'v_lcc_contact_company_link_candidates?select=' + CANDIDATE_COLS
    + '&match_class=eq.exact_unique&order=rank_value.desc.nullslast,person_entity_id&limit=' + page);
  if (!r.ok) return { ok: false, detail: r.data };
  return { ok: true, rows: Array.isArray(r.data) ? r.data : [] };
}

/**
 * Of a set of owner-org ids, which currently have NO person edge (so a link is
 * their FIRST contact) and which are in the contactless worklist. Bounded by the
 * id list. Best-effort — a failed probe returns empty sets (the counts degrade
 * to 0, never blocks the apply).
 */
export async function classifyOwnerState(ownerIds, q = opsQuery) {
  const ids = [...new Set((ownerIds || []).filter(Boolean))];
  const out = { hasPerson: new Set(), inWorklist: new Set() };
  if (!ids.length) return out;
  const inList = ids.map((id) => pgFilterVal(id)).join(',');
  try {
    // Owners already carrying a person edge (either direction).
    const rel = await q('GET', 'entity_relationships?select=from_entity_id,to_entity_id'
      + '&relationship_type=in.(associated_with,contact_at,works_at)'
      + '&or=(from_entity_id.in.(' + inList + '),to_entity_id.in.(' + inList + '))&limit=10000');
    if (rel.ok && Array.isArray(rel.data)) {
      const idset = new Set(ids);
      for (const r of rel.data) {
        const owner = idset.has(r.from_entity_id) ? r.from_entity_id
          : (idset.has(r.to_entity_id) ? r.to_entity_id : null);
        // We can only be sure the OWNER is here; the other end may or may not be a
        // person. Treat any such edge as "has a related entity" — conservative for
        // the first-contact count (may undercount first-contacts, never overcount).
        if (owner) out.hasPerson.add(owner);
      }
    }
  } catch (_e) { /* soft */ }
  try {
    const wl = await q('GET', 'v_owner_contact_worklist?select=entity_id&entity_id=in.(' + inList + ')&limit=10000');
    if (wl.ok && Array.isArray(wl.data)) for (const r of wl.data) out.inWorklist.add(r.entity_id);
  } catch (_e) { /* soft */ }
  return out;
}

/** Best-effort priority-queue cache refresh (Slice-1 staleness hook). */
export async function refreshQueue(q = opsQuery) {
  try { await q('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ }
}
