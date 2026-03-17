// ============================================================================
// Queue V2 API — Paginated, instrumented queue endpoints
// Life Command Center — Phase 6: Performance Optimization
//
// GET /api/queue-v2?view=my_work&page=1&per_page=25&status=open&domain=&sort=due_date
// GET /api/queue-v2?view=team_queue&page=1&per_page=25
// GET /api/queue-v2?view=inbox&page=1&per_page=25&status=new
// GET /api/queue-v2?view=research&page=1&per_page=25
// GET /api/queue-v2?view=work_counts  — uses materialized views (fast)
// GET /api/queue-v2?view=entity_timeline&entity_id=<uuid>&cursor=<iso_date>
// ============================================================================

import { authenticate, handleCors } from './_shared/auth.js';
import { opsQuery, requireOps } from './_shared/ops-db.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const start = Date.now();

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const { view } = req.query;

  let result;
  switch (view) {
    case 'my_work':       result = await getMyWork(req, user, workspaceId); break;
    case 'team_queue':    result = await getTeamQueue(req, user, workspaceId); break;
    case 'inbox':         result = await getInbox(req, user, workspaceId); break;
    case 'research':      result = await getResearch(req, user, workspaceId); break;
    case 'work_counts':   result = await getWorkCounts(req, user, workspaceId); break;
    case 'entity_timeline': result = await getEntityTimeline(req, user, workspaceId); break;
    case '_perf':           result = await getPerfDashboard(req, user, workspaceId); break;
    default:
      return res.status(400).json({ error: 'view must be: my_work, team_queue, inbox, research, work_counts, entity_timeline, _perf' });
  }

  // Add server timing header for instrumentation
  const duration = Date.now() - start;
  res.setHeader('Server-Timing', `db;dur=${duration}`);
  res.setHeader('X-Response-Time', `${duration}ms`);

  // Log perf metric (fire-and-forget)
  logPerfMetric(workspaceId, user.id, 'api_latency', `/api/queue-v2?view=${view}`, duration, {
    item_count: result.items?.length || 0,
    page: req.query.page || 1
  });

  return res.status(200).json(result);
}

// ============================================================================
// PAGINATION HELPERS
// ============================================================================

function pageParams(query) {
  const page = Math.max(parseInt(query.page) || 1, 1);
  const perPage = Math.min(Math.max(parseInt(query.per_page) || 25, 1), 100);
  const offset = (page - 1) * perPage;
  return { page, perPage, offset };
}

function paginationMeta(page, perPage, totalCount) {
  const totalPages = Math.ceil(totalCount / perPage);
  return {
    page,
    per_page: perPage,
    total: totalCount,
    total_pages: totalPages,
    has_next: page < totalPages,
    has_prev: page > 1
  };
}

function sortParam(query, defaultSort) {
  const ALLOWED_SORTS = {
    due_date: 'due_date.asc.nullslast',
    created_at: 'created_at.desc',
    updated_at: 'updated_at.desc',
    priority: 'priority.asc,created_at.desc',
    status: 'status.asc,created_at.desc',
    title: 'title.asc'
  };
  return ALLOWED_SORTS[query.sort] || defaultSort;
}

// ============================================================================
// MY WORK — with proper pagination
// ============================================================================

async function getMyWork(req, user, workspaceId) {
  const { page, perPage, offset } = pageParams(req.query);
  const { status, domain, priority } = req.query;
  const order = sortParam(req.query, 'due_date.asc.nullslast,created_at.desc');

  let path = `v_my_work?workspace_id=eq.${workspaceId}&or=(user_id.eq.${user.id},assigned_to.eq.${user.id})`;

  if (status) {
    if (status === 'overdue') {
      path += `&status=in.(open,in_progress)&due_date=lt.${new Date().toISOString().split('T')[0]}`;
    } else {
      path += `&status=eq.${status}`;
    }
  }
  if (domain) path += `&domain=eq.${domain}`;
  if (priority) path += `&priority=eq.${priority}`;

  path += `&limit=${perPage}&offset=${offset}&order=${order}`;

  const result = await opsQuery('GET', path);
  return {
    view: 'my_work',
    items: result.data || [],
    pagination: paginationMeta(page, perPage, result.count || 0)
  };
}

