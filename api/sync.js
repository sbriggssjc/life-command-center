// ============================================================================
// Sync Orchestration API — Per-user connector data ingestion
// Life Command Center — Phase 3: Outlook & Salesforce Connector Rollout
//
// POST /api/sync?action=ingest_emails          — ingest flagged emails for user
// POST /api/sync?action=ingest_calendar         — ingest calendar events for user
// POST /api/sync?action=ingest_sf_activities    — ingest Salesforce activities for user
// POST /api/sync?action=outbound                — send outbound command (log to SF, etc.)
// GET  /api/sync?action=health                  — connector health summary
// GET  /api/sync?action=jobs&connector_id=      — sync job history
// POST /api/sync?action=retry&error_id=         — retry a failed sync error
//
// This endpoint mediates between:
//   - The existing edge functions (ai-copilot) that talk to Salesforce/Outlook
//   - The canonical data model (inbox_items, activity_events, sync_jobs)
//   - Per-user connector bindings (connector_accounts)
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, requireOps } from './_shared/ops-db.js';
import { ACTIVITY_CATEGORIES, buildTransitionActivity } from './_shared/lifecycle.js';

// Edge function base URL (existing ai-copilot deployment)
const EDGE_FN_URL = process.env.EDGE_FUNCTION_URL || 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot';

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

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

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
      case 'retry':               return await handleRetry(req, res, user, workspaceId);
      case 'verify_connector':    return await handleVerifyConnector(req, res, user, workspaceId);
      default:
        return res.status(400).json({ error: 'Invalid POST action. Use: ingest_emails, ingest_calendar, ingest_sf_activities, outbound, retry, verify_connector' });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

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
    return res.status(500).json({ error: 'Email ingestion failed', detail: e.message, sync_job_id: job.id });
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
    return res.status(500).json({ error: 'Calendar ingestion failed', detail: e.message, sync_job_id: job.id });
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
    const edgeRes = await fetch(`${EDGE_FN_URL}/sync/sf-activities?limit=5000&sort_dir=desc&assigned_to=all`, {
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
    return res.status(500).json({ error: 'Salesforce ingestion failed', detail: e.message, sync_job_id: job.id });
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

  return res.status(502).json({
    error: 'Outbound command failed after retries',
    sync_job_id: job.id,
    correlation_id: correlationId,
    attempts: retries + 1,
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

  const connectorList = connectors.data || [];
  const summary = {
    total_connectors: connectorList.length,
    healthy: connectorList.filter(c => c.status === 'healthy').length,
    degraded: connectorList.filter(c => c.status === 'degraded').length,
    error: connectorList.filter(c => c.status === 'error').length,
    disconnected: connectorList.filter(c => c.status === 'disconnected').length,
    pending: connectorList.filter(c => c.status === 'pending_setup').length
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
    recent_jobs: recentJobs.data || [],
    unresolved_errors: unresolvedErrors.data || [],
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
