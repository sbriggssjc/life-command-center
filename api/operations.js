// ============================================================================
// Operations API — Consolidated from bridge.js + workflows.js
// Life Command Center
//
// BRIDGE ACTIONS (domain activity logging):
//   POST /api/operations?action=log_activity       — log domain activity
//   POST /api/operations?action=complete_research   — mark research complete
//   POST /api/operations?action=log_call           — log call activity
//   POST /api/operations?action=save_ownership     — ownership save → activity
//   POST /api/operations?action=dismiss_lead       — lead dismissal → activity
//   POST /api/operations?action=update_entity      — sync domain → canonical entity
//
// WORKFLOW ACTIONS (multi-step team operations):
//   POST /api/operations?action=promote_to_shared   — inbox → shared action
//   POST /api/operations?action=sf_task_to_action   — SF task → entity-linked action
//   POST /api/operations?action=research_followup   — research → follow-up action
//   POST /api/operations?action=reassign            — reassign work item
//   POST /api/operations?action=escalate            — escalate to manager
//   POST /api/operations?action=watch               — subscribe to item updates
//   POST /api/operations?action=unwatch             — unsubscribe from updates
//   POST /api/operations?action=bulk_assign         — assign multiple items
//   POST /api/operations?action=bulk_triage         — triage multiple inbox items
//   GET  /api/operations?action=oversight           — manager team overview
//   GET  /api/operations?action=unassigned          — unassigned work items
//   GET  /api/operations?action=watchers            — list watchers
//
// CHAT:
//   POST /api/operations?_route=chat               — AI copilot chat
//
// CONSOLIDATION NOTE (2026-04-03):
// Merged to stay within Vercel Hobby plan 12-function limit.
// See LCC_ARCHITECTURE_STRATEGY.md and .github/AI_INSTRUCTIONS.md
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, pgFilterVal, requireOps, withErrorHandler } from './_shared/ops-db.js';
import { closeResearchLoop } from './_shared/research-loop.js';
import { ensureEntityLink, normalizeCanonicalName } from './_shared/entity-link.js';
import { invokeChatProvider } from './_shared/ai.js';
import {
  canTransitionInbox, canTransitionAction,
  buildTransitionActivity, ACTION_TYPES, PRIORITIES, VISIBILITY_SCOPES, isValidEnum
} from './_shared/lifecycle.js';

// ============================================================================
// MAIN DISPATCHER
// ============================================================================

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  // Chat route (via vercel.json _route=chat)
  if (req.query._route === 'chat') {
    return handleChatRoute(req, res);
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const { action } = req.query;

  // ---- GET endpoints (workflows) ----
  if (req.method === 'GET') {
    switch (action) {
      case 'oversight':   return await getOversight(req, res, user, workspaceId);
      case 'unassigned':  return await getUnassigned(req, res, user, workspaceId);
      case 'watchers':    return await getWatchers(req, res, user, workspaceId);
      default: return res.status(400).json({ error: 'Invalid GET action. Use: oversight, unassigned, watchers' });
    }
  }

  // ---- POST endpoints ----
  if (req.method === 'POST') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }

    switch (action) {
      // Bridge actions
      case 'log_activity':       return await bridgeLogActivity(req, res, user, workspaceId);
      case 'complete_research':  return await bridgeCompleteResearch(req, res, user, workspaceId);
      case 'log_call':           return await bridgeLogCall(req, res, user, workspaceId);
      case 'save_ownership':     return await bridgeSaveOwnership(req, res, user, workspaceId);
      case 'dismiss_lead':       return await bridgeDismissLead(req, res, user, workspaceId);
      case 'update_entity':      return await bridgeUpdateEntity(req, res, user, workspaceId);

      // Workflow actions
      case 'promote_to_shared':  return await promoteToShared(req, res, user, workspaceId);
      case 'sf_task_to_action':  return await sfTaskToAction(req, res, user, workspaceId);
      case 'research_followup':  return await researchFollowup(req, res, user, workspaceId);
      case 'reassign':           return await reassignItem(req, res, user, workspaceId);
      case 'escalate':           return await escalateItem(req, res, user, workspaceId);
      case 'watch':              return await addWatch(req, res, user, workspaceId);
      case 'unwatch':            return await removeWatch(req, res, user, workspaceId);
      case 'bulk_assign':        return await bulkAssign(req, res, user, workspaceId);
      case 'bulk_triage':        return await bulkTriage(req, res, user, workspaceId);

      default:
        return res.status(400).json({
          error: 'Invalid POST action. Bridge: log_activity, complete_research, log_call, save_ownership, dismiss_lead, update_entity. Workflows: promote_to_shared, sf_task_to_action, research_followup, reassign, escalate, watch, unwatch, bulk_assign, bulk_triage'
        });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
});

// ============================================================================
// BRIDGE: Generic activity logging for any domain save operation
// ============================================================================

