// ============================================================================
// Intake correspondence → activity_events
// Life Command Center — Phase 2 Slice 3b (Unit 1)
// ----------------------------------------------------------------------------
// When the email-OM intake channel resolves a confident entity match, the OM
// itself lands in the timeline (intake_om / copilot_action), but the EMAIL
// correspondence does not. This helper logs the email as an `email` activity
// on the matched entity so the conversation — not just the extracted OM —
// shows in the entity's activity_timeline (the Layer-3/4 "every agent
// informed" goal).
//
// Doctrine:
//   - Only fire on the EMAIL channel (other channels carry no email context).
//   - Only fire on a CONFIDENT entity match — never log against a guessed or
//     null entity.
//   - Dedup on the internet_message_id (the activity_events unique index keys
//     on (workspace_id, source_type, external_id)), so re-processing the same
//     email is a no-op.
//   - Fire-and-forget: appendActivityEvent never throws; a failed append must
//     NOT block intake.
// ============================================================================

import { appendActivityEvent as defaultAppendActivityEvent } from './activity-events.js';

// activity_events.domain carries the canonical short form 'dia' | 'gov'.
// The matcher hands us 'dialysis' | 'government' (or null for an lcc-direct
// match). Normalize; unknown → null (the column is nullable).
function normalizeActivityDomain(domain) {
  if (!domain) return null;
  const s = String(domain).toLowerCase();
  if (s === 'gov' || s === 'government') return 'gov';
  if (s === 'dia' || s === 'dialysis')  return 'dia';
  return null;
}

/**
 * Append an `email` activity row for a matched email-OM intake.
 *
 * Returns the appendActivityEvent result, or a skip envelope:
 *   { ok:false, skipped:'not_email_channel' | 'no_entity_match' | 'no_message_id' }
 *
 * @param {object} args
 * @param {string} args.channel            — intake channel ('email' to fire)
 * @param {object} args.emailContext       — { internet_message_id, subject,
 *                                            body_snippet, web_link, received_at,
 *                                            from, to }
 * @param {string} args.matchedEntityId    — confident LCC entity match (required)
 * @param {string} [args.matchedDomain]    — 'dialysis' | 'government' | null
 * @param {string} args.workspaceId
 * @param {string} args.actorId
 * @param {string} [args.intakeId]
 * @param {object} [deps]                  — { appendActivityEvent } for testing
 */
export async function logEmailIntakeCorrespondence({
  channel,
  emailContext,
  matchedEntityId,
  matchedDomain = null,
  workspaceId,
  actorId,
  intakeId = null,
}, deps = {}) {
  const append = deps.appendActivityEvent || defaultAppendActivityEvent;

  // Guard 1: only the email channel carries email correspondence.
  if (channel !== 'email') return { ok: false, skipped: 'not_email_channel' };

  // Guard 2: never log against a guessed / null entity.
  if (!matchedEntityId) return { ok: false, skipped: 'no_entity_match' };

  const ctx = emailContext || {};
  // The dedup key — without it, re-processing the same email would insert a
  // duplicate timeline row every time, so we skip rather than log un-deduped.
  const externalId = ctx.internet_message_id || ctx.message_id || null;
  if (!externalId) return { ok: false, skipped: 'no_message_id' };

  return append({
    workspaceId,
    actorId,
    category:    'email',
    title:       ctx.subject || '(no subject)',
    body:        ctx.body_snippet || null,
    entityId:    matchedEntityId,
    sourceType:  'email_intake',
    externalId,
    externalUrl: ctx.web_link || null,
    occurredAt:  ctx.received_at || null,
    domain:      normalizeActivityDomain(matchedDomain),
    metadata: {
      intake_id: intakeId || null,
      from:      ctx.from || null,
      to:        ctx.to  || null,
    },
  });
}
