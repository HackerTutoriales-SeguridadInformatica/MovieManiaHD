/*
 * Movie Mania HD V3 · Transmitir: Chromecast + AirPlay (=dv)
 * Este módulo solo añade la elección y un reproductor HTML5 de prueba AirPlay.
 * El Chromecast existente continúa usando handleCast(), con todos sus controles.
 */
(function () {
  'use strict';
  if (window.MMHD_TRANSMIT_MENU) return;
  var root = null;
  var panel = null;
  var focusBefore = null;
  var currentMovie = null;
  var currentLanguage = '';
  var currentWebSource = '';
  var activeVideo = null;
  var currentMode = '';
  var ui = {};

  var css = `
    #mmhdTransmitOverlay[hidden]{display:none!important}
    #mmhdTransmitOverlay{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;
      justify-content:center;padding:16px;background:rgba(1,4,14,.87);backdrop-filter:blur(7px);
      -webkit-backdrop-filter:blur(7px);font-family:Inter,system-ui,-apple-system,Arial,sans-serif;color:#f2f7ff}
    #mmhdTransmitPanel{width:min(510px,100%);max-height:min(92vh,820px);overflow-y:auto;overscroll-behavior:contain;
      background:linear-gradient(155deg,#151f35,#0c1323);border:1px solid #435777;
      border-radius:20px;box-shadow:0 20px 65px #000b;padding:20px}
    #mmhdTransmitOverlay *{box-sizing:border-box}
    .mmhd-transmit-top{display:flex;align-items:start;justify-content:space-between;gap:14px;margin-bottom:8px}
    .mmhd-transmit-heading{font-size:21px;font-weight:850;margin:0 0 5px}
    .mmhd-transmit-subheading{font-size:12px;line-height:1.5;color:#b5c8e8;margin:0 0 16px;overflow-wrap:anywhere}
    .mmhd-transmit-close{background:#202b43;border:1px solid #445472;color:#e2edff;
      border-radius:9px;padding:8px 13px;font-size:20px;cursor:pointer}
    .mmhd-transmit-choice{display:flex;width:100%;align-items:center;gap:13px;text-align:left;
      background:#192945;border:1px solid #5275aa;color:#f1f7ff;border-radius:14px;
      padding:15px;margin:10px 0;font:inherit;cursor:pointer}
    .mmhd-transmit-choice[disabled]{opacity:.48;cursor:not-allowed}
    .mmhd-transmit-choice:not([disabled]):hover,.mmhd-transmit-choice:focus-visible{outline:2px solid #87b8ff;outline-offset:2px;background:#233b60}
    .mmhd-transmit-choice-icon{display:grid;place-items:center;border-radius:12px;background:#2e5485;
      flex:0 0 47px;height:47px;font-size:24px}
    .mmhd-transmit-choice b{font-size:15px;display:block;margin-bottom:3px}
    .mmhd-transmit-choice small{display:block;color:#b8cdea;line-height:1.5;font-size:11px}
    .mmhd-transmit-back{display:inline-block;margin:0 0 12px;color:#c3dbff;
      border:0;background:none;padding:4px;font-size:12px;font-weight:600;cursor:pointer}
    .mmhd-transmit-lang-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .mmhd-transmit-lang-list .mmhd-transmit-choice{margin:0;padding:11px;min-width:0}
    .mmhd-transmit-lang-list .mmhd-transmit-choice-icon{flex-basis:36px;height:36px;font-size:17px}
    .mmhd-transmit-preview{display:block;background:#050a12;border:1px solid #34445f;border-radius:12px;
      width:100%;max-height:300px;aspect-ratio:16/9;object-fit:contain;margin:10px auto}
    .mmhd-transmit-status{font-size:12px;line-height:1.55;min-height:38px;color:#bed4f8;
      padding:10px;border:1px solid #30435f;border-radius:10px;background:#101a2c;margin:11px 0}
    .mmhd-transmit-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
    .mmhd-transmit-action{flex:1 1 155px;min-height:44px;padding:11px;border-radius:10px;
      border:1px solid #6c98d9;background:#2e65ad;color:white;font-weight:750;cursor:pointer}
    .mmhd-transmit-action[disabled]{opacity:.5;cursor:not-allowed}
    .mmhd-transmit-action.secondary{background:#192b48;border-color:#3f5d82}
    .mmhd-transmit-web-sources{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:9px}
    .mmhd-transmit-web-sources button{padding:9px 5px;min-height:42px;border-radius:9px;background:#1b2a42;
      color:#e5f0ff;border:1px solid #466287;font-size:11px;font-weight:650;cursor:pointer}
    .mmhd-transmit-web-sources button[aria-pressed="true"]{background:#2b619d;border-color:#9bc5ff}
    .mmhd-transmit-diagnostic{font-size:11px;color:#c1d0e7;line-height:1.5;white-space:pre-line;overflow-wrap:anywhere;
      background:#0b1323;border:1px solid #2a3c57;padding:10px;border-radius:9px;margin-top:9px}
    .mmhd-transmit-help{font-size:11px;line-height:1.55;color:#b5c5dc;margin:12px 0 0}
    @media(max-width:480px){#mmhdTransmitPanel{padding:14px;border-radius:14px}.mmhd-transmit-heading{font-size:18px}}
  `;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(className, label, handler) {
    var node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  }
  function airplaySupported() {
    return !!(window.HTMLVideoElement &&
      typeof HTMLVideoElement.prototype.webkitShowPlaybackTargetPicker === 'function');
  }
  function castSupported() {
    try { return typeof castReady !== 'undefined' && !!castReady; } catch (_) { return false; }
  }
  function variantsFor(movie) {
    try { return typeof mmhdAudioVariants === 'function' ? mmhdAudioVariants(movie) : []; }
    catch (_) { return []; }
  }
  function firstSource(variant) {
    return String(variant && (variant.m37 || variant.m22 || variant.m18) || '').trim();
  }
  function toDirectVideoUrl(url) {
    var input = String(url || '').trim();
    if (!input) return '';
    var normalized = input.replace(/=m\d+(?=$|[&#?])/, '=dv');
    var target;
    try { target = new URL(normalized, location.href); } catch (_) { return ''; }
    // Una URL HTTPS directa evita proxys, CORS artificiales y acceso a archivos locales.
    return target.protocol === 'https:' ? target.href : '';
  }
  function setStatus(message) {
    if (ui.status) ui.status.textContent = message;
  }
  function ensureModal() {
    if (root) return;
    var style = el('style'); style.textContent = css; document.head.appendChild(style);
    root = el('div'); root.id = 'mmhdTransmitOverlay'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Elegir método de transmisión');
    panel = el('section'); panel.id = 'mmhdTransmitPanel';
    root.appendChild(panel);
    root.addEventListener('click', function (event) { if (event.target === root) close(); });
    document.addEventListener('keydown', function (event) {
      if (root.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        var controls = Array.prototype.filter.call(panel.querySelectorAll('button:not([disabled])'),
          function (b) { return b.getClientRects().length > 0; });
        if (!controls.length) return;
        var first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    document.body.appendChild(root);
  }
  function clearVideo() {
    if (activeVideo) {
      try { activeVideo.pause(); activeVideo.removeAttribute('src'); activeVideo.load(); }
      catch (_) { /* Safari desmonta el elemento al salir */ }
    }
    activeVideo = null;
    ui = {};
  }
  function close() {
    if (!root) return;
    root.hidden = true;
    clearVideo();
    currentMovie = null;
    currentLanguage = '';
    currentWebSource = '';
    var previous = focusBefore; focusBefore = null;
    try { if (previous && previous.isConnected) previous.focus(); } catch (_) {}
  }
  function header(title, subtitle, back) {
    clearVideo();
    panel.replaceChildren();
    var top = el('div', 'mmhd-transmit-top');
    var texts = el('div');
    texts.append(el('h2','mmhd-transmit-heading',title),
      el('p','mmhd-transmit-subheading',subtitle));
    top.append(texts,button('mmhd-transmit-close','×',close));
    panel.appendChild(top);
    if (back) panel.appendChild(button('mmhd-transmit-back','← Volver',back));
  }
  function choice(icon, name, desc, onClick, disabled) {
    var b = button('mmhd-transmit-choice','',onClick);
    b.replaceChildren();
    var glyph = el('span','mmhd-transmit-choice-icon',icon);
    var text = el('span');text.append(el('b','',name),el('small','',desc));
    b.append(glyph,text);b.disabled=!!disabled;
    return b;
  }
  function showRoutes() {
    if (!currentMovie) return;
    header('¿Dónde quieres transmitir?',currentMovie.title || 'Movie Mania HD');
    var canCast = castSupported();
    var canAirPlay = airplaySupported();
    panel.appendChild(choice('▣','Chromecast', canCast ? 'Usar el sistema Cast actual y sus cuatro controles.' :
      'Google Cast no está disponible en este navegador.',function () {
      var movie=currentMovie;
      close();
      // Se ejecuta sin esperar: conserva la activación del clic original para requestSession.
      try { handleCast(movie); }
      catch (err) { alert('No se pudo iniciar Chromecast: '+err.message); }
    },!canCast));
    panel.appendChild(choice('▵','Apple AirPlay', canAirPlay ?
      'Probar el video original (=dv) en Safari y enviarlo a la TV.' :
      'AirPlay requiere Safari compatible en iPhone, iPad o Mac.',
      function () { showLanguages(); },!canAirPlay));
    panel.append(el('p','mmhd-transmit-help',
      'Chromecast conserva su funcionamiento actual. AirPlay usa un reproductor HTML5 independiente para comprobar imagen y sonido.'));
    panel.querySelector('.mmhd-transmit-choice:not([disabled])')?.focus();
  }
  function showLanguages() {
    var variants = variantsFor(currentMovie).filter(function (v) { return !!firstSource(v); });
    if (!variants.length) {
      header('AirPlay','Este título no tiene enlaces de video configurados.',showRoutes);
      return;
    }
    if (variants.length === 1) { showAirPlay(variants[0]); return; }
    header('Elige el idioma', 'Selecciona qué versión del video deseas enviar por AirPlay.',showRoutes);
    var list = el('div','mmhd-transmit-lang-list');
    variants.forEach(function (variant) {
      var quality = variant.m37?'1080p':variant.m22?'720p':variant.m18?'420p':'';
      list.appendChild(choice('▶',variant.language || 'Principal',quality+' · enlace original =dv',
        function () {showAirPlay(variant);},false));
    });
    panel.appendChild(list);
    list.querySelector('button')?.focus();
  }
  function showAirPlay(variant) {
    var source = firstSource(variant);
    var dv = toDirectVideoUrl(source);
    currentLanguage = String(variant.language || 'Principal');
    currentWebSource = source;
    header('Enviar video por AirPlay',
      (currentMovie.title || 'Movie Mania HD') + ' · ' + currentLanguage,
      function () { showLanguages(); });
    if (!dv) {
      panel.append(el('p','mmhd-transmit-status','No hay una URL HTTPS válida para este video.'));
      return;
    }
    var video = document.createElement('video');
    video.id = 'mmhdAirPlayVideo';
    video.className = 'mmhd-transmit-preview';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('x-webkit-airplay', 'allow');
    try { video.webkitWirelessVideoPlaybackDisabled = false; } catch (_) {}
    if (currentMovie.poster) video.poster = currentMovie.poster;
    activeVideo = video;
    panel.appendChild(video);

    var status = el('div','mmhd-transmit-status','Cargando video original (=dv)…');
    status.setAttribute('role','status');
    ui.status = status;
    panel.appendChild(status);

    var actions = el('div','mmhd-transmit-actions');
    var play = button('mmhd-transmit-action secondary','▶ Reproducir video',function () {
      setStatus('Solicitando reproducción de ' + sourceLabel + '…');
      try {
        var result = video.play();
        if (result && typeof result.catch === 'function') result.catch(function (error) {
          if (activeVideo === video) {
            lastEvent = 'play() rechazado: ' + (error && error.name || 'desconocido');
            setStatus('Safari no inició ' + sourceLabel + '. ' +
              (error && error.name || 'Error desconocido') + '. Revisa el diagnóstico o prueba otra calidad.');
            updateDiagnostic();
          }
        });
      } catch (error) {
        lastEvent = 'play() falló: ' + (error && error.name || 'desconocido');
        setStatus('No se pudo iniciar el video. Prueba otra calidad.');
        updateDiagnostic();
      }
    });
    var send = button('mmhd-transmit-action','▵ Elegir TV AirPlay',function () {
      if (!activeVideo || activeVideo !== video) return;
      // Las dimensiones se conocen desde loadedmetadata; no significan que haya
      // fotogramas. HAVE_CURRENT_DATA (2) es el primer estado con imagen disponible.
      if (!firstFrameReady()) {
        setStatus('Todavía no hay un fotograma reproducible. La duración por sí sola no es suficiente: prueba otra calidad.');
        updateDiagnostic();
        return;
      }
      try { video.webkitShowPlaybackTargetPicker(); }
      catch (error) { setStatus('Safari no pudo abrir AirPlay: ' + error.message); }
    });
    send.disabled = true;
    actions.append(play,send);
    panel.appendChild(actions);

    var webOptions = [
      {key:'m37',title:'1080p',url:variant.m37},
      {key:'m22',title:'720p',url:variant.m22},
      {key:'m18',title:'420p',url:variant.m18}
    ].filter(function (x) {
      if (!x.url) return false;
      try { return new URL(String(x.url).trim(),location.href).protocol === 'https:'; }
      catch (_) { return false; }
    });
    var lastEvent = 'esperando metadatos';
    var sourceLabel = '=dv (original)';
    var lastError = 'ninguno';
    var sourceButtons = [];
    var diagnostics = el('div','mmhd-transmit-diagnostic','');
    var sourceContainer = el('div','mmhd-transmit-web-sources');
    if (webOptions.length) {
      panel.append(el('p','mmhd-transmit-help',
        'Si el original se queda cargando, prueba una calidad web a la vez. Ver la duración NO significa que haya imagen.'));
      webOptions.forEach(function (x) {
        var b = button('',x.title,function () { switchTo(x.url,'Calidad web ' + x.title,x.key); });
        b.setAttribute('aria-pressed','false');
        b.setAttribute('title','Probar enlace ' + x.key + ' sin modificar Chromecast');
        sourceContainer.appendChild(b);
        sourceButtons.push({key:x.key,button:b});
      });
      panel.appendChild(sourceContainer);
    }
    var originalButton = button('mmhd-transmit-action secondary','Volver al video original (=dv)',function () {
      switchTo(dv,'=dv (original)','dv');
    });
    var tools = el('div','mmhd-transmit-actions');
    tools.appendChild(originalButton);
    var copy = button('mmhd-transmit-action secondary','Copiar diagnóstico',function () {
      var report = makeDiagnostic();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(report).then(function(){
          setStatus('Diagnóstico copiado. No incluye enlaces ni credenciales.');
        }).catch(function(){ window.prompt('Copia este diagnóstico:', report); });
      } else { window.prompt('Copia este diagnóstico:', report); }
    });
    tools.appendChild(copy);
    panel.appendChild(tools);
    panel.appendChild(diagnostics);

    function firstFrameReady() {
      return video === activeVideo && video.readyState >= 2 &&
        video.videoWidth > 0 && video.videoHeight > 0 && !video.error;
    }
    function formatDuration(n) {
      if (!Number.isFinite(n) || n <= 0) return 'sin detectar';
      var secs = Math.round(n);
      var h = Math.floor(secs/3600), m = Math.floor(secs%3600/60), s=secs%60;
      return (h ? h+':' + String(m).padStart(2,'0') : String(m)) + ':' + String(s).padStart(2,'0');
    }
    function makeDiagnostic() {
      var states = ['sin datos','solo metadatos','primer fotograma disponible',
        'datos futuros disponibles','datos suficientes'];
      return 'Movie Mania HD · AirPlay\n' +
        'Fuente: ' + sourceLabel + '\n' +
        'Duración: ' + formatDuration(video.duration) + '\n' +
        'Estado del video: ' + (states[video.readyState] || video.readyState) +
          ' (readyState ' + video.readyState + ')\n' +
        'Estado de red: ' + video.networkState + '\n' +
        'Dimensiones: ' + video.videoWidth + ' × ' + video.videoHeight + '\n' +
        'Reproduciendo: ' + (!video.paused && !video.ended ? 'solicitado' : 'no') + '\n' +
        'Posición: ' + (Number.isFinite(video.currentTime) ? video.currentTime.toFixed(1) : '?') + ' s\n' +
        'Primer fotograma: ' + (firstFrameReady() ? 'sí' : 'no') + '\n' +
        'Error: ' + lastError + '\nÚltimo evento: ' + lastEvent;
    }
    function updateDiagnostic() {
      if (video !== activeVideo) return;
      diagnostics.textContent = makeDiagnostic();
      send.disabled = !airplaySupported() || !firstFrameReady();
    }
    function switchTo(url,label,key) {
      if (video !== activeVideo) return;
      var target;
      try { target = new URL(String(url).trim(),location.href); }
      catch (_) { setStatus('La URL de esta calidad no es válida.'); return; }
      if (target.protocol !== 'https:') { setStatus('Solo se admiten enlaces HTTPS.'); return; }
      try { video.pause(); } catch (_) {}
      sourceLabel = label;
      lastError = 'ninguno';
      lastEvent = 'cambio de fuente';
      sourceButtons.forEach(function(x){x.button.setAttribute('aria-pressed',x.key===key?'true':'false');});
      originalButton.hidden = key === 'dv';
      video.src = target.href;
      video.load();
      setStatus('Cargando ' + label + '. Pulsa «Reproducir video» y espera a ver imagen antes de transmitir.');
      updateDiagnostic();
    }
    video.addEventListener('loadedmetadata',function(){
      if (video !== activeVideo) return;
      lastEvent = 'loadedmetadata';
      setStatus(sourceLabel + ': duración ' + formatDuration(video.duration) +
        ' detectada. Esperando el primer fotograma; todavía NO está listo para AirPlay.');
      updateDiagnostic();
    });
    video.addEventListener('loadeddata',function(){
      if (video !== activeVideo) return;
      lastEvent = 'loadeddata';
      setStatus(sourceLabel + ': primer fotograma disponible. Ya puedes comprobar imagen y elegir AirPlay.');
      updateDiagnostic();
    });
    video.addEventListener('playing',function(){
      if (video !== activeVideo) return;
      lastEvent = 'playing';
      setStatus(sourceLabel + ': reproducción iniciada en Safari. Puedes elegir la TV, aunque esto no garantiza que el Roku admita el enlace.');
      updateDiagnostic();
    });
    video.addEventListener('timeupdate',function(){
      if (video !== activeVideo) return;
      updateDiagnostic();
    });
    video.addEventListener('waiting',function(){
      if (video !== activeVideo) return;
      lastEvent = 'waiting';
      setStatus(sourceLabel + ': esperando datos de video. Si no aparece imagen, prueba otra calidad.');
      updateDiagnostic();
    });
    video.addEventListener('stalled',function(){
      if (video !== activeVideo) return;
      lastEvent = 'stalled';
      setStatus(sourceLabel + ': el servidor dejó de enviar datos temporalmente. Prueba otra calidad.');
      updateDiagnostic();
    });
    video.addEventListener('error',function(){
      if (video !== activeVideo) return;
      var codes = {1:'carga cancelada',2:'error de red',3:'error de decodificación',4:'fuente no compatible'};
      lastError = video.error ? ((codes[video.error.code] || 'error') + ' (código ' + video.error.code + ')') : 'desconocido';
      lastEvent = 'error';
      setStatus(sourceLabel + ': ' + lastError + '. Prueba otra calidad.');
      updateDiagnostic();
    });
    video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged',function(){
      if(video !== activeVideo) return;
      if(video.webkitCurrentPlaybackTargetIsWireless){
        lastEvent = 'AirPlay conectado';
        setStatus('AirPlay conectado. Si el Roku sigue cargando, esta fuente podría no ser compatible o accesible desde la TV.');
      } else {lastEvent = 'AirPlay desconectado';}
      updateDiagnostic();
    });
    video.src = dv;
    video.load();
    updateDiagnostic();
    play.focus();
    panel.append(el('p','mmhd-transmit-help',
      'Diagnóstico sin URLs ni credenciales. Chromecast continúa igual. Si ninguna calidad funciona en Safari/Roku, puede ser necesario un archivo MP4/H.264/AAC o HLS con acceso directo y estable.'));
  }
  function open(movie) {
    if (!movie || typeof movie !== 'object') return;
    if (!root) ensureModal();
    if (root.hidden) focusBefore=document.activeElement;
    clearVideo();currentMovie=movie;root.hidden=false;showRoutes();
  }
  window.MMHD_TRANSMIT_MENU = {open:open,close:close,toDirectVideoUrl:toDirectVideoUrl};
})();
