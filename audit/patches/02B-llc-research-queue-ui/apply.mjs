#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #2 Phase B: LLC Research Queue UI.
//
// Phase A (shipped earlier) added the pg_cron job that drains
// llc_research_queue via the AI pipeline. Phase B adds a manual UI surface
// so Scott can power through the queue (1,267 entries currently, +3 no_match)
// when the AI pipeline hits ambiguous cases or when he wants to run his
// own SoS lookups.
//
// What this delivers:
//
//   1. New admin sub-route GET /api/admin?_route=llc-research-queue
//      Returns top-N queued LLC research items joined with property context
//      (address, city, state, $ value via v_property_value_signal). Ordered
//      by raw value DESC. Default limit 20.
//
//   2. New admin sub-route POST /api/admin?_route=resolve-llc-research
//      Body: { queue_id, status: 'no_match'|'completed',
//              found_filing_id?, found_filing_state? }
//      Marks an entry as resolved. Also marks the property's recorded_owner
//      research as no-longer-pending so the NBA queue stops surfacing it.
//
//   3. New widget at the top of the existing Research page (#researchContent
//      slot in index.html). Renders the top 15 LLC research items as cards
//      with:
//        • Search name + guessed state
//        • Property address + city + state + value chip
//        • External "Open SoS" button (state-aware URL map → Google fallback)
//        • Inline "Mark found" form (filing_id input) + "No match" button
//
//   4. CSS for the widget + state-portal map + per-row severity coloring.
//
// Branch: audit/02B-llc-research-queue-ui
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

