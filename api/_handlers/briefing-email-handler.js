// ============================================================================
// Briefing Email Handler v2 — Executive Briefing for the Net Lease Team
// Life Command Center
//
// Exposed via:
//   GET  /api/briefing-email   → render with no personal context
//   POST /api/briefing-email   → render WITH personal context (calendar,
//                                to-do, weather) piped in by Power Automate
//
// Renders a 10-section executive briefing matching the Northmarq brand
// palette (#003DA5 navy, #62B5E5 sky, Calibri Light/Calibri font stack).
//
// Section order (top → bottom):
//   1. Header band with date + Key Numbers strip
//   2. Today's Game Plan         (calendar + top tasks + recommended calls)
//   3. Analyst's Take            (AI-generated narrative, from snapshot)
//   4. Capital Markets & Rates   (yields, Fed, REITs, from snapshot)
//   5. Deal Intelligence         (pipeline value, lease expirations, comps)
//   6. Strategic Priorities      (scored from OPS DB — existing engine)
//   7. New on Market             (24h intake + 7d listings dia + gov)
//   8. Sector Watch              (healthcare / govt / tax / DOGE news)
//   9. What We're Reading        (curated long-form, from snapshot)
//  10. Ops & Queue + footer      (connector health, queue counts)
//
// Brand tokens are inlined (mirrored from public/reports/cm_brand_tokens.json)
// because Vercel serverless can't read /public at request time.
//
// Auth: STRICT X-LCC-Key enforcement via verifyApiKey (property-handler.js).
// Workspace: x-lcc-workspace header → LCC_DEFAULT_WORKSPACE_ID env.
// User:      x-lcc-user-id header   → LCC_SYSTEM_USER_ID env.
//
// Returns:
//   {
//     subject, html, text,
//     generated_at, role_view,
//     intel_freshness: { has_snapshot, as_of_date, generated_at } | null,
//     personal_context_present: boolean
//   }
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
  fetchNewIntakes,
  buildStrategicPriorities,
  deriveItemTitle,
  fetchIntelSnapshot,
  fetchRecentSalesComps,
  fetchUpcomingLeaseExpirations,
  fetchNewActiveListings,
  fetchPipelineRollup,
  fetchMarketStats,
  fetchResearchProgress,
  normalizePersonalContext,
} from '../_shared/briefing-data.js';

// ---------------------------------------------------------------------------
// Brand tokens (mirror of public/reports/cm_brand_tokens.json)
// ---------------------------------------------------------------------------

const BRAND = {
  navy:      '#003DA5',  // primary
  sky:       '#62B5E5',  // accent
  blueMid:   '#265AB2',  // secondary emphasis
  pale:      '#E0E8F4',  // card background
  axis:      '#6A748C',  // secondary text
  text:      '#191919',
  textMuted: '#666666',
  bg:        '#FFFFFF',
  bgAlt:     '#E7E6E6',
  good:      '#1A7F37',  // positive deltas
  bad:       '#B42318',  // negative deltas
};

const FONT = (
  "font-family:'Calibri Light','Calibri','Segoe UI'," +
  "system-ui,-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;"
);

const DAYS   = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Build a Date adjusted to America/Chicago for "as-of" formatting. */
function ctNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
}

function formatSubject(date, variant) {
  const day = DAYS[date.getDay()];
  const month = MONTHS[date.getMonth()];
  const tag = variant === 'friday_deep_dive' ? 'LCC Weekly Deep Dive' : 'LCC Morning Briefing';
  return `${tag} — ${day}, ${month} ${date.getDate()}, ${date.getFullYear()}`;
}

function fmtMonthDay(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago',
  }).replace(' ', '').toLowerCase();
}

function fmtMoney(n, { compact = false } = {}) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return null;
  if (compact && v >= 1_000_000) {
    return '$' + (v / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'M';
  }
  if (compact && v >= 1_000) {
    return '$' + Math.round(v / 1_000) + 'K';
  }
  return '$' + Math.round(v).toLocaleString('en-US');
}

function fmtPct(n, decimals = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  // Cap rates often stored as decimal (0.075) — normalize anything < 1 as fraction.
  const pct = Math.abs(v) < 1 ? v * 100 : v;
  return pct.toFixed(decimals) + '%';
}

/** Limit a string to N chars with ellipsis. Whitespace-tolerant. */
function truncate(s, n) {
  if (!s) return '';
  const t = String(s).trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…';
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

/** Section header — uppercase NM-navy with bottom rule. */
function sectionHeader(title, subtitle) {
  const sub = subtitle
    ? `<div style="${FONT}color:${BRAND.textMuted};font-size:11px;` +
      `font-weight:400;margin-top:2px;letter-spacing:0.3px;">${escapeHtml(subtitle)}</div>`
    : '';
  return (
    `<tr><td style="${FONT}padding:22px 24px 8px 24px;` +
    `border-bottom:2px solid ${BRAND.navy};">` +
    `<h2 style="margin:0;color:${BRAND.navy};font-size:13px;` +
    `font-weight:600;text-transform:uppercase;letter-spacing:1.2px;">` +
    `${escapeHtml(title)}</h2>${sub}</td></tr>`
  );
}

/** Empty / placeholder row when a section has no items. */
function emptyRow(message) {
  return (
    `<tr><td style="${FONT}padding:12px 24px;color:${BRAND.textMuted};` +
    `font-size:13px;font-style:italic;">${escapeHtml(message)}</td></tr>`
  );
}

/** Generic body cell wrapper. */
function bodyCell(innerHtml) {
  return `<tr><td style="padding:0 24px;">${innerHtml}</td></tr>`;
}

// ---------------------------------------------------------------------------
// 1. Header band — date, weather strip, Key Numbers grid
// ---------------------------------------------------------------------------

function renderHeader({ subject, weather, intelSnapshot }) {
  // Format directly from new Date() — ctNow() does a CT-as-UTC double-conversion
  // that's fine for getDay()/getDate() reads but produces a 5-6h offset when
  // we go back through toLocaleString. (Pre-fix the email header read 2:30 AM
  // CDT for an email sent at 7:30 AM CDT.)
  const generatedCt = new Date().toLocaleString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    timeZone: 'America/Chicago',
  });

  let weatherBar = '';
  if (weather && (weather.high_f != null || weather.condition)) {
    const bits = [];
    if (weather.location)  bits.push(escapeHtml(weather.location));
    if (weather.condition) bits.push(escapeHtml(weather.condition));
    if (weather.high_f != null && weather.low_f != null) {
      bits.push(`${weather.high_f}° / ${weather.low_f}°`);
    } else if (weather.high_f != null) {
      bits.push(`${weather.high_f}°`);
    }
    weatherBar = (
      `<div style="${FONT}font-size:12px;color:#ffffff;opacity:0.9;margin-top:6px;">` +
      bits.join(' &middot; ') + `</div>`
    );
  }

  const kn = Array.isArray(intelSnapshot?.key_numbers) ? intelSnapshot.key_numbers : [];
  const knCells = (kn.length ? kn.slice(0, 6) : []).map((k) => {
    const deltaColor = k.delta_dir === 'down' ? BRAND.bad
                     : k.delta_dir === 'up'   ? BRAND.good
                     : BRAND.textMuted;
    const delta = k.delta
      ? `<div style="${FONT}font-size:11px;color:${deltaColor};margin-top:2px;">` +
        `${escapeHtml(k.delta)}</div>`
      : '';
    return (
      `<td style="${FONT}padding:10px 8px;background:rgba(255,255,255,0.08);` +
      `border-radius:4px;color:#ffffff;text-align:center;width:16.66%;">` +
      `<div style="font-size:10px;opacity:0.75;text-transform:uppercase;letter-spacing:0.6px;">` +
      `${escapeHtml(k.label || '')}</div>` +
      `<div style="font-size:16px;font-weight:600;margin-top:3px;">` +
      `${escapeHtml(k.value || '—')}</div>` +
      `${delta}</td>`
    );
  }).join('');

  const knRow = knCells
    ? `<table role="presentation" cellpadding="0" cellspacing="6" border="0" ` +
      `width="100%" style="margin-top:14px;"><tr>${knCells}</tr></table>`
    : '';

  let freshness = '';
  if (!intelSnapshot) {
    freshness =
      `<div style="${FONT}font-size:11px;color:#ffffff;opacity:0.7;margin-top:8px;` +
      `font-style:italic;">Market data unavailable — intel snapshot has not refreshed yet today.</div>`;
  } else if (intelSnapshot._is_today === false && intelSnapshot.as_of_date) {
    const tag = fmtMonthDay(intelSnapshot.as_of_date);
    freshness =
      `<div style="${FONT}font-size:11px;color:#ffffff;opacity:0.8;margin-top:8px;` +
      `font-style:italic;">Market data as of ${escapeHtml(tag)} — today's refresh hasn't landed yet.</div>`;
  }

  return (
    `<tr><td style="${FONT}background:linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.blueMid} 100%);` +
    `color:#ffffff;padding:22px 24px 18px 24px;">` +
    `<div style="font-size:10px;opacity:0.7;text-transform:uppercase;letter-spacing:1.5px;">` +
    `Northmarq Net Lease · Life Command Center</div>` +
    `<h1 style="margin:6px 0 0 0;font-size:22px;font-weight:600;letter-spacing:-0.2px;">` +
    `${escapeHtml(subject)}</h1>` +
    `<div style="font-size:12px;opacity:0.85;margin-top:6px;">${escapeHtml(generatedCt)}</div>` +
    weatherBar +
    knRow +
    freshness +
    `</td></tr>`
  );
}

