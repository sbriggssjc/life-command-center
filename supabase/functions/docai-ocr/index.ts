// ============================================================================
// docai-ocr — Google Document AI OCR wrapper (the cheap-cloud OCR seam)
// Life Command Center — Supabase Edge Function (UW#4c, 2026-06-21)
//
// WHY THIS EXISTS:
// UW#4b built the tiered lease/deed OCR seam — free OSS (workstation) →
// `ocrCloudCheap` (the OCR_CLOUD_OCR_URL HTTP seam) → gpt-4o LAST RESORT — but
// the cheap-cloud provider was never wired (no creds). This is that wrapper.
// Document AI is at-least-equal quality to gpt-4o for typed/printed scanned
// deeds + leases and ~20-60× cheaper (~$1.50/1k pages; $0 under Google's $300
// new-account credit). gpt-4o stays the gated last resort for the hard tail
// (handwriting / poor scans).
//
// It is the SHAREPOINT_FETCH_URL webhook-adapter pattern (a thin HTTP flow, no
// new server SDK / always-on dependency). `ocrCloudCheap` POSTs base64 here and
// reads back { text, confidence, pages } — the exact shape it already expects;
// this function just fills the provider in. NOT a new api/*.js (≤12 holds).
//
// CONTRACT (what ocrCloudCheap sends / expects back):
//   POST /functions/v1/docai-ocr
//     body: { content_base64, mime_type? | media_type?, provider? }
//     →    { ok:true, text, confidence|null, pages, engine:"google_docai" }
//     →    { ok:false, reason, status? }   (never throws to the caller)
//   GET  /functions/v1/docai-ocr  → { ok:true, ready, configured } (health, no spend)
//
// AUTH (mirrors _shared/auth.ts): a shared secret in the Authorization: Bearer
// header (set OCR_CLOUD_OCR_KEY on Railway == DOCAI_SHARED_SECRET / LCC_API_KEY
// here) OR X-LCC-Key. When no secret env is set the function runs transitional
// (allow + warn), same posture as the rest of the edge layer.
//
// GCP AUTH: a service-account key held server-side (Scott provisions). The SA
// JSON is read from GOOGLE_DOCAI_SA_KEY; we mint a short-lived OAuth2 access
// token (RS256 JWT → token endpoint) via Web Crypto, cached in-process until
// near expiry. The Document AI Enterprise Document OCR processor is addressed by
// GOOGLE_DOCAI_PROCESSOR (full resource name) or the PROJECT/LOCATION/ID parts.
//
// COST: Document AI bills per PAGE. The response carries `pages`; the callers
// (lease-extractor / lease-backfill / document-text worker) aggregate pages ×
// provider per tick so the spend is observable.
//
// ── DOC8 (2026-09-01) — THE SYNC PAGE CAP WAS SENDING LEASES TO gpt-4o ───────
// Measured across every OCR row the CRE lane has produced: gpt-4o served 19 of
// 22 (86%) at avg 1,579 chars against DocAI's 14,687 — the EXPENSIVE tier
// returning 9.3× LESS text, minimum 31 characters. Read from this function's
// own log rather than guessed, the cause is not the documented Custom-Extractor
// footgun (the processor is the correct Enterprise Document OCR one):
//
//   "Document pages in non-imageless mode exceed the limit: 15 got 19.
//    Try using imageless mode to increase the limit to 30."  PAGE_LIMIT_EXCEEDED
//
// Google's own error names the fix. `imagelessMode` is a TOP-LEVEL boolean on
// ProcessRequest — NOT under processOptions.ocrConfig — verified against the
// live v1 discovery document (documentai.googleapis.com/$discovery/rest?version=v1,
// read 2026-09-01): GoogleCloudDocumentaiV1ProcessRequest.imagelessMode, type
// boolean, "Optional. Option to remove images from the document." It suppresses
// the rendered page IMAGE (Document.pages[].image) only; pages[].layout,
// .tokens and .textAnchor — everything pageTextsFromDoc and meanConfidence read
// — are separate fields and are unaffected.
//
// ⚠️ 30 IS STILL A CAP. A lease over 30 pages is completely ordinary. The CALLER
// does a pdf-parse page pre-flight and writes a named, dated `over_docai_page_cap`
// marker rather than falling silently through to gpt-4o (which, measured, returns
// a fragment on exactly this class). This function's job is to report the cap
// honestly: an over-cap 400 comes back `reason:'over_page_cap'` carrying the page
// count Google names in the error, so the caller learns the true page count even
// though nothing was processed.
//
// ⚠️ SAFE DEPLOY: a processor that rejects the field must not break the ≤15-page
// path that works today, so an INVALID_ARGUMENT naming `imagelessMode` retries
// ONCE without it. `DOCAI_IMAGELESS_MODE=false` is the kill switch.
// ============================================================================

