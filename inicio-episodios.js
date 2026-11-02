/*
 * Movie Mania HD V3 — Inicio: películas actualizadas, series completas en Recién agregados;
 * episodios individuales en Nuevos episodios.
 * Extensión independiente. No edita Supabase, fuentes de reproducción,
 * Chromecast, AirPlay ni la aprobación de publicaciones.
 *
 * Insertar DESPUÉS del script principal del catálogo y junto a public-sync.js:
 * <script src="/inicio-episodios.js?v=20261102c" defer></script>
 */
(function () {
  'use strict';
  if (window.MMHD_INICIO_EPISODIOS_V1) return;
  window.MMHD_INICIO_EPISODIOS_V1 = true;

  function dateValue(value) {
    const t = Date.parse(String(value || ''));
    return Number.isFinite(t) ? t : 0;
  }
  // Únicamente fechas propias de CADA episodio. Cuando una serie se edita,
  // NO se deben poner todos sus capítulos como si acabaran de agregarse.
  function episodeActivity(ep) {
    return Math.max(dateValue(ep && ep.addedAt), dateValue(ep && ep.updatedAt));
  }
  function playableEpisodes(limit) {
    const result = [];
    for (const series of MOVIES) {
      if (series.kind !== 'SERIES') continue;
      for (const season of (Array.isArray(series.seasons) ? series.seasons : [])) {
        for (const episode of (Array.isArray(season.episodes) ? season.episodes : [])) {
          if (!isPlayableEpisode(episode)) continue;
          result.push({
            series,
            season: Number(season.number) || 0,
            episode,
            time: episodeActivity(episode)
          });
        }
      }
    }
    result.sort((a, b) => b.time - a.time ||
      Number(b.season) - Number(a.season) ||
      Number(b.episode.number) - Number(a.episode.number));
    return result.slice(0, Number.isFinite(limit) ? Math.max(0, limit) : result.length);
  }

  // Las publicaciones anteriores al lanzamiento de esta función incluyen
  // miles de fechas de "actualización" provenientes de importaciones masivas.
  // No las consideramos novedades para no ocultar las incorporaciones reales.
  // Desde el 2 de noviembre de 2026, una película EDITADA Y PUBLICADA
  // puede volver al principio de Recién agregados.
  const MOVIE_EDIT_LAUNCH = Date.parse('2026-11-02T00:00:00.000Z');

  function activityForMovie(movie) {
    const added = dateValue(movie.addedAt);
    const updated = dateValue(movie.updatedAt);
    if (movie.kind === 'MOVIE' && updated >= MOVIE_EDIT_LAUNCH && updated > added) {
      return updated;
    }
    return added;
  }

  function recentTitles(limit = 20) {
    // Todos los títulos aprobados, no solo los 20 agregados originalmente:
    // una película antigua recién editada debe poder entrar al carrusel.
    const byId = new Map();
    MOVIES.forEach((movie, index) => {
      byId.set(String(movie.id), {m:movie, time:activityForMovie(movie), index});
    });
    // Las series mantienen UNA tarjeta por título, con prioridad por la
    // actividad del capítulo individual. No se incluyen tarjetas de episodios.
    const usedSeries = new Set();
    for (const ep of playableEpisodes(Infinity)) {
      const key = String(ep.series.id);
      if (ep.time <= 0 || usedSeries.has(key)) continue;
      usedSeries.add(key);
      const existing = byId.get(key);
      if (existing) existing.time = Math.max(existing.time, ep.time);
      if (usedSeries.size >= 8) break;
    }
    return Array.from(byId.values()).sort((a,b) =>
      b.time - a.time || b.index - a.index
    ).slice(0, Number.isFinite(limit) ? Math.max(0,limit) : byId.size);
  }

  function patch() {
    if (typeof MOVIES === 'undefined' || !Array.isArray(MOVIES) ||
        typeof mmhdRenderHomeRows !== 'function' ||
        typeof mmhdHomeCard !== 'function' ||
        typeof mmhdRecentItems !== 'function' ||
        typeof isPlayableEpisode !== 'function') return false;

    // «Nuevos episodios»: orden cronológico del capítulo, sin usar la fecha
    // general de modificación de la serie para todos sus capítulos.
    window.mmhdLatestEpisodes = function (limit = 18) {
      return playableEpisodes(limit);
    };

    const originalRenderRows = mmhdRenderHomeRows;
    window.mmhdRenderHomeRows = function () {
      originalRenderRows.apply(this, arguments);
      const row = document.querySelector('[data-mmhd-row="recent"]');
      if (!row) return;
      const track = row.querySelector('.mmhd-home-track');
      const more = track && track.querySelector('[data-mmhd-more="recent"]');
      if (!track || !more) return;

      // Una edición publicada de una película puede promocionarla sin
      // duplicarla. Las series siempre conservan la tarjeta de la serie.
      const cards = recentTitles(20);
      if (!cards.length) return;
      const template = document.createElement('template');
      template.innerHTML = cards.map(c => mmhdHomeCard(c)).join('');
      track.replaceChildren(template.content, more);
      for (const button of track.querySelectorAll('.mmhd-home-card')) {
        button.addEventListener('click', function () {
          const item = MOVIES.find(m => String(m.id) === this.dataset.mmhdRowId);
          if (item) openDetail(item.id);
        });
      }
      if (typeof setupHomeEpisodeLogos === 'function') setupHomeEpisodeLogos(track);
      const badge = row.querySelector('.mmhd-home-count');
      if (badge) badge.title = 'Películas y series nuevas, o películas actualizadas y aprobadas';
    };
    return true;
  }

  if (!patch()) {
    console.warn('[MMHD Inicio] No se encontró el catálogo esperado; se conserva la versión original.');
    return;
  }
  // La primera representación ya ocurrió antes de que cargue este archivo.
  // Al aprobar cambios, public-sync.js llamará a renderAll() otra vez.
  function initialRender() {
    if (typeof renderAll === 'function') renderAll();
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', initialRender, {once: true});
  else initialRender();
})();
