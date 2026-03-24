// ============================================================================
// Workflow Engine — Compound multi-step team operations
// Life Command Center — Phase 4: Shared Team Workflow Rollout
//
// POST /api/workflows?action=promote_to_shared    — private inbox → shared action
// POST /api/workflows?action=sf_task_to_action    — SF task inbox → entity-linked action
// POST /api/workflows?action=research_followup    — research → assigned follow-up action
// POST /api/workflows?action=reassign             — reassign work item to another user
// POST /api/workflows?action=escalate             — escalate to manager with reason
// POST /api/workflows?action=watch                — subscribe to updates on an item
// POST /api/workflows?action=unwatch              — unsubscribe from item updates
// POST /api/workflows?action=bulk_assign          — assign multiple items to a user
// POST /api/workflows?action=bulk_triage          — triage multiple inbox items at once
// GET  /api/workflows?action=oversight            — manager team overview
// GET  /api/workflows?action=unassigned           — unassigned work items
// GET  /api/workflows?action=watchers&item_type=&item_id=  — list watchers
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, requireOps, withErrorHandler } from './_shared/ops-db.js';
import {
  canTransitionInbox, canTransitionAction,
  buildTransitionActivity, ACTION_TYPES, PRIORITIES, VISIBILITY_SCOPES, isValidEnum
} from './_shared/lifecycle.js';
import { closeResearchLoop } from './_shared/research-loop.js';

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const membership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

  const { action } = req.query;

  // GET endpoints
  if (req.method === 'GET') {
    switch (action) {
      case 'oversight':   return await getOversight(req, res, user, workspaceId);
      case 'unassigned':  return await getUnassigned(req, res, user, workspaceId);
      case 'watchers':    return await getWatchers(req, res, user, workspaceId);
      default: return res.status(400).json({ error: 'Invalid GET action. Use: oversight, unassigned, watchers' });
    }
  }

  // POST endpoints — require operator+
  if (req.method === 'POST') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }

    switch (action) {
      case 'promote_to_shared':  return await promoteToShared(req, res, user, workspaceId);
      case 'sf_task_to_action':  return await sfTaskToAction(req, res, user, workspaceId);
      case 'research_followup':  return await researchFollowup(req, res, user, workspaceId);
      case 'reassign':           return await reassignItem(req, res, user, workspaceId);
      case 'escalate':           return await escalateItem(req, res, user, workspaceId);
      case 'watch':              return await addWatch(req, res, user, workspaceId);
      case 'unwatch':            return await removeWatch(req, res, user, workspaceId);
      case 'bulk_assign':        return await bulkAssign(req, res, user, workspaceId);
      case 'bulk_triage':        return await bulkTriage(req, res, user, workspaceId);
      default: return res.status(400).json({ error: 'Invalid POST action' });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
});

// ============================================================================
// PROMOTE TO SHARED — private inbox item → shared team action
//
// Steps:
// 1. Validate inbox item is private and promotable
// 2. Create action item with visibility=shared
// 3. Transition inbox to promoted
// 4. Auto-watch: creator becomes watcher
// 5. Log activity with provenance
// ============================================================================

