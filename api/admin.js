// ============================================================================
// Admin API — Consolidated: workspaces, members, flags, connectors, diagnostics, edge proxies
// Life Command Center
//
// Routed via vercel.json rewrites:
//   /api/workspaces  → /api/admin?_route=workspaces
//   /api/members     → /api/admin?_route=members
//   /api/flags       → /api/admin?_route=flags
//   /api/connectors  → /api/admin?_route=connectors
//   /api/config      → /api/admin?_route=config
//   /api/diag        → /api/admin?_route=diag
//   /api/treasury    → /api/admin?_route=treasury
//   /api/gov-query   → /api/admin?_route=edge-data&_source=gov
//   /api/dia-query   → /api/admin?_route=edge-data&_source=dia
//   /api/gov-write   → /api/admin?_route=edge-data&_edgeRoute=gov-write
//   /api/gov-evidence→ /api/admin?_route=edge-data&_edgeRoute=gov-evidence
//   /api/daily-briefing → /api/admin?_route=edge-brief
// ============================================================================

import { authenticate, requireRole, primaryWorkspace, handleCors } from './_shared/auth.js';
import { opsQuery, pgFilterVal, requireOps, withErrorHandler } from './_shared/ops-db.js';
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
  team_queue_enabled: true,
  escalations_enabled: false,
  bulk_operations_enabled: false,
  domain_templates_enabled: false,
  domain_sync_enabled: false,
  mutation_fallback_enabled: false,
  ops_pages_enabled: true,
  more_drawer_enabled: true,
  freshness_indicators: true,

  // ── Edge Migration Flags (Phase 0–4) ──
  // When enabled, frontend routes requests to Supabase Edge Functions
  // instead of Vercel API endpoints. Disable to instantly roll back.
  edge_context_broker: false,     // Phase 1: Context Broker → Supabase Edge
  edge_lead_ingest: false,        // Phase 2: RCM + LoopNet lead ingest → Supabase Edge
  edge_intake_receiver: false,    // Phase 2: Outlook email intake → Supabase Edge
  edge_copilot_chat: false,       // Phase 3: Chat / Copilot → Supabase Edge
  edge_template_service: false,   // Phase 3: Template drafts → Supabase Edge
  edge_daily_briefing: false,     // Phase 4: Daily briefing → Supabase Edge
  edge_data_query: false,         // Phase 4: Gov/Dia data queries → Supabase Edge
};

