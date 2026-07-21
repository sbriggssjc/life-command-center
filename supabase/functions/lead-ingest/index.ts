// ============================================================================
// Lead Ingest — RCM + LoopNet marketing lead ingestion
// Life Command Center — Infrastructure Migration Phase 2
//
// Ported from api/sync.js lines ~1545-2397.
// Receives Power Automate webhook payloads and writes to DIA Supabase.
//
// Routes (via ?action= query param):
//   POST ?action=rcm       — ingest RCM inquiry email
//   POST ?action=loopnet   — ingest LoopNet inquiry email
//   GET  ?action=health    — health check
//   GET  (no action)       — info endpoint
// ============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { rawQuery, opsClient } from "../_shared/supabase-client.ts";
import { authenticateWebhook, authenticateUser } from "../_shared/auth.ts";
import { queryParams, parseBody, isoNow } from "../_shared/utils.ts";
import { validateContactIngest } from "../_shared/ingest-contract.ts";
import {
  parseGoogleAlert, scoreNewsAlert, routeNewsAlert, tenantDedupKey,
  NEWS_ALERT_DEDUP_DAYS, DEFAULT_TRACKED_TENANTS,
} from "./news-alert.js";
import { buildProcessingRow } from "./processing-complete.js";

// ── Auto-archive/cleanup: emit a processing_complete decision ────────────────
// A lead channel (news_alert / rcm[CREXi] / loopnet) finishes an intake job and
// records the decision in public.processing_log (LCC Opps) — the SAME table +
// move-queue api/intake.js writes. Power Automate reads the pending rows via
// GET /api/webhooks/processing-complete and moves the email (a filed lead →
// Processed/Leads), and the daily briefing counts it. Best-effort: NEVER blocks
// or fails lead ingestion (a missing workspace/table just logs a warning).
// First emit wins (check-then-insert on (workspace_id, internet_message_id); the
// DB unique index is the backstop against a Power-Automate replay double-insert).
async function emitLeadProcessingComplete(
  ops: ReturnType<typeof opsClient> | null,
  args: {
    internetMessageId?: string | null;
    graphRestId?: string | null;
    outcome: string;
    channel?: string | null;
    domain?: string | null;
    sourceRef?: string | null;
    subject?: string | null;
  },
): Promise<Record<string, unknown> | null> {
  try {
    const workspaceId = Deno.env.get("LCC_DEFAULT_WORKSPACE_ID") || null;
    if (!workspaceId) {
      console.warn("[lead-ingest] processing_complete skipped — LCC_DEFAULT_WORKSPACE_ID unset");
      return null;
    }
    let client = ops;
    if (!client) {
      try { client = opsClient(); } catch { return null; }
    }
    if (!client) return null;
    const built = buildProcessingRow({ workspaceId, ...args });
    if (!built) return null;

    // First emit wins: a prior row for this (workspace, message) is the
    // authoritative decision; a Power-Automate replay must not enqueue a second
    // move or downgrade filed→duplicate.
    const { data: existing } = await client.from("processing_log")
      .select("outcome,target_folder,move_status")
      .eq("workspace_id", workspaceId)
      .eq("internet_message_id", built.row.internet_message_id)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return {
        internet_message_id: built.row.internet_message_id,
        outcome: existing.outcome,
        target_folder: existing.target_folder,
        move_status: existing.move_status,
        deduplicated: true,
      };
    }

    const { error } = await client.from("processing_log").insert(built.row);
    if (error) {
      // 23505 = a concurrent replay already inserted — treat as an idempotent
      // no-op, not a failure. Anything else (e.g. table missing pre-migration)
      // is non-fatal: lead ingestion already succeeded.
      if ((error as { code?: string }).code !== "23505") {
        console.warn("[lead-ingest] processing_complete insert failed (non-fatal):", error.message);
      }
      return built.event;
    }
    return built.event;
  } catch (err) {
    console.warn("[lead-ingest] processing_complete emit error (non-fatal):", (err as Error).message);
    return null;
  }
}

// C9 Phase 2 (2026-05-27): sanitize a parsed lead's name through the ingest
// contract before it's written to marketing_leads. A junk/section-label or
// federal-anti-pattern name is nulled (the lead keeps its email/phone
// identity); we never drop a lead that still has an email. Mutates the
// parsed object in place and returns it.
function sanitizeLeadName<T extends { lead_name?: string | null; lead_first_name?: string | null; lead_last_name?: string | null; lead_email?: string | null }>(parsed: T): T {
  const { errors } = validateContactIngest({
    domain: "dialysis",  // marketing_leads lives on dia
    name: parsed.lead_name || null,
    email: parsed.lead_email || null,
    role: "lead",
  });
  const nameRejected = errors.some((e) => e.startsWith("name "));
  if (nameRejected) {
    console.warn(`[lead-ingest] lead name rejected by ingest contract, nulling: ${errors.filter((e) => e.startsWith("name ")).join("; ")}`);
    parsed.lead_name = null;
    parsed.lead_first_name = null;
    parsed.lead_last_name = null;
  }
  return parsed;
}

// ── DIA Database Config ────────────────────────────────────────────────────

function diaConfig() {
  const url = Deno.env.get("DIA_SUPABASE_URL");
  const key = Deno.env.get("DIA_SUPABASE_KEY");
  return { url, key, configured: !!(url && key) };
}

