// ============================================================================
// Capital Markets API — Cross-vertical reporting backend
// Life Command Center — Capital Markets Phase 1 (gov slice live)
//
// GET  /api/capital-markets?action=verticals
//        → cm_verticals registry list (LCC Opps)
// GET  /api/capital-markets?action=subspecialties&vertical_id=
//        → cm_subspecialties for a vertical
// GET  /api/capital-markets?action=catalog
//        → cm_chart_catalog (chart_template_id contract)
// GET  /api/capital-markets?action=brand
//        → cm_brand_tokens key/value map
// GET  /api/capital-markets?action=broker_patterns
//        → cm_nm_broker_patterns (LCC Opps copy — master list)
//
// GET  /api/capital-markets?action=quarterly&vertical=&as_of=&subspecialty=
//        → all chart-template results for a vertical/quarter
// GET  /api/capital-markets?action=chart&vertical=&chart_template_id=&subspecialty=
//        → single chart's full timeseries
//
// POST /api/capital-markets?action=add_broker_pattern
//        → INSERT into cm_nm_broker_patterns (LCC Opps)
// POST /api/capital-markets?action=refresh_nm_attribution&vertical=gov
//        → call cm_gov_refresh_nm_attribution() RPC after pattern edits
//
// GET  /api/capital-markets?action=export&vertical=&format=xlsx|pdf|png   [Phase 2]
// POST /api/capital-markets?action=rca_import
//        body: { filename, file_b64, product_type?, notes? }
//        → parses RCA TrendTracker .xls export, upserts cm_rca_quarterly
// GET  /api/capital-markets?action=copilot_stat
//        params: vertical, chart_template_id, as_of?, subspecialty?
//        → one-line headline stat ("Gov-leased TTM weighted cap is 7.47% as of
//          2024-Q2; up 32 bps YoY.") for pasting into Outlook drafts. See
//          api/_shared/cm-stat-recipes.js for supported template IDs.
// GET  /api/capital-markets?action=copilot_stat_catalog
//        → list of chart_template_ids that have a stat recipe
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, requireOps, withErrorHandler } from './_shared/ops-db.js';
import { domainQuery } from './_shared/domain-db.js';
import { buildCapitalMarketsWorkbook, exportFilename } from './_shared/cm-excel-export.js';
import { parseRcaExport, normalizeProductType, VALID_PRODUCT_TYPES } from './_shared/rca-parser.js';
import { composeStat, listSupportedTemplates as listSupportedStatTemplates } from './_shared/cm-stat-recipes.js';
import { buildVolumeCapSummary, joinVolumeCapQuartile } from './_shared/cm-summary-table.js';
import { renderChartsToImages } from './_shared/cm-chart-image-renderer.js';
import { buildDialysisMasterWorkbook } from './_shared/cm-template-loader.js';

// ---------------------------------------------------------------------------
// Synthetic chart_templates — composed from other templates' rows rather than
// fetched from a single view. view_name_template uses the prefix
// '__synthetic__:<recipe_id>' to signal to the dispatcher.
//
// composer({ vertical, subspecialty, asOf, allCharts }) → row array
// allCharts is the array of fully-fetched, non-synthetic charts in this batch.
// ---------------------------------------------------------------------------
const SYNTHETIC_COMPOSERS = {
  'volume_cap_summary': ({ asOf, allCharts }) => {
    const find = (id) => allCharts.find((c) => c.chart_template_id === id)?.rows || [];
    return buildVolumeCapSummary({
      volumeRows:   find('volume_ttm_by_quarter'),
      capRows:      find('cap_rate_ttm_by_quarter'),
      quartileRows: find('cap_rate_top_bottom_quartile'),
      asOf: asOf || null,
    });
  },
  'volume_cap_quartile_combo': ({ allCharts }) => {
    const find = (id) => allCharts.find((c) => c.chart_template_id === id)?.rows || [];
    return joinVolumeCapQuartile({
      volumeRows:   find('volume_ttm_by_quarter'),
      capRows:      find('cap_rate_ttm_by_quarter'),
      quartileRows: find('cap_rate_top_bottom_quartile'),
    });
  },

  // Round 2b — Pace of Cap Rate Expansion (dialysis PDF p.24, gov p.~).
  // Computes month-over-month cap-rate delta (annualized × 12) for both
  // the all-cohort TTM avg and the 10+ Year Term cohort. Renders as a
  // 2-bar (overlapping) chart. Treasury delta line is deferred until
  // monthly treasury data is available.
  //
  // Inputs (master_m-mapped via the per-vertical monthly mapper):
  //   cap_rate_ttm_by_quarter  → ttm_weighted_cap_rate (avg cap, TTM)
  //   cap_rate_by_lease_term   → cap_10plus           (10+ cap cohort, TTM)
  'pace_of_cap_rate_expansion': ({ allCharts }) => {
    // Round 16 — formula reworked per user spec:
    //   "It should just be the nominal year over year change of cap rates
    //    and cost of capital (7.00% cap a year ago, 6.50% cap today
    //    should show a 50 basis point compression for the current month)."
    //
    // Old formula computed annualized MoM deltas (curr - prev_month) × 12,
    // which over-amplified short-term wobble and didn't match the PDF
    // deck. New formula is curr - lag(12), the nominal YoY bps movement.
    //
    // Added a third series: cost-of-capital YoY change (using
    // mortgage_30y_rate from master_m's macro join).
    const find = (id) => allCharts.find((c) => c.chart_template_id === id)?.rows || [];
    const capRows = find('cap_rate_ttm_by_quarter');
    const termRows = find('cap_rate_by_lease_term');
    const costRows = find('cost_of_capital');
    if (capRows.length === 0 && termRows.length === 0) return [];

    const byPeriod = new Map();
    for (const r of capRows) {
      const k = r.period_end;
      if (!byPeriod.has(k)) byPeriod.set(k, { period_end: k });
      byPeriod.get(k).avg_cap = r.ttm_weighted_cap_rate ?? r.avg_cap_rate;
    }
    for (const r of termRows) {
      const k = r.period_end;
      if (!byPeriod.has(k)) byPeriod.set(k, { period_end: k });
      // R44 — pace_core uses the "long-term cohort" cap rate. Gov's long-
      // term cohort is 10+ year (cap_10plus); dia's is 12+ year (cap_12plus).
      // The original recipe only looked for cap_10plus, so pace_core was
      // always null for dia. Fall back to cap_12plus when the 10+ key is
      // missing.
      byPeriod.get(k).cap_10plus = r.cap_10plus ?? r.cap_10plus_year ?? r.cap_12plus;
    }
    for (const r of costRows) {
      const k = r.period_end;
      if (!byPeriod.has(k)) byPeriod.set(k, { period_end: k });
      // cost_of_capital mapper emits treasury_10y_yield + avg_cap_rate;
      // we want the cost-of-capital indicator (mortgage rate) for the
      // YoY-change series. Fall back to treasury_10y_yield if mortgage
      // not present.
      byPeriod.get(k).cost_capital = r.mortgage_30y_rate ?? r.treasury_10y_yield;
      // R45 — for dia, cap_rate_by_lease_term isn't in the catalog
      // (applies_to_verticals=['gov']), so termRows above is always
      // empty and cap_10plus is never set. cost_of_capital IS in the
      // dia catalog and its master_m mapper emits cap_10plus_year
      // (line ~1057 — dia master_m has cap_10plus_year populated on
      // 264 of 303 monthly rows). Use it as a fallback source.
      if (byPeriod.get(k).cap_10plus == null && r.cap_10plus_year != null) {
        byPeriod.get(k).cap_10plus = r.cap_10plus_year;
      }
    }

    const sorted = [...byPeriod.values()].sort((a, b) =>
      String(a.period_end) < String(b.period_end) ? -1 : 1
    );
    if (sorted.length < 13) return [];

    // Detect cadence: monthly (≈30 days apart) → lag 12; quarterly (≈90) → lag 4.
    const t0 = new Date(sorted[0].period_end).getTime();
    const t1 = new Date(sorted[1].period_end).getTime();
    const diffDays = Math.abs(t1 - t0) / 86400000;
    const yoyLag = diffDays < 60 ? 12 : 4;

    const out = [];
    for (let i = yoyLag; i < sorted.length; i++) {
      const prev = sorted[i - yoyLag], curr = sorted[i];
      // Round 70 A2 — emit the YoY pace in BASIS POINTS (× 10000) per Scott's
      // spec ("6.50% vs 6.75% -> +25bps"). 0.0675 - 0.0650 = 0.0025 -> 25 bps.
      // pace_all/core/cost are consumed only by the pace_of_cap_rate_expansion
      // chart (all three surfaces format as integer bps). Nulls preserved
      // (JS `null * 10000` would be 0 — guarded by the ternary).
      const pace_all = (curr.avg_cap != null && prev.avg_cap != null)
        ? (Number(curr.avg_cap) - Number(prev.avg_cap)) * 10000
        : null;
      const pace_core = (curr.cap_10plus != null && prev.cap_10plus != null)
        ? (Number(curr.cap_10plus) - Number(prev.cap_10plus)) * 10000
        : null;
      const pace_cost = (curr.cost_capital != null && prev.cost_capital != null)
        ? (Number(curr.cost_capital) - Number(prev.cost_capital)) * 10000
        : null;
      out.push({ period_end: curr.period_end, pace_all, pace_core, pace_cost });
    }
    return out;
  },

  // Round 3c — Buyer_Pool_Monthly_Count (PDF dialysis p.27). Stacked
  // monthly bars with Private/Institutional-Fund/REIT counts.
  //
  // Round 24 — Round 15 fix referenced `buyer_pool_breakdown` which
  // doesn't exist as a chart_template_id in the catalog (the master_m
  // mapper writes those fields but only when a chart with that ID is
  // built — and one never is). Read directly from masterMonthlyRows
  // instead, which already has private_count / institutional_count /
  // reit_count / cross_border_count columns.
  'buyer_pool_monthly_count': ({ masterMonthlyRows }) => {
    if (!Array.isArray(masterMonthlyRows) || !masterMonthlyRows.length) return [];
    return masterMonthlyRows.map((r) => ({
      period_end: r.period_end,
      private_count:        r.private_count != null        ? Number(r.private_count)        : 0,
      institutional_count:  r.institutional_count != null  ? Number(r.institutional_count)  : 0,
      reit_count:           r.reit_count != null           ? Number(r.reit_count)           : 0,
      cross_border_count:   r.cross_border_count != null   ? Number(r.cross_border_count)   : 0,
    }));
  },

  // Round 4b — Available_by_Tenant donuts (PDF dialysis p.32). Both
  // donuts source from cm_dialysis_available_by_tenant for the LATEST
  // period_end. Composer pulls existing chart rows and reshapes for
  // a single-period 4-segment donut.
  'available_by_tenant_count_donut': ({ allCharts }) => {
    const find = (id) => allCharts.find((c) => c.chart_template_id === id)?.rows || [];
    const tenantRows = find('available_by_tenant');
    if (!tenantRows.length) return [];
    // Pick the latest period_end
    const latestPeriod = tenantRows
      .map(r => r.period_end)
      .filter(Boolean)
      .sort()
      .reverse()[0];
    const latest = tenantRows
      .filter(r => r.period_end === latestPeriod)
      .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
    return latest.map(r => ({
      tenant: r.tenant,
      count_active: Number(r.count_active) || 0,
      period_end: r.period_end,
    }));
  },
  'available_by_tenant_volume_donut': ({ allCharts }) => {
    const find = (id) => allCharts.find((c) => c.chart_template_id === id)?.rows || [];
    const tenantRows = find('available_by_tenant');
    if (!tenantRows.length) return [];
    const latestPeriod = tenantRows
      .map(r => r.period_end)
      .filter(Boolean)
      .sort()
      .reverse()[0];
    const latest = tenantRows
      .filter(r => r.period_end === latestPeriod)
      .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
    return latest.map(r => ({
      tenant: r.tenant,
      volume_available: Number(r.volume_available) || 0,
      period_end: r.period_end,
    }));
  },

  // Round 4c — Available_by_Term Summary (PDF dialysis p.30 bottom).
  // Combo: 4 grouped Avg Price bars + 4 cap-stat dot series
  // (Avg / Upper Q / Median / Lower Q) per lease-term cohort.
  // Round 32 split this into 2 charts; Round 33 reverted to the
  // combined layout per user feedback ("Missing all cap rate data"
  // + "remove the n=2 from the labels").
  'available_by_term_summary': ({ allCharts }) => {
    const find = (id) => allCharts.find((c) => c.chart_template_id === id)?.rows || [];
    const termRows = find('available_by_term_bucket');
    if (!termRows.length) return [];
    const latestPeriod = termRows
      .map(r => r.period_end)
      .filter(Boolean)
      .sort()
      .reverse()[0];
    const latest = termRows
      .filter(r => r.period_end === latestPeriod)
      .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
    // T10 — keep ALL buckets (incl. "Undisclosed Term") in the row stream so the
    // data tab + caption still carry its count for reconciliation; the chart
    // BUILDERS drop only the Undisclosed BAR (renderer filters, injector trims the
    // trailing Undisclosed row from the plotted cell range). sort_order keeps
    // Undisclosed last, so the injector's dataEnd-1 trim is exact.
    return latest.map(r => ({
      term_bucket: r.term_bucket,
      n_listings: Number(r.n_listings) || 0,
      avg_price: r.avg_price != null ? Number(r.avg_price) : null,
      avg_cap: r.avg_cap != null ? Number(r.avg_cap) : null,
      upper_quartile_cap: r.upper_quartile_cap != null ? Number(r.upper_quartile_cap) : null,
      median_cap: r.median_cap != null ? Number(r.median_cap) : null,
      lower_quartile_cap: r.lower_quartile_cap != null ? Number(r.lower_quartile_cap) : null,
      period_end: r.period_end,
    }));
  },

  // Round 3b — Quarterly_Volume_Bars (PDF dialysis p.21 bottom chart, gov
  // ~p.12). Distinct from volume_ttm_by_quarter which is a TTM rolling line;
  // this one is the quarter's own transaction volume as a bar.
  // Source: cm_<vertical>_market_quarterly (the per-quarter aggregator
  // already computes quarterly_volume + quarterly_count). We pull from the
  // existing volume_ttm_by_quarter chart's row stream because it carries
  // both ttm and per-quarter fields after Round GD1 fixes.
  'quarterly_volume_bars': ({ allCharts, masterMonthlyRows }) => {
    // Round 24 — Read from masterMonthlyRows first (has quarterly_volume
    // + quarterly_count on every row). Fall back to volume_ttm_by_quarter
    // when master_m isn't loaded. User reported the tab as blank again
    // — root cause was that volume_ttm_by_quarter wrapper view returns
    // only ttm columns (no quarterly_*), so the old find() never matched.
    const byPeriod = new Map();
    if (Array.isArray(masterMonthlyRows) && masterMonthlyRows.length) {
      for (const r of masterMonthlyRows) {
        const qv = r.quarterly_volume ?? r.volume_quarter ?? r.volume_dollars_quarterly;
        if (qv == null) continue;
        byPeriod.set(r.period_end, {
          period_end: r.period_end,
          quarterly_volume: Number(qv),
          quarterly_count: r.quarterly_count ?? r.count_quarter ?? null,
        });
      }
    }
    if (byPeriod.size === 0) {
      const find = (id) => allCharts.find((c) => c.chart_template_id === id)?.rows || [];
      const volRows = find('volume_ttm_by_quarter');
      for (const r of volRows) {
        const qv = r.quarterly_volume ?? r.volume_quarterly ?? r.volume_quarter
                    ?? r.volume_dollars_quarterly;
        if (qv == null) continue;
        byPeriod.set(r.period_end, {
          period_end: r.period_end,
          quarterly_volume: Number(qv),
          quarterly_count: r.quarterly_count ?? r.count_quarter ?? null,
        });
      }
    }
    return [...byPeriod.values()].sort((a, b) =>
      String(a.period_end) < String(b.period_end) ? -1 : 1
    );
  },

  // Round 20 — Trans Count + Avg Deal Size combo (master deck p.8/p.17).
  // Synth composer joins transaction_count_ttm and avg_deal_size charts
  // by period_end so the renderer can build a single combo (bars + line).
  'txn_count_avg_deal_combo': ({ allCharts }) => {
    const find = (id) => allCharts.find((c) => c.chart_template_id === id)?.rows || [];
    const txnRows = find('transaction_count_ttm');
    const avgRows = find('avg_deal_size');
    if (txnRows.length === 0 && avgRows.length === 0) return [];
    const byPeriod = new Map();
    for (const r of txnRows) {
      const k = r.period_end;
      if (!byPeriod.has(k)) byPeriod.set(k, { period_end: k });
      // master_m mapper emits `ttm_count`; raw _q view emits `transaction_count_ttm`
      byPeriod.get(k).ttm_count = r.ttm_count ?? r.transaction_count_ttm;
    }
    for (const r of avgRows) {
      const k = r.period_end;
      if (!byPeriod.has(k)) byPeriod.set(k, { period_end: k });
      byPeriod.get(k).avg_deal_size = r.avg_deal_size;
    }
    return [...byPeriod.values()].sort((a, b) =>
      String(a.period_end) < String(b.period_end) ? -1 : 1
    );
  },
};

