// ============================================================================
// P120 — Move-Queue Executor: the app actually MOVES the email
// ----------------------------------------------------------------------------
// PULL model — LCC never touches the mailbox. LCC publishes the batch of intake
// emails whose move has not been executed; a Power Automate "LCC Move Queue
// Executor" flow reads it, performs the Graph move into `target_folder`, and
// acks the outcome back here. MOVE ONLY — never delete.
//
//   GET  /api/move-queue-worklist  → up to N pending moves
//   POST /api/move-queue-ack       → stamp the move result on processing_log
//
// WHY THIS EXISTS (measured live 2026-08-20): api/_shared/processing-complete.js
// has been writing move_status='pending' rows since 2026-07-21 and NOTHING ever
// drained them (323 staged + 15 duplicate). The push relay
// (api/sync.js handleProcessingComplete → _shared/pa-move-message.js) is real
// and correct but has NO CALLER, and it never stamped processing_log on any
// path — so there was no queue endpoint to poll and no stamp-back. This module
// is both.
//
// OWNERSHIP (P119's one-owner-per-transition rule, made concrete):
//   Inbox → staging, Inbox → Processed/*  : THIS drainer (the processing_log owner).
//   staging → Processed                    : the W7.6 mailbox mirror.
//   The PA intake flow must NOT also move at classification time — a transient
//   Graph failure there is lost forever (no queue behind it), and two movers on
//   one transition is the race P119 killed.
//
// P119 SEMANTICS REUSED, NOT REINVENTED:
//   An ack of moved:false whose error says the MESSAGE is not in the source
//   folder means the desired end state is already true ⇒ TERMINAL SUCCESS on
//   the FIRST ack (move_outcome='already_out') — no retry, no park, no alert.
//   A missing DESTINATION folder is a real break ⇒ bounded retry → park →
//   alert. This handler forwards the mover's error text VERBATIM and does NOT
//   classify it: the single owner of that decision is the SQL function
//   lcc_mailbox_mirror_error_is_terminal(). A JS copy would be exactly the
//   normaliser drift this codebase keeps getting bitten by — never add one.
//
// HONEST COUNTS: the ack response echoes { move_outcome, terminal, parked,
//   attempts }. move_status='moved' covers BOTH a real relocation and an
//   already-gone no-op — the move-DELTA is move_outcome='moved' only.
//
// Flag-gated (MOVE_QUEUE_EXECUTOR, default off; registered in
// feature_flags_registry). Off ⇒ { skipped: 'flag_off' }; ?force=1 overrides
// for a dry-run read. Auth: X-LCC-Key or a signed-in operator.
// ============================================================================

import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { authenticate } from '../_shared/auth.js';

const WORKLIST_VIEW = 'v_lcc_move_queue_worklist';
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

const firstNonEmpty = (...xs) => xs.find((x) => x != null && String(x).trim() !== '') ?? null;

function flagOn(req) {
  return process.env.MOVE_QUEUE_EXECUTOR === 'true' || req.query?.force === '1';
}

function resolveWorkspaceId(req, user) {
  return req.headers['x-lcc-workspace']
    || user?.memberships?.[0]?.workspace_id
    || process.env.LCC_PRIMARY_WORKSPACE_ID
    || process.env.LCC_DEFAULT_WORKSPACE_ID
    || null;
}

