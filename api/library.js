module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Método no permitido'});
 const url=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
 // La clave nueva (sb_secret_) solo viaja en apikey; la antigua (JWT) conserva Bearer.
 const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
 const anon=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY;
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)||!key||!anon)return res.status(503).json({error:'Configuración Supabase incompleta'});
 const bearer=/^Bearer (.+)$/i.exec(req.headers.authorization||'');
 if(!bearer)return res.status(401).json({error:'Inicia sesión como administrador'});
 const headers={'apikey':key,'Content-Type':'application/json',
  ...(!key.startsWith('sb_secret_')?{'Authorization':'Bearer '+key}:{})};
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
     if(req.query?.presence==='1'){
       const presence=await query('mmhd_library_presence?select=user_id,current_item_id,current_title,last_seen&last_seen=gte.'+encodeURIComponent(new Date(Date.now()-60000).toISOString()));
       return res.status(200).json({presence,me:user.id});
     }
     const revision=await meta();
     if(req.query?.head==='1')return res.status(200).json({revision});
     // Cursor de eventos: registrar ANTES de leer la biblioteca completa para evitar
     // perder eventos que ocurran durante la paginación inicial.
     if(req.query?.delta==='1'){
       const since=Number(req.query.since);
       if(!Number.isSafeInteger(since)||since<0)return res.status(400).json({error:'Cursor incremental inválido'});
       const events=await query('mmhd_library_history?select=id,item_id&id=gt.'+since+'&order=id.asc&limit=501');
       const batch=events.slice(0,500),nextCursor=batch.length?Number(batch[batch.length-1].id):since;
       const ids=[...new Set(batch.map(x=>String(x.item_id)))];
       const items=[];
       // Consultas acotadas: la respuesta nunca contiene los títulos no modificados.
       for(let i=0;i<ids.length;i+=35){
         const part=ids.slice(i,i+35);
         const inFilter='('+part.map(x=>'"'+x.replace(/[\\"]/g,'')+'"').join(',')+')';
         items.push(...await query('mmhd_library_items?select=id,item,version&id=in.'+encodeURIComponent(inFilter)));
       }
       const found=new Set(items.map(x=>String(x.id)));
       return res.status(200).json({revision,items,deleted:ids.filter(x=>!found.has(x)),cursor:nextCursor,hasMore:events.length>500});
     }
     if(req.query?.extra==='1'){
       // Solo descargar la sección que realmente está viendo el administrador.
       // El historial contiene antes/después completos y puede ser grande.
       const section=['history','backups','admins'].includes(req.query?.section)?req.query.section:'all';
       const rawHistory=(section==='backups'||section==='admins')?[]:await query('mmhd_library_history?select=id,item_id,operation,actor,changed_at,before_item,after_item&order=id.desc&limit=60');
       // Only return compact descriptions: never expose full historical playback URLs in the activity feed.
       const fieldLabels={title:'Título',subtitle:'Subtítulo',overview:'Sinopsis',description:'Descripción',synopsis:'Sinopsis',plot:'Sinopsis',year:'Año',releaseDate:'Fecha de estreno',release_date:'Fecha de estreno',poster:'Póster',backdrop:'Fondo',logo:'Logo',genres:'Géneros',genre:'Género',runtime:'Duración',rating:'Calificación',cert:'Clasificación',platforms:'Plataformas',platform:'Plataforma',featured:'Destacados',season:'Temporada',seasons:'Temporadas',episodes:'Episodios',chapters:'Episodios',subtitleTracks:'Subtítulos',subtitlesUrl:'Subtítulos',audioTracks:'Audios',primaryLanguage:'Idioma principal',language:'Idioma',languages:'Idiomas',m18:'Enlace 360p',m22:'Enlace 720p',m37:'Enlace 1080p',m18En:'Enlace Inglés 360p',m22En:'Enlace Inglés 720p',m37En:'Enlace Inglés 1080p'};
       function changedFields(before,after){
         if(!before||!after)return [];
         const keys=new Set([...Object.keys(before),...Object.keys(after)]);
         const result=[];
         for(const k of keys){
           if(JSON.stringify(before[k])===JSON.stringify(after[k]))continue;
           const label=fieldLabels[k]||(/^(?:m18|m22|m37)/i.test(k)?'Enlaces de reproducción':/subtit|caption|srt|vtt/i.test(k)?'Subtítulos':/episod|season|temporad|chapter/i.test(k)?'Episodios o temporadas':/link|url|video|source|audio|quality|calidad/i.test(k)?'Enlaces o audio':k);
           if(!result.includes(label))result.push(label);
         }
         return result.slice(0,12);
       }
       const history=rawHistory.map(({before_item,after_item,...entry})=>{
         const item=after_item||before_item||{};
         const poster=typeof item.poster==='string'&&(/^https:\/\/image\.tmdb\.org\/t\/p\//.test(item.poster)||/^\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(item.poster))?item.poster:null;
         return {...entry,title:String(item.title||item.name||entry.item_id).slice(0,180),year:String(item.year||'').slice(0,8),poster,fields:changedFields(before_item,after_item)};
       });
       const backups=(section==='history'||section==='admins')?[]:await query('mmhd_library_backups?select=id,revision,reason,item_count,created_at&order=id.desc&limit=20');
       const presence=section==='all'?await query('mmhd_library_presence?select=user_id,current_item_id,current_title,last_seen&last_seen=gte.'+encodeURIComponent(new Date(Date.now()-60000).toISOString())):[];
       const emailMap={};
       if(section!=='backups'&&req.query?.names!=='0'){
         const admins=await query('mmhd_library_admins?select=user_id');
         for(const a of admins){const ar=await fetch(url+'/auth/v1/admin/users/'+encodeURIComponent(a.user_id),{headers,signal:AbortSignal.timeout(9000)});if(ar.ok){const u=await ar.json();emailMap[a.user_id]=u.email||a.user_id.slice(0,8);}}
       }
       return res.status(200).json({revision,section,history,backups,presence,admins:emailMap,me:user.id});
     }
     const beginCursorRows=await query('mmhd_library_history?select=id&order=id.desc&limit=1');
     const beginCursor=Number(beginCursorRows[0]?.id||0);
     const rows=[];for(let offset=0;offset<5000;offset+=1000){const page=await query('mmhd_library_items?select=id,item,version&order=id.asc&limit=1000&offset='+offset);rows.push(...page);if(page.length<1000)break;}
     return res.status(200).json({revision,items:rows,cursor:beginCursor});
   }
   const payload=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
   if(payload.action==='undo'){
     if(!Number.isSafeInteger(payload.historyId)||!Number.isSafeInteger(payload.expectedRevision))return res.status(400).json({error:'Datos de recuperación incorrectos'});
     if(await meta()!==payload.expectedRevision)return res.status(409).json({error:'La biblioteca cambió. Sincroniza y revisa antes de deshacer'});
     const hs=await query('mmhd_library_history?select=item_id,before_item&id=eq.'+payload.historyId+'&limit=1');
     if(!hs.length)return res.status(404).json({error:'Cambio no encontrado'});
     const id=hs[0].item_id;
     const current=await query('mmhd_library_items?select=id,version&id=eq.'+encodeURIComponent(id)+'&limit=1');
     const result=await query('rpc/mmhd_library_apply','POST',{p_changes:[{id,expectedVersion:current.length?current[0].version:null,item:hs[0].before_item}],p_actor:user.id});
     return res.status(result.ok?200:409).json(result);
   }
   if(payload.action==='backup'){
     const r=await query('rpc/mmhd_library_take_backup','POST',{p_actor:user.id,p_reason:'manual'});
     return res.status(200).json(r);
   }
   if(payload.action==='restore'){
     if(!Number.isSafeInteger(payload.backupId)||!Number.isSafeInteger(payload.expectedRevision))return res.status(400).json({error:'Identificadores incorrectos'});
     const r=await query('rpc/mmhd_library_restore','POST',{p_backup_id:payload.backupId,p_expected_revision:payload.expectedRevision,p_actor:user.id});
     return res.status(r.ok?200:409).json(r);
   }
   if(payload.action==='presence'){
     const r=await query('rpc/mmhd_library_heartbeat','POST',{p_actor:user.id,p_item_id:typeof payload.itemId==='string'?payload.itemId:null,p_title:typeof payload.title==='string'?payload.title:null});
     // Una sola llamada del navegador actualiza y consulta presencia. Conserva el
     // resultado original para clientes antiguos que no piden includePresence.
     if(payload.includePresence===true){
       const presence=await query('mmhd_library_presence?select=user_id,current_item_id,current_title,last_seen&last_seen=gte.'+encodeURIComponent(new Date(Date.now()-60000).toISOString()));
       return res.status(200).json({ok:true,result:r,presence,me:user.id});
     }
     return res.status(200).json(r);
   }
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
