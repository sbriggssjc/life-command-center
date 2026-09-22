// ============================================================================
// GOV-UX1 (2026-09-22, SBN-25) — ONE resolver for "which LCC entity is this
// property's owner?"
//
// The property panel's Next-step card read "Create the lead — Owner resolved"
// for 13923 Gold Cir, Omaha, and clicking the owner answered "No entity found
// matching 'Gold Circle Properties, LLC'". Measured live 2026-09-22: LCC entity
// ff84dd24… "Gold Circle Properties" exists (canonical_name
// 'gold circle properties'), a merged twin fe43e581… sits beside it, and the gov
// true_owner identity (source_system='gov', source_type='true_owner') already
// points at it. The owner click did a substring ILIKE on the raw display string
// `, LLC` included, which matches neither name nor canonical_name — and even
// without the suffix it returned the tombstone too, so the caller saw two rows.
//
// Resolution ladder (first rung that yields exactly one LIVE entity wins):
//   1. entity_id            — a caller that already holds the id (lcc_property_owner)
//   2. domain identity      — external_identities(dia|gov, true_owner, <id>), the
//                             canonical by-ID join (CLAUDE.md); follows merges
//   3. canonical_exact      — normalizeCanonicalName(name) = entities.canonical_name,
//                             live rows only. Strips ONLY legal-entity forms
//                             (LLC, Inc, LP, Ltd, trailing punctuation) — never a
//                             fuzzy match, so two different parties can't collide
//                             beyond what canonical_name already groups.
// Two or more live canonical matches is AMBIGUOUS and is returned as candidates,
// never guessed.
//
// Pure planning lives here so it is unit-testable; the handler only fetches.
// ============================================================================

import { normalizeCanonicalName } from './entity-link.js';

export const OWNER_RESOLVE_METHODS = Object.freeze(['entity_id', 'domain_identity', 'canonical_exact']);

/** The canonical lookup key for an owner display string. */
export function ownerCanonicalKey(name) {
  if (name == null || String(name).trim() === '') return null;
  return normalizeCanonicalName(name);
}

/** Follow merged_into_entity_id to the live survivor (hop-capped, cycle-safe). */
export function followSurvivor(startId, byId, maxHops = 20) {
  let cur = startId ? String(startId) : null;
  const seen = new Set();
  for (let i = 0; cur && i < maxHops; i++) {
    if (seen.has(cur)) return null;          // a merge cycle has no survivor
    seen.add(cur);
    const row = byId.get(cur);
    if (!row) return i === 0 ? null : cur;   // unknown → can't prove liveness of a start id
    if (!row.merged_into_entity_id) return cur;
    cur = String(row.merged_into_entity_id);
  }
  return null;
}

/**
 * Decide the owner entity from already-fetched rows.
 *
 * @param {object} input
 * @param {string|null} input.entityId         caller-held id
 * @param {Array} input.entityRows              rows {id, merged_into_entity_id, name, entity_type}
 *                                              covering entityId / identity ids and their merge chains
 * @param {Array} input.identityRows            external_identities rows {entity_id}
 * @param {Array} input.canonicalRows           entities rows with canonical_name = key (any liveness)
 * @returns {{entity_id:string|null, method:string|null, status:'resolved'|'ambiguous'|'none', candidates:Array}}
 */
export function planOwnerResolution({ entityId = null, entityRows = [], identityRows = [], canonicalRows = [] } = {}) {
  const byId = new Map();
  for (const r of [...entityRows, ...canonicalRows]) if (r && r.id) byId.set(String(r.id), r);

  if (entityId) {
    const s = followSurvivor(entityId, byId);
    if (s) return { entity_id: s, method: 'entity_id', status: 'resolved', candidates: [] };
  }

  const identitySurvivors = new Set();
  for (const r of identityRows) {
    const s = followSurvivor(r && r.entity_id, byId);
    if (s) identitySurvivors.add(s);
  }
  if (identitySurvivors.size === 1) {
    return { entity_id: [...identitySurvivors][0], method: 'domain_identity', status: 'resolved', candidates: [] };
  }

  // Canonical rung: resolve every match to its survivor, then dedupe — a live
  // entity and its own merged twin are ONE answer, not two.
  const survivors = new Map();
  for (const r of canonicalRows) {
    const s = followSurvivor(r && r.id, byId);
    if (s && !survivors.has(s)) survivors.set(s, byId.get(s) || { id: s });
  }
  // A domain identity that disagreed with itself (2+ survivors) is narrowed by
  // the name, never guessed.
  if (identitySurvivors.size > 1) {
    const both = [...identitySurvivors].filter((id) => survivors.has(id));
    if (both.length === 1) return { entity_id: both[0], method: 'domain_identity', status: 'resolved', candidates: [] };
  }
  if (survivors.size === 1) {
    return { entity_id: [...survivors.keys()][0], method: 'canonical_exact', status: 'resolved', candidates: [] };
  }
  const candidates = [...survivors.values()].map((r) => ({ id: r.id, name: r.name || null, entity_type: r.entity_type || null }));
  if (identitySurvivors.size > 1) {
    for (const id of identitySurvivors) if (!survivors.has(id)) candidates.push({ id, name: byId.get(id)?.name || null, entity_type: byId.get(id)?.entity_type || null });
  }
  return { entity_id: null, method: null, status: candidates.length ? 'ambiguous' : 'none', candidates };
}
