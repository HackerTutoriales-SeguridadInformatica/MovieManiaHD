/*
 * Movie Mania HD V3 — Inicio: episodios publicados y fechas reales.
 * Extensión independiente. No edita Supabase, fuentes de reproducción,
 * Chromecast, AirPlay ni la aprobación de publicaciones.
 *
 * Insertar DESPUÉS del script principal del catálogo y junto a public-sync.js:
 * <script src="/inicio-episodios.js?v=20261101a" defer></script>
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

  function patch() {
    if (typeof MOVIES === 'undefined' || !Array.isArray(MOVIES) ||
        typeof mmhdRenderHomeRows !== 'function' ||
        typeof mmhdHomeCard !== 'function' ||
        typeof mmhdRecentItems !== 'function' ||
        typeof isPlayableEpisode !== 'function') return false;

    // «Nuevos episodios»: ahora se ordenan por la fecha del capítulo, no
    // por la fecha general de edición de su serie.
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

      // «Recién agregados»: combina los títulos nuevos con el episodio
      // reproducible más reciente de cada serie. Límite de ocho series para
      // que el carrusel siga mostrando películas y series nuevas.
      const titleCards = mmhdRecentItems().map(m => ({
        m, time: dateValue(m.addedAt), isEpisode: false
      }));
      const usedSeries = new Set();
      const episodeCards = [];
      for (const ep of playableEpisodes(Infinity)) {
        const key = String(ep.series.id);
        if (ep.time <= 0 || usedSeries.has(key)) continue;
        usedSeries.add(key);
        episodeCards.push({m: ep.series, episode: ep, time: ep.time, isEpisode: true});
        if (episodeCards.length >= 8) break;
      }
      const cards = titleCards.concat(episodeCards)
        .sort((a, b) => b.time - a.time || Number(b.isEpisode) - Number(a.isEpisode))
        .slice(0, 20);
      if (!cards.length) return;

      // Guardamos el botón «Ver más» real para conservar su listener original.
      const template = document.createElement('template');
      template.innerHTML = cards.map(c => mmhdHomeCard(c)).join('');
      track.replaceChildren(template.content, more);

      // Igual que los botones originales del catálogo: una tarjeta de
      // episodio abre ese episodio; una tarjeta normal abre su ficha.
      for (const button of track.querySelectorAll('.mmhd-home-card')) {
        button.addEventListener('click', function () {
          const series = MOVIES.find(m => String(m.id) === this.dataset.mmhdRowId);
          if (!series) return;
          if (!this.dataset.mmhdRowSeason) {
            openDetail(series.id);
            return;
          }
          const season = Number(this.dataset.mmhdRowSeason);
          const found = findSeriesEpisode(series, season, Number(this.dataset.mmhdRowEpisode));
          if (found && isPlayableEpisode(found.data))
            openPlayer(playableForSeries(series, season, found.data));
          else openDetail(series.id);
        });
      }
      if (typeof setupHomeEpisodeLogos === 'function') setupHomeEpisodeLogos(track);
      const badge = row.querySelector('.mmhd-home-count');
      if (badge) badge.title = 'Incluye títulos recientes y capítulos publicados recientemente';
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