// ---------------------------------------------------------------------------
// 2. Today's Game Plan — calendar + top tasks + recommended calls
// ---------------------------------------------------------------------------

function renderGamePlan({ personalContext, priorities }) {
  const events = personalContext?.events || [];
  const tasks  = personalContext?.tasks  || [];
  const calls  = Array.isArray(priorities?.recommended_calls)
    ? priorities.recommended_calls.slice(0, 3) : [];

  const has = events.length || tasks.length || calls.length;
  const header = sectionHeader(
    "Today's Game Plan",
    has ? 'Your schedule, top priorities, and outreach for the day' : null,
  );

  if (!has) {
    return header + emptyRow(
      'No calendar, tasks, or recommended calls surfaced. ' +
      'Send Outlook + To Do data via Power Automate to populate this section.',
    );
  }

  const col = (heading, rows, emptyMsg) => {
    const body = rows.length
      ? rows.map((r) => (
          `<tr><td style="${FONT}padding:4px 0;font-size:13px;color:${BRAND.text};">` +
          `${r}</td></tr>`
        )).join('')
      : `<tr><td style="${FONT}padding:4px 0;font-size:12px;` +
        `color:${BRAND.textMuted};font-style:italic;">${escapeHtml(emptyMsg)}</td></tr>`;
    return (
      `<td valign="top" style="width:33.33%;padding:0 8px;">` +
      `<div style="${FONT}font-size:11px;font-weight:600;color:${BRAND.navy};` +
      `text-transform:uppercase;letter-spacing:0.6px;padding-bottom:6px;` +
      `border-bottom:1px solid ${BRAND.bgAlt};margin-bottom:6px;">${escapeHtml(heading)}</div>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">` +
      body + `</table></td>`
    );
  };

  const eventRows = events.slice(0, 5).map((e) => {
    const time = e.is_all_day
      ? `<span style="color:${BRAND.axis};">all-day</span>`
      : `<strong>${escapeHtml(fmtTime(e.start))}</strong>`;
    const loc = e.location ? `<div style="color:${BRAND.textMuted};font-size:11px;">` +
                              `${escapeHtml(truncate(e.location, 40))}</div>` : '';
    return `${time} &nbsp; ${escapeHtml(truncate(e.subject, 50))}${loc}`;
  });

  const taskRows = tasks.slice(0, 5).map((t) => {
    const flag = t.importance === 'high'
      ? `<span style="color:${BRAND.bad};font-weight:600;">!</span> `
      : '';
    const due = t.due
      ? `<span style="color:${BRAND.textMuted};font-size:11px;"> &middot; ${escapeHtml(fmtMonthDay(t.due))}</span>`
      : '';
    return `${flag}${escapeHtml(truncate(t.title, 60))}${due}`;
  });

  const callRows = calls.map((c) => {
    const ds = c.days_since_touch
      ? `<span style="color:${BRAND.textMuted};font-size:11px;"> &middot; ${c.days_since_touch}d cold</span>`
      : '';
    const company = c.company
      ? `<div style="color:${BRAND.textMuted};font-size:11px;">${escapeHtml(truncate(c.company, 40))}</div>`
      : '';
    return `<strong>${escapeHtml(c.name || '—')}</strong>${ds}${company}`;
  });

  const table =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>` +
    col('Calendar', eventRows, 'Nothing scheduled.') +
    col('Top Tasks', taskRows, 'No tasks due.') +
    col('Calls to Make', callRows, 'No outreach surfaced.') +
    `</tr></table>`;

  return header + bodyCell(`<div style="padding:14px 0;">${table}</div>`);
}

// ---------------------------------------------------------------------------
// 3. Analyst's Take — AI-generated narrative
// ---------------------------------------------------------------------------

function renderAnalystTake({ intelSnapshot }) {
  const text = intelSnapshot?.analyst_take?.trim();
  if (!text) return '';

  // Snapshot column is plain text by contract; strip any stray HTML as a
  // safety guard against a careless edge-function change leaking markup.
  const paragraphs = text
    .replace(/<[^>]+>/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((p) => (
      `<p style="${FONT}margin:0 0 10px 0;font-size:14px;line-height:1.55;` +
      `color:${BRAND.text};">${escapeHtml(p)}</p>`
    )).join('');

  const block =
    `<div style="border-left:3px solid ${BRAND.sky};padding:14px 0 14px 16px;` +
    `margin:14px 0;">${paragraphs}</div>`;

  return sectionHeader("Analyst's Take", 'AI-generated read on the day') + bodyCell(block);
}

// ---------------------------------------------------------------------------
// 4. Capital Markets & Rates
// ---------------------------------------------------------------------------

