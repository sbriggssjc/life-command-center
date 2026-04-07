// ============================================================================
// Sync & Connectors & RCM Ingest API — Consolidated
// Life Command Center
//
// Sync endpoints:
// POST /api/sync?action=ingest_emails|ingest_calendar|ingest_sf_activities|outbound|retry|verify_connector
// GET  /api/sync?action=health|jobs|isolation_check
//
// Listing Webhook (routed via vercel.json: /api/listing-webhook → /api/sync?_route=listing-webhook):
// POST /api/listing-webhook — SF deal "ELA Executed" → entity + listing-BD pipeline
//
// Connectors (routed via vercel.json: /api/connectors → /api/sync?_route=connectors):
// GET/POST/PATCH/DELETE /api/connectors
//
// RCM Ingest (routed via vercel.json: /api/rcm-ingest → /api/sync?_route=rcm-ingest):
// POST /api/rcm-ingest — parse RCM email notifications into marketing_leads
//
// LoopNet Ingest (routed via vercel.json: /api/loopnet-ingest → /api/sync?_route=loopnet-ingest):
// POST /api/loopnet-ingest — parse LoopNet inquiry emails into marketing_leads
//
// Lead Health (routed via vercel.json: /api/lead-health → /api/sync?_route=lead-health):
// GET /api/lead-health — health check for lead ingestion pipeline
// ============================================================================

import { authenticate, requireRole, primaryWorkspace, handleCors } from './_shared/auth.js';
import { logPerfMetric, opsQuery, requireOps, withErrorHandler } from './_shared/ops-db.js';
import { ACTIVITY_CATEGORIES, buildTransitionActivity } from './_shared/lifecycle.js';
import { runListingBdPipeline } from './_shared/listing-bd.js';
import { writeListingCreatedSignal, writeSignal } from './_shared/signals.js';

// Edge function base URL (existing ai-copilot deployment)
const EDGE_FN_URL = process.env.EDGE_FUNCTION_URL || 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot';

// Power Automate flow URL for completing original SF tasks
const PA_COMPLETE_TASK_URL = process.env.PA_COMPLETE_TASK_URL;

// DIA Supabase (for RCM ingest)
const DIA_SUPABASE_URL = process.env.DIA_SUPABASE_URL;
const DIA_SUPABASE_KEY = process.env.DIA_SUPABASE_KEY;

