// ============================================================================
// Feature Flags API — Runtime feature gates for rollout control
// Life Command Center — RG7: Rollout Safety
//
// GET  /api/flags                — list all flags and current values
// GET  /api/flags?flag=<name>   — check single flag
// POST /api/flags               — update flag (manager+)
//
// Flags are stored in workspace config (workspaces.config JSONB).
// Defaults are defined here; workspace overrides take precedence.
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, requireOps, withErrorHandler } from './_shared/ops-db.js';

// Default flag values — safe defaults for gradual rollout
const DEFAULT_FLAGS = {
  // Auth
  strict_auth: false,              // true = block all transitional/dev auth (RG1)

  // Queue
  queue_v2_enabled: false,         // true = use paginated queue-v2 endpoints
  queue_v2_auto_fallback: true,    // true = fall back to v1 if v2 fails

  // Sync
  auto_sync_on_load: false,        // true = triggerCanonicalSync() runs on page load
  sync_outlook_enabled: true,      // per-connector-type enable/disable
  sync_salesforce_enabled: true,
  sync_outbound_enabled: false,    // outbound write-back (conservative default)

  // Team features
  team_queue_enabled: false,       // true = show Team Queue page
  escalations_enabled: false,      // true = enable escalation workflows
  bulk_operations_enabled: false,  // true = enable bulk assign/triage

  // Domain expansion
  domain_templates_enabled: false, // true = allow apply_template endpoint
  domain_sync_enabled: false,      // true = allow sync_entities endpoint

  // UX
  ops_pages_enabled: false,        // true = show My Work/Queue/Inbox/etc in nav
  more_drawer_enabled: false,      // true = use new 5+More nav layout
  freshness_indicators: true,      // true = show green/yellow/red freshness dots
};

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const membership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

  // Fetch workspace config
  const wsResult = await opsQuery('GET',
    `workspaces?id=eq.${workspaceId}&select=config`
  );
  const wsConfig = wsResult.data?.[0]?.config || {};
  const featureFlags = wsConfig.feature_flags || {};

  if (req.method === 'GET') {
    const { flag } = req.query;

    // Merge defaults with workspace overrides
    const resolved = {};
    for (const [key, defaultValue] of Object.entries(DEFAULT_FLAGS)) {
      resolved[key] = featureFlags[key] !== undefined ? featureFlags[key] : defaultValue;
    }

    if (flag) {
      if (!(flag in DEFAULT_FLAGS)) {
        return res.status(404).json({ error: `Unknown flag: ${flag}` });
      }
      return res.status(200).json({
        flag,
        value: resolved[flag],
        source: featureFlags[flag] !== undefined ? 'workspace' : 'default',
        default: DEFAULT_FLAGS[flag]
      });
    }

    return res.status(200).json({
      flags: resolved,
      overrides: featureFlags,
      defaults: DEFAULT_FLAGS
    });
  }

  if (req.method === 'POST') {
    if (!requireRole(user, 'manager', workspaceId)) {
      return res.status(403).json({ error: 'Manager role required to update feature flags' });
    }

    const { flag, value } = req.body || {};
    if (!flag || !(flag in DEFAULT_FLAGS)) {
      return res.status(400).json({ error: `flag must be one of: ${Object.keys(DEFAULT_FLAGS).join(', ')}` });
    }
    if (typeof value !== 'boolean') {
      return res.status(400).json({ error: 'value must be a boolean' });
    }

    // Update workspace config
    const updatedFlags = { ...featureFlags, [flag]: value };
    const updatedConfig = { ...wsConfig, feature_flags: updatedFlags };

    const result = await opsQuery('PATCH',
      `workspaces?id=eq.${workspaceId}`,
      { config: updatedConfig, updated_at: new Date().toISOString() }
    );

    if (!result.ok) {
      return res.status(result.status).json({ error: 'Failed to update flag' });
    }

    return res.status(200).json({
      flag,
      value,
      previous: featureFlags[flag] !== undefined ? featureFlags[flag] : DEFAULT_FLAGS[flag],
      updated_at: new Date().toISOString()
    });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
});