function renderCapitalMarkets({ intelSnapshot }) {
  if (!intelSnapshot) return '';

  const md = intelSnapshot.market_data || {};
  const fo = intelSnapshot.fed_outlook || {};

  const buildRows = (items) => items.slice(0, 4).map((y) => {
    const dColor = (y.delta_dir === 'down') ? BRAND.bad
                 : (y.delta_dir === 'up')   ? BRAND.good
                 : BRAND.textMuted;
    return (
      `<tr><td style="${FONT}padding:6px 12px;font-size:13px;color:${BRAND.text};` +
      `border-bottom:1px solid ${BRAND.bgAlt};">${escapeHtml(y.label || '')}</td>` +
      `<td style="${FONT}padding:6px 12px;font-size:13px;color:${BRAND.text};` +
      `text-align:right;border-bottom:1px solid ${BRAND.bgAlt};font-weight:600;">` +
      `${escapeHtml(y.value || '')}</td>` +
      `<td style="${FONT}padding:6px 12px;font-size:12px;color:${dColor};` +
      `text-align:right;border-bottom:1px solid ${BRAND.bgAlt};">` +
      `${escapeHtml(y.delta || '')}</td></tr>`
    );
  }).join('');

  const yieldRows = buildRows(md.yields || []);
  const reitRows  = buildRows(md.reits  || []);

  const cmText = intelSnapshot.capital_markets?.trim();
  const cmBlock = cmText
    ? `<p style="${FONT}margin:14px 0 4px 0;font-size:13px;line-height:1.55;` +
      `color:${BRAND.text};">${escapeHtml(truncate(cmText, 800))}</p>`
    : '';

  const fedBits = [];
  if (fo.fed?.effr_baseline) {
    fedBits.push(`EFFR baseline ${escapeHtml(fo.fed.effr_baseline)}`);
  }
  const meetings = Array.isArray(fo.fed?.meetings) ? fo.fed.meetings.slice(0, 3) : [];
  if (meetings.length) {
    fedBits.push(meetings.map((m) =>
      `${escapeHtml(m.label || '')}: ${escapeHtml(m.implied || '')}`,
    ).join(' &middot; '));
  }
  const fedRow = fedBits.length
    ? `<div style="${FONT}font-size:12px;color:${BRAND.textMuted};margin-top:10px;">` +
      `Fed: ${fedBits.join(' &nbsp;|&nbsp; ')}</div>`
    : '';

  if (!yieldRows && !reitRows && !cmText && !fedRow) return '';

  const tablePair = (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>` +
    `<td valign="top" style="width:50%;padding-right:6px;">` +
    `<div style="${FONT}font-size:11px;color:${BRAND.navy};font-weight:600;` +
    `text-transform:uppercase;letter-spacing:0.6px;padding-bottom:4px;">Rates &amp; Yields</div>` +
    (yieldRows
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${yieldRows}</table>`
      : `<div style="${FONT}font-size:12px;color:${BRAND.textMuted};font-style:italic;padding:6px 0;">No yield data.</div>`) +
    `</td>` +
    `<td valign="top" style="width:50%;padding-left:6px;">` +
    `<div style="${FONT}font-size:11px;color:${BRAND.navy};font-weight:600;` +
    `text-transform:uppercase;letter-spacing:0.6px;padding-bottom:4px;">Net Lease REITs</div>` +
    (reitRows
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${reitRows}</table>`
      : `<div style="${FONT}font-size:12px;color:${BRAND.textMuted};font-style:italic;padding:6px 0;">No REIT data.</div>`) +
    `</td></tr></table>`
  );

  return (
    sectionHeader('Capital Markets & Rates', 'Where money is priced today') +
    bodyCell(`<div style="padding:14px 0;">${tablePair}${cmBlock}${fedRow}</div>`)
  );
}

// ---------------------------------------------------------------------------
// 4b. Market Stats — TTM tiles per vertical (dia + gov)
// ---------------------------------------------------------------------------

/** Compact money formatter for tile values — $4.2M, $850K, $1.2B. */
function fmtMoneyCompact(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '—';
  if (v >= 1_000_000_000) return '$' + (v / 1_000_000_000).toFixed(1) + 'B';
  if (v >= 1_000_000)     return '$' + (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1) + 'M';
  if (v >= 1_000)         return '$' + Math.round(v / 1_000) + 'K';
  return '$' + Math.round(v);
}

function fmtCapDecimal(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  // RPC returns cap_rate as a fraction (0.072). Multiply for display.
  const pct = Math.abs(v) < 1 ? v * 100 : v;
  return pct.toFixed(2) + '%';
}

function fmtInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}

/**
 * One tile group for a single vertical. Renders 5 metric tiles in a row:
 *   TTM Volume · Avg Cap · Q1-Q3 Cap · TTM Tx Count · On Market.
 */
function marketTileGroup(label, accent, stats) {
  if (!stats) {
    return (
      `<div style="${FONT}margin-top:14px;">` +
      `<div style="font-size:11px;color:${BRAND.navy};font-weight:600;` +
      `text-transform:uppercase;letter-spacing:0.8px;padding-bottom:6px;">` +
      `${escapeHtml(label)} <span style="color:${accent};">●</span></div>` +
      `<div style="${FONT}font-size:12px;color:${BRAND.textMuted};font-style:italic;` +
      `padding:6px 0;">Market stats unavailable.</div>` +
      `</div>`
    );
  }
  const q1 = fmtCapDecimal(stats.q1_cap);
  const q3 = fmtCapDecimal(stats.q3_cap);
  const tiles = [
    { label: 'TTM Volume',  value: fmtMoneyCompact(stats.ttm_volume),    sub: '12-month closed' },
    { label: 'Avg Cap',     value: fmtCapDecimal(stats.avg_cap),         sub: `median ${fmtCapDecimal(stats.median_cap)}` },
    { label: 'Cap Q1–Q3',   value: `${q1} – ${q3}`,                       sub: 'inter-quartile' },
    { label: 'TTM Tx',      value: fmtInt(stats.ttm_count),               sub: 'comp count' },
    { label: 'On Market',   value: fmtInt(stats.on_market_count),         sub: fmtMoneyCompact(stats.on_market_volume) + ' asking' },
  ];

  const cells = tiles.map((t) => (
    `<td style="${FONT}padding:10px 8px;text-align:center;width:20%;` +
    `vertical-align:top;border-right:1px solid ${BRAND.bgAlt};` +
    `background:#ffffff;">` +
    `<div style="font-size:10px;color:${BRAND.axis};text-transform:uppercase;` +
    `letter-spacing:0.6px;">${escapeHtml(t.label)}</div>` +
    `<div style="font-size:18px;font-weight:600;color:${BRAND.text};margin-top:3px;line-height:1.1;">` +
    `${escapeHtml(t.value)}</div>` +
    `<div style="font-size:10px;color:${BRAND.textMuted};margin-top:2px;">` +
    `${escapeHtml(t.sub)}</div>` +
    `</td>`
  )).join('');

  return (
    `<div style="${FONT}margin-top:14px;">` +
    `<div style="font-size:11px;color:${BRAND.navy};font-weight:600;` +
    `text-transform:uppercase;letter-spacing:0.8px;padding-bottom:6px;">` +
    `<span style="color:${accent};">●</span> ${escapeHtml(label)}</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="border:1px solid ${BRAND.bgAlt};border-radius:4px;background:#fafbfc;">` +
    `<tr>${cells}</tr></table></div>`
  );
}

function renderMarketStats({ marketStats }) {
  const dia = marketStats?.dialysis;
  const gov = marketStats?.government;
  if (!dia && !gov) return '';

  return sectionHeader('Vertical Market Stats', 'Trailing-12-month deal flow by vertical') +
    bodyCell(
      marketTileGroup('Dialysis',     BRAND.sky,    dia) +
      marketTileGroup('Government',   BRAND.blueMid, gov) +
      `<div style="${FONT}font-size:10px;color:${BRAND.textMuted};margin:8px 0 14px 0;font-style:italic;">` +
      `Excludes NM-listed deals and flagged outliers. Cap-rate distribution filtered to 2-20% range.</div>`,
    );
}

// ---------------------------------------------------------------------------
// 4c. Research Progress — weekly counts + coverage tiles
// ---------------------------------------------------------------------------

function fmtPctRate(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v * 100).toFixed(0) + '%';
}

