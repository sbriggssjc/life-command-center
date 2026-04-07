// ============================================================================
// Unified Queue & Inbox API — Consolidated: queue (v1) + queue-v2 + inbox
// Life Command Center
//
// V1 (original):
// GET /api/queue?view=my_work|team|inbox|sync_exceptions|research|entity_timeline|counts
//
// V2 (paginated, instrumented) — routed via vercel.json:
//   /api/queue-v2 → /api/queue?_version=v2
// GET /api/queue?_version=v2&view=my_work|team_queue|inbox|research|work_counts|entity_timeline|_perf
//
// Inbox (routed via vercel.json: /api/inbox → /api/queue?_route=inbox):
// GET    /api/inbox                     — list inbox items (filterable)
// GET    /api/inbox?id=<uuid>           — get single item
// POST   /api/inbox                     — create inbox item
// PATCH  /api/inbox?id=<uuid>           — update/transition inbox item
// POST   /api/inbox?action=promote&id=  — promote to action item
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, paginationParams, pgFilterVal, requireOps, withErrorHandler } from './_shared/ops-db.js';
import { getAiConfig } from './_shared/ai.js';
import {
  canTransitionInbox, inboxTransitionEffects, buildTransitionActivity,
  INBOX_TRANSITIONS, PRIORITIES, VISIBILITY_SCOPES, INBOX_SOURCE_TYPES, isValidEnum
} from './_shared/lifecycle.js';
import { writeTriageSignal, writePromotionSignal } from './_shared/signals.js';

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const membership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

  // Dispatch to inbox handler if routed via _route=inbox
  if (req.query._route === 'inbox') {
    return handleInbox(req, res, user, workspaceId);
  }

  // Allow POST for _perf beacon (performance telemetry from navigator.sendBeacon)
  if (req.method === 'POST' && req.query?.view === '_perf') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET is supported on the queue endpoint' });
  }

  // Dispatch to v2 if requested
  if (req.query._version === 'v2') {
    return handleV2(req, res, user, workspaceId);
  }

  const { view, entity_id, domain } = req.query;

  switch (view) {
    case 'my_work': {
      let path = `v_my_work?workspace_id=eq.${workspaceId}&or=(user_id.eq.${user.id},assigned_to.eq.${user.id})`;
      if (domain) path += `&domain=eq.${pgFilterVal(domain)}`;
      path += paginationParams({ ...req.query, order: req.query.order || 'sort_date.asc.nullslast' });

      const result = await opsQuery('GET', path);
      return res.status(200).json({ items: result.data || [], count: result.count, view: 'my_work' });
    }

    case 'team': {
      let path = `v_team_queue?workspace_id=eq.${workspaceId}`;
      if (domain) path += `&domain=eq.${pgFilterVal(domain)}`;
      if (req.query.assigned_to) path += `&assigned_to=eq.${pgFilterVal(req.query.assigned_to)}`;
      if (req.query.status) path += `&status=eq.${pgFilterVal(req.query.status)}`;
      path += paginationParams({ ...req.query, order: req.query.order || 'due_date.asc.nullslast,created_at.desc' });

      const result = await opsQuery('GET', path);
      return res.status(200).json({ items: result.data || [], count: result.count, view: 'team' });
    }

    case 'inbox': {
      let path = `v_inbox_triage?workspace_id=eq.${workspaceId}`;
      if (domain) path += `&domain=eq.${pgFilterVal(domain)}`;
      if (req.query.source_type) path += `&source_type=eq.${pgFilterVal(req.query.source_type)}`;
      if (req.query.assigned_to) path += `&assigned_to=eq.${pgFilterVal(req.query.assigned_to)}`;
      path += paginationParams({ ...req.query, order: req.query.order || 'received_at.desc' });

      const result = await opsQuery('GET', path);
      return res.status(200).json({ items: result.data || [], count: result.count, view: 'inbox' });
    }

    case 'sync_exceptions': {
      let path = `v_sync_exceptions?workspace_id=eq.${workspaceId}`;
      if (req.query.connector_type) path += `&connector_type=eq.${pgFilterVal(req.query.connector_type)}`;
      if (req.query.is_retryable) path += `&is_retryable=eq.${pgFilterVal(req.query.is_retryable)}`;
      path += paginationParams({ ...req.query, order: req.query.order || 'created_at.desc' });

      const result = await opsQuery('GET', path);
      return res.status(200).json({ items: result.data || [], count: result.count, view: 'sync_exceptions' });
    }

    case 'research': {
      let path = `research_tasks?workspace_id=eq.${workspaceId}&select=*,entities(name),users!research_tasks_assigned_to_fkey(display_name),users!research_tasks_created_by_fkey(display_name)`;
      if (domain) path += `&domain=eq.${pgFilterVal(domain)}`;
      if (req.query.assigned_to) path += `&assigned_to=eq.${pgFilterVal(req.query.assigned_to)}`;
      if (req.query.research_type) path += `&research_type=eq.${pgFilterVal(req.query.research_type)}`;
      if (req.query.status === 'active') path += `&status=in.(queued,in_progress)`;
      else if (req.query.status) path += `&status=eq.${pgFilterVal(req.query.status)}`;
      path += paginationParams({ ...req.query, order: req.query.order || 'priority.asc,created_at.asc' });

      const result = await opsQuery('GET', path);
      if (!result.ok) {
        return res.status(result.status || 500).json({ error: 'Failed to fetch research tasks' });
      }
      const rows = Array.isArray(result.data) ? result.data : [];
      const items = rows.map(r => ({
        ...r,
        entity_name: r.entities?.name || null,
        assignee_name: r.users?.display_name || r['users!research_tasks_assigned_to_fkey']?.display_name || null
      }));
      return res.status(200).json({ items, count: result.count, view: 'research' });
    }

    case 'entity_timeline': {
      if (!entity_id) {
        return res.status(400).json({ error: 'entity_id is required for entity_timeline view' });
      }

      let path = `v_entity_timeline?entity_id=eq.${pgFilterVal(entity_id)}&workspace_id=eq.${workspaceId}`;
      path += paginationParams({ ...req.query, order: req.query.order || 'occurred_at.desc' });

      const result = await opsQuery('GET', path);
      return res.status(200).json({ events: result.data || [], count: result.count, view: 'entity_timeline' });
    }

    case 'counts': {
      const result = await opsQuery('GET', `v_work_counts?workspace_id=eq.${workspaceId}`);
      const counts = result.data?.[0] || {
        open_actions: 0, new_inbox: 0, triaged_inbox: 0,
        active_research: 0, unresolved_sync_errors: 0, overdue_actions: 0
      };

      const myActions = await opsQuery('GET',
        `action_items?workspace_id=eq.${workspaceId}&or=(owner_id.eq.${user.id},assigned_to.eq.${user.id})&status=in.(open,in_progress,waiting)&select=id&limit=0`
      );
      const myInbox = await opsQuery('GET',
        `inbox_items?workspace_id=eq.${workspaceId}&or=(source_user_id.eq.${user.id},assigned_to.eq.${user.id})&status=in.(new,triaged)&select=id&limit=0`
      );

      return res.status(200).json({
        view: 'counts',
        workspace: counts,
        user: {
          my_actions: myActions.count || 0,
          my_inbox: myInbox.count || 0
        }
      });
    }

    default:
      return res.status(400).json({
        error: 'Invalid view. Must be one of: my_work, team, inbox, sync_exceptions, research, entity_timeline, counts'
      });
  }
});

