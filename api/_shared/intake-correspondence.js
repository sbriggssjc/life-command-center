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

import { createHash } from 'crypto';
import { appendActivityEvent as defaultAppendActivityEvent } from './activity-events.js';
import { growCadenceFromOutreach as defaultGrowCadenceFromOutreach } from './cadence-engine.js';
import { opsQuery as defaultOpsQuery, resolvePrimaryWorkspaceId } from './ops-db.js';
import { deriveNextStep } from './next-step-ai.js';
import { invokeExtractionAI as defaultInvokeExtractionAI } from './ai.js';
const invokeExtractionAI = defaultInvokeExtractionAI;

// activity_events.domain carries the canonical short form 'dia' | 'gov'.
// The matcher hands us 'dialysis' | 'government' (or null for an lcc-direct
// match). Normalize; unknown → null (the column is nullable).
// W7.1 — conversation-thread continuity. Return the deal (entity_id) that a
// PRIOR message in the same Outlook conversation was stamped to, if any. We key
// on metadata.conversation_id across the dual-anchor sources and require a
// non-null entity_id (a deal-stamped row). Best-effort; null on any miss.
async function dealForConversation(query, workspaceId, conversationId) {
  if (!conversationId) return null;
  try {
    const r = await query('GET',
      `activity_events?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
      `&metadata->>conversation_id=eq.${encodeURIComponent(conversationId)}` +
      `&entity_id=not.is.null&select=entity_id&order=occurred_at.desc&limit=1`);
    return r.data?.[0]?.entity_id || null;
  } catch (_e) { return null; }
}

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

  // W7.1 conversation-thread continuity: if the resolver yielded no deal but a
  // PRIOR message in the same Outlook conversation is already deal-stamped, this
  // reply belongs to that same deal — cheap and precise (same thread). Fills the
  // gap for a party we can't yet resolve to a roster/deal.
  const conversationId = ctx.conversation_id || ctx.conversationId || null;
  if (!dealEntityId && conversationId) {
    dealEntityId = await dealForConversation(query, workspaceId, conversationId);
  }

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
      // Prompt 96 — preserve the sender/recipient DISPLAY names (feedstock for
      // the W9.4 comms-harvest header-pair arm). Fill-blanks: only present when
      // the ingestion payload actually carried a name.
      from_name:       ctx.from_name || null,
      to:              ctx.to || null,
      to_names:        Array.isArray(ctx.to_names) && ctx.to_names.length ? ctx.to_names : null,
      via:             'outlook_inbound',
      conversation_id: conversationId,
      party_entity_id: partyEntityId,
      deal_entity_id:  dealEntityId,
    },
  });

  // Self-updating to-do engine (inbound): the awaited party got back — resolve
  // the open seller follow-up and write the next step. Phase 1 derives the SPECIFIC
  // next action (type/title/due) from the message content; when it can't read a
  // clear intent (feature off, ambiguous, low confidence, AI down) it returns null
  // and the RPC falls back to the generic "review response & set next step". Fresh
  // insert only; best-effort. Subject rides as context so the new to-do carries
  // what the reply was about.
  if (res?.inserted && (dealEntityId || partyEntityId)) {
    // Resolve the sender's premise (seller/buyer/broker/other) from the entity graph so the
    // next-step is framed for who actually wrote — our deals are listings, so inbound mail is
    // usually a buyer or cooperating broker, not the seller. Best-effort; defaults to seller.
    let premise = 'seller';
    if (partyEntityId && dealEntityId) {
      try {
        const pr = await query('POST', 'rpc/lcc_party_role', { p_party: partyEntityId, p_deal: dealEntityId });
        const role = Array.isArray(pr.data) ? pr.data[0] : pr.data;
        if (typeof role === 'string' && role) premise = role;
      } catch (_e) { /* keep default */ }
    }
    let ns = null;
    try {
      ns = await deriveNextStep(ctx.subject, ctx.body_snippet || '', null, { invokeExtractionAI, premise });
    } catch (_e) { ns = null; } // deriveNextStep self-guards; this is belt-and-suspenders
    try {
      await query('POST', 'rpc/lcc_advance_todos', {
        p_entity_id: dealEntityId, p_activity_id: res.id || null,
        p_party_entity_id: partyEntityId, p_channel: 'email', p_direction: 'inbound',
        p_context: ctx.subject ? (((premise === 'broker' ? 'Broker' : premise === 'buyer' ? 'Buyer' : premise === 'other' ? 'Contact' : 'Seller')) + ' replied: ' + String(ctx.subject).slice(0, 160)) : null,
        // Phase 1 AI-derived next step (null-safe: unset => generic review_response):
        p_next_action: ns?.next_action ?? null,
        p_next_type: ns?.action_type ?? null,
        p_next_due_offset: ns?.due_offset ?? null,
      });
    } catch (_e) { /* best-effort */ }
    // Deal-level reconciliation: stamp the deal's open deal_next_step to-dos with this
    // inbound reply (ball_in_court='us', de-stale) — the layer lcc_advance_todos doesn't
    // cover. Only when a deal is anchored; non-destructive; best-effort.
    if (dealEntityId) {
      try {
        await query('POST', 'rpc/lcc_reconcile_deal_todo', {
          p_deal_entity_id: dealEntityId, p_direction: 'inbound',
          p_activity_id: res.id || null, p_subject: ctx.subject || null,
          p_occurred_at: ctx.received_at || null,
        });
      } catch (_e) { /* best-effort */ }
    }
  }

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

  // Multi-channel auto-resolve: an OUTBOUND (placed) call closes a "reach out"
  // follow_up on the party/deal, the same way a send does. Fresh insert + outbound
  // only; best-effort (never blocks). Inbound/received calls just log on the spine.
  if (res?.inserted && dir === 'outbound' && (dealEntityId || partyEntityId)) {
    try {
      await query('POST', 'rpc/lcc_autoresolve_todos', {
        p_entity_id: dealEntityId, p_activity_id: res.id || null,
        p_party_entity_id: partyEntityId, p_channel: 'call', p_direction: 'outbound',
      });
    } catch (_e) { /* best-effort */ }
  }

  return {
    ok: true, inserted: !!res?.inserted,
    party_entity_id: partyEntityId, deal_entity_id: dealEntityId,
  };
}

// ============================================================================
// W7.3 — MANUAL CALL NOTE (quick-log + Copilot log_call_note)
// ----------------------------------------------------------------------------
// A human-captured call: the deal surface "Log call" action (path A) and the
// Copilot `log_call_note` action (path B) both land here. Unlike
// logCallDualAnchor (which RESOLVES a caller by phone from a telephony feed),
// this logger takes the anchors the operator ALREADY chose — the deal and/or
// party are prefilled from the surface context, or resolved+picked by the
// Copilot handler BEFORE calling in (never guessed here). It writes ONE
// `call` activity on the SAME relationship-primary / deal-subfilter spine as
// the email + telephony loggers, so W7.2 propagates it with zero new
// propagation code (the tick keys on metadata.deal_entity_id).
//
// Doctrine mirrors the other loggers:
//   - Reuse appendActivityEvent (the single spine writer) + deriveNextStep +
//     lcc_advance_todos — NO new spine/to-do writer.
//   - Deal-stamp only what the caller resolved; a note with no anchor still
//     logs (attention rides the relationship / is back-fillable).
//   - Dedup on (workspace, source_type='manual_call', external_id) so a double
//     submit / Copilot replay is a no-op. external_id is caller-supplied or a
//     deterministic hash of (actor, occurred_at, notes).
//   - Ollama structuring is PROPOSAL-ONLY and gated: on any AI failure the raw
//     notes are logged unchanged — structuring NEVER blocks the log.
//   - Fire-and-forget side effects: a next-step / cadence hiccup never throws.
//
// @param {object} args
// @param {string}  args.workspaceId
// @param {string}  args.actorId
// @param {string} [args.dealEntityId]   — OPEN-deal anchor (from surface / picked)
// @param {string} [args.partyEntityId]  — party anchor (from surface / picked)
// @param {string} [args.direction]      — 'made'|'placed'|'outbound' | 'received'|'inbound'
// @param {string}  args.notes           — free-text call notes (required to log)
// @param {string} [args.contactName]    — who was called (display only)
// @param {string} [args.occurredAt]     — ISO; defaults to now
// @param {string} [args.source]         — 'quick_log' (default) | 'copilot'
// @param {string} [args.externalId]     — explicit dedup key (else derived)
// @param {boolean}[args.structure]      — attempt Ollama structuring (default true)
// @param {object} [deps]                — { appendActivityEvent, opsQuery, resolveWorkspace, structureCallNotes }
export async function logManualCallNote({
  workspaceId, actorId,
  dealEntityId = null, partyEntityId = null,
  direction = null, notes = '', contactName = null,
  occurredAt = null, source = 'quick_log', externalId = null,
  structure = true,
}, deps = {}) {
  const append    = deps.appendActivityEvent || defaultAppendActivityEvent;
  const query     = deps.opsQuery || defaultOpsQuery;
  const resolveWs = deps.resolveWorkspace || resolvePrimaryWorkspaceId;
  const structFn  = deps.structureCallNotes || structureCallNotes;

  const text = String(notes || '').trim();
  if (!text) return { ok: false, skipped: 'no_notes' };

  const ws = workspaceId || (await resolveWs({ opsQuery: query }).catch(() => null));
  if (!ws) return { ok: false, skipped: 'no_workspace' };
  const actor = actorId || 'b0000000-0000-0000-0000-000000000001';

  const dir = (direction === 'made' || direction === 'placed' || direction === 'outbound') ? 'outbound'
            : (direction === 'received' || direction === 'inbound') ? 'inbound'
            : (direction || null);
  const occ = occurredAt || new Date().toISOString();

  // Deterministic dedup key when none supplied: source + actor + time + short
  // hash of the note text (a re-submit of the SAME note is a no-op; a genuinely
  // different note gets its own row).
  const extId = externalId
    || `${source}:${String(actor).slice(0, 8)}:${occ}:${createHash('sha1').update(text).digest('hex').slice(0, 12)}`;

  // Proposal-only structuring for the W7.2 summarizer. Gated + best-effort:
  // any failure leaves `structured` null and the raw text is logged regardless.
  let structured = null;
  if (structure) {
    try { structured = await structFn(text, { invokeExtractionAI }); }
    catch (_e) { structured = null; }
  }

  const who = contactName || (dir === 'outbound' ? 'contact' : 'caller');
  const title = ((dir === 'outbound' ? 'Call to ' : dir === 'inbound' ? 'Call from ' : 'Call: ') + who).slice(0, 500);

  const res = await append({
    workspaceId: ws,
    actorId:     actor,
    category:    'call',
    title,
    body:        text.slice(0, 4000),   // raw notes → the tick summarizer reads body
    entityId:    dealEntityId,          // OPEN-deal anchor (nullable → rides the party)
    sourceType:  'manual_call',
    externalId:  extId,
    occurredAt:  occ,
    metadata: {
      channel:         'call',
      via:             source,
      direction:       dir,
      name:            contactName || null,
      call_notes:      text.slice(0, 4000),
      structured:      structured || null,   // {participants,topics,commitments} or null
      party_entity_id: partyEntityId,
      deal_entity_id:  dealEntityId,
    },
  });

  // Self-updating to-do (best-effort): a call note that states a commitment
  // ("send them the OM") should produce that to-do via the SAME guarded Phase-1
  // path the inbound-mail logger uses. Fresh insert + an anchor only.
  if (res?.inserted && (dealEntityId || partyEntityId)) {
    let ns = null;
    try {
      ns = await deriveNextStep(title, text, null, { invokeExtractionAI, premise: 'seller' });
    } catch (_e) { ns = null; } // deriveNextStep self-guards; belt-and-suspenders
    try {
      await query('POST', 'rpc/lcc_advance_todos', {
        p_entity_id: dealEntityId, p_activity_id: res.id || null,
        p_party_entity_id: partyEntityId, p_channel: 'call', p_direction: dir || 'outbound',
        p_context: ('Call note: ' + text).slice(0, 200),
        p_next_action: ns?.next_action ?? null,
        p_next_type: ns?.action_type ?? null,
        p_next_due_offset: ns?.due_offset ?? null,
      });
    } catch (_e) { /* best-effort */ }
  }

  return {
    ok: true, inserted: !!res?.inserted, id: res?.id || null,
    deal_entity_id: dealEntityId, party_entity_id: partyEntityId,
    structured: structured || null,
  };
}

// Structure free-text call notes into {participants, topics, commitments[]} for
// the W7.2 summarizer. PROPOSAL-ONLY + gated: returns null unless Ollama is
// configured (OLLAMA_URL), and null on any AI/parse failure so the caller logs
// the raw text unchanged. Never fabricates — a field the model can't fill stays
// an empty array. invokeExtractionAI already routes local-Ollama-first.
export async function structureCallNotes(notes, deps = {}) {
  const text = String(notes || '').trim();
  if (!text) return null;
  // Gate: only spend on structuring when a local model is configured. Keeps this
  // strictly proposal-only / no surprise cloud spend on every call log.
  if (!process.env.OLLAMA_URL) return null;
  const invoke = deps.invokeExtractionAI || invokeExtractionAI;

  const prompt =
    'Extract structured facts from these CRE call notes. Return ONLY minified JSON with keys '
    + '"participants" (array of names mentioned), "topics" (array of short topic phrases), and '
    + '"commitments" (array of {who, what, due} for any promised next actions). '
    + 'Do NOT invent anything not in the notes; use empty arrays when unstated.\n\nNOTES:\n'
    + text.slice(0, 6000);

  let r;
  try { r = await invoke({ prompt }); } catch (_e) { return null; }
  if (!r?.ok) return null;
  const raw = r?.data?.response || '';
  const parsed = safeParseJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const arr = (v) => Array.isArray(v) ? v : [];
  return {
    participants: arr(parsed.participants).map((x) => String(x)).slice(0, 20),
    topics:       arr(parsed.topics).map((x) => String(x)).slice(0, 20),
    commitments:  arr(parsed.commitments).slice(0, 20).map((c) =>
                    (c && typeof c === 'object')
                      ? { who: c.who ? String(c.who) : null, what: c.what ? String(c.what) : null, due: c.due ? String(c.due) : null }
                      : { who: null, what: String(c), due: null }),
  };
}

// Tolerant JSON extraction — models often wrap JSON in prose / code fences.
function safeParseJsonObject(s) {
  const str = String(s || '');
  try { return JSON.parse(str); } catch (_e) { /* fall through */ }
  const start = str.indexOf('{');
  const end = str.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(str.slice(start, end + 1)); } catch (_e) { /* noop */ }
  }
  return null;
}