function researchTile(label, value, sub, accent) {
  return (
    `<td style="${FONT}padding:10px 8px;text-align:center;width:25%;` +
    `vertical-align:top;border-right:1px solid ${BRAND.bgAlt};` +
    `background:#ffffff;">` +
    `<div style="font-size:10px;color:${BRAND.axis};text-transform:uppercase;` +
    `letter-spacing:0.6px;">${escapeHtml(label)}</div>` +
    `<div style="font-size:20px;font-weight:600;color:${accent || BRAND.text};` +
    `margin-top:3px;line-height:1.1;">${escapeHtml(value)}</div>` +
    `<div style="font-size:10px;color:${BRAND.textMuted};margin-top:2px;">` +
    `${escapeHtml(sub || '')}</div>` +
    `</td>`
  );
}

function renderResearchProgress({ researchProgress }) {
  const ws  = researchProgress?.workspace;
  const dia = researchProgress?.dialysis;
  const gov = researchProgress?.government;
  if (!ws && !dia && !gov) return '';

  // Row 1: workspace-wide weekly counts
  let row1 = '';
  if (ws) {
    row1 =
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
      `style="border:1px solid ${BRAND.bgAlt};border-radius:4px;margin-top:14px;background:#fafbfc;"><tr>` +
      researchTile('Touchpoints',     fmtInt(ws.touchpoints_this_week),     'calls/emails/meetings 7d', BRAND.navy) +
      researchTile('Prospects Added', fmtInt(ws.prospects_added_this_week), 'new entities 7d',          BRAND.navy) +
      researchTile('Opps Opened',     fmtInt(ws.opportunities_opened_this_week), 'BD opportunities 7d',  BRAND.navy) +
      researchTile('% Prospected',    fmtPctRate(ws.pct_accounts_prospected),
        `${fmtInt(ws.entities_with_recent_activity)} of ${fmtInt(ws.total_entities)} engaged`, BRAND.navy) +
      `</tr></table>`;
  }

  // Row 2: per-vertical comps + listings + research coverage
  const verticalRow = (label, accent, row) => {
    if (!row) {
      return (
        `<div style="${FONT}font-size:11px;color:${BRAND.navy};font-weight:600;` +
        `text-transform:uppercase;letter-spacing:0.8px;padding-bottom:6px;margin-top:14px;">` +
        `<span style="color:${accent};">●</span> ${escapeHtml(label)}</div>` +
        `<div style="${FONT}font-size:12px;color:${BRAND.textMuted};font-style:italic;">` +
        `Coverage data unavailable.</div>`
      );
    }
    return (
      `<div style="${FONT}font-size:11px;color:${BRAND.navy};font-weight:600;` +
      `text-transform:uppercase;letter-spacing:0.8px;padding-bottom:6px;margin-top:14px;">` +
      `<span style="color:${accent};">●</span> ${escapeHtml(label)}</div>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
      `style="border:1px solid ${BRAND.bgAlt};border-radius:4px;background:#fafbfc;"><tr>` +
      researchTile('Comps Added',      fmtInt(row.comps_added),     'sales 7d') +
      researchTile('Listings Added',   fmtInt(row.listings_added),  'listings 7d') +
      researchTile('% Owner Researched', fmtPctRate(row.pct_owner),
        `${fmtInt(row.props_with_owner)} of ${fmtInt(row.props_total)} props`) +
      researchTile('% Developer Tagged', fmtPctRate(row.pct_developer),
        `${fmtInt(row.props_with_developer)} of ${fmtInt(row.props_total)} props`) +
      `</tr></table>`
    );
  };

  return sectionHeader('Research Progress', 'Coverage and outreach over the last 7 days') +
    bodyCell(
      row1 +
      verticalRow('Dialysis',   BRAND.sky,     dia) +
      verticalRow('Government', BRAND.blueMid, gov) +
      `<div style="${FONT}font-size:10px;color:${BRAND.textMuted};margin:8px 0 14px 0;font-style:italic;">` +
      `Touchpoints = call/email/meeting/note events. Engaged accounts = entities with activity in the last 180 days.</div>`,
    );
}

// ---------------------------------------------------------------------------
// 5. Deal Intelligence — callout card with pipeline + comps + expirations
// ---------------------------------------------------------------------------

function renderDealIntelligence({ pipelineRollup, salesComps, expirations }) {
  const open = pipelineRollup?.open_count || 0;
  const stageCounts = (pipelineRollup?.by_stage || [])
    .slice(0, 3)
    .map((s) => `${escapeHtml(s.stage)} (${s.count})`)
    .join(' &middot; ');

  const compsAll = [
    ...(salesComps?.dialysis || []).map((s) => ({ ...s, _domain: 'DIA' })),
    ...(salesComps?.government || []).map((s) => ({ ...s, _domain: 'GOV' })),
  ].sort((a, b) => (b.sale_date || '').localeCompare(a.sale_date || ''))
   .slice(0, 5);

  const compRows = compsAll.map((c) => {
    const loc = [c.city, c.state].filter(Boolean).join(', ');
    const tenant = c.tenant_agency || c.tenant || '';
    const price = fmtMoney(c.sale_price, { compact: true });
    const cap = fmtPct(c.cap_rate, 2);
    const date = fmtMonthDay(c.sale_date);
    const bits = [date, price, cap].filter(Boolean).join(' &middot; ');
    return (
      `<tr><td style="${FONT}padding:5px 0;font-size:12px;color:${BRAND.text};` +
      `border-bottom:1px solid ${BRAND.bgAlt};">` +
      `<strong>${escapeHtml(truncate(tenant || '(unknown tenant)', 36))}</strong> ` +
      `<span style="color:${BRAND.axis};font-size:11px;">[${c._domain}]</span>` +
      (loc ? ` <span style="color:${BRAND.textMuted};font-size:11px;">${escapeHtml(loc)}</span>` : '') +
      `<div style="color:${BRAND.textMuted};font-size:11px;">${bits}</div>` +
      `</td></tr>`
    );
  }).join('');

  const expAll = [
    ...(expirations?.dialysis || []).map((e) => ({ ...e, _domain: 'DIA' })),
    ...(expirations?.government || []).map((e) => ({ ...e, _domain: 'GOV' })),
  ].sort((a, b) => (a.lease_expiration || '9999').localeCompare(b.lease_expiration || '9999'))
   .slice(0, 5);

  const expRows = expAll.map((e) => {
    const tenant = e.tenant_agency || e.tenant || '(tenant unknown)';
    const loc = [e.city, e.state].filter(Boolean).join(', ');
    const exp = fmtMonthDay(e.lease_expiration);
    const rent = fmtMoney(e.annual_rent, { compact: true });
    const bits = [exp, rent ? `${rent}/yr` : null].filter(Boolean).join(' &middot; ');
    return (
      `<tr><td style="${FONT}padding:5px 0;font-size:12px;color:${BRAND.text};` +
      `border-bottom:1px solid ${BRAND.bgAlt};">` +
      `<strong>${escapeHtml(truncate(tenant, 36))}</strong> ` +
      `<span style="color:${BRAND.axis};font-size:11px;">[${e._domain}]</span>` +
      (loc ? ` <span style="color:${BRAND.textMuted};font-size:11px;">${escapeHtml(loc)}</span>` : '') +
      `<div style="color:${BRAND.textMuted};font-size:11px;">${bits}</div>` +
      `</td></tr>`
    );
  }).join('');

  const pipelineCell = (
    `<div style="${FONT}padding:0 0 6px 0;">` +
    `<div style="font-size:11px;color:${BRAND.navy};font-weight:600;` +
    `text-transform:uppercase;letter-spacing:0.6px;">Pipeline</div>` +
    `<div style="font-size:28px;font-weight:600;color:${BRAND.text};line-height:1.1;margin-top:2px;">${open}</div>` +
    `<div style="font-size:11px;color:${BRAND.textMuted};">open opportunities</div>` +
    (stageCounts
      ? `<div style="font-size:11px;color:${BRAND.textMuted};margin-top:4px;">${stageCounts}</div>`
      : '') +
    `</div>`
  );

  const compsCell = compRows
    ? `<div style="${FONT}font-size:11px;color:${BRAND.navy};font-weight:600;` +
      `text-transform:uppercase;letter-spacing:0.6px;padding-bottom:4px;">Recent Sales Comps (60d)</div>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${compRows}</table>`
    : '';

  const expCell = expRows
    ? `<div style="${FONT}font-size:11px;color:${BRAND.navy};font-weight:600;` +
      `text-transform:uppercase;letter-spacing:0.6px;padding-bottom:4px;margin-top:14px;">Lease Expirations (next 90d)</div>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${expRows}</table>`
    : '';

  if (!open && !compRows && !expRows) {
    return sectionHeader('Deal Intelligence', null) +
      emptyRow('No active pipeline, sales comps, or lease expirations to report.');
  }

  const card =
    `<div style="background:${BRAND.pale};border:1px solid ${BRAND.sky};` +
    `border-left:4px solid ${BRAND.navy};border-radius:4px;padding:14px 16px;margin:14px 0;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>` +
    `<td valign="top" style="width:30%;padding-right:14px;border-right:1px solid ${BRAND.bgAlt};">${pipelineCell}</td>` +
    `<td valign="top" style="padding-left:14px;">${compsCell}${expCell}</td>` +
    `</tr></table></div>`;

  return sectionHeader('Deal Intelligence', 'Your book at a glance') + bodyCell(card);
}

