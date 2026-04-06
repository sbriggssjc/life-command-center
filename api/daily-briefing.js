// ============================================================================
// Daily Briefing API — Unified read-only daily snapshot orchestration
// Life Command Center
//
// GET /api/daily-briefing?action=snapshot
// ============================================================================

import { authenticate, handleCors } from './_shared/auth.js';
import { opsQuery, requireOps, withErrorHandler } from './_shared/ops-db.js';

const MORNING_STRUCTURED_URL = process.env.MORNING_BRIEFING_STRUCTURED_URL || '';
const MORNING_HTML_URL = process.env.MORNING_BRIEFING_HTML_URL || '';

function pickRoleView(requested, membershipRole) {
  if (requested === 'analyst_ops' || requested === 'broker' || requested === 'manager') return requested;
  if (membershipRole === 'owner' || membershipRole === 'manager') return 'manager';
  if (membershipRole === 'operator' || membershipRole === 'viewer') return 'analyst_ops';
  return 'broker';
}

function pickAudience(roleView) {
  if (roleView === 'manager') return 'manager';
  if (roleView === 'analyst_ops') return 'team';
  return 'user';
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeMorningStructured(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const gmi = raw.global_market_intelligence || {};
  const summary =
    gmi.summary ||
    raw.summary ||
    raw.executive_summary ||
    raw.briefing_summary ||
    null;

  const normalized = {
    source_system: raw.source_system || gmi.source_system || 'morning_briefing',
    summary,
    highlights: toArray(gmi.highlights?.length ? gmi.highlights : raw.highlights),
    sector_signals: toArray(gmi.sector_signals?.length ? gmi.sector_signals : raw.sector_signals),
    watchlist: toArray(gmi.watchlist?.length ? gmi.watchlist : raw.watchlist),
    html_fragment: gmi.html_fragment || raw.html_fragment || raw.html || null,
    source_links: toArray(gmi.source_links?.length ? gmi.source_links : raw.source_links)
  };

  const hasContent = !!(
    normalized.summary ||
    normalized.highlights.length ||
    normalized.sector_signals.length ||
    normalized.watchlist.length ||
    normalized.html_fragment
  );
  return hasContent ? normalized : null;
}

function safeDateOnly(iso) {
  const value = iso || new Date().toISOString();
  return value.split('T')[0];
}

function buildBriefingId(asOf, workspaceId, userId, roleView) {
  return `${safeDateOnly(asOf)}:workspace:${workspaceId}:user:${userId}:role:${roleView}`;
}

async function fetchMorningStructured() {
  if (!MORNING_STRUCTURED_URL) return { ok: false, missing: true, reason: 'structured_url_not_configured' };
  try {
    const res = await fetch(MORNING_STRUCTURED_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, missing: true, reason: `structured_http_${res.status}` };
    const payload = await res.json();
    const normalized = normalizeMorningStructured(payload);
    if (!normalized) return { ok: false, missing: true, reason: 'structured_payload_empty' };
    return { ok: true, data: normalized };
  } catch (err) {
    return { ok: false, missing: true, reason: `structured_fetch_error:${err.message}` };
  }
}

async function fetchMorningHtml() {
  if (!MORNING_HTML_URL) return { ok: false, missing: true, reason: 'html_url_not_configured' };
  try {
    const res = await fetch(MORNING_HTML_URL, { headers: { Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' } });
    if (!res.ok) return { ok: false, missing: true, reason: `html_http_${res.status}` };
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const body = await res.json();
      const html = body?.html || body?.html_fragment || null;
      return html
        ? { ok: true, data: html }
        : { ok: false, missing: true, reason: 'html_json_payload_empty' };
    }
    const html = await res.text();
    return html && html.trim()
      ? { ok: true, data: html.trim() }
      : { ok: false, missing: true, reason: 'html_payload_empty' };
  } catch (err) {
    return { ok: false, missing: true, reason: `html_fetch_error:${err.message}` };
  }
}

async function fetchWorkCounts(workspaceId, userId) {
  const [teamMv, userMv] = await Promise.all([
    opsQuery('GET', `mv_work_counts?workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`),
    opsQuery('GET', `mv_user_work_counts?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`)
  ]);

  let team = teamMv;
  if (!team.ok || !team.data?.length) {
    team = await opsQuery('GET', `v_work_counts?workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`);
  }
  const t = team.data?.[0] || {};

  let user = userMv;
  if (!user.ok || !user.data?.length) {
    const myActions = await opsQuery('GET',
      `action_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&or=(owner_id.eq.${encodeURIComponent(userId)},assigned_to.eq.${encodeURIComponent(userId)})&status=in.(open,in_progress,waiting)&select=id&limit=0`
    );
    user = { data: [{ my_actions: myActions.count || 0, my_overdue: 0, my_inbox: 0, my_research: 0, my_completed_week: 0 }] };
  }
  const u = user.data?.[0] || {};

  return {
    my_actions: u.my_actions || 0,
    my_overdue: u.my_overdue || 0,
    my_inbox: u.my_inbox || 0,
    my_research: u.my_research || 0,
    my_completed_week: u.my_completed_week || 0,
    open_actions: t.open_actions || 0,
    inbox_new: t.inbox_new || 0,
    inbox_triaged: t.inbox_triaged || 0,
    research_active: t.research_active || 0,
    sync_errors: t.sync_errors || 0,
    overdue: t.overdue_actions || 0,
    due_this_week: t.due_this_week || 0,
    completed_week: t.completed_week || 0,
    open_escalations: t.open_escalations || 0,
    refreshed_at: t.refreshed_at || null
  };
}

async function fetchMyWork(workspaceId, userId, limit = 15) {
  const path =
    `v_my_work?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&or=(user_id.eq.${encodeURIComponent(userId)},assigned_to.eq.${encodeURIComponent(userId)})` +
    `&limit=${Math.max(1, Math.min(limit, 50))}` +
    `&order=due_date.asc.nullslast,created_at.desc`;
  const result = await opsQuery('GET', path);
  return Array.isArray(result.data) ? result.data : [];
}

async function fetchInboxSummary(workspaceId, limit = 10) {
  const path =
    `v_inbox_triage?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&limit=${Math.max(1, Math.min(limit, 50))}` +
    '&order=received_at.desc';
  const [items, newCount, triagedCount] = await Promise.all([
    opsQuery('GET', path),
    opsQuery('GET', `inbox_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.new&select=id&limit=0`),
    opsQuery('GET', `inbox_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.triaged&select=id&limit=0`)
  ]);
  return {
    total_new: newCount.count || 0,
    total_triaged: triagedCount.count || 0,
    items: Array.isArray(items.data) ? items.data : []
  };
}

async function fetchUnassignedWork(workspaceId, limit = 10) {
  const path =
    `v_unassigned_work?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&limit=${Math.max(1, Math.min(limit, 50))}` +
    '&order=created_at.desc';
  const result = await opsQuery('GET', path);
  return Array.isArray(result.data) ? result.data : [];
}

async function fetchSyncHealthSnapshot(workspaceId) {
  const [connectors, recentJobs, unresolvedErrors, openSfTasks] = await Promise.all([
    opsQuery('GET',
      `connector_accounts?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,user_id,connector_type,status,last_sync_at,last_error,external_user_id&order=connector_type,display_name`
    ),
    opsQuery('GET',
      `sync_jobs?workspace_id=eq.${encodeURIComponent(workspaceId)}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&select=id,status,direction,entity_type,records_processed,records_failed,completed_at&order=created_at.desc&limit=50`
    ),
    opsQuery('GET',
      `sync_errors?workspace_id=eq.${encodeURIComponent(workspaceId)}&resolved_at=is.null&select=id,error_message,is_retryable,retry_count,created_at&order=created_at.desc&limit=25`
    ),
    opsQuery('GET',
      `inbox_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&source_type=eq.sf_task&status=in.(new,triaged)&select=id&limit=1`
    )
  ]);

  const connectorList = connectors.data || [];
  const jobs = recentJobs.data || [];
  const outboundTracked = jobs.filter((job) => job.direction === 'outbound' && ['completed', 'failed', 'partial'].includes(job.status));
  const outboundCompleted = outboundTracked.filter((job) => job.status === 'completed').length;
  const latestSfInbound = jobs.find((job) => job.entity_type === 'sf_activity' && ['completed', 'partial'].includes(job.status));
  const sfOpenTaskCount = openSfTasks.count || 0;
  const sfLastProcessed = Number(latestSfInbound?.records_processed || 0);
  const estimatedGap = Math.max(sfOpenTaskCount - sfLastProcessed, 0);

  return {
    summary: {
      total_connectors: connectorList.length,
      healthy: connectorList.filter((c) => c.status === 'healthy').length,
      degraded: connectorList.filter((c) => c.status === 'degraded').length,
      error: connectorList.filter((c) => c.status === 'error').length,
      disconnected: connectorList.filter((c) => c.status === 'disconnected').length,
      pending: connectorList.filter((c) => c.status === 'pending_setup').length,
      outbound_success_rate_24h: outboundTracked.length ? Number((outboundCompleted / outboundTracked.length).toFixed(3)) : null
    },
    unresolved_errors: unresolvedErrors.data || [],
    queue_drift: {
      source: 'salesforce',
      salesforce_open_task_count: sfOpenTaskCount,
      last_sf_records_processed: sfLastProcessed,
      estimated_gap: estimatedGap,
      drift_flag: estimatedGap > 25,
      last_inbound_completed_at: latestSfInbound?.completed_at || null
    }
  };
}

function mapPriorityItems(items, limit = 5) {
  return items.slice(0, limit).map((item) => ({
    id: item.id,
    title: item.title || '(Untitled)',
    status: item.status || null,
    priority: item.priority || null,
    due_date: item.due_date || null,
    domain: item.domain || null,
    type: item.item_type || item.source_type || 'action'
  }));
}

function projectPriorities(roleView, myWork, inboxSummary, unassignedWork, syncHealth, workCounts) {
  const today = new Date();
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + 7);

  const overdue = myWork.filter((item) => item.due_date && new Date(item.due_date) < today);
  const dueThisWeek = myWork.filter((item) => {
    if (!item.due_date) return false;
    const due = new Date(item.due_date);
    return due >= today && due <= weekEnd;
  });

  const callRegex = /call|owner|prospect|follow[- ]?up|outreach/i;
  const recommendedCalls = myWork.filter((item) => callRegex.test(item.title || '')).slice(0, 5);
  const recommendedFollowups = inboxSummary.items.slice(0, 5);

  if (roleView === 'manager') {
    // Manager view: team production posture, bottlenecks, escalations
    const managerTop = [];
    // Surface escalations first
    if (workCounts.open_escalations > 0) {
      managerTop.push({
        id: '_escalations',
        title: `${workCounts.open_escalations} open escalation${workCounts.open_escalations > 1 ? 's' : ''} need attention`,
        status: 'needs_review',
        priority: 'urgent',
        due_date: null,
        domain: 'ops',
        source_type: 'escalation'
      });
    }
    // Surface unassigned work
    if (unassignedWork.length > 0) {
      managerTop.push({
        id: '_unassigned',
        title: `${unassignedWork.length} unassigned item${unassignedWork.length > 1 ? 's' : ''} in team queue`,
        status: 'needs_review',
        priority: 'high',
        due_date: null,
        domain: 'ops',
        source_type: 'unassigned'
      });
    }
    // Surface overdue count
    if (workCounts.overdue > 0) {
      managerTop.push({
        id: '_overdue',
        title: `${workCounts.overdue} overdue item${workCounts.overdue > 1 ? 's' : ''} across team`,
        status: 'needs_review',
        priority: 'high',
        due_date: null,
        domain: 'ops',
        source_type: 'overdue'
      });
    }
    // Surface sync errors if significant
    if (workCounts.sync_errors > 3) {
      managerTop.push({
        id: '_sync_errors',
        title: `${workCounts.sync_errors} unresolved sync errors`,
        status: 'needs_review',
        priority: 'normal',
        due_date: null,
        domain: 'ops',
        source_type: 'sync_error'
      });
    }
    // Fill remaining slots with highest-priority team work
    managerTop.push(...overdue.slice(0, 5 - managerTop.length));

    return {
      today_top_5: mapPriorityItems(managerTop, 5),
      my_overdue: mapPriorityItems(overdue, 5),
      my_due_this_week: mapPriorityItems(dueThisWeek, 5),
      recommended_calls: [],
      recommended_followups: mapPriorityItems(unassignedWork, 5)
    };
  }

  if (roleView === 'analyst_ops') {
    const opsTop = [
      ...inboxSummary.items.slice(0, 3),
      ...syncHealth.unresolved_errors.slice(0, 2).map((err) => ({
        id: err.id,
        title: `Sync issue: ${err.error_message || 'error'}`,
        status: 'needs_review',
        priority: err.is_retryable ? 'high' : 'normal',
        due_date: null,
        domain: 'ops',
        source_type: 'sync_error'
      }))
    ];
    return {
      today_top_5: mapPriorityItems(opsTop, 5),
      my_overdue: mapPriorityItems(overdue, 5),
      my_due_this_week: mapPriorityItems(dueThisWeek, 5),
      recommended_calls: mapPriorityItems(recommendedCalls, 3),
      recommended_followups: mapPriorityItems(recommendedFollowups, 5)
    };
  }

  // Broker view: personal production focus
  return {
    today_top_5: mapPriorityItems(myWork, 5),
    my_overdue: mapPriorityItems(overdue, 5),
    my_due_this_week: mapPriorityItems(dueThisWeek, 5),
    recommended_calls: mapPriorityItems(recommendedCalls, 5),
    recommended_followups: mapPriorityItems(recommendedFollowups, 5)
  };
}

function buildActions(roleView) {
  const base = [
    { label: 'Open My Queue', type: 'link', target: '/?tab=queue' },
    { label: 'Open Inbox Triage', type: 'link', target: '/?tab=inbox' },
    { label: 'View Sync Health', type: 'link', target: '/?tab=ops&view=sync-health' }
  ];
  if (roleView === 'analyst_ops' || roleView === 'manager') {
    base.push({ label: 'Review Unassigned Work', type: 'link', target: '/?tab=queue&view=team' });
  }
  if (roleView === 'manager') {
    base.push({ label: 'View Escalations', type: 'link', target: '/?tab=ops&view=escalations' });
  }
  return base;
}

function buildDomainSignals(myWork, inboxSummary, unassignedWork) {
  const govHighlights = [];
  const diaHighlights = [];

  for (const item of myWork) {
    if (item.domain === 'government') govHighlights.push(item.title || '(Untitled)');
    if (item.domain === 'dialysis') diaHighlights.push(item.title || '(Untitled)');
  }
  for (const item of inboxSummary.items || []) {
    if (item.domain === 'government') govHighlights.push(item.title || '(Untitled)');
    if (item.domain === 'dialysis') diaHighlights.push(item.title || '(Untitled)');
  }

  const govReview = (unassignedWork || []).filter((item) => item.domain === 'government').slice(0, 5);
  const diaReview = (unassignedWork || []).filter((item) => item.domain === 'dialysis').slice(0, 5);

  return {
    government: {
      highlights: govHighlights.slice(0, 5),
      review_required: mapPriorityItems(govReview, 5),
      freshness_flags: []
    },
    dialysis: {
      highlights: diaHighlights.slice(0, 5),
      review_required: mapPriorityItems(diaReview, 5),
      freshness_flags: []
    }
  };
}

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { action } = req.query;
  if (action !== 'snapshot') {
    return res.status(400).json({ error: 'Invalid action. Use action=snapshot' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships?.[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const membership = user.memberships?.find((m) => m.workspace_id === workspaceId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

  const roleView = pickRoleView(req.query.role_view, membership.role);
  const asOf = new Date().toISOString();

  const [morningStructured, morningHtml, workCounts, myWork, inboxSummary, unassignedWork, syncHealth] = await Promise.all([
    fetchMorningStructured(),
    fetchMorningHtml(),
    fetchWorkCounts(workspaceId, user.id),
    fetchMyWork(workspaceId, user.id, 15),
    fetchInboxSummary(workspaceId, 10),
    fetchUnassignedWork(workspaceId, 10),
    fetchSyncHealthSnapshot(workspaceId)
  ]);

  const missingSections = [];
  let globalMarketIntelligence = morningStructured.ok ? morningStructured.data : null;

  if (!morningStructured.ok) {
    missingSections.push('global_market_intelligence.structured_payload');
    if (morningHtml.ok) {
      globalMarketIntelligence = {
        source_system: 'morning_briefing',
        summary: null,
        highlights: [],
        sector_signals: [],
        watchlist: [],
        html_fragment: morningHtml.data,
        source_links: []
      };
    } else {
      missingSections.push('global_market_intelligence.html_fragment');
      globalMarketIntelligence = {
        source_system: 'morning_briefing',
        summary: null,
        highlights: [],
        sector_signals: [],
        watchlist: [],
        html_fragment: null,
        source_links: []
      };
    }
  } else if (!globalMarketIntelligence.html_fragment && morningHtml.ok) {
    globalMarketIntelligence.html_fragment = morningHtml.data;
  }

  const payload = {
    briefing_id: buildBriefingId(asOf, workspaceId, user.id, roleView),
    as_of: asOf,
    timezone: 'America/Chicago',
    workspace_id: workspaceId,
    audience: pickAudience(roleView),
    role_view: roleView,
    status: {
      completeness: missingSections.length > 0 ? 'degraded' : 'full',
      missing_sections: missingSections
    },
    global_market_intelligence: globalMarketIntelligence,
    user_specific_priorities: projectPriorities(roleView, myWork, inboxSummary, unassignedWork, syncHealth, workCounts),
    team_level_production_signals: {
      work_counts: {
        open_actions: workCounts.open_actions,
        inbox_new: workCounts.inbox_new,
        inbox_triaged: workCounts.inbox_triaged,
        research_active: workCounts.research_active,
        sync_errors: workCounts.sync_errors,
        overdue: workCounts.overdue,
        due_this_week: workCounts.due_this_week,
        completed_week: workCounts.completed_week,
        open_escalations: workCounts.open_escalations,
        refreshed_at: workCounts.refreshed_at
      },
      inbox_summary: inboxSummary,
      unassigned_work: unassignedWork,
      sync_health: syncHealth
    },
    domain_specific_alerts_highlights: buildDomainSignals(myWork, inboxSummary, unassignedWork),
    actions: buildActions(roleView)
  };

  return res.status(200).json(payload);
});
