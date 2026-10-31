const LIMIT=12;
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
 const type=req.query.type==='tv'?'tv':'movie';
 const q=String(req.query.q||'').trim();
 if(q.length<2||q.length>100)return res.status(400).json({error:'Escribe al menos 2 caracteres.'});
 const key=process.env.TMDB_API_KEY;
 if(!key)return res.status(503).json({error:'La búsqueda aún no está configurada.'});
 try{
  const url=`https://api.themoviedb.org/3/search/${type}?query=${encodeURIComponent(q)}&language=es-MX&include_adult=false&page=1`;
  const r=await fetch(url,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(8500)});
  if(!r.ok)return res.status(502).json({error:'TMDB no respondió correctamente.'});
  const d=await r.json();
  const results=(d.results||[]).filter(x=>Number.isSafeInteger(x.id)&&x.id>0).slice(0,LIMIT).map(x=>({id:x.id,title:String(x.title||x.name||'').slice(0,200),year:String(x.release_date||x.first_air_date||'').slice(0,4),poster:/^\/[\w./-]+$/.test(x.poster_path||'')?x.poster_path:null}));
  res.status(200).json({results});
 }catch(e){res.status(502).json({error:'No fue posible buscar en TMDB.'})}
};
