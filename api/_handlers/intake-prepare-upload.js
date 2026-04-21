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
import { randomUUID } from 'crypto';

const BUCKET = 'lcc-om-uploads';
const SIGNED_URL_TTL_SECONDS = 3600;   // signed upload URLs are valid 1 hour

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
  const safeName = inputs.file_name
    .replace(/[^\w.\-]+/g, '-')     // strip spaces + symbols
    .replace(/^-+|-+$/g, '')        // trim leading/trailing dashes
    .slice(0, 120) || 'upload.pdf';
  const objectId = randomUUID();
  const objectPath = `${today}/${objectId}-${safeName}`;          // within the bucket
  const fullPath   = `${BUCKET}/${objectPath}`;                   // bucket + path (what stageOmIntake stores)

  // ---- 2. Mint the signed upload URL via Supabase Storage REST
  const signEndpoint = `${supabaseUrl}/storage/v1/object/upload/sign/${BUCKET}/${objectPath}`;
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
      status: signRes.status === 404 ? 500 : signRes.status || 500,
      body: {
        error: 'signed_url_mint_failed',
        detail: signJson?.message || signJson?.error || signText?.slice(0, 300) || 'Supabase Storage signed-URL endpoint returned no data',
        hint: signRes.status === 404
          ? `Bucket "${BUCKET}" may not exist yet. Create it in Supabase Studio → Storage.`
          : 'Check that OPS_SUPABASE_KEY has storage:write permissions (service role).',
      },
    };
  }

  // ---- 3. Build the PUT URL the caller uses
  //     Supabase returns a relative `/object/upload/sign/...?token=JWT`.
  //     The client PUTs to https://<project>.supabase.co/storage/v1{url}
  //     with Authorization: Bearer <token>. Some SDKs use the URL as-is
  //     (token is embedded as query param) — both patterns work.
  const relativeSignedPath = signJson.url;                        // "/object/upload/sign/..."
  const uploadUrl = `${supabaseUrl}/storage/v1${relativeSignedPath}`;
  const uploadToken = signJson.token || null;                     // some Supabase versions include

  // ---- 4. Extract embedded token from URL if not returned separately
  let derivedToken = uploadToken;
  if (!derivedToken) {
    try {
      const parsed = new URL(uploadUrl);
      derivedToken = parsed.searchParams.get('token');
    } catch { /* fall through */ }
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();

  return {
    status: 200,
    body: {
      ok:            true,
      storage_path:  fullPath,                      // what the caller passes to stage-om later
      upload_url:    uploadUrl,                     // PUT the bytes here
      upload_method: 'PUT',
      upload_token:  derivedToken,                  // if caller needs Bearer header separately
      upload_headers: {
        // Most Supabase versions accept the URL as-is (token embedded) OR
        // with an explicit Bearer header. Include both hints for client flexibility.
        'x-upsert':      'true',                    // overwrite if path collides
        ...(derivedToken ? { 'Authorization': `Bearer ${derivedToken}` } : {}),
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
