/* Movie Mania HD — shell offline. No intenta descargar/cachar videos de Google Photos. */
const VERSION='mmhd-web-shell-v3-20261024';
const SHELL=`${VERSION}-shell`;
const IMAGES=`${VERSION}-images`;
const ROOT=new URL('./',self.registration.scope);
const files=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(SHELL);
    await Promise.allSettled(files.map(async file=>{
      const response=await fetch(new URL(file,ROOT),{cache:'reload'});
      if(response.ok)await cache.put(new URL(file,ROOT),response);
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys()){
      if(key.startsWith('mmhd-web-')&&key!==SHELL&&key!==IMAGES)await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
async function firstNetwork(request,cacheName,offlineFallback=null){
  const cache=await caches.open(cacheName);
  try{
    const response=await fetch(request);
    if(response.ok)await cache.put(request,response.clone());
    return response;
  }catch(_){
    const hit=await cache.match(request,{ignoreSearch:true});
    if(hit)return hit;
    if(offlineFallback){const cached=await cache.match(offlineFallback);if(cached)return cached;}
    return new Response('No hay conexión y el catálogo aún no está disponible sin internet.',{
      status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}
    });
  }
}
async function cacheImage(request){
  const cache=await caches.open(IMAGES);
  const hit=await cache.match(request);
  if(hit)return hit;
  const response=await fetch(request);
  if(response.ok||response.type==='opaque'){
    // Limita la cantidad de pósters almacenados para evitar crecer sin control.
    const keys=await cache.keys();
    if(keys.length>=160)await cache.delete(keys[0]);
    await cache.put(request,response.clone());
  }
  return response;
}
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.protocol!=='https:'&&url.protocol!=='http:')return;
  if(url.hostname.endsWith('googleusercontent.com')||url.pathname.includes('/api/'))return;
  const sameOrigin=url.origin===ROOT.origin;
  if(sameOrigin){
    const inScope=url.pathname.startsWith(ROOT.pathname);
    if(!inScope)return;
    const relative=url.pathname.slice(ROOT.pathname.length);
    if((relative===''||relative==='index.html')&&(req.mode==='navigate'||req.destination==='document')){
      event.respondWith(firstNetwork(req,SHELL,new URL('index.html',ROOT).href));return;
    }
    if(['manifest.webmanifest','icon-192.png','icon-512.png'].includes(relative)){
      event.respondWith(firstNetwork(req,SHELL));return;
    }
  }
  if(req.destination==='image' && (url.hostname==='image.tmdb.org'||url.hostname.endsWith('githubusercontent.com'))){
    event.respondWith(cacheImage(req).catch(async()=>{
      const cached=await caches.open(IMAGES);
      return (await cached.match(req))||Response.error();
    }));
  }
});