async function bridgeLogActivity(req, res, user, workspaceId) {
  const {
    category, title, body, domain, entity_id, external_id,
    source_system, source_type, metadata
  } = req.body || {};

  if (!title) return res.status(400).json({ error: 'title is required' });

  let resolvedEntityId = entity_id;
  if (!resolvedEntityId && external_id && source_system) {
    const link = await ensureEntityLink({
      workspaceId, userId: user.id, sourceSystem: source_system,
      sourceType: source_type || 'asset', externalId: external_id,
      domain, seedFields: { name: title, metadata }
    });
    if (link.ok) resolvedEntityId = link.entityId;
  }

  const activityMetadata = { ...metadata, bridge_source: 'domain_save' };
  if (req.body.gov_change_event_id) activityMetadata.gov_change_event_id = req.body.gov_change_event_id;
  if (req.body.gov_correlation_id) activityMetadata.gov_correlation_id = req.body.gov_correlation_id;
  if (req.body.source_record_id) activityMetadata.source_record_id = req.body.source_record_id;
  if (req.body.source_table) activityMetadata.source_table = req.body.source_table;

  const result = await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId, actor_id: user.id,
    category: category || 'note', title,
    body: body || null, entity_id: resolvedEntityId || null,
    source_type: source_system || 'system', domain: domain || null,
    visibility: 'shared', metadata: activityMetadata,
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
    domain, research_type, research_task_id, entity_id,
    external_id, external_url, source_system, source_type,
    source_record_id, source_table, outcome, notes,
    follow_up_title, follow_up_due, follow_up_assignee,
    title, instructions, entity_fields, metadata
  } = req.body || {};

  if (!research_type) return res.status(400).json({ error: 'research_type is required' });

  const researchMetadata = { ...(metadata || {}), research_type, outcome, bridge_source: 'research_completion' };
  if (req.body.gov_change_event_id) researchMetadata.gov_change_event_id = req.body.gov_change_event_id;
  if (req.body.gov_correlation_id) researchMetadata.gov_correlation_id = req.body.gov_correlation_id;
  if (source_record_id) researchMetadata.source_record_id = source_record_id;
  if (source_table) researchMetadata.source_table = source_table;

  const closure = await closeResearchLoop({
    workspaceId, user, researchTaskId: research_task_id,
    sourceSystem: source_system, sourceType: source_type || 'asset',
    sourceRecordId: source_record_id || external_id,
    sourceTable: source_table || null,
    externalId: external_id, externalUrl: external_url,
    researchType: research_type, domain,
    entityId: entity_id, entitySeedFields: entity_fields || {},
    title, instructions,
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
// BRIDGE: Call logging → canonical activity
// ============================================================================

async function bridgeLogCall(req, res, user, workspaceId) {
  const {
    subject, notes, outcome, domain, entity_id, external_id,
    source_system, source_type, sf_contact_id, sf_company_id, activity_date
  } = req.body || {};

  if (!subject) return res.status(400).json({ error: 'subject is required' });

  let resolvedEntityId = entity_id;
  if (!resolvedEntityId && external_id && source_system) {
    const link = await ensureEntityLink({
      workspaceId, userId: user.id, sourceSystem: source_system,
      sourceType: source_type || 'asset', externalId: external_id,
      domain, seedFields: { name: subject, metadata: { sf_contact_id, sf_company_id } }
    });
    if (link.ok) resolvedEntityId = link.entityId;
  }

  const result = await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId, actor_id: user.id,
    category: 'call', title: subject, body: notes || null,
    entity_id: resolvedEntityId || null, source_type: 'salesforce',
    domain: domain || null, visibility: 'shared',
    metadata: {
      outcome, sf_contact_id, sf_company_id,
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
    domain, entity_id, external_id, source_system,
    owner_name, true_owner_name, notes
  } = req.body || {};

  let resolvedEntityId = entity_id;
  if (!resolvedEntityId && external_id && source_system) {
    const link = await ensureEntityLink({
      workspaceId, userId: user.id, sourceSystem: source_system,
      sourceType: req.body.source_type || 'asset', externalId: external_id,
      domain, seedFields: { name: true_owner_name || owner_name, org_type: 'owner' }
    });
    if (link.ok) resolvedEntityId = link.entityId;
  }

  const title = true_owner_name
    ? `Ownership resolved: ${true_owner_name}${owner_name ? ` (recorded: ${owner_name})` : ''}`
    : `Ownership data saved${owner_name ? `: ${owner_name}` : ''}`;

  const ownershipMetadata = { owner_name, true_owner_name, bridge_source: 'ownership_save' };
  if (req.body.gov_change_event_id) ownershipMetadata.gov_change_event_id = req.body.gov_change_event_id;
  if (req.body.gov_correlation_id) ownershipMetadata.gov_correlation_id = req.body.gov_correlation_id;
  if (req.body.source_record_id) ownershipMetadata.source_record_id = req.body.source_record_id;
  if (req.body.source_table) ownershipMetadata.source_table = req.body.source_table;

  await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId, actor_id: user.id,
    category: 'research', title, body: notes || null,
    entity_id: resolvedEntityId || null,
    source_type: source_system || 'system', domain: domain || null,
    visibility: 'shared', metadata: ownershipMetadata,
    occurred_at: new Date().toISOString()
  });

  return res.status(201).json({ logged: true, entity_id: resolvedEntityId });
}

// ============================================================================
// BRIDGE: Lead dismissal → canonical activity
// ============================================================================

