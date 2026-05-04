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
// POST /api/capital-markets?action=rca_import                              [Phase 2]
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, requireOps, withErrorHandler } from './_shared/ops-db.js';
import { domainQuery } from './_shared/domain-db.js';

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
      case 'export':           return res.status(501).json(PHASE_2_PENDING(action));

      default:
        return res.status(400).json({
          error: 'GET actions: verticals, subspecialties, catalog, brand, broker_patterns, chart, quarterly, export, narrative'
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
      case 'rca_import':             return res.status(501).json(PHASE_2_PENDING(action));
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
  if (phase)    filters.push(`phase=eq.${parseInt(phase, 10)}`);
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
 * GET /api/capital-markets?action=chart&vertical=gov&chart_template_id=volume_ttm_by_quarter&subspecialty=all&from=&to=
 *   → { rows: [...], meta: { chart_template_id, vertical, view_name, ... } }
 */
async function fetchChart(req, res) {
  const { chart_template_id, vertical, subspecialty = 'all', from, to } = req.query;
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

  const view_name = viewNameFor(template.view_name_template, vertical);
  const domain = VERTICAL_TO_DOMAIN[vertical];

  // Build PostgREST query
  const parts = [`select=*`];
  parts.push(`subspecialty=eq.${encodeURIComponent(subspecialty)}`);
  if (from) parts.push(`period_end=gte.${from}`);
  if (to)   parts.push(`period_end=lte.${to}`);
  parts.push(`order=period_end.asc`);
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

  // 2. Fetch each chart's data in parallel
  const domain = VERTICAL_TO_DOMAIN[vertical];
  const queries = templates.map(async (tmpl) => {
    const view_name = viewNameFor(tmpl.view_name_template, vertical);
    const parts = [`select=*`, `subspecialty=eq.${encodeURIComponent(subspecialty)}`];
    parts.push(`order=period_end.asc`);
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
        view_name,
        ok: false,
        rows: [],
        error: String(e?.message || e),
      };
    }
  });

  const charts = await Promise.all(queries);

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
