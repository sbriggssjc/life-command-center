// ============================================================================
// Storage adapter — pluggable backend for OM intake artifacts
// Life Command Center · Phase 1 (intelligence-hub architecture)
//
// WHY: large OM/Excel bytes were bloating the LCC Opps (auth) DB toward the
// read-only lockout. R15 moved them to the Supabase `lcc-om-uploads` bucket.
// Phase 1 makes the storage location PLUGGABLE so they can live in the
// company's Microsoft SharePoint (Team Briggs Documents library) via Power
// Automate instead — keeping personal Supabase storage lean and laying the
// on-ramp for the Phase-2 folder feed.
//
// ONE interface, two backends. Ingest, extractor, and download resolve bytes /
// links through this module — never a backend directly.
//
//   putArtifact(...)        -> { ok, backend, storage_path, storage_ref, url }
//   fetchSharepointBytes()  -> raw bytes for the extractor's sharepoint branch
//   resolveArtifactDownload -> { signed_url, ... } for the download handler
//   getConfiguredStorageBackend() -> the EFFECTIVE backend after the no-op gate
//
// CUTOVER SAFETY: `STORAGE_BACKEND` (env) selects the backend, default
// `supabase` (today's behavior, byte-identical). `sharepoint_pa` is gated on
// its PA flow URL being configured — if selected but unconfigured it degrades
// to `supabase` with a one-time warning, so flipping the flag before the PA
// flow exists is a safe no-op (the `find_contacts_by_account` rollout pattern).
//
// The Supabase backend reuses api/_shared/artifact-storage.js (the deterministic
// path-builder + uploader) verbatim, so a supabase-mode write produces the same
// `storage_path` the existing readers already understand.
// ============================================================================

import {
  ARTIFACT_BUCKET,
  artifactObjectPath,
  uploadArtifactToStorage,
} from './artifact-storage.js';

export const STORAGE_BACKENDS = Object.freeze({
  SUPABASE:      'supabase',
  SHAREPOINT_PA: 'sharepoint_pa',
});

// Where the PA "Save Artifact" flow drops files inside the Team Briggs library.
// Server-relative to the Shared Documents root. Overridable via env.
const SHAREPOINT_INTAKE_FOLDER =
  (process.env.SHAREPOINT_INTAKE_FOLDER || "Storage OM's/Intake").replace(/^\/+|\/+$/g, '');

// The site/library prefix that the PA SharePoint connector supplies via its
// "Site Address" — a server-relative folder path must be made LIBRARY-relative
// (strip this prefix) before it goes into the Create-file action's `path`.
const SHAREPOINT_DOC_PREFIX =
  (process.env.SHAREPOINT_DOC_PREFIX || '/sites/TeamBriggs20/Shared Documents');

/**
 * Turn a full server-relative DESTINATION folder into the LIBRARY-relative
 * folder the Create-file action's "Folder Path" field expects (no site/library
 * prefix, no leading/trailing slash, collapsed double-slashes). Exported for
 * unit tests.
 *
 *   "/sites/TeamBriggs20/Shared Documents/PROPERTIES/D/DaVita/Chilton, WI"
 *   -> "PROPERTIES/D/DaVita/Chilton, WI"
 */
