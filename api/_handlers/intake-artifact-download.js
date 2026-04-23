// api/_handlers/intake-artifact-download.js
// ============================================================================
// Handler for Copilot action: intake.artifact_download.v1
//
// Mints a Supabase Storage signed DOWNLOAD URL so the LCC dashboard can
// open an ingested OM/flyer/marketing-brochure PDF with one click without
// exposing the service-role key to the browser.
//
// Input:  { storage_path: "lcc-om-uploads/2026-04-23/UUID-filename.pdf" }
//         OR { listing_id, domain: "government"|"dialysis" } to look it up
// Output: { signed_url, expires_at, storage_path, file_name }
//
// The signed URL is valid for 1 hour (enough for a user to click + download
// + browse the PDF). Refreshes are cheap; clients can re-call if they cache
// the signed URL longer than the TTL.
// ============================================================================

import { fetchWithTimeout } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';

const SIGNED_URL_TTL_SECONDS = 3600;   // 1 hour

/**
 * @param {object} args
 * @param {object} args.inputs
 * @param {string} [args.inputs.storage_path]  — direct path (preferred for dashboard links)
 * @param {string} [args.inputs.listing_id]    — alternative: look up via listing row
 * @param {'government'|'dialysis'} [args.inputs.domain]
 * @param {object} args.authContext            — { email, ... }
 */
export async function handleIntakeArtifactDownload({ inputs, authContext }) {
  if (!authContext?.email) {
    return { status: 401, body: { error: 'missing_caller_identity' } };
  }

  // Resolve storage_path — either provided directly or derived from listing lookup
  let storagePath = inputs?.storage_path || null;
  let resolvedFileName = null;
  if (!storagePath && inputs?.listing_id && inputs?.domain) {
    const domain = inputs.domain === 'dialysis' ? 'dialysis' : 'government';
    const pkCol  = domain === 'dialysis' ? 'listing_id' : 'listing_id';
    const lookup = await domainQuery(
      domain,
      'GET',
      `available_listings?${pkCol}=eq.${encodeURIComponent(inputs.listing_id)}` +
      `&select=intake_artifact_path,intake_artifact_type&limit=1`
    );
    if (lookup.ok && Array.isArray(lookup.data) && lookup.data.length) {
      storagePath = lookup.data[0]?.intake_artifact_path || null;
    }
    if (!storagePath) {
      return {
        status: 404,
        body: {
          error: 'artifact_not_linked',
          detail: 'Listing has no intake_artifact_path — nothing to download.',
        },
      };
    }
  }

  if (!storagePath || typeof storagePath !== 'string') {
    return {
      status: 400,
      body: {
        error: 'missing_storage_path',
        detail: 'Provide storage_path (string) or { listing_id, domain }.',
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

  // Supabase Storage signed-URL endpoint: POST /storage/v1/object/sign/{bucket}/{path}
  // with body { expiresIn }. storage_path = "{bucket}/{path}" — split on first /.
  const firstSlash = storagePath.indexOf('/');
  if (firstSlash < 1) {
    return {
      status: 400,
      body: { error: 'invalid_storage_path', detail: 'Expected bucket/path shape.' },
    };
  }
  const bucket     = storagePath.slice(0, firstSlash);
  const objectPath = storagePath.slice(firstSlash + 1);
  const fileName   = objectPath.split('/').pop() || 'document.pdf';

  const signEndpoint = `${supabaseUrl}/storage/v1/object/sign/${bucket}/${objectPath}`;
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
  try { signJson = signText ? JSON.parse(signText) : null; } catch { /* keep text */ }

  if (!signRes.ok || !signJson?.signedURL) {
    return {
      status: signRes.status || 500,
      body: {
        error: 'signed_url_mint_failed',
        detail: signJson?.message || signJson?.error || signText?.slice(0, 300) || 'Supabase returned no signed URL',
        storage_path: storagePath,
      },
    };
  }

  // signJson.signedURL is relative ("/object/sign/bucket/path?token=...") —
  // absolutize it.
  const signedUrl = `${supabaseUrl}/storage/v1${signJson.signedURL}`;
  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();

  return {
    status: 200,
    body: {
      ok:             true,
      signed_url:     signedUrl,
      expires_at:     expiresAt,
      storage_path:   storagePath,
      file_name:      resolvedFileName || fileName,
      ttl_seconds:    SIGNED_URL_TTL_SECONDS,
    },
  };
}
