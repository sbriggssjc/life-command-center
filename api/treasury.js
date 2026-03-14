export default async function handler(req, res) {
  // Use the Fiscal Data API (reliable for server-side access)
  const url = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=2&fields=record_date,avg_interest_rate_amt,security_desc&filter=security_desc:eq:Treasury Bonds';

  try {
    // Try Fiscal Data API first
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (response.ok) {
      const json = await response.json();
      const rows = json.data || [];

      if (rows.length >= 1) {
        const latest = rows[0];
        const prev = rows.length > 1 ? rows[1] : null;

        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(200).json({
          date: latest.record_date,
          ten_yr: parseFloat(latest.avg_interest_rate_amt) || null,
          thirty_yr: null,
          prev_date: prev ? prev.record_date : null,
          prev_ten_yr: prev ? (parseFloat(prev.avg_interest_rate_amt) || null) : null,
        });
      }
    }

    // Fallback: try the Treasury yield curve CSV
    const year = new Date().getFullYear();
    const csvUrl = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/${year}?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;

    const csvRes = await fetch(csvUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const text = await csvRes.text();
    const lines = text.trim().split('\n').filter(l => l.trim());

    if (lines.length < 2) {
      return res.status(500).json({ error: 'No data from either Treasury API' });
    }

    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const tenIdx = headers.findIndex(h => h === '10 Yr');
    const thirtyIdx = headers.findIndex(h => h === '30 Yr');

    if (tenIdx < 0) {
      return res.status(500).json({ error: '10 Yr column not found', headers });
    }

    const lastRow = lines[lines.length - 1].split(',').map(v => v.replace(/"/g, '').trim());
    const prevRow = lines.length > 2 ? lines[lines.length - 2].split(',').map(v => v.replace(/"/g, '').trim()) : null;

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({
      date: lastRow[0],
      ten_yr: parseFloat(lastRow[tenIdx]) || null,
      thirty_yr: thirtyIdx >= 0 ? (parseFloat(lastRow[thirtyIdx]) || null) : null,
      prev_date: prevRow ? prevRow[0] : null,
      prev_ten_yr: prevRow ? (parseFloat(prevRow[tenIdx]) || null) : null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
