#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #4 Phase C: Next Best Action rail on Home tab.
//
// Renders the cross-domain prioritized broker queue (dia + gov
// v_next_best_action) at the top of the Home page so Scott opens the app
// and immediately sees the highest-value gaps to close.
//
// This is the user-visible payoff for the entire Item #4 build:
//   - Phase A (dia v_next_best_action view)              shipped 2026-05-17
//   - Phase B-1 (gov mirror)                              shipped 2026-05-17
//   - Phase B-2 (cross-domain endpoint /api/admin?_route= shipped 2026-05-17
//                next-best-action)
//   - v3 valuation (NOI/cap_rate from CM-report TTM caps)  shipped 2026-05-17
//   - v3.2 dedupe + junk filter                            shipped 2026-05-17
//   - **Phase C** (Home rail UI)                           ← THIS PATCH
//
// Edits to:
//   - index.html  — inserts the widget block after the Home stats grid
//   - styles.css  — adds .nba-* styles (rail layout, severity colors)
//   - app.js      — adds state vars, render/load fns, wires handlePageLoad,
//                   bootApp Promise.all, auto-refresh + visibilitychange
//   - AUDIT_PROGRESS.md — closeout entry
//
// Branch: audit/05-nba-home-rail
// ============================================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const argv = new Set(process.argv.slice(2));
const DRY  = argv.has('--dry') || !argv.has('--apply');

function detectEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf   = (s.match(/(^|[^\r])\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}
function toEol(s, eol) {
  // Normalize all newlines in the supplied literal to the file's EOL.
  return s.replace(/\r\n/g, '\n').replace(/\n/g, eol);
}
async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0; let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
async function replaceUnique(path, oldStr, newStr, report, label) {
  console.log('[probe]', label, 'oldStr.len=', oldStr.length, 'newStr.len=', newStr.length);
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const oldN = toEol(oldStr, eol);
  const newN = toEol(newStr, eol);
  const occ = countOccurrences(original, oldN);
  if (occ === 0) throw new Error(`${label}: anchor not found in ${path}`);
  if (occ > 1)  throw new Error(`${label}: anchor matched ${occ} times in ${path} (must be unique)`);
  if (oldN === newN) {
    report.push([`${label}`, 0, 'no changes']);
    return;
  }
  const updated = original.replace(oldN, newN);
  const delta = updated.length - original.length;
  report.push([`${label} (${eol === '\r\n' ? 'CRLF' : 'LF'})`, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

// ─── index.html: insert Next Best Action widget after the stats grid ───
async function patchIndexHtml(report) {
  const path = resolve(REPO_ROOT, 'index.html');
  if (!await fileExists(path)) throw new Error('index.html not found.');

  const ANCHOR = `              <div class="stat-card clickable" onclick="navTo('pageBiz')"><div class="stat-label">Due This Week</div><div class="stat-value" id="statDue">-</div><div class="stat-sub">Tasks</div></div>
            </div>

            <!-- Weather -->`;

  const REPLACE = `              <div class="stat-card clickable" onclick="navTo('pageBiz')"><div class="stat-label">Due This Week</div><div class="stat-value" id="statDue">-</div><div class="stat-sub">Tasks</div></div>
            </div>

            <!-- Next Best Action — cross-domain prioritized broker queue (Item #4 Phase C, 2026-05-17) -->
            <div class="widget" id="nextBestActionWidget">
              <div class="widget-title">
                Next Best Action
                <div class="nba-controls">
                  <div class="nba-domain-switch" id="nbaDomainSwitch">
                    <button type="button" class="nba-domain-btn active" data-nba-domain="both" onclick="setNbaDomainView('both')">All</button>
                    <button type="button" class="nba-domain-btn" data-nba-domain="dia"  onclick="setNbaDomainView('dia')">Dialysis</button>
                    <button type="button" class="nba-domain-btn" data-nba-domain="gov"  onclick="setNbaDomainView('gov')">Government</button>
                  </div>
                  <button type="button" class="nba-refresh-btn" onclick="loadNextBestActionData(true)" title="Refresh">↻</button>
                </div>
              </div>
              <div id="nextBestActionContent"><div class="loading"><span class="spinner"></span></div></div>
            </div>

            <!-- Weather -->`;

  await replaceUnique(path, ANCHOR, REPLACE, report, 'index.html (NBA widget block)');
}

// ─── styles.css: insert .nba-* styles after the .db-market-html block ───
async function patchStylesCss(report) {
  const path = resolve(REPO_ROOT, 'styles.css');
  if (!await fileExists(path)) throw new Error('styles.css not found.');

  const ANCHOR = `.db-market-html td, .db-market-html th { border: 1px solid var(--border); padding: 4px 6px; }`;
  const NBA_CSS = `
/* Next Best Action — Home rail (Item #4 Phase C, 2026-05-17) */
#nextBestActionWidget .widget-title { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.nba-controls { display: flex; align-items: center; gap: 6px; }
.nba-domain-switch { display: inline-flex; background: var(--s2); border: 1px solid var(--border); border-radius: 8px; padding: 2px; gap: 2px; }
.nba-domain-btn { font-size: 11px; padding: 3px 8px; border: 0; background: transparent; color: var(--text2); border-radius: 6px; cursor: pointer; font-weight: 600; }
.nba-domain-btn.active { background: var(--accent2); color: #fff; }
.nba-refresh-btn { font-size: 14px; line-height: 1; padding: 2px 6px; border: 1px solid var(--border); background: var(--s2); color: var(--text2); border-radius: 6px; cursor: pointer; }
.nba-refresh-btn:hover { color: var(--accent); border-color: var(--accent); }
.nba-meta { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text2); margin-bottom: 8px; }
.nba-count strong { color: var(--text1); font-weight: 700; }
.nba-warn { color: var(--yellow); font-weight: 600; }
.nba-list { display: grid; gap: 6px; }
.nba-row { display: grid; grid-template-columns: 32px 56px 1fr auto; align-items: center; gap: 10px; padding: 8px 10px 8px 8px; background: var(--s2); border: 1px solid var(--border); border-left: 3px solid var(--border); border-radius: 8px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.nba-row:hover { border-color: var(--accent); background: color-mix(in srgb, var(--accent2) 8%, var(--s2)); }
.nba-row.nba-sev-critical { border-left-color: var(--red, #ef4444); }
.nba-row.nba-sev-high     { border-left-color: var(--orange, #f59e0b); }
.nba-row.nba-sev-medium   { border-left-color: var(--yellow, #eab308); }
.nba-row.nba-sev-low      { border-left-color: var(--text3); }
.nba-rank { font-size: 12px; font-weight: 700; color: var(--text2); text-align: center; }
.nba-tag-stack { display: flex; flex-direction: column; gap: 3px; align-items: stretch; }
.nba-sev-chip { font-size: 9px; font-weight: 800; letter-spacing: 0.4px; text-align: center; padding: 2px 4px; border-radius: 4px; border: 1px solid transparent; }
.nba-sev-critical-chip { background: color-mix(in srgb, var(--red, #ef4444) 18%, transparent); color: var(--red, #ef4444); border-color: color-mix(in srgb, var(--red, #ef4444) 45%, transparent); }
.nba-sev-high-chip     { background: color-mix(in srgb, var(--orange, #f59e0b) 18%, transparent); color: var(--orange, #f59e0b); border-color: color-mix(in srgb, var(--orange, #f59e0b) 45%, transparent); }
.nba-sev-medium-chip   { background: color-mix(in srgb, var(--yellow, #eab308) 18%, transparent); color: var(--yellow, #eab308); border-color: color-mix(in srgb, var(--yellow, #eab308) 45%, transparent); }
.nba-sev-low-chip      { background: var(--s1); color: var(--text2); border-color: var(--border); }
.nba-domain-tag { font-size: 9px; font-weight: 800; letter-spacing: 0.4px; text-align: center; padding: 2px 4px; border-radius: 4px; border: 1px solid transparent; }
.nba-domain-tag-dia { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.nba-domain-tag-gov { background: color-mix(in srgb, var(--accent2) 16%, transparent); color: var(--accent2); border-color: color-mix(in srgb, var(--accent2) 40%, transparent); }
.nba-body { min-width: 0; overflow: hidden; }
.nba-label { font-size: 13px; font-weight: 600; color: var(--text1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nba-action { font-size: 11px; color: var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.nba-value { font-size: 13px; font-weight: 700; color: var(--text1); text-align: right; white-space: nowrap; }
.nba-empty { font-size: 12px; color: var(--text3); padding: 12px 4px; text-align: center; }
@media (max-width: 720px) {
  .nba-row { grid-template-columns: 28px 48px 1fr auto; gap: 8px; padding: 7px 8px; }
  .nba-action { font-size: 10px; }
  .nba-value { font-size: 12px; }
}`;
  const REPLACE = ANCHOR + NBA_CSS;
  await replaceUnique(path, ANCHOR, REPLACE, report, 'styles.css (.nba-* block)');
}

// ─── app.js: state vars, handlePageLoad, render/load fns, bootApp ───
async function patchAppJs(report) {
  const path = resolve(REPO_ROOT, 'app.js');
  if (!await fileExists(path)) throw new Error('app.js not found.');

  // 1. State variables — sit alongside dailyBriefing state at line ~184
  await replaceUnique(path,
    `let dailyBriefingRoleView = 'broker';
let logCallData = {};`,
    `let dailyBriefingRoleView = 'broker';
// Next Best Action — Home rail (Item #4 Phase C, 2026-05-17)
let nbaSnapshot = null;
let nbaLoaded = false;
let nbaDomainView = 'both';
let logCallData = {};`,
    report, 'app.js (NBA state vars)');

  // 2. handlePageLoad — fire renderNextBestActionPanel + loadNextBestActionData
  await replaceUnique(path,
    `    case 'pageHome':
      renderDailyBriefingPanel();
      if (!dailyBriefingLoaded) loadDailyBriefingData();
      break;`,
    `    case 'pageHome':
      renderDailyBriefingPanel();
      if (!dailyBriefingLoaded) loadDailyBriefingData();
      renderNextBestActionPanel();
      if (!nbaLoaded) loadNextBestActionData();
      break;`,
    report, 'app.js (handlePageLoad pageHome)');

  // 3. Render + load + helpers — inserted right after loadDailyBriefingData
  await replaceUnique(path,
    `window.loadDailyBriefingData = loadDailyBriefingData;

// ============================================================
// TEAM PULSE`,
    `window.loadDailyBriefingData = loadDailyBriefingData;

// ============================================================
// NEXT BEST ACTION — Home rail (Item #4 Phase C, 2026-05-17)
// Cross-domain prioritized broker queue. Reads from
//   GET /api/admin?_route=next-best-action&domain={both|dia|gov}&limit=15
// which fans out across dia + gov v_next_best_action views and returns
// a globally re-ranked list of the highest-value open gaps.
// ============================================================
function getNbaDomainView() {
  try {
    const stored = localStorage.getItem('lcc.nba.domain');
    if (stored === 'dia' || stored === 'gov' || stored === 'both') return stored;
  } catch (_) {}
  return 'both';
}

function setNbaDomainView(view) {
  if (!['both', 'dia', 'gov'].includes(view)) return;
  nbaDomainView = view;
  try { localStorage.setItem('lcc.nba.domain', view); } catch (_) {}
  setNbaDomainSwitchActive(view);
  loadNextBestActionData(true);
}
window.setNbaDomainView = setNbaDomainView;

function setNbaDomainSwitchActive(view) {
  document.querySelectorAll('#nbaDomainSwitch .nba-domain-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.nbaDomain === view);
  });
}

function formatNbaValue(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 10e6 ? 0 : 1) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v);
}

function formatNbaGapType(type) {
  if (!type) return '';
  const map = {
    missing_recorded_owner: 'Missing recorded owner',
    llc_research_pending:   'LLC research pending',
    lease_tenant_drift:     'Lease vs property tenant drift',
    orphan_sale_owner:      'Sale missing owner backlink',
    stale_active_listing:   'Stale active listing'
  };
  if (map[type]) return map[type];
  if (String(type).startsWith('cms_chain_drift:')) return 'CMS chain drift';
  return String(type).replace(/_/g, ' ');
}

function nbaDomainTag(srcDomain) {
  if (srcDomain === 'dialysis')   return { code: 'DIA', cls: 'nba-domain-tag-dia' };
  if (srcDomain === 'government') return { code: 'GOV', cls: 'nba-domain-tag-gov' };
  return { code: '?', cls: '' };
}

function openNbaItem(srcDomain, propertyId) {
  if (!propertyId) return;
  const db = srcDomain === 'dialysis' ? 'dia' : (srcDomain === 'government' ? 'gov' : null);
  if (!db) return;
  if (typeof openUnifiedDetail === 'function') {
    try { openUnifiedDetail(db, { property_id: Number(propertyId) }, {}, null); return; }
    catch (e) { console.warn('[NBA] openUnifiedDetail failed:', e.message); }
  }
  if (typeof navTo === 'function') navTo(db === 'dia' ? 'pageDia' : 'pageGov');
}
window.openNbaItem = openNbaItem;

function renderNextBestActionPanel() {
  const el = document.getElementById('nextBestActionContent');
  if (!el) return;

  nbaDomainView = getNbaDomainView();
  setNbaDomainSwitchActive(nbaDomainView);

  if (!nbaLoaded) {
    el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    return;
  }
  if (!nbaSnapshot || !nbaSnapshot.ok) {
    el.innerHTML = '<div class="widget-error"><div class="err-msg">Next-best-action queue unavailable.</div><button class="retry-btn" onclick="loadNextBestActionData(true)">Retry</button></div>';
    return;
  }

  const items = Array.isArray(nbaSnapshot.items) ? nbaSnapshot.items : [];
  const total = Number(nbaSnapshot.total_merged) || items.length;
  const byDomain = nbaSnapshot.by_domain || {};

  if (items.length === 0) {
    el.innerHTML = '<div class="nba-empty">No outstanding gaps. Queue is clear.</div>';
    return;
  }

  const failed = Object.entries(byDomain).filter(([, v]) => v && !v.ok).map(([k]) => k);

  let html = '';
  html += '<div class="nba-meta">';
  html += '<span class="nba-count"><strong>' + Math.min(items.length, 10) + '</strong> shown · <strong>' + total.toLocaleString() + '</strong> total open</span>';
  if (failed.length > 0) {
    html += '<span class="nba-warn" title="' + esc(failed.join(', ')) + '">⚠ partial</span>';
  }
  html += '</div>';

  html += '<div class="nba-list">';
  items.slice(0, 10).forEach((row, idx) => {
    const sev = String(row.gap_severity || 'low').toLowerCase();
    const dom = nbaDomainTag(row.source_domain);
    const label = String(row.gap_label || '').trim() || ('Property #' + (row.property_id || ''));
    const action = String(row.suggested_action || '').trim() || formatNbaGapType(row.gap_type);
    const val = formatNbaValue(row.gap_value);
    const pid = row.property_id;
    const clickAttr = pid
      ? ' onclick="openNbaItem(\\'' + esc(row.source_domain || '') + '\\', ' + Number(pid) + ')"'
      : '';
    html += '<div class="nba-row nba-sev-' + esc(sev) + '"' + clickAttr + '>';
    html +=   '<div class="nba-rank">#' + (row.rank || (idx + 1)) + '</div>';
    html +=   '<div class="nba-tag-stack">';
    html +=     '<span class="nba-sev-chip nba-sev-' + esc(sev) + '-chip">' + esc(sev.toUpperCase()) + '</span>';
    html +=     '<span class="nba-domain-tag ' + dom.cls + '">' + dom.code + '</span>';
    html +=   '</div>';
    html +=   '<div class="nba-body">';
    html +=     '<div class="nba-label" title="' + esc(label) + '">' + esc(label) + '</div>';
    html +=     '<div class="nba-action" title="' + esc(action) + '">' + esc(action) + '</div>';
    html +=   '</div>';
    html +=   '<div class="nba-value">' + esc(val) + '</div>';
    html += '</div>';
  });
  html += '</div>';

  el.innerHTML = html;
}

async function loadNextBestActionData(force = false) {
  nbaDomainView = getNbaDomainView();

  if (!force && nbaLoaded && nbaSnapshot) {
    renderNextBestActionPanel();
    return;
  }

  nbaLoaded = false;
  renderNextBestActionPanel();

  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;

  try {
    const url = '/api/admin?_route=next-best-action&domain=' + encodeURIComponent(nbaDomainView) + '&limit=15';
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    nbaSnapshot = await res.json();
  } catch (e) {
    console.warn('[NextBestAction] Load failed:', e.message);
    nbaSnapshot = null;
  } finally {
    nbaLoaded = true;
    renderNextBestActionPanel();
  }
}
window.loadNextBestActionData = loadNextBestActionData;

// ============================================================
// TEAM PULSE`,
    report, 'app.js (NBA render/load fns)');

  // 4. bootApp Promise.all — append loadNextBestActionData()
  await replaceUnique(path,
    `Promise.all([loadActivities(), loadEmails(), loadCalendar(), loadHealth(), loadWeather(), loadMarket(), loadPersonalCalendar(), loadPersonalTasks(), loadCanonicalData(), loadDailyBriefingData()])`,
    `Promise.all([loadActivities(), loadEmails(), loadCalendar(), loadHealth(), loadWeather(), loadMarket(), loadPersonalCalendar(), loadPersonalTasks(), loadCanonicalData(), loadDailyBriefingData(), loadNextBestActionData()])`,
    report, 'app.js (bootApp Promise.all)');

  // 5. startAutoRefresh interval — add NBA refresh (unique anchor: loadHealth();)
  await replaceUnique(path,
    `    loadHealth();
    loadWeather();
    loadMarket();
    loadCanonicalData();
    loadDailyBriefingData(true);
    updateGreeting();
  }, interval);`,
    `    loadHealth();
    loadWeather();
    loadMarket();
    loadCanonicalData();
    loadDailyBriefingData(true);
    loadNextBestActionData(true);
    updateGreeting();
  }, interval);`,
    report, 'app.js (startAutoRefresh interval)');

  // 6. visibilitychange handler — add NBA refresh (anchor: 6-space indent + loadWeather)
  await replaceUnique(path,
    `      loadWeather();
      loadMarket();
      loadCanonicalData();
      loadDailyBriefingData(true);
      updateGreeting();
    }
  }
});`,
    `      loadWeather();
      loadMarket();
      loadCanonicalData();
      loadDailyBriefingData(true);
      loadNextBestActionData(true);
      updateGreeting();
    }
  }
});`,
    report, 'app.js (visibilitychange handler)');
}

// ─── AUDIT_PROGRESS.md: append closeout entry ───
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — item 4 Phase C — Next Best Action rail on Home tab
- **Status:** ✅ DONE
- **Branch:** \`audit/05-nba-home-rail\`
- **Patch:** \`audit/patches/05-nba-home-rail/apply.mjs\`
- **Closes:** B-1 (cross-domain) + B-3 (next-best-action surfacing) — user-visible payoff for the Item #4 build.

### What this adds
- New widget on Home page, immediately after the 4 stat cards and before Weather.
- Renders the top 10 globally-ranked gaps merged across dia + gov.
- Each row is clickable → opens the unified property detail panel for that record.
- Domain switch (All / Dialysis / Government) persisted in \`localStorage['lcc.nba.domain']\`.
- Refresh button + automatic refresh on auto-refresh interval and on tab regain-focus (visibilitychange).

### Data flow
\`\`\`
Home tab (#nextBestActionContent)
   ↓
loadNextBestActionData()
   ↓
GET /api/admin?_route=next-best-action&domain={both|dia|gov}&limit=15
   ↓
handleNextBestAction() fans out to:
   ├─ dia.v_next_best_action  (10,115 rows post-v3.2 cleanup)
   └─ gov.v_next_best_action  (gov mirror)
   ↓
Global re-rank by gap_value DESC, slice top-N, return {items, by_domain, total_merged}
\`\`\`

### Row layout
\`\`\`
[ #1 ] [CRIT] [GOV]  1234 Pennsylvania Ave NW          $42.5M
                     Research recorded owner for ...
\`\`\`
- Rank number, severity chip (CRIT/HIGH/MED/LOW with color), domain tag (DIA/GOV), label (with \`[N dup records]\` annotation from v3.2 when present), suggested action, and value estimate (NOI/cap from v3).
- Left border stripe color-coded by severity.
- Click anywhere on the row → \`openUnifiedDetail(db, { property_id })\`.

### Files changed
- \`index.html\` — widget block inserted after Home stats grid
- \`styles.css\` — \`.nba-*\` block (rail layout + severity colors)
- \`app.js\` — state vars, handlePageLoad wiring, render/load fns, bootApp Promise.all entry, auto-refresh + visibilitychange entries
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification (post-apply, post-commit)
1. \`grep -c "renderNextBestActionPanel" app.js\` → ≥ 4
2. \`grep -c "loadNextBestActionData" app.js\` → ≥ 5
3. \`grep -c "nextBestActionWidget" index.html\` → 1
4. \`grep -c ".nba-row" styles.css\` → ≥ 1
5. Smoke: hard-reload the app, land on Home → rail visible with 10 ranked rows, top entry has expected value, clicking opens the unified detail panel.

`);

  // Insert before the preflight section if present, else append at end.
  const preflightAnchor = N(`\n# Sprint preflight — 2026-05-17\n`);
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, appendBlock + preflightAnchor);
  } else {
    c = c + appendBlock;
  }

  if (c === original) {
    report.push(['AUDIT_PROGRESS.md', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push([`AUDIT_PROGRESS.md (${eol === '\r\n' ? 'CRLF' : 'LF'})`, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log(`\n=== LCC Audit Sprint — Item #4 Phase C (NBA Home rail) ===`);
  console.log(`Mode: ${DRY ? 'DRY-RUN' : 'APPLY'}\n`);
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error(`Could not find package.json at ${REPO_ROOT}.`);
  }
  const report = [];
  await patchIndexHtml(report);
  await patchStylesCss(report);
  await patchAppJs(report);
  await updateAuditProgress(report);
  console.log(`--- ${DRY ? 'DRY-RUN' : 'APPLY'} SUMMARY ---`);
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log(`  ${file.padEnd(60)}  ${sign}${delta} bytes  (${note})`);
  }
  if (DRY) {
    console.log(`\n✓ Dry-run complete. Re-run with --apply.\n`);
  } else {
    console.log(`\n✓ Apply complete.\n`);
  }
}
main().catch(err => { console.error(`\n❌ FAILED: ${err.message}\n`); process.exit(1); });
