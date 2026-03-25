// ============================================================================
// Domain Bridge & Activities API — Consolidated
// Life Command Center
//
// POST /api/bridge?action=log_activity      — log domain activity to canonical timeline
// POST /api/bridge?action=complete_research  — mark research complete + optional follow-up
// POST /api/bridge?action=log_call          — log call activity (SF + canonical)
// POST /api/bridge?action=save_ownership    — ownership save → canonical activity
// POST /api/bridge?action=dismiss_lead      — lead dismissal → canonical activity
// POST /api/bridge?action=update_entity     — sync domain record changes to canonical entity
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, requireOps, withErrorHandler } from './_shared/ops-db.js';
import { closeResearchLoop } from './_shared/research-loop.js';
import { ensureEntityLink, normalizeCanonicalName } from './_shared/entity-link.js';

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  // Dispatch to chat if routed via vercel.json _route=chat
  if (req.query._route === 'chat') {
    return handleChat(req, res);
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  if (!requireRole(user, 'operator', workspaceId)) {
    return res.status(403).json({ error: 'Operator role required' });
  }

  const { action } = req.query;

  switch (action) {
    case 'log_activity':       return await bridgeLogActivity(req, res, user, workspaceId);
    case 'complete_research':  return await bridgeCompleteResearch(req, res, user, workspaceId);
    case 'log_call':           return await bridgeLogCall(req, res, user, workspaceId);
    case 'save_ownership':     return await bridgeSaveOwnership(req, res, user, workspaceId);
    case 'dismiss_lead':       return await bridgeDismissLead(req, res, user, workspaceId);
    case 'update_entity':      return await bridgeUpdateEntity(req, res, user, workspaceId);
    default:
      return res.status(400).json({
        error: `Invalid action. Use: log_activity, complete_research, log_call, save_ownership, dismiss_lead, update_entity`
      });
  }
});

// ============================================================================
// BRIDGE: Generic activity logging for any domain save operation
// ============================================================================

async function bridgeLogActivity(req, res, user, workspaceId) {
  const {
    category,      // 'research', 'note', 'status_change', 'call', 'email'
    title,         // Human-readable title
    body,          // Optional details
    domain,        // 'government' or 'dialysis'
    entity_id,     // Optional canonical entity link
    external_id,   // Optional source system record ID
    source_system, // 'gov_supabase', 'dia_supabase', 'salesforce'
    source_type,
    metadata       // Optional extra data
  } = req.body || {};

  if (!title) return res.status(400).json({ error: 'title is required' });

  // Resolve entity if external_id provided but entity_id not
  let resolvedEntityId = entity_id;
  if (!resolvedEntityId && external_id && source_system) {
    const link = await ensureEntityLink({
      workspaceId,
      userId: user.id,
      sourceSystem: source_system,
      sourceType: source_type || 'asset',
      externalId: external_id,
      domain,
      seedFields: { name: title, metadata }
    });
    if (link.ok) resolvedEntityId = link.entityId;
  }

  // Carry government write service metadata for cross-system traceability
  const activityMetadata = { ...metadata, bridge_source: 'domain_save' };
  if (req.body.gov_change_event_id) activityMetadata.gov_change_event_id = req.body.gov_change_event_id;
  if (req.body.gov_correlation_id) activityMetadata.gov_correlation_id = req.body.gov_correlation_id;
  if (req.body.source_record_id) activityMetadata.source_record_id = req.body.source_record_id;
  if (req.body.source_table) activityMetadata.source_table = req.body.source_table;

  const result = await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId,
    actor_id: user.id,
    category: category || 'note',
    title,
    body: body || null,
    entity_id: resolvedEntityId || null,
    source_type: source_system || 'system',
    domain: domain || null,
    visibility: 'shared',
    metadata: activityMetadata,
    occurred_at: new Date().toISOString()
  });

  if (!result.ok) return res.status(result.status).json({ error: 'Failed to log activity' });

  return res.status(201).json({
    activity: Array.isArray(result.data) ? result.data[0] : result.data,
    entity_id: resolvedEntityId
  });
}

