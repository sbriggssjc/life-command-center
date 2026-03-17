export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const { history, years } = req.query || {};

  try {
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

    // Determine which years to fetch
    const currentYear = new Date().getFullYear();
    const numYears = Math.min(parseInt(years) || 1, 5); // max 5 years
    const yearsToFetch = [];
    for (let i = numYears - 1; i >= 0; i--) {
      yearsToFetch.push(currentYear - i);
    }

    // If history mode, return all daily entries for charting
    if (history === 'true') {
      let allEntries = [];

      for (const yr of yearsToFetch) {
        const xmlUrl = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${yr}`;
        try {
          const xmlRes = await fetch(xmlUrl, {
            headers: {
              'Accept': 'application/xml',
              'User-Agent': 'Mozilla/5.0 (compatible; LCC/1.0)'
            }
          });
          if (xmlRes.ok) {
            const text = await xmlRes.text();
            const entries = text.split('<m:properties>').slice(1);
            for (const entry of entries) {
              const parsed = parseEntry(entry);
              if (parsed.date && parsed.ten_yr !== null) {
                allEntries.push(parsed);
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to fetch year ${yr}:`, e.message);
        }
      }

      // Sort by date ascending
      allEntries.sort((a, b) => a.date.localeCompare(b.date));

      return res.status(200).json({
        history: allEntries,
        count: allEntries.length
      });
    }

    // Standard mode: return latest + previous
    const xmlUrl = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${currentYear}`;

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

    // Fallback: Treasury CSV feed
    const csvUrl = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/${currentYear}?type=daily_treasury_yield_curve&field_tdr_date_value=${currentYear}&page&_format=csv`;

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

    // Last resort fallback: Fiscal Data API for Treasury Notes (closer to yield)
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
