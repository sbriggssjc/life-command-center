// Vercel serverless function: reports connection status
// Keys stay server-side — never sent to browser
import { handleCors } from './_shared/auth.js';
import { withErrorHandler } from './_shared/ops-db.js';

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  res.setHeader('Cache-Control', 'no-store');

  res.status(200).json({
    gov: {
      connected: !!process.env.GOV_SUPABASE_KEY
    },
    dia: {
      connected: !!process.env.DIA_SUPABASE_KEY
    },
    ops: {
      connected: !!(process.env.OPS_SUPABASE_URL && process.env.OPS_SUPABASE_KEY)
    }
  });
});