async function bridgeDismissLead(req, res, user, workspaceId) {
  const {
    domain, entity_id, external_id, source_system, reason, notes
  } = req.body || {};

  let resolvedEntityId = entity_id;
  if (!resolvedEntityId && external_id && source_system) {
    const link = await ensureEntityLink({
      workspaceId, userId: user.id, sourceSystem: source_system,
      sourceType: req.body.source_type || 'asset', externalId: external_id,
      domain, seedFields: { name: reason || notes || 'Dismissed lead' }
    });
    if (link.ok) resolvedEntityId = link.entityId;
  }

  await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId, actor_id: user.id,
    category: 'status_change',
    title: `Lead dismissed${reason ? ': ' + reason : ''}`,
    body: notes || null, entity_id: resolvedEntityId || null,
    source_type: source_system || 'system', domain: domain || null,
    visibility: 'shared', metadata: { reason, bridge_source: 'lead_dismiss' },
    occurred_at: new Date().toISOString()
  });

  return res.status(201).json({ logged: true, entity_id: resolvedEntityId });
}

// ============================================================================
// BRIDGE: Entity update — sync domain record field changes to canonical entity
// ============================================================================

async function bridgeUpdateEntity(req, res, user, workspaceId) {
  const { external_id, source_system, source_type, fields } = req.body || {};

  if (!external_id || !source_system) {
    return res.status(400).json({ error: 'external_id and source_system are required' });
  }

  if (!fields || Object.keys(fields).length === 0) {
    return res.status(200).json({ updated: false, reason: 'No fields to update' });
  }

  const link = await ensureEntityLink({
    workspaceId, userId: user.id, sourceSystem: source_system,
    sourceType: source_type || 'asset', externalId: external_id,
    seedFields: fields, metadata: { bridge_source: 'update_entity' }
  });
  if (!link.ok) {
    return res.status(500).json({ error: link.error, detail: link.detail });
  }

  const entityId = link.entityId;
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

  await opsQuery('PATCH',
    `external_identities?entity_id=eq.${entityId}&source_system=eq.${pgFilterVal(source_system)}`,
    { last_synced_at: new Date().toISOString() }
  );

  if (!result.ok) {
    return res.status(result.status || 500).json({ error: 'Failed to update entity' });
  }

  return res.status(200).json({
    updated: true,
    entity_id: entityId,
    fields_updated: fieldCount
  });
}

// ============================================================================
// CHAT: Route /api/chat → invokeChatProvider (AI copilot)
// ============================================================================

async function fetchPortfolioStats() {
  const stats = { gov_stats: null, dia_stats: null };

  const govUrl = process.env.GOV_SUPABASE_URL;
  const govKey = process.env.GOV_SUPABASE_KEY;
  const diaUrl = process.env.DIA_SUPABASE_URL;
  const diaKey = process.env.DIA_SUPABASE_KEY;

  const fetches = [];

  if (govUrl && govKey) {
    fetches.push(
      fetch(`${govUrl}/rest/v1/mv_gov_overview_stats?select=*&limit=1`, {
        headers: { 'apikey': govKey, 'Authorization': `Bearer ${govKey}` }
      })
        .then(r => r.ok ? r.json() : null)
        .then(rows => { if (Array.isArray(rows) && rows[0]) stats.gov_stats = rows[0]; })
        .catch(e => console.warn('[operations] Gov stats fetch failed:', e.message))
    );
  }

  if (diaUrl && diaKey) {
    fetches.push(
      fetch(`${diaUrl}/rest/v1/v_counts_freshness?select=*&limit=1`, {
        headers: { 'apikey': diaKey, 'Authorization': `Bearer ${diaKey}` }
      })
        .then(r => r.ok ? r.json() : null)
        .then(rows => { if (Array.isArray(rows) && rows[0]) stats.dia_stats = rows[0]; })
        .catch(e => console.warn('[operations] Dialysis stats fetch failed:', e.message))
    );
    fetches.push(
      fetch(`${diaUrl}/rest/v1/clinic_financial_estimates?select=count&limit=1`, {
        headers: {
          'apikey': diaKey,
          'Authorization': `Bearer ${diaKey}`,
          'Prefer': 'count=exact'
        }
      })
        .then(r => {
          const range = r.headers.get('content-range');
          if (range) {
            const match = range.match(/\/(\d+)/);
            if (match) stats.dia_clinic_count = parseInt(match[1], 10);
          }
          return null;
        })
        .catch(e => console.warn('[operations] Dialysis clinic count fetch failed:', e.message))
    );
  }

  await Promise.all(fetches);
  return stats;
}

// ---------------------------------------------------------------------------
// ACTION DISPATCHER — structured action invocation from Copilot
// ---------------------------------------------------------------------------