function syntheticRecipeFor(template) {
  const t = template?.view_name_template || '';
  if (!t.startsWith('__synthetic__:')) return null;
  const recipeId = t.slice('__synthetic__:'.length);
  return SYNTHETIC_COMPOSERS[recipeId] || null;
}

// vertical_id (in cm_chart_catalog) → domain-db key (in domain-db.js)
const VERTICAL_TO_DOMAIN = {
  gov: 'government',
  dialysis: 'dialysis',
  // national_st lives in LCC Opps itself, not a separate domain DB
};

const PHASE_2_PENDING = (action) => ({
  error: 'phase_2_pending',
  action,
  message: `Endpoint '${action}' is scaffolded but Phase 2 implementation is pending.`,
  hint: 'Phase 2 adds the workbook export, PNG renderer, RCA upload, and editorial CMS.'
});

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const { action } = req.query;

  if (req.method === 'GET') {
    switch (action) {
      // Reference data (LCC Opps)
      case 'verticals':        return listVerticals(req, res);
      case 'subspecialties':   return listSubspecialties(req, res);
      case 'catalog':          return listCatalog(req, res);
      case 'brand':            return getBrandTokens(req, res);
      case 'broker_patterns':  return listBrokerPatterns(req, res);

      // Chart data (Phase 1 live)
      case 'chart':            return fetchChart(req, res);
      case 'quarterly':        return fetchQuarterly(req, res);

      // Phase 2
      case 'narrative':        return res.status(501).json(PHASE_2_PENDING(action));
      case 'export':           return exportWorkbook(req, res);

      // Phase 3 — Copilot tool surface
      case 'copilot_stat':     return copilotStat(req, res);
      case 'copilot_stat_catalog': return res.status(200).json({
        supported_chart_template_ids: listSupportedStatTemplates(),
      });

      default:
        return res.status(400).json({
          error: 'GET actions: verticals, subspecialties, catalog, brand, broker_patterns, chart, quarterly, export, narrative, copilot_stat, copilot_stat_catalog'
        });
    }
  }

  if (req.method === 'POST') {
    if (!requireRole(user, 'manager', workspaceId)) {
      return res.status(403).json({ error: 'Manager role required for capital-markets writes' });
    }

    switch (action) {
      case 'add_broker_pattern':     return addBrokerPattern(req, res);
      case 'refresh_nm_attribution': return refreshNmAttribution(req, res);
      case 'rca_import':             return rcaImport(req, res, user);
      case 'save_narrative':         return res.status(501).json(PHASE_2_PENDING(action));
      case 'publish':                return res.status(501).json(PHASE_2_PENDING(action));

      default:
        return res.status(400).json({ error: 'POST actions: add_broker_pattern, refresh_nm_attribution, rca_import, save_narrative, publish' });
    }
  }

  return res.status(405).json({ error: `${req.method} not allowed` });
});

// ============================================================================
// Phase 0 — reference endpoints (LCC Opps)
// ============================================================================

async function listVerticals(req, res) {
  const includeInactive = req.query.include_inactive === 'true';
  const filter = includeInactive ? '' : '&is_active=eq.true';
  const result = await opsQuery(
    'GET',
    `cm_verticals?select=*${filter}&order=is_active.desc,vertical_id`
  );
  return res.status(200).json({ verticals: result.data || [] });
}

async function listSubspecialties(req, res) {
  const { vertical_id } = req.query;
  const includeInactive = req.query.include_inactive === 'true';
  const filters = [];
  if (vertical_id) filters.push(`vertical_id=eq.${vertical_id}`);
  if (!includeInactive) filters.push('is_active=eq.true');
  const filterStr = filters.length ? '&' + filters.join('&') : '';
  const result = await opsQuery(
    'GET',
    `cm_subspecialties?select=*${filterStr}&order=vertical_id,subspecialty_id`
  );
  return res.status(200).json({ subspecialties: result.data || [] });
}

async function listCatalog(req, res) {
  const { vertical, phase } = req.query;
  const filters = [];
  if (vertical) filters.push(`applies_to_verticals=cs.{${vertical}}`);
  // phase is a CEILING — return every template whose phase <= the requested
  // value. Mirrors fetchQuarterly's filter so the catalog and chart-data
  // endpoints stay in sync. (Earlier this used phase=eq, which silently
  // dropped every chart card from earlier phases once the frontend bumped
  // its phase request to 5 — every Phase 1-4 sales chart vanished from
  // the dashboard until this was discovered.)
  if (phase)    filters.push(`phase=lte.${parseInt(phase, 10)}`);
  const filterStr = filters.length ? '&' + filters.join('&') : '';
  const result = await opsQuery(
    'GET',
    `cm_chart_catalog?select=*${filterStr}&order=phase,chart_template_id`
  );
  return res.status(200).json({ chart_templates: result.data || [] });
}

async function getBrandTokens(req, res) {
  const result = await opsQuery(
    'GET',
    `cm_brand_tokens?select=token_key,token_value,category&order=category,token_key`
  );

  const tokens = {};
  for (const row of result.data || []) {
    const [category, key] = row.token_key.split('.', 2);
    if (!tokens[category]) tokens[category] = {};
    tokens[category][key || category] = row.token_value;
  }
  return res.status(200).json({ tokens, raw: result.data || [] });
}

async function listBrokerPatterns(req, res) {
  const result = await opsQuery(
    'GET',
    `cm_nm_broker_patterns?select=*&order=effective_from`
  );
  return res.status(200).json({ patterns: result.data || [] });
}

// ============================================================================
// Phase 1 — chart data dispatch
// ============================================================================

/**
 * Look up a chart_template_id in cm_chart_catalog (LCC Opps) and resolve
 * to (vertical, view_name) — view_name is 'cm_{vertical}_<suffix>'.
 */
async function resolveTemplate(chart_template_id) {
  const r = await opsQuery(
    'GET',
    `cm_chart_catalog?chart_template_id=eq.${encodeURIComponent(chart_template_id)}&select=*&limit=1`
  );
  return r.data?.[0] || null;
}

/**
 * Materialize a view name template like 'cm_{vertical}_volume_ttm_q' for a vertical.
 */
function viewNameFor(template, vertical) {
  return template.replace('{vertical}', vertical);
}

/**
 * Pick the canonical time-axis column for a chart template's PostgREST query.
 *
 * Quarterly views expose `period_end`, annual views expose `year`. PostgREST
 * 400s when you order by a column that isn't on the view, which surfaces as
 * `result.ok === false` and an empty rows[] in the catch block — i.e. an
 * empty chart on the dashboard. The data_shape token captures the cadence:
 *
 *   - data_shape = '...yearly...'   → order by year
 *   - data_shape = '...quarterly...' (default) → order by period_end
 *
 * Synthetic templates (view_name_template starts with '__synthetic__:') skip
 * this — they compose rows from already-fetched dependencies without hitting
 * PostgREST themselves.
 */
function timeAxisColumnFor(template) {
  const shape = String(template?.data_shape || '').toLowerCase();
  if (shape.includes('yearly')) return 'year';
  return 'period_end';
}

/**
 * Clamp a chart's rows to the requested as-of period.
 *
 * Bug (diagnosed 2026-05-29): the per-chart `Data_*` tabs in the workbook
 * export were never clamped to `as_of`. Only the MasterPasteReady tab is
 * (it's sourced from the `*_master_m` views, which clamp to
 * `cm_last_completed_quarter_end()`). So a "2026-03-31" export still emitted
 * tabs with rows dated after Q1-2026 - e.g. dialysis Data_DOM_Ask ran through
 * 2026-05-31 with the trailing months forward-filled to identical values,
 * which reads as fabricated data.
 *
 * This is a post-fetch JS filter, NOT a PostgREST filter, on purpose: the
 * fetchView ladder already documents that strict PostgREST filters 400 and
 * silently empty the tab (the "many empty tabs" gov complaint). Filtering in
 * JS can never empty a tab by accident.
 *
 * Only genuine time-series tabs are clamped (data_shape `time_series*`,
 * `monthly*`, `quarterly*`, or yearly). Snapshot / ranked-table / kpi /
 * per-sale / per-listing shapes are point-in-time "as of now" views (active
 * inventory, top-buyer leaderboards, dot clouds) and are intentionally left
 * intact - clamping them by date would drop every row. Synthetic composers
 * read these already-clamped rows, so the clamp cascades to combo/summary
 * tabs for free.
 */
