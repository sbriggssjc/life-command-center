// ============================================================================
// Daily Briefing API — Unified read-only daily snapshot orchestration
// Life Command Center
//
// GET /api/daily-briefing?action=snapshot
// ============================================================================

import { authenticate, handleCors } from './_shared/auth.js';
import { opsQuery, requireOps, withErrorHandler } from './_shared/ops-db.js';
import { writeSignal } from './_shared/signals.js';

const MORNING_STRUCTURED_URL = process.env.MORNING_BRIEFING_STRUCTURED_URL || '';
const MORNING_HTML_URL = process.env.MORNING_BRIEFING_HTML_URL || '';
const GOV_URL = process.env.GOV_SUPABASE_URL;
const GOV_KEY = process.env.GOV_SUPABASE_KEY;
const DIA_URL = process.env.DIA_SUPABASE_URL;
const DIA_KEY = process.env.DIA_SUPABASE_KEY;

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

async function fetchCrossDomainOwnersDueForTouch(workspaceId, limit = 5) {
  // Find cross_domain_owner entities with no recent activity (90+ days)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();

  // Get cross-domain owner entities
  const entitiesResult = await opsQuery('GET',
    `entities?workspace_id=eq.${encodeURIComponent(workspaceId)}&tags=cs.{cross_domain_owner}&select=id,name,email,phone,tags,updated_at&limit=50`
  );
  const entities = Array.isArray(entitiesResult.data) ? entitiesResult.data : [];
  if (!entities.length) return [];

  // For each entity, check last activity and gather external identity counts
  const highlights = [];
  for (const entity of entities) {
    // Check last activity
    const activityResult = await opsQuery('GET',
      `activity_events?entity_id=eq.${entity.id}&order=occurred_at.desc&limit=1&select=occurred_at`
    );
    const lastActivity = activityResult.data?.[0]?.occurred_at;
    const lastActivityDate = lastActivity ? new Date(lastActivity) : null;

    // Skip if touched within 90 days
    if (lastActivityDate && lastActivityDate.getTime() > new Date(ninetyDaysAgo).getTime()) continue;

    const daysSinceTouch = lastActivityDate
      ? Math.floor((Date.now() - lastActivityDate.getTime()) / 86400000)
      : null;

    // Count assets per domain
    const extIds = await opsQuery('GET',
      `external_identities?entity_id=eq.${entity.id}&select=source_system`
    );
    const sources = Array.isArray(extIds.data) ? extIds.data : [];
    const govAssets = sources.filter(s => s.source_system === 'gov_db').length;
    const diaAssets = sources.filter(s => s.source_system === 'dia_db').length;

    highlights.push({
      entity_id: entity.id,
      name: entity.name,
      gov_assets: govAssets,
      dia_assets: diaAssets,
      days_since_touch: daysSinceTouch,
      recommended_action: daysSinceTouch
        ? `Cross-domain owner not touched in ${daysSinceTouch} days — prime candidate for compound outreach`
        : 'Cross-domain owner with no recorded activity — prime candidate for initial outreach'
    });

    if (highlights.length >= limit) break;
  }

  // Sort by days since touch descending (null = never touched = highest priority)
  highlights.sort((a, b) => {
    if (a.days_since_touch === null && b.days_since_touch === null) return 0;
    if (a.days_since_touch === null) return -1;
    if (b.days_since_touch === null) return 1;
    return b.days_since_touch - a.days_since_touch;
  });

  return highlights.slice(0, limit);
}

// ---------------------------------------------------------------------------
// STRATEGIC DATA FETCHERS — pull from all business-critical sources
// ---------------------------------------------------------------------------

async function fetchRecentSfActivity(workspaceId, limit = 30) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const result = await opsQuery('GET',
    `activity_events?workspace_id=eq.${encodeURIComponent(workspaceId)}&source_type=eq.salesforce&occurred_at=gte.${encodeURIComponent(sevenDaysAgo)}&order=occurred_at.desc&limit=${limit}&select=id,category,title,body,source_type,external_url,metadata,occurred_at`
  );
  return Array.isArray(result.data) ? result.data : [];
}

async function fetchHotContacts(limit = 15) {
  if (!GOV_URL || !GOV_KEY) return [];
  try {
    const res = await fetch(
      `${GOV_URL}/rest/v1/unified_contacts?contact_class=eq.business&engagement_score=gt.0&order=engagement_score.desc&limit=${limit}&select=unified_id,full_name,email,company_name,title,engagement_score,last_call_date,last_email_date,last_meeting_date,total_calls,total_emails_sent`,
      { headers: { 'apikey': GOV_KEY, 'Authorization': `Bearer ${GOV_KEY}` } }
    );
    return res.ok ? await res.json() : [];
  } catch { return []; }
}

