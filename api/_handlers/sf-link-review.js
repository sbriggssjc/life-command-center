// ============================================================================
// W4.3 follow-up — SF-link candidate review lane (PURE decision core, no IO).
//
// The W4.3 splink batch produced 3,452 `needs_review` sf_link_research_queue
// rows (gov 3,064 + dia 388), each carrying the machine's best Salesforce
// account candidate. This lane surfaces them in the Decision Center with
// one-click verdicts. This module holds the PURE planner + tiny parsers so the
// verdict logic (null-guard, conflict, label vocabulary) is unit-testable in
// isolation — the admin.js verdict handler injects the live SF-column value and
// performs every read/write around the returned plan. Mirrors the
// planSfLinkReconcile pattern in api/_handlers/sf-link-reconcile.js.
// ============================================================================

import { sfIdsMatch } from '../_shared/sf-id.js';

// gov owners link via `sf_account_id` (+ a `sf_last_synced` stamp); dia
// true_owners via `sf_company_id` (no sync stamp). Mirrors the attach map in
// admin.js::handleSfLinkTick.
export function sfLinkColumn(domain) {
  const dom = (domain === 'government') ? 'gov' : (domain === 'dialysis') ? 'dia' : domain;
  return dom === 'gov' ? 'sf_account_id' : 'sf_company_id';
}

// source_table → { table, idColumn }. gov carries both true_owners +
// recorded_owners; every dia queue row is a true_owner.
export function sfLinkTarget(sourceTable) {
  if (sourceTable === 'recorded_owners') return { table: 'recorded_owners', idColumn: 'recorded_owner_id' };
  return { table: 'true_owners', idColumn: 'true_owner_id' };
}

// The 18 dia conflict rows embed the pre-existing sf_company_id in last_error:
//   'w4_3_conflict_existing_sf_company_id_<ID>'. Return the id (null when absent).
const CONFLICT_ERR_PREFIX = 'w4_3_conflict_existing_sf_company_id_';
export function parseConflictExistingId(lastError) {
  const s = String(lastError || '');
  if (!s.startsWith(CONFLICT_ERR_PREFIX)) return null;
  const id = s.slice(CONFLICT_ERR_PREFIX.length).trim();
  return id || null;
}

// Map a verdict token → the entity_match_labels training verdict. Reuses the
// exact same vocabulary the owner_reconcile lane writes (same_party / distinct)
// so W4.4's corpus reader sees ONE consistent enum.
export function sfLinkLabelVerdict(verdict) {
  const v = String(verdict || '').toLowerCase();
  if (v === 'approve' || v === 'switch') return 'same_party';
  if (v === 'reject' || v === 'not_a_match' || v === 'keep_existing') return 'distinct';
  return null;
}