// R68-E (G3): per-chart lower bound on the time axis. cpi_vs_renewal_cagr's
// per-lease GSA renewal CAGR series only starts 2013-02; the CPI-only early
// years (2001-2011) add nothing but axis clutter, so crop the x-axis to
// 2012-01. period_end is ISO 'YYYY-MM-DD' (text-comparable).
const CHART_MIN_PERIOD = {
  cpi_vs_renewal_cagr: '2012-01-01',
};

function clampRowsToAsOf(rows, template, asOf) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const shape = String(template?.data_shape || '').toLowerCase();
  const isTimeSeries =
    shape.startsWith('time_series') ||
    shape.startsWith('monthly') ||
    shape.startsWith('quarterly') ||
    shape.includes('yearly') ||
    // Historical as-of (2026-08-07): these snapshot shapes carry a REAL
    // historical date in period_end (quarter-anchored cohort tables and
    // per-sale dot clouds where period_end = sale_date), so clamping to
    // <= as_of is correct — it selects the reporting quarter and drops
    // sales/quarters that had not happened yet. (Active-inventory snapshots
    // like tenant/term/per-listing are handled by _q reconstruction instead,
    // never by this date clamp, which would wrongly empty a max()-only view.)
    shape.startsWith('cohort_comparison') ||
    shape.startsWith('per_sale');
  if (!isTimeSeries) return rows;
  const col = timeAxisColumnFor(template); // 'year' | 'period_end'
  // R68-E (G3): apply the per-chart lower bound (data-side x-axis crop).
  const minPeriod = CHART_MIN_PERIOD[template?.chart_template_id];
  let out = rows;
  if (minPeriod && col === 'period_end') {
    out = out.filter(
      (r) => r?.period_end == null || String(r.period_end).slice(0, 10) >= minPeriod
    );
  }
  if (!asOf) return out;
  if (col === 'year') {
    const maxYear = new Date(asOf).getUTCFullYear();
    return out.filter((r) => r?.year == null || Number(r.year) <= maxYear);
  }
  // period_end is an ISO date string; YYYY-MM-DD compares correctly as text.
  const cap = String(asOf).slice(0, 10);
  return out.filter(
    (r) => r?.period_end == null || String(r.period_end).slice(0, 10) <= cap
  );
}

/**
 * CM export audit item 7 — crop a chart's rows to its registered display_from.
 * Only period_end time-series are cropped (the seeded series are all
 * period_end-based); a display_from is a date, and period_end is an ISO
 * 'YYYY-MM-DD' string that compares correctly as text. Non-time-series and
 * year-axis shapes pass through untouched.
 */
export function cropRowsToDisplayFrom(rows, template, df) {
  if (!Array.isArray(rows) || rows.length === 0 || df == null) return rows;
  // Backward-compat: accept either a resolved display_from string or a
  // {chart_template_id → date} map (used by the unit tests).
  const cutoff = typeof df === 'string'
    ? df
    : df[template?.chart_template_id];
  if (!cutoff) return rows;
  if (timeAxisColumnFor(template) !== 'period_end') return rows; // year-axis: skip
  return rows.filter(
    (r) => r?.period_end == null || String(r.period_end).slice(0, 10) >= String(cutoff).slice(0, 10)
  );
}

// ============================================================================
// Historical as-of resolution (CM historical regeneration, 2026-08-07)
// ============================================================================
//
// The export accepts ?as_of=YYYY-MM-DD. It is validated/snapped to a QUARTER
// END and defaults to the latest COMPLETED quarter — the JS mirror of the SQL
// `cm_last_completed_quarter_end()` (= date_trunc('quarter', current_date) - 1
// day). A value that lands mid-quarter is snapped down to that quarter's end; a
// value beyond the latest completed quarter is clamped back to it (a report can
// never be "as of" an in-progress quarter). Unparseable input is rejected by
// the caller (asOf === null).

/** Quarter end (last calendar day of the quarter containing `d`), ISO date. */
export function quarterEndOf(d) {
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(dt.getTime())) return null;
  const endMonth = Math.floor(dt.getUTCMonth() / 3) * 3 + 2; // 2,5,8,11
  // Day 0 of the following month = last day of endMonth.
  return new Date(Date.UTC(dt.getUTCFullYear(), endMonth + 1, 0)).toISOString().slice(0, 10);
}

/** Latest COMPLETED quarter end — JS mirror of cm_last_completed_quarter_end(). */
export function latestCompletedQuarterEnd(today = new Date()) {
  const startMonth = Math.floor(today.getUTCMonth() / 3) * 3;
  const firstOfQuarter = Date.UTC(today.getUTCFullYear(), startMonth, 1);
  return new Date(firstOfQuarter - 86400000).toISOString().slice(0, 10);
}

/**
 * Resolve the requested as_of into a validated quarter-end.
 * Returns { asOf, latest, defaulted, snapped } — asOf is null only when the
 * caller passed an unparseable date (→ 400).
 */
export function resolveAsOf(raw) {
  const latest = latestCompletedQuarterEnd();
  if (raw == null || String(raw).trim() === '') {
    return { asOf: latest, latest, defaulted: true, snapped: false };
  }
  const s = String(raw).slice(0, 10);
  const qe = quarterEndOf(s);
  if (!qe) return { asOf: null, latest, defaulted: false, snapped: false };
  const clamped = qe > latest ? latest : qe;
  return { asOf: clamped, latest, defaulted: false, snapped: clamped !== s };
}

// Snapshot feeds whose CURRENT-only views (max(period_end)) have a
// period_end-keyed `_q` reconstruction sibling. For these, when exporting, we
// fetch the `_q` view and select the requested quarter. Reconstruction is only
// wired for verticals that actually have the `_q` views built (dialysis today);
// any other vertical falls back to the current snapshot + an honest
// "not historical" stamp on the sheet (see snapshot_not_historical below).
const RECONSTRUCTABLE_QVIEW = {
  available_by_tenant:         'cm_{vertical}_available_by_tenant_q',
  available_by_term_bucket:    'cm_{vertical}_available_by_term_bucket_q',
  available_cap_rate_dot_plot: 'cm_{vertical}_available_cap_dot_q',
};
const RECONSTRUCTABLE_VERTICALS = new Set(['dialysis']);

// Data shapes that are point-in-time active-inventory snapshots (current-only
// unless a `_q` reconstruction exists). Used to stamp sheets "Snapshot as of
// <generation date> — not historical" when a historical as_of is requested but
// the feed can't be reconstructed for this vertical.
const CURRENT_ONLY_SNAPSHOT_SHAPES = new Set([
  'tenant_summary_table',
  'term_bucket_table',
  'per_listing_snapshot',
]);

/**
 * From a period_end-keyed reconstruction view, keep only the rows at the target
 * quarter = the greatest period_end <= asOf. Selecting the latest quarter
 * reproduces the current max(period_end) snapshot views exactly.
 */
export function selectSnapshotPeriod(rows, asOf) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const cap = String(asOf).slice(0, 10);
  let target = null;
  for (const r of rows) {
    const p = String(r?.period_end || '').slice(0, 10);
    if (!p || p > cap) continue;
    if (target === null || p > target) target = p;
  }
  if (target === null) return [];
  return rows.filter((r) => String(r?.period_end || '').slice(0, 10) === target);
}

/**
 * CM export audit item 4 — treasury freshness step, run BEFORE the workbook is
 * built. Treasury-derived series (10Y, loan constants, leveraged returns) read
 * FRED DGS10 from economic_indicators, which is written by the single dia
 * `ingest_fred` pipeline (we do NOT write it from here — a second writer would
 * fork the dedup/data_hash). This step:
 *   1. checks whether DGS10 covers the export month;
 *   2. if not AND a refresh webhook is configured (CM_TREASURY_REFRESH_URL),
 *      fires it once and re-checks (the env-gated ingestion trigger seam —
 *      no-op when unset, so default behavior is unchanged);
 *   3. returns { maxDate, stale } for meta; the per-chart macro-tail lag
 *      warning remains the fallback when the month genuinely isn't published.
 */
async function ensureTreasuryFreshForExport(domain, asOf) {
  if (!domain) return { maxDate: null, stale: null };
  const monthStart = (d) => String(d || new Date().toISOString().slice(0, 10)).slice(0, 7) + '-01';
  const readMax = async () => {
    try {
      const res = await domainQuery(
        domain, 'GET',
        'economic_indicators?series_id=eq.DGS10&select=observation_date&order=observation_date.desc&limit=1'
      );
      const v = res && res.ok !== false && Array.isArray(res.data) && res.data[0];
      return v && v.observation_date ? String(v.observation_date).slice(0, 10) : null;
    } catch { return null; }
  };
  const target = monthStart(asOf);
  let maxDate = await readMax();
  let stale = !maxDate || maxDate < target;
  if (stale && process.env.CM_TREASURY_REFRESH_URL) {
    try {
      // The refresh target is the dia FRED ingestion trigger. It may be a bare
      // webhook (default POST, no auth) OR an authenticated dispatch endpoint —
      // e.g. GitHub Actions workflow_dispatch, which requires an auth token and a
      // JSON body {"ref":"main"}. Optional env wiring (all unset => legacy bare POST):
      //   CM_TREASURY_REFRESH_METHOD  (default POST)
      //   CM_TREASURY_REFRESH_TOKEN   -> Authorization: Bearer <token>
      //   CM_TREASURY_REFRESH_BODY    -> raw request body (e.g. '{"ref":"main"}')
      // For GitHub, point CM_TREASURY_REFRESH_URL at
      //   https://api.github.com/repos/<owner>/Dialysis/actions/workflows/fred-ingest-daily.yml/dispatches
      // NOTE: dispatch is asynchronous (the ingest runs for ~1 min), so this
      // request cannot refresh the CURRENT export — it primes the NEXT one. The
      // daily schedule + dia_check_fred_staleness watchdog are the real freshness
      // guarantee; this seam just kicks an on-demand catch-up.
      const headers = { 'Content-Type': 'application/json' };
      if (process.env.CM_TREASURY_REFRESH_TOKEN) {
        headers.Authorization = `Bearer ${process.env.CM_TREASURY_REFRESH_TOKEN}`;
        headers.Accept = 'application/vnd.github+json'; // harmless for non-GitHub targets
      }
      await fetch(process.env.CM_TREASURY_REFRESH_URL, {
        method: process.env.CM_TREASURY_REFRESH_METHOD || 'POST',
        headers,
        body: process.env.CM_TREASURY_REFRESH_BODY || undefined,
      });
      maxDate = await readMax();
      stale = !maxDate || maxDate < target;
    } catch (e) {
      console.warn(`[cm-export] treasury refresh webhook failed: ${e?.message || e}`);
    }
  }
  if (stale) {
    console.warn(
      `[cm-export] treasury freshness: DGS10 latest ${maxDate || 'none'} does not cover ` +
      `export month ${target.slice(0, 7)}. Run the dia FRED ingestion (ingest_fred) for ` +
      `that month before shipping, or set CM_TREASURY_REFRESH_URL to auto-trigger it. ` +
      `Treasury-joined series will end on the last published month (see per-chart macro-tail warnings).`
    );
  }
  return { maxDate, stale };
}

/**
 * Resolve a chart's display_from from the registry rows, preferring the row
 * whose view_name equals the view this chart actually exports (so an _m chart
 * with both _m and _q sibling rows crops on the cadence it reads). Falls back
 * to any row for the chart_template_id. Returns an ISO date string or null.
 */
export function resolveDisplayFrom(displayFromRows, chart_template_id, view_name) {
  if (!Array.isArray(displayFromRows) || displayFromRows.length === 0) return null;
  const matches = displayFromRows.filter(
    (r) => r.chart_template_id === chart_template_id && r.display_from
  );
  if (matches.length === 0) return null;
  const exact = matches.find((r) => r.view_name === view_name);
  return String((exact || matches[0]).display_from).slice(0, 10);
}

/**
 * GET /api/capital-markets?action=chart&vertical=gov&chart_template_id=volume_ttm_by_quarter&subspecialty=all&from=&to=
 *   → { rows: [...], meta: { chart_template_id, vertical, view_name, ... } }
 */
