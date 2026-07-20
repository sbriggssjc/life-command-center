// ============================================================================
// Webhook: /api/webhooks/processing-complete  (→ /api/intake?_route=processing-complete)
// ----------------------------------------------------------------------------
// The bridge between "intake.js decided" and "Power Automate moved". intake.js
// records each processing_complete decision in public.processing_log but has NO
// Graph mailbox-write access. Power Automate:
//
//   GET  /api/webhooks/processing-complete[?limit=N]
//        → the pending move queue: [{ id, internet_message_id, graph_rest_id,
//          outcome, target_folder, subject }]. PA moves each message (Graph
//          move-message) to target_folder.
//
//   POST /api/webhooks/processing-complete
//        body { id | internet_message_id, moved: bool, error? }
//        or   { results: [ { id | internet_message_id, moved, error? }, ... ] }
//        → PA reports the move result; the row flips move_status → moved /
//          move_failed and drains out of the queue.
//
// Only 'pending' rows are returned (needs_review is 'skipped' = leave in place).
// Nothing here deletes — deletion is the separate retention sweep.
// ============================================================================

import { authenticate, requireRole } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';

function resolveWorkspace(req, user) {
  return req.headers['x-lcc-workspace']
    || user?.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID
    || null;
}

export async function handleProcessingComplete(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = resolveWorkspace(req, user);
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });
  if (!requireRole(user, 'operator', workspaceId)) {
    return res.status(403).json({ error: 'Operator role required' });
  }

  if (req.method === 'GET') return getPendingMoves(req, res, workspaceId);
  if (req.method === 'POST') return reportMoveResults(req, res, workspaceId);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

// ── GET: the pending move queue ─────────────────────────────────────────────
async function getPendingMoves(req, res, workspaceId) {
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

  const q = await opsQuery(
    'GET',
    `processing_log?workspace_id=eq.${pgFilterVal(workspaceId)}` +
      `&move_status=eq.pending` +
      `&select=id,internet_message_id,graph_rest_id,outcome,target_folder,domain,channel,subject,created_at` +
      `&order=created_at.asc&limit=${limit}`,
    null,
    { countMode: 'none' },
  );

  if (!q.ok) {
    return res.status(q.status || 500).json({ error: 'Failed to read processing queue', detail: q.data });
  }
  const events = Array.isArray(q.data) ? q.data : [];
  return res.status(200).json({ ok: true, count: events.length, events });
}

// ── POST: Power Automate reports the move result ────────────────────────────
async function reportMoveResults(req, res, workspaceId) {
  const body = req.body || {};
  const results = Array.isArray(body.results)
    ? body.results
    : [{ id: body.id, internet_message_id: body.internet_message_id, moved: body.moved, error: body.error }];

  const updated = [];
  const skipped = [];

  for (const r of results) {
    const id = r?.id || null;
    const imid = r?.internet_message_id || null;
    if (!id && !imid) { skipped.push({ reason: 'missing_id' }); continue; }

    const moved = r?.moved === true || r?.moved === 'true';
    const patch = moved
      ? { move_status: 'moved', moved_at: new Date().toISOString(), move_error: null }
      : { move_status: 'move_failed', move_error: r?.error ? String(r.error).slice(0, 500) : 'unspecified' };

    // Only transition rows still in the queue — never re-open a resolved row.
    const filter = id
      ? `id=eq.${pgFilterVal(id)}`
      : `workspace_id=eq.${pgFilterVal(workspaceId)}&internet_message_id=eq.${pgFilterVal(imid)}`;

    const upd = await opsQuery(
      'PATCH',
      `processing_log?${filter}&move_status=eq.pending`,
      patch,
      { Prefer: 'return=representation' },
    );
    if (upd.ok && Array.isArray(upd.data) && upd.data.length) {
      updated.push({ id: upd.data[0].id, move_status: upd.data[0].move_status });
    } else {
      skipped.push({ id: id || imid, reason: upd.ok ? 'not_pending' : `error_${upd.status}` });
    }
  }

  return res.status(200).json({ ok: true, updated: updated.length, updated_rows: updated, skipped });
}
