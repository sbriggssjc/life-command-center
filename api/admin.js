// ============================================================================
// Admin API — Consolidated: workspaces, members, flags
// Life Command Center
//
// Routed via vercel.json rewrites:
//   /api/workspaces → /api/admin?_route=workspaces
//   /api/members    → /api/admin?_route=members
//   /api/flags      → /api/admin?_route=flags
// ============================================================================

import { authenticate, requireRole, primaryWorkspace, handleCors } from './_shared/auth.js';
import { opsQuery, requireOps, withErrorHandler } from './_shared/ops-db.js';
import { ROLES } from './_shared/lifecycle.js';

// Default flag values — safe defaults for gradual rollout
const DEFAULT_FLAGS = {
  strict_auth: false,
  queue_v2_enabled: false,
  queue_v2_auto_fallback: true,
  auto_sync_on_load: false,
  sync_outlook_enabled: true,
  sync_salesforce_enabled: true,
  sync_outbound_enabled: false,
  team_queue_enabled: false,
  escalations_enabled: false,
  bulk_operations_enabled: false,
  domain_templates_enabled: false,
  domain_sync_enabled: false,
  ops_pages_enabled: false,
  more_drawer_enabled: false,
  freshness_indicators: true,
};

const VALID_ROLES = ROLES;

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const route = req.query._route;
  switch (route) {
    case 'workspaces': return handleWorkspaces(req, res);
    case 'members':    return handleMembers(req, res);
    case 'flags':      return handleFlags(req, res);
    default:
      return res.status(400).json({ error: 'Unknown admin route' });
  }
});

// ============================================================================
// WORKSPACES
// ============================================================================