async function fetchChart(req, res) {
  const { chart_template_id, vertical, subspecialty = 'all', from, to, as_of } = req.query;
  if (!chart_template_id) return res.status(400).json({ error: 'chart_template_id required' });
  if (!vertical)          return res.status(400).json({ error: 'vertical required' });

  const template = await resolveTemplate(chart_template_id);
  if (!template) return res.status(404).json({ error: `Unknown chart_template_id: ${chart_template_id}` });
  if (!template.applies_to_verticals?.includes(vertical)) {
    return res.status(400).json({
      error: `Chart '${chart_template_id}' is not applicable to vertical '${vertical}'`,
      applies_to: template.applies_to_verticals
    });
  }

  // Synthetic templates compose rows from a bundle of other templates'
  // time series. Resolve the dependency set + fetch + compose.
  const composer = syntheticRecipeFor(template);
  if (composer) {
    const depIds = ['volume_ttm_by_quarter', 'cap_rate_ttm_by_quarter', 'cap_rate_top_bottom_quartile'];
    const cat = await opsQuery(
      'GET',
      `cm_chart_catalog?select=*&chart_template_id=in.(${depIds.join(',')})`
    );
    const depTemplates = cat.data || [];
    const dom = VERTICAL_TO_DOMAIN[vertical];
    const depCharts = await Promise.all(depTemplates.map(async (tmpl) => {
      const view_name = viewNameFor(tmpl.view_name_template, vertical);
      const orderCol = timeAxisColumnFor(tmpl);
      const path = `${view_name}?select=*&subspecialty=eq.${encodeURIComponent(subspecialty)}&order=${orderCol}.asc`;
      const r = dom ? await domainQuery(dom, 'GET', path) : await opsQuery('GET', path);
      return {
        chart_template_id: tmpl.chart_template_id,
        rows: r.ok !== false ? (r.data || []) : [],
      };
    }));
    const rows = composer({ vertical, subspecialty, asOf: as_of, allCharts: depCharts });
    return res.status(200).json({
      chart_template_id, vertical, subspecialty,
      view_name: template.view_name_template,
      chart_type: template.chart_type,
      data_shape: template.data_shape,
      metric_focus: template.metric_focus,
      y_format_token: template.y_format_token,
      rows: rows || [],
    });
  }

  const view_name = viewNameFor(template.view_name_template, vertical);
  const domain = VERTICAL_TO_DOMAIN[vertical];

  // Build PostgREST query. Annual views (data_shape contains 'yearly') expose
  // a `year` column instead of `period_end` — without this branch, ordering
  // would 400 and the chart would render empty.
  const orderCol = timeAxisColumnFor(template);
  const parts = [`select=*`];
  parts.push(`subspecialty=eq.${encodeURIComponent(subspecialty)}`);
  if (from) parts.push(`${orderCol}=gte.${from}`);
  if (to)   parts.push(`${orderCol}=lte.${to}`);
  parts.push(`order=${orderCol}.asc`);
  const path = `${view_name}?${parts.join('&')}`;

  let result;
  if (domain) {
    result = await domainQuery(domain, 'GET', path);
  } else {
    // national_st lives in LCC Opps itself
    result = await opsQuery('GET', path);
  }

  if (!result.ok) {
    return res.status(result.status || 500).json({
      error: 'view_query_failed',
      view_name,
      vertical,
      detail: result.data
    });
  }

  return res.status(200).json({
    chart_template_id,
    vertical,
    subspecialty,
    view_name,
    chart_type: template.chart_type,
    data_shape: template.data_shape,
    metric_focus: template.metric_focus,
    y_format_token: template.y_format_token,
    rows: result.data || []
  });
}

/**
 * GET /api/capital-markets?action=quarterly&vertical=gov&as_of=2025-09-30&subspecialty=all
 *   → bulk-fetch every chart_template that applies to the vertical, returning
 *     the data needed to render a full Capital Markets tab in one round-trip.
 */
async function fetchQuarterly(req, res) {
  const { vertical, as_of, subspecialty = 'all', phase } = req.query;
  if (!vertical) return res.status(400).json({ error: 'vertical required' });

  // 1. Look up applicable templates from the catalog
  const phaseFilter = phase ? `&phase=lte.${parseInt(phase, 10)}` : '&phase=lte.1';
  const cat = await opsQuery(
    'GET',
    `cm_chart_catalog?select=*&applies_to_verticals=cs.{${vertical}}${phaseFilter}&order=phase,chart_template_id`
  );
  const templates = cat.data || [];
  if (templates.length === 0) {
    return res.status(200).json({ vertical, subspecialty, as_of, charts: [] });
  }

  // 2a. Split templates into real (fetched from a SQL view) and synthetic
  //     (composed from other templates' rows after the first wave finishes).
  const realTemplates      = templates.filter((t) => !syntheticRecipeFor(t));
  const syntheticTemplates = templates.filter((t) => syntheticRecipeFor(t));

  // 2b. Fetch each real chart's data in parallel
  const domain = VERTICAL_TO_DOMAIN[vertical];
  const queries = realTemplates.map(async (tmpl) => {
    const view_name = viewNameFor(tmpl.view_name_template, vertical);
    const orderCol = timeAxisColumnFor(tmpl);
    const parts = [`select=*`, `subspecialty=eq.${encodeURIComponent(subspecialty)}`];
    parts.push(`order=${orderCol}.asc`);
    const path = `${view_name}?${parts.join('&')}`;

    try {
      const result = domain
        ? await domainQuery(domain, 'GET', path)
        : await opsQuery('GET', path);
      return {
        chart_template_id: tmpl.chart_template_id,
        name: tmpl.name,
        chart_type: tmpl.chart_type,
        data_shape: tmpl.data_shape,
        metric_focus: tmpl.metric_focus,
        y_format_token: tmpl.y_format_token,
        cadence: tmpl.cadence || null,
        view_name,
        ok: result.ok !== false,
        rows: result.ok !== false ? (result.data || []) : [],
        error: result.ok === false ? (result.data?.message || result.data) : null,
      };
    } catch (e) {
      return {
        chart_template_id: tmpl.chart_template_id,
        name: tmpl.name,
        chart_type: tmpl.chart_type,
        data_shape: tmpl.data_shape,
        cadence: tmpl.cadence || null,
        view_name,
        ok: false,
        rows: [],
        error: String(e?.message || e),
      };
    }
  });

  const realCharts = await Promise.all(queries);

  // 2c. Compose synthetic charts from the fetched real-chart rows
  const synthCharts = syntheticTemplates.map((tmpl) => {
    const composer = syntheticRecipeFor(tmpl);
    let rows = [];
    let error = null;
    try {
      rows = composer({ vertical, subspecialty, asOf: as_of, allCharts: realCharts }) || [];
    } catch (e) {
      error = String(e?.message || e);
    }
    return {
      chart_template_id: tmpl.chart_template_id,
      name: tmpl.name,
      chart_type: tmpl.chart_type,
      data_shape: tmpl.data_shape,
      metric_focus: tmpl.metric_focus,
      y_format_token: tmpl.y_format_token,
      view_name: tmpl.view_name_template,  // synthetic marker
      ok: !error,
      rows,
      error,
    };
  });

  const charts = [...realCharts, ...synthCharts];

  // 3. If as_of supplied, also fold in the latest-quarter scalar summary
  let summary = null;
  if (as_of) {
    summary = {
      as_of,
      // Pluck the row matching as_of for each chart for KPI display
      kpis: charts.map(c => ({
        chart_template_id: c.chart_template_id,
        row: (c.rows || []).find(r => r.period_end === as_of) || null
      }))
    };
  }

  return res.status(200).json({
    vertical,
    subspecialty,
    as_of: as_of || null,
    charts,
    summary,
  });
}

// ============================================================================
// Phase 2a V1 — Excel export
// ============================================================================

/**
 * GET /api/capital-markets?action=export&vertical=gov&subspecialty=all&as_of=2025-09-30&format=xlsx
 *   → streams a brand-styled .xlsx workbook with data tabs for every Phase 1
 *     chart applicable to the vertical. V1 ships data tabs only; V2 will
 *     integrate a stripped master template with pre-built brand-styled
 *     chart objects pre-bound to these data ranges.
 */
