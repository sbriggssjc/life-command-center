// ============================================================================
// Template Service — Email draft generation & performance tracking
// Life Command Center — Infrastructure Migration Phase 3
//
// Ported from api/operations.js handleDraftRoute (lines ~1916-2223)
// + api/_shared/templates.js + api/_shared/template-refinement.js
//
// Routes (via ?action= query param):
//   GET  (no action)                — list all active templates
//   GET  ?template_id=T-001        — get a specific template
//   POST ?action=generate           — generate a single draft
//   POST ?action=batch              — generate drafts for multiple contacts
//   POST ?action=record_send        — record that a draft was sent
//   POST ?action=performance        — template performance analytics
//   POST ?action=health             — template voice refinement health check
//   GET  ?action=health             — health check
//
// NOT handled here (stays on Vercel):
//   POST ?action=listing_bd         — depends on listing-bd.js pipeline
// ============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { opsQuery, pgFilterVal } from "../_shared/supabase-client.ts";
import { authenticateUser, primaryWorkspaceId } from "../_shared/auth.ts";
import { writeSignal } from "../_shared/signals.ts";
import { queryParams, parseBody, isoNow } from "../_shared/utils.ts";

// ── Template Engine (ported from _shared/templates.js) ─────────────────────

function resolvePath(path: string, context: Record<string, unknown>): unknown {
  const parts = path.split(".");
  let current: unknown = context;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return true;
}

function renderTemplate(template: string, context: Record<string, unknown>): string {
  if (!template) return "";
  let output = template;

  // Pass 1: {{#if var}}...{{else}}...{{/if}}
  output = output.replace(
    /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, path, ifBlock, elseBlock) => {
      const value = resolvePath(path, context);
      return isPresent(value) ? ifBlock : elseBlock;
    }
  );

  // Pass 2: {{#if var}}...{{/if}}
  output = output.replace(
    /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, path, block) => {
      const value = resolvePath(path, context);
      return isPresent(value) ? block : "";
    }
  );

  // Pass 3: {{variable.path}}
  output = output.replace(
    /\{\{([\w.]+)\}\}/g,
    (_, path) => {
      const value = resolvePath(path, context);
      if (value == null) return "";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }
  );

  output = output.replace(/\n{3,}/g, "\n\n");
  return output.trim();
}

// ── Template DB Functions ──────────────────────────────────────────────────

async function loadTemplate(templateId: string): Promise<Record<string, unknown> | null> {
  const result = await opsQuery("GET",
    `template_definitions?template_id=eq.${pgFilterVal(templateId)}&deprecated=eq.false&order=template_version.desc&limit=1`
  );
  if (!result.ok || !result.data?.length) return null;
  return (result.data as Record<string, unknown>[])[0];
}

async function listActiveTemplates(): Promise<Record<string, unknown>[]> {
  const result = await opsQuery("GET",
    "template_definitions?deprecated=eq.false&order=template_id.asc,template_version.desc"
  );
  return result.ok ? (result.data as Record<string, unknown>[]) || [] : [];
}

function validateVariables(template: Record<string, unknown>, context: Record<string, unknown>): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const varPath of (template.mandatory_variables as string[]) || []) {
    const value = resolvePath(varPath, context);
    if (!isPresent(value)) missing.push(varPath);
  }
  return { valid: missing.length === 0, missing };
}

async function generateDraft(templateId: string, context: Record<string, unknown>, options: { strict?: boolean } = {}) {
  const template = await loadTemplate(templateId);
  if (!template) {
    return { ok: false, error: `Template "${templateId}" not found or deprecated` };
  }

  const validation = validateVariables(template, context);
  if (!validation.valid && options.strict) {
    return {
      ok: false,
      error: `Missing mandatory variables: ${validation.missing.join(", ")}`,
      missing: validation.missing,
      template_id: templateId,
      template_name: template.name
    };
  }

  const subject = renderTemplate(template.subject_template as string, context);
  const body = renderTemplate(template.body_template as string, context);

  const allVars = [...((template.mandatory_variables as string[]) || []), ...((template.optional_variables as string[]) || [])];
  const resolved_variables: Record<string, string> = {};
  for (const varPath of allVars) {
    const value = resolvePath(varPath, context);
    resolved_variables[varPath] = isPresent(value) ? "resolved" : "missing";
  }

  return {
    ok: true,
    draft: {
      template_id: template.template_id,
      template_version: template.template_version,
      template_name: template.name,
      category: template.category,
      subject, body,
      resolved_variables,
      unresolved_variables: validation.missing || []
    },
    metadata: {
      packet_bindings: template.packet_bindings,
      tone_notes: template.tone_notes,
      performance_targets: template.performance_targets,
      domain: template.domain
    }
  };
}