// ---------------------------------------------------------------------------
// 6. Strategic Priorities + Urgent (2-column)
// ---------------------------------------------------------------------------

function priorityRow(item) {
  const title = deriveItemTitle(item) || '(untitled)';
  const due = fmtMonthDay(item.due_date);
  const bits = [];
  if (item.domain)   bits.push(escapeHtml(item.domain));
  if (item.priority) bits.push(escapeHtml(item.priority));
  if (due)           bits.push(`due ${due}`);
  const meta = bits.length
    ? `<div style="color:${BRAND.textMuted};font-size:11px;margin-top:2px;">` +
      bits.join(' &middot; ') + `</div>`
    : '';
  return (
    `<tr><td style="${FONT}padding:8px 0;border-bottom:1px solid ${BRAND.bgAlt};` +
    `font-size:13px;color:${BRAND.text};">` +
    `<div style="font-weight:600;">${escapeHtml(truncate(title, 90))}</div>${meta}` +
    `</td></tr>`
  );
}

function renderStrategicAndUrgent({ priorities }) {
  const today = Array.isArray(priorities?.today_priorities)
    ? priorities.today_priorities
    : Array.isArray(priorities?.today_top_5)
      ? priorities.today_top_5
      : [];
  const strategic = today.filter((i) => (i.tier || i._tier) === 'strategic');
  const pool = strategic.length ? strategic : today.slice(0, 5);

  const overdue = Array.isArray(priorities?.my_overdue) ? priorities.my_overdue : [];
  const dueThisWeek = Array.isArray(priorities?.my_due_this_week) ? priorities.my_due_this_week : [];
  const urgent = [...overdue, ...dueThisWeek].slice(0, 5);

  const stratBody = pool.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">` +
      pool.slice(0, 5).map(priorityRow).join('') + `</table>`
    : `<div style="${FONT}padding:10px 0;color:${BRAND.textMuted};font-size:13px;` +
      `font-style:italic;">No strategic items surfaced for today.</div>`;

  const urgentBody = urgent.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">` +
      urgent.map(priorityRow).join('') + `</table>`
    : `<div style="${FONT}padding:10px 0;color:${BRAND.textMuted};font-size:13px;` +
      `font-style:italic;">No overdue or due-this-week items.</div>`;

  const inner =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>` +
    `<td valign="top" style="width:50%;padding:14px 12px 14px 0;border-right:1px solid ${BRAND.bgAlt};">` +
    `<div style="${FONT}font-size:11px;color:${BRAND.navy};font-weight:600;` +
    `text-transform:uppercase;letter-spacing:0.6px;padding-bottom:4px;">Strategic</div>${stratBody}</td>` +
    `<td valign="top" style="width:50%;padding:14px 0 14px 12px;">` +
    `<div style="${FONT}font-size:11px;color:${BRAND.navy};font-weight:600;` +
    `text-transform:uppercase;letter-spacing:0.6px;padding-bottom:4px;">Urgent &amp; Due</div>${urgentBody}</td>` +
    `</tr></table>`;

  return sectionHeader('Priorities', 'Top items from your scored queue') + bodyCell(inner);
}

// ---------------------------------------------------------------------------
// 7. New on Market — 24h OM intakes + 7d active listings
// ---------------------------------------------------------------------------

function renderNewOnMarket({ newIntakes, newListings }) {
  const intakes = (newIntakes?.items || []).slice(0, 6);
  const listings = [
    ...(newListings?.dialysis || []).map((l) => ({ ...l, _domain: 'DIA' })),
    ...(newListings?.government || []).map((l) => ({ ...l, _domain: 'GOV' })),
  ].sort((a, b) => (b.listing_date || '').localeCompare(a.listing_date || ''))
   .slice(0, 6);

  if (!intakes.length && !listings.length) {
    return sectionHeader('New on Market', null) +
      emptyRow('No OM intakes in the last 24h and no new listings in the last 7 days.');
  }

  const intakeRow = (it) => {
    const loc = [it.city, it.state].filter(Boolean).join(', ');
    const title = it.address || it.tenant_agency || '(untitled)';
    const broker = it.listing_broker ? ' &middot; ' + escapeHtml(it.listing_broker) : '';
    const price = it.asking_price ? ' &middot; ' + escapeHtml(fmtMoney(it.asking_price, { compact: true })) : '';
    return (
      `<tr><td style="${FONT}padding:6px 0;font-size:12px;color:${BRAND.text};` +
      `border-bottom:1px solid ${BRAND.bgAlt};">` +
      `<strong>${escapeHtml(truncate(title, 48))}</strong>` +
      (loc ? ` <span style="color:${BRAND.textMuted};">&middot; ${escapeHtml(loc)}</span>` : '') +
      ` <span style="color:${BRAND.axis};font-size:11px;">[${escapeHtml((it.domain || 'gov').toUpperCase())}]</span>` +
      `<div style="color:${BRAND.textMuted};font-size:11px;">${broker}${price}</div>` +
      `</td></tr>`
    );
  };

  const listingRow = (l) => {
    const loc = [l.city, l.state].filter(Boolean).join(', ');
    const tenant = l.tenant_agency || l.tenant || '(tenant unknown)';
    const date = fmtMonthDay(l.listing_date);
    const price = fmtMoney(l.asking_price, { compact: true });
    const cap = fmtPct(l.cap_rate, 2);
    const bits = [date, price, cap].filter(Boolean).join(' &middot; ');
    return (
      `<tr><td style="${FONT}padding:6px 0;font-size:12px;color:${BRAND.text};` +
      `border-bottom:1px solid ${BRAND.bgAlt};">` +
      `<strong>${escapeHtml(truncate(tenant, 36))}</strong> ` +
      `<span style="color:${BRAND.axis};font-size:11px;">[${l._domain}]</span>` +
      (loc ? ` <span style="color:${BRAND.textMuted};font-size:11px;">${escapeHtml(loc)}</span>` : '') +
      `<div style="color:${BRAND.textMuted};font-size:11px;">${bits}</div>` +
      `</td></tr>`
    );
  };

  const intakeBlock = intakes.length
    ? `<div style="${FONT}font-size:11px;color:${BRAND.navy};font-weight:600;` +
      `text-transform:uppercase;letter-spacing:0.6px;padding-bottom:4px;">OM Intakes (24h)</div>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">` +
      intakes.map(intakeRow).join('') + `</table>`
    : '';

  const listingBlock = listings.length
    ? `<div style="${FONT}font-size:11px;color:${BRAND.navy};font-weight:600;` +
      `text-transform:uppercase;letter-spacing:0.6px;padding-bottom:4px;` +
      (intakes.length ? 'margin-top:14px;' : '') + '">New Listings (7d)</div>' +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">` +
      listings.map(listingRow).join('') + `</table>`
    : '';

  const subtitle = `${intakes.length} new OM${intakes.length === 1 ? '' : 's'} · ${listings.length} new listing${listings.length === 1 ? '' : 's'}`;

  return sectionHeader('New on Market', subtitle) +
    bodyCell(`<div style="padding:14px 0;">${intakeBlock}${listingBlock}</div>`);
}

