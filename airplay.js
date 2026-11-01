/*
 * Movie Mania HD V3 - AirPlay opcional para Safari.
 * Integracion independiente: NO modifica Google Cast, URLs de video,
 * subtitulos, calidad, idioma, progreso ni el reproductor FWDEV.
 * El video real vive en el iframe blob: creado por el catalogo.
 */
(function () {
  'use strict';
  if (window.MMHD_AIRPLAY_READY) return;
  window.MMHD_AIRPLAY_READY = true;

  function start() {
    var frame = document.getElementById('playerFrame');
    var modal = document.getElementById('playerModal');
    var controls = document.querySelector('.mmhd-player-header-controls');
    if (!frame || !modal || !controls) return;

    var video = null, childDoc = null, available = null, connected = false;
    var windowButton = document.getElementById('mmhdAirPlayButton');
    var fullscreenButton = null;

    function makeButton(doc, fullscreen) {
      var button = doc.createElement('button');
      button.type = 'button';
      button.id = fullscreen ? 'mmhdAirPlayFullscreenButton' : 'mmhdAirPlayButton';
      button.setAttribute('aria-label', 'Elegir dispositivo Apple AirPlay');
      button.setAttribute('title', 'Transmitir con AirPlay (Safari)');
      button.setAttribute('aria-pressed', 'false');
      // Icono propio: pantalla con triangulo AirPlay, sin dependencias externas.
      button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-3px;margin-right:5px"><path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1"/><path d="m12 15 5 6H7z"/></svg><span>AirPlay</span>';
      button.hidden = true;
      // Se usan estilos propios para no interferir con controles de Cast o de FWDEV.
      button.style.cssText = 'border:1px solid #6f90c8;border-radius:8px;'
        + 'background:#1b2740;color:#eff6ff;padding:9px 11px;'
        + 'font:700 12px Arial,sans-serif;cursor:pointer;white-space:nowrap;';
      if (fullscreen) {
        button.style.cssText += 'position:fixed;top:16px;left:16px;'
          + 'z-index:2147483500;box-shadow:0 4px 16px #000a;';
      }
      button.addEventListener('click', function (event) {
        event.preventDefault();
        // IMPORTANTE: llamada sincronica desde un clic real del usuario.
        // AirPlay muestra el selector NATIVO; no se hace Cast ni se cambia src.
        var target = video;
        if (!target || !target.isConnected || typeof target.webkitShowPlaybackTargetPicker !== 'function') return;
        try {
          target.webkitShowPlaybackTargetPicker();
        } catch (error) {
          console.warn('[MMHD AirPlay] Safari no pudo abrir el selector nativo.', error);
        }
      });
      return button;
    }

    if (!windowButton) {
      windowButton = makeButton(document, false);
      // Antes de Cerrar: el botón no forma parte del grupo de Chromecast.
      var close = document.getElementById('btnPlayerClose');
      controls.insertBefore(windowButton, close && close.parentElement === controls ? close : null);
    }
    var defaultLabel = 'AirPlay';
    function support() {
      return !!video && typeof video.webkitShowPlaybackTargetPicker === 'function';
    }
    function visible() {
      return modal.classList.contains('show') && support() && available !== false;
    }
    function update() {
      var show = visible();
      windowButton.hidden = !show;
      windowButton.setAttribute('aria-pressed', String(show && connected));
      windowButton.querySelector('span').textContent = show && connected ? 'AirPlay conectado' : defaultLabel;
      // El botón del reproductor fullscreen se controla por separado.
      if (fullscreenButton) {
        var fs = null;
        try { fs = childDoc && (childDoc.fullscreenElement || childDoc.webkitFullscreenElement); } catch (_) {}
        var fullscreenHost = fs && fs.tagName !== 'VIDEO' ? fs : null;
        if (fullscreenHost && fullscreenButton.parentNode !== fullscreenHost) fullscreenHost.appendChild(fullscreenButton);
        // Fullscreen nativo sobre VIDEO: Safari ofrece sus controles de AirPlay.
        fullscreenButton.hidden = !show || !fullscreenHost;
        fullscreenButton.setAttribute('aria-pressed', String(show && connected));
        fullscreenButton.querySelector('span').textContent = show && connected ? 'AirPlay conectado' : defaultLabel;
      }
    }

    function onAvailability(event) {
      // Safari puede comunicar "available" o "not-available".
      available = event && event.availability === 'not-available' ? false
        : event && event.availability === 'available' ? true : null;
      update();
    }
    function onWirelessChanged() {
      connected = !!(video && video.webkitCurrentPlaybackTargetIsWireless);
      update();
    }
    function detachVideo() {
      if (!video) return;
      try {
        video.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvailability);
        video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWirelessChanged);
      } catch (_) {}
      video = null;
      available = null;
      connected = false;
    }
    function setVideo(nextVideo) {
      if (nextVideo === video) return;
      detachVideo();
      video = nextVideo || null;
      if (!video) { update(); return; }
      try {
        video.setAttribute('x-webkit-airplay', 'allow');
        video.webkitWirelessVideoPlaybackDisabled = false;
        video.addEventListener('webkitplaybacktargetavailabilitychanged', onAvailability);
        video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWirelessChanged);
        connected = !!video.webkitCurrentPlaybackTargetIsWireless;
      } catch (_) {}
      update();
    }
    function cleanupIframe() {
      detachVideo();
      if (childDoc) {
        try {
          childDoc.removeEventListener('fullscreenchange', update);
          childDoc.removeEventListener('webkitfullscreenchange', update);
        } catch (_) {}
      }
      if (fullscreenButton && fullscreenButton.parentNode) fullscreenButton.remove();
      fullscreenButton = null;
      childDoc = null;
      update();
    }
    function tick() {
      if (!modal.classList.contains('show')) {
        if (video || childDoc) cleanupIframe();
        windowButton.hidden = true;
        return;
      }
      var doc;
      try {
        // blob: tiene el mismo origen que el catalogo que crea el iframe.
        doc = frame.contentDocument;
        if (!doc || !doc.documentElement || doc.location.href === 'about:blank') return;
      } catch (_) {
        // Si alguna variante del reproductor usa otro origen, no interferimos.
        windowButton.hidden = true;
        return;
      }
      if (doc !== childDoc) {
        cleanupIframe();
        childDoc = doc;
        fullscreenButton = makeButton(doc, true);
        doc.body && doc.body.appendChild(fullscreenButton);
        doc.addEventListener('fullscreenchange', update);
        doc.addEventListener('webkitfullscreenchange', update);
      }
      if (fullscreenButton && !fullscreenButton.isConnected && doc.body) doc.body.appendChild(fullscreenButton);
      // FWDEV puede recrear el elemento VIDEO al elegir idioma o calidad.
      var nextVideo = doc.querySelector('#myDiv video') || doc.querySelector('video');
      if (nextVideo !== video) setVideo(nextVideo);
      update();
    }
    frame.addEventListener('load', tick);
    // Un observador en la pagina padre evitaria detectar los videos internos.
    // Una comprobacion liviana permite incorporar recreaciones del video FWDEV.
    var timer = window.setInterval(tick, 900);
    window.addEventListener('pagehide', function () {
      window.clearInterval(timer);
      cleanupIframe();
    }, {once:true});
    tick();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