// ============================================================================
// BRIDGE: Research completion → canonical activity + optional follow-up action
// ============================================================================

async function bridgeCompleteResearch(req, res, user, workspaceId) {
  const {
    domain,           // 'government' or 'dialysis'
    research_type,    // 'ownership', 'lease_backfill', 'clinic_lead'
    research_task_id,
    entity_id,
    external_id,
    external_url,
    source_system,
    source_type,
    source_record_id,
    source_table,
    outcome,          // 'completed', 'not_applicable', 'needs_followup'
    notes,
    follow_up_title,  // If outcome === 'needs_followup'
    follow_up_due,
    follow_up_assignee,
    title,
    instructions,
    entity_fields,
    metadata
  } = req.body || {};

  if (!research_type) return res.status(400).json({ error: 'research_type is required' });

  const researchMetadata = { ...(metadata || {}), research_type, outcome, bridge_source: 'research_completion' };
  if (req.body.gov_change_event_id) researchMetadata.gov_change_event_id = req.body.gov_change_event_id;
  if (req.body.gov_correlation_id) researchMetadata.gov_correlation_id = req.body.gov_correlation_id;
  if (source_record_id) researchMetadata.source_record_id = source_record_id;
  if (source_table) researchMetadata.source_table = source_table;

  const closure = await closeResearchLoop({
    workspaceId,
    user,
    researchTaskId: research_task_id,
    sourceSystem: source_system,
    sourceType: source_type || 'asset',
    sourceRecordId: source_record_id || external_id,
    sourceTable: source_table || null,
    externalId: external_id,
    externalUrl: external_url,
    researchType: research_type,
    domain,
    entityId: entity_id,
    entitySeedFields: entity_fields || {},
    title,
    instructions,
    outcome: typeof outcome === 'string' ? { status: outcome } : (outcome || { status: 'completed' }),
    notes,
    followupTitle: outcome === 'needs_followup' ? follow_up_title : (follow_up_title || null),
    followupAssignee: follow_up_assignee,
    followupDue: follow_up_due,
    activityMetadata: researchMetadata,
    researchMetadata
  });

  if (!closure.ok) {
    return res.status(closure.status || 500).json({ error: closure.error, detail: closure.detail });
  }

  return res.status(201).json({
    logged: true,
    entity_id: closure.entity?.id || closure.researchTask?.entity_id || null,
    research_task: closure.researchTask,
    follow_up: closure.followupAction,
    created_research_task: closure.createdResearchTask
  });
}

// ============================================================================
// BRIDGE: Call logging → canonical activity (wraps existing SF log + adds canonical)
// ============================================================================

async function bridgeLogCall(req, res, user, workspaceId) {
  const {
    subject,
    notes,
    outcome,
    domain,
    entity_id,
    external_id,
    source_system,
    source_type,
    sf_contact_id,
    sf_company_id,
    activity_date
  } = req.body || {};

  if (!subject) return res.status(400).json({ error: 'subject is required' });

  let resolvedEntityId = entity_id;
  if (!resolvedEntityId && external_id && source_system) {
    const link = await ensureEntityLink({
      workspaceId,
      userId: user.id,
      sourceSystem: source_system,
      sourceType: source_type || 'asset',
      externalId: external_id,
      domain,
      seedFields: { name: subject, metadata: { sf_contact_id, sf_company_id } }
    });
    if (link.ok) resolvedEntityId = link.entityId;
  }

  const result = await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId,
    actor_id: user.id,
    category: 'call',
    title: subject,
    body: notes || null,
    entity_id: resolvedEntityId || null,
    source_type: 'salesforce',
    domain: domain || null,
    visibility: 'shared',
    metadata: {
      outcome,
      sf_contact_id,
      sf_company_id,
      activity_date: activity_date || new Date().toISOString(),
      bridge_source: 'log_call'
    },
    occurred_at: activity_date || new Date().toISOString()
  });

  if (!result.ok) return res.status(result.status).json({ error: 'Failed to log call' });

  return res.status(201).json({
    activity: Array.isArray(result.data) ? result.data[0] : result.data,
    entity_id: resolvedEntityId
  });
}