async function exportWorkbook(req, res) {
  const { vertical, subspecialty = 'all', as_of, format = 'xlsx' } = req.query;
  if (!vertical) return res.status(400).json({ error: 'vertical required' });

  // Historical as-of (2026-08-07): validate/snap to a quarter end; default =
  // latest completed quarter. resolvedAsOf drives every sheet query, the
  // display-window clamp, snapshot reconstruction, the filename, and the Cover
  // "As of:" stamp — so the whole workbook is internally consistent.
  const asOfResolution = resolveAsOf(as_of);
  if (asOfResolution.asOf === null) {
    return res.status(400).json({
      error: 'invalid_as_of',
      as_of,
      hint: 'as_of must be a date (YYYY-MM-DD). It is snapped to the enclosing quarter end and defaults to the latest completed quarter.',
    });
  }
  const resolvedAsOf = asOfResolution.asOf;
  if (res && typeof res.setHeader === 'function') {
    res.setHeader('X-CM-AsOf', resolvedAsOf);
    res.setHeader('X-CM-AsOf-Latest', asOfResolution.latest);
    res.setHeader('X-CM-AsOf-Defaulted', String(asOfResolution.defaulted));
  }

  if (format !== 'xlsx') {
    return res.status(400).json({
      error: 'unsupported_format',
      format,
      supported: ['xlsx'],
      hint: 'PDF and PNG export land in V2.',
    });
  }

  // 1. Fetch chart catalog + data via the same dispatch logic the dashboard uses.
  //    The export is the "full data dump" use case — include every template
  //    applicable to the vertical regardless of phase. (Previously hardcoded
  //    to phase=lte.1, which silently dropped every Phase 2+ tab from the
  //    workbook: KPI blocks, inventory analysis, monthly TTM, rent box, etc.)
  //    Caller can still narrow via ?phase=N to cap at a lower phase if needed.
  const exportPhase = req.query.phase ? parseInt(req.query.phase, 10) : null;
  const phaseFilter = exportPhase ? `&phase=lte.${exportPhase}` : '';
  const cat = await opsQuery(
    'GET',
    `cm_chart_catalog?select=*&applies_to_verticals=cs.{${vertical}}${phaseFilter}&order=phase,chart_template_id`
  );
  const templates = cat.data || [];

  // Split into real (view-backed) vs synthetic (composed) templates so the
  // synthetic ones can read the freshly-fetched real-chart rows.
  const realTemplates      = templates.filter((t) => !syntheticRecipeFor(t));
  const syntheticTemplates = templates.filter((t) => syntheticRecipeFor(t));

  const domain = VERTICAL_TO_DOMAIN[vertical];

  // CM export audit item 7 — per-series display_from policy. cm_view_registry
  // stores the first period each registered series clears its density floor
  // (e.g. the 2001-start sale series don't clear 25 TTM deals until 2007-Q1);
  // the exporter drops rows earlier than that so charts inherit clean x-axes
  // without hand-cropping. Best-effort: a missing registry / column just means
  // no cropping (whole-history export, the prior behavior).
  // A chart_template_id can have >1 registry row (an _m and a _q sibling view);
  // keep the full rows so the crop resolves the row whose view_name matches the
  // view this chart actually exports (see resolveDisplayFrom).
  let displayFromRows = [];
  if (domain) {
    try {
      const reg = await domainQuery(
        domain, 'GET',
        `cm_view_registry?select=chart_template_id,view_name,display_from&vertical=eq.${encodeURIComponent(vertical)}&display_from=not.is.null`
      );
      if (reg && reg.ok !== false && Array.isArray(reg.data)) {
        displayFromRows = reg.data.filter((r) => r && r.chart_template_id && r.display_from);
      }
    } catch { /* registry optional — no crop on failure */ }
  }

  // CM export audit item 4 — treasury freshness step, before the workbook build.
  const treasuryFreshness = await ensureTreasuryFreshForExport(domain, resolvedAsOf);
  if (res && typeof res.setHeader === 'function') {
    res.setHeader('X-CM-Treasury-Max', treasuryFreshness.maxDate || 'none');
    res.setHeader('X-CM-Treasury-Stale', String(treasuryFreshness.stale));
  }

  // Fetch a chart-source view robustly: many older gov views were built
  // without a `subspecialty` column and some use `period_label` instead of
  // `period_end`. Strict filters → PostgREST 400 → empty Data_* tabs in
  // the workbook (this was the "many empty tabs" gov complaint, 2026-05-07).
  // Fallback ladder: standard → drop subspecialty → drop order → bare.
  // Stops as soon as PostgREST returns a 2xx.
  const fetchView = async (view_name, orderCol) => {
    const exec = (p) => domain ? domainQuery(domain, 'GET', p) : opsQuery('GET', p);
    const tries = [
      `${view_name}?select=*&subspecialty=eq.${encodeURIComponent(subspecialty)}&order=${orderCol}.asc`,
      `${view_name}?select=*&order=${orderCol}.asc`,
      `${view_name}?select=*&subspecialty=eq.${encodeURIComponent(subspecialty)}`,
      `${view_name}?select=*`,
    ];
    // PostgREST caps every response at 1000 rows regardless of `limit` (see
    // CLAUDE.md footgun). A `per_sale` dot-cloud view like cm_{v}_core_cap_dot_q
    // holds >1000 rows; ordered ASC, the cap silently truncated the NEWEST
    // sales (Data_Core_Cap_Dot ran only through mid-2025 — the audit's
    // A/Data_Core_Cap_Dot bug). Page through with limit/offset on the WINNING
    // path so every row lands and truncation is impossible. Uses the same
    // stable order clause the winning try carried (offset paging is only
    // stable under an ORDER BY; the ladder's ordered tries win first).
    const PAGE = 1000;
    const MAX_ROWS = 500000; // runaway backstop
    const paginate = async (winningPath, firstPage) => {
      if (!Array.isArray(firstPage) || firstPage.length < PAGE) return firstPage;
      const all = firstPage.slice();
      let offset = all.length;
      // Strip any pre-existing limit/offset the caller may have added.
      const basePath = winningPath.replace(/[?&](limit|offset)=\d+/g, '');
      const sep = basePath.includes('?') ? '&' : '?';
      while (all.length < MAX_ROWS) {
        const pagePath = `${basePath}${sep}limit=${PAGE}&offset=${offset}`;
        let pageRes;
        try { pageRes = await exec(pagePath); }
        catch { break; }
        if (!pageRes || pageRes.ok === false || !Array.isArray(pageRes.data) || pageRes.data.length === 0) break;
        all.push(...pageRes.data);
        offset += pageRes.data.length;
        if (pageRes.data.length < PAGE) break;
      }
      return all;
    };
    // Run the full fallback ladder once. Returns { result, path } so the
    // pager can re-issue the winning query with limit/offset.
    const runLadder = async () => {
      let lastResult = null;
      for (const p of tries) {
        try {
          const result = await exec(p);
          if (result.ok) return { result, path: p };
          lastResult = result;
        } catch (e) {
          lastResult = { ok: false, status: 0, data: { error: String(e) } };
        }
      }
      return { result: lastResult || { ok: false, status: 0, data: [] }, path: null };
    };
    // Round 68-E (G8): the renewal_rent_growth empty-tab incident (2026-06-04)
    // was a TRANSIENT fetch failure on a cold dyno — the view was live with 158
    // rows and every prior export had data. A single retry pass after a short
    // backoff absorbs that class of cold-start blip before we surface it.
    let { result, path } = await runLadder();
    if (result.ok === false) {
      await new Promise((r) => setTimeout(r, 400));
      const retry = await runLadder();
      if (retry.result.ok !== false) {
        ({ result, path } = retry);
      } else {
        console.error(
          `[fetchView] ${view_name} failed after retry ` +
          `(vertical=${vertical}, subspecialty=${subspecialty}, ` +
          `status=${retry.result.status || 'n/a'}): ${JSON.stringify(retry.result.data)?.slice(0, 200)} ` +
          `— tab will be marked FETCH FAILED, re-export needed.`
        );
        result = retry.result;
        path = retry.path;
      }
    }
    // Page past the PostgREST 1000-row cap on the winning query so large
    // per-sale/per-listing dot views export in full.
    if (result.ok !== false && path && Array.isArray(result.data) && result.data.length === PAGE) {
      result = { ...result, data: await paginate(path, result.data) };
    }
    return result;
  };

  const chartFetches = realTemplates.map(async (tmpl) => {
    // Historical as-of: for the current-only available-inventory snapshot
    // feeds, redirect to the period_end-keyed `_q` reconstruction view (when
    // this vertical has one) and select the requested quarter. Selecting the
    // latest quarter reproduces the current max() snapshot views exactly.
    const qViewTmpl = RECONSTRUCTABLE_QVIEW[tmpl.chart_template_id];
    const reconstructed = !!qViewTmpl && RECONSTRUCTABLE_VERTICALS.has(vertical);
    const view_name = (reconstructed ? qViewTmpl : tmpl.view_name_template)
      .replace('{vertical}', vertical);
    // A historical as_of on a current-only snapshot with NO reconstruction
    // (e.g. gov's tenant/term/per-listing feeds) must be labeled honestly on
    // the sheet rather than silently mislabeled as the report quarter.
    const snapshot_not_historical =
      !reconstructed &&
      CURRENT_ONLY_SNAPSHOT_SHAPES.has(String(tmpl.data_shape || '').toLowerCase()) &&
      resolvedAsOf !== asOfResolution.latest;
    const orderCol = timeAxisColumnFor(tmpl);
    try {
      const result = await fetchView(view_name, orderCol);
      // Reconstructed feeds: narrow the all-quarters view to the target period
      // BEFORE clamp/crop so the composers + data tab see just that quarter.
      const rawRows = result.ok !== false ? (result.data || []) : [];
      const baseRows = reconstructed ? selectSnapshotPeriod(rawRows, resolvedAsOf) : rawRows;
      const snapshot_period = reconstructed
        ? (baseRows[0]?.period_end ? String(baseRows[0].period_end).slice(0, 10) : null)
        : null;
      return {
        chart_template_id: tmpl.chart_template_id,
        name: tmpl.name,
        chart_type: tmpl.chart_type,
        data_shape: tmpl.data_shape,
        metric_focus: tmpl.metric_focus,
        // Round 6g — propagate cadence from catalog so the renderer uses
        // monthly window for charts whose underlying view is `_m` even
        // when not going through master_m mapper path.
        cadence: tmpl.cadence,
        // Round 10 — propagate vertical so per-vertical chart styling
        // (e.g. seller_sentiment axis ranges) can branch in the renderer.
        vertical,
        view_name,
        // 2026-05-29 - clamp time-series rows to the requested as-of period
        // so Data_* tabs never bleed past the report quarter (see
        // clampRowsToAsOf). Snapshot/table/kpi shapes pass through untouched.
        rows: cropRowsToDisplayFrom(
          clampRowsToAsOf(baseRows, tmpl, resolvedAsOf),
          tmpl,
          resolveDisplayFrom(displayFromRows, tmpl.chart_template_id, view_name)
        ),
        // Round 68-E (G8): distinguish a real fetch failure (after the
        // fetchView retry pass) from a legitimately empty view, so the tab
        // writer can stamp "FETCH FAILED — re-export" instead of a silent
        // 0-row tab that looks like a data gap.
        fetch_failed: result.ok === false,
        // Historical as-of provenance for the sheet stamps.
        reconstructed,
        snapshot_period,
        snapshot_not_historical,
      };
    } catch (e) {
      return {
        chart_template_id: tmpl.chart_template_id,
        name: tmpl.name,
        chart_type: tmpl.chart_type,
        cadence: tmpl.cadence,
        vertical,
        view_name,
        rows: [],
        fetch_failed: true,
      };
    }
  });
  const realCharts = await Promise.all(chartFetches);

  // CM export audit item 2 (2026-08-07) — log the resolved display_from for
  // every realCharts-driven sheet at export time (the crop itself is applied at
  // fetch, line ~1098). Sheets whose rows are later overridden by a master_m
  // mapper log again inside that loop with the re-applied crop. Together these
  // make sheet->display_from fully visible in the deploy logs so a missing crop
  // (Bid-Ask started 2001) can never silently recur.
  for (const c of realCharts) {
    const df = resolveDisplayFrom(displayFromRows, c.chart_template_id, c.view_name);
    console.log(
      `[exportWorkbook] display_from sheet=${c.chart_template_id} ` +
      `view=${c.view_name} display_from=${df || 'none'} rows=${Array.isArray(c.rows) ? c.rows.length : 0}`
    );
  }

  // CM export audit item 1 — core dot freshness assertion. The Core Cap Rate
  // Dot Plot reads the core-cohort view (cm_{v}_core_cap_dot_q). After the
  // pagination fix the sheet carries every qualifying core sale, so its newest
  // sale should be within 45 days of the export date; a larger gap means the
  // upstream sales feed stalled (or the 1000-cap regressed). Warn loudly and
  // stamp meta so the acceptance re-run can assert it. The date lives in
  // `period_end` (the core view aliases sale_date → period_end).
  const CORE_DOT_FRESH_DAYS = 45;
  for (const c of realCharts) {
    if (c.chart_template_id !== 'core_cap_rate_dot_plot') continue;
    if (!Array.isArray(c.rows) || c.rows.length === 0) continue;
    let maxMs = -Infinity;
    for (const r of c.rows) {
      const t = Date.parse(String(r?.period_end || '').slice(0, 10));
      if (!Number.isNaN(t) && t > maxMs) maxMs = t;
    }
    if (maxMs === -Infinity) continue;
    const ageDays = Math.round((Date.now() - maxMs) / 86400000);
    c.core_dot_max_sale = new Date(maxMs).toISOString().slice(0, 10);
    c.core_dot_age_days = ageDays;
    if (ageDays > CORE_DOT_FRESH_DAYS) {
      console.warn(
        `[cm-export] core dot freshness: newest core sale ${c.core_dot_max_sale} ` +
        `is ${ageDays}d old (> ${CORE_DOT_FRESH_DAYS}d) — check the sales feed / ` +
        `pagination before shipping (view=${c.view_name}).`
      );
    }
  }

  // CM export audit item 6 — macro ingestion-lag guard. Treasury-joined series
  // (cost of capital, leveraged returns, fed-funds-vs-10Y, net-lease spread)
  // read FRED/treasury rates that can land a month behind the export date, so
  // the final plotted point falls to null and the chart ends on a cliff. We do
  // NOT fabricate a synthetic final point (never-fabricate doctrine); instead
  // we surface the lag loudly so the operator ingests FRED for the export month
  // before shipping. The clean fix is running the treasury ingestion first —
  // this guard makes a stale tail impossible to miss.
  const MACRO_TAIL_CHECK = {
    cost_of_capital:        'treasury_10y_yield',
    fed_funds_vs_treasury:  'treasury_10y_yield',
    cash_leveraged_returns: 'leveraged_return_mid',
    net_lease_spread:       'nm_spread',
  };
  for (const c of realCharts) {
    const key = MACRO_TAIL_CHECK[c.chart_template_id];
    if (!key || !Array.isArray(c.rows) || c.rows.length === 0) continue;
    const last = c.rows[c.rows.length - 1];
    if (last && last[key] == null) {
      const lastGood = [...c.rows].reverse().find((r) => r && r[key] != null);
      console.warn(
        `[cm-export] macro tail lag on ${c.chart_template_id} (view=${c.view_name}): ` +
        `final period ${last.period_end || '?'} has null ${key} — ` +
        `${lastGood ? `last populated ${lastGood.period_end}` : 'no populated period'}. ` +
        `Run FRED/treasury ingestion for the export month before shipping.`
      );
    }
  }

  // Round 7 — moved synthCharts construction below master_m mapper so
  // synthetic composers see post-mapped (monthly) inputs. Previously
  // pace_of_cap_rate_expansion saw quarterly cap_rate_by_lease_term rows
  // and produced only the pace_all series (pace_core needs the master_m-
  // mapped `cap_10plus` field name; the quarterly view has
  // `cap_10plus_year`). The mapper loop runs against realCharts; then
  // synthCharts is built; then both are combined into `charts`.
  // (synthCharts construction moved further down — see "Round 7 split").
  let charts;

  // 2. Fetch brand tokens
  const brandResult = await opsQuery(
    'GET',
    `cm_brand_tokens?select=token_key,token_value,category`
  );
  const brand = { palette: {}, fonts: {} };
  for (const row of brandResult.data || []) {
    const [category, key] = row.token_key.split('.', 2);
    if (!brand[category]) brand[category] = {};
    brand[category][key || category] = row.token_value;
  }

  // 3. For gov + dialysis, also fetch the wide master view (powers
  //    the MasterPasteReady tab — column-shape parity for the master XLSX
  //    chart objects).
  let masterRows = null;
  if (domain) {
    const masterView = vertical === 'gov'      ? 'cm_gov_market_quarterly'
                     : vertical === 'dialysis' ? 'cm_dialysis_market_quarterly_master'
                     : null;
    if (masterView) {
      const masterPath = `${masterView}?select=*&subspecialty=eq.${encodeURIComponent(subspecialty)}&order=period_end.asc`;
      const masterResult = await domainQuery(domain, 'GET', masterPath);
      masterRows = masterResult.ok !== false ? (masterResult.data || []) : [];
    }
  }

  // 3b. For dialysis + gov: also fetch the MONTHLY master view that feeds
  //     the chart visuals. Each row = month-end anchor with rolling-12-month
  //     TTM rollups. master_m anchors are clamped to the last completed
  //     quarter end (cm_last_completed_quarter_end()) so in-progress
  //     quarters never appear on chart axes — addresses user feedback
  //     2026-05-07: "all of these charts display data through the 2Q of
  //     2026… we want to ensure the newest reported period as already
  //     passed."
  let masterMonthlyRows = null;
  if (domain && (vertical === 'dialysis' || vertical === 'gov')) {
    const monthlyView = vertical === 'dialysis'
      ? 'cm_dialysis_market_quarterly_master_m'
      : 'cm_gov_market_quarterly_master_m';
    // Round 6b — gov master_m fetch was returning 0 rows in production
    // (user's 2026-03-31 gov export shows every tab with quarterly view
    // counts ~70-115 rows, never master_m's ~300 monthly rows). Direct
    // SQL probe shows the view has 303 rows for subspecialty='all'. The
    // single strict fetch was failing silently — likely a PostgREST
    // serialization issue with one of the 39 columns.
    //
    // Use the resilient fetchView ladder (standard → no-subspecialty →
    // no-order → bare) instead of a single attempt, and log which try
    // succeeded so we can diagnose in Vercel logs.
    const monthlyResult = await fetchView(monthlyView, 'period_end');
    masterMonthlyRows = monthlyResult.ok !== false ? (monthlyResult.data || []) : [];
    console.log(
      `[exportWorkbook] vertical=${vertical} master_m=${monthlyView}: ` +
      `fetched ${masterMonthlyRows.length} rows ` +
      `(ok=${monthlyResult.ok}, status=${monthlyResult.status || 'n/a'})`
    );
    if (masterMonthlyRows.length === 0 && monthlyResult.ok === false) {
      console.warn(
        `[exportWorkbook] ${monthlyView} fetch failed; mapper block will be ` +
        `skipped, charts will fall back to per-view quarterly data. ` +
        `error=${JSON.stringify(monthlyResult.data)?.slice(0, 200)}`
      );
    }
  }

  // 4a. For dialysis charts that map to a master_m column, override the
  //     per-template QUARTERLY rows with the master_m MONTHLY rows. Per the
  //     user: "the old Excel was a monthly rolling trailing twelve month
  //     figure over a quarterly axis." Each x-position becomes a month;
  //     the chart-image-renderer's recent-window crop + Chart.js axis
  //     auto-skip renders quarterly-looking labels. Templates without a
  //     master_m equivalent (NM-vs-Market, lease-term cohorts, valuation
  //     index, etc.) keep their quarterly data until master_m extends to
  //     cols P-BM in a follow-up.
  if (Array.isArray(masterMonthlyRows) && masterMonthlyRows.length > 0
      && (vertical === 'dialysis' || vertical === 'gov')) {
    // Mappers shared between dialysis + gov master_m (column shapes match).
    const sharedMappers = {
      volume_ttm_by_quarter: (rows) => rows.map(r => ({
        period_end: r.period_end,
        volume_dollars: r.ttm_volume,
      })),
      // Round 6b — user feedback: "Data_Cap_Average looks great but this
      // is a weighted average. I think we have historically used an
      // average." master_m carries both ttm_weighted_cap_rate and
      // avg_cap_rate_ttm; the latter is the simple TTM mean while the
      // former weights by sold_price. Switch to the simple mean for
      // consistency with the manual Excel deliverable.
      cap_rate_ttm_by_quarter: (rows) => rows.map(r => ({
        period_end: r.period_end,
        // Field name preserved for renderer compatibility, but the value
        // is now the simple TTM avg, not the dollar-weighted version.
        ttm_weighted_cap_rate: r.avg_cap_rate_ttm,
      })),
      transaction_count_ttm: (rows) => rows.map(r => ({
        period_end: r.period_end,
        ttm_count: r.transaction_count_ttm,
      })),
      avg_deal_size: (rows) => rows.map(r => ({
        period_end: r.period_end,
        avg_deal_size: r.avg_deal_size,
      })),
      yoy_volume_change: (rows) => rows.map(r => ({
        period_end: r.period_end,
        yoy_change_pct: r.yoy_change_pct,
      })),
      // Round 3b — Quarterly_Volume_Bars (PDF dialysis p.21 bottom).
      // master_m carries `quarterly_volume` on every monthly anchor; we
      // dedupe to the last day of each quarter so the rendered bars are
      // truly quarterly (not 12 monthly snapshots of the same number).
      quarterly_volume_bars: (rows) => {
        const byQuarter = new Map();
        for (const r of rows) {
          if (r.quarterly_volume == null && r.quarterly_count == null) continue;
          // period_end is YYYY-MM-DD; quarter-end months are 03/06/09/12
          const m = String(r.period_end).slice(5, 7);
          if (m !== '03' && m !== '06' && m !== '09' && m !== '12') continue;
          byQuarter.set(r.period_end, {
            period_end: r.period_end,
            quarterly_volume: Number(r.quarterly_volume) || 0,
            quarterly_count: r.quarterly_count != null ? Number(r.quarterly_count) : null,
          });
        }
        return [...byQuarter.values()].sort((a, b) =>
          String(a.period_end) < String(b.period_end) ? -1 : 1
        );
      },
      cap_rate_yoy_change: (rows) => rows.map(r => ({
        period_end: r.period_end,
        yoy_change_pct: r.yoy_change_pct,
      })),
      cap_rate_top_bottom_quartile: (rows) => rows.map(r => ({
        period_end: r.period_end,
        top_quartile: r.upper_quartile_cap_ttm,
        bottom_quartile: r.lower_quartile_cap_ttm,
        // Round 7 — master_m now carries a TTM median (percentile_cont(0.50)).
        // User: "Data_Cap_Quartile looks much better but ... median is missing."
        median: r.median_quartile_cap_ttm,
      })),
      volume_cap_quartile_combo: (rows) => rows.map(r => ({
        period_end: r.period_end,
        volume_dollars: r.ttm_volume,
        cap_rate: r.avg_cap_rate_ttm,
        upper_quartile: r.upper_quartile_cap_ttm,
        lower_quartile: r.lower_quartile_cap_ttm,
      })),
      // R66w — `nm_vs_market_cap` mapper REMOVED (same fix as cap_rate_by_lease_term,
      // dom_and_pct_of_ask, seller_sentiment, cap_by_credit above). master_m's
      // nm_avg_cap_ttm / non_nm_avg_cap_ttm are the RAW UNGATED cap averages
      // (8%+ on thin gov NM cohorts) — mapping them here was overriding the
      // dedicated wrapper view (cm_<vertical>_nm_vs_market_q/_m), which is gated
      // (n>=3) and +/-4mo smoothed. The 2026-03-31 gov export showed NM clipping
      // at 8.2-8.4% on the 6-7.75% axis because of this override. Let the chart
      // fetch the gated wrapper directly via the realCharts path.
      // NOTE: net_lease_spread (below) still reads nm_avg_cap_ttm / non_nm_avg_cap_ttm
      // from master_m — if NL_Spread shows the same ungated NM line, it needs the
      // same treatment (or gate those two columns in the master_m view).
      // 2026-05-29 - shared `cap_rate_by_lease_term` master_m mapper REMOVED.
      // master_m's gov cohort columns (cap_10plus_year / cap_5to10_year /
      // cap_less5_year / cap_outside_firm) bucket on the leases-table join,
      // which can't resolve a firm term for ~67% of recent sold gov properties
      // (they dump into "outside firm term", starving 10+/6-10/<5 and inverting
      // the ladder). cm_gov_cap_by_term_m was rebuilt to classify by firm-term
      // REMAINING from gsa_leases.termination_date -- let gov fetch that wrapper
      // directly via the realCharts path (same pattern as the R45 cap_by_credit
      // and R12 seller_sentiment removals). Dialysis keeps its own
      // cap_rate_by_lease_term override in verticalMappers below (its master_m
      // cohorts are correct and PDF-aligned).
      // Round 12 — `dom_and_pct_of_ask` mapper REMOVED.
      // The wrapper views (cm_<vertical>_dom_pct_ask_m) carry the
      // sample-size gate (Round 10, gov) and widened DOM cap
      // (Round 11, dia) that master_m doesn't propagate. Mapping
      // from master_m here was bypassing both fixes — Mar 2026
      // gov export still showed the un-gated 151.5 days outlier and
      // dia values from before the cap widen. Let the chart fetch
      // from the wrapper view directly via the realCharts path.
      //
      // (No perf concern — both wrappers run sub-200ms after Round 11.)
      // 2026-08-07 — `bid_ask_spread` master_m mapper REMOVED (same pattern as
      // the nm_vs_market_cap / cap_rate_by_lease_term / seller_sentiment
      // removals above). master_m only carries avg_bid_ask_spread /
      // pct_price_change_bid_ask / avg_last_ask_cap, so mapping from it here
      // DROPPED the R66 min_last_ask_cap / max_last_ask_cap /
      // achieved_last_ask_cap columns (Data_Bid_Ask "Last Ask — Low/High" +
      // "Achieved Cap" rendered ALL-NULL) AND wiped the display_from crop
      // (Bid-Ask started 2001 instead of the registered 2015-04-30, because
      // the override replaced the already-cropped realCharts rows with
      // uncropped master_m rows). The dedicated monthly wrapper
      // cm_<vertical>_bid_ask_spread_m carries every column at monthly cadence
      // and is cropped on the realCharts path — let the chart read it directly.
      buyer_pool_breakdown: (rows) => rows.map(r => ({
        period_end: r.period_end,
        private_volume: r.private_volume,
        reit_volume: r.reit_volume,
        cross_border_volume: r.cross_border_volume,
        institutional_volume: r.institutional_volume,
        private_count: r.private_count,
        reit_count: r.reit_count,
        cross_border_count: r.cross_border_count,
        institutional_count: r.institutional_count,
      })),
      // Round 3c — Buyer_Pool_Monthly_Count (PDF dialysis p.27).
      // master_m carries per-month counts; we relabel for the deck:
      //   Private (Individual) ← private_count
      //   Institutional/Fund   ← institutional_count
      //   REIT                 ← reit_count
      // Cross-border is rolled into "Other" (kept on row but not charted).
      buyer_pool_monthly_count: (rows) => rows.map(r => ({
        period_end: r.period_end,
        private_count: r.private_count != null ? Number(r.private_count) : 0,
        institutional_count: r.institutional_count != null ? Number(r.institutional_count) : 0,
        reit_count: r.reit_count != null ? Number(r.reit_count) : 0,
        cross_border_count: r.cross_border_count != null ? Number(r.cross_border_count) : 0,
      })),
      // Round 6f — switch macro/cost-of-capital charts from per-view
      // quarterly to monthly TTM. master_m now carries treasury_10y_yield,
      // low/high_loan_constant, fed_funds_rate, mortgage_30y_rate, cpi_index
      // (joined from cm_<vertical>_macro_rates_m + cm_<vertical>_loan_constant_m).
      // User: "we want rolling monthly TTM and not quarterly data here."
      cost_of_capital: (rows) => rows.map(r => ({
        period_end: r.period_end,
        treasury_10y_yield: r.treasury_10y_yield,
        avg_cap_rate:       r.avg_cap_rate_ttm,
        cap_10plus_year:    r.cap_10plus_year,
        low_loan_constant:  r.low_loan_constant,
        high_loan_constant: r.high_loan_constant,
      })),
      // 2026-08-07 — `cash_leveraged_returns` master_m mapper REMOVED. It
      // recomputed only cash_return + leveraged_return_mid from master_m loan
      // constants, DROPPING the leveraged_return_low / leveraged_return_high
      // columns added to cm_<vertical>_returns_indexes_m (migration
      // 20260807_cm_dia_export_audit_views.sql) — so Data_Returns_Idx
      // "Leveraged High/Low" rendered ALL-NULL — and it wiped the display_from
      // crop. The extended monthly wrapper carries cash_return,
      // leveraged_return_mid/low/high at monthly cadence and is cropped on the
      // realCharts path — read it directly.
      net_lease_spread: (rows) => rows.map(r => ({
        period_end: r.period_end,
        treasury_10y_yield: r.treasury_10y_yield,
        avg_cap_rate:       r.avg_cap_rate_ttm,
        nm_avg_cap:         r.nm_avg_cap_ttm,
        non_nm_avg_cap:     r.non_nm_avg_cap_ttm,
        market_spread: (r.treasury_10y_yield != null && r.avg_cap_rate_ttm != null)
                       ? Number(r.avg_cap_rate_ttm) - Number(r.treasury_10y_yield) : null,
        nm_spread: (r.treasury_10y_yield != null && r.nm_avg_cap_ttm != null)
                   ? Number(r.nm_avg_cap_ttm) - Number(r.treasury_10y_yield) : null,
        non_nm_spread: (r.treasury_10y_yield != null && r.non_nm_avg_cap_ttm != null)
                       ? Number(r.non_nm_avg_cap_ttm) - Number(r.treasury_10y_yield) : null,
      })),
      fed_funds_vs_treasury: (rows) => rows.map(r => ({
        period_end: r.period_end,
        fed_funds_rate:    r.fed_funds_rate,
        treasury_10y_yield: r.treasury_10y_yield,
        mortgage_30y_rate: r.mortgage_30y_rate,
      })),
      // NOTE: cpi_vs_renewal_cagr deferred to Round 6g — needs a monthly
      // TTM gsa_renewal_cagr view (not yet built). Until then it stays
      // on the per-view quarterly fetch (cm_gov_cpi_vs_renewal_cagr).
    };

    // Vertical-specific mappers — fields that live on only one master_m.
    const verticalMappers = vertical === 'dialysis' ? {
      // 2026-08-07 — dialysis `seller_sentiment` master_m mapper REMOVED (gov's
      // was already removed at R12, below). master_m carries only the
      // pct_price_change / last_ask_cap cohorts, so mapping from it DROPPED the
      // n_all / n_long_term counts — Data_Sentiment "N (all)" / "N (10+ yr)"
      // rendered ALL-NULL — and wiped the display_from crop. The dedicated
      // wrapper cm_dialysis_seller_sentiment_m carries n_all + n_long_term +
      // both cohorts at monthly cadence and is gated/anchored — read it
      // directly via the realCharts path (identical treatment to gov).
      // Round 3 PDF parity (dialysis p.22): override the shared
      // cap_rate_by_lease_term mapper to expose the dialysis-specific
      // 12+/8-12/6-8/<=5 cohorts ALONGSIDE the legacy 10+/6-10/<5/outside.
      // The renderer prefers the new fields when present.
      cap_rate_by_lease_term: (rows) => rows.map(r => ({
        period_end: r.period_end,
        // Legacy gov-style (kept so other consumers don't break):
        cap_10plus: r.cap_10plus_year,
        cap_6to10: r.cap_6to10_year,
        cap_5to10: r.cap_5to10_year ?? r.cap_6to10_year,
        cap_less5: r.cap_less5_year,
        cap_outside_firm: r.cap_outside_firm,
        // NEW dialysis PDF-aligned cohorts:
        cap_12plus: r.cap_12plus_year,
        cap_8to12: r.cap_8to12_year,
        cap_6to8: r.cap_6to8_year,
        cap_5orless: r.cap_5orless_year,
      })),
    } : {
      // Round 12 — Gov `seller_sentiment` master_m mapper REMOVED.
      // Master_m has only the all-deals fields (pct_price_change_bid_ask,
      // avg_last_ask_cap); the mapper was aliasing the same field
      // twice for the "_long_term" cohort. The Round 11 rebuild of
      // cm_gov_seller_sentiment_m computes a proper long-term cohort split
      // from sales_transactions + leases — let the chart fetch from
      // that wrapper directly. ~190ms total over 303 monthly rows.
      // R73 #22 — the gov long-term cohort is the 6+ firm-yr CORE
      // (`firm_term_years >= 6` in the live view; the renderer + the
      // Data_Sentiment header label it "6+ yr"). dia keeps its 10+ core.
      // (This comment previously said "8+yr" — stale; the live bucket is 6+.)
      //
      // R45 — `cap_rate_by_credit` master_m mapper REMOVED.
      // master_m (cm_gov_market_quarterly_master_m_mat) only aggregates
      // the federal credit class; state_cap + muni_cap are NULL across
      // all 303 monthly rows. The mapper was silently overriding the
      // R44 catalog change (which repointed at the quarterly view that
      // DOES aggregate state + muni). Letting the chart fetch directly
      // from cm_gov_cap_by_credit_q via the realCharts path unblocks
      // the state + muni lines.
    };

    const monthlyMappers = { ...sharedMappers, ...verticalMappers };
    let swapped = 0;
    // Round 7 — iterate over realCharts (not the combined `charts`)
    // because synthCharts is built AFTER this loop (so synthetic
    // composers see post-mapped inputs).
    for (const c of realCharts) {
      const mapper = monthlyMappers[c.chart_template_id];
      if (mapper) {
        // CM export audit item 2 (2026-08-07) — the master_m override REPLACES
        // c.rows wholesale, which previously discarded the display_from crop +
        // as-of clamp applied on the realCharts fetch (line ~1098). master_m
        // rows run back to 2001, so every mapped sales-series sheet (Volume_TTM,
        // Cap_TTM, Count_TTM, Avg_Deal, YoY, Cap_Quartile, …) started 2001-01-31
        // instead of its registered display_from. Re-apply BOTH transforms to
        // the mapped output so a master_m-driven sheet crops exactly like a
        // realCharts-driven one.
        const df = resolveDisplayFrom(displayFromRows, c.chart_template_id, c.view_name);
        c.rows = cropRowsToDisplayFrom(
          clampRowsToAsOf(mapper(masterMonthlyRows), c, resolvedAsOf),
          c,
          df
        );
        c.cadence = 'monthly';  // hint for the renderer's window-size logic
        // CM export audit item 2 — log the resolved crop per sheet at export
        // time so a missing/way-off display_from is visible in the deploy logs.
        console.log(
          `[exportWorkbook] display_from sheet=${c.chart_template_id} ` +
          `view=${c.view_name} display_from=${df || 'none'} rows=${c.rows.length}`
        );
        swapped++;
      }
    }
    console.log(`[exportWorkbook] vertical=${vertical}: swapped ${swapped} chart_template_ids to monthly master_m data`);
  }

  // Round 7 split — synthCharts construction moved here, AFTER the
  // master_m mapper has rewritten realCharts. Synthetic composers
  // (pace_of_cap_rate_expansion, volume_cap_quartile_combo, etc.) now
  // read monthly-cadence data with the canonical field names the mappers
  // emit (ttm_weighted_cap_rate, cap_10plus, volume_dollars, ...).
  const synthCharts = syntheticTemplates.map((tmpl) => {
    const composer = syntheticRecipeFor(tmpl);
    let rows = [];
    try {
      // Round 24 — also pass masterMonthlyRows so synth composers that
      // need monthly buyer-class or quarterly-volume data can read it
      // directly. Round 15 fix for buyer_pool_monthly_count referenced
      // a non-existent `buyer_pool_breakdown` chart_template_id; this
      // gives the composer the master_m rows it really needs.
      rows = composer({
        vertical, subspecialty, asOf: as_of,
        allCharts: realCharts,
        masterMonthlyRows,
      }) || [];
    } catch { /* swallow — synthetic comp must not fail the workbook */ }
    // If any realChart this composer reads has cadence='monthly', the
    // synth output is also monthly (composer just maps row-by-row). Tag
    // accordingly so the renderer picks the monthly window/clipping.
    const upstreamMonthly = realCharts.some((c) => c.cadence === 'monthly');
    // CM export audit item 2 (2026-08-07 follow-up) — crop synthetic series to
    // their registered display_from too. Synthetic composers read masterMonthlyRows
    // (uncropped back to 2001-01-31: quarterly_volume_bars, buyer_pool_monthly_count)
    // or already-cropped realCharts (pace_of_cap_rate_expansion). The realCharts crop
    // at line ~1098 never reaches these, so a registered sales-series synthetic still
    // started 2001. Re-apply the crop here so a synthetic sales series inherits the
    // same 2007-03-31 start as the realCharts sales series. Pace's YoY-lag output
    // naturally starts ~2008, so its 2007-03-31 crop is a no-op (acceptance: pace
    // 2008-01 is fine). Best-effort: no registry row → no crop (whole history).
    const df = resolveDisplayFrom(displayFromRows, tmpl.chart_template_id, tmpl.view_name_template);
    rows = cropRowsToDisplayFrom(rows, tmpl, df);
    return {
      chart_template_id: tmpl.chart_template_id,
      name: tmpl.name,
      chart_type: tmpl.chart_type,
      data_shape: tmpl.data_shape,
      metric_focus: tmpl.metric_focus,
      cadence: tmpl.cadence === 'monthly' ? 'monthly'
             : upstreamMonthly ? 'monthly' : tmpl.cadence,
      // Round 10 — propagate vertical (see realCharts construction above).
      vertical,
      view_name: tmpl.view_name_template,
      rows,
    };
  });

  charts = [...realCharts, ...synthCharts];

  // 4b. Render the chart set to PNG images via QuickChart so each Data_* tab
  //     has a chart visual at the top alongside the data table below. This
  //     is the "chart-per-tab" layout the user asked for: ExcelJS-built
  //     workbook, brand-styled, marketing exports → opens → sees charts.
  //
  //     External service note: QuickChart receives chart configs (cap rates,
  //     volumes). Default endpoint is the public service; CM_QUICKCHART_URL
  //     can point at a self-hosted Docker instance for full data sovereignty.
  //     Per-chart graceful degradation: a render failure on one chart skips
  //     just that one chart's image (data tab still ships).
  let chartImages = null;
  try {
    chartImages = await renderChartsToImages({ charts, brand });
    console.log(`[exportWorkbook] rendered ${chartImages.length}/${charts.length} chart images`);
  } catch (e) {
    console.warn(`[exportWorkbook] chart-image render block skipped: ${e?.message || e}`);
    chartImages = [];
  }

  const filename = exportFilename({ vertical, subspecialty, asOf: resolvedAsOf });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // R66b — never cache the export at the browser/edge/proxy layer. The workbook
  // is regenerated live from the views on every request; a cached copy is the
  // source of "my export never changes even after re-downloading".
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  // 5a. Round 34 — Default is back to data_tabs (one chart per tab)
  //     per user direction: "I like the format of the Excel export
  //     with the single chart per tab we had going. I just want those
  //     exported charts to be editable and not PNG graphics." The
  //     in-flight work is now migrating the data_tabs path's charts
  //     from PNG-embed to native chart XML one chart_template_id at
  //     a time. The master_template path stays available as opt-in
  //     via ?layout=master_template for anyone who wants the
  //     consolidated-sheet version.
  //
  // Diagnostic header X-CM-Workbook-Path tells the caller which path fired.
  const layout = req.query.layout || 'data_tabs';
  const masterEligible = (vertical === 'dialysis' && layout === 'master_template');
  const masterHasRows = Array.isArray(masterMonthlyRows) && masterMonthlyRows.length > 0;

  console.log(`[exportWorkbook] vertical=${vertical} layout=${layout} masterEligible=${masterEligible} masterMonthlyRows=${masterMonthlyRows == null ? 'null' : masterMonthlyRows.length}`);

  if (masterEligible && masterHasRows) {
    try {
      const buf = await buildDialysisMasterWorkbook({
        masterRows: masterMonthlyRows,
        subspecialty,
        asOf: resolvedAsOf,
      });
      console.log(`[exportWorkbook] master_template path OK: ${buf.length} bytes from ${masterMonthlyRows.length} rows`);
      res.setHeader('X-CM-Workbook-Path', 'master_template');
      return res.status(200).send(buf);
    } catch (e) {
      // Fall through to the ExcelJS workbook if the template loader fails —
      // marketing still gets data tabs + MasterPasteReady, just without the
      // pre-wired chart objects. Log loudly so Vercel logs reveal the cause.
      console.error(`[exportWorkbook] master-template load FAILED: ${e?.message || e}`);
      if (e?.stack) console.error(e.stack);
      res.setHeader('X-CM-Workbook-Path', 'master_template_failed_fallback');
    }
  } else if (masterEligible && !masterHasRows) {
    console.warn(`[exportWorkbook] master_template skipped: monthly view returned ${masterMonthlyRows == null ? 'null' : 0} rows (verify cm_dialysis_market_quarterly_master_m exists + grant select)`);
    res.setHeader('X-CM-Workbook-Path', 'master_template_no_rows_fallback');
  } else {
    res.setHeader('X-CM-Workbook-Path', 'data_tabs');
  }

  // 5b. Default: ExcelJS-rendered workbook with data tabs + MasterPasteReady.
  // CM export audit item 5 — build-provenance for the Cover stamp. The git SHA
  // comes from the same Railway/host env vars server.js uses for /version, so
  // the workbook's stamp matches the live /version and a deployed-vs-HEAD
  // divergence is immediately visible on the deliverable.
  const provenance = {
    gitSha: (
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.RENDER_GIT_COMMIT ||
      process.env.SOURCE_VERSION ||
      'unknown'
    ),
    generatedAt: new Date().toISOString(),
    builder: 'api/capital-markets.js::exportWorkbook → cm-excel-export.js',
  };
  if (res && typeof res.setHeader === 'function') {
    res.setHeader('X-CM-Build-Sha', provenance.gitSha);
  }

  const wb = buildCapitalMarketsWorkbook({
    vertical,
    subspecialty,
    asOf: resolvedAsOf,
    charts,
    brand,
    masterRows,
    chartImages,
    provenance,
  });

  let buffer = await wb.xlsx.writeBuffer();

  // R34 — Post-process to inject native Excel chart objects for any
  // chart_template_ids in NATIVE_CHART_TEMPLATES. The workbook builder
  // already skipped the PNG embed for those, so the only chart users
  // see on those tabs is the editable native one.
  const injections = wb.nativeInjections || [];
  if (injections.length > 0) {
    try {
      const { injectNativeCharts } = await import('./_shared/cm-native-chart-injector.js');
      buffer = await injectNativeCharts(Buffer.from(buffer), injections);
      console.log(`[exportWorkbook] injected ${injections.length} native chart(s): ${injections.map(i => i.tabName).join(', ')}`);
      res.setHeader('X-CM-Native-Charts', String(injections.length));
    } catch (e) {
      console.error(`[exportWorkbook] native-chart injection failed: ${e?.message || e}`);
      // Fall back to PNG-less workbook for the migrated tabs (not ideal
      // but better than crashing the export). Tab will just lack a chart.
    }
  }

  return res.status(200).send(Buffer.from(buffer));
}

