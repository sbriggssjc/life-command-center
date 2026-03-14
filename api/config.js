// Vercel serverless function: returns Supabase credentials from environment variables
// Set these in Vercel Dashboard > Settings > Environment Variables:
//   GOV_SUPABASE_KEY   - Government Supabase service role key
//   DIA_SUPABASE_KEY   - Dialysis Supabase anon key
//   DIA_SUPABASE_URL   - Dialysis Supabase URL (optional, defaults to known URL)

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  res.status(200).json({
    gov: {
      url: process.env.GOV_SUPABASE_URL || 'https://scknotsqkcheojiaewwh.supabase.co',
      key: process.env.GOV_SUPABASE_KEY || ''
    },
    dia: {
      url: process.env.DIA_SUPABASE_URL || 'https://zqzrriwuavgrquhisnoa.supabase.co',
      key: process.env.DIA_SUPABASE_KEY || ''
    }
  });
}
