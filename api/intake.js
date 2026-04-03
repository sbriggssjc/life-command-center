// ============================================================================
// Unified Intake API — Consolidated from intake-outlook-message.js + intake-summary.js
// Life Command Center
//
// POST /api/intake?_route=outlook-message   — deterministic single-message intake
// GET  /api/intake?_route=summary           — Teams/Automation formatted summary
//
// CONSOLIDATION NOTE (2026-04-03):
// Merged to stay within Vercel Hobby plan 12-function limit.
// See LCC_ARCHITECTURE_STRATEGY.md and .github/AI_INSTRUCTIONS.md
// ============================================================================

import { createHash } from 'crypto';
import { authenticate, handleCors, requireRole } from './_shared/auth.js';
import { opsQuery, requireOps, withErrorHandler } from './_shared/ops-db.js';

// ============================================================================
// ROUTE DISPATCHER
// ============================================================================

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const route = req.query._route;

  switch (route) {
    case 'outlook-message':
      return handleOutlookMessage(req, res);
    case 'summary':
      return handleIntakeSummary(req, res);
    default:
      return res.status(400).json({
        error: 'Invalid _route. Use: outlook-message, summary'
      });
  }
});

// ============================================================================
// OUTLOOK SINGLE-MESSAGE INTAKE (was intake-outlook-message.js)
// ============================================================================

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

async function handleOutlookMessage(req, res) {
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
}

// ============================================================================
// INTAKE SUMMARY (was intake-summary.js)
// ============================================================================

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 20;

function parseLimit(raw) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function buildAppBaseUrl(req) {
  if (process.env.LCC_APP_URL) return process.env.LCC_APP_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

function truncate(text, maxLen = 220) {
  if (!text) return '';
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}...`;
}

function correlationToIsoFloor(correlationId) {
  const raw = String(correlationId || '');
  let ts = null;
  const emailMatch = raw.match(/^email-(\d{10,})/);
  if (emailMatch) {
    ts = Number(emailMatch[1]);
  } else {
    const tailMatch = raw.match(/-(\d{10,})$/);
    if (tailMatch) ts = Number(tailMatch[1]);
  }
  if (!Number.isFinite(ts)) return null;
  return new Date(Math.max(0, ts - 5 * 60 * 1000)).toISOString();
}

function mapItemForTeams(item, appBase) {
  const senderName = item.metadata?.sender_name || item.metadata?.sender_email || 'Unknown sender';
  const senderEmail = item.metadata?.sender_email || null;
  const subject = item.title || '(No subject)';
  const summary = truncate(item.body || item.metadata?.body_preview || '');
  const inboxUrl = `${appBase}/?page=pageInbox&inbox_id=${encodeURIComponent(item.id)}`;
  return {
    inbox_item_id: item.id,
    sender: senderName,
    sender_email: senderEmail,
    subject,
    summary,
    received_at: item.received_at || null,
    status: item.status || 'new',
    priority: item.priority || 'normal',
    has_attachments: Boolean(item.metadata?.has_attachments),
    lcc_item_url: inboxUrl,
    suggested_actions: ['triage', 'assign', 'promote']
  };
}

async function handleIntakeSummary(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships?.[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const limit = parseLimit(req.query.limit);
  const correlationId = req.query.correlation_id ? String(req.query.correlation_id) : '';
  const appBase = buildAppBaseUrl(req);

  let path = `inbox_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&source_type=eq.flagged_email&select=id,title,body,status,priority,received_at,metadata&order=received_at.desc&limit=${limit * 6}`;
  const floorIso = correlationToIsoFloor(correlationId);
  if (floorIso) path += `&received_at=gte.${encodeURIComponent(floorIso)}`;

  const result = await opsQuery('GET', path);
  if (!result.ok) {
    return res.status(result.status || 500).json({ error: 'Failed to fetch inbox intake summary' });
  }

  const rows = Array.isArray(result.data) ? result.data : [];
  const filtered = correlationId
    ? rows.filter(r => String(r.metadata?.correlation_id || '') === correlationId)
    : rows;
  const top = filtered.slice(0, limit);
  const items = top.map(item => mapItemForTeams(item, appBase));

  return res.status(200).json({
    correlation_id: correlationId || null,
    workspace_id: workspaceId,
    count: items.length,
    items
  });
}