// ---------------------------------------------------------------------------
// 8. Sector Watch — news grouped by stream
// ---------------------------------------------------------------------------

function renderSectorWatch({ intelSnapshot }) {
  const news = intelSnapshot?.sector_news || {};
  const streams = [
    { key: 'healthcare',  label: 'Healthcare / Dialysis',   limit: 3 },
    { key: 'government',  label: 'DOGE / GSA / Government', limit: 3 },
    { key: 'net_lease',   label: 'Net Lease & CRE',         limit: 3 },
    { key: 'tax_policy',  label: '1031 / Tax Policy',       limit: 2 },
  ];

  const allEmpty = streams.every((s) => !Array.isArray(news[s.key]) || !news[s.key].length);
  if (allEmpty) return '';

  const newsItem = (item) => {
    const link = item.url
      ? `<a href="${escapeHtml(item.url)}" style="color:${BRAND.navy};text-decoration:none;">` +
        `${escapeHtml(truncate(item.title || '(untitled)', 90))}</a>`
      : escapeHtml(truncate(item.title || '(untitled)', 90));
    const meta = [
      item.source ? escapeHtml(item.source) : null,
      item.published_at ? escapeHtml(fmtMonthDay(item.published_at)) : null,
    ].filter(Boolean).join(' &middot; ');
    const summary = item.summary
      ? `<div style="${FONT}color:${BRAND.textMuted};font-size:11px;margin-top:2px;">` +
        `${escapeHtml(truncate(item.summary, 160))}</div>`
      : '';
    return (
      `<tr><td style="${FONT}padding:7px 0;border-bottom:1px solid ${BRAND.bgAlt};` +
      `font-size:13px;color:${BRAND.text};">` +
      `<div style="font-weight:600;line-height:1.3;">${link}</div>` +
      (meta ? `<div style="color:${BRAND.axis};font-size:11px;margin-top:2px;">${meta}</div>` : '') +
      summary +
      `</td></tr>`
    );
  };

  const blocks = streams.map((s) => {
    const items = Array.isArray(news[s.key]) ? news[s.key].slice(0, s.limit) : [];
    if (!items.length) return '';
    return (
      `<div style="margin-top:10px;">` +
      `<div style="${FONT}font-size:11px;color:${BRAND.navy};font-weight:600;` +
      `text-transform:uppercase;letter-spacing:0.6px;padding-bottom:4px;">${escapeHtml(s.label)}</div>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">` +
      items.map(newsItem).join('') + `</table></div>`
    );
  }).join('');

  return sectionHeader('Sector Watch', 'What moved in your verticals overnight') +
    bodyCell(`<div style="padding:6px 0 14px 0;">${blocks}</div>`);
}

// ---------------------------------------------------------------------------
// 9. What We're Reading
// ---------------------------------------------------------------------------

function renderReadingList({ intelSnapshot }) {
  const items = Array.isArray(intelSnapshot?.reading_list) ? intelSnapshot.reading_list.slice(0, 5) : [];
  if (!items.length) return '';

  const rows = items.map((it) => {
    const link = it.url
      ? `<a href="${escapeHtml(it.url)}" style="color:${BRAND.navy};text-decoration:none;">` +
        `${escapeHtml(truncate(it.title || '(untitled)', 100))}</a>`
      : escapeHtml(truncate(it.title || '(untitled)', 100));
    const meta = [
      it.source ? escapeHtml(it.source) : null,
      it.published_at ? fmtMonthDay(it.published_at) : null,
    ].filter(Boolean).join(' &middot; ');
    const why = it.why_it_matters
      ? `<div style="${FONT}color:${BRAND.textMuted};font-size:11px;font-style:italic;margin-top:2px;">` +
        `Why it matters: ${escapeHtml(truncate(it.why_it_matters, 180))}</div>`
      : '';
    return (
      `<tr><td style="${FONT}padding:8px 0;border-bottom:1px solid ${BRAND.bgAlt};` +
      `font-size:13px;color:${BRAND.text};">` +
      `<div style="font-weight:600;line-height:1.3;">${link}</div>` +
      (meta ? `<div style="color:${BRAND.axis};font-size:11px;margin-top:2px;">${meta}</div>` : '') +
      why +
      `</td></tr>`
    );
  }).join('');

  return sectionHeader("What We're Reading", null) +
    bodyCell(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
      `style="margin:14px 0;">${rows}</table>`,
    );
}

// ---------------------------------------------------------------------------
// 9b. Weekly Changes (Friday deep dive only)
// ---------------------------------------------------------------------------

function renderWeeklyChanges({ intelSnapshot }) {
  if (intelSnapshot?.variant !== 'friday_deep_dive') return '';
  const rows = Array.isArray(intelSnapshot.weekly_changes) ? intelSnapshot.weekly_changes : [];
  if (!rows.length) return '';

  const body = rows.slice(0, 12).map((r) => {
    return (
      `<tr><td style="${FONT}padding:6px 12px;font-size:12px;color:${BRAND.text};` +
      `border-bottom:1px solid ${BRAND.bgAlt};">${escapeHtml(r.label || '')}</td>` +
      `<td style="${FONT}padding:6px 12px;font-size:12px;color:${BRAND.text};` +
      `text-align:right;border-bottom:1px solid ${BRAND.bgAlt};font-weight:600;">` +
      `${escapeHtml(r.value || '')}</td>` +
      `<td style="${FONT}padding:6px 12px;font-size:11px;color:${BRAND.axis};` +
      `text-align:right;border-bottom:1px solid ${BRAND.bgAlt};">${escapeHtml(r.change_1d || '')}</td>` +
      `<td style="${FONT}padding:6px 12px;font-size:11px;color:${BRAND.axis};` +
      `text-align:right;border-bottom:1px solid ${BRAND.bgAlt};">${escapeHtml(r.change_5d || '')}</td></tr>`
    );
  }).join('');

  const head =
    `<tr style="background:${BRAND.pale};">` +
    `<th style="${FONT}padding:6px 12px;font-size:10px;color:${BRAND.navy};text-align:left;` +
    `text-transform:uppercase;letter-spacing:0.6px;border-bottom:2px solid ${BRAND.sky};">Metric</th>` +
    `<th style="${FONT}padding:6px 12px;font-size:10px;color:${BRAND.navy};text-align:right;` +
    `text-transform:uppercase;letter-spacing:0.6px;border-bottom:2px solid ${BRAND.sky};">Value</th>` +
    `<th style="${FONT}padding:6px 12px;font-size:10px;color:${BRAND.navy};text-align:right;` +
    `text-transform:uppercase;letter-spacing:0.6px;border-bottom:2px solid ${BRAND.sky};">1d</th>` +
    `<th style="${FONT}padding:6px 12px;font-size:10px;color:${BRAND.navy};text-align:right;` +
    `text-transform:uppercase;letter-spacing:0.6px;border-bottom:2px solid ${BRAND.sky};">5d</th></tr>`;

  return sectionHeader('Week in Numbers', 'Friday deep-dive scorecard') +
    bodyCell(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
      `style="margin:14px 0;border:1px solid ${BRAND.bgAlt};">${head}${body}</table>`,
    );
}

