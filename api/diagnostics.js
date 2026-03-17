// ============================================================================
// Diagnostics API — Consolidated: config, diag, treasury
// Life Command Center
//
// Routed via vercel.json rewrites:
//   /api/config   → /api/diagnostics?_route=config
//   /api/diag     → /api/diagnostics?_route=diag
//   /api/treasury → /api/diagnostics?_route=treasury
// ============================================================================

import { handleCors, authenticate } from './_shared/auth.js';
import { withErrorHandler } from './_shared/ops-db.js';

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;

  const route = req.query._route || 'config';

  switch (route) {
    case 'config':   return handleConfig(req, res);
    case 'diag':     return handleDiag(req, res);
    case 'treasury': return handleTreasury(req, res);
    default:
      return res.status(400).json({ error: 'Unknown route' });
  }
});

// ---- /api/config ----
async function handleConfig(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    gov: { connected: !!process.env.GOV_SUPABASE_KEY },
    dia: { connected: !!process.env.DIA_SUPABASE_KEY },
    ops: { connected: !!(process.env.OPS_SUPABASE_URL && process.env.OPS_SUPABASE_KEY) }
  });
}

// ---- /api/diag ----
async function handleDiag(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const user = await authenticate(req, res);
  if (!user) return;

  const secret = process.env.DIAG_SECRET || 'lcc-diag-2024';
  if (req.query.secret !== secret) {
    return res.status(403).json({ error: 'Forbidden — pass ?secret=<DIAG_SECRET>' });
  }

  const govKey = process.env.GOV_SUPABASE_KEY || '';
  const diaKey = process.env.DIA_SUPABASE_KEY || '';
  const govUrl = process.env.GOV_SUPABASE_URL;
  const diaUrl = process.env.DIA_SUPABASE_URL;

  const results = {};

  if (govUrl) {
    try {
      const r = await fetch(`${govUrl}/rest/v1/ownership_history?select=ownership_id&limit=1`, {
        headers: { 'apikey': govKey, 'Authorization': `Bearer ${govKey}` }
      });
      const body = await r.text();
      results.gov = { status: r.status, keySet: govKey.length > 0, sample: body.substring(0, 200) };
    } catch (e) {
      results.gov = { error: e.message, keySet: govKey.length > 0 };
    }
  } else {
    results.gov = { error: 'GOV_SUPABASE_URL not configured', keySet: false };
  }

  if (diaUrl) {
    try {
      const r = await fetch(`${diaUrl}/rest/v1/v_counts_freshness?select=*&limit=1`, {
        headers: { 'apikey': diaKey, 'Authorization': `Bearer ${diaKey}` }
      });
      const body = await r.text();
      results.dia = { status: r.status, keySet: diaKey.length > 0, sample: body.substring(0, 200) };
    } catch (e) {
      results.dia = { error: e.message, keySet: diaKey.length > 0 };
    }
  } else {
    results.dia = { error: 'DIA_SUPABASE_URL not configured', keySet: false };
  }

  return res.status(200).json(results);
}

// ---- /api/treasury ----
async function handleTreasury(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  try {
    const year = new Date().getFullYear();
    const xmlUrl = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;

    const xmlRes = await fetch(xmlUrl, {
      headers: {
        'Accept': 'application/xml',
        'User-Agent': 'Mozilla/5.0 (compatible; LCC/1.0)'
      }
    });

    if (xmlRes.ok) {
      const text = await xmlRes.text();
      const entries = text.split('<m:properties>').slice(1);

      if (entries.length > 0) {
        const parseEntry = (entry) => {
          const dateMatch = entry.match(/<d:NEW_DATE[^>]*>([^<]+)/);
          const tenYrMatch = entry.match(/<d:BC_10YEAR[^>]*>([^<]+)/);
          const thirtyYrMatch = entry.match(/<d:BC_30YEAR[^>]*>([^<]+)/);
          return {
            date: dateMatch ? dateMatch[1].split('T')[0] : null,
            ten_yr: tenYrMatch ? parseFloat(tenYrMatch[1]) : null,
            thirty_yr: thirtyYrMatch ? parseFloat(thirtyYrMatch[1]) : null
          };
        };

        const latest = parseEntry(entries[entries.length - 1]);
        const prev = entries.length > 1 ? parseEntry(entries[entries.length - 2]) : null;

        if (latest.ten_yr !== null) {
          return res.status(200).json({
            date: latest.date,
            ten_yr: latest.ten_yr,
            thirty_yr: latest.thirty_yr,
            prev_date: prev ? prev.date : null,
            prev_ten_yr: prev ? prev.ten_yr : null,
          });
        }
      }
    }

    const csvUrl = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/${year}?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;

    const csvRes = await fetch(csvUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    if (csvRes.ok) {
      const csvText = await csvRes.text();
      const lines = csvText.trim().split('\n').filter(l => l.trim());

      if (lines.length >= 2) {
        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
        const tenIdx = headers.findIndex(h => h === '10 Yr');
        const thirtyIdx = headers.findIndex(h => h === '30 Yr');

        if (tenIdx >= 0) {
          const lastRow = lines[lines.length - 1].split(',').map(v => v.replace(/"/g, '').trim());
          const prevRow = lines.length > 2 ? lines[lines.length - 2].split(',').map(v => v.replace(/"/g, '').trim()) : null;

          return res.status(200).json({
            date: lastRow[0],
            ten_yr: parseFloat(lastRow[tenIdx]) || null,
            thirty_yr: thirtyIdx >= 0 ? (parseFloat(lastRow[thirtyIdx]) || null) : null,
            prev_date: prevRow ? prevRow[0] : null,
            prev_ten_yr: prevRow ? (parseFloat(prevRow[tenIdx]) || null) : null,
          });
        }
      }
    }

    const fiscalUrl = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=2&fields=record_date,avg_interest_rate_amt,security_desc&filter=security_desc:eq:Treasury Notes';

    const fiscalRes = await fetch(fiscalUrl, {
      headers: { 'Accept': 'application/json' }
    });

    if (fiscalRes.ok) {
      const json = await fiscalRes.json();
      const rows = json.data || [];
      if (rows.length >= 1) {
        const latest = rows[0];
        const prev = rows.length > 1 ? rows[1] : null;
        return res.status(200).json({
          date: latest.record_date,
          ten_yr: parseFloat(latest.avg_interest_rate_amt) || null,
          thirty_yr: null,
          prev_date: prev ? prev.record_date : null,
          prev_ten_yr: prev ? (parseFloat(prev.avg_interest_rate_amt) || null) : null,
        });
      }
    }

    return res.status(500).json({ error: 'No data from any Treasury source' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
