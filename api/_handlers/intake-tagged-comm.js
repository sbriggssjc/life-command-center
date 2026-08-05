// ============================================================================
// W7.3 path C — Outlook category-tagging receiver
// ----------------------------------------------------------------------------
// Zero-UI capture that works at SEND time: the operator assigns an Outlook
// CATEGORY to any message — `LCC` (auto-resolve the deal from the sender) or
// `LCC:<deal hint>` (explicit) — and a Power Automate flow (category-assigned
// trigger, works on SENT and RECEIVED mail) POSTs the message here. We resolve
// the deal (hint → open-deal name/tenant+city core → else the W7.1
// lcc_resolve_contact paths → else park in the tag_unresolved lane rather than
// guessing), then log it DEAL-STAMPED on the activity spine via the same
// appendActivityEvent the dual-anchor loggers use — so W7.2 propagates it with
// zero new propagation code (the tick keys on metadata.deal_entity_id).
//
// Doctrine:
//   - Deal resolution NEVER guesses (no LLM in the gate); ambiguity → the
//     tag_unresolved My Work lane (a research_tasks row, idempotent).
//   - Idempotent on internet_message_id (activity_events unique index
//     (workspace, source_type='outlook_tagged', external_id)).
//   - Flag-gated (TAGGED_COMM_INTAKE_ENABLED) like other intake routes; no-ops
//     when unset. Auth: X-PA-Webhook-Secret (PA_WEBHOOK_SECRET) or a signed-in
//     operator.
//   - Best-effort side effects (next-step/cadence) never block the log.
// ============================================================================

import { appendActivityEvent } from '../_shared/activity-events.js';
import { opsQuery, pgFilterVal, resolvePrimaryWorkspaceId } from '../_shared/ops-db.js';
import { authenticate } from '../_shared/auth.js';
import { resolveDealByQuery, parseLccCategoryHint } from '../_shared/deal-resolve.js';
import { deriveNextStep } from '../_shared/next-step-ai.js';
import { invokeExtractionAI } from '../_shared/ai.js';

const PA_WEBHOOK_SECRET = process.env.PA_WEBHOOK_SECRET;
function authenticateWebhook(req) {
  if (!PA_WEBHOOK_SECRET) return true; // transitional: allow when unconfigured
  const provided = req.headers['x-pa-webhook-secret'] || '';
  if (!provided || provided.length !== PA_WEBHOOK_SECRET.length) return false;
  let mismatch = 0;
  for (let i = 0; i < PA_WEBHOOK_SECRET.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ PA_WEBHOOK_SECRET.charCodeAt(i);
  }
  return mismatch === 0;
}

const firstNonEmpty = (...xs) => xs.find((x) => x != null && String(x).trim() !== '') ?? null;
const SYSTEM_ACTOR = 'b0000000-0000-0000-0000-000000000001';

// Resolve a deal for the tagged message. Order: explicit hint → sender/recipient
// via lcc_resolve_contact → conversation-thread continuity. Returns
// { deal_entity_id, party_entity_id, method, ambiguous, candidates }.
async function resolveTaggedDeal({ hint, from, to, conversationId, workspaceId }, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const resolveDeal = deps.resolveDealByQuery || resolveDealByQuery;

  // 1) Explicit `LCC:<hint>` — conservative name/tenant+city match.
  if (hint) {
    const r = await resolveDeal(hint, { opsQuery: q }).catch(() => null);
    if (r && (r.matched === 'exact' || r.matched === 'unique')) {
      return { deal_entity_id: r.deal_entity_id, party_entity_id: null, method: 'hint_' + r.matched, ambiguous: false };
    }
    if (r && r.matched === 'ambiguous') {
      return { deal_entity_id: null, party_entity_id: null, method: 'hint_ambiguous', ambiguous: true, candidates: r.candidates };
    }
    // hint matched nothing → fall through to sender resolution
  }

  // 2) Sender / recipient via the W7.1 resolver.
  let partyEntityId = null, dealEntityId = null;
  const addrs = [from, ...(Array.isArray(to) ? to : [to])].filter(Boolean);
  for (const a of addrs) {
    const email = String(a).toLowerCase();
    if (!email || email.includes('northmarq')) continue;
    try {
      const rc = await q('POST', 'rpc/lcc_resolve_contact', { p_email: email, p_phone: null });
      const packet = Array.isArray(rc.data) ? rc.data[0] : rc.data;
      if (packet?.party_entity_id && !partyEntityId) partyEntityId = packet.party_entity_id;
      if (packet?.primary_deal) { dealEntityId = packet.primary_deal; break; }
    } catch (_e) { /* best-effort */ }
  }
  if (dealEntityId) return { deal_entity_id: dealEntityId, party_entity_id: partyEntityId, method: 'sender_resolver', ambiguous: false };

  // 3) Conversation-thread continuity — a prior deal-stamped message in the thread.
  if (conversationId && workspaceId) {
    try {
      const r = await q('GET',
        `activity_events?workspace_id=eq.${pgFilterVal(workspaceId)}` +
        `&metadata->>conversation_id=eq.${encodeURIComponent(conversationId)}` +
        `&entity_id=not.is.null&select=entity_id&order=occurred_at.desc&limit=1`);
      const eid = r?.data?.[0]?.entity_id || null;
      if (eid) return { deal_entity_id: eid, party_entity_id: partyEntityId, method: 'conversation', ambiguous: false };
    } catch (_e) { /* best-effort */ }
  }

  return { deal_entity_id: null, party_entity_id: partyEntityId, method: 'unresolved', ambiguous: false };
}