// ============================================================================
// TEAM QUEUE — with pagination + filters
// ============================================================================

async function getTeamQueue(req, user, workspaceId) {
  const { page, perPage, offset } = pageParams(req.query);
  const { status, domain, assigned_to: assignee } = req.query;
  const order = sortParam(req.query, 'due_date.asc.nullslast,created_at.desc');

  let path = `v_team_queue?workspace_id=eq.${workspaceId}`;
  if (status) path += `&status=eq.${status}`;
  if (domain) path += `&domain=eq.${domain}`;
  if (assignee === 'none') path += `&assigned_to=is.null`;
  else if (assignee) path += `&assigned_to=eq.${assignee}`;

  path += `&limit=${perPage}&offset=${offset}&order=${order}`;

  const result = await opsQuery('GET', path);
  return {
    view: 'team_queue',
    items: result.data || [],
    pagination: paginationMeta(page, perPage, result.count || 0)
  };
}

// ============================================================================
// INBOX — with pagination + source type filter
// ============================================================================

async function getInbox(req, user, workspaceId) {
  const { page, perPage, offset } = pageParams(req.query);
  const { status, source_type, domain } = req.query;
  const order = sortParam(req.query, 'received_at.desc');

  let path = `v_inbox_triage?workspace_id=eq.${workspaceId}`;
  if (status) path += `&status=eq.${status}`;
  if (source_type) path += `&source_type=eq.${source_type}`;
  if (domain) path += `&domain=eq.${domain}`;

  path += `&limit=${perPage}&offset=${offset}&order=${order}`;

  const result = await opsQuery('GET', path);
  return {
    view: 'inbox',
    items: result.data || [],
    pagination: paginationMeta(page, perPage, result.count || 0)
  };
}

// ============================================================================
// RESEARCH — with pagination
// ============================================================================

async function getResearch(req, user, workspaceId) {
  const { page, perPage, offset } = pageParams(req.query);
  const { status, domain, research_type } = req.query;
  const order = sortParam(req.query, 'priority.asc,created_at.asc');

  let path = `v_research_queue?workspace_id=eq.${workspaceId}`;
  if (status) {
    if (status === 'active') path += `&status=in.(queued,in_progress)`;
    else path += `&status=eq.${status}`;
  }
  if (domain) path += `&domain=eq.${domain}`;
  if (research_type) path += `&research_type=eq.${research_type}`;

  path += `&limit=${perPage}&offset=${offset}&order=${order}`;

  const result = await opsQuery('GET', path);
  return {
    view: 'research',
    items: result.data || [],
    pagination: paginationMeta(page, perPage, result.count || 0)
  };
}

// ============================================================================
// WORK COUNTS — from materialized views (fast, no joins)
// Falls back to regular view if MV doesn't exist yet
// ============================================================================

async function getWorkCounts(req, user, workspaceId) {
  // Try materialized view first (fast path)
  let result = await opsQuery('GET', `mv_work_counts?workspace_id=eq.${workspaceId}&limit=1`);

  if (!result.ok || !result.data?.length) {
    // Fall back to regular view
    result = await opsQuery('GET', `v_work_counts?workspace_id=eq.${workspaceId}&limit=1`);
  }

  const counts = result.data?.[0] || {};

  // User-specific counts from MV
  let userResult = await opsQuery('GET',
    `mv_user_work_counts?workspace_id=eq.${workspaceId}&user_id=eq.${user.id}&limit=1`
  );

  if (!userResult.ok || !userResult.data?.length) {
    // Fall back to counted queries
    const myActions = await opsQuery('GET',
      `action_items?workspace_id=eq.${workspaceId}&or=(owner_id.eq.${user.id},assigned_to.eq.${user.id})&status=in.(open,in_progress,waiting)&select=id&limit=0`
    );
    userResult = { data: [{ my_actions: myActions.count || 0, my_inbox: 0 }] };
  }

  const userCounts = userResult.data?.[0] || {};

  return {
    view: 'work_counts',
    // Flat structure for easy consumption by ops.js
    my_actions: userCounts.my_actions || 0,
    my_overdue: userCounts.my_overdue || 0,
    my_inbox: userCounts.my_inbox || 0,
    my_research: userCounts.my_research || 0,
    my_completed_week: userCounts.my_completed_week || 0,
    open_actions: counts.open_actions || 0,
    in_progress: counts.in_progress_actions || 0,
    team_actions: counts.open_actions || 0,
    inbox_new: counts.inbox_new || 0,
    inbox_triaged: counts.inbox_triaged || 0,
    overdue: counts.overdue_actions || 0,
    due_this_week: counts.due_this_week || 0,
    completed_week: counts.completed_week || 0,
    research_active: counts.research_active || 0,
    sync_errors: counts.sync_errors || 0,
    total_entities: counts.total_entities || 0,
    open_escalations: counts.open_escalations || 0,
    refreshed_at: counts.refreshed_at
  };
}