// ── Env ─────────────────────────────────────────────────────────────────────
const SA_KEY_RAW =
  Deno.env.get("GOOGLE_DOCAI_SA_KEY") ||
  Deno.env.get("GOOGLE_DOCAI_SERVICE_ACCOUNT") ||
  Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") ||
  "";

const PROCESSOR_NAME = Deno.env.get("GOOGLE_DOCAI_PROCESSOR") || "";        // full: projects/.../locations/.../processors/...
const PROJECT_ID = Deno.env.get("GOOGLE_DOCAI_PROJECT_ID") || "";
const LOCATION = (Deno.env.get("GOOGLE_DOCAI_LOCATION") || "us").toLowerCase();
const PROCESSOR_ID = Deno.env.get("GOOGLE_DOCAI_PROCESSOR_ID") || "";

const SHARED_SECRET =
  Deno.env.get("DOCAI_SHARED_SECRET") ||
  Deno.env.get("OCR_CLOUD_OCR_KEY") ||
  Deno.env.get("LCC_API_KEY") ||
  "";

// DOC8: imageless mode raises the SYNCHRONOUS page cap 15 -> 30 on Enterprise
// Document OCR. Default ON; set DOCAI_IMAGELESS_MODE=false to fall back.
const IMAGELESS_MODE = String(Deno.env.get("DOCAI_IMAGELESS_MODE") ?? "true").toLowerCase() !== "false";

// Google's caps, reported so the caller's pre-flight and this function agree on
// one number. These are DOCUMENTED LIMITS, not guards we enforce — the only
// thing that can count a PDF's pages is something that parses the PDF, and this
// function is handed base64. `DOCAI_MAX_PAGES` used to sit here as a const that
// was never once read; a constant wearing a guard's clothes is worse than none.
export const DOCAI_SYNC_PAGE_CAP = 15;
export const DOCAI_SYNC_PAGE_CAP_IMAGELESS = 30;

const MAX_BYTES = Number(Deno.env.get("DOCAI_MAX_BYTES") || 20_000_000);

