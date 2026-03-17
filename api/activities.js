// ============================================================================
// Activity Events API — Immutable timeline of everything that happened
// Life Command Center — Phase 2
//
// GET  /api/activities                        — list activities (filterable)
// GET  /api/activities?entity_id=<uuid>       — entity timeline
// GET  /api/activities?action_item_id=<uuid>  — action timeline
// POST /api/activities                        — log an activity event
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, paginationParams, requireOps } from './_shared/ops-db.js';
import { ACTIVITY_CATEGORIES, VISIBILITY_SCOPES, isValidEnum } from './_shared/lifecycle.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const membership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

  // GET — list/filter activities
  if (req.method === 'GET') {
    const { entity_id, action_item_id, inbox_item_id, actor_id, category, domain, since } = req.query;

    let path = `activity_events?workspace_id=eq.${workspaceId}&select=*,users!activity_events_actor_id_fkey(display_name,avatar_url)`;

    if (entity_id) path += `&entity_id=eq.${entity_id}`;
    if (action_item_id) path += `&action_item_id=eq.${action_item_id}`;
    if (inbox_item_id) path += `&inbox_item_id=eq.${inbox_item_id}`;
    if (actor_id) path += `&actor_id=eq.${actor_id}`;
    if (category && isValidEnum(category, ACTIVITY_CATEGORIES)) path += `&category=eq.${category}`;
    if (domain) path += `&domain=eq.${domain}`;
    if (since) path += `&occurred_at=gte.${since}`;

    path += paginationParams({ ...req.query, order: req.query.order || 'occurred_at.desc' });

    const result = await opsQuery('GET', path);
    return res.status(200).json({ activities: result.data || [], count: result.count });
  }

  // POST — log an activity (append-only)
  if (req.method === 'POST') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }

    const { category, title, body, entity_id, action_item_id, inbox_item_id,
            source_type, source_connector_id, external_id, external_url,
            domain, visibility, metadata, occurred_at } = req.body || {};

    if (!category || !isValidEnum(category, ACTIVITY_CATEGORIES)) {
      return res.status(400).json({ error: `category must be one of: ${ACTIVITY_CATEGORIES.join(', ')}` });
    }
    if (!title) return res.status(400).json({ error: 'title is required' });

    const event = {
      workspace_id: workspaceId,
      actor_id: user.id,
      category,
      title: title.trim(),
      body: body || null,
      entity_id: entity_id || null,
      action_item_id: action_item_id || null,
      inbox_item_id: inbox_item_id || null,
      source_type: source_type || 'manual',
      source_connector_id: source_connector_id || null,
      external_id: external_id || null,
      external_url: external_url || null,
      domain: domain || null,
      visibility: isValidEnum(visibility, VISIBILITY_SCOPES) ? visibility : 'shared',
      metadata: metadata || {},
      occurred_at: occurred_at || new Date().toISOString()
    };

    const result = await opsQuery('POST', 'activity_events', event);
    if (!result.ok) {
      return res.status(result.status).json({ error: 'Failed to log activity', detail: result.data });
    }

    return res.status(201).json({ activity: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  // Activities are append-only — no PATCH or DELETE
  return res.status(405).json({ error: `Method ${req.method} not allowed. Activities are append-only.` });
}
