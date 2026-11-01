/* Movie Mania HD V3 - actualización pública conservadora. Nunca borra el catálogo estático. */
(() => {
  'use strict';
  const API = '/api/public-library';
  const INTERVAL = 20000;
  let revision = null, checking = false, pending = null;
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = item => String(item.id);
  function available() { return typeof MOVIES !== 'undefined' && Array.isArray(MOVIES) && typeof renderAll === 'function'; }
  function protectedView() {
    return !!document.querySelector('#playerModal.show, #detailScreen.show, #movieModal.show, #seriesModal.show') ||
      !!document.querySelector('video:not([paused])');
  }
  function validItem(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x) ||
        !Number.isSafeInteger(Number(x.id)) || !String(x.title || '').trim() ||
        !['MOVIE','SERIES'].includes(x.kind)) return false;
    if (x.kind === 'SERIES' && !Array.isArray(x.seasons)) return false;
    // No aceptar objetos parciales que podrían borrar enlaces o episodios.
    return Object.prototype.hasOwnProperty.call(x,'overview') &&
      Object.prototype.hasOwnProperty.call(x,'poster');
  }
  function prepare(payload) {
    if (!available() || !payload || typeof payload.version !== 'string' ||
        !Array.isArray(payload.items) || !Array.isArray(payload.approvedIds) || !payload.items.length ||
        payload.items.length > 10000) return null;
    const approved = new Set(payload.approvedIds.map(String));
    const unique = new Set();
    for (const item of payload.items) {
      if (!validItem(item) || unique.has(id(item)) || !approved.has(id(item))) return null;
      unique.add(id(item));
    }
    // La API debe traer la totalidad de los aprobados. Si llegan menos,
    // se evita aplicar una respuesta incompleta.
    if (unique.size !== approved.size) return null;
    const next = clone(MOVIES);
    const positions = new Map(next.map((m,i)=>[id(m),i]));
    let changes = 0;
    for (const item of payload.items) {
      const key = id(item);
      const pos = positions.get(key);
      const incoming = clone(item);
      // Las respuestas de Supabase pueden omitir campos multimedia antiguos.
      // En títulos ya incrustados, conservar las fuentes y pistas existentes
      // cuando faltan en la respuesta; nunca reemplazar una fuente por vacío.
      // Los valores nuevos NO vacíos sí tienen prioridad.
      if (pos !== undefined) {
        const previous = next[pos];
        const sourceKeys = ['m37','m22','m18','m37En','m22En','m18En'];
        const fallbackMedia = (dst, prior) => {
          if (!dst || !prior || typeof dst !== 'object' || typeof prior !== 'object') return;
          for (const key of sourceKeys) {
            if ((!dst[key] || typeof dst[key] !== 'string' || !dst[key].trim()) &&
                typeof prior[key] === 'string' && prior[key].trim()) dst[key] = prior[key];
          }
          if ((!Array.isArray(dst.subtitleTracks) || !dst.subtitleTracks.some(t=>t && t.url)) &&
              Array.isArray(prior.subtitleTracks) && prior.subtitleTracks.some(t=>t && t.url))
            dst.subtitleTracks = clone(prior.subtitleTracks);
          if ((!dst.subtitlesUrl || typeof dst.subtitlesUrl !== 'string' || !dst.subtitlesUrl.trim()) &&
              typeof prior.subtitlesUrl === 'string' && prior.subtitlesUrl.trim())
            dst.subtitlesUrl = prior.subtitlesUrl;
          if ((!dst.audioAlt || typeof dst.audioAlt !== 'object') && prior.audioAlt)
            dst.audioAlt = clone(prior.audioAlt);
          if ((!dst.primaryLanguage || !String(dst.primaryLanguage).trim()) && prior.primaryLanguage)
            dst.primaryLanguage = prior.primaryLanguage;
          if ((!dst.seriesDefaultLanguage || !String(dst.seriesDefaultLanguage).trim()) && prior.seriesDefaultLanguage)
            dst.seriesDefaultLanguage = prior.seriesDefaultLanguage;
        };
        fallbackMedia(incoming,previous);
        if (incoming.kind === 'SERIES' && Array.isArray(incoming.seasons) && Array.isArray(previous.seasons)) {
          const oldSeasons = new Map(previous.seasons.map(season=>[String(season.number),season]));
          incoming.seasons.forEach(season=>{
            const oldSeason = oldSeasons.get(String(season.number));
            if (!oldSeason || !Array.isArray(season.episodes) || !Array.isArray(oldSeason.episodes)) return;
            const oldEpisodes = new Map(oldSeason.episodes.map(ep=>[String(ep.number),ep]));
            season.episodes.forEach(ep=>fallbackMedia(ep,oldEpisodes.get(String(ep.number))));
          });
        }
      }
      // addedAt es opcional en títulos antiguos. Preservar su fecha conocida;
      // para nuevos títulos sin fecha, usar updatedAt o una fecha fija válida.
      if (!incoming.addedAt || !Number.isFinite(Date.parse(incoming.addedAt))) {
        const prior = pos === undefined ? null : next[pos];
        incoming.addedAt = (prior && prior.addedAt && Number.isFinite(Date.parse(prior.addedAt)))
          ? prior.addedAt
          : (incoming.updatedAt && Number.isFinite(Date.parse(incoming.updatedAt))
              ? incoming.updatedAt : '1970-01-01T00:00:00.000Z');
      }
      if (pos === undefined) {
        next.push(incoming);
        changes++;
      } else if (JSON.stringify(next[pos]) !== JSON.stringify(incoming)) {
        next[pos] = incoming;
        changes++;
      }
    }
    // El catálogo HTML incrustado es siempre nuestro punto de recuperación.
    if (next.length < MOVIES.length || !next.every(validItem)) return null;
    return {version:payload.version, next, changes};
  }
  function apply(update) {
    if (!update || !available()) return false;
    if (protectedView()) { pending=update; return false; }
    const previous = MOVIES.slice();
    try {
      if (update.changes) {
        MOVIES.splice(0, MOVIES.length, ...update.next);
        renderAll();
        if (typeof renderHero === 'function') renderHero();
        // La interfaz debe seguir conservando el listado.
        if (MOVIES.length < previous.length) throw new Error('Número de títulos inesperado');
      }
      revision=update.version;
      pending=null;
      return true;
    } catch (e) {
      MOVIES.splice(0, MOVIES.length, ...previous);
      try { renderAll(); if(typeof renderHero==='function') renderHero(); } catch (_) {}
      console.warn('[MMHD] Cambio público descartado; catálogo anterior conservado.',e);
      return false;
    }
  }
  async function getJson(uri) {
    const response = await fetch(uri,{cache:'no-store',headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error('Respuesta '+response.status);
    return response.json();
  }
  async function check() {
    if (checking || document.visibilityState==='hidden' || !available()) return;
    if (pending && !protectedView()) apply(pending);
    checking=true;
    try {
      const head=await getJson(API+'?head=1');
      if (!head || typeof head.version !== 'string' || head.version === revision) return;
      const payload=await getJson(API);
      const update=prepare(payload);
      if (!update || update.version !== head.version) {
        console.warn('[MMHD] Datos públicos incompletos; se mantiene el catálogo incrustado.');
        return;
      }
      apply(update);
    } catch (err) { console.warn('[MMHD] Catálogo estático conservado; sincronización no disponible.',err.message); }
    finally { checking=false; }
  }
  window.addEventListener('load',()=>{
    // El catálogo HTML se dibuja primero, antes de cualquier solicitud de red.
    setTimeout(check,1500);
    setInterval(check,INTERVAL);
  },{once:true});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check();});
  document.addEventListener('click',()=>{if(pending)setTimeout(()=>{if(pending&&!protectedView())apply(pending);},500);});
})();
