/* Movie Mania HD V3 — Biblioteca sin conexión para NAVEGADORES.
   Los videos se guardan en OPFS y los metadatos en IndexedDB. No usa Android/data.
   IMPORTANTE: el servidor debe permitir CORS para descargar mediante fetch.
   Alternativa: descargar con navegador + importar desde el dispositivo. */
(()=>{
  'use strict';
  const isAppWebView = location.hostname === 'appassets.androidplatform.net' || !!window.MMHDAndroid;
  const supported = !isAppWebView && window.isSecureContext &&
    !!navigator.storage?.getDirectory && !!window.indexedDB && !!window.ReadableStream;
  const DB_NAME='mmhd_web_offline_v1', STORE='videos';
  const DIR_NAME='videos';
  const active=new Map();
  let cachedItems=[];
  let ready=false;
  let dbPromise=null;
  let directoryPromise=null;
  let renderToken=0;
  let localVideoUrl=null;
  let currentVideoId=null;

  const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
  const formatBytes=n=>{
    if(!Number.isFinite(n))return '—';
    const unit=['B','KB','MB','GB']; let index=0;
    while(n>=1024&&index<3){n/=1024;index++;}
    return n.toFixed(index?1:0)+' '+unit[index];
  };
  function openDB(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>req.result.createObjectStore(STORE,{keyPath:'id'});
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('No se pudo abrir IndexedDB'));
    });
    return dbPromise;
  }
  async function database(action,mode='readonly'){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode);
      let result;
      const req=action(tx.objectStore(STORE));
      if(req){req.onsuccess=()=>result=req.result;req.onerror=()=>reject(req.error||new Error('Error de biblioteca'));}
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(tx.error||new Error('Error de biblioteca'));
      tx.onabort=()=>reject(tx.error||new Error('Operación cancelada'));
    });
  }
  const records=()=>database(store=>store.getAll());
  const getRecord=id=>database(store=>store.get(String(id)));
  const putRecord=record=>database(store=>store.put(record),'readwrite');
  const deleteRecord=id=>database(store=>store.delete(String(id)),'readwrite');
  function getDirectory(){
    if(!directoryPromise)directoryPromise=navigator.storage.getDirectory()
      .then(root=>root.getDirectoryHandle(DIR_NAME,{create:true}));
    return directoryPromise;
  }
  function contentId(movie){return String(movie.id);}
  function videoName(id,extension='mp4'){
    return 'mmhd-'+String(id).replace(/[^\w-]/g,'_')+'.'+extension.replace(/[^a-z0-9]/gi,'').slice(0,8);
  }
  function photoUrl(movie){
    const source=[movie.m37,movie.m22,movie.m18].map(v=>String(v||'').trim()).find(Boolean);
    if(!source)return '';
    if(/=dv(?=$|[?#&])/i.test(source))return source;
    const replaced=source.replace(/=m(?:37|22|18)(?=$|[?#&])/i,'=dv');
    if(replaced!==source)return replaced;
    // Otras variantes de Google Photos: sustituir el parámetro final de calidad.
    if(/^https:\/\/[^/]*googleusercontent\.com\//i.test(source)){
      return source.replace(/=(?:w|s|m)\d+(?:-[\w-]+)?(?=$|[?#&])/i,'=dv');
    }
    return source;
  }
  function itemFromMovie(movie,filename,bytes,mime,sourceType){
    const isEpisode=movie.parentSeriesId!=null;
    const parent=isEpisode?window.MMHDOfflineGetMovieById?.(movie.parentSeriesId):null;
    return {
      id:contentId(movie), parentId:isEpisode?String(movie.parentSeriesId):null,
      title:String(movie.title||'Video sin título'),
      seriesTitle:String(parent?.title||''),
      season:isEpisode?Number(movie.episodeSeason)||0:null,
      episode:isEpisode?Number(movie.episodeNumber)||0:null,
      poster:String(movie.poster||parent?.poster||''),
      backdrop:String(movie.backdrop||parent?.backdrop||''),
      year:String(movie.year||parent?.year||''),
      filename,bytes,mime,sourceType,createdAt:Date.now()
    };
  }
  async function refreshIndex(){
    if(!supported)return;
    cachedItems=(await records()).sort((a,b)=>b.createdAt-a.createdAt);
    ready=true;
    if(window.MMHDOfflineLibraryChanged)window.MMHDOfflineLibraryChanged(cachedItems.length);
    else if(typeof window.renderAll==='function'&&document.getElementById('catalogGrid'))window.renderAll();
  }
  function ui(){
    return {box:document.getElementById('downloadBox'),fill:document.getElementById('downloadFill'),
      label:document.getElementById('downloadLabel'),pct:document.getElementById('downloadPct'),
      status:document.getElementById('downloadStatus')};
  }
  function controls(){
    const {box}=ui();
    if(!box)return {};
    let wrap=box.querySelector('#mmhdWebOfflineActions');
    if(!wrap){
      wrap=document.createElement('div');wrap.id='mmhdWebOfflineActions';
      wrap.className='mmhd-web-download-actions';
      wrap.innerHTML=`<button type="button" id="mmhdWebCancelDownload">Cancelar descarga</button>
        <button type="button" id="mmhdWebBrowserDownload" hidden>Descargar con navegador</button>
        <button type="button" id="mmhdWebImportDownloaded" hidden>Importar archivo descargado</button>`;
      box.appendChild(wrap);
    }
    return {wrap,cancel:wrap.querySelector('#mmhdWebCancelDownload'),
      browser:wrap.querySelector('#mmhdWebBrowserDownload'),
      import:wrap.querySelector('#mmhdWebImportDownloaded')};
  }
  function statusUpdate(label,detail,pct,mode=''){
    const parts=ui();if(!parts.box)return;
    parts.box.classList.add('show');
    parts.box.classList.toggle('done',mode==='done');
    parts.box.classList.toggle('error',mode==='error');
    parts.label.textContent=label;
    parts.status.textContent=detail;
    parts.pct.textContent=pct==null?'—':`${Math.round(pct)}%`;
    parts.fill.style.width=pct==null?'0%':Math.max(0,Math.min(100,pct))+'%';
  }
  function extForFile(file){
    const ext=String(file.name).split('.').pop().toLowerCase();
    return ['mp4','mkv','webm','mov','avi','m4v','ts'].includes(ext)?ext:'mp4';
  }
  function mimeForFile(ext,file){
    return file?.type||({mp4:'video/mp4',m4v:'video/mp4',webm:'video/webm',mkv:'video/x-matroska',mov:'video/quicktime'}[ext]||'application/octet-stream');
  }
  async function saveStream(movie,stream,filename,mime,total,signal,onProgress){
    const dir=await getDirectory();
    const existing=await getRecord(contentId(movie));
    const handle=await dir.getFileHandle(filename,{create:true});
    const writable=await handle.createWritable();
    const reader=stream.getReader();
    let bytes=0,opened=true;
    try{
      while(true){
        if(signal?.aborted)throw new DOMException('Cancelada','AbortError');
        const {value,done}=await reader.read();if(done)break;
        if(bytes===0){
          const prefix=new TextDecoder().decode(value.slice(0,96)).trimStart().toLowerCase();
          if(prefix.startsWith('<!doctype html')||prefix.startsWith('<html')||prefix.startsWith('{\"error\"')){
            throw new Error('El servidor respondió con una página/error, no con un video');
          }
        }
        await writable.write(value);
        bytes+=value.byteLength;
        onProgress?.(bytes,total);
      }
      if(total&&bytes!==total)throw new Error('Descarga incompleta: cantidad de bytes incorrecta');
      if(bytes<128)throw new Error('El servidor no devolvió un video válido');
      await writable.close();opened=false;
      await putRecord(itemFromMovie(movie,filename,bytes,mime,total?'directo':'stream'));
      if(existing?.filename&&existing.filename!==filename){
        try{await dir.removeEntry(existing.filename);}catch(_){}
      }
      await refreshIndex();
      return bytes;
    }catch(err){
      try{await reader.cancel();}catch(_){}
      if(opened){try{await writable.abort();}catch(_){} }
      if(!existing||existing.filename!==filename){try{await dir.removeEntry(filename);}catch(_){} }
      throw err;
    }finally{reader.releaseLock();}
  }
  async function startDownload(movie){
    if(!supported){alert('Tu navegador no permite guardar videos en la biblioteca privada.');return;}
    if(!movie){alert('No hay una película o episodio seleccionado.');return;}
    const id=contentId(movie);
    if(active.has(id)){statusUpdate('Descarga en curso','Esta descarga ya está activa.',null);return;}
    const url=photoUrl(movie);
    if(!url){alert('Este título no tiene enlace de video configurado.');return;}
    const {cancel,browser,import:importButton}=controls();
    if(browser)browser.hidden=true;
    if(importButton)importButton.hidden=true;
    if(cancel)cancel.hidden=false;
    const controller=new AbortController();active.set(id,controller);
    if(cancel)cancel.onclick=()=>controller.abort();
    statusUpdate('Preparando descarga','Conectando con Google Photos…',null);
    try{
      const response=await fetch(url,{mode:'cors',credentials:'omit',cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error(`El servidor respondió HTTP ${response.status}`);
      const contentType=String(response.headers.get('content-type')||'').toLowerCase();
      if(contentType.includes('text/html')||contentType.includes('application/json')){
        throw new Error('El servidor devolvió una página en lugar del archivo de video');
      }
      if(!response.body)throw new Error('El navegador no pudo leer el contenido del archivo');
      const rawTotal=Number(response.headers.get('content-length'));
      const total=rawTotal>0?rawTotal:0;
      const filename=videoName(id+'-'+Date.now(),'mp4');
      const bytes=await saveStream(movie,response.body,filename,'video/mp4',total,controller.signal,
        (received,all)=>{
          const pct=all?Math.min(99,received/all*100):null;
          statusUpdate('Descargando en el navegador',all?
            `${formatBytes(received)} de ${formatBytes(all)} guardados`:
            `${formatBytes(received)} guardados · tamaño total desconocido`,pct);
        });
      statusUpdate('Descarga completada',
        `${formatBytes(bytes)} guardados. Puedes reproducirlo sin internet desde Descargas.`,100,'done');
    }catch(err){
      if(err.name==='AbortError'){
        statusUpdate('Descarga cancelada','El archivo incompleto se ha descartado.',null);
      }else{
        statusUpdate('No se pudo guardar automáticamente',
          `${err.message||'Error al descargar'}. Google Photos puede bloquear el acceso del navegador (CORS). Usa la descarga normal y después impórtala.`,null,'error');
        if(browser){
          browser.hidden=false;browser.onclick=()=>{
            const anchor=document.createElement('a');anchor.href=url;
            anchor.download=String(movie.title||'pelicula')+'.mp4';anchor.rel='noopener noreferrer';
            document.body.append(anchor);anchor.click();anchor.remove();
          };
        }
        if(importButton){importButton.hidden=false;importButton.onclick=()=>selectFile(movie);}
      }
    }finally{
      active.delete(id);if(cancel)cancel.hidden=true;
    }
  }
  function selectFile(movie=null){
    if(!supported){alert('Almacenamiento privado no disponible en este navegador.');return;}
    const input=document.createElement('input');input.type='file';
    input.accept='video/*,.mp4,.mkv,.webm,.mov,.avi,.m4v,.ts';
    input.style.display='none';document.body.appendChild(input);
    input.addEventListener('change',async()=>{
      const file=input.files?.[0];input.remove();if(!file)return;
      if(!movie){
        movie={id:'import-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),
          title:file.name.replace(/\.[^.]+$/,'')};
      }
      const id=contentId(movie);if(active.has(id))return;
      const controller=new AbortController();active.set(id,controller);
      const {cancel,browser,import:importButton}=controls();
      if(browser)browser.hidden=true;if(importButton)importButton.hidden=true;
      if(cancel){cancel.hidden=false;cancel.onclick=()=>controller.abort();}
      statusUpdate('Importando video','Copiando el archivo al almacenamiento privado…',0);
      try{
        const ext=extForFile(file),filename=videoName(id+'-'+Date.now(),ext);
        await saveStream(movie,file.stream(),filename,mimeForFile(ext,file),file.size,
          controller.signal,(done,total)=>statusUpdate('Importando video',
            `${formatBytes(done)} de ${formatBytes(total)} copiados`,total?done*100/total:null));
        statusUpdate('Importación completada','Puedes abrir el archivo sin internet desde Descargas.',100,'done');
      }catch(err){
        statusUpdate(err.name==='AbortError'?'Importación cancelada':'Error de importación',
          err.message||'No se pudo guardar el archivo',null,'error');
      }finally{active.delete(id);if(cancel)cancel.hidden=true;}
    },{once:true});
    input.click();
    // Si cancela el selector, el input no afecta a la biblioteca.
    setTimeout(()=>{if(input.isConnected)input.remove();},300000);
  }
  function closePlayer(){
    const modal=document.getElementById('mmhdOfflinePlayer');
    if(!modal)return;
    const video=modal.querySelector('video');
    video.pause();video.removeAttribute('src');video.load();
    if(localVideoUrl){URL.revokeObjectURL(localVideoUrl);localVideoUrl=null;}
    modal.hidden=true;currentVideoId=null;
    document.body.style.overflow=modal.dataset.oldOverflow||'';
  }
  function makePlayer(){
    let modal=document.getElementById('mmhdOfflinePlayer');if(modal)return modal;
    modal=document.createElement('div');modal.id='mmhdOfflinePlayer';modal.hidden=true;
    modal.innerHTML=`<div class="mmhd-offline-player-box" role="dialog" aria-modal="true" aria-label="Reproductor sin conexión">
      <div class="mmhd-offline-player-head"><strong id="mmhdOfflinePlayingTitle">Video descargado</strong>
       <button type="button" id="mmhdOfflineClosePlayer" aria-label="Cerrar reproductor">✕ Cerrar</button></div>
       <video controls playsinline preload="metadata"></video>
       <p>Reproducción local · El formato de audio y video debe ser compatible con tu navegador.</p>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#mmhdOfflineClosePlayer').onclick=closePlayer;
    modal.addEventListener('click',event=>{if(event.target===modal)closePlayer();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modal.hidden)closePlayer();});
    const video=modal.querySelector('video');
    video.addEventListener('timeupdate',()=>{
      if(!currentVideoId)return;
      try{localStorage.setItem('mmhd_web_offline_resume_'+currentVideoId,String(video.currentTime));}catch(_){}
    });
    video.addEventListener('loadedmetadata',()=>{
      if(!currentVideoId)return;
      const pos=Number(localStorage.getItem('mmhd_web_offline_resume_'+currentVideoId))||0;
      if(pos>0&&pos<video.duration-10)video.currentTime=pos;
    });
    return modal;
  }
  async function play(id){
    try{
      const record=await getRecord(id);
      if(!record)throw new Error('El archivo no existe en la biblioteca offline');
      const dir=await getDirectory();
      const file=await(await dir.getFileHandle(record.filename)).getFile();
      if(!file.size)throw new Error('El archivo está vacío');
      closePlayer();
      localVideoUrl=URL.createObjectURL(file);currentVideoId=String(id);
      const modal=makePlayer();
      modal.dataset.oldOverflow=document.body.style.overflow;
      modal.querySelector('#mmhdOfflinePlayingTitle').textContent=record.title;
      modal.querySelector('video').src=localVideoUrl;
      modal.hidden=false;document.body.style.overflow='hidden';
      await modal.querySelector('video').play().catch(()=>{});
    }catch(err){alert('No se pudo abrir el archivo: '+err.message);}
  }
  async function remove(id){
    if(!confirm('¿Eliminar este archivo descargado?'))return;
    const record=await getRecord(id);if(!record)return;
    if(currentVideoId===String(id))closePlayer();
    const dir=await getDirectory();
    try{await dir.removeEntry(record.filename);}catch(_){}
    await deleteRecord(id);await refreshIndex();
    if(window.MMHDOfflineInDownloads?.())renderLibrary();
  }
  async function renderLibrary(grid=document.getElementById('catalogGrid'),count=document.getElementById('gridCount')){
    if(!grid||!count||!window.MMHDOfflineInDownloads?.())return;
    const token=++renderToken;
    if(!ready){grid.innerHTML='<div class="mmhd-offline-empty">Cargando biblioteca sin conexión…</div>';}
    try{
      if(!ready)await refreshIndex();
      if(token!==renderToken||!window.MMHDOfflineInDownloads?.())return;
      const search=String(window.mmhdOfflineFilterText||'').toLocaleLowerCase('es').trim();
      const list=cachedItems.filter(item=>!search||String(item.title).toLocaleLowerCase('es').includes(search));
      count.textContent=list.length;
      grid.classList.add('mmhd-offline-list');
      grid.innerHTML=`<div class="mmhd-offline-toolbar">
        <div><b>Descargas sin conexión</b><span>${list.length} archivo(s) guardados en este navegador</span></div>
        <button type="button" id="mmhdOfflineImport">+ Importar video del dispositivo</button>
      </div>`+(list.length?list.map(item=>`<article class="mmhd-offline-item">
        <div class="mmhd-offline-cover">${item.poster?`<img loading="lazy" src="${htmlEscape(item.poster)}" alt="">`:'<span>🎬</span>'}</div>
        <div class="mmhd-offline-info"><strong>${htmlEscape(item.title)}</strong>
          <small>${htmlEscape(item.seriesTitle||item.year||'Video local')} · ${formatBytes(item.bytes)}</small>
          <small>Guardado ${new Date(item.createdAt).toLocaleDateString('es-MX')}</small>
          <div class="mmhd-offline-buttons"><button type="button" data-mmhd-offplay="${htmlEscape(item.id)}">▶ Reproducir sin internet</button>
          <button type="button" data-mmhd-offdelete="${htmlEscape(item.id)}">Eliminar</button></div>
        </div>
      </article>`).join(''):
      '<div class="mmhd-offline-empty"><strong>Aún no tienes videos guardados.</strong><p>Descarga desde la ficha de una película o importa un archivo que ya tengas en tu dispositivo.</p></div>');
      grid.querySelector('#mmhdOfflineImport').onclick=()=>selectFile();
      grid.querySelectorAll('[data-mmhd-offplay]').forEach(b=>b.onclick=()=>play(b.dataset.mmhdOffplay));
      grid.querySelectorAll('[data-mmhd-offdelete]').forEach(b=>b.onclick=()=>remove(b.dataset.mmhdOffdelete));
    }catch(err){
      grid.innerHTML='<div class="mmhd-offline-empty">No se pudo abrir la biblioteca local: '+htmlEscape(err.message)+'</div>';
    }
  }
  async function registerPWA(){
    if(!('serviceWorker' in navigator) || window.self!==window.top || isAppWebView)return;
    try{await navigator.serviceWorker.register('./service-worker.js',{scope:'./'});}catch(err){
      console.warn('[MMHD] La interfaz offline no pudo registrarse:',err);
    }
    try{if(navigator.storage.persist)await navigator.storage.persist();}catch(_){}
  }
  window.MMHDWebOffline={supported,startDownload,selectFile,renderLibrary,play,remove,refreshIndex,
    get count(){return cachedItems.length;},get ready(){return ready;},photoUrl};
  if(supported){
    const boot=()=>{refreshIndex().catch(console.warn);registerPWA();};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
    else boot();
  }
})();
