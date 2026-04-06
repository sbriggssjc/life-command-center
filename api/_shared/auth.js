// ============================================================================
// Auth Middleware — Route-level authentication and authorization
// Life Command Center — Phase 1: Workspace, Roles, and Policy Foundation
// ============================================================================
//
// Supports two auth modes:
//   1. Supabase JWT (Authorization: Bearer <jwt>) — production mode
//   2. API key (X-LCC-Key header) — development/internal mode
//
// Usage in serverless handlers:
//   import { authenticate, requireRole, requireWorkspace } from './_shared/auth.js';
//
//   const user = await authenticate(req, res);
//   if (!user) return; // already sent 401
//   requireRole(user, 'operator'); // throws if insufficient
// ============================================================================

const OPS_SUPABASE_URL = process.env.OPS_SUPABASE_URL;
const OPS_SUPABASE_KEY = process.env.OPS_SUPABASE_KEY;     // service_role — server only
const LCC_API_KEY      = process.env.LCC_API_KEY;          // internal dev key
const LCC_ENV          = process.env.LCC_ENV || 'development'; // 'production' | 'staging' | 'development'

// Role hierarchy: owner > manager > operator > viewer
// Canonical set — matches schema enum user_role in 001_workspace_and_users.sql
export const ROLES = ['owner', 'manager', 'operator', 'viewer'];
const ROLE_LEVELS = { owner: 40, manager: 30, operator: 20, viewer: 10 };

// ---- JWT verification via Supabase /auth/v1/user ----

async function verifySupabaseJwt(jwt) {
  if (!OPS_SUPABASE_URL) return null;

  const res = await fetch(`${OPS_SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'apikey': OPS_SUPABASE_KEY || ''
    }
  });

  if (!res.ok) return null;

  const supabaseUser = await res.json();
  if (!supabaseUser || !supabaseUser.id) return null;

  return supabaseUser;
}

// ---- Resolve LCC user + workspace from Supabase auth user ----

async function resolveUser(supabaseUser) {
  if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) return null;

  // Look up LCC user by email (linked to Supabase auth)
  const url = new URL(`${OPS_SUPABASE_URL}/rest/v1/users`);
  url.searchParams.set('select', '*, workspace_memberships(*, workspaces(*))');
  url.searchParams.set('email', `eq.${supabaseUser.email}`);
  url.searchParams.set('is_active', 'eq.true');
  url.searchParams.set('limit', '1');

  const res = await fetch(url.toString(), {
    headers: {
      'apikey': OPS_SUPABASE_KEY,
      'Authorization': `Bearer ${OPS_SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) return null;

  const rows = await res.json();
  if (!rows || rows.length === 0) return null;

  const user = rows[0];
  const memberships = user.workspace_memberships || [];

  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    auth_id: supabaseUser.id,
    memberships: memberships.map(m => ({
      workspace_id: m.workspace_id,
      workspace_name: m.workspaces?.name,
      workspace_slug: m.workspaces?.slug,
      role: m.role
    }))
  };
}

// ---- API key verification (dev/internal mode) ----

