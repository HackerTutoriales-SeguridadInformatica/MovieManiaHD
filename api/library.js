module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Método no permitido'});
 const url=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const anon=process.env.SUPABASE_ANON_KEY;
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)||!key||!anon)return res.status(503).json({error:'Configuración Supabase incompleta'});
 const bearer=/^Bearer (.+)$/i.exec(req.headers.authorization||'');
 if(!bearer)return res.status(401).json({error:'Inicia sesión como administrador'});
 const headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'};
 try{
   const userResponse=await fetch(url+'/auth/v1/user',{headers:{apikey:anon,Authorization:'Bearer '+bearer[1]},signal:AbortSignal.timeout(9000)});
   if(!userResponse.ok)return res.status(401).json({error:'Sesión caducada. Vuelve a entrar'});
   const user=await userResponse.json();
   if(!user.id||!user.email_confirmed_at)return res.status(403).json({error:'Cuenta sin correo verificado'});
   const adminResponse=await fetch(url+'/rest/v1/mmhd_library_admins?select=user_id&user_id=eq.'+encodeURIComponent(user.id),{headers,signal:AbortSignal.timeout(9000)});
   if(!adminResponse.ok)throw Error('No se pudo validar el permiso de administrador');
   const admins=await adminResponse.json();
   if(!admins.length)return res.status(403).json({error:'Tu cuenta no tiene permiso de administración'});
   async function query(path,method='GET',body){const r=await fetch(url+'/rest/v1/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await r.json().catch(()=>null);if(!r.ok)throw Error(data?.message||data?.error||'Supabase '+r.status);return data;}
   const meta=async()=>{const rows=await query('mmhd_library_meta?select=revision&id=eq.1');return Number(rows[0]?.revision||0)};
   if(req.method==='GET'){
     const revision=await meta();
     if(req.query?.head==='1')return res.status(200).json({revision});
     const rows=[];for(let offset=0;offset<5000;offset+=1000){const page=await query('mmhd_library_items?select=id,item,version&order=id.asc&limit=1000&offset='+offset);rows.push(...page);if(page.length<1000)break;}
     return res.status(200).json({revision,items:rows});
   }
   const payload=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
   if(payload.action==='seed'){
     if(!Array.isArray(payload.items)||payload.items.length>5000)return res.status(400).json({error:'Biblioteca inicial inválida'});
     const result=await query('rpc/mmhd_library_seed','POST',{p_items:payload.items,p_actor:user.id});
     return res.status(result.ok?200:409).json(result);
   }
   if(payload.action==='apply'){
     if(!Array.isArray(payload.changes)||payload.changes.length>1000)return res.status(400).json({error:'Cambios inválidos'});
     const result=await query('rpc/mmhd_library_apply','POST',{p_changes:payload.changes,p_actor:user.id});
     return res.status(result.ok?200:409).json(result);
   }
   return res.status(400).json({error:'Acción desconocida'});
 }catch(e){console.error('MMHD library',e?.message);return res.status(502).json({error:'No se pudo completar la operación con Supabase: '+(e.message||'Error')})}
};
