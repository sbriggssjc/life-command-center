// ============================================================================
// intake-salesforce-files — Salesforce file intake for the SF -> LCC bridge
// Life Command Center
//
// Routes:
//   POST ?action=manifest      — record discovered files, return the to-fetch list
//   POST ?action=upload-url    — mint a Storage signed-upload URL for one file
//   POST ?action=bytes         — store one file's bytes, finalize + enqueue extraction
//   POST ?action=retry-files   — return stuck (discovered/failed) files as a to-fetch list
//   POST ?action=fetch         — server-side: download discovered files from Salesforce
//   POST ?action=discover      — server-side: sweep ContentDocumentLink/ContentVersion
//                                for staged Comp/Listing/Deal records and record newly
//                                discovered files into sf_files (ingestion_status:"discovered").
//                                W3.7b: extends the sweep past Comp__c to Listing__c + Deal.
//   POST ?action=stage-queued  — drain sf_files at extraction_status:"queued" through
//                                LCC's /api/intake/stage-om pipeline (real OM extraction +
//                                property matching). Marks rows extraction_status:"extracted"
//                                with intake_id in process_notes.
//   GET  (no action)           — info
// ============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authenticateWebhook } from "../_shared/auth.ts";
import { queryParams, parseBody, isoNow } from "../_shared/utils.ts";
import {
  DISCOVERY_OBJECTS, buildContentDocumentLinkSoql, buildContentVersionSoql,
  mapVersionToFileRow, filterNewVersions, isDiscoverableExtension, linkedTypeFromCdl,
  sanitizeSfId, chunk, traversalColumnForType, CDL_ID_CHUNK, type ContentVersionRow,
} from "./discovery.ts";

const PAYLOAD_VERSION = "sf-files-2026-07-v6";
const SF_API_VERSION = "v60.0";
const BUCKET = "salesforce-files";
const MAX_INLINE_BYTES = 6 * 1024 * 1024;

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

// ── Salesforce auth (Connected App, optional) ──────────────────────────────
const SF_INSTANCE_URL = Deno.env.get("SF_INSTANCE_URL") ?? "";
const SF_CLIENT_ID = Deno.env.get("SF_CLIENT_ID") ?? "";
const SF_CLIENT_SECRET = Deno.env.get("SF_CLIENT_SECRET") ?? "";
let sfTokenCache: { token: string; instanceUrl: string; expiresAt: number } | null = null;

async function getSfToken(): Promise<{ token: string; instanceUrl: string } | null> {
  if (!SF_INSTANCE_URL || !SF_CLIENT_ID || !SF_CLIENT_SECRET) return null;
  const now = Date.now();
  if (sfTokenCache && sfTokenCache.expiresAt > now + 60_000) return { token: sfTokenCache.token, instanceUrl: sfTokenCache.instanceUrl };
  const form = new URLSearchParams({ grant_type: "client_credentials", client_id: SF_CLIENT_ID, client_secret: SF_CLIENT_SECRET });
  const res = await fetch(`${SF_INSTANCE_URL}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; instance_url?: string };
  if (!data.access_token) return null;
  sfTokenCache = { token: data.access_token, instanceUrl: data.instance_url || SF_INSTANCE_URL, expiresAt: now + 25 * 60 * 1000 };
  return { token: sfTokenCache.token, instanceUrl: sfTokenCache.instanceUrl };
}

async function sfDownloadBytes(auth: { token: string; instanceUrl: string }, path: string): Promise<{ ok: boolean; bytes?: Uint8Array; contentType?: string; error?: string }> {
  const url = path.startsWith("http") ? path : `${auth.instanceUrl}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } });
  if (!res.ok) return { ok: false, error: `${res.status} ${await res.text()}` };
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { ok: true, bytes, contentType: res.headers.get("content-type") || "application/octet-stream" };
}

