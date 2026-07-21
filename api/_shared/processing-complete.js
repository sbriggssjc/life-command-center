// ============================================================================
// Email auto-archive / cleanup — processing_complete emitter + folder mapping
// ----------------------------------------------------------------------------
// When the intake pipeline finishes with a flagged email, it emits a
// "processing_complete" decision: the stable internet_message_id, the OUTCOME
// (filed | needs_review | duplicate), and the Outlook TARGET_FOLDER. The
// decision is recorded in public.processing_log; Power Automate (which owns the
// Graph mailbox-write) reads the pending rows and performs the move.
//
// Design rules:
//   - NEVER blocks or fails the intake response. Best-effort, fire-and-forget:
//     a missing table / DB hiccup logs a warning and returns null (deploy-order
//     safe — the JS can ship before the migration lands).
//   - First emit wins (idempotent per workspace+internet_message_id). Power
//     Automate fires the flagged-email flow 3-6x per flag; replays must not
//     enqueue a second move. The authoritative decision is the FRESH pass
//     (email's data captured → filed); replays no-op.
//   - This module DECIDES; Power Automate MOVES. Nothing here deletes.
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';

// Single "everything outstanding" staging folder. A `staged` email — intake
// finished for a non-terminal category — moves HERE and KEEPS its flag until
// its Microsoft To Do task completes, then it reaches Processed/{category} (its
// final_target_folder, resolved at staging time). This is a top-level sibling of
// Processed/, deliberately OUTSIDE the retention sweep's Processed/* scope, so a
// staged (outstanding) email is never archived/deleted regardless of age.
export const STAGING_FOLDER = 'Intake Staged, Not Completed';

// All valid emit outcomes.
const VALID_OUTCOMES = new Set(['filed', 'needs_review', 'duplicate', 'staged']);

// Outcomes that require Power Automate to move the message. needs_review is left
// in place (no move), so it is recorded 'skipped' in the move queue. `staged`
// moves to the staging folder (but does NOT clear the flag — see clear_flag).
const MOVE_OUTCOMES = new Set(['filed', 'duplicate', 'staged']);

/**
 * Map an (outcome, channel/domain) to the Outlook target folder.
 * Returns null when the email should be LEFT IN PLACE (needs_review).
 *
 *   filed        → Processed/{domain}  — Processed/Deals | Processed/Infra |
 *                  Processed/Leads | Processed/General
 *   staged       → "Intake Staged, Not Completed" (single outstanding-work view;
 *                  flag KEPT; final destination in final_target_folder)
 *   needs_review → null (leave in place; existing flag/inbox surfaces it)
 *   duplicate    → Processed/Duplicates (recoverable; swept by the retention job)
 */
export function targetFolderFor(outcome, { channel = null, domain = null } = {}) {
  if (outcome === 'needs_review') return null;
  if (outcome === 'staged') return STAGING_FOLDER;
  if (outcome === 'duplicate') return 'Processed/Duplicates';
  if (outcome !== 'filed') return null;

  const key = String(domain || channel || '').toLowerCase();
  // Infra alerts → Processed/Infra.
  if (key === 'infra') return 'Processed/Infra';
  // Lead / news-alert / marketplace channels → Processed/Leads.
  if (['lead', 'leads', 'news_alert', 'news-alert', 'crexi', 'rcm', 'loopnet'].includes(key)) {
    return 'Processed/Leads';
  }
  // Deal channels (OM/lease extraction, closing announcements) → Processed/Deals.
  if (['om', 'lease', 'deal', 'deal_closing', 'deal-closing', 'dia', 'dialysis',
       'gov', 'government', 'netlease', 'net_lease'].includes(key)) {
    return 'Processed/Deals';
  }
  // Anything else that filed but carries no domain hint.
  return 'Processed/General';
}

