// api/config.js — serves public frontend config from env vars
// Only exposes ANON key (safe for frontend), never the SERVICE key

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600'); // cache 1hr

  const url     = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  return res.status(200).json({ url, anonKey });
}
