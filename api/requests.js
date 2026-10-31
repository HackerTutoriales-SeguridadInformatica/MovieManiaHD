const crypto=require('crypto');
function fail(res,status,message){return res.status(status).json({error:message})}
function constantEquals(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y)}
async function supabase(path,{method='GET',body,prefer}={}){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('Configuración de base de datos pendiente');
 const response=await fetch(url.replace(/\/$/,'')+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'content-type':'application/json',...(prefer?{Prefer:prefer}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(9000)});
 const text=await response.text();let data;try{data=text?JSON.parse(text):null}catch{data=null}
 if(!response.ok)throw Error('Base de datos: '+response.status);
 return data;
}
function admin(req){const expected=process.env.MMHD_REQUESTS_ADMIN_TOKEN||'';return expected.length>=24&&constantEquals(String(req.headers['x-mmhd-admin-key']||''),expected)}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','POST','PATCH'].includes(req.method))return fail(res,405,'Método no permitido');
 try{
  if(req.method==='GET'){
   if(!admin(req))return fail(res,401,'Clave administrativa incorrecta.');
   const items=await supabase('content_requests?select=id,media_type,tmdb_id,title,release_year,poster_path,votes,status,created_at,updated_at&order=updated_at.desc&limit=500');
   // Reparar automáticamente solicitudes antiguas sin póster (la validación previa
   // rechazaba indebidamente las rutas .jpg de TMDB). Sin afectar votos ni estados.
   const missing=Array.isArray(items)?items.filter(item=>!item.poster_path&&['movie','tv'].includes(item.media_type)&&Number.isSafeInteger(Number(item.tmdb_id))&&Number(item.tmdb_id)>0):[];
   const tmdbKey=process.env.TMDB_API_KEY;
   if(tmdbKey&&missing.length){
    // Procesar en tandas pequeñas para no saturar TMDB ni exceder el tiempo de Vercel.
    for(let i=0;i<Math.min(missing.length,24);i+=4){
     await Promise.all(missing.slice(i,i+4).map(async(item)=>{
      try{
       const r=await fetch(`https://api.themoviedb.org/3/${item.media_type}/${item.tmdb_id}?language=es-MX`,{headers:{Authorization:'Bearer '+tmdbKey},signal:AbortSignal.timeout(4500)});
       if(!r.ok)return;
       const d=await r.json();
       const poster=typeof d.poster_path==='string'&&/^\/[a-zA-Z0-9_/-]+\.(jpg|jpeg|png|webp)$/i.test(d.poster_path)?d.poster_path:null;
       if(!poster)return;
       item.poster_path=poster;
       // Persistir para no volver a consultar TMDB la siguiente vez.
       await supabase('content_requests?id=eq.'+encodeURIComponent(item.id),{method:'PATCH',body:{poster_path:poster},prefer:'return=minimal'});
      }catch(e){console.warn('MMHD poster repair:',item.tmdb_id,e.message)}
     }));
    }
   }
   return res.status(200).json({items});
  }
  if(req.method==='PATCH'){
   if(!admin(req))return fail(res,401,'Clave administrativa incorrecta.');
   const id=Number(req.body?.id),status=String(req.body?.status||'');
   if(!Number.isSafeInteger(id)||id<1||!['pending','progress','added'].includes(status))return fail(res,400,'Datos inválidos');
   await supabase('content_requests?id=eq.'+id,{method:'PATCH',body:{status},prefer:'return=minimal'});
   return res.status(200).json({ok:true});
  }
  // POST público: solo TMDB ID y tipo, nunca se confía en título o póster enviados por el visitante.
  // Turnstile obligatorio: validar en el servidor antes de consultar TMDB o guardar la solicitud.
  const captchaSecret=process.env.MMHD_TURNSTILE_SECRET_KEY;
  if(!captchaSecret)return fail(res,503,'Verificación anti-bots no configurada.');
  const captchaToken=String(req.body?.turnstileToken||'');
  if(!captchaToken||captchaToken.length>2048)return fail(res,400,'Completa la verificación anti-bots.');
  const form=new URLSearchParams({secret:captchaSecret,response:captchaToken});
  const captchaResponse=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form.toString(),signal:AbortSignal.timeout(8500)});
  if(!captchaResponse.ok)throw Error('Turnstile: '+captchaResponse.status);
  const captcha=await captchaResponse.json();
  if(!captcha.success)return fail(res,403,'Verificación fallida o vencida. Inténtalo de nuevo.');
  const expectedHost=new URL(process.env.MMHD_REQUESTS_ALLOWED_ORIGIN||'https://moviemaniahd.vercel.app').hostname;
  if(captcha.hostname!==expectedHost)return fail(res,403,'Origen de verificación inválido.');
  const type=req.body?.type,id=Number(req.body?.id);
  if(!['movie','tv'].includes(type)||!Number.isSafeInteger(id)||id<1||id>999999999)return fail(res,400,'Selecciona una película o serie válida.');
  if(!process.env.MMHD_REQUESTS_HASH_SECRET||process.env.MMHD_REQUESTS_HASH_SECRET.length<32)return fail(res,503,'Solicitudes todavía no configuradas.');
  const tmdbKey=process.env.TMDB_API_KEY;
  if(!tmdbKey)return fail(res,503,'TMDB todavía no configurado.');
  const r=await fetch(`https://api.themoviedb.org/3/${type}/${id}?language=es-MX`,{headers:{Authorization:'Bearer '+tmdbKey},signal:AbortSignal.timeout(8500)});
  if(!r.ok)return fail(res,400,'No se pudo verificar el título con TMDB.');
  const d=await r.json();const title=String(d.title||d.name||'').trim().slice(0,200);
  if(!title)return fail(res,400,'No se encontró el título.');
  // HMAC diaria: no se almacena IP en la BD, pero el hash limita abusos sin registro.
  const ip=String(req.headers['x-real-ip']||String(req.headers['x-forwarded-for']||'').split(',')[0]||'unknown').slice(0,100);
  const day=new Date().toISOString().slice(0,10);
  const fingerprint=crypto.createHmac('sha256',process.env.MMHD_REQUESTS_HASH_SECRET).update(day+'|'+ip).digest('hex');
  const year=String(d.release_date||d.first_air_date||'').slice(0,4);
  const poster=typeof d.poster_path==='string'&&/^\/[a-zA-Z0-9_/-]+\.(jpg|jpeg|png|webp)$/i.test(d.poster_path)?d.poster_path:null;
  const result=await supabase('rpc/mmhd_submit_request',{method:'POST',body:{p_type:type,p_tmdb_id:id,p_title:title,p_year:/^\d{4}$/.test(year)?year:null,p_poster:poster,p_fingerprint:fingerprint}});
  if(result?.limited)return fail(res,429,'Límite diario alcanzado. Inténtalo mañana.');
  return res.status(200).json({ok:true,duplicate:!!result?.duplicate});
 }catch(e){console.error('MMHD requests:',e.message);return fail(res,503,'Servicio de solicitudes no disponible. Revisa la configuración.');}
};
