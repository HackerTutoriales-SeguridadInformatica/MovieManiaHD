// Vercel /api/extractor — Google Photos (solo enlaces autorizados).
// Genera variantes de calidad; no puede garantizar que cada variante reproduzca.
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 12000;
const PAGE_HOSTS = new Set(['photos.google.com', 'photos.app.goo.gl']);

function checkedUrl(input, hosts){
  if (typeof input !== 'string' || input.length > 4096) throw Error('URL demasiado larga o inválida.');
  let u;
  try { u = new URL(input); } catch { throw Error('El enlace introducido no es válido.'); }
  if (u.protocol !== 'https:' || !hosts.has(u.hostname.toLowerCase()) || u.username || u.password || (u.port && u.port !== '443')){
    throw Error('Solo se aceptan enlaces HTTPS de Google Photos.');
  }
  return u;
}

async function fetchPhotosPage(startUrl){
  let url = checkedUrl(startUrl, PAGE_HOSTS);
  for (let i = 0; i <= MAX_REDIRECTS; i++){
    const response = await fetch(url.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
      }
    });
    if (response.status >= 300 && response.status < 400){
      const location = response.headers.get('location');
      if (!location) throw Error('Google Photos redirigió sin indicar un destino.');
      url = checkedUrl(new URL(location, url).href, PAGE_HOSTS);
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) throw Error('Google Photos respondió HTTP ' + response.status + '.');
    if (!(response.headers.get('content-type') || '').toLowerCase().includes('text/html')) {
      throw Error('La URL no devolvió una página HTML de Google Photos.');
    }
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_HTML_BYTES) throw Error('La página supera el tamaño permitido.');
    if (!response.body) throw Error('Google Photos no devolvió contenido.');
    const reader = response.body.getReader();
    const pieces = [];
    let size = 0;
    try {
      while (true){
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_HTML_BYTES) { await reader.cancel(); throw Error('La página supera el tamaño permitido.'); }
        pieces.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const chunk of pieces) { all.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(all);
  }
  throw Error('Demasiadas redirecciones de Google Photos.');
}

function urlsFromBase(url){
  const media = checkedUrl(url, new Set(['lh3.googleusercontent.com']));
  if (!media.pathname.includes('=')) throw Error('No se encontró el formato esperado de enlace del video.');
  const equals = media.href.lastIndexOf('=');
  if (equals <= media.href.indexOf('/', 8) || media.search || media.hash) throw Error('El enlace del video no tiene un sufijo válido.');
  const base = media.href.slice(0, equals + 1);
  return {ok:true, error:'', base, m37:base+'m37', m22:base+'m22', m18:base+'m18', verified:false,
    notice:'Enlaces generados: comprueba su reproducción antes de publicar.'};
}

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ok:false,error:'Método no permitido.'});
  let googleUrl;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    googleUrl = body?.google_url;
    if (typeof googleUrl !== 'string') throw Error('Introduce un enlace de Google Photos.');
    googleUrl = googleUrl.trim();
    if (!googleUrl) throw Error('Introduce un enlace de Google Photos.');
    if (googleUrl.length > 4096) throw Error('El enlace es demasiado largo.');
  } catch (error){ return res.status(400).json({ok:false,error:error.message || 'Body inválido.'}); }
  try {
    const input = new URL(googleUrl);
    // Permite pegar directamente la URL del medio, además del enlace compartido.
    if (input.hostname.toLowerCase() === 'lh3.googleusercontent.com'){
      return res.status(200).json(urlsFromBase(googleUrl));
    }
    const html = (await fetchPhotosPage(googleUrl))
      .replace(/\\\//g,'/').replace(/\\u003d/gi,'=').replace(/\\u0026/gi,'&').replace(/&amp;/g,'&');
    const candidates = [...new Set(html.match(/https:\/\/lh3\.googleusercontent\.com\/pw[^\s"'<>\\]+/gi) || [])];
    const valid = candidates.map(s => s.replace(/[),;]+$/g,'')).filter(s => {
      try { return Boolean(urlsFromBase(s)); } catch { return false; }
    });
    if (!valid.length) return res.status(404).json({ok:false,error:'No se encontró una URL de video compatible en la página pública de Google Photos.'});
    valid.sort((a,b)=>b.length-a.length);
    return res.status(200).json(urlsFromBase(valid[0]));
  } catch(error){
    const message = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? 'Google Photos tardó demasiado en responder.'
      : (error?.message || 'No fue posible procesar el enlace.');
    const badUrl = /URL|enlace|HTTPS|dominio|sufijo|formato|página HTML/i.test(message);
    return res.status(badUrl ? 400 : 502).json({ok:false,error:message});
  }
}
