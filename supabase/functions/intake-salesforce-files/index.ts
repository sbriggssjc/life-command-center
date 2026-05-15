// ============================================================================
// intake-salesforce-files — Salesforce file intake for the SF -> LCC bridge
// Life Command Center
//
// The front door Power Automate's "SF -> LCC: File Discovery & Move" flow
// POSTs to. Transport (Power Automate) discovers ContentDocumentLink /
// ContentVersion and moves bytes; this function records metadata, dedups,
// stores bytes in the salesforce-files bucket, and enqueues extraction.
// It never writes a domain table.
//
// Routes:
//   POST ?action=manifest     — record discovered files, return the to-fetch list
//   POST ?action=upload-url   — mint a Storage signed-upload URL for one file
//   POST ?action=bytes        — store one file's bytes, finalize + enqueue extraction
//   POST ?action=retry-files  — return stuck (discovered/failed) files as a to-fetch list
//   POST ?action=fetch        — server-side: download discovered files from Salesforce
//   GET  (no action)          — info
// ============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authenticateWebhook } from "../_shared/auth.ts";
import { queryParams, parseBody, isoNow } from "../_shared/utils.ts";

const PAYLOAD_VERSION = "sf-files-2026-05-v1";
const BUCKET = "salesforce-files";
const MAX_INLINE_BYTES = 6 * 1024 * 1024; // 6 MB cap on inline base64 uploads

type Vertical = "dia" | "gov" | "ops";

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

// Upload raw bytes to the salesforce-files Storage bucket on a vertical.
async function storageUpload(
  vertical: Vertical, path: string, bytes: Uint8Array, contentType: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const env = dbEnv(vertical);
  if (!env) return { ok: false, status: 503, error: `${vertical} not configured` };
  const res = await fetch(`${env.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: env.key,
      Authorization: `Bearer ${env.key}`,
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (res.ok) return { ok: true, status: res.status };
  return { ok: false, status: res.status, error: await res.text() };
}

// ── Salesforce auth + file download ─────────────────────────────────────────
// One Salesforce org for all verticals. A Connected App with the OAuth 2.0
// Client Credentials Flow enabled (run-as an integration user) mints tokens
// against the standard token endpoint — which is NOT behind the SSO gateway
// that blocked the username/password flow.
const SF_INSTANCE_URL = Deno.env.get("SF_INSTANCE_URL") ?? "";
const SF_CLIENT_ID = Deno.env.get("SF_CLIENT_ID") ?? "";
const SF_CLIENT_SECRET = Deno.env.get("SF_CLIENT_SECRET") ?? "";

let sfTokenCache: { token: string; instanceUrl: string; expiresAt: number } | null = null;

async function getSfToken(): Promise<{ token: string; instanceUrl: string } | null> {
  if (!SF_INSTANCE_URL || !SF_CLIENT_ID || !SF_CLIENT_SECRET) return null;
  const now = Date.now();
  if (sfTokenCache && sfTokenCache.expiresAt > now + 60_000) {
    return { token: sfTokenCache.token, instanceUrl: sfTokenCache.instanceUrl };
  }
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: SF_CLIENT_ID,
    client_secret: SF_CLIENT_SECRET,
  });
  const res = await fetch(`${SF_INSTANCE_URL}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; instance_url?: string };
  if (!data.access_token) return null;
  sfTokenCache = {
    token: data.access_token,
    instanceUrl: data.instance_url || SF_INSTANCE_URL,
    expiresAt: now + 25 * 60 * 1000, // refresh well before the ~1h expiry
  };
  return { token: sfTokenCache.token, instanceUrl: sfTokenCache.instanceUrl };
}

// Download a Salesforce file by its VersionData path (relative path stored by
// the manifest step, e.g. /services/data/v59.0/sobjects/ContentVersion/{Id}/VersionData).
async function sfDownloadBytes(
  auth: { token: string; instanceUrl: string },
  path: string,
): Promise<{ ok: boolean; bytes?: Uint8Array; contentType?: string; error?: string }> {
  const url = path.startsWith("http") ? path : `${auth.instanceUrl}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } });
  if (!res.ok) return { ok: false, error: `${res.status} ${await res.text()}` };
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    ok: true,
    bytes,
    contentType: res.headers.get("content-type") || "application/octet-stream",
  };
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
      actions: ["manifest", "upload-url", "bytes", "retry-files", "fetch"],
    });
  }

  if (!authenticateWebhook(req)) {
    return errorResponse(req, "Unauthorized — missing or invalid X-PA-Webhook-Secret", 401);
  }

  try {
    if (req.method !== "POST") {
      return errorResponse(req, `Method ${req.method} not allowed`, 405);
    }
    const body = (await parseBody(req)) as Record<string, unknown> | null;
    if (action === "manifest") return await handleManifest(req, body);
    if (action === "upload-url") return await handleUploadUrl(req, body);
    if (action === "bytes") return await handleBytes(req, body);
    if (action === "retry-files") return await handleRetryFiles(req, body);
    if (action === "fetch") return await handleFetch(req, body);
    return errorResponse(req, `Unknown POST action: ${action}`, 400);
  } catch (err) {
    console.error("[intake-salesforce-files]", err);
    return errorResponse(req, `Internal error: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});

