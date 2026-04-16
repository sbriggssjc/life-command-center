// ============================================================================
// Briefing Email Handler — Renders the daily briefing as an email payload
// Life Command Center
//
// Exposed via:
//   GET /api/briefing-email   → (vercel.json rewrite)
// Which rewrites to /api/entity-hub?_domain=briefing-email and dispatches here.
//
// Shares query logic directly with /api/daily-briefing (imports the underlying
// Supabase fetch helpers) so this endpoint never HTTP-calls itself.
//
// Returns:
//   {
//     subject: "LCC Morning Briefing — Monday, April 11, 2026",
//     html:    "<table …>…</table>",   // inline-styled, no <html>/<head>/<body>
//     text:    "LCC Morning Briefing\n…",
//     generated_at: "2026-04-11T13:00:00.000Z",
//     role_view: "broker"
//   }
//
// Auth: STRICT X-LCC-Key enforcement via verifyApiKey imported from
// property-handler.js — same pattern as other _handlers/*.
// Workspace context: x-lcc-workspace header → LCC_DEFAULT_WORKSPACE_ID env.
// User context: x-lcc-user-id header → LCC_SYSTEM_USER_ID env.
// ============================================================================

import { verifyApiKey } from './property-handler.js';
import {
  fetchWorkCounts,
  fetchMyWork,
  fetchInboxSummary,
  fetchUnassignedWork,
  fetchSyncHealthSnapshot,
  fetchRecentSfActivity,
  fetchHotContacts,
  fetchDiaPipeline,
  buildStrategicPriorities,
  deriveItemTitle,
} from '../_shared/briefing-data.js';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatSubject(date) {
  const day = DAYS[date.getUTCDay()];
  const month = MONTHS[date.getUTCMonth()];
  const d = date.getUTCDate();
  const y = date.getUTCFullYear();
  return `LCC Morning Briefing \u2014 ${day}, ${month} ${d}, ${y}`;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDueDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;
}

// ---------------------------------------------------------------------------
// HTML rendering — inline-styled, max-width 600px, table-based, Calibri/Arial,
// header color #003087. No <html>/<head>/<body> wrappers (email-client safe).
// ---------------------------------------------------------------------------

const FONT = "font-family:Calibri,Arial,sans-serif;";
const HEADER = "#003087";

function renderSectionHeader(title) {
  return (
    `<tr><td style="${FONT}padding:16px 20px 8px 20px;` +
    `border-bottom:2px solid ${HEADER};">` +
    `<h2 style="margin:0;color:${HEADER};font-size:16px;` +
    `text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(title)}</h2>` +
    `</td></tr>`
  );
}

function renderEmptyRow(message) {
  return (
    `<tr><td style="${FONT}padding:10px 20px;color:#666;font-size:13px;` +
    `font-style:italic;">${escapeHtml(message)}</td></tr>`
  );
}

function renderItemRow(item) {
  const title = escapeHtml(deriveItemTitle(item) || '(untitled)');
  const due = fmtDueDate(item.due_date);
  const metaBits = [];
  if (item.domain) metaBits.push(escapeHtml(item.domain));
  if (item.priority) metaBits.push(escapeHtml(item.priority));
  if (due) metaBits.push(`due ${escapeHtml(due)}`);
  const meta = metaBits.length
    ? `<div style="color:#666;font-size:12px;margin-top:2px;">${metaBits.join(' &middot; ')}</div>`
    : '';
  return (
    `<tr><td style="${FONT}padding:8px 20px;border-bottom:1px solid #eee;` +
    `font-size:14px;color:#222;">` +
    `<div style="font-weight:600;">${title}</div>${meta}` +
    `</td></tr>`
  );
}

function renderStrategicSection(priorities) {
  const today = Array.isArray(priorities?.today_priorities)
    ? priorities.today_priorities
    : Array.isArray(priorities?.today_top_5)
      ? priorities.today_top_5
      : [];
  const strategic = today.filter((i) => (i.tier || i._tier) === 'strategic');
  const pool = strategic.length ? strategic : today.slice(0, 5);
  const rows = pool.length
    ? pool.slice(0, 5).map(renderItemRow).join('')
    : renderEmptyRow('No strategic priorities surfaced for today.');
  return renderSectionHeader('Strategic Priorities') + rows;
}

function renderUrgentSection(priorities) {
  const overdue = Array.isArray(priorities?.my_overdue) ? priorities.my_overdue : [];
  const dueThisWeek = Array.isArray(priorities?.my_due_this_week) ? priorities.my_due_this_week : [];
  const combined = [...overdue, ...dueThisWeek].slice(0, 5);
  const rows = combined.length
    ? combined.map(renderItemRow).join('')
    : renderEmptyRow('No overdue or urgent items.');
  return renderSectionHeader('Urgent Items') + rows;
}

