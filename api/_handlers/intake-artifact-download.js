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
import { resolveArtifactDownload } from '../_shared/storage-adapter.js';

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

  // Resolve a download URL through the storage adapter. It sniffs the ref shape:
  //   "<bucket>/<path>"      -> Supabase signed URL (unchanged behavior)
  //   "/sites/.../<file>"    -> SharePoint sharing link via the PA flow
  const resolved = await resolveArtifactDownload({
    storageRef: storagePath,
    opsUrl:     process.env.OPS_SUPABASE_URL,
    opsKey:     process.env.OPS_SUPABASE_KEY,
    fetchImpl:  (u, opts) => fetchWithTimeout(u, opts, 8000),
  });

  if (!resolved.ok) {
    return {
      status: resolved.status || 500,
      body: {
        error:        resolved.error || 'signed_url_mint_failed',
        detail:       resolved.detail || 'Could not resolve a download URL for this artifact.',
        storage_path: storagePath,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok:           true,
      signed_url:   resolved.signed_url,
      expires_at:   resolved.expires_at,
      storage_path: storagePath,
      file_name:    resolvedFileName || resolved.file_name,
      ttl_seconds:  resolved.ttl_seconds || SIGNED_URL_TTL_SECONDS,
    },
  };
}
