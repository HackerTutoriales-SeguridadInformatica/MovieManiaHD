/* MMHD V3 · Chat comunitario público (opiniones y sugerencias).
   El HTML de la página no recibe claves de Supabase: todo pasa por /api/community. */
(()=>{'use strict';
 if(document.getElementById('mmhdCommunityLauncher'))return;
 const CSS=`
 #mmhdCommunityLauncher{position:fixed;right:22px;bottom:23px;z-index:1400;border:1px solid #fc7a9b;
  background:linear-gradient(135deg,#e72864,#ae174e);color:white;box-shadow:0 9px 33px #0009;
  font:800 13px Inter,Arial,sans-serif;display:none;align-items:center;gap:10px;border-radius:28px;padding:13px 17px;cursor:pointer}
 #mmhdCommunityLauncher.mmhd-chat-ready{display:flex}
 #mmhdCommunityLauncher .mmhd-chat-dot{width:8px;height:8px;border-radius:100%;background:#94ffc5;box-shadow:0 0 8px #7df8b8}
 #mmhdCommunityPanel{display:none;position:fixed;right:20px;bottom:85px;width:min(470px,calc(100vw - 26px));height:min(750px,84dvh);
  z-index:1500;background:#101827;border:1px solid #394760;border-radius:17px;color:#edf2ff;box-shadow:0 22px 85px #000c;
  flex-direction:column;overflow:hidden;font-family:Inter,Arial,sans-serif}
 #mmhdCommunityPanel.mmhd-chat-open{display:flex}
 .mmhd-chat-top{padding:13px 16px;background:linear-gradient(135deg,#192741,#141c2e);border-bottom:1px solid #30405b;
  display:flex;align-items:center;justify-content:space-between;gap:12px}
 .mmhd-chat-top strong{font-size:14px}.mmhd-chat-top p{font-size:11px;color:#b0bfd8;margin:3px 0 0}
 .mmhd-chat-heading{min-width:0;flex:1}
 .mmhd-chat-actions{display:flex;align-items:center;gap:9px;flex-shrink:0;min-width:0}
 .mmhd-chat-user-tag{display:inline-block;background:#273751;border:1px solid #466384;border-radius:20px;
  padding:7px 10px;color:#cce7ff;font-size:11px;font-weight:750;max-width:145px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .mmhd-chat-user-tag[hidden],.mmhd-chat-nickname-row[hidden]{display:none!important}
 .mmhd-chat-nickname-row{display:flex;flex-direction:column;gap:7px}
 .mmhd-chat-close{background:#253653;border-radius:9px;padding:7px 10px;font-size:20px;color:#e3eafb}
 .mmhd-chat-history{background:none;border:none;border-bottom:1px solid #25354c;padding:10px 12px;color:#a6c6ff;text-align:center;font-size:12px}
 .mmhd-chat-history[hidden]{display:none!important}
 .mmhd-chat-messages{flex:1;overflow-y:auto;min-height:0;padding:14px 13px;overscroll-behavior:contain;display:flex;flex-direction:column;gap:10px}
 .mmhd-chat-bubble{background:#1a2740;border:1px solid #2b3d5f;border-radius:13px;padding:11px 12px;overflow-wrap:anywhere}
 .mmhd-chat-meta{display:flex;align-items:center;gap:7px;font-size:11px;margin-bottom:4px}
 .mmhd-chat-name{font-weight:850;color:#c4ddff;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .mmhd-chat-date{color:#8797b4;margin-left:auto;white-space:nowrap;font-size:10px}
 .mmhd-chat-avatar{width:29px;height:29px;border-radius:8px;background:#2e3858;display:grid;place-items:center;overflow:hidden;flex:none}
 .mmhd-chat-avatar svg{display:block;width:100%;height:100%}
 .mmhd-chat-text{white-space:pre-wrap;font-size:13.5px;line-height:1.55;color:#edf2fb}
 .mmhd-chat-empty{color:#98a8c1;text-align:center;font-size:12px;margin:30px 10px}
 .mmhd-chat-compose{padding:10px 13px 12px;background:#151e31;border-top:1px solid #32445f;display:flex;flex-direction:column;gap:7px}
 .mmhd-chat-compose label{font-size:11px;color:#aec0dc;font-weight:700}
 .mmhd-chat-compose input,.mmhd-chat-compose textarea{font:inherit;font-size:12.5px;box-sizing:border-box;width:100%;
  color:#fff;background:#0b1323;border:1px solid #465675;border-radius:8px;padding:9px 10px;resize:none}
 .mmhd-chat-compose input:focus,.mmhd-chat-compose textarea:focus{outline:1px solid #ea5288}
 .mmhd-chat-compose input[readonly]{opacity:.8;cursor:default;border-color:#376a57;background:#101c27}
 .mmhd-chat-nicknote{font:10px/1.35 Inter,Arial,sans-serif;color:#9eb3d0;margin:-3px 0 2px}
 .mmhd-chat-submit{background:#df245e;border:0;padding:10px 15px;border-radius:9px;color:white;font-weight:800;font-size:12px}
 .mmhd-chat-submit:disabled{opacity:.45;cursor:not-allowed}
 .mmhd-chat-privacy{font-size:9.5px;color:#9cacc5;margin:0;line-height:1.3}
 .mmhd-chat-info{font-size:11px;color:#d7eaff;margin:0;min-height:15px}
 .mmhd-chat-info.error{color:#ffa8bc}
 /* Turnstile normal es HORIZONTAL y menos alto que su modo compacto; nunca escalar el iframe. */
 #mmhdCommunityCaptcha{min-height:65px;max-width:100%;display:flex;justify-content:center;align-items:center;overflow:visible}
 #mmhdCommunityCaptcha iframe{max-width:100%}
 body.mmhd-player-active #mmhdCommunityLauncher,body.mmhd-player-active #mmhdCommunityPanel{display:none!important}
 @media(max-width:600px){#mmhdCommunityLauncher{right:11px;bottom:calc(78px + env(safe-area-inset-bottom,0px));padding:11px 13px;font-size:12px}
  #mmhdCommunityPanel{right:7px;left:7px;bottom:calc(71px + env(safe-area-inset-bottom,0px));width:auto;
   height:min(690px,calc(100dvh - 134px));max-height:calc(100dvh - 134px);border-radius:13px}
  .mmhd-chat-top{padding:9px 12px}.mmhd-chat-compose{padding:8px 11px}.mmhd-chat-messages{padding:10px 11px}
  .mmhd-chat-user-tag{max-width:98px;padding:6px 8px;font-size:10px}.mmhd-chat-actions{gap:5px}}
 `;
 const style=document.createElement('style');style.textContent=CSS;document.head.append(style);
 const launcher=document.createElement('button');launcher.type='button';launcher.id='mmhdCommunityLauncher';
 launcher.setAttribute('aria-label','Abrir chat de la comunidad');launcher.innerHTML='<span aria-hidden="true">💬</span> Opiniones <span class="mmhd-chat-dot" aria-hidden="true"></span>';
 const panel=document.createElement('section');panel.id='mmhdCommunityPanel';panel.setAttribute('role','dialog');
 panel.setAttribute('aria-modal','false');panel.setAttribute('aria-label','Chat de la comunidad');
 panel.innerHTML=`<div class="mmhd-chat-top"><div class="mmhd-chat-heading"><strong>💬 Comunidad Movie Mania HD</strong><p>Opiniones y sugerencias públicas</p></div><div class="mmhd-chat-actions"><span id="mmhdChatActiveNick" class="mmhd-chat-user-tag" hidden title="Tu apodo reservado"></span><button type="button" class="mmhd-chat-close" id="mmhdChatClose" aria-label="Cerrar chat">×</button></div></div>
 <button type="button" class="mmhd-chat-history" id="mmhdChatOlder" hidden>↑ Ver mensajes anteriores</button>
 <div class="mmhd-chat-messages" id="mmhdChatMessages" role="log" aria-live="polite" aria-relevant="additions"></div>
 <form class="mmhd-chat-compose" id="mmhdChatForm"><div class="mmhd-chat-nickname-row" id="mmhdChatNicknameRow"><label for="mmhdChatNickname">Tu apodo público</label>
 <input type="text" id="mmhdChatNickname" minlength="2" maxlength="24" required autocomplete="nickname" placeholder="Ej. CineFan"/>
 <p class="mmhd-chat-nicknote" id="mmhdChatNickNote">El apodo se reserva con tu primer mensaje. No puede repetirse.</p></div>
 <label for="mmhdChatMessage">Tu opinión o sugerencia</label><textarea id="mmhdChatMessage" maxlength="500" minlength="8" rows="2" required placeholder="¿Qué te gusta o qué mejorarías?" ></textarea>
 <p class="mmhd-chat-privacy">Tu apodo y mensaje serán visibles para todos, incluso después. No publiques datos personales, enlaces ni insultos.</p>
 <div id="mmhdCommunityCaptcha"></div><p class="mmhd-chat-info" id="mmhdChatInfo" role="status"></p>
 <button class="mmhd-chat-submit" type="submit" id="mmhdChatSend" disabled>Publicar mensaje</button></form>`;
 document.body.append(launcher,panel);
 const $=id=>document.getElementById(id);
 const elements={messages:$('mmhdChatMessages'),older:$('mmhdChatOlder'),nick:$('mmhdChatNickname'),nickRow:$('mmhdChatNicknameRow'),activeNick:$('mmhdChatActiveNick'),nickNote:$('mmhdChatNickNote'),text:$('mmhdChatMessage'),info:$('mmhdChatInfo'),send:$('mmhdChatSend'),captcha:$('mmhdCommunityCaptcha')};
 let opened=false,ready=false,fetching=false,refreshQueued=false,hasOlder=false,oldest=0,newest=0,lastServerCursor=0;
 let captchaToken='',captchaId=null,siteKey='',lastRefresh=0,pollTimer=0,initCaptchaPromise=null;
 const rows=new Map();
 function notify(text,bad=false){elements.info.textContent=text||'';elements.info.classList.toggle('error',!!bad);}
 function showAvailable(){
  // El selector de perfiles debe completarse antes de mostrar el botón del chat.
  const gate=$('mmhdProfileOverlay');const hidden=gate && !gate.hidden;
  if(ready&&!hidden)launcher.classList.add('mmhd-chat-ready');else launcher.classList.remove('mmhd-chat-ready');
  if(hidden&&opened)toggle(false);
 }
 function profile(){
  try{const arr=JSON.parse(localStorage.getItem('mmhd_profiles_v1')||'[]');
   const id=sessionStorage.getItem('mmhd_profile_tab_v1')||localStorage.getItem('mmhd_profile_active_v1')||'principal';
   return arr.find(x=>x.id===id)||arr[0]||{name:'',avatar:'🎬'};
  }catch(_){return {name:'',avatar:'🎬'}}
 }
 // El secreto de cada perfil queda solo en este navegador. No enviarlo en URLs.
 const CLAIM_PREFIX='mmhd_community_claim_v1_';
 let lastProfileId='';
 function profileId(){
  try{return String(sessionStorage.getItem('mmhd_profile_tab_v1')||localStorage.getItem('mmhd_profile_active_v1')||'principal').slice(0,90)}
  catch(_){return 'principal'}
 }
 function loadClaim(create){
  const key=CLAIM_PREFIX+profileId();
  let claim=null;
  try{claim=JSON.parse(localStorage.getItem(key)||'null');}catch(_){if(create)throw Error('Necesitas permitir el almacenamiento del navegador para reservar tu apodo.');}
  if(!claim||typeof claim!=='object'||!/^[a-f0-9]{64}$/.test(claim.token||'')){
   if(!create)return null;
   if(!window.crypto||!crypto.getRandomValues)throw Error('Este navegador no permite crear la clave segura del apodo.');
   const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
   claim={token:Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),nickname:''};
   try{localStorage.setItem(key,JSON.stringify(claim))}
   catch(_){throw Error('No se pudo conservar la clave del apodo. Permite el almacenamiento local.');}
  }
  return {key,claim};
 }
 function setName(){
  const pid=profileId(),p=profile(),record=loadClaim(false);
  const claimed=!!record?.claim?.nickname;
  elements.nickRow.hidden=claimed;
  elements.activeNick.hidden=!claimed;
  if(claimed){
   elements.nick.value=record.claim.nickname;
   elements.nick.readOnly=true;
   elements.activeNick.textContent='@'+record.claim.nickname;
   elements.activeNick.title='Tu apodo público: '+record.claim.nickname;
   elements.nickNote.textContent='Apodo reservado para este perfil en este navegador.';
  }else{
   elements.activeNick.textContent='';
   elements.nick.readOnly=false;
   if(pid!==lastProfileId)elements.nick.value=(p?.name&&p.name!=='Principal')?p.name:'';
   else if(!elements.nick.value&&p?.name&&p.name!=='Principal')elements.nick.value=p.name;
   elements.nickNote.textContent='El apodo se reserva con tu primer mensaje. No puede repetirse.';
  }
  lastProfileId=pid;
 }

 function makeRow(m){
  const node=document.createElement('article');node.className='mmhd-chat-bubble';node.dataset.id=m.id;
  const head=document.createElement('div');head.className='mmhd-chat-meta';
  const avatar=document.createElement('span');avatar.className='mmhd-chat-avatar';
  try{if(typeof mmhdPaintAvatar==='function')mmhdPaintAvatar(avatar,m.avatar);else avatar.textContent=m.avatar||'🎬';}
  catch(_){avatar.textContent='🎬'}
  const name=document.createElement('span');name.className='mmhd-chat-name';name.textContent=m.nickname||'Visitante';
  const when=document.createElement('span');when.className='mmhd-chat-date';
  const date=new Date(m.created_at);when.textContent=Number.isNaN(date.getTime())?'':date.toLocaleString('es-MX',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  head.append(avatar,name,when);
  const text=document.createElement('div');text.className='mmhd-chat-text';text.textContent=m.message||'';
  node.append(head,text);return node;
 }
 function showEmpty(){
  let empty=elements.messages.querySelector('.mmhd-chat-empty');
  if(rows.size&&empty)empty.remove();
  if(!rows.size&&!empty){empty=document.createElement('p');empty.className='mmhd-chat-empty';empty.textContent='Todavía no hay mensajes. ¡Sé quien inicie la conversación!';elements.messages.append(empty);}
 }
 function addMessages(list,mode,forceScroll=false){
  if(!Array.isArray(list))return;
  const container=elements.messages;
  const stayBottom=container.scrollHeight-container.scrollTop-container.clientHeight<90;
  const oldHeight=container.scrollHeight,oldTop=container.scrollTop;
  const oldFirst=mode==='older'?container.querySelector('.mmhd-chat-bubble'):null;
  for(const message of list){
   const id=Number(message.id);if(!Number.isSafeInteger(id)||rows.has(id))continue;
   const node=makeRow(message);rows.set(id,node);
   if(mode==='older'){container.insertBefore(node,oldFirst||container.firstChild);}
   else{
    // Insertar ordenado aunque una respuesta llegue después del mensaje recién publicado.
    const following=Array.from(container.querySelectorAll('.mmhd-chat-bubble'))
     .find(existing=>Number(existing.dataset.id)>id);
    container.insertBefore(node,following||null);
   }
   oldest=oldest?Math.min(oldest,id):id;newest=Math.max(newest,id);
  }
  showEmpty();
  if(mode==='older')container.scrollTop=oldTop+(container.scrollHeight-oldHeight);
  else if(forceScroll||stayBottom||mode==='initial')container.scrollTop=container.scrollHeight;
  // En una visita larguísima, limitar DOM a lo que se ha consultado para evitar saturación.
 }
 async function get(params){
  const response=await fetch('/api/community'+(params?'?'+params:''),{cache:'no-store'});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Error al consultar');return data;
 }
 async function refresh(mode){
  if(fetching){if(mode==='recent')refreshQueued=true;return;}
  fetching=true;
  try{
   const param=mode==='older'&&oldest?'before='+oldest:mode==='recent'&&lastServerCursor?'after='+lastServerCursor:'';
   const result=await get(param);
   if(!result.enabled){toggle(false);ready=false;showAvailable();return;}
   siteKey=result.siteKey||siteKey;
   if(mode==='initial'||mode==='older'){
    hasOlder=!!result.hasMore;elements.older.hidden=!hasOlder;
   }
   const items=result.items||[];
   addMessages(items,mode);
   // El mensaje local confirmado no debe saltar mensajes ajenos publicados entre consultas.
   if(mode==='recent'||mode==='initial')for(const item of items){
    const id=Number(item.id);if(Number.isSafeInteger(id))lastServerCursor=Math.max(lastServerCursor,id);
   }
   lastRefresh=Date.now();
  }catch(err){notify(err.message||'No se pudieron cargar mensajes.',true)}finally{
   fetching=false;
   if(refreshQueued){refreshQueued=false;if(opened)void refresh('recent');}
  }
 }
 function canPost(){elements.send.disabled=!captchaToken||!elements.nick.value.trim()||elements.text.value.trim().length<8;}
 function loadScript(){return new Promise((resolve,reject)=>{
  if(window.turnstile)return resolve();
  let tag=document.getElementById('mmhd-turnstile-script');
  if(!tag){tag=document.createElement('script');tag.id='mmhd-turnstile-script';tag.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';tag.async=true;document.head.append(tag);}
  tag.addEventListener('load',resolve,{once:true});tag.addEventListener('error',reject,{once:true});
 });}
 async function captcha(){
  if(captchaId!==null||initCaptchaPromise)return initCaptchaPromise;
  initCaptchaPromise=(async()=>{
   try{
    if(!siteKey)throw Error('Anti-spam no configurado.');
    await loadScript();if(!opened)return;
    captchaId=window.turnstile.render(elements.captcha,{sitekey:siteKey,theme:'dark',size:'normal',
     callback:token=>{captchaToken=token;canPost()},
     'expired-callback':()=>{captchaToken='';canPost()},'error-callback':()=>{captchaToken='';canPost()}});
   }catch(err){notify('No se pudo iniciar la verificación anti-spam.',true)}finally{initCaptchaPromise=null}
  })();return initCaptchaPromise;
 }
 function resetCaptcha(){captchaToken='';if(captchaId!==null&&window.turnstile){try{window.turnstile.reset(captchaId)}catch(_){}}canPost()}
 function toggle(value){
  opened=!!value;panel.classList.toggle('mmhd-chat-open',opened);
  launcher.setAttribute('aria-expanded',String(opened));
  if(opened){setName();if(!rows.size)refresh('initial');else if(Date.now()-lastRefresh>8000)refresh('recent');captcha();}
  if(!opened)notify('');
 }
 launcher.addEventListener('click',()=>toggle(!opened));$('mmhdChatClose').addEventListener('click',()=>toggle(false));
 elements.older.addEventListener('click',()=>refresh('older'));
 elements.nick.addEventListener('input',canPost);elements.text.addEventListener('input',canPost);
 $('mmhdChatForm').addEventListener('submit',async event=>{
  event.preventDefault();if(elements.send.disabled)return;
  elements.send.disabled=true;notify('Publicando…');
  let record;
  try{record=loadClaim(true)}catch(err){notify(err.message,true);resetCaptcha();return;}
  const p=profile(),data={nickname:elements.nick.value.trim(),avatar:p.avatar||'🎬',message:elements.text.value.trim(),turnstileToken:captchaToken,claimToken:record.claim.token};
  try{
   const response=await fetch('/api/community',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
   const result=await response.json();if(!response.ok)throw Error(result.error||'No se pudo publicar.');
   // Persistir el nombre solo después de una publicación aceptada por el servidor.
   record.claim.nickname=data.nickname;
   try{localStorage.setItem(record.key,JSON.stringify(record.claim));}catch(_){notify('Se publicó, pero este navegador no guardó tu apodo. No borres los datos.',true);}
   setName();elements.text.value='';
   // Mensaje aceptado por el servidor: mostrarlo ahora, sin esperar al siguiente GET,
   // al caché del CDN ni a que termine otra consulta en curso.
   const confirmedId=Number(result.id);
   if(Number.isSafeInteger(confirmedId)&&confirmedId>0){
    addMessages([{id:confirmedId,nickname:data.nickname,avatar:data.avatar,
     message:data.message,created_at:new Date().toISOString(),status:'visible'}],'recent',true);
   }
   notify('¡Tu mensaje ya es público!');
   void refresh('recent');
  }catch(err){notify(err.message||'No se pudo publicar.',true)}finally{resetCaptcha()}
 });
 // Sin sesión abierta ni público que lea, no hacer consultas a Supabase.
 pollTimer=window.setInterval(()=>{if(opened&&!document.hidden&&!document.body.classList.contains('mmhd-player-active')&&Date.now()-lastRefresh>12000)refresh('recent');},12000);
 const selector=$('mmhdProfileOverlay');if(selector){new MutationObserver(showAvailable).observe(selector,{attributes:true,attributeFilter:['hidden','data-onboarding']});}
 new MutationObserver(()=>{if(opened&&document.body.classList.contains('mmhd-player-active'))toggle(false);}).observe(document.body,{attributes:true,attributeFilter:['class']});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&opened)refresh('recent')});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&opened)toggle(false)});
 get('').then(data=>{
  ready=!!data.enabled;if(!ready){panel.remove();launcher.remove();return;}
  siteKey=data.siteKey||'';addMessages(data.items||[],'initial');
  for(const item of data.items||[]){const id=Number(item.id);if(Number.isSafeInteger(id))lastServerCursor=Math.max(lastServerCursor,id);}
  hasOlder=!!data.hasMore;elements.older.hidden=!hasOlder;lastRefresh=Date.now();showAvailable();
 }).catch(()=>{launcher.remove();panel.remove()});
})();