/**
 * Record a processing_complete decision. Best-effort — returns the event
 * descriptor `{ internet_message_id, outcome, target_folder, move_status }` on
 * success (or when an authoritative row already existed), or null on any
 * failure. NEVER throws.
 *
 * @param {object} args
 * @param {string} args.workspaceId
 * @param {string} args.internetMessageId  Stable dedup/move key (falls back to
 *                                          graphRestId if the real one is absent).
 * @param {string} [args.graphRestId]
 * @param {string} args.outcome            'filed' | 'needs_review' | 'duplicate' | 'staged'
 * @param {string} [args.channel]          'om' | 'deal_closing' | 'infra' | 'lead'
 * @param {string} [args.domain]           'infra' | 'dia' | 'gov' | 'leads' | null
 * @param {string} [args.inboxItemId]
 * @param {string} [args.sourceType]
 * @param {string} [args.subject]
 */
export async function emitProcessingComplete(args = {}) {
  const {
    workspaceId,
    internetMessageId,
    graphRestId = null,
    outcome,
    channel = null,
    domain = null,
    inboxItemId = null,
    sourceType = null,
    subject = null,
  } = args;

  if (!outcome || !VALID_OUTCOMES.has(outcome)) {
    console.warn('[processing-complete] skipped emit — invalid outcome:', outcome);
    return null;
  }
  const messageKey = internetMessageId || graphRestId || null;
  if (!workspaceId || !messageKey) {
    console.warn('[processing-complete] skipped emit — missing workspace/message key');
    return null;
  }

  const targetFolder = targetFolderFor(outcome, { channel, domain });
  const moveStatus = MOVE_OUTCOMES.has(outcome) && targetFolder ? 'pending' : 'skipped';
  // For a `staged` email, resolve the eventual Processed/{category} destination
  // NOW (at staging time) so it is never re-derived later — the todo-completion
  // poll reads it to file the email once the task completes. Only staged carries
  // one (filed already IS the final move; duplicate/needs_review have no deferred
  // second move).
  const finalTargetFolder = outcome === 'staged'
    ? targetFolderFor('filed', { channel, domain })
    : null;
  // Whether Power Automate should CLEAR the flag after the move. A staged email
  // moves to the staging folder but stays flagged (it is still outstanding work
  // — the flag clears only when the To Do task completes and it files). filed +
  // duplicate are terminal and clear the flag. needs_review does not move.
  const clearFlag = outcome === 'filed' || outcome === 'duplicate';
  const event = {
    internet_message_id: messageKey,
    outcome,
    target_folder: targetFolder,
    final_target_folder: finalTargetFolder,
    move_status: moveStatus,
    clear_flag: clearFlag,
  };

  try {
    // First emit wins: a prior row for this (workspace, message) is the
    // authoritative decision (the fresh pass). A replay finds it and no-ops so
    // it never downgrades filed→duplicate or enqueues a second move.
    const existing = await opsQuery(
      'GET',
      `processing_log?workspace_id=eq.${pgFilterVal(workspaceId)}` +
        `&internet_message_id=eq.${pgFilterVal(messageKey)}` +
        `&select=id,outcome,target_folder,final_target_folder,move_status&limit=1`,
      null,
      { countMode: 'none' },
    );
    if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
      const row = existing.data[0];
      return {
        internet_message_id: messageKey,
        outcome: row.outcome,
        target_folder: row.target_folder,
        final_target_folder: row.final_target_folder ?? null,
        move_status: row.move_status,
        clear_flag: row.outcome === 'filed' || row.outcome === 'duplicate',
        deduplicated: true,
      };
    }

    const ins = await opsQuery('POST', 'processing_log', {
      workspace_id: workspaceId,
      internet_message_id: internetMessageId || null,
      graph_rest_id: graphRestId || null,
      inbox_item_id: inboxItemId || null,
      source_type: sourceType || null,
      channel: channel || null,
      domain: domain || null,
      subject: subject ? String(subject).slice(0, 500) : null,
      outcome,
      target_folder: targetFolder,
      final_target_folder: finalTargetFolder,
      move_status: moveStatus,
    }, { Prefer: 'return=minimal,resolution=merge-duplicates' });

    if (!ins.ok) {
      // Deploy-order safe: if the migration hasn't landed the table 404s here.
      console.warn('[processing-complete] emit insert failed (non-fatal):', ins.status);
      return null;
    }
    return event;
  } catch (err) {
    console.warn('[processing-complete] emit error (non-fatal):', err?.message || err);
    return null;
  }
}
