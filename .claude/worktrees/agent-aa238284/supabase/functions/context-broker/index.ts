// ============================================================================
// Context Broker — Assemble, cache, serve, and invalidate context packets
// Life Command Center — Infrastructure Migration Phase 1
//
// Ported from api/operations.js lines ~2810-3700.
// Runs as Supabase Edge Function next to the database for lower latency.
//
// Routes (via ?action= query param):
//   POST ?action=assemble             — assemble or retrieve a single packet
//   POST ?action=assemble-multi        — assemble multiple packets
//   POST ?action=invalidate            — invalidate cached packets
//   POST ?action=preassemble-nightly   — warm cache for high-priority entities
//   POST ?action=weekly-intelligence-report — weekly analytics summary
//   GET  (no action)                   — health/info endpoint
// ============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { opsQuery, rawQuery, pgFilterVal } from "../_shared/supabase-client.ts";
import { authenticateUser, primaryWorkspaceId } from "../_shared/auth.ts";
import { writeSignal, writePacketSignal } from "../_shared/signals.ts";
import { queryParams, parseBody, isoNow, isoFuture, estimateTokens, toArray } from "../_shared/utils.ts";

// ── Constants ──────────────────────────────────────────────────────────────

const VALID_PACKET_TYPES = new Set([
  "contact", "property", "pursuit", "deal",
  "daily_briefing", "listing_marketing", "comp_analysis"
]);

const PACKET_TTL_HOURS: Record<string, number> = {
  contact: 24,
  property: 4,
  pursuit: 12,
  deal: 4,
  daily_briefing: 1,
  listing_marketing: 6,
  comp_analysis: 72
};

// ── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  // GET = info/health endpoint
  if (req.method === "GET") {
    return jsonResponse(req, {
      service: "context-broker",
      version: "1.0.0",
      valid_actions: ["assemble", "assemble-multi", "invalidate", "preassemble-nightly", "weekly-intelligence-report"],
      valid_packet_types: [...VALID_PACKET_TYPES],
      ttl_hours: PACKET_TTL_HOURS
    });
  }

  if (req.method !== "POST") {
    return errorResponse(req, `Method ${req.method} not allowed. Context broker accepts POST only.`, 405);
  }

  // Authenticate
  const user = await authenticateUser(req);
  if (!user) {
    return errorResponse(req, "Authentication failed", 401);
  }

  const workspaceId = req.headers.get("x-lcc-workspace") || primaryWorkspaceId(user);
  if (!workspaceId) {
    return errorResponse(req, "No workspace context", 400);
  }

  const params = queryParams(req);
  const body = await parseBody(req);
  const action = params.get("action") || (body as Record<string, unknown>)?.action;

  switch (action) {
    case "assemble":                     return handleAssemble(req, body, workspaceId, user.id);
    case "assemble-multi":               return handleAssembleMulti(req, body, workspaceId, user.id);
    case "invalidate":                   return handleInvalidate(req, body, workspaceId, user.id);
    case "preassemble-nightly":          return handlePreassembleNightly(req, workspaceId, user.id);
    case "weekly-intelligence-report":   return handleWeeklyReport(req, workspaceId);
    default:
      return errorResponse(req, "Invalid context action. Use: assemble, assemble-multi, invalidate, preassemble-nightly, weekly-intelligence-report", 400);
  }
});

// ── Weekly Intelligence Report ─────────────────────────────────────────────