// Park an unresolved / ambiguous tagged message in the tag_unresolved My Work
// lane. Idempotent via the R21 research_tasks dedup index
// (source_table, source_record_id, research_type, domain).
async function parkUnresolved({ workspaceId, internetMsgId, subject, from, hint, candidates, reason }, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const row = {
    workspace_id: workspaceId,
    research_type: 'tag_unresolved',
    title: ('Tag a deal for: ' + (subject || '(no subject)')).slice(0, 300),
    instructions: 'An Outlook message was tagged for LCC but could not be matched to a single open deal ('
      + reason + '). Pick the deal (Copilot: tag_comm_to_deal with the internet_message_id) or ignore.',
    entity_id: null,
    domain: null,
    status: 'queued',
    priority: 30,
    source_record_id: String(internetMsgId),
    source_table: 'outlook_tagged',
    metadata: {
      internet_message_id: internetMsgId,
      subject: subject || null,
      from: from || null,
      hint: hint || null,
      candidates: Array.isArray(candidates) ? candidates.slice(0, 8) : null,
      reason,
    },
  };
  try {
    const r = await q('POST', 'research_tasks?on_conflict=source_table,source_record_id,research_type,domain',
      row, { headers: { Prefer: 'return=representation,resolution=ignore-duplicates' } });
    return { parked: true, id: Array.isArray(r.data) ? r.data[0]?.id : null };
  } catch (_e) {
    return { parked: false };
  }
}