const ACTION_REGISTRY = {
  // Tier 0: read-only
  get_daily_briefing_snapshot: { method: 'GET', path: 'daily-briefing?action=snapshot', tier: 0 },
  list_staged_intake_inbox:    { method: 'GET', path: 'inbox', tier: 0 },
  get_my_execution_queue:      { method: 'GET', path: 'queue-v2?view=my_work', tier: 0, alias: 'queue?_version=v2&view=my_work' },
  get_sync_run_health:         { method: 'GET', path: 'sync?action=health', tier: 0 },
  get_hot_business_contacts:   { method: 'GET', path: 'contacts?action=hot_leads', tier: 0, alias: 'entity-hub?_domain=contacts&action=hot_leads' },
  search_entity_targets:       { method: 'GET', path: 'entities?action=search', tier: 0, alias: 'entity-hub?_domain=entities&action=search' },
  fetch_listing_activity_context: { method: 'GET', path: 'queue-v2?view=entity_timeline', tier: 0, alias: 'queue?_version=v2&view=entity_timeline' },
  list_government_review_observations: { method: 'GET', path: 'gov-evidence?endpoint=research-observations', tier: 0, alias: 'data-proxy?_route=gov-evidence&endpoint=research-observations' },
  list_dialysis_review_queue:  { method: 'GET', path: 'dia-query?table=v_clinic_property_link_review_queue&select=*', tier: 0, alias: 'data-proxy?_source=dia&table=v_clinic_property_link_review_queue&select=*' },
  get_work_counts:             { method: 'GET', path: 'queue-v2?view=work_counts', tier: 0, alias: 'queue?_version=v2&view=work_counts' },

  // Tier 0-1: AI-powered actions (fetch context + generate content)
  generate_prospecting_brief:  { tier: 0, handler: 'prospecting_brief' },
  draft_outreach_email:        { tier: 1, handler: 'draft_outreach', confirm: 'explicit' },
  draft_seller_update_email:   { tier: 1, handler: 'draft_seller_update', confirm: 'explicit' },

  // Tier 1-2: mutations (require confirmation)
  ingest_outlook_flagged_emails: { method: 'POST', path: 'sync?action=ingest_emails', tier: 1, confirm: 'lightweight' },
  triage_inbox_item:           { method: 'PATCH', path: 'inbox', tier: 2, confirm: 'lightweight' },
  promote_intake_to_action:    { method: 'POST', path: 'workflows?action=promote_to_shared', tier: 2, confirm: 'explicit', alias: 'operations?action=promote_to_shared' },
  create_listing_pursuit_followup_task: { method: 'POST', path: 'actions', tier: 2, confirm: 'explicit' },
  update_execution_task_status: { method: 'PATCH', path: 'actions', tier: 2, confirm: 'explicit' },
  retry_sync_error_record:     { method: 'POST', path: 'sync?action=retry', tier: 2, confirm: 'explicit' },
};

async function dispatchAction(actionName, params, user, workspaceId) {
  const spec = ACTION_REGISTRY[actionName];
  if (!spec) {
    return { ok: false, error: `Unknown action: ${actionName}`, available_actions: Object.keys(ACTION_REGISTRY) };
  }

  // Enforce confirmation for write/draft actions
  if (spec.tier >= 1 && spec.confirm && !params?._confirmed) {
    return {
      ok: false,
      requires_confirmation: true,
      action: actionName,
      confirmation_level: spec.confirm || 'explicit',
      message: `Action "${actionName}" requires ${spec.confirm || 'explicit'} confirmation. Resend with _confirmed: true to execute.`,
      tier: spec.tier
    };
  }

  // AI-powered actions have dedicated handlers
  if (spec.handler) {
    switch (spec.handler) {
      case 'prospecting_brief':   return handleProspectingBrief(params, user, workspaceId);
      case 'draft_outreach':      return handleDraftOutreachEmail(params, user, workspaceId);
      case 'draft_seller_update': return handleDraftSellerUpdate(params, user, workspaceId);
      default: return { ok: false, error: `Unknown handler: ${spec.handler}` };
    }
  }

  // Build internal fetch URL using opsQuery for GET reads, or compose for mutations
  if (spec.method === 'GET') {
    return await executeReadAction(spec, params, user, workspaceId);
  }

  // Write actions return metadata about what to call — the frontend or
  // Copilot should invoke the real endpoint directly with proper auth.
  // This avoids double-proxying and keeps audit trails clean.
  return {
    ok: true,
    action: actionName,
    method: spec.method,
    endpoint: `/api/${spec.path}`,
    params_to_send: params || {},
    note: 'Execute this endpoint directly with your auth credentials to complete the action.'
  };
}

async function executeReadAction(spec, params, user, workspaceId) {
  // Build the query path with user params
  let path = spec.path;
  if (params) {
    const queryParts = [];
    for (const [key, val] of Object.entries(params)) {
      if (key.startsWith('_')) continue; // skip internal flags
      queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
    }
    if (queryParts.length) {
      path += (path.includes('?') ? '&' : '?') + queryParts.join('&');
    }
  }

  // Add workspace filter where relevant
  if (!path.includes('workspace_id') && workspaceId) {
    path += (path.includes('?') ? '&' : '?') + `workspace_id=eq.${encodeURIComponent(workspaceId)}`;
  }

  const result = await opsQuery('GET', path);
  return {
    ok: result.ok,
    action: spec.path.split('?')[0],
    data: result.data,
    count: result.count || undefined
  };
}

// ---------------------------------------------------------------------------
// AI-POWERED ACTIONS — fetch context, compose prompt, call AI provider
// ---------------------------------------------------------------------------

const GOV_URL = process.env.GOV_SUPABASE_URL;
const GOV_KEY = process.env.GOV_SUPABASE_KEY;

