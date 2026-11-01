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
      Object.prototype.hasOwnProperty.call(x,'poster') &&
      Object.prototype.hasOwnProperty.call(x,'addedAt');
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
      if (pos === undefined) {
        next.push(clone(item));
        changes++;
      } else if (JSON.stringify(next[pos]) !== JSON.stringify(item)) {
        next[pos] = clone(item);
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
