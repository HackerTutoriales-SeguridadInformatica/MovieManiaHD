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
    currentLanguage = String(variant.language||'Principal');
    currentWebSource = source;
    header('Enviar video por AirPlay',
      (currentMovie.title || 'Movie Mania HD')+' · '+currentLanguage,
      function () { showLanguages(); });
    if (!dv) {
      panel.append(el('p','mmhd-transmit-status','No hay una URL HTTPS válida para este video.'));
      return;
    }
    var video = document.createElement('video');
    video.id='mmhdAirPlayVideo';
    video.className='mmhd-transmit-preview';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('playsinline','');
    video.setAttribute('webkit-playsinline','');
    video.setAttribute('x-webkit-airplay','allow');
    try { video.webkitWirelessVideoPlaybackDisabled = false; } catch (_) {}
    if (currentMovie.poster) video.poster = currentMovie.poster;
    // No fetch, crossOrigin ni proxy: Safari accede directamente al mismo =dv de Cast.
    video.src = dv;
    activeVideo = video;
    panel.appendChild(video);
    var status = el('div','mmhd-transmit-status','Comprobando si Safari puede mostrar el video original (=dv)…');
    status.setAttribute('role','status');
    ui.status = status;
    panel.appendChild(status);
    var actions = el('div','mmhd-transmit-actions');
    var play = button('mmhd-transmit-action secondary','▶ Reproducir video',function () {
      var result = video.play();
      if (result && typeof result.catch === 'function') result.catch(function () {
        setStatus('Safari no consiguió reproducir esta fuente. Prueba la calidad web.');
      });
    });
    var send = button('mmhd-transmit-action','▵ Elegir TV AirPlay',function () {
      // El selector exige clic directo del usuario y un video con imagen detectable.
      if (!activeVideo || activeVideo !== video) return;
      if (!video.videoWidth || !video.videoHeight) {
        setStatus('No se ha detectado imagen en esta fuente. Pulsa Reproducir o prueba la calidad web antes de transmitir.');
        return;
      }
      try { video.webkitShowPlaybackTargetPicker(); }
      catch (error) { setStatus('Safari no pudo abrir AirPlay: '+error.message); }
    });
    send.disabled = true;
    var fallback = button('mmhd-transmit-action secondary','Probar calidad web',function () {
      // Alternativa manual cuando el original =dv es MKV u otro códec no apto para Safari.
      var raw = String(currentWebSource||'').trim();
      if (!raw) return;
      var webUrl;
      try { webUrl = new URL(raw, location.href); }
      catch (_) { setStatus('No hay enlace web válido.'); return; }
      if (webUrl.protocol !== 'https:') return;
      video.pause();video.src = webUrl.href;video.load();send.disabled = true;
      setStatus('Probando la fuente de calidad web. Espera a que aparezca imagen antes de elegir AirPlay.');
    });
    actions.append(play,send,fallback);
    panel.appendChild(actions);
    function inspect() {
      if (video !== activeVideo) return;
      var valid = !!(video.videoWidth && video.videoHeight);
      send.disabled = !valid || !airplaySupported();
      if (valid) setStatus('Video detectado ('+video.videoWidth+' × '+video.videoHeight+'). Pulsa «Elegir TV AirPlay».');
    }
    video.addEventListener('loadedmetadata',inspect);
    video.addEventListener('loadeddata',inspect);
    video.addEventListener('resize',inspect);
    video.addEventListener('playing',inspect);
    video.addEventListener('error',function () {
      send.disabled=true;
      setStatus('Safari no puede abrir este enlace como video. Si el original es MKV o usa un códec incompatible, prueba «Calidad web».');
    });
    video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged',function () {
      if(video.webkitCurrentPlaybackTargetIsWireless) setStatus('AirPlay conectado. Si la TV solo muestra audio, el receptor no pudo reproducir la imagen de esta fuente.');
    });
    video.load();
    play.focus();
    panel.append(el('p','mmhd-transmit-help',
      'El enlace =dv puede ser un archivo original no compatible con Safari/Roku. Verificar imagen en esta vista reduce las transmisiones de solo audio. Los subtítulos externos no se envían automáticamente con esta prueba.'));
  }
  function open(movie) {
    if (!movie || typeof movie !== 'object') return;
    if (!root) ensureModal();
    if (root.hidden) focusBefore=document.activeElement;
    clearVideo();currentMovie=movie;root.hidden=false;showRoutes();
  }
  window.MMHD_TRANSMIT_MENU = {open:open,close:close,toDirectVideoUrl:toDirectVideoUrl};
})();
