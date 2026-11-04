'use strict';

// Tráileres de TMDB para el catálogo público de Movie Mania HD.
// Preferir audio español latino SOLO cuando TMDB identifica un video real en ese idioma.
// Conservar una alternativa (español de España, inglés u original) si no existe.
// No expone credenciales ni escribe datos de la biblioteca.
const LATAM = new Set([
  'MX','AR','BO','CL','CO','CR','CU','DO','EC','GT','HN','NI','PA',
  'PE','PR','PY','SV','UY','VE','US'
]);
const LANGUAGES = ['es-MX', 'es-AR', 'es-CO', 'es-ES', 'en-US'];
const KEY_RE = /^[a-zA-Z0-9_-]{11}$/;

function spanishLatino(video) {
  const lang = String(video.iso_639_1 || '').toLowerCase();
  const region = String(video.iso_3166_1 || '').toUpperCase();
  const name = String(video.name || '').toLowerCase();
  return lang === 'es' && (
    LATAM.has(region) ||
    /latino|latina|latam|latinoam[eé]rica|hispanoam[eé]rica|espa[nñ]ol\s*(?:de\s*)?(?:m[eé]xico|latino)/i.test(name)
  );
}

function languagePriority(video) {
  const lang = String(video.iso_639_1 || '').toLowerCase();
  const region = String(video.iso_3166_1 || '').toUpperCase();
  if (spanishLatino(video)) return 5;
  if (lang === 'es' && region === 'ES') return 4;
  if (lang === 'es') return 3; // Español, pero TMDB no identifica una región latina.
  if (lang === 'en') return 2;
  return 1;
}

function videoTypePriority(video) {
  const type = String(video.type || '').toLowerCase();
  // No mostrar clips o entrevistas por encima de tráileres completos.
  if (type === 'trailer') return 4;
  if (type === 'teaser') return 3;
  if (type === 'clip') return 2;
  return 1;
}

function rank(video) {
  // El idioma manda cuando se comparan dos tráileres del mismo tipo.
  // Una pieza teaser no desplaza un tráiler completo disponible.
  return videoTypePriority(video) * 10000
    + languagePriority(video) * 1000
    + (video.official ? 100 : 0);
}

function languageLabel(video) {
  const lang = String(video.iso_639_1 || '').toLowerCase();
  if (spanishLatino(video)) return 'Español latino';
  if (lang === 'es') return String(video.iso_3166_1 || '').toUpperCase() === 'ES'
    ? 'Español (España)' : 'Español';
  if (lang === 'en') return 'Inglés';
  return 'Idioma original u otro';
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=180, s-maxage=3600, stale-while-revalidate=3600');
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

    const sorted = [...unique.values()].sort((a, b) => {
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
