export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

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
    results.gov = { status: r.status, keyLen: govKey.length, sample: body.substring(0, 200) };
  } catch (e) {
    results.gov = { error: e.message, keyLen: govKey.length };
  }

  // Test dia connection
  try {
    const r = await fetch(`${diaUrl}/rest/v1/v_counts_freshness?select=*&limit=1`, {
      headers: { 'apikey': diaKey, 'Authorization': `Bearer ${diaKey}` }
    });
    const body = await r.text();
    results.dia = { status: r.status, keyLen: diaKey.length, sample: body.substring(0, 200) };
  } catch (e) {
    results.dia = { error: e.message, keyLen: diaKey.length };
  }

  return res.status(200).json(results);
}