// Webhook secret for Power Automate ingestion endpoints (RCM, LoopNet, etc.)
// Bypasses user auth — PA flows send this in X-PA-Webhook-Secret header
const PA_WEBHOOK_SECRET = process.env.PA_WEBHOOK_SECRET;
function authenticateWebhook(req) {
  // If no webhook secret is configured, allow all requests (transitional)
  if (!PA_WEBHOOK_SECRET) return true;
  const provided = req.headers['x-pa-webhook-secret'] || '';
  if (!provided || provided.length !== PA_WEBHOOK_SECRET.length) return false;
  // Constant-time comparison
  let mismatch = 0;
  for (let i = 0; i < PA_WEBHOOK_SECRET.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ PA_WEBHOOK_SECRET.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Build per-user headers for edge function calls.
 * Passes connector identity so edge functions can scope data to the correct user.
 */
function connectorHeaders(connector) {
  const headers = { 'Content-Type': 'application/json' };
  if (connector.external_user_id) {
    headers['X-LCC-External-User'] = connector.external_user_id;
  }
  if (connector.config?.flow_id) {
    headers['X-LCC-Flow-Id'] = connector.config.flow_id;
  }
  if (connector.config?.tenant_id) {
    headers['X-LCC-Tenant-Id'] = connector.config.tenant_id;
  }
  return headers;
}

// ---- Connector constants ----
const VALID_CONNECTOR_TYPES = ['salesforce', 'outlook', 'power_automate', 'supabase_domain', 'webhook'];
const VALID_CONNECTOR_METHODS = ['direct_api', 'power_automate', 'webhook', 'manual'];
const VALID_CONNECTOR_STATUSES = ['healthy', 'degraded', 'error', 'disconnected', 'pending_setup'];

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  // Dispatch to connectors handler if routed via _route=connectors
  if (req.query._route === 'connectors') {
    return handleConnectors(req, res);
  }

  // Dispatch to RCM ingest if routed via _route=rcm-ingest
  if (req.query._route === 'rcm-ingest') {
    return handleRcmIngest(req, res);
  }

  // Dispatch to RCM backfill if routed via _route=rcm-backfill
  if (req.query._route === 'rcm-backfill') {
    return handleRcmBackfill(req, res);
  }

  // Dispatch to LoopNet ingest
  if (req.query._route === 'loopnet-ingest') {
    return handleLoopNetIngest(req, res);
  }

  // Dispatch to lead ingest test/health check
  if (req.query._route === 'lead-health') {
    return handleLeadHealth(req, res);
  }

  // Dispatch to live-ingest normalize (merged from api/live-ingest.js)
  if (req.query._route === 'live-ingest') {
    return handleLiveIngest(req, res);
  }

  // Dispatch to listing webhook (SF deal "ELA Executed" → listing-BD pipeline)
  if (req.query._route === 'listing-webhook') {
    return handleListingWebhook(req, res);
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const membership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

  const { action } = req.query;

  // ---- GET endpoints ----
  if (req.method === 'GET') {
    if (action === 'health') return await handleHealth(req, res, user, workspaceId);
    if (action === 'jobs') return await handleJobs(req, res, user, workspaceId);
    if (action === 'isolation_check') return await handleIsolationCheck(req, res, user, workspaceId);
    return res.status(400).json({ error: 'Invalid GET action. Use: health, jobs, isolation_check' });
  }

  // ---- POST endpoints ----
  if (req.method === 'POST') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }

    switch (action) {
      case 'ingest_emails':       return await ingestEmails(req, res, user, workspaceId);
      case 'ingest_calendar':     return await ingestCalendar(req, res, user, workspaceId);
      case 'ingest_sf_activities': return await ingestSfActivities(req, res, user, workspaceId);
      case 'outbound':            return await handleOutbound(req, res, user, workspaceId);
      case 'complete_sf_task':     return await handleCompleteSfTask(req, res, user, workspaceId);
      case 'retry':               return await handleRetry(req, res, user, workspaceId);
      case 'verify_connector':    return await handleVerifyConnector(req, res, user, workspaceId);
      default:
        return res.status(400).json({ error: 'Invalid POST action. Use: ingest_emails, ingest_calendar, ingest_sf_activities, outbound, complete_sf_task, retry, verify_connector' });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
});

// ============================================================================
// SYNC JOB HELPERS
// ============================================================================

async function createSyncJob(workspaceId, connectorAccountId, direction, entityType, correlationId, connector) {
  const jobData = {
    workspace_id: workspaceId,
    connector_account_id: connectorAccountId,
    direction,
    entity_type: entityType,
    correlation_id: correlationId || `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'running',
    started_at: new Date().toISOString()
  };
  // Capture source user context for audit and isolation verification
  if (connector) {
    jobData.source_user_context = {
      external_user_id: connector.external_user_id || null,
      connector_type: connector.connector_type,
      execution_method: connector.execution_method,
      flow_id: connector.config?.flow_id || null,
      tenant_id: connector.config?.tenant_id || null
    };
  }
  const result = await opsQuery('POST', 'sync_jobs', jobData);
  return result.ok ? (Array.isArray(result.data) ? result.data[0] : result.data) : null;
}

async function completeSyncJob(jobId, status, recordsProcessed, recordsFailed, errorSummary) {
  await opsQuery('PATCH', `sync_jobs?id=eq.${jobId}`, {
    status,
    records_processed: recordsProcessed,
    records_failed: recordsFailed,
    error_summary: errorSummary || null,
    completed_at: new Date().toISOString()
  });
}

async function logSyncError(jobId, workspaceId, connectorAccountId, externalId, errorMessage, recordSnapshot, isRetryable) {
  await opsQuery('POST', 'sync_errors', {
    sync_job_id: jobId,
    workspace_id: workspaceId,
    connector_account_id: connectorAccountId,
    external_id: externalId || null,
    error_message: errorMessage,
    record_snapshot: recordSnapshot || null,
    is_retryable: isRetryable !== false
  });
}

async function updateConnectorStatus(connectorId, status, lastSyncAt, lastError) {
  const updates = { status, updated_at: new Date().toISOString() };
  if (lastSyncAt) updates.last_sync_at = lastSyncAt;
  if (lastError !== undefined) updates.last_error = lastError;
  await opsQuery('PATCH', `connector_accounts?id=eq.${connectorId}`, updates);
}

/**
 * Resolve the user's connector account for a given type.
 * Falls back to creating a virtual connector for transitional mode.
 */
async function resolveConnector(userId, workspaceId, connectorType) {
  const result = await opsQuery('GET',
    `connector_accounts?user_id=eq.${userId}&workspace_id=eq.${workspaceId}&connector_type=eq.${connectorType}&select=*&limit=1`
  );

  if (result.ok && result.data?.length > 0) {
    return result.data[0];
  }

  // Auto-create connector in pending_setup if none exists (transitional)
  const createResult = await opsQuery('POST', 'connector_accounts', {
    workspace_id: workspaceId,
    user_id: userId,
    connector_type: connectorType,
    execution_method: connectorType === 'salesforce' ? 'power_automate' : 'power_automate',
    display_name: `${connectorType.charAt(0).toUpperCase() + connectorType.slice(1)} (${userId.slice(0, 8)})`,
    status: 'pending_setup'
  });

  return createResult.ok ? (Array.isArray(createResult.data) ? createResult.data[0] : createResult.data) : null;
}

// ============================================================================
// INGEST: FLAGGED EMAILS → inbox_items
// ============================================================================

async function ingestEmails(req, res, user, workspaceId) {
  const connector = await resolveConnector(user.id, workspaceId, 'outlook');
  if (!connector) return res.status(500).json({ error: 'Could not resolve Outlook connector' });

  const correlationId = `email-${Date.now()}`;
  const job = await createSyncJob(workspaceId, connector.id, 'inbound', 'flagged_email', correlationId, connector);
  if (!job) return res.status(500).json({ error: 'Could not create sync job' });

  let processed = 0, failed = 0, errors = [];

  try {
    // Fetch from existing edge function with per-user connector context
    const edgeRes = await fetch(`${EDGE_FN_URL}/sync/flagged-emails?limit=500`, {
      headers: connectorHeaders(connector)
    });
    if (!edgeRes.ok) throw new Error(`Edge function returned ${edgeRes.status}`);

    const data = await edgeRes.json();
    const emailList = data.emails || [];

    for (const email of emailList) {
      try {
        // Upsert into inbox_items using external_id for dedup
        const externalId = email.id || email.internet_message_id || `email-${email.subject}-${email.received_date_time}`;

        await opsQuery('POST', 'inbox_items', {
          workspace_id: workspaceId,
          source_user_id: user.id,
          assigned_to: user.id,
          title: email.subject || '(No subject)',
          body: email.body_preview || email.body || null,
          source_type: 'flagged_email',
          source_connector_id: connector.id,
          external_id: externalId,
          external_url: email.web_link || null,
          status: 'new',
          priority: 'normal',
          visibility: 'private',
          metadata: {
            sender_name: email.sender_name || email.from?.emailAddress?.name,
            sender_email: email.sender_email || email.from?.emailAddress?.address,
            received_at: email.received_date_time || email.receivedDateTime,
            has_attachments: email.has_attachments || false,
            importance: email.importance,
            correlation_id: correlationId
          },
          received_at: email.received_date_time || email.receivedDateTime || new Date().toISOString()
        }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

        processed++;
      } catch (e) {
        failed++;
        errors.push({ email_id: email.id, error: e.message });
        await logSyncError(job.id, workspaceId, connector.id, email.id, e.message, { subject: email.subject }, true);
      }
    }

    const status = failed === 0 ? 'completed' : (processed > 0 ? 'partial' : 'failed');
    await completeSyncJob(job.id, status, processed, failed, failed > 0 ? `${failed} emails failed to ingest` : null);
    await updateConnectorStatus(connector.id, failed === 0 ? 'healthy' : 'degraded', new Date().toISOString(), failed > 0 ? `${failed} errors` : null);

    return res.status(200).json({
      sync_job_id: job.id,
      correlation_id: correlationId,
      status,
      processed,
      failed,
      errors: errors.slice(0, 10)
    });
  } catch (e) {
    await completeSyncJob(job.id, 'failed', processed, failed, e.message);
    await updateConnectorStatus(connector.id, 'error', null, e.message);
    console.error('[sync] Email ingestion failed:', e.message);
    return res.status(500).json({ error: 'Email ingestion failed', sync_job_id: job.id });
  }
}

// ============================================================================
// INGEST: CALENDAR EVENTS → activity_events
// ============================================================================

async function ingestCalendar(req, res, user, workspaceId) {
  const connector = await resolveConnector(user.id, workspaceId, 'outlook');
  if (!connector) return res.status(500).json({ error: 'Could not resolve Outlook connector' });

  const { calendar } = req.body || {};
  const calendarParam = calendar || 'work';
  const correlationId = `cal-${calendarParam}-${Date.now()}`;
  const job = await createSyncJob(workspaceId, connector.id, 'inbound', 'calendar_event', correlationId, connector);
  if (!job) return res.status(500).json({ error: 'Could not create sync job' });

  let processed = 0, failed = 0;

  try {
    const edgeRes = await fetch(`${EDGE_FN_URL}/sync/calendar-events?days_back=1&days_forward=30&limit=200&calendar=${calendarParam}`, {
      headers: connectorHeaders(connector)
    });
    if (!edgeRes.ok) throw new Error(`Edge function returned ${edgeRes.status}`);

    const data = await edgeRes.json();
    const events = data.events || [];

    for (const event of events) {
      try {
        const externalId = event.id || `cal-${event.subject}-${event.start_time}`;

        await opsQuery('POST', 'activity_events', {
          workspace_id: workspaceId,
          actor_id: user.id,
          category: 'meeting',
          title: event.subject || '(No title)',
          body: event.body_preview || null,
          source_type: 'outlook',
          source_connector_id: connector.id,
          external_id: externalId,
          external_url: event.web_link || null,
          visibility: 'private',
          metadata: {
            start_time: event.start_time || event.start?.dateTime,
            end_time: event.end_time || event.end?.dateTime,
            location: event.location,
            is_all_day: event.is_all_day || false,
            is_cancelled: event.is_cancelled || false,
            calendar: calendarParam,
            attendees: event.attendees,
            organizer: event.organizer,
            correlation_id: correlationId
          },
          occurred_at: event.start_time || event.start?.dateTime || new Date().toISOString()
        }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

        processed++;
      } catch (e) {
        failed++;
        await logSyncError(job.id, workspaceId, connector.id, event.id, e.message, { subject: event.subject }, true);
      }
    }

    const status = failed === 0 ? 'completed' : (processed > 0 ? 'partial' : 'failed');
    await completeSyncJob(job.id, status, processed, failed, failed > 0 ? `${failed} events failed` : null);
    await updateConnectorStatus(connector.id, failed === 0 ? 'healthy' : 'degraded', new Date().toISOString(), null);

    return res.status(200).json({ sync_job_id: job.id, correlation_id: correlationId, status, processed, failed });
  } catch (e) {
    await completeSyncJob(job.id, 'failed', processed, failed, e.message);
    await updateConnectorStatus(connector.id, 'error', null, e.message);
    console.error('[sync] Calendar ingestion failed:', e.message);
    return res.status(500).json({ error: 'Calendar ingestion failed', sync_job_id: job.id });
  }
}

// ============================================================================
// INGEST: SALESFORCE ACTIVITIES → activity_events + inbox_items (tasks)
// ============================================================================

async function ingestSfActivities(req, res, user, workspaceId) {
  const connector = await resolveConnector(user.id, workspaceId, 'salesforce');
  if (!connector) return res.status(500).json({ error: 'Could not resolve Salesforce connector' });

  const correlationId = `sf-${Date.now()}`;
  const job = await createSyncJob(workspaceId, connector.id, 'inbound', 'sf_activity', correlationId, connector);
  if (!job) return res.status(500).json({ error: 'Could not create sync job' });

  let processed = 0, failed = 0;

  try {
    const edgeRes = await fetch(`${EDGE_FN_URL}/sync/sf-activities?limit=2000&sort_dir=desc&assigned_to=all`, {
      headers: connectorHeaders(connector)
    });
    if (!edgeRes.ok) throw new Error(`Edge function returned ${edgeRes.status}`);

    const data = await edgeRes.json();
    const activities = data.activities || [];

    // Deduplicate by ID (API returns ~2x duplicates)
    const seen = new Set();
    const unique = activities.filter(a => {
      const key = a.Id || a.id;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    for (const activity of unique) {
      try {
        const externalId = activity.Id || activity.id;
        const isTask = activity.type === 'Task' || activity.TaskSubtype === 'Task';

        // Determine category
        let category = 'note';
        const subType = (activity.TaskSubtype || activity.type || '').toLowerCase();
        if (subType === 'call' || (activity.Subject || '').toLowerCase().includes('call')) category = 'call';
        else if (subType === 'email' || (activity.Subject || '').toLowerCase().includes('email')) category = 'email';
        else if (subType === 'task') category = 'note';

        // Log as activity event
        await opsQuery('POST', 'activity_events', {
          workspace_id: workspaceId,
          actor_id: user.id,
          category,
          title: activity.Subject || activity.subject || '(No subject)',
          body: activity.Description || activity.description || null,
          source_type: 'salesforce',
          source_connector_id: connector.id,
          external_id: externalId,
          external_url: activity.sf_url || null,
          visibility: 'shared',
          metadata: {
            sf_type: activity.type || activity.Type,
            sf_subtype: activity.TaskSubtype,
            sf_status: activity.Status || activity.status,
            sf_who: activity.Who?.Name || activity.WhoId,
            sf_what: activity.What?.Name || activity.WhatId,
            activity_date: activity.ActivityDate || activity.activity_date,
            is_closed: activity.IsClosed || false,
            priority: activity.Priority,
            correlation_id: correlationId
          },
          occurred_at: activity.ActivityDate || activity.activity_date || activity.CreatedDate || new Date().toISOString()
        }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

        // If it's an open task, also create/update an inbox item for triage
        if (isTask && !(activity.IsClosed || activity.Status === 'Completed')) {
          await opsQuery('POST', 'inbox_items', {
            workspace_id: workspaceId,
            source_user_id: user.id,
            assigned_to: user.id,
            title: activity.Subject || '(No subject)',
            body: activity.Description || null,
            source_type: 'sf_task',
            source_connector_id: connector.id,
            external_id: externalId,
            external_url: activity.sf_url || null,
            status: 'new',
            priority: mapSfPriority(activity.Priority),
            visibility: 'shared',
            metadata: {
              sf_status: activity.Status,
              sf_who: activity.Who?.Name,
              sf_what: activity.What?.Name,
              activity_date: activity.ActivityDate,
              correlation_id: correlationId
            },
            received_at: activity.CreatedDate || new Date().toISOString()
          }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
        }

        processed++;
      } catch (e) {
        failed++;
        await logSyncError(job.id, workspaceId, connector.id, activity.Id || activity.id, e.message, { subject: activity.Subject }, true);
      }
    }

    const status = failed === 0 ? 'completed' : (processed > 0 ? 'partial' : 'failed');
    await completeSyncJob(job.id, status, processed, failed, failed > 0 ? `${failed} activities failed` : null);
    await updateConnectorStatus(connector.id, failed === 0 ? 'healthy' : 'degraded', new Date().toISOString(), null);

    return res.status(200).json({ sync_job_id: job.id, correlation_id: correlationId, status, processed, failed, total_source: unique.length });
  } catch (e) {
    await completeSyncJob(job.id, 'failed', processed, failed, e.message);
    await updateConnectorStatus(connector.id, 'error', null, e.message);
    console.error('[sync] Salesforce ingestion failed:', e.message);
    return res.status(500).json({ error: 'Salesforce ingestion failed', sync_job_id: job.id });
  }
}

function mapSfPriority(sfPriority) {
  if (!sfPriority) return 'normal';
  const p = sfPriority.toLowerCase();
  if (p === 'high') return 'high';
  if (p === 'low') return 'low';
  return 'normal';
}

// ============================================================================
// OUTBOUND: Send commands to external systems with retries
// ============================================================================

async function handleOutbound(req, res, user, workspaceId) {
  const startedAt = Date.now();
  // Gate behind feature flag — outbound writes are disabled by default
  const wsResult = await opsQuery('GET', `workspaces?id=eq.${workspaceId}&select=config`);
  const flags = wsResult.data?.[0]?.config?.feature_flags || {};
  if (flags.sync_outbound_enabled !== true) {
    return res.status(403).json({ error: 'Outbound sync is not enabled for this workspace. Enable the sync_outbound_enabled flag.' });
  }

  const { command, connector_id, payload, max_retries } = req.body || {};

  if (!command) return res.status(400).json({ error: 'command is required' });
  if (!payload) return res.status(400).json({ error: 'payload is required' });

  const VALID_COMMANDS = ['log_to_sf', 'update_sf_task', 'flag_email', 'unflag_email'];
  if (!VALID_COMMANDS.includes(command)) {
    return res.status(400).json({ error: `command must be one of: ${VALID_COMMANDS.join(', ')}` });
  }

  // Resolve connector
  const connectorType = command.startsWith('log_to_sf') || command.startsWith('update_sf') ? 'salesforce' : 'outlook';
  const connector = connector_id
    ? (await opsQuery('GET', `connector_accounts?id=eq.${connector_id}&workspace_id=eq.${workspaceId}&select=*`)).data?.[0]
    : await resolveConnector(user.id, workspaceId, connectorType);

  if (!connector) return res.status(404).json({ error: 'Connector not found' });

  const correlationId = `out-${command}-${Date.now()}`;
  const job = await createSyncJob(workspaceId, connector.id, 'outbound', command, correlationId, connector);
  if (!job) return res.status(500).json({ error: 'Could not create sync job' });

  // Map command to edge function endpoint
  const COMMAND_MAP = {
    log_to_sf: '/sync/log-to-sf',
    update_sf_task: '/sync/log-to-sf',
    flag_email: '/sync/flag-email',
    unflag_email: '/sync/unflag-email'
  };

  const endpoint = `${EDGE_FN_URL}${COMMAND_MAP[command]}`;
  const retries = Math.min(max_retries || 3, 5);
  let lastError = null;

  // Retry with exponential backoff
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      }

      const edgeRes = await fetch(endpoint, {
        method: 'POST',
        headers: connectorHeaders(connector),
        body: JSON.stringify({ ...payload, correlation_id: correlationId })
      });

      if (edgeRes.ok) {
        const data = await edgeRes.json();
        await completeSyncJob(job.id, 'completed', 1, 0);
        await updateConnectorStatus(connector.id, 'healthy', new Date().toISOString(), null);

        // Log outbound activity
        await opsQuery('POST', 'activity_events', {
          workspace_id: workspaceId,
          actor_id: user.id,
          category: command.includes('email') ? 'email' : 'sync',
          title: `Outbound: ${command}`,
          source_type: connectorType,
          source_connector_id: connector.id,
          visibility: 'shared',
          metadata: { command, correlation_id: correlationId, response: data },
          occurred_at: new Date().toISOString()
        });

        logPerfMetric(workspaceId, user.id, 'propagation_latency', 'sync:outbound', Date.now() - startedAt, {
          status: 'completed',
          command,
          connector_type: connectorType,
          attempts: attempt + 1,
          sync_job_id: job.id
        });

        return res.status(200).json({
          sync_job_id: job.id,
          correlation_id: correlationId,
          status: 'completed',
          attempt: attempt + 1,
          response: data
        });
      }

      lastError = `Edge function returned ${edgeRes.status}: ${await edgeRes.text().catch(() => '')}`;
    } catch (e) {
      lastError = e.message;
    }
  }

  // All retries exhausted
  await completeSyncJob(job.id, 'failed', 0, 1, lastError);
  await logSyncError(job.id, workspaceId, connector.id, null, lastError, payload, true);
  await updateConnectorStatus(connector.id, 'degraded', null, lastError);
  logPerfMetric(workspaceId, user.id, 'propagation_latency', 'sync:outbound', Date.now() - startedAt, {
    status: 'failed',
    command,
    connector_type: connectorType,
    attempts: retries + 1,
    sync_job_id: job.id,
    last_error: lastError
  });

  return res.status(502).json({
    error: 'Outbound command failed after retries',
    sync_job_id: job.id,
    correlation_id: correlationId,
    attempts: retries + 1,
    last_error: lastError
  });
}

// ============================================================================
// UPDATE SF TASK: Complete or reschedule open tasks in Salesforce via Power Automate
// ============================================================================

async function handleCompleteSfTask(req, res, user, workspaceId) {
  const startedAt = Date.now();
  if (!PA_COMPLETE_TASK_URL) {
    return res.status(501).json({ error: 'PA_COMPLETE_TASK_URL not configured' });
  }

  const { sf_contact_id, subject, action, new_date } = req.body || {};
  if (!sf_contact_id) return res.status(400).json({ error: 'sf_contact_id is required' });
  if (!subject) return res.status(400).json({ error: 'subject is required' });

  const taskAction = action || 'complete';
  if (!['complete', 'reschedule'].includes(taskAction)) {
    return res.status(400).json({ error: 'action must be "complete" or "reschedule"' });
  }
  if (taskAction === 'reschedule' && !new_date) {
    return res.status(400).json({ error: 'new_date is required for reschedule action' });
  }

  const refId = `LCC-${Date.now().toString(36)}`;
  const payload = {
    sf_contact_id,
    subject,
    action: taskAction,
    ref_id: refId,
    ...(new_date ? { new_date } : {})
  };

  const connector = await resolveConnector(user.id, workspaceId, 'salesforce');
  const correlationId = `sf-task-${taskAction}-${Date.now()}`;
  const job = connector
    ? await createSyncJob(workspaceId, connector.id, 'outbound', 'complete_sf_task', correlationId, connector)
    : null;

  // Retry with exponential backoff (up to 2 retries — this is non-critical)
  let lastError = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      }

      const paRes = await fetch(PA_COMPLETE_TASK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (paRes.ok) {
        const data = await paRes.json();
        if (job) {
          await completeSyncJob(job.id, 'completed', 1, 0);
        }
        if (connector) {
          await updateConnectorStatus(connector.id, 'healthy', new Date().toISOString(), null);
        }

        // Log the activity for audit trail
        await opsQuery('POST', 'activity_events', {
          workspace_id: workspaceId,
          actor_id: user.id,
          category: 'sync',
          title: taskAction === 'complete' ? 'Complete SF Task' : 'Reschedule SF Task',
          source_type: 'salesforce',
          visibility: 'shared',
          metadata: { sf_contact_id, subject, action: taskAction, new_date, ref_id: refId, pa_response: data },
          occurred_at: new Date().toISOString()
        });

        logPerfMetric(workspaceId, user.id, 'propagation_latency', 'sync:complete_sf_task', Date.now() - startedAt, {
          status: 'completed',
          action: taskAction,
          attempts: attempt + 1,
          sync_job_id: job?.id || null,
          connector_id: connector?.id || null
        });

        return res.status(200).json({
          success: true,
          sync_job_id: job?.id || null,
          correlation_id: correlationId,
          ref_id: refId,
          pa_response: data,
          attempt: attempt + 1
        });
      }

      lastError = `PA flow returned ${paRes.status}: ${await paRes.text().catch(() => '')}`;
    } catch (e) {
      lastError = e.message;
    }
  }

  if (job) {
    await completeSyncJob(job.id, 'failed', 0, 1, lastError);
  }
  if (connector) {
    await logSyncError(job?.id || null, workspaceId, connector.id, sf_contact_id, lastError, payload, true);
    await updateConnectorStatus(connector.id, 'degraded', null, lastError);
  }
  logPerfMetric(workspaceId, user.id, 'propagation_latency', 'sync:complete_sf_task', Date.now() - startedAt, {
    status: 'failed',
    action: taskAction,
    sync_job_id: job?.id || null,
    connector_id: connector?.id || null,
    last_error: lastError
  });

  return res.status(502).json({
    error: 'SF Task update flow failed after retries',
    sync_job_id: job?.id || null,
    correlation_id: correlationId,
    ref_id: refId,
    last_error: lastError
  });
}

// ============================================================================
// RETRY: Re-attempt a failed sync error
// ============================================================================

async function handleRetry(req, res, user, workspaceId) {
  const errorId = req.query.error_id || req.body?.error_id;
  if (!errorId) return res.status(400).json({ error: 'error_id is required' });

  const result = await opsQuery('GET',
    `sync_errors?id=eq.${errorId}&workspace_id=eq.${workspaceId}&select=*,sync_jobs(*)`
  );
  if (!result.ok || !result.data?.length) {
    return res.status(404).json({ error: 'Sync error not found' });
  }

  const syncError = result.data[0];
  if (!syncError.is_retryable) {
    return res.status(400).json({ error: 'This error is not retryable' });
  }

  // Increment retry count
  await opsQuery('PATCH', `sync_errors?id=eq.${errorId}`, {
    retry_count: syncError.retry_count + 1
  });

  // Re-trigger the appropriate sync based on the original job's entity_type
  const entityType = syncError.sync_jobs?.entity_type;
  const fakeReq = { body: {}, query: {}, headers: req.headers, method: 'POST' };

  if (entityType === 'flagged_email') {
    return await ingestEmails(fakeReq, res, user, workspaceId);
  } else if (entityType === 'calendar_event') {
    return await ingestCalendar(fakeReq, res, user, workspaceId);
  } else if (entityType === 'sf_activity') {
    return await ingestSfActivities(fakeReq, res, user, workspaceId);
  }

  return res.status(400).json({ error: `Cannot retry entity type: ${entityType}` });
}

// ============================================================================
// HEALTH: Connector health summary with recent sync history
// ============================================================================

async function handleHealth(req, res, user, workspaceId) {
  // Connector statuses
  const connectors = await opsQuery('GET',
    `connector_accounts?workspace_id=eq.${workspaceId}&select=id,user_id,connector_type,execution_method,display_name,status,last_sync_at,last_error,external_user_id&order=connector_type,display_name`
  );

  // Recent sync jobs (last 24h)
  const recentJobs = await opsQuery('GET',
    `sync_jobs?workspace_id=eq.${workspaceId}&created_at=gte.${new Date(Date.now() - 86400000).toISOString()}&select=id,connector_account_id,status,direction,entity_type,records_processed,records_failed,correlation_id,started_at,completed_at&order=created_at.desc&limit=50`
  );

  // Unresolved errors
  const unresolvedErrors = await opsQuery('GET',
    `sync_errors?workspace_id=eq.${workspaceId}&resolved_at=is.null&select=id,connector_account_id,error_code,error_message,is_retryable,retry_count,created_at&order=created_at.desc&limit=25`
  );

  const openSfTasks = await opsQuery('GET',
    `inbox_items?workspace_id=eq.${workspaceId}&source_type=eq.sf_task&status=in.(new,triaged)&select=id&limit=1`,
    { count: 'exact' }
  );

  const connectorList = connectors.data || [];
  const recentJobList = recentJobs.data || [];
  const outboundJobs = recentJobList.filter(job => job.direction === 'outbound');
  const outboundTracked = outboundJobs.filter(job => ['completed', 'failed', 'partial'].includes(job.status));
  const outboundCompleted = outboundTracked.filter(job => job.status === 'completed').length;
  const latestSfInbound = recentJobList.find(job =>
    job.entity_type === 'sf_activity' && ['completed', 'partial'].includes(job.status)
  );
  const sfOpenTaskCount = openSfTasks.count || 0;
  const sfLastProcessed = Number(latestSfInbound?.records_processed || 0);
  const estimatedGap = Math.max(sfOpenTaskCount - sfLastProcessed, 0);
  const summary = {
    total_connectors: connectorList.length,
    healthy: connectorList.filter(c => c.status === 'healthy').length,
    degraded: connectorList.filter(c => c.status === 'degraded').length,
    error: connectorList.filter(c => c.status === 'error').length,
    disconnected: connectorList.filter(c => c.status === 'disconnected').length,
    pending: connectorList.filter(c => c.status === 'pending_setup').length,
    outbound_success_rate_24h: outboundTracked.length ? Number((outboundCompleted / outboundTracked.length).toFixed(3)) : null
  };

  // Per-user breakdown
  const byUser = {};
  for (const c of connectorList) {
    if (!byUser[c.user_id]) byUser[c.user_id] = [];
    byUser[c.user_id].push({
      id: c.id,
      type: c.connector_type,
      status: c.status,
      last_sync: c.last_sync_at,
      last_error: c.last_error
    });
  }

  // Per-user verification status
  const verificationStatus = {};
  for (const c of connectorList) {
    if (!verificationStatus[c.user_id]) verificationStatus[c.user_id] = {};
    verificationStatus[c.user_id][c.connector_type] = {
      configured: !!c.external_user_id,
      status: c.status,
      last_sync: c.last_sync_at,
      has_identity: !!c.external_user_id,
      execution_method: c.execution_method
    };
  }

  return res.status(200).json({
    summary,
    connectors: connectorList,
    by_user: byUser,
    verification_status: verificationStatus,
    recent_jobs: recentJobList,
    unresolved_errors: unresolvedErrors.data || [],
    queue_drift: {
      source: 'salesforce',
      salesforce_open_task_count: sfOpenTaskCount,
      last_sf_records_processed: sfLastProcessed,
      estimated_gap: estimatedGap,
      drift_flag: estimatedGap > 25,
      last_inbound_job_id: latestSfInbound?.id || null,
      last_inbound_completed_at: latestSfInbound?.completed_at || null
    },
    checked_at: new Date().toISOString()
  });
}

// ============================================================================
// VERIFY CONNECTOR: Probe a connector to confirm it works for this user
// ============================================================================

async function handleVerifyConnector(req, res, user, workspaceId) {
  const { connector_id } = req.body || {};
  if (!connector_id) return res.status(400).json({ error: 'connector_id is required' });

  const result = await opsQuery('GET',
    `connector_accounts?id=eq.${connector_id}&workspace_id=eq.${workspaceId}&select=*`
  );
  if (!result.ok || !result.data?.length) {
    return res.status(404).json({ error: 'Connector not found' });
  }

  const connector = result.data[0];
  const checks = {
    connector_id: connector.id,
    connector_type: connector.connector_type,
    user_id: connector.user_id,
    has_external_identity: !!connector.external_user_id,
    execution_method: connector.execution_method,
    edge_function_reachable: false,
    edge_function_user_scoped: false,
    verified_at: new Date().toISOString()
  };

  // Determine the probe endpoint based on connector type
  const PROBE_MAP = {
    outlook: '/sync/flagged-emails?limit=1',
    salesforce: '/sync/sf-activities?limit=1&sort_dir=desc',
  };

  const probeEndpoint = PROBE_MAP[connector.connector_type];
  if (!probeEndpoint) {
    checks.skipped = `No probe available for connector type: ${connector.connector_type}`;
    return res.status(200).json(checks);
  }

  try {
    const probeRes = await fetch(`${EDGE_FN_URL}${probeEndpoint}`, {
      headers: connectorHeaders(connector)
    });
    checks.edge_function_reachable = probeRes.ok || probeRes.status < 500;
    checks.edge_function_status = probeRes.status;

    if (probeRes.ok) {
      const data = await probeRes.json();
      // Check if the response appears user-scoped
      // (has data and contains source identifiers matching our connector)
      checks.edge_function_user_scoped = !!(
        connector.external_user_id &&
        probeRes.headers.get('x-user-context')
      );
      checks.probe_record_count = Array.isArray(data.emails)
        ? data.emails.length
        : Array.isArray(data.activities)
          ? data.activities.length
          : Array.isArray(data.events)
            ? data.events.length
            : 0;
    }
  } catch (e) {
    checks.edge_function_error = e.message;
  }

  // Update connector verification metadata
  await opsQuery('PATCH', `connector_accounts?id=eq.${connector_id}`, {
    config: {
      ...connector.config,
      last_verified_at: checks.verified_at,
      last_verification_result: {
        reachable: checks.edge_function_reachable,
        user_scoped: checks.edge_function_user_scoped,
        status: checks.edge_function_status
      }
    },
    updated_at: new Date().toISOString()
  });

  return res.status(200).json(checks);
}

// ============================================================================
// ISOLATION CHECK: Verify no cross-user data leakage
// Requires manager+ role — compares sync results across users
// ============================================================================

async function handleIsolationCheck(req, res, user, workspaceId) {
  if (!requireRole(user, 'manager', workspaceId)) {
    return res.status(403).json({ error: 'Manager role required for isolation check' });
  }

  // Get all connectors grouped by type
  const connectors = await opsQuery('GET',
    `connector_accounts?workspace_id=eq.${workspaceId}&select=id,user_id,connector_type,external_user_id,status&order=connector_type`
  );

  const connectorList = connectors.data || [];
  const byType = {};
  for (const c of connectorList) {
    if (!byType[c.connector_type]) byType[c.connector_type] = [];
    byType[c.connector_type].push(c);
  }

  const results = { checked_at: new Date().toISOString(), connector_types: {} };

  for (const [type, typeConnectors] of Object.entries(byType)) {
    const typeResult = {
      user_count: typeConnectors.length,
      all_have_identity: typeConnectors.every(c => !!c.external_user_id),
      unique_identities: new Set(typeConnectors.map(c => c.external_user_id).filter(Boolean)).size,
      identity_collision: false,
      users: []
    };

    // Check for identity collisions (two users sharing same external_user_id)
    const identityCounts = {};
    for (const c of typeConnectors) {
      if (c.external_user_id) {
        identityCounts[c.external_user_id] = (identityCounts[c.external_user_id] || 0) + 1;
      }
    }
    typeResult.identity_collision = Object.values(identityCounts).some(count => count > 1);

    // Per-user check: recent inbox items should only belong to source_user_id
    for (const c of typeConnectors) {
      const sourceType = type === 'outlook' ? 'flagged_email' : type === 'salesforce' ? 'sf_task' : null;
      let crossUserItems = 0;

      if (sourceType) {
        const itemCheck = await opsQuery('GET',
          `inbox_items?workspace_id=eq.${workspaceId}&source_connector_id=eq.${c.id}&source_user_id=neq.${c.user_id}&select=id&limit=5`
        );
        crossUserItems = itemCheck.data?.length || 0;
      }

      typeResult.users.push({
        user_id: c.user_id,
        connector_id: c.id,
        has_external_identity: !!c.external_user_id,
        external_user_id: c.external_user_id,
        status: c.status,
        cross_user_items: crossUserItems,
        isolated: crossUserItems === 0
      });
    }

    results.connector_types[type] = typeResult;
  }

  results.fully_isolated = Object.values(results.connector_types)
    .every(t => t.users.every(u => u.isolated));

  return res.status(200).json(results);
}

// ============================================================================
// CONNECTORS — Connector Account Management (merged from connectors.js)
// ============================================================================

async function handleConnectors(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context. Set X-LCC-Workspace header.' });

  const myMembership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!myMembership) return res.status(403).json({ error: 'Not a member of this workspace' });

  if (req.method === 'GET') {
    const { id, user_id, action } = req.query;

    if (action === 'health') {
      const result = await opsQuery('GET',
        `connector_accounts?workspace_id=eq.${workspaceId}&select=id,user_id,connector_type,status,last_sync_at,last_error,display_name`
      );
      if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch connectors' });

      const connectors = Array.isArray(result.data) ? result.data : [];
      return res.status(200).json({
        total: connectors.length,
        healthy: connectors.filter(c => c.status === 'healthy').length,
        degraded: connectors.filter(c => c.status === 'degraded').length,
        error: connectors.filter(c => c.status === 'error').length,
        disconnected: connectors.filter(c => c.status === 'disconnected').length,
        pending: connectors.filter(c => c.status === 'pending_setup').length,
        connectors
      });
    }

    if (id) {
      const result = await opsQuery('GET',
        `connector_accounts?id=eq.${id}&workspace_id=eq.${workspaceId}&select=*`
      );
      if (!result.ok || !result.data?.length) return res.status(404).json({ error: 'Connector not found' });

      const connector = result.data[0];
      if (connector.user_id !== user.id && !requireRole(user, 'manager', workspaceId)) {
        const { config, ...safe } = connector;
        return res.status(200).json({ connector: safe });
      }
      return res.status(200).json({ connector });
    }

    if (user_id) {
      if (user_id !== user.id && !requireRole(user, 'manager', workspaceId)) {
        return res.status(403).json({ error: 'Cannot view other users\' connectors' });
      }
      const result = await opsQuery('GET',
        `connector_accounts?workspace_id=eq.${workspaceId}&user_id=eq.${user_id}&select=*&order=connector_type`
      );
      if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch connectors' });
      return res.status(200).json({ connectors: result.data || [] });
    }

    const isManager = !!requireRole(user, 'manager', workspaceId);
    const select = isManager
      ? '*'
      : 'id,user_id,connector_type,execution_method,display_name,status,last_sync_at';

    const result = await opsQuery('GET',
      `connector_accounts?workspace_id=eq.${workspaceId}&select=${select}&order=connector_type,display_name`
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch connectors' });
    return res.status(200).json({ connectors: result.data || [] });
  }

  if (req.method === 'POST') {
    const { connector_type, execution_method, display_name, config, external_user_id, target_user_id } = req.body || {};

    if (!connector_type || !VALID_CONNECTOR_TYPES.includes(connector_type)) {
      return res.status(400).json({ error: `connector_type must be one of: ${VALID_CONNECTOR_TYPES.join(', ')}` });
    }
    if (!display_name) return res.status(400).json({ error: 'display_name is required' });

    const method = execution_method || 'power_automate';
    if (!VALID_CONNECTOR_METHODS.includes(method)) {
      return res.status(400).json({ error: `execution_method must be one of: ${VALID_CONNECTOR_METHODS.join(', ')}` });
    }

    let targetUserId = user.id;
    if (target_user_id && target_user_id !== user.id) {
      if (!requireRole(user, 'manager', workspaceId)) {
        return res.status(403).json({ error: 'Only managers can create connectors for other users' });
      }
      targetUserId = target_user_id;
    }

    const result = await opsQuery('POST', 'connector_accounts', {
      workspace_id: workspaceId, user_id: targetUserId, connector_type,
      execution_method: method, display_name, status: 'pending_setup',
      config: config || {}, external_user_id: external_user_id || null
    });

    if (!result.ok) return res.status(result.status).json({ error: 'Failed to create connector', detail: result.data });
    return res.status(201).json({ connector: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });

    const existing = await opsQuery('GET',
      `connector_accounts?id=eq.${id}&workspace_id=eq.${workspaceId}&select=user_id`
    );
    if (!existing.ok || !existing.data?.length) return res.status(404).json({ error: 'Connector not found' });

    if (existing.data[0].user_id !== user.id && !requireRole(user, 'manager', workspaceId)) {
      return res.status(403).json({ error: 'Can only update your own connectors' });
    }

    const { display_name, status, config, execution_method, external_user_id, last_sync_at, last_error } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };

    if (display_name) updates.display_name = display_name;
    if (status && VALID_CONNECTOR_STATUSES.includes(status)) updates.status = status;
    if (config !== undefined) updates.config = config;
    if (execution_method && VALID_CONNECTOR_METHODS.includes(execution_method)) updates.execution_method = execution_method;
    if (external_user_id !== undefined) updates.external_user_id = external_user_id;
    if (last_sync_at !== undefined) updates.last_sync_at = last_sync_at;
    if (last_error !== undefined) updates.last_error = last_error;

    const result = await opsQuery('PATCH',
      `connector_accounts?id=eq.${id}&workspace_id=eq.${workspaceId}`, updates
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update connector' });
    return res.status(200).json({ connector: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });

    const existing = await opsQuery('GET',
      `connector_accounts?id=eq.${id}&workspace_id=eq.${workspaceId}&select=user_id`
    );
    if (!existing.ok || !existing.data?.length) return res.status(404).json({ error: 'Connector not found' });

    if (existing.data[0].user_id !== user.id && !requireRole(user, 'owner', workspaceId)) {
      return res.status(403).json({ error: 'Only connector owner or workspace owner can delete connectors' });
    }

    await opsQuery('DELETE',
      `connector_accounts?id=eq.${id}&workspace_id=eq.${workspaceId}`
    );

    return res.status(200).json({ id, removed: true });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

// ============================================================================
// RCM INGEST — Merged from rcm-ingest.js
// Parses RCM email notifications into marketing_leads
// ============================================================================

function parseRcmEmail(rawBody, subject) {
  const lines = rawBody.split('\n').map(l => l.trim()).filter(Boolean);

  function extractAfterLabel(labels) {
    for (const label of labels) {
      for (const line of lines) {
        if (line.toLowerCase().startsWith(label.toLowerCase())) {
          return line.substring(label.length).trim().replace(/^[:\s]+/, '');
        }
      }
    }
    return null;
  }

  // ── Inline format detection ──
  // RCM "Html_to_text" often collapses fields onto a single line:
  //   "Name:James DurandCompany:Mapleton InvestmentsFrom Phone:(310) 209-7243"
  // Detect and split this pattern before falling back to line-by-line extraction.
  let inlineName = null, inlineCompany = null, inlinePhone = null;
  const inlinePattern = /Name:\s*(.+?)(?:Company:|Firm:|Organization:)\s*(.+?)(?:From Phone:|Phone:|Tel:)\s*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i;
  for (const line of lines) {
    const m = line.match(inlinePattern);
    if (m) {
      inlineName = m[1].trim();
      inlineCompany = m[2].trim();
      inlinePhone = m[3].trim();
      break;
    }
  }

  // Also try a two-field inline pattern (Name + Company, no phone on same line)
  if (!inlineName) {
    const twoFieldPattern = /Name:\s*(.+?)(?:Company:|Firm:|Organization:)\s*(.+?)$/i;
    for (const line of lines) {
      const m = line.match(twoFieldPattern);
      if (m) {
        inlineName = m[1].trim();
        inlineCompany = m[2].trim();
        break;
      }
    }
  }

  const name = inlineName || extractAfterLabel(['Full Name:', 'Name:', 'Contact:', 'Requestor:']);
  const company = inlineCompany || extractAfterLabel(['Company:', 'Firm:', 'Organization:', 'Affiliation:']);
  const inquiryType = extractAfterLabel(['Request Type:', 'Inquiry:', 'Action:', 'Type:']);
  const propertyRef = extractAfterLabel(['Property:', 'Listing:', 'Asset:']);

  const emailMatch = rawBody.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const email = emailMatch ? emailMatch[0] : null;

  // ── Phone extraction ──
  // Prefer the inline-parsed contact phone; fall back to scanning the body
  // but skip the RCM boilerplate footer phone (usually after "call (760) 602-5080")
  let phone = inlinePhone || null;
  if (!phone) {
    // Strip the RCM boilerplate header/footer before scanning for phone numbers
    // so we don't accidentally grab the RCM office number.
    const bodyWithoutBoilerplate = rawBody
      .replace(/[-]{10,}[\s\S]*?[-]{10,}/g, '')  // remove --- header/footer blocks
      .replace(/call\s+\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/gi, ''); // remove "call (760) 602-5080" patterns
    const phoneMatch = bodyWithoutBoilerplate.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    phone = phoneMatch ? phoneMatch[0] : null;
  }

  // ── Deal name / property extraction from body ──
  // RCM notifications often say "has viewed the Agreement for {property}"
  // or "has viewed the Offering Memorandum for {property}"
  let bodyDeal = null;
  const dealBodyMatch = rawBody.match(/(?:viewed|downloaded|requested|opened)\s+(?:the\s+)?(?:Agreement|Offering Memorandum|OM|Flyer|Brochure|Package)\s+for\s+(.+?)(?:\.|$)/im);
  if (dealBodyMatch) {
    bodyDeal = dealBodyMatch[1].trim();
  }

  let firstName = null, lastName = null;
  if (name) {
    const parts = name.split(/\s+/);
    firstName = parts[0] || null;
    lastName = parts.slice(1).join(' ') || null;
  }

  return {
    lead_name: name,
    lead_first_name: firstName,
    lead_last_name: lastName,
    lead_email: email,
    lead_phone: phone,
    lead_company: company,
    deal_name: subject || bodyDeal || propertyRef || null,
    activity_type: inquiryType || 'rcm_inquiry',
    activity_detail: inquiryType
  };
}

async function handleRcmIngest(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  // Webhook endpoints accept PA_WEBHOOK_SECRET instead of user auth
  if (!authenticateWebhook(req)) {
    // Fall back to standard user auth (allows browser-based testing)
    const user = await authenticate(req, res);
    if (!user) return;
    const ws = primaryWorkspace(user);
    if (!ws || !requireRole(user, 'operator', ws.workspace_id)) {
      return res.status(403).json({ error: 'Operator role required' });
    }
  }

  if (!DIA_SUPABASE_URL || !DIA_SUPABASE_KEY) {
    return res.status(500).json({ error: 'DIA Supabase not configured' });
  }

  const { source, source_ref, deal_name, subject, raw_body, status } = req.body || {};

  if (!raw_body) {
    return res.status(400).json({ error: 'raw_body is required' });
  }
  if (source !== 'rcm') {
    return res.status(400).json({ error: 'source must be "rcm"' });
  }

  // Power Automate sends `subject` (email subject line); API callers may send `deal_name`.
  // Use whichever is provided, preferring deal_name if both are present.
  const parsed = parseRcmEmail(raw_body, deal_name || subject);

  const insertPayload = {
    source: 'rcm',
    source_ref: source_ref || null,
    lead_name: parsed.lead_name,
    lead_first_name: parsed.lead_first_name,
    lead_last_name: parsed.lead_last_name,
    lead_email: parsed.lead_email,
    lead_phone: parsed.lead_phone,
    lead_company: parsed.lead_company,
    deal_name: parsed.deal_name,
    activity_type: parsed.activity_type,
    activity_detail: parsed.activity_detail,
    notes: raw_body,
    status: status || 'new',
    ingested_at: new Date().toISOString()
  };

  try {
    const insertUrl = `${DIA_SUPABASE_URL}/rest/v1/marketing_leads`;
    const insertRes = await fetch(insertUrl, {
      method: 'POST',
      headers: {
        'apikey': DIA_SUPABASE_KEY,
        'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation,resolution=ignore-duplicates'
      },
      body: JSON.stringify(insertPayload)
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      return res.status(insertRes.status).json({
        error: 'Failed to insert marketing lead',
        detail: errText
      });
    }

    const inserted = await insertRes.json();
    const lead = Array.isArray(inserted) ? inserted[0] : inserted;

    if (!lead || !lead.lead_id) {
      return res.status(200).json({
        ok: true,
        duplicate: true,
        message: 'Lead already exists (duplicate source_ref)',
        source_ref
      });
    }

    // Attempt auto-match to Salesforce by email
    let sfMatch = null;
    if (parsed.lead_email) {
      try {
        const sfUrl = new URL(`${DIA_SUPABASE_URL}/rest/v1/salesforce_activities`);
        sfUrl.searchParams.set('select', 'sf_contact_id,sf_company_id,first_name,last_name,company_name,assigned_to');
        sfUrl.searchParams.set('email', `eq.${parsed.lead_email}`);
        sfUrl.searchParams.set('limit', '1');

        const sfRes = await fetch(sfUrl.toString(), {
          headers: {
            'apikey': DIA_SUPABASE_KEY,
            'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        if (sfRes.ok) {
          const sfData = await sfRes.json();
          if (Array.isArray(sfData) && sfData.length > 0 && sfData[0].sf_contact_id) {
            sfMatch = sfData[0];

            await fetch(`${DIA_SUPABASE_URL}/rest/v1/marketing_leads?lead_id=eq.${lead.lead_id}`, {
              method: 'PATCH',
              headers: {
                'apikey': DIA_SUPABASE_KEY,
                'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({
                sf_contact_id: sfMatch.sf_contact_id,
                sf_match_status: 'matched'
              })
            });
          }
        }
      } catch (sfErr) {
        console.error('SF match attempt failed:', sfErr.message);
      }
    }

    // ── Create salesforce_activities task so the lead appears in CRM hub ──
    // Matched leads attach to existing SF contact; unmatched get a synthetic ID
    let sfActivityId = null;
    try {
      const contactId = sfMatch ? sfMatch.sf_contact_id : `rcm-lead-${lead.lead_id}`;
      const taskSubject = parsed.deal_name
        ? `RCM: ${parsed.deal_name}`
        : `RCM Inquiry – ${parsed.lead_name || parsed.lead_email || 'New Lead'}`;
      const noteSnippet = parsed.activity_detail
        || (raw_body || '').substring(0, 300) + ((raw_body || '').length > 300 ? '…' : '');

      const sfActivityPayload = {
        subject: taskSubject,
        first_name: sfMatch?.first_name || parsed.lead_first_name || null,
        last_name: sfMatch?.last_name || parsed.lead_last_name || null,
        company_name: sfMatch?.company_name || parsed.lead_company || null,
        email: parsed.lead_email,
        phone: parsed.lead_phone,
        sf_contact_id: contactId,
        sf_company_id: sfMatch?.sf_company_id || null,
        nm_type: 'Task',
        task_subtype: 'Task',
        status: 'Open',
        activity_date: new Date().toISOString().split('T')[0],
        nm_notes: noteSnippet,
        assigned_to: sfMatch?.assigned_to || 'Unassigned',
        source_ref: `rcm:${source_ref || lead.lead_id}`
      };

      const sfActRes = await fetch(`${DIA_SUPABASE_URL}/rest/v1/salesforce_activities`, {
        method: 'POST',
        headers: {
          'apikey': DIA_SUPABASE_KEY,
          'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation,resolution=ignore-duplicates'
        },
        body: JSON.stringify(sfActivityPayload)
      });

      if (sfActRes.ok) {
        const sfActData = await sfActRes.json();
        const sfAct = Array.isArray(sfActData) ? sfActData[0] : sfActData;
        sfActivityId = sfAct?.activity_id || null;

        // Link the marketing lead back to the SF activity
        if (sfActivityId) {
          await fetch(`${DIA_SUPABASE_URL}/rest/v1/marketing_leads?lead_id=eq.${lead.lead_id}`, {
            method: 'PATCH',
            headers: {
              'apikey': DIA_SUPABASE_KEY,
              'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ sf_activity_id: sfActivityId })
          });
        }
      } else {
        console.error('SF activity creation failed:', await sfActRes.text().catch(() => ''));
      }
    } catch (sfActErr) {
      console.error('SF activity creation error:', sfActErr.message);
    }

    // Refresh materialized view so new RCM task appears immediately in CRM hub
    try {
      await fetch(`${DIA_SUPABASE_URL}/rest/v1/rpc/refresh_crm_rollup`, {
        method: 'POST',
        headers: {
          'apikey': DIA_SUPABASE_KEY,
          'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: '{}'
      });
    } catch (refreshErr) {
      console.warn('CRM rollup refresh skipped:', refreshErr.message);
    }

    return res.status(201).json({
      ok: true,
      lead_id: lead.lead_id,
      sf_activity_id: sfActivityId,
      parsed: {
        lead_name: parsed.lead_name,
        lead_email: parsed.lead_email,
        lead_phone: parsed.lead_phone,
        lead_company: parsed.lead_company,
        deal_name: parsed.deal_name,
        activity_type: parsed.activity_type
      },
      sf_match: sfMatch ? {
        sf_contact_id: sfMatch.sf_contact_id,
        name: `${sfMatch.first_name || ''} ${sfMatch.last_name || ''}`.trim()
      } : null
    });
  } catch (err) {
    console.error('[sync] RCM lead ingestion error:', err.message);
    return res.status(500).json({ error: 'Lead ingestion failed' });
  }
}

// ============================================================================
// RCM BACKFILL — Re-parse existing raw RCM leads that were inserted via
// dia-query without parsing, and create missing SF activities
// POST /api/rcm-backfill
// ============================================================================

async function handleRcmBackfill(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  // Webhook endpoints accept PA_WEBHOOK_SECRET instead of user auth
  if (!authenticateWebhook(req)) {
    const user = await authenticate(req, res);
    if (!user) return;
    const ws = primaryWorkspace(user);
    if (!ws || !requireRole(user, 'operator', ws.workspace_id)) {
      return res.status(403).json({ error: 'Operator role required' });
    }
  }

  if (!DIA_SUPABASE_URL || !DIA_SUPABASE_KEY) {
    return res.status(500).json({ error: 'DIA Supabase not configured' });
  }

  const headers = {
    'apikey': DIA_SUPABASE_KEY,
    'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    // Fetch all RCM leads that have raw_body but are missing parsed fields
    // (inserted via dia-query without parsing)
    const fetchUrl = new URL(`${DIA_SUPABASE_URL}/rest/v1/marketing_leads`);
    fetchUrl.searchParams.set('source', 'eq.rcm');
    fetchUrl.searchParams.set('select', '*');
    fetchUrl.searchParams.set('order', 'ingested_at.desc.nullslast');
    fetchUrl.searchParams.set('limit', '1000');

    const fetchRes = await fetch(fetchUrl.toString(), { headers });
    if (!fetchRes.ok) {
      const errText = await fetchRes.text();
      console.error('[sync] RCM leads fetch failed:', fetchRes.status, errText.substring(0, 500));
      return res.status(fetchRes.status).json({ error: 'Failed to fetch RCM leads' });
    }

    const leads = await fetchRes.json();
    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(200).json({ ok: true, message: 'No RCM leads found', processed: 0 });
    }

    let reparsed = 0;
    let sfActivitiesCreated = 0;
    let sfMatched = 0;
    const errors = [];

    for (const lead of leads) {
      try {
        // Re-parse if raw_body exists and lead_name is missing (wasn't parsed)
        const needsParsing = lead.raw_body && !lead.lead_name;
        // Also process leads missing SF activity linkage
        const needsSfActivity = !lead.sf_activity_id;

        if (!needsParsing && !needsSfActivity) continue;

        let parsed = null;
        if (needsParsing && lead.raw_body) {
          parsed = parseRcmEmail(lead.raw_body, lead.deal_name);

          // Update lead with parsed fields
          const patchPayload = {};
          if (parsed.lead_name) patchPayload.lead_name = parsed.lead_name;
          if (parsed.lead_first_name) patchPayload.lead_first_name = parsed.lead_first_name;
          if (parsed.lead_last_name) patchPayload.lead_last_name = parsed.lead_last_name;
          if (parsed.lead_email) patchPayload.lead_email = parsed.lead_email;
          if (parsed.lead_phone) patchPayload.lead_phone = parsed.lead_phone;
          if (parsed.lead_company) patchPayload.lead_company = parsed.lead_company;
          if (parsed.activity_type) patchPayload.activity_type = parsed.activity_type;
          if (parsed.activity_detail) patchPayload.activity_detail = parsed.activity_detail;
          if (parsed.deal_name && !lead.deal_name) patchPayload.deal_name = parsed.deal_name;

          if (Object.keys(patchPayload).length > 0) {
            await fetch(`${DIA_SUPABASE_URL}/rest/v1/marketing_leads?lead_id=eq.${lead.lead_id}`, {
              method: 'PATCH',
              headers: { ...headers, 'Prefer': 'return=minimal' },
              body: JSON.stringify(patchPayload)
            });
            reparsed++;
          }
        }

        // Use existing parsed data or freshly parsed data
        const email = parsed?.lead_email || lead.lead_email;
        const leadName = parsed?.lead_name || lead.lead_name;
        const leadCompany = parsed?.lead_company || lead.lead_company;
        const dealName = parsed?.deal_name || lead.deal_name;

        // Auto-match to Salesforce by email (if not already matched)
        if (email && !lead.sf_contact_id) {
          try {
            const sfUrl = new URL(`${DIA_SUPABASE_URL}/rest/v1/salesforce_activities`);
            sfUrl.searchParams.set('select', 'sf_contact_id,sf_company_id,first_name,last_name,company_name,assigned_to');
            sfUrl.searchParams.set('email', `eq.${email}`);
            sfUrl.searchParams.set('limit', '1');

            const sfRes = await fetch(sfUrl.toString(), { headers });
            if (sfRes.ok) {
              const sfData = await sfRes.json();
              if (Array.isArray(sfData) && sfData.length > 0 && sfData[0].sf_contact_id) {
                await fetch(`${DIA_SUPABASE_URL}/rest/v1/marketing_leads?lead_id=eq.${lead.lead_id}`, {
                  method: 'PATCH',
                  headers: { ...headers, 'Prefer': 'return=minimal' },
                  body: JSON.stringify({
                    sf_contact_id: sfData[0].sf_contact_id,
                    sf_match_status: 'matched'
                  })
                });
                sfMatched++;
              }
            }
          } catch (sfErr) {
            // Non-fatal — continue processing
          }
        }

        // Create SF activity if missing
        if (needsSfActivity) {
          const contactId = lead.sf_contact_id || `rcm-lead-${lead.lead_id}`;
          const taskSubject = dealName
            ? `RCM: ${dealName}`
            : `RCM Inquiry – ${leadName || email || 'New Lead'}`;
          const rawBody = lead.raw_body || lead.notes || '';
          const noteSnippet = (rawBody).substring(0, 300) + (rawBody.length > 300 ? '…' : '');

          const sfActivityPayload = {
            subject: taskSubject,
            first_name: parsed?.lead_first_name || lead.lead_first_name || null,
            last_name: parsed?.lead_last_name || lead.lead_last_name || null,
            company_name: leadCompany || null,
            email: email || null,
            phone: parsed?.lead_phone || lead.lead_phone || null,
            sf_contact_id: contactId,
            nm_type: 'Task',
            task_subtype: 'Task',
            status: 'Open',
            activity_date: lead.ingested_at ? lead.ingested_at.split('T')[0] : new Date().toISOString().split('T')[0],
            nm_notes: noteSnippet,
            assigned_to: 'Unassigned',
            source_ref: `rcm:${lead.source_ref || lead.lead_id}`
          };

          const sfActRes = await fetch(`${DIA_SUPABASE_URL}/rest/v1/salesforce_activities`, {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'return=representation,resolution=ignore-duplicates' },
            body: JSON.stringify(sfActivityPayload)
          });

          if (sfActRes.ok) {
            const sfActData = await sfActRes.json();
            const sfAct = Array.isArray(sfActData) ? sfActData[0] : sfActData;
            if (sfAct?.activity_id) {
              await fetch(`${DIA_SUPABASE_URL}/rest/v1/marketing_leads?lead_id=eq.${lead.lead_id}`, {
                method: 'PATCH',
                headers: { ...headers, 'Prefer': 'return=minimal' },
                body: JSON.stringify({ sf_activity_id: sfAct.activity_id })
              });
              sfActivitiesCreated++;
            }
          }
        }
      } catch (leadErr) {
        errors.push({ lead_id: lead.lead_id, error: leadErr.message });
      }
    }

    // Refresh materialized view
    try {
      await fetch(`${DIA_SUPABASE_URL}/rest/v1/rpc/refresh_crm_rollup`, {
        method: 'POST',
        headers,
        body: '{}'
      });
    } catch (refreshErr) {
      console.warn('CRM rollup refresh skipped:', refreshErr.message);
    }

    return res.status(200).json({
      ok: true,
      total_rcm_leads: leads.length,
      reparsed,
      sf_activities_created: sfActivitiesCreated,
      sf_matched: sfMatched,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('[sync] RCM backfill error:', err.message);
    return res.status(500).json({ error: 'Backfill operation failed' });
  }
}

// ============================================================================
// LoopNet Email Parser
// ============================================================================
function parseLoopNetEmail(rawBody, subject) {
  const lines = rawBody.split('\n').map(l => l.trim()).filter(Boolean);

  function extractAfterLabel(labels) {
    for (const label of labels) {
      for (const line of lines) {
        if (line.toLowerCase().startsWith(label.toLowerCase())) {
          return line.substring(label.length).trim().replace(/^[:\s]+/, '');
        }
      }
    }
    return null;
  }

  const name = extractAfterLabel([
    'Name:', 'Full Name:', 'Contact Name:', 'From:', 'Sender:',
    'Inquirer:', 'Prospect Name:', 'Buyer Name:'
  ]);
  const company = extractAfterLabel([
    'Company:', 'Firm:', 'Organization:', 'Brokerage:', 'Company Name:',
    'Buyer Company:', 'Investor Group:'
  ]);
  const inquiryType = extractAfterLabel([
    'Inquiry Type:', 'Request Type:', 'Type:', 'Action:', 'Interest:',
    'Lead Type:', 'Inquiry About:'
  ]);
  const propertyRef = extractAfterLabel([
    'Property:', 'Listing:', 'Property Name:', 'Property Address:',
    'Listing Name:', 'Asset:', 'Subject Property:'
  ]);
  const message = extractAfterLabel([
    'Message:', 'Comments:', 'Notes:', 'Additional Info:', 'Inquiry Message:'
  ]);

  const emailMatch = rawBody.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const email = emailMatch ? emailMatch[0] : null;

  const phoneMatch = rawBody.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(\s*(x|ext\.?|extension)\s*\d+)?/i);
  const phone = phoneMatch ? phoneMatch[0] : null;

  const listingIdMatch = rawBody.match(/(?:Listing\s*(?:ID|#|Number)[:\s]*)([\d]+)/i);
  const listingId = listingIdMatch ? listingIdMatch[1] : null;

  let firstName = null, lastName = null;
  if (name) {
    const parts = name.split(/\s+/);
    firstName = parts[0] || null;
    lastName = parts.slice(1).join(' ') || null;
  }

  let dealName = subject || propertyRef || null;
  if (dealName) {
    dealName = dealName
      .replace(/^(New\s+)?LoopNet\s+(Inquiry|Lead|Request)\s*[-:–]\s*/i, '')
      .replace(/^(RE|FW|Fwd):\s*/i, '')
      .trim();
  }

  return {
    lead_name: name,
    lead_first_name: firstName,
    lead_last_name: lastName,
    lead_email: email,
    lead_phone: phone,
    lead_company: company,
    deal_name: dealName,
    listing_id: listingId,
    activity_type: inquiryType || 'loopnet_inquiry',
    activity_detail: message || inquiryType || null
  };
}

// ============================================================================
// LOOPNET INGEST — Parses LoopNet inquiry emails into marketing_leads
// POST /api/loopnet-ingest
// ============================================================================
async function handleLoopNetIngest(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  // Webhook auth (same as RCM)
  if (!authenticateWebhook(req)) {
    const user = await authenticate(req, res);
    if (!user) return;
    const ws = primaryWorkspace(user);
    if (!ws || !requireRole(user, 'operator', ws.workspace_id)) {
      return res.status(403).json({ error: 'Operator role required' });
    }
  }

  if (!DIA_SUPABASE_URL || !DIA_SUPABASE_KEY) {
    return res.status(500).json({ error: 'DIA Supabase not configured' });
  }

  const { source_ref, deal_name, raw_body, status } = req.body || {};
  if (!raw_body) {
    return res.status(400).json({ error: 'raw_body is required' });
  }

  const parsed = parseLoopNetEmail(raw_body, deal_name);

  const insertPayload = {
    source: 'loopnet',
    source_ref: source_ref || null,
    lead_name: parsed.lead_name,
    lead_first_name: parsed.lead_first_name,
    lead_last_name: parsed.lead_last_name,
    lead_email: parsed.lead_email,
    lead_phone: parsed.lead_phone,
    lead_company: parsed.lead_company,
    deal_name: parsed.deal_name,
    listing_id: parsed.listing_id,
    activity_type: parsed.activity_type,
    activity_detail: parsed.activity_detail,
    notes: raw_body,
    status: status || 'new',
    ingested_at: new Date().toISOString()
  };

  try {
    const insertUrl = `${DIA_SUPABASE_URL}/rest/v1/marketing_leads`;
    const insertRes = await fetch(insertUrl, {
      method: 'POST',
      headers: {
        'apikey': DIA_SUPABASE_KEY,
        'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation,resolution=ignore-duplicates'
      },
      body: JSON.stringify(insertPayload)
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      return res.status(insertRes.status).json({
        error: 'Failed to insert marketing lead',
        detail: errText
      });
    }

    const inserted = await insertRes.json();
    const lead = Array.isArray(inserted) ? inserted[0] : inserted;

    if (!lead || !lead.lead_id) {
      return res.status(200).json({
        ok: true,
        duplicate: true,
        message: 'Lead already exists (duplicate source_ref)',
        source_ref
      });
    }

    // Auto-match to Salesforce by email (same logic as RCM)
    let sfMatch = null;
    if (parsed.lead_email) {
      try {
        const sfUrl = new URL(`${DIA_SUPABASE_URL}/rest/v1/salesforce_activities`);
        sfUrl.searchParams.set('select', 'sf_contact_id,sf_company_id,first_name,last_name,company_name,assigned_to');
        sfUrl.searchParams.set('email', `eq.${parsed.lead_email}`);
        sfUrl.searchParams.set('limit', '1');

        const sfRes = await fetch(sfUrl.toString(), {
          headers: {
            'apikey': DIA_SUPABASE_KEY,
            'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        if (sfRes.ok) {
          const sfData = await sfRes.json();
          if (Array.isArray(sfData) && sfData.length > 0 && sfData[0].sf_contact_id) {
            sfMatch = sfData[0];
            await fetch(`${DIA_SUPABASE_URL}/rest/v1/marketing_leads?lead_id=eq.${lead.lead_id}`, {
              method: 'PATCH',
              headers: {
                'apikey': DIA_SUPABASE_KEY,
                'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({
                sf_contact_id: sfMatch.sf_contact_id,
                sf_match_status: 'matched'
              })
            });
          }
        }
      } catch (sfErr) {
        console.error('SF match attempt failed:', sfErr.message);
      }
    }

    // Create salesforce_activities task so lead appears in CRM hub
    let sfActivityId = null;
    try {
      const contactId = sfMatch ? sfMatch.sf_contact_id : `loopnet-lead-${lead.lead_id}`;
      const taskSubject = parsed.deal_name
        ? `LoopNet: ${parsed.deal_name}`
        : `LoopNet Inquiry – ${parsed.lead_name || parsed.lead_email || 'New Lead'}`;
      const noteSnippet = parsed.activity_detail
        || (raw_body || '').substring(0, 300) + ((raw_body || '').length > 300 ? '…' : '');

      const sfActivityPayload = {
        subject: taskSubject,
        first_name: sfMatch?.first_name || parsed.lead_first_name || null,
        last_name: sfMatch?.last_name || parsed.lead_last_name || null,
        company_name: sfMatch?.company_name || parsed.lead_company || null,
        email: parsed.lead_email,
        phone: parsed.lead_phone,
        sf_contact_id: contactId,
        sf_company_id: sfMatch?.sf_company_id || null,
        nm_type: 'Task',
        task_subtype: 'Task',
        status: 'Open',
        activity_date: new Date().toISOString().split('T')[0],
        nm_notes: noteSnippet,
        assigned_to: sfMatch?.assigned_to || 'Unassigned',
        source_ref: `loopnet:${source_ref || lead.lead_id}`
      };

      const sfActRes = await fetch(`${DIA_SUPABASE_URL}/rest/v1/salesforce_activities`, {
        method: 'POST',
        headers: {
          'apikey': DIA_SUPABASE_KEY,
          'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation,resolution=ignore-duplicates'
        },
        body: JSON.stringify(sfActivityPayload)
      });

      if (sfActRes.ok) {
        const sfActData = await sfActRes.json();
        const sfAct = Array.isArray(sfActData) ? sfActData[0] : sfActData;
        sfActivityId = sfAct?.activity_id || null;

        if (sfActivityId) {
          await fetch(`${DIA_SUPABASE_URL}/rest/v1/marketing_leads?lead_id=eq.${lead.lead_id}`, {
            method: 'PATCH',
            headers: {
              'apikey': DIA_SUPABASE_KEY,
              'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ sf_activity_id: sfActivityId })
          });
        }
      } else {
        console.error('SF activity creation failed:', await sfActRes.text().catch(() => ''));
      }
    } catch (sfActErr) {
      console.error('SF activity creation error:', sfActErr.message);
    }

    // Refresh CRM rollup
    try {
      await fetch(`${DIA_SUPABASE_URL}/rest/v1/rpc/refresh_crm_rollup`, {
        method: 'POST',
        headers: {
          'apikey': DIA_SUPABASE_KEY,
          'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: '{}'
      });
    } catch (refreshErr) {
      console.warn('CRM rollup refresh skipped:', refreshErr.message);
    }

    return res.status(201).json({
      ok: true,
      lead_id: lead.lead_id,
      sf_activity_id: sfActivityId,
      parsed: {
        lead_name: parsed.lead_name,
        lead_email: parsed.lead_email,
        lead_phone: parsed.lead_phone,
        lead_company: parsed.lead_company,
        deal_name: parsed.deal_name,
        listing_id: parsed.listing_id,
        activity_type: parsed.activity_type
      },
      sf_match: sfMatch ? {
        sf_contact_id: sfMatch.sf_contact_id,
        name: `${sfMatch.first_name || ''} ${sfMatch.last_name || ''}`.trim()
      } : null
    });
  } catch (err) {
    console.error('[sync] LoopNet lead ingestion error:', err.message);
    return res.status(500).json({ error: 'Lead ingestion failed' });
  }
}

// ============================================================================
// LEAD HEALTH — Test/health check for lead ingestion pipeline
// GET /api/lead-health
// ============================================================================
async function handleLeadHealth(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  const checks = {
    dia_configured: !!(DIA_SUPABASE_URL && DIA_SUPABASE_KEY),
    webhook_secret_configured: !!PA_WEBHOOK_SECRET,
    timestamp: new Date().toISOString()
  };

  if (checks.dia_configured) {
    try {
      const countRes = await fetch(
        `${DIA_SUPABASE_URL}/rest/v1/marketing_leads?select=lead_id&limit=1`,
        { headers: { 'apikey': DIA_SUPABASE_KEY, 'Authorization': `Bearer ${DIA_SUPABASE_KEY}` } }
      );
      checks.marketing_leads_accessible = countRes.ok;
      if (!countRes.ok) checks.marketing_leads_error = await countRes.text();
    } catch (e) {
      checks.marketing_leads_accessible = false;
      checks.marketing_leads_error = e.message;
    }
  }

  return res.status(200).json(checks);
}

// ============================================================================
// LIVE INGEST — Document normalization (merged from api/live-ingest.js)
// POST /api/live-ingest?action=normalize
// (routed via vercel.json: /api/live-ingest → /api/sync?_route=live-ingest)
// ============================================================================
async function handleLiveIngest(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const action = req.query?.action || req.body?.action || 'normalize';
  if (action !== 'normalize') {
    return res.status(400).json({ error: 'Unsupported action. Use action=normalize.' });
  }

  const { normalizeLiveIngestDocuments } = await import('./_shared/live-ingest-normalize.js');
  const docs = Array.isArray(req.body?.documents) ? req.body.documents : [];
  const normalized = normalizeLiveIngestDocuments(docs);

  return res.status(200).json({
    ok: true,
    documents: normalized,
    count: normalized.length
  });
}

// ============================================================================
// LISTING WEBHOOK — SF Deal "ELA Executed" → Entity + Listing-BD Pipeline
// POST /api/listing-webhook → /api/sync?_route=listing-webhook
//
// Triggered by Power Automate when a Salesforce Deal record transitions to
// "ELA Executed" status and a Listing is created. The PA flow sends:
//
//   {
//     deal_id:        "SF Deal ID",
//     deal_name:      "123 Main St - Dialysis",
//     deal_status:    "ELA Executed",
//     deal_owner:     "Team Briggs",
//     listing: {
//       sf_listing_id:  "SF Listing record ID",
//       name:           "123 Main St NNN Dialysis",
//       address:        "123 Main St",
//       city:           "Tulsa",
//       state:          "OK",
//       zip:            "74101",
//       asset_type:     "Dialysis",       // or "GSA", "MOB", etc.
//       domain:         "dialysis",       // or "government"
//       list_price:     4500000,
//       cap_rate:       6.25,
//       sf_size:        5400,
//       tenant_name:    "DaVita Inc.",
//       lease_expiration: "2035-06-30",
//       om_url:         "https://...",    // optional: link to OM
//       website_url:    "https://...",    // optional: property website
//     },
//     seller_entity_id: "uuid",           // optional: existing LCC entity for seller
//   }
//
// The handler:
//   1. Authenticates via PA webhook secret (same as RCM/LoopNet)
//   2. Creates or updates the listing entity in entity-hub
//   3. Fires listing_created signal
//   4. Runs listing-BD pipeline → queues T-011 + T-012 inbox items
//   5. Returns summary with pipeline results
// ============================================================================

async function handleListingWebhook(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  // Auth: either PA webhook secret OR authenticated user
  let user = null;
  const isWebhook = authenticateWebhook(req);

  if (!isWebhook) {
    user = await authenticate(req, res);
    if (!user) return;
  }

  const {
    deal_id, deal_name, deal_status, deal_owner,
    listing, seller_entity_id
  } = req.body || {};

  // Validate required fields
  if (!listing || !listing.state) {
    return res.status(400).json({
      error: 'listing object with at least state is required',
      expected: '{ deal_id, deal_name, listing: { name, address, city, state, asset_type, domain, ... } }'
    });
  }

  // Resolve workspace — webhook uses header or default, authenticated user uses their workspace
  const workspaceId = req.headers['x-lcc-workspace']
    || user?.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID;

  if (!workspaceId) {
    return res.status(400).json({ error: 'Could not resolve workspace. Set X-LCC-Workspace header.' });
  }

  const userId = user?.id || process.env.LCC_SYSTEM_USER_ID || null;
  const now = new Date().toISOString();

  try {
    // ---- Step 1: Create or update the listing entity ----
    const entityName = listing.name || listing.address || deal_name || 'New Listing';
    const canonicalName = entityName.trim().toLowerCase()
      .replace(/\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\b\.?/gi, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Check for existing entity by SF listing ID (avoid duplicates)
    let existingEntity = null;
    if (listing.sf_listing_id) {
      const extIdCheck = await opsQuery('GET',
        `external_identities?source_system=eq.salesforce&source_type=eq.listing&external_id=eq.${listing.sf_listing_id}&select=entity_id`
      );
      if (extIdCheck.ok && extIdCheck.data?.length > 0) {
        const entResult = await opsQuery('GET',
          `entities?id=eq.${extIdCheck.data[0].entity_id}&select=*`
        );
        if (entResult.ok && entResult.data?.length > 0) {
          existingEntity = entResult.data[0];
        }
      }
    }

    let listingEntity;

    if (existingEntity) {
      // Update existing entity with latest listing data
      await opsQuery('PATCH', `entities?id=eq.${existingEntity.id}`, {
        name: entityName,
        canonical_name: canonicalName,
        domain: listing.domain || existingEntity.domain,
        address: listing.address || existingEntity.address,
        city: listing.city || existingEntity.city,
        state: listing.state || existingEntity.state,
        metadata: {
          ...(existingEntity.metadata || {}),
          asset_type: listing.asset_type || existingEntity.metadata?.asset_type,
          list_price: listing.list_price,
          cap_rate: listing.cap_rate,
          sf_size: listing.sf_size,
          tenant_name: listing.tenant_name,
          lease_expiration: listing.lease_expiration,
          om_url: listing.om_url || null,
          website_url: listing.website_url || null,
          deal_id: deal_id || null,
          deal_status: deal_status || 'ELA Executed',
          deal_owner: deal_owner || null,
          listing_activated_at: now
        },
        updated_at: now
      });
      listingEntity = { ...existingEntity, state: listing.state, domain: listing.domain || existingEntity.domain };
    } else {
      // Create new entity
      const createResult = await opsQuery('POST', 'entities', {
        workspace_id: workspaceId,
        entity_type: 'asset',
        name: entityName,
        canonical_name: canonicalName,
        domain: listing.domain || null,
        address: listing.address || null,
        city: listing.city || null,
        state: listing.state,
        created_by: userId,
        metadata: {
          asset_type: listing.asset_type || null,
          list_price: listing.list_price || null,
          cap_rate: listing.cap_rate || null,
          sf_size: listing.sf_size || null,
          tenant_name: listing.tenant_name || null,
          lease_expiration: listing.lease_expiration || null,
          om_url: listing.om_url || null,
          website_url: listing.website_url || null,
          deal_id: deal_id || null,
          deal_status: deal_status || 'ELA Executed',
          deal_owner: deal_owner || null,
          listing_activated_at: now
        }
      });

      if (!createResult.ok) {
        return res.status(500).json({ error: 'Failed to create listing entity', detail: createResult.data });
      }
      listingEntity = Array.isArray(createResult.data) ? createResult.data[0] : createResult.data;
    }

    // ---- Step 2: Link SF external identity ----
    if (listing.sf_listing_id && listingEntity?.id) {
      await opsQuery('POST', 'external_identities', {
        workspace_id: workspaceId,
        entity_id: listingEntity.id,
        source_system: 'salesforce',
        source_type: 'listing',
        external_id: listing.sf_listing_id,
        external_url: listing.sf_url || null,
        last_synced_at: now
      }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
    }

    // Also link the deal ID if provided
    if (deal_id && listingEntity?.id) {
      await opsQuery('POST', 'external_identities', {
        workspace_id: workspaceId,
        entity_id: listingEntity.id,
        source_system: 'salesforce',
        source_type: 'deal',
        external_id: deal_id,
        last_synced_at: now
      }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
    }

    // ---- Step 3: Determine if this is a new listing or an update (OM/website/etc.) ----
    const isNewListing = !existingEntity;
    const isOmUpdate = existingEntity && (listing.om_url || listing.website_url);

    // Enrich with asset_type from listing payload for the signal
    const enrichedEntity = {
      ...listingEntity,
      metadata: {
        ...(listingEntity.metadata || {}),
        asset_type: listing.asset_type || listingEntity.metadata?.asset_type,
        listing_status: 'active'
      }
    };

    if (isNewListing && userId) {
      writeListingCreatedSignal(enrichedEntity, { id: userId });
    }

    // ---- Step 4: Log activity event ----
    const activityTitle = isOmUpdate
      ? `Listing updated: ${entityName} — ${[listing.om_url ? 'OM uploaded' : null, listing.website_url ? 'website added' : null].filter(Boolean).join(', ')}`
      : `New listing activated: ${entityName} — ${listing.city || ''}, ${listing.state}`;

    await opsQuery('POST', 'activity_events', {
      workspace_id: workspaceId,
      actor_id: userId,
      category: isNewListing ? 'status_change' : 'update',
      title: activityTitle,
      entity_id: listingEntity.id,
      source_type: 'salesforce',
      domain: listing.domain || null,
      visibility: 'shared',
      metadata: {
        deal_id,
        deal_status: deal_status || 'ELA Executed',
        asset_type: listing.asset_type,
        list_price: listing.list_price,
        trigger: 'listing_webhook',
        update_type: isNewListing ? 'new_listing' : 'listing_update',
        ...(isOmUpdate ? { om_url: listing.om_url, website_url: listing.website_url } : {})
      },
      occurred_at: now
    });

    // ---- Step 5: Run listing-BD pipeline (only on new listings, not updates) ----
    let pipelineResult = { total_queued: 0, skipped: true, reason: 'update_only' };

    if (isNewListing) {
      const excludeIds = [];
      if (seller_entity_id) excludeIds.push(seller_entity_id);

      pipelineResult = await runListingBdPipeline(
        {
          ...enrichedEntity,
          asset_type: listing.asset_type || enrichedEntity.metadata?.asset_type
        },
        workspaceId,
        userId,
        { excludeEntityIds: excludeIds, triggerSource: 'listing_webhook', sfDealId: deal_id }
      );
    }

    // ---- Step 6: Fire OM/website update signal for the learning loop ----
    if (isOmUpdate) {
      writeSignal({
        signal_type: 'listing_collateral_updated',
        signal_category: 'prospecting',
        entity_type: 'listing',
        entity_id: listingEntity.id || null,
        domain: listing.domain || null,
        user_id: userId,
        payload: {
          deal_id,
          listing_name: entityName,
          om_url: listing.om_url || null,
          website_url: listing.website_url || null,
          update_source: 'listing_webhook'
        },
        outcome: 'positive'
      });
    }

    // Fire summary signal
    writeSignal({
      signal_type: 'listing_webhook_processed',
      signal_category: 'prospecting',
      entity_type: 'listing',
      entity_id: listingEntity.id || null,
      domain: listing.domain || null,
      user_id: userId,
      payload: {
        deal_id,
        deal_status,
        listing_name: entityName,
        listing_state: listing.state,
        entity_created: isNewListing,
        is_collateral_update: isOmUpdate || false,
        t011_queued: pipelineResult.t011_same_asset?.queued || 0,
        t012_queued: pipelineResult.t012_geographic?.queued || 0,
        total_queued: pipelineResult.total_queued || 0
      },
      outcome: 'positive'
    });

    return res.status(200).json({
      ok: true,
      entity_id: listingEntity.id,
      action: isNewListing ? 'created' : 'updated',
      listing_name: entityName,
      listing_state: listing.state,
      domain: listing.domain,
      ...(isOmUpdate ? { collateral_updated: { om_url: listing.om_url || null, website_url: listing.website_url || null } } : {}),
      listing_bd_pipeline: isNewListing ? pipelineResult : { skipped: true, reason: 'Entity already exists — BD pipeline ran on initial creation' },
      message: isNewListing
        ? `Listing entity created and ${pipelineResult.total_queued} BD drafts queued for review`
        : `Listing entity updated${isOmUpdate ? ' with new collateral' : ''}`
    });

  } catch (err) {
    console.error('[Listing webhook error]', err);
    return res.status(500).json({
      error: 'Internal error processing listing webhook',
      detail: err?.message || String(err)
    });
  }
}
