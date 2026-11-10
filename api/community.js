/* MMHD V3 · Opiniones y sugerencias, solo servidor. Nunca exponer la clave secreta. */
'use strict';
const crypto = require('crypto');
const AVATARS = new Set(['🎬','🍿','🎮','🌙','🦊','🐱','🚀','🌸','⭐','🐻']);
const COLUMNS = 'id,nickname,avatar,message,created_at,status,is_official';
function fail(res,status,error){return res.status(status).json({error});}
function enabled(){return process.env.MMHD_COMMUNITY_ENABLED==='1';}
function config(){return {enabled:enabled(),siteKey:enabled()?(process.env.MMHD_TURNSTILE_SITE_KEY||''):''};}
function clientIp(req){return String(req.headers['x-real-ip']||req.headers['x-vercel-forwarded-for']||String(req.headers['x-forwarded-for']||'').split(',')[0]||'unknown').trim().slice(0,100);}
function dbCredentials(){
 const url=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!/^https:\/\/[\w.-]+\.supabase\.co$/i.test(url)||!key)throw Error('Supabase no configurado');
 const headers={apikey:key,'content-type':'application/json'};
 if(!key.startsWith('sb_secret_')) headers.Authorization='Bearer '+key;
 return {url,headers};
}
async function db(path,{method='GET',body,prefer}={}){
 const {url,headers}=dbCredentials();
 const response=await fetch(url+'/rest/v1/'+path,{
  method,headers:{...headers,...(prefer?{Prefer:prefer}:{})},
  body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(9500)
 });
 if(!response.ok){console.error('MMHD community database:',response.status);throw Error('Base de datos no disponible');}
 if(response.status===204)return null;
 const raw=await response.text();return raw?JSON.parse(raw):null;
}
function normalized(s){return s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 .replace(/[0]/g,'o').replace(/[1!|]/g,'i').replace(/[3]/g,'e').replace(/[4@]/g,'a').replace(/[$5]/g,'s')
 .replace(/([a-z])\1{2,}/g,'$1$1');}
// Filtro inicial personalizable. No sustituye la moderación humana.
const BAD_WORDS = [
 'puta','puto','putazo','putiza','pendejo','pendeja','pendejada',
 'chinga','chingada','chingado','chingar','verga','culero','culera','cabron','cabrona',
 'mierda','maricon','maricona','zorra','perra','perro',
 'fuck','fucking','fucker','bitch','asshole','motherfucker','shit','dick','cunt','nigger','faggot'
];
// Se evita bloquear palabras que contengan estas secuencias dentro de otras palabras legítimas.
const BAD_PATTERN = new RegExp('(?:^|[^a-z])(?:'+BAD_WORDS.join('|')+')(?:$|[^a-z])','i');
function unacceptable(text){
 const t=normalized(text);
 if(BAD_PATTERN.test(t))return 'Revisa el lenguaje del mensaje.';
 if(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text))return 'No publiques correos electrónicos.';
 if(/(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|xyz|shop|info|ru|tk|app|link|me|mx|co|cc)\b)/i.test(t))return 'No se permiten enlaces ni publicidad.';
 if(/(?:\+?\d[\s().-]*){9,}/.test(text))return 'No publiques números de teléfono.';
 if(/(.)\1{9,}/u.test(text))return 'Evita los mensajes repetitivos.';
 if(/[A-ZÁÉÍÓÚÑ]{14,}/.test(text))return 'Evita mensajes enteros en mayúsculas.';
 return '';
}
function clean(s){return String(s??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();}
// Mayúsculas, tildes y espacios repetidos no dan derecho a un segundo apodo.
function nicknameKey(s){return s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/gu,' ').trim();}
const RESERVED_NICKS=new Set(['admin','administrador','administradora','moderador','moderadora','moderacion','soporte','staff','equipo mmhd','movie mania hd','moviemaniahd']);

