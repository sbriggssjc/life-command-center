// ============================================================================
// Artifact Storage helper — shared upload path for OM intake artifacts
// Life Command Center
//
// One place that knows how a staged_intake_artifacts row's bytes map to a
// Supabase Storage object, so the INGEST path (intake-om-pipeline.js, writes
// large OM bytes straight to Storage instead of base64 inline_data) and the
// OFFLOAD path (api/admin.js handleArtifactOffload, drains the legacy inline
// backlog) produce identical, deterministic object paths and storage_path
// values.
//
// storage_path convention (consumed verbatim by intake-extractor.js
// getArtifactBytes as `${OPS_URL}/storage/v1/object/${storage_path}`):
//     <bucket>/<YYYY-MM-DD>/<key>-<safe-file-name>
// where <key> is the artifact row id (offload path, known after insert) or the
// intake_id (ingest path, known before insert). Both are unique + stable, so a
// retry overwrites the same object (x-upsert) rather than duplicating.
// ============================================================================

const ARTIFACT_MIME_EXT = {
  'application/pdf':                                                          '.pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':        '.xlsx',
  'application/vnd.ms-excel':                                                 '.xls',
  'application/msword':                                                       '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':  '.docx',
  'text/plain':                                                               '.txt',
  'message/rfc822':                                                           '.eml',
};

export const ARTIFACT_BUCKET = 'lcc-om-uploads';

/** Sanitize a filename for use in a Storage object path, ensuring an extension. */
export function artifactSafeName(fileName, mimeType) {
  const fallbackExt = ARTIFACT_MIME_EXT[(mimeType || 'application/pdf').toLowerCase()] || '.bin';
  let safe = String(fileName || 'upload')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'upload';
  if (!/\.[a-z0-9]{2,6}$/i.test(safe)) safe += fallbackExt;
  return safe;
}

/** Build the deterministic object path (sans bucket) for an artifact. */
export function artifactObjectPath({ key, fileName, mimeType, createdAt }) {
  const datePart = new Date(createdAt || Date.now()).toISOString().slice(0, 10);
  return `${datePart}/${key}-${artifactSafeName(fileName, mimeType)}`;
}

/**
 * Upload artifact bytes to the LCC Storage bucket. Returns the full
 * storage_path (`<bucket>/<objectPath>`) on success.
 *
 * @param {object}  o
 * @param {string}  o.opsUrl        OPS_SUPABASE_URL
 * @param {string}  o.opsKey        OPS_SUPABASE_KEY (service role)
 * @param {string} [o.bucket]       defaults to lcc-om-uploads
 * @param {string}  o.objectPath    path within the bucket (from artifactObjectPath)
 * @param {string} [o.mimeType]
 * @param {Buffer}  o.buffer        raw (decoded) bytes
 * @param {Function} o.fetchImpl    fetch implementation (fetchWithTimeout or global fetch)
 * @returns {Promise<{ok:boolean, storage_path?:string, status?:number, detail?:string}>}
 */
/**
 * Download object bytes from a Supabase Storage bucket. Generic over the
 * project (opsUrl/opsKey for LCC, or a domain url/service-key for the per-domain
 * `property-documents` bucket — UW#6-REV). Returns { ok, buffer, contentType }.
 *
 * @param {object}  o
 * @param {string}  o.baseUrl     project Supabase URL
 * @param {string}  o.key         service-role key for that project
 * @param {string}  o.bucket      bucket id
 * @param {string}  o.objectPath  path within the bucket (no leading bucket id)
 * @param {Function} [o.fetchImpl]
 * @returns {Promise<{ok:boolean, buffer?:Buffer, contentType?:string, status?:number, detail?:string}>}
 */
export async function downloadFromStorage({ baseUrl, key, bucket, objectPath, fetchImpl }) {
  if (!baseUrl || !key || !bucket || !objectPath) {
    return { ok: false, status: 0, detail: 'missing_storage_args' };
  }
  const encodedPath = String(objectPath).split('/').map(encodeURIComponent).join('/');
  const url = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
  const doFetch = fetchImpl || ((u, opts) => fetch(u, opts));
  try {
    const res = await doFetch(url, {
      method: 'GET',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, status: res.status, detail: detail.slice(0, 200) };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { ok: true, buffer, contentType: res.headers?.get?.('content-type') || null };
  } catch (err) {
    return { ok: false, status: 0, detail: err?.message?.slice(0, 200) || 'download_error' };
  }
}

export async function uploadArtifactToStorage({ opsUrl, opsKey, bucket, objectPath, mimeType, buffer, fetchImpl }) {
  const b = bucket || ARTIFACT_BUCKET;
  const encodedPath = String(objectPath).split('/').map(encodeURIComponent).join('/');
  const url = `${opsUrl}/storage/v1/object/${encodeURIComponent(b)}/${encodedPath}`;
  const doFetch = fetchImpl || ((u, opts) => fetch(u, opts));
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'apikey':        opsKey,
        'Authorization': `Bearer ${opsKey}`,
        'Content-Type':  mimeType || 'application/octet-stream',
        'x-upsert':      'true',
      },
      body: buffer,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, status: res.status, detail: detail.slice(0, 200) };
    }
    return { ok: true, storage_path: `${b}/${objectPath}` };
  } catch (err) {
    return { ok: false, detail: err?.message?.slice(0, 200) || 'upload_error' };
  }
}