async function govContactQuery(path) {
  if (!GOV_URL || !GOV_KEY) return { ok: false, data: [] };
  const res = await fetch(`${GOV_URL}/rest/v1/${path}`, {
    headers: { 'apikey': GOV_KEY, 'Authorization': `Bearer ${GOV_KEY}`, 'Prefer': 'count=exact' }
  });
  const data = await res.json().catch(() => []);
  return { ok: res.ok, data: Array.isArray(data) ? data : [] };
}

async function handleProspectingBrief(params, user, workspaceId) {
  const limit = Math.min(parseInt(params?.limit) || 10, 25);

  // Fetch hot leads
  const hotResult = await govContactQuery(
    `unified_contacts?contact_class=eq.business&engagement_score=gt.0&order=engagement_score.desc&limit=${limit}&select=unified_id,full_name,email,phone,company_name,title,engagement_score,last_call_date,last_email_date,last_meeting_date,total_calls,total_emails_sent`
  );

  const contacts = (hotResult.data || []).map(c => ({
    name: c.full_name,
    company: c.company_name || '',
    title: c.title || '',
    email: c.email || '',
    phone: c.phone || '',
    score: c.engagement_score,
    heat: c.engagement_score >= 60 ? 'hot' : c.engagement_score >= 30 ? 'warm' : 'cool',
    last_call: c.last_call_date || 'never',
    last_email: c.last_email_date || 'never',
    last_meeting: c.last_meeting_date || 'never',
    total_calls: c.total_calls || 0,
    total_emails: c.total_emails_sent || 0
  }));

  if (!contacts.length) {
    return { ok: true, action: 'generate_prospecting_brief', response: 'No business contacts with engagement scores found. Start by ingesting contacts from Outlook or Salesforce.', contacts: [] };
  }

  const contactList = contacts.map((c, i) =>
    `${i + 1}. ${c.name} (${c.company}) — ${c.heat} (score: ${c.score})\n   Title: ${c.title}\n   Last call: ${c.last_call} | Last email: ${c.last_email}\n   Calls: ${c.total_calls} | Emails: ${c.total_emails}\n   Phone: ${c.phone} | Email: ${c.email}`
  ).join('\n\n');

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const prompt = `Generate a concise daily prospecting call sheet for ${today}.\n\nHere are the top contacts ranked by engagement:\n\n${contactList}\n\nFor each contact, provide:\n1. A one-line call prep note (why to call based on engagement pattern)\n2. A suggested talking point or reason to reach out\n3. Priority level (call today / this week / nurture)\n\nFocus on contacts who haven't been called recently but have high engagement. Flag any that are overdue for a touchpoint.`;

  const result = await invokeChatProvider({
    message: prompt,
    context: { assistant_feature: 'global_copilot', action: 'generate_prospecting_brief' },
    history: [],
    attachments: [],
    user,
    workspaceId
  });

  return {
    ok: true,
    action: 'generate_prospecting_brief',
    response: result.data?.response || '',
    contacts,
    provider: result.provider
  };
}

async function handleDraftOutreachEmail(params, user, workspaceId) {
  const { contact_id, contact_name, intent, tone } = params || {};

  // Fetch contact context if ID provided
  let contactContext = '';
  if (contact_id) {
    const result = await govContactQuery(
      `unified_contacts?unified_id=eq.${encodeURIComponent(contact_id)}&limit=1&select=full_name,email,phone,company_name,title,engagement_score,last_call_date,last_email_date,last_meeting_date,total_calls,total_emails_sent,city,state`
    );
    const c = result.data?.[0];
    if (c) {
      contactContext = `\nRecipient Profile:\n- Name: ${c.full_name}\n- Company: ${c.company_name || 'unknown'}\n- Title: ${c.title || 'unknown'}\n- Location: ${[c.city, c.state].filter(Boolean).join(', ') || 'unknown'}\n- Engagement: score ${c.engagement_score || 0}, ${c.total_calls || 0} calls, ${c.total_emails_sent || 0} emails sent\n- Last call: ${c.last_call_date || 'never'} | Last email: ${c.last_email_date || 'never'} | Last meeting: ${c.last_meeting_date || 'never'}`;
    }
  } else if (contact_name) {
    contactContext = `\nRecipient: ${contact_name}`;
  }

  const toneGuide = tone || 'professional, warm, and concise';
  const intentGuide = intent || 'reconnect and explore potential listing opportunities';

  const prompt = `Draft a personalized outreach email for a commercial real estate broker.\n${contactContext}\n\nIntent: ${intentGuide}\nTone: ${toneGuide}\n\nRequirements:\n- Subject line + email body\n- Reference any relevant engagement history to make it personal\n- Keep it under 150 words\n- Include a clear but soft call-to-action\n- Do NOT use generic filler — make it specific to the recipient\n- This is a DRAFT for the broker to review before sending`;

  const result = await invokeChatProvider({
    message: prompt,
    context: { assistant_feature: 'global_copilot', action: 'draft_outreach_email' },
    history: Array.isArray(params?.history) ? params.history : [],
    attachments: [],
    user,
    workspaceId
  });

  return {
    ok: true,
    action: 'draft_outreach_email',
    response: result.data?.response || '',
    requires_review: true,
    note: 'This is a draft. Review and edit before sending from Outlook.',
    provider: result.provider
  };
}

