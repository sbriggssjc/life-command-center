// ============================================================================
// docai-page-probe — DOC17: one measured answer, then nothing (2026-09-02)
//
// ⚠️ THIS IS A PROBE, NOT A LANE, and it is DELIBERATELY a SEPARATE edge
// function from `docai-ocr` so the live drain path cannot be touched by it:
//   * `docai-ocr` is unchanged — it still sends NO `processOptions` at all.
//   * nothing calls this on a schedule: no cron row, no caller in `api/`.
//   * it WRITES NOTHING. No table, no marker, no sidecar. The 42 documents
//     carrying `over_docai_page_cap` are read-only inputs here.
//
// It settles ONE question that cannot be settled by reading: for a page
// selection that does NOT start at page 1, is Document AI's synchronous page
// limit measured against the SELECTION or against the DOCUMENT TOTAL?
//   * Google's Limits page constrains only the EXTENDED (imageless, 30pp) cap —
//     "only applicable when processing pages contiguously starting from page 1".
//     It says nothing about the BASE 15-page cap under a non-page-1 selection.
//   * The v1 discovery document states no page limits at all. It is a schema,
//     not a quota surface, so that zero is a property of the instrument.
//   * DOC8's `{page_limit:"30", pages:"40"}` was taken with NO selector, where
//     selection and total are the same number — it discriminates nothing.
//
// TWO ARMS, AND THE SECOND IS THE POINT (DOC17 §3):
//   "mid"   individualPageSelector {pages:[31..45]} — 15 pages, base cap
//   "start" fromStart: 15                          — POSITIVE CONTROL
// Same document, imageless OFF on both. If the control fails too, the selector
// is being ignored or misplaced and the first arm's failure means nothing —
// that is the DOC8 silent-no-op shape, and a single failing call cannot tell
// "not allowed" from "not read".
//
// FIELD PLACEMENT, read from the schema rather than inferred:
//   ProcessRequest.processOptions -> ProcessOptions{ individualPageSelector |
//   fromStart | fromEnd } — a `oneof page_range`, "only applies to online
//   processing with ProcessDocument".
//   ⚠️ `imagelessMode` is a TOP-LEVEL ProcessRequest boolean and is NOT beside
//   these; they are different fields at different levels.
//
// IT NEVER RETURNS DOCUMENT TEXT — only lengths, page NUMBERS and the verbatim
// error body. The page numbers are the evidence: a selector that is silently
// ignored returns pages 1..N and would otherwise read as a clean success.
// ============================================================================

const SA_KEY_RAW =
  Deno.env.get("GOOGLE_DOCAI_SA_KEY") ||
  Deno.env.get("GOOGLE_DOCAI_SERVICE_ACCOUNT") ||
  Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") ||
  "";

const PROCESSOR_NAME = Deno.env.get("GOOGLE_DOCAI_PROCESSOR") || "";
const PROJECT_ID = Deno.env.get("GOOGLE_DOCAI_PROJECT_ID") || "";
const LOCATION = (Deno.env.get("GOOGLE_DOCAI_LOCATION") || "us").toLowerCase();
const PROCESSOR_ID = Deno.env.get("GOOGLE_DOCAI_PROCESSOR_ID") || "";

// ⚠️ ANY of the configured secrets is accepted, not the first non-empty one.
// `docai-ocr` resolves a single SHARED_SECRET with `||`, which means whichever
// env var is set first SHADOWS the others — and the probe is reached through
// `lcc_cron_post(..., 'edge')`, which sends the vault's `lcc_api_key`. Taking
// only the first would 401 a caller holding a perfectly valid key (measured:
// it did, on the first attempt).
const SHARED_SECRETS = [
  Deno.env.get("DOCAI_SHARED_SECRET") || "",
  Deno.env.get("OCR_CLOUD_OCR_KEY") || "",
  Deno.env.get("LCC_API_KEY") || "",
].filter(Boolean);

const SHAREPOINT_FETCH_URL = Deno.env.get("SHAREPOINT_FETCH_URL") || "";
const OPS_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("OPS_SUPABASE_URL") || "";
const OPS_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("OPS_SUPABASE_SERVICE_KEY") ||
  Deno.env.get("SERVICE_ROLE_KEY") ||
  "";

function processorResourceName(saProjectId: string): string {
  if (PROCESSOR_NAME) return PROCESSOR_NAME;
  const project = PROJECT_ID || saProjectId;
  if (project && PROCESSOR_ID) return `projects/${project}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;
  return "";
}
function docaiEndpoint(resourceName: string): string {
  const m = resourceName.match(/\/locations\/([^/]+)\//);
  const loc = (m && m[1]) || LOCATION;
  return `https://${loc}-documentai.googleapis.com/v1/${resourceName}:process`;
}

