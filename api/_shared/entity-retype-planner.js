// C13g-min-lane (2026-09-09) — pure planner for the Decision Center lane
// `entity_type_review`: the human-verdict lane over the retype write C13g-min
// already shipped (lcc_retype_entity / lcc_unretype_entity / lcc_entity_retype_log
// / v_lcc_entity_retype_candidates — migration 20261101120000). This lane exists
// because BOTH name-shape instruments are useless on this population (0 of 18
// carry an org marker; 7 of 18 fail lcc_looks_like_person) — it is a human
// verdict, never a rule. Design: docs/claude-code/prompts/C13g-min-lane-entity-
// type-review.md, docs/architecture/owner-role-classification.md §9e/§9f.
//
// Nothing in this module reads a database. api/admin.js hands it the row
// re-read from v_lcc_entity_retype_candidates AT VERDICT TIME (P188), plus the
// LIVE facts a guard needs (tombstone, current recorded entity_type), and it
// returns the decision. The single write is `rpc/lcc_retype_entity` — this
// module never PATCHes `entities` directly.
//
// The three verdicts:
//   retype_organization — the ONE write: rpc/lcc_retype_entity(p_entity,
//                          'organization', p_decision_id, p_reason). Reverse:
//                          rpc/lcc_unretype_entity(p_entity).
//   keep_person          — record-only; excluded from the lane (a human said
//                           this really is a person — the retype candidates
//                           view has no way to know that on its own).
//   research              — a research_task, existing machinery.

export const ENTITY_RETYPE_DECISION_TYPE = 'entity_type_review';
export const ENTITY_RETYPE_VERDICTS = Object.freeze(['retype_organization', 'keep_person', 'research']);
export const ENTITY_RETYPE_SOURCE_VIEW = 'v_lcc_entity_retype_candidates';

// subject_ref: `etype:<entity_id>` — the question is "is this entity really an
// organization", scoped to one entity, so a bare entity id is the whole key.
export function entityRetypeSubjectRef(row) {
  if (!row || !row.entity_id) return null;
  return 'etype:' + String(row.entity_id);
}

export function parseEntityRetypeSubjectRef(ref) {
  const m = /^etype:([0-9a-f-]{36})$/.exec(String(ref || ''));
  return m ? { entity_id: m[1] } : null;
}

// The card the operator sees. Every column the view carries rides through —
// the corroboration flags are the EVIDENCE, never a gate; looks_like_person_
// warning is a WARNING (that instrument is documented useless here — 7 of 18
// live candidates fail it), never a refusal.
export function buildEntityRetypeCard(row) {
  const r = row || {};
  return {
    entity_id: r.entity_id ? String(r.entity_id) : null,
    name: r.name || null,
    current_facts: Number(r.current_facts) || 0,
    current_rent: r.current_rent != null && Number.isFinite(Number(r.current_rent)) ? Number(r.current_rent) : null,
    has_salesforce_contact: r.has_salesforce_contact === true,
    has_salesforce_account: r.has_salesforce_account === true,
    n_rca_contact_ids: Number(r.n_rca_contact_ids) || 0,
    n_costar_contact_ids: Number(r.n_costar_contact_ids) || 0,
    looks_like_person_warning: r.looks_like_person_warning === true,
    has_org_marker: r.has_org_marker === true,
    relationship_count: Number(r.relationship_count) || 0,
    resolved_owner_of: Number(r.resolved_owner_of) || 0,
    // OWN-T0e: when set, retyping this entity is what a same_party/merge_now
    // verdict on that sponsor card needs — the card names which one.
    blocks_own_t0e_sponsor_id: r.blocks_own_t0e_sponsor_id ? String(r.blocks_own_t0e_sponsor_id) : null,
    blocks_own_t0e_token: r.blocks_own_t0e_token || null,
  };
}

// The verdict gate. `live` carries facts read from the database AT VERDICT
// TIME: { not_found: boolean, is_tombstone: boolean, recorded_type: string|null }.
// Returns { ok, verdict, entity_id, reason, error }.
export function validateEntityRetypeVerdict(card, verdict, payload, live) {
  const v = String(verdict || '').trim().toLowerCase();
  const p = (payload && typeof payload === 'object') ? payload : {};
  const lv = live || {};
  if (!card || !card.entity_id) return { ok: false, error: 'card has no entity_id' };
  if (!ENTITY_RETYPE_VERDICTS.includes(v)) return { ok: false, error: 'unknown verdict: ' + v };
  const entityId = card.entity_id;

  if (v === 'retype_organization') {
    if (lv.not_found === true) return { ok: false, error: 'entity not found' };
    if (lv.is_tombstone === true) return { ok: false, error: 'entity is a tombstone — resolve through lcc_entity_survivor first' };
    if (lv.recorded_type && lv.recorded_type !== 'person') {
      return { ok: false, error: 'recorded entity_type is no longer person (' + lv.recorded_type + ') — card is stale' };
    }
    const reason = (typeof p.reason === 'string' && p.reason.trim()) ? p.reason.trim() : null;
    return { ok: true, verdict: v, entity_id: entityId, reason };
  }

  if (v === 'keep_person') {
    return { ok: true, verdict: v, entity_id: entityId, reason: null };
  }

  // research
  return { ok: true, verdict: v, entity_id: entityId, reason: null };
}

// Lane ordering: a card blocking an OWN-T0e sponsor confirm first (it unblocks
// a second lane's work), then current rent desc — mirrors the view's own ORDER
// BY so the fetch branch and the SQL agree without re-deriving it.
export function orderEntityRetypeRows(rows) {
  const blocks = (r) => (r.blocks_own_t0e_sponsor_id ? 1 : 0);
  const rent = (r) => (r.current_rent != null && Number.isFinite(Number(r.current_rent)) ? Number(r.current_rent) : -1);
  return [...(rows || [])].sort((a, b) => blocks(b) - blocks(a) || rent(b) - rent(a)
    || String(a.name || '').localeCompare(String(b.name || '')));
}