async function handleDraftSellerUpdate(params, user, workspaceId) {
  const { entity_id, entity_name, listing_context } = params || {};

  // Fetch activity timeline if entity_id provided
  let activityContext = '';
  if (entity_id) {
    const timelineResult = await opsQuery('GET',
      `v_entity_timeline?entity_id=eq.${encodeURIComponent(entity_id)}&limit=20&order=created_at.desc`
    );
    const events = timelineResult.data || [];
    if (events.length) {
      activityContext = '\nRecent Activity Timeline:\n' + events.map(e =>
        `- ${e.created_at?.split('T')[0] || 'unknown'}: ${e.event_type || e.action_type || 'activity'} — ${e.title || e.subject || e.description || '(no description)'}`
      ).join('\n');
    }

    // Also try to get entity details from ops
    const entityResult = await opsQuery('GET',
      `entities?id=eq.${encodeURIComponent(entity_id)}&limit=1`
    );
    const entity = entityResult.data?.[0];
    if (entity) {
      activityContext = `\nProperty/Entity: ${entity.name || entity_name || 'Unknown'}\nType: ${entity.entity_type || 'unknown'}\nDomain: ${entity.domain || 'unknown'}` + activityContext;
    }
  }

  const extraContext = listing_context ? `\nAdditional Context: ${listing_context}` : '';

  const prompt = `Draft a weekly seller update email for a commercial real estate listing.\n${activityContext}${extraContext}\n\nRequirements:\n- Professional but approachable tone\n- Summarize this week's marketing activity and buyer engagement\n- Highlight key metrics (inquiries, showings, OM downloads if available)\n- Note any buyer follow-up actions taken\n- Brief market conditions commentary if relevant\n- End with next steps and timeline\n- Keep it under 250 words\n- This is a DRAFT for the broker to review before sending to the seller`;

  const result = await invokeChatProvider({
    message: prompt,
    context: { assistant_feature: 'global_copilot', action: 'draft_seller_update_email' },
    history: Array.isArray(params?.history) ? params.history : [],
    attachments: [],
    user,
    workspaceId
  });

  return {
    ok: true,
    action: 'draft_seller_update_email',
    response: result.data?.response || '',
    requires_review: true,
    note: 'This is a draft. Review and personalize before sending to the seller.',
    provider: result.provider
  };
}

// ---------------------------------------------------------------------------
// Fetch operational context for Copilot enrichment
// ---------------------------------------------------------------------------

