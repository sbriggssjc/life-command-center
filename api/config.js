// Vercel serverless function: reports connection status
// Keys stay server-side — never sent to browser
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  res.status(200).json({
    gov: {
      connected: !!process.env.GOV_SUPABASE_KEY
    },
    dia: {
      connected: !!process.env.DIA_SUPABASE_KEY
    }
  });
}