// ── Resolve the processor resource name ──────────────────────────────────────
function processorResourceName(saProjectId: string): string {
  if (PROCESSOR_NAME) return PROCESSOR_NAME;
  const project = PROJECT_ID || saProjectId;
  if (project && PROCESSOR_ID) {
    return `projects/${project}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;
  }
  return "";
}

function docaiEndpoint(resourceName: string): string {
  // The location is the segment after /locations/ in the resource name.
  const m = resourceName.match(/\/locations\/([^/]+)\//);
  const loc = (m && m[1]) || LOCATION;
  return `https://${loc}-documentai.googleapis.com/v1/${resourceName}:process`;
}

// ── base64url helpers ─────────────────────────────────────────────────────────
function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlFromString(s: string): string {
  return b64urlFromBytes(new TextEncoder().encode(s));
}
function pemToPkcs8Bytes(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Service-account OAuth2 access token (RS256 JWT → token endpoint) ──────────
interface SAKey { client_email: string; private_key: string; token_uri?: string; project_id?: string }

let _sa: SAKey | null = null;
function loadSa(): SAKey | null {
  if (_sa) return _sa;
  if (!SA_KEY_RAW) return null;
  try {
    _sa = JSON.parse(SA_KEY_RAW) as SAKey;
    return _sa;
  } catch (err) {
    console.error("[docai-ocr] GOOGLE_DOCAI_SA_KEY is not valid JSON:", (err as Error)?.message);
    return null;
  }
}

let _token: { value: string; exp: number } | null = null;
async function getAccessToken(sa: SAKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_token && _token.exp - 60 > now) return _token.value;        // reuse until ~1 min before expiry

  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const header = b64urlFromString(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlFromString(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8Bytes(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64urlFromBytes(new Uint8Array(sigBuf))}`;

  const resp = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`token_exchange_${resp.status}:${detail.slice(0, 200)}`);
  }
  const tok = await resp.json();
  _token = { value: tok.access_token, exp: now + (Number(tok.expires_in) || 3600) };
  return _token.value;
}

// ── Confidence aggregation from a Document AI response ───────────────────────
// The OCR processor reports per-token (and per-block) layout confidence (0-1).
// Mean token confidence × 100 is the honest OCR-quality signal; fall back to
// block confidence, else null (caller treats null as "not flagged low").
function meanConfidence(doc: Record<string, unknown>): number | null {
  const pages = (doc?.pages as Array<Record<string, unknown>>) || [];
  let sum = 0, n = 0;
  for (const p of pages) {
    for (const grp of ["tokens", "blocks", "lines"]) {
      const items = (p?.[grp] as Array<Record<string, unknown>>) || [];
      for (const it of items) {
        const c = (it?.layout as Record<string, unknown>)?.confidence;
        if (typeof c === "number") { sum += c; n += 1; }
      }
      if (n > 0) break;   // prefer the finest granularity that exists on this page
    }
  }
  if (n === 0) return null;
  return Math.round((sum / n) * 1000) / 10;   // 0-100, one decimal
}

// ── Per-page text (R58 Unit 4 — clause_ref PAGE anchors) ─────────────────────
// Document AI returns document.text (one concatenated string) plus, per page, a
// layout.textAnchor.textSegments[] of {startIndex,endIndex} offsets INTO that
// string. Slice the full text by each page's segments to recover per-page text.
// int64 fields arrive as STRINGS in the JSON, so coerce with Number() before
// slicing. Returns [{page, text}]; empty array when the shape isn't present —
// additive, so callers that ignore page_texts are unchanged.
function pageTextsFromDoc(doc: Record<string, unknown>): Array<{ page: number; text: string }> {
  const fullText = String(doc?.text || "");
  const pages = (doc?.pages as Array<Record<string, unknown>>) || [];
  const out: Array<{ page: number; text: string }> = [];
  pages.forEach((p, i) => {
    const pageNumber = Number((p?.pageNumber as number | string) ?? i + 1) || i + 1;
    const layout = (p?.layout as Record<string, unknown>) || {};
    const anchor = (layout?.textAnchor as Record<string, unknown>) || {};
    const segments = (anchor?.textSegments as Array<Record<string, unknown>>) || [];
    let text = "";
    for (const seg of segments) {
      const start = Number(seg?.startIndex ?? 0);   // int64 → string in JSON
      const end = Number(seg?.endIndex ?? 0);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        text += fullText.slice(start, end);
      }
    }
    out.push({ page: pageNumber, text: text.trim() });
  });
  return out;
}

// ── DOC8 — the Document AI call, and the two things its errors tell us ───────

/**
 * POST one document to the processor. `imageless` sets ProcessRequest.imagelessMode
 * (a TOP-LEVEL boolean, verified against the live v1 discovery document — it is
 * NOT under processOptions.ocrConfig, which is where an OcrConfig flag would go).
 * It raises the synchronous page cap 15 -> 30 by dropping the rendered page
 * images from the response; layout / tokens / textAnchor are untouched, so
 * pageTextsFromDoc and meanConfidence keep working.
 */
function callDocai(
  resourceName: string,
  token: string,
  contentB64: string,
  mimeType: string,
  imageless: boolean,
): Promise<Response> {
  return fetch(docaiEndpoint(resourceName), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      skipHumanReview: true,
      rawDocument: { content: contentB64, mimeType },
      ...(imageless ? { imagelessMode: true } : {}),
    }),
  });
}

/**
 * Does this 400 body say the processor does not know the `imagelessMode` field?
 * The shape a REST endpoint returns for an unrecognised field is
 * `Invalid JSON payload received. Unknown name "imagelessMode": Cannot find field.`
 * (googleapis/google-cloud-ruby#26951 hit exactly this on an older API surface).
 * Deliberately NARROW — it must not swallow PAGE_LIMIT_EXCEEDED or a quota error
 * and silently re-bill a second call.
 */
export function rejectsImagelessMode(detail: string): boolean {
  const d = String(detail || "");
  if (!/imagelessMode|imageless_mode/i.test(d)) return false;
  return /Unknown name|Cannot find field|INVALID_ARGUMENT|not supported|unsupported/i.test(d);
}

/**
 * Pull the page count out of a PAGE_LIMIT_EXCEEDED body:
 *   "Document pages in non-imageless mode exceed the limit: 15 got 19."
 * Returns { limit: 15, got: 19 }. Either half is null when absent — an absent
 * count is NULL, never 0 (P180), because 0 pages is a different, real answer.
 */
export function pageLimitFromError(detail: string): { limit: number | null; got: number | null } {
  const d = String(detail || "");
  const m = /exceed(?:s)? the limit:\s*(\d+)\s*got\s*(\d+)/i.exec(d);
  if (m) return { limit: Number(m[1]), got: Number(m[2]) };
  const g = /\bgot\s+(\d+)\b/i.exec(d);
  const l = /\blimit:?\s*(\d+)\b/i.exec(d);
  return { limit: l ? Number(l[1]) : null, got: g ? Number(g[1]) : null };
}

// ── Auth on this endpoint (shared secret) ────────────────────────────────────
function authorized(req: Request): boolean {
  if (!SHARED_SECRET) {
    console.warn("[docai-ocr] no DOCAI_SHARED_SECRET/OCR_CLOUD_OCR_KEY/LCC_API_KEY set — running transitional (open)");
    return true;
  }
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const xkey = req.headers.get("x-lcc-key") || "";
  return constantEq(bearer, SHARED_SECRET) || constantEq(xkey, SHARED_SECRET);
}
function constantEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let m = 0;
  for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return m === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const sa = loadSa();
  const resourceName = sa ? processorResourceName(sa.project_id || "") : processorResourceName("");
  const configured = !!(sa && resourceName);

  if (req.method === "GET") {
    // Health probe — no GCP call, no spend.
    return json({ ok: true, engine: "google_docai", ready: configured, configured,
      // 2026-08-12 diag: expose WHICH processor is configured (resource name is not a
      // secret) — an `entity_types` INVALID_ARGUMENT on documents:process means this
      // points at a Custom Extractor, not the Enterprise Document OCR processor.
      processor: resourceName || null,
      // DOC8: which sync page cap is in force, so a caller's pre-flight and this
      // function can never disagree about the number silently.
      imageless_mode: IMAGELESS_MODE,
      page_cap: IMAGELESS_MODE ? DOCAI_SYNC_PAGE_CAP_IMAGELESS : DOCAI_SYNC_PAGE_CAP,
      missing: configured ? [] : [
        ...(sa ? [] : ["GOOGLE_DOCAI_SA_KEY"]),
        ...(resourceName ? [] : ["GOOGLE_DOCAI_PROCESSOR (or PROJECT_ID+PROCESSOR_ID)"]),
      ] });
  }
  if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);
  if (!authorized(req)) return json({ ok: false, reason: "unauthorized" }, 401);
  if (!configured) return json({ ok: false, reason: "docai_unconfigured" }, 503);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, reason: "bad_json" }, 400); }

  const contentB64 = String(body?.content_base64 || body?.content || "");
  if (!contentB64) return json({ ok: false, reason: "no_content" }, 400);
  // mime_type is the documented field; media_type is what the existing seam sends.
  const mimeType = String(body?.mime_type || body?.media_type || "application/pdf");

  // Per-request cost guard: reject an over-cap doc up front (the sync OCR
  // processor caps at ~15 pages anyway) instead of erroring mid-process.
  const approxBytes = Math.floor((contentB64.length * 3) / 4);
  if (approxBytes > MAX_BYTES) return json({ ok: false, reason: "over_byte_cap", bytes: approxBytes }, 413);

  let token: string;
  try { token = await getAccessToken(sa!); }
  catch (err) {
    console.error("[docai-ocr] token error:", (err as Error)?.message);
    return json({ ok: false, reason: `auth_failed:${(err as Error)?.message || "err"}` }, 502);
  }

  // DOC8: request imageless mode (sync cap 15 -> 30). Retries ONCE without it if
  // this processor rejects the field, so the deploy cannot break the path that
  // already works.
  let imagelessUsed = IMAGELESS_MODE;
  let dResp: Response;
  try {
    dResp = await callDocai(resourceName, token, contentB64, mimeType, imagelessUsed);
    if (!dResp.ok && imagelessUsed) {
      const peek = await dResp.clone().text().catch(() => "");
      if (rejectsImagelessMode(peek)) {
        console.warn("[docai-ocr] processor rejected imagelessMode — retrying without it:", peek.slice(0, 300));
        imagelessUsed = false;
        dResp = await callDocai(resourceName, token, contentB64, mimeType, false);
      }
    }
  } catch (err) {
    return json({ ok: false, reason: `docai_fetch_threw:${(err as Error)?.message || "err"}` }, 502);
  }

  if (!dResp.ok) {
    const detail = await dResp.text().catch(() => "");
    console.error(`[docai-ocr] Document AI ${dResp.status} (processor=${resourceName}, imageless=${imagelessUsed}):`, detail.slice(0, 800));
    // PAGE_LIMIT_EXCEEDED comes back 400 — surface it distinctly so the tiered
    // seam can fall through to the gpt-4o last resort on a too-big scan.
    const overPageCap = /PAGE_LIMIT_EXCEEDED|exceed(s)? the limit/i.test(detail);
    const reason = overPageCap ? "over_page_cap" : `docai_${dResp.status}`;
    // ⚠️ The error carries the ONLY page count anyone gets on this path: nothing
    // was processed, so there is no document to count. Pass it back rather than
    // discarding it — the caller records a real page count on its marker instead
    // of a NULL that reads as "we never looked" (P180: unknown is not zero).
    const limits = overPageCap ? pageLimitFromError(detail) : null;
    return json({
      ok: false, reason, status: dResp.status,
      imageless: imagelessUsed,
      ...(limits?.got != null ? { pages: limits.got } : {}),
      ...(limits?.limit != null ? { page_limit: limits.limit } : {}),
    }, 502);
  }

  let data: Record<string, unknown>;
  try { data = await dResp.json(); } catch { return json({ ok: false, reason: "docai_bad_json" }, 502); }

  const doc = (data?.document as Record<string, unknown>) || {};
  const text = String(doc?.text || "").trim();
  const pages = Array.isArray(doc?.pages) ? (doc.pages as unknown[]).length : 0;
  if (!text) return json({ ok: false, reason: "docai_empty", pages });

  // R58 Unit 4 — per-page text for clause_ref PAGE anchors. Wrapped so a shape
  // surprise can NEVER turn a good OCR into a 502; on any error the field is [].
  let pageTexts: Array<{ page: number; text: string }> = [];
  try { pageTexts = pageTextsFromDoc(doc); }
  catch (err) { console.error("[docai-ocr] pageTextsFromDoc failed:", (err as Error)?.message); }

  return json({
    ok: true,
    engine: "google_docai",
    text,
    confidence: meanConfidence(doc),
    pages,
    page_texts: pageTexts,
    // Which mode actually served this document. `imageless:false` on a build
    // where IMAGELESS_MODE is true means the processor rejected the field and
    // the fallback ran — i.e. this document was still capped at 15 pages.
    imageless: imagelessUsed,
  });
});