async function handleWorkspaces(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const { id } = req.query;

    if (id) {
      const membership = user.memberships.find(m => m.workspace_id === id);
      if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

      const result = await opsQuery('GET', `workspaces?id=eq.${id}&select=*`);
      if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch workspace' });

      const workspace = Array.isArray(result.data) ? result.data[0] : result.data;
      return res.status(200).json({ workspace, role: membership.role });
    }

    const workspaceIds = user.memberships.map(m => m.workspace_id);
    if (workspaceIds.length === 0) return res.status(200).json({ workspaces: [] });

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

  if (req.method === 'POST') {
    const { name, slug } = req.body || {};
    if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens' });
    }

    const wsResult = await opsQuery('POST', 'workspaces', { name, slug });
    if (!wsResult.ok) return res.status(wsResult.status).json({ error: 'Failed to create workspace', detail: wsResult.data });

    const workspace = Array.isArray(wsResult.data) ? wsResult.data[0] : wsResult.data;
    await opsQuery('POST', 'workspace_memberships', {
      workspace_id: workspace.id,
      user_id: user.id,
      role: 'owner'
    });

    return res.status(201).json({ workspace, role: 'owner' });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });
    if (!requireRole(user, 'manager', id)) {
      return res.status(403).json({ error: 'Manager role or higher required to update workspace' });
    }

    const { name, slug } = req.body || {};
    const updates = {};
    if (name) updates.name = name;
    if (slug) {
      if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens' });
      updates.slug = slug;
    }
    updates.updated_at = new Date().toISOString();

    const result = await opsQuery('PATCH', `workspaces?id=eq.${id}`, updates);
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update workspace' });

    return res.status(200).json({ workspace: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

// ============================================================================
// MEMBERS
// ============================================================================

async function handleMembers(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context. Set X-LCC-Workspace header.' });

  const myMembership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!myMembership) return res.status(403).json({ error: 'Not a member of this workspace' });

  if (req.method === 'GET' && req.query.action === 'me') {
    return res.status(200).json({
      user: { id: user.id, email: user.email, display_name: user.display_name, avatar_url: user.avatar_url },
      workspace_id: workspaceId,
      role: myMembership.role,
      memberships: user.memberships
    });
  }

  if (req.method === 'GET') {
    const { user_id } = req.query;

    if (user_id) {
      const result = await opsQuery('GET',
        `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${user_id}&select=*,users(*)`
      );
      if (!result.ok || !result.data?.length) return res.status(404).json({ error: 'Member not found' });
      const m = result.data[0];
      return res.status(200).json({
        member: { user_id: m.user_id, role: m.role, joined_at: m.joined_at, ...m.users }
      });
    }

    const result = await opsQuery('GET',
      `workspace_memberships?workspace_id=eq.${workspaceId}&select=*,users(*)&order=joined_at`
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch members' });

    const members = (Array.isArray(result.data) ? result.data : []).map(m => ({
      user_id: m.user_id, role: m.role, joined_at: m.joined_at,
      display_name: m.users?.display_name, email: m.users?.email,
      avatar_url: m.users?.avatar_url, is_active: m.users?.is_active
    }));

    return res.status(200).json({ members, workspace_id: workspaceId });
  }

  if (req.method === 'POST') {
    if (!requireRole(user, 'manager', workspaceId)) {
      return res.status(403).json({ error: 'Manager role or higher required to add members' });
    }

    const { email, display_name, role } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email is required' });

    const memberRole = role || 'operator';
    if (!VALID_ROLES.includes(memberRole)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    }
    if (memberRole === 'owner' && myMembership.role !== 'owner') {
      return res.status(403).json({ error: 'Only workspace owners can assign the owner role' });
    }

    let targetUser;
    const existingResult = await opsQuery('GET', `users?email=eq.${email}&select=*&limit=1`);
    if (existingResult.ok && existingResult.data?.length > 0) {
      targetUser = existingResult.data[0];
    } else {
      const createResult = await opsQuery('POST', 'users', {
        email, display_name: display_name || email.split('@')[0], is_active: true
      });
      if (!createResult.ok) return res.status(createResult.status).json({ error: 'Failed to create user', detail: createResult.data });
      targetUser = Array.isArray(createResult.data) ? createResult.data[0] : createResult.data;
    }

    const memberCheck = await opsQuery('GET',
      `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${targetUser.id}&select=id`
    );
    if (memberCheck.ok && memberCheck.data?.length > 0) {
      return res.status(409).json({ error: 'User is already a member of this workspace' });
    }

    const memberResult = await opsQuery('POST', 'workspace_memberships', {
      workspace_id: workspaceId, user_id: targetUser.id, role: memberRole
    });
    if (!memberResult.ok) return res.status(memberResult.status).json({ error: 'Failed to add membership' });

    return res.status(201).json({
      member: { user_id: targetUser.id, email: targetUser.email, display_name: targetUser.display_name, role: memberRole }
    });
  }

  if (req.method === 'PATCH') {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id query parameter required' });
    if (!requireRole(user, 'owner', workspaceId)) {
      return res.status(403).json({ error: 'Only workspace owners can change roles' });
    }

    const { role } = req.body || {};
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    }
    if (user_id === user.id && myMembership.role === 'owner' && role !== 'owner') {
      return res.status(400).json({ error: 'Cannot demote yourself. Transfer ownership first.' });
    }

    const result = await opsQuery('PATCH',
      `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${user_id}`, { role }
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update role' });

    return res.status(200).json({ user_id, role, updated: true });
  }

  if (req.method === 'DELETE') {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id query parameter required' });
    if (!requireRole(user, 'owner', workspaceId)) {
      return res.status(403).json({ error: 'Only workspace owners can remove members' });
    }
    if (user_id === user.id) return res.status(400).json({ error: 'Cannot remove yourself from workspace' });

    await opsQuery('DELETE',
      `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${user_id}`
    );

    return res.status(200).json({ user_id, removed: true });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

// ============================================================================
// FLAGS
// ============================================================================

async function handleFlags(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const membership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

  const wsResult = await opsQuery('GET', `workspaces?id=eq.${workspaceId}&select=config`);
  const wsConfig = wsResult.data?.[0]?.config || {};
  const featureFlags = wsConfig.feature_flags || {};

  if (req.method === 'GET') {
    const { flag } = req.query;

    const resolved = {};
    for (const [key, defaultValue] of Object.entries(DEFAULT_FLAGS)) {
      resolved[key] = featureFlags[key] !== undefined ? featureFlags[key] : defaultValue;
    }

    if (flag) {
      if (!(flag in DEFAULT_FLAGS)) return res.status(404).json({ error: `Unknown flag: ${flag}` });
      return res.status(200).json({
        flag, value: resolved[flag],
        source: featureFlags[flag] !== undefined ? 'workspace' : 'default',
        default: DEFAULT_FLAGS[flag]
      });
    }

    return res.status(200).json({ flags: resolved, overrides: featureFlags, defaults: DEFAULT_FLAGS });
  }

  if (req.method === 'POST') {
    if (!requireRole(user, 'manager', workspaceId)) {
      return res.status(403).json({ error: 'Manager role required to update feature flags' });
    }

    const { flag, value } = req.body || {};
    if (!flag || !(flag in DEFAULT_FLAGS)) {
      return res.status(400).json({ error: `flag must be one of: ${Object.keys(DEFAULT_FLAGS).join(', ')}` });
    }
    if (typeof value !== 'boolean') return res.status(400).json({ error: 'value must be a boolean' });

    const updatedFlags = { ...featureFlags, [flag]: value };
    const updatedConfig = { ...wsConfig, feature_flags: updatedFlags };

    const result = await opsQuery('PATCH',
      `workspaces?id=eq.${workspaceId}`,
      { config: updatedConfig, updated_at: new Date().toISOString() }
    );

    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update flag' });

    return res.status(200).json({
      flag, value,
      previous: featureFlags[flag] !== undefined ? featureFlags[flag] : DEFAULT_FLAGS[flag],
      updated_at: new Date().toISOString()
    });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}