async function handleWeeklyReport(req: Request, workspaceId: string): Promise<Response> {
  const [ignoredResult, templatesResult, slowResult] = await Promise.all([
    opsQuery("GET", "ignored_recommendation_contacts?order=ignored_count.desc&limit=25"),
    opsQuery("GET", "high_performing_templates?order=response_rate_pct.desc&limit=10"),
    opsQuery("GET", "slow_action_report?order=avg_duration_ms.desc&limit=20")
  ]);

  const ignoredContacts = toArray(ignoredResult.data);
  const topTemplates = toArray(templatesResult.data);
  const slowActions = toArray(slowResult.data);

  const enrichedIgnored = await Promise.all(
    ignoredContacts.slice(0, 15).map(async (row: Record<string, unknown>) => {
      let name: string | null = null;
      if (row.entity_id) {
        try {
          const entityResult = await opsQuery("GET",
            `entities?id=eq.${pgFilterVal(row.entity_id as string)}&select=name&limit=1`
          );
          name = entityResult.data?.[0]?.name || null;
        } catch { /* best-effort */ }
      }
      return {
        entity_id: row.entity_id,
        name: name || "(unknown)",
        ignored_count: row.ignored_count
      };
    })
  );

  const weekEnding = new Date().toISOString().split("T")[0];
  const bestRate = topTemplates.length > 0 ? `${(topTemplates[0] as Record<string, unknown>).response_rate_pct}%` : "N/A";
  const slowestAvg = slowActions.length > 0 ? Number((slowActions[0] as Record<string, unknown>).avg_duration_ms) : 0;

  return jsonResponse(req, {
    week_ending: weekEnding,
    ignored_recommendations: enrichedIgnored,
    top_performing_templates: topTemplates.map((t: Record<string, unknown>) => ({
      template_name: t.template_name || t.template_id,
      response_rate_pct: t.response_rate_pct,
      sent_count: t.sent_count
    })),
    slowest_actions: slowActions.map((s: Record<string, unknown>) => ({
      signal_type: s.signal_type,
      avg_duration_ms: Number(s.avg_duration_ms),
      occurrence_count: s.occurrence_count
    })),
    summary: {
      contacts_consistently_ignored: ignoredContacts.length,
      best_template_response_rate: bestRate,
      slowest_avg_action_ms: slowestAvg
    }
  });
}

// ── Assemble Single ────────────────────────────────────────────────────────

async function handleAssemble(
  req: Request, body: Record<string, unknown> | null,
  workspaceId: string, userId: string
): Promise<Response> {
  const { packet_type, entity_id, entity_type, surface_hint, force_refresh, max_tokens } = (body || {}) as Record<string, unknown>;

  if (!packet_type || !VALID_PACKET_TYPES.has(packet_type as string)) {
    return errorResponse(req, `Invalid or missing packet_type. Use: ${[...VALID_PACKET_TYPES].join(", ")}`, 400);
  }
  if (packet_type !== "daily_briefing" && !entity_id) {
    return errorResponse(req, "entity_id is required for non-briefing packet types", 400);
  }

  try {
    const result = await assembleSinglePacket({
      packet_type: packet_type as string,
      entity_id: (entity_id as string) || null,
      entity_type: (entity_type as string) || null,
      surface_hint: (surface_hint as string) || null,
      force_refresh: !!force_refresh,
      max_tokens: (max_tokens as number) || null,
      workspaceId, userId
    });
    return jsonResponse(req, result);
  } catch (err) {
    console.error(`[context-broker] Assembly failed for ${packet_type}/${entity_id}:`, (err as Error).message);
    return errorResponse(req, "Context packet assembly failed", 503);
  }
}

// ── Assemble Multiple ──────────────────────────────────────────────────────

async function handleAssembleMulti(
  req: Request, body: Record<string, unknown> | null,
  workspaceId: string, userId: string
): Promise<Response> {
  const { requests } = (body || {}) as Record<string, unknown>;

  if (!Array.isArray(requests) || requests.length === 0) {
    return errorResponse(req, "requests array is required and must not be empty", 400);
  }
  if (requests.length > 10) {
    return errorResponse(req, "Maximum 10 packets per multi-assemble request", 400);
  }

  const startMs = Date.now();
  let cacheHits = 0;
  let assemblies = 0;

  const results = await Promise.allSettled(
    requests.map((r: Record<string, unknown>) => assembleSinglePacket({
      packet_type: r.packet_type as string,
      entity_id: (r.entity_id as string) || null,
      entity_type: (r.entity_type as string) || null,
      surface_hint: (r.surface_hint as string) || null,
      force_refresh: !!r.force_refresh,
      max_tokens: (r.max_tokens as number) || null,
      workspaceId, userId
    }))
  );

  const packets: unknown[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      packets.push(result.value);
      if ((result.value as Record<string, unknown>).cache_hit) cacheHits++;
      else assemblies++;
    } else {
      packets.push({ error: "Assembly failed" });
    }
  }

  const totalTokens = packets.reduce((sum, p) => sum + ((p as Record<string, unknown>).token_count as number || 0), 0);

  return jsonResponse(req, {
    packets,
    total_token_count: totalTokens,
    assembly_meta: {
      total_duration_ms: Date.now() - startMs,
      cache_hits: cacheHits,
      assemblies
    }
  });
}