async function generateBatchDrafts(templateId: string, contacts: Record<string, unknown>[], sharedContext: Record<string, unknown>, options: { strict?: boolean } = {}) {
  const drafts: Record<string, unknown>[] = [];
  const errors: Record<string, unknown>[] = [];

  for (const contactCtx of contacts) {
    const mergedContext = { ...sharedContext, contact: contactCtx };
    const result = await generateDraft(templateId, mergedContext, options);
    if (result.ok) {
      drafts.push({ contact: contactCtx, ...(result.draft as Record<string, unknown>) });
    } else {
      errors.push({ contact: contactCtx, error: result.error, missing: result.missing });
    }
  }

  return { ok: errors.length === 0, drafts, errors };
}

function computeEditDistance(original: string, final_: string): number {
  if (!original || !final_) return 100;
  if (original === final_) return 0;
  const origLines = original.split("\n");
  const finalLines = final_.split("\n");
  const maxLen = Math.max(origLines.length, finalLines.length);
  if (maxLen === 0) return 0;
  let matchingLines = 0;
  const minLen = Math.min(origLines.length, finalLines.length);
  for (let i = 0; i < minLen; i++) {
    if (origLines[i].trim() === finalLines[i].trim()) matchingLines++;
  }
  return Math.round((1 - matchingLines / maxLen) * 100);
}

async function recordTemplateSend(params: Record<string, unknown>) {
  const row = {
    template_id: params.template_id,
    template_version: params.template_version || 1,
    user_id: params.user_id,
    entity_id: params.entity_id || null,
    domain: params.domain || null,
    context_packet_id: params.context_packet_id || null,
    rendered_subject: params.rendered_subject || null,
    rendered_body: params.rendered_body || null,
    final_subject: params.final_subject || null,
    final_body: params.final_body || null,
    edit_distance_pct: params.edit_distance_pct ?? null,
    opened: false, replied: false, deal_advanced: false,
    sent_at: isoNow()
  };

  const result = await opsQuery("POST", "template_sends", row);
  if (!result.ok) {
    return { ok: false, error: "Failed to record template send", detail: result.data };
  }
  const send = Array.isArray(result.data) ? result.data[0] : result.data;

  // Fire-and-forget signal
  writeSignal({
    signal_type: "template_sent",
    signal_category: "communication",
    entity_type: "contact",
    entity_id: (params.entity_id as string) || null,
    domain: (params.domain as string) || null,
    user_id: params.user_id as string,
    payload: {
      template_id: params.template_id,
      template_version: params.template_version || 1,
      edit_distance_pct: params.edit_distance_pct ?? null,
      send_id: (send as Record<string, unknown>)?.id || null
    },
    outcome: "pending"
  });

  return { ok: true, send };
}

// ── Template Health Evaluation (from template-refinement.js) ───────────────

const EDIT_DISTANCE_FLAG_THRESHOLD = 40;
const MIN_SENDS_FOR_EVALUATION = 5;
const STALE_NO_SENDS_DAYS = 90;

