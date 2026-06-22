// ============================================================================
// Shared research-task producer (R59) — the ONE idempotent "open a research
// task" helper, reused by document/deed/lease extraction producers and any
// other engine that needs to PROMPT the operator instead of silently parking.
//
// Mirrors admin.js's decision-verdict createResearchTask (same `research_tasks`
// columns + workspace resolution), but is decision-independent so the deed/lease
// workers can call it. Idempotent on the live partial unique index
//   uq_research_tasks_open_source (source_table, source_record_id, research_type,
//   domain) WHERE status IN ('queued','in_progress') AND source_record_id NOT NULL
// → a re-tick / re-parse never spams a duplicate (we pre-check AND tolerate the
// 409 race). Effect-truthful: returns the real outcome; never throws.
// ============================================================================

import { opsQuery as defaultOpsQuery } from './ops-db.js';

/**
 * Open (or no-op if already open) a research_task.
 * @param {object} a
 *   researchType  — the research_type string (idempotency key component)
 *   title         — human title
 *   instructions  — optional body
 *   domain        — 'dia' | 'gov' | 'lcc' (idempotency key component)
 *   propertyId    — drives source_record_id (idempotent on research_type+property)
 *   entityId      — optional entity link
 *   sourceTable   — logical source (default 'document_extraction')
 *   metadata      — optional jsonb (ids + scalar facts only)
 *   workspaceId   — optional explicit workspace; else resolved (oldest workspace)
 * @param {object} [deps] — { opsQuery } injectable for tests
 * @returns {Promise<{ok, created, id, duplicate?, reason?}>}
 */
export async function openResearchTask(a, deps = {}) {
  const q = deps.opsQuery || defaultOpsQuery;
  const {
    researchType, title, instructions = null, domain = 'lcc',
    propertyId = null, entityId = null, sourceTable = 'document_extraction',
    metadata = null, workspaceId = null,
  } = a || {};
  const out = { ok: false, created: false, id: null, reason: null };
  if (!researchType || !title) { out.reason = 'missing_input'; return out; }
  try {
    let ws = workspaceId || deps.workspaceId || null;
    if (!ws) {
      const wr = await q('GET', 'workspaces?select=id&order=created_at.asc&limit=1');
      if (wr.ok && Array.isArray(wr.data) && wr.data[0]) ws = wr.data[0].id;
    }
    if (!ws) { out.reason = 'no_workspace'; return out; }

    const srcRec = propertyId != null ? String(propertyId) : null;
    // Idempotency pre-check on the open-source key (the live partial unique index).
    if (srcRec != null) {
      const ex = await q('GET',
        `research_tasks?research_type=eq.${encodeURIComponent(researchType)}` +
        `&domain=eq.${encodeURIComponent(domain)}` +
        `&source_table=eq.${encodeURIComponent(sourceTable)}` +
        `&source_record_id=eq.${encodeURIComponent(srcRec)}` +
        `&status=in.(queued,in_progress)&select=id&limit=1`);
      if (ex.ok && Array.isArray(ex.data) && ex.data.length) {
        return { ok: true, created: false, id: ex.data[0].id, duplicate: true };
      }
    }

    const r = await q('POST', 'research_tasks', {
      workspace_id: ws,
      research_type: researchType,
      title,
      instructions: instructions || null,
      entity_id: entityId || null,
      domain,
      status: 'queued',
      priority: 50,
      source_table: sourceTable,
      source_record_id: srcRec,
      metadata: metadata || null,
    });
    if (r.ok) {
      out.ok = true; out.created = true;
      out.id = Array.isArray(r.data) ? (r.data[0] && r.data[0].id) : (r.data && r.data.id);
      return out;
    }
    // A 23505 on the partial unique index (a race with another producer) is an
    // idempotent no-op, not a failure.
    if (r.status === 409) return { ok: true, created: false, duplicate: true };
    out.reason = 'insert_failed'; out.status = r.status; out.detail = r.data;
    return out;
  } catch (e) {
    out.reason = 'error'; out.error = e?.message || String(e);
    return out;
  }
}
