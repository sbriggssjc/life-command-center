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
import {
  advanceCadence as defaultAdvanceCadence,
  resolveCadenceForEntity as defaultResolveCadenceForEntity,
} from '../_shared/cadence-engine.js';

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

// OUTREACH #1 (RC1) — conservative outreach-subject shapes. Scott logs most of
// his real outreach in Salesforce as PLAIN Tasks (sf_type='Task', no
// TaskSubtype), which mapSfTypeToCategory collapses to 'note' — and the advance
// trigger skips 'note', so the touch never advances the cadence. Grounded live
// 2026-06-19: 29/31 recent 'note' SF events are real outreach. We recover the
// real category from the SUBJECT for those Tasks only; genuine internal notes
// ("2 - Medical Buyer/Portfolio") match neither pattern and stay 'note'.
const SF_EMAIL_SUBJECT_RE = /\bsent\b|^\s*(re|aw|antw|sv|vs|rv|fw|fwd)\s*:|\bre:|\bfw:|\bfwd:/i;
const SF_CALL_SUBJECT_RE  = /\bcall\b|voicemail|left\s+(a\s+)?(vm|message)/i;

/**
 * Derive the activity category for a Salesforce record. When the SF type maps
 * to a concrete channel (Call/Email/Meeting) that wins. When it collapses to
 * 'note' (a plain Task), infer the real channel from the subject so genuine
 * outreach logged as a Task advances the cadence — email markers
 * (sent/Re:/Fw:) first, then call markers (Call/voicemail), else 'note'.
 *
 * @param {string} type    SF type / TaskSubtype
 * @param {string} subject SF subject line
 * @returns {'call'|'email'|'meeting'|'note'}
 */
export function deriveSfCategory(type, subject) {
  const base = mapSfTypeToCategory(type);
  if (base !== 'note') return base;
  // Only infer outreach for generic Tasks / unknown activity types. An explicit
  // SF 'Note' object is a real note attachment, not a logged touch — leave it.
  if (String(type || '').toLowerCase() === 'note') return 'note';
  const s = String(subject || '');
  if (SF_EMAIL_SUBJECT_RE.test(s)) return 'email';
  if (SF_CALL_SUBJECT_RE.test(s))  return 'call';
  return 'note';
}

/**
 * Decide whether a mirrored email activity is an INBOUND REPLY from the
 * contact (R24 Unit 2). A reply is a high-signal touch that should advance the
 * cadence into active-engagement, not be counted as one of our outbound sends.
 *
 * Signals (any one):
 *   - an explicit inbound flag on the record (SF EmailMessage.Incoming, or a
 *     direction field the PA flow may add)
 *   - a subject line that begins with a reply prefix (RE:, AW:, etc.)
 *
 * Only meaningful for the 'email' category.
 */
