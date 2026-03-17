import { handleCors, authenticate } from './_shared/auth.js';
import { withErrorHandler } from './_shared/ops-db.js';

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Require authentication — diagnostic data should not be publicly accessible
  const user = await authenticate(req, res);
  if (!user) return;

  // Additionally require a secret token for defense-in-depth
  const secret = process.env.DIAG_SECRET || 'lcc-diag-2024';
  if (req.query.secret !== secret) {
    return res.status(403).json({ error: 'Forbidden — pass ?secret=<DIAG_SECRET>' });
  }

  const govKey = process.env.GOV_SUPABASE_KEY || '';
  const diaKey = process.env.DIA_SUPABASE_KEY || '';
  const govUrl = process.env.GOV_SUPABASE_URL;
  const diaUrl = process.env.DIA_SUPABASE_URL;

  const results = {};

  // Test gov connection
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

  // Test dia connection
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
});