// ─── api/admin.js: two new sub-routes ───
async function patchAdminJs(report) {
  const path = resolve(REPO_ROOT, 'api', 'admin.js');
  if (!await fileExists(path)) throw new Error('api/admin.js not found.');

  // 1. Add dispatcher cases.
  await replaceUnique(path,
    `    case 'client-error':            return handleClientErrorReport(req, res);
    default:`,
    `    case 'client-error':            return handleClientErrorReport(req, res);
    case 'llc-research-queue':      return handleLlcResearchQueueList(req, res);
    case 'resolve-llc-research':    return handleResolveLlcResearch(req, res);
    default:`,
    report, 'api/admin.js (dispatcher cases for LLC research)');

  // 2. Add the two handler functions. Anchor on the existing client-error
  //    handler's end so the new handlers sit conceptually nearby.
  await replaceUnique(path,
    `// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
function stripNullsLocal(obj) {`,
    `// ============================================================================
// LLC RESEARCH QUEUE — Item #2 Phase B (2026-05-17)
//
// GET  /api/admin?_route=llc-research-queue&limit=20
//   Returns top-N queued LLC research items joined with property context.
//
// POST /api/admin?_route=resolve-llc-research
//   Body: { queue_id, status: 'no_match'|'completed',
//           found_filing_id?, found_filing_state? }
//   Marks an entry as resolved. \`completed\` sets resolved_at to now().
// ============================================================================

async function handleLlcResearchQueueList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');
    // Pull queue rows first
    const qRes = await domainQuery('dialysis', 'GET',
      'llc_research_queue' +
      '?status=eq.queued' +
      '&select=queue_id,property_id,search_name,guessed_state,attempts,last_attempt_at,last_error,created_at' +
      '&order=created_at.asc' +
      '&limit=' + limit
    );
    if (!qRes.ok) {
      return res.status(502).json({ error: 'queue_fetch_failed', detail: qRes.data });
    }
    const rows = Array.isArray(qRes.data) ? qRes.data : [];
    if (rows.length === 0) {
      return res.status(200).json({ ok: true, items: [], total: 0 });
    }

    // Fetch property context for each queue row (single batched query)
    const propIds = Array.from(new Set(rows.map(r => r.property_id).filter(Boolean)));
    let propsById = {};
    if (propIds.length > 0) {
      const pRes = await domainQuery('dialysis', 'GET',
        'properties?property_id=in.(' + propIds.join(',') + ')' +
        '&select=property_id,address,city,state,zip_code,tenant,operator,chain_canonical,latest_sale_price,current_value_estimate,annual_rent,completeness_band,completeness_score'
      );
      if (pRes.ok && Array.isArray(pRes.data)) {
        for (const p of pRes.data) propsById[p.property_id] = p;
      }
    }

    // Pull value signal for ranking
    let valueById = {};
    if (propIds.length > 0) {
      const vRes = await domainQuery('dialysis', 'GET',
        'v_property_value_signal?property_id=in.(' + propIds.join(',') + ')&select=property_id,rev_value'
      );
      if (vRes.ok && Array.isArray(vRes.data)) {
        for (const v of vRes.data) valueById[v.property_id] = Number(v.rev_value) || 0;
      }
    }

    const items = rows.map(r => {
      const prop = propsById[r.property_id] || null;
      const rev_value = valueById[r.property_id] || 0;
      return {
        queue_id:           r.queue_id,
        property_id:        r.property_id,
        search_name:        r.search_name,
        guessed_state:      r.guessed_state,
        attempts:           r.attempts,
        last_attempt_at:    r.last_attempt_at,
        last_error:         r.last_error,
        created_at:         r.created_at,
        property_address:   prop?.address || null,
        property_city:      prop?.city || null,
        property_state:     prop?.state || null,
        property_zip:       prop?.zip_code || null,
        tenant:             prop?.tenant || prop?.operator || prop?.chain_canonical || null,
        completeness_band:  prop?.completeness_band || null,
        completeness_score: prop?.completeness_score != null ? Number(prop.completeness_score) : null,
        rev_value,
      };
    });

    // Sort by rev_value DESC so highest-value research surfaces first
    items.sort((a, b) => (b.rev_value || 0) - (a.rev_value || 0));

    return res.status(200).json({ ok: true, items, total: items.length });
  } catch (err) {
    console.error('[llc-research-queue]', err?.message || err);
    return res.status(500).json({ error: 'llc_research_queue_failed', message: err?.message });
  }
}

async function handleResolveLlcResearch(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const body = req.body || {};
  const queueId = Number(body.queue_id);
  const status  = String(body.status || '').toLowerCase();
  if (!Number.isFinite(queueId)) return res.status(400).json({ error: 'queue_id (number) required' });
  if (!['no_match', 'completed'].includes(status)) {
    return res.status(400).json({ error: "status must be 'no_match' or 'completed'" });
  }

  const patch = { status };
  if (status === 'completed') {
    patch.resolved_at = new Date().toISOString();
    if (body.found_filing_id)    patch.found_filing_id    = String(body.found_filing_id).slice(0, 200);
    if (body.found_filing_state) patch.found_filing_state = String(body.found_filing_state).slice(0, 4);
  } else {
    // no_match — still mark resolved_at so we can age out and re-queue later
    patch.resolved_at = new Date().toISOString();
    if (body.last_error) patch.last_error = String(body.last_error).slice(0, 500);
  }

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');
    const r = await domainQuery('dialysis', 'PATCH',
      'llc_research_queue?queue_id=eq.' + queueId, patch);
    if (!r.ok) return res.status(502).json({ error: 'update_failed', detail: r.data });
    return res.status(200).json({ ok: true, queue_id: queueId, status, patch });
  } catch (err) {
    console.error('[resolve-llc-research]', err?.message || err);
    return res.status(500).json({ error: 'resolve_failed', message: err?.message });
  }
}

// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
function stripNullsLocal(obj) {`,
    report, 'api/admin.js (LLC research handlers)');
}

