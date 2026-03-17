// ============================================================================
// Inbox Items API — Triage, promote, assign, dismiss
// Life Command Center — Phase 2
//
// GET    /api/inbox                     — list inbox items (filterable)
// GET    /api/inbox?id=<uuid>           — get single item
// POST   /api/inbox                     — create inbox item
// PATCH  /api/inbox?id=<uuid>           — update/transition inbox item
// POST   /api/inbox?action=promote&id=  — promote to action item
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, paginationParams, requireOps, withErrorHandler } from './_shared/ops-db.js';
import {
  canTransitionInbox, inboxTransitionEffects, buildTransitionActivity,
  INBOX_TRANSITIONS, PRIORITIES, VISIBILITY_SCOPES, INBOX_SOURCE_TYPES, isValidEnum
} from './_shared/lifecycle.js';

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const membership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

  // GET
  if (req.method === 'GET') {
    const { id, status, source_type, assigned_to, priority, domain } = req.query;

    if (id) {
      const result = await opsQuery('GET',
        `inbox_items?id=eq.${id}&workspace_id=eq.${workspaceId}&select=*`
      );
      if (!result.ok || !result.data?.length) {
        return res.status(404).json({ error: 'Inbox item not found' });
      }
      return res.status(200).json({ item: result.data[0] });
    }

    // List with filters — use the triage view for enriched data
    let path = `v_inbox_triage?workspace_id=eq.${workspaceId}`;
    if (status) path += `&status=eq.${status}`;
    if (source_type) path += `&source_type=eq.${source_type}`;
    if (assigned_to) path += `&assigned_to=eq.${assigned_to}`;
    if (priority) path += `&priority=eq.${priority}`;
    if (domain) path += `&domain=eq.${domain}`;
    path += paginationParams({ ...req.query, order: req.query.order || 'received_at.desc' });

    const result = await opsQuery('GET', path);
    return res.status(200).json({ items: result.data || [], count: result.count });
  }

  // POST
  if (req.method === 'POST') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }

    // Promote to action item
    if (req.query.action === 'promote' && req.query.id) {
      return await promoteToAction(req, res, user, workspaceId);
    }

    // Create inbox item
    const { title, body, source_type, priority, entity_id, domain, visibility,
            external_id, external_url, metadata, assigned_to, source_connector_id } = req.body || {};

    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!source_type) return res.status(400).json({ error: 'source_type is required' });

    const item = {
      workspace_id: workspaceId,
      source_user_id: user.id,
      title: title.trim(),
      body: body || null,
      source_type,
      status: 'new',
      priority: isValidEnum(priority, PRIORITIES) ? priority : 'normal',
      visibility: isValidEnum(visibility, VISIBILITY_SCOPES) ? visibility : 'private',
      entity_id: entity_id || null,
      domain: domain || null,
      external_id: external_id || null,
      external_url: external_url || null,
      source_connector_id: source_connector_id || null,
      assigned_to: assigned_to || null,
      metadata: metadata || {},
      received_at: new Date().toISOString()
    };

    const result = await opsQuery('POST', 'inbox_items', item);
    if (!result.ok) {
      return res.status(result.status).json({ error: 'Failed to create inbox item', detail: result.data });
    }

    return res.status(201).json({ item: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  // PATCH — update/transition
  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });

    // Fetch existing
    const existing = await opsQuery('GET',
      `inbox_items?id=eq.${id}&workspace_id=eq.${workspaceId}&select=*`
    );
    if (!existing.ok || !existing.data?.length) {
      return res.status(404).json({ error: 'Inbox item not found' });
    }
    const current = existing.data[0];

    // Check access: source user, assignee, or manager
    const canEdit = current.source_user_id === user.id
      || current.assigned_to === user.id
      || !!requireRole(user, 'manager', workspaceId);
    if (!canEdit) {
      return res.status(403).json({ error: 'Cannot edit this inbox item' });
    }

    const { status, priority, assigned_to, visibility, entity_id, tags, metadata } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };

    // Status transition with validation
    if (status && status !== current.status) {
      if (!canTransitionInbox(current.status, status)) {
        return res.status(400).json({
          error: `Cannot transition from "${current.status}" to "${status}"`,
          allowed: (INBOX_TRANSITIONS[current.status] || [])
        });
      }
      updates.status = status;
      if (status === 'triaged') updates.triaged_at = new Date().toISOString();

      // Log activity for transition
      const effects = inboxTransitionEffects(current.status, status, current);
      for (const effect of effects) {
        if (effect.action === 'log_activity') {
          const activity = buildTransitionActivity({
            user, workspace_id: workspaceId,
            entity_id: current.entity_id,
            category: effect.activity_category,
            title: effect.activity_title,
            item_type: 'inbox', item_id: id,
            domain: current.domain
          });
          await opsQuery('POST', 'activity_events', activity);
        }
      }
    }

    if (priority && isValidEnum(priority, PRIORITIES)) updates.priority = priority;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to;
    if (visibility && isValidEnum(visibility, VISIBILITY_SCOPES)) updates.visibility = visibility;
    if (entity_id !== undefined) updates.entity_id = entity_id;
    if (tags !== undefined) updates.tags = tags;
    if (metadata !== undefined) updates.metadata = metadata;

    const result = await opsQuery('PATCH',
      `inbox_items?id=eq.${id}&workspace_id=eq.${workspaceId}`,
      updates
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update inbox item' });

    return res.status(200).json({ item: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
});

/**
 * Promote an inbox item to an action item.
 * Creates the action, transitions inbox to 'promoted', logs activity.
 */
async function promoteToAction(req, res, user, workspaceId) {
  const inboxId = req.query.id;

  // Fetch inbox item
  const existing = await opsQuery('GET',
    `inbox_items?id=eq.${inboxId}&workspace_id=eq.${workspaceId}&select=*`
  );
  if (!existing.ok || !existing.data?.length) {
    return res.status(404).json({ error: 'Inbox item not found' });
  }
  const inbox = existing.data[0];

  if (inbox.status === 'promoted') {
    return res.status(400).json({ error: 'This inbox item has already been promoted' });
  }
  if (!canTransitionInbox(inbox.status, 'promoted')) {
    return res.status(400).json({ error: `Cannot promote from status "${inbox.status}". Triage first.` });
  }

  // Get overrides from request body
  const { action_type, title, description, priority, assigned_to, due_date, visibility } = req.body || {};

  // Create action item
  const action = {
    workspace_id: workspaceId,
    created_by: user.id,
    owner_id: user.id,
    assigned_to: assigned_to || inbox.assigned_to || user.id,
    title: title || inbox.title,
    description: description || inbox.body,
    action_type: action_type || 'follow_up',
    status: 'open',
    priority: priority || inbox.priority || 'normal',
    due_date: due_date || null,
    visibility: visibility || 'shared',
    entity_id: inbox.entity_id,
    inbox_item_id: inboxId,
    domain: inbox.domain,
    source_type: 'inbox_promotion',
    source_connector_id: inbox.source_connector_id,
    external_id: inbox.external_id,
    external_url: inbox.external_url
  };

  const actionResult = await opsQuery('POST', 'action_items', action);
  if (!actionResult.ok) {
    return res.status(actionResult.status).json({ error: 'Failed to create action item', detail: actionResult.data });
  }

  const createdAction = Array.isArray(actionResult.data) ? actionResult.data[0] : actionResult.data;

  // Transition inbox item to promoted
  await opsQuery('PATCH',
    `inbox_items?id=eq.${inboxId}&workspace_id=eq.${workspaceId}`,
    { status: 'promoted', updated_at: new Date().toISOString() }
  );

  // Log activity
  const activity = buildTransitionActivity({
    user, workspace_id: workspaceId,
    entity_id: inbox.entity_id,
    category: 'status_change',
    title: `Promoted "${inbox.title}" from inbox to action`,
    item_type: 'action', item_id: createdAction.id,
    domain: inbox.domain
  });
  await opsQuery('POST', 'activity_events', activity);

  return res.status(201).json({
    action: createdAction,
    inbox_status: 'promoted'
  });
}
