// ============================================================================
// Daily Briefing Edge Function — Unified read-only daily snapshot orchestration
// Life Command Center — Supabase Edge Function Port
//
// GET /functions/v1/daily-briefing?action=snapshot
// GET /functions/v1/daily-briefing?action=health
// ============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authenticateUser, primaryWorkspaceId, requireRole } from "../_shared/auth.ts";
import { opsQuery, rawQuery, pgFilterVal } from "../_shared/supabase-client.ts";
import { writeSignal } from "../_shared/signals.ts";
import { queryParams, parseBody, deriveItemTitle as utilDeriveItemTitle, toArray } from "../_shared/utils.ts";

// ============================================================================
// Environment & Configuration
// ============================================================================

const MORNING_STRUCTURED_URL = Deno.env.get("MORNING_BRIEFING_STRUCTURED_URL") || "";
const MORNING_HTML_URL = Deno.env.get("MORNING_BRIEFING_HTML_URL") || "";
const GOV_URL = Deno.env.get("GOV_SUPABASE_URL");
const GOV_KEY = Deno.env.get("GOV_SUPABASE_KEY");
const DIA_URL = Deno.env.get("DIA_SUPABASE_URL");
const DIA_KEY = Deno.env.get("DIA_SUPABASE_KEY");
const LCC_BASE_URL = Deno.env.get("LCC_BASE_URL") || "";
const TEAMS_COLD_ALERTS_ENABLED = Deno.env.get("TEAMS_COLD_ALERTS_ENABLED") === "true";

// ============================================================================
// Role and Audience Selection
// ============================================================================

function pickRoleView(requested: string | null, membershipRole: string): string {
  if (requested === "analyst_ops" || requested === "broker" || requested === "manager") return requested;
  if (membershipRole === "owner" || membershipRole === "manager") return "manager";
  if (membershipRole === "operator" || membershipRole === "viewer") return "analyst_ops";
  return "broker";
}

function pickAudience(roleView: string): string {
  if (roleView === "manager") return "manager";
  if (roleView === "analyst_ops") return "team";
  return "user";
}

// ============================================================================
// Item Title Derivation
// ============================================================================

export function deriveItemTitle(item: any): string | null {
  if (item == null) return null;
  if (typeof item === "string") {
    const s = item.trim();
    return s || null;
  }
  if (typeof item !== "object") return null;

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

  // Synthetic title fallbacks from item metadata
  const meta = (item.metadata && typeof item.metadata === "object") ? item.metadata : {};
  const sender = item.sender_name || item.from_name || meta.sender_name || meta.from_name || null;
  const senderEmail = item.sender_email || item.from_email || meta.sender_email || meta.from_email || null;
  const taskType = item.task_type || meta.task_type || null;
  const rawType = String(item.item_type || item.source_type || item.type || meta.type || "").toLowerCase();

  if (rawType.includes("email") || rawType.includes("inbox")) {
    if (sender) return `Email from ${sender}`;
    if (senderEmail) return `Email from ${senderEmail}`;
  }
  if (rawType.includes("call")) {
    if (sender) return `Call with ${sender}`;
  }
  if (rawType.includes("task") || rawType.includes("action")) {
    if (taskType) return `Task: ${taskType}`;
    if (sender) return `Task from ${sender}`;
  }

  // Descriptive-text fields used by market intelligence payloads
  const descriptive = item.description || item.text || item.summary;
  if (descriptive && String(descriptive).trim()) {
    return String(descriptive).trim();
  }

  return null;
}

// ============================================================================
// Morning Briefing Normalization
// ============================================================================

