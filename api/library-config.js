module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_ANON_KEY;
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url||'') || !key)return res.status(503).json({error:'Configure SUPABASE_URL y SUPABASE_ANON_KEY en Vercel'});
  return res.status(200).json({url:url.replace(/\/$/,''),anonKey:key});
};
