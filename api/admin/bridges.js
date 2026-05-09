// ============================================================================
// Admin Bridges — freshness + queue depth surface
// Life Command Center — Phase 0
// ----------------------------------------------------------------------------
// GET /api/admin/bridges
//
// Returns:
//   {
//     ok, workspace_id,
//     bridges: [ { ...v_bridge_freshness row } ],
//     queue:   { pending, running, error_recent_24h }
//   }
//
// Phase 0 is read-only. Bridge configuration (creating/pausing/editing
// allowlists) will grow into PUT/PATCH actions on this same file in
// Phase 1, gated by requireRole(user, 'manager').
// ============================================================================

import {
  authenticate, requireWorkspace, primaryWorkspace, handleCors
} from '../_shared/auth.js';
import {
  opsQuery, isOpsConfigured, withErrorHandler, pgFilterVal
} from '../_shared/ops-db.js';

async function getQueueCounts(workspaceId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const baseFilter = `workspace_id=eq.${pgFilterVal(workspaceId)}`;

  const [pending, running, errored] = await Promise.all([
    opsQuery('GET',
      `enrichment_jobs?${baseFilter}&status=eq.pending&select=id&limit=1`,
      null, { countMode: 'exact' }),
    opsQuery('GET',
      `enrichment_jobs?${baseFilter}&status=eq.running&select=id&limit=1`,
      null, { countMode: 'exact' }),
    opsQuery('GET',
      `enrichment_jobs?${baseFilter}&status=eq.error&updated_at=gte.${encodeURIComponent(since)}&select=id&limit=1`,
      null, { countMode: 'exact' })
  ]);
  return {
    pending:           pending.ok ? (pending.count || 0) : null,
    running:           running.ok ? (running.count || 0) : null,
    error_recent_24h:  errored.ok ? (errored.count || 0) : null
  };
}

export default withErrorHandler(async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const user = await authenticate(req, res);
  if (!user) return;
  if (!isOpsConfigured()) {
    res.status(503).json({ error: 'Ops database not configured' });
    return;
  }

  // Workspace pinned via ?workspace=… query, X-LCC-Workspace header, or
  // primary membership (in that order). Caller must be a member.
  const requested =
    req.query?.workspace ||
    req.headers['x-lcc-workspace'] ||
    primaryWorkspace(user)?.workspace_id;
  if (!requested) {
    res.status(400).json({ error: 'No workspace context' });
    return;
  }
  if (!requireWorkspace(user, requested)) {
    res.status(403).json({ error: 'Not a member of this workspace' });
    return;
  }

  const filter = `workspace_id=eq.${pgFilterVal(requested)}`;
  const bridgesR = await opsQuery('GET',
    `v_bridge_freshness?${filter}&order=source_system.asc,bridge_key.asc`,
    null,
    { countMode: 'estimated' }
  );

  const queue = await getQueueCounts(requested);

  res.status(200).json({
    ok: true,
    workspace_id: requested,
    bridges: bridgesR.ok ? (bridgesR.data || []) : [],
    queue
  });
});
