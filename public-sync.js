/* Movie Mania HD V3: sincronización pública a prueba de fallos. */
(function () {
  'use strict';
  if (typeof MOVIES === 'undefined' || !Array.isArray(MOVIES) || typeof renderAll !== 'function') return;
  const endpoint = '/api/public-library';
  let activeVersion = null;
  let busy = false;
  let pending = false;
  let lastKnownGood = MOVIES.map(x => structuredClone(x));
  function isOpen() {
    return !!document.getElementById('playerModal')?.classList.contains('show') ||
           !!document.getElementById('detailScreen')?.classList.contains('show');
  }
  function validItem(m) {
    return m && typeof m === 'object' && !Array.isArray(m) && m.id != null &&
      String(m.id).length <= 120 && typeof m.title === 'string' && m.title.trim().length > 0 &&
      (m.kind === 'MOVIE' || m.kind === 'SERIES');
  }
  function apply(data) {
    // No permitir que una respuesta parcial o vacía borre el catálogo existente.
    if (!data || !Array.isArray(data.items) || !Array.isArray(data.approvedIds) ||
        typeof data.version !== 'string' || !data.items.length) return false;
    if (!data.items.every(validItem)) return false;
    const ids = new Set();
    for (const item of data.items) {
      const id = String(item.id);
      if (ids.has(id)) return false;
      ids.add(id);
    }
    // No eliminar títulos estáticos de forma automática. Retirar contenido exige
    // una publicación estática coordinada para garantizar coherencia sin conexión.
    const next = MOVIES.map(x => structuredClone(x));
    const index = new Map(next.map((m,i) => [String(m.id),i]));
    for (const item of data.items) {
      const id = String(item.id);
      const pos = index.get(id);
      if (pos !== undefined) {
        // Mantener todos los campos originales, incluyendo enlaces m18/m22/m37,
        // temporadas, subtítulos, cast, logos, poster, runtime y configuraciones.
        next[pos] = Object.assign({}, next[pos], item);
      } else {
        next.push(structuredClone(item));
      }
    }
    if (!next.length || !next.every(validItem)) return false;
    const previous = MOVIES.slice();
    try {
      MOVIES.splice(0, MOVIES.length, ...next);
      if (!isOpen()) {
        renderAll();
        if (typeof renderHero === 'function') renderHero();
        pending = false;
      } else pending = true;
      activeVersion = data.version;
      lastKnownGood = next.map(x => structuredClone(x));
      return true;
    } catch (error) {
      MOVIES.splice(0, MOVIES.length, ...previous);
      console.warn('[MMHD] Se conservó el catálogo tras un error de renderizado', error);
      try { renderAll(); } catch (_) {}
      return false;
    }
  }
  async function check() {
    if (busy || document.visibilityState === 'hidden') return;
    busy = true;
    try {
      const h = await fetch(endpoint + '?head=1', {cache:'no-store'});
      if (!h.ok) return;
      const meta = await h.json();
      if (typeof meta.version !== 'string') return;
      if (meta.version !== activeVersion) {
        const r = await fetch(endpoint, {cache:'no-store'});
        if (!r.ok) return;
        const data = await r.json();
        if (!apply(data)) console.warn('[MMHD] Respuesta pública incompleta; se conserva el catálogo estático.');
      } else if (pending && !isOpen()) {
        try {renderAll(); if (typeof renderHero === 'function') renderHero(); pending=false;} catch(e) {console.warn('[MMHD] Error al redibujar',e);}
      }
    } catch(e) {console.warn('[MMHD] Sincronización no disponible; catálogo local conservado.',e);}
    finally {busy = false;}
  }
  window.addEventListener('load', () => {void check();setInterval(() => void check(),20000);}, {once:true});
  document.addEventListener('visibilitychange', () => {if(document.visibilityState==='visible')void check();});
})();
