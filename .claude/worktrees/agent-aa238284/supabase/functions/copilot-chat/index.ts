// ============================================================================
// Copilot Chat — AI chat with context enrichment
// Life Command Center — Infrastructure Migration Phase 3
//
// Ported from api/operations.js handleChatRoute (lines ~2229-2387)
// + fetchPortfolioStats (lines ~522-589) + fetchOpsContext (lines ~1742-1818)
// + invokeChatProvider from api/_shared/ai.js
//
// Handles:
//   POST ?action=chat            — main chat with context enrichment + LLM
//   POST ?action=followup        — copilot_followup signal write
//   GET  ?action=health          — health check
//   GET  (no action)             — info endpoint
//
// NOT handled here (stays on Vercel):
//   copilot_action dispatch      — too many dependencies on action handlers
//   GET spec/manifest            — stateless, low compute
// ============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { opsQuery, rawQuery } from "../_shared/supabase-client.ts";
import { authenticateUser, primaryWorkspaceId } from "../_shared/auth.ts";
import { writeSignal } from "../_shared/signals.ts";
import { queryParams, parseBody, isoNow } from "../_shared/utils.ts";

// ── AI Config ──────────────────────────────────────────────────────────────

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_EDGE_FN_URL = "https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot";

function getAiConfig() {
  const provider = (Deno.env.get("AI_CHAT_PROVIDER") || "edge").toLowerCase();
  const edgeBaseUrl = (Deno.env.get("AI_CHAT_URL") || Deno.env.get("EDGE_FUNCTION_URL") || DEFAULT_EDGE_FN_URL).replace(/\/+$/, "");
  const openaiBaseUrl = (Deno.env.get("AI_API_BASE_URL") || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY") || "";
  const chatModel = Deno.env.get("AI_CHAT_MODEL") || Deno.env.get("AI_MODEL") || "gpt-5-mini";
  return { provider, edgeBaseUrl, openaiBaseUrl, openaiApiKey, chatModel };
}

// ── System Prompt ──────────────────────────────────────────────────────────

const COPILOT_SYSTEM_PROMPT = `You are the Life Command Center (LCC) Copilot — an AI assistant for a commercial real estate brokerage team led by Scott Briggs at NorthMarq. You help the team source, secure, market, execute, and compound listing-driven production in net lease investment sales, focused on government-leased and dialysis/kidney care assets.

You have access to live portfolio, operational, Salesforce CRM, and contact engagement data injected as "Context JSON" in the user's message. This data is REAL and current — it comes from the team's actual databases. Always reference the specific numbers and names from the Context JSON when answering.

## Strategic Prioritization Framework

Structure every response about priorities and daily planning using this hierarchy:

1. **STRATEGIC** (do first) — actions that directly advance revenue production:
   - Active deal responses (offers, LOIs, PSAs, closing items, due diligence)
   - Listing pursuit opportunities (BOVs, proposals, pitch meetings)
   - High-value relationship touchpoints (warm contacts going cold, referral follow-ups)

2. **IMPORTANT** (do second) — actions that build pipeline and protect relationships:
   - Prospecting outreach to warm contacts (engagement score > 30)
   - Seller communication (weekly updates, marketing reports)
   - Client and partner follow-ups that aren't deal-critical today
   - Research and analysis that informs pursuit strategy

3. **URGENT** (do third) — operational items that need attention:
   - Inbox triage and email processing
   - Sync errors and system health
   - Internal queue management and task updates
   - Administrative and compliance items

When a user asks "what should I do today?" or "give me my briefing," always lead with strategic items first. Never bury a deal response under inbox triage.

## Rules
- Never say you don't have access to real-time data — you do.
- Be concise, data-driven, and actionable. Lead with what matters most.
- When suggesting a write action, always note it requires confirmation.
- Never auto-send emails or messages — drafts require user review.
- Reference specific numbers, names, and deals from Context JSON — not generic advice.
- When the context includes inbox items with deal-related subjects (offers, LOIs, contracts), surface those first.
- When the context includes ops_work_counts, reference overdue and due_this_week counts specifically.
- When the context includes hot_leads_summary, mention contacts by name and engagement score.
- When the context includes pipeline data, reference deal counts and stages.
- When unsure, ask a clarifying question rather than guessing.
- Always frame recommendations in terms of revenue impact and business development value.`;

// ── Cross-DB Fetchers ──────────────────────────────────────────────────────

function dbFetch(baseUrl: string, apiKey: string, path: string, prefer?: string): Promise<Response> {
  const headers: Record<string, string> = {
    "apikey": apiKey, "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers["Prefer"] = prefer;
  return fetch(`${baseUrl}/rest/v1/${path}`, { headers });
}

async function fetchPortfolioStats(): Promise<Record<string, unknown>> {
  const stats: Record<string, unknown> = { gov_stats: null, dia_stats: null };

  const govUrl = Deno.env.get("GOV_SUPABASE_URL");
  const govKey = Deno.env.get("GOV_SUPABASE_KEY");
  const diaUrl = Deno.env.get("DIA_SUPABASE_URL");
  const diaKey = Deno.env.get("DIA_SUPABASE_KEY");

  const fetches: Promise<void>[] = [];

  if (govUrl && govKey) {
    fetches.push(
      dbFetch(govUrl, govKey, "mv_gov_overview_stats?select=*&limit=1")
        .then(r => r.ok ? r.json() : null)
        .then(rows => { if (Array.isArray(rows) && rows[0]) stats.gov_stats = rows[0]; })
        .catch(e => console.warn("[copilot-chat] Gov stats fetch failed:", (e as Error).message))
    );
    fetches.push(
      dbFetch(govUrl, govKey, "v_opportunity_domain_classified?domain=eq.government&status=eq.Open&order=activity_date.desc.nullslast&limit=10&select=deal_display_name,contact_name,company_name,activity_date,deal_priority")
        .then(r => r.ok ? r.json() : [])
        .then(rows => { if (Array.isArray(rows)) stats.gov_opportunities = rows; })
        .catch(() => {})
    );
  }

  if (diaUrl && diaKey) {
    fetches.push(
      dbFetch(diaUrl, diaKey, "v_counts_freshness?select=*&limit=1")
        .then(r => r.ok ? r.json() : null)
        .then(rows => { if (Array.isArray(rows) && rows[0]) stats.dia_stats = rows[0]; })
        .catch(e => console.warn("[copilot-chat] Dialysis stats fetch failed:", (e as Error).message))
    );
    fetches.push(
      dbFetch(diaUrl, diaKey, "clinic_financial_estimates?select=count&limit=1", "count=exact")
        .then(r => {
          const range = r.headers.get("content-range");
          if (range) {
            const match = range.match(/\/(\d+)/);
            if (match) stats.dia_clinic_count = parseInt(match[1], 10);
          }
        })
        .catch(e => console.warn("[copilot-chat] Dialysis clinic count fetch failed:", (e as Error).message))
    );
    fetches.push(
      dbFetch(diaUrl, diaKey, "v_opportunity_domain_classified?domain=eq.dialysis&status=eq.Open&order=activity_date.desc.nullslast&limit=10&select=deal_display_name,contact_name,company_name,activity_date,deal_priority")
        .then(r => r.ok ? r.json() : [])
        .then(rows => { if (Array.isArray(rows)) stats.dia_opportunities = rows; })
        .catch(() => {})
    );
    fetches.push(
      dbFetch(diaUrl, diaKey, "v_facility_patient_counts_mom?patient_delta=gt.5&order=patient_delta.desc&limit=5&select=facility_name,city,state,patient_count,patient_delta,pct_change")
        .then(r => r.ok ? r.json() : [])
        .then(rows => { if (Array.isArray(rows)) stats.dia_growth_clinics = rows; })
        .catch(() => {})
    );
  }

  await Promise.all(fetches);
  return stats;
}

async function fetchOpsContext(workspaceId: string, userId: string): Promise<Record<string, unknown>> {
  if (!workspaceId) return {};
  try {
    const wsEnc = encodeURIComponent(workspaceId);
    const [countResult, syncResult, recentInbox, recentSf, researchBacklog] = await Promise.all([
      opsQuery("GET", `mv_work_counts?workspace_id=eq.${wsEnc}&limit=1`),
      opsQuery("GET", `sync_errors?workspace_id=eq.${wsEnc}&resolved_at=is.null&select=id&limit=0`),
      opsQuery("GET", `inbox_items?workspace_id=eq.${wsEnc}&status=in.(new,triaged)&order=received_at.desc&limit=8&select=id,title,status,priority,source_type,metadata,received_at`),
      opsQuery("GET", `activity_events?workspace_id=eq.${wsEnc}&source_type=eq.salesforce&order=occurred_at.desc&limit=10&select=title,category,metadata,occurred_at`),
      opsQuery("GET", `research_tasks?workspace_id=eq.${wsEnc}&status=in.(queued,in_progress)&order=priority.desc,created_at.asc&limit=5&select=id,title,research_type,domain,status,priority,created_at`)
    ]);

    const counts = (countResult.data as Record<string, unknown>[])?.[0] || {};
    const inboxItems = ((recentInbox.data || []) as Record<string, unknown>[]).map(i => ({
      title: i.title,
      from: (i.metadata as Record<string, unknown>)?.sender_email || (i.metadata as Record<string, unknown>)?.sf_who || null,
      type: i.source_type,
      priority: i.priority,
      received: i.received_at
    }));
    const sfItems = ((recentSf.data || []) as Record<string, unknown>[]).map(a => ({
      title: a.title,
      type: a.category,
      contact: (a.metadata as Record<string, unknown>)?.sf_who || null,
      deal: (a.metadata as Record<string, unknown>)?.sf_what || null,
      date: a.occurred_at
    }));
    const research = ((researchBacklog.data || []) as Record<string, unknown>[]).map(r => ({
      title: r.title,
      type: r.research_type,
      domain: r.domain,
      status: r.status,
      age_days: Math.floor((Date.now() - new Date(r.created_at as string).getTime()) / 86400000)
    }));

    // Fetch hot contacts from Gov DB
    let topContacts: Record<string, unknown>[] = [];
    const govUrl = Deno.env.get("GOV_SUPABASE_URL");
    const govKey = Deno.env.get("GOV_SUPABASE_KEY");
    if (govUrl && govKey) {
      try {
        const cRes = await dbFetch(govUrl, govKey,
          "unified_contacts?contact_class=eq.business&engagement_score=gt.20&order=engagement_score.desc&limit=5&select=full_name,company_name,engagement_score,last_call_date,last_email_date,contact_type"
        );
        if (cRes.ok) {
          const contacts = await cRes.json();
          topContacts = (contacts || []).map((c: Record<string, unknown>) => ({
            name: c.full_name,
            company: c.company_name,
            score: c.engagement_score,
            type: c.contact_type,
            last_call: c.last_call_date || "never",
            last_email: c.last_email_date || "never"
          }));
        }
      } catch { /* non-fatal */ }
    }

    return {
      ops_work_counts: {
        open_actions: (counts as Record<string, number>).open_actions || 0,
        overdue: (counts as Record<string, number>).overdue_actions || 0,
        inbox_new: (counts as Record<string, number>).inbox_new || 0,
        research_active: (counts as Record<string, number>).research_active || 0,
        sync_errors: syncResult.count || 0,
        open_escalations: (counts as Record<string, number>).open_escalations || 0,
        due_this_week: (counts as Record<string, number>).due_this_week || 0,
        completed_week: (counts as Record<string, number>).completed_week || 0
      },
      recent_inbox_items: inboxItems,
      recent_sf_activity: sfItems,
      research_backlog: research,
      top_engaged_contacts: topContacts
    };
  } catch {
    return {};
  }
}

// ── LLM Invocation ─────────────────────────────────────────────────────────

function buildContextText(context: Record<string, unknown>): string {
  if (!context || typeof context !== "object" || !Object.keys(context).length) return "";
  return `Context JSON:\n${JSON.stringify(context, null, 2)}`;
}

interface ResponseMessage {
  type: string;
  role: string;
  content: Array<{ type: string; text?: string; image_url?: string; detail?: string }>;
}

function toResponseMessage(role: string, text: string, attachments: unknown[] = [], contextText = ""): ResponseMessage {
  const content: Array<{ type: string; text?: string; image_url?: string; detail?: string }> = [];
  const textParts: string[] = [];
  if (contextText && role === "user") textParts.push(contextText);
  if (text) textParts.push(text);
  if (textParts.length) {
    content.push({ type: "input_text", text: textParts.join("\n\n") });
  }
  if (role === "user" && Array.isArray(attachments)) {
    for (const item of attachments) {
      const a = item as Record<string, unknown>;
      if (a?.data_url) {
        content.push({ type: "input_image", image_url: a.data_url as string, detail: "auto" });
      }
    }
  }
  return { type: "message", role, content };
}

function extractResponseText(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string" && (data.output_text as string).trim()) {
    return (data.output_text as string).trim();
  }
  const outputs = Array.isArray(data.output) ? data.output : [];
  const parts: string[] = [];
  for (const item of outputs) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const ci of item.content) {
      if (ci?.type === "output_text" && typeof ci.text === "string") {
        parts.push(ci.text);
      }
    }
  }
  return parts.join("\n").trim();
}