async function evaluateTemplateHealth(options: { lookback_days?: number; template_id?: string }) {
  const lookbackDays = options.lookback_days || 120;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  let sendFilter = `sent_at=gte.${since}&select=template_id,template_version,edit_distance_pct,opened,replied,deal_advanced,sent_at&order=sent_at.desc&limit=1000`;
  if (options.template_id) {
    sendFilter += `&template_id=eq.${pgFilterVal(options.template_id)}`;
  }

  const [sendsResult, templatesResult] = await Promise.all([
    opsQuery("GET", `template_sends?${sendFilter}`),
    listActiveTemplates()
  ]);

  const sends = (sendsResult.data || []) as Record<string, unknown>[];
  const templates = templatesResult;

  // Aggregate by template
  const byTemplate: Record<string, Record<string, unknown>> = {};
  for (const s of sends) {
    const tid = s.template_id as string;
    if (!byTemplate[tid]) {
      byTemplate[tid] = {
        template_id: tid,
        total_sends: 0, opened: 0, replied: 0, deal_advanced: 0,
        edit_distances: [] as number[],
        first_send: s.sent_at, last_send: s.sent_at
      };
    }
    const t = byTemplate[tid];
    (t.total_sends as number)++;
    if (s.opened) (t.opened as number)++;
    if (s.replied) (t.replied as number)++;
    if (s.deal_advanced) (t.deal_advanced as number)++;
    if (s.edit_distance_pct != null) (t.edit_distances as number[]).push(s.edit_distance_pct as number);
    if ((s.sent_at as string) < (t.first_send as string)) t.first_send = s.sent_at;
    if ((s.sent_at as string) > (t.last_send as string)) t.last_send = s.sent_at;
  }

  // Evaluate each template
  const evaluations = templates.map(tmpl => {
    const tid = tmpl.template_id as string;
    const data = byTemplate[tid];
    const issues: string[] = [];
    let status = "healthy";

    if (!data) {
      // Check if stale
      const created = new Date(tmpl.created_at as string);
      const daysSinceCreation = Math.floor((Date.now() - created.getTime()) / 86400000);
      if (daysSinceCreation > STALE_NO_SENDS_DAYS) {
        issues.push(`No sends in ${lookbackDays} days`);
        status = "stale";
      } else {
        status = "new";
      }
      return { template_id: tid, template_name: tmpl.name, status, issues, sends: 0 };
    }

    const totalSends = data.total_sends as number;
    const editDistances = data.edit_distances as number[];
    const avgEdit = editDistances.length > 0
      ? editDistances.reduce((a, b) => a + b, 0) / editDistances.length
      : 0;

    if (totalSends >= MIN_SENDS_FOR_EVALUATION && avgEdit > EDIT_DISTANCE_FLAG_THRESHOLD) {
      issues.push(`High edit rate: ${Math.round(avgEdit)}% avg over ${totalSends} sends`);
      status = "needs_revision";
    }

    const replyRate = totalSends > 0 ? (data.replied as number) / totalSends : 0;
    if (totalSends >= 10 && replyRate < 0.05) {
      issues.push(`Low reply rate: ${Math.round(replyRate * 100)}%`);
      if (status === "healthy") status = "underperforming";
    }

    return {
      template_id: tid, template_name: tmpl.name, status, issues,
      sends: totalSends,
      avg_edit_distance_pct: Math.round(avgEdit * 10) / 10,
      reply_rate_pct: totalSends > 0 ? Math.round(replyRate * 1000) / 10 : 0,
    };
  });

  return {
    ok: true,
    lookback_days: lookbackDays,
    total_templates: templates.length,
    total_sends: sends.length,
    evaluations
  };
}

// ── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const params = queryParams(req);
  const action = params.get("action");
  const templateId = params.get("template_id");

  // Health check (GET, no auth)
  if (req.method === "GET" && action === "health") {
    return handleServiceHealth(req);
  }

  // Auth required for everything else
  const user = await authenticateUser(req);
  if (!user) return errorResponse(req, "Authentication failed", 401);
  const workspaceId = req.headers.get("x-lcc-workspace") || primaryWorkspaceId(user) || "";

  // GET — list or get templates
  if (req.method === "GET") {
    if (templateId) {
      const template = await loadTemplate(templateId);
      if (!template) return errorResponse(req, `Template "${templateId}" not found`, 404);
      return jsonResponse(req, { template });
    }
    const templates = await listActiveTemplates();
    return jsonResponse(req, { templates, count: templates.length });
  }

  if (req.method !== "POST") {
    return errorResponse(req, `Method ${req.method} not allowed`, 405);
  }

  const body = await parseBody(req) as Record<string, unknown> | null;
  const payload = body || {};

  switch (action) {
    case "generate":
    case null:
    case undefined:
      return handleGenerate(req, payload);
    case "batch":
      return handleBatch(req, payload);
    case "record_send":
      return handleRecordSend(req, payload, user, workspaceId);
    case "performance":
      return handlePerformance(req, payload);
    case "health":
      return handleTemplateHealth(req, payload, user);
    case "listing_bd":
      return errorResponse(req, "listing_bd action is not available on edge — use Vercel endpoint", 400);
    default:
      return errorResponse(req, "Invalid action. Use: generate, batch, record_send, performance, health", 400);
  }
});

// ── Action Handlers ────────────────────────────────────────────────────────

async function handleGenerate(req: Request, payload: Record<string, unknown>): Promise<Response> {
  const { template_id, context, strict } = payload;
  if (!template_id) return errorResponse(req, "template_id is required", 400);
  if (!context || typeof context !== "object") {
    return errorResponse(req, "context object is required (merged packet payload)", 400);
  }

  const result = await generateDraft(template_id as string, context as Record<string, unknown>, { strict: !!strict });
  if (!result.ok) return jsonResponse(req, result, 422);
  return jsonResponse(req, result);
}

