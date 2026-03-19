// ============================================================================
// Data Proxy API — Consolidated: gov-query, dia-query
// Life Command Center
//
// Routed via vercel.json rewrites:
//   /api/gov-query → /api/data-proxy?_source=gov
//   /api/dia-query → /api/data-proxy?_source=dia
// ============================================================================

import {
  GOV_READ_TABLES, GOV_WRITE_TABLES,
  DIA_READ_TABLES, DIA_WRITE_TABLES,
  GOV_WRITE_SERVICE_TABLES,
  isAllowedTable, safeLimit, safeSelect, safeColumn
} from './_shared/allowlist.js';
import { authenticate, requireRole, primaryWorkspace, handleCors } from './_shared/auth.js';

const SOURCE_CONFIG = {
  gov: {
    urlEnv: 'GOV_SUPABASE_URL',
    keyEnv: 'GOV_SUPABASE_KEY',
    readTables: GOV_READ_TABLES,
    writeTables: GOV_WRITE_TABLES,
    label: 'GOV'
  },
  dia: {
    urlEnv: 'DIA_SUPABASE_URL',
    keyEnv: 'DIA_SUPABASE_KEY',
    readTables: DIA_READ_TABLES,
    writeTables: DIA_WRITE_TABLES,
    label: 'DIA'
  }
};

// ── Gov Write Service sub-handler ──
const GOV_API_URL = process.env.GOV_API_URL;
const GOV_WRITE_ENDPOINT_MAP = {
  'ownership':        '/api/write/ownership',
  'lead-research':    '/api/write/lead-research',
  'financial':        '/api/write/financial',
  'resolve-pending':  '/api/pending-updates'
};

