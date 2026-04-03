// ============================================================================
// Outlook Single-Message Intake API — Deterministic event-level orchestration
// Life Command Center
//
// POST /api/intake-outlook-message
// Purpose:
// - Accept one Outlook-triggered message payload
// - Upsert exactly one inbox intake item
// - Emit deterministic correlation_id for event-level traceability
//
// Notes:
// - Does NOT alter core sync ingestion pipeline in api/sync.js
// - Thin orchestration endpoint for Power Automate event determinism
// ============================================================================

import { createHash } from 'crypto';
import { authenticate, handleCors, requireRole } from './_shared/auth.js';
import { opsQuery, requireOps, withErrorHandler } from './_shared/ops-db.js';

function isoOrNow(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function normalizeSender(sender) {
  if (!sender) return { name: null, email: null };
  if (typeof sender === 'string') return { name: null, email: sender };
  if (sender.emailAddress) {
    return {
      name: sender.emailAddress.name || null,
      email: sender.emailAddress.address || null
    };
  }
  return {
    name: sender.name || null,
    email: sender.email || null
  };
}

function deterministicCorrelationId(workspaceId, externalId, receivedAtIso) {
  const base = `${workspaceId}|${externalId}|${receivedAtIso}`;
  const digest = createHash('sha1').update(base).digest('hex').slice(0, 12);
  const ts = new Date(receivedAtIso).getTime();
  return `outlook-msg-${digest}-${ts}`;
}

function firstNonEmpty(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships?.[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  if (!requireRole(user, 'operator', workspaceId)) {
    return res.status(403).json({ error: 'Operator role required' });
  }

  const payload = req.body || {};
  const messageId = firstNonEmpty(payload.message_id, payload.id, payload.internet_message_id);
  const subject = firstNonEmpty(payload.subject, '(No subject)');
  const bodyPreview = firstNonEmpty(payload.body_preview, payload.bodyPreview, payload.body, '');
  const webLink = firstNonEmpty(payload.web_link, payload.webLink, null);
  const receivedAtIso = isoOrNow(firstNonEmpty(payload.received_date_time, payload.receivedDateTime, payload.received_at));
  const sender = normalizeSender(firstNonEmpty(payload.from, payload.sender, payload.sender_email));
  const hasAttachments = Boolean(firstNonEmpty(payload.has_attachments, payload.hasAttachments, false));
  const attachmentCount = Array.isArray(payload.attachments) ? payload.attachments.length : null;

  if (!messageId) {
    return res.status(400).json({ error: 'message_id (or id/internet_message_id) is required' });
  }

  const correlationId = deterministicCorrelationId(workspaceId, String(messageId), receivedAtIso);

  const result = await opsQuery('POST', 'inbox_items', {
    workspace_id: workspaceId,
    source_user_id: user.id,
    assigned_to: user.id,
    title: String(subject),
    body: bodyPreview ? String(bodyPreview) : null,
    source_type: 'flagged_email',
    source_connector_id: null,
    external_id: String(messageId),
    external_url: webLink,
    status: 'new',
    priority: 'normal',
    visibility: 'private',
    metadata: {
      sender_name: sender.name,
      sender_email: sender.email,
      received_at: receivedAtIso,
      has_attachments: hasAttachments,
      attachment_count: attachmentCount,
      event_source: 'outlook_power_automate',
      correlation_id: correlationId
    },
    received_at: receivedAtIso
  }, { Prefer: 'return=representation,resolution=merge-duplicates' });

  if (!result.ok) {
    return res.status(result.status || 500).json({ error: 'Failed to ingest Outlook message', detail: result.data });
  }

  const item = Array.isArray(result.data) ? result.data[0] : result.data;
  return res.status(200).json({
    ok: true,
    correlation_id: correlationId,
    inbox_item_id: item?.id || null,
    external_id: String(messageId),
    status: item?.status || 'new'
  });
});

