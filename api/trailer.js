'use strict';

// Consulta pública y limitada de tráileres oficiales en TMDB.
// Reutiliza TMDB_API_KEY, ya configurada para api/requests.js.
// No expone credenciales ni modifica registros de la biblioteca.
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
    const languages = ['es-MX', 'es-ES', 'en-US'];
    // Priorizar vídeos en español sin descartar el tráiler original en inglés.
    const lists = await Promise.all(languages.map(async (language) => {
      const url = `https://api.themoviedb.org/3/${kind}/${rawId}/videos?language=${language}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(6500)
      });
      if (!response.ok) throw new Error('TMDB respondió HTTP ' + response.status);
      const body = await response.json();
      return (Array.isArray(body.results) ? body.results : []).map(item => ({ ...item, requestedLanguage: language }));
    }));

    const unique = new Map();
    for (const video of lists.flat()) {
      if (String(video.site).toLowerCase() !== 'youtube') continue;
      const key = String(video.key || '');
      if (!/^[\w-]{11}$/.test(key)) continue;
      if (!unique.has(key)) unique.set(key, video);
    }

    const sorted = [...unique.values()].sort((a, b) => {
      function points(v) {
        const type = String(v.type || '').toLowerCase();
        const typeScore = type === 'trailer' ? 120 : type === 'teaser' ? 65 : type === 'clip' ? 25 : 0;
        const langScore = v.requestedLanguage === 'es-MX' ? 26 : v.requestedLanguage === 'es-ES' ? 20 : 11;
        const official = v.official ? 35 : 0;
        return typeScore + langScore + official;
      }
      return points(b) - points(a);
    });
    const best = sorted[0];
    if (!best) return res.status(404).json({ error: 'No se encontró un tráiler de YouTube para este título.' });
    return res.status(200).json({
      key: String(best.key),
      name: String(best.name || 'Tráiler').slice(0,130),
      type: String(best.type || 'Trailer'),
      language: String(best.iso_639_1 || '').slice(0,4),
      official: Boolean(best.official)
    });
  } catch (error) {
    console.error('[MMHD trailer]', kind, rawId, error.message);
    return res.status(502).json({ error: 'No fue posible consultar el tráiler en TMDB.' });
  }
};
