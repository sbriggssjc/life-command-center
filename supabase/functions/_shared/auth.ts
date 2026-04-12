// ============================================================================
// Auth — Authentication for Edge Functions
// Life Command Center — Infrastructure Migration Phase 0
//
// Supports:
//   1. Power Automate webhook secret (X-PA-Webhook-Secret header)
//   2. Supabase JWT (Authorization: Bearer <jwt>) — future
//   3. Transitional dev fallback — resolves default owner from OPS DB
//
// Mirrors the auth patterns from api/_shared/auth.js for consistency.
// ============================================================================

import { opsQuery, pgFilterVal } from "./supabase-client.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export interface LccUser {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  auth_id: string | null;
  _transitional: boolean;
  memberships: Array<{
    workspace_id: string;
    workspace_name: string;
    workspace_slug: string;
    role: string;
  }>;
}

// ── Webhook Authentication (Power Automate) ─────────────────────────────────

const PA_WEBHOOK_SECRET = Deno.env.get("PA_WEBHOOK_SECRET");

/**
 * Validate Power Automate webhook requests.
 * Constant-time comparison to prevent timing attacks.
 * If PA_WEBHOOK_SECRET is not set, allows all requests (transitional mode).
 */
export function authenticateWebhook(req: Request): boolean {
  if (!PA_WEBHOOK_SECRET) return true; // transitional mode
  const provided = req.headers.get("x-pa-webhook-secret") || "";
  if (provided.length !== PA_WEBHOOK_SECRET.length) return false;
  let mismatch = 0;
  for (let i = 0; i < PA_WEBHOOK_SECRET.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ PA_WEBHOOK_SECRET.charCodeAt(i);
  }
  return mismatch === 0;
}

// ── API Key Authentication ──────────────────────────────────────────────────

const LCC_API_KEY = Deno.env.get("LCC_API_KEY");

/**
 * Validate API key from X-LCC-Key header.
 * Constant-time comparison.
 */
export function verifyApiKey(key: string): boolean {
  if (!LCC_API_KEY) return false;
  if (key.length !== LCC_API_KEY.length) return false;
  let mismatch = 0;
  for (let i = 0; i < LCC_API_KEY.length; i++) {
    mismatch |= key.charCodeAt(i) ^ LCC_API_KEY.charCodeAt(i);
  }
  return mismatch === 0;
}

// ── User Authentication ─────────────────────────────────────────────────────

/**
 * Authenticate a user request. Tries in order:
 *   1. X-LCC-Key header (API key)
 *   2. Authorization: Bearer <jwt> (Supabase JWT — future)
 *   3. Transitional fallback (resolve first owner from OPS DB)
 *
 * Returns null if authentication fails.
 */
export async function authenticateUser(req: Request): Promise<LccUser | null> {
  // Path 1: API key
  const apiKey = req.headers.get("x-lcc-key");
  if (apiKey && verifyApiKey(apiKey)) {
    return resolveFirstOwner();
  }

  // Path 2: Supabase JWT (future — when frontend sends auth headers)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ") && authHeader.length > 20) {
    // TODO: Implement JWT verification via Supabase /auth/v1/user
    // For now, fall through to transitional mode
  }

  // Path 3: Transitional mode — resolve default owner
  return resolveFirstOwner();
}

/**
 * Resolve the first owner user from OPS database.
 * Used in transitional single-user mode (no frontend auth yet).
 * Mirrors resolveFirstOwner() from api/_shared/auth.js.
 */
async function resolveFirstOwner(): Promise<LccUser | null> {
  try {
    const result = await opsQuery(
      "GET",
      "workspace_memberships?select=role,workspace_id,workspaces(id,name,slug),users(id,email,display_name,avatar_url)&role=eq.owner&limit=1"
    );

    if (!result.ok || !result.data || !Array.isArray(result.data) || result.data.length === 0) {
      return null;
    }

    const m = result.data[0];
    const u = m.users;
    const w = m.workspaces;
    if (!u) return null;

    return {
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      avatar_url: u.avatar_url || null,
      auth_id: null,
      _transitional: true,
      memberships: [{
        workspace_id: m.workspace_id,
        workspace_name: w?.name || "Default",
        workspace_slug: w?.slug || "default",
        role: m.role,
      }],
    };
  } catch (err) {
    console.error("[auth] Failed to resolve first owner:", err);
    return null;
  }
}

// ── Role Checking ───────────────────────────────────────────────────────────

const ROLE_LEVELS: Record<string, number> = {
  owner: 40,
  manager: 30,
  operator: 20,
  viewer: 10,
};

/**
 * Check if user has at least the required role in a workspace.
 * Returns true if the user meets the role requirement.
 */
export function requireRole(user: LccUser, requiredRole: string, workspaceId?: string): boolean {
  const membership = workspaceId
    ? user.memberships.find(m => m.workspace_id === workspaceId)
    : user.memberships[0];

  if (!membership) return false;
  return (ROLE_LEVELS[membership.role] || 0) >= (ROLE_LEVELS[requiredRole] || 0);
}

/**
 * Get the primary workspace ID for a user.
 */
export function primaryWorkspaceId(user: LccUser): string | null {
  return user.memberships[0]?.workspace_id || null;
}