export function libraryRelativeFolder(folderPath) {
  return String(folderPath || '')
    .replace(SHAREPOINT_DOC_PREFIX, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
}

/**
 * Turn a full server-relative DESTINATION folder + file name into the
 * LIBRARY-relative file path (no site/library prefix, no leading slash,
 * collapsed double-slashes). Exported for unit tests.
 *
 *   "/sites/TeamBriggs20/Shared Documents/PROPERTIES/D/DaVita/Chilton, WI"
 *     + "Foo [LCC].pdf"
 *   -> "PROPERTIES/D/DaVita/Chilton, WI/Foo [LCC].pdf"
 */
export function libraryRelativeDocPath(folderPath, fileName) {
  return `${libraryRelativeFolder(folderPath)}/${fileName}`.replace(/\/{2,}/g, '/');
}

let _warnedSharepointUnconfigured = false;

/**
 * Resolve the EFFECTIVE storage backend.
 * Honors STORAGE_BACKEND but degrades sharepoint_pa -> supabase (one-time warn)
 * when SHAREPOINT_SAVE_URL is unset, so the flag can be flipped before the PA
 * flow is live without breaking ingest.
 */
export function getConfiguredStorageBackend() {
  const raw = String(process.env.STORAGE_BACKEND || STORAGE_BACKENDS.SUPABASE)
    .trim().toLowerCase();
  if (raw === STORAGE_BACKENDS.SHAREPOINT_PA) {
    if (!process.env.SHAREPOINT_SAVE_URL) {
      if (!_warnedSharepointUnconfigured) {
        console.warn(
          '[storage-adapter] STORAGE_BACKEND=sharepoint_pa but SHAREPOINT_SAVE_URL is unset — ' +
          'falling back to supabase storage (no-op until the PA flow is configured).'
        );
        _warnedSharepointUnconfigured = true;
      }
      return STORAGE_BACKENDS.SUPABASE;
    }
    return STORAGE_BACKENDS.SHAREPOINT_PA;
  }
  return STORAGE_BACKENDS.SUPABASE;
}

/**
 * A SharePoint storage_ref is a server-relative URL (starts with "/" — e.g.
 * "/sites/TeamBriggs20/Shared Documents/Storage OM's/Intake/...").
 * A Supabase storage_path is "<bucket>/<object>" (no leading slash). This lets
 * readers route on the ref shape without a separate backend column on every
 * caller (the ref is self-describing).
 */
export function looksLikeSharepointRef(ref) {
  return typeof ref === 'string' && ref.startsWith('/');
}

// ---------------------------------------------------------------------------
// PUT — store bytes in the configured backend
// ---------------------------------------------------------------------------

/**
 * Store artifact bytes. Returns a backend-tagged reference for the DB row.
 *
 * @param {object}   o
 * @param {string}   o.key         row/intake id — makes the object path stable
 * @param {string}   o.fileName
 * @param {string}   o.mimeType
 * @param {Buffer}   o.buffer      raw (decoded) bytes
 * @param {string}  [o.createdAt]  ISO; defaults now
 * @param {string}   o.opsUrl      OPS_SUPABASE_URL (supabase backend)
 * @param {string}   o.opsKey      OPS_SUPABASE_KEY (supabase backend)
 * @param {Function} o.fetchImpl   fetch impl (fetchWithTimeout)
 * @returns {Promise<{ok:boolean, backend:string, storage_path:?string,
 *                     storage_ref:?string, url:?string, status?:number, detail?:string}>}
 *   supabase   -> storage_path = storage_ref = "<bucket>/<object>", url null
 *   sharepoint -> storage_ref = server_relative_url, storage_path null, url set
 */
export async function putArtifact({ key, fileName, mimeType, buffer, createdAt, opsUrl, opsKey, fetchImpl }) {
  const backend    = getConfiguredStorageBackend();
  const objectPath = artifactObjectPath({ key, fileName, mimeType, createdAt });

  if (backend === STORAGE_BACKENDS.SHAREPOINT_PA) {
    const sp = await putToSharePoint({ objectPath, mimeType, buffer, fetchImpl });
    if (sp.ok) {
      return {
        ok: true,
        backend: STORAGE_BACKENDS.SHAREPOINT_PA,
        storage_path: null,
        storage_ref:  sp.server_relative_url,
        url:          sp.url || null,
      };
    }
    // The PA flow failed — fall back to supabase so ingestion is NEVER blocked.
    console.warn('[storage-adapter] sharepoint_pa save failed, falling back to supabase:',
      sp.status || '', sp.detail || '');
  }

  // supabase (default + fallback path)
  const up = await uploadArtifactToStorage({
    opsUrl, opsKey, bucket: ARTIFACT_BUCKET, objectPath, mimeType, buffer, fetchImpl,
  });
  if (!up.ok) {
    return { ok: false, backend: STORAGE_BACKENDS.SUPABASE, status: up.status, detail: up.detail };
  }
  return {
    ok: true,
    backend: STORAGE_BACKENDS.SUPABASE,
    storage_path: up.storage_path,
    storage_ref:  up.storage_path,
    url:          null,
  };
}

/**
 * POST bytes to the PA "LCC -> SharePoint: Save Artifact" flow.
 * Contract (mirrors the email-intake flow shape):
 *   trigger body  { path, content_base64, content_type }
 *   response      { ok:true, server_relative_url, item_id, url? }
 */
async function putToSharePoint({ objectPath, mimeType, buffer, fetchImpl }) {
  const saveUrl = process.env.SHAREPOINT_SAVE_URL;
  if (!saveUrl) return { ok: false, detail: 'SHAREPOINT_SAVE_URL unset' };
  const relPath = `${SHAREPOINT_INTAKE_FOLDER}/${objectPath}`.replace(/\/{2,}/g, '/');
  const doFetch = fetchImpl || ((u, opts) => fetch(u, opts));
  try {
    const res = await doFetch(saveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path:           relPath,
        content_base64: Buffer.from(buffer).toString('base64'),
        content_type:   mimeType || 'application/octet-stream',
      }),
    });
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    if (!res.ok || !json?.ok || !json?.server_relative_url) {
      return {
        ok: false,
        status: res.status,
        detail: String(json?.error || text || 'pa_save_failed').slice(0, 200),
      };
    }
    return { ok: true, server_relative_url: json.server_relative_url, item_id: json.item_id, url: json.url || null };
  } catch (err) {
    return { ok: false, detail: err?.message?.slice(0, 200) || 'pa_save_error' };
  }
}