function normalizeMorningStructured(raw: any): any {
  if (!raw || typeof raw !== "object") return null;

  const gmi = raw.global_market_intelligence || {};
  const summary = gmi.summary || raw.summary || raw.executive_summary || raw.briefing_summary || null;

  const normalizeGmiList = (arr: any[]) =>
    toArray(arr)
      .map((entry: any) => {
        if (typeof entry === "string") {
          const t = entry.trim();
          return t || null;
        }
        if (!entry || typeof entry !== "object") return null;
        const title = deriveItemTitle(entry);
        if (!title) return null;
        return { ...entry, title };
      })
      .filter(Boolean);

  const normalized = {
    source_system: raw.source_system || gmi.source_system || "morning_briefing",
    summary,
    highlights: normalizeGmiList(gmi.highlights?.length ? gmi.highlights : raw.highlights),
    sector_signals: normalizeGmiList(gmi.sector_signals?.length ? gmi.sector_signals : raw.sector_signals),
    watchlist: normalizeGmiList(gmi.watchlist?.length ? gmi.watchlist : raw.watchlist),
    html_fragment: gmi.html_fragment || raw.html_fragment || raw.html || null,
    source_links: toArray(gmi.source_links?.length ? gmi.source_links : raw.source_links),
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

function safeDateOnly(iso: string | undefined): string {
  const value = iso || new Date().toISOString();
  return value.split("T")[0];
}

function buildBriefingId(asOf: string, workspaceId: string, userId: string, roleView: string): string {
  return `${safeDateOnly(asOf)}:workspace:${workspaceId}:user:${userId}:role:${roleView}`;
}

// ============================================================================
// Fetcher Functions — Morning Briefing
// ============================================================================

async function fetchMorningStructured(): Promise<any> {
  if (!MORNING_STRUCTURED_URL) return { ok: false, missing: true, reason: "structured_url_not_configured" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(MORNING_STRUCTURED_URL, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) return { ok: false, missing: true, reason: `structured_http_${res.status}` };
      const payload = await res.json();
      const normalized = normalizeMorningStructured(payload);
      if (!normalized) return { ok: false, missing: true, reason: "structured_payload_empty" };
      return { ok: true, data: normalized };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { ok: false, missing: true, reason: `structured_fetch_error:${(err as Error)?.message || "unknown"}` };
  }
}

async function fetchMorningHtml(): Promise<any> {
  if (!MORNING_HTML_URL) return { ok: false, missing: true, reason: "html_url_not_configured" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(MORNING_HTML_URL, {
        headers: { Accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
        signal: controller.signal,
      });
      if (!res.ok) return { ok: false, missing: true, reason: `html_http_${res.status}` };
      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("application/json")) {
        const body = await res.json();
        const html = body?.html || body?.html_fragment || null;
        return html ? { ok: true, data: html } : { ok: false, missing: true, reason: "html_json_payload_empty" };
      }
      const html = await res.text();
      return html && html.trim()
        ? { ok: true, data: html.trim() }
        : { ok: false, missing: true, reason: "html_payload_empty" };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { ok: false, missing: true, reason: `html_fetch_error:${(err as Error)?.message || "unknown"}` };
  }
}

// ============================================================================
// Work Counts Fetcher
// ============================================================================

export async function fetchWorkCounts(workspaceId: string, userId: string): Promise<any> {
  const [teamMv, userMv] = await Promise.all([
    opsQuery("GET", `mv_work_counts?workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`),
    opsQuery("GET", `mv_user_work_counts?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`),
  ]);

  let team = teamMv;
  let teamSource = "mv_work_counts";
  if (!team.ok || !team.data?.length) {
    team = await opsQuery("GET", `v_work_counts?workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`);
    teamSource = "v_work_counts";
  }
  let t = team.data?.[0] || {};
  const rawMvRow = { ...t, _source: teamSource, _ok: team.ok, _status: team.status, _row_count: team.data?.length || 0 };

  // Direct-count fallback
  const wsEnc = encodeURIComponent(workspaceId);
  if (!t.open_actions && !t.inbox_new && !t.overdue_actions) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [openRes, inboxNewRes, syncErrRes, overdueRes] = await Promise.all([
        opsQuery("GET", `action_items?workspace_id=eq.${wsEnc}&status=in.(open,in_progress,waiting,assigned)&select=id&limit=0`),
        opsQuery("GET", `inbox_items?workspace_id=eq.${wsEnc}&status=eq.new&select=id&limit=0`),
        opsQuery("GET", `action_items?workspace_id=eq.${wsEnc}&status=eq.sync_error&select=id&limit=0`),
        opsQuery("GET", `action_items?workspace_id=eq.${wsEnc}&status=in.(open,in_progress)&due_date=lt.${today}&select=id&limit=0`),
      ]);
      t = {
        ...t,
        open_actions: openRes.count || 0,
        inbox_new: inboxNewRes.count || 0,
        sync_errors: (syncErrRes.count || 0) + (t.sync_errors || 0),
        overdue_actions: overdueRes.count || 0,
        _source: "direct_count_fallback",
      };
      console.log("[Briefing] team signals direct-count fallback used:", {
        open: t.open_actions,
        inbox: t.inbox_new,
        overdue: t.overdue_actions,
        sync: t.sync_errors,
      });
    } catch (err) {
      console.error("[Briefing] direct-count fallback failed:", (err as Error)?.message || err);
    }
  }

  let user = userMv;
  if (!user.ok || !user.data?.length) {
    const myActions = await opsQuery(
      "GET",
      `action_items?workspace_id=eq.${wsEnc}&or=(owner_id.eq.${encodeURIComponent(userId)},assigned_to.eq.${encodeURIComponent(userId)})&status=in.(open,in_progress,waiting)&select=id&limit=0`
    );
    user = { data: [{ my_actions: myActions.count || 0, my_overdue: 0, my_inbox: 0, my_research: 0, my_completed_week: 0 }] };
  }
  const u = user.data?.[0] || {};

  const today = new Date().toISOString().slice(0, 10);
  let dueToday = 0;
  try {
    const dueTodayRes = await opsQuery(
      "GET",
      `action_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=in.(open,in_progress,waiting)&due_date=eq.${today}&select=id&limit=0`
    );
    dueToday = dueTodayRes.count || 0;
  } catch (err) {
    console.error("[Briefing] due_today direct-count failed:", (err as Error)?.message || err);
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
    _mv_raw: rawMvRow,
  };
}

export async function fetchMyWork(workspaceId: string, userId: string, limit = 15): Promise<any[]> {
  const path =
    `v_my_work?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&or=(user_id.eq.${encodeURIComponent(userId)},assigned_to.eq.${encodeURIComponent(userId)})` +
    `&limit=${Math.max(1, Math.min(limit, 50))}` +
    `&order=due_date.asc.nullslast,created_at.desc`;
  const result = await opsQuery("GET", path);
  return Array.isArray(result.data) ? result.data : [];
}

export async function fetchInboxSummary(workspaceId: string, limit = 10): Promise<any> {
  const path =
    `v_inbox_triage?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&limit=${Math.max(1, Math.min(limit, 50))}` +
    "&order=received_at.desc";
  const [items, newCount, triagedCount] = await Promise.all([
    opsQuery("GET", path),
    opsQuery("GET", `inbox_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.new&select=id&limit=0`),
    opsQuery("GET", `inbox_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.triaged&select=id&limit=0`),
  ]);
  return {
    total_new: newCount.count || 0,
    total_triaged: triagedCount.count || 0,
    items: Array.isArray(items.data) ? items.data : [],
  };
}

async function fetchUnassignedWork(workspaceId: string, limit = 10): Promise<any[]> {
  const path =
    `v_unassigned_work?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&limit=${Math.max(1, Math.min(limit, 50))}` +
    "&order=created_at.desc";
  const result = await opsQuery("GET", path);
  return Array.isArray(result.data) ? result.data : [];
}