function renderPipelineSection(priorities, syncHealth) {
  const deals = Array.isArray(priorities?.pipeline_deals) ? priorities.pipeline_deals : [];
  const parts = [renderSectionHeader('Pipeline Health')];
  if (deals.length) {
    parts.push(deals.slice(0, 5).map(renderItemRow).join(''));
  } else {
    parts.push(renderEmptyRow('No active pipeline deals surfaced.'));
  }
  const s = syncHealth?.summary || {};
  const healthBits = [
    `${s.healthy || 0} healthy`,
    `${s.degraded || 0} degraded`,
    `${s.error || 0} error`,
  ].join(' &middot; ');
  parts.push(
    `<tr><td style="${FONT}padding:8px 20px;color:#444;font-size:12px;">` +
    `Connectors: ${healthBits}</td></tr>`
  );
  return parts.join('');
}

function renderQueueSection(workCounts, inboxSummary) {
  const rows = [
    ['Open actions', workCounts.open || 0],
    ['Overdue', workCounts.overdue || 0],
    ['Due today', workCounts.due_today || 0],
    ['Inbox new', inboxSummary?.total_new || workCounts.inbox_new || 0],
    ['Inbox triaged', inboxSummary?.total_triaged || workCounts.inbox_triaged || 0],
  ];
  const body = rows
    .map(
      ([label, value]) =>
        `<tr><td style="${FONT}padding:6px 20px;font-size:14px;color:#222;` +
        `border-bottom:1px solid #eee;">${escapeHtml(label)}</td>` +
        `<td style="${FONT}padding:6px 20px;font-size:14px;color:#222;` +
        `text-align:right;border-bottom:1px solid #eee;font-weight:600;">` +
        `${escapeHtml(value)}</td></tr>`,
    )
    .join('');
  return (
    renderSectionHeader('Queue Summary') +
    `<tr><td style="padding:0 20px;" colspan="1"><table role="presentation" ` +
    `cellpadding="0" cellspacing="0" border="0" width="100%">${body}</table></td></tr>`
  );
}

function renderHtml({ subject, priorities, syncHealth, workCounts, inboxSummary, generatedAt }) {
  const header =
    `<tr><td style="${FONT}background:${HEADER};color:#ffffff;` +
    `padding:20px;text-align:left;">` +
    `<h1 style="margin:0;font-size:20px;">${escapeHtml(subject)}</h1>` +
    `<div style="font-size:12px;opacity:0.85;margin-top:4px;">` +
    `Generated ${escapeHtml(new Date(generatedAt).toUTCString())}</div>` +
    `</td></tr>`;
  const footer =
    `<tr><td style="${FONT}padding:16px 20px;color:#888;font-size:11px;` +
    `border-top:1px solid #eee;">` +
    `Life Command Center &middot; automated briefing digest</td></tr>`;
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
    `width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;">` +
    header +
    renderStrategicSection(priorities) +
    renderUrgentSection(priorities) +
    renderPipelineSection(priorities, syncHealth) +
    renderQueueSection(workCounts, inboxSummary) +
    footer +
    `</table>`
  );
}

// ---------------------------------------------------------------------------
// Plain-text fallback
// ---------------------------------------------------------------------------

function textItem(item) {
  const title = deriveItemTitle(item) || '(untitled)';
  const bits = [];
  if (item.domain) bits.push(item.domain);
  if (item.priority) bits.push(item.priority);
  const due = fmtDueDate(item.due_date);
  if (due) bits.push(`due ${due}`);
  return bits.length ? `  - ${title} [${bits.join(' | ')}]` : `  - ${title}`;
}

