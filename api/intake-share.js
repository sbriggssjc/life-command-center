// ============================================================================
// /api/intake-share — iOS Shortcut "Send to LCC" share-target endpoint
// Life Command Center
//
// POST /api/intake-share
//   Body: { url?, text?, notes?, source, domain_hint?, images?: [{base64|data_url, mime_type}] }
//   Auth: X-LCC-Key (Shortcut) or Bearer JWT (web). Operator role required.
//   Behavior: stages the share in intake_share_inbox, runs Vision extraction
//             synchronously, returns the structured payload.
//
// GET  /api/intake-share?status=new&limit=50
//   Lists pending shares for the caller's workspace.
//
// PATCH /api/intake-share?id=<uuid>
//   Updates status / notes / promoted_to. Used by the review UI.
//
// Promotion to canonical property/contact records lives elsewhere — this
// endpoint only stages and extracts. See docs/ios-shortcut-send-to-lcc.md.
// ============================================================================

import { createHash } from 'crypto';
import { authenticate, handleCors, requireRole } from './_shared/auth.js';
import {
  opsQuery,
  pgFilterVal,
  requireOps,
  withErrorHandler,
} from './_shared/ops-db.js';
import { extractFromShare } from './_shared/share-extractor.js';

const MAX_IMAGES      = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME    = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const ALLOWED_SOURCES = new Set([
  'linkedin',
  'instagram',
  'twitter',
  'mail',
  'safari',
  'article',
  'manual',
  'other',
]);

export default withErrorHandler(async (req, res) => {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  const ws = user.memberships?.[0];
  const workspaceId = ws?.workspace_id;
  if (!workspaceId) {
    res.status(403).json({ error: 'No workspace membership' });
    return;
  }
  if (!requireRole(user, 'operator', workspaceId)) {
    res.status(403).json({ error: 'Operator role required' });
    return;
  }

  const method = (req.method || 'GET').toUpperCase();
  if (method === 'POST')  return handlePost(req, res, user, workspaceId);
  if (method === 'GET')   return handleList(req, res, workspaceId);
  if (method === 'PATCH') return handlePatch(req, res, workspaceId);
  res.status(405).json({ error: 'Method not allowed' });
});

async function handlePost(req, res, user, workspaceId) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const url         = body.url ? String(body.url).slice(0, 2048) : null;
  const text        = body.text ? String(body.text).slice(0, 50_000) : null;
  const notes       = body.notes ? String(body.notes).slice(0, 4000) : null;
  const sourceRaw   = (body.source || 'manual').toString().toLowerCase();
  const source      = ALLOWED_SOURCES.has(sourceRaw) ? sourceRaw : 'other';
  const domainHint  = body.domain_hint
    ? String(body.domain_hint).toLowerCase()
    : null;
  const rawImages   = Array.isArray(body.images) ? body.images : [];

  if (!url && !text && rawImages.length === 0) {
    res.status(400).json({ error: 'At least one of url, text, or images is required' });
    return;
  }
  if (rawImages.length > MAX_IMAGES) {
    res.status(400).json({ error: `Too many images (max ${MAX_IMAGES})` });
    return;
  }
  if (domainHint && !['gov_lease', 'dialysis', 'general'].includes(domainHint)) {
    res.status(400).json({ error: 'domain_hint must be gov_lease | dialysis | general' });
    return;
  }

  const normalized = [];
  for (const img of rawImages) {
    let mime = (img.mime_type || img.mimeType || '').toLowerCase();
    let dataUrl = null;
    if (img.data_url) {
      dataUrl = img.data_url;
      const m = String(dataUrl).match(/^data:([^;]+);base64,(.*)$/);
      if (m) mime = mime || m[1].toLowerCase();
    } else if (img.base64 || img.data) {
      mime = mime || 'image/jpeg';
      dataUrl = `data:${mime};base64,${img.base64 || img.data}`;
    } else {
      continue;
    }
    if (!ALLOWED_MIME.has(mime)) {
      res.status(400).json({ error: `Unsupported image type: ${mime}` });
      return;
    }
    const b64 = dataUrl.split(',', 2)[1] || '';
    const sizeBytes = Math.floor(b64.length * 0.75);
    if (sizeBytes > MAX_IMAGE_BYTES) {
      res.status(413).json({ error: 'Image too large (max 8MB)' });
      return;
    }
    const sha = createHash('sha256').update(b64).digest('hex');
    normalized.push({ data_url: dataUrl, mime_type: mime, size_bytes: sizeBytes, sha256: sha });
  }

  const imageMeta = normalized.map(({ data_url, ...rest }) => rest);

  const shellRow = {
    workspace_id: workspaceId,
    source,
    source_url: url,
    shared_text: text,
    notes,
    domain_hint: domainHint,
    image_count: normalized.length,
    raw_payload: { source, url, text, notes, domain_hint: domainHint, image_meta: imageMeta },
    images: imageMeta,
    extraction_status: 'extracting',
    source_user_id: user.id,
    visibility: 'shared',
  };

  const insertRes = await opsQuery('POST', 'intake_share_inbox', shellRow);
  if (!insertRes.ok) {
    res.status(insertRes.status || 500).json({ error: 'Failed to stage share', detail: insertRes.data });
    return;
  }
  const row = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
  const id = row?.id;

  let extraction = null;
  let extractionError = null;
  try {
    extraction = await extractFromShare({
      url, text, notes, source, domain_hint: domainHint, images: normalized,
    });
  } catch (err) {
    extractionError = err?.message || String(err);
    console.warn(`[intake-share] extraction failed for ${id}: ${extractionError}`);
  }

  const patch = extraction
    ? {
        extraction,
        extraction_status: 'extracted',
        detected_domain: extraction.domain || null,
        confidence: typeof extraction.confidence === 'number' ? extraction.confidence : null,
        updated_at: new Date().toISOString(),
      }
    : {
        extraction_status: 'failed',
        extraction_error: extractionError || 'unknown',
        updated_at: new Date().toISOString(),
      };

  if (id) {
    await opsQuery(
      'PATCH',
      `intake_share_inbox?id=eq.${pgFilterVal(id)}`,
      patch,
    );
  }

  res.status(201).json({
    ok: true,
    id,
    extraction,
    extraction_status: patch.extraction_status,
    extraction_error: patch.extraction_error || null,
  });
}

async function handleList(req, res, workspaceId) {
  const status = (req.query.status || 'new').toString();
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const path =
    `intake_share_inbox` +
    `?workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&status=eq.${pgFilterVal(status)}` +
    `&order=created_at.desc&limit=${limit}` +
    `&select=id,source,source_url,domain_hint,detected_domain,confidence,extraction_status,extraction,notes,created_at`;
  const r = await opsQuery('GET', path);
  res.status(r.status || 200).json({ items: r.data || [], total: r.count });
}

async function handlePatch(req, res, workspaceId) {
  const id = req.query.id;
  if (!id) {
    res.status(400).json({ error: 'id query param required' });
    return;
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const allowed = ['status', 'detected_domain', 'notes', 'promoted_to', 'promoted_at'];
  const patch = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'no updatable fields in body' });
    return;
  }
  patch.updated_at = new Date().toISOString();
  const r = await opsQuery(
    'PATCH',
    `intake_share_inbox?id=eq.${pgFilterVal(id)}&workspace_id=eq.${pgFilterVal(workspaceId)}`,
    patch,
  );
  res.status(r.status || 200).json({ ok: r.ok, data: r.data });
}