// ── Invalidate ─────────────────────────────────────────────────────────────

async function handleInvalidate(
  req: Request, body: Record<string, unknown> | null,
  workspaceId: string, userId: string
): Promise<Response> {
  const { packet_type, entity_id, reason, force_rebuild } = (body || {}) as Record<string, unknown>;

  if (!entity_id) return errorResponse(req, "entity_id is required", 400);
  if (!packet_type) return errorResponse(req, 'packet_type is required (or "all")', 400);

  let filter = `context_packets?entity_id=eq.${pgFilterVal(entity_id as string)}&invalidated=eq.false`;
  if (packet_type !== "all") {
    filter += `&packet_type=eq.${pgFilterVal(packet_type as string)}`;
  }

  const patchResult = await opsQuery("PATCH", filter, {
    invalidated: true,
    invalidation_reason: (reason as string) || "manual_invalidation"
  });

  const invalidatedCount = Array.isArray(patchResult.data) ? patchResult.data.length : 0;

  writeSignal({
    signal_type: "packet_invalidated",
    signal_category: "intelligence",
    entity_id: entity_id as string,
    user_id: userId,
    payload: { packet_type, reason, invalidated_count: invalidatedCount }
  });

  let rebuildQueued = false;
  if (force_rebuild && packet_type !== "all") {
    rebuildQueued = true;
    assembleSinglePacket({
      packet_type: packet_type as string,
      entity_id: (entity_id as string) || null,
      entity_type: null, surface_hint: null,
      force_refresh: true, max_tokens: null,
      workspaceId, userId
    }).catch(err => console.error("[context-broker] Rebuild after invalidation failed:", (err as Error).message));
  }

  return jsonResponse(req, { invalidated_count: invalidatedCount, rebuild_queued: rebuildQueued });
}

// ── Preassemble Nightly ────────────────────────────────────────────────────

