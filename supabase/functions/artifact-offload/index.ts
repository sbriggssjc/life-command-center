// ============================================================================
// artifact-offload — DB-local staged_intake_artifacts inline → Storage drainer
// Life Command Center — Supabase Edge Function (LCC Opps project)
//
// WHY THIS EXISTS (R15, 2026-06-08):
// Large OM files were historically stored as base64 `inline_data` in
// staged_intake_artifacts on LCC Opps (the auth DB), bloating it toward the
// ~13 GB read-only disk ceiling. The Vercel/Railway offload handler
// (api/admin.js handleArtifactOffload) round-trips every multi-MB blob DB →
// Railway → Storage, so it is time-budgeted to ~2 large files/tick and, when
// run frequently, exhausted the small-tier connection budget (the 2026-05-29
// incident that DISABLED the every-5-min cron).
//
// This Edge Function does the same offload but IN-REGION (DB + Storage are both
// on Supabase), so each row is fast and the multi-MB bytes never leave the
// Supabase network. That lets one invocation drain a whole batch within a
// normal time budget while staying gentle on the DB:
//   * concurrency = 1 (strictly serial), with a short pause between rows
//   * bounded batch size, largest-first (reclaim the most disk per call)
//   * PostgREST (pooled) — no raw connection fan-out
//
// It is the durable replacement for the Railway-round-trip offload cron and the
// engine for a faster one-shot backlog drain (raise `limit`, invoke a few times).
//
// SAFETY / IDEMPOTENCY (identical contract to the Vercel handler):
//   * Only rows with inline_data NOT NULL, storage_path NULL, older than
//     grace_minutes (default 15 — lets the inline-based initial extraction
//     finish before the bytes move).
//   * Upload uses x-upsert; the PATCH is guarded on storage_path IS NULL, so a
//     partial failure or re-run re-uploads to the same deterministic path and
//     patches once — no duplicates, no data loss. A failed upload leaves the
//     row untouched and still readable via inline_data.
//
// Entry points:
//   POST /functions/v1/artifact-offload
//        body: { limit?: number, grace_minutes?: number, bucket?: string, dry_run?: bool }
//   GET  /functions/v1/artifact-offload            → dry-run (counts, no writes)
//
// Auth: Authorization: Bearer <LCC_API_KEY>  OR  X-LCC-Key: <LCC_API_KEY>
//       (pg_cron posts the Bearer via lcc_cron_post(..., 'edge')).
// ============================================================================

const OPS_URL =
  Deno.env.get("OPS_SUPABASE_URL") ||
  Deno.env.get("SUPABASE_URL") ||
  "";
