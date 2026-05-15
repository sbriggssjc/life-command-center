// ============================================================================
// intake-salesforce — Salesforce object intake for the SF -> LCC bridge
// Life Command Center
//
// The front door Power Automate's "SF -> LCC: Object Sync" flow POSTs to.
// Transport (Power Automate) -> brain (this function): validate, dedup, route
// per vertical, stage. It never writes a domain table — promotion is the
// sf-promotion-worker's job, gated by lcc_merge_field().
//
// Routes:
//   POST ?action=objects         — stage a batch of Salesforce records
//   POST ?action=crawl-complete  — close a batch: crawl_run row + link-probe
//   POST ?action=retry           — re-stage failed sync_log rows; dead-letter exhausted
//   POST ?action=dead-letter     — mark sync_log rows dead
//   GET  ?action=watermark       — last successful crawl_run date
//   GET  ?action=file-targets    — staged SF ids for Flow 2 file discovery
//   GET  ?action=retry-queue     — failed sync_log rows for Flow 3
//   GET  (no action)             — info
// ============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authenticateWebhook } from "../_shared/auth.ts";
import { queryParams, parseBody, isoNow } from "../_shared/utils.ts";
import {
  OBJECT_CONFIG, resolveObjectKey, mapRecord, routeVertical, normalizeAddress,
  type Vertical,
} from "./sf-config.ts";

const PAYLOAD_VERSION = "sf-2026-05-v1";
const MAX_RETRY = 5;

// ── per-vertical DB access (service-role, server-side only) ─────────────────
function dbEnv(vertical: Vertical): { url: string; key: string } | null {
  const map: Record<Vertical, [string, string]> = {
    ops: ["OPS_SUPABASE_URL", "OPS_SUPABASE_SERVICE_KEY"],
    gov: ["GOV_SUPABASE_URL", "GOV_SUPABASE_KEY"],
    dia: ["DIA_SUPABASE_URL", "DIA_SUPABASE_KEY"],
  };
  const [u, k] = map[vertical];
  const url = Deno.env.get(u), key = Deno.env.get(k);
  return url && key ? { url, key } : null;
}

async function dbFetch(
  vertical: Vertical, method: string, path: string,
  body?: unknown, prefer = "return=minimal",
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const env = dbEnv(vertical);
  if (!env) return { ok: false, status: 503, data: { error: `${vertical} DB not configured` } };
  const res = await fetch(`${env.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.key,
      Authorization: `Bearer ${env.key}`,
      "Content-Type": "application/json",
      Prefer: method === "GET" ? "count=exact" : prefer,
    },
    body: body && method !== "GET" ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// Append rows to the central LCC ledger (OPS.sf_sync_log).
function ledgerRows(rows: Record<string, unknown>[]) {
  return dbFetch("ops", "POST", "sf_sync_log", rows);
}

// ── main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const params = queryParams(req);
  const action = params.get("action");

  if (req.method === "GET" && !action) {
    return jsonResponse(req, {
      service: "intake-salesforce",
      version: PAYLOAD_VERSION,
      actions: ["objects", "crawl-complete", "retry", "dead-letter", "watermark", "file-targets", "retry-queue"],
    });
  }

  // Everything else requires the Power Automate webhook secret.
  if (!authenticateWebhook(req)) {
    return errorResponse(req, "Unauthorized — missing or invalid X-PA-Webhook-Secret", 401);
  }

  try {
    if (req.method === "GET") {
      if (action === "watermark") return await handleWatermark(req);
      if (action === "file-targets") return await handleFileTargets(req, params);
      if (action === "retry-queue") return await handleRetryQueue(req);
      return errorResponse(req, `Unknown GET action: ${action}`, 400);
    }
    if (req.method === "POST") {
      const body = (await parseBody(req)) as Record<string, unknown> | null;
      if (action === "objects") return await handleObjects(req, body);
      if (action === "crawl-complete") return await handleCrawlComplete(req, body);
      if (action === "retry") return await handleRetry(req, body);
      if (action === "dead-letter") return await handleDeadLetter(req, body);
      return errorResponse(req, `Unknown POST action: ${action}`, 400);
    }
    return errorResponse(req, `Method ${req.method} not allowed`, 405);
  } catch (err) {
    console.error("[intake-salesforce]", err);
    return errorResponse(req, `Internal error: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});

