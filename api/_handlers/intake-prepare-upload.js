// api/_handlers/intake-prepare-upload.js
// Handler for Copilot action: intake.prepare_upload.v1
//
// Mints a Supabase Storage signed-upload URL so clients (Power Automate,
// the Chrome extension, the bot, or any future caller) can PUT bytes
// directly to storage without routing the payload through Vercel.
//
// Flow:
//   1. Client POSTs { file_name, mime_type, intake_channel } here.
//   2. We call Supabase Storage's /object/upload/sign endpoint using the
//      service-role key. Supabase returns { url, token }.
//   3. We return { storage_path, upload_url, upload_token, expires_at } to
//      the client. They PUT the file bytes at upload_url with
//      Authorization: Bearer <upload_token> (or x-upsert: true header for
//      newer Supabase SDK flows).
//   4. Client then calls intake.stage.om.v1 with { storage_path }.
//
// Bucket used: "lcc-om-uploads" — create via Supabase Studio first.

import { fetchWithTimeout } from '../_shared/ops-db.js';
import { getDomainCredentials } from '../_shared/domain-db.js';
import { randomUUID } from 'crypto';

const BUCKET = 'lcc-om-uploads';
const PROPERTY_DOC_BUCKET = 'property-documents';   // UW#6-REV — per-domain, retained
const SIGNED_URL_TTL_SECONDS = 3600;   // signed upload URLs are valid 1 hour

