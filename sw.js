/* DTR POB Network · offline shell + visible UPDATE NOW flow.
   App assets are available offline. Darkstat telemetry remains network-only. */
const CACHE_PREFIX='dtr-pob-network-pwa-';
const CACHE_NAME=`${CACHE_PREFIX}2026-09-02-pwa-6`;
const APP_SHELL=[
  './','./index.html','./styles.css','./enhancements.css','./dtr-quality.css','./dtr-uplink.css','./app.js','./enhancements.js','./dtr-quality.js','./dtr-uplink.js','./dtr-pwa-updates.js','./manifest.webmanifest',
  './assets/favicon-64.png','./assets/apple-touch-icon.png','./assets/icon-192.png','./assets/icon-512.png','./assets/icon-maskable-512.png'
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});

async function networkFirst(request,fallback){
  const cache=await caches.open(CACHE_NAME);
  try{
    const response=await fetch(request,{cache:'no-store'});
    if(!response.ok)throw new Error(`NETWORK RESPONSE ${response.status}`);
    await cache.put(request,response.clone());
    return response;
  }catch(error){
    const cached=await cache.match(request,{ignoreSearch:true})||await cache.match(fallback);
    if(cached)return cached;
    throw error;
  }
}

async function cacheFirst(request){
  const cache=await caches.open(CACHE_NAME);
  const cached=await cache.match(request,{ignoreSearch:true});
  if(cached)return cached;
  const response=await fetch(request);
  if(response.ok)await cache.put(request,response.clone());
  return response;
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);

  if(url.origin===self.location.origin&&url.searchParams.has('dtr_update_probe')){
    event.respondWith(fetch(request,{cache:'no-store'}));
    return;
  }

  if(request.mode==='navigate'){
    event.respondWith(networkFirst(request,'./index.html'));
    return;
  }

  if(url.origin===self.location.origin){
    event.respondWith(cacheFirst(request));
    return;
  }

  if(url.hostname==='fonts.googleapis.com'||url.hostname==='fonts.gstatic.com')event.respondWith(cacheFirst(request));
});