// ============================================================================
// Phase 1 — broker pattern mutation + attribution refresh
// ============================================================================

async function addBrokerPattern(req, res) {
  const { match_pattern, effective_from, effective_until, notes } = req.body || {};
  if (!match_pattern) return res.status(400).json({ error: 'match_pattern required' });

  // Insert into LCC Opps (master copy)
  const result = await opsQuery('POST', 'cm_nm_broker_patterns', {
    match_pattern,
    effective_from: effective_from || null,
    effective_until: effective_until || null,
    notes: notes || null
  });

  if (!result.ok) {
    return res.status(result.status || 500).json({ error: 'insert_failed', detail: result.data });
  }

  return res.status(201).json({
    pattern: result.data?.[0] || null,
    next_step: 'Mirror this pattern into the relevant domain DB (cm_nm_broker_patterns) and run refresh_nm_attribution.',
  });
}

/**
 * POST /api/capital-markets?action=refresh_nm_attribution&vertical=gov
 *   → calls public.cm_gov_refresh_nm_attribution() RPC on the gov DB.
 *   Returns rows_updated + pre/post-acquisition counts for sanity check.
 */
async function refreshNmAttribution(req, res) {
  const vertical = req.body?.vertical || req.query?.vertical;
  if (!vertical) return res.status(400).json({ error: 'vertical required' });

  const domain = VERTICAL_TO_DOMAIN[vertical];
  if (!domain) {
    return res.status(400).json({
      error: 'unsupported_vertical_for_refresh',
      vertical,
      supported: Object.keys(VERTICAL_TO_DOMAIN),
    });
  }

  const rpcName = vertical === 'gov' ? 'cm_gov_refresh_nm_attribution' :
                  vertical === 'dialysis' ? 'cm_dialysis_refresh_nm_attribution' : null;
  if (!rpcName) {
    return res.status(501).json({ error: 'refresh_rpc_not_implemented', vertical });
  }

  const result = await domainQuery(domain, 'POST', `rpc/${rpcName}`, {});
  if (!result.ok) {
    return res.status(result.status || 500).json({ error: 'refresh_failed', detail: result.data });
  }

  return res.status(200).json({
    vertical,
    rpc: rpcName,
    result: result.data,
  });
}