// ---------------------------------------------------------------------------
// PUT (write-back) — upload an LCC-generated doc INTO a property folder
// ---------------------------------------------------------------------------

/**
 * Upload an LCC-authored deliverable (BOV / OM / memo / master sheet) into a
 * resolved SharePoint folder via the PA "Http -> Upload file (LCC Put
 * Artifact)" flow (Phase 2, Slice 2b). This is the WRITE side of the PROPERTIES
 * channel — unlike putArtifact (which drops intake artifacts into a fixed
 * Storage OM's/Intake folder), this writes into the MATCHED property's own
 * folder so the folder and the DB record become one connected object.
 *
 * Mirrors fetchSharepointBytes' tolerant-parse + 503-when-unset shape. Never
 * throws; a failure returns ok:false so the caller writes nothing to the DB.
 * Contract (the Create-file action takes a DYNAMIC Folder Path + File Name from
 * the trigger, so the destination folder is no longer hardcoded to the intake
 * zone — Slice 2b.2):
 *   trigger body  { folder_path, file_name, content_base64 }
 *                 (folder_path is LIBRARY-relative, e.g.
 *                  "PROPERTIES/D/DaVita/Chilton, WI")
 *   response      { ok:true, server_relative_url, item_id, url? }
 *
 * @param {object}   o
 * @param {string}   o.folderPath  full server-relative path of the DESTINATION
 *                                  folder. Made library-relative (the
 *                                  site/library prefix is stripped) before it
 *                                  becomes the flow's `folder_path`.
 * @param {string}   o.fileName    target file name (already [LCC]-tagged + dedup'd)
 * @param {Buffer}   o.bytes       raw bytes to write
 * @param {Function} [o.fetchImpl] fetch impl (defaults to global fetch)
 * @returns {Promise<{ok:boolean, server_relative_url?:string, status?:number, detail?:string}>}
 */
export async function uploadDocToFolder({ folderPath, fileName, bytes, fetchImpl }) {
  const uploadUrl = process.env.SHAREPOINT_UPLOAD_URL;
  if (!uploadUrl) return { ok: false, status: 503, detail: 'SHAREPOINT_UPLOAD_URL unset' };
  if (!folderPath) return { ok: false, status: 400, detail: 'missing folder_path' };
  if (!fileName)   return { ok: false, status: 400, detail: 'missing file_name' };
  if (!bytes || !Buffer.isBuffer(bytes) || bytes.length === 0) {
    return { ok: false, status: 400, detail: 'missing or empty bytes' };
  }
  const folder_path = libraryRelativeFolder(folderPath);
  const doFetch = fetchImpl || ((u, opts) => fetch(u, opts));
  try {
    const res = await doFetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folder_path,
        file_name:      fileName,
        content_base64: Buffer.from(bytes).toString('base64'),
      }),
    });
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    if (!res.ok || !json?.ok || !json?.server_relative_url) {
      return {
        ok: false,
        status: res.status,
        detail: String(json?.error || text || 'pa_upload_failed').slice(0, 200),
      };
    }
    return { ok: true, status: res.status, server_relative_url: json.server_relative_url };
  } catch (err) {
    return { ok: false, status: 0, detail: err?.message?.slice(0, 200) || 'pa_upload_error' };
  }
}

// ---------------------------------------------------------------------------
// GET — fetch raw bytes from SharePoint (extractor's sharepoint read branch)
// ---------------------------------------------------------------------------

/**
 * Fetch raw artifact bytes from SharePoint via the PA "Get Artifact" flow.
 * The Supabase byte-read stays in intake-extractor.js (its base64-recovery +
 * diagnostic path is unchanged); this only covers the sharepoint_pa backend.
 * Contract:
 *   trigger body  { server_relative_url }
 *   response      { ok:true, content_base64, content_type }
 * @returns {Promise<{ok:boolean, buffer?:Buffer, contentType?:string, status?:number, detail?:string}>}
 */