async function fetchSyncHealthSnapshot(workspaceId: string): Promise<any> {
  const [connectors, recentJobs, unresolvedErrors, openSfTasks] = await Promise.all([
    opsQuery(
      "GET",
      `connector_accounts?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,user_id,connector_type,status,last_sync_at,last_error,external_user_id&order=connector_type,display_name`
    ),
    opsQuery(
      "GET",
      `sync_jobs?workspace_id=eq.${encodeURIComponent(workspaceId)}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&select=id,status,direction,entity_type,records_processed,records_failed,completed_at&order=created_at.desc&limit=50`
    ),
    opsQuery(
      "GET",
      `sync_errors?workspace_id=eq.${encodeURIComponent(workspaceId)}&resolved_at=is.null&select=id,error_message,is_retryable,retry_count,created_at&order=created_at.desc&limit=25`
    ),
    opsQuery(
      "GET",
      `inbox_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&source_type=eq.sf_task&status=in.(new,triaged)&select=id&limit=1`
    ),
  ]);

  const connectorList = connectors.data || [];
  const jobs = recentJobs.data || [];
  const outboundTracked = jobs.filter((job: any) => job.direction === "outbound" && ["completed", "failed", "partial"].includes(job.status));
  const outboundCompleted = outboundTracked.filter((job: any) => job.status === "completed").length;
  const latestSfInbound = jobs.find((job: any) => job.entity_type === "sf_activity" && ["completed", "partial"].includes(job.status));
  const sfOpenTaskCount = openSfTasks.count || 0;
  const sfLastProcessed = Number(latestSfInbound?.records_processed || 0);
  const estimatedGap = Math.max(sfOpenTaskCount - sfLastProcessed, 0);

  return {
    summary: {
      total_connectors: connectorList.length,
      healthy: connectorList.filter((c: any) => c.status === "healthy").length,
      degraded: connectorList.filter((c: any) => c.status === "degraded").length,
      error: connectorList.filter((c: any) => c.status === "error").length,
      disconnected: connectorList.filter((c: any) => c.status === "disconnected").length,
      pending: connectorList.filter((c: any) => c.status === "pending_setup").length,
      outbound_success_rate_24h: outboundTracked.length ? Number((outboundCompleted / outboundTracked.length).toFixed(3)) : null,
    },
    unresolved_errors: unresolvedErrors.data || [],
    queue_drift: {
      source: "salesforce",
      salesforce_open_task_count: sfOpenTaskCount,
      last_sf_records_processed: sfLastProcessed,
      estimated_gap: estimatedGap,
      drift_flag: estimatedGap > 25,
      last_inbound_completed_at: latestSfInbound?.completed_at || null,
    },
  };
}

function mapPriorityItems(items: any[], limit = 5): any[] {
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
      type: item.item_type || item.source_type || "action",
    });
  }
  return mapped;
}

async function fetchCrossDomainOwnersDueForTouch(workspaceId: string, limit = 5): Promise<any[]> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const entitiesResult = await opsQuery(
    "GET",
    `entities?workspace_id=eq.${encodeURIComponent(workspaceId)}&tags=cs.{cross_domain_owner}&select=id,name,email,phone,tags,updated_at&limit=50`
  );
  const entities = Array.isArray(entitiesResult.data) ? entitiesResult.data : [];
  if (!entities.length) return [];

  const highlights = [];
  for (const entity of entities) {
    const activityResult = await opsQuery("GET", `activity_events?entity_id=eq.${entity.id}&order=occurred_at.desc&limit=1&select=occurred_at`);
    const lastActivity = activityResult.data?.[0]?.occurred_at;
    const lastActivityDate = lastActivity ? new Date(lastActivity) : null;

    if (lastActivityDate && lastActivityDate.getTime() > new Date(ninetyDaysAgo).getTime()) continue;

    const daysSinceTouch = lastActivityDate ? Math.floor((Date.now() - lastActivityDate.getTime()) / 86400000) : null;
    const extIds = await opsQuery("GET", `external_identities?entity_id=eq.${entity.id}&select=source_system`);
    const sources = Array.isArray(extIds.data) ? extIds.data : [];
    const govAssets = sources.filter((s: any) => s.source_system === "gov_db").length;
    const diaAssets = sources.filter((s: any) => s.source_system === "dia_db").length;

    highlights.push({
      entity_id: entity.id,
      name: entity.name,
      gov_assets: govAssets,
      dia_assets: diaAssets,
      days_since_touch: daysSinceTouch,
      recommended_action: daysSinceTouch
        ? `Cross-domain owner not touched in ${daysSinceTouch} days — prime candidate for compound outreach`
        : "Cross-domain owner with no recorded activity — prime candidate for initial outreach",
    });

    if (highlights.length >= limit) break;
  }

  highlights.sort((a, b) => {
    if (a.days_since_touch === null && b.days_since_touch === null) return 0;
    if (a.days_since_touch === null) return -1;
    if (b.days_since_touch === null) return 1;
    return b.days_since_touch - a.days_since_touch;
  });

  return highlights.slice(0, limit);
}

// ============================================================================
// Strategic Data Fetchers
// ============================================================================

export async function fetchRecentSfActivity(workspaceId: string, limit = 30): Promise<any[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const result = await opsQuery(
    "GET",
    `activity_events?workspace_id=eq.${encodeURIComponent(workspaceId)}&source_type=eq.salesforce&occurred_at=gte.${encodeURIComponent(sevenDaysAgo)}&order=occurred_at.desc&limit=${limit}&select=id,category,title,body,source_type,external_url,metadata,occurred_at`
  );
  return Array.isArray(result.data) ? result.data : [];
}

export async function fetchHotContacts(limit = 15): Promise<any[]> {
  if (!GOV_URL || !GOV_KEY) return [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(
        `${GOV_URL}/rest/v1/unified_contacts?contact_class=eq.business&engagement_score=gt.0&order=engagement_score.desc&limit=${limit}&select=unified_id,full_name,email,company_name,title,engagement_score,last_call_date,last_email_date,last_meeting_date,total_calls,total_emails_sent`,
        { headers: { apikey: GOV_KEY, Authorization: `Bearer ${GOV_KEY}` }, signal: controller.signal }
      );
      return res.ok ? await res.json() : [];
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }
}

async function fetchDomainTransactionCounts(): Promise<any> {
  const ttmDate = new Date(Date.now() - 365 * 86400000).toISOString().split("T")[0];
  const queryDomain = async (url: string | undefined, key: string | undefined, label: string) => {
    if (!url || !key) return { count: 0, label };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`${url}/rest/v1/sales_transactions?select=sale_id&sale_date=gte.${ttmDate}`, {
          headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
          signal: controller.signal,
        });
        if (!res.ok) return { count: 0, label };
        const contentRange = res.headers.get("content-range");
        let count = 0;
        if (contentRange) {
          const m = contentRange.match(/\/(\d+)/);
          if (m) count = parseInt(m[1], 10);
        } else {
          const data = await res.json();
          count = Array.isArray(data) ? data.length : 0;
        }
        return { count, label };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return { count: 0, label };
    }
  };
  const [gov, dia] = await Promise.all([queryDomain(GOV_URL, GOV_KEY, "government"), queryDomain(DIA_URL, DIA_KEY, "dialysis")]);
  return { gov, dia };
}