// ============================================================================
// Phase 2f — RCA TrendTracker import (national_st vertical)
// ============================================================================

/**
 * POST /api/capital-markets?action=rca_import
 *
 * Body shape (JSON):
 *   {
 *     filename:     'RCA_TrendTracker_Office.xls',
 *     product_type: 'office'|'medical'|'industrial'|'retail' (optional — parser
 *                   auto-detects from header text, but supplying it lets the
 *                   parser refuse a mismatched file from the wrong subfolder),
 *     file_b64:     '<base64-encoded .xls bytes>',
 *     notes:        'optional free-text note for cm_rca_imports.notes'
 *   }
 *
 * Flow:
 *   1. Decode base64 → Buffer
 *   2. Parse via rca-parser.js (header-driven, tolerates the 4 product
 *      shape variants we documented in 2026-05-05 recon)
 *   3. Insert lineage row into cm_rca_imports (returns import_id)
 *   4. UPSERT all parsed rows into cm_rca_quarterly with source_export_id
 *      = import_id (PK is product_type+period_end, so re-uploading a
 *      newer export naturally refreshes prior quarters)
 *   5. Patch cm_rca_imports.rows_loaded with the count
 *   6. Return summary: import_id, product_type, rows_loaded, period range,
 *      report_run_date, warnings.
 */
