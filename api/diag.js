export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Require a secret to prevent casual access to diagnostic data
  const secret = process.env.DIAG_SECRET || 'lcc-diag-2024';
  if (req.query.secret !== secret) {
    return res.status(403).json({ error: 'Forbidden — pass ?secret=<DIAG_SECRET>' });
  }

  const govKey = process.env.GOV_SUPABASE_KEY || '';
  const diaKey = process.env.DIA_SUPABASE_KEY || '';
  const govUrl = process.env.GOV_SUPABASE_URL || 'https://scknotsqkcheojiaewwh.supabase.co';
  const diaUrl = process.env.DIA_SUPABASE_URL || 'https://zqzrriwuavgrquhisnoa.supabase.co';

  const results = {};

  // Test gov connection
  try {
    const r = await fetch(`${govUrl}/rest/v1/ownership_history?select=ownership_id&limit=1`, {
      headers: { 'apikey': govKey, 'Authorization': `Bearer ${govKey}` }
    });
    const body = await r.text();
    results.gov = { status: r.status, keySet: govKey.length > 0, sample: body.substring(0, 200) };
  } catch (e) {
    results.gov = { error: e.message, keySet: govKey.length > 0 };
  }

  // Test dia connection
  try {
    const r = await fetch(`${diaUrl}/rest/v1/v_counts_freshness?select=*&limit=1`, {
      headers: { 'apikey': diaKey, 'Authorization': `Bearer ${diaKey}` }
    });
    const body = await r.text();
    results.dia = { status: r.status, keySet: diaKey.length > 0, sample: body.substring(0, 200) };
  } catch (e) {
    results.dia = { error: e.message, keySet: diaKey.length > 0 };
  }

  return res.status(200).json(results);
}
