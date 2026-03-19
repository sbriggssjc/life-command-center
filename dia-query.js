// Serverless proxy for Dialysis Supabase queries
// Keeps secret key server-side — never exposed to browser
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const diaKey = process.env.DIA_SUPABASE_KEY;
  const diaUrl = process.env.DIA_SUPABASE_URL || 'https://zqzrriwuavgrquhisnoa.supabase.co';

  if (!diaKey) {
    return res.status(500).json({ error: 'DIA_SUPABASE_KEY not configured' });
  }

  const { table, select, filter, filter2, order, limit, offset } = req.query;

  if (!table) {
    return res.status(400).json({ error: 'table parameter required' });
  }

  // Handle POST/PATCH requests (for inserts/upserts/updates)
  if (req.method === 'POST' || req.method === 'PATCH') {
    try {
      // Build URL with query filters for PATCH
      let patchUrl = `${diaUrl}/rest/v1/${table}`;
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

      const response = await fetch(patchUrl, {
        method: req.method,
        headers: {
          'apikey': diaKey,
          'Authorization': `Bearer ${diaKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(req.body)
      });

      if (!response.ok) {
        const errBody = await response.text();
        return res.status(response.status).json({ error: errBody });
      }

      return res.status(req.method === 'POST' ? 201 : 200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // GET requests (queries)
  const url = new URL(`${diaUrl}/rest/v1/${table}`);
  url.searchParams.set('select', select || '*');

  if (filter) {
    const eqIdx = filter.indexOf('=');
    if (eqIdx > 0) {
      const col = filter.substring(0, eqIdx);
      const val = filter.substring(eqIdx + 1);
      url.searchParams.set(col, val);
    }
  }

  if (filter2) {
    const eqIdx = filter2.indexOf('=');
    if (eqIdx > 0) {
      const col = filter2.substring(0, eqIdx);
      const val = filter2.substring(eqIdx + 1);
      url.searchParams.set(col, val);
    }
  }

  if (order) url.searchParams.set('order', order);
  if (limit !== undefined) url.searchParams.set('limit', limit);
  if (offset !== undefined) url.searchParams.set('offset', offset);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'apikey': diaKey,
        'Authorization': `Bearer ${diaKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'count=exact'
      }
    });

    const body = await response.text();
    const contentRange = response.headers.get('content-range');

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Supabase returned ${response.status}`,
        detail: body.substring(0, 500)
      });
    }

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
