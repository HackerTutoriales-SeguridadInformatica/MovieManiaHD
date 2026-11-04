'use strict';

// Movie Mania HD V3 — prioridad ESTRICTA de tráileres:
// 1) español latino identificable; 2) inglés; 3) idioma original del título.
// Nunca usar español de España ni español sin región como respaldo automático,
// excepto cuando el propio idioma original de la obra sea español (tercer nivel).
// Los metadatos de TMDB son indicios: no verifican el audio de YouTube.

const LATAM_REGIONS = new Set([
  'MX', 'AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'GT', 'HN', 'NI',
  'PA', 'PE', 'PR', 'PY', 'SV', 'UY', 'VE', 'BZ', 'GY', 'SR', 'GF'
]);
const VIDEO_QUERIES = ['es-MX', 'es-AR', 'es-CO', 'es-CL', 'es-PE', 'en-US', 'es-ES'];
const KEY_RE = /^[a-zA-Z0-9_-]{11}$/;
const TYPE_SCORE = { trailer: 3, teaser: 2, clip: 1 };

function normalizeText(str) {
  return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function meta(video) {
  return {
    lang: String(video?.iso_639_1 || '').toLowerCase(),
    region: String(video?.iso_3166_1 || '').toUpperCase(),
    name: normalizeText(video?.name)
  };
}
function isSpainName(name) {
  return /(?:castellano|espana|spanish\s*(?:spain|es)|es[-_]es|espanol\s*(?:de\s*)?espana|doblaje\s*espanol\s*espana)/i.test(name);
}
function isLatinName(name) {
  return /(?:espanol\s*(?:latino(?:americano)?|de\s*(?:mexico|latinoamerica))|latin(?:o|a|america|oamericano)|latam|doblaje\s*latino|es[-_](?:419|mx|ar|co|cl|pe)|mexican[oa])/i.test(name);
}
function isSubtitled(name) {
  // Un tráiler subtitulado en español latino puede tener audio original.
  return /(?:subtitula(?:do|da|dos|das)?|subtitulos?|subtitled|subtitles?|subbed|sub\s*(?:esp|lat(?:am|ino)?)|v\.?o\.?s\.?e\.?)/i.test(name);
}
function languageTier(video, originalLanguage) {
  const { lang, region, name } = meta(video);
  const original = String(originalLanguage || '').toLowerCase();
  // El nombre explícitamente «castellano / España» prevalece sobre un país MX
  // incorrecto. Solo es válido si el idioma ORIGINAL de la obra es español.
  if (lang === 'es' && isSpainName(name)) return original === 'es' ? 1 : 0;
  const latinByName = isLatinName(name) && !isSubtitled(name);
  const latinByRegion = lang === 'es' && LATAM_REGIONS.has(region) && !isSubtitled(name);
  if ((lang === 'es' || lang === '' || lang === 'und') && (latinByName || latinByRegion)) return 3;
  if (lang === 'en') return 2;
  // «es» sin país confirmado NO se trata como latino.
  // En particular, no se selecciona castellano si la película es originalmente inglesa.
  if (original && lang === original) return 1;
  return 0;
}
function rank(video, originalLanguage) {
  return languageTier(video, originalLanguage) * 100000
    + (TYPE_SCORE[String(video?.type || '').toLowerCase()] || 0) * 1000
    + (video.official ? 100 : 0);
}
function label(video, originalLanguage) {
  const tier = languageTier(video, originalLanguage);
  if (tier === 3) return 'Español latino (según TMDB)';
  if (tier === 2) return 'Inglés';
  return 'Idioma original (' + String(originalLanguage || 'no identificado') + ')';
}
async function tmdbRequest(path, token) {
  const response = await fetch('https://api.themoviedb.org/3/' + path, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error('TMDB respondió HTTP ' + response.status);
  return response.json();
}
function validVideos(results) {
  return (Array.isArray(results) ? results : []).filter(video =>
    String(video?.site || '').toLowerCase() === 'youtube' && KEY_RE.test(String(video?.key || ''))
  );
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=60');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  const kind = String(req.query?.type || '').toLowerCase();
  const id = String(req.query?.id || '');
  if (!['movie', 'tv'].includes(kind) || !/^[1-9]\d{0,8}$/.test(id)) {
    return res.status(400).json({ error: 'Identificador de película o serie no válido.' });
  }
  const token = process.env.TMDB_API_KEY;
  if (!token) return res.status(503).json({ error: 'TMDB no está configurado en el servidor.' });

  try {
    // Consultar detalles en paralelo para obtener el idioma de rodaje original.
    // Los distintos territorios recuperan videos que es-MX por sí solo podría omitir.
    const jobs = [
      tmdbRequest(`${kind}/${id}?language=en-US`, token),
      ...VIDEO_QUERIES.map(language => tmdbRequest(
        `${kind}/${id}/videos?language=${encodeURIComponent(language)}&include_video_language=es,en,null`, token
      ))
    ];
    const settled = await Promise.allSettled(jobs);
    const detail = settled[0].status === 'fulfilled' ? settled[0].value : null;
    const originalLanguage = String(detail?.original_language || '').toLowerCase();
    const videoResponses = settled.slice(1).filter(result => result.status === 'fulfilled');
    if (!videoResponses.length) throw new Error('No se pudieron consultar los videos de TMDB.');
    const unique = new Map();
    const add = body => {
      for (const video of validVideos(body?.results)) {
        const old = unique.get(video.key);
        if (!old || rank(video, originalLanguage) > rank(old, originalLanguage)) unique.set(video.key, video);
      }
    };
    for (const result of videoResponses) add(result.value);

    // Si el idioma original NO es español ni inglés, asegurar que se consulten
    // sus videos, porque los filtros de los territorios anteriores podrían omitirlos.
    if (originalLanguage && originalLanguage !== 'es' && originalLanguage !== 'en' && /^[a-z]{2,3}$/.test(originalLanguage)) {
      try {
        const original = await tmdbRequest(
          `${kind}/${id}/videos?language=${encodeURIComponent(originalLanguage)}&include_video_language=${encodeURIComponent(`es,en,${originalLanguage},null`)}`,
          token
        );
        add(original);
      } catch (error) {
        console.warn('[MMHD trailer] No se pudo consultar el idioma original:', originalLanguage, error?.message);
      }
    }

    const all = [...unique.values()].filter(video => languageTier(video, originalLanguage) > 0);
    // Los clips solo se consideran si no hay ningún tráiler ni teaser válido.
    const main = all.filter(video => ['trailer', 'teaser'].includes(String(video.type || '').toLowerCase()));
    const eligible = main.length ? main : all.filter(video => String(video.type || '').toLowerCase() === 'clip');
    eligible.sort((a, b) => {
      const diff = rank(b, originalLanguage) - rank(a, originalLanguage);
      return diff || ((Date.parse(b.published_at || '') || 0) - (Date.parse(a.published_at || '') || 0));
    });
    const best = eligible[0];
    if (!best) return res.status(404).json({
      error: 'No se encontró un tráiler en español latino, inglés ni en el idioma original.'
    });
    return res.status(200).json({
      key: String(best.key),
      name: String(best.name || 'Tráiler').slice(0, 130),
      type: String(best.type || 'Trailer'),
      language: String(best.iso_639_1 || '').slice(0, 4),
      region: String(best.iso_3166_1 || '').slice(0, 2),
      languageLabel: label(best, originalLanguage),
      originalLanguage,
      priority: 'latam-english-original',
      official: Boolean(best.official)
    });
  } catch (error) {
    console.error('[MMHD trailer]', kind, id, error?.message || error);
    return res.status(502).json({ error: 'No fue posible consultar los tráileres en TMDB.' });
  }
};