// ============================================================================
// ENTITY TIMELINE — cursor-based pagination (for infinite scroll)
// ============================================================================

async function getEntityTimeline(req, user, workspaceId) {
  const { entity_id, cursor } = req.query;
  if (!entity_id) return { error: 'entity_id required', view: 'entity_timeline' };

  const perPage = Math.min(parseInt(req.query.per_page) || 25, 100);
  let path = `v_entity_timeline?entity_id=eq.${entity_id}&workspace_id=eq.${workspaceId}`;

  // Cursor = ISO date of last seen item (fetch older items)
  if (cursor) {
    path += `&occurred_at=lt.${cursor}`;
  }

  path += `&limit=${perPage + 1}&order=occurred_at.desc`;

  const result = await opsQuery('GET', path);
  const items = result.data || [];
  const hasMore = items.length > perPage;
  if (hasMore) items.pop();

  return {
    view: 'entity_timeline',
    events: items,
    has_more: hasMore,
    next_cursor: items.length > 0 ? items[items.length - 1].occurred_at : null
  };
}

// ============================================================================
// PERFORMANCE DASHBOARD — operational perf data (manager+ only)
// ============================================================================

async function getPerfDashboard(req, user, workspaceId) {
  // Require manager+ role for perf dashboard access
  const role = user.memberships?.find(m => m.workspace_id === workspaceId)?.role || 'viewer';
  if (!['owner', 'manager'].includes(role)) {
    return { view: '_perf', error: 'Manager role required for perf dashboard' };
  }

  const section = req.query.section || 'summary';

  if (section === 'summary') {
    // Endpoint latency summary
    const endpoints = await opsQuery('GET', 'v_perf_endpoint_summary?limit=50');
    // MV freshness
    const mvFreshness = await opsQuery('GET', `v_mv_freshness?workspace_id=eq.${workspaceId}&limit=1`);
    // Target compliance
    const compliance = await opsQuery('GET', 'v_perf_target_compliance?limit=50');
    // Hourly throughput
    const throughput = await opsQuery('GET', 'v_perf_hourly_throughput?limit=48');

    return {
      view: '_perf',
      section: 'summary',
      endpoints: endpoints.data || [],
      mv_freshness: mvFreshness.data?.[0] || null,
      compliance: compliance.data || [],
      throughput: throughput.data || []
    };
  }

  if (section === 'slow') {
    // Slow request log
    const slow = await opsQuery('GET', 'v_perf_slow_requests?limit=100');
    return {
      view: '_perf',
      section: 'slow',
      slow_requests: slow.data || []
    };
  }

  if (section === 'workspace') {
    const ws = await opsQuery('GET', `v_perf_workspace_summary?workspace_id=eq.${workspaceId}&limit=1`);
    return {
      view: '_perf',
      section: 'workspace',
      workspace_perf: ws.data?.[0] || null
    };
  }

  return { view: '_perf', error: 'section must be: summary, slow, workspace' };
}

// ============================================================================
// PERF METRIC LOGGING (fire-and-forget)
// ============================================================================

async function logPerfMetric(workspaceId, userId, metricType, endpoint, durationMs, metadata) {
  try {
    await opsQuery('POST', 'perf_metrics', {
      workspace_id: workspaceId,
      user_id: userId,
      metric_type: metricType,
      endpoint,
      duration_ms: durationMs,
      metadata
    });
  } catch {
    // Fire-and-forget — don't fail the main request
  }
}
