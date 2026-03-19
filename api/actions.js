// ============================================================================
// Action Items API — The canonical unit of work
// Life Command Center — Phase 2
//
// GET    /api/actions                    — list actions (filterable)
// GET    /api/actions?id=<uuid>          — get single action with timeline
// POST   /api/actions                    — create action item
// PATCH  /api/actions?id=<uuid>          — update/transition action item
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, paginationParams, requireOps, withErrorHandler } from './_shared/ops-db.js';
import {
  canTransitionAction, actionTransitionEffects, buildTransitionActivity,
  ACTION_TYPES, PRIORITIES, ACTIVITY_CATEGORIES, VISIBILITY_SCOPES, isValidEnum
} from './_shared/lifecycle.js';

// ── Activities sub-handler (routed via /api/activities → /api/actions?_route=activities) ──
async function handleActivities(req, res, user, workspaceId) {
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

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const membership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

  // Route to activities sub-handler if requested
  if (req.query._route === 'activities') {
    return handleActivities(req, res, user, workspaceId);
  }

  // GET
  if (req.method === 'GET') {
    const { id, status, action_type, assigned_to, owner_id, priority, domain, entity_id, due_before } = req.query;

    // Single action with activity timeline
    if (id) {
      const result = await opsQuery('GET',
        `action_items?id=eq.${id}&workspace_id=eq.${workspaceId}&select=*,entities(id,name,entity_type),inbox_items(id,title,source_type)`
      );
      if (!result.ok || !result.data?.length) {
        return res.status(404).json({ error: 'Action item not found' });
      }

      // Fetch related activity events
      const activities = await opsQuery('GET',
        `activity_events?action_item_id=eq.${id}&workspace_id=eq.${workspaceId}&select=*&order=occurred_at.desc&limit=50`
      );

      return res.status(200).json({
        action: result.data[0],
        activities: activities.data || []
      });
    }

    // List with filters
    let path = `action_items?workspace_id=eq.${workspaceId}&select=id,title,status,priority,action_type,due_date,owner_id,assigned_to,visibility,entity_id,domain,source_type,created_at,updated_at,completed_at`;

    if (status) path += `&status=eq.${status}`;
    if (action_type) path += `&action_type=eq.${action_type}`;
    if (assigned_to) path += `&assigned_to=eq.${assigned_to}`;
    if (owner_id) path += `&owner_id=eq.${owner_id}`;
    if (priority) path += `&priority=eq.${priority}`;
    if (domain) path += `&domain=eq.${domain}`;
    if (entity_id) path += `&entity_id=eq.${entity_id}`;
    if (due_before) path += `&due_date=lte.${due_before}`;

    path += paginationParams({ ...req.query, order: req.query.order || 'due_date.asc.nullslast,priority.asc,created_at.desc' });

    const result = await opsQuery('GET', path);
    return res.status(200).json({ actions: result.data || [], count: result.count });
  }

  // POST — create action
  if (req.method === 'POST') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }

    const { title, description, action_type, priority, assigned_to, due_date,
            visibility, entity_id, domain, source_type, external_id, external_url, metadata } = req.body || {};

    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!action_type || !isValidEnum(action_type, ACTION_TYPES)) {
      return res.status(400).json({ error: `action_type must be one of: ${ACTION_TYPES.join(', ')}` });
    }

    const action = {
      workspace_id: workspaceId,
      created_by: user.id,
      owner_id: user.id,
      assigned_to: assigned_to || user.id,
      title: title.trim(),
      description: description || null,
      action_type,
      status: 'open',
      priority: isValidEnum(priority, PRIORITIES) ? priority : 'normal',
      due_date: due_date || null,
      visibility: isValidEnum(visibility, VISIBILITY_SCOPES) ? visibility : 'shared',
      entity_id: entity_id || null,
      domain: domain || null,
      source_type: source_type || 'manual',
      external_id: external_id || null,
      external_url: external_url || null,
      metadata: metadata || {}
    };

    const result = await opsQuery('POST', 'action_items', action);
    if (!result.ok) {
      return res.status(result.status).json({ error: 'Failed to create action', detail: result.data });
    }

    const created = Array.isArray(result.data) ? result.data[0] : result.data;

    // Log creation activity
    const activity = buildTransitionActivity({
      user, workspace_id: workspaceId,
      entity_id: entity_id || null,
      category: 'status_change',
      title: `Created action "${title.trim()}"`,
      item_type: 'action', item_id: created.id,
      domain
    });
    await opsQuery('POST', 'activity_events', activity);

    return res.status(201).json({ action: created });
  }

  // PATCH — update/transition
  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });

    // Fetch existing
    const existing = await opsQuery('GET',
      `action_items?id=eq.${id}&workspace_id=eq.${workspaceId}&select=*`
    );
    if (!existing.ok || !existing.data?.length) {
      return res.status(404).json({ error: 'Action item not found' });
    }
    const current = existing.data[0];

    // Check access: owner, assignee, or manager
    const canEdit = current.owner_id === user.id
      || current.assigned_to === user.id
      || !!requireRole(user, 'manager', workspaceId);
    if (!canEdit) {
      return res.status(403).json({ error: 'Cannot edit this action item' });
    }

    const { status, title, description, priority, assigned_to, due_date,
            visibility, entity_id, tags, metadata } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };

    // Status transition with lifecycle validation
    if (status && status !== current.status) {
      if (!canTransitionAction(current.status, status)) {
        return res.status(400).json({
          error: `Cannot transition from "${current.status}" to "${status}"`
        });
      }
      updates.status = status;
      if (status === 'completed') updates.completed_at = new Date().toISOString();
      if (status === 'open' && current.completed_at) updates.completed_at = null;

      // Log transition activity
      const effects = actionTransitionEffects(current.status, status, current);
      for (const effect of effects) {
        const activity = buildTransitionActivity({
          user, workspace_id: workspaceId,
          entity_id: current.entity_id,
          category: effect.activity_category,
          title: effect.activity_title,
          item_type: 'action', item_id: id,
          domain: current.domain
        });
        await opsQuery('POST', 'activity_events', activity);
      }
    }

    // Assignment change — log it
    if (assigned_to !== undefined && assigned_to !== current.assigned_to) {
      updates.assigned_to = assigned_to;
      const activity = buildTransitionActivity({
        user, workspace_id: workspaceId,
        entity_id: current.entity_id,
        category: 'assignment',
        title: `Reassigned "${current.title}"`,
        item_type: 'action', item_id: id,
        domain: current.domain
      });
      await opsQuery('POST', 'activity_events', activity);
    }

    if (title) updates.title = title.trim();
    if (description !== undefined) updates.description = description;
    if (priority && isValidEnum(priority, PRIORITIES)) updates.priority = priority;
    if (due_date !== undefined) updates.due_date = due_date;
    if (visibility && isValidEnum(visibility, VISIBILITY_SCOPES)) updates.visibility = visibility;
    if (entity_id !== undefined) updates.entity_id = entity_id;
    if (tags !== undefined) updates.tags = tags;
    if (metadata !== undefined) updates.metadata = metadata;

    const result = await opsQuery('PATCH',
      `action_items?id=eq.${id}&workspace_id=eq.${workspaceId}`,
      updates
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update action' });

    return res.status(200).json({ action: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
});
