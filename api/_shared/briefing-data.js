// ============================================================================
// Briefing Data Helpers — data-fetching and scoring functions for daily briefing
// Life Command Center
//
// Extracted from the former api/daily-briefing.js (deleted in Phase 4b
// consolidation) so that briefing-email-handler.js can continue to import
// these functions without pulling in the full serverless handler.
// ============================================================================

import { fetchWithTimeout, opsQuery } from './ops-db.js';
import { sendTeamsAlert } from './teams-alert.js';

const GOV_URL = process.env.GOV_SUPABASE_URL;
const GOV_KEY = process.env.GOV_SUPABASE_KEY;
const DIA_URL = process.env.DIA_SUPABASE_URL;
const DIA_KEY = process.env.DIA_SUPABASE_KEY;

// ---------------------------------------------------------------------------
// deriveItemTitle
// ---------------------------------------------------------------------------

export function deriveItemTitle(item) {
  if (item == null) return null;
  if (typeof item === 'string') {
    const s = item.trim();
    return s || null;
  }
  if (typeof item !== 'object') return null;

  const direct = [
    item.title,
    item.subject,
    item.name,
    item.headline,
    item.label,
    item.what_name,
    item.full_name,
    item.company_name,
  ];
  for (const c of direct) {
    if (c != null && String(c).trim()) return String(c).trim();
  }

  const meta = (item.metadata && typeof item.metadata === 'object') ? item.metadata : {};
  const sender =
    item.sender_name || item.from_name || meta.sender_name || meta.from_name || null;
  const senderEmail =
    item.sender_email || item.from_email || meta.sender_email || meta.from_email || null;
  const taskType = item.task_type || meta.task_type || null;
  const rawType = String(
    item.item_type || item.source_type || item.type || meta.type || ''
  ).toLowerCase();

  if (rawType.includes('email') || rawType.includes('inbox')) {
    if (sender) return `Email from ${sender}`;
    if (senderEmail) return `Email from ${senderEmail}`;
  }
  if (rawType.includes('call')) {
    if (sender) return `Call with ${sender}`;
  }
  if (rawType.includes('task') || rawType.includes('action')) {
    if (taskType) return `Task: ${taskType}`;
    if (sender) return `Task from ${sender}`;
  }

  const descriptive = item.description || item.text || item.summary;
  if (descriptive && String(descriptive).trim()) {
    return String(descriptive).trim();
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

function mapPriorityItems(items, limit = 5) {
  const mapped = [];
  for (const item of items || []) {
    if (mapped.length >= limit) break;
    const title = deriveItemTitle(item);
    if (!title) continue;
    mapped.push({
      id: item.id,
      title,
      status: item.status || null,
      priority: item.priority || null,
      due_date: item.due_date || null,
      domain: item.domain || null,
      type: item.item_type || item.source_type || 'action'
    });
  }
  return mapped;
}

const DEAL_KEYWORDS = /offer|under contract|loi|letter of intent|closing|escrow|due diligence|earnest money|psa|purchase|disposition|assignment/i;
const REVENUE_KEYWORDS = /commission|fee|listing agreement|exclusive|signed|engaged|retained/i;
const PURSUIT_KEYWORDS = /bov|proposal|valuation|pitch|pursuit|prospect|owner|developer|seller/i;
const RELATIONSHIP_KEYWORDS = /follow[- ]?up|check[- ]?in|touch base|reconnect|introduction|referral|thank you|congrat/i;

function scoreItem(item, hotContactMap) {
  let score = 0;
  let tier = 'urgent';
  const title = (item.title || '').toLowerCase();
  const body = (item.body || '').toLowerCase();
  const combined = title + ' ' + body;
  const senderEmail = item.metadata?.sender_email || '';

  if (DEAL_KEYWORDS.test(combined)) {
    score += 100;
    tier = 'strategic';
  }
  if (REVENUE_KEYWORDS.test(combined)) {
    score += 90;
    tier = 'strategic';
  }
  if (PURSUIT_KEYWORDS.test(combined)) {
    score += 70;
    if (tier !== 'strategic') tier = 'strategic';
  }

  if (RELATIONSHIP_KEYWORDS.test(combined)) {
    score += 50;
    if (tier === 'urgent') tier = 'important';
  }

  if (senderEmail && hotContactMap) {
    const contact = hotContactMap.get(senderEmail.toLowerCase());
    if (contact) {
      score += Math.min(contact.engagement_score || 0, 50);
      if (contact.engagement_score >= 60) tier = tier === 'urgent' ? 'important' : tier;
    }
  }

  if (item.due_date) {
    const due = new Date(item.due_date);
    const now = new Date();
    const daysUntil = (due - now) / 86400000;
    if (daysUntil < 0) score += 40;
    else if (daysUntil < 1) score += 30;
    else if (daysUntil < 3) score += 20;
    else if (daysUntil < 7) score += 10;
  }

  if (item.priority === 'urgent') score += 30;
  else if (item.priority === 'high') score += 20;

  if (item.source_type === 'sf_task') score += 15;
  if (item.source_type === 'flagged_email') score += 10;

  if (item.metadata?.has_attachments) score += 5;

  return { score, tier };
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

export async function fetchWorkCounts(workspaceId, userId) {
  // Single-row materialized-view reads — count header is never consumed.
  const [teamMv, userMv] = await Promise.all([
    opsQuery('GET', `mv_work_counts?workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`, undefined, { countMode: 'none' }),
    opsQuery('GET', `mv_user_work_counts?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`, undefined, { countMode: 'none' })
  ]);

  let team = teamMv;
  let teamSource = 'mv_work_counts';
  if (!team.ok || !team.data?.length) {
    team = await opsQuery('GET', `v_work_counts?workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`, undefined, { countMode: 'none' });
    teamSource = 'v_work_counts';
  }
  let t = team.data?.[0] || {};
  const rawMvRow = { ...t, _source: teamSource, _ok: team.ok, _status: team.status, _row_count: team.data?.length || 0 };

  const wsEnc = encodeURIComponent(workspaceId);
  if (!t.open_actions && !t.inbox_new && !t.overdue_actions) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [openRes, inboxNewRes, syncErrRes, overdueRes] = await Promise.all([
        opsQuery('GET', `action_items?workspace_id=eq.${wsEnc}&status=in.(open,in_progress,waiting,assigned)&select=id&limit=0`),
        opsQuery('GET', `inbox_items?workspace_id=eq.${wsEnc}&status=eq.new&select=id&limit=0`),
        opsQuery('GET', `action_items?workspace_id=eq.${wsEnc}&status=eq.sync_error&select=id&limit=0`),
        opsQuery('GET', `action_items?workspace_id=eq.${wsEnc}&status=in.(open,in_progress)&due_date=lt.${today}&select=id&limit=0`)
      ]);
      t = {
        ...t,
        open_actions: openRes.count || 0,
        inbox_new: inboxNewRes.count || 0,
        sync_errors: (syncErrRes.count || 0) + (t.sync_errors || 0),
        overdue_actions: overdueRes.count || 0,
        _source: 'direct_count_fallback'
      };
      console.log('[Briefing] team signals direct-count fallback used:', { open: t.open_actions, inbox: t.inbox_new, overdue: t.overdue_actions, sync: t.sync_errors });
    } catch (err) {
      console.error('[Briefing] direct-count fallback failed:', err.message);
    }
  }

  let user = userMv;
  if (!user.ok || !user.data?.length) {
    const myActions = await opsQuery('GET',
      `action_items?workspace_id=eq.${wsEnc}&or=(owner_id.eq.${encodeURIComponent(userId)},assigned_to.eq.${encodeURIComponent(userId)})&status=in.(open,in_progress,waiting)&select=id&limit=0`
    );
    user = { data: [{ my_actions: myActions.count || 0, my_overdue: 0, my_inbox: 0, my_research: 0, my_completed_week: 0 }] };
  }
  const u = user.data?.[0] || {};

  const today = new Date().toISOString().slice(0, 10);
  let dueToday = 0;
  try {
    const dueTodayRes = await opsQuery('GET',
      `action_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=in.(open,in_progress,waiting)&due_date=eq.${today}&select=id&limit=0`
    );
    dueToday = dueTodayRes.count || 0;
  } catch (err) {
    console.error('[Briefing] due_today direct-count failed:', err.message);
  }

  const open = Number(t.open_actions || 0);
  const overdue = Number(t.overdue_actions || 0);

  return {
    open,
    overdue,
    due_today: dueToday,
    my_actions: u.my_actions || 0,
    my_overdue: u.my_overdue || 0,
    my_inbox: u.my_inbox || 0,
    my_research: u.my_research || 0,
    my_completed_week: u.my_completed_week || 0,
    open_actions: open,
    inbox_new: t.inbox_new || 0,
    inbox_triaged: t.inbox_triaged || 0,
    research_active: t.research_active || 0,
    sync_errors: t.sync_errors || 0,
    due_this_week: t.due_this_week || 0,
    completed_week: t.completed_week || 0,
    open_escalations: t.open_escalations || 0,
    refreshed_at: t.refreshed_at || null,
    _mv_raw: rawMvRow
  };
}

export async function fetchMyWork(workspaceId, userId, limit = 15) {
  const path =
    `v_my_work?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&or=(user_id.eq.${encodeURIComponent(userId)},assigned_to.eq.${encodeURIComponent(userId)})` +
    `&limit=${Math.max(1, Math.min(limit, 50))}` +
    `&order=due_date.asc.nullslast,created_at.desc`;
  // List read — count header unused.
  const result = await opsQuery('GET', path, undefined, { countMode: 'none' });
  return Array.isArray(result.data) ? result.data : [];
}

export async function fetchInboxSummary(workspaceId, limit = 10) {
  const path =
    `v_inbox_triage?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&limit=${Math.max(1, Math.min(limit, 50))}` +
    '&order=received_at.desc';
  // Items list reads .data only; the two count probes (select=id&limit=0)
  // intentionally keep count=exact since their whole purpose is counting.
  const [items, newCount, triagedCount] = await Promise.all([
    opsQuery('GET', path, undefined, { countMode: 'none' }),
    opsQuery('GET', `inbox_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.new&select=id&limit=0`),
    opsQuery('GET', `inbox_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.triaged&select=id&limit=0`)
  ]);
  return {
    total_new: newCount.count || 0,
    total_triaged: triagedCount.count || 0,
    items: Array.isArray(items.data) ? items.data : []
  };
}

/**
 * Newly promoted OM intakes within the last N hours.
 *
 * Surfaces OMs that made it through the full pipeline (extraction → match →
 * promote) in the recent past so the daily briefing tells a broker "4 new
 * deals landed overnight — here they are." Queries
 * staged_intake_promotions, which intake-promoter writes one row per
 * successful promotion to.
 *
 * Designed to be called from the briefing assembler (Phase 4b) and
 * rendered as its own "New OM Intakes" section alongside Inbox Summary.
 *
 * @param {string} workspaceId
 * @param {number} hours   — lookback window (default 24h)
 * @param {number} limit   — max rows (default 10)
 */
export async function fetchNewIntakes(workspaceId, hours = 24, limit = 10) {
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  // pipeline_result is the promoter's full response blob (listing,
  // broker_contact, property_financials, etc.). We unpack it client-side
  // to avoid scattering jsonb extraction across the rendering code.
  const path =
    `staged_intake_promotions?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&promoted_at=gte.${encodeURIComponent(sinceIso)}` +
    `&select=id,intake_id,entity_id,pipeline_result,promoted_at,promoted_by` +
    `&order=promoted_at.desc&limit=${Math.max(1, Math.min(limit, 50))}`;
  const res = await opsQuery('GET', path, undefined, { countMode: 'none' });
  const rawItems = Array.isArray(res.data) ? res.data : [];
  const items = rawItems.map((r) => {
    const pr = r.pipeline_result || {};
    const listing = pr.listing || {};
    const snap    = pr.snapshot || {};
    return {
      id:              r.id,
      intake_id:       r.intake_id,
      entity_id:       r.entity_id,
      promoted_at:     r.promoted_at,
      domain:          pr.domain || null,
      property_id:     pr.match?.property_id || listing.property_id || null,
      listing_id:      listing.listing_id || null,
      address:         snap.address || listing.address || null,
      city:            snap.city || listing.city || null,
      state:           snap.state || listing.state || null,
      tenant_agency:   snap.tenant_agency || snap.tenant_name || null,
      listing_broker:  snap.listing_broker || null,
      asking_price:    snap.asking_price ?? null,
    };
  });
  return {
    window_hours: hours,
    count:        items.length,
    items,
  };
}

export async function fetchUnassignedWork(workspaceId, limit = 10) {
  const path =
    `v_unassigned_work?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&limit=${Math.max(1, Math.min(limit, 50))}` +
    '&order=created_at.desc';
  const result = await opsQuery('GET', path, undefined, { countMode: 'none' });
  return Array.isArray(result.data) ? result.data : [];
}

export async function fetchSyncHealthSnapshot(workspaceId) {
  // Three reads use only .data; openSfTasks uses .count for queue_drift.
  const [connectors, recentJobs, unresolvedErrors, openSfTasks] = await Promise.all([
    opsQuery('GET',
      `connector_accounts?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,user_id,connector_type,status,last_sync_at,last_error,external_user_id&order=connector_type,display_name`,
      undefined, { countMode: 'none' }
    ),
    opsQuery('GET',
      `sync_jobs?workspace_id=eq.${encodeURIComponent(workspaceId)}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&select=id,status,direction,entity_type,records_processed,records_failed,completed_at&order=created_at.desc&limit=50`,
      undefined, { countMode: 'none' }
    ),
    opsQuery('GET',
      `sync_errors?workspace_id=eq.${encodeURIComponent(workspaceId)}&resolved_at=is.null&select=id,error_message,is_retryable,retry_count,created_at&order=created_at.desc&limit=25`,
      undefined, { countMode: 'none' }
    ),
    opsQuery('GET',
      `inbox_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&source_type=eq.sf_task&status=in.(new,triaged)&select=id&limit=1`,
      undefined, { countMode: 'exact' }
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

export async function fetchRecentSfActivity(workspaceId, limit = 30) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const result = await opsQuery('GET',
    `activity_events?workspace_id=eq.${encodeURIComponent(workspaceId)}&source_type=eq.salesforce&occurred_at=gte.${encodeURIComponent(sevenDaysAgo)}&order=occurred_at.desc&limit=${limit}&select=id,category,title,body,source_type,external_url,metadata,occurred_at`
  );
  return Array.isArray(result.data) ? result.data : [];
}

export async function fetchHotContacts(limit = 15) {
  if (!GOV_URL || !GOV_KEY) return [];
  try {
    const res = await fetchWithTimeout(
      `${GOV_URL}/rest/v1/unified_contacts?contact_class=eq.business&engagement_score=gt.0&order=engagement_score.desc&limit=${limit}&select=unified_id,full_name,email,company_name,title,engagement_score,last_call_date,last_email_date,last_meeting_date,total_calls,total_emails_sent`,
      { headers: { 'apikey': GOV_KEY, 'Authorization': `Bearer ${GOV_KEY}` } },
      5000
    );
    return res.ok ? await res.json() : [];
  } catch { return []; }
}

export async function fetchDiaPipeline() {
  if (!DIA_URL || !DIA_KEY) return { deals: [], leads: [] };
  try {
    const [dealsRes, leadsRes] = await Promise.all([
      fetchWithTimeout(`${DIA_URL}/rest/v1/salesforce_activities?nm_type=eq.Opportunity&is_closed=eq.false&order=activity_date.desc&limit=20&select=id,subject,who_name,what_name,status,activity_date,due_date,priority,description`, {
        headers: { 'apikey': DIA_KEY, 'Authorization': `Bearer ${DIA_KEY}` }
      }, 5000),
      fetchWithTimeout(`${DIA_URL}/rest/v1/salesforce_activities?nm_type=eq.Task&is_closed=eq.false&order=due_date.asc.nullslast&limit=20&select=id,subject,who_name,what_name,status,activity_date,due_date,priority,description`, {
        headers: { 'apikey': DIA_KEY, 'Authorization': `Bearer ${DIA_KEY}` }
      }, 5000)
    ]);
    return {
      deals: dealsRes.ok ? await dealsRes.json() : [],
      leads: leadsRes.ok ? await leadsRes.json() : []
    };
  } catch { return { deals: [], leads: [] }; }
}

// ---------------------------------------------------------------------------
// Strategic priority scoring engine
// ---------------------------------------------------------------------------

export async function buildStrategicPriorities(roleView, myWork, inboxItems, sfActivity, hotContacts, diaPipeline, unassignedWork, syncHealth, workCounts) {
  const today = new Date();
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + 7);

  const hotContactMap = new Map();
  (hotContacts || []).forEach(c => {
    if (c.email) hotContactMap.set(c.email.toLowerCase(), c);
  });

  const allItems = [];

  for (const item of (inboxItems || [])) {
    const { score, tier } = scoreItem(item, hotContactMap);
    allItems.push({ ...item, _score: score, _tier: tier, _source: 'inbox' });
  }

  for (const item of (myWork || [])) {
    const { score, tier } = scoreItem(item, hotContactMap);
    allItems.push({ ...item, _score: score, _tier: tier, _source: 'work' });
  }

  for (const item of (sfActivity || [])) {
    const { score, tier } = scoreItem(item, hotContactMap);
    if (score >= 30) {
      allItems.push({
        id: item.id,
        title: item.title,
        status: item.metadata?.sf_status || 'open',
        priority: item.metadata?.priority || 'normal',
        due_date: item.metadata?.activity_date || null,
        domain: null,
        type: 'sf_activity',
        metadata: item.metadata,
        _score: score,
        _tier: tier,
        _source: 'salesforce'
      });
    }
  }

  for (const deal of (diaPipeline?.deals || [])) {
    const pseudoItem = {
      title: deal.subject || deal.what_name || '(deal)',
      body: deal.description || '',
      due_date: deal.due_date || deal.activity_date,
      priority: deal.priority === 'High' ? 'high' : 'normal',
      metadata: { sf_who: deal.who_name, sf_what: deal.what_name }
    };
    const { score, tier } = scoreItem(pseudoItem, hotContactMap);
    if (score >= 20) {
      allItems.push({
        id: deal.id,
        title: deal.subject || deal.what_name || '(deal)',
        status: deal.status || 'open',
        priority: pseudoItem.priority,
        due_date: pseudoItem.due_date,
        domain: 'dialysis',
        type: 'sf_deal',
        _score: score + 20,
        _tier: tier === 'urgent' ? 'important' : tier,
        _source: 'pipeline'
      });
    }
  }

  allItems.sort((a, b) => b._score - a._score);

  const strategic = allItems.filter(i => i._tier === 'strategic');
  const important = allItems.filter(i => i._tier === 'important');
  const urgent = allItems.filter(i => i._tier === 'urgent');

  const todayPriorities = [
    ...strategic.slice(0, 3),
    ...important.slice(0, 3),
    ...urgent.slice(0, 4)
  ].slice(0, 7);

  const now = Date.now();
  const touchpointCandidates = (hotContacts || [])
    .filter(c => {
      const lastTouch = Math.max(
        c.last_call_date ? new Date(c.last_call_date).getTime() : 0,
        c.last_email_date ? new Date(c.last_email_date).getTime() : 0,
        c.last_meeting_date ? new Date(c.last_meeting_date).getTime() : 0
      );
      return lastTouch > 0 && (now - lastTouch) > 14 * 86400000;
    })
    .sort((a, b) => (b.engagement_score || 0) - (a.engagement_score || 0))
    .slice(0, 10)
    .map(c => ({
      id: c.unified_id,
      name: c.full_name,
      company: c.company_name,
      score: c.engagement_score,
      days_since_touch: Math.floor((now - Math.max(
        c.last_call_date ? new Date(c.last_call_date).getTime() : 0,
        c.last_email_date ? new Date(c.last_email_date).getTime() : 0,
        c.last_meeting_date ? new Date(c.last_meeting_date).getTime() : 0
      )) / 86400000),
      reason: 'High engagement contact overdue for touchpoint'
    }));

  const weightedCandidates = await Promise.all(
    touchpointCandidates.map(async (contact) => {
      let weight = 1.0;
      try {
        const weightResult = await Promise.race([
          opsQuery('POST', 'rpc/get_contact_recommendation_weight', { p_entity_id: contact.id }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500))
        ]);
        if (weightResult.ok && weightResult.data != null) {
          const parsed = typeof weightResult.data === 'number' ? weightResult.data : parseFloat(weightResult.data);
          if (!isNaN(parsed)) weight = parsed;
        }
      } catch { /* timeout or query error */ }

      const recommendation_note = weight === 0.5 ? 'Previously dismissed \u2014 lower priority'
        : weight === 1.5 ? 'High engagement history \u2014 prioritize'
        : '';

      return { ...contact, recommendation_weight: weight, recommendation_note };
    })
  );

  const staleTouchpoints = weightedCandidates
    .sort((a, b) => ((b.days_since_touch || 0) * b.recommendation_weight) - ((a.days_since_touch || 0) * a.recommendation_weight))
    .slice(0, 5);

  if (process.env.TEAMS_COLD_ALERTS_ENABLED === 'true') {
    const goingCold = (hotContacts || [])
      .filter(c => {
        const lastTouch = Math.max(
          c.last_call_date ? new Date(c.last_call_date).getTime() : 0,
          c.last_email_date ? new Date(c.last_email_date).getTime() : 0,
          c.last_meeting_date ? new Date(c.last_meeting_date).getTime() : 0
        );
        const daysSince = lastTouch > 0 ? Math.floor((now - lastTouch) / 86400000) : 0;
        return lastTouch > 0 && daysSince > 60 && (c.engagement_score || 0) > 40;
      })
      .slice(0, 3);

    for (const c of goingCold) {
      const lastTouch = Math.max(
        c.last_call_date ? new Date(c.last_call_date).getTime() : 0,
        c.last_email_date ? new Date(c.last_email_date).getTime() : 0,
        c.last_meeting_date ? new Date(c.last_meeting_date).getTime() : 0
      );
      const daysSince = Math.floor((now - lastTouch) / 86400000);
      const lastTouchDate = new Date(lastTouch).toISOString().split('T')[0];

      sendTeamsAlert({
        title: 'Warm Contact Going Cold',
        summary: `${c.full_name || 'Unknown'} \u2014 ${daysSince} days since last touch`,
        severity: 'high',
        facts: [
          ['Contact', c.full_name || 'Unknown'],
          ['Company', c.company_name || 'Unknown'],
          ['Last Touch', lastTouchDate],
          ['Relationship Score', c.engagement_score || 0],
          ['Active Pursuits', c.total_calls || 0]
        ],
        actions: [{ label: 'View Contact', url: `${process.env.LCC_BASE_URL || ''}/contacts` }]
      }).catch(() => {});
    }
  }

  const overdue = allItems.filter(i => i.due_date && new Date(i.due_date) < today);
  const dueThisWeek = allItems.filter(i => {
    if (!i.due_date) return false;
    const due = new Date(i.due_date);
    return due >= today && due <= weekEnd;
  });

  return {
    today_priorities: todayPriorities
      .map((i) => {
        const title = deriveItemTitle(i);
        if (!title) return null;
        return {
          id: i.id,
          title,
          status: i.status || null,
          priority: i.priority || null,
          due_date: i.due_date || null,
          domain: i.domain || null,
          type: i.type || i.item_type || i.source_type || 'action',
          tier: i._tier,
          score: i._score,
          source: i._source
        };
      })
      .filter(Boolean),
    strategic_count: strategic.length,
    important_count: important.length,
    urgent_count: urgent.length,
    my_overdue: mapPriorityItems(overdue, 5),
    my_due_this_week: mapPriorityItems(dueThisWeek, 5),
    recommended_calls: staleTouchpoints,
    recommended_followups: mapPriorityItems(
      inboxItems.filter(i => {
        const { score } = scoreItem(i, hotContactMap);
        return score >= 20;
      }).slice(0, 5),
      5
    ),
    pipeline_deals: (diaPipeline?.deals || []).slice(0, 5).map(d => ({
      id: d.id,
      title: d.subject || d.what_name,
      contact: d.who_name,
      status: d.status,
      due: d.due_date || d.activity_date,
      domain: 'dialysis'
    })),
    sf_activity_summary: {
      total_7d: (sfActivity || []).length,
      calls: (sfActivity || []).filter(a => a.category === 'call').length,
      emails: (sfActivity || []).filter(a => a.category === 'email').length,
      tasks: (sfActivity || []).filter(a => a.category === 'note').length
    }
  };
}
