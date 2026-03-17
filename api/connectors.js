// ============================================================================
// Connector Account Management API
// Life Command Center — Phase 1
//
// Per-user connector bindings with execution method support.
// Supports policy-aware connectors (Power Automate mediation).
//
// GET    /api/connectors                           — list connectors for workspace
// GET    /api/connectors?id=<uuid>                 — get single connector
// GET    /api/connectors?user_id=<uuid>            — get connectors for a user
// GET    /api/connectors?action=health             — connector health summary
// POST   /api/connectors                           — register connector (self or manager+)
// PATCH  /api/connectors?id=<uuid>                 — update connector config/status
// DELETE /api/connectors?id=<uuid>                 — remove connector (self or owner)
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { withErrorHandler } from './_shared/ops-db.js';

const OPS_URL = process.env.OPS_SUPABASE_URL;
const OPS_KEY = process.env.OPS_SUPABASE_KEY;

const VALID_TYPES = ['salesforce', 'outlook', 'power_automate', 'supabase_domain', 'webhook'];
const VALID_METHODS = ['direct_api', 'power_automate', 'webhook', 'manual'];
const VALID_STATUSES = ['healthy', 'degraded', 'error', 'disconnected', 'pending_setup'];

async function opsQuery(method, path, body) {
  const url = `${OPS_URL}/rest/v1/${path}`;
  const opts = {
    method,
    headers: {
      'apikey': OPS_KEY,
      'Authorization': `Bearer ${OPS_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (!OPS_URL || !OPS_KEY) {
    return res.status(503).json({ error: 'Ops database not configured' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) {
    return res.status(400).json({ error: 'No workspace context. Set X-LCC-Workspace header.' });
  }

  const myMembership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!myMembership) {
    return res.status(403).json({ error: 'Not a member of this workspace' });
  }

  // GET
  if (req.method === 'GET') {
    const { id, user_id, action } = req.query;

    // Health summary
    if (action === 'health') {
      const result = await opsQuery('GET',
        `connector_accounts?workspace_id=eq.${workspaceId}&select=id,user_id,connector_type,status,last_sync_at,last_error,display_name`
      );
      if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch connectors' });

      const connectors = Array.isArray(result.data) ? result.data : [];
      const summary = {
        total: connectors.length,
        healthy: connectors.filter(c => c.status === 'healthy').length,
        degraded: connectors.filter(c => c.status === 'degraded').length,
        error: connectors.filter(c => c.status === 'error').length,
        disconnected: connectors.filter(c => c.status === 'disconnected').length,
        pending: connectors.filter(c => c.status === 'pending_setup').length,
        connectors
      };

      return res.status(200).json(summary);
    }

    // Single connector
    if (id) {
      const result = await opsQuery('GET',
        `connector_accounts?id=eq.${id}&workspace_id=eq.${workspaceId}&select=*`
      );
      if (!result.ok || !result.data?.length) {
        return res.status(404).json({ error: 'Connector not found' });
      }

      const connector = result.data[0];
      // Non-managers can only see their own connectors' full details
      if (connector.user_id !== user.id && !requireRole(user, 'manager', workspaceId)) {
        // Return limited info
        const { config, ...safe } = connector;
        return res.status(200).json({ connector: safe });
      }

      return res.status(200).json({ connector });
    }

    // User's connectors
    if (user_id) {
      // Only self or manager+ can view specific user's connectors
      if (user_id !== user.id && !requireRole(user, 'manager', workspaceId)) {
        return res.status(403).json({ error: 'Cannot view other users\' connectors' });
      }

      const result = await opsQuery('GET',
        `connector_accounts?workspace_id=eq.${workspaceId}&user_id=eq.${user_id}&select=*&order=connector_type`
      );
      if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch connectors' });

      return res.status(200).json({ connectors: result.data || [] });
    }

    // All workspace connectors (list view — limited fields for non-managers)
    const isManager = !!requireRole(user, 'manager', workspaceId);
    const select = isManager
      ? '*'
      : 'id,user_id,connector_type,execution_method,display_name,status,last_sync_at';

    const result = await opsQuery('GET',
      `connector_accounts?workspace_id=eq.${workspaceId}&select=${select}&order=connector_type,display_name`
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch connectors' });

    return res.status(200).json({ connectors: result.data || [] });
  }

  // POST — register connector
  if (req.method === 'POST') {
    const { connector_type, execution_method, display_name, config, external_user_id, target_user_id } = req.body || {};

    if (!connector_type || !VALID_TYPES.includes(connector_type)) {
      return res.status(400).json({ error: `connector_type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (!display_name) {
      return res.status(400).json({ error: 'display_name is required' });
    }

    const method = execution_method || 'power_automate';
    if (!VALID_METHODS.includes(method)) {
      return res.status(400).json({ error: `execution_method must be one of: ${VALID_METHODS.join(', ')}` });
    }

    // Determine target user — self by default, managers can create for others
    let targetUserId = user.id;
    if (target_user_id && target_user_id !== user.id) {
      if (!requireRole(user, 'manager', workspaceId)) {
        return res.status(403).json({ error: 'Only managers can create connectors for other users' });
      }
      targetUserId = target_user_id;
    }

    const result = await opsQuery('POST', 'connector_accounts', {
      workspace_id: workspaceId,
      user_id: targetUserId,
      connector_type,
      execution_method: method,
      display_name,
      status: 'pending_setup',
      config: config || {},
      external_user_id: external_user_id || null
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: 'Failed to create connector', detail: result.data });
    }

    return res.status(201).json({ connector: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  // PATCH — update connector
  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });

    // Fetch existing to check ownership
    const existing = await opsQuery('GET',
      `connector_accounts?id=eq.${id}&workspace_id=eq.${workspaceId}&select=user_id`
    );
    if (!existing.ok || !existing.data?.length) {
      return res.status(404).json({ error: 'Connector not found' });
    }

    // Self or manager+ can update
    if (existing.data[0].user_id !== user.id && !requireRole(user, 'manager', workspaceId)) {
      return res.status(403).json({ error: 'Can only update your own connectors' });
    }

    const { display_name, status, config, execution_method, external_user_id, last_sync_at, last_error } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };

    if (display_name) updates.display_name = display_name;
    if (status && VALID_STATUSES.includes(status)) updates.status = status;
    if (config !== undefined) updates.config = config;
    if (execution_method && VALID_METHODS.includes(execution_method)) updates.execution_method = execution_method;
    if (external_user_id !== undefined) updates.external_user_id = external_user_id;
    if (last_sync_at !== undefined) updates.last_sync_at = last_sync_at;
    if (last_error !== undefined) updates.last_error = last_error;

    const result = await opsQuery('PATCH',
      `connector_accounts?id=eq.${id}&workspace_id=eq.${workspaceId}`,
      updates
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update connector' });

    return res.status(200).json({ connector: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  // DELETE — remove connector
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });

    const existing = await opsQuery('GET',
      `connector_accounts?id=eq.${id}&workspace_id=eq.${workspaceId}&select=user_id`
    );
    if (!existing.ok || !existing.data?.length) {
      return res.status(404).json({ error: 'Connector not found' });
    }

    // Self or owner can delete
    if (existing.data[0].user_id !== user.id && !requireRole(user, 'owner', workspaceId)) {
      return res.status(403).json({ error: 'Only connector owner or workspace owner can delete connectors' });
    }

    await opsQuery('DELETE',
      `connector_accounts?id=eq.${id}&workspace_id=eq.${workspaceId}`
    );

    return res.status(200).json({ id, removed: true });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
});
