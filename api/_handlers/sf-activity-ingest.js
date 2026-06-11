// ============================================================================
// Salesforce activity → activity_events ingest
// Life Command Center — Phase 2 Slice 3b (Unit 2, LCC-side handler)
// ----------------------------------------------------------------------------
// Mirrors Salesforce Task/Activity records into the canonical activity_events
// timeline, linked to the LCC entity via the existing external_identities
// (source_system='salesforce') → entity mapping. Salesforce is the system of
// record for client interactions (calls, emails, meetings, notes logged on
// Contacts/Accounts); this is how that correspondence flows into the timeline
// the property/contact context packets read.
//
//   POST /api/intake?_route=sf-activity   (rewritten to /api/sf-activity)
//   Body: { records: [ { sf_id, type, subject, description, activity_date,
//                        who_id, what_id, status }, ... ] }
//         (a bare array is also accepted)
//
// Per record:
//   - resolve the LCC entity from who_id (Contact) → what_id (Account) via
//     external_identities (source_system='salesforce')
//   - map SF type → activity_events.category
//       Call→call, Email→email, Meeting/Event→meeting, Task/Note/other→note
//   - appendActivityEvent(... sourceType:'salesforce', externalId:sf_id ...)
//     (dedup is automatic on (workspace_id, source_system='salesforce', sf_id))
//   - skip (never guess) when no entity resolves
//
// Reports { matched, skipped_no_entity, inserted, deduped, errors, total }.
//
// THE SF-SIDE FEED IS THE DEPENDENCY (Scott / Power Automate): the SF connector
// must QUERY Task/ActivityHistory and POST batches here. This handler is the
// unblocked half; the PA "SF → LCC Activity Sync" flow is a separate manual
// step built once this endpoint is live (same pattern as the other PA flows).
// ============================================================================

import { authenticate, requireRole } from '../_shared/auth.js';
import { appendActivityEvent as defaultAppendActivityEvent } from '../_shared/activity-events.js';
import { findEntityBySfId as defaultFindEntityBySfId } from '../_shared/bridge-handlers-salesforce.js';

const MAX_BATCH = 500;

/**
 * Map a Salesforce activity type to an activity_events.category.
 * Note/Task and anything unrecognized collapse to 'note' (the closest
 * semantic fit, matching activity-events.js normalizeCategory).
 */
export function mapSfTypeToCategory(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'call')                       return 'call';
  if (t === 'email' || t === 'listemail') return 'email';
  if (t === 'meeting' || t === 'event')   return 'meeting';
  // Task, Note, ToDo, and any other subtype → note.
  return 'note';
}

/**
 * Process a batch of SF activity records. Pure-ish: all I/O is injected via
 * `deps` so it can be unit-tested without a DB.
 *
 * @param {Array<object>} records
 * @param {object} ctx   — { workspaceId, actorId }
 * @param {object} deps  — { findEntityBySfId, appendActivityEvent }
 * @returns {Promise<{matched,skipped_no_entity,inserted,deduped,errors,total,results}>}
 */
export async function processSfActivityBatch(records, ctx, deps = {}) {
  const findEntity = deps.findEntityBySfId || defaultFindEntityBySfId;
  const append     = deps.appendActivityEvent || defaultAppendActivityEvent;
  const { workspaceId, actorId } = ctx || {};

  const summary = {
    total: Array.isArray(records) ? records.length : 0,
    matched: 0,
    skipped_no_entity: 0,
    skipped_no_id: 0,
    inserted: 0,
    deduped: 0,
    errors: 0,
    results: [],
  };

  if (!Array.isArray(records) || records.length === 0) return summary;

  for (const rec of records) {
    const sfId = rec?.sf_id || rec?.Id || rec?.id || null;
    if (!sfId) {
      summary.skipped_no_id += 1;
      summary.results.push({ sf_id: null, outcome: 'skipped_no_id' });
      continue;
    }

    const whoId  = rec.who_id  || rec.WhoId  || null;   // Contact
    const whatId = rec.what_id || rec.WhatId || null;   // Account / other

    // Resolve the LCC entity — Contact (who) first, then Account (what).
    let entity = null;
    let resolvedVia = null;
    try {
      if (whoId) {
        entity = await findEntity(workspaceId, 'Contact', whoId);
        if (entity) resolvedVia = 'contact';
      }
      if (!entity && whatId) {
        entity = await findEntity(workspaceId, 'Account', whatId);
        if (entity) resolvedVia = 'account';
      }
    } catch (err) {
      summary.errors += 1;
      summary.results.push({ sf_id: sfId, outcome: 'error', error: err?.message || String(err) });
      continue;
    }

    const entityId = entity?.entityId || null;
    if (!entityId) {
      // Never guess — record the skip so the feed is observable, but don't
      // manufacture an entity.
      summary.skipped_no_entity += 1;
      summary.results.push({ sf_id: sfId, outcome: 'skipped_no_entity' });
      continue;
    }

    summary.matched += 1;
    const category = mapSfTypeToCategory(rec.type || rec.TaskSubtype || rec.EventSubtype);

    let appendRes;
    try {
      appendRes = await append({
        workspaceId,
        actorId,
        category,
        title:       rec.subject || rec.Subject || `(SF ${category})`,
        body:        rec.description || rec.Description || null,
        entityId,
        sourceType:  'salesforce',
        externalId:  String(sfId),
        occurredAt:  rec.activity_date || rec.ActivityDate || rec.activityDate || null,
        metadata: {
          sf_id:     String(sfId),
          sf_type:   rec.type || rec.TaskSubtype || rec.EventSubtype || null,
          sf_status: rec.status || rec.Status || null,
          who_id:    whoId,
          what_id:   whatId,
          resolved_via: resolvedVia,
        },
      });
    } catch (err) {
      // appendActivityEvent never throws, but stay defensive.
      summary.errors += 1;
      summary.results.push({ sf_id: sfId, outcome: 'error', error: err?.message || String(err) });
      continue;
    }

    if (appendRes?.ok && appendRes.inserted) {
      summary.inserted += 1;
      summary.results.push({ sf_id: sfId, entity_id: entityId, outcome: 'inserted' });
    } else if (appendRes?.ok) {
      summary.deduped += 1;
      summary.results.push({ sf_id: sfId, entity_id: entityId, outcome: 'deduped' });
    } else {
      summary.errors += 1;
      summary.results.push({ sf_id: sfId, entity_id: entityId, outcome: 'error', reason: appendRes?.reason || 'append_failed' });
    }
  }

  return summary;
}

// ============================================================================
// HTTP handler
// ============================================================================

export async function handleSfActivityIngest(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace']
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  if (!requireRole(user, 'operator', workspaceId)) {
    return res.status(403).json({ error: 'Operator role required' });
  }

  const body = req.body || {};
  const records = Array.isArray(body) ? body
    : Array.isArray(body.records) ? body.records
    : Array.isArray(body.activities) ? body.activities
    : null;

  if (!records) {
    return res.status(400).json({ error: 'Body must be an array or { records: [...] }' });
  }
  if (records.length > MAX_BATCH) {
    return res.status(413).json({ error: `Batch too large (${records.length} > ${MAX_BATCH})` });
  }

  // activity_events.actor_id is NOT NULL → users(id); the SF record carries no
  // LCC user, so the authenticated caller is the actor for the mirror.
  const summary = await processSfActivityBatch(records, {
    workspaceId,
    actorId: user.id,
  });

  return res.status(200).json({ ok: true, ...summary });
}
