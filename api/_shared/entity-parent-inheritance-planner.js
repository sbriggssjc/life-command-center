// api/_shared/entity-parent-inheritance-planner.js
// ============================================================================
// ACI-phase1-2 Unit B — AC1e, SPE subsidiary → true-owner-parent inheritance.
// ----------------------------------------------------------------------------
// PURE, no I/O. Scott (from the account-based-contact-intelligence lane):
// subsidiaries "should be connected to the true owner parent once we have a
// connected domain and person." `lcc_buyer_parents` (curated parents) and
// `v_lcc_entity_tier0_parent` (subsidiary → candidate-parent proposals) already
// exist. This module decides, PER SUBSIDIARY, whether it can auto-attach to its
// parent's existing Tier 0 contact, or whether it needs a human (WHICH person,
// when the parent has more than one candidate).
//
// ⚠️ THE BULK ATTACH GOES THROUGH THE EXISTING JS VERDICT PATH ONLY.
// `api/_shared/tier0-attach-effect.js::applyTier0Attach` is the SINGLE writer
// of an owner→contact attach (owner_contact_pivot + ledger + person→owner edge)
// — P194's own rule ("ONE WRITER, TWO CALLERS"). This module produces a PLAN
// only (which subsidiary inherits which person, at what confidence); a caller
// (a Decision Center verdict or an explicit sweep) must invoke the SAME
// applyTier0Attach effect used everywhere else in Tier 0. This file contains
// NO SQL write and NO fetch — it is not itself the writer.
//
// ⚠️ RE-MEASURED 2026-09-10 (xengecqvemvfknjvbvrq), the "19 of 107" figure
// from the original P193/AC1e note has MOVED:
//   select count(*) from v_lcc_entity_tier0_parent;   -> 227 (was 330)
//   select entity_id, count(distinct parent_entity_id)
//     from v_lcc_entity_tier0_parent group by 1;      -> every subsidiary
//                                                         already resolves to
//                                                         EXACTLY ONE parent
//                                                         candidate at the
//                                                         SUBSIDIARY level.
// The "which person" ambiguity Scott named (UIRC has 7 candidates) lives one
// level DOWN — at the PARENT's Tier 0 bench of candidate people, not at the
// subsidiary→parent mapping. `v_lcc_entity_tier0_parent` alone cannot answer
// "which person"; this module's `planParentInheritance()` takes the parent's
// resolved Tier 0 winner (or bench) as an input, exactly as it would come from
// the existing tier0-confirm-planner machinery, and states plainly when that
// input is ambiguous (>1 eligible person) rather than guessing.
// ============================================================================

/**
 * @typedef {object} SubsidiaryParentProposal
 * @property {string} entity_id          - the subsidiary entity id
 * @property {string} parent_entity_id   - the resolved parent (curated buyer_parent)
 * @property {string} [parent_name]
 */

/**
 * @typedef {object} ParentContactState
 * @property {string} parent_entity_id
 * @property {string|null} active_contact_entity_id - the parent's CONFIRMED Tier 0 contact, if any
 * @property {string|null} active_contact_name
 * @property {number} eligible_candidate_count       - how many people are ON the parent's bench
 */

/**
 * @typedef {object} InheritanceDecision
 * @property {string} entity_id
 * @property {string} parent_entity_id
 * @property {'inherit'|'needs_human'|'no_parent_contact'} action
 * @property {string|null} contact_entity_id  - set only when action === 'inherit'
 * @property {string} reason
 */

/**
 * Decide, per subsidiary, whether it can inherit its parent's confirmed
 * contact automatically, or needs a human because the parent itself has no
 * confirmed contact yet, or has more than one eligible candidate (the "UIRC
 * has 7" case — WHICH person stays a human decision, per Scott's instruction).
 *
 * @param {SubsidiaryParentProposal[]} proposals
 * @param {Map<string, ParentContactState>} parentStates - keyed by parent_entity_id
 * @returns {InheritanceDecision[]}
 */
export function planParentInheritance(proposals, parentStates) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(proposals) ? proposals : []) {
    const entityId = String(p?.entity_id || '').trim();
    const parentId = String(p?.parent_entity_id || '').trim();
    if (!entityId || !parentId) continue;

    // A subsidiary must resolve to exactly one parent to inherit anything —
    // if it is proposed against >1 parent, that is a data conflict, not an
    // inheritance decision, and it is routed to a human rather than guessed.
    const key = entityId;
    if (seen.has(key)) {
      const existing = out.find((d) => d.entity_id === entityId);
      if (existing && existing.parent_entity_id !== parentId) {
        existing.action = 'needs_human';
        existing.contact_entity_id = null;
        existing.reason = 'subsidiary_proposed_against_multiple_parents';
      }
      continue;
    }
    seen.add(key);

    const parent = parentStates instanceof Map ? parentStates.get(parentId) : undefined;
    if (!parent) {
      out.push({
        entity_id: entityId,
        parent_entity_id: parentId,
        action: 'needs_human',
        contact_entity_id: null,
        reason: 'parent_state_unknown',
      });
      continue;
    }

    if (parent.eligible_candidate_count > 1 && !parent.active_contact_entity_id) {
      // The "UIRC has 7 candidates" case — the parent itself has not been
      // resolved to one person yet. WHICH person is a human decision.
      out.push({
        entity_id: entityId,
        parent_entity_id: parentId,
        action: 'needs_human',
        contact_entity_id: null,
        reason: 'parent_has_multiple_unresolved_candidates',
      });
      continue;
    }

    if (!parent.active_contact_entity_id) {
      out.push({
        entity_id: entityId,
        parent_entity_id: parentId,
        action: 'no_parent_contact',
        contact_entity_id: null,
        reason: 'parent_has_no_confirmed_contact_yet',
      });
      continue;
    }

    // Parent has exactly one confirmed contact -> safe to inherit.
    out.push({
      entity_id: entityId,
      parent_entity_id: parentId,
      action: 'inherit',
      contact_entity_id: parent.active_contact_entity_id,
      reason: 'parent_has_single_confirmed_contact',
    });
  }
  return out;
}

/** Summarize a plan for an honest-count response, never a re-discovery tally. */
export function summarizeParentInheritancePlan(decisions) {
  const list = Array.isArray(decisions) ? decisions : [];
  return {
    total: list.length,
    inherit: list.filter((d) => d.action === 'inherit').length,
    needs_human: list.filter((d) => d.action === 'needs_human').length,
    no_parent_contact: list.filter((d) => d.action === 'no_parent_contact').length,
  };
}