async function handlePreassembleNightly(
  req: Request, workspaceId: string, userId: string
): Promise<Response> {
  const startMs = Date.now();

  const [propsRes, contactsRes, crossDomainRes] = await Promise.all([
    opsQuery("GET",
      `entities?entity_type=eq.asset` +
      `&metadata->>investment_score=gt.60` +
      `&workspace_id=eq.${pgFilterVal(workspaceId)}` +
      `&select=id,entity_type,domain` +
      `&limit=100`
    ),
    fetchActiveContacts(workspaceId),
    opsQuery("GET",
      `entities?tags=cs.{cross_domain_owner}` +
      `&workspace_id=eq.${pgFilterVal(workspaceId)}` +
      `&select=id,entity_type,domain`
    )
  ]);

  const entityMap = new Map();
  for (const list of [propsRes, contactsRes, crossDomainRes]) {
    const rows = toArray(list.data);
    for (const row of rows) {
      if (row.id && !entityMap.has(row.id)) entityMap.set(row.id, row);
    }
  }
  const candidates = [...entityMap.values()];

  const assemblyQueue: Array<Record<string, unknown>> = [];
  let alreadyFresh = 0;
  const fourHoursFromNow = isoFuture(4);

  for (const entity of candidates) {
    const packetType = entity.entity_type === "asset" ? "property" : "contact";
    const freshCheck = await opsQuery("GET",
      `context_packets?entity_id=eq.${pgFilterVal(entity.id)}` +
      `&packet_type=eq.${pgFilterVal(packetType)}` +
      `&invalidated=eq.false` +
      `&expires_at=gt.${pgFilterVal(fourHoursFromNow)}` +
      `&limit=1`
    );
    if (freshCheck.ok && freshCheck.data?.length > 0) {
      alreadyFresh++;
    } else {
      assemblyQueue.push({ ...entity, packet_type: packetType });
    }
  }

  let assembled = 0;
  let failed = 0;
  const BATCH_SIZE = 10;

  for (let i = 0; i < assemblyQueue.length; i += BATCH_SIZE) {
    const batch = assemblyQueue.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(entity => assembleSinglePacket({
        packet_type: entity.packet_type as string,
        entity_id: entity.id as string,
        entity_type: entity.entity_type as string,
        surface_hint: "preassembly",
        force_refresh: true,
        max_tokens: null,
        workspaceId, userId
      }))
    );
    for (const result of results) {
      if (result.status === "fulfilled") assembled++;
      else {
        failed++;
        console.error("[preassemble-nightly] Failed:", result.reason?.message);
      }
    }
    if (i + BATCH_SIZE < assemblyQueue.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Also assemble daily_briefing
  try {
    await assembleSinglePacket({
      packet_type: "daily_briefing",
      entity_id: null, entity_type: null,
      surface_hint: "preassembly",
      force_refresh: true, max_tokens: null,
      workspaceId, userId
    });
    assembled++;
  } catch (err) {
    failed++;
    console.error("[preassemble-nightly] daily_briefing failed:", (err as Error).message);
  }

  return jsonResponse(req, {
    total_candidates: candidates.length,
    already_fresh: alreadyFresh,
    assembled, failed,
    duration_ms: Date.now() - startMs
  });
}

// ── Active Contacts Helper ─────────────────────────────────────────────────

async function fetchActiveContacts(workspaceId: string) {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const activityRes = await opsQuery("GET",
    `activity_events?occurred_at=gt.${pgFilterVal(ninetyDaysAgo)}&select=entity_id&limit=500`
  );

  const entityIds = [...new Set(
    toArray(activityRes.data)
      .map((r: Record<string, unknown>) => r.entity_id)
      .filter(Boolean)
  )];

  if (entityIds.length === 0) return { ok: true, data: [] };

  return opsQuery("GET",
    `entities?entity_type=eq.person` +
    `&workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&id=in.(${entityIds.map(id => pgFilterVal(id as string)).join(",")})` +
    `&select=id,entity_type,domain` +
    `&limit=200`
  );
}

// ── Core Assembly Engine ───────────────────────────────────────────────────

interface AssembleParams {
  packet_type: string;
  entity_id: string | null;
  entity_type: string | null;
  surface_hint: string | null;
  force_refresh: boolean;
  max_tokens: number | null;
  workspaceId: string;
  userId: string;
}

async function assembleSinglePacket(params: AssembleParams) {
  const { packet_type, entity_id, entity_type, surface_hint, force_refresh, max_tokens, workspaceId, userId } = params;
  const startMs = Date.now();

  // Step 1 — Cache check
  if (!force_refresh && entity_id) {
    const cacheFilter =
      `context_packets?packet_type=eq.${pgFilterVal(packet_type)}` +
      `&entity_id=eq.${pgFilterVal(entity_id)}` +
      `&invalidated=eq.false` +
      `&expires_at=gt.${pgFilterVal(isoNow())}` +
      `&order=assembled_at.desc&limit=1`;

    const cached = await opsQuery("GET", cacheFilter);
    if (cached.ok && cached.data?.length > 0) {
      const pkt = cached.data[0];
      writePacketSignal(packet_type, entity_id, entity_type || pkt.entity_type, userId, {
        token_count: pkt.token_count, surface_hint: surface_hint || undefined,
        sources_queried: [], duration_ms: Date.now() - startMs, cache_hit: true
      });
      return {
        packet_id: pkt.id, packet_type: pkt.packet_type,
        entity_id: pkt.entity_id, assembled_at: pkt.assembled_at,
        expires_at: pkt.expires_at, cache_hit: true,
        token_count: pkt.token_count, payload: pkt.payload,
        assembly_meta: { sources_queried: [], fields_missing: [], compression_applied: false, duration_ms: Date.now() - startMs }
      };
    }
  }

  // Cache check for daily_briefing (no entity_id)
  if (!force_refresh && packet_type === "daily_briefing" && !entity_id) {
    const briefingFilter =
      `context_packets?packet_type=eq.daily_briefing` +
      `&requesting_user=eq.${pgFilterVal(userId)}` +
      `&invalidated=eq.false` +
      `&expires_at=gt.${pgFilterVal(isoNow())}` +
      `&order=assembled_at.desc&limit=1`;

    const cached = await opsQuery("GET", briefingFilter);
    if (cached.ok && cached.data?.length > 0) {
      const pkt = cached.data[0];
      writePacketSignal("daily_briefing", null, null, userId, {
        token_count: pkt.token_count, surface_hint: surface_hint || undefined,
        sources_queried: [], duration_ms: Date.now() - startMs, cache_hit: true
      });
      return {
        packet_id: pkt.id, packet_type: pkt.packet_type,
        entity_id: pkt.entity_id, assembled_at: pkt.assembled_at,
        expires_at: pkt.expires_at, cache_hit: true,
        token_count: pkt.token_count, payload: pkt.payload,
        assembly_meta: { sources_queried: [], fields_missing: [], compression_applied: false, duration_ms: Date.now() - startMs }
      };
    }
  }

  // Step 2 — Assemble fresh packet
  let payload: Record<string, unknown>;
  let sourcesQueried: string[];
  let fieldsMissing: string[];

  switch (packet_type) {
    case "property":
      ({ payload, sourcesQueried, fieldsMissing } = await assemblePropertyPacket(entity_id!, workspaceId));
      break;
    case "contact":
      ({ payload, sourcesQueried, fieldsMissing } = await assembleContactPacket(entity_id!, workspaceId));
      break;
    case "daily_briefing":
      ({ payload, sourcesQueried, fieldsMissing } = await assembleDailyBriefingPacket(workspaceId, userId));
      break;
    default:
      ({ payload, sourcesQueried, fieldsMissing } = await assembleGenericPacket(packet_type, entity_id!, workspaceId));
      break;
  }

  const assembledAt = isoNow();
  const ttlHours = PACKET_TTL_HOURS[packet_type] || 4;
  const expiresAt = isoFuture(ttlHours);
  const tokenCount = estimateTokens(payload);
  const durationMs = Date.now() - startMs;

  // Step 3 — Write to cache (fire-and-forget)
  opsQuery("POST", "context_packets", {
    packet_type, entity_id: entity_id || null,
    entity_type: entity_type || null,
    requesting_user: userId,
    surface_hint: surface_hint || null,
    payload, token_count: tokenCount,
    assembled_at: assembledAt, expires_at: expiresAt,
    assembly_duration_ms: durationMs, model_version: "1.0"
  }).catch(err => console.error("[context-broker] Cache write failed:", (err as Error).message));

  // Step 4 — Write signal (fire-and-forget)
  writePacketSignal(packet_type, entity_id, entity_type, userId, {
    token_count: tokenCount, surface_hint: surface_hint || undefined,
    sources_queried: sourcesQueried, duration_ms: durationMs
  });

  // Step 5 — Return packet
  return {
    packet_id: null, packet_type,
    entity_id: entity_id || null,
    assembled_at: assembledAt, expires_at: expiresAt,
    cache_hit: false, token_count: tokenCount, payload,
    assembly_meta: { sources_queried: sourcesQueried, fields_missing: fieldsMissing, compression_applied: false, duration_ms: durationMs }
  };
}

// ── Property Packet Assembly ───────────────────────────────────────────────

async function assemblePropertyPacket(entityId: string, workspaceId: string) {
  const sourcesQueried = ["lcc_db"];
  const fieldsMissing: string[] = [];

  const [entityRes, identitiesRes, activityRes, researchRes] = await Promise.all([
    opsQuery("GET", `entities?id=eq.${pgFilterVal(entityId)}&select=*&limit=1`),
    opsQuery("GET", `external_identities?entity_id=eq.${pgFilterVal(entityId)}&select=*`),
    opsQuery("GET", `activity_events?entity_id=eq.${pgFilterVal(entityId)}&order=occurred_at.desc&limit=10&select=id,category,title,source_type,occurred_at,metadata`),
    opsQuery("GET", `action_items?entity_id=eq.${pgFilterVal(entityId)}&status=in.(open,in_progress)&select=id,title,status,priority,due_date,action_type&order=created_at.desc&limit=5`)
  ]);

  const entity = entityRes.data?.[0] || null;
  if (!entity) throw new Error(`Entity ${entityId} not found`);

  const identities = toArray(identitiesRes.data);
  const activityTimeline = toArray(activityRes.data);
  const activeResearch = toArray(researchRes.data);

  // Query domain DBs for lease data via linked source IDs
  let leaseData = null;
  const govIdentity = identities.find((i: Record<string, unknown>) => i.source_system === "gov_db" || i.source_system === "government");
  const diaIdentity = identities.find((i: Record<string, unknown>) => i.source_system === "dia_db" || i.source_system === "dialysis");

  const govUrl = Deno.env.get("GOV_SUPABASE_URL");
  const govKey = Deno.env.get("GOV_SUPABASE_KEY");
  const diaUrl = Deno.env.get("DIA_SUPABASE_URL");
  const diaKey = Deno.env.get("DIA_SUPABASE_KEY");

  if (govIdentity?.external_id && govUrl && govKey) {
    sourcesQueried.push("gov_db");
    try {
      const govRes = await rawQuery(govUrl, govKey, "GET",
        `properties?id=eq.${encodeURIComponent(govIdentity.external_id)}&select=*&limit=1`
      );
      if (govRes.ok) leaseData = govRes.data?.[0] || null;
    } catch (err) {
      console.error("[context-broker] Gov DB query failed:", (err as Error).message);
      fieldsMissing.push("lease_data");
    }
  } else if (diaIdentity?.external_id && diaUrl && diaKey) {
    sourcesQueried.push("dia_db");
    try {
      const diaRes = await rawQuery(diaUrl, diaKey, "GET",
        `properties?id=eq.${encodeURIComponent(diaIdentity.external_id)}&select=*&limit=1`
      );
      if (diaRes.ok) leaseData = diaRes.data?.[0] || null;
    } catch (err) {
      console.error("[context-broker] Dia DB query failed:", (err as Error).message);
      fieldsMissing.push("lease_data");
    }
  }

  // Investment score heuristic
  let investmentScore: number | null = null;
  if (leaseData) {
    investmentScore = 50;
    if ((leaseData as Record<string, unknown>).remaining_lease_term_years as number > 10) investmentScore += 20;
    else if ((leaseData as Record<string, unknown>).remaining_lease_term_years as number > 5) investmentScore += 10;
    if ((leaseData as Record<string, unknown>).occupancy_status === "occupied") investmentScore += 15;
    if ((leaseData as Record<string, unknown>).lease_type === "NNN") investmentScore += 15;
  }

  const payload = {
    entity, lease_data: leaseData, research_status: activeResearch,
    activity_timeline: activityTimeline, investment_score: investmentScore,
    external_identities: identities.map((i: Record<string, unknown>) => ({
      source_system: i.source_system, source_type: i.source_type, external_id: i.external_id
    }))
  };

  return { payload, sourcesQueried, fieldsMissing };
}

// ── Contact Packet Assembly ────────────────────────────────────────────────

async function assembleContactPacket(entityId: string, workspaceId: string) {
  const sourcesQueried = ["lcc_db"];
  const fieldsMissing: string[] = [];

  const [entityRes, activityRes, touchpointRes, pursuitsRes] = await Promise.all([
    opsQuery("GET", `entities?id=eq.${pgFilterVal(entityId)}&select=*&limit=1`),
    opsQuery("GET", `activity_events?entity_id=eq.${pgFilterVal(entityId)}&order=occurred_at.desc&limit=20&select=id,category,title,source_type,occurred_at,metadata`),
    opsQuery("GET", `signals?entity_id=eq.${pgFilterVal(entityId)}&signal_type=eq.touchpoint_logged&order=created_at.desc&limit=20&select=id,signal_type,payload,created_at`),
    opsQuery("GET", `action_items?entity_id=eq.${pgFilterVal(entityId)}&status=in.(open,in_progress)&select=id,title,status,priority,due_date,action_type&order=created_at.desc&limit=10`)
  ]);

  const entity = entityRes.data?.[0] || null;
  if (!entity) throw new Error(`Entity ${entityId} not found`);

  const activityTimeline = toArray(activityRes.data);
  const touchpoints = toArray(touchpointRes.data);
  const activePursuits = toArray(pursuitsRes.data);

  const touchpointCount = touchpoints.length;
  const lastTouch = (touchpoints[0] as Record<string, unknown>)?.created_at as string || null;
  const lastTouchDate = lastTouch ? lastTouch.split("T")[0] : null;
  const daysSinceLastTouch = lastTouch
    ? Math.floor((Date.now() - new Date(lastTouch).getTime()) / 86400000)
    : null;

  let relationshipScore: number | null = null;
  if (touchpointCount > 0) {
    relationshipScore = Math.min(100, Math.max(0,
      Math.round(50 + (touchpointCount * 3) - (daysSinceLastTouch || 0))
    ));
  }

  let recommendedAction: string | null = null;
  if (daysSinceLastTouch === null || daysSinceLastTouch > 30) {
    recommendedAction = "Reconnect — no recent touchpoints";
  } else if (daysSinceLastTouch > 14) {
    recommendedAction = "Follow up — approaching cadence gap";
  } else if (activePursuits.length > 0) {
    recommendedAction = `Active pursuit: ${(activePursuits[0] as Record<string, unknown>).title}`;
  }

  const payload = {
    entity,
    touchpoint_history: touchpoints.map((t: Record<string, unknown>) => ({
      date: t.created_at,
      type: (t.payload as Record<string, unknown>)?.activity_category || "touchpoint",
      title: (t.payload as Record<string, unknown>)?.title || null
    })),
    active_pursuits: activePursuits,
    relationship_score: relationshipScore,
    recommended_action: recommendedAction,
    last_touch_date: lastTouchDate,
    touchpoint_count: touchpointCount,
    days_since_last_touch: daysSinceLastTouch,
    activity_timeline: activityTimeline
  };

  return { payload, sourcesQueried, fieldsMissing };
}

// ── Daily Briefing Packet Assembly ─────────────────────────────────────────

async function assembleDailyBriefingPacket(workspaceId: string, userId: string) {
  const sourcesQueried = ["lcc_db"];
  const fieldsMissing: string[] = [];

  const [workCountsRes, myWorkRes, inboxRes, sfActivityRes] = await Promise.all([
    opsQuery("GET", `mv_work_counts?workspace_id=eq.${pgFilterVal(workspaceId)}&limit=1`),
    opsQuery("GET",
      `v_my_work?workspace_id=eq.${pgFilterVal(workspaceId)}` +
      `&or=(user_id.eq.${pgFilterVal(userId)},assigned_to.eq.${pgFilterVal(userId)})` +
      `&limit=15&order=due_date.asc.nullslast,created_at.desc`
    ),
    opsQuery("GET",
      `v_inbox_triage?workspace_id=eq.${pgFilterVal(workspaceId)}&limit=10&order=received_at.desc`
    ),
    opsQuery("GET",
      `activity_events?workspace_id=eq.${pgFilterVal(workspaceId)}&source_type=eq.salesforce&order=occurred_at.desc&limit=30&select=id,category,title,body,source_type,metadata,occurred_at`
    )
  ]);

  const workCounts = workCountsRes.data?.[0] || {};
  const myWork = toArray(myWorkRes.data);
  const inboxItems = toArray(inboxRes.data);
  const sfActivity = toArray(sfActivityRes.data);

  const DEAL_RE = /offer|under contract|loi|closing|escrow|due diligence|psa|purchase|disposition/i;
  const PURSUIT_RE = /bov|proposal|valuation|pitch|pursuit|prospect|owner|seller/i;

  const strategic: Record<string, unknown>[] = [];
  const important: Record<string, unknown>[] = [];
  const urgent: Record<string, unknown>[] = [];

  for (const item of [...myWork, ...inboxItems]) {
    const rec = item as Record<string, unknown>;
    const text = (((rec.title as string) || "") + " " + ((rec.body as string) || "")).toLowerCase();
    if (DEAL_RE.test(text) || PURSUIT_RE.test(text)) strategic.push(rec);
    else if (rec.priority === "high" || rec.priority === "urgent") important.push(rec);
    else urgent.push(rec);
  }

  const mapItem = (item: Record<string, unknown>, rank: number) => ({
    priority_rank: rank,
    category: (item.source_type || item.item_type || "general") as string,
    title: (item.title as string) || "(Untitled)",
    entity_name: (item.title as string) || null,
    entity_id: (item.entity_id || item.id || null) as string | null,
    context: (item.body as string) || null,
    suggested_actions: []
  });

  const calls = sfActivity.filter((a: Record<string, unknown>) => a.category === "call").length;
  const emails = sfActivity.filter((a: Record<string, unknown>) => a.category === "email").length;

  const payload = {
    packet_type: "daily_briefing",
    generated_at: isoNow(),
    date: new Date().toISOString().split("T")[0],
    user_id: userId,
    strategic_items: strategic.slice(0, 5).map((item, i) => mapItem(item, i + 1)),
    important_items: important.slice(0, 5).map((item, i) => mapItem(item, i + 1)),
    urgent_items: urgent.slice(0, 5).map((item, i) => mapItem(item, i + 1)),
    production_score: {
      bd_touchpoints: { planned: 10, completed_yesterday: 0, weekly_target: 10, weekly_completed: calls + emails },
      calls_logged: { weekly_completed: calls, weekly_target: 15 },
      om_follow_ups_completed: { open: 0, overdue_48h: 0 }
    },
    team_metrics: {
      open_actions: workCounts.open_actions || 0,
      inbox_new: workCounts.inbox_new || 0,
      overdue: workCounts.overdue_actions || 0,
      completed_week: workCounts.completed_week || 0
    },
    assembled_at: isoNow()
  };

  return { payload, sourcesQueried, fieldsMissing };
}

// ── Generic Packet Assembly ────────────────────────────────────────────────

async function assembleGenericPacket(packetType: string, entityId: string, workspaceId: string) {
  const sourcesQueried = ["lcc_db"];
  const fieldsMissing: string[] = [];

  const [entityRes, activityRes, relatedActionsRes] = await Promise.all([
    opsQuery("GET", `entities?id=eq.${pgFilterVal(entityId)}&select=*&limit=1`),
    opsQuery("GET", `activity_events?entity_id=eq.${pgFilterVal(entityId)}&order=occurred_at.desc&limit=15&select=id,category,title,source_type,occurred_at,metadata`),
    opsQuery("GET", `action_items?entity_id=eq.${pgFilterVal(entityId)}&status=in.(open,in_progress)&select=id,title,status,priority,due_date,action_type&order=created_at.desc&limit=10`)
  ]);

  const entity = entityRes.data?.[0] || null;
  if (!entity) throw new Error(`Entity ${entityId} not found`);

  const payload = {
    packet_type: packetType,
    entity,
    activity_timeline: toArray(activityRes.data),
    active_items: toArray(relatedActionsRes.data)
  };

  return { payload, sourcesQueried, fieldsMissing };
}
