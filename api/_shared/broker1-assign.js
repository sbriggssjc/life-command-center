// ============================================================================
// api/_shared/broker1-assign.js
// ----------------------------------------------------------------------------
// BROKER1 — live ROE self-signal resolution for the prospect population.
//
// Reuses roe.js::brokerClass() directly (never re-implements the classifier).
// Scope: the SF Account-owner signal only (`resolveAccountOwner`'s "entity
// account" tier reused at batch grain — `entities.external_identities`
// source_system='salesforce', source_type='account', metadata.sf_owner_name),
// because that lives on LCC Opps itself and can be read in one paged query
// for the whole prospect population. The dealAssignees tier (dia
// salesforce_activities.assigned_to) is a per-contact, cross-database signal
// (P123: an N+1 round trip per prospect is exactly the cost this repo's
// doctrine warns against) and is left to the existing Contact 360 panel,
// which already computes it per-contact on demand — this pass does not
// duplicate that path.
//
// Writes ONLY where the prospect has no existing lcc_entity_owner_override
// row (fill-blanks-only — rule 1 must never override a real prior
// assignment, and this pass must never overwrite the SQL default sweep or a
// human). A name that cannot be resolved to a known lcc_users row is left
// alone (never guessed) — it falls through to the vertical-default sweep in
// lcc_broker1_assign_prospect_brokers().
// ============================================================================

import { opsQuery, isOpsConfigured, pgFilterVal } from './ops-db.js';
import { brokerClass } from './roe.js';

const PAGE = 1000; // PostgREST hard cap regardless of `limit=`

async function fetchAllPages(path) {
  const out = [];
  let offset = 0;
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await opsQuery('GET', `${path}${sep}limit=${PAGE}&offset=${offset}`, null, { countMode: 'none' });
    if (!r.ok || !Array.isArray(r.data)) break;
    out.push(...r.data);
    if (r.data.length < PAGE) break;
    offset += PAGE;
    if (offset > 200000) break; // sanity cap
  }
  return out;
}

/**
 * Resolve an SF owner display name to a known Team Briggs lcc_users row.
 * Conservative: the owner name must CONTAIN a known active lcc_users
 * display_name (case-insensitive). Never guesses; returns null on ambiguity.
 */
export function matchLccUser(ownerName, lccUsers) {
  const s = String(ownerName || '').trim().toLowerCase();
  if (!s) return null;
  const hits = lccUsers.filter(u => u.display_name && s.includes(String(u.display_name).trim().toLowerCase()));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * For every prospect (entity in lcc_priority_queue_resolved) that has NO
 * existing lcc_entity_owner_override row, check its SF Account-owner name
 * (the "self" ROE signal already captured on the entity's external
 * identity). If roe.js::brokerClass classifies it 'self' AND it resolves
 * unambiguously to an active lcc_users row, write the override
 * (set_by='broker1_roe_self'), fill-blanks-only.
 *
 * Returns { scanned, self_signal_found, self_signal_written, self_signal_unresolved }.
 */
export async function applyBroker1RoeSelfSignal({ dryRun = true } = {}) {
  const result = { scanned: 0, self_signal_found: 0, self_signal_written: 0, self_signal_unresolved: 0, error: null };
  if (!isOpsConfigured()) { result.error = 'ops_not_configured'; return result; }

  const lccUsersRes = await opsQuery('GET', 'lcc_users?active=eq.true&select=lcc_user_id,display_name', null, { countMode: 'none' });
  if (!lccUsersRes.ok || !Array.isArray(lccUsersRes.data)) { result.error = 'lcc_users_fetch_failed'; return result; }
  const lccUsers = lccUsersRes.data;

  const queueRows = await fetchAllPages('lcc_priority_queue_resolved?entity_id=not.is.null&select=entity_id');
  const prospectIds = Array.from(new Set(queueRows.map(r => r.entity_id).filter(Boolean)));
  if (!prospectIds.length) return result;

  // Which prospects already carry ANY override row (manual, sf_owner-captured,
  // or a prior run of this function)? Those are excluded — fill-blanks only.
  const alreadyAssigned = new Set();
  for (let i = 0; i < prospectIds.length; i += PAGE) {
    const chunk = prospectIds.slice(i, i + PAGE).map(id => pgFilterVal(id)).join(',');
    const r = await opsQuery('GET', `lcc_entity_owner_override?entity_id=in.(${chunk})&select=entity_id`, null, { countMode: 'none' });
    if (r.ok && Array.isArray(r.data)) for (const row of r.data) alreadyAssigned.add(row.entity_id);
  }

  const unassignedIds = prospectIds.filter(id => !alreadyAssigned.has(id));
  result.scanned = unassignedIds.length;
  if (!unassignedIds.length) return result;

  // Batch-fetch the SF Account owner signal for every unassigned prospect.
  const ownerByEntity = new Map();
  for (let i = 0; i < unassignedIds.length; i += PAGE) {
    const chunk = unassignedIds.slice(i, i + PAGE).map(id => pgFilterVal(id)).join(',');
    const r = await opsQuery('GET',
      `external_identities?entity_id=in.(${chunk})&source_system=eq.salesforce&source_type=eq.account` +
      `&select=entity_id,metadata`, null, { countMode: 'none' });
    if (r.ok && Array.isArray(r.data)) {
      for (const row of r.data) {
        const name = row.metadata && row.metadata.sf_owner_name;
        if (name && !ownerByEntity.has(row.entity_id)) ownerByEntity.set(row.entity_id, name);
      }
    }
  }

  const toWrite = [];
  for (const [entityId, ownerName] of ownerByEntity) {
    const cls = brokerClass(ownerName);
    if (cls !== 'self') continue;
    result.self_signal_found++;
    const user = matchLccUser(ownerName, lccUsers);
    if (!user) { result.self_signal_unresolved++; continue; }
    toWrite.push({ entity_id: entityId, owner_user_id: user.lcc_user_id, set_by: 'broker1_roe_self', note: `sf_owner:${ownerName}` });
  }

  if (dryRun || !toWrite.length) { result.self_signal_written = dryRun ? toWrite.length : 0; return result; }

  // Fill-blanks: on_conflict do nothing — a race with another writer since
  // the read above must never clobber it.
  const w = await opsQuery('POST',
    'lcc_entity_owner_override?on_conflict=entity_id',
    toWrite,
    { headers: { Prefer: 'resolution=ignore-duplicates,return=representation' } }
  );
  result.self_signal_written = (w.ok && Array.isArray(w.data)) ? w.data.length : 0;
  return result;
}
