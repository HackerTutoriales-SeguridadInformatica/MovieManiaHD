/* Movie Mania HD V3 — Ver juntos experimental (1 anfitrión + 1 invitado)
 * Transporte: Supabase Realtime Broadcast + Presence, canales públicos con códigos aleatorios.
 * No transmite video, URLs, subtítulos ni secretos; solo identificador y estado de reproducción.
 * El invitado solo recibe comandos del anfitrión. Cada navegador descarga/reproduce su propia copia.
 */
(function () {
  'use strict';
  if (window.mmhdWatchParty) return;

  const $ = id => document.getElementById(id);
  const ROOM_PARAM = 'verjuntos';
  const ROOM_RE = /^[A-Za-z0-9_-]{22}$/;
  const myPeer = (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16))).map(x=>x.toString(16).padStart(2,'0')).join(''));
  let sb = null;
  let room = null;
  let lastLocal = {position:0, paused:true, duration:0};
  let remote = null;
  let lastHostSeq = 0;
  let lastSent = 0;
  let seq = 0;
  let connecting = false;
  let pendingHostMissing = false;
  let currentRoomUrl = '';
  let guestBlocked = false;
  let guestNeedsAudio = false;
  let chatUnread = 0;
  let lastChatSent = 0;
  const seenChat = new Set();
  const timer = window.setInterval(tick, 3500);

  const css = document.createElement('style');
  css.textContent = `
  .mmhd-wp-btn{background:#13223b!important;color:#c0dcff!important;border:1px solid #3b6293!important;border-radius:8px;padding:8px 10px;font:700 12px Inter,Arial,sans-serif;white-space:nowrap;cursor:pointer}
  .mmhd-wp-btn:hover{background:#223d68!important}
  .mmhd-wp-detail{grid-column:1/-1;min-height:42px}
  .mmhd-wp-backdrop[hidden]{display:none!important}
  .mmhd-wp-backdrop{position:fixed;inset:0;z-index:300000;background:#02050bd9;display:grid;place-items:center;padding:18px;overflow-y:auto}
  .mmhd-wp-card{background:#111829;border:1px solid #3b4a67;box-shadow:0 14px 55px #000b;border-radius:16px;padding:20px;max-width:510px;width:min(100%,510px);color:#f5f8ff;font:14px/1.6 Inter,Arial,sans-serif}
  .mmhd-wp-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .mmhd-wp-top h2{margin:0;font-size:20px}
  .mmhd-wp-card p{color:#bec8d8;font-size:13px;margin:10px 0}
  .mmhd-wp-card label{display:block;font-weight:750;margin-top:10px;margin-bottom:4px}
  .mmhd-wp-card input{border:1px solid #4c5c79;background:#090f1c;padding:10px;border-radius:8px;color:#fff;width:100%;font:13px Inter,Arial,sans-serif}
  .mmhd-wp-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
  .mmhd-wp-actions button,.mmhd-wp-top button{border:1px solid #53698b;background:#1c3459;border-radius:8px;padding:9px 13px;color:#f5f8ff;cursor:pointer;font-weight:700}
  .mmhd-wp-actions button:disabled{opacity:.55;cursor:wait}
  .mmhd-wp-actions .mmhd-wp-danger{border-color:#a43d49;background:#491922}
  .mmhd-wp-card .mmhd-wp-status{margin-top:10px;color:#a6d7ff;font-weight:700}
  .mmhd-wp-card .mmhd-wp-notice{font-size:12px;color:#f4d6a0}
  /* Chat de sala: fuera del iframe para mantenerse accesible durante la película. */
  .mmhd-wp-chat[hidden],.mmhd-wp-chat-launcher[hidden],.mmhd-wp-chat-audio[hidden]{display:none!important}
  .mmhd-wp-chat-launcher{position:fixed;right:22px;bottom:22px;z-index:300010;background:#1c3459;border:1px solid #74a8ff;border-radius:50%;width:52px;height:52px;box-shadow:0 8px 24px #000b;color:white;cursor:pointer;font-size:22px}
  .mmhd-wp-chat-launcher span{position:absolute;right:-3px;top:-5px;display:grid;place-items:center;min-width:20px;height:20px;border-radius:12px;background:#e23e63;font:800 11px Inter,sans-serif;padding:0 3px}
  .mmhd-wp-chat{position:fixed;right:18px;bottom:18px;z-index:300011;width:min(365px,calc(100vw - 24px));height:min(490px,calc(100dvh - 50px));border:1px solid #475b80;background:#0e1728;box-shadow:0 18px 55px #000c;border-radius:15px;display:flex;flex-direction:column;overflow:hidden;color:#fff;font:13px/1.45 Inter,Arial,sans-serif}
  .mmhd-wp-chat-head{display:flex;gap:9px;align-items:center;background:#1b3052;padding:10px 12px;min-height:60px}
  .mmhd-wp-chat-head strong{display:block;font-size:14px;line-height:1.3}
  .mmhd-wp-chat-head small{display:block;color:#bed3f3;font-size:11px}
  .mmhd-wp-chat-head-title{flex:1;min-width:0}
  .mmhd-wp-chat-head button{background:#304a70;border:1px solid #5877a4;color:#fff;border-radius:7px;min-width:30px;height:30px;cursor:pointer}
  .mmhd-wp-chat-messages{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:9px;padding:12px;background:#0b1220}
  .mmhd-wp-msg{max-width:92%;align-self:flex-start;background:#23354f;border-radius:12px 12px 12px 4px;padding:8px 10px;overflow-wrap:anywhere;white-space:pre-wrap}
  .mmhd-wp-msg.mine{background:#1e4d84;align-self:flex-end;border-radius:12px 12px 4px 12px}
  .mmhd-wp-msg .mmhd-wp-who{display:block;font-size:10px;font-weight:800;color:#d7eaff;margin-bottom:4px}
  .mmhd-wp-msg.system{max-width:100%;align-self:center;background:transparent;color:#9eafc7;font-size:11px;text-align:center;padding:0 5px}
  .mmhd-wp-chat-audio{margin:0 10px 8px;border:1px solid #7ab3ff;border-radius:8px;background:#1d5a9b;color:white;font:800 12px Inter,Arial,sans-serif;padding:10px;cursor:pointer}
  .mmhd-wp-chat-form{display:flex;gap:7px;padding:10px;border-top:1px solid #344764;background:#111e33}
  .mmhd-wp-chat-form input{flex:1;min-width:0;background:#08101e;border:1px solid #516687;color:white;border-radius:8px;padding:9px;font:13px Inter,Arial,sans-serif}
  .mmhd-wp-chat-form button{padding:9px 12px;border-radius:8px;border:1px solid #689de7;background:#245793;color:#fff;font-weight:800;cursor:pointer}
  .mmhd-wp-chat-form button:disabled,.mmhd-wp-chat-form input:disabled{opacity:.45;cursor:not-allowed}
  @media(max-width:600px){.mmhd-wp-chat{right:9px;bottom:76px;width:min(340px,calc(100vw - 18px));height:min(420px,calc(100dvh - 100px))}.mmhd-wp-chat-launcher{right:13px;bottom:80px}}
  @media(max-width:540px){.mmhd-wp-btn{font-size:10px;padding:6px 7px}.mmhd-wp-card{padding:16px}}
  `;
  document.head.appendChild(css);

  const dialog = document.createElement('div');
  dialog.className = 'mmhd-wp-backdrop';
  dialog.id = 'mmhdWpDialog';
  dialog.hidden = true;
  dialog.innerHTML = `
    <div class="mmhd-wp-card" role="dialog" aria-modal="true" aria-labelledby="mmhdWpTitle">
      <div class="mmhd-wp-top"><h2 id="mmhdWpTitle">🎬 Ver juntos</h2><button type="button" id="mmhdWpClose" aria-label="Cerrar panel">✕</button></div>
      <p id="mmhdWpExplain">Crea una sala e invita a otra persona para sincronizar la película.</p>
      <div id="mmhdWpInviteBlock" hidden><label for="mmhdWpLink">Enlace para compartir</label><input type="text" id="mmhdWpLink" readonly autocomplete="off"></div>
      <p id="mmhdWpStatus" class="mmhd-wp-status" role="status">Sin conexión</p>
      <p id="mmhdWpNotice" class="mmhd-wp-notice">La reproducción se descarga por separado en cada navegador. No incluye chat ni Chromecast en esta prueba.</p>
      <div class="mmhd-wp-actions">
        <button type="button" id="mmhdWpCreate">Crear sala</button>
        <button type="button" id="mmhdWpJoin" hidden>Entrar a la sala</button>
        <button type="button" id="mmhdWpCopy" hidden>Copiar enlace</button>
        <button type="button" id="mmhdWpResync" hidden>Sincronizar ahora</button>
        <button type="button" id="mmhdWpLeave" class="mmhd-wp-danger" hidden>Salir de la sala</button>
      </div>
    </div>`;
  document.body.appendChild(dialog);

  const chatLauncher=document.createElement('button');
  chatLauncher.id='mmhdWpChatLauncher';chatLauncher.className='mmhd-wp-chat-launcher';
  chatLauncher.type='button';chatLauncher.hidden=true;chatLauncher.title='Abrir chat de Ver juntos';
  chatLauncher.innerHTML='💬 <span id="mmhdWpChatUnread" hidden>0</span>';
  document.body.appendChild(chatLauncher);
  const chat=document.createElement('section');
  chat.id='mmhdWpChat';chat.className='mmhd-wp-chat';chat.hidden=true;
  chat.setAttribute('aria-label','Chat de Ver juntos');
  chat.innerHTML=`
    <div class="mmhd-wp-chat-head">
      <span aria-hidden="true">💬</span>
      <div class="mmhd-wp-chat-head-title"><strong>Ver juntos · Chat</strong><small id="mmhdWpChatStatus">Esperando conexión…</small></div>
      <button type="button" id="mmhdWpChatOptions" title="Opciones de sala" aria-label="Opciones de sala">⚙</button>
      <button type="button" id="mmhdWpChatMinimize" title="Minimizar chat" aria-label="Minimizar chat">—</button>
    </div>
    <div id="mmhdWpChatMessages" class="mmhd-wp-chat-messages" role="log" aria-label="Mensajes del chat" aria-live="polite"></div>
    <button type="button" class="mmhd-wp-chat-audio" id="mmhdWpChatAudio" hidden>🔊 Activar sonido y reproducción</button>
    <form id="mmhdWpChatForm" class="mmhd-wp-chat-form">
      <input id="mmhdWpChatInput" type="text" maxlength="450" autocomplete="off" placeholder="Escribe un mensaje…" aria-label="Tu mensaje" disabled>
      <button id="mmhdWpChatSend" type="submit" disabled>Enviar</button>
    </form>`;
  document.body.appendChild(chat);

  function openChat(){chat.hidden=false;chatLauncher.hidden=true;chatUnread=0;$('mmhdWpChatUnread').hidden=true;}
  function minimizeChat(){chat.hidden=true;chatLauncher.hidden=!(room||ROOM_RE.test(new URL(location.href).searchParams.get(ROOM_PARAM)||''));}
  function chatSystem(message){appendChat('system',message);}
  function appendChat(kind,message){
    const holder=$('mmhdWpChatMessages');
    const item=document.createElement('div');item.className='mmhd-wp-msg'+(kind==='mine'?' mine':kind==='system'?' system':'');
    if(kind!=='system'){
      const who=document.createElement('span');who.className='mmhd-wp-who';
      who.textContent=kind==='mine'?(room?.role==='host'?'Tú · Anfitrión':'Tú · Invitado'):(room?.role==='host'?'Invitado':'Anfitrión');
      item.appendChild(who);
    }
    const msg=document.createElement('span');msg.textContent=String(message);item.appendChild(msg);
    holder.appendChild(item);
    while(holder.children.length>120)holder.firstChild.remove();
    holder.scrollTop=holder.scrollHeight;
    if(chat.hidden&&kind==='other'){
      chatUnread=Math.min(99,chatUnread+1);$('mmhdWpChatUnread').textContent=String(chatUnread);
      $('mmhdWpChatUnread').hidden=false;
    }
  }
  function updateChatUI(){
    const connected=Boolean(room?.connected);
    $('mmhdWpChatInput').disabled=!connected;
    $('mmhdWpChatSend').disabled=!connected;
    $('mmhdWpChatStatus').textContent=connected
      ?(room.role==='host'?'Sala activa · anfitrión':'Sala activa · invitado')
      :(room?'Conectando con la sala…':'Sin conexión');
    $('mmhdWpChatAudio').hidden=!(room?.role==='guest'&&guestNeedsAudio);
    if(!room&&!ROOM_RE.test(new URL(location.href).searchParams.get(ROOM_PARAM)||''))chatLauncher.hidden=true;
  }
  function receiveChat(payload){
    if(!room?.connected || typeof payload.text!=='string' || payload.text.length>450 || !payload.text.trim())return;
    if(payload.role===(room.role==='host'?'guest':'host') && typeof payload.id==='string' && payload.id.length<120 && !seenChat.has(payload.id)){
      seenChat.add(payload.id);if(seenChat.size>300)seenChat.delete(seenChat.values().next().value);
      appendChat('other',payload.text.trim());
    }
  }
  function sendChat(){
    const field=$('mmhdWpChatInput');const message=field.value.trim();
    if(!room?.connected || !message || message.length>450 || Date.now()-lastChatSent<350)return;
    lastChatSent=Date.now();field.value='';
    appendChat('mine',message);
    send({kind:'chat',id:myPeer+':'+Date.now(),text:message});
  }
  function enableGuestAudio(){
    if(!room || room.role!=='guest')return;
    const frame=$('playerFrame');let video=null;
    try{video=frame?.contentDocument?.querySelector('#myDiv video')||frame?.contentDocument?.querySelector('video');}catch(_){/* iframe no accesible */}
    if(video){
      try{
        video.muted=false;
        const p=remote?.paused?null:video.play();
        if(p?.then)p.then(()=>{guestNeedsAudio=false;guestBlocked=false;updateChatUI();chatSystem('Sonido activado.');})
          .catch(()=>{guestNeedsAudio=true;updateChatUI();chatSystem('Chrome sigue bloqueando el sonido. Toca Play dentro del video.');});
        else{guestNeedsAudio=false;guestBlocked=false;updateChatUI();}
      }catch(_){chatSystem('No se pudo activar el audio desde este navegador; toca Play en el video.');}
    }else{
      try{frame?.contentWindow?.postMessage({type:'mmhd-watch-enable-audio',id:String(activeMovie()?.id??'')},'*');}catch(_){}
      chatSystem('Intenta activar el sonido con Play en el video.');
    }
  }
  chatLauncher.addEventListener('click',openChat);
  $('mmhdWpChatMinimize').addEventListener('click',minimizeChat);
  $('mmhdWpChatOptions').addEventListener('click',openPanel);
  $('mmhdWpChatAudio').addEventListener('click',enableGuestAudio);
  $('mmhdWpChatForm').addEventListener('submit',e=>{e.preventDefault();sendChat();});

  const playButton = document.createElement('button');
  playButton.type = 'button'; playButton.className = 'mmhd-wp-btn';
  playButton.id = 'mmhdWpPlayerBtn'; playButton.textContent = '👥 Ver juntos';
  const playerClose = $('btnPlayerClose');
  if (playerClose?.parentElement) playerClose.parentElement.insertBefore(playButton,playerClose);
  playButton.addEventListener('click',openPanel);

  const detailActions = document.querySelector('.detail-actions');
  if(detailActions){
    const b = document.createElement('button'); b.type = 'button'; b.id = 'mmhdWpDetailBtn';
    b.className = 'detail-btn detail-btn-secondary mmhd-wp-detail';
    b.innerHTML = '<i class="fa-solid fa-users"></i> Ver juntos (2 navegadores)';
    detailActions.appendChild(b);
    b.addEventListener('click',()=>{openPanel();});
  }

  function status(s){$('mmhdWpStatus').textContent=s;updateChatUI();}
  function label(s){$('mmhdWpExplain').textContent=s;}
  function modal(show){dialog.hidden=!show;}
  function setBusy(v){connecting=!!v;$('mmhdWpCreate').disabled=connecting;$('mmhdWpJoin').disabled=connecting;}
  function refreshUI(){
    const pendingCode=new URL(location.href).searchParams.get(ROOM_PARAM);
    const canJoin=!room && ROOM_RE.test(pendingCode||'');
    $('mmhdWpCreate').hidden=Boolean(room)||canJoin;
    $('mmhdWpJoin').hidden=Boolean(room)||!canJoin;
    $('mmhdWpCopy').hidden=!room || room.role!=='host';
    $('mmhdWpResync').hidden=!room || room.role!=='guest';
    $('mmhdWpLeave').hidden=!room;
    $('mmhdWpInviteBlock').hidden=!room || room.role!=='host';
    if(room?.role==='host'){$('mmhdWpLink').value=currentRoomUrl;}
    updateChatUI();
    if(canJoin)label('Has recibido una invitación. Conectando el chat y la película automáticamente…');
    else if(room?.role==='host')label('Comparte el enlace. Solo tú controlas la reproducción; el invitado puede elegir subtítulos e idioma localmente.');
    else if(room?.role==='guest')label('Conectado como invitado. El anfitrión controla la reproducción; puedes escoger tus propios subtítulos.');
    else label('Abre una película o un episodio y crea una sala para dos navegadores.');
  }
  function openPanel(){refreshUI();modal(true);}
  function makeCode(){
    const bytes=crypto.getRandomValues(new Uint8Array(16));
    let str='';for(const v of bytes)str+=String.fromCharCode(v);
    return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function descriptor(movie){
    if(!movie)return null;
    return movie.parentSeriesId!=null
      ? {type:'episode',seriesId:Number(movie.parentSeriesId),season:Number(movie.episodeSeason),episode:Number(movie.episodeNumber)}
      : {type:'movie',id:Number(movie.id)};
  }
  function resolve(desc){
    if(!desc||typeof desc!=='object')return null;
    if(desc.type==='movie'){
      return MOVIES.find(m=>Number(m.id)===Number(desc.id)&&m.kind!=='SERIES')||null;
    }
    if(desc.type==='episode'){
      const series=MOVIES.find(m=>Number(m.id)===Number(desc.seriesId)&&m.kind==='SERIES');
      if(!series)return null;
      const found=findSeriesEpisode(series,Number(desc.season),Number(desc.episode));
      return found&&isPlayableEpisode(found.data)?playableForSeries(series,found.season,found.data):null;
    }
    return null;
  }
  function activeMovie(){return typeof activePlayerMovie==='undefined'?null:activePlayerMovie;}
  function send(packet){
    if(!room || !room.connected) return;
    const message={...packet, peer:myPeer, role:room.role};
    Promise.resolve(room.channel.send({type:'broadcast',event:'mmhd-watch',payload:message}))
      .catch(err=>console.warn('[MMHD Ver juntos] Error en mensaje',err));
  }
  function publish(force=false){
    if(!room||room.role!=='host'||!room.connected||!activeMovie())return;
    if(!force && Date.now()-lastSent<3000)return;
    lastSent=Date.now();
    send({kind:'state',seq:++seq,media:descriptor(activeMovie()),position:lastLocal.position,
      paused:lastLocal.paused,duration:lastLocal.duration});
  }
  function queryVideo(){
    const movie=activeMovie(),frame=$('playerFrame');
    if(!movie||!frame?.contentWindow)return;
    frame.contentWindow.postMessage({type:'mmhd-watch-query',id:String(movie.id)},'*');
  }
  function syncGuest(force=false){
    if(!room||room.role!=='guest'||!remote||!activeMovie())return;
    const media=resolve(remote.media);
    if(!media||Number(activeMovie().id)!==Number(media.id))return;
    const frame=$('playerFrame');
    if(!frame?.contentWindow)return;
    frame.contentWindow.postMessage({type:'mmhd-watch-sync',id:String(media.id),position:remote.position,
      paused:remote.paused,force:force},'*');
  }
  function tick(){
    if(!room||!room.connected)return;
    if(room.role==='host'){queryVideo();publish(true);}
    if(room.role==='guest'){
      if(!remote){send({kind:'hello'});return;}
      syncGuest(false);
    }
  }
  function onPresence(){
    if(!room)return;
    const peers=Object.values(room.channel.presenceState()||{}).flat();
    const unique=new Map(peers.filter(x=>x?.peer).map(x=>[x.peer,x]));
    const guestCount=Array.from(unique.values()).filter(x=>x.role==='guest').length;
    const hostCount=Array.from(unique.values()).filter(x=>x.role==='host').length;
    if(room.role==='host'){
      status(guestCount ? 'Sala conectada · 2 navegadores' : 'Sala creada · esperando al invitado');
      if(guestCount>1)status('Advertencia: hay más de un invitado; cierra esta sala y crea otra.');
    }else{
      if(hostCount){pendingHostMissing=false;status(guestBlocked?'Conectado · pulsa Play si Chrome bloquea el sonido':'Anfitrión conectado · sincronizando…');}
      else if(pendingHostMissing)status('Se perdió la conexión con el anfitrión.');
      if(hostCount)pendingHostMissing=true;
    }
  }
  async function createOrJoin(role,code){
    if(connecting||room)return;
    openChat();updateChatUI();
    const settings=window.MMHD_WATCH_PARTY_CONFIG||{};
    const url=String(settings.supabaseUrl||'').trim();
    const key=String(settings.publishableKey||'').trim();
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) || !key || /^sb_secret_|^ey.*service_role/i.test(key)){
      status('Falta configurar URL y clave pública en ver-juntos-config.js.');
      openPanel();return;
    }
    if(!window.supabase?.createClient){status('No cargó Supabase JS. Revisa la conexión o el bloqueador de anuncios.');openPanel();return;}
    setBusy(true);
    if(role==='host' && !activeMovie()){
      const media=typeof selectedPlayable==='function'?selectedPlayable():null;
      if(!media || !mmhdAudioVariants(media)?.length){status('Abre una película o episodio con video antes de crear la sala.');setBusy(false);return;}
      openPlayer(media);
    }
    status('Conectando con Supabase Realtime…');
    try{
      if(!sb)sb=window.supabase.createClient(url.replace(/\/$/,''),key,{
        auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
      });
      room={role,code,connected:false,channel:null};
      lastLocal={position:0,paused:true,duration:0};remote=null;seq=0;lastHostSeq=0;guestBlocked=false;guestNeedsAudio=false;
      $('mmhdWpChatMessages').replaceChildren();seenChat.clear();updateChatUI();
      const current=room;
      const channel=sb.channel('mmhd-watch-v1-'+code,{
        config:{private:false,broadcast:{ack:false,self:false},presence:{key:myPeer}}
      });
      current.channel=channel;
      channel.on('broadcast',{event:'mmhd-watch'},({payload})=>{if(room===current)receive(payload);})
        .on('presence',{event:'sync'},()=>{if(room===current)onPresence();})
        .subscribe(async subscription=>{
          if(room!==current)return;
          if(subscription==='SUBSCRIBED'){
            room.connected=true;setBusy(false);
            try{await channel.track({peer:myPeer,role});}
            catch(err){console.warn('[MMHD Ver juntos] Presence',err);}
            if(role==='host'){
              currentRoomUrl=location.origin+'/?'+ROOM_PARAM+'='+code;
              status('Sala lista · comparte tu enlace');chatSystem('Sala creada. Comparte el enlace y usa este chat para conversar.');queryVideo();publish(true);
            }else{status('Conectado · esperando datos del anfitrión');chatSystem('Te conectaste a la sala. Puedes conversar mientras ven la película.');send({kind:'hello'});}
            refreshUI();
          }
          if(subscription==='CHANNEL_ERROR'||subscription==='TIMED_OUT'||subscription==='CLOSED'){
            room.connected=false;
            room=null;
            status('No se pudo conectar a Supabase. Verifica Realtime y vuelve a intentar.');
            setBusy(false);
            refreshUI();openPanel();
            try{await sb?.removeChannel(channel);}catch(_){}
          }
        });
      refreshUI();
    }catch(error){console.warn('[MMHD Ver juntos]',error);room=null;setBusy(false);status('No se pudo abrir la sala: '+String(error.message||error));refreshUI();}
  }
  function receive(payload){
    if(!room || !payload || payload.peer===myPeer)return;
    if(payload.kind==='chat'){receiveChat(payload);return;}
    if(room.role==='host'){
      if(payload.kind==='hello' && payload.role==='guest'){queryVideo();publish(true);}
      return;
    }
    if(room.role!=='guest'||payload.role!=='host'||payload.kind!=='state')return;
    const order=Number(payload.seq);
    if(!Number.isSafeInteger(order) || order<=lastHostSeq)return;
    const movie=resolve(payload.media);
    if(!movie){status('El título no está disponible en esta versión del catálogo. Actualiza la página.');return;}
    lastHostSeq=order;
    const firstPlay=!Boolean(payload.paused) && (!remote || remote.paused);
    remote={media:payload.media,position:Math.max(0,Number(payload.position)||0),paused:Boolean(payload.paused)};
    if(!activeMovie()||Number(activeMovie().id)!==Number(movie.id)){
      openPlayer(movie);
      // El receptor del iframe guardará los comandos hasta que cargue <video>.
      window.setTimeout(()=>syncGuest(true),160);
    }else syncGuest(firstPlay);
    if(!guestBlocked)status('Conectado · siguiendo al anfitrión');
  }
  async function leave(){
    const old=room;room=null;
    lastLocal={position:0,paused:true,duration:0};remote=null;lastHostSeq=0;currentRoomUrl='';guestBlocked=false;guestNeedsAudio=false;
    $('mmhdWpChatMessages').replaceChildren();seenChat.clear();chatUnread=0;chat.hidden=true;chatLauncher.hidden=true;
    setBusy(false);
    if(old?.channel){
      try{if(old.connected)await old.channel.untrack();}catch(_){}
      try{await sb?.removeChannel(old.channel);}catch(_){}
    }
    const u=new URL(location.href);if(u.searchParams.has(ROOM_PARAM)){
      u.searchParams.delete(ROOM_PARAM);history.replaceState(history.state,'',u.pathname+u.search+u.hash);
    }
    refreshUI();status('Sala cerrada. Puedes seguir viendo el video por tu cuenta.');
  }

  window.mmhdWatchParty={
    isGuest:()=>Boolean(room&&room.role==='guest'),
    restoreSeconds:(movieId)=> room?.role==='guest' ? (
      remote&&resolve(remote.media)?.id===Number(movieId)?remote.position:0
    ) : null,
    onPlayerOpen:movie=>{
      if(!room)return;
      if(room.role==='host'){
        lastLocal={position:0,paused:true,duration:0};
        window.setTimeout(()=>{queryVideo();publish(true);},250);
      }else if(remote){window.setTimeout(()=>syncGuest(true),230);}
    },
    onPlayerClose:()=>{if(room)void leave();},
    openPanel
  };

  window.addEventListener('message',event=>{
    if(!room||!room.connected || !$('playerModal')?.classList.contains('show'))return;
    if(event.source!==$('playerFrame')?.contentWindow || !event.data)return;
    const data=event.data;
    if(!activeMovie() || String(data.id)!==String(activeMovie().id))return;
    if(room.role==='host' && data.type==='mmhd-watch-event'){
      lastLocal={position:Math.max(0,Number(data.position)||0),paused:Boolean(data.paused),duration:Number(data.duration)||0};
      const reason=String(data.reason||'');
      publish(reason!=='time');
    }
    if(room.role==='host' && data.type==='mmhd-watch-ready')queryVideo();
    if(room.role==='guest' && data.type==='mmhd-watch-ready')syncGuest(true);
    if(room.role==='guest' && data.type==='mmhd-watch-muted-start'){
      const firstWarning=!guestNeedsAudio;
      guestBlocked=true;guestNeedsAudio=true;status('Video sincronizado en silencio. Pulsa Activar sonido.');
      openChat();updateChatUI();
      if(firstWarning)chatSystem('Chrome bloqueó el primer inicio con audio. La película arrancó silenciada; toca «Activar sonido y reproducción».');
    }
    if(room.role==='guest' && data.type==='mmhd-watch-blocked'){
      const firstWarning=!guestNeedsAudio;
      guestBlocked=true;guestNeedsAudio=true;status('Chrome bloqueó el inicio automático.');
      openChat();updateChatUI();
      if(firstWarning)chatSystem('Para iniciar con sonido, toca «Activar sonido y reproducción».');
    }
  });

  $('mmhdWpClose').addEventListener('click',()=>modal(false));
  $('mmhdWpCreate').addEventListener('click',()=>createOrJoin('host',makeCode()));
  $('mmhdWpJoin').addEventListener('click',()=>{
    const code=new URL(location.href).searchParams.get(ROOM_PARAM);
    if(ROOM_RE.test(code||''))createOrJoin('guest',code);
  });
  $('mmhdWpLeave').addEventListener('click',()=>void leave());
  $('mmhdWpCopy').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(currentRoomUrl);status('Enlace copiado. Envíalo a tu invitado.');}
    catch(_){$('mmhdWpLink').select();status('Copia manualmente el enlace seleccionado.');}
  });
  $('mmhdWpResync').addEventListener('click',()=>{
    guestBlocked=false;
    if(remote){syncGuest(true);status('Sincronización solicitada. Si no inicia el audio, pulsa Play.');}
    else{send({kind:'hello'});status('Solicitando posición al anfitrión…');}
  });
  dialog.addEventListener('click',event=>{if(event.target===dialog)modal(false);});
  window.addEventListener('pagehide',()=>{if(room?.channel)void room.channel.untrack().catch(()=>{});});
  refreshUI();
  const invitedCode=new URL(location.href).searchParams.get(ROOM_PARAM);
  if(ROOM_RE.test(invitedCode||'')){
    status('Invitación recibida · conectando automáticamente…');
    openChat();chatSystem('Invitación recibida. Conectando el chat y el reproductor…');
    void createOrJoin('guest',invitedCode);
  }
})();