const VALID_ROLES = ROLES;

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const route = req.query._route;
  switch (route) {
    case 'workspaces':  return handleWorkspaces(req, res);
    case 'members':     return handleMembers(req, res);
    case 'flags':       return handleFlags(req, res);
    case 'auth-config': return handleAuthConfig(req, res);
    case 'me':          return handleMe(req, res);
    case 'connectors':  return handleConnectors(req, res);
    case 'config':      return handleConfig(req, res);
    case 'diag':        return handleDiag(req, res);
    case 'treasury':    return handleTreasury(req, res);
    case 'edge-data':   return handleEdgeDataProxy(req, res);
    case 'edge-brief':  return handleEdgeBriefingProxy(req, res);
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

      const result = await opsQuery('GET', `workspaces?id=eq.${pgFilterVal(id)}&select=*`);
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

    const result = await opsQuery('PATCH', `workspaces?id=eq.${pgFilterVal(id)}`, updates);
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
        `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${pgFilterVal(user_id)}&select=*,users(*)`
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
    const existingResult = await opsQuery('GET', `users?email=eq.${pgFilterVal(email)}&select=*&limit=1`);
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
      `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${pgFilterVal(user_id)}`, { role }
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
      `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${pgFilterVal(user_id)}`
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

// ============================================================================
// AUTH CONFIG — Public endpoint for frontend to discover auth settings
// No authentication required (needed before the user can sign in)
// ============================================================================

function handleAuthConfig(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  // Return the public (anon) Supabase credentials — NEVER the service role key
  const supabaseUrl = process.env.OPS_SUPABASE_URL || null;
  const supabaseAnonKey = process.env.OPS_SUPABASE_ANON_KEY || null;
  const env = process.env.LCC_ENV || 'development';
  const lccApiKey = process.env.LCC_API_KEY || null;

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({
    supabase_url: supabaseUrl,
    supabase_anon_key: supabaseAnonKey,
    env,
    // Phase 6b: expose API key so the frontend fetch interceptor can authenticate
    // when JWT is unavailable. This is safe for a single-user private deployment.
    // For multi-user production, remove this and require JWT auth exclusively.
    lcc_api_key: lccApiKey,
    auth_modes: lccApiKey ? ['jwt', 'magic_link', 'api_key'] : ['jwt', 'magic_link'],
    _note: supabaseAnonKey
      ? 'Supabase auth is configured. Frontend should use JWT authentication.'
      : lccApiKey
        ? 'API key mode — frontend will authenticate via X-LCC-Key header.'
        : 'No auth configured (OPS_SUPABASE_ANON_KEY / LCC_API_KEY). Running in dev fallback mode.'
  });
}

// ============================================================================
// ME — Return the authenticated user's profile and workspace info
// Requires authentication (JWT or API key)
// ============================================================================

async function handleMe(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  return res.status(200).json({
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    auth_id: user.auth_id || null,
    _transitional: user._transitional || false,
    _api_key_auth: user._api_key_auth || false,
    memberships: user.memberships || []
  });
}

// ============================================================================
// CONNECTORS — Connector account CRUD (migrated from sync.js, Phase 4b)
// GET/POST/PATCH/DELETE /api/connectors → /api/admin?_route=connectors
// ============================================================================

const VALID_CONNECTOR_TYPES = ['salesforce', 'outlook', 'power_automate', 'supabase_domain', 'webhook'];
const VALID_CONNECTOR_METHODS = ['direct_api', 'power_automate', 'webhook', 'manual'];
const VALID_CONNECTOR_STATUSES = ['healthy', 'degraded', 'error', 'disconnected', 'pending_setup'];

async function handleConnectors(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context. Set X-LCC-Workspace header.' });

  const myMembership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!myMembership) return res.status(403).json({ error: 'Not a member of this workspace' });

  if (req.method === 'GET') {
    const { id, user_id, action } = req.query;

    if (action === 'health') {
      const result = await opsQuery('GET',
        `connector_accounts?workspace_id=eq.${pgFilterVal(workspaceId)}&select=id,user_id,connector_type,status,last_sync_at,last_error,display_name`
      );
      if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch connectors' });

      const connectors = Array.isArray(result.data) ? result.data : [];
      return res.status(200).json({
        total: connectors.length,
        healthy: connectors.filter(c => c.status === 'healthy').length,
        degraded: connectors.filter(c => c.status === 'degraded').length,
        error: connectors.filter(c => c.status === 'error').length,
        disconnected: connectors.filter(c => c.status === 'disconnected').length,
        pending: connectors.filter(c => c.status === 'pending_setup').length,
        connectors
      });
    }

    if (id) {
      const result = await opsQuery('GET',
        `connector_accounts?id=eq.${pgFilterVal(id)}&workspace_id=eq.${pgFilterVal(workspaceId)}&select=*`
      );
      if (!result.ok || !result.data?.length) return res.status(404).json({ error: 'Connector not found' });

      const connector = result.data[0];
      if (connector.user_id !== user.id && !requireRole(user, 'manager', workspaceId)) {
        const { config, ...safe } = connector;
        return res.status(200).json({ connector: safe });
      }
      return res.status(200).json({ connector });
    }

    if (user_id) {
      if (user_id !== user.id && !requireRole(user, 'manager', workspaceId)) {
        return res.status(403).json({ error: 'Cannot view other users\' connectors' });
      }
      const result = await opsQuery('GET',
        `connector_accounts?workspace_id=eq.${pgFilterVal(workspaceId)}&user_id=eq.${pgFilterVal(user_id)}&select=*&order=connector_type`
      );
      if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch connectors' });
      return res.status(200).json({ connectors: result.data || [] });
    }

    const isManager = !!requireRole(user, 'manager', workspaceId);
    const select = isManager
      ? '*'
      : 'id,user_id,connector_type,execution_method,display_name,status,last_sync_at';

    const result = await opsQuery('GET',
      `connector_accounts?workspace_id=eq.${pgFilterVal(workspaceId)}&select=${select}&order=connector_type,display_name`
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch connectors' });
    return res.status(200).json({ connectors: result.data || [] });
  }

  if (req.method === 'POST') {
    const { connector_type, execution_method, display_name, config, external_user_id, target_user_id } = req.body || {};

    if (!connector_type || !VALID_CONNECTOR_TYPES.includes(connector_type)) {
      return res.status(400).json({ error: `connector_type must be one of: ${VALID_CONNECTOR_TYPES.join(', ')}` });
    }
    if (!display_name) return res.status(400).json({ error: 'display_name is required' });

    const method = execution_method || 'power_automate';
    if (!VALID_CONNECTOR_METHODS.includes(method)) {
      return res.status(400).json({ error: `execution_method must be one of: ${VALID_CONNECTOR_METHODS.join(', ')}` });
    }

    let targetUserId = user.id;
    if (target_user_id && target_user_id !== user.id) {
      if (!requireRole(user, 'manager', workspaceId)) {
        return res.status(403).json({ error: 'Only managers can create connectors for other users' });
      }
      targetUserId = target_user_id;
    }

    const result = await opsQuery('POST', 'connector_accounts', {
      workspace_id: workspaceId, user_id: targetUserId, connector_type,
      execution_method: method, display_name, status: 'pending_setup',
      config: config || {}, external_user_id: external_user_id || null
    });

    if (!result.ok) return res.status(result.status).json({ error: 'Failed to create connector', detail: result.data });
    return res.status(201).json({ connector: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });

    const existing = await opsQuery('GET',
      `connector_accounts?id=eq.${pgFilterVal(id)}&workspace_id=eq.${pgFilterVal(workspaceId)}&select=user_id`
    );
    if (!existing.ok || !existing.data?.length) return res.status(404).json({ error: 'Connector not found' });

    if (existing.data[0].user_id !== user.id && !requireRole(user, 'manager', workspaceId)) {
      return res.status(403).json({ error: 'Can only update your own connectors' });
    }

    const { display_name, status, config, execution_method, external_user_id, last_sync_at, last_error } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };

    if (display_name) updates.display_name = display_name;
    if (status && VALID_CONNECTOR_STATUSES.includes(status)) updates.status = status;
    if (config !== undefined) updates.config = config;
    if (execution_method && VALID_CONNECTOR_METHODS.includes(execution_method)) updates.execution_method = execution_method;
    if (external_user_id !== undefined) updates.external_user_id = external_user_id;
    if (last_sync_at !== undefined) updates.last_sync_at = last_sync_at;
    if (last_error !== undefined) updates.last_error = last_error;

    const result = await opsQuery('PATCH',
      `connector_accounts?id=eq.${pgFilterVal(id)}&workspace_id=eq.${pgFilterVal(workspaceId)}`, updates
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update connector' });
    return res.status(200).json({ connector: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });

    const existing = await opsQuery('GET',
      `connector_accounts?id=eq.${pgFilterVal(id)}&workspace_id=eq.${pgFilterVal(workspaceId)}&select=user_id`
    );
    if (!existing.ok || !existing.data?.length) return res.status(404).json({ error: 'Connector not found' });

    if (existing.data[0].user_id !== user.id && !requireRole(user, 'owner', workspaceId)) {
      return res.status(403).json({ error: 'Only connector owner or workspace owner can delete connectors' });
    }

    await opsQuery('DELETE',
      `connector_accounts?id=eq.${pgFilterVal(id)}&workspace_id=eq.${pgFilterVal(workspaceId)}`
    );

    return res.status(200).json({ id, removed: true });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

// ============================================================================
// DIAGNOSTICS — Config, diag, treasury (migrated from diagnostics.js, Phase 4b)
// ============================================================================

async function handleConfig(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    gov: { connected: !!process.env.GOV_SUPABASE_KEY },
    dia: { connected: !!process.env.DIA_SUPABASE_KEY },
    ops: { connected: !!(process.env.OPS_SUPABASE_URL && process.env.OPS_SUPABASE_KEY) }
  });
}

async function handleDiag(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const user = await authenticate(req, res);
  if (!user) return;

  const secret = process.env.DIAG_SECRET || 'lcc-diag-2024';
  if (req.query.secret !== secret) {
    return res.status(403).json({ error: 'Forbidden — pass ?secret=<DIAG_SECRET>' });
  }

  const govKey = process.env.GOV_SUPABASE_KEY || '';
  const diaKey = process.env.DIA_SUPABASE_KEY || '';
  const govUrl = process.env.GOV_SUPABASE_URL;
  const diaUrl = process.env.DIA_SUPABASE_URL;
  const results = {};

  if (govUrl) {
    try {
      const r = await fetch(`${govUrl}/rest/v1/ownership_history?select=ownership_id&limit=1`, {
        headers: { 'apikey': govKey, 'Authorization': `Bearer ${govKey}` }
      });
      const body = await r.text();
      results.gov = { status: r.status, keySet: govKey.length > 0, sample: body.substring(0, 200) };
    } catch (e) {
      results.gov = { error: e.message, keySet: govKey.length > 0 };
    }
  } else {
    results.gov = { error: 'GOV_SUPABASE_URL not configured', keySet: false };
  }

  if (diaUrl) {
    try {
      const r = await fetch(`${diaUrl}/rest/v1/v_counts_freshness?select=*&limit=1`, {
        headers: { 'apikey': diaKey, 'Authorization': `Bearer ${diaKey}` }
      });
      const body = await r.text();
      results.dia = { status: r.status, keySet: diaKey.length > 0, sample: body.substring(0, 200) };
    } catch (e) {
      results.dia = { error: e.message, keySet: diaKey.length > 0 };
    }
  } else {
    results.dia = { error: 'DIA_SUPABASE_URL not configured', keySet: false };
  }

  return res.status(200).json(results);
}

function parseXmlEntry(entry) {
  const dateMatch = entry.match(/<d:NEW_DATE[^>]*>([^<]+)/);
  const tenYrMatch = entry.match(/<d:BC_10YEAR[^>]*>([^<]+)/);
  const thirtyYrMatch = entry.match(/<d:BC_30YEAR[^>]*>([^<]+)/);
  return {
    date: dateMatch ? dateMatch[1].split('T')[0] : null,
    ten_yr: tenYrMatch ? parseFloat(tenYrMatch[1]) : null,
    thirty_yr: thirtyYrMatch ? parseFloat(thirtyYrMatch[1]) : null
  };
}

async function fetchXmlYear(year) {
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  try {
    const r = await fetch(url, {
      headers: { 'Accept': 'application/xml', 'User-Agent': 'Mozilla/5.0 (compatible; LCC/1.0)' }
    });
    if (!r.ok) return [];
    const text = await r.text();
    const entries = text.split('<m:properties>').slice(1);
    return entries.map(parseXmlEntry).filter(e => e.date && e.ten_yr !== null);
  } catch {
    return [];
  }
}

async function fetchCsvYear(year) {
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/${year}?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!r.ok) return [];
    const csvText = await r.text();
    const lines = csvText.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const hdrs = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const tenIdx = hdrs.findIndex(h => h === '10 Yr');
    const thirtyIdx = hdrs.findIndex(h => h === '30 Yr');
    if (tenIdx < 0) return [];
    return lines.slice(1).map(line => {
      const cols = line.split(',').map(v => v.replace(/"/g, '').trim());
      const tenVal = parseFloat(cols[tenIdx]);
      if (isNaN(tenVal)) return null;
      const parts = cols[0].split('/');
      const isoDate = parts.length === 3
        ? `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`
        : cols[0];
      return { date: isoDate, ten_yr: tenVal, thirty_yr: thirtyIdx >= 0 ? (parseFloat(cols[thirtyIdx]) || null) : null };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function handleTreasury(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const wantHistory = req.query.history === 'true';
  const numYears = Math.min(parseInt(req.query.years, 10) || 1, 5);
  const currentYear = new Date().getFullYear();

  try {
    if (wantHistory) {
      const years = [];
      for (let i = 0; i < numYears; i++) years.push(currentYear - i);
      let allEntries = (await Promise.all(years.map(fetchXmlYear))).flat();
      if (allEntries.length === 0) allEntries = (await Promise.all(years.map(fetchCsvYear))).flat();
      allEntries.sort((a, b) => a.date.localeCompare(b.date));
      return res.status(200).json({ history: allEntries });
    }

    const entries = await fetchXmlYear(currentYear);
    if (entries.length > 0) {
      const latest = entries[entries.length - 1];
      const prev = entries.length > 1 ? entries[entries.length - 2] : null;
      return res.status(200).json({
        date: latest.date, ten_yr: latest.ten_yr, thirty_yr: latest.thirty_yr,
        prev_date: prev ? prev.date : null, prev_ten_yr: prev ? prev.ten_yr : null,
      });
    }

    const csvEntries = await fetchCsvYear(currentYear);
    if (csvEntries.length > 0) {
      const latest = csvEntries[csvEntries.length - 1];
      const prev = csvEntries.length > 1 ? csvEntries[csvEntries.length - 2] : null;
      return res.status(200).json({
        date: latest.date, ten_yr: latest.ten_yr, thirty_yr: latest.thirty_yr,
        prev_date: prev ? prev.date : null, prev_ten_yr: prev ? prev.ten_yr : null,
      });
    }

    const fiscalUrl = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=2&fields=record_date,avg_interest_rate_amt,security_desc&filter=security_desc:eq:Treasury Notes';
    const fiscalRes = await fetch(fiscalUrl, { headers: { 'Accept': 'application/json' } });
    if (fiscalRes.ok) {
      const json = await fiscalRes.json();
      const rows = json.data || [];
      if (rows.length >= 1) {
        const latest = rows[0];
        const prev = rows.length > 1 ? rows[1] : null;
        return res.status(200).json({
          date: latest.record_date, ten_yr: parseFloat(latest.avg_interest_rate_amt) || null,
          thirty_yr: null, prev_date: prev ? prev.record_date : null,
          prev_ten_yr: prev ? (parseFloat(prev.avg_interest_rate_amt) || null) : null,
        });
      }
    }

    return res.status(500).json({ error: 'No data from any Treasury source' });
  } catch (e) {
    console.error('[diagnostics] Treasury rate fetch error:', e.message);
    return res.status(500).json({ error: 'Treasury rate fetch failed' });
  }
}

// ============================================================================
// EDGE FUNCTION PROXIES — Phase 4b: Pure edge-first routing
// No local fallback — edge functions are the source of truth
// ============================================================================

const DATA_QUERY_EDGE_URL = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/data-query';
const DAILY_BRIEFING_EDGE_URL_ADMIN = 'https://xengecqvemvfknjvbvrq.supabase.co/functions/v1/daily-briefing';

function buildEdgeProxyHeaders(req) {
  const hdrs = { 'Content-Type': 'application/json' };
  const forward = [
    'x-lcc-workspace', 'x-lcc-key', 'x-pa-webhook-secret',
    'x-lcc-user-id', 'x-lcc-user-email', 'authorization', 'prefer'
  ];
  for (const h of forward) {
    if (req.headers[h]) hdrs[h] = req.headers[h];
  }
  return hdrs;
}

async function handleEdgeDataProxy(req, res) {
  const url = new URL(DATA_QUERY_EDGE_URL);

  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === '_route') continue;
    if (key === '_edgeRoute') { url.searchParams.set('_route', value); continue; }
    url.searchParams.set(key, value);
  }

  try {
    const edgeRes = await fetch(url.toString(), {
      method: req.method,
      headers: buildEdgeProxyHeaders(req),
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
    const data = await edgeRes.json();
    return res.status(edgeRes.status).json(data);
  } catch (err) {
    console.error('[admin/edge-data] Edge proxy failed:', err.message);
    return res.status(502).json({ error: 'Edge function unavailable', detail: err.message });
  }
}

async function handleEdgeBriefingProxy(req, res) {
  const url = new URL(DAILY_BRIEFING_EDGE_URL_ADMIN);

  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === '_route') continue;
    url.searchParams.set(key, value);
  }

  try {
    const edgeRes = await fetch(url.toString(), {
      method: req.method,
      headers: buildEdgeProxyHeaders(req),
      signal: AbortSignal.timeout(30000),
    });
    const data = await edgeRes.json();
    return res.status(edgeRes.status).json(data);
  } catch (err) {
    console.error('[admin/edge-brief] Edge proxy failed:', err.message);
    return res.status(502).json({ error: 'Edge function unavailable', detail: err.message });
  }
}