async function fetchOpsContext(workspaceId, userId) {
  if (!workspaceId) return {};
  try {
    const [countResult, inboxResult, syncResult] = await Promise.all([
      opsQuery('GET', `mv_work_counts?workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`),
      opsQuery('GET', `inbox_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.new&select=id&limit=0`),
      opsQuery('GET', `sync_errors?workspace_id=eq.${encodeURIComponent(workspaceId)}&resolved_at=is.null&select=id&limit=0`)
    ]);
    const counts = countResult.data?.[0] || {};
    return {
      ops_work_counts: {
        open_actions: counts.open_actions || 0,
        overdue: counts.overdue_actions || 0,
        inbox_new: counts.inbox_new || 0,
        research_active: counts.research_active || 0,
        sync_errors: syncResult.count || 0,
        open_escalations: counts.open_escalations || 0,
        due_this_week: counts.due_this_week || 0,
        completed_week: counts.completed_week || 0
      }
    };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// CHAT HANDLER
// ---------------------------------------------------------------------------

async function handleChatRoute(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships?.[0]?.workspace_id || '';

  const { message, context, history, attachments } = req.body || {};

  // --- Structured action dispatch ---
  // If the request includes an action field, dispatch it directly instead of
  // routing through the LLM. This is the programmatic entry point for Copilot
  // agents, Teams cards, and Power Automate flows.
  if (req.body?.copilot_action) {
    const { copilot_action, params } = req.body;
    const result = await dispatchAction(copilot_action, params || {}, user, workspaceId);
    return res.status(result.ok === false && result.requires_confirmation ? 200 : (result.ok ? 200 : 400)).json({
      ...result,
      source: 'copilot_action_dispatch'
    });
  }

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  // --- Enrich context with portfolio stats + operational signals ---
  let portfolioStats = {};
  let opsContext = {};
  try {
    [portfolioStats, opsContext] = await Promise.all([
      fetchPortfolioStats(),
      fetchOpsContext(workspaceId, user.id)
    ]);
  } catch {
    // Non-fatal
  }

  const enrichedContext = {
    ...(context || {}),
    ...portfolioStats,
    ...opsContext,
  };

  const result = await invokeChatProvider({
    message,
    context: enrichedContext,
    history: Array.isArray(history) ? history : [],
    attachments: Array.isArray(attachments) ? attachments : [],
    user,
    workspaceId
  });

  if (!result.ok) {
    return res.status(result.status || 502).json({
      error: result.data?.error || 'AI provider request failed',
      provider: result.provider,
      details: result.data?.details
    });
  }

  return res.status(200).json({
    response: result.data?.response || result.data?.content?.[0]?.text || '',
    usage: result.data?.usage || null,
    provider: result.provider
  });
}

// ============================================================================
// WORKFLOW: PROMOTE TO SHARED — private inbox → shared team action
// ============================================================================

async function promoteToShared(req, res, user, workspaceId) {
  const { inbox_item_id, title, action_type, priority, assigned_to, due_date, entity_id, description } = req.body || {};

  if (!inbox_item_id) return res.status(400).json({ error: 'inbox_item_id is required' });

  const inbox = await fetchOne('inbox_items', inbox_item_id, workspaceId);
  if (!inbox) return res.status(404).json({ error: 'Inbox item not found' });

  if (inbox.status === 'promoted') {
    return res.status(400).json({ error: 'Already promoted' });
  }
  if (!canTransitionInbox(inbox.status, 'promoted') && inbox.status !== 'new') {
    if (!canTransitionInbox(inbox.status, 'triaged')) {
      return res.status(400).json({ error: `Cannot promote from status "${inbox.status}"` });
    }
  }

  const action = await opsQuery('POST', 'action_items', {
    workspace_id: workspaceId, created_by: user.id, owner_id: user.id,
    assigned_to: assigned_to || user.id,
    title: title || inbox.title, description: description || inbox.body,
    action_type: isValidEnum(action_type, ACTION_TYPES) ? action_type : 'follow_up',
    status: 'open',
    priority: isValidEnum(priority, PRIORITIES) ? priority : inbox.priority || 'normal',
    due_date: due_date || null, visibility: 'shared',
    entity_id: entity_id || inbox.entity_id, inbox_item_id: inbox_item_id,
    domain: inbox.domain, source_type: 'inbox_promotion',
    source_connector_id: inbox.source_connector_id,
    external_id: inbox.external_id, external_url: inbox.external_url
  });

  if (!action.ok) return res.status(500).json({ error: 'Failed to create action' });
  const createdAction = unwrap(action);

  if (inbox.status === 'new') {
    await opsQuery('PATCH', `inbox_items?id=eq.${pgFilterVal(inbox_item_id)}`, {
      status: 'promoted', triaged_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
  } else {
    await opsQuery('PATCH', `inbox_items?id=eq.${pgFilterVal(inbox_item_id)}`, {
      status: 'promoted', updated_at: new Date().toISOString()
    });
  }

  await opsQuery('POST', 'watchers', {
    workspace_id: workspaceId, user_id: user.id,
    action_item_id: createdAction.id, reason: 'creator'
  }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

  if (assigned_to && assigned_to !== user.id) {
    await opsQuery('POST', 'watchers', {
      workspace_id: workspaceId, user_id: assigned_to,
      action_item_id: createdAction.id, reason: 'assigned'
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
  }

  await logWorkflowActivity(user, workspaceId, {
    category: 'status_change',
    title: `Promoted "${inbox.title}" from private inbox to shared action`,
    entity_id: entity_id || inbox.entity_id,
    action_item_id: createdAction.id,
    inbox_item_id: inbox_item_id, domain: inbox.domain
  });

  return res.status(201).json({ action: createdAction, inbox_status: 'promoted', workflow: 'promote_to_shared' });
}

// ============================================================================
// WORKFLOW: SF TASK → SHARED ACTION
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

  const entity = await fetchOne('entities', entity_id, workspaceId);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });

  const action = await opsQuery('POST', 'action_items', {
    workspace_id: workspaceId, created_by: user.id, owner_id: user.id,
    assigned_to: assigned_to || user.id,
    title: inbox.title, description: inbox.body,
    action_type: isValidEnum(action_type, ACTION_TYPES) ? action_type : 'follow_up',
    status: 'open',
    priority: isValidEnum(priority, PRIORITIES) ? priority : inbox.priority || 'normal',
    due_date: due_date || inbox.metadata?.activity_date || null,
    visibility: 'shared', entity_id, inbox_item_id,
    domain: inbox.domain, source_type: 'sf_sync',
    source_connector_id: inbox.source_connector_id,
    external_id: inbox.external_id, external_url: inbox.external_url
  });

  if (!action.ok) return res.status(500).json({ error: 'Failed to create action' });
  const createdAction = unwrap(action);

  if (inbox.external_id) {
    await opsQuery('POST', 'external_identities', {
      workspace_id: workspaceId, entity_id,
      source_system: 'salesforce', source_type: 'task',
      external_id: inbox.external_id, external_url: inbox.external_url,
      last_synced_at: new Date().toISOString()
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
  }

  await opsQuery('PATCH', `inbox_items?id=eq.${pgFilterVal(inbox_item_id)}`, {
    status: 'promoted', entity_id, updated_at: new Date().toISOString()
  });

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
// WORKFLOW: RESEARCH → FOLLOW-UP
// ============================================================================

async function researchFollowup(req, res, user, workspaceId) {
  const { research_task_id, outcome, followup_title, followup_description, followup_type, followup_priority,
          assigned_to, due_date, entity_id } = req.body || {};

  if (!research_task_id) return res.status(400).json({ error: 'research_task_id is required' });

  const research = await fetchOne('research_tasks', research_task_id, workspaceId);
  if (!research) return res.status(404).json({ error: 'Research task not found' });

  const closure = await closeResearchLoop({
    workspaceId, user, researchTaskId: research_task_id,
    sourceRecordId: research.source_record_id || null,
    sourceTable: research.source_table || null,
    researchType: research.research_type, domain: research.domain,
    entityId: entity_id || research.entity_id,
    title: research.title, instructions: research.instructions,
    outcome: outcome || { status: 'completed' },
    followupTitle: followup_title, followupDescription: followup_description,
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
    action: closure.followupAction, research_task: closure.researchTask,
    workflow: 'research_followup'
  });
}

// ============================================================================
// WORKFLOW: REASSIGN
// ============================================================================

async function reassignItem(req, res, user, workspaceId) {
  const { item_type, item_id, assigned_to, reason } = req.body || {};

  if (!item_type || !item_id || !assigned_to) {
    return res.status(400).json({ error: 'item_type, item_id, and assigned_to are required' });
  }

  const targetMember = await opsQuery('GET',
    `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${pgFilterVal(assigned_to)}&select=user_id,role`
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

  await opsQuery('PATCH', `${table}?id=eq.${pgFilterVal(item_id)}&workspace_id=eq.${workspaceId}`, {
    assigned_to, updated_at: new Date().toISOString()
  });

  if (item_type === 'action') {
    await opsQuery('POST', 'watchers', {
      workspace_id: workspaceId, user_id: assigned_to,
      action_item_id: item_id, reason: 'assigned'
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
  }

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
// WORKFLOW: ESCALATE
// ============================================================================

async function escalateItem(req, res, user, workspaceId) {
  const { action_item_id, escalate_to, reason } = req.body || {};

  if (!action_item_id || !escalate_to || !reason) {
    return res.status(400).json({ error: 'action_item_id, escalate_to, and reason are required' });
  }

  const action = await fetchOne('action_items', action_item_id, workspaceId);
  if (!action) return res.status(404).json({ error: 'Action item not found' });

  const targetRole = requireRole({ memberships: [{ workspace_id: workspaceId }] }, 'viewer', workspaceId);
  const targetMember = await opsQuery('GET',
    `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${pgFilterVal(escalate_to)}&select=role`
  );
  if (!targetMember.ok || !targetMember.data?.length) {
    return res.status(400).json({ error: 'Escalation target is not a workspace member' });
  }

  await opsQuery('POST', 'escalations', {
    workspace_id: workspaceId, action_item_id,
    escalated_by: user.id, escalated_to: escalate_to,
    previous_assignee: action.assigned_to, reason
  });

  await opsQuery('PATCH', `action_items?id=eq.${pgFilterVal(action_item_id)}`, {
    assigned_to: escalate_to,
    priority: action.priority === 'normal' ? 'high' : action.priority,
    updated_at: new Date().toISOString()
  });

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
    entity_id: action.entity_id, action_item_id, domain: action.domain
  });

  return res.status(200).json({ action_item_id, escalated_to: escalate_to, reason, workflow: 'escalate' });
}

// ============================================================================
// WORKFLOW: WATCH / UNWATCH
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
    workspace_id: workspaceId, user_id: userId, [column]: item_id, reason: 'manual'
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
    `watchers?workspace_id=eq.${workspaceId}&user_id=eq.${user.id}&${column}=eq.${pgFilterVal(item_id)}`
  );
  return res.status(200).json({ watching: false, item_type, item_id });
}

// ============================================================================
// WORKFLOW: BULK ASSIGN
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

    const r = await opsQuery('PATCH', `${table}?id=eq.${pgFilterVal(item_id)}&workspace_id=eq.${workspaceId}`, {
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
// WORKFLOW: BULK TRIAGE
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

    const r = await opsQuery('PATCH', `inbox_items?id=eq.${pgFilterVal(id)}&workspace_id=eq.${workspaceId}`, updates);
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
    workspace_id: workspaceId, view: 'oversight'
  });
}

// ============================================================================
// GET: UNASSIGNED WORK
// ============================================================================

async function getUnassigned(req, res, user, workspaceId) {
  const { domain } = req.query;
  let path = `v_unassigned_work?workspace_id=eq.${workspaceId}&order=created_at.desc&limit=100`;
  if (domain) path += `&domain=eq.${pgFilterVal(domain)}`;

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
    `watchers?workspace_id=eq.${workspaceId}&${column}=eq.${pgFilterVal(item_id)}&select=*,users(display_name,email,avatar_url)&order=created_at`
  );
  return res.status(200).json({ watchers: result.data || [] });
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

async function fetchOne(table, id, workspaceId) {
  const result = await opsQuery('GET', `${table}?id=eq.${pgFilterVal(id)}&workspace_id=eq.${workspaceId}&select=*&limit=1`);
  return result.ok && result.data?.length > 0 ? result.data[0] : null;
}

function unwrap(result) {
  return Array.isArray(result.data) ? result.data[0] : result.data;
}

async function fetchUserName(userId) {
  const result = await opsQuery('GET', `users?id=eq.${pgFilterVal(userId)}&select=display_name&limit=1`);
  return result.ok && result.data?.length > 0 ? result.data[0].display_name : 'Unknown';
}

async function logWorkflowActivity(user, workspaceId, { category, title, entity_id, action_item_id, inbox_item_id, domain }) {
  await opsQuery('POST', 'activity_events', {
    workspace_id: workspaceId, actor_id: user.id,
    category: category || 'status_change', title,
    entity_id: entity_id || null,
    action_item_id: action_item_id || null,
    inbox_item_id: inbox_item_id || null,
    source_type: 'system', domain: domain || null,
    visibility: 'shared',
    occurred_at: new Date().toISOString()
  });
}