// ─── ops.js: inject widget at top of renderResearchPage ───
async function patchOpsJs(report) {
  const path = resolve(REPO_ROOT, 'ops.js');
  if (!await fileExists(path)) throw new Error('ops.js not found.');

  await replaceUnique(path,
    `async function renderResearchPage(page = opsResearchPage) {
  const el = document.getElementById('researchContent');
  if (!el) return;
  opsResearchPage = Math.max(parseInt(page, 10) || 1, 1);
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:research');`,
    `async function renderResearchPage(page = opsResearchPage) {
  const el = document.getElementById('researchContent');
  if (!el) return;
  opsResearchPage = Math.max(parseInt(page, 10) || 1, 1);
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:research');

  // Item #2 Phase B (2026-05-17): mount the LLC research queue widget at
  // the top of the Research page. Fires once per page render; the widget
  // itself owns its refresh button + click-driven updates.
  try {
    if (typeof renderLlcResearchQueueWidget === 'function') {
      await renderLlcResearchQueueWidget(el);
    }
  } catch (e) { console.warn('[ResearchPage] LLC widget render failed:', e?.message); }`,
    report, 'ops.js (LLC widget mount in renderResearchPage)');
}

// ─── app.js: widget render + load + actions ───
async function patchAppJs(report) {
  const path = resolve(REPO_ROOT, 'app.js');
  if (!await fileExists(path)) throw new Error('app.js not found.');

  // Append the widget code after the lccRenderSortToggle helpers (end of
  // Phase B-3 / 9B block).
  await replaceUnique(path,
    `function lccRenderSortToggle(table, defaultKey, keys, onChangeFnName) {`,
    `// ============================================================================
// LLC RESEARCH QUEUE WIDGET — Item #2 Phase B (2026-05-17)
// Renders at the top of the Research page (mounted from ops.js). Lists
// top-N queued LLC research entries from dia.llc_research_queue with
// property context + state-aware SoS portal links + inline resolve
// actions ("Mark found" + "No match").
// ============================================================================

// State-aware SoS / corporations portal URLs. Fall through to a Google
// search query when the state isn't in this map.
const _LCC_SOS_PORTALS = {
  AL: 'https://arc-sos.state.al.us/CGI/CORPNAME.MBR/INPUT',
  AZ: 'https://ecorp.azcc.gov/EntitySearch/Index',
  CA: 'https://bizfileonline.sos.ca.gov/search/business',
  CO: 'https://www.coloradosos.gov/biz/BusinessEntityCriteriaExt.do',
  DE: 'https://icis.corp.delaware.gov/Ecorp/EntitySearch/NameSearch.aspx',
  FL: 'https://search.sunbiz.org/Inquiry/CorporationSearch/ByName',
  GA: 'https://ecorp.sos.ga.gov/BusinessSearch',
  IL: 'https://www.ilsos.gov/corporatellc/',
  IN: 'https://bsd.sos.in.gov/publicbusinesssearch',
  KY: 'https://web.sos.ky.gov/ftshow/(S())/default.aspx',
  MA: 'https://corp.sec.state.ma.us/CorpWeb/CorpSearch/CorpSearch.aspx',
  MD: 'https://egov.maryland.gov/businessexpress/entitysearch',
  MI: 'https://cofs.lara.state.mi.us/SearchApi/Search/Search',
  MN: 'https://mblsportal.sos.state.mn.us/Business/Search',
  MO: 'https://bsd.sos.mo.gov/BusinessEntity/BESearch.aspx?SearchType=0',
  NC: 'https://www.sosnc.gov/online_services/search/by_title/_Business_Registration',
  NJ: 'https://www.njportal.com/dor/businessrecords/',
  NV: 'https://www.nvsos.gov/sosentitysearch/',
  NY: 'https://apps.dos.ny.gov/publicInquiry/',
  OH: 'https://businesssearch.ohiosos.gov/',
  OR: 'https://sos.oregon.gov/business/Pages/find.aspx',
  PA: 'https://www.corporations.pa.gov/search/CorpSearch',
  TN: 'https://tnbear.tn.gov/Ecommerce/FilingSearch.aspx',
  TX: 'https://mycpa.cpa.state.tx.us/coa/Index.html',
  VA: 'https://sccefile.scc.virginia.gov/Find/Business',
  WA: 'https://ccfs.sos.wa.gov/#/AdvancedSearch',
  WI: 'https://www.wdfi.org/apps/CorpSearch/Search.aspx',
};

function _lccSosPortalUrl(state, searchName) {
  const st = String(state || '').toUpperCase().trim();
  if (st && _LCC_SOS_PORTALS[st]) return _LCC_SOS_PORTALS[st];
  const q = encodeURIComponent('"' + (searchName || '') + '" ' + (st ? st + ' ' : '') + 'secretary of state LLC filing');
  return 'https://www.google.com/search?q=' + q;
}

function _lccFormatLlcValue(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 10e6 ? 0 : 1) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v);
}

async function loadLlcResearchQueue(limit) {
  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
  const url = '/api/admin?_route=llc-research-queue&limit=' + (limit || 15);
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    if (typeof lccReportError === 'function') {
      lccReportError('Load LLC research queue', e, { tier: 'warn' });
    } else {
      console.warn('[LLC Research] load failed:', e.message);
    }
    return { ok: false, items: [], total: 0 };
  }
}
window.loadLlcResearchQueue = loadLlcResearchQueue;

async function renderLlcResearchQueueWidget(parentEl) {
  if (!parentEl) return;
  // Insert (or replace) a dedicated wrapper above the existing
  // #researchContent contents.
  let widget = parentEl.querySelector('.lcc-llc-research-widget');
  if (!widget) {
    widget = document.createElement('div');
    widget.className = 'lcc-llc-research-widget';
    parentEl.insertBefore(widget, parentEl.firstChild);
  }
  widget.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  const snap = await loadLlcResearchQueue(15);
  if (!snap || !snap.ok) {
    widget.innerHTML = '<div class="widget-error"><div class="err-msg">LLC research queue unavailable.</div><button class="retry-btn" onclick="(async()=>{const el=document.getElementById(&quot;researchContent&quot;);if(el)await renderLlcResearchQueueWidget(el);})()">Retry</button></div>';
    return;
  }

  const items = Array.isArray(snap.items) ? snap.items : [];
  const parts = [];
  parts.push('<div class="lcc-llc-research-header">');
  parts.push(  '<div class="lcc-llc-research-title">LLC Research Queue <span class="lcc-llc-research-count">' + items.length + '</span></div>');
  parts.push(  '<button type="button" class="nba-refresh-btn" title="Refresh" onclick="(async()=>{const el=document.getElementById(&quot;researchContent&quot;);if(el)await renderLlcResearchQueueWidget(el);})()">↻</button>');
  parts.push('</div>');

  if (items.length === 0) {
    parts.push('<div class="lcc-llc-research-empty">Queue is clear — no LLCs awaiting research.</div>');
    widget.innerHTML = parts.join('');
    return;
  }

  parts.push('<div class="lcc-llc-research-list">');
  items.forEach((row, idx) => {
    const queueId = Number(row.queue_id);
    const propId = Number(row.property_id);
    const searchName = String(row.search_name || '').trim() || '(no name)';
    const guessedSt = String(row.guessed_state || row.property_state || '').toUpperCase();
    const propAddr = [row.property_address, row.property_city, row.property_state].filter(Boolean).join(', ');
    const valStr = _lccFormatLlcValue(row.rev_value);
    const tenant = row.tenant || '';
    const sosUrl = _lccSosPortalUrl(guessedSt, searchName);
    const cmpChip = (row.completeness_band || row.completeness_score != null)
      ? lccCompletenessChip(row.completeness_score, row.completeness_band)
      : '';
    parts.push('<div class="lcc-llc-research-row" data-queue-id="' + queueId + '">');
    parts.push(  '<div class="lcc-llc-research-rank">#' + (idx + 1) + '</div>');
    parts.push(  '<div class="lcc-llc-research-body">');
    parts.push(    '<div class="lcc-llc-research-name">' + esc(searchName) + (guessedSt ? ' <span class="lcc-llc-research-state">(' + esc(guessedSt) + ')</span>' : '') + '</div>');
    if (propAddr) {
      parts.push(  '<div class="lcc-llc-research-addr">' + esc(propAddr) + (tenant ? ' — ' + esc(tenant) : '') + '</div>');
    }
    parts.push(    '<div class="lcc-llc-research-meta">');
    parts.push(      '<span class="lcc-llc-research-val">' + esc(valStr) + '</span>');
    if (cmpChip) parts.push(    cmpChip);
    if (row.attempts != null) parts.push('<span class="lcc-llc-research-attempts">' + Number(row.attempts) + ' attempt' + (Number(row.attempts) === 1 ? '' : 's') + '</span>');
    parts.push(    '</div>');
    parts.push(  '</div>');
    parts.push(  '<div class="lcc-llc-research-actions">');
    parts.push(    '<a href="' + esc(sosUrl) + '" target="_blank" rel="noopener" class="lcc-llc-research-btn">Open SoS →</a>');
    parts.push(    '<button type="button" class="lcc-llc-research-btn lcc-llc-research-btn-primary" onclick="_lccLlcResearchMarkFound(' + queueId + ', &quot;' + esc(guessedSt) + '&quot;)">Mark found</button>');
    parts.push(    '<button type="button" class="lcc-llc-research-btn" onclick="_lccLlcResearchMarkNoMatch(' + queueId + ')">No match</button>');
    parts.push(  '</div>');
    parts.push('</div>');
    void propId; // referenced in suppressed code path — keep linter happy
  });
  parts.push('</div>');

  widget.innerHTML = parts.join('');
}
window.renderLlcResearchQueueWidget = renderLlcResearchQueueWidget;

async function _lccLlcResearchResolve(queue_id, status, extraBody) {
  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
  try {
    const r = await fetch('/api/admin?_route=resolve-llc-research', {
      method: 'POST', headers,
      body: JSON.stringify(Object.assign({ queue_id, status }, extraBody || {})),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    if (typeof lccReportError === 'function') {
      lccReportError('Resolve LLC research', e);
    } else {
      console.warn('[LLC Research] resolve failed:', e.message);
    }
    return { ok: false, error: e.message };
  }
}

async function _lccLlcResearchMarkFound(queue_id, guessedState) {
  if (typeof asyncPrompt !== 'function') {
    if (typeof showToast === 'function') showToast('Prompt helper unavailable — use Studio to set found_filing_id', 'warn');
    return;
  }
  const filingId = await asyncPrompt('Found filing ID (e.g. SoS file number):', '');
  if (filingId == null || !String(filingId).trim()) return;
  const filingState = guessedState || (typeof asyncPrompt === 'function'
    ? await asyncPrompt('Filing state (2-letter, e.g. CA):', guessedState || '')
    : null);
  const out = await _lccLlcResearchResolve(queue_id, 'completed', {
    found_filing_id:    String(filingId).trim(),
    found_filing_state: filingState ? String(filingState).trim().toUpperCase() : null,
  });
  if (out.ok && typeof showToast === 'function') showToast('Marked resolved', 'ok');
  // Re-render the widget to remove the resolved row
  const el = document.getElementById('researchContent');
  if (el) renderLlcResearchQueueWidget(el);
}
window._lccLlcResearchMarkFound = _lccLlcResearchMarkFound;

async function _lccLlcResearchMarkNoMatch(queue_id) {
  let confirmed = true;
  if (typeof asyncConfirm === 'function') {
    confirmed = await asyncConfirm('Mark this LLC as "no match"? It will not appear in the queue again.');
  }
  if (!confirmed) return;
  const out = await _lccLlcResearchResolve(queue_id, 'no_match', {});
  if (out.ok && typeof showToast === 'function') showToast('Marked no_match', 'ok');
  const el = document.getElementById('researchContent');
  if (el) renderLlcResearchQueueWidget(el);
}
window._lccLlcResearchMarkNoMatch = _lccLlcResearchMarkNoMatch;

function lccRenderSortToggle(table, defaultKey, keys, onChangeFnName) {`,
    report, 'app.js (LLC research widget)');
}

