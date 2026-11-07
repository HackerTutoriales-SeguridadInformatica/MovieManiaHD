'use strict';
// Imagen pública de la portada para notificaciones solicitadas de Movie Mania HD.
// Solo admite rutas de imágenes TMDB: NO acepta URLs externas arbitrarias.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Método no permitido');
  }
  const path = typeof req.query?.path === 'string' ? req.query.path : '';
  if (!/^\/[A-Za-z0-9_.-]{8,160}\.(?:jpg|jpeg|png|webp)$/i.test(path) || path.includes('..')) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).send('Ruta de imagen no válida');
  }
  const url = 'https://image.tmdb.org/t/p/w342' + path;
  try {
    const upstream = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'image/jpeg,image/png,image/webp', 'User-Agent': 'MovieManiaHD-MailPoster/1.0' },
      signal: AbortSignal.timeout(15000)
    });
    if (!upstream.ok) return res.status(502).send('No se pudo obtener la portada de TMDB');
    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!['image/jpeg','image/png','image/webp'].includes(contentType)) {
      return res.status(502).send('TMDB no devolvió una imagen admitida');
    }
    const length = Number(upstream.headers.get('content-length') || 0);
    if (length > 3_000_000) return res.status(502).send('Portada demasiado grande');
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length < 80 || bytes.length > 3_000_000) return res.status(502).send('Portada no válida');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'HEAD') return res.status(200).end();
    return res.status(200).end(bytes);
  } catch (err) {
    console.warn('[MMHD Mail Poster] No se pudo obtener imagen:', err?.message || String(err));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).send('Error al descargar la portada');
  }
};
