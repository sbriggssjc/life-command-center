// ============================================================================
// processing-complete.js — auto-archive/cleanup emitter for the LEAD channels
// ----------------------------------------------------------------------------
// The Deno-side twin of api/_shared/processing-complete.js. The lead-ingest
// edge function (news_alert / rcm[CREXi] / loopnet) finishes a lead's intake
// job and emits a "processing_complete" decision into public.processing_log
// (LCC Opps) — the SAME table + move-queue the flagged-email intake path
// (api/intake.js) writes to. Power Automate reads the pending rows via
// GET /api/webhooks/processing-complete and performs the Outlook move, so a
// filed lead lands in Processed/Leads and the daily briefing counts it.
//
// This module is PURE ESM (no Deno/Node APIs) so it is imported by BOTH the
// Deno edge handler (index.ts) AND the node test (test/lead-processing-
// complete.test.mjs) with no drift. All I/O (the ops insert) lives in index.ts.
//
// Design rules (identical contract to the Node emitter):
//   - Lead channels file to ONE folder: Processed/Leads. The news vertical
//     (dialysis/government/netlease) rides the `domain` column as metadata but
//     NEVER drives the folder — a lead is a lead, not a deal.
//   - filed | duplicate require a Power Automate move (move_status='pending');
//     needs_review is left in place (move_status='skipped', target_folder=null).
//   - First emit wins: the handler check-then-inserts on
//     (workspace_id, internet_message_id); the DB unique index is the backstop.
// ============================================================================

// Outcomes that require Power Automate to move the message.
export const LEAD_MOVE_OUTCOMES = new Set(['filed', 'duplicate']);
export const LEAD_OUTCOMES = new Set(['filed', 'needs_review', 'duplicate']);

/**
 * Map a lead-channel outcome to the Outlook target folder.
 *   filed        → Processed/Leads       (Power Automate moves it)
 *   duplicate    → Processed/Duplicates   (recoverable; swept by retention)
 *   needs_review → null (leave in place — surfaced by the existing flag/inbox)
 * Anything else → null (leave in place).
 */
export function targetFolderForLead(outcome) {
  if (outcome === 'filed') return 'Processed/Leads';
  if (outcome === 'duplicate') return 'Processed/Duplicates';
  return null; // needs_review or unknown → leave in place
}

/**
 * Build the processing_log row + the response event descriptor for a lead
 * outcome. Returns null when the emit should be skipped (invalid outcome, or no
 * workspace/message key — the count would be un-attributable / the move
 * un-targetable). Pure — the handler performs the insert.
 *
 * @param {object} args
 * @param {string}  args.workspaceId       required (the briefing filters on it)
 * @param {string} [args.internetMessageId] stable dedup/move key (preferred)
 * @param {string} [args.graphRestId]       the Graph REST id (source_ref)
 * @param {string}  args.outcome           'filed' | 'needs_review' | 'duplicate'
 * @param {string} [args.channel]          'news_alert' | 'crexi' | 'loopnet' | ...
 * @param {string} [args.domain]           news vertical metadata (dia/gov/netlease)
 * @param {string} [args.sourceRef]        the lead-table source_ref (audit)
 * @param {string} [args.subject]
 * @returns {{ row: object, event: object } | null}
 */
export function buildProcessingRow(args = {}) {
  const {
    workspaceId,
    internetMessageId = null,
    graphRestId = null,
    outcome,
    channel = null,
    domain = null,
    sourceRef = null,
    subject = null,
  } = args;

  if (!LEAD_OUTCOMES.has(outcome)) return null;

  // The move/dedup key: prefer the stable internet message id; fall back to the
  // Graph REST id (source_ref) so PA still has something to move by.
  const messageKey = internetMessageId || graphRestId || sourceRef || null;
  if (!workspaceId || !messageKey) return null;

  const targetFolder = targetFolderForLead(outcome);
  const moveStatus = LEAD_MOVE_OUTCOMES.has(outcome) && targetFolder ? 'pending' : 'skipped';

  const row = {
    workspace_id: workspaceId,
    internet_message_id: messageKey,
    graph_rest_id: graphRestId || null,
    source_type: 'lead_email',
    channel: channel || 'lead',
    domain: domain || null,
    subject: subject ? String(subject).slice(0, 500) : null,
    outcome,
    target_folder: targetFolder,
    move_status: moveStatus,
  };

  const event = {
    internet_message_id: messageKey,
    outcome,
    target_folder: targetFolder,
    move_status: moveStatus,
  };

  return { row, event };
}