function renderText({ subject, priorities, syncHealth, workCounts, inboxSummary, generatedAt }) {
  const lines = [];
  lines.push(subject);
  lines.push(`Generated ${new Date(generatedAt).toUTCString()}`);
  lines.push('');

  const today = priorities?.today_priorities || priorities?.today_top_5 || [];
  const strategic = today.filter((i) => (i.tier || i._tier) === 'strategic');
  const stratList = (strategic.length ? strategic : today.slice(0, 5)).slice(0, 5);
  lines.push('STRATEGIC PRIORITIES');
  if (stratList.length) stratList.forEach((i) => lines.push(textItem(i)));
  else lines.push('  (none)');
  lines.push('');

  const urgent = [
    ...(priorities?.my_overdue || []),
    ...(priorities?.my_due_this_week || []),
  ].slice(0, 5);
  lines.push('URGENT ITEMS');
  if (urgent.length) urgent.forEach((i) => lines.push(textItem(i)));
  else lines.push('  (none)');
  lines.push('');

  const deals = priorities?.pipeline_deals || [];
  lines.push('PIPELINE HEALTH');
  if (deals.length) deals.slice(0, 5).forEach((d) => lines.push(textItem(d)));
  else lines.push('  (no active deals)');
  const s = syncHealth?.summary || {};
  lines.push(
    `  connectors: ${s.healthy || 0} healthy, ${s.degraded || 0} degraded, ${s.error || 0} error`,
  );
  lines.push('');

  lines.push('QUEUE SUMMARY');
  lines.push(`  Open actions: ${workCounts.open || 0}`);
  lines.push(`  Overdue: ${workCounts.overdue || 0}`);
  lines.push(`  Due today: ${workCounts.due_today || 0}`);
  lines.push(`  Inbox new: ${inboxSummary?.total_new || workCounts.inbox_new || 0}`);
  lines.push(`  Inbox triaged: ${inboxSummary?.total_triaged || workCounts.inbox_triaged || 0}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function briefingEmailHandler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LCC-Key, X-LCC-Workspace, X-LCC-User-Id');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed. Use GET.' });
    return;
  }

  // Strict API key auth — reject missing or wrong key
  const providedKey = req.headers['x-lcc-key'] || '';
  if (!verifyApiKey(providedKey)) {
    res.status(401).json({ error: 'Unauthorized: missing or invalid X-LCC-Key header' });
    return;
  }

  if (!process.env.OPS_SUPABASE_URL || !process.env.OPS_SUPABASE_KEY) {
    res.status(503).json({ error: 'OPS database not configured' });
    return;
  }

  const workspaceId =
    req.headers['x-lcc-workspace'] || process.env.LCC_DEFAULT_WORKSPACE_ID || '';
  if (!workspaceId) {
    res.status(400).json({
      error: 'Could not resolve workspace. Set X-LCC-Workspace header or LCC_DEFAULT_WORKSPACE_ID.',
    });
    return;
  }
  const userId =
    req.headers['x-lcc-user-id'] || process.env.LCC_SYSTEM_USER_ID || '';

  const roleView = 'broker';
  const generatedAt = new Date().toISOString();

  const safe = (fn, fallback) =>
    fn().catch((err) => {
      console.error(`[BriefingEmail] ${fn.name || 'fetch'} failed:`, err?.message || err);
      return fallback;
    });

  const defaultWorkCounts = {
    open: 0, overdue: 0, due_today: 0, my_actions: 0, my_overdue: 0,
    my_inbox: 0, my_research: 0, my_completed_week: 0, open_actions: 0,
    inbox_new: 0, inbox_triaged: 0, research_active: 0, sync_errors: 0,
    due_this_week: 0, completed_week: 0, open_escalations: 0, refreshed_at: null,
  };
  const defaultInbox = { total_new: 0, total_triaged: 0, items: [] };
  const defaultSyncHealth = {
    summary: {
      total_connectors: 0, healthy: 0, degraded: 0, error: 0,
      disconnected: 0, pending: 0, outbound_success_rate_24h: null,
    },
    unresolved_errors: [],
    queue_drift: null,
  };

  const [
    workCounts,
    myWork,
    inboxSummary,
    unassignedWork,
    syncHealth,
    sfActivity,
    hotContacts,
    diaPipeline,
  ] = await Promise.all([
    safe(() => fetchWorkCounts(workspaceId, userId), defaultWorkCounts),
    safe(() => fetchMyWork(workspaceId, userId, 15), []),
    safe(() => fetchInboxSummary(workspaceId, 10), defaultInbox),
    safe(() => fetchUnassignedWork(workspaceId, 10), []),
    safe(() => fetchSyncHealthSnapshot(workspaceId), defaultSyncHealth),
    safe(() => fetchRecentSfActivity(workspaceId, 30), []),
    safe(() => fetchHotContacts(15), []),
    safe(fetchDiaPipeline, { deals: [], leads: [] }),
  ]);

  let priorities;
  try {
    priorities = await buildStrategicPriorities(
      roleView,
      myWork,
      inboxSummary.items,
      sfActivity,
      hotContacts,
      diaPipeline,
      unassignedWork,
      syncHealth,
      workCounts,
    );
  } catch (err) {
    console.error('[BriefingEmail] buildStrategicPriorities failed:', err?.message || err);
    priorities = {
      today_priorities: [],
      my_overdue: [],
      my_due_this_week: [],
      pipeline_deals: [],
    };
  }

  const subject = formatSubject(new Date(generatedAt));
  const html = renderHtml({
    subject, priorities, syncHealth, workCounts, inboxSummary, generatedAt,
  });
  const text = renderText({
    subject, priorities, syncHealth, workCounts, inboxSummary, generatedAt,
  });

  res.status(200).json({
    subject,
    html,
    text,
    generated_at: generatedAt,
    role_view: roleView,
  });
}