function verifyApiKey(key) {
  if (!LCC_API_KEY) return false;
  // Constant-time comparison
  if (key.length !== LCC_API_KEY.length) return false;
  let mismatch = 0;
  for (let i = 0; i < key.length; i++) {
    mismatch |= key.charCodeAt(i) ^ LCC_API_KEY.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---- Look up first owner user from ops DB (transitional single-user mode) ----

async function resolveFirstOwner() {
  if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) return null;
  try {
    const url = new URL(`${OPS_SUPABASE_URL}/rest/v1/workspace_memberships`);
    url.searchParams.set('select', 'role,workspace_id,workspaces(id,name,slug),users(id,email,display_name,avatar_url)');
    url.searchParams.set('role', 'eq.owner');
    url.searchParams.set('limit', '1');

    const res = await fetch(url.toString(), {
      headers: {
        'apikey': OPS_SUPABASE_KEY,
        'Authorization': `Bearer ${OPS_SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows || rows.length === 0) return null;

    const m = rows[0];
    const u = m.users;
    const w = m.workspaces;
    if (!u) return null;

    return {
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      avatar_url: u.avatar_url,
      auth_id: null,
      _transitional: true,
      memberships: [{
        workspace_id: m.workspace_id,
        workspace_name: w?.name || 'Default',
        workspace_slug: w?.slug || 'default',
        role: m.role
      }]
    };
  } catch {
    return null;
  }
}

// ---- Dev-mode user lookup by X-LCC-User-Id or X-LCC-Email ----

async function resolveDevUser(req) {
  const userId = req.headers['x-lcc-user-id'];
  const email = req.headers['x-lcc-user-email'];

  if (!userId && !email) return null;
  if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) {
    // No ops database — return a synthetic dev user (development only)
    if (LCC_ENV === 'production' || LCC_ENV === 'staging') return null;
    return {
      id: userId || 'dev-user',
      email: email || 'dev@local',
      display_name: 'Dev User',
      avatar_url: null,
      auth_id: null,
      _transitional: true,
      memberships: [{
        workspace_id: 'dev-workspace',
        workspace_name: 'Development',
        workspace_slug: 'dev',
        role: 'operator'
      }]
    };
  }

  // Look up real user from ops DB
  const url = new URL(`${OPS_SUPABASE_URL}/rest/v1/users`);
  url.searchParams.set('select', '*, workspace_memberships(*, workspaces(*))');
  if (userId) {
    url.searchParams.set('id', `eq.${userId}`);
  } else {
    url.searchParams.set('email', `eq.${email}`);
  }
  url.searchParams.set('is_active', 'eq.true');
  url.searchParams.set('limit', '1');

  const res = await fetch(url.toString(), {
    headers: {
      'apikey': OPS_SUPABASE_KEY,
      'Authorization': `Bearer ${OPS_SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows || rows.length === 0) return null;

  const user = rows[0];
  const memberships = user.workspace_memberships || [];

  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    auth_id: null,
    memberships: memberships.map(m => ({
      workspace_id: m.workspace_id,
      workspace_name: m.workspaces?.name,
      workspace_slug: m.workspaces?.slug,
      role: m.role
    }))
  };
}

// ============================================================================
// Main authenticate function — call at the top of every protected handler
//
// Returns user object or null (after sending 401).
// During dev transition: if no auth is configured, returns a default dev user
// so existing functionality is not broken.
// ============================================================================

export async function authenticate(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const apiKey = req.headers['x-lcc-key'] || '';

  // 1. Try Supabase JWT
  if (authHeader.startsWith('Bearer ')) {
    const jwt = authHeader.slice(7);
    const supabaseUser = await verifySupabaseJwt(jwt);
    if (supabaseUser) {
      const user = await resolveUser(supabaseUser);
      if (user) return user;
    }
    // JWT provided but invalid — don't fall through
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }

  // 2. Try API key (dev/internal)
  if (apiKey) {
    if (!verifyApiKey(apiKey)) {
      res.status(401).json({ error: 'Invalid API key' });
      return null;
    }
    const user = await resolveDevUser(req);
    if (user) return user;
    res.status(401).json({ error: 'Valid API key but user not found' });
    return null;
  }

  // 3. Transitional: if LCC_API_KEY is not configured, no client-side auth
  //    mechanism exists yet. Allow through with a default owner user so the
  //    frontend (which sends no credentials) can load data.
  //    Once LCC_API_KEY is set, this fallback stops and real auth is enforced.
  //    HARDENED: Only permitted in development environment. Production and
  //    staging always require real authentication.
  if (!LCC_API_KEY) {
    if (LCC_ENV === 'production' || LCC_ENV === 'staging') {
      res.status(401).json({ error: 'Authentication required. LCC_API_KEY must be configured in production/staging.' });
      return null;
    }
    res.setHeader('X-LCC-Auth-Warning', 'transitional-no-api-key');
    // Try to resolve user from ops DB if headers are present
    if (OPS_SUPABASE_URL) {
      const devUser = await resolveDevUser(req);
      if (devUser) return devUser;
      // No headers — look up the first owner in the ops DB (single-user setup)
      const firstOwner = await resolveFirstOwner();
      if (firstOwner) return firstOwner;
    }
    // Fall back to default owner user
    return {
      id: 'default-dev-user',
      email: 'dev@local',
      display_name: 'Dev User',
      avatar_url: null,
      auth_id: null,
      _transitional: true,
      memberships: [{
        workspace_id: 'default-workspace',
        workspace_name: 'Default',
        workspace_slug: 'default',
        role: 'owner'
      }]
    };
  }

  res.status(401).json({ error: 'Authentication required. Provide Authorization header or X-LCC-Key.' });
  return null;
}

// ============================================================================
// Authorization helpers
// ============================================================================

/**
 * Check if user has at least the required role in a workspace.
 * Returns the matching membership or null.
 */
export function requireRole(user, requiredRole, workspaceId) {
  const requiredLevel = ROLE_LEVELS[requiredRole] || 0;

  const memberships = workspaceId
    ? user.memberships.filter(m => m.workspace_id === workspaceId)
    : user.memberships;

  for (const m of memberships) {
    if ((ROLE_LEVELS[m.role] || 0) >= requiredLevel) {
      return m;
    }
  }
  return null;
}

/**
 * Check if user has access to a given workspace.
 * Returns the membership or null.
 */
export function requireWorkspace(user, workspaceId) {
  return user.memberships.find(m => m.workspace_id === workspaceId) || null;
}

/**
 * Get user's primary workspace (first membership).
 */
export function primaryWorkspace(user) {
  return user.memberships[0] || null;
}

/**
 * Determine if user can see a record based on its visibility scope.
 *
 * @param {object} user - Authenticated user
 * @param {object} record - Record with visibility, source_user_id, assigned_to, workspace_id
 * @returns {boolean}
 */
export function canView(user, record) {
  if (!record) return false;

  // Shared records are visible to all workspace members
  if (record.visibility === 'shared') {
    return !!requireWorkspace(user, record.workspace_id);
  }

  // Assigned records: visible to owner, assignee, and managers+
  if (record.visibility === 'assigned') {
    if (record.source_user_id === user.id) return true;
    if (record.assigned_to === user.id) return true;
    if (record.owner_id === user.id) return true;
    // Managers and owners can see assigned items in their workspace
    const membership = requireWorkspace(user, record.workspace_id);
    return membership && (membership.role === 'manager' || membership.role === 'owner');
  }

  // Private: only the source user
  if (record.visibility === 'private') {
    return record.source_user_id === user.id || record.owner_id === user.id;
  }

  return false;
}

/**
 * Build a visibility filter clause for Supabase PostgREST queries.
 * Returns filter params that should be applied to restrict results
 * based on user's role and visibility rules.
 */
export function visibilityFilter(user, workspaceId) {
  const membership = requireWorkspace(user, workspaceId);
  if (!membership) return null;

  // Managers and owners see everything in the workspace
  if (membership.role === 'manager' || membership.role === 'owner') {
    return { workspace_id: `eq.${workspaceId}` };
  }

  // Operators and viewers: shared + their own assigned/private
  // This requires an OR filter — implemented as an RPC or view server-side.
  // For now, return workspace filter and let the handler apply row-level filtering.
  return {
    workspace_id: `eq.${workspaceId}`,
    _requires_row_filter: true,
    _user_id: user.id
  };
}

/**
 * Standard CORS + auth preflight handler.
 * Returns true if this was an OPTIONS request (already handled).
 */
export function handleCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, Authorization, Prefer, X-LCC-Key, X-LCC-User-Id, X-LCC-User-Email, X-LCC-Workspace'
  );
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}
