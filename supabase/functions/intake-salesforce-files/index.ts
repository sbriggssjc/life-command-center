// ============================================================================
// intake-salesforce-files — Salesforce file intake for the SF -> LCC bridge
// Life Command Center
//
// TRANSPORT DOCTRINE (SALESFORCE_LCC_INGESTION_PLAN.md §2): the Northmarq org is
// SSO-gated and CANNOT provision a Salesforce Connected App (no admin). ALL
// Salesforce access therefore flows through Power Automate — a PA flow holds the
// interactive-SSO SF connection, reads Salesforce, and POSTs to the webhook
// actions below under X-PA-Webhook-Secret. PA is transport only; it never writes
// a domain table. The server-side Connected-App sweep (?action=discover / =fetch)
// is RETIRED (W3.7c) — see the tombstone below.
//
// Routes:
//   GET  ?action=discovery-worklist — W3.7c: return a batch of staged Comp/Listing/
//                                Deal SF ids (both domains) that have NO sf_files row
//                                and no discovery attempt in N days; stamps each served
//                                id as attempted (lease). This is what the PA File-
//                                Discovery flow pulls.
//   POST ?action=discover-webhook — W3.7c: accept PA's array of read-from-Salesforce
//                                file metadata → insert sf_files 'discovered' rows via
//                                the shared discovery dedup logic (content_version_id).
//   POST ?action=file-content  — W3.7c: accept one file's base64 bytes → store to the
//                                salesforce-files bucket, verify sha256 + size cap,
//                                flip the row to stored/queued (idempotent on
//                                content_version_id) → feeds ?action=stage-queued.
//   POST ?action=manifest      — record discovered files, return the to-fetch list
//   POST ?action=upload-url    — mint a Storage signed-upload URL for one file
//   POST ?action=bytes         — store one file's bytes, finalize + enqueue extraction
//   POST ?action=retry-files   — return stuck (discovered/failed) files as a to-fetch list
//   POST ?action=stage-queued  — drain sf_files at extraction_status:"queued" through
//                                LCC's /api/intake/stage-om pipeline (real OM extraction +
//                                property matching). Marks rows extraction_status:"extracted"
//                                with intake_id in process_notes.
//   POST ?action=discover      — RETIRED (410). Connected-App sweep; use the PA-collector
//                                worklist + discover-webhook above.
//   POST ?action=fetch         — RETIRED (410). Connected-App byte mover; use file-content.
//   GET  (no action)           — info
// ============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authenticateWebhook } from "../_shared/auth.ts";
import { queryParams, parseBody, isoNow } from "../_shared/utils.ts";
import {
  WORKLIST_OBJECTS, DEFAULT_WORKLIST_STALE_DAYS, staleCutoffIso, makeWorklistItem,
  mapDiscoveredFileToRow, filterNewVersions, fileContentDecision,
  sanitizeSfId, chunk, traversalColumnForType, normalizeVertical,
  CDL_ID_CHUNK, type WorklistItem, type DiscoverWebhookFile,
} from "./discovery.ts";

const PAYLOAD_VERSION = "sf-files-2026-07-v7";
const BUCKET = "salesforce-files";
const MAX_INLINE_BYTES = 6 * 1024 * 1024;
// W3.7c ?action=file-content byte cap. OMs are ~6-9MB; the stage-queued drain
// caps at 15MB, so files past this must ride ?action=upload-url + a bucket upload
// (large-file lane in the flow spec) rather than a base64 body.
const FILE_CONTENT_MAX_BYTES = 15 * 1024 * 1024;

type Vertical = "dia" | "gov" | "ops";

// ── vertical auto-routing ───────────────────────────────────────────────────
const DIA_SIGNALS = ["dialysis", "davita", "fresenius", "renal", "kidney", "clinic", "nephrology"];
const GOV_SIGNALS = ["gsa", "federal", "government", "u.s.", "department of", "veterans", "social security"];

function routeFileVertical(f: Record<string, unknown>): Vertical {
  const explicit = String(f.vertical || "").toLowerCase();
  if (explicit === "dia" || explicit === "gov" || explicit === "ops") return explicit as Vertical;
  const hay = [
    f.linked_entity_tenant, f.linked_entity_property_type, f.linked_entity_name, f.title, f.file_name,
  ].filter((v) => v).join(" ").toLowerCase();
  if (DIA_SIGNALS.some((s) => hay.includes(s))) return "dia";
  if (GOV_SIGNALS.some((s) => hay.includes(s))) return "gov";
  return "dia";
}

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