// ============================================================================
// BRIDGE: Ownership save → canonical activity
// ============================================================================

async function bridgeSaveOwnership(req, res, user, workspaceId) {
  const {
    domain,
    entity_id,
    external_id,
    source_system,
    owner_name,
    true_owner_name,
    notes
  } = req.body || {};

  let resolvedEntityId = entity_id;
  if (!resolvedEntityId && external_id && source_system) {
    const link = await ensureEntityLink({
      workspaceId,
      userId: user.id,
      sourceSystem: source_system,
      sourceType: req.body.source_type || 'asset',
      externalId: external_id,
      domain,
      seedFields: { name: true_owner_name || owner_name, org_type: 'owner' }
    });
    if (link.ok) resolvedEntityId = link.entityId;
  }

  const title = true_owner_name
    ? `Ownership resolved: ${true_owner_name}${owner_name ? ` (recorded: ${owner_name})` : ''}`
    : `Ownership data saved${owner_name ? `: ${owner_name}` : ''}`;

  // Carry government write service metadata for cross-system traceability
  const ownershipMetadata = { owner_name, true_owner_name, bridge_source: 'ownership_save' };
  if (req.body.gov_change_event_id) ownershipMetadata.gov_change_event_id = req.body.gov_change_event_id;
  if (req.body.gov_correlation_id) ownershipMetadata.gov_correlation_id = req.body.gov_correlation_id;
  if (req.body.source_record_id) ownershipMetadata.source_record_id = req.body.source_record_id;
  if (req.body.source_table) ownershipMetadata.source_table = req.body.source_table;

  await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId,
    actor_id: user.id,
    category: 'research',
    title,
    body: notes || null,
    entity_id: resolvedEntityId || null,
    source_type: source_system || 'system',
    domain: domain || null,
    visibility: 'shared',
    metadata: ownershipMetadata,
    occurred_at: new Date().toISOString()
  });

  return res.status(201).json({ logged: true, entity_id: resolvedEntityId });
}

// ============================================================================
// BRIDGE: Lead dismissal → canonical activity
// ============================================================================

async function bridgeDismissLead(req, res, user, workspaceId) {
  const {
    domain,
    entity_id,
    external_id,
    source_system,
    reason,
    notes
  } = req.body || {};

  let resolvedEntityId = entity_id;
  if (!resolvedEntityId && external_id && source_system) {
    const link = await ensureEntityLink({
      workspaceId,
      userId: user.id,
      sourceSystem: source_system,
      sourceType: req.body.source_type || 'asset',
      externalId: external_id,
      domain,
      seedFields: { name: reason || notes || 'Dismissed lead' }
    });
    if (link.ok) resolvedEntityId = link.entityId;
  }

  await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId,
    actor_id: user.id,
    category: 'status_change',
    title: `Lead dismissed${reason ? ': ' + reason : ''}`,
    body: notes || null,
    entity_id: resolvedEntityId || null,
    source_type: source_system || 'system',
    domain: domain || null,
    visibility: 'shared',
    metadata: { reason, bridge_source: 'lead_dismiss' },
    occurred_at: new Date().toISOString()
  });

  return res.status(201).json({ logged: true, entity_id: resolvedEntityId });
}

// ============================================================================
// BRIDGE: Entity update — sync domain record field changes to canonical entity
// ============================================================================