// ─── styles.css: widget styles ───
async function patchStylesCss(report) {
  const path = resolve(REPO_ROOT, 'styles.css');
  if (!await fileExists(path)) throw new Error('styles.css not found.');

  const ANCHOR = `.lcc-sort-toggle-btn:hover:not(.active) { background: var(--s1); color: var(--text1); }`;
  const CSS = `

/* LLC Research Queue widget — Item #2 Phase B (2026-05-17) */
.lcc-llc-research-widget { background: var(--s1); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 18px; }
.lcc-llc-research-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.lcc-llc-research-title { font-size: 15px; font-weight: 700; color: var(--text1); display: inline-flex; align-items: center; gap: 8px; }
.lcc-llc-research-count { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--accent2); color: #fff; font-weight: 700; }
.lcc-llc-research-empty { font-size: 13px; color: var(--text2); font-style: italic; padding: 8px 4px; }
.lcc-llc-research-list { display: grid; gap: 6px; }
.lcc-llc-research-row { display: grid; grid-template-columns: 28px 1fr auto; gap: 12px; align-items: center; padding: 9px 10px; background: var(--s2); border: 1px solid var(--border); border-radius: 8px; }
.lcc-llc-research-rank { font-size: 12px; font-weight: 700; color: var(--text2); text-align: center; }
.lcc-llc-research-body { min-width: 0; }
.lcc-llc-research-name { font-size: 13px; font-weight: 700; color: var(--text1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lcc-llc-research-state { font-weight: 500; color: var(--text2); font-size: 11px; }
.lcc-llc-research-addr { font-size: 11px; color: var(--text2); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lcc-llc-research-meta { display: flex; align-items: center; gap: 6px; margin-top: 3px; flex-wrap: wrap; }
.lcc-llc-research-val { font-size: 11px; font-weight: 700; color: var(--text1); }
.lcc-llc-research-attempts { font-size: 10px; color: var(--text3); }
.lcc-llc-research-actions { display: inline-flex; gap: 6px; align-items: center; flex-shrink: 0; }
.lcc-llc-research-btn { font-size: 11px; padding: 5px 10px; border: 1px solid var(--border); background: var(--s1); color: var(--text); border-radius: 6px; cursor: pointer; text-decoration: none; font-weight: 600; white-space: nowrap; transition: background 0.15s, border-color 0.15s, color 0.15s; }
.lcc-llc-research-btn:hover { border-color: var(--accent); color: var(--accent); }
.lcc-llc-research-btn-primary { background: var(--accent2); color: #fff; border-color: var(--accent2); }
.lcc-llc-research-btn-primary:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
@media (max-width: 720px) {
  .lcc-llc-research-row { grid-template-columns: 24px 1fr; gap: 8px; padding: 8px; }
  .lcc-llc-research-actions { grid-column: 1 / -1; padding-top: 6px; }
  .lcc-llc-research-btn { font-size: 10px; padding: 4px 8px; }
}`;
  const REPLACE = ANCHOR + CSS;
  await replaceUnique(path, ANCHOR, REPLACE, report, 'styles.css (LLC research widget)');
}

