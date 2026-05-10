// ============================================================================
// activity_events helper — idempotent timeline row append
// Life Command Center — Phase 3.5
// ----------------------------------------------------------------------------
// Used by every bridge handler that wants to surface a touch in the
// canonical timeline:
//
//   SF activity handler   → category 'call' | 'email' | 'meeting' | 'note'
//   Outlook handler       → category 'email'
//   Calendar handler      → category 'meeting'
//   SharePoint classifier → (deferred — high-volume; opt-in later)
//
// Idempotency is provided by the partial unique index on
// (workspace_id, source_type, external_id) added by Phase 3.5 migration.
// Duplicate inserts return [] thanks to Prefer=resolution=ignore-duplicates,
// so callers can call this on retry without worrying about dupes.
// ============================================================================

import { opsQuery, isOpsConfigured } from './ops-db.js';

// activity_events.category enum (per schema 004_operations.sql):
//   call, email, meeting, note, status_change, assignment, sync, research, system
// SF Tasks come through as 'task' upstream; the helper maps that to 'note'
// (the closest semantic fit) when the caller forgets to.
const VALID_CATEGORIES = new Set([
  'call','email','meeting','note',
  'status_change','assignment','sync','research','system'
]);

function normalizeCategory(c) {
  if (!c) return 'note';
  if (c === 'task' || c === 'other') return 'note';
  return VALID_CATEGORIES.has(c) ? c : 'note';
}

/**
 * Insert an activity_events row, deduped on (workspace_id, source_type, external_id).
 *
 * Returns:
 *   { ok: true,  inserted: true,  id }   — newly inserted
 *   { ok: true,  inserted: false }       — duplicate, no-op
 *   { ok: false, reason }                — bad input or DB error (never throws)
 *
 * Required:  workspaceId, actorId, category
 * Recommended: title, sourceType, externalId (without external_id, dedupe
 *              can't help — the row will insert every time)
 *
 * Title is truncated to 500 chars and body to 4000.
 */
export async function appendActivityEvent({
  workspaceId,
  actorId,
  category,
  title,
  body         = null,
  entityId     = null,
  sourceType   = null,
  externalId   = null,
  externalUrl  = null,
  occurredAt   = null,
  visibility   = 'shared',
  domain       = null,
  metadata     = {}
}) {
  if (!isOpsConfigured()) return { ok: false, reason: 'ops_not_configured' };
  if (!workspaceId)       return { ok: false, reason: 'workspace_required' };
  if (!actorId)           return { ok: false, reason: 'actor_required' };

  const cat = normalizeCategory(category);
  const safeTitle = title ? String(title).slice(0, 500) : '(no title)';
  const safeBody  = body ? String(body).slice(0, 4000) : null;

  try {
    const r = await opsQuery('POST',
      'activity_events?on_conflict=workspace_id,source_type,external_id',
      {
        workspace_id:        workspaceId,
        actor_id:            actorId,
        visibility,
        category:            cat,
        title:               safeTitle,
        body:                safeBody,
        entity_id:           entityId,
        source_type:         sourceType,
        external_id:         externalId,
        external_url:        externalUrl,
        domain,
        occurred_at:         occurredAt || new Date().toISOString(),
        metadata:            metadata || {}
      },
      { headers: { Prefer: 'return=representation,resolution=ignore-duplicates' } }
    );
    if (r.ok && Array.isArray(r.data) && r.data.length > 0) {
      return { ok: true, inserted: true, id: r.data[0].id };
    }
    if (r.ok) {
      // Empty array — duplicate hit the unique index.
      return { ok: true, inserted: false };
    }
    return { ok: false, reason: `insert_failed_${r.status}` };
  } catch (err) {
    console.warn('[activity-events] append failed (non-fatal):',
      err?.message || err);
    return { ok: false, reason: 'insert_threw', error: err?.message || String(err) };
  }
}
