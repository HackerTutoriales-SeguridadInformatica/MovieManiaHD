// Movie Mania HD V3 — /api/cast-subtitles
// Convierte SRT/VTT remoto a WebVTT HTTP público, para Chromecast.
// Este endpoint NO es un proxy abierto: solo permite dominios HTTPS autorizados.
const MAX_SUBTITLE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10000;
const DEFAULT_ALLOWED = ['raw.githubusercontent.com', 'gist.githubusercontent.com', 'cdn.jsdelivr.net'];

function allowedHosts(){
  const extra = String(process.env.SUBTITLE_ALLOWED_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  const vercelDomains = [process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL]
    .filter(Boolean).map(host => host.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]);
  return new Set([...DEFAULT_ALLOWED, ...extra, ...vercelDomains]);
}
function checkedUrl(input){
  if (typeof input !== 'string' || input.length > 3500) throw new Error('URL de subtítulos inválida o demasiado larga.');
  let url;
  try { url = new URL(input); } catch { throw new Error('No se pudo interpretar la URL de subtítulos.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !allowedHosts().has(host) || url.username || url.password ||
      (url.port && url.port !== '443') || !host || /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})$/.test(host) || host.endsWith('.local')) {
    throw new Error('Dominio de subtítulos no autorizado. Usa HTTPS y configura SUBTITLE_ALLOWED_HOSTS si es necesario.');
  }
  return url;
}
function convertToVtt(content){
  let text = String(content || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text || /^\s*<(?:!doctype|html|head|body)/i.test(text)) throw new Error('El enlace no devolvió subtítulos SRT/VTT.');
  if (/^WEBVTT(?:\s|$)/.test(text)) {
    if (!/-->/m.test(text)) throw new Error('El archivo VTT no contiene marcas de tiempo.');
    return text + '\n';
  }
  // Solo ajustar coma decimal en líneas de tiempos (sin cambiar el texto de los diálogos).
  text = text.replace(/^([^\n]*-->[^\n]*)$/gm, line => line.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'));
  if (!/^\s*(?:\d+\s*\n)?\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/m.test(text)) {
    throw new Error('Formato inválido: se esperaba SRT o WebVTT.');
  }
  return 'WEBVTT\n\n' + text + '\n';
}
async function fetchSubtitle(startUrl, signal){
  let url = checkedUrl(startUrl);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const response = await fetch(url.href, {
      method: 'GET', redirect: 'manual', signal,
      headers: { Accept: 'text/vtt,text/plain,application/octet-stream;q=0.8,*/*;q=0.1' }
    });
    if (response.status >= 300 && response.status < 400) {
      const destination = response.headers.get('location');
      await response.body?.cancel();
      if (!destination) throw new Error('Redirección de subtítulos sin destino.');
      url = checkedUrl(new URL(destination, url).href);
      continue;
    }
    if (!response.ok) throw new Error('El archivo de subtítulos respondió HTTP ' + response.status + '.');
    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (type.includes('text/html') || type.includes('application/json')) {
      throw new Error('La URL devolvió una página y no el archivo de subtítulos.');
    }
    const reported = Number(response.headers.get('content-length') || 0);
    if (reported > MAX_SUBTITLE_BYTES) throw new Error('El archivo de subtítulos supera 1 MB.');
    if (!response.body) throw new Error('El archivo de subtítulos está vacío.');
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_SUBTITLE_BYTES) throw new Error('El archivo de subtítulos supera 1 MB.');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total);
    return convertToVtt(bytes.toString('utf8'));
  }
  throw new Error('Demasiadas redirecciones de subtítulos.');
}
export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).json({error:'Método no permitido.'});
  const input = req.query?.url;
  try { checkedUrl(input); }
  catch (error) { return res.status(400).json({error:error.message}); }
  try {
    const vtt = await fetchSubtitle(input, AbortSignal.timeout(TIMEOUT_MS));
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=1800');
    if (req.method === 'HEAD') return res.status(200).end();
    return res.status(200).send(vtt);
  } catch (error) {
    console.warn('Movie Mania HD: error al preparar pista Cast', error.message);
    return res.status(502).json({error: error.name === 'TimeoutError' ? 'Se agotó el tiempo al descargar los subtítulos.' : error.message});
  }
}
export const __testing = { checkedUrl, convertToVtt, fetchSubtitle };
