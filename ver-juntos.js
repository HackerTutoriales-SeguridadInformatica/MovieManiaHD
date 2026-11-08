/* Movie Mania HD V3 - Ver juntos V2 (experimental)
 * Requiere SQL de instalación y Auth Anonymous Sign-ins en Supabase.
 * Dos miembros registrados en SQL; dos canales privados: solo host envía controles.
 * Realtime: un heartbeat / 12 s + eventos; chat efímero, no se guardan URLs.
 */
(function(){
  'use strict';
  if(window.mmhdWatchParty)return;
  const $=id=>document.getElementById(id);
  const ROOM_PARAM='verjuntos', ROOM_RE=/^[A-Za-z0-9_-]{22}$/;
  const PEER=(crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join(''));
  const CODE_PREFIX='mmhd-watch-v2-';
  const HOST_MEDIA_KEY='mmhd_wp_host_media_v2_';
  const HOST_STATE_KEY='mmhd_wp_host_state_v2_';
  const READINESS_KEY='mmhd_wp_ready_v2_';
  let sb=null, room=null, connecting=false, local={position:0,paused:true,duration:0};
  let remote=null, seq=0, latestSeq=0, lastControlSession='', lastHostBroadcast=0;
  let lastChatAt=0, lastChatId=0, unread=0, blocked=false, audioNeeded=false;
  let lastHelloAt=0, lastGuestCorrection=0, chatOpen=true;
  const seenChats=new Set();
  let lastChatSerial=0;

  const styles=document.createElement('style');
  styles.textContent=`
  .mmhd-wp-btn{border:1px solid #3d6b9e!important;background:#162d50!important;color:#e0ecff!important;border-radius:8px;padding:8px 10px;font:700 12px Inter,Arial,sans-serif;cursor:pointer}
  .mmhd-wp-detail{grid-column:1/-1;min-height:42px}
  .mmhd-wp-cover[hidden],.mmhd-wp-chat[hidden],.mmhd-wp-launcher[hidden],.mmhd-wp-audio[hidden],.mmhd-wp-tools[hidden]{display:none!important}
  .mmhd-wp-cover{position:fixed;inset:0;z-index:300000;background:#02040bdc;display:grid;place-items:center;padding:14px;overflow-y:auto}
  .mmhd-wp-box{background:#101c2f;border:1px solid #476186;box-shadow:0 18px 70px #000a;color:#f5f9ff;border-radius:16px;padding:20px;width:min(100%,540px);max-height:95dvh;overflow-y:auto;font:13px/1.55 Inter,Arial,sans-serif}
  .mmhd-wp-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .mmhd-wp-head h2{margin:0;font-size:21px}
  .mmhd-wp-head button,.mmhd-wp-actions button,.mmhd-wp-tools button{padding:9px 12px;border:1px solid #5680b4;background:#1d3962;color:white;border-radius:9px;font-weight:750;cursor:pointer}
  .mmhd-wp-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:12px}
  .mmhd-wp-actions button:disabled{opacity:.42;cursor:not-allowed}
  .mmhd-wp-actions button.mmhd-wp-go{background:#15633d;border-color:#369d6b}
  .mmhd-wp-actions button.mmhd-wp-exit{background:#51222b;border-color:#a14b61}
  .mmhd-wp-box p{margin:11px 0;color:#d1ddf0}
  .mmhd-wp-box label{display:block;font-weight:750;margin-bottom:4px}
  .mmhd-wp-box input[type=text]{width:100%;border:1px solid #6881a7;border-radius:8px;background:#091321;padding:10px;color:#fff;font-size:13px}
  .mmhd-wp-users{display:flex;gap:9px;flex-wrap:wrap;margin:12px 0}
  .mmhd-wp-user{display:flex;align-items:center;gap:7px;border:1px solid #385077;border-radius:9px;padding:8px 11px;background:#13223a;flex:1;min-width:190px}
  .mmhd-wp-dot{width:9px;height:9px;border-radius:50%;background:#606f85;display:inline-block}
  .mmhd-wp-dot.ready{background:#27c77c}
  .mmhd-wp-status{color:#b6d8ff!important;font-weight:700}
  .mmhd-wp-warning{color:#e6c692!important;font-size:12px}
  .mmhd-wp-launcher{position:fixed;right:22px;bottom:22px;z-index:300010;border-radius:50%;border:1px solid #8bb4ff;background:#1b416f;color:white;width:54px;height:54px;cursor:pointer;font-size:23px;box-shadow:0 8px 30px #000b}
  .mmhd-wp-launcher em{position:absolute;top:-4px;right:-3px;min-width:21px;height:21px;display:grid;place-items:center;background:#e23d63;border-radius:15px;font:800 11px Inter;padding:0 4px}
  .mmhd-wp-chat{position:fixed;right:16px;bottom:16px;z-index:300011;width:min(370px,calc(100vw - 20px));height:min(505px,calc(100dvh - 40px));border:1px solid #526e96;background:rgba(14,24,40,var(--wp-chat-alpha,.96));border-radius:14px;display:flex;flex-direction:column;color:#fff;overflow:hidden;box-shadow:0 20px 65px #000c;font:13px/1.45 Inter,Arial,sans-serif}
  .mmhd-wp-chat-top{display:flex;gap:8px;align-items:center;background:#193453;padding:11px;min-height:55px}
  .mmhd-wp-chat-top strong{font-size:14px}.mmhd-wp-chat-top small{display:block;font-size:11px;color:#c1d5ee}
  .mmhd-wp-chat-top button{background:#345375;border:1px solid #6587ad;color:white;border-radius:7px;min-width:32px;height:31px;cursor:pointer}
  .mmhd-wp-chatlog{flex:1;overflow-y:auto;min-height:0;padding:11px;display:flex;flex-direction:column;gap:9px;overscroll-behavior:contain}
  .mmhd-wp-bubble{max-width:92%;align-self:flex-start;background:#284364;border-radius:12px;padding:8px 10px;white-space:pre-wrap;overflow-wrap:anywhere}
  .mmhd-wp-bubble.mine{align-self:flex-end;background:#205a98}
  .mmhd-wp-bubble.system{align-self:center;max-width:100%;background:transparent;text-align:center;color:#afc4df;font-size:11px;padding:0}
  .mmhd-wp-bubble b{font-size:10px;display:block;margin-bottom:3px}
  .mmhd-wp-audio{background:#1f5f9c;border:1px solid #85c3ff;border-radius:8px;color:#fff;padding:10px;margin:0 10px 8px;font-weight:750;cursor:pointer}
  .mmhd-wp-form{display:flex;gap:7px;background:#122139;border-top:1px solid #3e5c7a;padding:10px}
  .mmhd-wp-form input{flex:1;min-width:0;border:1px solid #607d9f;background:#081426;color:#fff;border-radius:7px;padding:9px;font-size:13px}
  .mmhd-wp-form button{background:#2864a0;border:1px solid #659fda;color:white;border-radius:7px;padding:9px 12px;cursor:pointer}
  .mmhd-wp-form :disabled{opacity:.43;cursor:not-allowed}
  .mmhd-wp-tools{background:#162b46;padding:9px 12px;display:flex;align-items:center;gap:7px;font-size:11px}
  .mmhd-wp-tools input{width:115px}
  @media(max-width:600px){.mmhd-wp-box{padding:15px}.mmhd-wp-chat{right:8px;bottom:75px;width:min(350px,calc(100vw - 16px));height:min(440px,calc(100dvh - 95px))}.mmhd-wp-launcher{right:12px;bottom:80px}}
  `;
  document.head.appendChild(styles);

  const dialog=document.createElement('div');dialog.id='mmhdWpDialog';dialog.className='mmhd-wp-cover';dialog.hidden=true;
  dialog.innerHTML=`<section class="mmhd-wp-box" role="dialog" aria-modal="true" aria-labelledby="mmhdWpTitle">
    <div class="mmhd-wp-head"><h2 id="mmhdWpTitle">🎬 Ver juntos · V2</h2><button type="button" id="mmhdWpClose" aria-label="Cerrar">✕</button></div>
    <p id="mmhdWpExplainer">Crea una sala temporal para dos navegadores.</p>
    <p id="mmhdWpStatus" class="mmhd-wp-status" role="status">Sin conexión</p>
    <div id="mmhdWpPresence" class="mmhd-wp-users" hidden>
      <div class="mmhd-wp-user"><span class="mmhd-wp-dot" id="mmhdWpHostDot"></span><span id="mmhdWpHostStatus">Anfitrión sin conectar</span></div>
      <div class="mmhd-wp-user"><span class="mmhd-wp-dot" id="mmhdWpGuestDot"></span><span id="mmhdWpGuestStatus">Invitado sin conectar</span></div>
    </div>
    <div id="mmhdWpInvite" hidden><label for="mmhdWpLink">Enlace de invitación</label><input id="mmhdWpLink" type="text" readonly autocomplete="off"/></div>
    <p class="mmhd-wp-warning" id="mmhdWpExpiry">Las salas duran hasta seis horas y el chat no guarda mensajes.</p>
    <div class="mmhd-wp-actions">
      <button type="button" id="mmhdWpCreate">Crear sala</button>
      <button type="button" id="mmhdWpReady" hidden>Estoy listo</button>
      <button type="button" id="mmhdWpStart" class="mmhd-wp-go" hidden>▶ Iniciar para ambos</button>
      <button type="button" id="mmhdWpCopy" hidden>Copiar enlace</button>
      <button type="button" id="mmhdWpResync" hidden>Sincronizar</button>
      <button type="button" id="mmhdWpRequestPause" hidden>Solicitar pausa</button>
      <button type="button" id="mmhdWpLeave" class="mmhd-wp-exit" hidden>Salir</button>
    </div>
  </section>`;
  document.body.appendChild(dialog);
  const launcher=document.createElement('button');launcher.type='button';launcher.id='mmhdWpChatLauncher';launcher.className='mmhd-wp-launcher';launcher.hidden=true;
  launcher.innerHTML='💬<em id="mmhdWpUnread" hidden>0</em>';launcher.title='Abrir chat de sala';document.body.appendChild(launcher);
  const chat=document.createElement('section');chat.id='mmhdWpChat';chat.className='mmhd-wp-chat';chat.hidden=true;
  chat.setAttribute('aria-label','Chat de Ver juntos');
  chat.innerHTML=`<div class="mmhd-wp-chat-top"><span aria-hidden="true">💬</span><div style="flex:1;min-width:0"><strong>Ver juntos · Chat</strong><small id="mmhdWpChatStatus">Esperando la sala…</small></div><button id="mmhdWpChatToolsBtn" type="button" title="Opciones visuales">⚙</button><button type="button" id="mmhdWpChatOptions" title="Sala">⋯</button><button id="mmhdWpMinimize" type="button" title="Minimizar">—</button></div>
    <div id="mmhdWpChatTools" class="mmhd-wp-tools" hidden><label for="mmhdWpOpacity">Transparencia</label><input type="range" id="mmhdWpOpacity" min="45" max="100" value="96"/><span id="mmhdWpOpacityLabel">96%</span></div>
    <div id="mmhdWpChatLog" class="mmhd-wp-chatlog" role="log" aria-live="polite"></div>
    <button type="button" id="mmhdWpAudio" class="mmhd-wp-audio" hidden>🔊 Activar sonido</button>
    <form id="mmhdWpChatForm" class="mmhd-wp-form"><input type="text" id="mmhdWpChatInput" maxlength="450" placeholder="Escribe un mensaje…" aria-label="Mensaje" disabled/><button id="mmhdWpChatSend" type="submit" disabled>Enviar</button></form>`;
  document.body.appendChild(chat);
  const playerButton=document.createElement('button');playerButton.id='mmhdWpPlayerBtn';playerButton.className='mmhd-wp-btn';playerButton.type='button';playerButton.textContent='👥 Ver juntos';
  const closePlayerButton=$('btnPlayerClose');if(closePlayerButton?.parentElement)closePlayerButton.parentElement.insertBefore(playerButton,closePlayerButton);
  const detailActions=document.querySelector('.detail-actions');
  if(detailActions){const b=document.createElement('button');b.id='mmhdWpDetailBtn';b.type='button';b.className='detail-btn detail-btn-secondary mmhd-wp-detail';b.textContent='👥 Ver juntos (2 navegadores)';detailActions.appendChild(b);b.addEventListener('click',openPanel);}

  function roomCodeInUrl(){return new URL(location.href).searchParams.get(ROOM_PARAM)||'';}
  function setRoomCodeUrl(code){const u=new URL(location.href);if(code)u.searchParams.set(ROOM_PARAM,code);else u.searchParams.delete(ROOM_PARAM);history.replaceState(history.state,'',u.pathname+u.search+u.hash);}
  function inviteUrl(code){return location.origin+'/?'+ROOM_PARAM+'='+encodeURIComponent(code);}
  function makeCode(){const a=crypto.getRandomValues(new Uint8Array(16));return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function status(t){$('mmhdWpStatus').textContent=t;updateChatUI();}
  function panel(show){dialog.hidden=!show;}
  function openPanel(){refreshUI();panel(true);}
  function openChat(){chat.hidden=false;launcher.hidden=true;unread=0;$('mmhdWpUnread').hidden=true;chatOpen=true;}
  function minimizeChat(){chat.hidden=true;launcher.hidden=!room;chatOpen=false;}
  function updateChatUI(){const connected=Boolean(room?.connected);$('mmhdWpChatInput').disabled=!connected;$('mmhdWpChatSend').disabled=!connected;
    $('mmhdWpAudio').hidden=!(room?.role==='guest'&&audioNeeded);
    $('mmhdWpChatStatus').textContent=connected?(room.role==='host'?'Anfitrión conectado':'Invitado conectado'):(room?'Reconectando…':'Sin sala');}
  function appendChat(kind,message){const holder=$('mmhdWpChatLog');const msg=document.createElement('div');msg.className='mmhd-wp-bubble '+(kind==='mine'?'mine':kind==='system'?'system':'');
    if(kind!=='system'){const b=document.createElement('b');b.textContent=kind==='mine'?'Tú':room?.role==='host'?'Invitado':'Anfitrión';msg.appendChild(b);}
    const span=document.createElement('span');span.textContent=String(message||'');msg.appendChild(span);holder.appendChild(msg);
    while(holder.children.length>100)holder.firstChild.remove();holder.scrollTop=holder.scrollHeight;
    postIframe({type:'mmhd-watch-chat-display',kind,text:String(message||'').slice(0,450)});
    if(chat.hidden&&kind==='other'){unread=Math.min(unread+1,99);$('mmhdWpUnread').textContent=String(unread);$('mmhdWpUnread').hidden=false;}
  }
  function note(message){appendChat('system',message);}
  function chatSend(message){const text=String(message||'').trim().slice(0,450);if(!room?.connected||!text||Date.now()-lastChatAt<400)return false;
    lastChatAt=Date.now();appendChat('mine',text);sendChat({kind:'chat',id:PEER+':'+(++lastChatSerial),text});return true;}
  function receiveChat(p){if(typeof p?.text!=='string'||!p.text.trim()||p.text.length>450||typeof p.id!=='string'||p.id.length>150||seenChats.has(p.id))return;
    seenChats.add(p.id);if(seenChats.size>300)seenChats.delete(seenChats.values().next().value);appendChat('other',p.text.trim());}
  function descriptor(movie){if(!movie)return null;return movie.parentSeriesId!=null?{type:'episode',seriesId:Number(movie.parentSeriesId),season:Number(movie.episodeSeason),episode:Number(movie.episodeNumber)}:{type:'movie',id:Number(movie.id)};}
  function resolve(d){if(!d||typeof d!=='object')return null;
    if(d.type==='movie')return MOVIES.find(m=>Number(m.id)===Number(d.id)&&m.kind!=='SERIES')||null;
    if(d.type==='episode'){
      const series=MOVIES.find(m=>Number(m.id)===Number(d.seriesId)&&m.kind==='SERIES');if(!series)return null;
      const ep=findSeriesEpisode(series,Number(d.season),Number(d.episode));return ep&&isPlayableEpisode(ep.data)?playableForSeries(series,ep.season,ep.data):null;
    }return null;
  }
  function activeMovie(){return typeof activePlayerMovie==='undefined'?null:activePlayerMovie;}
  function sameMovie(a,b){return a&&b&&String(a.id)===String(b.id)&&String(a.parentSeriesId||'')===String(b.parentSeriesId||'');}
  function postIframe(payload){const frame=$('playerFrame');if(!frame?.contentWindow)return;try{frame.contentWindow.postMessage({...payload,id:String(activeMovie()?.id??'')},'*');}catch(_){}}
  function playerVideo(){try{return $('playerFrame')?.contentDocument?.querySelector('#myDiv video')||$('playerFrame')?.contentDocument?.querySelector('video')||null;}catch(_){return null;}}
  function sendChat(p){const ch=room?.chatChannel;if(!ch||!room?.chatConnected)return;void Promise.resolve(ch.send({type:'broadcast',event:'mmhd-watch-chat',payload:{...p,peer:PEER}})).catch(e=>console.warn('[Ver juntos] chat',e));}
  function sendControl(p){const ch=room?.controlChannel;if(!ch||!room?.controlConnected||room?.role!=='host')return;
    void Promise.resolve(ch.send({type:'broadcast',event:'mmhd-watch-control',payload:{...p,peer:PEER}})).catch(e=>console.warn('[Ver juntos] control',e));}
  function mediaAvailable(){return activeMovie()&&typeof mmhdAudioVariants==='function'&&mmhdAudioVariants(activeMovie()).length>0;}
  function storeHostState(){
    if(!room||room.role!=='host'||!mediaAvailable())return;
    try{sessionStorage.setItem(HOST_STATE_KEY+room.code,JSON.stringify({media:descriptor(activeMovie()),position:local.position,paused:local.paused,started:room.started,time:Date.now()}));}catch(_){}
  }
  function publish(force){if(!room?.connected||room.role!=='host'||!mediaAvailable())return;
    if(!force&&Date.now()-lastHostBroadcast<12000)return;
    lastHostBroadcast=Date.now();const d=descriptor(activeMovie());
    try{sessionStorage.setItem(HOST_MEDIA_KEY+room.code,JSON.stringify(d));}catch(_){}
    storeHostState();
    sendControl({kind:'state',session:PEER,seq:++seq,media:d,position:local.position,paused:room.started?local.paused:true,
      duration:local.duration,started:room.started});
  }
  function queryVideo(){if(mediaAvailable())postIframe({type:'mmhd-watch-query'});}
  function setGate(enabled){postIframe({type:'mmhd-watch-gate',enabled:!!enabled});}
  function setPartyMode(enabled){postIframe({type:'mmhd-watch-party-mode',enabled:!!enabled});}
  function targetPosition(){if(!remote)return 0;return Math.max(0,remote.position+(remote.started&&!remote.paused?Math.max(0,(performance.now()-remote.receivedAt)/1000):0));}
  function syncGuest(force=false){if(!room||room.role!=='guest'||!remote)return;
    const media=resolve(remote.media);if(!media||!sameMovie(activeMovie(),media))return;
    postIframe({type:'mmhd-watch-guest-lock',enabled:true});
    postIframe({type:'mmhd-watch-sync',position:targetPosition(),paused:!remote.started||remote.paused,force:!!force});
    if(force)lastGuestCorrection=Date.now();
  }
  function currentPeers(){const entries=Object.values(room?.chatChannel?.presenceState()||{}).flat().filter(x=>x&&x.peer&&['host','guest'].includes(x.role));
    return {host:entries.find(x=>x.role==='host')||null,guest:entries.find(x=>x.role==='guest')||null};}
  function bothReady(){const p=currentPeers();return Boolean(p.host?.ready&&p.guest?.ready);}
  function refreshUI(){const r=room;$('mmhdWpCreate').hidden=!!r||!!connecting;$('mmhdWpCreate').disabled=connecting;
    $('mmhdWpInvite').hidden=!(r?.role==='host');$('mmhdWpCopy').hidden=!(r?.role==='host');
    $('mmhdWpReady').hidden=!r||r.started;$('mmhdWpStart').hidden=!r||r.role!=='host'||r.started;
    $('mmhdWpResync').hidden=!r||r.role!=='guest';$('mmhdWpRequestPause').hidden=!r||r.role!=='guest'||!r.started;
    $('mmhdWpLeave').hidden=!r;$('mmhdWpPresence').hidden=!r;
    if(r?.role==='host')$('mmhdWpLink').value=inviteUrl(r.code);
    $('mmhdWpReady').textContent=r?.ready?'✓ Estoy listo · Desmarcar':'✓ Estoy listo';
    $('mmhdWpStart').disabled=!(r?.connected&&bothReady()&&mediaAvailable());
    if(!r){$('mmhdWpExplainer').textContent=connecting?'Conectando con Supabase…':'Crea una sala temporal para dos navegadores.';$('mmhdWpExpiry').textContent='El chat es temporal y la sala caduca a las 6 horas.';}
    else{$('mmhdWpExplainer').textContent=r.role==='host'?'Comparte la invitación. Ambos pulsan «Estoy listo» y tú inicias la película.':'Entra a la sala, deja cargar el video y pulsa «Estoy listo» para que el anfitrión inicie.';
      const remain=Math.max(0,Math.ceil((r.expiresAt-Date.now())/60000));$('mmhdWpExpiry').textContent=`Sala privada · caduca en unos ${remain} minutos · solo 2 participantes.`;}
    const peers=currentPeers();for(const [name,p] of [['Host',peers.host],['Guest',peers.guest]]){
      $(name==='Host'?'mmhdWpHostStatus':'mmhdWpGuestStatus').textContent=(name==='Host'?'Anfitrión':'Invitado')+': '+(p?(p.ready?'listo':'conectado, preparando'):'sin conectar');
      $(name==='Host'?'mmhdWpHostDot':'mmhdWpGuestDot').classList.toggle('ready',Boolean(p?.ready));
    }
    updateChatUI();
  }
  function onPresence(){if(!room)return;const peers=currentPeers();
    if(room.role==='host'){
      status(room.started?(peers.guest?'Reproducción sincronizada · 2 navegadores':'Invitado desconectado · esperando reconexión'):(bothReady()?'Los dos están listos · puedes iniciar':peers.guest?'Invitado conectado · esperando a que ambos estén listos':'Sala creada · esperando invitado'));
    }else{status(room.started?(peers.host?'Siguiendo al anfitrión':'Anfitrión desconectado · reconectando'):(peers.host?'Conectado · indica cuando estés listo':'Esperando al anfitrión…'));}
    refreshUI();
  }
  function changeReady(next){if(!room?.connected||room.started)return;room.ready=!!next;
    try{sessionStorage.setItem(READINESS_KEY+room.code,room.ready?'1':'0');}catch(_){}
    if(room.role==='guest'&&room.ready){
      const video=playerVideo();
      if(video&&video.paused){try{const promise=video.play();if(promise&&promise.then)promise.then(()=>{video.pause();}).catch(()=>{});else video.pause();}catch(_){}}
    }
    void room.chatChannel.track({peer:PEER,role:room.role,ready:room.ready}).catch(()=>{});
    onPresence();
  }
  function attemptHostStart(){if(!room?.connected||room.role!=='host'||room.started||!bothReady()||!mediaAvailable())return;
    room.startArmed=true;status('Iniciando película para ambos…');setGate(false);
    const v=playerVideo();if(v){
      try{const p=v.play();if(p&&p.catch)p.catch(()=>{status('Pulsa Play dentro del video para iniciar la sesión.');});}catch(_){status('Pulsa Play dentro del video para iniciar la sesión.');}
    }else{postIframe({type:'mmhd-watch-host-play'});status('Cargando video… si no inicia, pulsa Play dentro del reproductor.');}
  }
  function markStarted(){if(!room||room.role!=='host'||room.started||!room.startArmed)return;
    room.started=true;room.startArmed=false;local.paused=false;publish(true);refreshUI();status('Película iniciada · sincronizando al invitado');
    note('La función inició. Cada participante puede cambiar idioma, calidad y subtítulos sin afectar al otro.');
  }
  async function enableAudio(){if(!room||room.role!=='guest')return;
    const v=playerVideo();if(v){try{v.muted=false;const p=remote&&!remote.paused?v.play():null;if(p?.then)await p;audioNeeded=false;blocked=false;updateChatUI();note('Sonido activado.');}
      catch(_){audioNeeded=true;note('El navegador sigue bloqueando el audio; toca Play dentro del video.');}}
    else{postIframe({type:'mmhd-watch-enable-audio'});note('Si aún no suena, toca Play dentro del video.');}
  }
  function receivedControl(p){if(!room||room.role!=='guest'||!p)return;
    if(p.kind==='closed'){note('El anfitrión cerró esta sala.');void leave('El anfitrión cerró la sala.');return;}
    if(p.kind!=='state'||typeof p.session!=='string')return;
    const order=Number(p.seq);if(!Number.isSafeInteger(order)||order<1)return;
    if(lastControlSession!==p.session){lastControlSession=p.session;latestSeq=0;}
    if(order<=latestSeq)return;
    const media=resolve(p.media);if(!media){status('El título no está disponible en tu catálogo. Actualiza la página.');return;}
    latestSeq=order;
    const old=remote,firstStart=Boolean(p.started)&&(!old||!old.started);
    remote={media:p.media,position:Math.max(0,Number(p.position)||0),paused:Boolean(p.paused),started:Boolean(p.started),receivedAt:performance.now()};
    if(!room.started&&remote.started){room.started=true;room.ready=true;refreshUI();note('El anfitrión inició la película.');}
    if(!sameMovie(activeMovie(),media)){
      openPlayer(media);setTimeout(()=>{setGate(!remote.started);syncGuest(true);},250);
    }else{setGate(!remote.started);syncGuest(firstStart||!old||old.paused!==remote.paused);}
    if(remote.started&&!blocked)status('Reproduciendo junto al anfitrión');
  }
  async function ensureClient(){const cfg=window.MMHD_WATCH_PARTY_CONFIG||{};
    const url=String(cfg.supabaseUrl||'').trim();const key=String(cfg.publishableKey||'').trim();
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)||!key||/^sb_secret_|^ey.*service_role/i.test(key))throw Error('Configura supabaseUrl y publishableKey en ver-juntos-config.js.');
    if(!window.supabase?.createClient)throw Error('No se cargó la biblioteca Supabase JS.');
    if(!sb)sb=window.supabase.createClient(url.replace(/\/$/,''),key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'mmhd-watch-party-v2-auth'}});
    let {data:{session},error}=await sb.auth.getSession();if(error)throw error;
    if(!session){const auth=await sb.auth.signInAnonymously();if(auth.error)throw Error('Activa Anonymous Sign-ins en Supabase Auth: '+auth.error.message);session=auth.data.session;}
    if(!session?.access_token)throw Error('No fue posible obtener autorización de Supabase.');
    sb.realtime.setAuth(session.access_token);return sb;
  }
  function friendlyError(message){
    const m=String(message||'');
    if(m.includes('ROOM_FULL'))return 'Esta sala ya tiene anfitrión e invitado. Pide al anfitrión una invitación nueva.';
    if(m.includes('ROOM_NOT_FOUND_OR_EXPIRED'))return 'La invitación ya caducó o la sala fue cerrada.';
    if(m.includes('ROOM_CREATION_LIMIT'))return 'Has creado demasiadas salas recientemente. Prueba más tarde.';
    if(m.includes('ROOM_ALREADY_EXISTS'))return 'No se pudo crear el código de sala; vuelve a intentarlo.';
    if(m.includes('AUTH_REQUIRED'))return 'No fue posible iniciar la sesión anónima de Supabase.';
    if(/permission denied|row.level.security|unauthorized/i.test(m))return 'Supabase rechazó el acceso privado. Revisa las políticas de Realtime y la sesión anónima.';
    return m;
  }
  async function connect(code,create){if(connecting||room)return;
    if(!ROOM_RE.test(code||''))return;
    connecting=true;openChat();refreshUI();status('Autenticando e ingresando a la sala privada…');
    try{
      const client=await ensureClient();
      const {data,error}=await client.rpc('mmhd_wp_enter',{p_code:code,p_create:Boolean(create)});
      if(error)throw Error(/function .* does not exist|not found/i.test(error.message)?'Falta ejecutar supabase/ver-juntos-v2.sql en el SQL Editor.':error.message);
      const seat=Array.isArray(data)?data[0]:data;
      if(!seat||!['host','guest'].includes(seat.member_role))throw Error('Supabase no confirmó tu lugar en la sala.');
      const expiresAt=Date.parse(seat.room_expires_at);
      if(!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw Error('La invitación está vencida.');
      room={code,role:seat.member_role,expiresAt,ready:false,started:false,startArmed:false,connected:false,chatConnected:false,controlConnected:false,chatChannel:null,controlChannel:null};
      local={position:0,paused:true,duration:0};remote=null;seq=0;latestSeq=0;lastControlSession='';blocked=false;audioNeeded=false;
      $('mmhdWpChatLog').replaceChildren();seenChats.clear();
      const current=room;
      if(room.role==='host'){
        setRoomCodeUrl(code);
        if(!create){try{const old=JSON.parse(sessionStorage.getItem(HOST_STATE_KEY+code)||'null');
          if(old?.started&&resolve(old.media)){room.started=true;room.ready=true;local={position:Math.max(0,Number(old.position)||0),paused:true,duration:0};
            note('Sesión recuperada. Pulsa Play para reanudar y sincronizar a tu invitado.');}
        }catch(_){}}
        if(!activeMovie()){
          try{const saved=JSON.parse(sessionStorage.getItem(HOST_MEDIA_KEY+code)||'null');const movie=resolve(saved);if(movie)openPlayer(movie);}catch(_){}
        }
        if(!activeMovie()&&create){const candidate=typeof selectedPlayable==='function'?selectedPlayable():null;if(candidate&&mmhdAudioVariants(candidate)?.length)openPlayer(candidate);}
      }
      const chatCh=client.channel(CODE_PREFIX+'chat-'+code,{config:{private:true,broadcast:{ack:false,self:false},presence:{key:PEER}}});
      const controlCh=client.channel(CODE_PREFIX+'control-'+code,{config:{private:true,broadcast:{ack:false,self:false}}});
      current.chatChannel=chatCh;current.controlChannel=controlCh;
      chatCh.on('broadcast',{event:'mmhd-watch-chat'},({payload})=>{
        if(room!==current||!payload||payload.peer===PEER)return;
        if(payload.kind==='chat')receiveChat(payload);
        if(payload.kind==='hello'&&current.role==='host'){queryVideo();publish(true);}
        if(payload.kind==='pause-request'&&current.role==='host'){note('El invitado solicitó una pausa.');openChat();}
      });
      chatCh.on('presence',{event:'sync'},()=>{if(room===current)onPresence();});
      controlCh.on('broadcast',{event:'mmhd-watch-control'},({payload})=>{
        if(room===current&&current.role==='guest')receivedControl(payload);
      });
      const statusHandler=(which,st)=>{
        if(room!==current)return;
        if(st==='SUBSCRIBED'){
          current[which+'Connected']=true;
          if(which==='chat'){void chatCh.track({peer:PEER,role:current.role,ready:current.ready}).catch(e=>console.warn('[Ver juntos] presence',e));}
          if(current.chatConnected&&current.controlConnected){
            current.connected=true;connecting=false;refreshUI();onPresence();
            setPartyMode(true);
            if(current.role==='host'){setGate(!current.started);queryVideo();publish(true);note('Sala privada lista. Comparte el enlace y marca «Estoy listo».');}
            else{sendChat({kind:'hello'});note('Entraste a la sala privada. Pulsa «Estoy listo» cuando cargue la película.');}
          }
        }else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(st)){
          current[which+'Connected']=false;current.connected=false;status('Conexión interrumpida; Supabase intentará reconectar…');refreshUI();
        }
      };
      chatCh.subscribe(st=>statusHandler('chat',st));
      controlCh.subscribe(st=>statusHandler('control',st));
      if(create){note('Se creó una sala privada con vencimiento de seis horas.');}
      refreshUI();
    }catch(e){console.warn('[Ver juntos] Conexión',e);connecting=false;room=null;status('No se pudo ingresar: '+friendlyError(e.message||e));panel(true);refreshUI();}
  }
  async function leave(reason='Has salido de Ver juntos. Puedes continuar viendo por tu cuenta.'){const old=room;room=null;connecting=false;remote=null;audioNeeded=false;blocked=false;
    setRoomCodeUrl('');chat.hidden=true;launcher.hidden=true;
    if(old){
      if(old.role==='host'&&old.connected)sendClosed(old);
      try{await sb?.rpc('mmhd_wp_exit',{p_code:old.code});}catch(e){console.warn('[Ver juntos] No se pudo liberar sala',e);}
      try{await sb?.removeChannel(old.chatChannel);}catch(_){}
      try{await sb?.removeChannel(old.controlChannel);}catch(_){}
      try{sessionStorage.removeItem(HOST_MEDIA_KEY+old.code);sessionStorage.removeItem(HOST_STATE_KEY+old.code);sessionStorage.removeItem(READINESS_KEY+old.code);}catch(_){}
    }
    setPartyMode(false);setGate(false);refreshUI();status(reason);panel(false);
  }
  function sendClosed(old){try{void old.controlChannel?.send({type:'broadcast',event:'mmhd-watch-control',payload:{kind:'closed',peer:PEER}}).catch(()=>{});}catch(_){}}
  function tick(){if(!room?.connected)return;
    if(room.expiresAt<=Date.now()){void leave('La sala caducó. Puedes crear otra.');return;}
    if(room.role==='host'){queryVideo();publish(false);}
    else if(room.role==='guest'){
      if(!remote&&Date.now()-lastHelloAt>12000){lastHelloAt=Date.now();sendChat({kind:'hello'});}
      else if(remote){syncGuest(false);}
    }
    refreshUI();
  }
  const heartbeat=setInterval(tick,12000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){
    if(room?.connected){if(room.role==='host'){queryVideo();publish(true);}else{sendChat({kind:'hello'});syncGuest(true);}}
  }});
  window.addEventListener('online',()=>{if(room?.connected){if(room.role==='guest')sendChat({kind:'hello'});else publish(true);}});
  window.addEventListener('message',event=>{
    if(!room||event.source!==$('playerFrame')?.contentWindow||!event.data||!activeMovie())return;
    const d=event.data;if(String(d.id)!==String(activeMovie().id))return;
    if(room.role==='host'){
      if(d.type==='mmhd-watch-ready'){setPartyMode(true);setGate(!room.started);queryVideo();}
      if(d.type==='mmhd-watch-event'){
        const why=String(d.reason||'');local={position:Math.max(0,Number(d.position)||0),duration:Number(d.duration)||0,paused:Boolean(d.paused)};
        if(why==='play'&&!room.started){if(room.startArmed&&bothReady())markStarted();else setGate(true);}
        if(room.started&&['play','pause','seeked','ended'].includes(why))publish(true);
        else if(room.started&&why==='time')publish(false);
      }
      if(d.type==='mmhd-watch-blocked')status('Para iniciar, pulsa Play dentro del reproductor.');
    }else{
      if(d.type==='mmhd-watch-ready'){setPartyMode(true);setGate(!room.started);syncGuest(true);}
      if(d.type==='mmhd-watch-event'&&room.started&&['pause','seeked','play'].includes(d.reason)&&Date.now()-lastGuestCorrection>650){syncGuest(true);}
      if(d.type==='mmhd-watch-muted-start'||d.type==='mmhd-watch-blocked'){
        const first=!audioNeeded;blocked=true;audioNeeded=true;openChat();updateChatUI();if(first)note('Tu navegador bloqueó el sonido automático. Pulsa «Activar sonido».');
      }
    }
    if(d.type==='mmhd-watch-fs-chat-send'&&typeof d.text==='string')chatSend(d.text);
    if(d.type==='mmhd-watch-fs-chat-unmute')void enableAudio();
  });

  window.mmhdWatchParty={
    isGuest:()=>room?.role==='guest',
    restoreSeconds:id=>room?.role==='guest'&&remote&&String(resolve(remote.media)?.id)===String(id)?targetPosition():null,
    onPlayerOpen:movie=>{if(!room)return;
      if(room.role==='host'){if(!room.started)local={position:0,paused:true,duration:0};try{sessionStorage.setItem(HOST_MEDIA_KEY+room.code,JSON.stringify(descriptor(movie)));}catch(_){}
        setTimeout(()=>{if(room){setPartyMode(true);setGate(!room.started);queryVideo();publish(true);}},280);
      }else{setTimeout(()=>{if(room){setPartyMode(true);setGate(!room.started);syncGuest(true);}},280);}
    },
    onPlayerClose:()=>{if(room)void leave();},openPanel
  };
  $('mmhdWpClose').addEventListener('click',()=>panel(false));
  $('mmhdWpCreate').addEventListener('click',()=>{
    const candidate=activeMovie()||(typeof selectedPlayable==='function'?selectedPlayable():null);
    if(!candidate||!mmhdAudioVariants(candidate)?.length){status('Abre primero una película o un episodio con video.');return;}
    void connect(makeCode(),true);
  });
  $('mmhdWpReady').addEventListener('click',()=>changeReady(!room?.ready));
  $('mmhdWpStart').addEventListener('click',attemptHostStart);
  $('mmhdWpCopy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(inviteUrl(room.code));status('Enlace de invitación copiado.');}catch(_){$('mmhdWpLink').select();status('Selecciona y copia el enlace manualmente.');}});
  $('mmhdWpResync').addEventListener('click',()=>{if(room?.role==='guest'){sendChat({kind:'hello'});syncGuest(true);status('Sincronización solicitada.');}});
  $('mmhdWpRequestPause').addEventListener('click',()=>{if(room?.role==='guest'){sendChat({kind:'pause-request'});note('Le pediste al anfitrión que haga una pausa.');}});
  $('mmhdWpLeave').addEventListener('click',()=>void leave());
  launcher.addEventListener('click',openChat);
  $('mmhdWpMinimize').addEventListener('click',minimizeChat);
  $('mmhdWpChatOptions').addEventListener('click',openPanel);
  $('mmhdWpChatToolsBtn').addEventListener('click',()=>{$('mmhdWpChatTools').hidden=!$('mmhdWpChatTools').hidden;});
  $('mmhdWpOpacity').addEventListener('input',e=>{const v=Number(e.target.value)||96;chat.style.setProperty('--wp-chat-alpha',String(v/100));$('mmhdWpOpacityLabel').textContent=v+'%';postIframe({type:'mmhd-watch-chat-opacity',opacity:v/100});});
  $('mmhdWpChatForm').addEventListener('submit',e=>{e.preventDefault();if(chatSend($('mmhdWpChatInput').value))$('mmhdWpChatInput').value='';});
  $('mmhdWpAudio').addEventListener('click',()=>void enableAudio());
  playerButton.addEventListener('click',openPanel);
  dialog.addEventListener('click',e=>{if(e.target===dialog)panel(false);});
  // No liberar el lugar en pagehide: así la misma sesión se reconecta al actualizar.
  // Al salir explícitamente sí se libera (el anfitrión cierra la sala).
  refreshUI();
  const invite=roomCodeInUrl();
  if(ROOM_RE.test(invite)){
    openChat();note('Invitación detectada. Conectando a la sala privada…');void connect(invite,false);
  }
})();
