// ============================================================================
// W7.6 — Mailbox Mirror: Outlook folders reflect open LCC work
// ----------------------------------------------------------------------------
// PULL model — LCC never touches the mailbox. LCC publishes a DETERMINISTIC
// worklist of intake-captured flagged emails whose LCC loop has CLOSED; a Power
// Automate "mover" flow reads it, moves each message from the "Intake Staged,
// Not Complete" Outlook folder to a Processed folder (+ unflag + mark read) via
// Microsoft Graph, and acks the outcome back here. MOVE ONLY — never delete.
//
//   GET  /api/mailbox-reconcile-worklist  → up to N closed-loop messages
//   POST /api/mailbox-reconcile-ack       → record move outcome (ledger)
//
// Doctrine:
//   - DETERMINISTIC gate — the whole closure decision is the SQL view
//     v_lcc_mailbox_reconcile_worklist. This module imports NO ai seam (asserted
//     in tests): there is no LLM anywhere in the path.
//   - Flag-gated (MAILBOX_MIRROR, default off; registered in
//     feature_flags_registry). Off ⇒ { skipped: 'flag_off' }. ?force=1 overrides
//     for a dry-run read.
//   - Reversible + ledgered + idempotent — the ack RPC upserts one ledger row
//     per internet_message_id; re-acks are no-ops; failed moves back off 1h and
//     park after 5 tries with a loud lcc_health_alerts row (never a silent drop).
//   - Auth: X-LCC-Key (or a signed-in operator) via the shared authenticate().
// ============================================================================

import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { authenticate } from '../_shared/auth.js';

const WORKLIST_VIEW = 'v_lcc_mailbox_reconcile_worklist';
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

const firstNonEmpty = (...xs) => xs.find((x) => x != null && String(x).trim() !== '') ?? null;

function flagOn(req) {
  return process.env.MAILBOX_MIRROR === 'true' || req.query?.force === '1';
}

// ── GET /api/mailbox-reconcile-worklist ────────────────────────────────────
// Returns { ok, count, rows: [{ internet_message_id, reason, closed_at,
// deal_entity_id, inbox_item_id, subject, attempts }] }. Oldest-closed first so
// the backlog drains FIFO; capped at N (default 25).
export async function handleMailboxWorklist(req, res, deps = {}) {
  const query = deps.opsQuery || opsQuery;
  const auth = deps.authenticate || authenticate;
  if (req.method !== 'GET') return res.status(405).json({ error: `Method ${req.method} not allowed` });
  if (!flagOn(req)) {
    return res.status(200).json({
      ok: true, skipped: 'flag_off',
      hint: 'Set MAILBOX_MIRROR=true in Railway (feature_flags_registry: MAILBOX_MIRROR) to enable, or call with ?force=1 for a dry-run read.',
    });
  }

  const user = await auth(req, res);
  if (!user) return; // authenticate already responded 401

  const workspaceId = req.headers['x-lcc-workspace']
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_PRIMARY_WORKSPACE_ID
    || process.env.LCC_DEFAULT_WORKSPACE_ID
    || null;

  let limit = parseInt(firstNonEmpty(req.query?.limit, req.query?.n, DEFAULT_LIMIT), 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const select = 'internet_message_id,reason,closed_at,deal_entity_id,inbox_item_id,subject,attempts';
  let path = `${WORKLIST_VIEW}?select=${select}&order=closed_at.asc.nullslast&limit=${limit}`;
  if (workspaceId) path += `&workspace_id=eq.${pgFilterVal(workspaceId)}`;

  const r = await query('GET', path);
  if (!r.ok) {
    return res.status(r.status || 502).json({ ok: false, error: 'worklist_query_failed', detail: r.data });
  }
  const rows = Array.isArray(r.data) ? r.data : [];
  return res.status(200).json({ ok: true, count: rows.length, limit, rows });
}

// ── POST /api/mailbox-reconcile-ack ────────────────────────────────────────
// Body: { internet_message_id, moved: true|false, reason?, error? }. Routes
// straight to the ack RPC (idempotent upsert + retry/backoff/park + alert).
export async function handleMailboxAck(req, res, deps = {}) {
  const query = deps.opsQuery || opsQuery;
  const auth = deps.authenticate || authenticate;
  if (req.method !== 'POST') return res.status(405).json({ error: `Method ${req.method} not allowed` });
  if (!flagOn(req)) {
    return res.status(200).json({ ok: true, skipped: 'flag_off' });
  }

  const user = await auth(req, res);
  if (!user) return;

  const p = req.body || {};
  const imid = firstNonEmpty(p.internet_message_id, p.internetMessageId, p.message_id, p.id);
  if (!imid) return res.status(400).json({ error: 'internet_message_id is required' });

  // Coerce moved: accept boolean or the string forms PA sends.
  const moved = p.moved === true || p.moved === 'true' || p.moved === 1 || p.moved === '1';
  const reason = firstNonEmpty(p.reason, null);
  const errorText = moved ? null : (firstNonEmpty(p.error, p.error_text, 'unknown_error'));

  const r = await query('POST', 'rpc/lcc_mailbox_reconcile_ack', {
    p_internet_message_id: String(imid),
    p_moved: moved,
    p_reason: reason,
    p_error: errorText,
  });
  if (!r.ok) {
    return res.status(r.status || 502).json({ ok: false, error: 'ack_failed', detail: r.data });
  }
  const result = Array.isArray(r.data) ? r.data[0] : r.data;
  return res.status(200).json({ ok: true, result });
}