async function dbFetch(vertical: Vertical, method: string, path: string, body?: unknown, prefer = "return=minimal"): Promise<{ ok: boolean; status: number; data: unknown }> {
  const env = dbEnv(vertical);
  if (!env) return { ok: false, status: 503, data: { error: `${vertical} DB not configured` } };
  const res = await fetch(`${env.url}/rest/v1/${path}`, {
    method,
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json", Prefer: method === "GET" ? "count=exact" : prefer },
    body: body && method !== "GET" ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function storageUpload(vertical: Vertical, path: string, bytes: Uint8Array, contentType: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const env = dbEnv(vertical);
  if (!env) return { ok: false, status: 503, error: `${vertical} not configured` };
  const res = await fetch(`${env.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": contentType || "application/octet-stream", "x-upsert": "true" },
    body: bytes,
  });
  if (res.ok) return { ok: true, status: res.status };
  return { ok: false, status: res.status, error: await res.text() };
}

// ── Salesforce Connected-App path — RETIRED (W3.7c, 2026-07-31) ─────────────
// The org is SSO-gated and cannot provision a Connected App (no admin;
// SALESFORCE_LCC_INGESTION_PLAN.md §2 — a client-credentials login returns
// INVALID_SSO_GATEWAY_URL). The former getSfToken()/sfQuery()/sfDownloadBytes()
// read SF_INSTANCE_URL / SF_CLIENT_ID / SF_CLIENT_SECRET, which would surface as
// dormant capability flags that can NEVER turn on. They are DELETED so nothing
// reads those env vars. Salesforce reads now flow exclusively through Power
// Automate → ?action=discovery-worklist + ?action=discover-webhook +
// ?action=file-content. Do NOT re-introduce SF_CLIENT_ID/SF_CLIENT_SECRET or a
// Connected-App token flow — see the STANDING ARCHITECTURE RULE in
// docs/audits/ROLLOUT_STATUS.md (2026-07-31 correction).

// ── helpers ─────────────────────────────────────────────────────────────────
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeName(name: string): string {
  return (name || "file").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

function storagePath(row: Record<string, unknown>): string {
  const parts = [
    "salesforce",
    String(row.linked_entity_type || "unknown"),
    String(row.linked_entity_sf_id || "unknown"),
    String(row.content_document_id || "doc"),
    String(row.content_version_id || "ver"),
    safeName(String(row.file_name || row.title || "file")),
  ];
  return parts.map((p) => encodeURIComponent(p)).join("/");
}

function bytesToBase64(bytes: Uint8Array): string {
  // Allocation-friendly: build an array of per-chunk strings and join once at
  // the end rather than `binary += ...` (which reallocates an ever-growing
  // string for every chunk — a 6-9MB PDF would churn ~200 reallocations and
  // pin double the bytes in memory mid-loop). Array-of-chunks + a single join
  // keeps peak allocation bounded.
  const CHUNK = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(chunks.join(""));
}

// ── main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const params = queryParams(req);
  const action = params.get("action");

  if (req.method === "GET" && !action) {
    return jsonResponse(req, {
      service: "intake-salesforce-files",
      version: PAYLOAD_VERSION,
      transport: "power-automate-only (Connected-App path retired W3.7c)",
      actions: [
        "discovery-worklist (GET)", "discover-webhook", "file-content",
        "manifest", "upload-url", "bytes", "retry-files", "stage-queued",
      ],
      retired: ["discover", "fetch"],
    });
  }

  if (!authenticateWebhook(req)) {
    return errorResponse(req, "Unauthorized — missing or invalid X-PA-Webhook-Secret", 401);
  }

  try {
    // W3.7c: the PA File-Discovery flow GETs its worklist.
    if (req.method === "GET" && action === "discovery-worklist") {
      return await handleDiscoveryWorklist(req);
    }
    if (req.method !== "POST") return errorResponse(req, `Method ${req.method} not allowed`, 405);
    const body = (await parseBody(req)) as Record<string, unknown> | null;
    if (action === "discover-webhook") return await handleDiscoverWebhook(req, body);
    if (action === "file-content") return await handleFileContent(req, body);
    if (action === "manifest") return await handleManifest(req, body);
    if (action === "upload-url") return await handleUploadUrl(req, body);
    if (action === "bytes") return await handleBytes(req, body);
    if (action === "retry-files") return await handleRetryFiles(req, body);
    if (action === "stage-queued") return await handleStageQueued(req, body);
    // W3.7c: the Connected-App sweep + byte mover are retired — the org can't
    // provision a Connected App, so these can never work. Answer 410 with the
    // PA-collector replacement rather than a silent no-op.
    if (action === "discover" || action === "fetch") {
      return jsonResponse(req, {
        ok: false, retired: true, action,
        replacement: action === "discover"
          ? ["GET ?action=discovery-worklist", "POST ?action=discover-webhook"]
          : ["POST ?action=file-content"],
        reason: "Salesforce Connected-App path retired (org is SSO-gated, no admin). " +
          "Salesforce access flows through Power Automate only — see SALESFORCE_LCC_INGESTION_PLAN.md §2.",
      }, 410);
    }
    return errorResponse(req, `Unknown POST action: ${action}`, 400);
  } catch (err) {
    console.error("[intake-salesforce-files]", err);
    return errorResponse(req, `Internal error: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});

// ── POST ?action=manifest ───────────────────────────────────────────────────
async function handleManifest(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  if (!body) return errorResponse(req, "Missing JSON body", 400);
  const batchId = String(body.batch_id || "");
  const files = Array.isArray(body.files) ? body.files as Record<string, unknown>[] : null;
  if (!batchId) return errorResponse(req, "batch_id is required", 400);
  if (!files) return errorResponse(req, "files[] is required", 400);

  const byVertical: Record<string, Record<string, unknown>[]> = {};
  for (const f of files) {
    const v = routeFileVertical(f);
    (byVertical[v] ??= []).push(f);
  }

  const toFetch: Record<string, unknown>[] = [];
  const insertErrors: string[] = [];
  let discovered = 0, errors = 0;

  for (const [vertical, vFiles] of Object.entries(byVertical)) {
    const cvids = vFiles.map((f) => f.content_version_id).filter(Boolean) as string[];
    if (!cvids.length) continue;

    const inList = cvids.map((c) => `"${c}"`).join(",");
    const existing = await dbFetch(vertical as Vertical, "GET",
      `sf_files?content_version_id=in.(${inList})&select=content_version_id,ingestion_status`);
    const statusByCvid: Record<string, string> = {};
    for (const r of (Array.isArray(existing.data) ? existing.data : []) as Record<string, unknown>[]) {
      statusByCvid[String(r.content_version_id)] = String(r.ingestion_status);
    }

    const newRows = vFiles.filter((f) => !(String(f.content_version_id) in statusByCvid)).map((f) => {
      const row: Record<string, unknown> = {
        content_document_id: f.content_document_id ?? null,
        content_version_id: f.content_version_id ?? null,
        linked_entity_type: f.linked_entity_type ?? null,
        linked_entity_sf_id: f.linked_entity_sf_id ?? null,
        title: f.title ?? null,
        file_name: f.file_name ?? null,
        extension: f.extension ?? null,
        version_number: f.version_number ?? null,
        size_bytes: f.size_bytes ?? null,
        sf_download_url: f.sf_download_url ?? null,
        source_system: "salesforce",
        import_batch: batchId,
        ingestion_status: "discovered",
        extraction_status: "pending",
        discovered_at: isoNow(),
        updated_at: isoNow(),
      };
      // W3.7b: stamp the traversal convenience column (sf_comp_id/sf_listing_id/
      // sf_deal_id) so a manifest-discovered Listing/Deal file is reachable the
      // same way a server-discovered one is.
      const col = traversalColumnForType(String(f.linked_entity_type || ""));
      if (col) row[col] = f.linked_entity_sf_id ?? null;
      return row;
    });

    if (newRows.length) {
      const res = await dbFetch(vertical as Vertical, "POST", `sf_files`, newRows, "return=minimal");
      if (res.ok) discovered += newRows.length;
      else {
        errors += newRows.length;
        const errMsg = `${vertical}: status=${res.status} data=${JSON.stringify(res.data).slice(0,200)}`;
        insertErrors.push(errMsg);
        console.error("[intake-salesforce-files] manifest insert failed", errMsg);
      }
    }

    for (const f of vFiles) {
      const cur = statusByCvid[String(f.content_version_id)];
      if (cur !== "stored") toFetch.push({ ...f, vertical });
    }
  }

  return jsonResponse(req, {
    ok: errors === 0,
    batch_id: batchId,
    received: files.length,
    discovered, errors,
    insert_errors: insertErrors.length ? insertErrors : undefined,
    to_fetch: toFetch,
  });
}

// ── POST ?action=upload-url ─────────────────────────────────────────────────
async function handleUploadUrl(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  if (!body) return errorResponse(req, "Missing JSON body", 400);
  const vertical = String(body.vertical || "dia") as Vertical;
  const cvid = String(body.content_version_id || "");
  if (!cvid) return errorResponse(req, "content_version_id is required", 400);
  const env = dbEnv(vertical);
  if (!env) return errorResponse(req, `${vertical} DB not configured`, 503);

  const lookup = await dbFetch(vertical, "GET",
    `sf_files?content_version_id=eq.${encodeURIComponent(cvid)}&source_system=eq.salesforce&select=file_id,content_document_id,content_version_id,linked_entity_type,linked_entity_sf_id,title,file_name&limit=1`);
  const rows = Array.isArray(lookup.data) ? lookup.data as Record<string, unknown>[] : [];
  if (!rows.length) return errorResponse(req, `No sf_files row for content_version_id ${cvid}`, 404);
  const objectPath = storagePath(rows[0]);

  // Idempotency: delete existing object first so signed-upload URL minting doesn't fail.
  await fetch(`${env.url}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: "DELETE",
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
  }).catch(() => {});

  const signEndpoint = `${env.url}/storage/v1/object/upload/sign/${BUCKET}/${objectPath}`;
  const signRes = await fetch(signEndpoint, {
    method: "POST",
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  const signText = await signRes.text();
  let signJson: Record<string, unknown> | null = null;
  try { signJson = signText ? JSON.parse(signText) : null; } catch {}
  if (!signRes.ok || !signJson?.url) return errorResponse(req, `Signed-URL mint failed: ${String(signJson?.message || signJson?.error || signText || "no data").slice(0, 300)}`, signRes.status || 500);

  const uploadUrl = `${env.url}/storage/v1${signJson.url}`;
  return jsonResponse(req, {
    ok: true, content_version_id: cvid, vertical, storage_path: objectPath,
    upload_url: uploadUrl, upload_method: "PUT", upload_headers: { "x-upsert": "true" },
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
  });
}

// ── POST ?action=bytes ──────────────────────────────────────────────────────
async function handleBytes(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  if (!body) return errorResponse(req, "Missing JSON body", 400);
  const vertical = String(body.vertical || "dia") as Vertical;
  const cvid = String(body.content_version_id || "");
  if (!cvid) return errorResponse(req, "content_version_id is required", 400);

  const lookup = await dbFetch(vertical, "GET",
    `sf_files?content_version_id=eq.${encodeURIComponent(cvid)}&source_system=eq.salesforce&select=file_id,content_document_id,content_version_id,linked_entity_type,linked_entity_sf_id,title,file_name&limit=1`);
  const rows = Array.isArray(lookup.data) ? lookup.data as Record<string, unknown>[] : [];
  if (!rows.length) return errorResponse(req, `No sf_files row for content_version_id ${cvid}`, 404);
  const row = rows[0];

  let path: string | null = null;
  let sha: string | null = null;
  let size: number | null = null;

  if (typeof body.file_base64 === "string" && body.file_base64) {
    const bytes = b64ToBytes(body.file_base64);
    if (bytes.byteLength > MAX_INLINE_BYTES) return errorResponse(req, `Inline file exceeds ${MAX_INLINE_BYTES} bytes`, 413);
    sha = await sha256Hex(bytes);
    size = bytes.byteLength;
    path = storagePath(row);
    const up = await storageUpload(vertical, path, bytes, String(body.mime_type || "application/octet-stream"));
    if (!up.ok) {
      await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${row.file_id}`, {
        ingestion_status: "failed", process_notes: `storage upload failed: ${up.error}`, updated_at: isoNow(),
      });
      return errorResponse(req, `Storage upload failed: ${up.error}`, up.status || 500);
    }
  } else if (typeof body.storage_path === "string" && body.storage_path) {
    path = String(body.storage_path);
    sha = (body.sha256 as string) ?? null;
    size = (body.size_bytes as number) ?? null;
  } else {
    return errorResponse(req, "Provide either file_base64 or storage_path", 400);
  }

  const patch = await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${row.file_id}`, {
    ingestion_status: "stored", extraction_status: "queued",
    storage_path: path, sha256: sha, size_bytes: size,
    stored_at: isoNow(), updated_at: isoNow(),
  });

  return jsonResponse(req, {
    ok: patch.ok, content_version_id: cvid, file_id: row.file_id,
    storage_path: path, sha256: sha, extraction_status: "queued",
  });
}

// ── POST ?action=retry-files ────────────────────────────────────────────────
async function handleRetryFiles(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  const b = body || {};
  const limit = Math.min(Number(b.limit) || 50, 200);
  const verticals: Vertical[] = b.vertical ? [String(b.vertical) as Vertical] : ["dia", "gov"];
  const toFetch: Record<string, unknown>[] = [];
  const report: Record<string, number> = {};
  for (const vertical of verticals) {
    const res = await dbFetch(vertical, "GET",
      `sf_files?source_system=eq.salesforce&ingestion_status=in.(discovered,failed)` +
      `&select=content_version_id,content_document_id,linked_entity_type,linked_entity_sf_id,title,file_name,extension,version_number,size_bytes,sf_download_url,ingestion_status` +
      `&limit=${limit}`);
    const rows = Array.isArray(res.data) ? res.data as Record<string, unknown>[] : [];
    for (const r of rows) toFetch.push({ vertical, ...r });
    report[vertical] = rows.length;
  }
  return jsonResponse(req, { ok: true, count: toFetch.length, by_vertical: report, to_fetch: toFetch });
}

// ── GET ?action=discovery-worklist ──────────────────────────────────────────
// W3.7c PA-collector, step 1. Returns a batch of staged Comp/Listing/Deal SF ids
// (both domains) that (a) have NO sf_files row yet and (b) have not been attempted
// in `stale_days` days. Every id it serves is STAMPED last_file_discovery_at=now()
// (the lease) so an id that yields no files isn't re-served every run. The PA File-
// Discovery flow pulls this, then reads each id's ContentDocumentLinks/ContentVersion
// via its SSO Salesforce connection and POSTs back to ?action=discover-webhook.
//
// query: ?limit=<total, default 200, cap 1000>&stale_days=<default 7>
//        &vertical=<dia|gov optional>&object_types=<comp,listing,deal optional csv>
async function handleDiscoveryWorklist(req: Request): Promise<Response> {
  const params = queryParams(req);
  const limit = Math.min(Math.max(Number(params.get("limit")) || 200, 1), 1000);
  const staleDays = Number(params.get("stale_days"));
  const cutoff = staleCutoffIso(Date.now(), Number.isFinite(staleDays) ? staleDays : DEFAULT_WORKLIST_STALE_DAYS);
  const vParam = normalizeVertical(params.get("vertical"));
  const verticals: Vertical[] = vParam ? [vParam] : ["gov", "dia"];
  const otParam = (params.get("object_types") || "").toLowerCase();
  const wantKeys = otParam ? new Set(otParam.split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const objects = WORKLIST_OBJECTS.filter((o) => !wantKeys || wantKeys.has(o.key));

  const nowIso = isoNow();
  const worklist: WorklistItem[] = [];
  const byVertical: Record<string, unknown> = {};
  // Split the batch budget across the requested domains so neither starves.
  const perVerticalBudget = Math.ceil(limit / verticals.length);

  for (const vertical of verticals) {
    const vReport: Record<string, unknown> = { by_object: {}, served: 0 };
    const env = dbEnv(vertical);
    if (!env) { vReport.error = `${vertical} DB not configured`; byVertical[vertical] = vReport; continue; }
    let vBudget = perVerticalBudget;

    for (const obj of objects) {
      const oStats = { candidates: 0, with_files: 0, served: 0 };
      if (vBudget <= 0) { (vReport.by_object as Record<string, unknown>)[obj.key] = oStats; continue; }

      // 1. staging ids not attempted within the lease window (null or stale).
      //    Over-fetch past the budget so file-covered ids can be filtered out
      //    and still leave a full budget of fresh ids. PostgREST caps at 1000.
      const fetchLimit = Math.min(vBudget + 300, 1000);
      const orFilter = `or=(last_file_discovery_at.is.null,last_file_discovery_at.lt.${encodeURIComponent(cutoff)})`;
      const cand = await dbFetch(vertical, "GET",
        `${obj.stagingTable}?select=${obj.sfIdColumn}&${obj.sfIdColumn}=not.is.null&${orFilter}` +
        `&order=last_file_discovery_at.asc.nullsfirst&limit=${fetchLimit}`);
      const candIds = [...new Set(
        (Array.isArray(cand.data) ? cand.data as Record<string, unknown>[] : [])
          .map((r) => sanitizeSfId(r[obj.sfIdColumn])).filter(Boolean) as string[],
      )];
      oStats.candidates = candIds.length;
      if (!candIds.length) { (vReport.by_object as Record<string, unknown>)[obj.key] = oStats; continue; }

      // 2. which of these already have an sf_files row (traversal col OR linked id).
      const withFiles = new Set<string>();
      for (const ids of chunk(candIds, CDL_ID_CHUNK)) {
        const inList = ids.map((c) => `"${c}"`).join(",");
        const ex = await dbFetch(vertical, "GET",
          `sf_files?select=${obj.traversalColumn},linked_entity_sf_id` +
          `&or=(${obj.traversalColumn}.in.(${inList}),linked_entity_sf_id.in.(${inList}))`);
        for (const r of (Array.isArray(ex.data) ? ex.data : []) as Record<string, unknown>[]) {
          const t = r[obj.traversalColumn]; if (t) withFiles.add(String(t));
          const l = r.linked_entity_sf_id; if (l) withFiles.add(String(l));
        }
      }
      oStats.with_files = candIds.filter((id) => withFiles.has(id)).length;

      // 3. serve the file-less ids, up to the remaining budget.
      const served = candIds.filter((id) => !withFiles.has(id)).slice(0, vBudget);
      if (!served.length) { (vReport.by_object as Record<string, unknown>)[obj.key] = oStats; continue; }

      // 4. STAMP the lease on served ids so they aren't re-served for stale_days
      //    even if PA finds no files for them.
      for (const ids of chunk(served, CDL_ID_CHUNK)) {
        const inList = ids.map((c) => `"${c}"`).join(",");
        await dbFetch(vertical, "PATCH",
          `${obj.stagingTable}?${obj.sfIdColumn}=in.(${inList})`,
          { last_file_discovery_at: nowIso });
      }

      for (const id of served) worklist.push(makeWorklistItem(vertical, obj, id));
      oStats.served = served.length;
      vBudget -= served.length;
      (vReport.served as number) += served.length;
      (vReport.by_object as Record<string, unknown>)[obj.key] = oStats;
    }
    byVertical[vertical] = vReport;
  }

  return jsonResponse(req, {
    ok: true, mode: "discovery-worklist",
    generated_at: nowIso, stale_days: Number.isFinite(staleDays) ? staleDays : DEFAULT_WORKLIST_STALE_DAYS,
    limit, count: worklist.length, by_vertical: byVertical, worklist,
  });
}

// ── POST ?action=discover-webhook ────────────────────────────────────────────
// W3.7c PA-collector, step 2. Accepts the array of file metadata Power Automate
// read from Salesforce (ContentDocumentLink → latest ContentVersion) for the
// worklist ids, and records new files into sf_files (ingestion_status='discovered')
// via the SHARED discovery dedup logic (mapDiscoveredFileToRow + filterNewVersions,
// keyed on content_version_id). Same insert path the retired server-side sweep used
// — only the transport (PA vs Connected App) changed.
//
// body: {
//   vertical?: 'dia'|'gov',           // batch default; per-file override honored
//   batch_id?: string,
//   files: [{ linked_entity_type, linked_entity_id, content_document_id,
//             content_version_id, title, file_name, extension, version_number,
//             size_bytes, vertical? }]
// }
async function handleDiscoverWebhook(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  if (!body) return errorResponse(req, "Missing JSON body", 400);
  const files = Array.isArray(body.files) ? body.files as DiscoverWebhookFile[] : null;
  if (!files) return errorResponse(req, "files[] is required", 400);
  const batchId = String(body.batch_id || `discover-webhook-${isoNow()}`);
  const bodyVertical = normalizeVertical(body.vertical);

  // Route each file to its vertical, then map → dedup → insert per vertical.
  const byVerticalRows: Record<Vertical, Record<string, unknown>[]> = { dia: [], gov: [], ops: [] };
  let skippedInvalid = 0;
  for (const f of files) {
    const v = normalizeVertical(f.vertical) || bodyVertical || routeFileVertical(f as Record<string, unknown>);
    const vert: Vertical = (v === "gov" || v === "dia") ? v : "dia";
    const row = mapDiscoveredFileToRow({ file: f, batchId, nowIso: isoNow() });
    if (!row) { skippedInvalid++; continue; }
    byVerticalRows[vert].push(row);
  }

  const report: Record<string, unknown> = {};
  let discovered = 0, skippedExisting = 0, errors = 0;
  const insertErrors: string[] = [];

  for (const vertical of ["gov", "dia"] as Vertical[]) {
    const rows = byVerticalRows[vertical];
    const vStats = { candidates: rows.length, discovered: 0, skipped_existing: 0, errors: 0 };
    if (!rows.length) { report[vertical] = vStats; continue; }

    // Dedup vs existing sf_files.content_version_id in this DB.
    const cvids = rows.map((r) => String(r.content_version_id)).filter(Boolean);
    const existing = new Set<string>();
    for (const ids of chunk([...new Set(cvids)], CDL_ID_CHUNK)) {
      const inList = ids.map((c) => `"${c}"`).join(",");
      const ex = await dbFetch(vertical, "GET",
        `sf_files?content_version_id=in.(${inList})&select=content_version_id`);
      for (const r of (Array.isArray(ex.data) ? ex.data : []) as Record<string, unknown>[]) {
        existing.add(String(r.content_version_id));
      }
    }
    const fresh = filterNewVersions(rows, existing);
    vStats.skipped_existing = rows.length - fresh.length;
    skippedExisting += vStats.skipped_existing;

    if (fresh.length) {
      const ins = await dbFetch(vertical, "POST", "sf_files", fresh, "return=minimal");
      if (ins.ok) { vStats.discovered = fresh.length; discovered += fresh.length; }
      else {
        vStats.errors = fresh.length; errors += fresh.length;
        const msg = `${vertical}: status=${ins.status} data=${JSON.stringify(ins.data).slice(0, 200)}`;
        insertErrors.push(msg);
        console.error("[intake-salesforce-files] discover-webhook insert failed", msg);
      }
    }
    report[vertical] = vStats;
  }

  return jsonResponse(req, {
    ok: errors === 0, mode: "discover-webhook", batch_id: batchId,
    received: files.length, discovered,
    skipped_existing: skippedExisting, skipped_invalid: skippedInvalid, errors,
    insert_errors: insertErrors.length ? insertErrors : undefined,
    by_vertical: report,
    note: "New files are ingestion_status='discovered'. POST ?action=file-content with " +
      "each new content_version_id's bytes to store + queue them for extraction.",
  });
}

// ── POST ?action=file-content ────────────────────────────────────────────────
// W3.7c PA-collector, step 3. Accepts one file's bytes (base64) keyed by
// content_version_id, verifies sha256 + a size cap, writes to the salesforce-files
// bucket, and flips the sf_files row to stored/queued — feeding the EXISTING
// ?action=stage-queued extraction path (no new engine). Idempotent on
// content_version_id: a row already stored is a no-op (never re-extracts).
//
// body: { vertical?, content_version_id, sha256?, file_base64 (| content | base64),
//         mime_type? }
async function handleFileContent(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  if (!body) return errorResponse(req, "Missing JSON body", 400);
  const cvid = sanitizeSfId(body.content_version_id);
  if (!cvid) return errorResponse(req, "content_version_id is required (valid SF id)", 400);
  const b64 = String(body.file_base64 || body.content || body.base64 || "");
  if (!b64) return errorResponse(req, "Provide file_base64 (base64 content)", 400);
  const providedSha = body.sha256 ? String(body.sha256) : null;

  // Resolve which DB holds the row (PA echoes vertical from the worklist; probe
  // both if absent). content_version_id is unique per source_system.
  const hint = normalizeVertical(body.vertical);
  const tryVerticals: Vertical[] = hint ? [hint] : ["gov", "dia"];
  let vertical: Vertical | null = null;
  let row: Record<string, unknown> | null = null;
  for (const v of tryVerticals) {
    const lookup = await dbFetch(v, "GET",
      `sf_files?content_version_id=eq.${encodeURIComponent(cvid)}&source_system=eq.salesforce` +
      `&select=file_id,content_document_id,content_version_id,linked_entity_type,linked_entity_sf_id,title,file_name,ingestion_status,extraction_status,sha256&limit=1`);
    const rows = Array.isArray(lookup.data) ? lookup.data as Record<string, unknown>[] : [];
    if (rows.length) { vertical = v; row = rows[0]; break; }
  }
  if (!row || !vertical) return errorResponse(req, `No sf_files row for content_version_id ${cvid}`, 404);

  // Idempotency: already stored → no-op (never reset an in-flight/extracted row).
  if (String(row.ingestion_status) === "stored") {
    return jsonResponse(req, {
      ok: true, idempotent: true, vertical, content_version_id: cvid, file_id: row.file_id,
      ingestion_status: "stored", extraction_status: row.extraction_status ?? null,
      note: "Row already stored — content-fetch is a no-op (idempotent on content_version_id).",
    });
  }

  // Decode + hash.
  let bytes: Uint8Array;
  try { bytes = b64ToBytes(b64); }
  catch { return errorResponse(req, "file_base64 is not valid base64", 400); }
  const computedSha = await sha256Hex(bytes);
  const decision = fileContentDecision({
    sizeBytes: bytes.byteLength, maxBytes: FILE_CONTENT_MAX_BYTES, providedSha, computedSha,
  }).verdict;
  if (decision === "empty") return errorResponse(req, "Decoded file is empty", 400);
  if (decision === "too_large") {
    const human = `${(bytes.byteLength / (1024 * 1024)).toFixed(1)}MB`;
    return errorResponse(req, `File ${human} exceeds the ${FILE_CONTENT_MAX_BYTES} byte cap — use ?action=upload-url + a bucket upload for large files`, 413);
  }
  if (decision === "sha_mismatch") {
    return errorResponse(req, `sha256 mismatch: provided ${providedSha}, computed ${computedSha}`, 422);
  }

  // Store to the bucket.
  const path = storagePath(row);
  const up = await storageUpload(vertical, path, bytes, String(body.mime_type || "application/octet-stream"));
  if (!up.ok) {
    await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${row.file_id}`, {
      ingestion_status: "failed", process_notes: `storage upload failed: ${up.error}`, updated_at: isoNow(),
    });
    return errorResponse(req, `Storage upload failed: ${up.error}`, up.status || 500);
  }

  // Flip to stored/queued — feeds the existing ?action=stage-queued drain.
  const patch = await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${row.file_id}`, {
    ingestion_status: "stored", extraction_status: "queued",
    storage_path: path, sha256: computedSha, size_bytes: bytes.byteLength,
    stored_at: isoNow(), updated_at: isoNow(),
  });

  return jsonResponse(req, {
    ok: patch.ok, idempotent: false, vertical, content_version_id: cvid, file_id: row.file_id,
    storage_path: path, sha256: computedSha, size_bytes: bytes.byteLength,
    extraction_status: "queued",
    note: "Stored to salesforce-files bucket; queued for extraction via ?action=stage-queued.",
  });
}

// ── POST ?action=stage-queued ───────────────────────────────────────────────
// Drains sf_files rows still at extraction_status='queued' through LCC's
// /api/intake/stage-om pipeline. For each row:
//   1. Download bytes from this DB's salesforce-files bucket
//   2. base64-encode (max 25MB per LCC cap; our PDFs are ~6-7MB)
//   3. POST to https://<LCC_BASE_URL>/api/intake/stage-om with X-LCC-Key
//   4. On success: PATCH → extraction_status='extracted', process_notes captures intake_id
//   5. On failure: PATCH → extraction_status='extract_failed' with error
// LCC's stage-om handler does: pdf-parse + AI classification + property matching.
const LCC_BASE_URL = Deno.env.get("LCC_BASE_URL") || "tranquil-delight-production-633f.up.railway.app";
const LCC_API_KEY = Deno.env.get("LCC_API_KEY") || "";

// Per-tick wall-clock budget. The edge function's CPU/wall budget is finite and
// each row is heavy (download 6-9MB PDF + base64 + a 5-30s LCC /stage-om call).
// We stop *starting* new rows once elapsed crosses this; an in-flight row always
// runs to completion so no row is ever left half-processed by the cutoff.
const STAGE_QUEUED_WALL_BUDGET_MS = 45_000;
// Files larger than this are skipped (marked extract_failed) rather than risk an
// OOM base64-encoding them in the edge function. ~15MB raw.
const STAGE_QUEUED_MAX_FILE_BYTES = 15 * 1024 * 1024;

async function handleStageQueued(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  if (!LCC_API_KEY) {
    return errorResponse(req, "LCC_API_KEY not configured — set it as an edge function secret", 503);
  }
  const b = body || {};
  // Default 3 rows/tick (was 10) — fits the wall budget even when several large
  // PDFs land in one tick. Body override honored, capped at 10 (was 50).
  const limit = Math.min(Number(b.limit) || 3, 10);
  const verticals: Vertical[] = b.vertical ? [String(b.vertical) as Vertical] : ["dia", "gov"];

  const startedAt = Date.now();
  let budgetExhausted = false;
  const report: Record<string, unknown> = {};

  for (const vertical of verticals) {
    const vStats = {
      queued: 0, staged: 0, failed: 0, skipped: 0, remaining: 0,
      errors: [] as string[],
      stage_results: [] as Record<string, unknown>[],
    };

    // Budget already spent by a prior vertical — don't even probe this one.
    if (Date.now() - startedAt >= STAGE_QUEUED_WALL_BUDGET_MS) {
      budgetExhausted = true;
      report[vertical] = { ...vStats, deferred: "wall budget exhausted before this vertical" };
      continue;
    }

    const pending = await dbFetch(vertical, "GET",
      `sf_files?ingestion_status=eq.stored&extraction_status=eq.queued&source_system=eq.salesforce` +
      `&extension=eq.pdf` +
      `&select=file_id,content_version_id,content_document_id,linked_entity_type,linked_entity_sf_id,title,file_name,extension,size_bytes,sha256,storage_path` +
      `&limit=${limit}`);
    const rows = Array.isArray(pending.data) ? pending.data as Record<string, unknown>[] : [];
    vStats.queued = rows.length;

    const env = dbEnv(vertical);
    if (!env) {
      report[vertical] = { ...vStats, error: `${vertical} DB not configured` };
      continue;
    }

    let idx = 0;
    for (const row of rows) {
      // Never START a new row past the budget — leave the rest for the next tick.
      if (Date.now() - startedAt >= STAGE_QUEUED_WALL_BUDGET_MS) {
        budgetExhausted = true;
        vStats.remaining = rows.length - idx;
        break;
      }
      idx++;
      const fileId = row.file_id;
      const storagePathStr = String(row.storage_path || "");
      if (!storagePathStr) {
        vStats.failed++;
        vStats.errors.push(`file_id ${fileId}: no storage_path`);
        await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${fileId}`, {
          extraction_status: "extract_failed",
          process_notes: "no storage_path on row",
          updated_at: isoNow(),
        });
        continue;
      }

      // Skip oversize files BEFORE downloading — base64-encoding a >15MB PDF in
      // the edge function risks OOM. Mark extract_failed so it leaves the queue.
      const declaredSize = Number(row.size_bytes) || 0;
      if (declaredSize > STAGE_QUEUED_MAX_FILE_BYTES) {
        vStats.skipped++;
        const human = `${(declaredSize / (1024 * 1024)).toFixed(1)}MB`;
        vStats.errors.push(`file_id ${fileId}: too large (${human})`);
        await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${fileId}`, {
          extraction_status: "extract_failed",
          process_notes: `file too large for edge staging (${human})`,
          updated_at: isoNow(),
        });
        continue;
      }

      // Download bytes from bucket
      const dlRes = await fetch(`${env.url}/storage/v1/object/${BUCKET}/${storagePathStr}`, {
        headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
      });
      if (!dlRes.ok) {
        vStats.failed++;
        vStats.errors.push(`file_id ${fileId}: storage download HTTP ${dlRes.status}`);
        await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${fileId}`, {
          extraction_status: "extract_failed",
          process_notes: `storage download failed: HTTP ${dlRes.status}`,
          updated_at: isoNow(),
        });
        continue;
      }
      const bytes = new Uint8Array(await dlRes.arrayBuffer());
      // Authoritative size guard: size_bytes may be NULL on legacy rows, so the
      // pre-download check can miss an oversize file. Re-check the real byte
      // length before the heavy base64 step.
      if (bytes.byteLength > STAGE_QUEUED_MAX_FILE_BYTES) {
        vStats.skipped++;
        const human = `${(bytes.byteLength / (1024 * 1024)).toFixed(1)}MB`;
        vStats.errors.push(`file_id ${fileId}: too large (${human})`);
        await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${fileId}`, {
          extraction_status: "extract_failed",
          process_notes: `file too large for edge staging (${human})`,
          updated_at: isoNow(),
        });
        continue;
      }
      const base64 = bytesToBase64(bytes);

      const linkedType = String(row.linked_entity_type || "Comp__c");
      const linkedId = String(row.linked_entity_sf_id || "");
      const title = String(row.title || row.file_name || "Salesforce file");
      const fileName = String(row.file_name || "om.pdf");

      const stagePayload = {
        intake_source: "salesforce",
        intake_channel: "email",
        intent: `Salesforce ${linkedType} ${linkedId} — ${title} (vertical:${vertical})`,
        artifacts: {
          primary_document: {
            bytes_base64: base64,
            file_name: fileName,
            mime_type: "application/pdf",
            size_bytes: bytes.byteLength,
            sha256: row.sha256 ?? null,
          },
        },
        seed_data: {
          sf_entity_type: linkedType,
          sf_entity_id: linkedId,
          source_vertical: vertical,
          source_content_version_id: row.content_version_id,
        },
      };

      const base = LCC_BASE_URL.startsWith("http") ? LCC_BASE_URL : `https://${LCC_BASE_URL}`;
      const stageRes = await fetch(`${base}/api/intake/stage-om`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-LCC-Key": LCC_API_KEY },
        body: JSON.stringify(stagePayload),
      });
      const stageText = await stageRes.text();
      let stageJson: Record<string, unknown> = {};
      try { stageJson = stageText ? JSON.parse(stageText) : {}; } catch {}

      if (!stageRes.ok || stageJson.error) {
        vStats.failed++;
        // R5-P-1 (2026-05-20): prefer error_summary — intake.js now always returns
        // a short, non-sensitive cause (name + truncated message) so copilot_action_exception
        // failures self-diagnose here in sf_files.process_notes (no LCC_ENV=development needed).
        const errMsg = String(stageJson.error_summary || stageJson.error || stageJson.detail || `HTTP ${stageRes.status}`);
        vStats.errors.push(`file_id ${fileId}: ${errMsg.slice(0, 200)}`);
        await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${fileId}`, {
          extraction_status: "extract_failed",
          process_notes: `stage-om failed: ${errMsg.slice(0, 300)}`,
          updated_at: isoNow(),
        });
        continue;
      }

      const intakeId = stageJson.intake_id || stageJson.inbox_id || null;
      const extractionStatus = stageJson.extraction_status || null;
      const matchStatus = stageJson.entity_match_status || stageJson.match_status || null;
      const matchedEntityId = stageJson.matched_entity_id || null;
      await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${fileId}`, {
        extraction_status: "extracted",
        process_notes: `intake:${intakeId} extract:${extractionStatus} match:${matchStatus}` +
          (matchedEntityId ? ` matched:${matchedEntityId}` : ""),
        updated_at: isoNow(),
      });
      vStats.staged++;
      vStats.stage_results.push({
        file_id: fileId,
        intake_id: intakeId,
        extraction_status: extractionStatus,
        match_status: matchStatus,
        matched_entity_id: matchedEntityId,
      });
    }

    report[vertical] = vStats;
  }

  const remainingTotal = Object.values(report).reduce(
    (sum, v) => sum + (Number((v as Record<string, unknown>).remaining) || 0), 0);

  return jsonResponse(req, {
    ok: true,
    mode: "stage-queued",
    budget_exhausted: budgetExhausted,
    remaining: remainingTotal,
    elapsed_ms: Date.now() - startedAt,
    note: "Pumped sf_files at extraction_status='queued' through LCC /api/intake/stage-om. " +
      "Successful rows are now extraction_status='extracted' with intake_id in process_notes." +
      (budgetExhausted
        ? ` Wall budget (${STAGE_QUEUED_WALL_BUDGET_MS}ms) hit — ${remainingTotal} row(s) left for the next tick.`
        : ""),
    by_vertical: report,
  });
}
