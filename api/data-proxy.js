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

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

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
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'apikey': dbKey,
        'Authorization': `Bearer ${dbKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'count=exact'
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