// ── POST ?action=manifest ───────────────────────────────────────────────────
// body: { batch_id, files: [{ vertical, content_document_id, content_version_id,
//          linked_entity_type, linked_entity_sf_id, title, file_name, extension,
//          version_number, size_bytes, sf_download_url }] }
// Records discovered files in sf_files (dedup on content_version_id) and returns
// only the files whose bytes are not already stored.
async function handleManifest(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  if (!body) return errorResponse(req, "Missing JSON body", 400);
  const batchId = String(body.batch_id || "");
  const files = Array.isArray(body.files) ? body.files as Record<string, unknown>[] : null;
  if (!batchId) return errorResponse(req, "batch_id is required", 400);
  if (!files) return errorResponse(req, "files[] is required", 400);

  // group incoming files by vertical
  const byVertical: Record<string, Record<string, unknown>[]> = {};
  for (const f of files) {
    const v = String(f.vertical || "dia");
    (byVertical[v] ??= []).push(f);
  }

  const toFetch: Record<string, unknown>[] = [];
  let discovered = 0, errors = 0;

  for (const [vertical, vFiles] of Object.entries(byVertical)) {
    const cvids = vFiles.map((f) => f.content_version_id).filter(Boolean) as string[];
    if (!cvids.length) continue;

    // which content_version_ids already exist, and their ingestion_status
    const inList = cvids.map((c) => `"${c}"`).join(",");
    const existing = await dbFetch(
      vertical as Vertical, "GET",
      `sf_files?content_version_id=in.(${inList})&select=content_version_id,ingestion_status`,
    );
    const statusByCvid: Record<string, string> = {};
    for (const r of (Array.isArray(existing.data) ? existing.data : []) as Record<string, unknown>[]) {
      statusByCvid[String(r.content_version_id)] = String(r.ingestion_status);
    }

    // insert only the genuinely new ones
    const newRows = vFiles
      .filter((f) => !(String(f.content_version_id) in statusByCvid))
      .map((f) => ({
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
      }));

    if (newRows.length) {
      const res = await dbFetch(
        vertical as Vertical, "POST",
        `sf_files?on_conflict=content_version_id,source_system`,
        newRows, "resolution=merge-duplicates,return=minimal",
      );
      if (res.ok) discovered += newRows.length;
      else errors += newRows.length;
    }

    // to_fetch = every file in this batch whose bytes are not already stored
    for (const f of vFiles) {
      const cur = statusByCvid[String(f.content_version_id)];
      if (cur !== "stored") {
        toFetch.push({ vertical, ...f });
      }
    }
  }

  return jsonResponse(req, {
    ok: errors === 0,
    batch_id: batchId,
    received: files.length,
    discovered,
    errors,
    to_fetch: toFetch,
  });
}