// ---------------------------------------------------------------------------
// 10. Ops & Queue + footer
// ---------------------------------------------------------------------------

function renderOpsAndQueue({ workCounts, inboxSummary, syncHealth, newIntakes }) {
  const s = syncHealth?.summary || {};
  const queueCells = [
    ['Open', workCounts.open || 0],
    ['Overdue', workCounts.overdue || 0],
    ['Due today', workCounts.due_today || 0],
    ['Inbox new', inboxSummary?.total_new || workCounts.inbox_new || 0],
    ['OM intakes 24h', newIntakes?.count || 0],
    ['Connectors', `${s.healthy || 0}/${s.total_connectors || 0}`],
  ];

  const cells = queueCells.map(([label, val]) => (
    `<td style="${FONT}padding:8px 10px;text-align:center;width:16.66%;border-right:1px solid ${BRAND.bgAlt};">` +
    `<div style="font-size:10px;color:${BRAND.axis};text-transform:uppercase;letter-spacing:0.6px;">` +
    `${escapeHtml(label)}</div>` +
    `<div style="font-size:18px;font-weight:600;color:${BRAND.text};margin-top:2px;">` +
    `${escapeHtml(String(val))}</div></td>`
  )).join('');

  const health = `${s.healthy || 0} healthy &middot; ${s.degraded || 0} degraded &middot; ${s.error || 0} error`;
  return sectionHeader('Ops & Queue', `Connectors: ${health}`) +
    bodyCell(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
      `style="margin:14px 0;border:1px solid ${BRAND.bgAlt};background:#fafbfc;">` +
      `<tr>${cells}</tr></table>`,
    );
}

function renderFooter(intelSnapshot) {
  const ver = intelSnapshot?.variant === 'friday_deep_dive' ? 'v2.0 Friday Deep Dive' : 'v2.0';
  const snapBit = intelSnapshot
    ? `Intel snapshot generated ${escapeHtml(new Date(intelSnapshot.generated_at).toUTCString())}`
    : 'Intel snapshot unavailable';
  return (
    `<tr><td style="${FONT}padding:18px 24px;color:${BRAND.textMuted};font-size:11px;` +
    `border-top:1px solid ${BRAND.bgAlt};background:#fafbfc;text-align:center;">` +
    `Northmarq Net Lease · Life Command Center · ${escapeHtml(ver)}` +
    `<div style="color:${BRAND.axis};font-size:10px;margin-top:4px;">${snapBit}</div>` +
    `</td></tr>`
  );
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

function renderHtml(ctx) {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
    `width="100%" style="max-width:680px;margin:0 auto;background:${BRAND.bg};` +
    `border:1px solid ${BRAND.bgAlt};">` +
    renderHeader(ctx) +
    renderGamePlan(ctx) +
    renderAnalystTake(ctx) +
    renderCapitalMarkets(ctx) +
    renderMarketStats(ctx) +
    renderWeeklyChanges(ctx) +
    renderDealIntelligence(ctx) +
    renderStrategicAndUrgent(ctx) +
    renderResearchProgress(ctx) +
    renderNewOnMarket(ctx) +
    renderSectorWatch(ctx) +
    renderReadingList(ctx) +
    renderOpsAndQueue(ctx) +
    renderFooter(ctx.intelSnapshot) +
    `</table>`
  );
}

// ---------------------------------------------------------------------------
// Plain-text fallback
// ---------------------------------------------------------------------------