export function isInboundReply(category, rec, subject) {
  if (category !== 'email') return false;
  const incoming = rec?.incoming ?? rec?.Incoming ?? rec?.is_incoming ?? null;
  if (incoming === true || String(incoming).toLowerCase() === 'true') return true;
  const dir = String(rec?.direction ?? rec?.Direction ?? '').toLowerCase();
  if (dir === 'inbound' || dir === 'incoming' || dir === 'received') return true;
  return /^\s*(re|aw|antw|sv|vs|rv)\s*:/i.test(String(subject || ''));
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
  const findEntity     = deps.findEntityBySfId || defaultFindEntityBySfId;
  const append         = deps.appendActivityEvent || defaultAppendActivityEvent;
  const advance        = deps.advanceCadence || defaultAdvanceCadence;
  const resolveCadence = deps.resolveCadenceForEntity || defaultResolveCadenceForEntity;
  const { workspaceId, actorId } = ctx || {};

  const summary = {
    total: Array.isArray(records) ? records.length : 0,
    matched: 0,
    skipped_no_entity: 0,
    skipped_no_id: 0,
    inserted: 0,
    deduped: 0,
    errors: 0,
    replies_captured: 0,
    results: [],
  };

  if (!Array.isArray(records) || records.length === 0) return summary;

  for (const rec of records) {
    // Accept EITHER the canonical shape ({sf_id, type, subject, ...}) OR the
    // raw Salesforce "Get records (Tasks)" field names ({Id, TaskSubtype,
    // Subject, ...}) so the PA flow can POST the SF output with no in-flow
    // field mapping. The canonical key wins when both are present.
    const sfId    = rec?.sf_id        ?? rec?.Id ?? rec?.id ?? null;
    const rawType = rec?.type         ?? rec?.TaskSubtype ?? rec?.EventSubtype ?? rec?.Type ?? null;
    const subject = rec?.subject      ?? rec?.Subject ?? null;
    const descr   = rec?.description  ?? rec?.Description ?? null;
    const actDate = rec?.activity_date ?? rec?.ActivityDate ?? rec?.activityDate ?? null;
    const whoId   = rec?.who_id       ?? rec?.WhoId ?? null;   // Contact
    const whatId  = rec?.what_id      ?? rec?.WhatId ?? null;  // Account / other
    const status  = rec?.status       ?? rec?.Status ?? null;
    // WHO logged this Task — the SF Task.OwnerId. Records it so the timeline can
    // attribute "my team" vs "NorthMarq debt" touches. Owner.Name only rides
    // along if the flow ever expands it; null otherwise (id is enough to group).
    const ownerId   = rec?.owner_id   ?? rec?.OwnerId ?? null;
    const ownerName = rec?.owner_name ?? rec?.OwnerName ?? rec?.Owner?.Name ?? null;

    if (!sfId) {
      summary.skipped_no_id += 1;
      summary.results.push({ sf_id: null, outcome: 'skipped_no_id' });
      continue;
    }

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
    // OUTREACH #1 (RC1) — subject-aware so a plain SF Task that is really an
    // email/call advances the cadence instead of being a dead 'note'.
    const category = deriveSfCategory(rawType, subject);
    const replyTouch = isInboundReply(category, rec, subject);

    const metadata = {
      sf_id:     String(sfId),
      sf_type:   rawType,
      sf_status: status,
      who_id:    whoId,
      what_id:   whatId,
      activity_date: actDate,
      resolved_via: resolvedVia,
      owner_id:   ownerId,
      owner_name: ownerName,
    };
    // R24 Unit 2 — for an inbound reply, the JS advanceCadence path owns the
    // advance (sets emails_replied + the converted/pause branch), so tag the
    // event skip_cadence_advance='true' to keep the SQL trigger from also
    // advancing it (the R10 single-advance-owner doctrine).
    if (replyTouch) {
      metadata.is_reply = true;
      metadata.skip_cadence_advance = 'true';
    }

    let appendRes;
    try {
      appendRes = await append({
        workspaceId,
        actorId,
        category,
        title:       subject || `(SF ${category})`,
        body:        descr,
        entityId,
        sourceType:  'salesforce',
        externalId:  String(sfId),
        occurredAt:  actDate,
        metadata,
      });
    } catch (err) {
      // appendActivityEvent never throws, but stay defensive.
      summary.errors += 1;
      summary.results.push({ sf_id: sfId, outcome: 'error', error: err?.message || String(err) });
      continue;
    }

    if (appendRes?.ok && appendRes.inserted) {
      summary.inserted += 1;
      // R24 Unit 2 — a freshly-inserted inbound reply advances the cadence
      // (emails_replied++, unopened reset, → converted). Only on `inserted` so
      // a re-POST of the same SF id (deduped) never double-counts. Best-effort:
      // a missing cadence or a failed advance never fails the mirror.
      let replyAdvanced = false;
      if (replyTouch) {
        try {
          const cad = await resolveCadence(entityId);
          if (cad?.id) {
            const adv = await advance(cad.id, { type: 'reply', direction: 'inbound', outcome: 'replied' });
            replyAdvanced = !!(adv && adv.ok);
            if (replyAdvanced) summary.replies_captured += 1;
          }
        } catch (err) {
          // non-blocking — the activity is recorded regardless
          replyAdvanced = false;
        }
      }
      summary.results.push({ sf_id: sfId, entity_id: entityId, outcome: 'inserted', reply_captured: replyAdvanced });
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
