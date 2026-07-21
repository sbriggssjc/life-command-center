// api/_shared/contacts-company-link.js
// ============================================================================
// Contact → company link (Phase 1b + the aggressive-normalizer widen).
// ----------------------------------------------------------------------------
// Phase 1a exact-key backfilled `unified_contacts.entity_id` (person entities,
// all 1:1) but set NO edges. This module drains the resolved candidate surface
// `v_lcc_contact_company_link_candidates`:
//   * auto_appliable=true  → auto-apply a person→owner-org edge. Reuses the SAME
//                      `linkPersonToEntity` the contact picker / acquisition
//                      worker use (dupe-guarded, `associated_with`,
//                      metadata.role='works_at', metadata.via batch tag). The
//                      view flags a row auto_appliable when n_candidate_orgs=1
//                      (the ambiguity gate) AND the AGGRESSIVE descriptor-core
//                      of company_name == that of owner_org_name (len>=4) AND the
//                      person guards pass. So "Blake Real Estate" ↔ "Blake Real
//                      Estate Inc" now auto-links, not just dense-equal names.
//   * everything else → surfaced to the Decision-Center `contact_company_link`
//                      federated lane (never a guess).
//
// The name-core normalizer is defined ONCE — the SQL 2-arg
// `lcc_normalize_entity_name(name, true)` (the view) and the JS
// `aggressiveCompanyCore` (this module, the resolver's apply-time canary) are
// kept in lockstep by test/contacts-company-link.test.mjs (SQL↔JS agreement on a
// fixture list), so the two tiers can never drift. This module does NOT fork a
// matcher — the match lives in the view; the JS mirror re-verifies the core at
// apply time and is the drift canary.
//
// Reversible: every edge carries metadata.via='contact_company_link:<batch_tag>'.
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';
import { linkPersonToEntity } from './contact-attach.js';
import { isJunkEntityName, isImplausiblePersonName, looksLikePersonName } from './entity-link.js';

export const DEFAULT_BATCH_TAG = 'company_link_widen_20260721';
export const VIA_PREFIX = 'contact_company_link:';
export const LINK_ROLE = 'works_at';

// The AGGRESSIVE descriptor suffixes (trailing, iterative). Kept as an exported
// constant so the JS mirror + the SQL function + the test all reference one list.
// Mirrors the 2-arg lcc_normalize_entity_name(text, boolean) SQL body exactly.
export const AGGRESSIVE_SUFFIXES = [
  'inc', 'llc', 'lp', 'llp', 'ltd', 'corp', 'corporation', 'company', 'co', 'trust',
  'group', 'holdings', 'partners', 'properties', 'props', 'realty', 'management',
  'mgmt', 'associates', 'enterprises', 'capital', 'development', 'developers',
];
const AGGRESSIVE_SUFFIX_RE = new RegExp('\\s+(' + AGGRESSIVE_SUFFIXES.join('|') + ')$');

/**
 * Aggressive descriptor-core normalizer — the EXACT JS mirror of the SQL
 * `lcc_normalize_entity_name(text, true)`. Order (mirrors the SQL):
 *   lowercase → drop parentheticals → keep before the first `|` → separators to
 *   single space → drop a leading "the" → ITERATIVELY strip a trailing descriptor
 *   token (and the two-word "real estate") until stable → dense collapse.
 * The loop is required: a single trailing-token pass stalls ("claremont group
 * llc" → "claremont group") before reaching "claremont".
 * Pure. Returns a dense lowercase string (possibly '' for all-descriptor input).
 */
export function aggressiveCompanyCore(name) {
  if (name == null) return '';
  let v = String(name).toLowerCase();
  v = v.replace(/\([^)]*\)/g, ' ');       // drop parentheticals
  v = v.split('|')[0];                     // keep before the first `|`
  v = v.replace(/[^a-z0-9]+/g, ' ').trim();
  v = v.replace(/^the\s+/, '');            // leading "the"
  let prev;
  do {
    prev = v;
    v = v.replace(/\s+real\s+estate$/, '');
    v = v.replace(AGGRESSIVE_SUFFIX_RE, '');
    v = v.trim();
  } while (v !== prev);
  return v.replace(/[^a-z0-9]+/g, '');     // dense core
}

/** The apply-time core gate: two names share an aggressive descriptor-core (>=4). */
export function coreMatches(companyName, ownerName) {
  const a = aggressiveCompanyCore(companyName);
  return a.length >= 4 && a === aggressiveCompanyCore(ownerName);
}

// Columns the worker reads off the candidate view.
export const CANDIDATE_COLS = 'unified_id,person_entity_id,person_name,company_name,'
  + 'match_class,n_candidate_orgs,owner_org_id,owner_org_name,workspace_id,rank_value,auto_appliable';

/**
 * Pure per-row decision for an auto_appliable candidate: apply a person→owner-org
 * edge unless a guard rejects it. No I/O. deps injectable for tests.
 *
 * The SQL view already gated n_candidate_orgs=1 + aggressive-core equality; this
 * planner re-applies the JS person/junk guards (the single source of the name
 * guards) so the two tiers agree, and shapes the edge. Reversible via metadata.via.
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
      via: VIA_PREFIX + batchTag,
    },
  };
}

/**
 * Lane counts: the auto-appliable set + the human-review remainder (single /
 * multi candidate). PostgREST count=exact per bucket.
 */
export async function countLane(q = opsQuery) {
  const one = async (filter) => {
    const r = await q('GET', 'v_lcc_contact_company_link_candidates?select=unified_id&' + filter
      + '&limit=1', undefined, { countMode: 'exact' });
    return (r.ok && typeof r.count === 'number') ? r.count : null;
  };
  const [auto, reviewSingle, reviewMulti] = await Promise.all([
    one('auto_appliable=eq.true'),
    one('auto_appliable=eq.false&n_candidate_orgs=eq.1'),
    one('auto_appliable=eq.false&n_candidate_orgs=gt.1'),
  ]);
  const review = (reviewSingle == null || reviewMulti == null) ? null : reviewSingle + reviewMulti;
  return { auto, review, review_single: reviewSingle, review_multi: reviewMulti };
}

/**
 * Fetch a page of auto_appliable candidates (value-ranked). PostgREST caps at
 * 1000/page; `limit` bounds the total processed per invocation.
 */
export async function fetchAutoAppliable(limit, q = opsQuery) {
  const page = Math.min(1000, limit);
  const r = await q('GET', 'v_lcc_contact_company_link_candidates?select=' + CANDIDATE_COLS
    + '&auto_appliable=eq.true&order=rank_value.desc.nullslast,person_entity_id&limit=' + page);
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
    const rel = await q('GET', 'entity_relationships?select=from_entity_id,to_entity_id'
      + '&relationship_type=in.(associated_with,contact_at,works_at)'
      + '&or=(from_entity_id.in.(' + inList + '),to_entity_id.in.(' + inList + '))&limit=10000');
    if (rel.ok && Array.isArray(rel.data)) {
      const idset = new Set(ids);
      for (const r of rel.data) {
        const owner = idset.has(r.from_entity_id) ? r.from_entity_id
          : (idset.has(r.to_entity_id) ? r.to_entity_id : null);
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