async function invokeOpenAI(
  message: string, context: Record<string, unknown>,
  history: unknown[], attachments: unknown[],
  cfg: ReturnType<typeof getAiConfig>
): Promise<Record<string, unknown>> {
  if (!cfg.openaiApiKey) {
    return { ok: false, status: 503, data: { error: "OPENAI_API_KEY is not configured" }, provider: "openai" };
  }

  const contextText = buildContextText(context);
  const input: ResponseMessage[] = [];
  if (Array.isArray(history)) {
    for (const item of history.slice(-8)) {
      const h = item as Record<string, unknown>;
      if (!h?.content || !h?.role) continue;
      const role = h.role === "assistant" ? "assistant" : "user";
      input.push(toResponseMessage(role, String(h.content), [], ""));
    }
  }
  input.push(toResponseMessage("user", message, attachments, contextText));

  const res = await fetch(`${cfg.openaiBaseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cfg.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: cfg.chatModel,
      instructions: COPILOT_SYSTEM_PROMPT,
      input,
      store: false,
    }),
  });

  let data: Record<string, unknown> = {};
  try { data = await res.json(); } catch { data = { error: "Invalid OpenAI response" }; }

  const responseText = extractResponseText(data);
  return {
    ok: res.ok, status: res.status, provider: "openai",
    data: { ...data, model: data?.model || cfg.chatModel, response: responseText || data?.response || "" },
  };
}

async function invokeEdge(
  message: string, context: Record<string, unknown>,
  history: unknown[], attachments: unknown[],
  cfg: ReturnType<typeof getAiConfig>,
  workspaceId: string, userId: string, userEmail: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${cfg.edgeBaseUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LCC-Workspace": workspaceId || "",
      "X-LCC-User-Id": userId || "",
      "X-LCC-User-Email": userEmail || "",
    },
    body: JSON.stringify({
      message,
      context: context || {},
      history: Array.isArray(history) ? history : [],
      attachments: Array.isArray(attachments) ? attachments : [],
    }),
  });

  let data: Record<string, unknown> = {};
  try { data = await res.json(); } catch { data = { error: "Invalid AI provider response" }; }
  return { ok: res.ok, status: res.status, data, provider: "edge" };
}

async function invokeChatProvider(
  message: string, context: Record<string, unknown>,
  history: unknown[], attachments: unknown[],
  workspaceId: string, userId: string, userEmail: string
): Promise<Record<string, unknown>> {
  const cfg = getAiConfig();

  if (cfg.provider === "disabled" || cfg.provider === "none") {
    return { ok: false, status: 503, data: { error: "AI chat provider is disabled" }, provider: cfg.provider };
  }
  if (cfg.provider === "openai") {
    return invokeOpenAI(message, context, history, attachments, cfg);
  }
  if (cfg.provider === "edge") {
    return invokeEdge(message, context, history, attachments, cfg, workspaceId, userId, userEmail);
  }
  return { ok: false, status: 400, data: { error: `Unsupported AI provider: ${cfg.provider}` }, provider: cfg.provider };
}

// ── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const params = queryParams(req);
  const action = params.get("action");

  // GET = info or health
  if (req.method === "GET") {
    if (action === "health") return handleHealth(req);
    return jsonResponse(req, {
      service: "copilot-chat",
      version: "1.0.0",
      valid_actions: ["chat", "followup", "health"],
      note: "copilot_action dispatch stays on Vercel"
    });
  }

  if (req.method !== "POST") {
    return errorResponse(req, `Method ${req.method} not allowed`, 405);
  }

  const user = await authenticateUser(req);
  if (!user) return errorResponse(req, "Authentication failed", 401);

  const workspaceId = req.headers.get("x-lcc-workspace") || primaryWorkspaceId(user) || "";
  const body = await parseBody(req) as Record<string, unknown> | null;

  switch (action) {
    case "followup": return handleFollowup(req, body, user);
    case "chat":
    default:
      return handleChat(req, body, user, workspaceId);
  }
});

// ── Follow-up Signal ───────────────────────────────────────────────────────

function handleFollowup(
  req: Request, body: Record<string, unknown> | null,
  user: { id: string }
): Response {
  const followup = (body as Record<string, unknown>)?.copilot_followup as Record<string, unknown> | undefined;
  if (!followup) {
    return errorResponse(req, "copilot_followup object is required", 400);
  }

  const { original_action, entity_ids_acted_on, items_ignored_count,
          session_id, surface } = followup;

  writeSignal({
    signal_type: "copilot_result_acted_on",
    signal_category: "intelligence",
    user_id: user.id,
    payload: {
      original_action: original_action || null,
      entity_ids_acted_on: entity_ids_acted_on || [],
      acted_on_count: (Array.isArray(entity_ids_acted_on) ? entity_ids_acted_on.length : 0),
      items_ignored_count: items_ignored_count ?? null,
      session_id: session_id || null,
      surface: surface || "copilot_chat"
    },
    outcome: (Array.isArray(entity_ids_acted_on) && entity_ids_acted_on.length > 0) ? "positive" : "neutral"
  });

  return jsonResponse(req, { ok: true, signal: "copilot_result_acted_on" });
}

// ── Main Chat Handler ──────────────────────────────────────────────────────

async function handleChat(
  req: Request, body: Record<string, unknown> | null,
  user: { id: string; email: string },
  workspaceId: string
): Promise<Response> {
  const { message, context, history, attachments } = (body || {}) as Record<string, unknown>;

  if (!message) {
    return errorResponse(req, "message is required", 400);
  }

  // Enrich context with portfolio stats + operational signals
  let portfolioStats: Record<string, unknown> = {};
  let opsContext: Record<string, unknown> = {};
  try {
    [portfolioStats, opsContext] = await Promise.all([
      fetchPortfolioStats(),
      fetchOpsContext(workspaceId, user.id)
    ]);
  } catch {
    // Non-fatal
  }

  const enrichedContext = {
    ...((context as Record<string, unknown>) || {}),
    ...portfolioStats,
    ...opsContext,
  };

  const result = await invokeChatProvider(
    message as string,
    enrichedContext,
    Array.isArray(history) ? history : [],
    Array.isArray(attachments) ? attachments : [],
    workspaceId,
    user.id,
    user.email
  );

  if (!result.ok) {
    const data = result.data as Record<string, unknown>;
    return jsonResponse(req, {
      error: data?.error || "AI provider request failed",
      provider: result.provider,
      details: data?.details
    }, (result.status as number) || 502);
  }

  const data = result.data as Record<string, unknown>;
  return jsonResponse(req, {
    response: data?.response || (data?.content as unknown[])?.[0] || "",
    usage: data?.usage || null,
    provider: result.provider
  });
}

// ── Health Check ───────────────────────────────────────────────────────────

async function handleHealth(req: Request): Promise<Response> {
  const cfg = getAiConfig();
  const checks: Record<string, unknown> = {
    ai_provider: cfg.provider,
    ai_model: cfg.chatModel,
    openai_key_configured: !!cfg.openaiApiKey,
    gov_configured: !!(Deno.env.get("GOV_SUPABASE_URL") && Deno.env.get("GOV_SUPABASE_KEY")),
    dia_configured: !!(Deno.env.get("DIA_SUPABASE_URL") && Deno.env.get("DIA_SUPABASE_KEY")),
    timestamp: isoNow()
  };

  // Quick OPS DB check
  try {
    const r = await opsQuery("GET", "mv_work_counts?limit=1");
    checks.ops_accessible = r.ok;
  } catch {
    checks.ops_accessible = false;
  }

  return jsonResponse(req, checks);
}