// ── GET /api/move-queue-worklist ───────────────────────────────────────────
// Returns { ok, count, limit, rows: [{ internet_message_id, graph_rest_id,
// target_folder, outcome, clear_flag, subject, created_at, move_attempts }] }.
// Oldest-first so the backlog drains FIFO; capped at N (default 25). The view
// is actionable-only (has a move key + destination, not parked, outside the 1h
// retry backoff), so every published row is real work.
export async function handleMoveQueueWorklist(req, res, deps = {}) {
  const query = deps.opsQuery || opsQuery;
  const auth = deps.authenticate || authenticate;
  if (req.method !== 'GET') return res.status(405).json({ error: `Method ${req.method} not allowed` });
  if (!flagOn(req)) {
    return res.status(200).json({
      ok: true,
      skipped: 'flag_off',
      hint: 'Set MOVE_QUEUE_EXECUTOR=true in Railway (feature_flags_registry: MOVE_QUEUE_EXECUTOR) to enable, or call with ?force=1 for a dry-run read.',
    });
  }

  const user = await auth(req, res);
  if (!user) return; // authenticate already responded 401

  const workspaceId = resolveWorkspaceId(req, user);

  let limit = parseInt(firstNonEmpty(req.query?.limit, req.query?.n, DEFAULT_LIMIT), 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const select = 'internet_message_id,graph_rest_id,outcome,target_folder,final_target_folder,'
    + 'subject,channel,domain,created_at,move_attempts,clear_flag';
  let path = `${WORKLIST_VIEW}?select=${select}&order=created_at.asc&limit=${limit}`;
  if (workspaceId) path += `&workspace_id=eq.${pgFilterVal(workspaceId)}`;

  const r = await query('GET', path);
  if (!r.ok) {
    return res.status(r.status || 502).json({ ok: false, error: 'worklist_query_failed', detail: r.data });
  }
  const rows = Array.isArray(r.data) ? r.data : [];
  return res.status(200).json({ ok: true, count: rows.length, limit, rows });
}

// ── POST /api/move-queue-ack ───────────────────────────────────────────────
// Body: { internet_message_id, moved: true|false, target_folder?, error? }.
// Accepts a single ack or a batch via { items: [...] } / { acks: [...] } so one
// PA "Apply to each" can report the whole batch in one call. Routes straight to
// the ack RPC (idempotent + terminal classification + retry/park/alert).
export async function handleMoveQueueAck(req, res, deps = {}) {
  const query = deps.opsQuery || opsQuery;
  const auth = deps.authenticate || authenticate;
  if (req.method !== 'POST') return res.status(405).json({ error: `Method ${req.method} not allowed` });
  if (!flagOn(req)) {
    return res.status(200).json({ ok: true, skipped: 'flag_off' });
  }

  const user = await auth(req, res);
  if (!user) return;

  const body = req.body || {};
  const batch = Array.isArray(body.items) ? body.items
    : Array.isArray(body.acks) ? body.acks
    : Array.isArray(body.results) ? body.results
    : [body];

  if (!batch.length) return res.status(400).json({ error: 'no ack items supplied' });

  const workspaceId = resolveWorkspaceId(req, user);
  const results = [];
  // Honest counters — a SEND count is not a WRITE count, and 'moved' is not the
  // same claim as 'already_out'. Report the move-DELTA separately.
  const counts = { moved: 0, already_out: 0, retrying: 0, parked: 0, already_done: 0, failed_ack: 0 };

  for (const item of batch) {
    const p = item || {};
    const imid = firstNonEmpty(p.internet_message_id, p.internetMessageId, p.message_id, p.id);
    if (!imid) {
      counts.failed_ack += 1;
      results.push({ ok: false, error: 'internet_message_id is required' });
      continue;
    }
    const moved = p.moved === true || p.moved === 'true' || p.moved === 1 || p.moved === '1';
    // Verbatim — the SQL classifier reads this text. Never pre-judge it here.
    const errorText = moved ? null : firstNonEmpty(p.error, p.error_text, p.message, 'unknown_error');
    const targetFolder = firstNonEmpty(p.target_folder, p.targetFolder, null);

    const r = await query('POST', 'rpc/lcc_move_queue_ack', {
      p_internet_message_id: String(imid),
      p_workspace_id: workspaceId || null,
      p_moved: moved,
      p_target_folder: targetFolder,
      p_error: errorText,
    });

    if (!r.ok) {
      counts.failed_ack += 1;
      results.push({ ok: false, internet_message_id: imid, error: 'ack_failed', detail: r.data });
      continue;
    }
    const out = Array.isArray(r.data) ? r.data[0] : r.data;
    if (out?.already_done) counts.already_done += 1;
    else if (out?.move_outcome === 'moved') counts.moved += 1;
    else if (out?.move_outcome === 'already_out') counts.already_out += 1;
    else if (out?.parked) counts.parked += 1;
    else counts.retrying += 1;
    results.push(out);
  }

  return res.status(200).json({
    ok: true,
    acked: results.length,
    // moves ACTUALLY performed by this system — not the queue-drain count.
    moves_performed: counts.moved,
    counts,
    results,
  });
}