async function handleBatch(req: Request, payload: Record<string, unknown>): Promise<Response> {
  const { template_id, contacts, shared_context, strict } = payload;
  if (!template_id) return errorResponse(req, "template_id is required", 400);
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return errorResponse(req, "contacts array is required and must not be empty", 400);
  }

  const result = await generateBatchDrafts(
    template_id as string,
    contacts as Record<string, unknown>[],
    (shared_context as Record<string, unknown>) || {},
    { strict: !!strict }
  );
  return jsonResponse(req, result);
}

async function handleRecordSend(
  req: Request, payload: Record<string, unknown>,
  user: { id: string }, workspaceId: string
): Promise<Response> {
  const { template_id, template_version, entity_id, domain,
          context_packet_id, rendered_subject, rendered_body,
          final_subject, final_body,
          original_draft, sent_text, duration_ms } = payload;

  if (!template_id) return errorResponse(req, "template_id is required", 400);

  let edit_distance_pct: number | null = null;
  if (rendered_body && final_body) {
    edit_distance_pct = computeEditDistance(rendered_body as string, final_body as string);
  }

  const result = await recordTemplateSend({
    template_id, template_version: template_version || 1,
    user_id: user.id, entity_id: entity_id || null,
    domain: domain || null, context_packet_id: context_packet_id || null,
    rendered_subject, rendered_body,
    final_subject: final_subject || rendered_subject,
    final_body: final_body || rendered_body,
    edit_distance_pct
  });

  // Voice diff capture — fire and forget, never blocks response
  try {
    const diffOriginal = (original_draft || rendered_body) as string;
    const diffSent = (sent_text || final_body) as string;

    if (diffOriginal && diffSent) {
      const charDelta = diffSent.length - diffOriginal.length;
      const wasEdited = diffSent !== diffOriginal && Math.abs(charDelta) > 10;

      let firstChangedLine = -1;
      if (wasEdited) {
        const origParas = diffOriginal.split("\n\n");
        const sentParas = diffSent.split("\n\n");
        const minParas = Math.min(origParas.length, sentParas.length);
        for (let i = 0; i < minParas; i++) {
          if (origParas[i] !== sentParas[i]) { firstChangedLine = i; break; }
        }
        if (firstChangedLine === -1 && origParas.length !== sentParas.length) {
          firstChangedLine = minParas;
        }
      }

      const editSummary = wasEdited ? {
        original_length: diffOriginal.length,
        sent_length: diffSent.length,
        char_delta: charDelta,
        first_changed_line: firstChangedLine
      } : null;

      // Fire-and-forget: write to template_refinements
      opsQuery("POST", "template_refinements", {
        workspace_id: workspaceId,
        template_id,
        original_draft: diffOriginal,
        sent_text: diffSent,
        was_edited: wasEdited,
        edit_summary: editSummary,
        entity_id: entity_id || null,
        domain: domain || null,
        created_at: isoNow()
      }).catch(err => console.error("[Template refinement write failed]", (err as Error)?.message));

      // Fire-and-forget: write template_edited signal
      writeSignal({
        signal_type: "template_edited",
        signal_category: "communication",
        entity_type: "contact",
        entity_id: (entity_id as string) || null,
        domain: (domain as string) || null,
        user_id: user.id,
        payload: {
          template_id,
          template_name: template_id,
          was_edited: wasEdited,
          edit_summary: editSummary,
          duration_ms: duration_ms || null
        }
      });
    }
  } catch (err) {
    console.error("[Voice diff capture failed]", (err as Error)?.message);
  }

  if (!result.ok) return jsonResponse(req, result, 500);
  return jsonResponse(req, result, 201);
}

