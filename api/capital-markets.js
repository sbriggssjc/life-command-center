// ============================================================================
// Capital Markets API — Cross-vertical reporting backend
// Life Command Center — Capital Markets Phase 0 (foundation)
//
// Stub for the data + chart + export endpoints that power the LCC Capital
// Markets tab and (Phase 3) the Copilot attach-chart tools. Phase 0 wires
// the routing surface and the always-available reference endpoints
// (verticals, catalog, brand). The data, render, and export endpoints
// return 501 with a clear "phase pending" message until Phase 1 lands.
//
// GET  /api/capital-markets?action=verticals
//        → cm_verticals registry list
// GET  /api/capital-markets?action=subspecialties&vertical_id=
//        → cm_subspecialties for a vertical
// GET  /api/capital-markets?action=catalog
//        → cm_chart_catalog (chart_template_id contract)
// GET  /api/capital-markets?action=brand
//        → cm_brand_tokens key/value map
// GET  /api/capital-markets?action=broker_patterns
//        → cm_nm_broker_patterns
// GET  /api/capital-markets?action=quarterly&vertical=&as_of=&subspecialty=
//        → [Phase 1] all chart-template results for a vertical/quarter
// GET  /api/capital-markets?action=chart&vertical=&chart_template_id=&as_of=&subspecialty=
//        → [Phase 1] single chart's data
// GET  /api/capital-markets?action=export&vertical=&as_of=&format=xlsx|pdf|png
//        → [Phase 2] marketing-ready workbook or per-chart PNG
// POST /api/capital-markets?action=rca_import
//        → [Phase 1] upload an RCA TrendTracker export (xls/csv)
// GET  /api/capital-markets?action=narrative&vertical=&as_of=
// POST /api/capital-markets?action=save_narrative
// POST /api/capital-markets?action=publish
//        → [Phase 2] editorial CMS for narratives + publish gate
//
// See public/reports/CAPITAL_MARKETS_ARCHITECTURE.md for the design.
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, requireOps, withErrorHandler } from './_shared/ops-db.js';

const PHASE_1_PENDING = (action) => ({
  error: 'phase_1_pending',
  action,
  message: `Endpoint '${action}' is scaffolded but Phase 1 implementation is pending. ` +
           `Phase 1 will add the cm_*_q views in each domain Supabase project plus the ` +
           `dispatch logic that fetches from the right project per chart_template_id.`,
  hint: 'See public/reports/CAPITAL_MARKETS_ARCHITECTURE.md §10 for the phase plan.'
});

const PHASE_2_PENDING = (action) => ({
  error: 'phase_2_pending',
  action,
  message: `Endpoint '${action}' is scaffolded but Phase 2 implementation is pending.`,
  hint: 'Phase 2 adds the workbook export, PNG renderer, and editorial CMS.'
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
      // Phase 0 — live now
      case 'verticals':        return listVerticals(req, res);
      case 'subspecialties':   return listSubspecialties(req, res);
      case 'catalog':          return listCatalog(req, res);
      case 'brand':            return getBrandTokens(req, res);
      case 'broker_patterns':  return listBrokerPatterns(req, res);

      // Phase 1 — scaffolded, returns 501 until views exist
      case 'quarterly':        return res.status(501).json(PHASE_1_PENDING(action));
      case 'chart':            return res.status(501).json(PHASE_1_PENDING(action));
      case 'narrative':        return res.status(501).json(PHASE_2_PENDING(action));

      // Phase 2 — exports
      case 'export':           return res.status(501).json(PHASE_2_PENDING(action));

      default:
        return res.status(400).json({
          error: 'GET actions: verticals, subspecialties, catalog, brand, broker_patterns, quarterly, chart, export, narrative'
        });
    }
  }

  if (req.method === 'POST') {
    if (!requireRole(user, 'manager', workspaceId)) {
      return res.status(403).json({ error: 'Manager role required for capital-markets writes' });
    }

    switch (action) {
      case 'rca_import':       return res.status(501).json(PHASE_1_PENDING(action));
      case 'save_narrative':   return res.status(501).json(PHASE_2_PENDING(action));
      case 'publish':          return res.status(501).json(PHASE_2_PENDING(action));
      case 'add_broker_pattern': return addBrokerPattern(req, res);

      default:
        return res.status(400).json({ error: 'POST actions: rca_import, save_narrative, publish, add_broker_pattern' });
    }
  }

  return res.status(405).json({ error: `${req.method} not allowed` });
});

// ============================================================================
// Phase 0 — live endpoints
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

  // Reshape into a nested object for easy client consumption
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

async function addBrokerPattern(req, res) {
  const { match_pattern, effective_from, effective_until, notes } = req.body || {};
  if (!match_pattern) return res.status(400).json({ error: 'match_pattern required' });

  const result = await opsQuery('POST', 'cm_nm_broker_patterns', {
    match_pattern,
    effective_from: effective_from || null,
    effective_until: effective_until || null,
    notes: notes || null
  });

  return res.status(201).json({ pattern: result.data?.[0] || null });
}