// ============================================================================
// V2 HANDLER — Paginated, instrumented queue endpoints
// ============================================================================

async function handleV2(req, res, user, workspaceId) {
  const start = Date.now();
  const { view } = req.query;

  let result;
  switch (view) {
    case 'my_work':       result = await v2GetMyWork(req, user, workspaceId); break;
    case 'team_queue':    result = await v2GetTeamQueue(req, user, workspaceId); break;
    case 'inbox':         result = await v2GetInbox(req, user, workspaceId); break;
    case 'research':      result = await v2GetResearch(req, user, workspaceId); break;
    case 'work_counts':   result = await v2GetWorkCounts(req, user, workspaceId); break;
    case 'entity_timeline': result = await v2GetEntityTimeline(req, user, workspaceId); break;
    case '_perf':           result = await v2GetPerfDashboard(req, user, workspaceId); break;
    default:
      return res.status(400).json({ error: 'view must be: my_work, team_queue, inbox, research, work_counts, entity_timeline, _perf' });
  }

  const duration = Date.now() - start;
  res.setHeader('Server-Timing', `db;dur=${duration}`);
  res.setHeader('X-Response-Time', `${duration}ms`);
  // Allow short caching for work_counts since it's called on every page load/tab switch
  if (view === 'work_counts') {
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
  }

  logPerfMetric(workspaceId, user.id, 'api_latency', `/api/queue-v2?view=${view}`, duration, {
    item_count: result.items?.length || 0,
    page: req.query.page || 1
  });

  return res.status(200).json(result);
}