function diaFetch(path: string, method: string, body?: unknown, prefer?: string) {
  const { url, key } = diaConfig();
  if (!url || !key) throw new Error("DIA Supabase not configured");
  const headers: Record<string, string> = {
    "apikey": key, "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers["Prefer"] = prefer;
  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${url}/rest/v1/${path}`, opts);
}

// ── Activity-type taxonomy (single source of truth) ────────────────────────
// The full vocabulary written to marketing_leads.activity_type and the
// Salesforce Listing_Activity__c.Action → activity_type map. See
// docs/marketing_leads_activity_taxonomy.md for the reference.

// SF Listing_Activity__c.Action → marketing_leads.activity_type
const ENGAGEMENT_ACTION_MAP: Record<string, string> = {
  "Viewed Agreement":          "om_download",
  "Viewed Summary":            "html_view",
  "Viewed Executive Summary":  "exec_summary_view",
  "Viewed Email":              "email_view",
  "Executed Agreement":        "agreement_executed",
  "Entered VDR":               "vdr_entry",
  "Downloaded Docs":           "doc_download",
  "Approved User":             "vdr_approved",
  "Sent Email":                "email_sent",
};

// Case-insensitive lookup so "viewed agreement" and "Viewed Agreement" both map.
const ENGAGEMENT_ACTION_LOOKUP: Record<string, string> = Object.fromEntries(
  Object.entries(ENGAGEMENT_ACTION_MAP).map(([k, v]) => [k.toLowerCase(), v]),
);

// The known activity_type vocabulary = engagement enum + inquiry/website types.
// Note: an unmapped Action falls back to a slug of the raw Action, so this set
// is the KNOWN taxonomy, not a hard allow-list (the slug is the escape hatch).
const ALLOWED_ACTIVITY_TYPES: ReadonlySet<string> = new Set<string>([
  ...Object.values(ENGAGEMENT_ACTION_MAP),
  "rcm_inquiry",
  "loopnet_inquiry",
  "website_hit",
]);

function slugifyAction(action: string): string {
  return action
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "engagement";
}

// Map an SF Listing_Activity Action to an activity_type. Unknown/absent Action
// falls back to a slug of the raw string (never throws, never null).
function mapEngagementAction(action: string | null | undefined): string {
  const a = (action || "").trim();
  if (!a) return "engagement";
  return ENGAGEMENT_ACTION_LOOKUP[a.toLowerCase()] || slugifyAction(a);
}

// Resolve a lead_date: prefer an explicit ISO date (validated), else now().
// Used by all three ingest paths so lead_date is always stamped.
function resolveLeadDate(explicit: unknown): string {
  if (typeof explicit === "string" && explicit.trim()) {
    const t = Date.parse(explicit.trim());
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return isoNow();
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
      service: "lead-ingest",
      version: "1.2.0",
      valid_actions: ["rcm", "loopnet", "engagement", "news_alert", "health"],
    });
  }

  if (req.method !== "POST") {
    return errorResponse(req, `Method ${req.method} not allowed`, 405);
  }

  // Authenticate via webhook secret; fall back to user auth
  if (!authenticateWebhook(req)) {
    const user = await authenticateUser(req);
    if (!user) return errorResponse(req, "Authentication failed", 401);
  }

  const body = await parseBody(req);

  // news_alert lands in LCC Opps (OPS), not DIA — gate DIA only for the
  // RCM/LoopNet marketing-lead handlers.
  if (action === "news_alert") return handleNewsAlertIngest(req, body);

  if (!diaConfig().configured) {
    return errorResponse(req, "DIA Supabase not configured", 500);
  }

  switch (action) {
    case "rcm":         return handleRcmIngest(req, body);
    case "loopnet":     return handleLoopNetIngest(req, body);
    case "engagement":  return handleEngagementIngest(req, body);
    default:
      return errorResponse(req, "Invalid action. Use: rcm, loopnet, engagement, news_alert, health", 400);
  }
});

// ── News Alert Ingest Handler ───────────────────────────────────────────────
// Cross-vertical (dialysis / government / netlease) Google Alert lead intake.
// Classifies the tenant/domain, runs the confidence gate, dedups 90-day
// reposts, and writes to the canonical LCC-Opps `news_alert_leads` table. The
// response tells Power Automate whether to auto-archive the source email.

function loadTrackedTenants(): Record<string, unknown> {
  const raw = Deno.env.get("TRACKED_TENANTS_JSON");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      console.warn("[lead-ingest] TRACKED_TENANTS_JSON invalid — using seed watchlist");
    }
  }
  return DEFAULT_TRACKED_TENANTS as Record<string, unknown>;
}

async function handleNewsAlertIngest(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  const { source_ref, subject, raw_body, internet_message_id } =
    (body || {}) as Record<string, unknown>;
  if (!raw_body) return errorResponse(req, "raw_body is required", 400);

  let ops;
  try {
    ops = opsClient();
  } catch {
    return errorResponse(req, "OPS Supabase not configured", 500);
  }

  // Auto-archive/cleanup emitter, bound to this message's ids. news_alert leads
  // and their processing_log rows both live in LCC Opps, so reuse the `ops`
  // client. channel='news_alert' files a filed lead to Processed/Leads (the news
  // vertical rides `domain` as metadata, never the folder).
  const emitPC = (outcome: string, dom: string | null) =>
    emitLeadProcessingComplete(ops, {
      internetMessageId: (internet_message_id as string) || (source_ref as string) || null,
      graphRestId: (source_ref as string) || null,
      outcome,
      channel: "news_alert",
      domain: dom,
      sourceRef: (source_ref as string) || null,
      subject: (subject as string) || null,
    });

  const watchlist = loadTrackedTenants();
  const extracted = parseGoogleAlert(raw_body as string, (subject || null) as string | null, watchlist);
  const tenantMatch = extracted.match;
  const tenant = (tenantMatch && tenantMatch.tenant) || extracted.tenant_name || null;
  const domain = (tenantMatch && tenantMatch.domain) || null;
  const confidence = scoreNewsAlert(tenantMatch, extracted);
  const route = routeNewsAlert(confidence);
  const dedupKey = tenantDedupKey(tenant);

  // Dedup: suppress a duplicate lead for the same tenant + city/state within the
  // window (syndicated re-posts of one story). A high-confidence duplicate is
  // still auto-archived (no new row); a low-confidence one is left for review.
  if (dedupKey) {
    const sinceIso = new Date(Date.now() - NEWS_ALERT_DEDUP_DAYS * 86400000).toISOString();
    let dq = ops.from("news_alert_leads")
      .select("news_lead_id")
      .eq("dedup_key", dedupKey)
      .gte("created_at", sinceIso)
      .limit(1);
    if (extracted.city) dq = dq.ilike("city", extracted.city as string);
    if (extracted.state) dq = dq.ilike("state", extracted.state as string);
    const { data: dup } = await dq;
    if (Array.isArray(dup) && dup.length > 0) {
      const pc = await emitPC("duplicate", domain);
      return jsonResponse(req, {
        ok: true, duplicate: true, news_lead_id: dup[0].news_lead_id,
        domain, tenant, confidence, route: route.route, archive: route.archive,
        target_folder: pc?.target_folder ?? null, processing_complete: pc,
        message: `Duplicate of ${dup[0].news_lead_id} (same tenant + city/state within ${NEWS_ALERT_DEDUP_DAYS}d)`,
      });
    }
  }

  const insertPayload = {
    source: "google_alert",
    domain,
    tenant,
    match_kind: (tenantMatch && tenantMatch.match_kind) || "none",
    confidence,
    city: extracted.city,
    state: extracted.state,
    article_url: extracted.article_url,
    article_title: extracted.article_title,
    summary: extracted.summary,
    status: route.status,
    dedup_key: dedupKey || null,
    source_ref: (source_ref as string) || null,
    raw_subject: (subject as string) || null,
    metadata: { matched: tenantMatch?.matched || null },
  } as Record<string, unknown>;

  try {
    const { data, error } = await ops.from("news_alert_leads")
      .insert(insertPayload)
      .select("news_lead_id")
      .maybeSingle();

    // A unique (source, source_ref) collision means Power Automate re-POSTed the
    // same alert — treat as an idempotent duplicate, not an error.
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        const pc = await emitPC("duplicate", domain);
        return jsonResponse(req, {
          ok: true, duplicate: true, domain, tenant, confidence,
          route: route.route, archive: route.archive,
          target_folder: pc?.target_folder ?? null, processing_complete: pc,
          message: "Lead already exists (duplicate source_ref)",
        });
      }
      return jsonResponse(req, { error: "Failed to insert news-alert lead", detail: error.message }, 500);
    }

    // A high-confidence (route=auto) hit filed a lead → Processed/Leads. A
    // low-confidence (route=review) hit is left in the inbox for the review
    // queue (needs_review → no move).
    const pc = await emitPC(route.route === "auto" ? "filed" : "needs_review", domain);
    return jsonResponse(req, {
      ok: true,
      news_lead_id: data?.news_lead_id || null,
      domain,
      tenant,
      match_kind: (tenantMatch && tenantMatch.match_kind) || "none",
      confidence,
      route: route.route,            // "auto" | "review"
      status: route.status,          // "developer_unknown" | "needs_review"
      archive: route.archive,        // Power Automate archives the source email iff true
      target_folder: pc?.target_folder ?? null,  // Processed/Leads (filed) | null (review)
      processing_complete: pc,
      article_url: extracted.article_url,
    }, 201);
  } catch (err) {
    console.error("[lead-ingest] news_alert error:", (err as Error).message);
    return errorResponse(req, "News-alert ingestion failed", 500);
  }
}

// ── RCM Email Parser ───────────────────────────────────────────────────────

function parseRcmEmail(rawBody: string, subject: string | null) {
  const lines = rawBody.split("\n").map(l => l.trim()).filter(Boolean);

  function extractAfterLabel(labels: string[]): string | null {
    for (const label of labels) {
      for (const line of lines) {
        if (line.toLowerCase().startsWith(label.toLowerCase())) {
          return line.substring(label.length).trim().replace(/^[:\s]+/, "");
        }
      }
    }
    return null;
  }

  // Inline format: "Name:James DurandCompany:Mapleton InvestmentsFrom Phone:(310) 209-7243"
  let inlineName: string | null = null, inlineCompany: string | null = null, inlinePhone: string | null = null;
  const inlinePattern = /Name:\s*(.+?)(?:Company:|Firm:|Organization:)\s*(.+?)(?:From Phone:|Phone:|Tel:)\s*(\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4})/i;
  for (const line of lines) {
    const m = line.match(inlinePattern);
    if (m) { inlineName = m[1].trim(); inlineCompany = m[2].trim(); inlinePhone = m[3].trim(); break; }
  }
  if (!inlineName) {
    const twoField = /Name:\s*(.+?)(?:Company:|Firm:|Organization:)\s*(.+?)$/i;
    for (const line of lines) {
      const m = line.match(twoField);
      if (m) { inlineName = m[1].trim(); inlineCompany = m[2].trim(); break; }
    }
  }

  const name = inlineName || extractAfterLabel(["Full Name:", "Name:", "Contact:", "Requestor:"]);
  const company = inlineCompany || extractAfterLabel(["Company:", "Firm:", "Organization:", "Affiliation:"]);
  const inquiryType = extractAfterLabel(["Request Type:", "Inquiry:", "Action:", "Type:"]);
  const propertyRef = extractAfterLabel(["Property:", "Listing:", "Asset:"]);

  const emailMatch = rawBody.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const email = emailMatch ? emailMatch[0] : null;

  let phone = inlinePhone || null;
  if (!phone) {
    const cleaned = rawBody
      .replace(/[-]{10,}[\s\S]*?[-]{10,}/g, "")
      .replace(/call\s+\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}/gi, "");
    const phoneMatch = cleaned.match(/\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}/);
    phone = phoneMatch ? phoneMatch[0] : null;
  }

  let bodyDeal: string | null = null;
  const dealMatch = rawBody.match(/(?:viewed|downloaded|requested|opened)\s+(?:the\s+)?(?:Agreement|Offering Memorandum|OM|Flyer|Brochure|Package)\s+for\s+(.+?)(?:\.|$)/im);
  if (dealMatch) bodyDeal = dealMatch[1].trim();

  let firstName: string | null = null, lastName: string | null = null;
  if (name) {
    const parts = name.split(/\s+/);
    firstName = parts[0] || null;
    lastName = parts.slice(1).join(" ") || null;
  }

  return {
    lead_name: name, lead_first_name: firstName, lead_last_name: lastName,
    lead_email: email, lead_phone: phone, lead_company: company,
    deal_name: subject || bodyDeal || propertyRef || null,
    activity_type: inquiryType || "rcm_inquiry",
    activity_detail: inquiryType
  };
}

// ── LoopNet Email Parser ───────────────────────────────────────────────────

function parseLoopNetEmail(rawBody: string, subject: string | null) {
  const lines = rawBody.split("\n").map(l => l.trim()).filter(Boolean);

  function extractAfterLabel(labels: string[]): string | null {
    for (const label of labels) {
      for (const line of lines) {
        if (line.toLowerCase().startsWith(label.toLowerCase())) {
          return line.substring(label.length).trim().replace(/^[:\s]+/, "");
        }
      }
    }
    return null;
  }

  const name = extractAfterLabel(["Name:", "Full Name:", "Contact Name:", "From:", "Sender:", "Inquirer:", "Prospect Name:", "Buyer Name:"]);
  const company = extractAfterLabel(["Company:", "Firm:", "Organization:", "Brokerage:", "Company Name:", "Buyer Company:", "Investor Group:"]);
  const inquiryType = extractAfterLabel(["Inquiry Type:", "Request Type:", "Type:", "Action:", "Interest:", "Lead Type:", "Inquiry About:"]);
  const propertyRef = extractAfterLabel(["Property:", "Listing:", "Property Name:", "Property Address:", "Listing Name:", "Asset:", "Subject Property:"]);
  const message = extractAfterLabel(["Message:", "Comments:", "Notes:", "Additional Info:", "Inquiry Message:"]);

  const emailMatch = rawBody.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const email = emailMatch ? emailMatch[0] : null;

  const phoneMatch = rawBody.match(/\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}(\s*(x|ext\.?|extension)\s*\d+)?/i);
  const phone = phoneMatch ? phoneMatch[0] : null;

  const listingIdMatch = rawBody.match(/(?:Listing\s*(?:ID|#|Number)[:\s]*)([\d]+)/i);
  const listingId = listingIdMatch ? listingIdMatch[1] : null;

  let firstName: string | null = null, lastName: string | null = null;
  if (name) {
    const parts = name.split(/\s+/);
    firstName = parts[0] || null;
    lastName = parts.slice(1).join(" ") || null;
  }

  let dealName = subject || propertyRef || null;
  if (dealName) {
    dealName = dealName
      .replace(/^(New\s+)?LoopNet\s+(Inquiry|Lead|Request)\s*[-:–]\s*/i, "")
      .replace(/^(RE|FW|Fwd):\s*/i, "")
      .trim();
  }

  return {
    lead_name: name, lead_first_name: firstName, lead_last_name: lastName,
    lead_email: email, lead_phone: phone, lead_company: company,
    deal_name: dealName, listing_id: listingId,
    activity_type: inquiryType || "loopnet_inquiry",
    activity_detail: message || inquiryType || null
  };
}

// ── Shared SF Match + Activity Logic ───────────────────────────────────────

async function matchAndCreateActivity(
  lead: Record<string, unknown>,
  parsed: Record<string, unknown>,
  source: string,
  sourceRef: string | null,
  rawBody: string
) {
  const { url, key } = diaConfig();
  if (!url || !key) return { sfMatch: null, sfActivityId: null };

  // Auto-match to Salesforce by email
  let sfMatch: Record<string, unknown> | null = null;
  if (parsed.lead_email) {
    try {
      const sfUrl = new URL(`${url}/rest/v1/salesforce_activities`);
      sfUrl.searchParams.set("select", "sf_contact_id,sf_company_id,first_name,last_name,company_name,assigned_to");
      sfUrl.searchParams.set("email", `eq.${parsed.lead_email}`);
      sfUrl.searchParams.set("limit", "1");
      const sfRes = await fetch(sfUrl.toString(), {
        headers: { "apikey": key, "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }
      });
      if (sfRes.ok) {
        const sfData = await sfRes.json();
        if (Array.isArray(sfData) && sfData.length > 0 && sfData[0].sf_contact_id) {
          sfMatch = sfData[0];
          await diaFetch(`marketing_leads?lead_id=eq.${lead.lead_id}`, "PATCH",
            { sf_contact_id: sfMatch.sf_contact_id, sf_match_status: "matched" },
            "return=minimal"
          );
        }
      }
    } catch (err) { console.error("SF match failed:", (err as Error).message); }
  }

  // Extended matching (best-effort): when NO Contact matched, still try to
  // resolve the Account/Company and Opportunity from the lead's company name /
  // email domain, and stamp sf_company_id / sf_opportunity_id when found. A
  // company/opp hit is weaker than a contact hit, so it does NOT flip
  // sf_match_status to matched. Never fails the ingest.
  if (!sfMatch) {
    try {
      const supp = await matchCompanyAndOpportunity(parsed, url, key);
      const patch: Record<string, unknown> = {};
      if (supp.sf_company_id) patch.sf_company_id = supp.sf_company_id;
      if (supp.sf_opportunity_id) patch.sf_opportunity_id = supp.sf_opportunity_id;
      if (supp.sf_match_method) patch.sf_match_method = supp.sf_match_method;
      if (Object.keys(patch).length > 0) {
        await diaFetch(`marketing_leads?lead_id=eq.${lead.lead_id}`, "PATCH", patch, "return=minimal");
      }
    } catch (err) { console.warn("company/opportunity match skipped:", (err as Error).message); }
  }

  // Create salesforce_activities task
  let sfActivityId: string | null = null;
  try {
    const contactId = sfMatch ? sfMatch.sf_contact_id : `${source}-lead-${lead.lead_id}`;
    const label = source === "rcm" ? "RCM" : "LoopNet";
    const taskSubject = parsed.deal_name
      ? `${label}: ${parsed.deal_name}`
      : `${label} Inquiry – ${parsed.lead_name || parsed.lead_email || "New Lead"}`;
    const noteSnippet = (parsed.activity_detail as string)
      || rawBody.substring(0, 300) + (rawBody.length > 300 ? "…" : "");

    const sfActRes = await diaFetch("salesforce_activities", "POST", {
      subject: taskSubject,
      first_name: sfMatch?.first_name || parsed.lead_first_name || null,
      last_name: sfMatch?.last_name || parsed.lead_last_name || null,
      company_name: sfMatch?.company_name || parsed.lead_company || null,
      email: parsed.lead_email, phone: parsed.lead_phone,
      sf_contact_id: contactId,
      sf_company_id: sfMatch?.sf_company_id || null,
      nm_type: "Task", task_subtype: "Task", status: "Open",
      activity_date: new Date().toISOString().split("T")[0],
      nm_notes: noteSnippet,
      assigned_to: (sfMatch?.assigned_to as string) || "Unassigned",
      source_ref: `${source}:${sourceRef || lead.lead_id}`
    }, "return=representation,resolution=ignore-duplicates");

    if (sfActRes.ok) {
      const sfActData = await sfActRes.json();
      const sfAct = Array.isArray(sfActData) ? sfActData[0] : sfActData;
      sfActivityId = sfAct?.activity_id || null;
      if (sfActivityId) {
        await diaFetch(`marketing_leads?lead_id=eq.${lead.lead_id}`, "PATCH",
          { sf_activity_id: sfActivityId }, "return=minimal"
        );
      }
    }
  } catch (err) { console.error("SF activity creation error:", (err as Error).message); }

  // Refresh CRM rollup
  try {
    await diaFetch("rpc/refresh_crm_rollup", "POST", {});
  } catch (err) { console.warn("CRM rollup refresh skipped:", (err as Error).message); }

  return { sfMatch, sfActivityId };
}

// ── Company/Account + Opportunity fallback matcher (rcm/loopnet) ────────────
// Best-effort: resolve an Account/Company and Opportunity from the lead's
// company name (fuzzy) or email domain, for inquiry leads with no Contact
// match. Returns ids to stamp; the caller PATCHes them. Never throws to the
// caller — the top-level call site wraps it, and every branch swallows fetch
// errors so a match miss can never fail the ingest.

const GENERIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "me.com", "live.com", "msn.com", "comcast.net", "ymail.com",
]);

async function matchCompanyAndOpportunity(
  parsed: Record<string, unknown>,
  url: string,
  key: string,
): Promise<{ sf_company_id: string | null; sf_opportunity_id: string | null; sf_match_method: string | null }> {
  const out: { sf_company_id: string | null; sf_opportunity_id: string | null; sf_match_method: string | null } =
    { sf_company_id: null, sf_opportunity_id: null, sf_match_method: null };
  const headers = { "apikey": key, "Authorization": `Bearer ${key}`, "Content-Type": "application/json" };

  const company = typeof parsed.lead_company === "string" ? parsed.lead_company.trim() : "";
  const email = typeof parsed.lead_email === "string" ? parsed.lead_email.trim() : "";
  const domain = email.includes("@") ? (email.split("@").pop() || "").toLowerCase().trim() : "";
  const hasCompany = company.length >= 3;

  const firstRow = async (u: URL): Promise<Record<string, unknown> | null> => {
    try {
      const r = await fetch(u.toString(), { headers });
      if (!r.ok) return null;
      const d = await r.json();
      return Array.isArray(d) && d.length > 0 ? d[0] : null;
    } catch { return null; }
  };

  // 1) Account/Company by fuzzy name (salesforce_accounts).
  if (hasCompany) {
    const u = new URL(`${url}/rest/v1/salesforce_accounts`);
    u.searchParams.set("select", "sf_account_id,name");
    u.searchParams.set("name", `ilike.*${company}*`);
    u.searchParams.set("sf_account_id", "not.is.null");
    u.searchParams.set("limit", "1");
    const row = await firstRow(u);
    if (row?.sf_account_id) { out.sf_company_id = row.sf_account_id as string; out.sf_match_method = "company_name"; }
  }

  // 1b) Fallback: an existing SF contact sharing the lead's (non-generic) email
  //     domain resolves the Account.
  if (!out.sf_company_id && domain && !GENERIC_EMAIL_DOMAINS.has(domain)) {
    const u = new URL(`${url}/rest/v1/salesforce_contacts`);
    u.searchParams.set("select", "sf_account_id");
    u.searchParams.set("email", `ilike.*@${domain}`);
    u.searchParams.set("sf_account_id", "not.is.null");
    u.searchParams.set("limit", "1");
    const row = await firstRow(u);
    if (row?.sf_account_id) { out.sf_company_id = row.sf_account_id as string; out.sf_match_method = out.sf_match_method || "email_domain"; }
  }

  // 2) Opportunity (SF Deal) by fuzzy company name on either side of the deal.
  if (hasCompany) {
    for (const col of ["seller_company_name", "buyer_company_name"]) {
      const u = new URL(`${url}/rest/v1/sf_deal_staging`);
      u.searchParams.set("select", "sf_deal_id");
      u.searchParams.set(col, `ilike.*${company}*`);
      u.searchParams.set("sf_deal_id", "not.is.null");
      u.searchParams.set("limit", "1");
      const row = await firstRow(u);
      if (row?.sf_deal_id) { out.sf_opportunity_id = row.sf_deal_id as string; break; }
    }
  }

  return out;
}

// ── RCM Ingest Handler ─────────────────────────────────────────────────────

async function handleRcmIngest(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  const { source, source_ref, deal_name, subject, raw_body, status, internet_message_id } =
    (body || {}) as Record<string, unknown>;

  if (!raw_body) return errorResponse(req, "raw_body is required", 400);
  if (source !== "rcm") return errorResponse(req, 'source must be "rcm"', 400);

  // Auto-archive/cleanup emitter (RCM/CREXi is the marketplace-inquiry channel).
  // marketing_leads lives on DIA, but processing_log lives on LCC Opps, so pass
  // ops=null and let the emitter lazily create the OPS client.
  const emitPC = (outcome: string) =>
    emitLeadProcessingComplete(null, {
      internetMessageId: (internet_message_id as string) || (source_ref as string) || null,
      graphRestId: (source_ref as string) || null,
      outcome,
      channel: "crexi",
      sourceRef: (source_ref as string) || null,
      subject: (deal_name || subject) as string || null,
    });

  const parsed = sanitizeLeadName(parseRcmEmail(raw_body as string, (deal_name || subject || null) as string | null));

  const insertPayload = {
    source: "rcm", source_ref: source_ref || null,
    lead_name: parsed.lead_name, lead_first_name: parsed.lead_first_name,
    lead_last_name: parsed.lead_last_name, lead_email: parsed.lead_email,
    lead_phone: parsed.lead_phone, lead_company: parsed.lead_company,
    deal_name: parsed.deal_name, activity_type: parsed.activity_type,
    activity_detail: parsed.activity_detail,
    lead_date: resolveLeadDate(body?.lead_date),
    notes: raw_body, status: status || "new",
    ingested_at: isoNow()
  };

  try {
    const insertRes = await diaFetch("marketing_leads", "POST", insertPayload,
      "return=representation,resolution=ignore-duplicates");

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      return jsonResponse(req, { error: "Failed to insert marketing lead", detail: errText }, insertRes.status);
    }

    const inserted = await insertRes.json();
    const lead = Array.isArray(inserted) ? inserted[0] : inserted;

    if (!lead || !lead.lead_id) {
      const pc = await emitPC("duplicate");
      return jsonResponse(req, { ok: true, duplicate: true, message: "Lead already exists (duplicate source_ref)", source_ref, target_folder: pc?.target_folder ?? null, processing_complete: pc });
    }

    const { sfMatch, sfActivityId } = await matchAndCreateActivity(lead, parsed, "rcm", source_ref as string, raw_body as string);

    const pc = await emitPC("filed");
    return jsonResponse(req, {
      ok: true, lead_id: lead.lead_id, sf_activity_id: sfActivityId,
      parsed: { lead_name: parsed.lead_name, lead_email: parsed.lead_email, lead_phone: parsed.lead_phone, lead_company: parsed.lead_company, deal_name: parsed.deal_name, activity_type: parsed.activity_type },
      sf_match: sfMatch ? { sf_contact_id: sfMatch.sf_contact_id, name: `${sfMatch.first_name || ""} ${sfMatch.last_name || ""}`.trim() } : null,
      target_folder: pc?.target_folder ?? null, processing_complete: pc
    }, 201);
  } catch (err) {
    console.error("[lead-ingest] RCM error:", (err as Error).message);
    return errorResponse(req, "Lead ingestion failed", 500);
  }
}

// ── LoopNet Ingest Handler ─────────────────────────────────────────────────

async function handleLoopNetIngest(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  const { source_ref, deal_name, raw_body, status, internet_message_id } =
    (body || {}) as Record<string, unknown>;

  if (!raw_body) return errorResponse(req, "raw_body is required", 400);

  // Auto-archive/cleanup emitter (marketing_leads on DIA; processing_log on OPS).
  const emitPC = (outcome: string) =>
    emitLeadProcessingComplete(null, {
      internetMessageId: (internet_message_id as string) || (source_ref as string) || null,
      graphRestId: (source_ref as string) || null,
      outcome,
      channel: "loopnet",
      sourceRef: (source_ref as string) || null,
      subject: (deal_name as string) || null,
    });

  const parsed = sanitizeLeadName(parseLoopNetEmail(raw_body as string, (deal_name || null) as string | null));

  const insertPayload = {
    source: "loopnet", source_ref: source_ref || null,
    lead_name: parsed.lead_name, lead_first_name: parsed.lead_first_name,
    lead_last_name: parsed.lead_last_name, lead_email: parsed.lead_email,
    lead_phone: parsed.lead_phone, lead_company: parsed.lead_company,
    deal_name: parsed.deal_name, listing_id: parsed.listing_id,
    activity_type: parsed.activity_type, activity_detail: parsed.activity_detail,
    lead_date: resolveLeadDate(body?.lead_date),
    notes: raw_body, status: status || "new",
    ingested_at: isoNow()
  };

  try {
    const insertRes = await diaFetch("marketing_leads", "POST", insertPayload,
      "return=representation,resolution=ignore-duplicates");

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      return jsonResponse(req, { error: "Failed to insert marketing lead", detail: errText }, insertRes.status);
    }

    const inserted = await insertRes.json();
    const lead = Array.isArray(inserted) ? inserted[0] : inserted;

    if (!lead || !lead.lead_id) {
      const pc = await emitPC("duplicate");
      return jsonResponse(req, { ok: true, duplicate: true, message: "Lead already exists (duplicate source_ref)", source_ref, target_folder: pc?.target_folder ?? null, processing_complete: pc });
    }

    const { sfMatch, sfActivityId } = await matchAndCreateActivity(lead, parsed, "loopnet", source_ref as string, raw_body as string);

    const pc = await emitPC("filed");
    return jsonResponse(req, {
      ok: true, lead_id: lead.lead_id, sf_activity_id: sfActivityId,
      parsed: { lead_name: parsed.lead_name, lead_email: parsed.lead_email, lead_phone: parsed.lead_phone, lead_company: parsed.lead_company, deal_name: parsed.deal_name, listing_id: parsed.listing_id, activity_type: parsed.activity_type },
      sf_match: sfMatch ? { sf_contact_id: sfMatch.sf_contact_id, name: `${sfMatch.first_name || ""} ${sfMatch.last_name || ""}`.trim() } : null,
      target_folder: pc?.target_folder ?? null, processing_complete: pc
    }, 201);
  } catch (err) {
    console.error("[lead-ingest] LoopNet error:", (err as Error).message);
    return errorResponse(req, "Lead ingestion failed", 500);
  }
}

// ── Engagement Ingest Handler ──────────────────────────────────────────────
// Salesforce Listing_Activity__c engagement signals (OM downloads, VDR entries,
// executed agreements, …). A PA flow maps SF fields into the JSON contract and
// POSTs here. Idempotent on sf_activity_id (stored in source_ref): re-POSTing
// the same activity UPDATES the row, never duplicates.

async function handleEngagementIngest(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  const b = (body || {}) as Record<string, unknown>;

  const sfActivityId = ((b.sf_activity_id as string) || "").trim();
  if (!sfActivityId) return errorResponse(req, "sf_activity_id is required", 400);

  const action = (b.action as string) || null;
  const activityType = mapEngagementAction(action);
  const sfContactId = ((b.sf_contact_id as string) || "").trim() || null;

  // Person name comes only from the contact fields; fall back to a composed
  // first+last. Route the name through the ingest contract (junk/federal guard).
  const first = ((b.lead_first_name as string) || "").trim() || null;
  const last = ((b.lead_last_name as string) || "").trim() || null;
  const composedName = [first, last].filter(Boolean).join(" ").trim() || null;
  const parsed = sanitizeLeadName({
    lead_name: composedName,
    lead_first_name: first,
    lead_last_name: last,
    lead_email: ((b.lead_email as string) || "").trim() || null,
  });

  const row: Record<string, unknown> = {
    source: "rcm_engagement",
    source_ref: sfActivityId,
    listing_id: ((b.sf_listing_id as string) || "").trim() || null,
    sf_opportunity_id: ((b.sf_opportunity_id as string) || "").trim() || null,
    sf_contact_id: sfContactId,
    sf_company_id: ((b.sf_company_id as string) || "").trim() || null,
    sf_match_status: sfContactId ? "matched" : "unmatched",
    sf_match_method: sfContactId ? "engagement_contact_id" : null,
    lead_date: resolveLeadDate(b.activity_date),
    activity_type: activityType,
    activity_detail: action,
    lead_name: parsed.lead_name,
    lead_first_name: parsed.lead_first_name,
    lead_last_name: parsed.lead_last_name,
    lead_email: parsed.lead_email,
    lead_phone: ((b.lead_phone as string) || "").trim() || null,
    lead_company: ((b.lead_company as string) || "").trim() || null,
    lead_title: ((b.lead_title as string) || "").trim() || null,
    deal_name: ((b.listing_name as string) || "").trim() || null,
    property_address: ((b.property_address as string) || "").trim() || null,
    property_city: ((b.property_city as string) || "").trim() || null,
    property_state: ((b.property_state as string) || "").trim() || null,
    status: "new",
    ingested_at: isoNow(),
  };

  try {
    const result = await upsertEngagementLead(row);
    if ("error" in result) {
      return jsonResponse(req, { error: "Failed to upsert engagement lead", detail: result.detail }, result.status);
    }
    const { lead, created } = result;
    return jsonResponse(req, {
      ok: true,
      lead_id: lead?.lead_id ?? null,
      created,
      updated: !created,
      action,
      activity_type: activityType,
      listing_id: row.listing_id,
      sf_opportunity_id: row.sf_opportunity_id,
      sf_contact_id: sfContactId,
      sf_company_id: row.sf_company_id,
      sf_match_status: row.sf_match_status,
      lead_date: row.lead_date,
    }, created ? 201 : 200);
  } catch (err) {
    console.error("[lead-ingest] engagement error:", (err as Error).message);
    return errorResponse(req, "Engagement ingestion failed", 500);
  }
}

// Idempotent write for an engagement row. POST first (a duplicate
// (source, source_ref) → 23505 via marketing_leads_engagement_uidx / the
// composite index); on conflict, PATCH the existing row by (source, source_ref)
// so a re-POST updates action/date/match fields instead of duplicating. The DB
// unique index is the race backstop (mirrors salesforce_activities sf_task_id).
async function upsertEngagementLead(
  row: Record<string, unknown>,
): Promise<{ lead: Record<string, unknown> | null; created: boolean } | { error: string; status: number; detail?: string }> {
  const insertRes = await diaFetch("marketing_leads", "POST", row, "return=representation");

  if (insertRes.ok) {
    const data = await insertRes.json();
    const lead = Array.isArray(data) ? data[0] : data;
    if (lead && lead.lead_id) return { lead, created: true };
    // No row returned (return=minimal semantics) — fall through to update by key.
  } else {
    const detail = await insertRes.text();
    const isDup = insertRes.status === 409 || detail.includes("23505");
    if (!isDup) return { error: "insert_failed", status: insertRes.status, detail };
  }

  // Update the existing row (idempotent re-POST path). Keep the immutable
  // identity/audit columns; refresh everything else + updated_at.
  const patchFields: Record<string, unknown> = { ...row };
  delete patchFields.source;
  delete patchFields.source_ref;
  delete patchFields.ingested_at;
  patchFields.updated_at = isoNow();

  const q = `marketing_leads?source=eq.rcm_engagement&source_ref=eq.${encodeURIComponent(String(row.source_ref))}`;
  const patchRes = await diaFetch(q, "PATCH", patchFields, "return=representation");
  if (!patchRes.ok) {
    const detail = await patchRes.text();
    return { error: "update_failed", status: patchRes.status, detail };
  }
  const data = await patchRes.json();
  const lead = Array.isArray(data) ? data[0] : data;
  return { lead: lead ?? null, created: false };
}

// ── Health Check ───────────────────────────────────────────────────────────

async function handleHealth(req: Request): Promise<Response> {
  const dia = diaConfig();
  const checks: Record<string, unknown> = {
    dia_configured: dia.configured,
    ops_configured: !!(Deno.env.get("OPS_SUPABASE_URL") && Deno.env.get("OPS_SUPABASE_SERVICE_KEY")),
    webhook_secret_configured: !!Deno.env.get("PA_WEBHOOK_SECRET"),
    activity_types_known: [...ALLOWED_ACTIVITY_TYPES],
    engagement_action_map: ENGAGEMENT_ACTION_MAP,
    timestamp: isoNow()
  };

  if (dia.configured) {
    try {
      const res = await diaFetch("marketing_leads?select=lead_id&limit=1", "GET");
      checks.marketing_leads_accessible = res.ok;
      if (!res.ok) checks.marketing_leads_error = await res.text();
    } catch (e) {
      checks.marketing_leads_accessible = false;
      checks.marketing_leads_error = (e as Error).message;
    }
  }

  return jsonResponse(req, checks);
}
