// API de lectura del catálogo publicado y aprobación autenticada.
module.exports = async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Método no permitido'});
 const url=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY,anon=process.env.SUPABASE_ANON_KEY;
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)||!key||!anon)return res.status(503).json({error:'Supabase no configurado'});
 const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'};
 const read=async(path,method='GET',body)=>{
  const r=await fetch(url+'/rest/v1/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(16000)});
  const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.message||d?.error||'Supabase '+r.status);return d;
 };
 try{
  if(req.method==='POST'){
   const bearer=/^Bearer (.+)$/i.exec(req.headers.authorization||'');
   if(!bearer)return res.status(401).json({error:'Inicia sesión'});
   const u=await fetch(url+'/auth/v1/user',{headers:{apikey:anon,Authorization:'Bearer '+bearer[1]},signal:AbortSignal.timeout(9000)});
   if(!u.ok)return res.status(401).json({error:'Sesión caducada'});
   const user=await u.json();if(!user.id||!user.email_confirmed_at)return res.status(403).json({error:'Usuario no verificado'});
   const a=await read('mmhd_library_admins?select=user_id&user_id=eq.'+encodeURIComponent(user.id));
   if(!a.length)return res.status(403).json({error:'Sin permisos de administración'});
   const p=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
   if(p.action==='publish'){
     const ids=Array.isArray(p.ids)?[...new Set(p.ids.map(String))]:[];
     if(!ids.length||ids.length>100||ids.some(id=>!id||id.length>120))return res.status(400).json({error:'Identificadores inválidos; máximo 100 por lote'});
     const result=await read('rpc/mmhd_public_publish_snapshot','POST',{p_ids:ids,p_actor:user.id});
     return res.status(200).json(result);
   }
   if(p.action==='unpublish'){
    const id=String(p.id||'');if(!id||id.length>120)return res.status(400).json({error:'ID inválido'});
    const r=await fetch(url+'/rest/v1/mmhd_public_titles?id=eq.'+encodeURIComponent(id),{method:'PATCH',headers,body:JSON.stringify({enabled:false}),signal:AbortSignal.timeout(9000)});
    if(!r.ok)throw Error('No se pudo retirar la publicación');return res.status(200).json({ok:true});
   }
   if(p.action==='list'){const data=await read('rpc/mmhd_public_status','POST',{});return res.status(200).json(data);}
   return res.status(400).json({error:'Acción desconocida'});
  }
  const published=await read('mmhd_public_titles?select=id,enabled&limit=5000');
  const ids=published.filter(x=>x.enabled).map(x=>String(x.id));
  const config=await read('mmhd_public_meta?select=revision&id=eq.1');
  const version=String(config[0]?.revision||0);
  if(req.query?.head==='1')return res.status(200).json({version});
  const chunks=[];for(let i=0;i<ids.length;i+=80)chunks.push(ids.slice(i,i+80));
  const pages=await Promise.all(chunks.map(chunk=>read('mmhd_public_snapshots?select=id,item&id=in.('+chunk.map(x=>'"'+x.replace(/"/g,'')+'"').join(',')+')')));
  const rows=pages.flat();
  const received=new Set(rows.map(row=>String(row.id)));
  if(received.size!==ids.length || ids.some(id=>!received.has(id))) {
   console.error('MMHD snapshots incompletos',received.size,ids.length);
   return res.status(503).json({error:'Versiones públicas incompletas; se conserva el catálogo estático'});
  }
  return res.status(200).json({version,approvedIds:ids,items:rows.map(row=>row.item)});
 }catch(e){console.error('MMHD public library',e.message);return res.status(502).json({error:'No se pudo consultar el catálogo público'});}
};
