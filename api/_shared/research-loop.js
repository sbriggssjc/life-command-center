import { opsQuery, pgFilterVal } from './ops-db.js';
import { canTransitionResearch } from './lifecycle.js';
import { ensureEntityLink } from './entity-link.js';

function unwrap(result) {
  return Array.isArray(result?.data) ? result.data[0] : result?.data;
}

async function fetchResearchTaskById(researchTaskId, workspaceId) {
  const result = await opsQuery('GET',
    `research_tasks?id=eq.${pgFilterVal(researchTaskId)}&workspace_id=eq.${workspaceId}&select=*&limit=1`
  );
  return result.ok && result.data?.length ? result.data[0] : null;
}

async function resolveResearchTask({
  workspaceId,
  userId,
  researchTaskId,
  sourceRecordId,
  sourceTable,
  researchType,
  domain,
  entityId,
  title,
  instructions,
  metadata
}) {
  if (researchTaskId) {
    const existing = await fetchResearchTaskById(researchTaskId, workspaceId);
    if (existing) return { task: existing, created: false };
  }

  if (sourceRecordId && researchType && domain) {
    let path = `research_tasks?workspace_id=eq.${workspaceId}&research_type=eq.${pgFilterVal(researchType)}&domain=eq.${pgFilterVal(domain)}&source_record_id=eq.${pgFilterVal(sourceRecordId)}&select=*&order=created_at.desc&limit=1`;
    if (sourceTable) path += `&source_table=eq.${pgFilterVal(sourceTable)}`;
    const existing = await opsQuery('GET', path);
    if (existing.ok && existing.data?.length) {
      return { task: existing.data[0], created: false };
    }
  }

  if (!researchType || !domain) {
    return { task: null, created: false };
  }

  const createRes = await opsQuery('POST', 'research_tasks', {
    workspace_id: workspaceId,
    assigned_to: userId || null,
    created_by: userId || null,
    research_type: researchType,
    title: title || `Research: ${researchType}${sourceRecordId ? ` (${sourceRecordId})` : ''}`,
    instructions: instructions || null,
    entity_id: entityId || null,
    domain,
    status: 'in_progress',
    source_record_id: sourceRecordId || null,
    source_table: sourceTable || null,
    metadata: metadata || {}
  });

  return { task: unwrap(createRes), created: true };
}

async function logResearchActivity({ workspaceId, userId, entityId, domain, sourceType, title, body, metadata, actionItemId }) {
  return opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId,
    actor_id: userId,
    category: 'research',
    title,
    body: body || null,
    entity_id: entityId || null,
    action_item_id: actionItemId || null,
    source_type: sourceType || 'system',
    domain: domain || null,
    visibility: 'shared',
    metadata: metadata || {},
    occurred_at: new Date().toISOString()
  });
}

export async function closeResearchLoop({
  workspaceId,
  user,
  researchTaskId,
  sourceSystem,
  sourceType,
  sourceRecordId,
  sourceTable,
  externalId,
  externalUrl,
  researchType,
  domain,
  entityId,
  entitySeedFields,
  title,
  instructions,
  outcome,
  notes,
  followupTitle,
  followupDescription,
  followupType,
  followupPriority,
  followupAssignee,
  followupDue,
  activityMetadata = {},
  researchMetadata = {}
}) {
  let resolvedEntityId = entityId || null;
  let entityResult = null;

  if (sourceSystem && sourceType && (externalId || sourceRecordId || entitySeedFields?.name || entitySeedFields?.address)) {
    entityResult = await ensureEntityLink({
      workspaceId,
      userId: user.id,
      sourceSystem,
      sourceType,
      externalId: externalId || sourceRecordId,
      externalUrl,
      domain,
      entityId,
      seedFields: entitySeedFields || {},
      metadata: researchMetadata
    });
    if (!entityResult.ok) {
      return { ok: false, status: 500, error: entityResult.error, detail: entityResult.detail };
    }
    resolvedEntityId = entityResult.entityId;
  }

  const taskResult = await resolveResearchTask({
    workspaceId,
    userId: user.id,
    researchTaskId,
    sourceRecordId: sourceRecordId || externalId,
    sourceTable,
    researchType,
    domain,
    entityId: resolvedEntityId,
    title,
    instructions,
    metadata: researchMetadata
  });

  const task = taskResult.task;
  if (!task) {
    return { ok: false, status: 400, error: 'Could not resolve or create research task' };
  }

  const taskUpdates = {
    entity_id: resolvedEntityId || task.entity_id || null,
    outcome: typeof outcome === 'object'
      ? { ...outcome, notes: notes || outcome.notes || null }
      : { status: outcome || 'completed', notes: notes || null, metadata: researchMetadata },
    updated_at: new Date().toISOString()
  };

  if (task.status !== 'completed') {
    if (task.status !== 'in_progress' && canTransitionResearch(task.status, 'in_progress')) {
      await opsQuery('PATCH', `research_tasks?id=eq.${task.id}`, {
        status: 'in_progress',
        updated_at: new Date().toISOString()
      });
    }
    taskUpdates.status = 'completed';
    taskUpdates.completed_at = new Date().toISOString();
  }

  const patchTask = await opsQuery('PATCH', `research_tasks?id=eq.${task.id}`, taskUpdates);
  if (!patchTask.ok) {
    return { ok: false, status: patchTask.status, error: 'Failed to update research task', detail: patchTask.data };
  }

  let followupAction = null;
  if (followupTitle) {
    const actionRes = await opsQuery('POST', 'action_items', {
      workspace_id: workspaceId,
      created_by: user.id,
      owner_id: user.id,
      assigned_to: followupAssignee || user.id,
      title: followupTitle,
      description: followupDescription || `Follow-up from research: ${task.title}`,
      action_type: followupType || 'follow_up',
      status: 'open',
      priority: followupPriority || 'normal',
      due_date: followupDue || null,
      visibility: 'shared',
      entity_id: resolvedEntityId || null,
      domain: domain || task.domain || null,
      source_type: 'research',
      metadata: { research_task_id: task.id, research_type: task.research_type || researchType, ...researchMetadata }
    });
    if (actionRes.ok) {
      followupAction = unwrap(actionRes);
    }
  }

  await logResearchActivity({
    workspaceId,
    userId: user.id,
    entityId: resolvedEntityId || task.entity_id,
    domain: domain || task.domain,
    sourceType: sourceSystem || 'system',
    title: `Completed research "${task.title}"${followupAction ? ' and created follow-up' : ''}`,
    body: notes || null,
    metadata: {
      research_task_id: task.id,
      research_type: task.research_type || researchType,
      outcome: typeof outcome === 'string' ? outcome : outcome?.status || 'completed',
      source_record_id: sourceRecordId || externalId || null,
      source_table: sourceTable || null,
      ...activityMetadata
    },
    actionItemId: followupAction?.id || null
  });

  return {
    ok: true,
    researchTask: unwrap(patchTask),
    followupAction,
    entity: entityResult?.entity || null,
    createdResearchTask: taskResult.created
  };
}