// ── base64url + SA OAuth2 (identical mechanics to docai-ocr; duplicated here on
//    purpose so the probe cannot alter the live function's behaviour) ──────────
function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlFromString(s: string): string { return b64urlFromBytes(new TextEncoder().encode(s)); }
function pemToPkcs8Bytes(pem: string): Uint8Array {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
interface SAKey { client_email: string; private_key: string; token_uri?: string; project_id?: string }
let _sa: SAKey | null = null;
function loadSa(): SAKey | null {
  if (_sa) return _sa;
  if (!SA_KEY_RAW) return null;
  try { _sa = JSON.parse(SA_KEY_RAW) as SAKey; return _sa; } catch { return null; }
}
async function getAccessToken(sa: SAKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const header = b64urlFromString(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlFromString(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: tokenUri, iat: now, exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8Bytes(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64urlFromBytes(new Uint8Array(sigBuf))}`;
  const resp = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!resp.ok) throw new Error(`token_exchange_${resp.status}:${(await resp.text().catch(() => "")).slice(0, 200)}`);
  const tok = await resp.json();
  return tok.access_token as string;
}

// ── Bytes for the probe document ─────────────────────────────────────────────
// READ-ONLY, two sources, and the SECOND one is why this function exists in the
// shape it does.
//
// ⚠️ THE 42 `over_docai_page_cap` DOCUMENTS ARE NOT REACHABLE FROM HERE.
// All 42 are SharePoint server-relative refs, fetched by the drain through the
// Power Automate "Get Artifact" flow — and `SHAREPOINT_FETCH_URL` is a RAILWAY
// env var, not a Supabase edge secret (measured: the health probe reports
// `sharepoint_fetch_url: false`). The registry path below is kept because it is
// the right path the moment that secret is set; today it returns an honest
// `SHAREPOINT_FETCH_URL unset` rather than a silent empty result.
// So the probe reads a real long PDF out of LCC Opps storage instead — a
// document we hold, of the same kind (a net lease), which is what the question
// needs. The document's identity is irrelevant to it; its PAGE COUNT is not,
// and that is established by the baseline arm rather than assumed.
function storageObjectUrl(ref: string): string {
  const clean = String(ref || "").replace(/^\/+/, "");
  return `${OPS_URL}/storage/v1/object/${clean}`;
}

async function fetchStorageBytes(storageRef: string): Promise<{ ok: boolean; b64?: string; detail?: string }> {
  if (!OPS_URL || !OPS_KEY) return { ok: false, detail: "ops_credentials_unset" };
  const res = await fetch(storageObjectUrl(storageRef), {
    headers: { apikey: OPS_KEY, Authorization: `Bearer ${OPS_KEY}` },
  });
  if (!res.ok) return { ok: false, detail: `storage_${res.status}:${(await res.text().catch(() => "")).slice(0, 200)}` };
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;   // btoa on one 15 MB string blows the argument limit
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return { ok: true, b64: btoa(bin) };
}

async function fetchProbeBytes(documentId: number): Promise<{ ok: boolean; b64?: string; detail?: string; source_url?: string }> {
  if (!OPS_URL || !OPS_KEY) return { ok: false, detail: "ops_credentials_unset" };
  const url = `${OPS_URL}/rest/v1/lcc_cre_property_documents?select=id,file_name,source_url&id=eq.${documentId}`;
  const reg = await fetch(url, { headers: { apikey: OPS_KEY, Authorization: `Bearer ${OPS_KEY}` } });
  if (!reg.ok) return { ok: false, detail: `registry_${reg.status}` };
  const rows = await reg.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.source_url) return { ok: false, detail: "no_source_url" };
  if (!SHAREPOINT_FETCH_URL) return { ok: false, detail: "SHAREPOINT_FETCH_URL unset", source_url: row.source_url };
  const pa = await fetch(SHAREPOINT_FETCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ server_relative_url: row.source_url }),
  });
  const text = await pa.text().catch(() => "");
  let json: Record<string, unknown> | null = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (!pa.ok || !json?.content_base64) {
    return { ok: false, detail: `pa_${pa.status}:${String(json?.error || text || "").slice(0, 200)}`, source_url: row.source_url };
  }
  return { ok: true, b64: String(json.content_base64), source_url: row.source_url };
}

// ── One arm ──────────────────────────────────────────────────────────────────
// `processOptions` is passed through VERBATIM from the request so the probe
// cannot quietly rewrite the thing under test.
async function runArm(
  resourceName: string, token: string, contentB64: string, mimeType: string,
  arm: { name: string; processOptions?: Record<string, unknown>; imageless?: boolean },
): Promise<Record<string, unknown>> {
  const requestBody: Record<string, unknown> = {
    skipHumanReview: true,
    rawDocument: { content: contentB64, mimeType },
  };
  if (arm.imageless) requestBody.imagelessMode = true;
  if (arm.processOptions) requestBody.processOptions = arm.processOptions;

  const started = Date.now();
  let resp: Response;
  try {
    resp = await fetch(docaiEndpoint(resourceName), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    return { arm: arm.name, sent: { processOptions: arm.processOptions ?? null, imagelessMode: !!arm.imageless },
      ok: false, threw: (err as Error)?.message?.slice(0, 300) };
  }

  const raw = await resp.text().catch(() => "");
  if (!resp.ok) {
    // ⚠️ The whole point of the probe is the VERBATIM body, details[] included —
    // DOC8's `{page_limit, pages}` metadata is what made that diagnosis possible.
    let details: unknown = null;
    try { details = JSON.parse(raw)?.error?.details ?? null; } catch { /* keep raw */ }
    return {
      arm: arm.name,
      sent: { processOptions: arm.processOptions ?? null, imagelessMode: !!arm.imageless },
      ok: false, status: resp.status, ms: Date.now() - started,
      error_body: raw.slice(0, 2000),
      details,
    };
  }

  let doc: Record<string, unknown> = {};
  try { doc = (JSON.parse(raw)?.document as Record<string, unknown>) || {}; } catch { /* shape surprise */ }
  const pages = (doc?.pages as Array<Record<string, unknown>>) || [];
  // ⚠️ The page NUMBERS are the evidence, not the count: a selector that is
  // silently ignored returns pages 1..N and would otherwise read as a success.
  const pageNumbers = pages.map((p, i) => Number((p?.pageNumber as number | string) ?? i + 1) || i + 1);
  return {
    arm: arm.name,
    sent: { processOptions: arm.processOptions ?? null, imagelessMode: !!arm.imageless },
    ok: true, status: resp.status, ms: Date.now() - started,
    pages_returned: pages.length,
    page_numbers: pageNumbers,
    text_chars: String(doc?.text || "").length,   // never the text itself
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function constantEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let m = 0;
  for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return m === 0;
}
function authorized(req: Request): boolean {
  if (!SHARED_SECRETS.length) return true;   // same transitional posture as the rest of the edge layer
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const xkey = req.headers.get("x-lcc-key") || "";
  return SHARED_SECRETS.some((s) => constantEq(bearer, s) || constantEq(xkey, s));
}

Deno.serve(async (req: Request) => {
  const sa = loadSa();
  const resourceName = sa ? processorResourceName(sa.project_id || "") : processorResourceName("");
  const configured = !!(sa && resourceName);

  // Health: reports only PRESENCE of each input, never a value. No GCP call, no spend.
  if (req.method === "GET") {
    return json({
      ok: true, probe: "DOC17", configured, processor: resourceName || null,
      env_present: {
        sa_key: !!SA_KEY_RAW, shared_secrets: SHARED_SECRETS.length,
        sharepoint_fetch_url: !!SHAREPOINT_FETCH_URL,
        ops_url: !!OPS_URL, ops_key: !!OPS_KEY,
      },
    });
  }
  if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);
  if (!authorized(req)) return json({ ok: false, reason: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, reason: "bad_json" }, 400); }

  if (body?.mode === "health" || !configured) {
    return json({
      ok: !!configured, probe: "DOC17", configured, processor: resourceName || null,
      env_present: {
        sa_key: !!SA_KEY_RAW, shared_secrets: SHARED_SECRETS.length,
        sharepoint_fetch_url: !!SHAREPOINT_FETCH_URL,
        ops_url: !!OPS_URL, ops_key: !!OPS_KEY,
      },
    }, configured ? 200 : 503);
  }

  // Bytes: either handed in directly, or fetched read-only by registry id.
  let contentB64 = String(body?.content_base64 || "");
  let sourceUrl: string | null = null;
  const storageRef = String(body?.storage_ref || "");
  const documentId = Number(body?.document_id || 0);
  if (!contentB64 && storageRef) {
    const got = await fetchStorageBytes(storageRef);
    if (!got.ok) return json({ ok: false, reason: "storage_fetch_failed", detail: got.detail }, 502);
    contentB64 = got.b64!;
    sourceUrl = storageRef;
  }
  if (!contentB64 && documentId) {
    const got = await fetchProbeBytes(documentId);
    if (!got.ok) return json({ ok: false, reason: "fetch_failed", detail: got.detail, source_url: got.source_url ?? null }, 502);
    contentB64 = got.b64!;
    sourceUrl = got.source_url ?? null;
  }
  if (!contentB64) return json({ ok: false, reason: "no_content" }, 400);

  const mimeType = String(body?.mime_type || "application/pdf");
  const arms = (body?.arms as Array<{ name: string; processOptions?: Record<string, unknown>; imageless?: boolean }>) || [];
  if (!arms.length) return json({ ok: false, reason: "no_arms" }, 400);

  let token: string;
  try { token = await getAccessToken(sa!); }
  catch (err) { return json({ ok: false, reason: `auth_failed:${(err as Error)?.message || "err"}` }, 502); }

  const results: Array<Record<string, unknown>> = [];
  for (const arm of arms) results.push(await runArm(resourceName, token, contentB64, mimeType, arm));

  return json({
    ok: true, probe: "DOC17",
    document_id: documentId || null,
    source_url: sourceUrl,
    bytes: Math.floor((contentB64.length * 3) / 4),
    processor: resourceName,
    results,
  });
});