// ── POST ?action=objects ────────────────────────────────────────────────────
async function handleObjects(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  if (!body) return errorResponse(req, "Missing JSON body", 400);
  const batchId = String(body.batch_id || "");
  const objectType = String(body.object_type || "");
  const records = Array.isArray(body.records) ? body.records as Record<string, unknown>[] : null;
  if (!batchId) return errorResponse(req, "batch_id is required", 400);
  if (!records) return errorResponse(req, "records[] is required", 400);

  const objectKey = resolveObjectKey(objectType);
  if (!objectKey) return errorResponse(req, `Unrecognized object_type: ${objectType}`, 400);
  const cfg = OBJECT_CONFIG[objectKey];

  const ledger: Record<string, unknown>[] = [];
  const stagingByVertical: Record<string, Record<string, unknown>[]> = {};
  let errors = 0;

  for (const record of records) {
    try {
      const mapped = await mapRecord(objectKey, record);
      const { vertical, resolved } = routeVertical(mapped.row);

      ledger.push({
        sync_type: "object_intake",
        target_database: vertical,
        sf_object_type: objectType,
        sf_object_id: mapped.sfId,
        import_batch: batchId,
        payload: mapped.raw,
        status: "ok",
      });

      const stagingRow = {
        ...mapped.row,
        source_system: "salesforce",
        import_batch: batchId,
        process_status: resolved ? "pending" : "review",
        process_notes: resolved ? null : "vertical routing unresolved — defaulted to dia",
        match_method: resolved ? null : "vertical_unresolved",
        imported_at: isoNow(),
        updated_at: isoNow(),
      };
      (stagingByVertical[vertical] ??= []).push(stagingRow);
    } catch (err) {
      errors++;
      ledger.push({
        sync_type: "object_intake", target_database: null,
        sf_object_type: objectType, sf_object_id: (record?.Id as string) ?? null,
        import_batch: batchId, payload: record, status: "error",
        error_message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // one batched write to the central ledger
  if (ledger.length) await ledgerRows(ledger);

  // one batched upsert per vertical (idempotent on the dedup unique index)
  const byVertical: Record<string, number> = {};
  for (const [vertical, rows] of Object.entries(stagingByVertical)) {
    const onConflict = `${cfg.sfIdColumn},source_system,import_batch`;
    const result = await dbFetch(
      vertical as Vertical, "POST",
      `${cfg.stagingTable}?on_conflict=${onConflict}`,
      rows, "resolution=merge-duplicates,return=minimal",
    );
    byVertical[vertical] = result.ok ? rows.length : 0;
    if (!result.ok) {
      errors += rows.length;
      await ledgerRows([{
        sync_type: "object_intake", target_database: vertical,
        sf_object_type: objectType, import_batch: batchId,
        payload: { staging_table: cfg.stagingTable, count: rows.length },
        status: "error",
        error_message: `staging upsert failed: ${JSON.stringify(result.data)}`,
      }]);
    }
  }

  return jsonResponse(req, {
    ok: errors === 0,
    batch_id: batchId,
    object_type: objectType,
    object_key: objectKey,
    received: records.length,
    staged: Object.values(byVertical).reduce((a, b) => a + b, 0),
    errors,
    by_vertical: byVertical,
  });
}

// ── POST ?action=crawl-complete ─────────────────────────────────────────────
async function handleCrawlComplete(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  if (!body) return errorResponse(req, "Missing JSON body", 400);
  const batchId = String(body.batch_id || "");
  if (!batchId) return errorResponse(req, "batch_id is required", 400);
  const failures = Array.isArray(body.failures) ? body.failures : [];

  // close the batch — this crawl_run row is the watermark store
  await ledgerRows([{
    sync_type: "crawl_run",
    sf_object_id: batchId,
    import_batch: batchId,
    payload: body,
    status: failures.length ? "error" : "ok",
  }]);

  // run the address link-probe for everything staged under this batch
  const probe: Record<string, unknown> = {};
  for (const vertical of ["dia", "gov"] as Vertical[]) {
    for (const [objectKey, cfg] of Object.entries(OBJECT_CONFIG)) {
      const linked = await linkProbe(vertical, cfg.stagingTable, batchId);
      if (linked.scanned > 0) probe[`${vertical}.${objectKey}`] = linked;
    }
  }

  return jsonResponse(req, { ok: true, batch_id: batchId, link_probe: probe });
}

// Match this batch's staged rows to properties by normalized address.
// Conservative: exact normalized match within the same city/state -> linked;
// otherwise process_status='review'. No fuzzy promotion here.
async function linkProbe(vertical: Vertical, table: string, batchId: string) {
  const stats = { scanned: 0, linked: 0, review: 0 };
  const staged = await dbFetch(
    vertical, "GET",
    `${table}?import_batch=eq.${encodeURIComponent(batchId)}&linked_property_id=is.null` +
    `&select=staging_id,normalized_address,city,state`,
  );
  const rows = Array.isArray(staged.data) ? staged.data as Record<string, unknown>[] : [];
  if (!rows.length) return stats;
  stats.scanned = rows.length;

  // index properties for the city/state pairs present in this batch
  const pairs = new Set(rows.filter((r) => r.city && r.state).map((r) => `${r.city}|${r.state}`));
  const index: Record<string, Record<string, unknown>> = {};
  for (const pair of pairs) {
    const [city, state] = pair.split("|");
    const props = await dbFetch(
      vertical, "GET",
      `properties?city=ilike.${encodeURIComponent(city)}&state=ilike.${encodeURIComponent(state)}` +
      `&select=property_id,address`,
    );
    const bucket: Record<string, unknown> = {};
    for (const p of (Array.isArray(props.data) ? props.data : []) as Record<string, unknown>[]) {
      const n = normalizeAddress(p.address as string);
      if (n) bucket[n] = p.property_id;
    }
    index[pair] = bucket;
  }

  for (const r of rows) {
    const norm = r.normalized_address as string | null;
    const bucket = index[`${r.city}|${r.state}`] || {};
    let matchId: unknown = null;
    if (norm) {
      for (const [pn, pid] of Object.entries(bucket)) {
        if (pn === norm || norm.includes(pn) || pn.includes(norm)) { matchId = pid; break; }
      }
    }
    const update = matchId
      ? { linked_property_id: matchId, match_method: "normalized_address", match_confidence: 0.9,
          process_status: "linked", processed: true, processed_at: isoNow(), updated_at: isoNow() }
      : { match_method: "review", process_status: "review",
          process_notes: "no confident property match", updated_at: isoNow() };
    await dbFetch(vertical, "PATCH", `${table}?staging_id=eq.${r.staging_id}`, update);
    if (matchId) stats.linked++; else stats.review++;
  }
  return stats;
}

// ── GET ?action=watermark ───────────────────────────────────────────────────
async function handleWatermark(req: Request): Promise<Response> {
  const res = await dbFetch(
    "ops", "GET",
    "sf_sync_log?sync_type=eq.crawl_run&status=eq.ok&order=created_at.desc&limit=1&select=created_at",
  );
  const rows = Array.isArray(res.data) ? res.data as Record<string, unknown>[] : [];
  const watermark = rows.length ? String(rows[0].created_at).slice(0, 10) : null;
  return jsonResponse(req, { watermark });
}

// ── GET ?action=file-targets ────────────────────────────────────────────────
// Returns the staged Salesforce ids Flow 2 should walk for ContentDocumentLink.
async function handleFileTargets(req: Request, params: URLSearchParams): Promise<Response> {
  const limit = Math.min(parseInt(params.get("limit") || "1000", 10), 5000);
  const wantVertical = params.get("vertical");
  const targets: Record<string, Record<string, string[]>> = {};

  for (const vertical of ["dia", "gov"] as Vertical[]) {
    if (wantVertical && wantVertical !== vertical) continue;
    targets[vertical] = {};
    for (const [objectKey, cfg] of Object.entries(OBJECT_CONFIG)) {
      const res = await dbFetch(
        vertical, "GET",
        `${cfg.stagingTable}?processed=eq.false&select=${cfg.sfIdColumn}&limit=${limit}`,
      );
      const rows = Array.isArray(res.data) ? res.data as Record<string, unknown>[] : [];
      targets[vertical][objectKey] = rows
        .map((r) => r[cfg.sfIdColumn] as string).filter(Boolean);
    }
  }
  return jsonResponse(req, { targets });
}

// ── GET ?action=retry-queue ─────────────────────────────────────────────────
async function handleRetryQueue(req: Request): Promise<Response> {
  const res = await dbFetch(
    "ops", "GET",
    `sf_sync_log?status=eq.error&retry_count=lt.${MAX_RETRY}&order=created_at.asc&limit=200` +
    "&select=sync_id,sync_type,target_database,sf_object_type,sf_object_id,import_batch,payload,retry_count,error_message",
  );
  const items = Array.isArray(res.data) ? res.data : [];
  return jsonResponse(req, { items, count: Array.isArray(items) ? items.length : 0 });
}

// ── POST ?action=retry ──────────────────────────────────────────────────────
// body: { limit? }
// Drains sf_sync_log error rows (retry_count < MAX_RETRY): re-maps and re-stages
// each from its stored SF-record payload. On success the ledger row flips to
// 'ok'; on repeated failure retry_count increments and the row is dead-lettered
// once it reaches MAX_RETRY. One server-side action that supersedes the manual
// retry-queue (read) + dead-letter (write) pair.
async function handleRetry(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  const b = body || {};
  const limit = Math.min(Number(b.limit) || 100, 200);

  const res = await dbFetch(
    "ops", "GET",
    `sf_sync_log?status=eq.error&retry_count=lt.${MAX_RETRY}&order=created_at.asc&limit=${limit}` +
    "&select=sync_id,sync_type,sf_object_type,sf_object_id,import_batch,payload,retry_count",
  );
  const items = (Array.isArray(res.data) ? res.data : []) as Record<string, unknown>[];
  const stats = { scanned: items.length, retried_ok: 0, still_error: 0, dead_lettered: 0, skipped: 0 };

  for (const item of items) {
    const syncId = String(item.sync_id);
    const objectType = String(item.sf_object_type || "");
    const batchId = String(item.import_batch || "");
    const payload = item.payload as Record<string, unknown> | null;
    const nextRetries = (Number(item.retry_count) || 0) + 1;

    // Only object_intake rows carrying a real SF record (has an Id) are
    // retryable — staging-upsert-failure markers ({staging_table,count}) are
    // skipped and left for manual attention.
    const objectKey = resolveObjectKey(objectType);
    if (item.sync_type !== "object_intake" || !objectKey || !payload || !payload.Id) {
      stats.skipped++;
      continue;
    }

    let ok = false;
    let errMsg = "";
    try {
      const mapped = await mapRecord(objectKey, payload);
      const { vertical, resolved } = routeVertical(mapped.row);
      const cfg = OBJECT_CONFIG[objectKey];
      const stagingRow = {
        ...mapped.row,
        source_system: "salesforce",
        import_batch: batchId,
        process_status: resolved ? "pending" : "review",
        process_notes: resolved ? null : "vertical routing unresolved — defaulted to dia",
        match_method: resolved ? null : "vertical_unresolved",
        imported_at: isoNow(),
        updated_at: isoNow(),
      };
      const onConflict = `${cfg.sfIdColumn},source_system,import_batch`;
      const up = await dbFetch(
        vertical, "POST",
        `${cfg.stagingTable}?on_conflict=${onConflict}`,
        [stagingRow], "resolution=merge-duplicates,return=minimal",
      );
      ok = up.ok;
      if (!ok) errMsg = `staging upsert failed: ${JSON.stringify(up.data)}`;
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
    }

    if (ok) {
      await dbFetch("ops", "PATCH", `sf_sync_log?sync_id=eq.${syncId}`, {
        status: "ok", retry_count: nextRetries, retried_at: isoNow(), error_message: null,
      });
      stats.retried_ok++;
    } else if (nextRetries >= MAX_RETRY) {
      await dbFetch("ops", "PATCH", `sf_sync_log?sync_id=eq.${syncId}`, {
        status: "dead", retry_count: nextRetries, retried_at: isoNow(),
        error_message: `retry exhausted: ${errMsg}`.slice(0, 500),
      });
      stats.dead_lettered++;
    } else {
      await dbFetch("ops", "PATCH", `sf_sync_log?sync_id=eq.${syncId}`, {
        status: "error", retry_count: nextRetries, retried_at: isoNow(),
        error_message: errMsg.slice(0, 500),
      });
      stats.still_error++;
    }
  }

  return jsonResponse(req, { ok: true, ...stats });
}

// ── POST ?action=dead-letter ────────────────────────────────────────────────
async function handleDeadLetter(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  const ids = Array.isArray(body?.sync_ids) ? body!.sync_ids as string[] : [];
  if (!ids.length) return errorResponse(req, "sync_ids[] is required", 400);
  const inList = ids.map((i) => `"${i}"`).join(",");
  const res = await dbFetch(
    "ops", "PATCH",
    `sf_sync_log?sync_id=in.(${inList})`,
    { status: "dead", retried_at: isoNow() },
  );
  return jsonResponse(req, { ok: res.ok, dead_lettered: res.ok ? ids.length : 0 });
}