function isAdmin(req){
 const expected=String(process.env.MMHD_REQUESTS_ADMIN_TOKEN||'');
 const given=String(req.headers['x-mmhd-admin-key']||'');
 const a=Buffer.from(expected),b=Buffer.from(given);
 return a.length>=24&&a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function turnstileOk(token,req){
 const secret=process.env.MMHD_TURNSTILE_SECRET_KEY;
 if(!secret||!token||token.length>2048)return false;
 const resp=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({secret,response:token,remoteip:clientIp(req)}).toString(),
  signal:AbortSignal.timeout(8000)
 });
 if(!resp.ok)return false;
 const result=await resp.json();
 const expected=new URL(process.env.MMHD_COMMUNITY_ALLOWED_ORIGIN||process.env.MMHD_REQUESTS_ALLOWED_ORIGIN||'https://moviemaniahd.vercel.app').hostname;
 return result.success===true&&result.hostname===expected;
}
module.exports=async function handler(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST','PATCH','DELETE'].includes(req.method))return fail(res,405,'Método no permitido.');
 if(!enabled()){if(req.method==='GET')return res.status(200).json({enabled:false,items:[]});return fail(res,503,'El chat no está habilitado.');}
 try{
  if(req.method==='GET'){
   const moderate=String(req.query?.moderate||'')==='1';
   if(moderate&&!isAdmin(req))return fail(res,401,'Acceso administrativo no autorizado.');
   let cursor=String(req.query?.before||'');const after=String(req.query?.after||'');
   if(cursor&&!/^[1-9]\d{0,17}$/.test(cursor))return fail(res,400,'Cursor inválido.');
   if(after&&!/^[1-9]\d{0,17}$/.test(after))return fail(res,400,'Cursor inválido.');
   if(cursor&&after)return fail(res,400,'Elige un único cursor.');
   let path='mmhd_community_messages?select='+encodeURIComponent(COLUMNS);
   if(!moderate)path+='&status=eq.visible';
   if(cursor)path+='&id=lt.'+cursor;
   if(after)path+='&id=gt.'+after;
   path+='&order=id.'+(after?'asc':'desc')+'&limit='+(after?'50':'31');
   const rows=await db(path);
   const hasMore=!after&&Array.isArray(rows)&&rows.length>30;
   const list=(Array.isArray(rows)?rows:[]).slice(0,after?50:30);
   if(!after)list.reverse();
   if(!moderate){res.setHeader('Cache-Control','public, max-age=0, s-maxage=7');}
   return res.status(200).json({enabled:true,siteKey:process.env.MMHD_TURNSTILE_SITE_KEY||'',items:list,hasMore});
  }
  if(req.method==='PATCH'||req.method==='DELETE'){
   if(!isAdmin(req))return fail(res,401,'Acceso administrativo no autorizado.');
   // Solo quien conoce la clave administrativa puede asignar una insignia oficial.
   // La API no concede insignias por el simple texto de un apodo.
   if(req.method==='PATCH'&&req.body?.action==='official'){
    const target=nicknameKey(clean(req.body?.nickname));
    const official=req.body?.official;
    if(target!=='esteban mmhd'||typeof official!=='boolean')return fail(res,400,'Solo se puede administrar el perfil oficial autorizado.');
    const outcome=await db('rpc/mmhd_community_manage_official',{method:'POST',body:{p_nickname_key:target,p_official:official}});
    if(!outcome?.ok)return fail(res,409,outcome?.error||'No se puede verificar este apodo.');
    return res.status(200).json({ok:true,nickname:'Esteban MMHD',is_official:official,updated:outcome.updated});
   }
   const id=Number(req.body?.id),status=String(req.body?.status||'');
   if(!Number.isSafeInteger(id)||id<1||(req.method==='PATCH'&&!['visible','hidden'].includes(status)))return fail(res,400,'Datos inválidos.');
   if(req.method==='DELETE')await db('mmhd_community_messages?id=eq.'+id,{method:'DELETE',prefer:'return=minimal'});
   else await db('mmhd_community_messages?id=eq.'+id,{method:'PATCH',body:{status},prefer:'return=minimal'});
   return res.status(200).json({ok:true});
  }
  const raw=req.body||{};
  const nickname=clean(raw.nickname),message=clean(raw.message),avatar=String(raw.avatar||'🎬');
  const token=String(raw.turnstileToken||'');
  const claimToken=String(raw.claimToken||'');
  const nickKey=nicknameKey(nickname);
  if(raw.action==='identity'){
   // Consultar solo la identidad propia: el secreto no va en URLs ni en la respuesta.
   if(!/^[a-f0-9]{64}$/.test(claimToken)||nickKey.length<2||nickKey.length>100)
    return fail(res,400,'Identidad inválida.');
   const hashSecret=process.env.MMHD_REQUESTS_HASH_SECRET;
   if(!hashSecret||hashSecret.length<32)return fail(res,503,'Identidad no configurada.');
   const ownerHash=crypto.createHmac('sha256',hashSecret)
    .update('mmhd-community-nickname-v1|'+claimToken).digest('hex');
   const found=await db('mmhd_community_nicknames?select=is_official,legacy&nickname_key=eq.'+
    encodeURIComponent(nickKey)+'&owner_hash=eq.'+ownerHash+'&limit=1');
   return res.status(200).json({is_official:found?.[0]?.is_official===true&&found?.[0]?.legacy===false});
  }
  if(!/^[a-f0-9]{64}$/.test(claimToken))return fail(res,400,'No se pudo conservar tu apodo. Activa el almacenamiento de este navegador.');
  if(!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(nickname))return fail(res,400,'El apodo solo puede contener letras, números, espacios, puntos, guiones o guion bajo.');
  if(RESERVED_NICKS.has(nickKey))return fail(res,400,'Ese apodo está reservado para el equipo de Movie Mania HD.');
  // Evitar imitaciones evidentes como Esteban_MMHD o Esteban-MMHD.
  // El apodo exacto Esteban MMHD sigue disponible para su propietario legítimo.
  if(nickKey!=='esteban mmhd'&&nickKey.replace(/[ ._-]+/g,'').includes('estebanmmhd'))
   return fail(res,400,'Ese nombre es demasiado parecido al del equipo oficial.');
  if(nickname.length<2||nickname.length>24||message.length<8||message.length>500)return fail(res,400,'Nombre (2 a 24 caracteres) y mensaje (8 a 500) obligatorios.');
  if(!AVATARS.has(avatar))return fail(res,400,'Avatar inválido.');
  const reason=unacceptable(nickname+' '+message);
  if(reason)return fail(res,400,reason);
  if(!process.env.MMHD_REQUESTS_HASH_SECRET||process.env.MMHD_REQUESTS_HASH_SECRET.length<32)return fail(res,503,'Protección contra spam sin configurar.');
  if(!(await turnstileOk(token,req)))return fail(res,403,'Verificación anti-bots fallida o caducada.');
  const day=new Date().toISOString().slice(0,10);
  const fingerprint=crypto.createHmac('sha256',process.env.MMHD_REQUESTS_HASH_SECRET)
   .update(day+'|'+clientIp(req)).digest('hex');
  const ownerHash=crypto.createHmac('sha256',process.env.MMHD_REQUESTS_HASH_SECRET)
   .update('mmhd-community-nickname-v1|'+claimToken).digest('hex');
  const result=await db('rpc/mmhd_community_submit',{method:'POST',body:{
   p_nickname:nickname,p_nickname_key:nickKey,p_owner_hash:ownerHash,
   p_avatar:avatar,p_message:message,p_fingerprint:fingerprint
  }});
  if(result?.limited)return fail(res,429,result.error||'Límite de mensajes alcanzado.');
  if(result?.code==='nickname_taken')return fail(res,409,result.error||'Este apodo ya está ocupado. Elige otro.');
  if(result?.code==='nickname_locked')return fail(res,409,result.error||'Ya tienes otro apodo reservado en este perfil.');
  if(!result?.ok)return fail(res,400,result?.error||'No se pudo publicar.');
  return res.status(201).json({ok:true,id:result.id,is_official:result.is_official===true});
 }catch(err){console.error('MMHD community error:',err?.message);return fail(res,503,'El chat no está disponible temporalmente.');}
};
module.exports._test={unacceptable,clean,normalized,nicknameKey,RESERVED_NICKS};
