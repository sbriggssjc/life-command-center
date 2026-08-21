// ─────────────────────────────────────────────────────────────────────────────
// ops-domain-health.js — W6.5 Stage 4, Unit 3 (extracted from ops.js
// 2026-08-20). Moved VERBATIM from ops.js lines 6185-6344.
//
// B8 Domain Health Summary — the side-by-side dia + gov health/completeness
// panel: _opsTrendSeries (a v_data_health_trend series picker used only here)
// and renderDomainHealthSummary.
//
// ⚠️ THE REGION WAS SPLIT ON PURPOSE. THREE HELPERS SIT UNDER THE B8 BANNER AND
// ONLY ONE OF THEM IS B8 CODE:
//
//   _opsSparkline    (ops.js ~6157) — STAYS. It is a CROSS-FILE SHARED helper:
//                    detail.js references it 7 times to draw the dialysis Ops
//                    tab's patient-census chart. Filing it under "domain health"
//                    would make a dialysis property panel depend on a module
//                    named for an unrelated admin view. This exact function has
//                    already caused one silent production bug (detail.js used to
//                    define a rival _opsSparkline(history) that ops.js silently
//                    overrode, so the census chart rendered the literal string
//                    "no trend" on every property for months) — it has earned
//                    being left somewhere obvious rather than tucked into a
//                    feature module.
//   metricCardHTML   (ops.js ~6137) — STAYS. 28 call sites across ops.js from
//                    line 1724 onward; it is above the banner and shared.
//   _opsTrendSeries  (here) — travels. Two references, both B8.
//
// The B8 banner itself stays in ops.js, where it now heads _opsSparkline. That
// is honest about where the code is, rather than tidy about where a banner is.
//
// STAGE-4 RULE: declares only functions; no top-level statement reads ops.js's
// shared state header (45-126) at eval time.
// ─────────────────────────────────────────────────────────────────────────────

// Pull last-30-day series for a single metric out of v_data_health_trend
// rows. trendRows have shape [{day, view_name, payload, ...}]. Selects
// matching view_name + extracts payload[metricKey] over time (asc).
function _opsTrendSeries(trendRows, viewName, metricKey) {
  if (!Array.isArray(trendRows)) return [];
  return trendRows
    .filter(r => r && r.view_name === viewName)
    .sort((a, b) => String(a.day).localeCompare(String(b.day)))
    .map(r => {
      const v = r.payload && r.payload[metricKey];
      const n = v == null ? null : Number(v);
      return Number.isFinite(n) ? n : null;
    });
}

