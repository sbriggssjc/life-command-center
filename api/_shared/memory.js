// ============================================================================
// Memory Helper — entity-scoped interaction logging via activity_events
// Life Command Center — Cross-conversation knowledge layer
//
// Uses the existing activity_events table (schema/004_operations.sql) as the
// canonical timeline. Every Copilot write action and OM ingestion calls
// logCopilotInteraction() after success so future conversations can retrieve
// "what did I ask / do about this entity before".
//
// Retrieval lives in the context-broker edge function (extended separately) —
// this module is write-only.
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';

/**
 * @typedef {object} CopilotInteractionInput
 * @property {string} workspaceId      — required
 * @property {string} actorId          — required, users.id
 * @property {string|null} [entityId]  — optional; if null, logs at workspace level
 * @property {string} actionId         — e.g. 'intake.stage.om.v1', 'drafts.outreach.v1'
 * @property {string} summary          — one-line human-readable
 * @property {string} [turnText]       — optional raw user utterance or draft text
 * @property {('copilot_chat'|'outlook'|'teams'|'sidebar'|'email'|'sms')} channel
 * @property {object} [metadata]       — action-specific context
 * @property {string} [inboxItemId]    — optional link to inbox_items.id
 * @property {string} [actionItemId]   — optional link to action_items.id
 */

/**
 * Log a Copilot-driven interaction to activity_events.
 * Non-blocking by design: callers are expected to catch + swallow errors.
 *
 * Prefers category 'copilot_action' (added in migration 038); falls back to
 * 'note' with metadata.category_subtype so older DBs still accept the row.
 *
 * @param {CopilotInteractionInput} input
 * @returns {Promise<{ok:boolean, id?:string, error?:string}>}
 */
export async function logCopilotInteraction(input) {
  if (!input?.workspaceId || !input?.actorId) {
    return { ok: false, error: 'workspaceId and actorId required' };
  }

  const preferredCategory = 'copilot_action';
  const fallbackCategory  = 'note';

  const baseBody = {
    workspace_id:        input.workspaceId,
    actor_id:            input.actorId,
    visibility:          'private',
    title:               input.summary || `copilot:${input.actionId || 'interaction'}`,
    body:                input.turnText || null,
    entity_id:           input.entityId || null,
    inbox_item_id:       input.inboxItemId || null,
    action_item_id:      input.actionItemId || null,
    source_type:         'copilot',
    source_connector_id: null,
    external_id:         null,
    external_url:        null,
    metadata: {
      ...(input.metadata || {}),
      channel:   input.channel || null,
      action_id: input.actionId || null,
    },
  };

  // Attempt preferred category first
  const firstTry = await opsQuery('POST', 'activity_events', {
    ...baseBody,
    category: preferredCategory,
  });
  if (firstTry.ok) {
    const row = Array.isArray(firstTry.data) ? firstTry.data[0] : firstTry.data;
    return { ok: true, id: row?.id || null };
  }

  // If the enum value isn't present yet (pre-migration-038), fall back to 'note'
  // and stamp the real category into metadata for later back-fill.
  const secondTry = await opsQuery('POST', 'activity_events', {
    ...baseBody,
    category: fallbackCategory,
    metadata: {
      ...baseBody.metadata,
      category_subtype: preferredCategory,
    },
  });
  if (secondTry.ok) {
    const row = Array.isArray(secondTry.data) ? secondTry.data[0] : secondTry.data;
    return { ok: true, id: row?.id || null, fallback: true };
  }

  return {
    ok: false,
    error: 'activity_event_insert_failed',
    detail: secondTry.data,
  };
}

/**
 * Fetch the last N interactions for an entity, newest first.
 * Thin read helper used by the retrieve-context handler + context-broker.
 *
 * @param {object} p
 * @param {string} p.workspaceId
 * @param {string} p.entityId
 * @param {number} [p.limit=20]
 * @param {number} [p.windowDays=90]
 * @returns {Promise<{ok:boolean, rows:Array, error?:string}>}
 */
export async function getRecentInteractions({ workspaceId, entityId, limit = 20, windowDays = 90 }) {
  if (!workspaceId || !entityId) {
    return { ok: false, rows: [], error: 'workspaceId and entityId required' };
  }
  const sinceIso = new Date(Date.now() - windowDays * 86400 * 1000).toISOString();
  const path =
    `activity_events?workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&entity_id=eq.${pgFilterVal(entityId)}` +
    `&occurred_at=gte.${pgFilterVal(sinceIso)}` +
    `&select=id,category,title,body,metadata,source_type,occurred_at,actor_id,inbox_item_id,action_item_id` +
    `&order=occurred_at.desc&limit=${Math.max(1, Math.min(limit, 100))}`;
  const res = await opsQuery('GET', path);
  if (!res.ok) {
    return { ok: false, rows: [], error: res.data?.message || 'fetch_failed' };
  }
  return { ok: true, rows: res.data || [] };
}