// Pure verdict planner. Inputs:
//   domain      'gov' | 'dia' (long forms tolerated)
//   verdict     'approve' | 'reject' | 'keep_existing' | 'switch' | 'research'
//   ctx         the decision context (queue_id, source_table, source_id,
//               sf_account_id_resolved, sf_account_name_resolved, score_resolved,
//               owner_name, conflict_existing_id)
//   currentSfId the LIVE value of the source row's SF column (handler-fetched);
//               null when unset. Drives the null-guard on the Link button.
//
// Returns a plan the handler executes. Never does IO; never throws.
//   { ok, error, verdictKind, sfColumn, sourceTable, sourceIdColumn, sourceId,
//     queueId, writeSource, idempotent, conflict, conflictExistingId, landedSfId,
//     queueStatus, queueLastError, queueResolvedId, queueResolvedName,
//     provenance, makeLabel, labelVerdict, rawVerdict }
export function planSfLinkVerdict({ domain, verdict, ctx, currentSfId } = {}) {
  ctx = ctx || {};
  const dom = (domain === 'government') ? 'gov' : (domain === 'dialysis') ? 'dia' : domain;
  const v = String(verdict || '').toLowerCase();
  const tgt = sfLinkTarget(ctx.source_table);
  const candidateId = ctx.sf_account_id_resolved != null ? String(ctx.sf_account_id_resolved) : null;
  const existingId = ctx.conflict_existing_id != null ? String(ctx.conflict_existing_id) : null;

  const base = {
    ok: true, error: null, verdictKind: v, domain: dom,
    sfColumn: sfLinkColumn(dom), sourceTable: tgt.table, sourceIdColumn: tgt.idColumn,
    sourceId: ctx.source_id != null ? String(ctx.source_id) : null,
    queueId: ctx.queue_id != null ? ctx.queue_id : null,
    writeSource: false, idempotent: false, conflict: false, conflictExistingId: null,
    landedSfId: null, queueStatus: null, queueLastError: null,
    queueResolvedId: undefined, queueResolvedName: undefined,
    provenance: false, makeLabel: false, labelVerdict: null, rawVerdict: null,
  };

  // Research: leave the queue row needs_review (handler spawns a task). No label.
  if (v === 'research') return Object.assign(base, { verdictKind: 'research' });

  // Link (the two-way approve button). Null-guard: write ONLY when the column is
  // null or already equals the candidate (idempotent no-op success). A DIFFERENT
  // non-null id → CONFLICT: do NOT write, do NOT record a verdict — the UI must
  // re-render the three-way card. (Non-negotiable #1: the Link button never
  // overwrites a non-null different id.)
  if (v === 'approve') {
    if (!candidateId) return Object.assign(base, { ok: false, error: 'no candidate sf id to link' });
    if (currentSfId && !sfIdsMatch(currentSfId, candidateId)) {
      return Object.assign(base, { conflict: true, conflictExistingId: String(currentSfId) });
    }
    const idempotent = !!(currentSfId && sfIdsMatch(currentSfId, candidateId));
    return Object.assign(base, {
      verdictKind: 'approve', writeSource: !idempotent, idempotent, landedSfId: candidateId,
      queueStatus: 'linked', queueLastError: null,
      queueResolvedId: candidateId, queueResolvedName: ctx.sf_account_name_resolved || null,
      provenance: !idempotent, makeLabel: true, labelVerdict: 'same_party', rawVerdict: 'approve',
    });
  }

  // Switch to candidate (the DELIBERATE three-way override). The operator has
  // seen the conflict card and chosen the candidate over the existing link. This
  // is the ONE path that overwrites a non-null different id — an explicit human
  // choice, NOT the Link button — and it is fully provenance-audited (old_value
  // preserved) and reversible.
  if (v === 'switch') {
    if (!candidateId) return Object.assign(base, { ok: false, error: 'no candidate sf id to switch to' });
    return Object.assign(base, {
      verdictKind: 'switch', writeSource: true, landedSfId: candidateId,
      queueStatus: 'linked', queueLastError: null,
      queueResolvedId: candidateId, queueResolvedName: ctx.sf_account_name_resolved || null,
      provenance: true, makeLabel: true, labelVerdict: 'same_party', rawVerdict: 'switch',
    });
  }

  // Not a match. No source write; queue → no_match; label the pair distinct.
  if (v === 'reject' || v === 'not_a_match') {
    return Object.assign(base, {
      verdictKind: 'reject', queueStatus: 'no_match', queueLastError: 'human_rejected_w4_3',
      makeLabel: true, labelVerdict: 'distinct', rawVerdict: 'reject',
    });
  }

  // Keep existing (conflict card only). The source row already holds the existing
  // id — NO source write. Queue records the kept id (and clears the candidate
  // name). Still labels the CANDIDATE pair as distinct.
  if (v === 'keep_existing') {
    if (!existingId) return Object.assign(base, { ok: false, error: 'keep_existing requires an existing sf id' });
    return Object.assign(base, {
      verdictKind: 'keep_existing', writeSource: false, landedSfId: existingId,
      queueStatus: 'linked', queueLastError: 'human_kept_existing_w4_3',
      queueResolvedId: existingId, queueResolvedName: null,
      makeLabel: true, labelVerdict: 'distinct', rawVerdict: 'keep_existing',
    });
  }

  return Object.assign(base, { ok: false, error: 'unknown verdict for sf_link_candidate: ' + v });
}
