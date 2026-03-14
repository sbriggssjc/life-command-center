// Serverless proxy for Government Supabase queries
// Keeps service_role key server-side — never exposed to browser
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

  // Build Supabase REST URL
  const url = new URL(`${govUrl}/rest/v1/${table}`);
  url.searchParams.set('select', select || '*');

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
  if (limit !== undefined) url.searchParams.set('limit', limit);
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

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Supabase returned ${response.status}`,
        detail: body.substring(0, 500)
      });
    }

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
