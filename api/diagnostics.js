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

function parseXmlEntry(entry) {
  const dateMatch = entry.match(/<d:NEW_DATE[^>]*>([^<]+)/);
  const tenYrMatch = entry.match(/<d:BC_10YEAR[^>]*>([^<]+)/);
  const thirtyYrMatch = entry.match(/<d:BC_30YEAR[^>]*>([^<]+)/);
  return {
    date: dateMatch ? dateMatch[1].split('T')[0] : null,
    ten_yr: tenYrMatch ? parseFloat(tenYrMatch[1]) : null,
    thirty_yr: thirtyYrMatch ? parseFloat(thirtyYrMatch[1]) : null
  };
}

async function fetchXmlYear(year) {
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/xml', 'User-Agent': 'Mozilla/5.0 (compatible; LCC/1.0)' }
    });
    if (!res.ok) return [];
    const text = await res.text();
    const entries = text.split('<m:properties>').slice(1);
    return entries.map(parseXmlEntry).filter(e => e.date && e.ten_yr !== null);
  } catch {
    return [];
  }
}

async function fetchCsvYear(year) {
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/${year}?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!res.ok) return [];
    const csvText = await res.text();
    const lines = csvText.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const tenIdx = headers.findIndex(h => h === '10 Yr');
    const thirtyIdx = headers.findIndex(h => h === '30 Yr');
    if (tenIdx < 0) return [];
    return lines.slice(1).map(line => {
      const cols = line.split(',').map(v => v.replace(/"/g, '').trim());
      const tenVal = parseFloat(cols[tenIdx]);
      if (isNaN(tenVal)) return null;
      // CSV date is MM/DD/YYYY — normalize to YYYY-MM-DD
      const parts = cols[0].split('/');
      const isoDate = parts.length === 3
        ? `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`
        : cols[0];
      return {
        date: isoDate,
        ten_yr: tenVal,
        thirty_yr: thirtyIdx >= 0 ? (parseFloat(cols[thirtyIdx]) || null) : null
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function handleTreasury(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const wantHistory = req.query.history === 'true';
  const numYears = Math.min(parseInt(req.query.years, 10) || 1, 5);
  const currentYear = new Date().getFullYear();

  try {
    if (wantHistory) {
      // Fetch XML for each requested year in parallel
      const years = [];
      for (let i = 0; i < numYears; i++) years.push(currentYear - i);
      let allEntries = (await Promise.all(years.map(fetchXmlYear))).flat();

      // Fallback to CSV if XML returned nothing
      if (allEntries.length === 0) {
        allEntries = (await Promise.all(years.map(fetchCsvYear))).flat();
      }

      // Sort chronologically
      allEntries.sort((a, b) => a.date.localeCompare(b.date));

      return res.status(200).json({ history: allEntries });
    }

    // --- Latest data point mode (unchanged logic) ---
    const entries = await fetchXmlYear(currentYear);
    if (entries.length > 0) {
      const latest = entries[entries.length - 1];
      const prev = entries.length > 1 ? entries[entries.length - 2] : null;
      return res.status(200).json({
        date: latest.date,
        ten_yr: latest.ten_yr,
        thirty_yr: latest.thirty_yr,
        prev_date: prev ? prev.date : null,
        prev_ten_yr: prev ? prev.ten_yr : null,
      });
    }

    // CSV fallback for latest
    const csvEntries = await fetchCsvYear(currentYear);
    if (csvEntries.length > 0) {
      const latest = csvEntries[csvEntries.length - 1];
      const prev = csvEntries.length > 1 ? csvEntries[csvEntries.length - 2] : null;
      return res.status(200).json({
        date: latest.date,
        ten_yr: latest.ten_yr,
        thirty_yr: latest.thirty_yr,
        prev_date: prev ? prev.date : null,
        prev_ten_yr: prev ? prev.ten_yr : null,
      });
    }

    // Fiscal Data API last resort
    const fiscalUrl = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=2&fields=record_date,avg_interest_rate_amt,security_desc&filter=security_desc:eq:Treasury Notes';
    const fiscalRes = await fetch(fiscalUrl, { headers: { 'Accept': 'application/json' } });
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
