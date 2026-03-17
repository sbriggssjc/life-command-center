// ============================================================================
// Workspace Management API
// Life Command Center — Phase 1
//
// GET  /api/workspaces              — list workspaces for current user
// GET  /api/workspaces?id=<uuid>    — get single workspace details
// POST /api/workspaces              — create workspace (owner only)
// PATCH /api/workspaces?id=<uuid>   — update workspace (owner/manager only)
// ============================================================================

import { authenticate, requireRole, primaryWorkspace, handleCors } from './_shared/auth.js';

const OPS_URL = process.env.OPS_SUPABASE_URL;
const OPS_KEY = process.env.OPS_SUPABASE_KEY;

async function opsQuery(method, path, body) {
  const url = `${OPS_URL}/rest/v1/${path}`;
  const opts = {
    method,
    headers: {
      'apikey': OPS_KEY,
      'Authorization': `Bearer ${OPS_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=representation'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (!OPS_URL || !OPS_KEY) {
    return res.status(503).json({ error: 'Ops database not configured' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  // GET — list user's workspaces or get single workspace
  if (req.method === 'GET') {
    const { id } = req.query;

    if (id) {
      // Single workspace — verify membership
      const membership = user.memberships.find(m => m.workspace_id === id);
      if (!membership) {
        return res.status(403).json({ error: 'Not a member of this workspace' });
      }

      const result = await opsQuery('GET', `workspaces?id=eq.${id}&select=*`);
      if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch workspace' });

      const workspace = Array.isArray(result.data) ? result.data[0] : result.data;
      return res.status(200).json({ workspace, role: membership.role });
    }

    // List all workspaces user belongs to
    const workspaceIds = user.memberships.map(m => m.workspace_id);
    if (workspaceIds.length === 0) {
      return res.status(200).json({ workspaces: [] });
    }

    const result = await opsQuery('GET',
      `workspaces?id=in.(${workspaceIds.join(',')})&select=*&order=name`
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch workspaces' });

    const workspaces = (Array.isArray(result.data) ? result.data : []).map(ws => ({
      ...ws,
      role: user.memberships.find(m => m.workspace_id === ws.id)?.role
    }));

    return res.status(200).json({ workspaces });
  }

  // POST — create workspace
  if (req.method === 'POST') {
    const { name, slug } = req.body || {};
    if (!name || !slug) {
      return res.status(400).json({ error: 'name and slug are required' });
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens' });
    }

    // Create workspace
    const wsResult = await opsQuery('POST', 'workspaces', { name, slug });
    if (!wsResult.ok) {
      return res.status(wsResult.status).json({ error: 'Failed to create workspace', detail: wsResult.data });
    }

    const workspace = Array.isArray(wsResult.data) ? wsResult.data[0] : wsResult.data;

    // Add creating user as owner
    await opsQuery('POST', 'workspace_memberships', {
      workspace_id: workspace.id,
      user_id: user.id,
      role: 'owner'
    });

    return res.status(201).json({ workspace, role: 'owner' });
  }

  // PATCH — update workspace
  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });

    // Require manager+ role
    if (!requireRole(user, 'manager', id)) {
      return res.status(403).json({ error: 'Manager role or higher required to update workspace' });
    }

    const { name, slug } = req.body || {};
    const updates = {};
    if (name) updates.name = name;
    if (slug) {
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens' });
      }
      updates.slug = slug;
    }
    updates.updated_at = new Date().toISOString();

    const result = await opsQuery('PATCH', `workspaces?id=eq.${id}`, updates);
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update workspace' });

    return res.status(200).json({ workspace: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}
