/* Movie Mania HD V3 - catálogo vivo. No reemplaza el reproductor ni sus datos locales. */
(function(){
 'use strict';
 if(typeof MOVIES==='undefined'||typeof renderAll!=='function')return;
 const endpoint='/api/public-library';
 let activeVersion=null,busy=false,pending=null;
 function safeData(raw){
  const m=Object.assign({},raw);
  m.id=raw.id;
  m.title=String(raw.title||'');m.kind=raw.kind==='SERIES'?'SERIES':'MOVIE';
  m.year=String(raw.year||'');m.poster=String(raw.poster||'');m.backdrop=String(raw.backdrop||'');
  m.rating=Number(raw.rating)||0;m.genres=String(raw.genres||'');m.overview=String(raw.overview||'');
  m.searchTitles=Array.isArray(raw.searchTitles)?raw.searchTitles:[];
  m.manualSearchTitles=Array.isArray(raw.manualSearchTitles)?raw.manualSearchTitles:[];
  m.cast=Array.isArray(raw.cast)?raw.cast:[];
  m.watchProvidersMx=Array.isArray(raw.watchProvidersMx)?raw.watchProvidersMx:[];
  m.providerOverridesMx=raw.providerOverridesMx||{};
  m.featured=raw.featured===true;m.featuredOrder=Number(raw.featuredOrder??999);
  m.subtitleTracks=Array.isArray(raw.subtitleTracks)?raw.subtitleTracks:[];
  m.seasons=Array.isArray(raw.seasons)?raw.seasons:[];
  for(const season of m.seasons){if(!Array.isArray(season.episodes))season.episodes=[];}
  return m;
 }
 function apply(data){
  const allowed=new Set((data.approvedIds||[]).map(String));
  const existing=new Map(MOVIES.map(m=>[String(m.id),m]));
  const approvedItems=new Map((data.items||[]).filter(m=>m&&m.id!=null).map(m=>[String(m.id),safeData(m)]));
  // Los IDs aprobados que ya no existen en Supabase deben retirarse de la web.
  for(let i=MOVIES.length-1;i>=0;i--){const id=String(MOVIES[i].id);if(allowed.has(id)&&!approvedItems.has(id))MOVIES.splice(i,1);}
  for(const [id,m] of approvedItems){const old=existing.get(id);if(old){Object.keys(old).forEach(k=>{if(!(k in m))delete old[k];});Object.assign(old,m);}else MOVIES.push(m);}
  activeVersion=data.version;
  // No cerrar ni reiniciar un reproductor activo o una ficha que está abierta.
  const playing=!!document.getElementById('playerModal')?.classList.contains('show');
  const detail=!!document.getElementById('detailScreen')?.classList.contains('show');
  if(playing||detail){pending=true;return;}
  renderAll();
  if(typeof renderHero==='function')renderHero();
  pending=false;
 }
 async function check(){
  if(busy||document.visibilityState==='hidden')return;
  busy=true;
  try{
   const head=await fetch(endpoint+'?head=1',{cache:'no-store'});
   if(!head.ok)return;
   const meta=await head.json();
   if(meta.version!==activeVersion){const response=await fetch(endpoint,{cache:'no-store'});
    if(!response.ok)return;
    const data=await response.json();apply(data);
   }else if(pending&&!document.getElementById('playerModal')?.classList.contains('show')&&!document.getElementById('detailScreen')?.classList.contains('show')){
    renderAll();if(typeof renderHero==='function')renderHero();pending=false;
   }
  }catch(e){console.warn('[Movie Mania HD] Sincronización pública no disponible:',e.message)}finally{busy=false;}
 }
 window.addEventListener('load',()=>{void check();setInterval(()=>void check(),20000)},{once:true});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void check()});
 window.addEventListener('pageshow',e=>{if(e.persisted)void check()});
})();