export async function fetchDiaPipeline(): Promise<any> {
  if (!DIA_URL || !DIA_KEY) return { deals: [], leads: [] };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const [dealsRes, leadsRes] = await Promise.all([
        fetch(
          `${DIA_URL}/rest/v1/salesforce_activities?nm_type=eq.Opportunity&is_closed=eq.false&order=activity_date.desc&limit=20&select=id,subject,who_name,what_name,status,activity_date,due_date,priority,description`,
          { headers: { apikey: DIA_KEY, Authorization: `Bearer ${DIA_KEY}` }, signal: controller.signal }
        ),
        fetch(
          `${DIA_URL}/rest/v1/salesforce_activities?nm_type=eq.Task&is_closed=eq.false&order=due_date.asc.nullslast&limit=20&select=id,subject,who_name,what_name,status,activity_date,due_date,priority,description`,
          { headers: { apikey: DIA_KEY, Authorization: `Bearer ${DIA_KEY}` }, signal: controller.signal }
        ),
      ]);
      return {
        deals: dealsRes.ok ? await dealsRes.json() : [],
        leads: leadsRes.ok ? await leadsRes.json() : [],
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { deals: [], leads: [] };
  }
}

// ============================================================================
// Strategic Priority Scoring Engine
// ============================================================================

const DEAL_KEYWORDS = /offer|under contract|loi|letter of intent|closing|escrow|due diligence|earnest money|psa|purchase|disposition|assignment/i;
const REVENUE_KEYWORDS = /commission|fee|listing agreement|exclusive|signed|engaged|retained/i;
const PURSUIT_KEYWORDS = /bov|proposal|valuation|pitch|pursuit|prospect|owner|developer|seller/i;
const RELATIONSHIP_KEYWORDS = /follow[- ]?up|check[- ]?in|touch base|reconnect|introduction|referral|thank you|congrat/i;

function scoreItem(item: any, hotContactMap: Map<string, any>): { score: number; tier: string } {
  let score = 0;
  let tier = "urgent";
  const title = (item.title || "").toLowerCase();
  const body = (item.body || "").toLowerCase();
  const combined = title + " " + body;
  const senderEmail = item.metadata?.sender_email || "";
  const senderName = item.metadata?.sender_name || item.metadata?.sf_who || "";

  if (DEAL_KEYWORDS.test(combined)) {
    score += 100;
    tier = "strategic";
  }
  if (REVENUE_KEYWORDS.test(combined)) {
    score += 90;
    tier = "strategic";
  }
  if (PURSUIT_KEYWORDS.test(combined)) {
    score += 70;
    if (tier !== "strategic") tier = "strategic";
  }

  if (RELATIONSHIP_KEYWORDS.test(combined)) {
    score += 50;
    if (tier === "urgent") tier = "important";
  }

  if (senderEmail && hotContactMap) {
    const contact = hotContactMap.get(senderEmail.toLowerCase());
    if (contact) {
      score += Math.min(contact.engagement_score || 0, 50);
      if (contact.engagement_score >= 60) tier = tier === "urgent" ? "important" : tier;
    }
  }

  if (item.due_date) {
    const due = new Date(item.due_date);
    const now = new Date();
    const daysUntil = (due.getTime() - now.getTime()) / 86400000;
    if (daysUntil < 0) score += 40;
    else if (daysUntil < 1) score += 30;
    else if (daysUntil < 3) score += 20;
    else if (daysUntil < 7) score += 10;
  }

  if (item.priority === "urgent") score += 30;
  else if (item.priority === "high") score += 20;

  if (item.source_type === "sf_task") score += 15;
  if (item.source_type === "flagged_email") score += 10;

  if (item.metadata?.has_attachments) score += 5;

  return { score, tier };
}

