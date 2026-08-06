// ============================================================================
// W7.5 — Outbound loop closure: shared advance + cross-path de-dupe helpers
// ----------------------------------------------------------------------------
// Two small, dependency-injectable helpers shared by the two outbound-mail
// intake paths so a SENT email actually COMPLETES the work a to-do asked for:
//
//   1. handleOutlookSent  (api/intake.js, ?_route=outlook-sent) — the untagged
//      Sent-Items sweep. Already advanced to-dos inline; W7.5 adds only the
//      cross-path de-dupe check here (kept inline to avoid churning the proven
//      path).
//   2. handleTaggedComm   (api/_handlers/intake-tagged-comm.js) — the W7.3
//      category-tagging receiver. Was INBOUND-only; W7.5 wires the outbound
//      branch to advanceOutboundTodos so a tagged send closes the deal's
//      offer_review / follow_up to-dos and stamps deal_next_step.
//
// Both live outbound paths can log the SAME internet_message_id (a tagged send
// also lands in Sent Items). They insert under different source_type values
// (`outlook_tagged` vs `outlook_sent`) so the per-path unique index cannot
// dedupe them — findCrossPathDuplicate closes that gap: the second path to see
// the message finds the first path's spine row and skips both the insert AND
// the advance, so a to-do never advances twice for one send.
//
// Doctrine: best-effort (never blocks/duplicates the log), reversible (reuses
// lcc_advance_todos' own metadata-stamped, reversible completions — no new
// writer), idempotent on internet_message_id across BOTH paths.
// ============================================================================

import { opsQuery as defaultOpsQuery, pgFilterVal } from './ops-db.js';

/**
 * Advance a deal's outbound to-dos for a sent email — the same two calls
 * handleOutlookSent makes: resolve offer_review + reach-out follow_ups (and
 * schedule the seller follow-up when an offer was just sent) via
 * lcc_advance_todos, then non-destructively stamp the deal's open
 * deal_next_step via lcc_reconcile_deal_todo.
 *
 * Best-effort: any failure is swallowed so the caller's log is never blocked.
 * Returns { advance, reconcile } — `advance` is the lcc_advance_todos result
 * (surfaced in the receiver response so a dry-run can confirm it fired).
 */
export async function advanceOutboundTodos({
  opsQuery = defaultOpsQuery,
  dealEntityId,
  partyEntityId = null,
  activityId = null,
  subject = null,
  occurredAt = null,
  context = null,
}) {
  let advance = null;
  let reconcile = null;
  if (!dealEntityId && !partyEntityId) return { advance, reconcile };

  try {
    const rr = await opsQuery('POST', 'rpc/lcc_advance_todos', {
      p_entity_id: dealEntityId,
      p_activity_id: activityId,
      p_party_entity_id: partyEntityId,
      p_channel: 'email',
      p_direction: 'outbound',
      ...(context ? { p_context: context } : {}),
    });
    advance = Array.isArray(rr.data) ? rr.data[0] : rr.data;
  } catch (_e) { /* best-effort — never block the log */ }

  // Deal-level, NON-DESTRUCTIVE reconciliation of the open deal_next_step
  // (ball_in_court='them', de-stale) — the layer lcc_advance_todos doesn't cover.
  if (dealEntityId) {
    try {
      await opsQuery('POST', 'rpc/lcc_reconcile_deal_todo', {
        p_deal_entity_id: dealEntityId,
        p_direction: 'outbound',
        p_activity_id: activityId,
        p_subject: subject,
        p_occurred_at: occurredAt,
      });
      reconcile = 'stamped';
    } catch (_e) { /* best-effort */ }
  }

  return { advance, reconcile };
}

/**
 * Look for an existing spine row for this internet_message_id logged by the
 * OTHER outbound path. Returns the row ({ id, source_type }) or null.
 *
 * @param sourceTypes  the source_type value(s) written by the other path(s)
 *                     — e.g. ['outlook_tagged'] when called from the sent
 *                     path, ['outlook_sent'] from the tagged path.
 */
export async function findCrossPathDuplicate({
  opsQuery = defaultOpsQuery,
  workspaceId,
  externalId,
  sourceTypes,
}) {
  const types = Array.isArray(sourceTypes) ? sourceTypes.filter(Boolean) : [sourceTypes].filter(Boolean);
  if (!workspaceId || !externalId || !types.length) return null;
  try {
    const inList = types.map((s) => `"${String(s)}"`).join(',');
    const r = await opsQuery('GET',
      `activity_events?workspace_id=eq.${pgFilterVal(workspaceId)}` +
      `&source_type=in.(${inList})` +
      `&external_id=eq.${encodeURIComponent(String(externalId))}` +
      `&select=id,source_type&limit=1`);
    return (r?.data && r.data[0]) || null;
  } catch (_e) {
    return null; // best-effort — a failed probe must not block the log
  }
}
