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

  function status(s){$('mmhdWpStatus').textContent=s;}
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
    if(canJoin)label('Has recibido una invitación. Pulsa Entrar a la sala para conectarte al anfitrión.');
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
      lastLocal={position:0,paused:true,duration:0};remote=null;seq=0;lastHostSeq=0;
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
              status('Sala lista · comparte tu enlace');queryVideo();publish(true);
            }else{status('Conectado · esperando datos del anfitrión');send({kind:'hello'});}
            refreshUI();
          }
          if(subscription==='CHANNEL_ERROR'||subscription==='TIMED_OUT'||subscription==='CLOSED'){
            room.connected=false;
            status('Conexión interrumpida. Comprueba que Supabase permita canales públicos.');
            setBusy(false);
          }
        });
      refreshUI();
    }catch(error){console.warn('[MMHD Ver juntos]',error);room=null;setBusy(false);status('No se pudo abrir la sala: '+String(error.message||error));refreshUI();}
  }
  function receive(payload){
    if(!room || !payload || payload.peer===myPeer)return;
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
    remote={media:payload.media,position:Math.max(0,Number(payload.position)||0),paused:Boolean(payload.paused)};
    if(!activeMovie()||Number(activeMovie().id)!==Number(movie.id)){
      openPlayer(movie);
      // El receptor del iframe guardará los comandos hasta que cargue <video>.
      window.setTimeout(()=>syncGuest(true),160);
    }else syncGuest(false);
    if(!guestBlocked)status('Conectado · siguiendo al anfitrión');
  }
  async function leave(){
    const old=room;room=null;
    lastLocal={position:0,paused:true,duration:0};remote=null;lastHostSeq=0;currentRoomUrl='';guestBlocked=false;
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
    if(room.role==='guest' && data.type==='mmhd-watch-blocked'){
      guestBlocked=true;status('Chrome bloqueó el inicio automático: pulsa ▶ en tu reproductor.');
      openPanel();
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
  if(ROOM_RE.test(new URL(location.href).searchParams.get(ROOM_PARAM)||'')){
    status('Invitación recibida · pulsa Entrar a la sala');openPanel();
  }
})();