// ── POST ?action=upload-url ─────────────────────────────────────────────────
// body: { vertical, content_version_id }
// Mints a Supabase Storage signed-upload URL for the file's target path so the
// caller (Power Automate) can PUT the raw bytes straight to the salesforce-files
// bucket — no size cap, and the service-role key never leaves the server.
// Mirrors the LCC OM-ingest prepare-upload pattern
// (api/_handlers/intake-prepare-upload.js). After a successful PUT, the caller
// finalizes the row with ?action=bytes { storage_path }.
async function handleUploadUrl(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  if (!body) return errorResponse(req, "Missing JSON body", 400);
  const vertical = String(body.vertical || "dia") as Vertical;
  const cvid = String(body.content_version_id || "");
  if (!cvid) return errorResponse(req, "content_version_id is required", 400);

  const env = dbEnv(vertical);
  if (!env) return errorResponse(req, `${vertical} DB not configured`, 503);

  // look up the sf_files row recorded by the manifest step
  const lookup = await dbFetch(
    vertical, "GET",
    `sf_files?content_version_id=eq.${encodeURIComponent(cvid)}&source_system=eq.salesforce` +
    `&select=file_id,content_document_id,content_version_id,linked_entity_type,linked_entity_sf_id,title,file_name&limit=1`,
  );
  const rows = Array.isArray(lookup.data) ? lookup.data as Record<string, unknown>[] : [];
  if (!rows.length) {
    return errorResponse(req, `No sf_files row for content_version_id ${cvid} — run manifest first`, 404);
  }
  const objectPath = storagePath(rows[0]); // bucket-relative path

  // mint the signed upload URL via Supabase Storage REST
  const signEndpoint = `${env.url}/storage/v1/object/upload/sign/${BUCKET}/${objectPath}`;
  const signRes = await fetch(signEndpoint, {
    method: "POST",
    headers: {
      apikey: env.key,
      Authorization: `Bearer ${env.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  const signText = await signRes.text();
  let signJson: Record<string, unknown> | null = null;
  try { signJson = signText ? JSON.parse(signText) : null; } catch { /* keep text for error */ }
  if (!signRes.ok || !signJson?.url) {
    return errorResponse(
      req,
      `Signed-URL mint failed: ${String(signJson?.message || signJson?.error || signText || "no data").slice(0, 300)}`,
      signRes.status || 500,
    );
  }

  // Supabase returns a relative "/object/upload/sign/...?token=JWT". The caller
  // PUTs the bytes there with the x-upsert header — the ?token is the only auth
  // (do NOT add an Authorization header on the PUT).
  const uploadUrl = `${env.url}/storage/v1${signJson.url}`;

  return jsonResponse(req, {
    ok: true,
    content_version_id: cvid,
    vertical,
    storage_path: objectPath,        // pass this back to ?action=bytes after the PUT
    upload_url: uploadUrl,           // PUT the raw file bytes here
    upload_method: "PUT",
    upload_headers: { "x-upsert": "true" },
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
  });
}

// ── POST ?action=bytes ──────────────────────────────────────────────────────
// body: { vertical, content_version_id, file_base64?, storage_path?, mime_type? }
// Stores the bytes (inline base64 -> bucket, or accepts a pre-uploaded
// storage_path), verifies sha256, finalizes the sf_files row, enqueues extraction.
async function handleBytes(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  if (!body) return errorResponse(req, "Missing JSON body", 400);
  const vertical = String(body.vertical || "dia") as Vertical;
  const cvid = String(body.content_version_id || "");
  if (!cvid) return errorResponse(req, "content_version_id is required", 400);

  // look up the sf_files row recorded by the manifest step
  const lookup = await dbFetch(
    vertical, "GET",
    `sf_files?content_version_id=eq.${encodeURIComponent(cvid)}&source_system=eq.salesforce` +
    `&select=file_id,content_document_id,content_version_id,linked_entity_type,linked_entity_sf_id,title,file_name&limit=1`,
  );
  const rows = Array.isArray(lookup.data) ? lookup.data as Record<string, unknown>[] : [];
  if (!rows.length) {
    return errorResponse(req, `No sf_files row for content_version_id ${cvid} — run manifest first`, 404);
  }
  const row = rows[0];

  let path: string | null = null;
  let sha: string | null = null;
  let size: number | null = null;

  if (typeof body.file_base64 === "string" && body.file_base64) {
    const bytes = b64ToBytes(body.file_base64);
    if (bytes.byteLength > MAX_INLINE_BYTES) {
      return errorResponse(req, `Inline file exceeds ${MAX_INLINE_BYTES} bytes — use storage_path instead`, 413);
    }
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
    // Power Automate uploaded the bytes straight to the bucket
    path = String(body.storage_path);
    sha = (body.sha256 as string) ?? null;
    size = (body.size_bytes as number) ?? null;
  } else {
    return errorResponse(req, "Provide either file_base64 or storage_path", 400);
  }

  const patch = await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${row.file_id}`, {
    ingestion_status: "stored",
    extraction_status: "queued",
    storage_path: path,
    sha256: sha,
    size_bytes: size,
    stored_at: isoNow(),
    updated_at: isoNow(),
  });

  return jsonResponse(req, {
    ok: patch.ok,
    content_version_id: cvid,
    file_id: row.file_id,
    storage_path: path,
    sha256: sha,
    extraction_status: "queued",
  });
}

// ── POST ?action=retry-files ────────────────────────────────────────────────
// body: { vertical?, limit? }
// Returns sf_files rows still stuck at ingestion_status in (discovered, failed)
// as a to_fetch list (same shape as the manifest response) so the retry flow
// can re-run the move loop against them. The file analog of
// intake-salesforce's ?action=retry.
async function handleRetryFiles(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  const b = body || {};
  const limit = Math.min(Number(b.limit) || 50, 200);
  const verticals: Vertical[] = b.vertical
    ? [String(b.vertical) as Vertical]
    : ["dia", "gov"];

  const toFetch: Record<string, unknown>[] = [];
  const report: Record<string, number> = {};

  for (const vertical of verticals) {
    const res = await dbFetch(
      vertical, "GET",
      `sf_files?source_system=eq.salesforce&ingestion_status=in.(discovered,failed)` +
      `&select=content_version_id,content_document_id,linked_entity_type,linked_entity_sf_id,` +
      `title,file_name,extension,version_number,size_bytes,sf_download_url,ingestion_status` +
      `&limit=${limit}`,
    );
    const rows = Array.isArray(res.data) ? res.data as Record<string, unknown>[] : [];
    for (const r of rows) toFetch.push({ vertical, ...r });
    report[vertical] = rows.length;
  }

  return jsonResponse(req, {
    ok: true,
    count: toFetch.length,
    by_vertical: report,
    to_fetch: toFetch,
  });
}

// ── POST ?action=fetch ──────────────────────────────────────────────────────
// body: { vertical?, limit? }
// The server-side "Move": drains sf_files rows still at
// ingestion_status='discovered', downloads each file's bytes straight from
// Salesforce (Connected App OAuth), stores them in the salesforce-files
// bucket, finalizes the row, and enqueues extraction. Power Automate only
// does discovery (the manifest step) — it never moves bytes.
async function handleFetch(req: Request, body: Record<string, unknown> | null): Promise<Response> {
  const b = body || {};
  const limit = Math.min(Number(b.limit) || 25, 100);
  const verticals: Vertical[] = b.vertical
    ? [String(b.vertical) as Vertical]
    : ["dia", "gov"];

  const auth = await getSfToken();
  if (!auth) {
    return errorResponse(
      req,
      "Salesforce not configured — set SF_INSTANCE_URL, SF_CLIENT_ID, SF_CLIENT_SECRET",
      503,
    );
  }

  const report: Record<string, unknown> = {};

  for (const vertical of verticals) {
    const vStats = {
      discovered: 0, stored: 0, failed: 0, skipped: 0,
      errors: [] as string[],
    };

    const pending = await dbFetch(
      vertical, "GET",
      `sf_files?ingestion_status=eq.discovered&source_system=eq.salesforce` +
      `&select=file_id,content_document_id,content_version_id,linked_entity_type,linked_entity_sf_id,title,file_name,sf_download_url` +
      `&limit=${limit}`,
    );
    const rows = Array.isArray(pending.data) ? pending.data as Record<string, unknown>[] : [];
    vStats.discovered = rows.length;

    for (const row of rows) {
      const dlPath = String(row.sf_download_url || "");
      if (!dlPath) {
        vStats.skipped++;
        await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${row.file_id}`, {
          ingestion_status: "failed",
          process_notes: "no sf_download_url on row",
          updated_at: isoNow(),
        });
        continue;
      }

      const dl = await sfDownloadBytes(auth, dlPath);
      if (!dl.ok || !dl.bytes) {
        vStats.failed++;
        vStats.errors.push(`${row.content_version_id}: ${dl.error}`);
        await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${row.file_id}`, {
          ingestion_status: "failed",
          process_notes: `download failed: ${dl.error}`,
          updated_at: isoNow(),
        });
        continue;
      }

      const path = storagePath(row);
      const up = await storageUpload(
        vertical, path, dl.bytes, dl.contentType || "application/octet-stream",
      );
      if (!up.ok) {
        vStats.failed++;
        vStats.errors.push(`${row.content_version_id}: storage ${up.error}`);
        await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${row.file_id}`, {
          ingestion_status: "failed",
          process_notes: `storage upload failed: ${up.error}`,
          updated_at: isoNow(),
        });
        continue;
      }

      const sha = await sha256Hex(dl.bytes);
      await dbFetch(vertical, "PATCH", `sf_files?file_id=eq.${row.file_id}`, {
        ingestion_status: "stored",
        extraction_status: "queued",
        storage_path: path,
        sha256: sha,
        size_bytes: dl.bytes.byteLength,
        stored_at: isoNow(),
        updated_at: isoNow(),
      });
      vStats.stored++;
    }

    report[vertical] = vStats;
  }

  return jsonResponse(req, {
    ok: true,
    mode: "server-side fetch",
    note: "Drained sf_files rows at ingestion_status='discovered'; stored bytes " +
      "are queued for extraction.",
    by_vertical: report,
  });
}