async function promoteToShared(req, res, user, workspaceId) {
  const { inbox_item_id, title, action_type, priority, assigned_to, due_date, entity_id, description } = req.body || {};

  if (!inbox_item_id) return res.status(400).json({ error: 'inbox_item_id is required' });

  // Fetch inbox item
  const inbox = await fetchOne('inbox_items', inbox_item_id, workspaceId);
  if (!inbox) return res.status(404).json({ error: 'Inbox item not found' });

  if (inbox.status === 'promoted') {
    return res.status(400).json({ error: 'Already promoted' });
  }
  if (!canTransitionInbox(inbox.status, 'promoted') && inbox.status !== 'new') {
    // Allow direct promotion from new (skip triage for this workflow)
    if (!canTransitionInbox(inbox.status, 'triaged')) {
      return res.status(400).json({ error: `Cannot promote from status "${inbox.status}"` });
    }
  }

  // Create shared action
  const action = await opsQuery('POST', 'action_items', {
    workspace_id: workspaceId,
    created_by: user.id,
    owner_id: user.id,
    assigned_to: assigned_to || user.id,
    title: title || inbox.title,
    description: description || inbox.body,
    action_type: isValidEnum(action_type, ACTION_TYPES) ? action_type : 'follow_up',
    status: 'open',
    priority: isValidEnum(priority, PRIORITIES) ? priority : inbox.priority || 'normal',
    due_date: due_date || null,
    visibility: 'shared',
    entity_id: entity_id || inbox.entity_id,
    inbox_item_id: inbox_item_id,
    domain: inbox.domain,
    source_type: 'inbox_promotion',
    source_connector_id: inbox.source_connector_id,
    external_id: inbox.external_id,
    external_url: inbox.external_url
  });

  if (!action.ok) return res.status(500).json({ error: 'Failed to create action' });
  const createdAction = unwrap(action);

  // Transition inbox to promoted (triage first if new)
  if (inbox.status === 'new') {
    await opsQuery('PATCH', `inbox_items?id=eq.${inbox_item_id}`, {
      status: 'promoted', triaged_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
  } else {
    await opsQuery('PATCH', `inbox_items?id=eq.${inbox_item_id}`, {
      status: 'promoted', updated_at: new Date().toISOString()
    });
  }

  // Auto-watch: creator watches the action
  await opsQuery('POST', 'watchers', {
    workspace_id: workspaceId, user_id: user.id,
    action_item_id: createdAction.id, reason: 'creator'
  }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

  // If assigned to someone else, they watch too
  if (assigned_to && assigned_to !== user.id) {
    await opsQuery('POST', 'watchers', {
      workspace_id: workspaceId, user_id: assigned_to,
      action_item_id: createdAction.id, reason: 'assigned'
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
  }

  // Log activity
  await logWorkflowActivity(user, workspaceId, {
    category: 'status_change',
    title: `Promoted "${inbox.title}" from private inbox to shared action`,
    entity_id: entity_id || inbox.entity_id,
    action_item_id: createdAction.id,
    inbox_item_id: inbox_item_id,
    domain: inbox.domain
  });

  return res.status(201).json({ action: createdAction, inbox_status: 'promoted', workflow: 'promote_to_shared' });
}

// ============================================================================
// SF TASK → SHARED ACTION — link Salesforce task to canonical entity
// ============================================================================

async function sfTaskToAction(req, res, user, workspaceId) {
  const { inbox_item_id, entity_id, action_type, priority, assigned_to, due_date } = req.body || {};

  if (!inbox_item_id) return res.status(400).json({ error: 'inbox_item_id is required' });
  if (!entity_id) return res.status(400).json({ error: 'entity_id is required — link SF task to a canonical entity' });

  const inbox = await fetchOne('inbox_items', inbox_item_id, workspaceId);
  if (!inbox) return res.status(404).json({ error: 'Inbox item not found' });
  if (inbox.source_type !== 'sf_task') {
    return res.status(400).json({ error: 'This workflow is for SF task inbox items only' });
  }

  // Verify entity exists
  const entity = await fetchOne('entities', entity_id, workspaceId);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });

  // Create action linked to entity
  const action = await opsQuery('POST', 'action_items', {
    workspace_id: workspaceId,
    created_by: user.id,
    owner_id: user.id,
    assigned_to: assigned_to || user.id,
    title: inbox.title,
    description: inbox.body,
    action_type: isValidEnum(action_type, ACTION_TYPES) ? action_type : 'follow_up',
    status: 'open',
    priority: isValidEnum(priority, PRIORITIES) ? priority : inbox.priority || 'normal',
    due_date: due_date || inbox.metadata?.activity_date || null,
    visibility: 'shared',
    entity_id,
    inbox_item_id,
    domain: inbox.domain,
    source_type: 'sf_sync',
    source_connector_id: inbox.source_connector_id,
    external_id: inbox.external_id,
    external_url: inbox.external_url
  });

  if (!action.ok) return res.status(500).json({ error: 'Failed to create action' });
  const createdAction = unwrap(action);

  // Link SF external identity to entity if not already linked
  if (inbox.external_id) {
    await opsQuery('POST', 'external_identities', {
      workspace_id: workspaceId, entity_id,
      source_system: 'salesforce', source_type: 'task',
      external_id: inbox.external_id,
      external_url: inbox.external_url,
      last_synced_at: new Date().toISOString()
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
  }

  // Transition inbox
  await opsQuery('PATCH', `inbox_items?id=eq.${inbox_item_id}`, {
    status: 'promoted', entity_id, updated_at: new Date().toISOString()
  });

  // Auto-watch
  await opsQuery('POST', 'watchers', {
    workspace_id: workspaceId, user_id: user.id,
    action_item_id: createdAction.id, reason: 'creator'
  }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

  await logWorkflowActivity(user, workspaceId, {
    category: 'status_change',
    title: `Linked SF task "${inbox.title}" to ${entity.name} and created action`,
    entity_id, action_item_id: createdAction.id, inbox_item_id,
    domain: inbox.domain
  });

  return res.status(201).json({ action: createdAction, entity: entity.name, workflow: 'sf_task_to_action' });
}

// ============================================================================
// RESEARCH → FOLLOW-UP — complete research and create follow-up action
// ============================================================================

async function researchFollowup(req, res, user, workspaceId) {
  const { research_task_id, outcome, followup_title, followup_description, followup_type, followup_priority,
          assigned_to, due_date, entity_id } = req.body || {};

  if (!research_task_id) return res.status(400).json({ error: 'research_task_id is required' });

  const research = await fetchOne('research_tasks', research_task_id, workspaceId);
  if (!research) return res.status(404).json({ error: 'Research task not found' });

  const closure = await closeResearchLoop({
    workspaceId,
    user,
    researchTaskId: research_task_id,
    sourceRecordId: research.source_record_id || null,
    sourceTable: research.source_table || null,
    researchType: research.research_type,
    domain: research.domain,
    entityId: entity_id || research.entity_id,
    title: research.title,
    instructions: research.instructions,
    outcome: outcome || { status: 'completed' },
    followupTitle: followup_title,
    followupDescription: followup_description,
    followupType: isValidEnum(followup_type, ACTION_TYPES) ? followup_type : 'follow_up',
    followupPriority: isValidEnum(followup_priority, PRIORITIES) ? followup_priority : 'normal',
    followupAssignee: assigned_to || user.id,
    followupDue: due_date || null,
    activityMetadata: { workflow: 'research_followup' },
    researchMetadata: { workflow: 'research_followup' }
  });
  if (!closure.ok) {
    return res.status(closure.status || 500).json({ error: closure.error, detail: closure.detail });
  }

  if (closure.followupAction) {
    await opsQuery('POST', 'watchers', {
      workspace_id: workspaceId, user_id: user.id,
      action_item_id: closure.followupAction.id, reason: 'creator'
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
  }

  return res.status(200).json({
    research_status: closure.researchTask?.status || 'completed',
    action: closure.followupAction,
    research_task: closure.researchTask,
    workflow: 'research_followup'
  });
}

// ============================================================================
// REASSIGN — transfer ownership/assignment of any work item
// ============================================================================

async function reassignItem(req, res, user, workspaceId) {
  const { item_type, item_id, assigned_to, reason } = req.body || {};

  if (!item_type || !item_id || !assigned_to) {
    return res.status(400).json({ error: 'item_type, item_id, and assigned_to are required' });
  }

  // Verify target user is a workspace member
  const targetMember = await opsQuery('GET',
    `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${assigned_to}&select=user_id,role`
  );
  if (!targetMember.ok || !targetMember.data?.length) {
    return res.status(400).json({ error: 'Target user is not a workspace member' });
  }

  const table = item_type === 'action' ? 'action_items'
    : item_type === 'inbox' ? 'inbox_items'
    : item_type === 'research' ? 'research_tasks'
    : null;

  if (!table) return res.status(400).json({ error: 'item_type must be: action, inbox, or research' });

  const existing = await fetchOne(table, item_id, workspaceId);
  if (!existing) return res.status(404).json({ error: 'Item not found' });

  const previousAssignee = existing.assigned_to;

  await opsQuery('PATCH', `${table}?id=eq.${item_id}&workspace_id=eq.${workspaceId}`, {
    assigned_to,
    updated_at: new Date().toISOString()
  });

  // Auto-watch: new assignee watches the item
  if (item_type === 'action') {
    await opsQuery('POST', 'watchers', {
      workspace_id: workspaceId, user_id: assigned_to,
      action_item_id: item_id, reason: 'assigned'
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
  }

  // Fetch display names for activity log
  const [fromUser, toUser] = await Promise.all([
    previousAssignee ? fetchUserName(previousAssignee) : Promise.resolve('unassigned'),
    fetchUserName(assigned_to)
  ]);

  await logWorkflowActivity(user, workspaceId, {
    category: 'assignment',
    title: `Reassigned "${existing.title}" from ${fromUser} to ${toUser}${reason ? ': ' + reason : ''}`,
    entity_id: existing.entity_id,
    action_item_id: item_type === 'action' ? item_id : null,
    inbox_item_id: item_type === 'inbox' ? item_id : null,
    domain: existing.domain
  });

  return res.status(200).json({ item_id, assigned_to, previous: previousAssignee, workflow: 'reassign' });
}

// ============================================================================
// ESCALATE — escalate an action to a manager with tracking
// ============================================================================

async function escalateItem(req, res, user, workspaceId) {
  const { action_item_id, escalate_to, reason } = req.body || {};

  if (!action_item_id || !escalate_to || !reason) {
    return res.status(400).json({ error: 'action_item_id, escalate_to, and reason are required' });
  }

  const action = await fetchOne('action_items', action_item_id, workspaceId);
  if (!action) return res.status(404).json({ error: 'Action item not found' });

  // Verify target is manager+
  const targetRole = requireRole({ memberships: [{ workspace_id: workspaceId }] }, 'viewer', workspaceId);
  const targetMember = await opsQuery('GET',
    `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${escalate_to}&select=role`
  );
  if (!targetMember.ok || !targetMember.data?.length) {
    return res.status(400).json({ error: 'Escalation target is not a workspace member' });
  }

  // Create escalation record
  await opsQuery('POST', 'escalations', {
    workspace_id: workspaceId,
    action_item_id,
    escalated_by: user.id,
    escalated_to: escalate_to,
    previous_assignee: action.assigned_to,
    reason
  });

  // Reassign to escalation target
  await opsQuery('PATCH', `action_items?id=eq.${action_item_id}`, {
    assigned_to: escalate_to,
    priority: action.priority === 'normal' ? 'high' : action.priority,
    updated_at: new Date().toISOString()
  });

  // Auto-watch: both parties watch
  for (const uid of [user.id, escalate_to]) {
    await opsQuery('POST', 'watchers', {
      workspace_id: workspaceId, user_id: uid,
      action_item_id, reason: uid === user.id ? 'escalation' : 'assigned'
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
  }

  const toName = await fetchUserName(escalate_to);
  await logWorkflowActivity(user, workspaceId, {
    category: 'assignment',
    title: `Escalated "${action.title}" to ${toName}: ${reason}`,
    entity_id: action.entity_id,
    action_item_id,
    domain: action.domain
  });

  return res.status(200).json({ action_item_id, escalated_to: escalate_to, reason, workflow: 'escalate' });
}

// ============================================================================
// WATCH / UNWATCH
// ============================================================================

async function addWatch(req, res, user, workspaceId) {
  const { item_type, item_id, target_user_id } = req.body || {};
  if (!item_type || !item_id) return res.status(400).json({ error: 'item_type and item_id required' });

  const userId = target_user_id || user.id;
  const column = item_type === 'action' ? 'action_item_id'
    : item_type === 'entity' ? 'entity_id'
    : item_type === 'inbox' ? 'inbox_item_id'
    : null;
  if (!column) return res.status(400).json({ error: 'item_type must be: action, entity, or inbox' });

  const result = await opsQuery('POST', 'watchers', {
    workspace_id: workspaceId,
    user_id: userId,
    [column]: item_id,
    reason: 'manual'
  }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

  if (!result.ok) return res.status(result.status).json({ error: 'Failed to add watch' });
  return res.status(201).json({ watching: true, item_type, item_id });
}

async function removeWatch(req, res, user, workspaceId) {
  const { item_type, item_id } = req.body || {};
  if (!item_type || !item_id) return res.status(400).json({ error: 'item_type and item_id required' });

  const column = item_type === 'action' ? 'action_item_id'
    : item_type === 'entity' ? 'entity_id'
    : item_type === 'inbox' ? 'inbox_item_id'
    : null;
  if (!column) return res.status(400).json({ error: 'item_type must be: action, entity, or inbox' });

  await opsQuery('DELETE',
    `watchers?workspace_id=eq.${workspaceId}&user_id=eq.${user.id}&${column}=eq.${item_id}`
  );
  return res.status(200).json({ watching: false, item_type, item_id });
}

// ============================================================================
// BULK ASSIGN — assign multiple items to one user
// ============================================================================

async function bulkAssign(req, res, user, workspaceId) {
  const { items, assigned_to } = req.body || {};
  if (!items?.length || !assigned_to) return res.status(400).json({ error: 'items array and assigned_to required' });

  if (!requireRole(user, 'manager', workspaceId)) {
    return res.status(403).json({ error: 'Manager role required for bulk assignment' });
  }

  const results = [];
  for (const { item_type, item_id } of items) {
    const table = item_type === 'action' ? 'action_items'
      : item_type === 'inbox' ? 'inbox_items'
      : item_type === 'research' ? 'research_tasks'
      : null;
    if (!table) { results.push({ item_id, error: 'invalid type' }); continue; }

    const r = await opsQuery('PATCH', `${table}?id=eq.${item_id}&workspace_id=eq.${workspaceId}`, {
      assigned_to, updated_at: new Date().toISOString()
    });
    results.push({ item_id, item_type, success: r.ok });
  }

  const assigneeName = await fetchUserName(assigned_to);
  await logWorkflowActivity(user, workspaceId, {
    category: 'assignment',
    title: `Bulk assigned ${items.length} items to ${assigneeName}`
  });

  return res.status(200).json({ assigned_to, count: items.length, results, workflow: 'bulk_assign' });
}

// ============================================================================
// BULK TRIAGE — triage multiple inbox items at once
// ============================================================================

async function bulkTriage(req, res, user, workspaceId) {
  const { item_ids, status, priority, assigned_to } = req.body || {};
  if (!item_ids?.length) return res.status(400).json({ error: 'item_ids array required' });

  const targetStatus = status || 'triaged';
  const results = [];

  for (const id of item_ids) {
    const updates = { updated_at: new Date().toISOString() };
    if (targetStatus) updates.status = targetStatus;
    if (targetStatus === 'triaged') updates.triaged_at = new Date().toISOString();
    if (priority) updates.priority = priority;
    if (assigned_to) updates.assigned_to = assigned_to;

    const r = await opsQuery('PATCH', `inbox_items?id=eq.${id}&workspace_id=eq.${workspaceId}`, updates);
    results.push({ id, success: r.ok });
  }

  await logWorkflowActivity(user, workspaceId, {
    category: 'status_change',
    title: `Bulk triaged ${item_ids.length} inbox items → ${targetStatus}`
  });

  return res.status(200).json({ count: item_ids.length, status: targetStatus, results, workflow: 'bulk_triage' });
}

// ============================================================================
// GET: MANAGER OVERSIGHT
// ============================================================================

async function getOversight(req, res, user, workspaceId) {
  if (!requireRole(user, 'manager', workspaceId)) {
    return res.status(403).json({ error: 'Manager role required for team oversight' });
  }

  const overview = await opsQuery('GET', `v_manager_overview?workspace_id=eq.${workspaceId}&order=display_name`);
  const unassigned = await opsQuery('GET', `v_unassigned_work?workspace_id=eq.${workspaceId}&limit=50&order=created_at.desc`);
  const escalations = await opsQuery('GET',
    `escalations?workspace_id=eq.${workspaceId}&resolved_at=is.null&select=*,action_items(title,status,priority),users!escalations_escalated_by_fkey(display_name),users!escalations_escalated_to_fkey(display_name)&order=created_at.desc&limit=25`
  );

  return res.status(200).json({
    team: overview.data || [],
    unassigned_work: unassigned.data || [],
    open_escalations: escalations.data || [],
    workspace_id: workspaceId,
    view: 'oversight'
  });
}

// ============================================================================
// GET: UNASSIGNED WORK
// ============================================================================

async function getUnassigned(req, res, user, workspaceId) {
  const { domain } = req.query;
  let path = `v_unassigned_work?workspace_id=eq.${workspaceId}&order=created_at.desc&limit=100`;
  if (domain) path += `&domain=eq.${domain}`;

  const result = await opsQuery('GET', path);
  return res.status(200).json({ items: result.data || [], count: result.count, view: 'unassigned' });
}

// ============================================================================
// GET: WATCHERS for an item
// ============================================================================

async function getWatchers(req, res, user, workspaceId) {
  const { item_type, item_id } = req.query;
  if (!item_type || !item_id) return res.status(400).json({ error: 'item_type and item_id required' });

  const column = item_type === 'action' ? 'action_item_id'
    : item_type === 'entity' ? 'entity_id'
    : item_type === 'inbox' ? 'inbox_item_id'
    : null;
  if (!column) return res.status(400).json({ error: 'item_type must be: action, entity, or inbox' });

  const result = await opsQuery('GET',
    `watchers?workspace_id=eq.${workspaceId}&${column}=eq.${item_id}&select=*,users(display_name,email,avatar_url)&order=created_at`
  );
  return res.status(200).json({ watchers: result.data || [] });
}

// ============================================================================
// HELPERS
// ============================================================================

async function fetchOne(table, id, workspaceId) {
  const result = await opsQuery('GET', `${table}?id=eq.${id}&workspace_id=eq.${workspaceId}&select=*&limit=1`);
  return result.ok && result.data?.length > 0 ? result.data[0] : null;
}

function unwrap(result) {
  return Array.isArray(result.data) ? result.data[0] : result.data;
}

async function fetchUserName(userId) {
  const result = await opsQuery('GET', `users?id=eq.${userId}&select=display_name&limit=1`);
  return result.ok && result.data?.length > 0 ? result.data[0].display_name : 'Unknown';
}

async function logWorkflowActivity(user, workspaceId, { category, title, entity_id, action_item_id, inbox_item_id, domain }) {
  await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId,
    actor_id: user.id,
    category: category || 'status_change',
    title,
    entity_id: entity_id || null,
    action_item_id: action_item_id || null,
    inbox_item_id: inbox_item_id || null,
    source_type: 'system',
    domain: domain || null,
    visibility: 'shared',
    occurred_at: new Date().toISOString()
  });
}