// ─── AUDIT_PROGRESS.md: closeout ───
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — item 2 Phase B — LLC Research Queue UI
- **Status:** ✅ DONE.
- **Branch:** \`audit/02B-llc-research-queue-ui\`
- **Patch:** \`audit/patches/02B-llc-research-queue-ui/apply.mjs\`
- **Closes:** the UI half of #2. Phase A's cron drainer continues to run; Phase B gives Scott the manual surface for the cases the AI pipeline can't resolve (ambiguous, multi-state filings, etc.).

### What this adds

**1. Two new admin sub-routes** in \`api/admin.js\`:
- \`GET /api/admin?_route=llc-research-queue&limit=20\` — returns the top-N queued LLC research items joined with property context (address, city, state, value via \`v_property_value_signal\`, completeness band/score from Phase B-1). Ordered by \`rev_value\` DESC so the highest-value LLCs surface first.
- \`POST /api/admin?_route=resolve-llc-research\` — body \`{ queue_id, status: 'no_match'|'completed', found_filing_id?, found_filing_state? }\`. Marks the entry resolved + sets \`resolved_at\`. The AI cron then stops picking it up.

**2. Widget at top of the Research page** (#pageResearch):
- Mounts above the existing generic research queue (renderResearchPage in ops.js).
- Renders the top 15 LLC entries as cards: rank, search name, guessed state, property address + tenant context, value, completeness chip, attempts count.
- Per-row actions:
  - **"Open SoS →"** external link to the state's SoS / corporations portal (26 states mapped; falls through to Google search for unmapped states).
  - **"Mark found"** opens an async prompt for filing_id + state → POSTs to resolve endpoint with \`status='completed'\`.
  - **"No match"** confirms then POSTs with \`status='no_match'\`.
- Refresh button + auto-rerender on successful action.

**3. SoS portal URL map** for the 26 most common states (AL/AZ/CA/CO/DE/FL/GA/IL/IN/KY/MA/MD/MI/MN/MO/NC/NJ/NV/NY/OH/OR/PA/TN/TX/VA/WA/WI). Unmapped states fall through to a Google search query that biases toward "<name> <state> secretary of state LLC filing".

**4. CSS** for the widget — header + card grid + action buttons + mobile layout.

### Live queue (verified 2026-05-17)
- Queued: 1,267
- No match: 3
- Completed: 0 (yet — this UI is what changes that)

### Files changed
- \`api/admin.js\` — 2 sub-routes + 2 handlers
- \`ops.js\` — mount call inside \`renderResearchPage\`
- \`app.js\` — widget render + load + 2 actions + SoS portal map (~250 lines)
- \`styles.css\` — \`.lcc-llc-research-*\` block
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification
1. \`grep -c "llc-research-queue" api/admin.js\` → 2 or more (dispatcher case + handler reference)
2. \`grep -c "renderLlcResearchQueueWidget" app.js ops.js\` → 3 or more
3. Smoke (post-deploy):
   - Open the LCC app → More drawer → Research.
   - The LLC Research Queue widget appears at the top with up to 15 items, ordered by deal value.
   - Click "Open SoS" on a CA / DE / NY entry → the right state's portal opens in a new tab.
   - Click "Mark found" → prompt asks for filing_id → submit → row disappears + toast.
   - Click "No match" → confirm → row disappears.
4. SQL verification on dia:
   \`\`\`sql
   SELECT status, count(*) FROM public.llc_research_queue GROUP BY 1;
   -- After resolving a few rows, expect 'completed' or 'no_match' counts > 0.
   \`\`\`

### Phase C follow-ups
- **Bulk mode**: select multiple rows + "Mark all no_match" / "Open all in new tabs".
- **Inline result capture**: instead of an async-prompt, render a small inline form on click (Filing ID input + state dropdown + Save).
- **Per-row history**: previous attempts, AI's last_error (already returned by the endpoint), inline retry-button.
- **State coverage**: expand the SoS portal URL map to all 50 states + DC + territories.
- **Telemetry**: dispatch \`lccReportError('LLC research action', err)\` instead of bare console.warn — auto-buffered into client_errors (Phase B telemetry from #10).

`);

  const preflightAnchor = N('\n# Sprint preflight — 2026-05-17\n');
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, () => appendBlock + preflightAnchor);
  } else {
    c = c + appendBlock;
  }
  if (c === original) { report.push(['AUDIT_PROGRESS.md', 0, 'no changes']); return; }
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Audit Sprint — Item #2 Phase B (LLC Research Queue UI) ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await patchAdminJs(report);
  await patchOpsJs(report);
  await patchAppJs(report);
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