export async function buildStrategicPriorities(
  roleView: string,
  myWork: any[],
  inboxItems: any[],
  sfActivity: any[],
  hotContacts: any[],
  diaPipeline: any,
  unassignedWork: any[],
  syncHealth: any,
  workCounts: any
): Promise<any> {
  const today = new Date();
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + 7);

  const hotContactMap = new Map();
  (hotContacts || []).forEach((c: any) => {
    if (c.email) hotContactMap.set(c.email.toLowerCase(), c);
  });

  const allItems: any[] = [];

  for (const item of (inboxItems || [])) {
    const { score, tier } = scoreItem(item, hotContactMap);
    allItems.push({ ...item, _score: score, _tier: tier, _source: "inbox" });
  }

  for (const item of (myWork || [])) {
    const { score, tier } = scoreItem(item, hotContactMap);
    allItems.push({ ...item, _score: score, _tier: tier, _source: "work" });
  }

  for (const item of (sfActivity || [])) {
    const { score, tier } = scoreItem(item, hotContactMap);
    if (score >= 30) {
      allItems.push({
        id: item.id,
        title: item.title,
        status: item.metadata?.sf_status || "open",
        priority: item.metadata?.priority || "normal",
        due_date: item.metadata?.activity_date || null,
        domain: null,
        type: "sf_activity",
        metadata: item.metadata,
        _score: score,
        _tier: tier,
        _source: "salesforce",
      });
    }
  }

  for (const deal of (diaPipeline?.deals || [])) {
    const pseudoItem = {
      title: deal.subject || deal.what_name || "(deal)",
      body: deal.description || "",
      due_date: deal.due_date || deal.activity_date,
      priority: deal.priority === "High" ? "high" : "normal",
      metadata: { sf_who: deal.who_name, sf_what: deal.what_name },
    };
    const { score, tier } = scoreItem(pseudoItem, hotContactMap);
    if (score >= 20) {
      allItems.push({
        id: deal.id,
        title: deal.subject || deal.what_name || "(deal)",
        status: deal.status || "open",
        priority: pseudoItem.priority,
        due_date: pseudoItem.due_date,
        domain: "dialysis",
        type: "sf_deal",
        _score: score + 20,
        _tier: tier === "urgent" ? "important" : tier,
        _source: "pipeline",
      });
    }
  }

  allItems.sort((a, b) => b._score - a._score);

  const strategic = allItems.filter((i) => i._tier === "strategic");
  const important = allItems.filter((i) => i._tier === "important");
  const urgent = allItems.filter((i) => i._tier === "urgent");

  const todayPriorities = [...strategic.slice(0, 3), ...important.slice(0, 3), ...urgent.slice(0, 4)].slice(0, 7);

  const now = Date.now();
  const touchpointCandidates = (hotContacts || [])
    .filter((c: any) => {
      const lastTouch = Math.max(
        c.last_call_date ? new Date(c.last_call_date).getTime() : 0,
        c.last_email_date ? new Date(c.last_email_date).getTime() : 0,
        c.last_meeting_date ? new Date(c.last_meeting_date).getTime() : 0
      );
      return lastTouch > 0 && (now - lastTouch) > 14 * 86400000;
    })
    .sort((a: any, b: any) => (b.engagement_score || 0) - (a.engagement_score || 0))
    .slice(0, 10)
    .map((c: any) => ({
      id: c.unified_id,
      name: c.full_name,
      company: c.company_name,
      score: c.engagement_score,
      days_since_touch: Math.floor(
        (now -
          Math.max(
            c.last_call_date ? new Date(c.last_call_date).getTime() : 0,
            c.last_email_date ? new Date(c.last_email_date).getTime() : 0,
            c.last_meeting_date ? new Date(c.last_meeting_date).getTime() : 0
          )) /
          86400000
      ),
      reason: "High engagement contact overdue for touchpoint",
    }));

  const weightedCandidates = await Promise.all(
    touchpointCandidates.map(async (contact: any) => {
      let weight = 1.0;
      try {
        const weightResult = await Promise.race([
          opsQuery("POST", "rpc/get_contact_recommendation_weight", { p_entity_id: contact.id }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 500)),
        ]);
        if (weightResult.ok && weightResult.data != null) {
          const parsed = typeof weightResult.data === "number" ? weightResult.data : parseFloat(weightResult.data);
          if (!isNaN(parsed)) weight = parsed;
        }
      } catch {
        // timeout or query error — keep default weight 1.0
      }

      const recommendation_note =
        weight === 0.5
          ? "Previously dismissed — lower priority"
          : weight === 1.5
            ? "High engagement history — prioritize"
            : "";

      return { ...contact, recommendation_weight: weight, recommendation_note };
    })
  );

  const staleTouchpoints = weightedCandidates
    .sort(
      (a, b) =>
        ((b.days_since_touch || 0) * b.recommendation_weight) - ((a.days_since_touch || 0) * a.recommendation_weight)
    )
    .slice(0, 5);

  if (TEAMS_COLD_ALERTS_ENABLED) {
    const goingCold = (hotContacts || [])
      .filter((c: any) => {
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
      // Note: Teams alert handling ported as console.log (fire-and-forget)
      console.log("[Briefing] Going cold alert:", {
        name: c.full_name || "Unknown",
        company: c.company_name || "Unknown",
        lastTouch: new Date(lastTouch).toISOString().split("T")[0],
        daysSince,
        engagement: c.engagement_score || 0,
      });
    }
  }

  const overdue = allItems.filter((i) => i.due_date && new Date(i.due_date) < today);
  const dueThisWeek = allItems.filter((i) => {
    if (!i.due_date) return false;
    const due = new Date(i.due_date);
    return due >= today && due <= weekEnd;
  });

  return {
    today_priorities: todayPriorities
      .map((i: any) => {
        const title = deriveItemTitle(i);
        if (!title) return null;
        return {
          id: i.id,
          title,
          status: i.status || null,
          priority: i.priority || null,
          due_date: i.due_date || null,
          domain: i.domain || null,
          type: i.type || i.item_type || i.source_type || "action",
          tier: i._tier,
          score: i._score,
          source: i._source,
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
      inboxItems.filter((i) => {
        const { score } = scoreItem(i, hotContactMap);
        return score >= 20;
      }).slice(0, 5),
      5
    ),
    pipeline_deals: (diaPipeline?.deals || []).slice(0, 5).map((d: any) => ({
      id: d.id,
      title: d.subject || d.what_name,
      contact: d.who_name,
      status: d.status,
      due: d.due_date || d.activity_date,
      domain: "dialysis",
    })),
    sf_activity_summary: {
      total_7d: (sfActivity || []).length,
      calls: (sfActivity || []).filter((a: any) => a.category === "call").length,
      emails: (sfActivity || []).filter((a: any) => a.category === "email").length,
      tasks: (sfActivity || []).filter((a: any) => a.category === "note").length,
    },
  };
}

// ============================================================================
// Legacy Priority Projection (for analyst_ops and manager views)
// ============================================================================

function projectPriorities(
  roleView: string,
  myWork: any[],
  inboxSummary: any,
  unassignedWork: any[],
  syncHealth: any,
  workCounts: any
): any {
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
  const recommendedCalls = myWork.filter((item) => callRegex.test(item.title || "")).slice(0, 5);
  const recommendedFollowups = inboxSummary.items.slice(0, 5);

  if (roleView === "manager") {
    const managerTop = [];
    if (workCounts.open_escalations > 0) {
      managerTop.push({
        id: "_escalations",
        title: `${workCounts.open_escalations} open escalation${workCounts.open_escalations > 1 ? "s" : ""} need attention`,
        status: "needs_review",
        priority: "urgent",
        due_date: null,
        domain: "ops",
        source_type: "escalation",
      });
    }
    if (unassignedWork.length > 0) {
      managerTop.push({
        id: "_unassigned",
        title: `${unassignedWork.length} unassigned item${unassignedWork.length > 1 ? "s" : ""} in team queue`,
        status: "needs_review",
        priority: "high",
        due_date: null,
        domain: "ops",
        source_type: "unassigned",
      });
    }
    if (workCounts.overdue > 0) {
      managerTop.push({
        id: "_overdue",
        title: `${workCounts.overdue} overdue item${workCounts.overdue > 1 ? "s" : ""} across team`,
        status: "needs_review",
        priority: "high",
        due_date: null,
        domain: "ops",
        source_type: "overdue",
      });
    }
    if (workCounts.sync_errors > 3) {
      managerTop.push({
        id: "_sync_errors",
        title: `${workCounts.sync_errors} unresolved sync errors`,
        status: "needs_review",
        priority: "normal",
        due_date: null,
        domain: "ops",
        source_type: "sync_error",
      });
    }
    managerTop.push(...overdue.slice(0, 5 - managerTop.length));

    return {
      today_top_5: mapPriorityItems(managerTop, 5),
      my_overdue: mapPriorityItems(overdue, 5),
      my_due_this_week: mapPriorityItems(dueThisWeek, 5),
      recommended_calls: [],
      recommended_followups: mapPriorityItems(unassignedWork, 5),
    };
  }

  if (roleView === "analyst_ops") {
    const opsTop = [
      ...inboxSummary.items.slice(0, 3),
      ...syncHealth.unresolved_errors.slice(0, 2).map((err: any) => ({
        id: err.id,
        title: `Sync issue: ${err.error_message || "error"}`,
        status: "needs_review",
        priority: err.is_retryable ? "high" : "normal",
        due_date: null,
        domain: "ops",
        source_type: "sync_error",
      })),
    ];
    return {
      today_top_5: mapPriorityItems(opsTop, 5),
      my_overdue: mapPriorityItems(overdue, 5),
      my_due_this_week: mapPriorityItems(dueThisWeek, 5),
      recommended_calls: mapPriorityItems(recommendedCalls, 3),
      recommended_followups: mapPriorityItems(recommendedFollowups, 5),
    };
  }

  return {
    today_top_5: mapPriorityItems(myWork, 5),
    my_overdue: mapPriorityItems(overdue, 5),
    my_due_this_week: mapPriorityItems(dueThisWeek, 5),
    recommended_calls: mapPriorityItems(recommendedCalls, 5),
    recommended_followups: mapPriorityItems(recommendedFollowups, 5),
  };
}

function buildActions(roleView: string): any[] {
  const base = [
    { label: "Open My Queue", type: "nav", target: "pagePipeline" },
    { label: "Open Inbox Triage", type: "nav", target: "pageInbox" },
    { label: "View Sync Health", type: "nav", target: "pageSyncHealth" },
  ];
  if (roleView === "analyst_ops" || roleView === "manager") {
    base.push({ label: "Review Unassigned Work", type: "nav", target: "pagePipeline" });
  }
  if (roleView === "manager") {
    base.push({ label: "View Escalations", type: "nav", target: "pagePipeline" });
  }
  return base;
}

const GOV_DOMAIN_RE = /\b(gsa|federal|government|gov\b|lease|tenant|agency|sba|hud|va\b|dod|usda|fema|census|opm)\b/i;
const DIA_DOMAIN_RE =
  /\b(dialysis|davita|fresenius|clinic|renal|kidney|nephrology|npi|cms\b|esrd|rcm)\b/i;

function inferDomain(item: any): string | null {
  if (item.domain === "government" || item.domain === "dialysis") return item.domain;
  const text = `${item.title || ""} ${item.body || ""} ${item.metadata?.sender_name || ""} ${item.metadata?.sender_email || ""}`;
  if (GOV_DOMAIN_RE.test(text)) return "government";
  if (DIA_DOMAIN_RE.test(text)) return "dialysis";
  return null;
}

function buildDomainSignals(myWork: any[], inboxSummary: any, unassignedWork: any[], hotContacts: any[], diaPipeline: any): any {
  const govHighlights: string[] = [];
  const diaHighlights: string[] = [];
  const seenGov = new Set();
  const seenDia = new Set();

  const keyFor = (item: any) =>
    item.id || item.external_id || item.task_id || (item.title ? String(item.title).trim().toLowerCase() : null);

  const allOpsItems = [...(myWork || []), ...(inboxSummary.items || [])];
  for (const item of allOpsItems) {
    const domain = inferDomain(item);
    if (domain !== "government" && domain !== "dialysis") continue;
    const title = deriveItemTitle(item);
    if (!title) continue;
    const k = keyFor(item) || title.toLowerCase();
    if (domain === "government" && !seenGov.has(k)) {
      seenGov.add(k);
      govHighlights.push(title);
    }
    if (domain === "dialysis" && !seenDia.has(k)) {
      seenDia.add(k);
      diaHighlights.push(title);
    }
  }

  for (const c of (hotContacts || [])) {
    if (govHighlights.length >= 5) break;
    const name = deriveItemTitle(c);
    if (!name) continue;
    const score = c.engagement_score ? ` (score: ${c.engagement_score})` : "";
    govHighlights.push(`${name}${score}`);
  }

  const diaPipe = diaPipeline || { deals: [], leads: [] };
  for (const deal of (diaPipe.deals || [])) {
    if (diaHighlights.length >= 5) break;
    const title = deriveItemTitle(deal);
    if (!title) continue;
    diaHighlights.push(title);
  }
  for (const lead of (diaPipe.leads || [])) {
    if (diaHighlights.length >= 5) break;
    const title = deriveItemTitle(lead);
    if (!title) continue;
    diaHighlights.push(title);
  }

  const govReview = (unassignedWork || []).filter((item) => inferDomain(item) === "government").slice(0, 5);
  const diaReview = (unassignedWork || []).filter((item) => inferDomain(item) === "dialysis").slice(0, 5);

  return {
    government: {
      highlights: govHighlights.slice(0, 5),
      review_required: mapPriorityItems(govReview, 5),
      freshness_flags: [],
    },
    dialysis: {
      highlights: diaHighlights.slice(0, 5),
      review_required: mapPriorityItems(diaReview, 5),
      freshness_flags: [],
    },
  };
}

// ============================================================================
// Daily Briefing Packet Builder
// ============================================================================

function buildPacketItem(item: any, rank: number, category: string): any {
  const title = deriveItemTitle(item);
  if (!title) return null;
  return {
    priority_rank: rank,
    category: category || item.type || "general",
    title,
    entity_name: title,
    entity_id: item.id || null,
    context: item.metadata?.description || item.body || null,
    suggested_actions: [],
    tier: item._tier || null,
    score: item._score || 0,
    source: item._source || null,
    domain: item.domain || null,
  };
}

function buildProductionScore(workCounts: any, sfActivity: any): any {
  const calls = (sfActivity || []).filter((a: any) => a.category === "call").length;
  const emails = (sfActivity || []).filter((a: any) => a.category === "email").length;
  return {
    bd_touchpoints: {
      planned: 10,
      completed_yesterday: 0,
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
      open: 0,
      overdue_48h: 0,
    },
    seller_reports_sent: {
      due_this_week: 0,
      sent: 0,
    },
  };
}

function buildOvernightSignals(morningStructured: any): any[] {
  if (!morningStructured || !morningStructured.sector_signals) return [];
  return (morningStructured.sector_signals || []).slice(0, 5).map((s: any) => ({
    signal_type: "market_intelligence",
    description: typeof s === "string" ? s : (s.description || s.text || JSON.stringify(s)),
    entity_name: null,
    recommended_action: null,
  }));
}

async function writeBriefingPacket(userId: string, packetPayload: any): Promise<void> {
  try {
    const ttlHours = 18;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
    const tokenEstimate = Math.ceil(JSON.stringify(packetPayload).length / 4);

    try {
      const result = await opsQuery("POST", "context_packets", {
        packet_type: "daily_briefing",
        entity_id: null,
        entity_type: null,
        requesting_user: userId,
        surface_hint: "daily_briefing",
        payload: packetPayload,
        token_count: tokenEstimate,
        expires_at: expiresAt,
        assembly_duration_ms: 0,
        model_version: "v1.0",
      });
      if (!result || !result.ok) {
        console.error(
          "[Briefing write error] context_packets insert failed:",
          `status=${result?.status}`,
          result?.data?.message || result?.data || "unknown error"
        );
      }
    } catch (writeErr) {
      console.error("[Briefing write error] context_packets insert threw:", (writeErr as Error)?.message || writeErr);
    }
  } catch (err) {
    console.error("[Briefing write error] packet preparation failed:", (err as Error)?.message || err);
  }
}

// ============================================================================
// Main Handler
// ============================================================================

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "GET") {
    return errorResponse(req, `Method ${req.method} not allowed`, 405);
  }

  const params = queryParams(req);
  const action = params.get("action");

  // Health check endpoint
  if (action === "health") {
    return jsonResponse(req, { status: "ok", timestamp: new Date().toISOString() });
  }

  if (action !== "snapshot") {
    return errorResponse(req, "Invalid action. Use action=snapshot", 400);
  }

  const user = await authenticateUser(req);
  if (!user) {
    return errorResponse(req, "Authentication failed", 401);
  }

  const workspaceId = req.headers.get("x-lcc-workspace") || primaryWorkspaceId(user);
  if (!workspaceId) {
    return errorResponse(req, "No workspace context", 400);
  }

  const membership = user.memberships?.find((m) => m.workspace_id === workspaceId);
  if (!membership) {
    return errorResponse(req, "Not a member of this workspace", 403);
  }

  const roleView = pickRoleView(params.get("role_view"), membership.role);
  const asOf = new Date().toISOString();

  const defaultWorkCounts = {
    open: 0,
    overdue: 0,
    due_today: 0,
    my_actions: 0,
    my_overdue: 0,
    my_inbox: 0,
    my_research: 0,
    my_completed_week: 0,
    open_actions: 0,
    inbox_new: 0,
    inbox_triaged: 0,
    research_active: 0,
    sync_errors: 0,
    due_this_week: 0,
    completed_week: 0,
    open_escalations: 0,
    refreshed_at: null,
    _mv_raw: { _source: "default_fallback" },
  };
  const defaultInbox = { total_new: 0, total_triaged: 0, items: [] };
  const defaultSyncHealth = {
    summary: {
      total_connectors: 0,
      healthy: 0,
      degraded: 0,
      error: 0,
      disconnected: 0,
      pending: 0,
      outbound_success_rate_24h: null,
    },
    unresolved_errors: [],
    queue_drift: {
      source: "salesforce",
      salesforce_open_task_count: 0,
      last_sf_records_processed: 0,
      estimated_gap: 0,
      drift_flag: false,
      last_inbound_completed_at: null,
    },
  };

  const safe = async (fn: () => Promise<any>, fallback: any) => {
    try {
      return await fn();
    } catch (err) {
      console.error(`[Briefing fetch failed] ${fn.name || "anonymous"}:`, (err as Error)?.message || err);
      return fallback;
    }
  };

  const [morningStructured, morningHtml, workCounts, myWork, inboxSummary, unassignedWork, syncHealth, sfActivity, hotContacts, diaPipeline, crossDomainHighlights] = await Promise.all([
    safe(() => fetchMorningStructured(), { ok: false, missing: true, reason: "structured_fetch_timeout" }),
    safe(() => fetchMorningHtml(), { ok: false, missing: true, reason: "html_fetch_timeout" }),
    safe(() => fetchWorkCounts(workspaceId, user.id), defaultWorkCounts),
    safe(() => fetchMyWork(workspaceId, user.id, 15), []),
    safe(() => fetchInboxSummary(workspaceId, 10), defaultInbox),
    safe(() => fetchUnassignedWork(workspaceId, 10), []),
    safe(() => fetchSyncHealthSnapshot(workspaceId), defaultSyncHealth),
    safe(() => fetchRecentSfActivity(workspaceId, 30), []),
    safe(() => fetchHotContacts(15), []),
    safe(() => fetchDiaPipeline(), { deals: [], leads: [] }),
    safe(() => fetchCrossDomainOwnersDueForTouch(workspaceId, 5), []),
  ]);

  try {
    const missingSections: string[] = [];
    let globalMarketIntelligence = morningStructured.ok ? morningStructured.data : null;

    if (!morningStructured.ok) {
      missingSections.push("global_market_intelligence.structured_payload");
      if (morningHtml.ok) {
        globalMarketIntelligence = {
          source_system: "morning_briefing",
          summary: null,
          highlights: [],
          sector_signals: [],
          watchlist: [],
          html_fragment: morningHtml.data,
          source_links: [],
        };
      } else {
        missingSections.push("global_market_intelligence.html_fragment");
        let fallbackSummary = null;
        let fallbackHighlights = [];
        try {
          const txCounts = await fetchDomainTransactionCounts();
          const parts = [];
          if (txCounts.dia.count > 0) parts.push(`${txCounts.dia.count} dialysis transaction${txCounts.dia.count !== 1 ? "s" : ""}`);
          if (txCounts.gov.count > 0) parts.push(`${txCounts.gov.count} government transaction${txCounts.gov.count !== 1 ? "s" : ""}`);
          if (parts.length > 0) {
            fallbackSummary = `Trailing 12-month activity: ${parts.join(" and ")} tracked.`;
          }
          if (txCounts.dia.count > 0) {
            fallbackHighlights.push({
              title: `Dialysis TTM volume: ${txCounts.dia.count} transactions`,
              category: "dialysis",
            });
          }
          if (txCounts.gov.count > 0) {
            fallbackHighlights.push({
              title: `Government TTM volume: ${txCounts.gov.count} transactions`,
              category: "government",
            });
          }
        } catch (err) {
          console.error("[Briefing] domain transaction fallback failed:", (err as Error)?.message || err);
        }
        globalMarketIntelligence = {
          source_system: "domain_fallback",
          summary: fallbackSummary,
          highlights: fallbackHighlights,
          sector_signals: [],
          watchlist: [],
          html_fragment: null,
          source_links: [],
        };
      }
    } else if (!globalMarketIntelligence.html_fragment && morningHtml.ok) {
      globalMarketIntelligence.html_fragment = morningHtml.data;
    }

    const strategicPriorities =
      roleView === "broker"
        ? await buildStrategicPriorities(roleView, myWork, inboxSummary.items, sfActivity, hotContacts, diaPipeline, unassignedWork, syncHealth, workCounts)
        : projectPriorities(roleView, myWork, inboxSummary, unassignedWork, syncHealth, workCounts);

    const todayItems = strategicPriorities.today_priorities || strategicPriorities.today_top_5 || [];
    const strategicItems = todayItems.filter((i: any) => i.tier === "strategic" || i._tier === "strategic");
    const importantItems = todayItems.filter((i: any) => i.tier === "important" || i._tier === "important");
    const urgentItems = todayItems.filter((i: any) => i.tier === "urgent" || i._tier === "urgent");

    const dailyBriefingPacket = {
      packet_type: "daily_briefing",
      generated_at: asOf,
      date: safeDateOnly(asOf),
      user_id: user.id,
      strategic_items: strategicItems.map((item: any, i: number) => buildPacketItem(item, i + 1, "deal_action")).filter(Boolean),
      important_items: importantItems.map((item: any, i: number) => buildPacketItem(item, i + 1, "touchpoint_due")).filter(Boolean),
      urgent_items: urgentItems.map((item: any, i: number) => buildPacketItem(item, i + 1, "inbox_triage")).filter(Boolean),
      production_score: buildProductionScore(workCounts, sfActivity),
      overnight_signals: buildOvernightSignals(globalMarketIntelligence),
      carry_forward_from_yesterday: (strategicPriorities.my_overdue || [])
        .map((item: any) => {
          const title = deriveItemTitle(item);
          if (!title) return null;
          return {
            item: title,
            days_carried: item.due_date ? Math.max(0, Math.floor((Date.now() - new Date(item.due_date).getTime()) / 86400000)) : 0,
          };
        })
        .filter(Boolean),
    };

    try {
      const packetWrite = writeBriefingPacket(user.id, dailyBriefingPacket);
      if (packetWrite && typeof packetWrite.catch === "function") {
        packetWrite.catch((err: Error) => {
          console.error("[Briefing write error] packet write rejected:", err?.message || err);
        });
      }
    } catch (err) {
      console.error("[Briefing write error] packet write threw:", (err as Error)?.message || err);
    }

    try {
      const signalWrite = writeSignal({
        signal_type: "packet_assembled",
        signal_category: "intelligence",
        user_id: user.id,
        payload: {
          packet_type: "daily_briefing",
          strategic_count: strategicItems.length,
          important_count: importantItems.length,
          urgent_count: urgentItems.length,
          carry_forward_count: dailyBriefingPacket.carry_forward_from_yesterday.length,
        },
      });
      if (signalWrite && typeof signalWrite.catch === "function") {
        signalWrite.catch((err: Error) => {
          console.error("[Briefing write error] signal write rejected:", err?.message || err);
        });
      }
    } catch (err) {
      console.error("[Briefing write error] signal write threw:", (err as Error)?.message || err);
    }

    const payload = {
      briefing_id: buildBriefingId(asOf, workspaceId, user.id, roleView),
      as_of: asOf,
      timezone: "America/Chicago",
      workspace_id: workspaceId,
      audience: pickAudience(roleView),
      role_view: roleView,
      status: {
        completeness: missingSections.length > 0 ? "degraded" : "full",
        missing_sections: missingSections,
      },
      global_market_intelligence: globalMarketIntelligence,
      global_signals: {
        team: {
          open: workCounts.open,
          overdue: workCounts.overdue,
          due_today: workCounts.due_today,
          refreshed_at: workCounts.refreshed_at,
        },
      },
      _debug: {
        work_counts_raw: workCounts._mv_raw || null,
      },
      daily_briefing_packet: dailyBriefingPacket,
      user_specific_priorities: strategicPriorities,
      team_level_production_signals: {
        work_counts: {
          open: workCounts.open,
          open_actions: workCounts.open_actions,
          inbox_new: workCounts.inbox_new,
          inbox_triaged: workCounts.inbox_triaged,
          research_active: workCounts.research_active,
          sync_errors: workCounts.sync_errors,
          overdue: workCounts.overdue,
          due_today: workCounts.due_today,
          due_this_week: workCounts.due_this_week,
          completed_week: workCounts.completed_week,
          open_escalations: workCounts.open_escalations,
          refreshed_at: workCounts.refreshed_at,
        },
        inbox_summary: inboxSummary,
        unassigned_work: unassignedWork,
        sync_health: syncHealth,
      },
      domain_specific_alerts_highlights: buildDomainSignals(myWork, inboxSummary, unassignedWork, hotContacts, diaPipeline),
      cross_domain_highlights: crossDomainHighlights,
      actions: buildActions(roleView),
    };

    return jsonResponse(req, payload);
  } catch (assemblyErr) {
    console.error("[Briefing assembly failed]", (assemblyErr as Error)?.message || assemblyErr, (assemblyErr as any)?.stack);
    return jsonResponse(
      req,
      {
        error: "Briefing build failed",
        partial: true,
        briefing_id: buildBriefingId(asOf, workspaceId, user.id, roleView),
        as_of: asOf,
        workspace_id: workspaceId,
        role_view: roleView,
        status: { completeness: "failed", missing_sections: ["assembly_error"] },
        work_counts: workCounts,
        actions: buildActions(roleView),
      },
      500
    );
  }
});
