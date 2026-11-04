'use strict';

// Tráileres de TMDB para el catálogo público de Movie Mania HD.
// Preferir audio español latino SOLO cuando TMDB identifica un video real en ese idioma.
// Conservar una alternativa (español de España, inglés u original) si no existe.
// No expone credenciales ni escribe datos de la biblioteca.
// La región de TMDB es una pista, no una garantía del doblaje real de YouTube.
// Si el título del video dice «castellano» o «España», esa evidencia prevalece
// incluso sobre un código regional latinoamericano cargado incorrectamente.
const LATAM = new Set([
  'MX','AR','BO','CL','CO','CR','CU','DO','EC','GT','HN','NI','PA',
  'PE','PR','PY','SV','UY','VE'
]);
const LANGUAGES = ['es-MX', 'es-AR', 'es-CO', 'es-CL', 'es-PE', 'es-ES', 'en-US'];
const KEY_RE = /^[a-zA-Z0-9_-]{11}$/;
const TYPE_SCORE = { trailer: 50, teaser: 30, clip: 10 };

function videoMeta(video) {
  return {
    lang: String(video?.iso_639_1 || '').toLowerCase(),
    region: String(video?.iso_3166_1 || '').toUpperCase(),
    name: String(video?.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  };
}

function languagePriority(video) {
  const { lang, region, name } = videoMeta(video);
  // Los nombres expresamente regionales tienen prioridad sobre iso_3166_1,
  // porque algunos videos aparecen etiquetados con un país equivocado.
  const isSpain = /(?:castellano|espana|spanish\s*(?:spain|es)|es[-_]es|espanol\s*(?:de\s*)?espana|doblaje\s*espanol\s*espana)/i.test(name);
  const isLatam = /(?:espanol\s*(?:latino(?:americano)?|de\s*(?:mexico|latinoamerica))|latin(?:o|a|america|oamericano)|latam|doblaje\s*latino|es[-_](?:419|mx|ar|co|cl|pe)|mexican[oa])/i.test(name);
  if (isSpain) return 25;  // Español de España, aunque región TMDB indique MX.
  if (isLatam && (lang === 'es' || lang === '' || lang === 'und')) return 60;
  if (lang === 'es' && LATAM.has(region)) return 55;
  if (lang === 'es' && region !== 'ES') return 40; // Español sin región fiable.
  if (lang === 'es') return 20;                     // Español de España.
  if (lang === 'en') return 15;
  return 5;
}

function videoTypePriority(video) {
  const type = String(video?.type || '').toLowerCase();
  return TYPE_SCORE[type] || 0;
}

function rank(video) {
  // Prioridad REAL: español latino > español sin región fiable > España > inglés.
  // Solo dentro de un idioma preferimos tráiler, teaser y luego otros videos.
  return languagePriority(video) * 100000
    + videoTypePriority(video) * 1000
    + (video.official ? 100 : 0);
}

function languageLabel(video) {
  const level = languagePriority(video);
  if (level >= 55) return 'Español latino (según TMDB)';
  if (level === 40) return 'Español (región no confirmada)';
  if (level === 20 || level === 25) return 'Español (España)';
  if (level === 15) return 'Inglés';
  return 'Idioma original u otro';
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=90, s-maxage=300, stale-while-revalidate=300');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  const kind = String(req.query?.type || '').toLowerCase();
  const rawId = String(req.query?.id || '');
  if (!['movie', 'tv'].includes(kind) || !/^[1-9]\d{0,8}$/.test(rawId)) {
    return res.status(400).json({ error: 'Identificador de película o serie no válido.' });
  }
  const token = process.env.TMDB_API_KEY;
  if (!token) return res.status(503).json({ error: 'TMDB no está configurado en el servidor.' });

  try {
    // Diferentes territorios de español para encontrar videos latinoamericanos
    // que una consulta es-MX podría no devolver. También se conserva el fallback.
    // Si falla un territorio, los demás siguen funcionando.
    const settled = await Promise.allSettled(LANGUAGES.map(async language => {
      const url = `https://api.themoviedb.org/3/${kind}/${rawId}/videos?language=${language}&include_video_language=es,en,null`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(6500)
      });
      if (!response.ok) throw new Error(`TMDB respondió HTTP ${response.status} (${language}).`);
      const body = await response.json();
      return Array.isArray(body.results) ? body.results : [];
    }));
    const successful = settled.filter(x => x.status === 'fulfilled');
    if (!successful.length) throw new Error('Todas las consultas a TMDB fallaron.');

    const unique = new Map();
    for (const result of successful) {
      for (const video of result.value) {
        if (String(video.site || '').toLowerCase() !== 'youtube') continue;
        const key = String(video.key || '');
        if (!KEY_RE.test(key)) continue;
        const current = unique.get(key);
        if (!current || rank(video) > rank(current)) unique.set(key, video);
      }
    }

    // Evitar elegir clips breves si TMDB dispone de tráileres o teasers.
    const candidates = [...unique.values()];
    const playable = candidates.some(v => videoTypePriority(v) >= 30)
      ? candidates.filter(v => videoTypePriority(v) >= 30)
      : candidates;
    const sorted = playable.sort((a, b) => {
      const score = rank(b) - rank(a);
      if (score) return score;
      // Para igual idioma/tipo/oficialidad, priorizar video reciente.
      const da = Date.parse(a.published_at || '') || 0;
      const db = Date.parse(b.published_at || '') || 0;
      return db - da;
    });
    const best = sorted[0];
    if (!best) return res.status(404).json({ error: 'No se encontró un tráiler de YouTube para este título.' });
    return res.status(200).json({
      key: String(best.key),
      name: String(best.name || 'Tráiler').slice(0, 130),
      type: String(best.type || 'Trailer'),
      language: String(best.iso_639_1 || '').slice(0, 4),
      region: String(best.iso_3166_1 || '').slice(0, 2),
      languageLabel: languageLabel(best),
      official: Boolean(best.official)
    });
  } catch (error) {
    console.error('[MMHD trailer]', kind, rawId, error?.message || error);
    return res.status(502).json({ error: 'No fue posible consultar el tráiler en TMDB.' });
  }
};
