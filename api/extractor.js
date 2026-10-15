// api/extractor.js
// Función serverless para Vercel (Node.js runtime)
// Extrae la URL base de Google Photos y genera m37, m22, m18

export default async function handler(req, res) {
  // ---------- CORS ----------
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Método no permitido.' });
    return;
  }

  // ---------- Leer body ----------
  let googleUrl = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    googleUrl = (body?.google_url || '').trim();
  } catch {
    res.status(400).json({ ok: false, error: 'Body inválido.' });
    return;
  }

  if (!googleUrl) {
    res.status(400).json({ ok: false, error: 'Introduce un enlace de Google Photos.' });
    return;
  }

  try {
    new URL(googleUrl);
  } catch {
    res.status(400).json({ ok: false, error: 'El enlace introducido no es válido.' });
    return;
  }

  // ---------- Descargar la página de Google Photos ----------
  try {
    const response = await fetch(googleUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/140.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
      }
    });

    if (!response.ok) {
      res.status(502).json({
        ok: false,
        error: 'Google Photos respondió con el código HTTP: ' + response.status
      });
      return;
    }

    let html = await response.text();

    // Limpiar caracteres escapados
    html = html
      .replace(/\\\//g, '/')
      .replace(/\\u003d/g, '=')
      .replace(/\\u0026/g, '&')
      .replace(/&amp;/g, '&');

    // Buscar todas las URLs que comiencen con lh3.googleusercontent.com/pw
    const regex = /https:\/\/lh3\.googleusercontent\.com\/pw[^\s"'<>\\]+/gi;
    const matches = html.match(regex) || [];

    // Eliminar duplicados
    const urls = [...new Set(matches)];

    // Buscar la URL más larga
    let urlMasLarga = '';
    for (let url of urls) {
      url = url.replace(/[),;]+$/, '');
      if (url.length > urlMasLarga.length) {
        urlMasLarga = url;
      }
    }

    if (!urlMasLarga) {
      res.status(404).json({
        ok: false,
        error:
          'No se encontró ninguna URL de Google Photos que comience con https://lh3.googleusercontent.com/pw'
      });
      return;
    }

    const pos = urlMasLarga.lastIndexOf('=');
    if (pos === -1) {
      res.status(422).json({
        ok: false,
        error: 'La URL encontrada no contiene el signo "=".'
      });
      return;
    }

    const base = urlMasLarga.substring(0, pos + 1);

    res.status(200).json({
      ok: true,
      error: '',
      base,
      m37: base + 'm37',
      m22: base + 'm22',
      m18: base + 'm18'
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      error:
        'No fue posible descargar la página de Google Photos: ' +
        (err.message || 'Error desconocido')
    });
  }
}