const OPS_KEY =
  Deno.env.get("OPS_SUPABASE_SERVICE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("OPS_SUPABASE_KEY") ||
  "";
const SHARED_SECRET =
  Deno.env.get("LCC_API_KEY") ||
  Deno.env.get("LCC_CRON_KEY") ||
  "";

const DEFAULT_BUCKET = "lcc-om-uploads";
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;
const DEFAULT_GRACE_MIN = 15;
const TIME_BUDGET_MS = 45_000; // return BEFORE lcc_cron_post's 60s pg_net timeout
                               // so the cron captures the 200 + telemetry
                               // (~16 large files/tick at the in-region rate)
const PER_ROW_PAUSE_MS = 150;  // gentle on the small-tier DB (serial + paced)

const MIME_EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel": ".xls",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "text/plain": ".txt",
  "message/rfc822": ".eml",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authorize(req: Request): boolean {
  if (!SHARED_SECRET) return true; // local dev / unset → permissive (matches availability-checker)
  const auth = req.headers.get("authorization") || "";
  const xkey = req.headers.get("x-lcc-key") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return bearer === SHARED_SECRET || xkey === SHARED_SECRET;
}

function safeName(fileName: string | null, mimeType: string | null): string {
  const fallbackExt = MIME_EXT[(mimeType || "application/pdf").toLowerCase()] || ".bin";
  let safe = String(fileName || "upload")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "upload";
  if (!/\.[a-z0-9]{2,6}$/i.test(safe)) safe += fallbackExt;
  return safe;
}

function restHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "apikey": OPS_KEY,
    "Authorization": `Bearer ${OPS_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "GET (dry-run) or POST (offload) only" }, 405);
  }
  if (!authorize(req)) return json({ error: "unauthorized" }, 401);
  if (!OPS_URL || !OPS_KEY) return json({ error: "ops_credentials_missing" }, 503);

  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { body = {}; }
  }
  const url = new URL(req.url);
  const qp = (k: string) => body[k] ?? url.searchParams.get(k);

  const bucket = String(qp("bucket") || DEFAULT_BUCKET);
  const graceMinutes = Math.max(0, parseInt(String(qp("grace_minutes") ?? DEFAULT_GRACE_MIN), 10) || DEFAULT_GRACE_MIN);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(qp("limit") ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const dryRun = req.method === "GET" || qp("dry_run") === true || String(qp("dry_run")) === "true";
  const cutoffIso = new Date(Date.now() - graceMinutes * 60_000).toISOString();

  // 1. List eligible rows (NOT selecting inline_data — multi-MB base64).
  const listUrl =
    `${OPS_URL}/rest/v1/staged_intake_artifacts` +
    `?select=id,file_name,mime_type,size_bytes,created_at` +
    `&inline_data=not.is.null&storage_path=is.null` +
    `&created_at=lt.${encodeURIComponent(cutoffIso)}` +
    `&order=size_bytes.desc.nullslast&limit=${limit}`;
  const listRes = await fetch(listUrl, { headers: restHeaders({ Prefer: "count=exact" }) });
  if (!listRes.ok) {
    const detail = await listRes.text().catch(() => "");
    return json({ error: "artifact_list_failed", status: listRes.status, detail: detail.slice(0, 300) }, 502);
  }
  const rows = await listRes.json() as Array<{ id: string | number; file_name: string | null; mime_type: string | null; size_bytes: number | null; created_at: string | null }>;
  const totalHeader = listRes.headers.get("content-range") || "";
  const eligibleTotal = totalHeader.includes("/") ? parseInt(totalHeader.split("/")[1], 10) : null;

  if (dryRun) {
    return json({
      mode: "dry_run",
      bucket,
      grace_minutes: graceMinutes,
      eligible_now: rows.length,
      eligible_total: eligibleTotal,
      sample: rows.slice(0, 10).map((r) => ({ id: r.id, file_name: r.file_name, size_bytes: r.size_bytes })),
    });
  }

  // 2. Offload serially, paced, in-region.
  const startedAt = Date.now();
  const stats = { scanned: 0, offloaded: 0, skipped_empty: 0, errored: 0, bytes_freed: 0 };
  const failures: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    stats.scanned++;
    try {
      // 2a. Fetch this row's bytes only.
      const oneRes = await fetch(
        `${OPS_URL}/rest/v1/staged_intake_artifacts?select=inline_data&id=eq.${encodeURIComponent(String(row.id))}`,
        { headers: restHeaders() },
      );
      const oneJson = oneRes.ok ? await oneRes.json() : [];
      const inline = Array.isArray(oneJson) && oneJson[0]?.inline_data;
      if (!inline) { stats.skipped_empty++; continue; }

      const bytes = base64ToBytes(inline);
      if (!bytes.length) { stats.skipped_empty++; continue; }

      // 2b. Deterministic object path keyed by row id (re-run-safe).
      const datePart = new Date(row.created_at || Date.now()).toISOString().slice(0, 10);
      const objectPath = `${datePart}/${row.id}-${safeName(row.file_name, row.mime_type)}`;
      const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
      const fullPath = `${bucket}/${objectPath}`;

      // 2c. Upload to Storage (in-region; x-upsert so re-runs are safe).
      const upRes = await fetch(
        `${OPS_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
        {
          method: "POST",
          headers: {
            "apikey": OPS_KEY,
            "Authorization": `Bearer ${OPS_KEY}`,
            "Content-Type": row.mime_type || "application/octet-stream",
            "x-upsert": "true",
          },
          body: bytes,
        },
      );
      if (!upRes.ok) {
        const detail = await upRes.text().catch(() => "");
        stats.errored++;
        failures.push({ id: row.id, status: upRes.status, detail: detail.slice(0, 200) });
        continue;
      }

      // 2d. Point the row at Storage, drop inline. Guarded on storage_path IS NULL.
      const patchRes = await fetch(
        `${OPS_URL}/rest/v1/staged_intake_artifacts?id=eq.${encodeURIComponent(String(row.id))}&storage_path=is.null`,
        {
          method: "PATCH",
          headers: restHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({ storage_path: fullPath, inline_data: null }),
        },
      );
      if (!patchRes.ok) {
        const detail = await patchRes.text().catch(() => "");
        stats.errored++;
        failures.push({ id: row.id, status: patchRes.status, detail: detail.slice(0, 200) || "patch_failed" });
        continue;
      }

      stats.offloaded++;
      stats.bytes_freed += bytes.length;
    } catch (err) {
      stats.errored++;
      failures.push({ id: row.id, detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
    }
    await sleep(PER_ROW_PAUSE_MS);
  }

  return json({
    mode: "offload",
    bucket,
    grace_minutes: graceMinutes,
    eligible_total: eligibleTotal,
    ...stats,
    bytes_freed_pretty: `${(stats.bytes_freed / 1024 / 1024).toFixed(1)} MB`,
    elapsed_ms: Date.now() - startedAt,
    failures: failures.slice(0, 20),
  });
});