// Doctypes the deep-parser knows; everything else is filed as 'other' (triage).
const KNOWN_DOCTYPES = new Set(['deed', 'lease', 'om', 'dd', 'master', 'bov', 'brochure', 'comp', 'survey', 'other']);
function normalizeDoctype(d) {
  const v = String(d || '').toLowerCase().trim();
  return KNOWN_DOCTYPES.has(v) ? v : 'other';
}
function sanitizeSegment(s, fallback) {
  const v = String(s || '').replace(/[^\w.\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return v || fallback;
}

/**
 * @param {object} args
 * @param {object} args.inputs
 * @param {string} args.inputs.file_name     — original filename incl. extension
 * @param {string} [args.inputs.mime_type]   — defaults to application/pdf
 * @param {string} [args.inputs.intake_channel] — for logging/audit
 * @param {object} args.authContext          — { email, ... }
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleIntakePrepareUpload({ inputs, authContext }) {
  if (!inputs?.file_name || typeof inputs.file_name !== 'string') {
    return {
      status: 400,
      body: {
        error: 'missing_file_name',
        detail: 'file_name (string) is required, e.g. "123-Main-OM.pdf"',
      },
    };
  }
  if (!authContext?.email) {
    return {
      status: 401,
      body: { error: 'missing_caller_identity' },
    };
  }

  // ── UW#6-REV: per-domain property-documents upload ──────────────────────────
  // The sidebar captured a deed/lease/OM PDF's bytes in-session and needs a
  // signed URL to PUT them into the DOMAIN's retained `property-documents` bucket
  // (co-located with the property_documents row). The domain service key never
  // leaves the server. Unset target ⇒ the original OM path below (LCC bucket).
  if (inputs.target === 'property_document' || String(inputs.bucket || '') === PROPERTY_DOC_BUCKET) {
    const creds = getDomainCredentials(String(inputs.domain || '').toLowerCase());
    if (!creds) {
      return { status: 400, body: { error: 'bad_domain', detail: `domain must be dia/gov (got "${inputs.domain}")` } };
    }
    const dom = /^(dia|dialysis)$/i.test(inputs.domain) ? 'dia' : 'gov';
    const doctype = normalizeDoctype(inputs.doctype);
    const pid = sanitizeSegment(inputs.property_id, 'unknown');
    const objKey = sanitizeSegment(inputs.content_hash, '') || randomUUID();
    const ext = (/\.([a-z0-9]{2,6})$/i.exec(inputs.file_name || '')?.[1] || 'pdf').toLowerCase();
    const objectPath = `${dom}/${doctype}/${pid}/${objKey}.${ext}`;  // deterministic, idempotent on re-capture
    const minted = await mintSignedUpload({ supabaseUrl: creds.url, serviceKey: creds.key, bucket: PROPERTY_DOC_BUCKET, objectPath });
    if (!minted.ok) return { status: minted.status, body: minted.body };
    return {
      status: 200,
      body: {
        ok: true,
        storage_path: objectPath,               // WITHIN the bucket; notify carries storage_bucket separately
        storage_bucket: PROPERTY_DOC_BUCKET,
        domain: dom,
        doctype,
        upload_url: minted.uploadUrl,
        upload_method: 'PUT',
        upload_token: minted.token,
        upload_headers: { 'x-upsert': 'true' },
        expires_at: minted.expiresAt,
        max_bytes: 100 * 1024 * 1024,
        instructions: [
          '1. PUT the file bytes to upload_url with the listed upload_headers.',
          '2. POST /api/intake/document-notify { domain, property_id, doctype, file_name, source_url, content_hash, storage_path, storage_bucket }.',
        ],
      },
    };
  }

  const supabaseUrl = process.env.OPS_SUPABASE_URL;
  const serviceKey  = process.env.OPS_SUPABASE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return {
      status: 503,
      body: {
        error: 'storage_not_configured',
        detail: 'OPS_SUPABASE_URL / OPS_SUPABASE_KEY missing from environment.',
      },
    };
  }

  // ---- 1. Build a unique storage path keyed by date + UUID + sanitized name
  const today = new Date().toISOString().slice(0, 10);           // YYYY-MM-DD

  // Infer an extension from the MIME type when the file_name doesn't have one.
  // Supabase Storage and most CDNs gate on path extension; missing extensions
  // sometimes cause the object to be written but unreadable via REST fetch.
  const mimeExtMap = {
    'application/pdf':                                                    '.pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':  '.xlsx',
    'application/vnd.ms-excel':                                           '.xls',
    'application/msword':                                                 '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  };
  const fallbackExt = mimeExtMap[(inputs.mime_type || 'application/pdf').toLowerCase()] || '.bin';

  let safeName = inputs.file_name
    .replace(/[^\w.\-]+/g, '-')     // strip spaces + symbols
    .replace(/^-+|-+$/g, '')        // trim leading/trailing dashes
    .slice(0, 120) || 'upload';

  // Guarantee an extension; sidebar doc-card labels often don't include one.
  if (!/\.[a-z0-9]{2,6}$/i.test(safeName)) {
    safeName += fallbackExt;
  }

  const objectId = randomUUID();
  const objectPath = `${today}/${objectId}-${safeName}`;          // within the bucket
  const fullPath   = `${BUCKET}/${objectPath}`;                   // bucket + path (what stageOmIntake stores)

  // ---- 2-4. Mint the signed upload URL (shared with the property-doc path)
  const minted = await mintSignedUpload({ supabaseUrl, serviceKey, bucket: BUCKET, objectPath });
  if (!minted.ok) return { status: minted.status, body: minted.body };
  const uploadUrl = minted.uploadUrl;
  const derivedToken = minted.token;
  const expiresAt = minted.expiresAt;

  return {
    status: 200,
    body: {
      ok:            true,
      storage_path:  fullPath,                      // what the caller passes to stage-om later
      upload_url:    uploadUrl,                     // PUT the bytes here
      upload_method: 'PUT',
      upload_token:  derivedToken,                  // exposed only for callers
                                                    // that PUT without the
                                                    // ?token in the URL; the
                                                    // default flow doesn't
                                                    // need it.
      upload_headers: {
        // Supabase's signed-upload flow authenticates via the `?token=` in
        // the URL only. Do NOT add an Authorization header — when both
        // Authorization and ?token are present, Supabase's auth middleware
        // decodes Authorization as a JWT, fails, and silently discards the
        // request body while still returning 200 OK and Content-Length: 0.
        // storage-js's uploadToSignedUrl uses only these two headers.
        'x-upsert':   'true',                       // overwrite if path collides
      },
      bucket:        BUCKET,
      object_path:   objectPath,
      expires_at:    expiresAt,
      max_bytes:     100 * 1024 * 1024,             // 100 MB recommended cap
      instructions: [
        `1. PUT your file bytes to upload_url with the listed upload_headers.`,
        `2. After the upload succeeds (HTTP 200), POST to /api/intake/stage-om with { "artifacts": { "primary_document": { "storage_path": "${fullPath}", "file_name": "${inputs.file_name}" } } }`,
      ],
    },
  };
}

/**
 * Mint a Supabase Storage signed-upload URL for any project/bucket/path.
 * Shared by the OM (LCC) path and the per-domain property-documents path.
 * Returns { ok:true, uploadUrl, token, expiresAt } or
 * { ok:false, status, body } (a ready-to-return error envelope).
 */
async function mintSignedUpload({ supabaseUrl, serviceKey, bucket, objectPath }) {
  const signEndpoint = `${supabaseUrl}/storage/v1/object/upload/sign/${bucket}/${objectPath}`;
  const signRes = await fetchWithTimeout(signEndpoint, {
    method: 'POST',
    headers: {
      'apikey':        serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
  }, 8000);

  const signText = await signRes.text();
  let signJson = null;
  try { signJson = signText ? JSON.parse(signText) : null; } catch { /* keep text for error */ }

  if (!signRes.ok || !signJson?.url) {
    return {
      ok: false,
      status: signRes.status === 404 ? 500 : signRes.status || 500,
      body: {
        error: 'signed_url_mint_failed',
        detail: signJson?.message || signJson?.error || signText?.slice(0, 300) || 'Supabase Storage signed-URL endpoint returned no data',
        hint: signRes.status === 404
          ? `Bucket "${bucket}" may not exist yet. Create it in Supabase Studio → Storage.`
          : 'Check that the service key has storage:write permissions (service role).',
      },
    };
  }

  // Supabase returns a relative `/object/upload/sign/...?token=JWT`. The client
  // PUTs to https://<project>.supabase.co/storage/v1{url}. The token is embedded
  // in the URL query string; we also surface it for callers that need it.
  const uploadUrl = `${supabaseUrl}/storage/v1${signJson.url}`;
  let token = signJson.token || null;
  if (!token) {
    try { token = new URL(uploadUrl).searchParams.get('token'); } catch { /* fall through */ }
  }
  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  return { ok: true, uploadUrl, token, expiresAt };
}