async function rcaImport(req, res, user) {
  const body = req.body || {};
  const { filename, file_b64, notes } = body;

  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'filename required (string)' });
  }
  if (!file_b64 || typeof file_b64 !== 'string') {
    return res.status(400).json({ error: 'file_b64 required (base64 string)' });
  }

  // Optional product hint — parser will validate against header
  let expectedProductType = null;
  if (body.product_type) {
    try {
      expectedProductType = normalizeProductType(body.product_type);
    } catch (e) {
      return res.status(400).json({ error: e.message, valid: VALID_PRODUCT_TYPES });
    }
  }

  // Decode base64 → Buffer (Vercel Hobby body limit is 4.5MB; RCA files are ~50KB)
  let buffer;
  try {
    buffer = Buffer.from(file_b64, 'base64');
    if (buffer.length === 0) throw new Error('empty buffer after base64 decode');
    if (buffer.length > 5 * 1024 * 1024) {
      throw new Error(`file too large: ${buffer.length} bytes (max 5MB)`);
    }
  } catch (e) {
    return res.status(400).json({ error: 'file_b64_decode_failed', detail: e.message });
  }

  // Parse
  let parsed;
  try {
    parsed = parseRcaExport(buffer, { expectedProductType });
  } catch (e) {
    return res.status(400).json({ error: 'rca_parse_failed', detail: e.message });
  }

  const { product_type, rows: parsedRows, report_run_date, header_signature, warnings } = parsed;

  // 1. Lineage row
  const uploadedBy = user?.email || user?.user_id || 'unknown';
  const lineageNotes = [
    notes,
    `header_signature=${header_signature}`,
    report_run_date ? `report_run=${report_run_date}` : null,
    warnings.length ? `warnings=${warnings.join('|')}` : null,
  ].filter(Boolean).join(' | ');

  const importIns = await opsQuery('POST', 'cm_rca_imports', {
    product_type,
    filename,
    rows_loaded: 0, // patched after upsert
    uploaded_by: uploadedBy,
    notes: lineageNotes || null,
  });
  if (!importIns.ok) {
    return res.status(importIns.status || 500).json({
      error: 'cm_rca_imports_insert_failed', detail: importIns.data,
    });
  }
  const importId = importIns.data?.[0]?.import_id;
  if (!importId) {
    return res.status(500).json({ error: 'no_import_id_returned', detail: importIns.data });
  }

  // 2. UPSERT rows (PK: product_type + period_end). PostgREST handles
  //    on-conflict via Prefer:resolution=merge-duplicates header.
  const rowsToUpsert = parsedRows.map((r) => ({
    ...r,
    source_export_id: importId,
  }));

  const upsert = await opsQuery(
    'POST',
    'cm_rca_quarterly',
    rowsToUpsert,
    {
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
    }
  );
  if (!upsert.ok) {
    return res.status(upsert.status || 500).json({
      error: 'cm_rca_quarterly_upsert_failed',
      detail: upsert.data,
      import_id: importId,
    });
  }

  // 3. Patch the lineage row with row count
  const rowsLoaded = Array.isArray(upsert.data) ? upsert.data.length : rowsToUpsert.length;
  await opsQuery(
    'PATCH',
    `cm_rca_imports?import_id=eq.${importId}`,
    { rows_loaded: rowsLoaded }
  );

  // 4. Compute period range for the response
  const periods = parsedRows.map((r) => r.period_end).sort();

  return res.status(201).json({
    import_id: importId,
    product_type,
    filename,
    rows_loaded: rowsLoaded,
    period_range: {
      first: periods[0] || null,
      last: periods[periods.length - 1] || null,
    },
    report_run_date,
    header_signature,
    warnings,
  });
}

// ============================================================================
// Phase 3 — Copilot stat tool
// ============================================================================

/**
 * GET /api/capital-markets?action=copilot_stat
 *   &vertical=gov&chart_template_id=cap_rate_ttm_by_quarter
 *   &as_of=2024-06-30&subspecialty=all
 *
 * Returns:
 *   {
 *     ok: true,
 *     stat_text: "Gov-leased TTM weighted cap is 7.47% as of 2024-Q2; up 32 bps YoY.",
 *     value: 0.0747,
 *     value_formatted: "7.47%",
 *     yoy_delta: 0.0032,
 *     yoy_delta_formatted: "+32 bps",
 *     direction: "up",
 *     period_end: "2024-06-30",
 *     period_label: "2024-Q2",
 *     ...
 *   }
 *
 * Composes a one-line headline metric suitable for pasting into an Outlook
 * draft or a Slack message. Reuses the same data path as fetchChart so
 * everything stays consistent (era-aware NM attribution, subspecialty filter,
 * etc.). Recipe definitions live in api/_shared/cm-stat-recipes.js.
 */
async function copilotStat(req, res) {
  const { vertical, chart_template_id, as_of, subspecialty = 'all' } = req.query;
  if (!vertical)          return res.status(400).json({ error: 'vertical required' });
  if (!chart_template_id) return res.status(400).json({ error: 'chart_template_id required' });

  const template = await resolveTemplate(chart_template_id);
  if (!template) {
    return res.status(404).json({ error: `Unknown chart_template_id: ${chart_template_id}` });
  }
  if (!template.applies_to_verticals?.includes(vertical)) {
    return res.status(400).json({
      error: `Chart '${chart_template_id}' is not applicable to vertical '${vertical}'`,
      applies_to: template.applies_to_verticals,
    });
  }

  // Same dispatch logic as fetchChart — fetch full timeseries (sorted ASC)
  const view_name = viewNameFor(template.view_name_template, vertical);
  const domain = VERTICAL_TO_DOMAIN[vertical];
  const orderCol = timeAxisColumnFor(template);
  const path = `${view_name}?select=*&subspecialty=eq.${encodeURIComponent(subspecialty)}&order=${orderCol}.asc`;

  let result;
  try {
    result = domain
      ? await domainQuery(domain, 'GET', path)
      : await opsQuery('GET', path);
  } catch (e) {
    return res.status(500).json({ error: 'view_query_threw', detail: String(e?.message || e) });
  }
  if (!result.ok) {
    return res.status(result.status || 500).json({
      error: 'view_query_failed', view_name, vertical, detail: result.data,
    });
  }

  const rows = Array.isArray(result.data) ? result.data : [];
  const stat = composeStat({
    chart_template_id,
    vertical,
    subspecialty,
    rows,
    as_of: as_of || null,
  });

  if (!stat.ok) {
    // 404 for "no data for this slice", 400 for client-side recipe issues
    const status = stat.error === 'recipe_not_implemented' ? 400 : 404;
    return res.status(status).json({
      ...stat,
      view_name,
      hint: stat.error === 'recipe_not_implemented'
        ? 'See action=copilot_stat_catalog for the supported list.'
        : undefined,
    });
  }

  return res.status(200).json({
    ...stat,
    view_name,
    chart_name: template.name,
  });
}