async function handlePerformance(req: Request, payload: Record<string, unknown>): Promise<Response> {
  const { template_id, days, domain } = payload;
  const lookbackDays = (days as number) || 90;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  let filter = `sent_at=gte.${since}`;
  if (template_id) filter += `&template_id=eq.${pgFilterVal(template_id as string)}`;
  if (domain) filter += `&domain=eq.${pgFilterVal(domain as string)}`;

  const result = await opsQuery("GET",
    `template_sends?${filter}&select=template_id,template_version,edit_distance_pct,opened,replied,deal_advanced,sent_at,domain&order=sent_at.desc&limit=500`
  );

  if (!result.ok) {
    return jsonResponse(req, { error: "Failed to query template_sends", detail: result.data }, 500);
  }

  const sends = (result.data || []) as Record<string, unknown>[];

  const byTemplate: Record<string, Record<string, unknown>> = {};
  for (const s of sends) {
    const tid = s.template_id as string;
    if (!byTemplate[tid]) {
      byTemplate[tid] = {
        template_id: tid, total_sends: 0, opened: 0, replied: 0, deal_advanced: 0,
        edit_distances: [] as number[], first_send: s.sent_at, last_send: s.sent_at,
        domains: new Set<string>()
      };
    }
    const t = byTemplate[tid];
    (t.total_sends as number)++;
    if (s.opened) (t.opened as number)++;
    if (s.replied) (t.replied as number)++;
    if (s.deal_advanced) (t.deal_advanced as number)++;
    if (s.edit_distance_pct != null) (t.edit_distances as number[]).push(s.edit_distance_pct as number);
    if ((s.sent_at as string) < (t.first_send as string)) t.first_send = s.sent_at;
    if ((s.sent_at as string) > (t.last_send as string)) t.last_send = s.sent_at;
    if (s.domain) (t.domains as Set<string>).add(s.domain as string);
  }

  const templates = Object.values(byTemplate).map(t => {
    const eds = t.edit_distances as number[];
    const total = t.total_sends as number;
    const avgEdit = eds.length > 0 ? Math.round(eds.reduce((a, b) => a + b, 0) / eds.length * 10) / 10 : null;
    return {
      template_id: t.template_id, total_sends: total,
      opened: t.opened, replied: t.replied, deal_advanced: t.deal_advanced,
      open_rate_pct: total > 0 ? Math.round((t.opened as number) / total * 1000) / 10 : 0,
      reply_rate_pct: total > 0 ? Math.round((t.replied as number) / total * 1000) / 10 : 0,
      deal_advance_rate_pct: total > 0 ? Math.round((t.deal_advanced as number) / total * 1000) / 10 : 0,
      avg_edit_distance_pct: avgEdit,
      edit_sample_size: eds.length,
      first_send: t.first_send, last_send: t.last_send,
      domains: [...(t.domains as Set<string>)]
    };
  }).sort((a, b) => b.total_sends - a.total_sends);

  return jsonResponse(req, {
    ok: true, lookback_days: lookbackDays, total_sends: sends.length, templates,
    _insight: templates.length > 0
      ? `${templates[0].template_id} is the most-used template (${templates[0].total_sends} sends). ${templates.filter(t => t.avg_edit_distance_pct != null && t.avg_edit_distance_pct > 40).map(t => t.template_id).join(", ") || "No templates"} have high edit rates (>40%), suggesting the template may need revision.`
      : "No sends recorded in this period."
  });
}

async function handleTemplateHealth(
  req: Request, payload: Record<string, unknown>,
  user: { id: string }
): Promise<Response> {
  const { template_id, lookback_days } = payload;
  const healthReport = await evaluateTemplateHealth({
    template_id: template_id as string | undefined,
    lookback_days: (lookback_days as number) || 120
  });

  // Auto-flag templates that need revision
  const needsRevision = (healthReport.evaluations as Record<string, unknown>[])
    ?.filter(e => e.status === "needs_revision") || [];

  for (const t of needsRevision) {
    // Flag in DB
    await opsQuery("POST", "template_flags", {
      template_id: t.template_id,
      flag_type: "needs_revision",
      reason: (t.issues as string[]).join("; "),
      flagged_by: user.id,
      created_at: isoNow()
    }).catch(() => {}); // fire-and-forget
  }

  return jsonResponse(req, {
    ...healthReport,
    revisions_flagged: needsRevision.length
  });
}

// ── Service Health Check ───────────────────────────────────────────────────

async function handleServiceHealth(req: Request): Promise<Response> {
  const checks: Record<string, unknown> = {
    timestamp: isoNow(),
    ops_configured: !!(Deno.env.get("OPS_SUPABASE_URL") && Deno.env.get("OPS_SUPABASE_SERVICE_KEY")),
  };

  try {
    const r = await opsQuery("GET", "template_definitions?deprecated=eq.false&limit=1&select=template_id");
    checks.templates_accessible = r.ok;
    checks.template_count = r.count || 0;
  } catch {
    checks.templates_accessible = false;
  }

  return jsonResponse(req, checks);
}