// ---- V2 PAGINATION HELPERS ----

function v2PageParams(query) {
  const page = Math.max(parseInt(query.page) || 1, 1);
  const perPage = Math.min(Math.max(parseInt(query.per_page) || 25, 1), 100);
  const offset = (page - 1) * perPage;
  return { page, perPage, offset };
}

function v2PaginationMeta(page, perPage, totalCount) {
  const totalPages = Math.ceil(totalCount / perPage);
  return {
    page, per_page: perPage, total: totalCount, total_pages: totalPages,
    has_next: page < totalPages, has_prev: page > 1
  };
}

function v2SortParam(query, defaultSort) {
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

// ---- V2 MY WORK ----

async function v2GetMyWork(req, user, workspaceId) {
  const { page, perPage, offset } = v2PageParams(req.query);
  const { status, domain, priority } = req.query;
  const order = v2SortParam(req.query, 'due_date.asc.nullslast,created_at.desc');

  let path = `v_my_work?workspace_id=eq.${workspaceId}&or=(user_id.eq.${user.id},assigned_to.eq.${user.id})`;

  if (status) {
    if (status === 'overdue') {
      path += `&status=in.(open,in_progress)&due_date=lt.${new Date().toISOString().split('T')[0]}`;
    } else {
      path += `&status=eq.${pgFilterVal(status)}`;
    }
  }
  if (domain) path += `&domain=eq.${pgFilterVal(domain)}`;
  if (priority) path += `&priority=eq.${pgFilterVal(priority)}`;
  path += `&limit=${perPage}&offset=${offset}&order=${order}`;

  const result = await opsQuery('GET', path);
  return { view: 'my_work', items: result.data || [], pagination: v2PaginationMeta(page, perPage, result.count || 0) };
}

// ---- V2 TEAM QUEUE ----

async function v2GetTeamQueue(req, user, workspaceId) {
  const { page, perPage, offset } = v2PageParams(req.query);
  const { status, domain, assigned_to: assignee } = req.query;
  const order = v2SortParam(req.query, 'due_date.asc.nullslast,created_at.desc');

  let path = `v_team_queue?workspace_id=eq.${workspaceId}`;
  if (status) path += `&status=eq.${pgFilterVal(status)}`;
  if (domain) path += `&domain=eq.${pgFilterVal(domain)}`;
  if (assignee === 'none') path += `&assigned_to=is.null`;
  else if (assignee) path += `&assigned_to=eq.${pgFilterVal(assignee)}`;
  path += `&limit=${perPage}&offset=${offset}&order=${order}`;

  const result = await opsQuery('GET', path);
  return { view: 'team_queue', items: result.data || [], pagination: v2PaginationMeta(page, perPage, result.count || 0) };
}

// ---- V2 INBOX ----

async function v2GetInbox(req, user, workspaceId) {
  const { page, perPage, offset } = v2PageParams(req.query);
  const { status, source_type, domain } = req.query;
  const order = v2SortParam(req.query, 'received_at.desc');

  let path = `v_inbox_triage?workspace_id=eq.${workspaceId}`;
  if (status) path += `&status=eq.${pgFilterVal(status)}`;
  if (source_type) path += `&source_type=eq.${pgFilterVal(source_type)}`;
  if (domain) path += `&domain=eq.${pgFilterVal(domain)}`;
  path += `&limit=${perPage}&offset=${offset}&order=${order}`;

  const result = await opsQuery('GET', path);
  return { view: 'inbox', items: result.data || [], pagination: v2PaginationMeta(page, perPage, result.count || 0) };
}

// ---- V2 RESEARCH ----

async function v2GetResearch(req, user, workspaceId) {
  const { page, perPage, offset } = v2PageParams(req.query);
  const { status, domain, research_type } = req.query;
  const order = v2SortParam(req.query, 'priority.asc,created_at.asc');

  let path = `research_tasks?workspace_id=eq.${workspaceId}&select=*,entities(name),users!research_tasks_assigned_to_fkey(display_name),users!research_tasks_created_by_fkey(display_name)`;
  if (status) {
    if (status === 'active') path += `&status=in.(queued,in_progress)`;
    else path += `&status=eq.${pgFilterVal(status)}`;
  }
  if (domain) path += `&domain=eq.${pgFilterVal(domain)}`;
  if (research_type) path += `&research_type=eq.${pgFilterVal(research_type)}`;
  path += `&limit=${perPage}&offset=${offset}&order=${order}`;

  const result = await opsQuery('GET', path);
  if (!result.ok) {
    return { view: 'research', items: [], error: result.data?.message || 'Failed to fetch research tasks', pagination: v2PaginationMeta(page, perPage, 0) };
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  const items = rows.map(r => ({
    ...r,
    entity_name: r.entities?.name || null,
    assignee_name: r['users!research_tasks_assigned_to_fkey']?.display_name || null,
    creator_name: r['users!research_tasks_created_by_fkey']?.display_name || null
  }));
  return { view: 'research', items, pagination: v2PaginationMeta(page, perPage, result.count || 0) };
}

// ---- V2 WORK COUNTS ----

async function v2GetWorkCounts(req, user, workspaceId) {
  // Run both queries in parallel to cut latency in half
  const [result1, userResult1] = await Promise.all([
    opsQuery('GET', `mv_work_counts?workspace_id=eq.${workspaceId}&limit=1`),
    opsQuery('GET', `mv_user_work_counts?workspace_id=eq.${workspaceId}&user_id=eq.${user.id}&limit=1`)
  ]);

  // Fallback: if materialized views are empty, try regular views
  let result = result1;
  if (!result.ok || !result.data?.length) {
    result = await opsQuery('GET', `v_work_counts?workspace_id=eq.${workspaceId}&limit=1`);
  }
  const counts = result.data?.[0] || {};

  let userResult = userResult1;
  if (!userResult.ok || !userResult.data?.length) {
    const myActions = await opsQuery('GET',
      `action_items?workspace_id=eq.${workspaceId}&or=(owner_id.eq.${user.id},assigned_to.eq.${user.id})&status=in.(open,in_progress,waiting)&select=id&limit=0`
    );
    userResult = { data: [{ my_actions: myActions.count || 0, my_inbox: 0 }] };
  }
  const userCounts = userResult.data?.[0] || {};

  return {
    view: 'work_counts',
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

// ---- V2 ENTITY TIMELINE (cursor-based) ----

async function v2GetEntityTimeline(req, user, workspaceId) {
  const { entity_id, cursor } = req.query;
  if (!entity_id) return { error: 'entity_id required', view: 'entity_timeline' };

  const perPage = Math.min(parseInt(req.query.per_page) || 25, 100);
  let path = `v_entity_timeline?entity_id=eq.${entity_id}&workspace_id=eq.${workspaceId}`;
  if (cursor) path += `&occurred_at=lt.${cursor}`;
  path += `&limit=${perPage + 1}&order=occurred_at.desc`;

  const result = await opsQuery('GET', path);
  const items = result.data || [];
  const hasMore = items.length > perPage;
  if (hasMore) items.pop();

  return {
    view: 'entity_timeline', events: items, has_more: hasMore,
    next_cursor: items.length > 0 ? items[items.length - 1].occurred_at : null
  };
}

// ---- V2 PERF DASHBOARD ----

async function v2GetPerfDashboard(req, user, workspaceId) {
  const role = user.memberships?.find(m => m.workspace_id === workspaceId)?.role || 'viewer';
  if (!['owner', 'manager'].includes(role)) {
    return { view: '_perf', error: 'Manager role required for perf dashboard' };
  }

  const section = req.query.section || 'summary';

  if (section === 'summary') {
    const endpoints = await opsQuery('GET', 'v_perf_endpoint_summary?limit=50');
    const mvFreshness = await opsQuery('GET', `v_mv_freshness?workspace_id=eq.${workspaceId}&limit=1`);
    const compliance = await opsQuery('GET', 'v_perf_target_compliance?limit=50');
    const throughput = await opsQuery('GET', 'v_perf_hourly_throughput?limit=48');
    return {
      view: '_perf', section: 'summary',
      endpoints: endpoints.data || [], mv_freshness: mvFreshness.data?.[0] || null,
      compliance: compliance.data || [], throughput: throughput.data || []
    };
  }

  if (section === 'slow') {
    const slow = await opsQuery('GET', 'v_perf_slow_requests?limit=100');
    return { view: '_perf', section: 'slow', slow_requests: slow.data || [] };
  }

  if (section === 'workspace') {
    const ws = await opsQuery('GET', `v_perf_workspace_summary?workspace_id=eq.${workspaceId}&limit=1`);
    return { view: '_perf', section: 'workspace', workspace_perf: ws.data?.[0] || null };
  }

  if (section === 'ai') {
    const aiCfg = getAiConfig();
    const aiMetrics = await opsQuery(
      'GET',
      `perf_metrics?workspace_id=eq.${workspaceId}&metric_type=eq.ai_call&select=endpoint,duration_ms,metadata,created_at&order=created_at.desc&limit=200`
    );
    const rows = aiMetrics.data || [];

    const featureMap = new Map();
    const providerMap = new Map();
    const statusMap = new Map();
    let totalCalls = 0;
    let totalDurationMs = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;
    let totalAttachments = 0;
    let callsWithModel = 0;
    let callsWithUsage = 0;
    let callsWithCacheData = 0;

    for (const row of rows) {
      totalCalls += 1;
      totalDurationMs += Number(row.duration_ms || 0);

      const meta = row.metadata || {};
      const feature = meta.feature || meta.assistant_feature || 'unknown';
      const provider = meta.provider || 'unknown';
      const model = meta.model || 'unknown';
      const chatPolicy = meta.chat_policy || 'manual';
      const status = String(meta.status || 'unknown');
      const attachmentCount = Number(meta.attachment_count || 0);
      const inputTokens = Number(meta.input_tokens || meta.usage?.input_tokens || meta.usage?.prompt_tokens || 0);
      const outputTokens = Number(meta.output_tokens || meta.usage?.output_tokens || meta.usage?.completion_tokens || 0);
      const totalRowTokens = Number(meta.total_tokens || meta.usage?.total_tokens || (inputTokens + outputTokens) || 0);
      const cacheHit = Boolean(meta.cache_hit);
      const cacheReadTokens = Number(meta.cache_read_tokens || 0);
      const hasModel = Boolean(meta.model);
      const hasUsage = Boolean(meta.usage || meta.total_tokens || meta.input_tokens || meta.output_tokens);
      const hasCacheData = Boolean(meta.cache_hit || meta.cache_read_tokens);

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalTokens += totalRowTokens;
      totalAttachments += attachmentCount;
      callsWithModel += hasModel ? 1 : 0;
      callsWithUsage += hasUsage ? 1 : 0;
      callsWithCacheData += hasCacheData ? 1 : 0;

      if (!featureMap.has(feature)) featureMap.set(feature, { feature, calls: 0, total_duration_ms: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, attachments: 0, cache_hits: 0, cache_read_tokens: 0, last_called_at: null });
      const featureRow = featureMap.get(feature);
      featureRow.calls += 1;
      featureRow.total_duration_ms += Number(row.duration_ms || 0);
      featureRow.input_tokens += inputTokens;
      featureRow.output_tokens += outputTokens;
      featureRow.total_tokens += totalRowTokens;
      featureRow.attachments += attachmentCount;
      featureRow.cache_hits += cacheHit ? 1 : 0;
      featureRow.cache_read_tokens += cacheReadTokens;
      featureRow.last_called_at = featureRow.last_called_at || row.created_at || null;

      const providerKey = `${provider}::${model}`;
      if (!providerMap.has(providerKey)) providerMap.set(providerKey, { provider, model, calls: 0, total_duration_ms: 0, total_tokens: 0, cache_hits: 0 });
      const providerRow = providerMap.get(providerKey);
      providerRow.calls += 1;
      providerRow.total_duration_ms += Number(row.duration_ms || 0);
      providerRow.total_tokens += totalRowTokens;
      providerRow.cache_hits += cacheHit ? 1 : 0;

      statusMap.set(`policy:${chatPolicy}`, (statusMap.get(`policy:${chatPolicy}`) || 0) + 1);
      statusMap.set(status, (statusMap.get(status) || 0) + 1);
    }

    const features = [...featureMap.values()]
      .map((row) => ({
        ...row,
        avg_duration_ms: row.calls ? Math.round(row.total_duration_ms / row.calls) : 0,
      }))
      .sort((a, b) => b.calls - a.calls);

    const providers = [...providerMap.values()]
      .map((row) => ({
        ...row,
        avg_duration_ms: row.calls ? Math.round(row.total_duration_ms / row.calls) : 0,
      }))
      .sort((a, b) => b.calls - a.calls);

    const statuses = [...statusMap.entries()]
      .map(([status, calls]) => ({ status, calls }))
      .sort((a, b) => b.calls - a.calls);

    const recent = rows.slice(0, 20).map((row) => ({
      endpoint: row.endpoint,
      duration_ms: row.duration_ms,
      created_at: row.created_at,
      feature: row.metadata?.feature || row.metadata?.assistant_feature || 'unknown',
      provider: row.metadata?.provider || 'unknown',
      model: row.metadata?.model || 'unknown',
      status: row.metadata?.status || 'unknown',
      cache_hit: Boolean(row.metadata?.cache_hit),
      attachment_count: Number(row.metadata?.attachment_count || 0),
      usage: row.metadata?.usage || null,
    }));

    const routeConfig = {
      policy: aiCfg.chatPolicy || 'manual',
      default_provider: aiCfg.provider || 'edge',
      default_model: aiCfg.chatModel || 'gpt-5-mini',
      feature_providers: aiCfg.featureProviders || {},
      feature_models: aiCfg.featureModels || {},
    };
    const overrideCount = Object.keys(routeConfig.feature_providers || {}).length + Object.keys(routeConfig.feature_models || {}).length;
    const rolloutStatus = routeConfig.policy !== 'manual' || overrideCount > 0 ? 'active' : 'manual_only';

    const mismatches = features
      .map((row) => {
        const expectedProvider = routeConfig.feature_providers[row.feature] || routeConfig.default_provider;
        const expectedModel = routeConfig.feature_models[row.feature] || routeConfig.default_model;
        const matchingRecent = rows.filter((metric) => (metric.metadata?.feature || metric.metadata?.assistant_feature || 'unknown') === row.feature);
        const seenProviders = [...new Set(matchingRecent.map((metric) => metric.metadata?.provider || 'unknown'))];
        const seenModels = [...new Set(matchingRecent.map((metric) => metric.metadata?.model || 'unknown'))];
        const providerMismatch = seenProviders.length > 0 && !seenProviders.every((provider) => provider === expectedProvider);
        const modelMismatch = seenModels.some((model) => model !== 'unknown' && model !== expectedModel);
        if (!providerMismatch && !modelMismatch) return null;
        return {
          feature: row.feature,
          expected_provider: expectedProvider,
          expected_model: expectedModel,
          seen_providers: seenProviders,
          seen_models: seenModels,
          calls: row.calls,
        };
      })
      .filter(Boolean);

    return {
      view: '_perf',
      section: 'ai',
      route_config: routeConfig,
      rollout: {
        status: rolloutStatus,
        override_count: overrideCount,
        suggestion:
          rolloutStatus === 'manual_only'
          ? 'Set AI_CHAT_POLICY=balanced or add feature overrides to begin a staged rollout.'
            : mismatches.length > 0
              ? 'Review routing mismatches below before expanding the rollout. Observed traffic does not fully match the configured route.'
              : callsWithUsage < totalCalls
                ? 'Routing is active. Next priority is improving upstream model/usage telemetry coverage so cost tracking is more reliable.'
                : 'Routing is active and telemetry coverage looks healthy. Expand or tighten feature routing based on observed cost and quality.',
      },
      presets: [
        {
          name: 'Manual Edge',
          file: 'AI_CHAT_MANUAL_EDGE_PRESET.env.example',
          description: 'Rollback/default preset that keeps routing effectively off and preserves edge-first behavior.',
          recommended_for: 'Fallback or baseline comparison',
        },
        {
          name: 'Balanced',
          file: 'AI_CHAT_BALANCED_PRESET.env.example',
          description: 'Recommended first rollout: intake/intel/research on local-cost paths, ownership on stronger API reasoning, copilot still on edge.',
          recommended_for: 'Initial staged rollout',
        },
        {
          name: 'Low Cost',
          file: 'AI_CHAT_LOW_COST_PRESET.env.example',
          description: 'More aggressive cost-reduction preset that shifts most chat traffic to local Ollama while preserving stronger ownership reasoning.',
          recommended_for: 'Post-balanced optimization',
        },
      ],
      summary: {
        total_calls: totalCalls,
        avg_duration_ms: totalCalls ? Math.round(totalDurationMs / totalCalls) : 0,
        total_input_tokens: totalInputTokens,
        total_output_tokens: totalOutputTokens,
        total_tokens: totalTokens,
        total_attachments: totalAttachments,
        cache_hits: rows.filter((row) => row.metadata?.cache_hit).length,
        calls_with_model: callsWithModel,
        calls_with_usage: callsWithUsage,
        calls_with_cache_data: callsWithCacheData,
        model_coverage_pct: totalCalls ? Math.round((callsWithModel / totalCalls) * 100) : 0,
        usage_coverage_pct: totalCalls ? Math.round((callsWithUsage / totalCalls) * 100) : 0,
        cache_coverage_pct: totalCalls ? Math.round((callsWithCacheData / totalCalls) * 100) : 0,
      },
      features,
      providers,
      statuses,
      mismatches,
      recent,
    };
  }

  return { view: '_perf', error: 'section must be: summary, slow, workspace, ai' };
}

// ---- PERF METRIC LOGGING (fire-and-forget) ----

async function logPerfMetric(workspaceId, userId, metricType, endpoint, durationMs, metadata) {
  try {
    await opsQuery('POST', 'perf_metrics', {
      workspace_id: workspaceId, user_id: userId, metric_type: metricType,
      endpoint, duration_ms: durationMs, metadata
    });
  } catch {
    // Fire-and-forget
  }
}

// ============================================================================
// INBOX — Merged from inbox.js (triage, promote, assign, dismiss)
// ============================================================================

async function handleInbox(req, res, user, workspaceId) {
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
      return await inboxPromoteToAction(req, res, user, workspaceId);
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

      // Write triage_decision signal to learning loop (fire-and-forget)
      writeTriageSignal(current, status, user, {
        ai_classification: current.metadata?.ai_classification || null,
        ai_confidence: current.metadata?.ai_confidence || null,
      });
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
}

/**
 * Promote an inbox item to an action item.
 */
async function inboxPromoteToAction(req, res, user, workspaceId) {
  const inboxId = req.query.id;

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

  const { action_type, title, description, priority, assigned_to, due_date, visibility } = req.body || {};

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

  await opsQuery('PATCH',
    `inbox_items?id=eq.${inboxId}&workspace_id=eq.${workspaceId}`,
    { status: 'promoted', updated_at: new Date().toISOString() }
  );

  const activity = buildTransitionActivity({
    user, workspace_id: workspaceId,
    entity_id: inbox.entity_id,
    category: 'status_change',
    title: `Promoted "${inbox.title}" from inbox to action`,
    item_type: 'action', item_id: createdAction.id,
    domain: inbox.domain
  });
  await opsQuery('POST', 'activity_events', activity);

  // Write promotion signal to learning loop (fire-and-forget)
  writePromotionSignal(inbox, createdAction, user);

  return res.status(201).json({
    action: createdAction,
    inbox_status: 'promoted'
  });
}