// Run a SOQL query via the Connected App, following nextRecordsUrl pagination.
async function sfQuery(
  auth: { token: string; instanceUrl: string }, soql: string,
): Promise<{ ok: boolean; status: number; records: Record<string, unknown>[]; error?: string }> {
  const records: Record<string, unknown>[] = [];
  let next: string | null = `/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`;
  let status = 200;
  while (next) {
    const url = next.startsWith("http") ? next : `${auth.instanceUrl}${next}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } });
    status = res.status;
    if (!res.ok) return { ok: false, status, records, error: (await res.text()).slice(0, 400) };
    const data = (await res.json()) as { records?: Record<string, unknown>[]; done?: boolean; nextRecordsUrl?: string };
    if (Array.isArray(data.records)) records.push(...data.records);
    next = data.done === false && data.nextRecordsUrl ? data.nextRecordsUrl : null;
  }
  return { ok: true, status, records };
}

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
      actions: ["manifest", "upload-url", "bytes", "retry-files", "fetch", "discover", "stage-queued"],
    });
  }

  if (!authenticateWebhook(req)) {
    return errorResponse(req, "Unauthorized — missing or invalid X-PA-Webhook-Secret", 401);
  }

  try {
    if (req.method !== "POST") return errorResponse(req, `Method ${req.method} not allowed`, 405);
    const body = (await parseBody(req)) as Record<string, unknown> | null;
    if (action === "manifest") return await handleManifest(req, body);
    if (action === "upload-url") return await handleUploadUrl(req, body);
    if (action === "bytes") return await handleBytes(req, body);
    if (action === "retry-files") return await handleRetryFiles(req, body);
    if (action === "fetch") return await handleFetch(req, body);
    if (action === "discover") return await handleDiscover(req, body);
    if (action === "stage-queued") return await handleStageQueued(req, body);
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

// ── POST ?action=discover ───────────────────────────────────────────────────
// Server-side ContentDocumentLink → ContentVersion sweep via the Connected App.
// W3.7b: extends the file-discovery sweep past Comp__c to Listing__c + Deal
// (Opportunity). For each staged Comp/Listing/Deal SF id it queries
// ContentDocumentLink, then the latest ContentVersion per document, and records
// newly discovered files into sf_files (ingestion_status='discovered') with the
// same dedup contract (content_version_id) and the sf_comp_id/sf_listing_id/
// sf_deal_id traversal column stamped. The existing ?action=fetch drains those
// 'discovered' rows to bytes, and ?action=stage-queued feeds the extractor —
// no new extraction engine.
//
// body: {
//   vertical?: 'dia'|'gov',            // default both
//   object_types?: ['comp','listing','deal'],  // default all three
//   entity_ids?: string[],             // scoped backfill (e.g. one Listing id);
//                                      // applied to the requested object_types
//   limit?: number,                    // per staging table (backfill sweep size)
//   only_unprocessed?: boolean,        // staging rows with processed=false only
//   batch_id?: string,
// }
// Clean no-op (200, configured:false) when the Connected App is not configured,
// so a driving cron is safe before credentials land.
async function handleDiscover(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  const b = body || {};
  const auth = await getSfToken();
  if (!auth) {
    return jsonResponse(req, {
      ok: true, configured: false,
      note: "Salesforce Connected App not configured (SF_INSTANCE_URL/SF_CLIENT_ID/SF_CLIENT_SECRET) — discover is a no-op until credentials land.",
    });
  }

  const verticals: Vertical[] = b.vertical ? [String(b.vertical) as Vertical] : ["dia", "gov"];
  const wantKeys = Array.isArray(b.object_types) && b.object_types.length
    ? new Set((b.object_types as unknown[]).map((k) => String(k).toLowerCase()))
    : null;
  const objects = DISCOVERY_OBJECTS.filter((o) => !wantKeys || wantKeys.has(o.key));
  const scopedIds = Array.isArray(b.entity_ids)
    ? (b.entity_ids as unknown[]).map(sanitizeSfId).filter(Boolean) as string[]
    : null;
  const perTableLimit = Math.min(Number(b.limit) || 2000, 5000);
  const onlyUnprocessed = b.only_unprocessed === true;
  const batchId = String(b.batch_id || `discover-${isoNow()}`);

  const report: Record<string, unknown> = {};

  for (const vertical of verticals) {
    const env = dbEnv(vertical);
    const vReport: Record<string, unknown> = { by_object: {} };
    if (!env) { vReport.error = `${vertical} DB not configured`; report[vertical] = vReport; continue; }

    for (const obj of objects) {
      const oStats = {
        staged_ids: 0, content_links: 0, documents: 0, latest_versions: 0,
        discoverable: 0, new_discovered: 0, skipped_existing: 0, errors: [] as string[],
      };

      // 1. entity ids to sweep — scoped list, else staged parent ids.
      let entityIds: string[] = [];
      if (scopedIds) {
        entityIds = scopedIds;
      } else {
        const filter = onlyUnprocessed ? "&processed=eq.false" : "";
        const res = await dbFetch(vertical, "GET",
          `${obj.stagingTable}?select=${obj.sfIdColumn}${filter}&${obj.sfIdColumn}=not.is.null&limit=${perTableLimit}`);
        const rows = Array.isArray(res.data) ? res.data as Record<string, unknown>[] : [];
        entityIds = rows.map((r) => sanitizeSfId(r[obj.sfIdColumn])).filter(Boolean) as string[];
      }
      entityIds = [...new Set(entityIds)];
      oStats.staged_ids = entityIds.length;
      if (!entityIds.length) { (vReport.by_object as Record<string, unknown>)[obj.key] = oStats; continue; }

      // 2. ContentDocumentLink for these entities → document ids (+ which entity).
      const docToEntity: Record<string, { entityId: string; type: string }> = {};
      for (const ids of chunk(entityIds, CDL_ID_CHUNK)) {
        const q = await sfQuery(auth, buildContentDocumentLinkSoql(ids));
        if (!q.ok) { oStats.errors.push(`CDL query: ${q.status} ${q.error || ""}`.slice(0, 200)); continue; }
        for (const cdl of q.records) {
          const docId = sanitizeSfId(cdl.ContentDocumentId);
          const entId = sanitizeSfId(cdl.LinkedEntityId);
          if (!docId || !entId) continue;
          oStats.content_links++;
          // First entity wins per document (deterministic); type from the row,
          // falling back to this object's SF type.
          if (!docToEntity[docId]) {
            docToEntity[docId] = { entityId: entId, type: linkedTypeFromCdl(cdl) || obj.sfType };
          }
        }
      }
      const docIds = Object.keys(docToEntity);
      oStats.documents = docIds.length;
      if (!docIds.length) { (vReport.by_object as Record<string, unknown>)[obj.key] = oStats; continue; }

      // 3. latest ContentVersion per document → candidate sf_files rows.
      const candidates: Record<string, unknown>[] = [];
      for (const ids of chunk(docIds, CDL_ID_CHUNK)) {
        const q = await sfQuery(auth, buildContentVersionSoql(ids));
        if (!q.ok) { oStats.errors.push(`CV query: ${q.status} ${q.error || ""}`.slice(0, 200)); continue; }
        for (const cv of q.records as ContentVersionRow[]) {
          oStats.latest_versions++;
          if (!isDiscoverableExtension(cv.FileExtension)) continue;
          oStats.discoverable++;
          const link = docToEntity[String(cv.ContentDocumentId)];
          if (!link) continue;
          candidates.push(mapVersionToFileRow({
            cv, linkedEntityType: link.type, linkedEntityId: link.entityId,
            batchId, nowIso: isoNow(), apiVersion: SF_API_VERSION,
          }));
        }
      }
      if (!candidates.length) { (vReport.by_object as Record<string, unknown>)[obj.key] = oStats; continue; }

      // 4. dedup vs existing sf_files.content_version_id (this vertical).
      const cvids = candidates.map((c) => String(c.content_version_id)).filter(Boolean);
      const existing = new Set<string>();
      for (const ids of chunk(cvids, CDL_ID_CHUNK)) {
        const inList = ids.map((c) => `"${c}"`).join(",");
        const ex = await dbFetch(vertical, "GET",
          `sf_files?content_version_id=in.(${inList})&select=content_version_id`);
        for (const r of (Array.isArray(ex.data) ? ex.data : []) as Record<string, unknown>[]) {
          existing.add(String(r.content_version_id));
        }
      }
      const fresh = filterNewVersions(candidates, existing);
      oStats.skipped_existing = candidates.length - fresh.length;

      // 5. insert the fresh discovered rows.
      if (fresh.length) {
        const ins = await dbFetch(vertical, "POST", "sf_files", fresh, "return=minimal");
        if (ins.ok) oStats.new_discovered = fresh.length;
        else oStats.errors.push(`insert: ${ins.status} ${JSON.stringify(ins.data).slice(0, 160)}`);
      }

      (vReport.by_object as Record<string, unknown>)[obj.key] = oStats;
    }

    report[vertical] = vReport;
  }

  return jsonResponse(req, {
    ok: true, configured: true, mode: "discover", batch_id: batchId,
    note: "Swept ContentDocumentLink/ContentVersion for staged Comp/Listing/Deal records; new files are ingestion_status='discovered'. Run ?action=fetch then ?action=stage-queued to store + extract.",
    by_vertical: report,
  });
}

// ── POST ?action=fetch ──────────────────────────────────────────────────────
// Server-side byte mover via Salesforce Connected App. Drains rows still at
// ingestion_status='discovered'. Requires SF_INSTANCE_URL + SF_CLIENT_ID + SF_CLIENT_SECRET.
async function handleFetch(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  const b = body || {};
  const limit = Math.min(Number(b.limit) || 25, 100);
  const verticals: Vertical[] = b.vertical ? [String(b.vertical) as Vertical] : ["dia", "gov"];
  const auth = await getSfToken();
  if (!auth) return errorResponse(req, "Salesforce not configured", 503);
  const report: Record<string, unknown> = {};
  for (const vertical of verticals) {
    const vStats = { discovered: 0, stored: 0, failed: 0, skipped: 0, errors: [] as string[] };
    const pending = await dbFetch(vertical, "GET",
      `sf_files?ingestion_status=eq.discovered&source_system=eq.salesforce` +
      `&select=file_id,content_document_id,content_version_id,linked_entity_type,linked_entity_sf_id,title,file_name,sf_download_url` +
      `&limit=${limit}`);
    const rows = Array.isArray(pending.data) ? pending.data as Record<string, unknown>[] : [];
    vStats.discovered = rows.length;
    for (const row of rows) {
      const dlPath = String(row.sf_download_url || "");
      if (!dlPath) {
        vStats.skipped++;
        await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${row.file_id}`, {
          ingestion_status: "failed", process_notes: "no sf_download_url on row", updated_at: isoNow(),
        });
        continue;
      }
      const dl = await sfDownloadBytes(auth, dlPath);
      if (!dl.ok || !dl.bytes) {
        vStats.failed++;
        vStats.errors.push(`${row.content_version_id}: ${dl.error}`);
        await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${row.file_id}`, {
          ingestion_status: "failed", process_notes: `download failed: ${dl.error}`, updated_at: isoNow(),
        });
        continue;
      }
      const path = storagePath(row);
      const up = await storageUpload(vertical, path, dl.bytes, dl.contentType || "application/octet-stream");
      if (!up.ok) {
        vStats.failed++;
        vStats.errors.push(`${row.content_version_id}: storage ${up.error}`);
        await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${row.file_id}`, {
          ingestion_status: "failed", process_notes: `storage upload failed: ${up.error}`, updated_at: isoNow(),
        });
        continue;
      }
      const sha = await sha256Hex(dl.bytes);
      await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${row.file_id}`, {
        ingestion_status: "stored", extraction_status: "queued",
        storage_path: path, sha256: sha, size_bytes: dl.bytes.byteLength,
        stored_at: isoNow(), updated_at: isoNow(),
      });
      vStats.stored++;
    }
    report[vertical] = vStats;
  }
  return jsonResponse(req, {
    ok: true, mode: "server-side fetch",
    note: "Drained sf_files rows at ingestion_status='discovered'.",
    by_vertical: report,
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