async function renderDomainHealthSummary() {
  const host = document.getElementById('domainHealthSummary');
  if (!host) return;
  if (typeof diaQuery !== 'function' || typeof govQuery !== 'function') {
    host.innerHTML = '<div class="widget"><div class="widget-title">Domain Health Summary</div><div class="ops-empty">diaQuery / govQuery helper not loaded</div></div>';
    return;
  }

  // Parallel pulls. Each helper has slightly different return shape:
  //   diaQuery returns the array directly
  //   govQuery returns {data: [...]}
  const unwrap = (r) => Array.isArray(r) ? r : (r && Array.isArray(r.data) ? r.data : []);
  const [
    diaSales, diaOwn, diaEnt, diaComp, diaSf, diaTrend,
    govSales, govOwn, govEnt, govComp, govSf, govTrend,
  ] = await Promise.all([
    diaQuery('v_data_health_sales', '*', { limit: 1 }),
    diaQuery('v_data_health_ownership', '*', { limit: 1 }),
    diaQuery('v_data_health_entities', '*', { limit: 1 }),
    diaQuery('v_sales_completeness_summary', '*', { limit: 1 }),
    diaQuery('v_sf_link_queue_summary', 'status,n', { limit: 20 }),
    diaQuery('v_data_health_trend', 'day,view_name,payload',
      { order: 'day.asc', limit: 200 }),
    govQuery('v_data_health_sales', '*', { limit: 1 }),
    govQuery('v_data_health_ownership', '*', { limit: 1 }),
    govQuery('v_data_health_entities', '*', { limit: 1 }),
    govQuery('v_sales_completeness_summary', '*', { limit: 1 }),
    govQuery('v_sf_link_queue_summary', 'status,n', { limit: 20 }),
    govQuery('v_data_health_trend', 'day,view_name,payload',
      { order: 'day.asc', limit: 200 }),
  ]);

  const ds  = unwrap(diaSales)[0]  || {};
  const doh = unwrap(diaOwn)[0]    || {};
  const de  = unwrap(diaEnt)[0]    || {};
  const dc  = unwrap(diaComp)[0]   || {};
  const dt  = unwrap(diaTrend);
  const gs  = unwrap(govSales)[0]  || {};
  const goh = unwrap(govOwn)[0]    || {};
  const ge  = unwrap(govEnt)[0]    || {};
  const gc  = unwrap(govComp)[0]   || {};
  const gt  = unwrap(govTrend);

  // SF-link queue rollup. v_sf_link_queue_summary returns one row per
  // status with column `n` (server-side aggregated to avoid pulling all
  // 30K queue rows on every page-load).
  const sfCount = (rows) => {
    const c = { queued: 0, in_progress: 0, linked: 0, needs_review: 0, no_match: 0, failed: 0, unsupported: 0 };
    for (const r of unwrap(rows)) {
      if (r && r.status && c.hasOwnProperty(r.status)) c[r.status] = Number(r.n) || 0;
    }
    return c;
  };
  const dsf = sfCount(diaSf);
  const gsf = sfCount(govSf);
  const sfTotal = (c) => c.queued + c.in_progress + c.linked + c.needs_review + c.no_match + c.failed;

  // Pick out 30d series for the key metrics from v_data_health_trend.
  // Available payload keys (from migration): sales_live, duplicate_groups_live,
  // sales_needs_review, redundant_owner_rows, pct_property_to_recorded_owner.
  const trendOf = (rows, view, key) => _opsTrendSeries(rows, view, key);

  // Render — three rows of cards (Sales, Ownership, Entities + SF link),
  // each with side-by-side dia/gov values + a 30d sparkline below the value.
  const num = (v) => v == null || v === '' ? '—' : Number(v).toLocaleString();
  const pct = (v) => v == null || v === '' ? '—' : (Number(v).toFixed(1) + '%');
  const pctOf = (n, d) => (d > 0 ? (100 * n / d).toFixed(1) + '%' : '—');

  // Mini card builder: a single domain's value + sparkline for one metric.
  const cellHTML = (value, sparkSeries, sub) => `
    <div style="display:flex;flex-direction:column;gap:2px">
      <div style="font-size:18px;font-weight:600;line-height:1.1">${value}</div>
      <div>${_opsSparkline(sparkSeries)}</div>
      <div style="font-size:11px;color:var(--text2)">${sub || ''}</div>
    </div>`;

  const rowHTML = (label, diaCell, govCell) => `
    <div style="display:grid;grid-template-columns:170px 1fr 1fr;gap:12px;padding:10px 12px;border-bottom:1px solid var(--border)">
      <div style="font-weight:500;color:var(--text2);align-self:center">${label}</div>
      <div>${diaCell}</div>
      <div>${govCell}</div>
    </div>`;

  let html = '<div class="widget"><div class="widget-title">Domain Health Summary <span style="font-weight:400;color:var(--text2);font-size:12px">— values today, sparkline = last 30d</span></div>';
  html += `<div style="display:grid;grid-template-columns:170px 1fr 1fr;gap:12px;padding:10px 12px;border-bottom:2px solid var(--border);font-size:12px;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:0.5px">
    <div>Metric</div><div>Dialysis</div><div>Government</div>
  </div>`;

  // ── Sales
  html += rowHTML('Live sales',
    cellHTML(num(ds.sales_live), trendOf(dt, 'v_data_health_sales', 'sales_live'), 'curated sales rows'),
    cellHTML(num(gs.sales_live), trendOf(gt, 'v_data_health_sales', 'sales_live'), 'curated sales rows'));
  html += rowHTML('Sales completeness',
    cellHTML((dc.avg_score == null ? '—' : Number(dc.avg_score).toFixed(1)) + ' avg',
             trendOf(dt, 'v_sales_completeness_summary', 'avg_score'),
             `median ${dc.p50_score ?? '—'} · ${dc.perfect ?? 0} perfect · ${dc.critical_lt_40 ?? 0} critical`),
    cellHTML((gc.avg_score == null ? '—' : Number(gc.avg_score).toFixed(1)) + ' avg',
             trendOf(gt, 'v_sales_completeness_summary', 'avg_score'),
             `median ${gc.p50_score ?? '—'} · ${gc.perfect ?? 0} perfect · ${gc.critical_lt_40 ?? 0} critical`));
  html += rowHTML('Needs-review sales',
    cellHTML(num(ds.sales_needs_review), trendOf(dt, 'v_data_health_sales', 'sales_needs_review'), 'awaiting triage'),
    cellHTML(num(gs.sales_needs_review), trendOf(gt, 'v_data_health_sales', 'sales_needs_review'), 'awaiting triage'));
  html += rowHTML('Live dupe groups',
    cellHTML(num(ds.duplicate_groups_live), trendOf(dt, 'v_data_health_sales', 'duplicate_groups_live'), 'should be 0 (C1+C4)'),
    cellHTML(num(gs.duplicate_groups_live), trendOf(gt, 'v_data_health_sales', 'duplicate_groups_live'), 'should be 0 (C1+C4)'));

  // ── Ownership
  html += rowHTML('Property → recorded_owner',
    cellHTML(pct(doh.pct_property_to_recorded_owner),
             trendOf(dt, 'v_data_health_ownership', 'pct_property_to_recorded_owner'),
             `${num(doh.prop_with_recorded_owner)} of ${num(doh.prop_total)}`),
    cellHTML(pct(goh.pct_property_to_recorded_owner),
             trendOf(gt, 'v_data_health_ownership', 'pct_property_to_recorded_owner'),
             `${num(goh.prop_with_recorded_owner)} of ${num(goh.prop_total)}`));
  html += rowHTML('Ownership history (active)',
    cellHTML(num(doh.oh_active), trendOf(dt, 'v_data_health_ownership', 'oh_active'),
             `${num(doh.oh_superseded)} superseded · ${num(doh.oh_orphan)} orphans`),
    cellHTML(num(goh.oh_active), trendOf(gt, 'v_data_health_ownership', 'oh_active'),
             `${num(goh.oh_superseded)} superseded · ${num(goh.oh_orphan)} orphans`));

  // ── Entities
  html += rowHTML('Recorded owners',
    cellHTML(num(de.total_recorded_owners), [],
             `${num(de.redundant_owner_groups)} redundant groups (${num(de.redundant_owner_rows)} rows)`),
    cellHTML(num(ge.total_recorded_owners), [],
             `${num(ge.redundant_owner_groups)} redundant groups (${num(ge.redundant_owner_rows)} rows)`));
  html += rowHTML('True owners',
    cellHTML(num(de.total_true_owners), [], 'canonical owners'),
    cellHTML(num(ge.total_true_owners), [], 'canonical owners'));

  // ── SF link (A7)
  const sfCellHTML = (c) => {
    const total = sfTotal(c);
    const linkedPct = total > 0 ? Math.round(100 * c.linked / total) : 0;
    const tone = c.queued > 100 ? 'red' : c.queued > 10 ? 'yellow' : 'green';
    return `<div style="display:flex;flex-direction:column;gap:2px">
      <div style="font-size:18px;font-weight:600;line-height:1.1" class="${tone}">${num(c.linked)}<span style="font-size:13px;font-weight:400;color:var(--text2)"> / ${num(total)} (${linkedPct}%)</span></div>
      <div style="font-size:11px;color:var(--text2)">queued ${c.queued} · review ${c.needs_review} · no_match ${c.no_match} · failed ${c.failed}</div>
    </div>`;
  };
  html += rowHTML('SF-link backfill (A7)', sfCellHTML(dsf), sfCellHTML(gsf));

  html += '</div>';
  host.innerHTML = html;
}
