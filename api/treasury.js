export default async function handler(req, res) {
  const year = new Date().getFullYear();
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/${year}?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LCC/1.0)' }
    });
    const text = await response.text();
    const lines = text.trim().split('\n').filter(l => l.trim());

    if (lines.length < 2) {
      return res.status(500).json({ error: 'No data returned from Treasury' });
    }

    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const tenIdx = headers.findIndex(h => h === '10 Yr');
    const thirtyIdx = headers.findIndex(h => h === '30 Yr');

    if (tenIdx < 0) {
      return res.status(500).json({ error: '10 Yr column not found', headers });
    }

    const lastRow = lines[lines.length - 1].split(',').map(v => v.replace(/"/g, '').trim());
    const prevRow = lines.length > 2 ? lines[lines.length - 2].split(',').map(v => v.replace(/"/g, '').trim()) : null;

    const result = {
      date: lastRow[0],
      ten_yr: parseFloat(lastRow[tenIdx]) || null,
      thirty_yr: thirtyIdx >= 0 ? (parseFloat(lastRow[thirtyIdx]) || null) : null,
      prev_date: prevRow ? prevRow[0] : null,
      prev_ten_yr: prevRow ? (parseFloat(prevRow[tenIdx]) || null) : null,
    };

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
