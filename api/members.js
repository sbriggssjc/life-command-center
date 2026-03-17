// ============================================================================
// User & Membership Management API
// Life Command Center — Phase 1
//
// GET    /api/members                         — list workspace members
// GET    /api/members?user_id=<uuid>          — get single member
// POST   /api/members                         — invite/add member (owner/manager)
// PATCH  /api/members?user_id=<uuid>          — update role (owner only)
// DELETE /api/members?user_id=<uuid>          — remove member (owner only)
// GET    /api/members?action=me               — get current user profile + memberships
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';

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
      'Prefer': 'return=representation'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

const VALID_ROLES = ['owner', 'manager', 'operator', 'viewer'];

export default async function handler(req, res) {
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

  // Verify user belongs to this workspace
  const myMembership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!myMembership) {
    return res.status(403).json({ error: 'Not a member of this workspace' });
  }

  // GET /api/members?action=me — return current user info
  if (req.method === 'GET' && req.query.action === 'me') {
    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url
      },
      workspace_id: workspaceId,
      role: myMembership.role,
      memberships: user.memberships
    });
  }

  // GET — list members or get single member
  if (req.method === 'GET') {
    const { user_id } = req.query;

    if (user_id) {
      const result = await opsQuery('GET',
        `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${user_id}&select=*,users(*)`
      );
      if (!result.ok || !result.data?.length) {
        return res.status(404).json({ error: 'Member not found' });
      }
      const m = result.data[0];
      return res.status(200).json({
        member: {
          user_id: m.user_id,
          role: m.role,
          joined_at: m.joined_at,
          ...m.users
        }
      });
    }

    // List all members
    const result = await opsQuery('GET',
      `workspace_memberships?workspace_id=eq.${workspaceId}&select=*,users(*)&order=joined_at`
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch members' });

    const members = (Array.isArray(result.data) ? result.data : []).map(m => ({
      user_id: m.user_id,
      role: m.role,
      joined_at: m.joined_at,
      display_name: m.users?.display_name,
      email: m.users?.email,
      avatar_url: m.users?.avatar_url,
      is_active: m.users?.is_active
    }));

    return res.status(200).json({ members, workspace_id: workspaceId });
  }

  // POST — add member (owner/manager only)
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

    // Only owners can assign owner role
    if (memberRole === 'owner' && myMembership.role !== 'owner') {
      return res.status(403).json({ error: 'Only workspace owners can assign the owner role' });
    }

    // Find or create user
    let targetUser;
    const existingResult = await opsQuery('GET', `users?email=eq.${email}&select=*&limit=1`);
    if (existingResult.ok && existingResult.data?.length > 0) {
      targetUser = existingResult.data[0];
    } else {
      // Create new user
      const createResult = await opsQuery('POST', 'users', {
        email,
        display_name: display_name || email.split('@')[0],
        is_active: true
      });
      if (!createResult.ok) {
        return res.status(createResult.status).json({ error: 'Failed to create user', detail: createResult.data });
      }
      targetUser = Array.isArray(createResult.data) ? createResult.data[0] : createResult.data;
    }

    // Check if already a member
    const memberCheck = await opsQuery('GET',
      `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${targetUser.id}&select=id`
    );
    if (memberCheck.ok && memberCheck.data?.length > 0) {
      return res.status(409).json({ error: 'User is already a member of this workspace' });
    }

    // Add membership
    const memberResult = await opsQuery('POST', 'workspace_memberships', {
      workspace_id: workspaceId,
      user_id: targetUser.id,
      role: memberRole
    });
    if (!memberResult.ok) {
      return res.status(memberResult.status).json({ error: 'Failed to add membership' });
    }

    return res.status(201).json({
      member: {
        user_id: targetUser.id,
        email: targetUser.email,
        display_name: targetUser.display_name,
        role: memberRole
      }
    });
  }

  // PATCH — update role (owner only)
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

    // Prevent self-demotion from owner (must have at least one owner)
    if (user_id === user.id && myMembership.role === 'owner' && role !== 'owner') {
      return res.status(400).json({ error: 'Cannot demote yourself. Transfer ownership first.' });
    }

    const result = await opsQuery('PATCH',
      `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${user_id}`,
      { role }
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update role' });

    return res.status(200).json({ user_id, role, updated: true });
  }

  // DELETE — remove member (owner only)
  if (req.method === 'DELETE') {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id query parameter required' });

    if (!requireRole(user, 'owner', workspaceId)) {
      return res.status(403).json({ error: 'Only workspace owners can remove members' });
    }

    if (user_id === user.id) {
      return res.status(400).json({ error: 'Cannot remove yourself from workspace' });
    }

    const result = await opsQuery('DELETE',
      `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${user_id}`
    );

    return res.status(200).json({ user_id, removed: true });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}
