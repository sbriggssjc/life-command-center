// ============================================================================
// Intake Summary API — Teams/Automation-friendly formatted intake payload
// Life Command Center
//
// GET /api/intake-summary?correlation_id=email-...&limit=5
// ============================================================================

import { authenticate, handleCors } from './_shared/auth.js';
import { opsQuery, requireOps, withErrorHandler } from './_shared/ops-db.js';

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
  // ingest_emails uses: email-<timestamp>
  const m = String(correlationId || '').match(/^email-(\d{10,})/);
  if (!m) return null;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts)) return null;
  // Include a small backoff window to avoid edge clock skew.
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

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

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
});

