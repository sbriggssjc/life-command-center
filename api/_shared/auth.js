// ============================================================================
// Auth Middleware — Route-level authentication and authorization
// Life Command Center — Phase 1: Workspace, Roles, and Policy Foundation
// ============================================================================
//
// Supports three auth modes:
//   1. Supabase JWT (Authorization: Bearer <jwt>) — production mode
//   2. API key (X-LCC-Key header) — Power Automate / external integrations
//   3. Transitional dev fallback — unauthenticated frontend in development env
//
// DUAL MODE: LCC_API_KEY can be set while the frontend still works without auth.
// Power Automate sends x-lcc-key header → validated via path 2.
// Frontend sends no credentials → falls through to path 3 (dev only).
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

// ---- Lockout-prevention misconfig guard (Phase 6b) ----
// When enforcement is ON (production/staging) the no-credential dev fallback in
// authenticate() is disabled and every request must present a valid X-LCC-Key
// or Supabase JWT. If NEITHER credential source is configured —
//   * LCC_API_KEY empty  → the X-LCC-Key path can never validate, AND
//   * OPS_SUPABASE_URL absent → verifySupabaseJwt() short-circuits to null, so
//     the JWT path can never validate either
// then EVERY request 401s with nothing it could possibly present. That is a
// total sign-in lockout (same blast radius as the 2026-05 disk-full outage).
// Surface it loudly at cold start instead of silently enforcing into a wall.
export function detectAuthMisconfig(env = process.env) {
  const lccEnv = env.LCC_ENV || 'development';
  const enforcing = lccEnv === 'production' || lccEnv === 'staging';
  const hasApiKey = !!env.LCC_API_KEY;
  const hasJwtVerification = !!env.OPS_SUPABASE_URL;
  return {
    lccEnv,
    enforcing,
    hasApiKey,
    hasJwtVerification,
    // No credential source the frontend or an integration could ever satisfy.
    misconfigured: enforcing && !hasApiKey && !hasJwtVerification,
  };
}

// One-time loud warning at module load (cold start). Does NOT change behavior —
// auth-config stays reachable so the frontend can always bootstrap its key.
(function warnIfAuthMisconfigured() {
  const m = detectAuthMisconfig();
  if (m.misconfigured) {
    console.error(
      '[auth] MISCONFIG: enforcement on but no credential source — every request will 401. ' +
      'Set LCC_API_KEY (X-LCC-Key path) or OPS_SUPABASE_URL (JWT path), ' +
      'or unset LCC_ENV (back to development) to recover.'
    );
  }
})();

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

// ---- Auth-readiness probe (read-only, no side effects) ----
//
// Reports, for the CURRENT request, whether it carries credentials that would
// survive flipping LCC_ENV=production — WITHOUT changing behavior or calling out
// to Supabase. Lets the operator confirm (while still in DEV MODE) that the
// frontend interceptor is already attaching X-LCC-Key before committing to the
// enforced flip.
//
// Note: the API-key path is validated synchronously (constant-time compare vs
// LCC_API_KEY) so `api_key_valid` is authoritative. The JWT path only checks
// header *presence* here — full verification requires an async Supabase round
// trip — so `has_jwt` is a precondition signal, not a guarantee.
export function authReadiness(req) {
  const authHeader = (req.headers && req.headers['authorization']) || '';
  const apiKey = (req.headers && req.headers['x-lcc-key']) || '';
  const hasJwt = authHeader.startsWith('Bearer ') && authHeader.slice(7).length > 0;
  const hasApiKey = !!apiKey;
  const apiKeyValid = hasApiKey && verifyApiKey(apiKey);
  const isCopilotPath = !!(req.query && req.query._copilot_path);
  const lccEnv = LCC_ENV;
  const enforcing = lccEnv === 'production' || lccEnv === 'staging';

  return {
    lcc_env: lccEnv,
    enforcing,
    has_jwt: hasJwt,
    has_api_key: hasApiKey,
    api_key_valid: apiKeyValid,
    api_key_configured: !!LCC_API_KEY,
    is_copilot_path: isCopilotPath,
    // Under production/staging enforcement, only a valid API key, a Bearer JWT,
    // or a Copilot passthrough survives. The dev fallback is gone.
    would_pass_in_production: apiKeyValid || hasJwt || isCopilotPath,
  };
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

  // 2. Try API key (dev/internal — used by Power Automate and other integrations)
  if (apiKey) {
    if (!verifyApiKey(apiKey)) {
      res.status(401).json({ error: 'Invalid API key' });
      return null;
    }
    // Try to resolve user from identity headers (x-lcc-user-id / x-lcc-user-email)
    const user = await resolveDevUser(req);
    if (user) return user;
    // No identity headers — fall back to first owner (typical for automation callers)
    if (OPS_SUPABASE_URL) {
      const owner = await resolveFirstOwner();
      if (owner) {
        owner._api_key_auth = true;
        return owner;
      }
    }
    // Last resort: synthetic automation user so the call doesn't fail
    return {
      id: 'api-key-user',
      email: 'automation@lcc',
      display_name: 'API Automation',
      avatar_url: null,
      auth_id: null,
      _api_key_auth: true,
      _transitional: true,
      memberships: [{
        workspace_id: 'default-workspace',
        workspace_name: 'Default',
        workspace_slug: 'default',
        role: 'operator'
      }]
    };
  }

  // 3a. Copilot plugin passthrough — requests from M365 Copilot declarative agent
  //     arrive via vercel.json rewrites with _copilot_path query param. Copilot
  //     authenticates the user at the M365 layer; allow these through with limited scope.
  // Defensive ?. — Vercel always populates req.query, but unit-test mocks
  // sometimes skip it. Without the optional chain a missing query throws
  // "Cannot read properties of undefined (reading '_copilot_path')" and
  // makes the test failure look like an auth bug.
  if (req.query?._copilot_path) {
    res.setHeader('X-LCC-Auth-Warning', 'copilot-plugin-passthrough');
    if (OPS_SUPABASE_URL) {
      const firstOwner = await resolveFirstOwner();
      if (firstOwner) return { ...firstOwner, _copilot_plugin: true };
    }
    return {
      id: 'copilot-plugin-user',
      email: 'copilot@microsoft.com',
      display_name: 'Copilot Plugin',
      avatar_url: null,
      auth_id: null,
      _copilot_plugin: true,
      memberships: [{
        workspace_id: 'default-workspace',
        workspace_name: 'Default',
        workspace_slug: 'default',
        role: 'operator'
      }]
    };
  }

  // 3b. Transitional dev fallback — DUAL MODE
  //    In development: allow unauthenticated frontend requests through even when
  //    LCC_API_KEY is set (the key is needed for Power Automate / external callers).
  //    Production and staging always require real authentication.
  //    Phase 6b: Frontend now sends X-LCC-Key automatically via auth.js interceptor,
  //    so production mode should work once LCC_API_KEY is set in Vercel + LCC_ENV=production.
  if (LCC_ENV === 'production' || LCC_ENV === 'staging') {
    console.warn('[auth] 401 — no credentials provided. Set X-LCC-Key or Authorization header.');
    res.status(401).json({ error: 'Authentication required. Provide Authorization header or X-LCC-Key.' });
    return null;
  }

  // Development mode — transitional passthrough for the frontend
  res.setHeader('X-LCC-Auth-Warning', 'transitional-dev-fallback');
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