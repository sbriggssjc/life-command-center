// Serverless proxy for Government Supabase queries
// Keeps service_role key server-side — never exposed to browser
// Hardened with table allowlist and input validation
import {
  GOV_READ_TABLES, GOV_WRITE_TABLES,
  isAllowedTable, safeLimit, safeSelect
} from './_shared/allowlist.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Prefer');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const govKey = process.env.GOV_SUPABASE_KEY;
  const govUrl = process.env.GOV_SUPABASE_URL || 'https://scknotsqkcheojiaewwh.supabase.co';

  if (!govKey) {
    return res.status(500).json({ error: 'GOV_SUPABASE_KEY not configured' });
  }

  const { table, select, filter, order, limit, offset } = req.query;

  if (!table) {
    return res.status(400).json({ error: 'table parameter required' });
  }

  // Handle POST/PATCH requests (for inserts/upserts/updates and RPC calls)
  if (req.method === 'POST' || req.method === 'PATCH') {
    // Validate table against write allowlist
    if (!isAllowedTable(table, GOV_WRITE_TABLES)) {
      return res.status(403).json({ error: `Write access denied for table: ${table}` });
    }

    const isRpc = table.startsWith('rpc/');
    // Honor client's Prefer header — needed for POST return=representation (ownership save)
    const clientPrefer = req.headers['prefer'] || '';
    const wantsRepresentation = clientPrefer.includes('return=representation');
    try {
      // Build URL with query filters for PATCH
      let patchUrl = `${govUrl}/rest/v1/${table}`;
      if (filter) {
        const eqIdx = filter.indexOf('=');
        if (eqIdx > 0) {
          const col = filter.substring(0, eqIdx);
          const val = filter.substring(eqIdx + 1);
          patchUrl += `?${encodeURIComponent(col)}=${encodeURIComponent(val)}`;
        }
      }
      // Support additional filters via query params
      const { filter2 } = req.query;
      if (filter2) {
        const eqIdx = filter2.indexOf('=');
        if (eqIdx > 0) {
          const col = filter2.substring(0, eqIdx);
          const val = filter2.substring(eqIdx + 1);
          patchUrl += `${patchUrl.includes('?') ? '&' : '?'}${encodeURIComponent(col)}=${encodeURIComponent(val)}`;
        }
      }

      // Determine Prefer header: RPC and client-requested representation get return=representation
      let preferHeader = 'return=minimal';
      if (isRpc || wantsRepresentation) preferHeader = 'return=representation';

      const response = await fetch(patchUrl, {
        method: req.method,
        headers: {
          'apikey': govKey,
          'Authorization': `Bearer ${govKey}`,
          'Content-Type': 'application/json',
          'Prefer': preferHeader
        },
        body: JSON.stringify(req.body)
      });

      if (!response.ok) {
        const errBody = await response.text();
        return res.status(response.status).json({ error: errBody });
      }

      // If representation was requested (RPC or client), return the created/updated record
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

  // Validate table against read allowlist
  if (!isAllowedTable(table, GOV_READ_TABLES)) {
    return res.status(403).json({ error: `Read access denied for table: ${table}` });
  }

  // Build Supabase REST URL with validated inputs
  const url = new URL(`${govUrl}/rest/v1/${table}`);
  url.searchParams.set('select', safeSelect(select));

  if (filter) {
    // filter format: "column=eq.value" or "column=value"
    const eqIdx = filter.indexOf('=');
    if (eqIdx > 0) {
      const col = filter.substring(0, eqIdx);
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
        'apikey': govKey,
        'Authorization': `Bearer ${govKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'count=exact'
      }
    });

    const body = await response.text();

    // Forward the content-range header for count info
    const contentRange = response.headers.get('content-range');

    if (!response.ok) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(response.status).json({
        error: `Supabase returned ${response.status}`,
        detail: body.substring(0, 500)
      });
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

    // Return data with count from content-range
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