export async function handleTaggedComm(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: `Method ${req.method} not allowed` });

  // Flag gate — inert until TAGGED_COMM_INTAKE_ENABLED is set in Railway.
  if (process.env.TAGGED_COMM_INTAKE_ENABLED !== 'true' && req.query.force !== '1') {
    return res.status(200).json({
      ok: true, skipped: 'flag_off',
      hint: 'Set TAGGED_COMM_INTAKE_ENABLED=true in Railway (feature_flags_registry: TAGGED_COMM_INTAKE) to enable, or call with ?force=1.',
    });
  }

  // Auth: PA webhook secret OR a signed-in operator.
  let user = null;
  if (!authenticateWebhook(req)) {
    user = await authenticate(req, res);
    if (!user) return; // authenticate already responded
  }

  const p = req.body || {};
  const internetMsgId = firstNonEmpty(p.internet_message_id, p.internetMessageId, p.message_id, p.id);
  if (!internetMsgId) return res.status(400).json({ error: 'internet_message_id is required' });

  const workspaceId = req.headers['x-lcc-workspace']
    || user?.memberships?.[0]?.workspace_id
    || process.env.LCC_PRIMARY_WORKSPACE_ID
    || process.env.LCC_DEFAULT_WORKSPACE_ID
    || (await resolvePrimaryWorkspaceId({ opsQuery }).catch(() => null));
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const subject = firstNonEmpty(p.subject, '(no subject)');
  const bodyPreview = (firstNonEmpty(p.body_preview, p.bodyPreview, p.body, '') || '').toString().slice(0, 4000) || null;
  const webLink = firstNonEmpty(p.web_link, p.webLink, null);
  const occurredAt = firstNonEmpty(p.sent_at, p.sentAt, p.received_at, p.receivedAt, p.sent_date_time, p.received_date_time) || new Date().toISOString();
  const conversationId = firstNonEmpty(p.conversation_id, p.conversationId, null);

  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const fromAddr = (String(firstNonEmpty(p.from, p.sender, '') || '').match(EMAIL_RE) || [])[0]?.toLowerCase() || null;
  const toAddrs = [...new Set((String(firstNonEmpty(p.to, p.to_recipients, p.recipients, '') || '').match(EMAIL_RE) || []).map((e) => e.toLowerCase()))];

  // Category gate — a message with no LCC category is a mis-fire; ignore quietly.
  const { tagged, hint } = parseLccCategoryHint(p.categories ?? p.category);
  if (!tagged) return res.status(200).json({ ok: true, logged: false, reason: 'no_lcc_category' });

  // Direction: a message the operator SENT vs one they RECEIVED. PA can pass it;
  // otherwise infer from an internal sender.
  const direction = firstNonEmpty(p.direction,
    (fromAddr && fromAddr.includes('northmarq')) ? 'outbound' : 'inbound');

  const resolved = await resolveTaggedDeal({ hint, from: fromAddr, to: toAddrs, conversationId, workspaceId });

  // Ambiguous / unresolved → park, do NOT guess.
  if (!resolved.deal_entity_id) {
    const reason = resolved.ambiguous ? 'ambiguous_hint' : 'no_deal_match';
    const park = await parkUnresolved({
      workspaceId, internetMsgId, subject, from: fromAddr, hint,
      candidates: resolved.candidates, reason,
    });
    return res.status(200).json({
      ok: true, logged: false, parked: park.parked, reason,
      candidates: resolved.candidates || undefined,
      note: 'No single open deal matched — parked in the tag_unresolved lane. Use Copilot tag_comm_to_deal with this internet_message_id to attach it.',
    });
  }

  // Log deal-stamped on the spine (idempotent on internet_message_id).
  const res2 = await appendActivityEvent({
    workspaceId,
    actorId: user?.id || user?.user_id || SYSTEM_ACTOR,
    category: 'email',
    title: ((direction === 'outbound' ? 'Sent (tagged): ' : 'Received (tagged): ') + subject).slice(0, 500),
    body: bodyPreview,
    entityId: resolved.deal_entity_id,
    sourceType: 'outlook_tagged',
    externalId: String(internetMsgId),
    externalUrl: webLink,
    occurredAt,
    metadata: {
      direction,
      from: fromAddr,
      to: toAddrs.length ? toAddrs : null,
      via: 'outlook_tagged',
      categories: Array.isArray(p.categories) ? p.categories : (p.categories ? [p.categories] : null),
      hint: hint || null,
      conversation_id: conversationId,
      resolution_method: resolved.method,
      party_entity_id: resolved.party_entity_id,
      deal_entity_id: resolved.deal_entity_id,
    },
  });

  // Best-effort self-updating to-do for an inbound tagged reply (mirror the
  // inbound dual-anchor logger). Fresh insert only; never blocks.
  if (res2?.inserted && direction === 'inbound') {
    let ns = null;
    try { ns = await deriveNextStep(subject, bodyPreview || '', null, { invokeExtractionAI, premise: 'seller' }); }
    catch (_e) { ns = null; }
    try {
      await opsQuery('POST', 'rpc/lcc_advance_todos', {
        p_entity_id: resolved.deal_entity_id, p_activity_id: res2.id || null,
        p_party_entity_id: resolved.party_entity_id, p_channel: 'email', p_direction: 'inbound',
        p_context: subject ? ('Tagged reply: ' + String(subject).slice(0, 160)) : null,
        p_next_action: ns?.next_action ?? null, p_next_type: ns?.action_type ?? null,
        p_next_due_offset: ns?.due_offset ?? null,
      });
    } catch (_e) { /* best-effort */ }
  }

  return res.status(200).json({
    ok: true,
    logged: !!res2?.inserted,
    duplicate: res2?.ok && !res2?.inserted,
    activity_id: res2?.id || null,
    deal_entity_id: resolved.deal_entity_id,
    resolution_method: resolved.method,
    note: 'Logged — the deal summary and next steps update within the hour.',
  });
}

// Exported for unit tests.
export { resolveTaggedDeal, parkUnresolved };