export async function fetchSharepointBytes({ storageRef, fetchImpl }) {
  const fetchUrl = process.env.SHAREPOINT_FETCH_URL;
  if (!fetchUrl) return { ok: false, detail: 'SHAREPOINT_FETCH_URL unset' };
  if (!storageRef) return { ok: false, detail: 'missing storage_ref' };
  const doFetch = fetchImpl || ((u, opts) => fetch(u, opts));
  try {
    const res = await doFetch(fetchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_relative_url: storageRef }),
    });
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    if (!res.ok || !json?.ok || !json?.content_base64) {
      return { ok: false, status: res.status, detail: String(json?.error || text || 'pa_fetch_failed').slice(0, 200) };
    }
    return {
      ok: true,
      buffer: Buffer.from(json.content_base64, 'base64'),
      contentType: json.content_type || null,
    };
  } catch (err) {
    return { ok: false, detail: err?.message?.slice(0, 200) || 'pa_fetch_error' };
  }
}

// ---------------------------------------------------------------------------
// DOWNLOAD — resolve a browser-openable link for a stored artifact
// ---------------------------------------------------------------------------

const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour (matches the legacy download handler)

/**
 * Resolve a download URL for an artifact, routing on the ref shape.
 * - Supabase ("<bucket>/<object>")  -> a Supabase signed URL (verbatim legacy logic).
 * - SharePoint ("/sites/.../...")   -> a PA "Get Sharing Link" flow URL.
 *
 * @returns {Promise<{ok:boolean, status:number, signed_url?:string,
 *                     expires_at?:string, file_name?:string, ttl_seconds?:number,
 *                     storage_ref?:string, error?:string, detail?:string}>}
 */
export async function resolveArtifactDownload({ storageRef, opsUrl, opsKey, fetchImpl }) {
  if (!storageRef || typeof storageRef !== 'string') {
    return { ok: false, status: 400, error: 'missing_storage_ref' };
  }
  const doFetch = fetchImpl || ((u, opts) => fetch(u, opts));

  if (looksLikeSharepointRef(storageRef)) {
    const linkUrl = process.env.SHAREPOINT_LINK_URL;
    if (!linkUrl) {
      return {
        ok: false, status: 501, error: 'sharepoint_link_not_configured',
        detail: 'SHAREPOINT_LINK_URL (PA sharing-link flow) is not set.',
        storage_ref: storageRef,
      };
    }
    try {
      const res = await doFetch(linkUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_relative_url: storageRef }),
      });
      const text = await res.text().catch(() => '');
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* keep */ }
      if (!res.ok || !json?.ok || !json?.url) {
        return { ok: false, status: res.status || 502, error: 'sharepoint_link_failed',
          detail: String(json?.error || text || '').slice(0, 200), storage_ref: storageRef };
      }
      return {
        ok: true, status: 200,
        signed_url: json.url,
        expires_at: json.expires_at || null,
        file_name:  String(storageRef).split('/').pop() || 'document',
        storage_ref: storageRef,
      };
    } catch (err) {
      return { ok: false, status: 502, error: 'sharepoint_link_error', detail: err?.message?.slice(0, 200) };
    }
  }

  // Supabase signed URL — legacy behavior, preserved byte-for-byte.
  if (!opsUrl || !opsKey) {
    return { ok: false, status: 503, error: 'storage_not_configured',
      detail: 'OPS_SUPABASE_URL / OPS_SUPABASE_KEY missing from environment.' };
  }
  const firstSlash = storageRef.indexOf('/');
  if (firstSlash < 1) {
    return { ok: false, status: 400, error: 'invalid_storage_path', detail: 'Expected bucket/path shape.' };
  }
  const bucket     = storageRef.slice(0, firstSlash);
  const objectPath = storageRef.slice(firstSlash + 1);
  const fileName   = objectPath.split('/').pop() || 'document.pdf';
  const signEndpoint = `${opsUrl}/storage/v1/object/sign/${bucket}/${objectPath}`;
  const signRes = await doFetch(signEndpoint, {
    method: 'POST',
    headers: {
      'apikey':        opsKey,
      'Authorization': `Bearer ${opsKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
  });
  const signText = await signRes.text();
  let signJson = null;
  try { signJson = signText ? JSON.parse(signText) : null; } catch { /* keep text */ }
  if (!signRes.ok || !signJson?.signedURL) {
    return {
      ok: false, status: signRes.status || 500, error: 'signed_url_mint_failed',
      detail: signJson?.message || signJson?.error || signText?.slice(0, 300) || 'Supabase returned no signed URL',
      storage_ref: storageRef,
    };
  }
  return {
    ok: true, status: 200,
    signed_url: `${opsUrl}/storage/v1${signJson.signedURL}`,
    expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
    file_name:  fileName,
    ttl_seconds: SIGNED_URL_TTL_SECONDS,
    storage_ref: storageRef,
  };
}
