#!/usr/bin/env node
// ============================================================================
// LCC Phase C — ingest_write_failures admin dashboard widget.
//
// Closes the observability loop on the silent-write telemetry built over
// this sprint:
//   • Item #5 Phase A — ingest_write_failures table + domainQuery
//                       instrumentation (1.5+k rows landed since deploy)
//   • Item #10 Phase B — client_errors table + lccReportError telemetry
//   • Fresh audit A-3 — labeled previously-anonymous writers
//
// Today Scott has no in-app surface for "what's silently failing right now"
// — he has to query Supabase Studio. This patch adds a widget on the Sync
// Health page that shows:
//   • Stats row: total / labeled / unlabeled / distinct labels
//   • Top 10 failing label/path/status combos with counts + freshness
//   • Empty state when there are no failures (the happy case)
//
// Three small changes:
//   1. New admin sub-route GET /api/admin?_route=write-failures-rollup
//   2. New widget render in app.js
//   3. Mount call in ops.js renderSyncHealthPage
//
// Branch: audit/phase-c-write-failures-dashboard
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
function toEol(s, eol) { return s.replace(/\r\n/g, '\n').replace(/\n/g, eol); }
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
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const oldN = toEol(oldStr, eol);
  const newN = toEol(newStr, eol);
  const occ = countOccurrences(original, oldN);
  if (occ === 0) throw new Error(label + ': anchor not found in ' + path);
  if (occ > 1)  throw new Error(label + ': anchor matched ' + occ + ' times in ' + path);
  if (oldN === newN) { report.push([label, 0, 'no changes']); return; }
  const updated = original.replace(oldN, () => newN);
  const delta = updated.length - original.length;
  report.push([label + ' (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

// ─── api/admin.js: dispatcher + handler ───
async function patchAdminJs(report) {
  const path = resolve(REPO_ROOT, 'api', 'admin.js');
  if (!await fileExists(path)) throw new Error('api/admin.js not found.');

  await replaceUnique(path,
    `    case 'agency-drift-queue':      return handleAgencyDriftQueueList(req, res);
    case 'resolve-agency-drift':    return handleResolveAgencyDrift(req, res);
    default:`,
    `    case 'agency-drift-queue':      return handleAgencyDriftQueueList(req, res);
    case 'resolve-agency-drift':    return handleResolveAgencyDrift(req, res);
    case 'write-failures-rollup':   return handleWriteFailuresRollup(req, res);
    default:`,
    report, 'api/admin.js (dispatcher case for write-failures-rollup)');

  await replaceUnique(path,
    `// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
function stripNullsLocal(obj) {`,
    `// ============================================================================
// WRITE FAILURES ROLLUP — Phase C (2026-05-18)
//
// GET /api/admin?_route=write-failures-rollup&hours=24
//   Returns:
//     {
//       ok: true,
//       window_hours,
//       totals: { total, labeled, unlabeled, distinct_labels },
//       top_combos: [{ label, path, http_status, count, latest_at, sample_detail }]
//     }
//   top_combos limited to 25 rows ordered by count DESC.
// ============================================================================
async function handleWriteFailuresRollup(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const hours = Math.min(parseInt(req.query.hours, 10) || 24, 168);

  try {
    const { opsQuery } = await import('./_shared/ops-db.js');
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    // Pull recent failures with bounded payload (cap at 5000 rows for stats).
    const r = await opsQuery('GET',
      'ingest_write_failures?occurred_at=gte.' + encodeURIComponent(cutoff) +
      '&select=label,path,http_status,occurred_at,error_detail' +
      '&order=occurred_at.desc' +
      '&limit=5000'
    );
    if (!r.ok) return res.status(502).json({ error: 'rollup_fetch_failed', detail: r.data });

    const rows = Array.isArray(r.data) ? r.data : [];
    const labelsSeen = new Set();
    let labeled = 0;
    let unlabeled = 0;
    const buckets = new Map();
    for (const row of rows) {
      if (row.label) { labeled++; labelsSeen.add(row.label); } else { unlabeled++; }
      const key = (row.label || '(unlabeled)') + '|' + (row.path || '') + '|' + (row.http_status || '');
      let b = buckets.get(key);
      if (!b) {
        b = {
          label: row.label || null,
          path: row.path || null,
          http_status: row.http_status || null,
          count: 0,
          latest_at: row.occurred_at,
          sample_detail: null,
        };
        buckets.set(key, b);
      }
      b.count++;
      if (row.occurred_at > b.latest_at) b.latest_at = row.occurred_at;
      if (!b.sample_detail && row.error_detail) {
        try {
          const det = typeof row.error_detail === 'string' ? row.error_detail : JSON.stringify(row.error_detail);
          b.sample_detail = det.length > 240 ? det.slice(0, 237) + '...' : det;
        } catch (_) {}
      }
    }
    const top_combos = Array.from(buckets.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 25);

    return res.status(200).json({
      ok: true,
      window_hours: hours,
      totals: {
        total:           rows.length,
        labeled,
        unlabeled,
        distinct_labels: labelsSeen.size,
      },
      top_combos,
    });
  } catch (err) {
    console.error('[write-failures-rollup]', err?.message || err);
    return res.status(500).json({ error: 'rollup_failed', message: err?.message });
  }
}

// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
function stripNullsLocal(obj) {`,
    report, 'api/admin.js (handleWriteFailuresRollup)');
}

// ─── app.js: widget render + load ───
async function patchAppJs(report) {
  const path = resolve(REPO_ROOT, 'app.js');
  if (!await fileExists(path)) throw new Error('app.js not found.');

  await replaceUnique(path,
    `function _lccAgencyDriftOpenDetail(property_id) {
  if (typeof openUnifiedDetail === 'function') {
    try { openUnifiedDetail('gov', { property_id: Number(property_id) }, {}, null); return; }
    catch (e) { console.warn('[AgencyDrift] openUnifiedDetail failed:', e.message); }
  }
  if (typeof navTo === 'function') navTo('pageGov');
}
window._lccAgencyDriftOpenDetail = _lccAgencyDriftOpenDetail;`,
    `function _lccAgencyDriftOpenDetail(property_id) {
  if (typeof openUnifiedDetail === 'function') {
    try { openUnifiedDetail('gov', { property_id: Number(property_id) }, {}, null); return; }
    catch (e) { console.warn('[AgencyDrift] openUnifiedDetail failed:', e.message); }
  }
  if (typeof navTo === 'function') navTo('pageGov');
}
window._lccAgencyDriftOpenDetail = _lccAgencyDriftOpenDetail;

// ============================================================================
// WRITE FAILURES DASHBOARD WIDGET — Phase C (2026-05-18)
//
// Mounts on the Sync Health page below the connector cards. Surfaces the
// last 24h of silent-write failures captured by Item #5 Phase A's
// ingest_write_failures table. Helps Scott see at a glance "what's
// silently broken right now".
// ============================================================================

function _lccFmtFreshness(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

async function loadWriteFailuresRollup(hours) {
  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
  try {
    const r = await fetch('/api/admin?_route=write-failures-rollup&hours=' + (hours || 24), { headers });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    if (typeof lccReportError === 'function') {
      lccReportError('Load write-failures rollup', e, { tier: 'warn' });
    }
    return { ok: false, totals: { total: 0 }, top_combos: [] };
  }
}
window.loadWriteFailuresRollup = loadWriteFailuresRollup;

async function renderWriteFailuresWidget(parentEl) {
  if (!parentEl) return;
  let widget = parentEl.querySelector('.lcc-wf-widget');
  if (!widget) {
    widget = document.createElement('div');
    widget.className = 'lcc-wf-widget';
    parentEl.appendChild(widget);
  }
  widget.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  const snap = await loadWriteFailuresRollup(24);
  if (!snap || !snap.ok) {
    widget.innerHTML = '<div class="widget-error"><div class="err-msg">Write-failures rollup unavailable.</div><button class="retry-btn" onclick="(async()=>{const el=document.getElementById(&quot;syncHealthContent&quot;);if(el)await renderWriteFailuresWidget(el);})()">Retry</button></div>';
    return;
  }

  const t = snap.totals || {};
  const combos = Array.isArray(snap.top_combos) ? snap.top_combos : [];
  const parts = [];
  parts.push('<div class="lcc-wf-header">');
  parts.push(  '<div class="lcc-wf-title">Silent-Write Failures <span class="lcc-wf-window">last 24h</span></div>');
  parts.push(  '<button type="button" class="nba-refresh-btn" title="Refresh" onclick="(async()=>{const el=document.getElementById(&quot;syncHealthContent&quot;);if(el)await renderWriteFailuresWidget(el);})()">↻</button>');
  parts.push('</div>');

  // Stats row
  parts.push('<div class="lcc-wf-stats">');
  parts.push(  '<div class="lcc-wf-stat"><div class="lcc-wf-stat-num">' + (t.total || 0).toLocaleString() + '</div><div class="lcc-wf-stat-label">Total</div></div>');
  parts.push(  '<div class="lcc-wf-stat"><div class="lcc-wf-stat-num">' + (t.labeled || 0).toLocaleString() + '</div><div class="lcc-wf-stat-label">Labeled</div></div>');
  parts.push(  '<div class="lcc-wf-stat ' + ((t.unlabeled || 0) > 0 ? 'lcc-wf-stat-warn' : '') + '"><div class="lcc-wf-stat-num">' + (t.unlabeled || 0).toLocaleString() + '</div><div class="lcc-wf-stat-label">Unlabeled</div></div>');
  parts.push(  '<div class="lcc-wf-stat"><div class="lcc-wf-stat-num">' + (t.distinct_labels || 0).toLocaleString() + '</div><div class="lcc-wf-stat-label">Distinct labels</div></div>');
  parts.push('</div>');

  // Table
  if (combos.length === 0) {
    parts.push('<div class="lcc-wf-empty">No silent-write failures in the last 24h. ✓</div>');
  } else {
    parts.push('<div class="lcc-wf-table-wrap">');
    parts.push('<table class="lcc-wf-table"><thead><tr>');
    parts.push(  '<th>Label</th><th>Path</th><th>Status</th><th class="num">Count</th><th>Last seen</th>');
    parts.push('</tr></thead><tbody>');
    combos.forEach(c => {
      const labelStr = c.label || '(unlabeled)';
      const cls = c.label ? 'lcc-wf-row' : 'lcc-wf-row lcc-wf-row-unlabeled';
      const sample = c.sample_detail ? ' title="' + esc(c.sample_detail) + '"' : '';
      parts.push('<tr class="' + cls + '"' + sample + '>');
      parts.push(  '<td class="lcc-wf-label">' + esc(labelStr) + '</td>');
      parts.push(  '<td class="lcc-wf-path">' + esc(c.path || '') + '</td>');
      parts.push(  '<td class="lcc-wf-status">' + (c.http_status != null ? c.http_status : '') + '</td>');
      parts.push(  '<td class="lcc-wf-count num">' + (c.count || 0).toLocaleString() + '</td>');
      parts.push(  '<td class="lcc-wf-when">' + esc(_lccFmtFreshness(c.latest_at)) + '</td>');
      parts.push('</tr>');
    });
    parts.push('</tbody></table>');
    parts.push('</div>');
  }

  widget.innerHTML = parts.join('');
}
window.renderWriteFailuresWidget = renderWriteFailuresWidget;`,
    report, 'app.js (write-failures widget)');
}

// ─── ops.js: mount inside renderSyncHealthPage ───
async function patchOpsJs(report) {
  const path = resolve(REPO_ROOT, 'ops.js');
  if (!await fileExists(path)) throw new Error('ops.js not found.');

  await replaceUnique(path,
    `  el.innerHTML = html;
  perf.end();

  // Append perf dashboard for managers
  setTimeout(appendPerfToSyncHealth, 100);
}

async function triggerSync(connectorType) {`,
    `  el.innerHTML = html;
  perf.end();

  // Append perf dashboard for managers
  setTimeout(appendPerfToSyncHealth, 100);

  // Phase C (2026-05-18): mount the silent-write-failures widget at the
  // bottom of the Sync Health page. Surfaces ingest_write_failures
  // rollup so silent failures are visible in-app instead of only in Studio.
  try {
    if (typeof renderWriteFailuresWidget === 'function') {
      await renderWriteFailuresWidget(el);
    }
  } catch (e) { console.warn('[SyncHealth] write-failures widget render failed:', e?.message); }
}

async function triggerSync(connectorType) {`,
    report, 'ops.js (mount write-failures widget)');
}

// ─── styles.css ───
async function patchStylesCss(report) {
  const path = resolve(REPO_ROOT, 'styles.css');
  if (!await fileExists(path)) throw new Error('styles.css not found.');

  const ANCHOR = `.lcc-agency-drift-blank { font-style: italic; color: var(--text3) !important; background: var(--s2) !important; border-color: var(--border) !important; }
.lcc-adrift-controls { display: inline-flex; align-items: center; gap: 8px; }`;
  const CSS = `

/* Write failures dashboard widget — Phase C (2026-05-18) */
.lcc-wf-widget { margin-top: 24px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--s1); }
.lcc-wf-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.lcc-wf-title { font-size: 15px; font-weight: 700; color: var(--text1); display: inline-flex; align-items: center; gap: 8px; }
.lcc-wf-window { font-size: 10px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 8px; background: var(--s2); border: 1px solid var(--border); border-radius: 999px; }
.lcc-wf-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
.lcc-wf-stat { padding: 10px 12px; background: var(--s2); border: 1px solid var(--border); border-radius: 8px; }
.lcc-wf-stat-num { font-size: 22px; font-weight: 800; color: var(--text1); line-height: 1.1; }
.lcc-wf-stat-label { font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; margin-top: 2px; }
.lcc-wf-stat-warn { border-color: color-mix(in srgb, var(--yellow, #eab308) 50%, var(--border)); }
.lcc-wf-stat-warn .lcc-wf-stat-num { color: var(--yellow, #eab308); }
.lcc-wf-empty { font-size: 13px; color: var(--text2); padding: 24px; text-align: center; font-style: italic; }
.lcc-wf-table-wrap { overflow-x: auto; }
.lcc-wf-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.lcc-wf-table th { text-align: left; padding: 8px 10px; color: var(--text2); font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; font-size: 10px; border-bottom: 1px solid var(--border); }
.lcc-wf-table th.num { text-align: right; }
.lcc-wf-table td { padding: 8px 10px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); color: var(--text); }
.lcc-wf-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.lcc-wf-row:hover { background: color-mix(in srgb, var(--accent2) 6%, transparent); }
.lcc-wf-row-unlabeled .lcc-wf-label { color: var(--text3); font-style: italic; }
.lcc-wf-label { font-weight: 600; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lcc-wf-path { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 11px; color: var(--text2); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lcc-wf-status { font-variant-numeric: tabular-nums; color: var(--text2); }
.lcc-wf-count { font-weight: 700; color: var(--text1); }
.lcc-wf-when { color: var(--text3); white-space: nowrap; }
@media (max-width: 720px) {
  .lcc-wf-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .lcc-wf-table { font-size: 11px; }
  .lcc-wf-path { max-width: 160px; }
}`;
  const REPLACE = ANCHOR + CSS;
  await replaceUnique(path, ANCHOR, REPLACE, report, 'styles.css (write-failures widget)');
}

// ─── AUDIT_PROGRESS.md ───
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Phase C — Silent-write failures dashboard ✅
- **Status:** ✅ DONE.
- **Branch:** \`audit/phase-c-write-failures-dashboard\`
- **Patch:** \`audit/patches/phase-c-write-failures-dashboard/apply.mjs\`

### What this adds
Closes the in-app observability loop on the silent-write telemetry. Today Scott has to query Supabase Studio to see "what's quietly failing"; this widget surfaces it on the Sync Health page.

**Widget contents:**
- **Stats row** (4 cards): Total / Labeled / Unlabeled / Distinct labels
- **Top 25 failing combos** table: label · path · http_status · count · last seen
- **Empty state** ("No silent-write failures in the last 24h ✓") when nothing's broken

**Backend**: new admin sub-route \`GET /api/admin?_route=write-failures-rollup&hours=24\` returning a JSON rollup of \`ingest_write_failures\` over the last N hours (capped at 5,000 rows for stats).

**Mount**: bottom of the Sync Health page (\`#syncHealthContent\`), via a hook in \`renderSyncHealthPage\` after the existing connectors render.

### Files changed
- \`api/admin.js\` — dispatcher case + \`handleWriteFailuresRollup\`
- \`app.js\` — \`renderWriteFailuresWidget\` + \`loadWriteFailuresRollup\` + \`_lccFmtFreshness\`
- \`ops.js\` — single \`renderWriteFailuresWidget(el)\` mount call inside \`renderSyncHealthPage\`
- \`styles.css\` — \`.lcc-wf-*\` block (stats grid, table styles, dark-mode aware)
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification
1. Open the LCC app → More drawer → **Sync Health**.
2. Scroll past the existing connector cards. Below them: "Silent-Write Failures (last 24h)" widget.
3. Stats row shows current numbers. With all the labeling work from A-2/A-3/A-4 deployed, the "Unlabeled" count should be low (target: <30).
4. Table shows the top 25 label/path/status combos with counts. Hover a row for a sample error_detail tooltip.
5. After a few days clean: the widget shows "No silent-write failures in the last 24h ✓".

### Phase C punch list — still pending
- Sort/chip helper adoption per tab (deferred — v_sales_comps matview needs completeness columns added first)
- Item #8 Phase B — per-action inline workflows on next-action bar
- client_errors consumption sweep (~50 call sites)
- pushProvenance gating sweep (~30 call sites)
- Item #3 Phase C — external enrichment pipeline (13,131 orphans)

`);
  c = c + appendBlock;
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Phase C — Silent-write failures dashboard ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await patchAdminJs(report);
  await patchAppJs(report);
  await patchOpsJs(report);
  await patchStylesCss(report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(75) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