function renderText(ctx) {
  const lines = [];
  lines.push(ctx.subject);
  lines.push(`Generated ${new Date(ctx.generatedAt).toUTCString()}`);
  lines.push('');

  if (ctx.personalContext?.events?.length) {
    lines.push("TODAY'S SCHEDULE");
    ctx.personalContext.events.slice(0, 6).forEach((e) => {
      const time = e.is_all_day ? 'all-day' : fmtTime(e.start);
      lines.push(`  - ${time}  ${e.subject}${e.location ? '  @ ' + e.location : ''}`);
    });
    lines.push('');
  }

  if (ctx.personalContext?.tasks?.length) {
    lines.push('TOP TASKS');
    ctx.personalContext.tasks.slice(0, 6).forEach((t) => {
      const flag = t.importance === 'high' ? '! ' : '  ';
      lines.push(`${flag}- ${t.title}${t.due ? '  due ' + fmtMonthDay(t.due) : ''}`);
    });
    lines.push('');
  }

  if (ctx.intelSnapshot?.analyst_take) {
    lines.push("ANALYST'S TAKE");
    lines.push(ctx.intelSnapshot.analyst_take.replace(/\n\s*\n/g, '\n').trim());
    lines.push('');
  }

  const md = ctx.intelSnapshot?.market_data || {};
  if ((md.yields || []).length || (md.reits || []).length) {
    lines.push('CAPITAL MARKETS');
    (md.yields || []).slice(0, 4).forEach((y) =>
      lines.push(`  ${y.label}: ${y.value} ${y.delta ? '(' + y.delta + ')' : ''}`));
    (md.reits || []).slice(0, 4).forEach((r) =>
      lines.push(`  ${r.label}: ${r.value} ${r.delta ? '(' + r.delta + ')' : ''}`));
    lines.push('');
  }

  const open = ctx.pipelineRollup?.open_count || 0;
  lines.push('DEAL INTELLIGENCE');
  lines.push(`  Pipeline: ${open} open opportunities`);
  const allComps = [...(ctx.salesComps?.dialysis || []), ...(ctx.salesComps?.government || [])]
    .sort((a, b) => (b.sale_date || '').localeCompare(a.sale_date || '')).slice(0, 5);
  if (allComps.length) {
    lines.push('  Recent sales comps (60d):');
    allComps.forEach((c) => {
      const loc = [c.city, c.state].filter(Boolean).join(', ');
      lines.push(`    - ${c.tenant_agency || c.tenant || 'unknown'}  ${loc}  ` +
        `${fmtMoney(c.sale_price, { compact: true }) || ''}  ${fmtPct(c.cap_rate, 2) || ''}`);
    });
  }
  lines.push('');

  const today = ctx.priorities?.today_priorities || [];
  const strategic = today.filter((i) => (i.tier || i._tier) === 'strategic');
  const stratList = (strategic.length ? strategic : today.slice(0, 5)).slice(0, 5);
  lines.push('STRATEGIC PRIORITIES');
  if (stratList.length) stratList.forEach((i) =>
    lines.push(`  - ${deriveItemTitle(i) || '(untitled)'}`));
  else lines.push('  (none)');
  lines.push('');

  const intakes = ctx.newIntakes?.items || [];
  if (intakes.length) {
    lines.push(`NEW OM INTAKES (last ${ctx.newIntakes.window_hours || 24}h)`);
    intakes.slice(0, 6).forEach((it) => {
      const loc = [it.city, it.state].filter(Boolean).join(', ');
      lines.push(`  - ${it.address || it.tenant_agency || 'untitled'}  ${loc}`);
    });
    lines.push('');
  }

  const news = ctx.intelSnapshot?.sector_news || {};
  const newsStreams = ['healthcare', 'government', 'net_lease', 'tax_policy'];
  const anyNews = newsStreams.some((k) => Array.isArray(news[k]) && news[k].length);
  if (anyNews) {
    lines.push('SECTOR WATCH');
    newsStreams.forEach((k) => {
      const items = Array.isArray(news[k]) ? news[k].slice(0, 3) : [];
      items.forEach((it) => lines.push(`  - [${k}] ${it.title}  (${it.source || ''})`));
    });
    lines.push('');
  }

  const wc = ctx.workCounts || {};
  lines.push('QUEUE SUMMARY');
  lines.push(`  Open: ${wc.open || 0}  Overdue: ${wc.overdue || 0}  Due today: ${wc.due_today || 0}`);
  lines.push(`  Inbox new: ${ctx.inboxSummary?.total_new || 0}  OM intakes 24h: ${ctx.newIntakes?.count || 0}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Body parsing — Vercel sometimes hands us a stringified body
// ---------------------------------------------------------------------------

async function readPostBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c.toString(); });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function briefingEmailHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, X-LCC-Key, X-LCC-Workspace, X-LCC-User-Id');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
    return;
  }

  const providedKey = req.headers['x-lcc-key'] || '';
  if (!verifyApiKey(providedKey)) {
    res.status(401).json({ error: 'Unauthorized: missing or invalid X-LCC-Key header' });
    return;
  }

  if (!process.env.OPS_SUPABASE_URL || !process.env.OPS_SUPABASE_KEY) {
    res.status(503).json({ error: 'OPS database not configured' });
    return;
  }

  const workspaceId = req.headers['x-lcc-workspace'] || process.env.LCC_DEFAULT_WORKSPACE_ID || '';
  if (!workspaceId) {
    res.status(400).json({
      error: 'Could not resolve workspace. Set X-LCC-Workspace header or LCC_DEFAULT_WORKSPACE_ID.',
    });
    return;
  }
  const userId = req.headers['x-lcc-user-id'] || process.env.LCC_SYSTEM_USER_ID || '';

  let personalContext = { events: [], tasks: [], weather: null };
  if (req.method === 'POST') {
    const body = await readPostBody(req);
    personalContext = normalizePersonalContext(body);
  }

  const roleView = 'broker';
  const generatedAt = new Date().toISOString();

  const safe = (fn, fallback, label) =>
    fn().catch((err) => {
      console.error(`[BriefingEmail] ${label || fn.name || 'fetch'} failed:`,
        err?.message || err);
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
    summary: { total_connectors: 0, healthy: 0, degraded: 0, error: 0,
               disconnected: 0, pending: 0, outbound_success_rate_24h: null },
    unresolved_errors: [], queue_drift: null,
  };

  const [
    workCounts, myWork, inboxSummary, unassignedWork, syncHealth,
    sfActivity, hotContacts, diaPipeline, newIntakes,
    intelSnapshot, salesComps, expirations, newListings, pipelineRollup,
    marketStats, researchProgress,
  ] = await Promise.all([
    safe(() => fetchWorkCounts(workspaceId, userId), defaultWorkCounts, 'fetchWorkCounts'),
    safe(() => fetchMyWork(workspaceId, userId, 15), [], 'fetchMyWork'),
    safe(() => fetchInboxSummary(workspaceId, 10), defaultInbox, 'fetchInboxSummary'),
    safe(() => fetchUnassignedWork(workspaceId, 10), [], 'fetchUnassignedWork'),
    safe(() => fetchSyncHealthSnapshot(workspaceId), defaultSyncHealth, 'fetchSyncHealthSnapshot'),
    safe(() => fetchRecentSfActivity(workspaceId, 30), [], 'fetchRecentSfActivity'),
    safe(() => fetchHotContacts(15), [], 'fetchHotContacts'),
    safe(fetchDiaPipeline, { deals: [], leads: [] }, 'fetchDiaPipeline'),
    safe(() => fetchNewIntakes(workspaceId, 24, 10),
      { window_hours: 24, count: 0, items: [] }, 'fetchNewIntakes'),
    safe(() => fetchIntelSnapshot(workspaceId), null, 'fetchIntelSnapshot'),
    safe(() => fetchRecentSalesComps(60, 8),
      { dialysis: [], government: [] }, 'fetchRecentSalesComps'),
    safe(() => fetchUpcomingLeaseExpirations(90, 6),
      { dialysis: [], government: [] }, 'fetchUpcomingLeaseExpirations'),
    safe(() => fetchNewActiveListings(7, 5),
      { dialysis: [], government: [] }, 'fetchNewActiveListings'),
    safe(fetchPipelineRollup,
      { open_count: 0, total_value: 0, weighted_value: 0, by_stage: [] }, 'fetchPipelineRollup'),
    safe(() => fetchMarketStats(365), { dialysis: null, government: null }, 'fetchMarketStats'),
    safe(() => fetchResearchProgress(workspaceId, 7),
      { window_days: 7, workspace: null, dialysis: null, government: null },
      'fetchResearchProgress'),
  ]);

  let priorities;
  try {
    priorities = await buildStrategicPriorities(
      roleView, myWork, inboxSummary.items, sfActivity, hotContacts,
      diaPipeline, unassignedWork, syncHealth, workCounts,
    );
  } catch (err) {
    console.error('[BriefingEmail] buildStrategicPriorities failed:',
      err?.message || err);
    priorities = {
      today_priorities: [], my_overdue: [], my_due_this_week: [],
      pipeline_deals: [], recommended_calls: [],
    };
  }

  // Friday detection — the snapshot variant overrides; otherwise infer from
  // today's weekday in America/Chicago.
  const ctWeekday = ctNow().getDay();
  const variant = intelSnapshot?.variant || (ctWeekday === 5 ? 'friday_deep_dive' : 'daily');

  const subject = formatSubject(ctNow(), variant);
  const ctx = {
    subject, generatedAt,
    personalContext, intelSnapshot,
    priorities, syncHealth, workCounts, inboxSummary, newIntakes,
    salesComps, expirations, newListings, pipelineRollup,
    marketStats, researchProgress,
    weather: personalContext.weather,
  };

  const html = renderHtml(ctx);
  const text = renderText(ctx);

  res.status(200).json({
    subject,
    html,
    text,
    generated_at: generatedAt,
    role_view: roleView,
    intel_freshness: intelSnapshot
      ? {
          has_snapshot: true,
          as_of_date: intelSnapshot.as_of_date,
          generated_at: intelSnapshot.generated_at,
          variant: intelSnapshot.variant,
        }
      : { has_snapshot: false, as_of_date: null, generated_at: null, variant: null },
    personal_context_present:
      !!(personalContext.events.length || personalContext.tasks.length || personalContext.weather),
  });
}