async function fetchDiaPipeline() {
  if (!DIA_URL || !DIA_KEY) return { deals: [], leads: [] };
  try {
    const [dealsRes, leadsRes] = await Promise.all([
      fetch(`${DIA_URL}/rest/v1/salesforce_activities?nm_type=eq.Opportunity&is_closed=eq.false&order=activity_date.desc&limit=20&select=id,subject,who_name,what_name,status,activity_date,due_date,priority,description`, {
        headers: { 'apikey': DIA_KEY, 'Authorization': `Bearer ${DIA_KEY}` }
      }),
      fetch(`${DIA_URL}/rest/v1/salesforce_activities?nm_type=eq.Task&is_closed=eq.false&order=due_date.asc.nullslast&limit=20&select=id,subject,who_name,what_name,status,activity_date,due_date,priority,description`, {
        headers: { 'apikey': DIA_KEY, 'Authorization': `Bearer ${DIA_KEY}` }
      })
    ]);
    return {
      deals: dealsRes.ok ? await dealsRes.json() : [],
      leads: leadsRes.ok ? await leadsRes.json() : []
    };
  } catch { return { deals: [], leads: [] }; }
}

// ---------------------------------------------------------------------------
// STRATEGIC PRIORITY SCORING ENGINE
//
// Every item gets a score based on:
//   - Strategic value (deal/revenue impact, listing pursuit, relationship)
//   - Time sensitivity (overdue, due today, due this week)
//   - Engagement signal (who is it from, are they a hot contact)
//   - Business stage (active offer > under contract > marketing > pursuit)
// ---------------------------------------------------------------------------

const DEAL_KEYWORDS = /offer|under contract|loi|letter of intent|closing|escrow|due diligence|earnest money|psa|purchase|disposition|assignment/i;
const REVENUE_KEYWORDS = /commission|fee|listing agreement|exclusive|signed|engaged|retained/i;
const PURSUIT_KEYWORDS = /bov|proposal|valuation|pitch|pursuit|prospect|owner|developer|seller/i;
const RELATIONSHIP_KEYWORDS = /follow[- ]?up|check[- ]?in|touch base|reconnect|introduction|referral|thank you|congrat/i;
const URGENT_SENDER_KEYWORDS = /client|seller|buyer|attorney|lender|title|escrow/i;

function scoreItem(item, hotContactMap) {
  let score = 0;
  let tier = 'urgent'; // default: operational urgency
  const title = (item.title || '').toLowerCase();
  const body = (item.body || '').toLowerCase();
  const combined = title + ' ' + body;
  const senderEmail = item.metadata?.sender_email || '';
  const senderName = item.metadata?.sender_name || item.metadata?.sf_who || '';

  // --- Strategic scoring (highest value) ---
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

  // --- Relationship scoring ---
  if (RELATIONSHIP_KEYWORDS.test(combined)) {
    score += 50;
    if (tier === 'urgent') tier = 'important';
  }

  // --- Contact engagement boost ---
  if (senderEmail && hotContactMap) {
    const contact = hotContactMap.get(senderEmail.toLowerCase());
    if (contact) {
      score += Math.min(contact.engagement_score || 0, 50); // up to +50 for hot contacts
      if (contact.engagement_score >= 60) tier = tier === 'urgent' ? 'important' : tier;
    }
  }

  // --- Time sensitivity ---
  if (item.due_date) {
    const due = new Date(item.due_date);
    const now = new Date();
    const daysUntil = (due - now) / 86400000;
    if (daysUntil < 0) score += 40; // overdue
    else if (daysUntil < 1) score += 30; // due today
    else if (daysUntil < 3) score += 20; // due within 3 days
    else if (daysUntil < 7) score += 10; // due this week
  }

  // --- Priority boost ---
  if (item.priority === 'urgent') score += 30;
  else if (item.priority === 'high') score += 20;

  // --- Source type boost ---
  if (item.source_type === 'sf_task') score += 15; // Salesforce tasks represent real CRM work
  if (item.source_type === 'flagged_email') score += 10; // user flagged it for a reason

  // --- Attachment/deal signal ---
  if (item.metadata?.has_attachments) score += 5;

  return { score, tier };
}

