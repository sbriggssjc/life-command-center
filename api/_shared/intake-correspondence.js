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
import { growCadenceFromOutreach as defaultGrowCadenceFromOutreach } from './cadence-engine.js';
import { opsQuery as defaultOpsQuery, resolvePrimaryWorkspaceId } from './ops-db.js';

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
  const grow   = deps.growCadenceFromOutreach || defaultGrowCadenceFromOutreach;

  // Guard 1: only the email channel carries email correspondence.
  if (channel !== 'email') return { ok: false, skipped: 'not_email_channel' };

  // Guard 2: never log against a guessed / null entity.
  if (!matchedEntityId) return { ok: false, skipped: 'no_entity_match' };

  const ctx = emailContext || {};
  // The dedup key — without it, re-processing the same email would insert a
  // duplicate timeline row every time, so we skip rather than log un-deduped.
  const externalId = ctx.internet_message_id || ctx.message_id || null;
  if (!externalId) return { ok: false, skipped: 'no_message_id' };

  const res = await append({
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

  // Phase 1 (2026-07-13) — capture Scott's REAL pipeline. Email-OM
  // correspondence matches to a PROPERTY (asset), so growing hops to the OWNER
  // (the R10 owns-hop, inside growCadenceFromOutreach): property-page email
  // becomes owner cadence tracking. Best-effort, fresh-insert only.
  if (res?.inserted) {
    try {
      await grow({ entityId: matchedEntityId, category: 'email',
        domain: normalizeActivityDomain(matchedDomain) });
    } catch (_e) { /* best-effort — the timeline row is written regardless */ }
  }
  return res;
}

// ============================================================================
// LIVE INBOUND dual-anchor stamp — the inbound mirror of handleOutlookSent
// ----------------------------------------------------------------------------
// logEmailIntakeCorrespondence (above) only fires on a CONFIDENT property/OM
// match, so ordinary inbound BD mail from a known party — a broker reply, a
// seller note — was never logged or party-stamped. This logs EVERY flagged
// inbound email as an `outlook_inbound` activity, resolving the sender's PARTY
// (the durable BD unit) and OPEN deal (active sub-context) via
// lcc_resolve_contact and stamping the dual anchor — exactly as the outbound
// path (handleOutlookSent) does for sent mail. This is what makes NEW inbound
// mail self-resolve to the relationship going forward, with no re-drain.
//
// Doctrine:
//   - Relationship-primary: the PARTY is the durable anchor; the OPEN deal is a
//     subfilter. A sender with no open deal still logs on the party (entity_id
//     null → attention rides the relationship, by design).
//   - Skip internal (northmarq) / empty senders — not a BD party.
//   - Dedup on (workspace, source_type='outlook_inbound', internet_message_id)
//     via appendActivityEvent, so PA's 3–6 replays are a no-op.
//   - Fire-and-forget: never blocks OM intake; a resolver hiccup still logs the
//     raw inbound touch (party/deal simply null).
//
// @param {object} args
// @param {string} args.workspaceId
// @param {string} args.actorId
// @param {object} args.emailContext  — { internet_message_id, subject,
//                                       body_snippet, web_link, received_at,
//                                       from, to }
// @param {object} [deps]             — { appendActivityEvent, opsQuery } for testing
export async function logInboundCorrespondenceDualAnchor({
  workspaceId,
  actorId,
  emailContext,
}, deps = {}) {
  const append = deps.appendActivityEvent || defaultAppendActivityEvent;
  const query  = deps.opsQuery || defaultOpsQuery;

  const ctx  = emailContext || {};
  const from = (ctx.from || '').toString().trim().toLowerCase();
  // Guard: only external senders are BD parties (internal/self carry no party).
  if (!from || from.includes('northmarq')) return { ok: false, skipped: 'internal_or_no_sender' };
  const externalId = ctx.internet_message_id || ctx.message_id || null;
  if (!externalId) return { ok: false, skipped: 'no_message_id' };

  // Resolve the PARTY (durable BD unit) + OPEN deal (active sub-context) from
  // the sender. Best-effort: a resolver failure still logs the raw touch.
  let partyEntityId = null, dealEntityId = null;
  try {
    const rc = await query('POST', 'rpc/lcc_resolve_contact', { p_email: from, p_phone: null });
    const packet = Array.isArray(rc.data) ? rc.data[0] : rc.data;
    if (packet?.party_entity_id) partyEntityId = packet.party_entity_id;
    if (packet?.primary_deal)    dealEntityId  = packet.primary_deal;
  } catch (_e) { /* best-effort */ }

  const res = await append({
    workspaceId,
    actorId,
    category:    'email',
    title:       ('Received: ' + (ctx.subject || '(no subject)')).slice(0, 500),
    body:        ctx.body_snippet || null,
    entityId:    dealEntityId,          // OPEN-deal anchor (nullable → rides the party)
    sourceType:  'outlook_inbound',
    externalId,
    externalUrl: ctx.web_link || null,
    occurredAt:  ctx.received_at || null,
    metadata: {
      direction:       'inbound',
      from,
      to:              ctx.to || null,
      via:             'outlook_inbound',
      party_entity_id: partyEntityId,
      deal_entity_id:  dealEntityId,
    },
  });
  return {
    ok: true, inserted: !!res?.inserted,
    party_entity_id: partyEntityId, deal_entity_id: dealEntityId,
  };
}

// ============================================================================
// CALL dual-anchor stamp — the WebEx/telephony mirror of the email loggers
// ----------------------------------------------------------------------------
// WebEx call history lands in unified_contacts (engagement scoring) but never
// reached the OPS activity_events spine, so calls were invisible to the deal
// dossier / offer-context / cadence. This logs a call as a `call` activity on
// the SAME relationship-primary, deal-subfilter spine as email: it resolves the
// caller's PARTY + OPEN deal by PHONE (and email if known) via
// lcc_resolve_contact and stamps the dual anchor. Now that a `webex` phone
// identity can persist (external_identities CHECK widened), resolution improves
// as identities accrue; until then it falls back to entities.phone.
//
// Doctrine mirrors the email loggers: relationship-primary (a caller with no
// open deal still logs on the party; entity_id null → attention rides the
// relationship), dedup on (workspace, source_type, external_id) so a re-ingest
// is a no-op, fire-and-forget (never blocks the contacts pipeline; a resolver
// hiccup still logs the raw call with null anchors).
//
// @param {object} args
// @param {string} [args.workspaceId]  — OPS workspace; resolved if omitted
// @param {string} [args.actorId]      — defaults to the system actor
// @param {object} args.call           — { phone, name?, email?, direction
//                                        ('placed'|'received'|'outbound'|'inbound'),
//                                        occurred_at, external_id?, duration_seconds?,
//                                        disposition?, source_system? ('webex') }
// @param {object} [deps]              — { appendActivityEvent, opsQuery, resolveWorkspace }
export async function logCallDualAnchor({ workspaceId, actorId, call }, deps = {}) {
  const append = deps.appendActivityEvent || defaultAppendActivityEvent;
  const query  = deps.opsQuery || defaultOpsQuery;
  const resolveWs = deps.resolveWorkspace || resolvePrimaryWorkspaceId;

  const c = call || {};
  const phone = String(c.phone || '').trim();
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length < 10) return { ok: false, skipped: 'no_phone' };

  const sys = (c.source_system || 'webex').toLowerCase();
  // Deterministic dedup key when the source has no stable call id (WebEx call
  // history is {type,name,number,time}): system + last-10 + timestamp.
  const externalId = c.external_id || `${sys}:${digits.slice(-10)}:${c.occurred_at || ''}`;

  const ws = workspaceId || (await resolveWs({ opsQuery: query }).catch(() => null));
  if (!ws) return { ok: false, skipped: 'no_workspace' };
  const actor = actorId || 'b0000000-0000-0000-0000-000000000001';

  // Resolve PARTY (durable BD unit) + OPEN deal (active sub-context) by phone
  // (+ email when known). Best-effort: a resolver failure still logs the call.
  let partyEntityId = null, dealEntityId = null;
  try {
    const rc = await query('POST', 'rpc/lcc_resolve_contact', { p_email: c.email || null, p_phone: phone });
    const packet = Array.isArray(rc.data) ? rc.data[0] : rc.data;
    if (packet?.party_entity_id) partyEntityId = packet.party_entity_id;
    if (packet?.primary_deal)    dealEntityId  = packet.primary_deal;
  } catch (_e) { /* best-effort */ }

  const dir = (c.direction === 'placed' || c.direction === 'outbound') ? 'outbound'
            : (c.direction === 'received' || c.direction === 'inbound') ? 'inbound'
            : (c.direction || null);
  const who = c.name || phone;
  const title = ((dir === 'outbound' ? 'Call to ' : dir === 'inbound' ? 'Call from ' : 'Call: ') + who).slice(0, 500);
  const bodyBits = [];
  if (c.disposition) bodyBits.push('Disposition: ' + c.disposition);
  if (c.duration_seconds) bodyBits.push(c.duration_seconds + 's');

  const res = await append({
    workspaceId: ws,
    actorId: actor,
    category:    'call',
    title,
    body:        bodyBits.length ? bodyBits.join(' · ') : null,
    entityId:    dealEntityId,           // OPEN-deal anchor (nullable → rides the party)
    sourceType:  sys + '_call',          // e.g. 'webex_call'
    externalId,
    occurredAt:  c.occurred_at || null,
    metadata: {
      channel:          'call',
      via:              sys,
      direction:        dir,
      phone,
      name:             c.name || null,
      duration_seconds: c.duration_seconds || null,
      disposition:      c.disposition || null,
      party_entity_id:  partyEntityId,
      deal_entity_id:   dealEntityId,
    },
  });
  return {
    ok: true, inserted: !!res?.inserted,
    party_entity_id: partyEntityId, deal_entity_id: dealEntityId,
  };
}
