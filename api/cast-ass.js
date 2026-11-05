// Movie Mania HD V3 — Chromecast: ASS/SSA -> WebVTT, karaoke complejo legible.
// El archivo ASS original se mantiene sin cambios para el reproductor web.
// Compatible con el receptor Cast estándar, que no admite renderizado ASS/libass.
// Seguridad: no es un proxy abierto; sólo lee archivos HTTPS de dominios autorizados.
const MAX_SUBTITLE_BYTES = 8 * 1024 * 1024;
const MAX_VTT_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 21000;
const DEFAULT_ALLOWED = ['raw.githubusercontent.com', 'gist.githubusercontent.com', 'cdn.jsdelivr.net'];

function allowedHosts() {
  const extra = String(process.env.SUBTITLE_ALLOWED_HOSTS || '').split(',')
    .map(s => s.trim().toLowerCase()).filter(Boolean);
  return new Set([...DEFAULT_ALLOWED, ...extra]);
}
function checkedUrl(input) {
  if (typeof input !== 'string' || input.length > 3500) throw new Error('URL de subtítulos inválida.');
  let url;
  try { url = new URL(input); } catch { throw new Error('URL de subtítulos no válida.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !allowedHosts().has(host) ||
      url.username || url.password || (url.port && url.port !== '443') ||
      host.endsWith('.local') || host === 'localhost' ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    throw new Error('Dominio de subtítulos no autorizado: utiliza HTTPS de GitHub Raw o CDN permitida.');
  }
  return url;
}
function parseTime(input) {
  const m = String(input).trim().match(/^(\d+):(\d{2}):(\d{2})[.](\d{1,3})$/);
  if (!m) return NaN;
  return +m[1]*3600 + +m[2]*60 + +m[3] + (+m[4])/Math.pow(10,m[4].length);
}
function vttTime(seconds) {
  let ms = Math.round(seconds * 1000);
  const hrs = Math.floor(ms / 3600000); ms -= hrs*3600000;
  const mins = Math.floor(ms / 60000); ms -= mins*60000;
  const secs = Math.floor(ms / 1000); ms -= secs*1000;
  return String(hrs).padStart(2,'0')+':'+String(mins).padStart(2,'0')+':'+String(secs).padStart(2,'0')+'.'+String(ms).padStart(3,'0');
}
// Divide frases excepcionalmente largas sin alterar los tiempos ni las posiciones ASS.
// Las líneas de letras de canciones ya separadas mediante \N se conservan.
function wrapCastLine(text, maxChars = 52) {
  return String(text).split('\n').map(line => {
    if (line.length <= maxChars || !/\s/.test(line)) return line;
    const result = [];
    let current = '';
    for (const word of line.split(/\s+/)) {
      if (current && current.length + 1 + word.length > maxChars) {
        result.push(current); current = word;
      } else current += (current ? ' ' : '') + word;
    }
    if (current) result.push(current);
    return result.join('\n');
  }).join('\n');
}
function fieldObject(str, columns) {
  const values = str.split(',');
  if (values.length > columns.length) {
    values.splice(columns.length-1, values.length-(columns.length-1), values.slice(columns.length-1).join(','));
  }
  const out = Object.create(null);
  columns.forEach((col, i) => { out[col] = String(values[i] ?? '').trim(); });
  return out;
}
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function convertASS(content) {
  const src = String(content || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!/\[Events\]/i.test(src) || !/^\s*Dialogue\s*:/mi.test(src)) {
    throw new Error('No se encontró contenido ASS/SSA válido.');
  }
  // Al hacer karaoke con Aegisub, el ASS puede contener miles de letras
  // individuales (Effector [fx]) y los versos completos como Comment.
  // Sólo para archivos MUY complejos activamos la lectura segura usada
  // por el reproductor web: línea original ROMAJI arriba, traducción abajo.
  // El umbral protege la conversión existente de SRT y ASS más sencillos.
  const sourceLines = src.split('\n');
  const complexKaraoke = sourceLines.filter(l =>
    /^\s*Dialogue\s*:/i.test(l) && /,\s*Effector\s*\[fx\]\s*,/i.test(l)
  ).length > 1200;
  const lyricStyle = name => /(?:OP|ED)[^,]*-(?:RO|TL)$/i.test(String(name || ''));
  const japaneseLyricStyle = name => /(?:OP|ED)[^,]*-KA$/i.test(String(name || ''));
  const originalLyrics = new Set();
  if (complexKaraoke) {
    // Registrar los estilos con versos recuperables. Es importante no
    // introducir notas de Comment que sólo documentan el proyecto.
    for (const raw of sourceLines) {
      if (!/^\s*Comment\s*:/i.test(raw)) continue;
      const cols = raw.slice(raw.indexOf(':')+1).split(',',10);
      if (cols.length >= 10 && lyricStyle(cols[3]) && cols[9].trim() &&
          !/^(?:opening|ending)\s*[-–]\s*(?:ro|tl)\b/i.test(cols[9].trim())) {
        originalLyrics.add(cols[3].trim());
      }
    }
  }
  // Otro caso habitual: el ASS no tiene miles de efectos pero sí contiene
  // tres pistas del mismo opening: romaji, japonés (KA) y traducción (TL).
  // Para la TV mantener las dos pistas legibles RO/TL, como el modo web seguro.
  const layeredLyrics = sourceLines.some(l =>
    /^\s*Style\s*:[^,]*(?:OP|ED)[^,]*-RO\s*,/i.test(l)
  ) && sourceLines.some(l =>
    /^\s*Style\s*:[^,]*(?:OP|ED)[^,]*-TL\s*,/i.test(l)
  );
  let section = '', width = 1280, height = 720, styleColumns = [], eventColumns = [];
  const styles = Object.create(null), entries = [];
  let sequence = 0;
  for (const raw of sourceLines) {
    const line = raw.trim();
    if (/^\[[^\]]+\]$/.test(line)) { section = line.toLowerCase(); continue; }
    if (section === '[script info]') {
      let m = line.match(/^PlayResX\s*:\s*(\d+)/i); if (m) width = +m[1] || width;
      m = line.match(/^PlayResY\s*:\s*(\d+)/i); if (m) height = +m[1] || height;
    } else if (section === '[v4+ styles]' || section === '[v4 styles]') {
      if (/^Format\s*:/i.test(line)) {
        styleColumns = line.replace(/^Format\s*:/i,'').split(',').map(x => x.trim().toLowerCase());
      } else if (/^Style\s*:/i.test(line) && styleColumns.length) {
        const o = fieldObject(line.replace(/^Style\s*:/i, ''), styleColumns);
        styles[o.name] = o;
      }
    } else if (section === '[events]') {
      if (/^Format\s*:/i.test(line)) {
        eventColumns = line.replace(/^Format\s*:/i,'').split(',').map(x => x.trim().toLowerCase());
      } else if (/^(?:Dialogue|Comment)\s*:/i.test(line)) {
        const isComment = /^Comment\s*:/i.test(line);
        if (eventColumns.length === 0) {
          eventColumns = ['layer','start','end','style','name','marginl','marginr','marginv','effect','text'];
        }
        const o = fieldObject(line.replace(/^(?:Dialogue|Comment)\s*:/i,''), eventColumns);
        const start = parseTime(o.start), end = parseTime(o.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        // Los Comment normales son notas de producción: nunca enviarlos.
        // Únicamente recuperar versos originales RO/TL en ASS complejos.
        if (isComment) {
          if (!complexKaraoke || !lyricStyle(o.style) || !originalLyrics.has(o.style)) continue;
        } else {
          if (complexKaraoke && /Effector\s*\[fx\]/i.test(o.effect || '')) continue;
          if ((complexKaraoke || layeredLyrics) && japaneseLyricStyle(o.style)) continue;
          if (complexKaraoke && lyricStyle(o.style) && originalLyrics.has(o.style)) continue;
        }
        const rawText = o.text || '';
        // Los dibujos vectoriales de ASS no son líneas de texto.
        if (/\{[^}]*\\p[1-9]/i.test(rawText)) continue;
        // El formato ASS usa {\an8}, {\pos(...)} y otras etiquetas técnicas,
        // pero algunos archivos también traen anotaciones editoriales como
        // {escuela}, {lluvia pasajera} o {¿...}. NINGÚN bloque entre llaves
        // debe llegar como texto visible al receptor Cast.
        const text = rawText
          .replace(/\{[^{}]*\}/g, '')
          .replace(/\\N/g,'\n').replace(/\\n/g,' ').replace(/\\h/g,' ')
          .replace(/\\([{}])/g,'$1')
          .replace(/\u0000/g,'')
          .replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').trim();
        if (!text || !/[^\s]/.test(text)) continue;
        // Los letreros de anime también pueden estar dibujados letra por
        // letra o a intervalos de unos fotogramas: no enviarlos como cues
        // independientes que parpadean o tapan el vídeo en Chromecast.
        if (complexKaraoke && !isComment && /signs?/i.test(o.style || '') &&
            ((end-start)<0.45 || text.length < 3)) continue;
        // ASS normalmente duplica eventos en varias capas para crear brillo/contorno.
        const tags = (rawText.match(/\{[^}]*\\[^}]*\}/g) || []).join('');
        const alignMatch = tags.match(/\\an([1-9])(?:\\|\}|$)/i);
        const posMatch = tags.match(/\\(?:pos|move)\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/i);
        const style = styles[o.style] || styles.Default || {};
        let alignment = +alignMatch?.[1] || +style.alignment || 2;
        // SSA original usa sistema de alineación diferente.
        if (![1,2,3,4,5,6,7,8,9].includes(alignment)) alignment = 2;
        const marginV = Math.max(0,+o.marginv || +style.marginv || 0);
        const marginL = Math.max(0,+o.marginl || +style.marginl || 0);
        const marginR = Math.max(0,+o.marginr || +style.marginr || 0);
        let x, y;
        if (posMatch) {
          x = clamp(100*(+posMatch[1])/width, 3, 97);
          y = clamp(100*(+posMatch[2])/height, 2, 94);
        } else {
          const col = alignment % 3;  // 1 izquierda, 2 centro, 0 derecha.
          x = col===1 ? clamp(100*marginL/width + 3,3,40) :
              col===2 ? 50 : clamp(97-100*marginR/width,60,97);
          // WebVTT no admite todas las capas ASS; preservar al menos región superior/inferior.
          y = alignment>=7 ? clamp(3+100*marginV/height,3,38) :
              alignment>=4 ? 48 : clamp(88-100*marginV/height,65,89);
        }
        const align = alignment%3===1?'start':alignment%3===2?'center':'end';
        const linePercent = Math.round(y*10)/10;
        const positionPercent = Math.round(x*10)/10;
        // Chromecast/WebVTT necesita además un ANCHO de caja (size).
        // Sin size, los rótulos independientes terminan ocupando el ancho del
        // cuadro completo y el receptor los puede apilar en el centro.
        // Un letrero con \pos conserva su ancla X; diálogos centrados usan
        // una sola región ancha; letras izquierda/derecha utilizan mitades.
        const anchored = !!posMatch;
        let cueSize, cueX = positionPercent, cueAlign = align;
        if (anchored) {
          cueAlign = 'center';
          const sign = /(?:sign|letrero|cartel|type)/i.test(o.style || '');
          // La región acotada de un letrero no se extiende hacia otra caja.
          cueSize = sign ? 22 : 32;
          if (text.length > 33 && !text.includes('\n')) cueSize = Math.min(38,cueSize+8);
          cueSize = Math.min(cueSize, Math.max(9, 2*Math.min(cueX,100-cueX)-2));
        } else if (align === 'start') {
          cueX = clamp(cueX,3,45);
          cueSize = Math.min(44, 96-cueX);
        } else if (align === 'end') {
          cueX = clamp(cueX,55,97);
          cueSize = Math.min(44, cueX-3);
        } else {
          cueX = 50;
          cueSize = 90;
        }
        const cueSettings = `line:${linePercent}% position:${Math.round(cueX*10)/10}% size:${Math.round(cueSize)}% align:${cueAlign}`;
        // Para subtítulos simultáneos, conservar cada texto y su posicionamiento.
        // Ignoramos diferencias de margen entre capas con el mismo texto para no duplicarlo.
        const dedupe = complexKaraoke && /signs?/i.test(o.style || '')
          ? [Math.round(start*100),Math.round(end*100),text.toLowerCase(),o.style].join('|')
          : [Math.round(start*100),Math.round(end*100),text,alignment,
             posMatch ? Math.round(x)+':'+Math.round(y) : 'flow'].join('|');
        entries.push({start,end,text,cueSettings,dedupe,sequence:sequence++,x:cueX,y,align:cueAlign,size:cueSize});
      }
    }
    if (entries.length > 50000) throw new Error('ASS demasiado complejo para Chromecast.');
  }
  if (!entries.length) throw new Error('No se encontraron diálogos ASS legibles.');
  const seen = new Set();
  const filtered = entries.filter(e => {
    if (seen.has(e.dedupe)) return false;
    seen.add(e.dedupe); return true;
  }).sort((a,b) => a.start-b.start || a.sequence-b.sequence);
  // Si dos letras simultáneas ocupan la misma zona, separarlas en la TV.
  const occupied = new Map();
  for (const e of filtered) {
    const key = [Math.round(e.start*100),Math.round(e.end*100),Math.round(e.x),Math.round(e.y)].join('|');
    const index = occupied.get(key) || 0;
    occupied.set(key,index+1);
    if (index) {
      const shifted = clamp(e.y+(e.y<45 ? 6 : e.y>55 ? -6 : 5)*Math.min(3,index),3,92);
      e.cueSettings = `line:${Math.round(shifted*10)/10}% position:${Math.round(e.x*10)/10}% size:${Math.round(e.size)}% align:${e.align}`;
    }
  }
  let output = 'WEBVTT\n\n', outputBytes = Buffer.byteLength(output,'utf8');
  for (const e of filtered) {
    // Evitar que una letra que contenga HTML sea interpretada como marcado VTT.
    const safe = wrapCastLine(e.text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const cue = vttTime(e.start)+' --> '+vttTime(e.end)+' '+e.cueSettings+'\n'+safe+'\n\n';
    outputBytes += Buffer.byteLength(cue,'utf8');
    if (outputBytes > MAX_VTT_BYTES) throw new Error('La pista convertida supera 5 MB.');
    output += cue;
  }
  return output;
}
async function fetchASS(input, signal) {
  let url = checkedUrl(input);
  for (let tries = 0; tries <= MAX_REDIRECTS; tries++) {
    const response = await fetch(url.href, {
      method:'GET', redirect:'manual', signal,
      headers:{Accept:'text/plain,application/octet-stream;q=0.9,*/*;q=0.1'}
    });
    if (response.status >= 300 && response.status < 400) {
      const redirect = response.headers.get('location');
      if (response.body) await response.body.cancel();
      if (!redirect) throw new Error('Redirección sin destino.');
      url = checkedUrl(new URL(redirect,url).href); continue;
    }
    if (!response.ok) throw new Error('El archivo ASS respondió HTTP '+response.status+'.');
    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (type.includes('text/html') || type.includes('application/json')) throw new Error('La URL devolvió una página, no un archivo ASS.');
    if (+response.headers.get('content-length') > MAX_SUBTITLE_BYTES) throw new Error('Archivo ASS mayor a 8 MB.');
    if (!response.body) throw new Error('Archivo de subtítulos vacío.');
    const reader = response.body.getReader(), chunks=[];
    let total=0;
    try {
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        total += value.byteLength;
        if (total > MAX_SUBTITLE_BYTES) throw new Error('Archivo ASS mayor a 8 MB.');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
    return convertASS(Buffer.concat(chunks,total).toString('utf8'));
  }
  throw new Error('Demasiadas redirecciones.');
}
export default async function handler(req,res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cross-Origin-Resource-Policy','cross-origin');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='OPTIONS') return res.status(204).end();
  if(!['GET','HEAD'].includes(req.method))return res.status(405).json({error:'Método no permitido.'});
  try { checkedUrl(req.query?.url); }
  catch(e){return res.status(400).json({error:e.message});}
  try {
    const output = await fetchASS(req.query.url,AbortSignal.timeout(TIMEOUT_MS));
    res.setHeader('Content-Type','text/vtt; charset=utf-8');
    res.setHeader('Cache-Control','public, max-age=120, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400');
    if(req.method==='HEAD')return res.status(200).end();
    return res.status(200).send(output);
  } catch(e) {
    console.warn('[MMHD] Conversión ASS para Chromecast:',e.message);
    const code = /mayor a|supera 5 MB/.test(e.message) ? 413 : 502;
    if(code===502)res.setHeader('Retry-After','2');
    res.setHeader('Cache-Control','no-store');
    return res.status(code).json({error:e.name==='TimeoutError'?'Tiempo de descarga de subtítulos agotado.':e.message});
  }
}
export const __testing = {convertASS, checkedUrl, fetchASS};