function buildStrategicPriorities(roleView, myWork, inboxItems, sfActivity, hotContacts, diaPipeline, unassignedWork, syncHealth, workCounts) {
  const today = new Date();
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + 7);

  // Build hot contact lookup by email
  const hotContactMap = new Map();
  (hotContacts || []).forEach(c => {
    if (c.email) hotContactMap.set(c.email.toLowerCase(), c);
  });

  // Score and classify all items
  const allItems = [];

  // Score inbox items
  for (const item of (inboxItems || [])) {
    const { score, tier } = scoreItem(item, hotContactMap);
    allItems.push({ ...item, _score: score, _tier: tier, _source: 'inbox' });
  }

  // Score my work items
  for (const item of (myWork || [])) {
    const { score, tier } = scoreItem(item, hotContactMap);
    allItems.push({ ...item, _score: score, _tier: tier, _source: 'work' });
  }

  // Score SF activities as potential priorities
  for (const item of (sfActivity || [])) {
    const { score, tier } = scoreItem(item, hotContactMap);
    if (score >= 30) { // only surface SF items with meaningful scores
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

  // Score Dia pipeline deals
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
        _score: score + 20, // pipeline deals get a base boost
        _tier: tier === 'urgent' ? 'important' : tier,
        _source: 'pipeline'
      });
    }
  }

  // Sort by score descending
  allItems.sort((a, b) => b._score - a._score);

  // Split into tiers
  const strategic = allItems.filter(i => i._tier === 'strategic');
  const important = allItems.filter(i => i._tier === 'important');
  const urgent = allItems.filter(i => i._tier === 'urgent');

  // Build today's prioritized list: strategic first, then important, then urgent
  const todayPriorities = [
    ...strategic.slice(0, 3),
    ...important.slice(0, 3),
    ...urgent.slice(0, 4)
  ].slice(0, 7);

  // Contacts who need a touchpoint (haven't been called in 14+ days, high engagement)
  const now = Date.now();
  const staleTouchpoints = (hotContacts || [])
    .filter(c => {
      const lastTouch = Math.max(
        c.last_call_date ? new Date(c.last_call_date).getTime() : 0,
        c.last_email_date ? new Date(c.last_email_date).getTime() : 0,
        c.last_meeting_date ? new Date(c.last_meeting_date).getTime() : 0
      );
      return lastTouch > 0 && (now - lastTouch) > 14 * 86400000;
    })
    .sort((a, b) => (b.engagement_score || 0) - (a.engagement_score || 0))
    .slice(0, 5)
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

  // Overdue items (across all sources)
  const overdue = allItems.filter(i => i.due_date && new Date(i.due_date) < today);
  const dueThisWeek = allItems.filter(i => {
    if (!i.due_date) return false;
    const due = new Date(i.due_date);
    return due >= today && due <= weekEnd;
  });

  return {
    today_priorities: todayPriorities.map(i => ({
      id: i.id,
      title: i.title || '(Untitled)',
      status: i.status || null,
      priority: i.priority || null,
      due_date: i.due_date || null,
      domain: i.domain || null,
      type: i.type || i.item_type || i.source_type || 'action',
      tier: i._tier,
      score: i._score,
      source: i._source
    })),
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

// Legacy priority projection (kept for analyst_ops and manager role views)
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
    { label: 'Open My Queue', type: 'nav', target: 'pageMyWork' },
    { label: 'Open Inbox Triage', type: 'nav', target: 'pageInbox' },
    { label: 'View Sync Health', type: 'nav', target: 'pageSyncHealth' }
  ];
  if (roleView === 'analyst_ops' || roleView === 'manager') {
    base.push({ label: 'Review Unassigned Work', type: 'nav', target: 'pageTeamQueue' });
  }
  if (roleView === 'manager') {
    base.push({ label: 'View Escalations', type: 'nav', target: 'pageMyWork' });
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

// ---------------------------------------------------------------------------
// DAILY BRIEFING PACKET BUILDER
// Transforms the existing briefing data into the formal Daily Briefing Packet
// schema defined in context_packet_schema.md
// ---------------------------------------------------------------------------

function buildPacketItem(item, rank, category) {
  return {
    priority_rank: rank,
    category: category || item.type || 'general',
    title: item.title || '(Untitled)',
    entity_name: item.title || null,
    entity_id: item.id || null,
    context: item.metadata?.description || item.body || null,
    suggested_actions: [],
    tier: item._tier || null,
    score: item._score || 0,
    source: item._source || null,
    domain: item.domain || null,
  };
}

function buildProductionScore(workCounts, sfActivity) {
  const calls = (sfActivity || []).filter(a => a.category === 'call').length;
  const emails = (sfActivity || []).filter(a => a.category === 'email').length;
  return {
    bd_touchpoints: {
      planned: 10,  // weekly target (configurable later)
      completed_yesterday: 0,  // needs day-level filtering
      weekly_target: 10,
      weekly_completed: calls + emails,
    },
    new_leads_researched: {
      daily_target: 2,
      weekly_completed: workCounts.research_active || 0,
    },
    calls_logged: {
      weekly_completed: calls,
      weekly_target: 15,
    },
    om_follow_ups_completed: {
      open: 0,       // will be populated when OM tracking is wired
      overdue_48h: 0,
    },
    seller_reports_sent: {
      due_this_week: 0,
      sent: 0,
    },
  };
}

function buildOvernightSignals(morningStructured) {
  if (!morningStructured || !morningStructured.sector_signals) return [];
  return (morningStructured.sector_signals || []).slice(0, 5).map(s => ({
    signal_type: 'market_intelligence',
    description: typeof s === 'string' ? s : (s.description || s.text || JSON.stringify(s)),
    entity_name: null,
    recommended_action: null,
  }));
}

async function writeBriefingPacket(userId, packetPayload) {
  try {
    const ttlHours = 18;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
    const tokenEstimate = Math.ceil(JSON.stringify(packetPayload).length / 4);

    await opsQuery('POST', 'context_packets', {
      packet_type: 'daily_briefing',
      entity_id: null,
      entity_type: null,
      requesting_user: userId,
      surface_hint: 'daily_briefing',
      payload: packetPayload,
      token_count: tokenEstimate,
      expires_at: expiresAt,
      assembly_duration_ms: 0,
      model_version: 'v1.0',
    });
  } catch (err) {
    console.error('[Briefing packet write failed]', err?.message || err);
  }
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

  const [morningStructured, morningHtml, workCounts, myWork, inboxSummary, unassignedWork, syncHealth, sfActivity, hotContacts, diaPipeline, crossDomainHighlights] = await Promise.all([
    fetchMorningStructured(),
    fetchMorningHtml(),
    fetchWorkCounts(workspaceId, user.id),
    fetchMyWork(workspaceId, user.id, 15),
    fetchInboxSummary(workspaceId, 10),
    fetchUnassignedWork(workspaceId, 10),
    fetchSyncHealthSnapshot(workspaceId),
    fetchRecentSfActivity(workspaceId, 30),
    fetchHotContacts(15),
    fetchDiaPipeline(),
    fetchCrossDomainOwnersDueForTouch(workspaceId, 5)
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

  // Build strategic priorities (existing logic)
  const strategicPriorities = roleView === 'broker'
    ? buildStrategicPriorities(roleView, myWork, inboxSummary.items, sfActivity, hotContacts, diaPipeline, unassignedWork, syncHealth, workCounts)
    : projectPriorities(roleView, myWork, inboxSummary, unassignedWork, syncHealth, workCounts);

  // ── Build formal Daily Briefing Packet (context_packet_schema.md) ──
  const todayItems = strategicPriorities.today_priorities || strategicPriorities.today_top_5 || [];
  const strategicItems = todayItems.filter(i => i.tier === 'strategic' || i._tier === 'strategic');
  const importantItems = todayItems.filter(i => i.tier === 'important' || i._tier === 'important');
  const urgentItems = todayItems.filter(i => i.tier === 'urgent' || i._tier === 'urgent');

  const dailyBriefingPacket = {
    packet_type: 'daily_briefing',
    generated_at: asOf,
    date: safeDateOnly(asOf),
    user_id: user.id,
    strategic_items: strategicItems.map((item, i) => buildPacketItem(item, i + 1, 'deal_action')),
    important_items: importantItems.map((item, i) => buildPacketItem(item, i + 1, 'touchpoint_due')),
    urgent_items: urgentItems.map((item, i) => buildPacketItem(item, i + 1, 'inbox_triage')),
    production_score: buildProductionScore(workCounts, sfActivity),
    overnight_signals: buildOvernightSignals(globalMarketIntelligence),
    carry_forward_from_yesterday: (strategicPriorities.my_overdue || []).map(item => ({
      item: item.title || '(Untitled)',
      days_carried: item.due_date
        ? Math.max(0, Math.floor((Date.now() - new Date(item.due_date).getTime()) / 86400000))
        : 0,
    })),
  };

  // Write packet to context_packets table (fire-and-forget)
  writeBriefingPacket(user.id, dailyBriefingPacket);

  // Log briefing assembly signal
  writeSignal({
    signal_type: 'packet_assembled',
    signal_category: 'intelligence',
    user_id: user.id,
    payload: {
      packet_type: 'daily_briefing',
      strategic_count: strategicItems.length,
      important_count: importantItems.length,
      urgent_count: urgentItems.length,
      carry_forward_count: dailyBriefingPacket.carry_forward_from_yesterday.length,
    },
  });

  // ── Return full response (backwards-compatible + packet) ──
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
    // Formal packet (new — used by Copilot and AI surfaces)
    daily_briefing_packet: dailyBriefingPacket,
    // Legacy shape (preserved for existing frontend)
    user_specific_priorities: strategicPriorities,
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
    cross_domain_highlights: crossDomainHighlights,
    actions: buildActions(roleView)
  };

  return res.status(200).json(payload);
});
