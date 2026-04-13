// ============================================================================
// Intake Receiver — Outlook email intake from Power Automate
// Life Command Center — Infrastructure Migration Phase 2
//
// Ported from api/intake.js (handleOutlookMessage, lines 82-169).
// Receives flagged emails from Power Automate and creates inbox_items in OPS.
//
// Routes:
//   POST ?action=outlook-message   — ingest a flagged email
//   GET  ?action=summary           — recent intake summary
//   GET  (no action)               — info endpoint
// ============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { opsQuery, pgFilterVal } from "../_shared/supabase-client.ts";
import { authenticateUser, primaryWorkspaceId } from "../_shared/auth.ts";
import { queryParams, parseBody, isoNow, toArray } from "../_shared/utils.ts";

// ── Helpers ──────────────────────────────────────────────────────────────

function isoOrNow(value: unknown): string {
  const d = value ? new Date(value as string) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function normalizeSender(sender: unknown): { name: string | null; email: string | null } {
  if (!sender) return { name: null, email: null };
  if (typeof sender === "string") return { name: null, email: sender };
  const s = sender as Record<string, unknown>;
  if (s.emailAddress) {
    const ea = s.emailAddress as Record<string, unknown>;
    return { name: (ea.name as string) || null, email: (ea.address as string) || null };
  }
  return { name: (s.name as string) || null, email: (s.email as string) || null };
}

function firstNonEmpty(...values: unknown[]): unknown {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}

async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function deterministicCorrelationId(workspaceId: string, externalId: string, receivedAtIso: string): Promise<string> {
  const base = `${workspaceId}|${externalId}|${receivedAtIso}`;
  const digest = (await sha1Hex(base)).slice(0, 12);
  const ts = new Date(receivedAtIso).getTime();
  return `outlook-msg-${digest}-${ts}`;
}

// ── Custom opsQuery with Prefer header override ───────────────────────────

async function opsInsertMergeDuplicates(path: string, body: Record<string, unknown>) {
  const url = Deno.env.get("OPS_SUPABASE_URL");
  const key = Deno.env.get("OPS_SUPABASE_SERVICE_KEY");
  if (!url || !key) return { ok: false, status: 503, data: { error: "OPS not configured" } };

  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      "apikey": key, "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation,resolution=merge-duplicates"
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// ── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const params = queryParams(req);
  const action = params.get("action");

  if (req.method === "GET") {
    if (action === "summary") return handleSummary(req, params);
    return jsonResponse(req, {
      service: "intake-receiver",
      version: "1.0.1",
      valid_actions: ["outlook-message", "summary"]
    });
  }

  if (req.method !== "POST") {
    return errorResponse(req, `Method ${req.method} not allowed`, 405);
  }

  const user = await authenticateUser(req);
  if (!user) return errorResponse(req, "Authentication failed", 401);

  const workspaceId = req.headers.get("x-lcc-workspace") || primaryWorkspaceId(user);
  if (!workspaceId) return errorResponse(req, "No workspace context", 400);

  const body = await parseBody(req);

  switch (action) {
    case "outlook-message": return handleOutlookMessage(req, body, workspaceId, user.id);
    default:
      return errorResponse(req, "Invalid action. Use: outlook-message, summary", 400);
  }
});

// ── Outlook Message Handler ────────────────────────────────────────────────

async function handleOutlookMessage(
  req: Request, body: Record<string, unknown> | null,
  workspaceId: string, userId: string
): Promise<Response> {
  const payload = body || {};

  const internetMsgId = firstNonEmpty(payload.internet_message_id, payload.internetMessageId, null) as string | null;
  const graphRestId = firstNonEmpty(payload.message_id, payload.id, null) as string | null;
  const messageId = internetMsgId || graphRestId;
  const subject = (firstNonEmpty(payload.subject, "(No subject)") as string);
  const bodyPreview = (firstNonEmpty(payload.body_preview, payload.bodyPreview, payload.body, "") as string);
  const webLink = firstNonEmpty(payload.web_link, payload.webLink, null) as string | null;
  const receivedAtIso = isoOrNow(firstNonEmpty(payload.received_date_time, payload.receivedDateTime, payload.received_at));
  const sender = normalizeSender(firstNonEmpty(payload.from, payload.sender, payload.sender_email));
  const hasAttachments = Boolean(firstNonEmpty(payload.has_attachments, payload.hasAttachments, false));
  const attachmentCount = Array.isArray(payload.attachments) ? payload.attachments.length : null;

  if (!messageId) {
    return errorResponse(req, "message_id (or id/internet_message_id) is required", 400);
  }

  const correlationId = await deterministicCorrelationId(workspaceId, String(messageId), receivedAtIso);

  const deepLink = webLink
    || (graphRestId ? `https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(graphRestId)}` : null);

  // Use merge-duplicates for idempotent upsert (same as Vercel version)
  // Note: internet_message_id stored in metadata, not as a column
  const result = await opsInsertMergeDuplicates("inbox_items", {
    workspace_id: workspaceId,
    source_user_id: userId,
    assigned_to: userId,
    title: String(subject),
    body: bodyPreview ? String(bodyPreview) : null,
    source_type: "flagged_email",
    source_connector_id: null,
    external_id: String(messageId),
    external_url: deepLink,
    status: "new",
    priority: "normal",
    visibility: "private",
    metadata: {
      sender_name: sender.name,
      sender_email: sender.email,
      received_at: receivedAtIso,
      has_attachments: hasAttachments,
      attachment_count: attachmentCount,
      graph_rest_id: graphRestId || null,
      internet_message_id: internetMsgId || null,
      event_source: "outlook_power_automate",
      correlation_id: correlationId
    },
    received_at: receivedAtIso
  });

  if (!result.ok) {
    return jsonResponse(req, { error: "Failed to ingest Outlook message", detail: result.data }, result.status || 500);
  }

  const item = Array.isArray(result.data) ? result.data[0] : result.data;

  return jsonResponse(req, {
    ok: true,
    correlation_id: correlationId,
    inbox_item_id: item?.id || null,
    external_id: String(messageId),
    status: item?.status || "new"
  });
}

// ── Intake Summary ─────────────────────────────────────────────────────────

async function handleSummary(req: Request, params: URLSearchParams): Promise<Response> {
  const user = await authenticateUser(req);
  if (!user) return errorResponse(req, "Authentication failed", 401);

  const workspaceId = req.headers.get("x-lcc-workspace") || primaryWorkspaceId(user);
  if (!workspaceId) return errorResponse(req, "No workspace context", 400);

  const limit = Math.min(parseInt(params.get("limit") || "3", 10), 20);
  const correlationId = params.get("correlation_id");

  let filter = `inbox_items?workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&source_type=eq.flagged_email` +
    `&order=received_at.desc` +
    `&limit=${limit}` +
    `&select=id,title,body,status,priority,metadata,received_at,external_url`;

  if (correlationId) {
    filter += `&metadata->>correlation_id=eq.${pgFilterVal(correlationId)}`;
  }

  const result = await opsQuery("GET", filter);
  const items = toArray(result.data);

  const mapped = items.map((item: Record<string, unknown>) => {
    const meta = (item.metadata || {}) as Record<string, unknown>;
    return {
      id: item.id,
      subject: item.title,
      summary: item.body ? (item.body as string).substring(0, 220) : null,
      sender: meta.sender_name || meta.sender_email || "(unknown)",
      received_at: item.received_at || meta.received_at,
      has_attachments: meta.has_attachments || false,
      status: item.status,
      external_url: item.external_url
    };
  });

  return jsonResponse(req, { items: mapped, count: mapped.length });
}