async function bridgeUpdateEntity(req, res, user, workspaceId) {
  const {
    external_id,
    source_system,
    source_type,
    fields   // { name, address, city, state, phone, email, ... }
  } = req.body || {};

  if (!external_id || !source_system) {
    return res.status(400).json({ error: 'external_id and source_system are required' });
  }

  if (!fields || Object.keys(fields).length === 0) {
    return res.status(200).json({ updated: false, reason: 'No fields to update' });
  }

  const link = await ensureEntityLink({
    workspaceId,
    userId: user.id,
    sourceSystem: source_system,
    sourceType: source_type || 'asset',
    externalId: external_id,
    seedFields: fields,
    metadata: { bridge_source: 'update_entity' }
  });
  if (!link.ok) {
    return res.status(500).json({ error: link.error, detail: link.detail });
  }

  const entityId = link.entityId;

  // Apply field updates to canonical entity
  const allowedFields = ['name', 'description', 'first_name', 'last_name', 'title', 'phone', 'email',
    'org_type', 'address', 'city', 'state', 'zip', 'county', 'latitude', 'longitude', 'asset_type'];

  const updates = { updated_at: new Date().toISOString() };
  let fieldCount = 0;
  for (const f of allowedFields) {
    if (fields[f] !== undefined) {
      updates[f] = fields[f];
      fieldCount++;
    }
  }

  if (fields.name) {
    updates.canonical_name = normalizeCanonicalName(fields.name);
  }

  if (fieldCount === 0) {
    return res.status(200).json({ updated: false, reason: 'No recognized fields to update' });
  }

  const result = await opsQuery('PATCH',
    `entities?id=eq.${entityId}&workspace_id=eq.${workspaceId}`,
    updates
  );

  // Update sync timestamp on external identity
  await opsQuery('PATCH',
    `external_identities?entity_id=eq.${entityId}&source_system=eq.${source_system}&external_id=eq.${external_id}`,
    { last_synced_at: new Date().toISOString() }
  );

  return res.status(200).json({
    updated: true,
    entity_id: entityId,
    fields_updated: fieldCount,
    entity_created: !!link.createdEntity,
    identity_created: !!link.createdIdentity
  });
}

// ============================================================================
// CHAT — AI chat handler (merged from api/chat.js)
// POST /api/chat (routed via vercel.json: /api/chat → /api/bridge?_route=chat)
// ============================================================================
async function handleChat(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const { invokeChatProvider, logAiMetric, normalizeAiTelemetry, resolveAiRoute, getAiConfig } = await import('./_shared/ai.js');

  const { message, context, history, attachments } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  const safeAttachments = Array.isArray(attachments)
    ? attachments
        .filter((item) => item && typeof item === 'object')
        .slice(0, 3)
        .map((item) => ({
          type: typeof item.type === 'string' ? item.type : 'image',
          mime_type: typeof item.mime_type === 'string' ? item.mime_type : '',
          name: typeof item.name === 'string' ? item.name : '',
          data_url: typeof item.data_url === 'string' ? item.data_url : '',
        }))
        .filter((item) => item.data_url)
    : [];
  const route = resolveAiRoute(getAiConfig(), context || {});

  const startedAt = Date.now();
  const result = await invokeChatProvider({ message, context, history, attachments: safeAttachments, user, workspaceId });
  const durationMs = Date.now() - startedAt;
  const normalized = normalizeAiTelemetry(result.data || {});
  const feature = route.feature;
  await logAiMetric(workspaceId, user.id, 'chat', durationMs, {
    feature,
    provider: result.provider,
    status: result.status,
    model: normalized.model || route.model,
    chat_policy: getAiConfig().chatPolicy,
    cache_hit: normalized.cache_hit,
    cache_read_tokens: normalized.cache_read_tokens,
    had_context: !!context && Object.keys(context || {}).length > 0,
    history_count: Array.isArray(history) ? history.length : 0,
    attachment_count: safeAttachments.length,
    attachment_types: safeAttachments.map((item) => item.type || 'image'),
    message_chars: message.length,
    usage: normalized.usage.raw,
    input_tokens: normalized.usage.input_tokens,
    output_tokens: normalized.usage.output_tokens,
    total_tokens: normalized.usage.total_tokens,
  });

  if (!result.ok) {
    return res.status(result.status || 502).json({
      error: result.data?.error || 'AI provider request failed',
      detail: result.data?.detail,
      provider: result.provider,
    });
  }

  return res.status(200).json({
    ...result.data,
    provider: result.provider,
    telemetry: {
      ...(result.data?.telemetry || {}),
      duration_ms: durationMs,
      cache_hit: normalized.cache_hit,
      cache_read_tokens: normalized.cache_read_tokens,
    },
    model: result.data?.model || normalized.model || route.model || null,
    usage: result.data?.usage || normalized.usage.raw,
  });
}