async function handleGovWrite(req, res, user) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const ws = primaryWorkspace(user);
  if (!ws || !requireRole(user, 'operator', ws.workspace_id)) {
    return res.status(403).json({ error: 'Operator role required for government writes' });
  }

  if (!GOV_API_URL) {
    return res.status(503).json({ error: 'GOV_API_URL not configured' });
  }

  const { endpoint, update_id } = req.query;
  if (!endpoint || !GOV_WRITE_ENDPOINT_MAP[endpoint]) {
    return res.status(400).json({
      error: `Invalid endpoint. Use: ${Object.keys(GOV_WRITE_ENDPOINT_MAP).join(', ')}`
    });
  }

  let govPath = GOV_WRITE_ENDPOINT_MAP[endpoint];
  if (endpoint === 'resolve-pending') {
    if (!update_id) {
      return res.status(400).json({ error: 'update_id query parameter required for resolve-pending' });
    }
    govPath = `${govPath}/${encodeURIComponent(update_id)}/resolve`;
  }

  const govUrl = `${GOV_API_URL.replace(/\/+$/, '')}${govPath}`;
  const body = {
    ...req.body,
    source_app: 'lcc',
    actor: user.email || user.display_name || user.id
  };

  try {
    const response = await fetch(govUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Source-App': 'lcc',
        'X-LCC-User': user.id
      },
      body: JSON.stringify(body)
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Gov write service returned ${response.status}`,
        detail: data
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error(`[gov-write] Error calling ${govUrl}:`, err.message);
    return res.status(502).json({
      error: 'Failed to reach government write service',
      message: process.env.LCC_ENV === 'development' ? err.message : undefined
    });
  }
}

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  // Route to gov-write sub-handler if requested
  if (req.query._route === 'gov-write') {
    return handleGovWrite(req, res, user);
  }

  if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const ws = primaryWorkspace(user);
  if (!ws || !requireRole(user, 'viewer', ws.workspace_id)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  if (req.method === 'POST' || req.method === 'PATCH') {
    if (!requireRole(user, 'operator', ws.workspace_id)) {
      return res.status(403).json({ error: 'Write access requires operator role or higher' });
    }
  }

  const source = req.query._source;
  const cfg = SOURCE_CONFIG[source];
  if (!cfg) {
    return res.status(400).json({ error: 'Invalid _source. Must be gov or dia.' });
  }

  const dbUrl = process.env[cfg.urlEnv];
  const dbKey = process.env[cfg.keyEnv];
  if (!dbUrl) return res.status(500).json({ error: `${cfg.label}_SUPABASE_URL not configured` });
  if (!dbKey) return res.status(500).json({ error: `${cfg.label}_SUPABASE_KEY not configured` });

  const { table, select, filter, order, limit, offset } = req.query;
  if (!table) return res.status(400).json({ error: 'table parameter required' });

  // Handle POST/PATCH (writes and RPC)
  if (req.method === 'POST' || req.method === 'PATCH') {
    if (!isAllowedTable(table, cfg.writeTables)) {
      return res.status(403).json({ error: `Write access denied for table: ${table}` });
    }

    // Government domain tables must use write services instead of raw proxy writes
    if (source === 'gov' && GOV_WRITE_SERVICE_TABLES.has(table)) {
      const serviceHint = table === 'prospect_leads' || table === 'rpc/upsert_lead'
        ? 'lead-research' : table === 'research_queue_outcomes' || table === 'rpc/save_research_outcome'
        ? 'lead-research' : 'ownership';
      return res.status(400).json({
        error: `Government domain writes to "${table}" must use the write service endpoint.`,
        hint: `POST /api/gov-write?endpoint=${serviceHint}`,
        docs: 'Government closed-loop write services handle propagation, provenance, and change journaling.'
      });
    }

    const isRpc = table.startsWith('rpc/');
    const clientPrefer = req.headers['prefer'] || '';
    const wantsRepresentation = clientPrefer.includes('return=representation');

    try {
      let patchUrl = `${dbUrl}/rest/v1/${table}`;
      if (filter) {
        const eqIdx = filter.indexOf('=');
        if (eqIdx > 0) {
          const col = safeColumn(filter.substring(0, eqIdx));
          if (!col) return res.status(400).json({ error: 'Invalid column name in filter' });
          const val = filter.substring(eqIdx + 1);
          patchUrl += `?${encodeURIComponent(col)}=${encodeURIComponent(val)}`;
        }
      }
      const { filter2 } = req.query;
      if (filter2) {
        const eqIdx = filter2.indexOf('=');
        if (eqIdx > 0) {
          const col = safeColumn(filter2.substring(0, eqIdx));
          if (!col) return res.status(400).json({ error: 'Invalid column name in filter2' });
          const val = filter2.substring(eqIdx + 1);
          patchUrl += `${patchUrl.includes('?') ? '&' : '?'}${encodeURIComponent(col)}=${encodeURIComponent(val)}`;
        }
      }

      let preferHeader = 'return=minimal';
      if (isRpc || wantsRepresentation) preferHeader = 'return=representation';

      const response = await fetch(patchUrl, {
        method: req.method,
        headers: {
          'apikey': dbKey,
          'Authorization': `Bearer ${dbKey}`,
          'Content-Type': 'application/json',
          'Prefer': preferHeader
        },
        body: JSON.stringify(req.body)
      });

      if (!response.ok) {
        const errBody = await response.text();
        return res.status(response.status).json({ error: errBody });
      }

      if (isRpc || wantsRepresentation) {
        const body = await response.text();
        try {
          const data = JSON.parse(body);
          return res.status(req.method === 'POST' ? 201 : 200).json(Array.isArray(data) ? data : [data]);
        } catch {
          return res.status(req.method === 'POST' ? 201 : 200).json([]);
        }
      }

      return res.status(req.method === 'POST' ? 201 : 200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // GET (read queries)
  if (!isAllowedTable(table, cfg.readTables)) {
    return res.status(403).json({ error: `Read access denied for table: ${table}` });
  }

  const url = new URL(`${dbUrl}/rest/v1/${table}`);
  url.searchParams.set('select', safeSelect(select));

  if (filter) {
    const eqIdx = filter.indexOf('=');
    if (eqIdx > 0) {
      const col = safeColumn(filter.substring(0, eqIdx));
      if (!col) return res.status(400).json({ error: 'Invalid column name in filter' });
      const val = filter.substring(eqIdx + 1);
      url.searchParams.set(col, val);
    }
  }

  if (order) url.searchParams.set('order', order);
  url.searchParams.set('limit', safeLimit(limit));
  if (offset !== undefined) url.searchParams.set('offset', offset);

  try {
    const wantCount = req.query.count !== 'false';
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'apikey': dbKey,
        'Authorization': `Bearer ${dbKey}`,
        'Content-Type': 'application/json',
        ...(wantCount ? { 'Prefer': 'count=exact' } : {})
      }
    });

    const body = await response.text();
    const contentRange = response.headers.get('content-range');

    if (!response.ok) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(response.status).json({
        error: `Supabase returned ${response.status}`,
        detail: body.substring(0, 500)
      });
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

    let count = 0;
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)/);
      if (match) count = parseInt(match[1], 10);
    }

    const data = JSON.parse(body);
    return res.status(200).json({ data: Array.isArray(data) ? data : [], count });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
