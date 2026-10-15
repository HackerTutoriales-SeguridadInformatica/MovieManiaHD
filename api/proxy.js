// api/proxy.js
// Proxy de descarga: recibe ?url=... y devuelve el binario con headers de descarga.
// Sirve para saltar el bloqueo CORS de lh3.googleusercontent.com

export default async function handler(req, res) {
  // CORS para que tu catálogo (en cualquier origen) pueda pedirlo
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Content-Disposition');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Método no permitido.' });
    return;
  }

  const targetUrl = (req.query.url || '').trim();
  if (!targetUrl) {
    res.status(400).json({ ok: false, error: 'Falta el parámetro ?url=' });
    return;
  }

  // Validación de seguridad: solo permitir dominios de Google Photos
  let host;
  try {
    host = new URL(targetUrl).hostname;
  } catch {
    res.status(400).json({ ok: false, error: 'URL inválida.' });
    return;
  }
  const allowed = /(^|\.)googleusercontent\.com$/.test(host);
  if (!allowed) {
    res.status(403).json({ ok: false, error: 'Dominio no permitido: ' + host });
    return;
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/140.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
      }
    });

    if (!upstream.ok) {
      res.status(502).json({ ok: false, error: 'Upstream HTTP ' + upstream.status });
      return;
    }

    // Reenviar headers útiles
    const ct = upstream.headers.get('Content-Type') || 'application/octet-stream';
    const cl = upstream.headers.get('Content-Length');
    res.setHeader('Content-Type', ct);
    if (cl) res.setHeader('Content-Length', cl);
    res.setHeader('Cache-Control', 'no-store');

    // Streamear el cuerpo al cliente
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();

  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'Error en el proxy: ' + (err.message || 'desconocido')
    });
  }
}