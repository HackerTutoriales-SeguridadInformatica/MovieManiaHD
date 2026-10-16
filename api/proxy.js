// Vercel /api/proxy — streaming de medios de Google; limita destinos y recursos.
// Para protección ante abuso de ancho de banda conviene añadir reglas en Vercel Firewall.
const ALLOWED_HOST = 'lh3.googleusercontent.com';
const MAX_REDIRECTS = 4;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TIME_MS = 60000;

function checkedMediaUrl(value){
  if (typeof value !== 'string' || value.length > 4096) throw Error('URL inválida.');
  let url;
  try { url = new URL(value); } catch { throw Error('URL inválida.'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== ALLOWED_HOST || url.username || url.password || (url.port && url.port !== '443')){
    throw Error('El proxy solo admite HTTPS de lh3.googleusercontent.com.');
  }
  return url;
}

async function openMedia(input, signal){
  let url = checkedMediaUrl(input);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++){
    const response = await fetch(url.href, {
      method:'GET', redirect:'manual', signal,
      headers:{ 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', 'Accept':'*/*' }
    });
    if (response.status >= 300 && response.status < 400){
      const location = response.headers.get('location');
      if (!location) throw Error('Redirección sin destino.');
      url = checkedMediaUrl(new URL(location,url).href);
      await response.body?.cancel();
      continue;
    }
    return response;
  }
  throw Error('Demasiadas redirecciones del medio.');
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Expose-Headers','Content-Length, Content-Type');
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ok:false,error:'Método no permitido.'});
  let url;
  try { url = checkedMediaUrl(req.query?.url); }
  catch(error){ return res.status(400).json({ok:false,error:error.message}); }
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), MAX_TIME_MS);
  const onClose = () => controller.abort();
  res.on('close',onClose);
  let reader;
  try {
    const upstream = await openMedia(url.href,controller.signal);
    if (!upstream.ok) return res.status(502).json({ok:false,error:'Google respondió HTTP '+upstream.status});
    const ct = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ct.startsWith('video/') && ct !== 'application/octet-stream') {
      return res.status(502).json({ok:false,error:'La URL no devolvió un video descargable.'});
    }
    const cl = upstream.headers.get('content-length');
    const size = cl === null ? null : Number(cl);
    if (size !== null && (!Number.isFinite(size) || size < 0 || size > MAX_BYTES)){
      return res.status(413).json({ok:false,error:'El archivo excede el límite de 2 GiB del proxy.'});
    }
    if (!upstream.body) throw Error('La respuesta no contiene un video.');
    res.setHeader('Content-Type', ct);
    if (size !== null) res.setHeader('Content-Length',String(size));
    reader = upstream.body.getReader();
    let received = 0;
    while (true){
      const {done,value} = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BYTES) throw Error('El video excede el límite permitido.');
      if (!res.write(Buffer.from(value))){
        await new Promise((resolve,reject)=>{
          const done = () => { res.off('drain',done); res.off('close',fail); resolve(); };
          const fail = () => { res.off('drain',done); res.off('close',fail); reject(Error('Cliente desconectado.')); };
          res.once('drain',done); res.once('close',fail);
        });
      }
    }
    res.end();
  } catch(error){
    const message = controller.signal.aborted ? 'La descarga expiró o se canceló.' : (error.message || 'Error de descarga.');
    if (res.headersSent) res.destroy();
    else res.status(502).json({ok:false,error:message});
  } finally {
    clearTimeout(timeout);
    res.off('close',onClose);
    try { await reader?.cancel(); } catch {}
  }
}
